/**
 * Platform composition root: the one place every subsystem is wired.
 *
 * Why A single composition root
 *
 * The registry in `services.ts` provides a lifetime and a lookup; it deliberately
 * knows nothing about which services exist. This module is the other half: the
 * complete, greppable list of what RayZen runs and what each thing depends on.
 * Keeping registration in one function means the dependency graph is readable in a
 * single screen, and it means a subsystem's constructor arguments are visible at
 * review time rather than discovered by following imports.
 *
 * Why it is request-scoped
 *
 * A Worker isolate serves many requests. Anything memoised at module scope is
 * shared across users and across time, which is the defect the master architecture
 * calls P1 (`src/settings/settings.ts:109`). `createPlatform` is called per request
 * and its container is discarded with the request, so a KV-bound repository can
 * never leak from one request into the next.
 *
 * Why it is lazy all the way down
 *
 * `createPlatform` itself performs no I/O and constructs no service. It registers
 * factories and attaches event subscribers. A WebSocket upgrade that never asks for
 * analytics pays for one `Map` and a few closures. That property is what makes it
 * acceptable to create a platform on the data plane at all, and it is asserted by a
 * test that checks `isResolved` is false for every service after construction.
 *
 * WHAT `dispose` IS FOR
 *
 * Two things, in order: flush the repositories so mutations reach KV, and detach
 * the event subscribers so no listener outlives the request. A handler that forgets
 * to call it loses counters and history, so the intended pattern is
 * `ctx.waitUntil(platform.dispose())` at the request tail.
 */

import type { CapabilityContext } from './features';
import { CORE_FEATURES, createFeatureRegistry, type FeatureRegistry } from './features';
import { createEventBus, type EventBus, type ListenerFailure } from './events';
import { createRepositories, type Repositories } from './repositories';
import { createServiceRegistry, type ServiceContainer } from './services';
import { createStorage } from '@storage';
import {
    createAnalyticsService,
    subscribeAnalytics,
    type AnalyticsService
} from '@features/analytics/service';
import { createHistoryService, subscribeHistory, type HistoryService } from '@features/history/service';
import { createDiagnosticsService } from '@features/diagnostics/service';
import { createScannerService, type ScannerService } from '@features/scanner/service';
import { createPresetRegistry, CORE_PRESETS, type PresetRegistry } from '@features/presets/service';
import {
    createRecommendationEngine,
    diagnosticsProvider,
    presetProvider,
    scannerProvider,
    type RecommendationEngine
} from '@features/recommendations/service';
import { createOptimizationService, optimizationProvider, type OptimizationService } from '@features/optimization/service';
import type { ProbeDeps } from '@features/scanner/probe';

export interface PlatformOptions {
    /**
     * The probe transport. Optional because most requests never scan, and because
     * `cloudflare:sockets` must not be imported eagerly: it is external to the
     * bundle and unresolvable under Node, so a test's module graph would break.
     * The scanner service is registered either way; asking for it without a
     * connector is the error, not creating the platform without one.
     */
    probe?: ProbeDeps;
}

/**
 * Everything a request handler needs from the platform.
 *
 * `services` is the lazy container. The registries and the bus are exposed
 * directly because they are cheap, stateless-per-request values that callers use
 * for control flow rather than for I/O.
 */
export interface Platform {
    services: ServiceContainer;
    events: EventBus;
    features: FeatureRegistry;
    presets: PresetRegistry;
    recommendations: RecommendationEngine;
    /**
     * Flushes repositories, drains fire-and-forget listeners, and detaches
     * subscribers. Returns what was written and what failed so a caller can log
     * rather than guess. Safe to call more than once.
     */
    dispose(): Promise<{ writes: number; failures: readonly ListenerFailure[] }>;
}

/**
 * Builds the capability context from values a caller already holds.
 *
 * A helper rather than a method on the platform, because it needs settings and KV
 * facts that the platform deliberately does not read: a capability check runs on
 * the panel render path, and a function that performed a KV read to answer "is
 * Telegram configured?" would put a read on every page load.
 */
export function capabilityContext(input: CapabilityContext): CapabilityContext {
    return input;
}

/**
 * Facades that defer resolution to first call.
 *
 * The event subscribers need a service object at *attach* time, but resolving one
 * then would construct a KV-backed repository on every request including the ones
 * that publish nothing. Each facade forwards to `registry.get`, so the service is
 * built on the first event that actually reaches a listener and never otherwise.
 *
 * Written out rather than produced by a `Proxy`: three lines per method is cheaper
 * in bundle bytes than a proxy trap, and the explicit form keeps the return types
 * checked against the interface instead of cast through `any`.
 */
function deferredAnalytics(registry: ServiceContainer): AnalyticsService {
    return {
        record: (metric, by) => registry.get('analytics').record(metric, by),
        snapshot: () => registry.get('analytics').snapshot(),
        statistics: () => registry.get('analytics').statistics(),
        total: metric => registry.get('analytics').total(metric),
        reset: () => registry.get('analytics').reset()
    };
}

function deferredHistory(registry: ServiceContainer): HistoryService {
    return {
        record: (kind, summary, detail) => registry.get('history').record(kind, summary, detail),
        list: limit => registry.get('history').list(limit),
        listByKind: (kind, limit) => registry.get('history').listByKind(kind, limit),
        latest: kind => registry.get('history').latest(kind),
        clear: () => registry.get('history').clear()
    };
}

function deferredScanner(registry: ServiceContainer): ScannerService {
    return {
        run: request => registry.get('scanner').run(request),
        dryRun: request => registry.get('scanner').dryRun(request),
        history: (kind, limit) => registry.get('scanner').history(kind, limit),
        schedule: (kind, options) => registry.get('scanner').schedule(kind, options),
        best: kind => registry.get('scanner').best(kind),
        intelligence: kind => registry.get('scanner').intelligence(kind),
        reset: () => registry.get('scanner').reset()
    };
}

function deferredOptimization(registry: ServiceContainer): OptimizationService {
    return {
        profiles: () => registry.get('optimization').profiles(),
        evaluate: settings => registry.get('optimization').evaluate(settings),
        recommend: settings => registry.get('optimization').recommend(settings)
    };
}

export function createPlatform(kv: KVNamespace, options: PlatformOptions = {}): Platform {
    const events = createEventBus();
    const features = createFeatureRegistry(CORE_FEATURES);
    const presets = createPresetRegistry(CORE_PRESETS);

    const registry = createServiceRegistry();

    // `repositories` is the only stateful service and every other KV-backed
    // service resolves through it, which is what makes the flush-once write budget
    // hold: two services bumping counters share one document.
    let repositories: Repositories | null = null;

    registry
        .register('storage', () => createStorage(kv))
        .register('events', () => events)
        .register('repositories', () => {
            repositories = createRepositories(kv);
            return repositories;
        })
        .register('analytics', services => createAnalyticsService(services.get('repositories').metrics))
        .register('history', services => createHistoryService(services.get('repositories').history))
        .register('diagnostics', () => createDiagnosticsService())
        .register('optimization', services => createOptimizationService(presets, services.get('repositories').scanner))
        .register('scanner', services => {
            if (!options.probe) {
                throw new Error(
                    'Scanner requested without a probe transport. Pass `probe` to createPlatform.'
                );
            }

            return createScannerService({
                probe: options.probe,
                repository: services.get('repositories').scanner,
                events
            });
        });

    // Subscribers are attached eagerly and are the one exception to laziness,
    // because a listener registered after an event was published has already
    // missed it. Attaching costs two closures and no I/O; the services they
    // reference are still resolved on first delivery, via the `deferred` facades
    // below.
    const detach = [
        subscribeAnalytics(events, deferredAnalytics(registry)),
        subscribeHistory(events, deferredHistory(registry))
    ];

    const recommendations = createRecommendationEngine([
        diagnosticsProvider(createDiagnosticsService()),
        presetProvider(presets),
        optimizationProvider(deferredOptimization(registry)),
        // The scanner provider is registered only when a transport exists. Without
        // one, `scanner.best` would throw on the recommendation path, and a
        // recommendation list that fails because scanning is unavailable is worse
        // than one that simply has no scan-derived advice.
        ...(options.probe ? [scannerProvider(deferredScanner(registry))] : [])
    ]);

    let disposed = false;

    return {
        services: registry,
        events,
        features,
        presets,
        recommendations,

        async dispose() {
            if (disposed) return { writes: 0, failures: [] };
            disposed = true;

            for (const off of detach) off();

            // Order matters: listeners write through repositories, so their
            // promises must settle before the flush, or the flush writes a
            // document that is still being mutated.
            const failures = await events.settled();
            const writes = repositories ? await repositories.flush() : 0;

            return { writes, failures };
        }
    };
}

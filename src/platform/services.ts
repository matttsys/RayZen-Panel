/**
 * Service registry: request-scoped lazy resolution of platform services.
 *
 * Why not A DI container
 *
 * A reflective container needs decorators, metadata emission and a runtime that
 * can walk constructor parameters. In a Worker that costs bundle bytes for a
 * problem this codebase does not have: the dependency graph is small, known at
 * compile time, and every edge is already visible in an import statement. What the
 * codebase actually lacks is a *lifetime*: somewhere for "the thing that exists
 * once per request" to live, so that two subsystems handling the same request see
 * the same analytics recorder and the same KV-backed repository rather than each
 * constructing their own.
 *
 * So this registry is deliberately a typed lazy-singleton map with a request
 * lifetime, and nothing more. It is roughly 60 lines and adds no dependency.
 *
 * Why request-scoped and not module-scoped
 *
 * `src/settings/settings.ts:109` holds request state in a module global. In a
 * Worker, one isolate serves many requests, so that global is shared across users
 * and across time. It is the defect the master architecture calls P1. A registry
 * that memoised at module scope would recreate exactly that bug at a larger scale,
 * because it would cache a KV-bound repository from a previous request. Every
 * container here is created per request and discarded with it.
 *
 * WHY LAZY
 *
 * Most requests use almost nothing. A WebSocket upgrade needs no analytics, no
 * diagnostics and no scanner. Constructing services eagerly would put that work on
 * the data plane's critical path. A factory runs on first `get`, and never if the
 * service is not asked for.
 */

/**
 * The service catalogue.
 *
 * Keys are declared as an interface rather than a string map so `get` returns the
 * right type and a missing registration is a compile error at the call site, not a
 * runtime `undefined`. Concrete service types are imported lazily via `type` so
 * this module creates no runtime dependency on any subsystem.
 */
export interface ServiceMap {
    storage: import('@storage').Storage;
    events: import('./events').EventBus;
    repositories: import('./repositories').Repositories;
    analytics: import('@features/analytics/service').AnalyticsService;
    history: import('@features/history/service').HistoryService;
    diagnostics: import('@features/diagnostics/service').DiagnosticsService;
    scanner: import('@features/scanner/service').ScannerService;
    optimization: import('@features/optimization/service').OptimizationService;
}

export type ServiceKey = keyof ServiceMap;

/** A factory receives the container so a service can depend on other services. */
export type ServiceFactory<K extends ServiceKey> = (services: ServiceContainer) => ServiceMap[K];

export interface ServiceContainer {
    /**
     * Resolves a service, constructing it on first use.
     *
     * Throws when nothing is registered. That is deliberate: a silent `undefined`
     * would surface far from the cause, and every registration happens in one
     * place (`createPlatform`), so an unregistered key is a programming error
     * rather than a runtime condition to handle.
     */
    get<K extends ServiceKey>(key: K): ServiceMap[K];
    /** True when a factory is registered, whether or not it has been constructed. */
    has(key: ServiceKey): boolean;
    /** True when the service has already been constructed. Used by tests and diagnostics. */
    isResolved(key: ServiceKey): boolean;
    /** Registered keys, in registration order. */
    keys(): ServiceKey[];
}

export interface ServiceRegistry extends ServiceContainer {
    /**
     * Registers a factory. Re-registering an already-resolved key throws, because
     * some caller is already holding the old instance and would silently diverge
     * from later callers.
     */
    register<K extends ServiceKey>(key: K, factory: ServiceFactory<K>): ServiceRegistry;
    /** Registers an already-constructed value. Used for `storage` and in tests. */
    provide<K extends ServiceKey>(key: K, value: ServiceMap[K]): ServiceRegistry;
}

export function createServiceRegistry(): ServiceRegistry {
    const factories = new Map<ServiceKey, ServiceFactory<ServiceKey>>();
    const instances = new Map<ServiceKey, unknown>();
    const resolving = new Set<ServiceKey>();

    const registry: ServiceRegistry = {
        register(key, factory) {
            if (instances.has(key)) {
                throw new Error(`Service '${key}' is already resolved and cannot be re-registered.`);
            }

            factories.set(key, factory as ServiceFactory<ServiceKey>);
            return registry;
        },

        provide(key, value) {
            factories.set(key, () => value);
            instances.set(key, value);
            return registry;
        },

        get(key) {
            const existing = instances.get(key);
            if (existing !== undefined) return existing as ServiceMap[typeof key];

            const factory = factories.get(key);
            if (!factory) {
                throw new Error(`Service '${key}' is not registered.`);
            }

            // A cycle would otherwise recurse until the stack overflows, which
            // reports the symptom and hides the cause.
            if (resolving.has(key)) {
                const chain = [...resolving, key].join(' -> ');
                throw new Error(`Circular service dependency: ${chain}`);
            }

            resolving.add(key);
            try {
                const value = factory(registry);
                instances.set(key, value);
                return value as ServiceMap[typeof key];
            } finally {
                resolving.delete(key);
            }
        },

        has(key) {
            return factories.has(key);
        },

        isResolved(key) {
            return instances.has(key);
        },

        keys() {
            return Array.from(factories.keys());
        }
    };

    return registry;
}

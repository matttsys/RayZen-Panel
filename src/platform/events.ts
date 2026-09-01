/**
 * Event bus: the seam that lets subsystems observe each other without importing
 * each other.
 *
 * Why this exists
 *
 * Before this module, cross-cutting concerns had exactly one implementation
 * strategy: call the other module directly. `src/handlers/panel.ts` imports the
 * Cloudflare deploy client, the Warp client, the validator, the KV layer and the
 * Telegram client, because every one of those things must happen when settings
 * are saved. Adding a sixth concern (record the save in history, invalidate a
 * cached diagnosis, bump an analytics counter) means a sixth import in the
 * handler and a sixth reason for the handler to change.
 *
 * The bus inverts that. A handler publishes "settings.updated" and does not know
 * or care who listens. History, analytics and diagnostics subscribe. None of them
 * appear in the handler's import list, and adding a seventh listener does not
 * touch the handler at all.
 *
 * What it deliberately is not
 *
 * This is not a message queue, not durable, and not cross-isolate. A Worker
 * isolate lives for one request burst; an event published in isolate A is never
 * seen by isolate B. Anything that must survive the request goes to KV through a
 * repository, and the listener that writes it is responsible for that write.
 * Treating this as durable would be the single most likely way to misuse it, so
 * it is stated first.
 *
 * Design constraints this satisfies
 *
 *   1. A listener that throws must not break the publisher. A broken analytics
 *      counter cannot be allowed to fail a settings save. Errors are collected
 *      and reported, never propagated.
 *   2. Publishing must be usable from a hot path, so `emit` is synchronous and
 *      allocation-light when there are no listeners (the common case).
 *   3. Async listeners exist (KV writes are async) but a publisher must be able
 *      to choose not to wait. `emit` fires and forgets with error capture;
 *      `emitAsync` awaits every listener.
 *   4. Event names are a closed union, not strings, so a typo is a compile error
 *      and the full event catalogue is greppable in one place.
 */

import type { ValidationIssue } from '#types/platform';

/**
 * The complete event catalogue and each event's payload.
 *
 * Adding an event means adding a line here, which makes the catalogue reviewable
 * in a diff. Payloads carry only data the publisher already has: no event
 * handler may cause a KV read just to build a payload.
 */
export interface EventMap {
    /** Panel settings were persisted. `changed` lists the keys that differ. */
    'settings.updated': { changed: string[]; version: string };
    /** Settings were reset to defaults. */
    'settings.reset': { version: string };
    /** Settings failed validation and were rejected. */
    'settings.rejected': { issues: ValidationIssue[] };
    /** A subscription config was generated and served. */
    'config.exported': { subscription: string; core: string; client: string; bytes: number };
    /** A config export was requested for an unsupported type/client pair. */
    'config.unsupported': { subscription: string; client: string };
    /** An authentication attempt completed. */
    'auth.attempt': { ok: boolean };
    /** A session was established. */
    'auth.login': Record<string, never>;
    /** A session was destroyed. */
    'auth.logout': Record<string, never>;
    /** A scan of a candidate endpoint finished. */
    'scanner.probed': { target: string; ok: boolean; latencyMs: number | null };
    /** A scan run finished, covering one or more targets. */
    'scanner.completed': { targets: number; healthy: number };
    /** WARP account material was refreshed. */
    'warp.refreshed': { accounts: number };
    /** A panel self-update was deployed. */
    'panel.updated': { from: string; to: string };
    /** A subsystem reported a degraded or failed dependency. */
    'diagnostics.finding': { check: string; severity: 'info' | 'warn' | 'error' };
    /**
     * A subscription link was created or its availability changed.
     *
     * The payload carries no token. Everything downstream of this event is a durable
     * record, and a token in a durable record is a second copy of a live credential
     * with a different lifetime from the one the operator can revoke.
     */
    'links.changed': {
        action: 'create' | 'enable' | 'disable' | 'delete' | 'limit' | 'reset-count';
        name: string;
        remaining: number;
    };
}

export type EventName = keyof EventMap;

/** A listener may be sync or async. Async listeners are awaited only by `emitAsync`. */
export type Listener<K extends EventName> = (payload: EventMap[K]) => void | Promise<void>;

/** Removes the subscription. Idempotent. */
export type Unsubscribe = () => void;

/** A listener failure, surfaced to the publisher instead of thrown at it. */
export interface ListenerFailure {
    event: EventName;
    error: unknown;
}

export interface EventBus {
    on<K extends EventName>(event: K, listener: Listener<K>): Unsubscribe;
    /**
     * Subscribes for exactly one delivery. Used by request-scoped code that wants
     * the first occurrence and must not leak a listener into a long-lived isolate.
     */
    once<K extends EventName>(event: K, listener: Listener<K>): Unsubscribe;
    /**
     * Publishes without waiting. Sync listeners run inline; a promise returned by
     * an async listener is tracked so `settled()` can await it, but `emit` itself
     * does not block. Returns the number of listeners invoked.
     */
    emit<K extends EventName>(event: K, payload: EventMap[K]): number;
    /** Publishes and awaits every listener. Failures are captured, not thrown. */
    emitAsync<K extends EventName>(event: K, payload: EventMap[K]): Promise<ListenerFailure[]>;
    /**
     * Awaits every promise started by `emit` since the last call.
     *
     * The intended caller is a request handler's tail, or `ctx.waitUntil`, so that
     * a fire-and-forget KV write is not abandoned when the isolate is suspended.
     */
    settled(): Promise<ListenerFailure[]>;
    /** Failures captured so far. Cleared by `settled()`. */
    failures(): readonly ListenerFailure[];
    listenerCount(event?: EventName): number;
}

/**
 * Creates an isolated bus.
 *
 * There is no module-level default instance on purpose. A module global would be
 * shared across requests inside one isolate, so a listener registered while
 * serving request A would still be attached while serving request B, which is
 * exactly the class of bug `src/settings/settings.ts:109` already has. Every bus
 * is owned by a platform context with a request-scoped lifetime.
 */
export function createEventBus(): EventBus {
    const listeners = new Map<EventName, Set<Listener<EventName>>>();
    let pending: Promise<void>[] = [];
    let captured: ListenerFailure[] = [];

    const record = (event: EventName, error: unknown) => {
        captured.push({ event, error });
    };

    /** Runs one listener, converting any failure into a captured record. */
    const invoke = <K extends EventName>(event: K, listener: Listener<K>, payload: EventMap[K]) => {
        try {
            const result = listener(payload);
            if (result instanceof Promise) {
                pending.push(result.catch(error => record(event, error)));
            }
        } catch (error) {
            record(event, error);
        }
    };

    return {
        on(event, listener) {
            let set = listeners.get(event);
            if (!set) {
                set = new Set();
                listeners.set(event, set);
            }

            set.add(listener as Listener<EventName>);
            let active = true;

            return () => {
                if (!active) return;
                active = false;
                set!.delete(listener as Listener<EventName>);
                if (set!.size === 0) listeners.delete(event);
            };
        },

        once(event, listener) {
            const off = this.on(event, payload => {
                off();
                return listener(payload);
            });

            return off;
        },

        emit(event, payload) {
            const set = listeners.get(event);
            if (!set || set.size === 0) return 0;

            // Snapshot: a listener that unsubscribes during delivery must not
            // mutate the set being iterated.
            const snapshot = Array.from(set);
            for (const listener of snapshot) invoke(event, listener, payload);
            return snapshot.length;
        },

        async emitAsync(event, payload) {
            const set = listeners.get(event);
            if (!set || set.size === 0) return [];

            const before = captured.length;
            const snapshot = Array.from(set);
            const started: Promise<void>[] = [];

            for (const listener of snapshot) {
                try {
                    const result = listener(payload);
                    if (result instanceof Promise) {
                        started.push(result.catch(error => record(event, error)));
                    }
                } catch (error) {
                    record(event, error);
                }
            }

            await Promise.all(started);
            return captured.slice(before);
        },

        async settled() {
            // Listeners may themselves emit, appending to `pending` while we
            // await. Drain until stable rather than awaiting a single snapshot.
            while (pending.length > 0) {
                const batch = pending;
                pending = [];
                await Promise.all(batch);
            }

            const failures = captured;
            captured = [];
            return failures;
        },

        failures() {
            return captured;
        },

        listenerCount(event) {
            if (event) return listeners.get(event)?.size ?? 0;
            let total = 0;
            for (const set of listeners.values()) total += set.size;
            return total;
        }
    };
}

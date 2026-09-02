/**
 * Feature registry: one honest answer to "can this deployment do X?"
 *
 * Why this exists
 *
 * RayZen runs in configurations that differ in what they can actually do. Pages
 * and Workers deployments have different deploy APIs. A deployment whose operator
 * never set a Telegram token cannot send Telegram messages. A deployment without
 * a password is unauthenticated. Today each of those facts is rediscovered
 * wherever it matters, usually as an inline truthiness check, and the panel's only
 * vocabulary for "unavailable" is to hide a button.
 *
 * That produces two bad outcomes. Users see features silently missing with no
 * explanation, and the codebase has no single list of what a feature needs, so a
 * new dependency is easy to add and impossible to audit.
 *
 * The registry makes capability a first-class, queryable value: every feature
 * declares what it requires, evaluates against the live environment, and returns
 * `available | degraded | unavailable` plus a plain-English reason the panel can
 * show verbatim.
 *
 * What it is not
 *
 * Not a feature-flag service and not a kill switch. There is no remote config, no
 * rollout percentage, and no way for a flag to be set from outside the
 * deployment: a flag fetched from a network source would be a censorship
 * chokepoint pointed at the exact users this project exists to protect. Every
 * answer here is computed locally from the deployment's own state.
 */

import type { FeatureState, FeatureStatus } from '#types/platform';

/**
 * The environment a feature evaluates against.
 *
 * Deliberately a plain data snapshot rather than `Env` plus settings: an evaluator
 * that received the live objects could perform I/O, and capability checks run on
 * the panel's render path where an unexpected KV read or fetch would be a latency
 * regression. Everything here is already in memory by the time the registry runs.
 */
export interface CapabilityContext {
    /** `workers` or `pages`. Decides which deploy API is reachable. */
    deployType: string;
    /** True when a panel password exists in KV. */
    hasPassword: boolean;
    /** True when a Telegram bot token is configured. */
    hasTelegramBot: boolean;
    /** True when WARP account material is present. */
    hasWarpAccounts: boolean;
    /** True when a Cloudflare API token is embedded. */
    hasApiToken: boolean;
    /** True when the KV binding is present. */
    hasKv: boolean;
    /** True when a custom domain is configured. */
    hasCustomDomain: boolean;
    /** Enabled protocol list, e.g. `['vless', 'trojan']`. */
    protocols: readonly string[];
}

/**
 * A feature declaration.
 *
 * `requires` is documentation and diagnostics input: it names the capabilities in
 * human terms so the health view can say what is missing. `evaluate` is the
 * decision. Both exist because the string list alone cannot express "degraded",
 * and the function alone cannot be rendered in a table.
 */
export interface FeatureDefinition {
    id: string;
    title: string;
    requires: readonly string[];
    evaluate(context: CapabilityContext): { state: FeatureState; reason?: string };
}

export interface FeatureRegistry {
    register(definition: FeatureDefinition): FeatureRegistry;
    /** Every feature's status, in registration order. */
    evaluateAll(context: CapabilityContext): FeatureStatus[];
    /** One feature's status, or null when the id is unknown. */
    evaluate(id: string, context: CapabilityContext): FeatureStatus | null;
    /** Convenience for call sites that only branch on availability. */
    isAvailable(id: string, context: CapabilityContext): boolean;
    list(): readonly FeatureDefinition[];
}

export function createFeatureRegistry(definitions: readonly FeatureDefinition[] = []): FeatureRegistry {
    const features = new Map<string, FeatureDefinition>();

    const toStatus = (definition: FeatureDefinition, context: CapabilityContext): FeatureStatus => {
        const { state, reason } = definition.evaluate(context);
        return {
            id: definition.id,
            title: definition.title,
            state,
            ...(reason ? { reason } : {}),
            requires: definition.requires
        };
    };

    const registry: FeatureRegistry = {
        register(definition) {
            if (features.has(definition.id)) {
                throw new Error(`Feature '${definition.id}' is already registered.`);
            }

            features.set(definition.id, definition);
            return registry;
        },

        evaluateAll(context) {
            return Array.from(features.values(), definition => toStatus(definition, context));
        },

        evaluate(id, context) {
            const definition = features.get(id);
            return definition ? toStatus(definition, context) : null;
        },

        isAvailable(id, context) {
            return registry.evaluate(id, context)?.state === 'available';
        },

        list() {
            return Array.from(features.values());
        }
    };

    for (const definition of definitions) registry.register(definition);
    return registry;
}

/**
 * The features RayZen ships.
 *
 * Every entry reflects a check that already existed somewhere in the codebase as
 * an inline condition; this is where those conditions become declarations. Adding
 * a feature here is a reviewable one-line-per-capability diff.
 */
export const CORE_FEATURES: readonly FeatureDefinition[] = [
    {
        id: 'panel.auth',
        title: 'Password protection',
        requires: ['KV binding', 'panel password'],
        evaluate: ({ hasKv, hasPassword }) => {
            if (!hasKv) return { state: 'unavailable', reason: 'No KV namespace is bound to this deployment.' };
            if (!hasPassword) {
                return {
                    state: 'degraded',
                    reason: 'No panel password is set, so the panel is reachable by anyone who knows its URL.'
                };
            }

            return { state: 'available' };
        }
    },
    {
        id: 'panel.self-update',
        title: 'Panel self-update',
        requires: ['Cloudflare API token', 'Workers or Pages deployment'],
        evaluate: ({ hasApiToken }) =>
            hasApiToken
                ? { state: 'available' }
                : {
                      state: 'unavailable',
                      reason: 'No Cloudflare API token is embedded, so the panel cannot redeploy itself.'
                  }
    },
    {
        id: 'config.subscriptions',
        title: 'Subscription generation',
        requires: ['at least one protocol enabled'],
        evaluate: ({ protocols }) =>
            protocols.length > 0
                ? { state: 'available' }
                : {
                      state: 'unavailable',
                      reason: 'No protocols are enabled, so no subscription can be generated.'
                  }
    },
    {
        id: 'config.warp',
        title: 'WARP configurations',
        requires: ['WARP account material'],
        evaluate: ({ hasWarpAccounts }) =>
            hasWarpAccounts
                ? { state: 'available' }
                : {
                      state: 'degraded',
                      reason: 'No WARP accounts are stored yet. They are fetched on first use.'
                  }
    },
    {
        id: 'integration.telegram',
        title: 'Telegram bot',
        requires: ['Telegram bot token'],
        evaluate: ({ hasTelegramBot }) =>
            hasTelegramBot
                ? { state: 'available' }
                : { state: 'unavailable', reason: 'No Telegram bot token is configured.' }
        },
    {
        id: 'deployment.custom-domain',
        title: 'Custom domain',
        requires: ['Cloudflare API token', 'a zone on the account'],
        evaluate: ({ hasCustomDomain, hasApiToken }) => {
            if (!hasApiToken) {
                return { state: 'unavailable', reason: 'No Cloudflare API token is embedded.' };
            }

            return hasCustomDomain
                ? { state: 'available' }
                : { state: 'degraded', reason: 'No custom domain is configured; the default hostname is in use.' };
        }
    },
    {
        id: 'platform.analytics',
        title: 'Usage analytics',
        requires: ['KV binding'],
        evaluate: ({ hasKv }) =>
            hasKv
                ? { state: 'available' }
                : { state: 'unavailable', reason: 'No KV namespace is bound, so counters cannot be stored.' }
    },
    {
        id: 'platform.history',
        title: 'Change history',
        requires: ['KV binding'],
        evaluate: ({ hasKv }) =>
            hasKv
                ? { state: 'available' }
                : { state: 'unavailable', reason: 'No KV namespace is bound, so history cannot be stored.' }
    },
    {
        id: 'platform.scanner',
        title: 'Endpoint scanner',
        requires: ['KV binding', 'outbound TCP sockets'],
        evaluate: ({ hasKv }) =>
            hasKv
                ? { state: 'available' }
                : { state: 'degraded', reason: 'No KV namespace is bound, so scan history cannot be retained.' }
    }
];

import type { EmbededSettings } from './settings';

declare global {
    interface Env {
        readonly CF_PAGES: string;
        readonly kv: KVNamespace;

        /**
         * Deployment identity, read by `src/settings/identity.ts`. Every one is
         * optional: a Deploy to Cloudflare deployment sets none of them and
         * bootstraps its identity into KV on the first request instead.
         *
         * The two credential values are read from the environment and never
         * persisted, so they stay out of settings exports and backups.
         */
        readonly RAYZEN_ADMIN_EMAIL?: string;

        /**
         * Optional geo-lookup endpoint for configured proxy addresses.
         *
         * Absent by default, and absent means no third party is contacted: the panel
         * reports locations as unknown rather than sending the operator's endpoint list
         * somewhere. See src/api/geo.ts for why that trade is made in that direction.
         */
        readonly RAYZEN_GEO_ENDPOINT?: string;
        readonly RAYZEN_CF_ACCOUNT_ID?: string;
        readonly RAYZEN_CF_API_TOKEN?: string;
        readonly RAYZEN_WORKER_NAME?: string;
        readonly RAYZEN_SECURE_PATH?: string;
        readonly RAYZEN_VL_UUID?: string;
        readonly RAYZEN_TR_PASS?: string;
        readonly RAYZEN_PROXY_IP_MODE?: string;
        readonly RAYZEN_PROXY_IPS?: string;
        readonly RAYZEN_PREFIXES?: string;
        readonly RAYZEN_FALLBACK?: string;
        readonly RAYZEN_DOH_URL?: string;

        /** legacy upstream 4.x variables. Present only so `init` can refuse them explicitly. */
        readonly UUID?: string;
        readonly TR_PASS?: string;
    }

    const SOURCE_CONTENT: string;

    /**
     * The identity block a packaged artifact carries. Absent on a
     * Deploy to Cloudflare deployment, hence the `typeof` guard every reader uses.
     */
    const EMBEDED_SETTINGS: EmbededSettings | undefined;

    const VERSION: string;
    const ERROR_HTML_CONTENT: string;
    const PANEL_HTML_CONTENT: string;
    const LOGIN_HTML_CONTENT: string;
    const SETUP_HTML_CONTENT: string;
    const PROXY_IP_HTML_CONTENT: string;

    /**
     * The sandboxed measurement frame (`src/assets/probe/`). Served only to the panel,
     * embedded in an opaque origin, and the only document with a permissive
     * `connect-src`. See src/common/security.ts.
     */
    const PROBE_HTML_CONTENT: string;
    const ICON_CONTENT: string;
    const PAGE_CSP_HASHES: Readonly<Record<string, { script: string; style: string }>>;
    const _VL_: string;
    const _VL_CAP_: string;
    const _VM_: string;
    const _VM_CAP_: string;
    const _TR_: string;
    const _TR_CAP_: string;
    const _SS_: string;
    const _V2_: string;
    const _project_: string;
    const _project_SM_: string;

    interface Array<T> {
        concatIf<T>(condition: boolean, concat: T | T[]): T[];
    }

    interface Object {
        omitEmpty<T>(): T | undefined;
    }
}

export { };

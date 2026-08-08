import { defineConfig } from 'vitest/config';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const root = dirname(fileURLToPath(import.meta.url));
const pkg = JSON.parse(readFileSync(join(root, 'package.json'), 'utf8'));

const src = (...parts: string[]) => join(root, 'src', ...parts);

export default defineConfig({
    resolve: {
        // Mirror the tsconfig `paths` map. esbuild resolves these at build time;
        // Vitest needs them spelled out explicitly.
        alias: {
            '@cores': src('cores'),
            '@xray': src('cores', 'xray'),
            '@sing-box': src('cores', 'sing-box'),
            '@clash': src('cores', 'clash'),
            '@utils': src('cores', 'utils.ts'),
            '@handlers': src('handlers'),
            '@settings': src('settings', 'settings.ts'),
            '@settings-loader': src('settings', 'load.ts'),
            '@validators': src('settings', 'validators.ts'),
            '@common': src('common', 'common.ts'),
            '@security': src('common', 'security.ts'),
            '@runtime': src('common', 'runtime.ts'),
            '@storage': src('storage', 'storage.ts'),
            '@kv': src('settings', 'kv.ts'),
            '@identity': src('settings', 'identity.ts'),
            '@main': src('settings', 'main.ts'),
            '@api': src('api'),
            '@protocols': src('protocols'),
            '@auth': src('auth', 'auth.ts'),
            '@platform': src('platform'),
            '@features': src('features'),
            '#types': src('types')
        }
    },
    define: {
        // Build-time constant injected by scripts/build.js. Without it every
        // module that transitively imports @settings fails to evaluate.
        VERSION: JSON.stringify(pkg.version),
        PAGE_CSP_HASHES: JSON.stringify({
            panel: { script: "'sha256-test-script'", style: "'sha256-test-style'" },
            login: { script: "'sha256-test-script'", style: "'sha256-test-style'" },
            'proxy-ip': { script: "'sha256-test-script'", style: "'sha256-test-style'" },
            error: { script: "'none'", style: "'none'" },
            api: { script: "'none'", style: "'none'" }
        })
    },
    test: {
        include: ['tests/**/*.test.ts'],
        setupFiles: ['tests/setup/globals.ts'],
        environment: 'node',
        restoreMocks: true,
        unstubGlobals: true
    }
});

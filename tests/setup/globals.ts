/**
 * Test-time stand-ins for the values `scripts/build.js` injects into the Worker
 * bundle at build time.
 *
 * Two distinct mechanisms are being emulated:
 *
 *  1. `esbuild --define` replaces `VERSION` textually. Vitest handles that via
 *     `define` in vitest.config.ts, so it is not set here.
 *  2. `Object.assign(globalThis, {...})` at the top of the emitted bundle
 *     supplies the embedded asset blobs and `EMBEDED_SETTINGS`. Those are real
 *     globals at runtime, so they are real globals here too.
 *
 * The `_VL_` / `_TR_` / `_project_` family is assigned by
 * `src/settings/settings.ts:13-28` as an import side effect, so it must NOT be
 * stubbed here: doing so would mask a regression in that block.
 *
 * Every value below is deliberately, obviously fake.
 */
import { gzipSync } from 'node:zlib';

/** A syntactically valid v4 UUID that is clearly not a real credential. */
export const TEST_UUID = '00000000-0000-4000-8000-000000000001';
export const TEST_TR_PASS = 'test-trojan-password';
export const TEST_SECURE_PATH = 'test-secure-path';
export const TEST_ACCOUNT_ID = '0000000000000000000000000000test';
export const TEST_API_TOKEN = 'test-api-token-not-a-real-credential';
export const TEST_EMAIL = 'test@example.invalid';
export const TEST_MAIN_DOMAIN = 'rayzen-test.workers.dev';

export const TEST_EMBEDED_SETTINGS = {
    accID: TEST_ACCOUNT_ID,
    accEmail: TEST_EMAIL,
    vlUUID: TEST_UUID,
    trPass: TEST_TR_PASS,
    securePath: TEST_SECURE_PATH,
    proxyIpMode: 'proxyip',
    proxyIPs: [] as string[],
    prefixes: [] as string[],
    mainDomain: TEST_MAIN_DOMAIN,
    fallback: '',
    dohUrl: ''
};

/** Mimics the build step: minified HTML, gzipped, base64-encoded. */
function embeddedPage(marker: string): string {
    const html = `<!DOCTYPE html><html><head><title>${marker}</title></head><body>__ICON__</body></html>`;
    return gzipSync(Buffer.from(html), { level: 9 }).toString('base64');
}

/**
 * The setup page fixture carries the email placeholders `src/handlers/setup.ts`
 * substitutes. A
 * fixture without them would let a substitution bug pass unnoticed.
 */
function embeddedSetupPage(): string {
    const html =
        '<!DOCTYPE html><html><head><title>setup</title></head>' +
        '<body data-email-fixed=__EMAIL_FIXED__>' +
        '__ICON__<span id=fixedEmail>__EMAIL_VALUE__</span></body></html>';
    return gzipSync(Buffer.from(html), { level: 9 }).toString('base64');
}

Object.assign(globalThis, {
    EMBEDED_SETTINGS: TEST_EMBEDED_SETTINGS,
    SOURCE_CONTENT: gzipSync(Buffer.from('export default {};'), { level: 9 }).toString('base64'),
    PANEL_HTML_CONTENT: embeddedPage('panel'),
    LOGIN_HTML_CONTENT: embeddedPage('login'),
    SETUP_HTML_CONTENT: embeddedSetupPage(),
    ERROR_HTML_CONTENT: embeddedPage('error'),
    PROXY_IP_HTML_CONTENT: embeddedPage('proxy-ip'),
    PROBE_HTML_CONTENT: embeddedPage('probe'),
    ICON_CONTENT: Buffer.from('fake-icon-bytes').toString('base64')
});

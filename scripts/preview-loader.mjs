/**
 * Local preview loader hooks.
 *
 * `dist/worker.js` imports `cloudflare:sockets`, which only exists inside the Workers
 * runtime. These hooks resolve that specifier to a stub so the real artifact can be
 * imported by Node for `scripts/preview.js`. Nothing else is intercepted, so every other
 * line of the preview is the shipped code.
 *
 * The stub throws on connect rather than returning a fake socket: the preview is for
 * looking at the UI, and a fake TCP socket would make the proxy-IP test and the scanner
 * appear to work when they cannot.
 */
const STUB = `
export function connect() {
    throw new Error(
        'cloudflare:sockets is not available in the local preview. ' +
        'Anything that opens a TCP socket (proxy-IP test, scanner probe) needs a real deploy.'
    );
}
export default { connect };
`;

export async function resolve(specifier, context, next) {
    if (specifier === 'cloudflare:sockets') {
        return { url: 'preview-stub:cloudflare-sockets', shortCircuit: true };
    }
    return next(specifier, context);
}

export async function load(url, context, next) {
    if (url === 'preview-stub:cloudflare-sockets') {
        return { format: 'module', source: STUB, shortCircuit: true };
    }
    return next(url, context);
}

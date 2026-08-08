import { readFileSync, writeFileSync, mkdirSync, readdirSync } from 'fs';
import { join, dirname as pathDirname } from 'path';
import { fileURLToPath } from 'url';
import { build, transform, version as esbuildVersion } from 'esbuild';
import pkg from '../package.json' with { type: 'json' };
import { gzipSync } from 'zlib';
import { createHash } from 'crypto';

const __filename = fileURLToPath(import.meta.url);
const __dirname = pathDirname(__filename);
const ROOT = join(__dirname, '..');
const ASSET_PATH = join(ROOT, 'src/assets');
const DIST_PATH = join(ROOT, 'dist');
const FORENSICS_PATH = join(DIST_PATH, 'forensics');
const success = '\x1b[32m✔\x1b[0m';
const failure = '\x1b[31m✗\x1b[0m';
const pageCspHashes = {};
const pageBuild = {};
const BUILD_MODE = process.env.RAYZEN_BUILD_MODE || 'production';
const VALID_MODES = new Set(['development', 'production', 'minified', 'sourcemap']);
if (!VALID_MODES.has(BUILD_MODE)) throw new Error(`Unknown RAYZEN_BUILD_MODE: ${BUILD_MODE}`);
const MINIFY = BUILD_MODE !== 'development';
const SOURCE_MAP = BUILD_MODE === 'sourcemap';

const sha256 = value => createHash('sha256').update(value).digest('hex');
const cspHash = value => `'sha256-${createHash('sha256').update(value).digest('base64')}'`;
const setupSource = readFileSync(join(ASSET_PATH, 'setup/script.js'), 'utf8');
const SETUP_BUILD_MARKER = `rayzen-setup-${sha256(setupSource).slice(0, 16)}`;

function pageDirectories() {
    return readdirSync(ASSET_PATH, { withFileTypes: true })
        .filter(entry => entry.isDirectory())
        .map(entry => entry.name)
        .filter(dir => {
            try { readFileSync(join(ASSET_PATH, dir, 'index.html')); return true; } catch { return false; }
        });
}

async function compileBrowserScript(dir, script) {
    const sourcefile = `src/assets/${dir}/script.js`;
    const transformed = await transform(script, {
        loader: 'js',
        target: 'esnext',
        sourcefile,
        sourcemap: SOURCE_MAP ? 'external' : false,
        sourcesContent: true,
        minifySyntax: MINIFY,
        minifyWhitespace: MINIFY,
        minifyIdentifiers: MINIFY
    });

    // A stable sourceURL makes future production stacks name the owning asset instead
    // of only `(index)`. In the forensic build, embed the source map so DevTools can
    // map a minified frame directly to the original setup source.
    let code = transformed.code.trim();
    if (SOURCE_MAP && transformed.map) {
        const encodedMap = Buffer.from(transformed.map, 'utf8').toString('base64');
        code += `\n//# sourceMappingURL=data:application/json;base64,${encodedMap}`;
        mkdirSync(FORENSICS_PATH, { recursive: true });
        writeFileSync(join(FORENSICS_PATH, `${dir}.min.js`), `${transformed.code.trim()}\n`, 'utf8');
        writeFileSync(join(FORENSICS_PATH, `${dir}.min.js.map`), transformed.map, 'utf8');
        writeFileSync(join(FORENSICS_PATH, `${dir}.source.js`), script, 'utf8');
    }
    code += `\n//# sourceURL=rayzen-${dir}.js`;

    pageBuild[dir] = {
        sourcefile,
        sourceSha256: sha256(script),
        builtSha256: sha256(code),
        sourceMap: SOURCE_MAP ? `forensics/${dir}.min.js.map` : null
    };
    return code;
}

function compactHtml(html) {
    // HTML compaction never touches script/style bodies. Browser JavaScript has one
    // transformer owner (esbuild above), preventing a second rename/rewrite pass.
    return html.replace(/<!--(?!\[if)[\s\S]*?-->/g, '').replace(/>\s+</g, '><').trim();
}

async function processHtmlPages() {
    const result = {};
    for (const dir of pageDirectories()) {
        const base = file => join(ASSET_PATH, dir, file);
        let html = readFileSync(base('index.html'), 'utf8')
            .replaceAll('__VERSION__', pkg.version)
            .replaceAll('__SETUP_BUILD_MARKER__', SETUP_BUILD_MARKER);
        if (dir !== 'error') {
            const css = readFileSync(base('style.css'), 'utf8');
            const script = await compileBrowserScript(dir, readFileSync(base('script.js'), 'utf8'));
            html = html.replace('/* CSS_PLACEHOLDER */', css).replace('/* JS_PLACEHOLDER */', script);
        }
        const compact = compactHtml(html);
        const inlineScript = /<script>([\s\S]*?)<\/script>/.exec(compact)?.[1];
        const inlineStyle = /<style>([\s\S]*?)<\/style>/.exec(compact)?.[1];
        pageCspHashes[dir] = {
            script: inlineScript ? cspHash(inlineScript) : "'none'",
            style: inlineStyle ? cspHash(inlineStyle) : "'none'"
        };
        result[dir] = gzipSync(compact, { level: 9 }).toString('base64');
    }
    console.log(`${success} Assets bundled (${BUILD_MODE})`);
    return result;
}

async function buildWorker() {
    mkdirSync(DIST_PATH, { recursive: true });
    const htmls = await processHtmlPages();
    const faviconBase64 = readFileSync(join(ASSET_PATH, 'favicon.ico')).toString('base64');
    const code = await build({
        entryPoints: [join(ROOT, 'src/worker.ts')],
        bundle: true,
        format: 'esm',
        write: false,
        sourcemap: SOURCE_MAP ? 'inline' : false,
        external: ['cloudflare:sockets', 'node:crypto'],
        platform: 'browser',
        target: 'esnext',
        loader: { '.ts': 'ts' },
        define: { VERSION: JSON.stringify(pkg.version), PAGE_CSP_HASHES: JSON.stringify(pageCspHashes) },
        // Exactly one Worker bundle/minification pass. Browser page scripts were already
        // compiled before gzip/base64 embedding and cannot be transformed by this pass.
        minifySyntax: MINIFY,
        minifyWhitespace: MINIFY,
        minifyIdentifiers: MINIFY
    });
    const script = code.outputFiles.find(file => file.path.endsWith('.js'))?.text || code.outputFiles[0].text;
    const base64Gzip = gzipSync(script, { level: 9 }).toString('base64');
    const embeddedContents = {
        SOURCE_CONTENT: base64Gzip,
        PANEL_HTML_CONTENT: htmls.panel,
        LOGIN_HTML_CONTENT: htmls.login,
        SETUP_HTML_CONTENT: htmls.setup,
        ERROR_HTML_CONTENT: htmls.error,
        PROXY_IP_HTML_CONTENT: htmls['proxy-ip'],
        PROBE_HTML_CONTENT: htmls.probe,
        ICON_CONTENT: faviconBase64
    };
    const worker = `Object.assign(globalThis, ${JSON.stringify(embeddedContents)});${script}`;
    writeFileSync(join(DIST_PATH, 'worker.js'), worker, 'utf8');
    writeFileSync(join(DIST_PATH, 'build-manifest.json'), `${JSON.stringify({
        product: 'RayZen',
        version: pkg.version,
        buildMode: BUILD_MODE,
        minified: MINIFY,
        sourceMaps: SOURCE_MAP,
        toolchain: { esbuild: esbuildVersion },
        workerSha256: sha256(worker),
        setupBuildMarker: SETUP_BUILD_MARKER,
        pages: pageBuild
    }, null, 2)}\n`, 'utf8');
    console.log(`${success} Worker built: ${sha256(worker)}`);
    console.log(`${success} Setup marker: ${SETUP_BUILD_MARKER}`);
}

buildWorker().catch(err => { console.error(`${failure} Build failed:`, err); process.exit(1); });

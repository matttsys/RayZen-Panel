/**
 * Registers the preview loader hooks, then hands control to scripts/preview.js.
 *
 * `--import` runs this in the main thread before the entry point loads, which is what
 * `module.register` needs in order to intercept the `cloudflare:sockets` specifier that
 * dist/worker.js imports. See scripts/preview-loader.mjs.
 */
import { register } from 'node:module';
import { pathToFileURL } from 'node:url';

register('./preview-loader.mjs', pathToFileURL(import.meta.filename));

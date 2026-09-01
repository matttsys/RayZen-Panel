/**
 * Bundle size budget gate.
 *
 * The Worker artifact is a single file that Cloudflare must accept, and it also
 * doubles as the self-update payload, so growth is a real constraint rather than
 * a nicety. This script fails the build when the artifact exceeds the committed
 * budget, and warns when it enters the early-warning band.
 *
 * Baselines and thresholds are recorded in perf-baseline.json so a legitimate
 * increase is an explicit, reviewable change to that file rather than an
 * invisible one in the diff.
 *
 * Usage: npm run size   (after npm run build)
 */
import { readFileSync, existsSync, statSync } from 'node:fs';
import { gzipSync } from 'node:zlib';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const root = join(__dirname, '..');
const artifact = join(root, 'dist', 'worker.js');
const baselinePath = join(root, 'perf-baseline.json');

const green = '\x1b[32m';
const yellow = '\x1b[33m';
const red = '\x1b[31m';
const reset = '\x1b[0m';

if (!existsSync(artifact)) {
    console.error(`${red}✗${reset} dist/worker.js not found. Run \`npm run build\` first.`);
    process.exit(1);
}

if (!existsSync(baselinePath)) {
    console.error(`${red}✗${reset} perf-baseline.json not found.`);
    process.exit(1);
}

const baseline = JSON.parse(readFileSync(baselinePath, 'utf8'));
const budgets = baseline.budgets;

const raw = statSync(artifact).size;
const gzip = gzipSync(readFileSync(artifact), { level: 9 }).length;

const checks = [
    { name: 'worker.js raw', actual: raw, fail: budgets.workerRawFail, warn: budgets.workerRawWarn },
    { name: 'worker.js gzip', actual: gzip, fail: budgets.workerGzipFail, warn: budgets.workerGzipWarn }
];

const pct = (a, b) => `${((a / b - 1) * 100).toFixed(1)}%`;
let failed = false;

console.log('Bundle size budget');
for (const { name, actual, fail, warn } of checks) {
    const recorded = name.includes('gzip') ? baseline.measured.workerGzipBytes : baseline.measured.workerRawBytes;
    const drift = actual === recorded ? 'unchanged' : `${actual > recorded ? '+' : ''}${actual - recorded} B vs baseline`;

    if (actual > fail) {
        console.error(`  ${red}✗${reset} ${name}: ${actual} B exceeds hard limit ${fail} B (${pct(actual, fail)} over) — ${drift}`);
        failed = true;
    } else if (actual > warn) {
        console.warn(`  ${yellow}!${reset} ${name}: ${actual} B exceeds warn threshold ${warn} B — ${drift}`);
    } else {
        console.log(`  ${green}✔${reset} ${name}: ${actual} B (limit ${fail} B) — ${drift}`);
    }
}

if (failed) {
    console.error(
        `\n${red}✗${reset} Bundle size budget exceeded.\n` +
        '  Either reduce the artifact, or raise the threshold in perf-baseline.json\n' +
        '  in its own commit with a written justification.'
    );
    process.exit(1);
}

console.log(`${green}✔${reset} Bundle within budget.`);

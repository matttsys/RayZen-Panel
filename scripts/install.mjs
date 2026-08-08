/**
 * The no-GitHub installer.
 *
 * Why this exists
 *
 * The Deploy to Cloudflare button is the easiest path and it has one hard requirement
 * that has nothing to do with running a VPN panel: a GitHub account, authorised to be
 * forked into. People who do not have one, or who do not want a public fork of a
 * censorship-circumvention tool sitting under their real name, had no supported option
 * that did not involve cloning a repository and learning wrangler.
 *
 * This script is that option. It uploads the built Worker straight to Cloudflare's API:
 * no repository, no fork, no wrangler, no build toolchain beyond Node.
 *
 * USAGE
 *
 *   node scripts/install.mjs
 *
 * It asks for a Cloudflare API token, picks a random Worker name, creates the KV
 * namespace, uploads the Worker, turns on its workers.dev address and prints the URL to
 * open. First-run setup in the panel does the rest.
 *
 * Flags (all optional, all also readable from the environment):
 *
 *   --token <token>     RAYZEN_CF_API_TOKEN
 *   --account <id>      RAYZEN_CF_ACCOUNT_ID
 *   --name <name>       RAYZEN_WORKER_NAME   (default: generated)
 *   --dry-run           Verify the token and report the plan; change nothing.
 *   --yes               Do not ask for confirmation.
 *
 * The token
 *
 * Create it at https://dash.cloudflare.com/profile/api-tokens with exactly three
 * permissions:
 *
 *   Account · Workers Scripts  · Edit
 *   Account · Workers KV Storage · Edit
 *   Account · Account Settings · Read
 *
 * Nothing here writes the token to disk, and nothing uploads it into the Worker. The
 * panel does not need it to serve traffic; it only needs one later if you want the
 * in-panel self-update button, and that is a separate, deliberate step.
 */
import { createInterface } from 'node:readline/promises';
import { readFileSync, existsSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { generateWorkerName, uniqueWorkerName, isSafeWorkerName } from './worker-name.mjs';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const API = 'https://api.cloudflare.com/client/v4';

const bold = text => `\x1b[1m${text}\x1b[0m`;
const dim = text => `\x1b[2m${text}\x1b[0m`;
const green = text => `\x1b[32m${text}\x1b[0m`;
const red = text => `\x1b[31m${text}\x1b[0m`;

function arg(flag) {
    const index = process.argv.indexOf(flag);
    return index === -1 ? undefined : process.argv[index + 1];
}
const has = flag => process.argv.includes(flag);

function fail(message, hint) {
    console.error(`\n${red('✖')} ${message}`);
    if (hint) console.error(dim(`  ${hint}`));
    process.exit(1);
}

/**
 * One Cloudflare API call.
 *
 * Every failure is reported with Cloudflare's own message, because the two that actually
 * happen — a token missing a permission, and an account with no workers.dev subdomain —
 * are both self-explanatory in their own words and unrecognisable once flattened into
 * "request failed".
 */
async function cf(token, path, options = {}) {
    const response = await fetch(`${API}${path}`, {
        ...options,
        headers: { Authorization: `Bearer ${token}`, ...options.headers }
    });

    let body;
    try {
        body = await response.json();
    } catch {
        fail(`Cloudflare returned ${response.status} with no JSON body for ${path}`);
    }

    if (!body.success) {
        const detail = (body.errors ?? []).map(error => `${error.code}: ${error.message}`).join('; ');
        fail(`Cloudflare rejected ${options.method ?? 'GET'} ${path}`, detail || `HTTP ${response.status}`);
    }

    return body.result;
}

async function ask(rl, question, fallback) {
    const answer = (await rl.question(question)).trim();
    return answer || fallback;
}

async function main() {
    console.log(`\n${bold('RayZen installer')} ${dim('— Cloudflare, no GitHub account required')}\n`);

    const script = join(root, 'dist', 'worker.js');
    if (!existsSync(script)) {
        fail('dist/worker.js is missing.', 'Run `npm install && npm run build` first, or use a release artifact.');
    }

    const rl = createInterface({ input: process.stdin, output: process.stdout });

    try {
        let token = arg('--token') ?? process.env.RAYZEN_CF_API_TOKEN;
        if (!token) {
            console.log(dim('  Create a token with Workers Scripts:Edit, Workers KV Storage:Edit and'));
            console.log(dim('  Account Settings:Read at https://dash.cloudflare.com/profile/api-tokens'));
            console.log(dim('  It is used for this install only and is never written to disk.\n'));
            token = await ask(rl, 'Cloudflare API token: ');
        }
        if (!token) fail('No API token given.');

        await cf(token, '/user/tokens/verify');
        console.log(`${green('✔')} Token is valid.`);

        let accountId = arg('--account') ?? process.env.RAYZEN_CF_ACCOUNT_ID;
        if (!accountId) {
            const accounts = await cf(token, '/accounts');
            if (!accounts.length) fail('This token can see no accounts.', 'Check the token is account-scoped.');
            if (accounts.length === 1) {
                accountId = accounts[0].id;
                console.log(`${green('✔')} Account: ${accounts[0].name}`);
            } else {
                accounts.forEach((account, index) => console.log(`  ${index + 1}. ${account.name} ${dim(account.id)}`));
                const choice = Number(await ask(rl, `Account [1-${accounts.length}]: `, '1'));
                accountId = accounts[choice - 1]?.id;
                if (!accountId) fail('That is not one of the listed accounts.');
            }
        }

        // Without a workers.dev subdomain a Worker deploys and has no address, which is
        // the single most common "it deployed and does nothing" report.
        const subdomain = await cf(token, `/accounts/${accountId}/workers/subdomain`);
        if (!subdomain?.subdomain) {
            fail(
                'This account has no workers.dev subdomain.',
                'Set one once under Workers & Pages → Subdomain, then run this again.'
            );
        }

        const scripts = await cf(token, `/accounts/${accountId}/workers/scripts`);
        const taken = scripts.map(entry => entry.id);

        let name = arg('--name') ?? process.env.RAYZEN_WORKER_NAME ?? uniqueWorkerName(taken);
        if (!isSafeWorkerName(name)) {
            fail(`"${name}" is not a safe Worker name.`, 'Use lowercase letters, digits and hyphens, and do not use the forbidden deployment term.');
        }
        if (taken.includes(name)) {
            const replacement = uniqueWorkerName(taken);
            console.log(dim(`  "${name}" already exists in this account; using ${replacement} instead.`));
            name = replacement;
        }

        const hostname = `${name}.${subdomain.subdomain}.workers.dev`;
        console.log(`\n  Worker name  ${bold(name)}`);
        console.log(`  Address      ${bold(`https://${hostname}`)}`);
        console.log(`  KV namespace ${bold(name)} ${dim('(created now, bound as `kv`)')}\n`);

        if (has('--dry-run')) {
            console.log(`${green('✔')} Dry run: nothing was created.`);
            return;
        }

        if (!has('--yes')) {
            const confirm = (await ask(rl, 'Deploy this? [Y/n] ', 'y')).toLowerCase();
            if (confirm !== 'y' && confirm !== 'yes') {
                console.log('Cancelled. Nothing was created.');
                return;
            }
        }

        // One namespace per deployment, never shared: the keys are the same in every
        // deployment, so a shared namespace means the second panel overwrites the first.
        const namespace = await cf(token, `/accounts/${accountId}/storage/kv/namespaces`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ title: name })
        });
        console.log(`${green('✔')} KV namespace created.`);

        const metadata = {
            main_module: 'worker.js',
            compatibility_date: '2026-08-06',
            // Load-bearing: Trojan password hashing and WARP key generation use node:crypto.
            compatibility_flags: ['nodejs_compat'],
            bindings: [{ type: 'kv_namespace', name: 'kv', namespace_id: namespace.id }]
        };

        const form = new FormData();
        form.append('metadata', new Blob([JSON.stringify(metadata)], { type: 'application/json' }));
        form.append(
            'worker.js',
            new Blob([readFileSync(script)], { type: 'application/javascript+module' }),
            'worker.js'
        );

        await cf(token, `/accounts/${accountId}/workers/scripts/${name}`, { method: 'PUT', body: form });
        console.log(`${green('✔')} Worker uploaded.`);

        // Previews stay off: a preview URL is a second, differently-named public copy of
        // the same panel, and one public address is enough.
        await cf(token, `/accounts/${accountId}/workers/scripts/${name}/subdomain`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ enabled: true, previews_enabled: false })
        });
        console.log(`${green('✔')} workers.dev address enabled.\n`);

        console.log(bold('  Next, and only once:'));
        console.log(`  1. Open ${bold(`https://${hostname}`)} — do this now, not later.`);
        console.log('  2. Set the email and password you will sign in with.');
        console.log('  3. Save the panel URL it shows you. It contains a secret path that');
        console.log('     is shown exactly once and cannot be recovered from the dashboard.\n');
        console.log(dim('  Until step 2 is done, anyone who finds the address can claim it.'));
        console.log(dim(`  Delete this deployment with:  node scripts/install.mjs --help`));
    } finally {
        rl.close();
    }
}

if (has('--help') || has('-h')) {
    console.log(`
${bold('RayZen installer')} — deploy to Cloudflare without GitHub

  node scripts/install.mjs [--token <t>] [--account <id>] [--name <n>] [--dry-run] [--yes]

Token permissions: Workers Scripts:Edit, Workers KV Storage:Edit, Account Settings:Read.
The name is generated (e.g. ${generateWorkerName()}) unless you pass one.

To remove a deployment later, delete the Worker and its KV namespace in the Cloudflare
dashboard under Workers & Pages. This installer never deletes anything.
`);
    process.exit(0);
}

await main();

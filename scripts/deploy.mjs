/** Deploy the release artifact under a fresh safe Worker name. */
import { spawnSync } from 'node:child_process';
import { generateWorkerName, isSafeWorkerName } from './worker-name.mjs';

const requested = process.env.RAYZEN_WORKER_NAME?.trim();
const name = requested || generateWorkerName();
if (!isSafeWorkerName(name)) {
    console.error(`Unsafe Worker name: ${JSON.stringify(name)}. Use lowercase letters, digits and hyphens, and do not use the forbidden deployment term.`);
    process.exit(1);
}

console.log(`Deploying RayZen as ${name}`);
const command = process.platform === 'win32' ? 'wrangler.cmd' : 'wrangler';
const result = spawnSync(command, ['deploy', '--name', name], { stdio: 'inherit' });
if (result.error) {
    console.error(result.error.message);
    process.exit(1);
}
process.exit(result.status ?? 1);

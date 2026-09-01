import { createHash } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import {
  accountDetails,
  createKv,
  findKvNamespace,
  createWorkersSubdomain,
  getWorkerSubdomainState,
  getWorkersSubdomain,
  listKvNamespaceTitles,
  listWorkerNames,
  publishWorker,
  uploadWorker
} from './cloudflare.js';
import { candidateAccountSubdomain, chooseWorkerName } from './names.js';

export const STEPS = Object.freeze([
  { id: 'access', label: 'Validating access' },
  { id: 'prepare', label: 'Preparing deployment' },
  { id: 'name', label: 'Generating Worker name' },
  { id: 'kv', label: 'Creating KV' },
  { id: 'upload', label: 'Uploading application' },
  { id: 'publish', label: 'Publishing Worker' },
  { id: 'verify', label: 'Verifying deployment' },
  { id: 'complete', label: 'Deployment complete' }
]);

const manifestUrl = new URL('../artifacts/manifest.json', import.meta.url);
const workerArtifactUrl = new URL('../artifacts/worker.js', import.meta.url);
const MAX_WORKER_BYTES = 8 * 1024 * 1024;

async function deploymentManifest() {
  const manifest = JSON.parse(await readFile(manifestUrl, 'utf8'));
  if (!manifest?.entry || !manifest?.compatibilityDate || !manifest?.kvBinding || !manifest?.sha256 || !/^rayzen-setup-[a-f0-9]{16}$/u.test(String(manifest?.setupBuildMarker || ''))) {
    throw Object.assign(new Error('RayZen deployment metadata is incomplete.'), { statusCode: 500, code: 'ARTIFACT_METADATA_INVALID' });
  }
  return manifest;
}

async function artifact() {
  const manifest = await deploymentManifest();
  let code;
  try {
    code = await readFile(workerArtifactUrl);
  } catch (error) {
    throw Object.assign(new Error('The bundled RayZen Worker artifact is missing from this Wizard deployment.'), {
      statusCode: 500,
      code: 'ARTIFACT_MISSING',
      cause: error
    });
  }

  if (!code.length || code.length > MAX_WORKER_BYTES) {
    throw Object.assign(new Error('The bundled RayZen Worker has an invalid size.'), {
      statusCode: 500,
      code: 'ARTIFACT_INVALID'
    });
  }

  const sha256 = createHash('sha256').update(code).digest('hex');
  const expected = String(manifest.sha256 || '').trim().toLowerCase();
  if (!expected || sha256 !== expected) {
    throw Object.assign(new Error('The bundled RayZen Worker does not match its release manifest.'), {
      statusCode: 500,
      code: 'ARTIFACT_MISMATCH'
    });
  }

  return {
    manifest: { ...manifest, sha256, size: code.length },
    code,
    source: { url: 'bundled://wizard/artifacts/worker.js', sha256, size: code.length, label: `RayZen ${manifest.version} release` }
  };
}

export function freshDeployment(account, authKind = null) {
  return {
    v: 3,
    status: 'ready',
    accountId: account.id,
    accountName: account.name,
    authKind,
    next: 'access',
    startedAt: Date.now(),
    completed: [],
    timings: {},
    subdomain: null,
    workerName: null,
    namespaceId: null,
    namespaceTitle: null,
    workerUrl: null,
    verification: null,
    artifactSource: null,
    artifactSha256: null
  };
}

function complete(state, id, started) {
  if (!state.completed.includes(id)) state.completed.push(id);
  state.timings[id] = Math.max(1, Date.now() - started);
  const index = STEPS.findIndex((step) => step.id === id);
  state.next = STEPS[index + 1]?.id || null;
  return state;
}

async function ensureSubdomain(token, state) {
  const current = await getWorkersSubdomain(token, state.accountId);
  if (current) return current;
  let lastError;
  for (let attempt = 0; attempt < 5; attempt += 1) {
    try {
      return await createWorkersSubdomain(token, state.accountId, candidateAccountSubdomain());
    } catch (error) {
      lastError = error;
      const text = String(error?.message || '').toLowerCase();
      if (!(text.includes('exist') || text.includes('taken') || error?.statusCode === 409)) throw error;
    }
  }
  throw lastError || Object.assign(new Error('Unable to create a workers.dev subdomain.'), { code: 'SUBDOMAIN_UNAVAILABLE' });
}

export async function runNextStep(token, state) {
  if (!state?.accountId) throw Object.assign(new Error('Select a Cloudflare account first.'), { statusCode: 400, code: 'ACCOUNT_REQUIRED' });
  if (state.status === 'complete') return state;

  state.v = 3;
  state.status = 'deploying';
  const id = state.next || 'access';
  const started = Date.now();

  if (id === 'access') {
    const account = await accountDetails(token, state.accountId);
    state.accountName = account.name;
    return complete(state, id, started);
  }
  if (id === 'prepare') {
    await deploymentManifest();
    state.subdomain = await ensureSubdomain(token, state);
    return complete(state, id, started);
  }
  if (id === 'name') {
    const [workerNames, kvTitles] = await Promise.all([
      listWorkerNames(token, state.accountId),
      listKvNamespaceTitles(token, state.accountId)
    ]);
    state.workerName = chooseWorkerName(new Set([...workerNames, ...kvTitles]));
    return complete(state, id, started);
  }
  if (id === 'kv') {
    if (!state.workerName) throw Object.assign(new Error('Worker name is missing.'), { code: 'STATE_INVALID' });
    const existingNamespace = await findKvNamespace(token, state.accountId, state.workerName);
    const namespace = existingNamespace || await createKv(token, state.accountId, state.workerName);
    state.namespaceId = namespace?.id;
    state.namespaceTitle = namespace?.title || state.workerName;
    if (!state.namespaceId) throw Object.assign(new Error('Cloudflare did not return a KV namespace ID.'), { code: 'KV_CREATE_INVALID' });
    return complete(state, id, started);
  }
  if (id === 'upload') {
    const bundle = await artifact();
    await uploadWorker(token, state.accountId, state.workerName, { ...bundle, namespaceId: state.namespaceId });
    state.artifactSource = bundle.source.label;
    state.artifactSha256 = bundle.source.sha256;
    return complete(state, id, started);
  }
  if (id === 'publish') {
    await publishWorker(token, state.accountId, state.workerName);
    state.workerUrl = `https://${state.workerName}.${state.subdomain}.workers.dev`;
    return complete(state, id, started);
  }
  if (id === 'verify') {
    const bundleManifest = await deploymentManifest();
    const subdomainState = await getWorkerSubdomainState(token, state.accountId, state.workerName);
    if (!subdomainState.enabled) throw Object.assign(new Error('Worker is deployed but workers.dev is not enabled.'), { code: 'WORKER_NOT_PUBLISHED' });
    let publicStatus = 'platform-verified';
    try {
      const response = await fetch(`${state.workerUrl}/`, { redirect: 'manual', signal: AbortSignal.timeout(10_000) });
      if (response.status >= 200 && response.status < 500) {
        const contentType = response.headers.get('content-type') || '';
        if (contentType.includes('text/html')) {
          const body = await response.text();
          const expectedSetupBuild = bundleManifest.setupBuildMarker;
          if (!body.includes(`data-rayzen-setup-build=${expectedSetupBuild}`) && !body.includes(`data-rayzen-setup-build=\"${expectedSetupBuild}\"`)) {
            throw Object.assign(new Error('Cloudflare is serving a different RayZen setup build than the Wizard uploaded.'), {
              code: 'DEPLOYED_ARTIFACT_MISMATCH',
              statusCode: 502
            });
          }
        }
        publicStatus = 'reachable';
      }
    } catch (error) {
      if (error?.code === 'DEPLOYED_ARTIFACT_MISMATCH') throw error;
      publicStatus = 'platform-verified';
    }
    state.verification = publicStatus;
    return complete(state, id, started);
  }
  if (id === 'complete') {
    complete(state, id, started);
    state.status = 'complete';
    state.finishedAt = Date.now();
    state.durationMs = Math.max(1, state.finishedAt - state.startedAt);
    state.next = null;
    return state;
  }
  throw Object.assign(new Error('Deployment state is invalid.'), { code: 'STATE_INVALID', statusCode: 409 });
}

export function publicDeployment(state) {
  if (!state) return null;
  const currentIndex = state.next ? STEPS.findIndex((step) => step.id === state.next) : STEPS.length;
  return {
    status: state.status,
    accountId: state.accountId,
    accountName: state.accountName,
    authKind: state.authKind || null,
    next: state.next,
    completed: state.completed || [],
    timings: state.timings || {},
    workerName: state.workerName,
    namespaceId: state.namespaceId,
    namespaceTitle: state.namespaceTitle,
    workerUrl: state.workerUrl,
    verification: state.verification,
    artifactSource: state.artifactSource,
    artifactSha256: state.artifactSha256,
    durationMs: state.durationMs || Date.now() - state.startedAt,
    region: 'Cloudflare global network',
    progress: state.status === 'complete' ? 100 : Math.max(4, Math.round((Math.max(0, currentIndex) / STEPS.length) * 100)),
    steps: STEPS
  };
}

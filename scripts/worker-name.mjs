/**
 * Safe, unique Worker names for every RayZen deployment.
 *
 * Deployment names are generated automatically so users do not share a fleet-wide
 * hostname pattern. The forbidden word is rejected even when a custom name is passed.
 */
import { randomInt } from 'node:crypto';

const FIRST = [
    'amber', 'blue', 'brave', 'bright', 'calm', 'clear', 'coral', 'crisp',
    'dawn', 'deep', 'early', 'east', 'fast', 'fresh', 'gentle', 'glass',
    'green', 'high', 'ivory', 'jade', 'kind', 'late', 'light', 'lively',
    'lunar', 'mellow', 'north', 'olive', 'open', 'plain', 'polar', 'quick',
    'quiet', 'rapid', 'river', 'sandy', 'silver', 'slate', 'smooth', 'solar',
    'south', 'spring', 'steady', 'stone', 'sunny', 'swift', 'teal', 'tidy',
    'urban', 'violet', 'warm', 'west', 'white', 'wide', 'winter'
];

const SECOND = [
    'anchor', 'atlas', 'basin', 'beacon', 'bridge', 'cabin', 'canvas', 'cedar',
    'cloud', 'comet', 'cove', 'delta', 'dock', 'ember', 'falcon', 'ferry',
    'field', 'forge', 'garden', 'harbor', 'hawk', 'hollow', 'island', 'lantern',
    'ledger', 'maple', 'meadow', 'mesa', 'nest', 'node', 'orbit', 'otter',
    'pier', 'pilot', 'plaza', 'prairie', 'quarry', 'ranger', 'ridge', 'river',
    'sail', 'signal', 'sparrow', 'station', 'summit', 'thicket', 'trail', 'valley',
    'vault', 'willow', 'window'
];

const PREFIX = 'rayzen';
const secureRandom = () => randomInt(0, 0x1_0000_0000) / 0x1_0000_0000;

/** Cloudflare's Worker-name syntax, checked locally before an upload. */
export const WORKER_NAME_RULE = /^[a-z0-9][a-z0-9-]{0,61}[a-z0-9]$/u;
/** Names containing this term are never accepted, including custom names. */
export const FORBIDDEN_WORKER_NAME = /panel/iu;

export function isSafeWorkerName(name) {
    return WORKER_NAME_RULE.test(name) && !FORBIDDEN_WORKER_NAME.test(name);
}

function pick(list, random) {
    return list[Math.floor(random() * list.length)];
}

function hexSuffix(random) {
    return Math.floor(random() * 0x1_0000).toString(16).padStart(4, '0');
}

/** A fresh high-entropy name, e.g. `rayzen-swift-harbor-a91f`. */
export function generateWorkerName(random = secureRandom) {
    return `${PREFIX}-${pick(FIRST, random)}-${pick(SECOND, random)}-${hexSuffix(random)}`;
}

/** Return a name not already used in the supplied account script list. */
export function uniqueWorkerName(taken, random = secureRandom) {
    const used = new Set(taken);
    for (let attempt = 0; attempt < 64; attempt++) {
        const name = generateWorkerName(random);
        if (isSafeWorkerName(name) && !used.has(name)) return name;
    }
    throw new Error('Could not generate an unused safe Worker name after 64 attempts.');
}

if (import.meta.url === `file://${process.argv[1]}`) {
    process.stdout.write(`${generateWorkerName()}\n`);
}

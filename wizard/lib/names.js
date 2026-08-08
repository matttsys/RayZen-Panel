import { randomBytes } from 'node:crypto';

const adjectives = ['silent','lunar','crystal','shadow','velvet','polar','swift','hidden','solar','misty','silver','cosmic','winter','amber','nova','calm'];
const nouns = ['orbit','harbor','forest','wave','frost','comet','meadow','signal','ridge','quartz','cove','drift','echo','horizon','nebula','current'];

function pick(items) {
  return items[randomBytes(1)[0] % items.length];
}

function suffix() {
  return randomBytes(3).toString('hex');
}

export function candidateWorkerName() {
  return `rayzen-${pick(adjectives)}-${pick(nouns)}-${suffix()}`;
}

export function candidateAccountSubdomain() {
  return `edge-${pick(adjectives)}-${pick(nouns)}-${suffix()}`.slice(0, 63).replace(/-+$/,'');
}

export function validWorkerName(name) {
  return typeof name === 'string' &&
    /^[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?$/.test(name) &&
    !/panel/i.test(name);
}

export function chooseWorkerName(existing = new Set()) {
  const set = existing instanceof Set ? existing : new Set(existing);
  for (let i = 0; i < 64; i += 1) {
    const name = candidateWorkerName();
    if (validWorkerName(name) && !set.has(name)) return name;
  }
  throw Object.assign(new Error('Unable to generate an available Worker name.'), { code: 'NAME_EXHAUSTED', statusCode: 409 });
}

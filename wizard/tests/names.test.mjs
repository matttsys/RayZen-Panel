import test from 'node:test';
import assert from 'node:assert/strict';
import { candidateAccountSubdomain, candidateWorkerName, chooseWorkerName, validWorkerName } from '../lib/names.js';

test('worker names match Cloudflare-safe constraints', () => {
  for (let i = 0; i < 200; i += 1) {
    const name = candidateWorkerName();
    assert.equal(validWorkerName(name), true);
    assert.match(name, /^rayzen-/);
    assert.doesNotMatch(name, /panel/i);
    assert.ok(name.length <= 63);
  }
});

test('worker name avoids existing names', () => {
  const existing = new Set();
  const first = chooseWorkerName(existing);
  existing.add(first);
  const second = chooseWorkerName(existing);
  assert.notEqual(first, second);
});

test('account subdomains are conservative DNS labels', () => {
  for (let i = 0; i < 100; i += 1) {
    const value = candidateAccountSubdomain();
    assert.match(value, /^[a-z0-9](?:[a-z0-9-]*[a-z0-9])?$/);
    assert.ok(value.length <= 63);
  }
});

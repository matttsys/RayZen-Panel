import test from 'node:test';
import assert from 'node:assert/strict';
import { decrypt, encrypt, pkceChallenge, randomToken } from '../lib/security.js';

process.env.WIZARD_SESSION_SECRET = 'test-secret-abcdefghijklmnopqrstuvwxyz-0123456789';

test('encrypted session round-trips and rejects wrong purpose', () => {
  const payload = { token: 'secret-value', nested: { ok: true } };
  const token = encrypt(payload, 'auth');
  assert.notEqual(token.includes('secret-value'), true);
  assert.deepEqual(decrypt(token, 'auth'), payload);
  assert.equal(decrypt(token, 'deploy'), null);
});

test('tampered encrypted session is rejected', () => {
  const token = encrypt({ ok: true }, 'auth');
  const chars = token.split('');
  const index = Math.max(5, token.length - 8);
  chars[index] = chars[index] === 'A' ? 'B' : 'A';
  assert.equal(decrypt(chars.join(''), 'auth'), null);
});

test('PKCE challenge is deterministic and verifier is random', () => {
  assert.equal(pkceChallenge('abc'), 'ungWv48Bz-pBQUDeXa4iI7ADYaOWF3qctBD_YfIAFa0');
  assert.notEqual(randomToken(), randomToken());
});

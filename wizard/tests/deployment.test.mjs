import test from 'node:test';
import assert from 'node:assert/strict';
import { freshDeployment, publicDeployment, STEPS } from '../lib/deployment.js';

test('fresh deployment exposes no credentials', () => {
  const state = freshDeployment({ id: 'a'.repeat(32), name: 'Test account' }, 'oauth');
  const output = publicDeployment(state);
  assert.equal(output.status, 'ready');
  assert.equal(output.progress, 4);
  assert.equal(output.authKind, 'oauth');
  assert.equal('accessToken' in output, false);
  assert.equal('setupToken' in output, false);
  assert.equal('setupProtected' in output, false);
  assert.equal(output.steps.length, STEPS.length);
});

test('complete deployment reports 100 percent', () => {
  const state = freshDeployment({ id: 'a'.repeat(32), name: 'Test account' });
  state.status = 'complete'; state.next = null; state.durationMs = 1200;
  const output = publicDeployment(state);
  assert.equal(output.progress, 100);
  assert.equal(output.region, 'Cloudflare global network');
});

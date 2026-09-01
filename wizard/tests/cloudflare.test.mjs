import test from 'node:test';
import assert from 'node:assert/strict';
import { cfRequest, findKvNamespace } from '../lib/cloudflare.js';

test('KV recovery finds an already-created namespace after an interrupted response', async () => {
  const original = global.fetch;
  global.fetch = async (url, options) => {
    assert.match(String(url), /storage\/kv\/namespaces/);
    assert.equal(options.headers.Authorization, 'Bearer token');
    return new Response(JSON.stringify({ success: true, result: [{ id: 'kv-123', title: 'rayzen-lunar-wave-a91f' }], result_info: { page: 1, per_page: 100, total_count: 1 } }), { status: 200, headers: { 'Content-Type': 'application/json' } });
  };
  try {
    const result = await findKvNamespace('token', 'a'.repeat(32), 'rayzen-lunar-wave-a91f');
    assert.deepEqual(result, { id: 'kv-123', title: 'rayzen-lunar-wave-a91f' });
  } finally { global.fetch = original; }
});


test('Cloudflare 429 preserves retry timing for actionable recovery', async () => {
  const original = global.fetch;
  global.fetch = async () => new Response(JSON.stringify({ success:false, errors:[{ code:1015, message:'rate limited' }] }), {
    status:429, headers:{ 'Content-Type':'application/json', 'Retry-After':'7' }
  });
  try {
    await assert.rejects(() => cfRequest('token','/accounts'), (error) => {
      assert.equal(error.code,'CLOUDFLARE_RATE_LIMITED');
      assert.equal(error.statusCode,429);
      assert.equal(error.retryAfter,7);
      return true;
    });
  } finally { global.fetch = original; }
});

test('Cloudflare network failures are classified as unavailable', async () => {
  const original = global.fetch;
  global.fetch = async () => { throw new TypeError('network down'); };
  try {
    await assert.rejects(() => cfRequest('token','/accounts',{ timeoutMs:10 }), (error) => {
      assert.equal(error.code,'CLOUDFLARE_UNAVAILABLE');
      assert.equal(error.statusCode,503);
      return true;
    });
  } finally { global.fetch = original; }
});

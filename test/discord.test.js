const { test, mock } = require('node:test');
const assert = require('node:assert');
const { sendDigest } = require('../lib/discord');

test('sendDigest：成功時不拋錯，送出 multipart 含 payload_json 與檔案', async (t) => {
  let capturedUrl, capturedBody;
  t.mock.method(global, 'fetch', async (url, opts) => {
    capturedUrl = url; capturedBody = opts.body;
    return { ok: true, status: 200, json: async () => ({}) };
  });
  await sendDigest('https://discord.com/api/webhooks/123/abc',
    { title: '測試報表', imageBuffer: Buffer.from([1, 2, 3]) });
  assert.equal(capturedUrl, 'https://discord.com/api/webhooks/123/abc');
  assert.ok(capturedBody instanceof FormData);
});

test('sendDigest：Discord 回非 2xx 時拋出含狀態碼的錯誤', async (t) => {
  t.mock.method(global, 'fetch', async () => (
    { ok: false, status: 401, json: async () => ({ message: 'Unauthorized' }) }));
  await assert.rejects(
    () => sendDigest('https://discord.com/api/webhooks/bad/token', { title: 'x', imageBuffer: Buffer.from([1]) }),
    /HTTP 401/);
});

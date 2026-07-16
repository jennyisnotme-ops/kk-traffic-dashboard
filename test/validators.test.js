const { test } = require('node:test');
const assert = require('node:assert');
const { validateExportPayload } = require('../lib/validators');

test('validateExportPayload 接受合法 payload', () => {
  assert.deepEqual(
    validateExportPayload({ filename: '廣告成效', headers: ['日期', '花費'], rows: [['2026-07-01', 123]] }),
    { ok: true });
});

test('validateExportPayload 拒絕缺欄位與超限', () => {
  assert.equal(validateExportPayload(null).ok, false);
  assert.equal(validateExportPayload({ filename: 'x', headers: [], rows: [] }).ok, false);          // headers 至少 1
  assert.equal(validateExportPayload({ filename: 'x', headers: ['a'], rows: 'no' }).ok, false);
  assert.equal(validateExportPayload({ filename: 'x', headers: Array(51).fill('h'), rows: [] }).ok, false);
  const tooMany = { filename: 'x', headers: ['a'], rows: Array(10001).fill(['v']) };
  assert.equal(validateExportPayload(tooMany).ok, false);
});

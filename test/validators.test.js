const { test } = require('node:test');
const assert = require('node:assert');
const { validateExportPayload, validateReportConfig } = require('../lib/validators');

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

test('validateReportConfig 接受合法 config', () => {
  assert.deepEqual(validateReportConfig({
    type: 'smooth',
    metrics: [
      { source: 'ga_daily', field: 'sessions' },
      { source: 'ga_channels', field: 'sessions', channel: 'Organic Search' },
      { source: 'ads_daily', field: 'spend', campaign_id: 'c1', label: '七月檔期花費' },
    ],
  }), { ok: true });
});

test('validateReportConfig 拒絕非法值', () => {
  assert.equal(validateReportConfig(null).ok, false);
  assert.equal(validateReportConfig({ type: 'radar', metrics: [{ source: 'ga_daily', field: 'users' }] }).ok, false);
  assert.equal(validateReportConfig({ type: 'line', metrics: [] }).ok, false);
  assert.equal(validateReportConfig({ type: 'line', metrics: Array(7).fill({ source: 'ga_daily', field: 'users' }) }).ok, false);
  assert.equal(validateReportConfig({ type: 'line', metrics: [{ source: 'ga_daily', field: 'nope' }] }).ok, false);
  assert.equal(validateReportConfig({ type: 'line', metrics: [{ source: 'ga_channels', field: 'sessions' }] }).ok, false); // 缺 channel
  assert.equal(validateReportConfig({ type: 'line', metrics: [{ source: 'ga_daily', field: 'users', label: 'x'.repeat(51) }] }).ok, false);
});

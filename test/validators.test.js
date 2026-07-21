const { test } = require('node:test');
const assert = require('node:assert');
const { validateExportPayload, validateReportConfig, validateNewUser, validateLayoutCards } = require('../lib/validators');

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

test('validateNewUser 接受合法 payload', () => {
  assert.deepEqual(validateNewUser({
    username: 'test_user1', password: 'secret6', display_name: '測試員',
    role: 'user', allowed_pages: ['overview', 'ga'],
  }), { ok: true });
});

test('validateNewUser 拒絕 username 格式錯', () => {
  assert.equal(validateNewUser({
    username: 'ab', password: 'secret6', display_name: '測試員',
    role: 'user', allowed_pages: ['overview'],
  }).ok, false);
  assert.equal(validateNewUser({
    username: '不合法帳號', password: 'secret6', display_name: '測試員',
    role: 'user', allowed_pages: ['overview'],
  }).ok, false);
});

test('validateNewUser 拒絕密碼過短', () => {
  assert.equal(validateNewUser({
    username: 'test_user1', password: '123', display_name: '測試員',
    role: 'user', allowed_pages: ['overview'],
  }).ok, false);
});

test('validateNewUser 拒絕 role 不合法', () => {
  assert.equal(validateNewUser({
    username: 'test_user1', password: 'secret6', display_name: '測試員',
    role: 'superadmin', allowed_pages: ['overview'],
  }).ok, false);
});

test('validateNewUser 拒絕 allowed_pages 含非法鍵', () => {
  assert.equal(validateNewUser({
    username: 'test_user1', password: 'secret6', display_name: '測試員',
    role: 'user', allowed_pages: ['overview', 'not_a_page'],
  }).ok, false);
});

test('validateLayoutCards 接受合法卡片陣列', () => {
  assert.deepEqual(validateLayoutCards([
    { cid: 'ga_daily_users' },
    { cid: 'custom_1', type: 'bar' },
  ]), { ok: true });
});

test('validateLayoutCards 拒絕空陣列', () => {
  assert.equal(validateLayoutCards([]).ok, false);
});

test('validateLayoutCards 拒絕超過 20 項', () => {
  const cards = Array.from({ length: 21 }, (_, i) => ({ cid: `c${i}` }));
  assert.equal(validateLayoutCards(cards).ok, false);
});

test('validateLayoutCards 拒絕 cid 過長', () => {
  assert.equal(validateLayoutCards([{ cid: 'x'.repeat(61) }]).ok, false);
});

test('validateLayoutCards 拒絕不合法的 type', () => {
  assert.equal(validateLayoutCards([{ cid: 'a', type: 'radar' }]).ok, false);
});

test('validateLayoutCards 拒絕非陣列', () => {
  assert.equal(validateLayoutCards(null).ok, false);
  assert.equal(validateLayoutCards({}).ok, false);
});

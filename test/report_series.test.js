const { test } = require('node:test');
const assert = require('node:assert');
const { dateAxis, seriesFor } = require('../lib/report_series');

test('dateAxis 產生含頭尾的日期陣列', () => {
  assert.deepEqual(dateAxis('2026-07-01', '2026-07-03'), ['2026-07-01', '2026-07-02', '2026-07-03']);
  assert.deepEqual(dateAxis('2026-07-01', '2026-07-01'), ['2026-07-01']);
});

test('seriesFor：一般來源（ga_daily）直接讀欄位', () => {
  const rows = [{ date: '2026-07-01', sessions: 100 }, { date: '2026-07-02', sessions: 120 }];
  const metric = { source: 'ga_daily', field: 'sessions' };
  const axis = ['2026-07-01', '2026-07-02', '2026-07-03'];
  assert.deepEqual(seriesFor(rows, metric, axis),
    { label: 'GA 工作階段', data: [100, 120, 0], color: '#26a69a' });
});

test('seriesFor：ga_channels 依 channel 過濾並加總', () => {
  const rows = [
    { date: '2026-07-01', channel: 'Organic Search', sessions: 50 },
    { date: '2026-07-01', channel: 'Paid Search', sessions: 30 },
    { date: '2026-07-02', channel: 'Organic Search', sessions: 60 },
  ];
  const metric = { source: 'ga_channels', field: 'sessions', channel: 'Organic Search' };
  const axis = ['2026-07-01', '2026-07-02'];
  assert.deepEqual(seriesFor(rows, metric, axis),
    { label: 'GA 管道工作階段（Organic Search）', data: [50, 60], color: '#00897b' });
});

test('seriesFor：ads_daily 依 campaign_id 過濾，未指定則加總全帳戶', () => {
  const rows = [
    { date: '2026-07-01', campaign_id: 'c1', spend: '100.00' },
    { date: '2026-07-01', campaign_id: 'c2', spend: '50.00' },
  ];
  const axis = ['2026-07-01'];
  assert.deepEqual(seriesFor(rows, { source: 'ads_daily', field: 'spend' }, axis),
    { label: '廣告花費', data: [150], color: '#c62828' });
  assert.deepEqual(seriesFor(rows, { source: 'ads_daily', field: 'spend', campaign_id: 'c1' }, axis),
    { label: '廣告花費', data: [100], color: '#c62828' });
});

test('seriesFor：自訂 label 覆蓋預設', () => {
  const rows = [{ date: '2026-07-01', spend: '10' }];
  const r = seriesFor(rows, { source: 'ads_daily', field: 'spend', label: '七月檔期' }, ['2026-07-01']);
  assert.equal(r.label, '七月檔期');
});

const { test } = require('node:test');
const assert = require('node:assert');
const { gaDate, rowsToObjects } = require('../fetchers/ga');

test('gaDate 轉換 GA 日期格式', () => {
  assert.equal(gaDate('20260701'), '2026-07-01');
});

test('rowsToObjects 轉換 GA 回傳列', () => {
  const rows = [{
    dimensionValues: [{ value: '20260701' }, { value: 'Organic Search' }],
    metricValues: [{ value: '150' }, { value: '120' }],
  }];
  assert.deepEqual(
    rowsToObjects(rows, ['date', 'channel'], ['sessions', 'users']),
    [{ date: '2026-07-01', channel: 'Organic Search', sessions: 150, users: 120 }]
  );
});

test('rowsToObjects 空回傳與非數字', () => {
  assert.deepEqual(rowsToObjects(undefined, ['date'], ['sessions']), []);
  const rows = [{ dimensionValues: [{ value: '20260701' }], metricValues: [{ value: '' }] }];
  assert.equal(rowsToObjects(rows, ['date'], ['sessions'])[0].sessions, 0);
});

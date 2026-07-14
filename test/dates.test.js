const { test } = require('node:test');
const assert = require('node:assert');
const { taipeiToday, addDays } = require('../lib/dates');

test('addDays 加減天數', () => {
  assert.equal(addDays('2026-07-14', -1), '2026-07-13');
  assert.equal(addDays('2026-07-01', -1), '2026-06-30');   // 跨月
  assert.equal(addDays('2026-01-01', -1), '2025-12-31');   // 跨年
  assert.equal(addDays('2026-07-14', 3), '2026-07-17');
});

test('taipeiToday 回傳 YYYY-MM-DD 格式', () => {
  assert.match(taipeiToday(), /^\d{4}-\d{2}-\d{2}$/);
});

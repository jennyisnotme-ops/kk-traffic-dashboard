const { test } = require('node:test');
const assert = require('node:assert');
const { extractConversions, insightRowsToRows } = require('../fetchers/ads');

test('extractConversions 依優先序取轉換數', () => {
  assert.equal(extractConversions([
    { action_type: 'link_click', value: '99' },
    { action_type: 'omni_purchase', value: '7' },
    { action_type: 'purchase', value: '5' },
  ]), 7);                                                   // omni_purchase 優先
  assert.equal(extractConversions([{ action_type: 'lead', value: '3' }]), 3);
  assert.equal(extractConversions([{ action_type: 'link_click', value: '99' }]), 0);
  assert.equal(extractConversions(undefined), 0);
});

test('insightRowsToRows 攤平廣告列', () => {
  const data = [{
    date_start: '2026-07-01', date_stop: '2026-07-01',
    campaign_id: 'c1', campaign_name: '七月檔期',
    spend: '1234.56', impressions: '10000', clicks: '250',
    actions: [{ action_type: 'omni_purchase', value: '4' }],
  }];
  assert.deepEqual(insightRowsToRows(data), [{
    date: '2026-07-01', campaign_id: 'c1', campaign_name: '七月檔期',
    spend: 1234.56, impressions: 10000, clicks: 250, conversions: 4,
    actions: [{ action_type: 'omni_purchase', value: '4' }],
  }]);
});

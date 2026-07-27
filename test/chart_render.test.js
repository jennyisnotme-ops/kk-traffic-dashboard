const { test } = require('node:test');
const assert = require('node:assert');
const { renderChartPng } = require('../lib/chart_render');

test('renderChartPng 產生合法 PNG buffer（折線圖）', async () => {
  const buf = await renderChartPng({
    type: 'line',
    labels: ['07-01', '07-02', '07-03'],
    series: [{ label: '工作階段', data: [100, 120, 90], color: '#1565c0' }],
  });
  assert.ok(Buffer.isBuffer(buf));
  assert.ok(buf.length > 500, `buffer 太小 (${buf.length} bytes)，可能渲染失敗`);
  // PNG 檔頭 magic bytes: 89 50 4E 47 0D 0A 1A 0A
  assert.deepEqual(buf.subarray(0, 8), Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]));
});

test('renderChartPng 支援圓餅圖（僅第一個數列）', async () => {
  const buf = await renderChartPng({
    type: 'pie',
    labels: ['Organic', 'Paid', 'Direct'],
    series: [{ label: '工作階段', data: [50, 30, 20], color: '#1565c0' }],
  });
  assert.ok(buf.length > 500);
});

test('renderChartPng 空數列不拋錯（畫出空圖）', async () => {
  const buf = await renderChartPng({ type: 'line', labels: [], series: [{ label: 'x', data: [], color: '#000' }] });
  assert.ok(Buffer.isBuffer(buf));
});

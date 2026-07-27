const { test } = require('node:test');
const assert = require('node:assert');
const { loadImage } = require('canvas');
const { renderChartPng, renderDigestPng } = require('../lib/chart_render');

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

// renderDigestPng — 每日摘要合成入口：單指標時直接沿用 renderChartPng，
// 多指標時每個指標各畫一張帶標題的小圖（各自 Y 軸自動縮放），拼成 2 欄網格單一 PNG（見 8232c57 前端同款修法的伺服器端對應）
test('renderDigestPng 單指標時直接透傳 renderChartPng，尺寸與內容一致', async () => {
  const args = {
    type: 'line',
    labels: ['07-01', '07-02', '07-03'],
    series: [{ label: '工作階段', data: [100, 120, 90], color: '#1565c0' }],
  };
  const buf = await renderDigestPng(args, { width: 640, height: 320 });
  assert.ok(Buffer.isBuffer(buf));
  assert.ok(buf.length > 500, `buffer 太小 (${buf.length} bytes)`);
  assert.deepEqual(buf.subarray(0, 8), Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]));
  const img = await loadImage(buf);
  assert.equal(img.width, 640);
  assert.equal(img.height, 320);
});

test('renderDigestPng 多指標時合成 2 欄小圖網格，尺寸為 cols*cellW x rows*cellH', async () => {
  const args = {
    type: 'line',
    labels: ['07-01', '07-02', '07-03'],
    series: [
      { label: '頁面瀏覽數', data: [500000, 520000, 480000], color: '#1565c0' },
      { label: '廣告點擊', data: [12, 18, 9], color: '#ef6c00' },
      { label: '轉換數', data: [2, 3, 1], color: '#8e24aa' },
    ],
  };
  const cellWidth = 400, cellHeight = 240;
  const buf = await renderDigestPng(args, { cellWidth, cellHeight });
  assert.ok(Buffer.isBuffer(buf));
  assert.ok(buf.length > 500, `buffer 太小 (${buf.length} bytes)`);
  assert.deepEqual(buf.subarray(0, 8), Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]));
  // 3 個指標、2 欄 → 2 列；整張合成圖尺寸應為 2 欄 x 2 列的小圖網格
  const img = await loadImage(buf);
  assert.equal(img.width, 2 * cellWidth);
  assert.equal(img.height, 2 * cellHeight);
});

test('renderDigestPng 多指標使用預設 cell 尺寸時仍能產生合法網格 PNG', async () => {
  const args = {
    type: 'bar',
    labels: ['07-01', '07-02'],
    series: [
      { label: 'A', data: [1, 2], color: '#1565c0' },
      { label: 'B', data: [3, 4], color: '#26a69a' },
    ],
  };
  const buf = await renderDigestPng(args);
  const img = await loadImage(buf);
  assert.equal(img.width, 2 * 480); // 預設 cellWidth
  assert.equal(img.height, 1 * 280); // 2 指標、2 欄 → 1 列，預設 cellHeight
});

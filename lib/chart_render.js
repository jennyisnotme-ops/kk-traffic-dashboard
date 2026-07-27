// lib/chart_render.js — 伺服器端把 {type, labels, series} 畫成 PNG（每日摘要用，不開瀏覽器）
// renderDigestPng 對應前端 8232c57 的「多指標小圖群組」修法：多指標時各自獨立 Y 軸縮放，
// 拼成一張 2 欄小圖網格，避免小數值指標（廣告點擊/轉換）被大數值指標（頁面瀏覽數）壓成看不見的線
const { ChartJSNodeCanvas } = require('chartjs-node-canvas');
const { createCanvas, loadImage } = require('canvas');

function buildConfig({ type, labels, series, title }) {
  const isPie = type === 'pie';
  const chartType = isPie ? 'pie' : (type === 'bar' ? 'bar' : 'line');
  const s = series && series.length ? series : [{ label: '', data: [], color: '#1565c0' }];

  return {
    type: chartType,
    data: {
      labels,
      datasets: isPie
        ? [{ data: s[0].data,
             backgroundColor: ['#1565c0', '#26a69a', '#ef6c00', '#8e24aa', '#c62828',
                                '#5c6bc0', '#00897b', '#f9a825', '#6d4c41', '#78909c'] }]
        : s.map(one => ({
            label: one.label, data: one.data,
            borderColor: one.color, backgroundColor: one.color + '33',
            tension: type === 'smooth' ? 0.35 : 0,
            fill: false, borderWidth: 2, pointRadius: 2,
          })),
    },
    options: {
      responsive: false, animation: false,
      plugins: {
        legend: { display: isPie || s.length > 1, labels: { color: '#263238' } },
        ...(title ? { title: { display: true, text: title, color: '#263238', font: { size: 14 } } } : {}),
      },
      scales: isPie ? {} : {
        x: { ticks: { color: '#607d8b' }, grid: { color: '#eceff1' } },
        y: { beginAtZero: true, ticks: { color: '#607d8b' }, grid: { color: '#eceff1' } },
      },
      backgroundColor: '#ffffff',
    },
  };
}

async function renderChartPng({ type, labels, series, title }, opts = {}) {
  const width = opts.width || 800;
  const height = opts.height || 400;
  const canvas = new ChartJSNodeCanvas({
    width, height,
    backgroundColour: 'white',
    chartCallback: (ChartJS) => { ChartJS.defaults.font.family = 'sans-serif'; },
  });
  return canvas.renderToBuffer(buildConfig({ type, labels, series, title: opts.title || title }));
}

// 每日摘要用的合成入口：單指標時行為與 renderChartPng 完全相同；
// 多指標時每個指標各畫一張帶標題的小圖（各自 Y 軸自動縮放），再拼成 2 欄網格單一 PNG。
async function renderDigestPng({ type, labels, series }, opts = {}) {
  if (!series || series.length <= 1) return renderChartPng({ type, labels, series }, opts);
  const cols = 2;
  const rows = Math.ceil(series.length / cols);
  const cellW = opts.cellWidth || 480;
  const cellH = opts.cellHeight || 280;
  const buffers = await Promise.all(
    series.map(s => renderChartPng({ type, labels, series: [s] }, { width: cellW, height: cellH, title: s.label })));
  const canvas = createCanvas(cols * cellW, rows * cellH);
  const ctx = canvas.getContext('2d');
  ctx.fillStyle = '#ffffff';
  ctx.fillRect(0, 0, canvas.width, canvas.height);
  for (let i = 0; i < buffers.length; i++) {
    const img = await loadImage(buffers[i]);
    const x = (i % cols) * cellW, y = Math.floor(i / cols) * cellH;
    ctx.drawImage(img, x, y, cellW, cellH);
  }
  return canvas.toBuffer('image/png');
}

module.exports = { renderChartPng, renderDigestPng };

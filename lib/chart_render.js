// lib/chart_render.js — 伺服器端把 {type, labels, series} 畫成 PNG（每日摘要用，不開瀏覽器）
const { ChartJSNodeCanvas } = require('chartjs-node-canvas');

function buildConfig({ type, labels, series }) {
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
      },
      scales: isPie ? {} : {
        x: { ticks: { color: '#607d8b' }, grid: { color: '#eceff1' } },
        y: { beginAtZero: true, ticks: { color: '#607d8b' }, grid: { color: '#eceff1' } },
      },
      backgroundColor: '#ffffff',
    },
  };
}

async function renderChartPng({ type, labels, series }, opts = {}) {
  const width = opts.width || 800;
  const height = opts.height || 400;
  const canvas = new ChartJSNodeCanvas({
    width, height,
    backgroundColour: 'white',
    chartCallback: (ChartJS) => { ChartJS.defaults.font.family = 'sans-serif'; },
  });
  return canvas.renderToBuffer(buildConfig({ type, labels, series }));
}

module.exports = { renderChartPng };

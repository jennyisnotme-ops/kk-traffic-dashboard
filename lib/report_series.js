// lib/report_series.js — 伺服器端版本的「報表設定 → 圖表資料」計算
// 對應 public/js/app.js 的 METRICS/metricSeries（因無建置工具、前後端無法共用模組，
// 兩處邏輯需保持一致；若新增指標請同步修改兩處）
const { pool } = require('./db');

const METRICS = [
  { source: 'ga_daily', field: 'users', label: 'GA 使用者', color: '#1565c0' },
  { source: 'ga_daily', field: 'sessions', label: 'GA 工作階段', color: '#26a69a' },
  { source: 'ga_daily', field: 'pageviews', label: 'GA 瀏覽頁數', color: '#8e24aa' },
  { source: 'ga_daily', field: 'engagement_rate', label: 'GA 互動率', color: '#5c6bc0' },
  { source: 'ga_channels', field: 'sessions', label: 'GA 管道工作階段', color: '#00897b' },
  { source: 'fb_page_daily', field: 'reach', label: '粉專觀看', color: '#f9a825' },
  { source: 'fb_page_daily', field: 'engagement', label: '粉專互動', color: '#ef6c00' },
  { source: 'fb_page_daily', field: 'fans_total', label: '追蹤者總數', color: '#6d4c41' },
  { source: 'fb_page_daily', field: 'fans_change', label: '追蹤者變化', color: '#78909c' },
  { source: 'ads_daily', field: 'spend', label: '廣告花費', color: '#c62828' },
  { source: 'ads_daily', field: 'impressions', label: '廣告曝光', color: '#ad1457' },
  { source: 'ads_daily', field: 'clicks', label: '廣告點擊', color: '#283593' },
  { source: 'ads_daily', field: 'conversions', label: '廣告轉換', color: '#004d40' },
];
const metricDef = m => METRICS.find(x => x.source === m.source && x.field === m.field);

function dateAxis(from, to) {
  const out = [];
  for (let d = from; d <= to; d = addOneDay(d)) out.push(d);
  return out;
}

function addOneDay(dateStr) {
  const d = new Date(`${dateStr}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + 1);
  return d.toISOString().slice(0, 10);
}

function seriesFor(rows, metric, axis) {
  const def = metricDef(metric) || { label: `${metric.source}.${metric.field}`, color: '#78909c' };
  const byDate = new Map();
  if (metric.source === 'ga_channels') {
    for (const r of rows) if (r.channel === metric.channel)
      byDate.set(r.date, (byDate.get(r.date) || 0) + Number(r[metric.field] || 0));
  } else if (metric.source === 'ads_daily') {
    for (const r of rows) if (!metric.campaign_id || r.campaign_id === metric.campaign_id)
      byDate.set(r.date, (byDate.get(r.date) || 0) + Number(r[metric.field] || 0));
  } else {
    for (const r of rows) byDate.set(r.date, Number(r[metric.field] || 0));
  }
  return { label: metric.label || (metric.channel ? `${def.label}（${metric.channel}）` : def.label),
           data: axis.map(d => byDate.get(d) ?? 0), color: def.color };
}

// 依 config.metrics 用到哪些來源，只查需要的表
async function computeReportSeries(pool, config, from, to) {
  const axis = dateAxis(from, to);
  const sourcesNeeded = new Set(config.metrics.map(m => m.source));
  const tableOf = { ga_daily: 'traf_ga_daily', ga_channels: 'traf_ga_channels',
                     fb_page_daily: 'traf_fb_page_daily', ads_daily: 'traf_ads_daily' };
  const rowsBySource = {};
  for (const source of sourcesNeeded) {
    const { rows } = await pool.query(
      `SELECT * FROM ${tableOf[source]} WHERE date BETWEEN $1 AND $2`, [from, to]);
    rowsBySource[source] = rows;
  }
  const series = config.metrics.map(m => seriesFor(rowsBySource[m.source], m, axis));
  return { labels: axis, series };
}

module.exports = { dateAxis, seriesFor, computeReportSeries, METRICS };

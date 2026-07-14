// fetchers/ga.js — GA4 Data API → traf_ga_*
const { BetaAnalyticsDataClient } = require('@google-analytics/data');

let _client = null;
function client() {
  if (!_client) {
    const credentials = JSON.parse(
      Buffer.from(process.env.GA_SERVICE_ACCOUNT_JSON, 'base64').toString('utf8'));
    _client = new BetaAnalyticsDataClient({ credentials });
  }
  return _client;
}

// GA 的 date 維度是 '20260701' → '2026-07-01'
function gaDate(s) { return `${s.slice(0, 4)}-${s.slice(4, 6)}-${s.slice(6, 8)}`; }

function rowsToObjects(rows, dims, mets) {
  return (rows || []).map(r => {
    const o = {};
    dims.forEach((d, i) => {
      const v = r.dimensionValues[i].value;
      o[d] = d === 'date' ? gaDate(v) : v;
    });
    mets.forEach((m, i) => { o[m] = Number(r.metricValues[i].value) || 0; });
    return o;
  });
}

async function runReport(dims, mets, from, to) {
  const [resp] = await client().runReport({
    property: `properties/${process.env.GA_PROPERTY_ID}`,
    dateRanges: [{ startDate: from, endDate: to }],
    dimensions: dims.map(name => ({ name })),
    metrics: mets.map(name => ({ name })),
    limit: 100000,
  });
  return rowsToObjects(resp.rows, dims, mets);
}

async function fetchGa(pool, from, to) {
  // 1) 每日總量
  const daily = await runReport(
    ['date'], ['activeUsers', 'sessions', 'screenPageViews', 'engagementRate'], from, to);
  for (const d of daily) {
    await pool.query(
      `INSERT INTO traf_ga_daily (date, users, sessions, pageviews, engagement_rate)
       VALUES ($1,$2,$3,$4,$5)
       ON CONFLICT (date) DO UPDATE
         SET users=$2, sessions=$3, pageviews=$4, engagement_rate=$5`,
      [d.date, d.activeUsers, d.sessions, d.screenPageViews, d.engagementRate]);
  }

  // 2) 來源管道
  const channels = await runReport(
    ['date', 'sessionDefaultChannelGroup'], ['sessions', 'activeUsers'], from, to);
  for (const c of channels) {
    await pool.query(
      `INSERT INTO traf_ga_channels (date, channel, sessions, users)
       VALUES ($1,$2,$3,$4)
       ON CONFLICT (date, channel) DO UPDATE SET sessions=$3, users=$4`,
      [c.date, c.sessionDefaultChannelGroup, c.sessions, c.activeUsers]);
  }

  // 3) 熱門頁面：每天只留前 20 名
  const pagesAll = await runReport(
    ['date', 'pagePath'], ['screenPageViews', 'activeUsers'], from, to);
  const byDate = {};
  for (const p of pagesAll) (byDate[p.date] = byDate[p.date] || []).push(p);
  let pagesKept = 0;
  for (const list of Object.values(byDate)) {
    list.sort((a, b) => b.screenPageViews - a.screenPageViews);
    for (const p of list.slice(0, 20)) {
      await pool.query(
        `INSERT INTO traf_ga_pages (date, page_path, views, users)
         VALUES ($1,$2,$3,$4)
         ON CONFLICT (date, page_path) DO UPDATE SET views=$3, users=$4`,
        [p.date, p.pagePath.slice(0, 300), p.screenPageViews, p.activeUsers]);
      pagesKept++;
    }
  }

  // 4) 轉換（關鍵事件）：keyEvents 為 0 的列不存
  const events = (await runReport(['date', 'eventName'], ['keyEvents'], from, to))
    .filter(e => e.keyEvents > 0);
  for (const e of events) {
    await pool.query(
      `INSERT INTO traf_ga_events (date, event_name, count)
       VALUES ($1,$2,$3)
       ON CONFLICT (date, event_name) DO UPDATE SET count=$3`,
      [e.date, e.eventName, e.keyEvents]);
  }

  return { daily: daily.length, channels: channels.length, pages: pagesKept, events: events.length };
}

module.exports = { fetchGa, gaDate, rowsToObjects };

// jobs/daily.js — 排程與抓取協調：每源獨立成敗、一律寫 traf_fetch_log
const cron = require('node-cron');
const { fetchGa } = require('../fetchers/ga');
const { fetchFbPage } = require('../fetchers/fb_page');
const { fetchAds } = require('../fetchers/ads');
const { taipeiToday, addDays } = require('../lib/dates');

const SOURCES = [
  ['ga', fetchGa],
  ['fb_page', fetchFbPage],
  ['ads', fetchAds],
];

async function logFetch(pool, source, from, to, status, error) {
  await pool.query(
    `INSERT INTO traf_fetch_log (source, date_from, date_to, status, error)
     VALUES ($1,$2,$3,$4,$5)`,
    [source, from, to, status, error ? String(error).slice(0, 500) : null]);
}

async function runAll(pool, from, to) {
  const results = {};
  for (const [name, fn] of SOURCES) {
    try {
      const summary = await fn(pool, from, to);
      await logFetch(pool, name, from, to, 'ok', null);
      results[name] = { ok: true, ...summary };
    } catch (err) {
      console.error(`[fetch:${name}] ${err.message}`);
      await logFetch(pool, name, from, to, 'error', err.message);
      results[name] = { ok: false, error: err.message };
    }
  }
  return results;
}

// 每日抓 D-3 ~ D-1：GA 要 24–48h 才處理完整、廣告有歸因回填，重抓覆蓋
function defaultRange() {
  const today = taipeiToday();
  return { from: addDays(today, -3), to: addDays(today, -1) };
}

function scheduleDaily(pool) {
  cron.schedule('0 8 * * *', async () => {
    const { from, to } = defaultRange();
    console.log(`[cron] 每日抓取 ${from} ~ ${to}`);
    await runAll(pool, from, to);
  }, { timezone: 'Asia/Taipei' });
  console.log('排程已啟動：每天 08:00 (Asia/Taipei)');
}

// 一次性回補：各源用自己的 API 回溯上限
async function backfill(pool) {
  const to = addDays(taipeiToday(), -1);
  const plans = [
    ['ga', fetchGa, addDays(to, -364)],
    ['fb_page', fetchFbPage, addDays(to, -88)],   // 粉專 insights 約 90 天上限
    ['ads', fetchAds, addDays(to, -364)],
  ];
  const results = {};
  for (const [name, fn, from] of plans) {
    try {
      const summary = await fn(pool, from, to);
      await logFetch(pool, name, from, to, 'ok', null);
      results[name] = { ok: true, from, to, ...summary };
    } catch (err) {
      await logFetch(pool, name, from, to, 'error', err.message);
      results[name] = { ok: false, from, to, error: err.message };
    }
  }
  return results;
}

module.exports = { runAll, scheduleDaily, backfill, defaultRange };

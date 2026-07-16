// jobs/daily.js — 排程與抓取協調：每源獨立成敗、一律寫 traf_fetch_log
const cron = require('node-cron');
const { fetchGa } = require('../fetchers/ga');
const { fetchFbPage } = require('../fetchers/fb_page');
const { fetchAds } = require('../fetchers/ads');
const { taipeiToday, addDays } = require('../lib/dates');

const SOURCES = [
  ['ga', fetchGa, 3],
  ['fb_page', fetchFbPage, 3],
  ['ads', fetchAds, 7],   // 廣告 7 天點擊歸因會回填轉換數，D-3 會永久低估
];

// 併發鎖：避免手動重抓/回補與 cron 或彼此重疊執行造成 UPSERT 競爭
let running = false;

async function logFetch(pool, source, from, to, status, error) {
  try {
    await pool.query(
      `INSERT INTO traf_fetch_log (source, date_from, date_to, status, error)
       VALUES ($1,$2,$3,$4,$5)`,
      [source, from, to, status, error ? String(error).slice(0, 500) : null]);
  } catch (e) {
    // 寫 log 失敗不可中斷抓取流程或 cron
    console.error('[fetch_log] 寫入失敗:', e.message);
  }
}

async function runAll(pool, from = null, to = null) {
  if (running) throw new Error('抓取已在執行中，請稍後再試');
  running = true;
  try {
    const results = {};
    const defaultTo = addDays(taipeiToday(), -1);
    for (const [name, fn, daysBack] of SOURCES) {
      const f = from || addDays(defaultTo, -(daysBack - 1));
      const t = to || defaultTo;
      try {
        const summary = await fn(pool, f, t);
        await logFetch(pool, name, f, t, 'ok', null);
        results[name] = { ok: true, ...summary };
      } catch (err) {
        const msg = err?.message || String(err);
        console.error(`[fetch:${name}] ${msg}`);
        await logFetch(pool, name, f, t, 'error', msg);
        results[name] = { ok: false, error: msg };
      }
    }
    return results;
  } finally { running = false; }
}

function scheduleDaily(pool) {
  cron.schedule('0 8 * * *', async () => {
    try {
      console.log('[cron] 每日抓取（各源預設窗）');
      // 注意：若 08:00 當下剛好有手動重抓/回補在跑，runAll 會擲出「抓取已在執行中」，
      // 此處 catch 會記錄 console.error 並跳過本次排程，屬可接受的行為（不重試、不中斷 process）
      await runAll(pool);
    } catch (err) {
      // 排程路徑不可洩漏 unhandled rejection
      console.error('[cron] 每日抓取失敗:', err);
    }
  }, { timezone: 'Asia/Taipei' });
  console.log('排程已啟動：每天 08:00 (Asia/Taipei)');
}

// 一次性回補：各源用自己的 API 回溯上限
async function backfill(pool) {
  if (running) throw new Error('抓取已在執行中，請稍後再試');
  running = true;
  try {
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
        const msg = err?.message || String(err);
        await logFetch(pool, name, from, to, 'error', msg);
        results[name] = { ok: false, from, to, error: msg };
      }
    }
    return results;
  } finally {
    running = false;
  }
}

module.exports = { runAll, scheduleDaily, backfill };

// jobs/daily.js — 排程與抓取協調：每源獨立成敗、一律寫 traf_fetch_log
const cron = require('node-cron');
const { fetchGa } = require('../fetchers/ga');
const { fetchFbPage } = require('../fetchers/fb_page');
const { fetchAds } = require('../fetchers/ads');
const { taipeiToday, addDays } = require('../lib/dates');
const { computeReportSeries } = require('../lib/report_series');
const { renderDigestPng } = require('../lib/chart_render');
const { sendDigest } = require('../lib/discord');

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
      await runDigestOnce(pool);
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

// 每日摘要：獨立於三個資料來源之外的第四步驟，任何失敗都不影響資料抓取本身
// override 非 null 時忽略 DB 的 enabled 報表清單，改用呼叫端指定的 report_ids，用於「測試發送」（見 server.js）
// 可勾選多份報表：每份各自算圖、各自發一則 Discord 訊息、各自成敗互不影響（見本函式內的 for 迴圈）
async function runDigestOnce(pool, override = null) {
  const results = [];
  try {
    let webhookUrl, entries;
    if (override) {
      webhookUrl = override.webhook_url;
      entries = (override.report_ids || []).map(id => ({ report_id: id }));
    } else {
      const { rows: cfgRows } = await pool.query('SELECT webhook_url FROM traf_daily_digest WHERE id = 1');
      webhookUrl = cfgRows[0]?.webhook_url;
      if (!webhookUrl) return { ok: true, skipped: true };
      const { rows } = await pool.query('SELECT report_id FROM traf_digest_reports WHERE enabled = true');
      entries = rows;
    }
    if (!webhookUrl || !entries.length) return { ok: true, skipped: true };

    const to = addDays(taipeiToday(), -1);
    const from = addDays(to, -29);

    for (const entry of entries) {
      try {
        const { rows: reportRows } = await pool.query('SELECT * FROM traf_reports WHERE id = $1', [entry.report_id]);
        const report = reportRows[0];
        if (!report) throw new Error('指定的自訂報表已不存在');
        const { labels, series } = await computeReportSeries(pool, report.config, from, to);
        const imageBuffer = await renderDigestPng({ type: report.config.type, labels, series });
        await sendDigest(webhookUrl, { title: `${report.name}（${from} ~ ${to}）`, imageBuffer });
        if (!override) {
          await pool.query(
            `UPDATE traf_digest_reports SET last_sent_at = now(), last_status = 'ok', last_error = NULL WHERE report_id = $1`,
            [entry.report_id]);
        }
        results.push({ report_id: entry.report_id, ok: true });
      } catch (err) {
        const msg = err?.message || String(err);
        console.error('[digest]', entry.report_id, msg);
        if (!override) {
          await pool.query(
            `UPDATE traf_digest_reports SET last_sent_at = now(), last_status = 'error', last_error = $1 WHERE report_id = $2`,
            [msg.slice(0, 500), entry.report_id]).catch(e => console.error('[digest] 寫入狀態失敗:', e.message));
        }
        results.push({ report_id: entry.report_id, ok: false, error: msg });
      }
    }
    return { ok: true, results };
  } catch (err) {
    // 理論上不會走到這裡（上面每筆報表已各自 try/catch）；保留最外層防線避免任何未預期例外外洩到呼叫端
    const msg = err?.message || String(err);
    console.error('[digest]', msg);
    return { ok: false, error: msg };
  }
}

module.exports = { runAll, scheduleDaily, backfill, runDigestOnce };

// scripts/smoke_browser.js — Puppeteer 瀏覽器煙霧測試小助理
//
// 啟動一份 server 子行程（PORT=3777），用 headless Chrome 走一輪關鍵使用者流程，
// 確認登入、頁籤、比較、匯出彈窗、報表彈窗、圖表類型記憶等功能沒有壞掉。
// 特別針對「彈窗一載入就顯示」這類 CSS [hidden] 被 display:flex 蓋掉的回歸問題，
// 一律用「計算後樣式」（offsetParent / getComputedStyle().display）檢查可見性，
// 不能只看 hidden attribute 本身。
//
// 用法：npm run smoke

'use strict';

require('dotenv').config();

const path = require('path');
const { spawn } = require('child_process');
const puppeteer = require('puppeteer');

const PORT = 3777;
const BASE_URL = `http://localhost:${PORT}`;
const PROJECT_ROOT = path.join(__dirname, '..');
const HEALTH_TIMEOUT_MS = 30000;
const ADMIN_SECRET = process.env.INIT_ADMIN_SECRET;

const failures = [];
const results = [];

function ok(name) {
  results.push(`✓ ${name}`);
  console.log(`✓ ${name}`);
}
function fail(name, detail) {
  const msg = detail ? `✗ ${name} — ${detail}` : `✗ ${name}`;
  results.push(msg);
  failures.push(msg);
  console.log(msg);
}
async function check(name, fn) {
  try {
    await fn();
    ok(name);
  } catch (err) {
    fail(name, err && err.message ? err.message : String(err));
  }
}

function sleep(ms) { return new Promise(r => setTimeout(r, ms)); }

async function waitForHealth(timeoutMs) {
  const deadline = Date.now() + timeoutMs;
  let lastErr = null;
  while (Date.now() < deadline) {
    try {
      const res = await fetch(`${BASE_URL}/health`);
      if (res.ok) {
        const json = await res.json();
        if (json && json.ok) return;
      }
    } catch (err) {
      lastErr = err;
    }
    await sleep(300);
  }
  throw new Error(`server /health 逾時未就緒（${timeoutMs}ms）${lastErr ? ': ' + lastErr.message : ''}`);
}

function spawnServer() {
  const child = spawn(process.execPath, ['server.js'], {
    cwd: PROJECT_ROOT,
    env: { ...process.env, PORT: String(PORT) },
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  let out = '';
  child.stdout.on('data', d => { out += d.toString(); });
  child.stderr.on('data', d => { out += d.toString(); });
  child._smokeLog = () => out;
  return child;
}

// ── 可見性判斷：一律用計算後樣式，不看 hidden attribute ──────────
async function isComputedVisible(page, selector) {
  return page.evaluate(sel => {
    const el = document.querySelector(sel);
    if (!el) return false;
    const style = getComputedStyle(el);
    if (style.display === 'none' || style.visibility === 'hidden') return false;
    // offsetParent 為 null 通常代表未顯示（position:fixed 元素例外，故僅作輔助條件）
    return true;
  }, selector);
}
async function computedDisplay(page, selector) {
  return page.evaluate(sel => {
    const el = document.querySelector(sel);
    if (!el) return 'MISSING';
    return getComputedStyle(el).display;
  }, selector);
}

async function main() {
  if (!ADMIN_SECRET) {
    throw new Error('未設定 INIT_ADMIN_SECRET（.env），無法登入測試');
  }

  console.log(`啟動 server（PORT=${PORT}）…`);
  const server = spawnServer();
  let browser = null;
  const pageErrors = [];

  try {
    await waitForHealth(HEALTH_TIMEOUT_MS);
    ok('server /health 就緒');

    browser = await puppeteer.launch({
      // 注意：Puppeteer 新版預設的「new」headless 模式在部分沙箱環境下，
      // 頁面導航/重繪後合成滑鼠事件會被靜默吞掉（mousedown 完全不觸發），
      // 導致 page.click() 對頁籤、checkbox 等元素完全無效但不報錯。
      // 改用舊版 headless（'shell'）可穩定重現真實使用者點擊行為。
      headless: 'shell',
      defaultViewport: { width: 1280, height: 900 },
    });
    const page = await browser.newPage();
    page.on('pageerror', err => pageErrors.push(err.message || String(err)));
    page.on('console', msg => {
      if (msg.type() === 'error') {
        // 頁面 console.error 不直接算失敗（可能是預期中的 API 401 log），
        // 但 pageerror（未捕捉例外）一定算數，見下方檢查 (k)。
      }
    });

    // a. 初始載入：登入層可見，#main 隱藏
    await check('初始載入：登入層可見、#main 隱藏', async () => {
      const resp = await page.goto(BASE_URL, { waitUntil: 'networkidle0' });
      if (!resp || !resp.ok()) throw new Error(`GET / 失敗：status=${resp && resp.status()}`);
      await page.waitForSelector('#login-overlay', { timeout: 5000 });
      const loginVisible = await isComputedVisible(page, '#login-overlay');
      if (!loginVisible) throw new Error('#login-overlay 未顯示');
      const mainDisplay = await computedDisplay(page, '#main');
      if (mainDisplay !== 'none') throw new Error(`#main 應為 display:none，實際為 ${mainDisplay}`);
    });

    // b. 回歸檢查：初始載入時兩個彈窗都不可見（[hidden] 必須真的隱藏）
    await check('回歸檢查：#export-modal / #report-modal 初始載入皆不可見', async () => {
      const exportDisplay = await computedDisplay(page, '#export-modal');
      const reportDisplay = await computedDisplay(page, '#report-modal');
      if (exportDisplay !== 'none') throw new Error(`#export-modal 應為 display:none，實際為 ${exportDisplay}`);
      if (reportDisplay !== 'none') throw new Error(`#report-modal 應為 display:none，實際為 ${reportDisplay}`);
    });

    // c. 錯誤密碼
    await check('錯誤密碼 → #login-error 顯示訊息、#main 仍隱藏', async () => {
      await page.type('#login-secret', 'this-is-definitely-wrong-password');
      await page.click('#login-form button[type="submit"]');
      await page.waitForFunction(
        () => document.querySelector('#login-error')?.textContent?.trim().length > 0,
        { timeout: 5000 },
      );
      const errText = await page.$eval('#login-error', el => el.textContent.trim());
      if (!errText) throw new Error('#login-error 為空');
      const mainDisplay = await computedDisplay(page, '#main');
      if (mainDisplay !== 'none') throw new Error(`#main 應仍為 display:none，實際為 ${mainDisplay}`);
      // 清空輸入框，準備下一步輸入正確密碼
      await page.evaluate(() => { document.querySelector('#login-secret').value = ''; });
    });

    // d. 正確密碼
    await check('正確密碼 → #main 顯示、登入層消失', async () => {
      await page.type('#login-secret', ADMIN_SECRET);
      await page.click('#login-form button[type="submit"]');
      await page.waitForFunction(() => {
        const main = document.querySelector('#main');
        return main && getComputedStyle(main).display !== 'none';
      }, { timeout: 10000 });
      const loginDisplay = await computedDisplay(page, '#login-overlay');
      if (loginDisplay !== 'none') throw new Error(`登入層應消失，實際 display=${loginDisplay}`);
    });

    // e. 總覽頁：至少 4 張 .card
    await check('總覽頁：10 秒內至少渲染 4 張 .card', async () => {
      await page.waitForFunction(
        () => document.querySelectorAll('#tab-overview .card').length >= 4,
        { timeout: 10000 },
      );
    });

    // f. 各頁籤點擊 → 對應 section 啟用且有內容
    const tabs = ['ga', 'fb', 'ads', 'custom'];
    for (const tab of tabs) {
      await check(`頁籤切換：${tab} 分頁啟用且有內容`, async () => {
        await page.click(`#tabs button[data-tab="${tab}"]`);
        await page.waitForFunction(
          t => document.querySelector(`#tab-${t}`)?.classList.contains('active'),
          { timeout: 5000 },
          tab,
        );
        await page.waitForFunction(
          t => {
            const sec = document.querySelector(`#tab-${t}`);
            if (!sec) return false;
            return sec.querySelectorAll('.card').length > 0 || sec.querySelector('#add-report-btn');
          },
          { timeout: 10000 },
          tab,
        );
      });
    }

    // 切回總覽，方便後續步驟
    await page.click('#tabs button[data-tab="overview"]');
    await page.waitForFunction(
      () => document.querySelector('#tab-overview')?.classList.contains('active'),
      { timeout: 5000 },
    );

    // g. 比較模式：勾選 → 第二次 /api/data 請求、出現 .kpi-delta；取消勾選 → delta 消失
    await check('比較模式：勾選觸發第二次請求並顯示 .kpi-delta；取消後消失', async () => {
      let dataRequestCount = 0;
      const onRequest = req => {
        if (req.url().includes('/api/data')) dataRequestCount += 1;
      };
      page.on('request', onRequest);
      try {
        const beforeCount = dataRequestCount;
        await page.click('#compare-on');
        // 比較模式預設 prev（前一期），勾選後會自動 load()
        await page.waitForFunction(
          () => document.querySelectorAll('#tab-overview .kpi-delta').length > 0,
          { timeout: 10000 },
        );
        const afterCount = dataRequestCount;
        if (afterCount <= beforeCount) {
          throw new Error(`勾選比較後未偵測到新的 /api/data 請求（before=${beforeCount}, after=${afterCount}）`);
        }
        const deltaCount = await page.$$eval('#tab-overview .kpi-delta', els => els.length);
        if (deltaCount < 1) throw new Error('勾選比較後找不到 .kpi-delta');

        // 取消勾選
        await page.click('#compare-on');
        await page.waitForFunction(
          () => document.querySelectorAll('#tab-overview .kpi-delta').length === 0,
          { timeout: 10000 },
        );
      } finally {
        page.off('request', onRequest);
      }
    });

    // h. 匯出彈窗
    await check('匯出彈窗：開啟顯示格式/欄位、取消後隱藏', async () => {
      const hasExportBtn = await page.$('#tab-overview .export-btn');
      if (!hasExportBtn) throw new Error('總覽頁找不到 .export-btn');
      await page.click('#tab-overview .export-btn');
      await page.waitForFunction(
        () => getComputedStyle(document.querySelector('#export-modal')).display !== 'none',
        { timeout: 5000 },
      );
      const formatCount = await page.$$eval('#export-formats input[type="radio"]', els => els.length);
      if (formatCount < 1) throw new Error('#export-formats 沒有找到格式選項');
      const fieldCount = await page.$$eval('#export-fields input[type="checkbox"]', els => els.length);
      if (fieldCount < 1) throw new Error('#export-fields 沒有找到欄位勾選框');
      await page.click('#export-cancel');
      await page.waitForFunction(
        () => getComputedStyle(document.querySelector('#export-modal')).display === 'none',
        { timeout: 5000 },
      );
    });

    // i. 報表彈窗（自訂報表頁）
    await check('報表彈窗：新增報表開啟/取消', async () => {
      await page.click('#tabs button[data-tab="custom"]');
      await page.waitForFunction(
        () => document.querySelector('#tab-custom')?.classList.contains('active'),
        { timeout: 5000 },
      );
      await page.waitForSelector('#add-report-btn', { timeout: 10000 });
      await page.click('#add-report-btn');
      await page.waitForFunction(
        () => getComputedStyle(document.querySelector('#report-modal')).display !== 'none',
        { timeout: 5000 },
      );
      await page.click('#report-cancel');
      await page.waitForFunction(
        () => getComputedStyle(document.querySelector('#report-modal')).display === 'none',
        { timeout: 5000 },
      );
    });

    // j. 圖表類型記憶（localStorage 持久化）
    await check('圖表類型記憶：切換長條後重新載入仍為 active', async () => {
      await page.click('#tabs button[data-tab="overview"]');
      await page.waitForFunction(
        () => document.querySelector('#tab-overview')?.classList.contains('active'),
        { timeout: 5000 },
      );
      await page.waitForSelector('#tab-overview .card .type-switch button', { timeout: 10000 });
      // 找第一張圖表卡的「長條」按鈕（依 TYPE_LABEL 文字比對）
      const clicked = await page.evaluate(() => {
        const card = document.querySelector('#tab-overview .card .type-switch');
        if (!card) return false;
        const btn = [...card.querySelectorAll('button')].find(b => b.textContent.trim() === '長條');
        if (!btn) return false;
        btn.click();
        return true;
      });
      if (!clicked) throw new Error('找不到第一張圖表卡的「長條」切換按鈕');
      await page.waitForFunction(() => {
        const card = document.querySelector('#tab-overview .card .type-switch');
        const btn = card && [...card.querySelectorAll('button')].find(b => b.textContent.trim() === '長條');
        return btn && btn.classList.contains('active');
      }, { timeout: 5000 });

      // 重新載入頁面：先前登入成功時 app.js 會把密碼存進 localStorage（traf_secret），
      // reload 後啟動流程會自動用它重新登入（見 app.js 檔尾），不一定會停在登入表單，
      // 所以要同時等「自動登入完成」或「登入表單仍在」兩種情況，再視情況手動登入。
      await page.goto(BASE_URL, { waitUntil: 'networkidle0' });
      await page.waitForFunction(() => {
        const main = document.querySelector('#main');
        const mainVisible = main && getComputedStyle(main).display !== 'none';
        const loginVisible = getComputedStyle(document.querySelector('#login-overlay')).display !== 'none';
        return mainVisible || loginVisible;
      }, { timeout: 10000 });
      const alreadyIn = await page.evaluate(() => {
        const main = document.querySelector('#main');
        return Boolean(main && getComputedStyle(main).display !== 'none');
      });
      if (!alreadyIn) {
        await page.waitForSelector('#login-secret', { timeout: 5000 });
        await page.type('#login-secret', ADMIN_SECRET);
        await page.click('#login-form button[type="submit"]');
      }
      await page.waitForFunction(() => {
        const main = document.querySelector('#main');
        return main && getComputedStyle(main).display !== 'none';
      }, { timeout: 10000 });
      await page.waitForFunction(
        () => document.querySelectorAll('#tab-overview .card').length >= 4,
        { timeout: 10000 },
      );
      const stillActive = await page.evaluate(() => {
        const card = document.querySelector('#tab-overview .card .type-switch');
        const btn = card && [...card.querySelectorAll('button')].find(b => b.textContent.trim() === '長條');
        return Boolean(btn && btn.classList.contains('active'));
      });
      if (!stillActive) throw new Error('重新載入並登入後，「長條」按鈕未保持 active（localStorage 記憶失效）');
    });

    // k. 全程零頁面錯誤
    await check('全程零頁面錯誤（pageerror）', async () => {
      if (pageErrors.length > 0) {
        throw new Error(`偵測到 ${pageErrors.length} 個 pageerror：${pageErrors.join(' | ')}`);
      }
    });
  } finally {
    if (browser) {
      try { await browser.close(); } catch (_) { /* ignore */ }
    }
    if (server && !server.killed) {
      server.kill();
      // 給子行程一點時間乾淨結束，避免殘留 port 佔用
      await sleep(300);
    }
    if (server && server._smokeLog && failures.length > 0) {
      const log = server._smokeLog();
      if (log.trim()) {
        console.log('\n--- server 輸出（供除錯參考）---');
        console.log(log.slice(-3000));
      }
    }
  }

  console.log('\n──────────');
  console.log(`共 ${results.length} 項檢查，通過 ${results.length - failures.length}，失敗 ${failures.length}`);
  if (failures.length > 0) {
    console.log('\n失敗項目：');
    failures.forEach(f => console.log(`  ${f}`));
    process.exit(1);
  }
  process.exit(0);
}

main().catch(err => {
  console.error('煙霧測試執行時發生未預期錯誤：', err);
  process.exit(1);
});

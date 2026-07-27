// scripts/smoke_browser.js — Puppeteer 瀏覽器煙霧測試小助理
//
// 啟動一份 server 子行程（PORT=3777），用 headless Chrome 走一輪關鍵使用者流程，
// 確認登入、左側選單（含粉專三分頁）、比較、匯出彈窗、報表彈窗、圖表類型記憶、
// 手機 RWD 漢堡選單等功能沒有壞掉。
// 特別針對「彈窗一載入就顯示」這類 CSS [hidden] 被 display:flex 蓋掉的回歸問題，
// 一律用「計算後樣式」（offsetParent / getComputedStyle().display）檢查可見性，
// 不能只看 hidden attribute 本身。
//
// 用法：npm run smoke

'use strict';

require('dotenv').config();

const net = require('net');
const path = require('path');
const { spawn } = require('child_process');
const puppeteer = require('puppeteer');

const PORT = 3777;
const BASE_URL = `http://localhost:${PORT}`;
const PROJECT_ROOT = path.join(__dirname, '..');
const HEALTH_TIMEOUT_MS = 30000;
const ADMIN_USERNAME = 'admin';
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

// 起跑前先確認測試用連接埠沒被占用（例如上一次執行沒清乾淨的 server 子行程），
// 否則 spawn 出來的 server 會 EADDRINUSE 掛掉，只看得到籠統的 /health 逾時訊息。
function assertPortFree(port) {
  return new Promise((resolve, reject) => {
    const probe = net.createServer();
    probe.once('error', err => {
      if (err.code === 'EADDRINUSE') {
        reject(new Error(`連接埠 ${port} 已被占用（可能是上次未清乾淨的 server），請先 kill 再重跑`));
      } else {
        reject(err);
      }
    });
    probe.once('listening', () => probe.close(resolve));
    probe.listen(port, '127.0.0.1');
  });
}

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

  // 起跑前先確認連接埠可用，占用時立即失敗並給出可行動的訊息，
  // 而不是讓子行程 EADDRINUSE 後空等 30 秒 /health 逾時。
  await assertPortFree(PORT);

  console.log(`啟動 server（PORT=${PORT}）…`);
  const server = spawnServer();
  let browser = null;
  const pageErrors = [];

  // server 子行程若在就緒前就掛掉（缺環境變數、資料庫連不上等），
  // 不要傻等 /health 逾時，直接以子行程輸出報錯。
  let serverExitedEarly = null;
  server.once('exit', (code, signal) => {
    serverExitedEarly = `server 子行程提前結束（code=${code}, signal=${signal}）`;
  });

  try {
    let healthSettled = false;
    // 子行程提前結束偵測：與 waitForHealth 賽跑；health 先完成時此輪詢會安靜收尾
    //（healthSettled 讓迴圈退出、附掛的 catch 吞掉輸家的 rejection，避免 unhandledRejection）。
    const earlyExitWatch = (async () => {
      while (serverExitedEarly === null && !healthSettled) await sleep(200);
      if (serverExitedEarly !== null && !healthSettled) throw new Error(serverExitedEarly);
    })();
    try {
      await Promise.race([waitForHealth(HEALTH_TIMEOUT_MS), earlyExitWatch]);
    } catch (err) {
      // /health 逾時或子行程提前結束時，子行程輸出是最有用的線索，
      // 必須在這裡就印出來（下方 finally 的輸出區塊只在有檢查失敗時才印，
      // 此路徑尚未累積任何失敗，走不到那裡）。
      // 同樣原樣轉印 server 輸出，仰賴 server.js 不落機密的原則（見 finally 區塊註解）。
      const log = server._smokeLog();
      if (log.trim()) {
        console.log('\n--- server 輸出（啟動失敗診斷）---');
        console.log(log.slice(-3000));
      }
      throw err;
    } finally {
      healthSettled = true;
      earlyExitWatch.catch(() => {});
    }
    server.removeAllListeners('exit');
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
      await page.type('#login-username', ADMIN_USERNAME);
      await page.type('#login-password', 'this-is-definitely-wrong-password');
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
      await page.evaluate(() => { document.querySelector('#login-password').value = ''; });
    });

    // d. 正確密碼
    await check('正確密碼 → #main 顯示、登入層消失', async () => {
      await page.type('#login-password', ADMIN_SECRET);
      await page.click('#login-form button[type="submit"]');
      await page.waitForFunction(() => {
        const main = document.querySelector('#main');
        return main && getComputedStyle(main).display !== 'none';
      }, { timeout: 10000 });
      const loginDisplay = await computedDisplay(page, '#login-overlay');
      if (loginDisplay !== 'none') throw new Error(`登入層應消失，實際 display=${loginDisplay}`);
    });

    // d2. 快照 admin 目前的個人化狀態（個人版面、主題色），供結尾清理步驟精準還原。
    // 不能盲目重置成出廠預設值：一旦 admin 之後真的自訂了版面或選了莫蘭迪主題色，
    // 每次 npm run smoke 都會把它洗掉，這支測試必須是非破壞性的。
    let snapshotMineCards = null;
    let snapshotThemePrimary = null;
    await check('快照：讀取 admin 目前的個人版面與主題色（供結尾精準還原）', async () => {
      const token = await page.evaluate(() => localStorage.getItem('traf_token'));
      if (!token) throw new Error('找不到 traf_token，無法快照現有狀態');

      const layoutRes = await page.evaluate(async (t) => {
        const r = await fetch('/api/layout?scope=mine', { headers: { Authorization: `Bearer ${t}` } });
        return { status: r.status, body: await r.json().catch(() => null) };
      }, token);
      if (layoutRes.status !== 200 || !layoutRes.body) {
        throw new Error(`GET /api/layout?scope=mine 快照失敗：status=${layoutRes.status}`);
      }
      snapshotMineCards = layoutRes.body.cards; // null（無個人版面）或卡片陣列

      const meRes = await page.evaluate(async (t) => {
        const r = await fetch('/api/me', { headers: { Authorization: `Bearer ${t}` } });
        return { status: r.status, body: await r.json().catch(() => null) };
      }, token);
      if (meRes.status !== 200 || !meRes.body) {
        throw new Error(`GET /api/me 快照失敗：status=${meRes.status}`);
      }
      snapshotThemePrimary = (meRes.body.prefs && meRes.body.prefs.theme && meRes.body.prefs.theme.primary) || null;
    });

    // e. 總覽頁：至少 4 張 .card
    await check('總覽頁：10 秒內至少渲染 4 張 .card', async () => {
      await page.waitForFunction(
        () => document.querySelectorAll('#page-overview .card').length >= 4,
        { timeout: 10000 },
      );
    });

    // 共用：點選單項 → 對應 #page-* 啟用且有內容
    async function assertPageRenders(pageKey) {
      await page.click(`.menu-item[data-page="${pageKey}"]`);
      await page.waitForFunction(
        p => document.querySelector(`#page-${p}`)?.classList.contains('active'),
        { timeout: 5000 },
        pageKey,
      );
      await page.waitForFunction(
        p => {
          const sec = document.querySelector(`#page-${p}`);
          if (!sec) return false;
          return sec.querySelectorAll('.card').length > 0 || sec.querySelector('#add-report-btn');
        },
        { timeout: 10000 },
        pageKey,
      );
    }

    // f. 選單直接項目點擊 → 對應 page 啟用且有內容
    for (const pageKey of ['ga', 'custom']) {
      await check(`選單切換：${pageKey} 頁啟用且有內容`, async () => {
        await assertPageRenders(pageKey);
      });
    }

    // f2. 粉專群組：預設收合，點父項展開子選單
    await check('粉專群組：點擊父項展開子選單', async () => {
      const subVisibleBefore = await isComputedVisible(page, '#menu-fb .menu-sub');
      if (subVisibleBefore) throw new Error('.menu-sub 應預設收合');
      await page.click('.menu-parent[data-group="fb"]');
      await page.waitForFunction(
        () => getComputedStyle(document.querySelector('#menu-fb .menu-sub')).display !== 'none',
        { timeout: 5000 },
      );
    });

    // f3. 粉專三個子頁：各自可點且渲染內容
    for (const pageKey of ['fb_insights', 'fb_posts', 'fb_ads']) {
      await check(`粉專子頁：${pageKey} 啟用且有內容`, async () => {
        await assertPageRenders(pageKey);
      });
    }

    // 切回總覽，方便後續步驟
    await page.click('.menu-item[data-page="overview"]');
    await page.waitForFunction(
      () => document.querySelector('#page-overview')?.classList.contains('active'),
      { timeout: 5000 },
    );

    // g. 比較模式：勾選 → 第二次 /api/data 請求、出現 .kpi-delta；取消勾選 → delta 消失
    await check('比較模式：勾選觸發第二次請求並顯示 .kpi-delta；取消後消失', async () => {
      // 請求計數的前提：/api/data 只會由前端明確的 load() 呼叫觸發（勾選比較、
      // 換日期區間等），app 沒有背景輪詢。若未來加入自動刷新/輪詢，
      // 這裡的 before/after 計數就可能被背景請求干擾，需改為比對請求參數。
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
          () => document.querySelectorAll('#page-overview .kpi-delta').length > 0,
          { timeout: 10000 },
        );
        const afterCount = dataRequestCount;
        if (afterCount <= beforeCount) {
          throw new Error(`勾選比較後未偵測到新的 /api/data 請求（before=${beforeCount}, after=${afterCount}）`);
        }
        const deltaCount = await page.$$eval('#page-overview .kpi-delta', els => els.length);
        if (deltaCount < 1) throw new Error('勾選比較後找不到 .kpi-delta');

        // 取消勾選
        await page.click('#compare-on');
        await page.waitForFunction(
          () => document.querySelectorAll('#page-overview .kpi-delta').length === 0,
          { timeout: 10000 },
        );
      } finally {
        page.off('request', onRequest);
      }
    });

    // h. 匯出彈窗
    await check('匯出彈窗：開啟顯示格式/欄位、取消後隱藏', async () => {
      const hasExportBtn = await page.$('#page-overview .export-btn');
      if (!hasExportBtn) throw new Error('總覽頁找不到 .export-btn');
      await page.click('#page-overview .export-btn');
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

    // h2. 總覽版面編輯（R3c-2）：進入個人編輯模式、勾掉一張卡、儲存 → 少一張卡；
    // 「恢復預設」→ 卡片數回到編輯前。admin 帳號本身就是這支煙霧測試的登入身分，
    // 最後必須把 'mine' 版面還原成本次執行前的快照狀態（見上方 d2 快照 / 下方清理步驟），
    // 不能無條件清空，否則會洗掉 admin 真正存好的個人化版面。
    await check('總覽版面編輯：勾掉一張卡並儲存後卡片數減少', async () => {
      const beforeCount = await page.$$eval('#overview-cards .card', els => els.length);
      if (beforeCount < 4) throw new Error(`編輯前卡片數異常：${beforeCount}`);

      const editBtnVisible = await isComputedVisible(page, '#edit-layout-btn');
      if (!editBtnVisible) throw new Error('#edit-layout-btn 未顯示');
      await page.click('#edit-layout-btn');
      await page.waitForFunction(
        () => getComputedStyle(document.querySelector('#layout-edit-modal')).display !== 'none',
        { timeout: 5000 },
      );
      const rowCount = await page.$$eval('#layout-edit-list .layout-edit-row', els => els.length);
      if (rowCount < 7) throw new Error(`卡片庫項目數異常：${rowCount}（預期至少 7 張內建卡）`);

      // 取消勾選第一列（目前生效順序的第一張卡）
      await page.evaluate(() => {
        const cb = document.querySelector('#layout-edit-list .layout-edit-row .layout-edit-cb');
        if (cb) { cb.checked = false; }
      });
      await page.click('#layout-edit-save');
      await page.waitForFunction(
        () => getComputedStyle(document.querySelector('#layout-edit-modal')).display === 'none',
        { timeout: 5000 },
      );
      await page.waitForFunction(
        (n) => document.querySelectorAll('#overview-cards .card').length === n,
        { timeout: 10000 },
        beforeCount - 1,
      );
      const afterCount = await page.$$eval('#overview-cards .card', els => els.length);
      if (afterCount !== beforeCount - 1) {
        throw new Error(`儲存後卡片數應為 ${beforeCount - 1}，實際 ${afterCount}`);
      }
    });

    await check('總覽版面編輯：恢復預設後卡片數回到編輯前', async () => {
      const beforeRestoreCount = await page.$$eval('#overview-cards .card', els => els.length);
      await page.click('#edit-layout-btn');
      await page.waitForFunction(
        () => getComputedStyle(document.querySelector('#layout-edit-modal')).display !== 'none',
        { timeout: 5000 },
      );
      await page.click('#layout-edit-restore');
      await page.waitForFunction(
        () => getComputedStyle(document.querySelector('#layout-edit-modal')).display === 'none',
        { timeout: 5000 },
      );
      await page.waitForFunction(
        (n) => document.querySelectorAll('#overview-cards .card').length > n,
        { timeout: 10000 },
        beforeRestoreCount,
      );
      const restoredCount = await page.$$eval('#overview-cards .card', els => els.length);
      if (restoredCount < 7) throw new Error(`恢復預設後卡片數異常：${restoredCount}（預期至少 7 張內建卡）`);
    });

    // 清理：把 admin 帳號的 'mine' 版面精準還原成本次執行「開始前」的快照狀態。
    // 快照為 null（本來就沒有個人版面）→ 沿用 DELETE，結果等價於還原成 null；
    // 快照有真實卡片陣列（admin 真的自訂過版面）→ 改用 PUT 寫回原始卡片，
    // 絕不能無條件 DELETE，否則會把 admin 事先存好的個人化版面洗掉。
    await check('清理：把 admin 個人版面還原成執行前的快照狀態', async () => {
      const token = await page.evaluate(() => localStorage.getItem('traf_token'));
      if (!token) throw new Error('找不到 traf_token，無法呼叫清理 API');

      if (snapshotMineCards === null) {
        const res = await page.evaluate(async (t) => {
          const r = await fetch('/api/layout/mine', { method: 'DELETE', headers: { Authorization: `Bearer ${t}` } });
          return { status: r.status, body: await r.json().catch(() => null) };
        }, token);
        if (res.status !== 200 || !res.body || res.body.ok !== true) {
          throw new Error(`DELETE /api/layout/mine 未回傳預期結果：status=${res.status}, body=${JSON.stringify(res.body)}`);
        }
      } else {
        const res = await page.evaluate(async (t, cards) => {
          const r = await fetch('/api/layout', {
            method: 'PUT',
            headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${t}` },
            body: JSON.stringify({ scope: 'mine', cards }),
          });
          return { status: r.status, body: await r.json().catch(() => null) };
        }, token, snapshotMineCards);
        if (res.status !== 200 || !res.body || !Array.isArray(res.body.cards)) {
          throw new Error(`PUT /api/layout 還原快照版面未回傳預期結果：status=${res.status}, body=${JSON.stringify(res.body)}`);
        }
      }
    });

    // i. 報表彈窗（自訂報表頁）
    await check('報表彈窗：新增報表開啟/取消', async () => {
      await page.click('.menu-item[data-page="custom"]');
      await page.waitForFunction(
        () => document.querySelector('#page-custom')?.classList.contains('active'),
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

    // i2. 帳號管理（admin 專屬）：選單項可見、點擊渲染表格、新增彈窗開關不送出
    await check('帳號管理：admin 可見選單項，點擊渲染表格', async () => {
      const usersMenuVisible = await isComputedVisible(page, '#menu-users');
      if (!usersMenuVisible) throw new Error('#menu-users 應對 admin 顯示');
      await page.click('#menu-users');
      await page.waitForFunction(
        () => document.querySelector('#page-users')?.classList.contains('active'),
        { timeout: 5000 },
      );
      await page.waitForFunction(
        () => document.querySelectorAll('#page-users table tbody tr').length > 0,
        { timeout: 10000 },
      );
    });

    await check('帳號管理：新增帳號彈窗開啟/取消（不送出）', async () => {
      await page.waitForSelector('#add-user-btn', { timeout: 5000 });
      await page.click('#add-user-btn');
      await page.waitForFunction(
        () => getComputedStyle(document.querySelector('#user-modal')).display !== 'none',
        { timeout: 5000 },
      );
      const pageCbCount = await page.$$eval('.user-page-cb', els => els.length);
      if (pageCbCount !== 6) throw new Error(`預期 6 個頁面權限勾選框，實際 ${pageCbCount}`);
      await page.click('#user-cancel');
      await page.waitForFunction(
        () => getComputedStyle(document.querySelector('#user-modal')).display === 'none',
        { timeout: 5000 },
      );
    });

    // i2b. 每日摘要（admin 專屬）：選單項可見、可渲染設定頁；測試發送對不合法 webhook 顯示失敗訊息
    // （刻意用假 webhook 觸發失敗路徑，不需要真的送到 Discord 就能驗證前端錯誤反饋接得到）
    await check('每日摘要：admin 選單可見並可渲染設定頁', async () => {
      const digestMenuVisible = await isComputedVisible(page, '#menu-digest');
      if (!digestMenuVisible) throw new Error('#menu-digest 應對 admin 顯示');
      await page.click('#menu-digest');
      await page.waitForFunction(
        () => document.querySelector('#page-digest')?.classList.contains('active'),
        { timeout: 5000 },
      );
      await page.waitForSelector('#digest-settings', { timeout: 5000 });
    });

    await check('每日摘要：測試發送對不合法 webhook 顯示失敗訊息', async () => {
      await page.evaluate(() => {
        document.querySelector('#digest-webhook').value = 'https://discord.com/api/webhooks/000/invalid';
      });
      // report 下拉若無任何報表選項則略過選擇：端點本身仍會因缺報表或 webhook 無效而回錯誤
      await page.click('#digest-test-btn');
      await page.waitForFunction(
        () => document.querySelector('#digest-error')?.textContent.length > 0,
        { timeout: 8000 },
      );
    });

    // i3. 設定→改密碼：群組展開、子選單可到達
    await check('設定群組：展開後可點擊到達改密碼頁', async () => {
      const subVisibleBefore = await isComputedVisible(page, '#menu-settings .menu-sub');
      if (subVisibleBefore) throw new Error('#menu-settings .menu-sub 應預設收合');
      await page.click('.menu-parent[data-group="settings"]');
      await page.waitForFunction(
        () => getComputedStyle(document.querySelector('#menu-settings .menu-sub')).display !== 'none',
        { timeout: 5000 },
      );
      await page.click('.menu-item[data-page="settings_password"]');
      await page.waitForFunction(
        () => document.querySelector('#page-settings_password')?.classList.contains('active'),
        { timeout: 5000 },
      );
      await page.waitForSelector('#settings-password-form', { timeout: 5000 });
    });

    // i3b. 設定→外觀主題：點色卡即時預覽、儲存後寫入帳號 prefs（重新整理＋重新登入後仍保留，
    // 證明不是只存在 localStorage 的預覽狀態），事後另有清理步驟精準還原成執行前的快照色
    let themeChosenHex = null;
    await check('外觀主題：點色卡即時預覽並儲存，重新整理＋重新登入後仍保留', async () => {
      await page.click('.menu-item[data-page="settings_theme"]');
      await page.waitForFunction(
        () => document.querySelector('#page-settings_theme')?.classList.contains('active'),
        { timeout: 5000 },
      );
      await page.waitForSelector('#theme-swatches .theme-swatch', { timeout: 5000 });

      const swatchCount = await page.$$eval('#theme-swatches .theme-swatch', els => els.length);
      if (swatchCount !== 10) throw new Error(`預期 10 個十色莫蘭迪色卡，實際 ${swatchCount}`);

      themeChosenHex = await page.evaluate(
        () => document.querySelector('#theme-swatches .theme-swatch')?.dataset.hex.toLowerCase() || null,
      );
      if (!themeChosenHex) throw new Error('找不到色卡按鈕的 data-hex');

      await page.click('#theme-swatches .theme-swatch');
      await page.waitForFunction(
        (hex) => getComputedStyle(document.documentElement).getPropertyValue('--c-primary').trim().toLowerCase() === hex,
        { timeout: 5000 },
        themeChosenHex,
      );

      await page.click('#theme-save-btn');
      await page.waitForFunction(
        () => document.querySelector('#settings-theme-success')?.textContent.trim() === '主題已儲存',
        { timeout: 5000 },
      );

      // 重新整理整頁（＋視情況重新登入）：驗證主題色來自 GET /api/me 的 prefs.theme，
      // 不是僅存在瀏覽器記憶體或 localStorage 的預覽狀態
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
        await page.waitForSelector('#login-username', { timeout: 5000 });
        await page.type('#login-username', ADMIN_USERNAME);
        await page.type('#login-password', ADMIN_SECRET);
        await page.click('#login-form button[type="submit"]');
      }
      await page.waitForFunction(() => {
        const main = document.querySelector('#main');
        return main && getComputedStyle(main).display !== 'none';
      }, { timeout: 10000 });

      const persistedHex = await page.evaluate(
        () => getComputedStyle(document.documentElement).getPropertyValue('--c-primary').trim().toLowerCase(),
      );
      if (persistedHex !== themeChosenHex) {
        throw new Error(`重新整理並登入後 --c-primary 未保留（非 localStorage 預覽）：預期 ${themeChosenHex}，實際 ${persistedHex}`);
      }
    });

    // 清理：把 admin 帳號的主題色精準還原成本次執行「開始前」的快照值。
    // 快照為 null（本來就沒存過主題色）→ 還原成 style.css 的 --c-primary 出廠值 #1565c0
    // （與唯一的 CSS 來源值一致，不另外新增第四份硬編碼）；
    // 快照有真實色碼（admin 真的選過莫蘭迪色）→ 寫回原始色碼，不能盲目改成 #1565c0。
    await check('清理：還原 admin 主題色為執行前的快照值', async () => {
      const token = await page.evaluate(() => localStorage.getItem('traf_token'));
      if (!token) throw new Error('找不到 traf_token，無法呼叫清理 API');
      const restorePrimary = snapshotThemePrimary || '#1565c0';
      const res = await page.evaluate(async (t, primary) => {
        const r = await fetch('/api/me/theme', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${t}` },
          body: JSON.stringify({ primary }),
        });
        return { status: r.status, body: await r.json().catch(() => null) };
      }, token, restorePrimary);
      if (res.status !== 200 || !res.body || res.body.ok !== true) {
        throw new Error(`POST /api/me/theme 還原快照未回傳預期結果：status=${res.status}, body=${JSON.stringify(res.body)}`);
      }
    });

    // 切回總覽，方便後續步驟
    await page.click('.menu-item[data-page="overview"]');
    await page.waitForFunction(
      () => document.querySelector('#page-overview')?.classList.contains('active'),
      { timeout: 5000 },
    );

    // j. 圖表類型記憶（localStorage 持久化）
    await check('圖表類型記憶：切換長條後重新載入仍為 active', async () => {
      await page.click('.menu-item[data-page="overview"]');
      await page.waitForFunction(
        () => document.querySelector('#page-overview')?.classList.contains('active'),
        { timeout: 5000 },
      );
      await page.waitForSelector('#page-overview .card .type-switch button', { timeout: 10000 });
      // 找第一張圖表卡的「長條」按鈕（依 TYPE_LABEL 文字比對）
      const clicked = await page.evaluate(() => {
        const card = document.querySelector('#page-overview .card .type-switch');
        if (!card) return false;
        const btn = [...card.querySelectorAll('button')].find(b => b.textContent.trim() === '長條');
        if (!btn) return false;
        btn.click();
        return true;
      });
      if (!clicked) throw new Error('找不到第一張圖表卡的「長條」切換按鈕');
      await page.waitForFunction(() => {
        const card = document.querySelector('#page-overview .card .type-switch');
        const btn = card && [...card.querySelectorAll('button')].find(b => b.textContent.trim() === '長條');
        return btn && btn.classList.contains('active');
      }, { timeout: 5000 });

      // 重新載入頁面：先前登入成功時 app.js 會把 token 存進 localStorage（traf_token），
      // reload 後啟動流程會呼叫 GET /api/me 驗證並自動還原登入狀態（見 app.js 檔尾），
      // 不一定會停在登入表單，所以要同時等「自動登入完成」或「登入表單仍在」兩種情況，
      // 再視情況手動登入。
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
        await page.waitForSelector('#login-username', { timeout: 5000 });
        await page.type('#login-username', ADMIN_USERNAME);
        await page.type('#login-password', ADMIN_SECRET);
        await page.click('#login-form button[type="submit"]');
      }
      await page.waitForFunction(() => {
        const main = document.querySelector('#main');
        return main && getComputedStyle(main).display !== 'none';
      }, { timeout: 10000 });
      await page.waitForFunction(
        () => document.querySelectorAll('#page-overview .card').length >= 4,
        { timeout: 10000 },
      );
      const stillActive = await page.evaluate(() => {
        const card = document.querySelector('#page-overview .card .type-switch');
        const btn = card && [...card.querySelectorAll('button')].find(b => b.textContent.trim() === '長條');
        return Boolean(btn && btn.classList.contains('active'));
      });
      if (!stillActive) throw new Error('重新載入並登入後，「長條」按鈕未保持 active（localStorage 記憶失效）');
    });

    // j1b. 同分頁內登出再登入（不 reload）：Sidebar.init 監聽器不得重複綁定
    // 回歸測試：#logout-btn 不會整頁重載，app.js 的 enter() 每次登入成功都會呼叫
    // Sidebar.init；若 sidebar.js 每次都重新 addEventListener，同分頁內第二次登入後
    // 粉專群組展開/收合這類 classList.toggle() 邏輯會被觸發兩次而互相抵銷，看起來像失靈。
    await check('同分頁登出再登入：粉專群組展開/收合仍正常（監聽器未重複綁定）', async () => {
      await page.click('#logout-btn');
      await page.waitForFunction(() => {
        const login = document.querySelector('#login-overlay');
        return login && getComputedStyle(login).display !== 'none';
      }, { timeout: 5000 });
      const mainHiddenAfterLogout = await computedDisplay(page, '#main');
      if (mainHiddenAfterLogout !== 'none') throw new Error(`登出後 #main 應為 display:none，實際為 ${mainHiddenAfterLogout}`);

      await page.waitForSelector('#login-username', { timeout: 5000 });
      await page.evaluate(() => {
        document.querySelector('#login-username').value = '';
        document.querySelector('#login-password').value = '';
      });
      await page.type('#login-username', ADMIN_USERNAME);
      await page.type('#login-password', ADMIN_SECRET);
      await page.click('#login-form button[type="submit"]');
      await page.waitForFunction(() => {
        const main = document.querySelector('#main');
        return main && getComputedStyle(main).display !== 'none';
      }, { timeout: 10000 });
      await page.waitForFunction(
        () => document.querySelectorAll('#page-overview .card').length >= 4,
        { timeout: 10000 },
      );

      // 粉專群組此時應為預設收合狀態（沒有 reload，但 setActivePage 只在點選單項時展開，
      // 重新登入本身不會展開它）
      const subVisibleBefore = await isComputedVisible(page, '#menu-fb .menu-sub');
      if (subVisibleBefore) throw new Error('重新登入後 .menu-sub 應仍為收合狀態');

      // 點父項展開：若監聽器被重複綁定 N 次，toggle 會被連續呼叫 N 次，
      // 偶數次會讓畫面停在「看起來沒展開」
      await page.click('.menu-parent[data-group="fb"]');
      await page.waitForFunction(
        () => getComputedStyle(document.querySelector('#menu-fb .menu-sub')).display !== 'none',
        { timeout: 5000 },
      );

      // 再點一次應收合
      await page.click('.menu-parent[data-group="fb"]');
      await page.waitForFunction(
        () => getComputedStyle(document.querySelector('#menu-fb .menu-sub')).display === 'none',
        { timeout: 5000 },
      );
    });

    // j2. RWD：手機視窗（375×800）漢堡選單存在且可展開/收合
    await check('RWD：375px 視窗漢堡選單可展開/收合', async () => {
      await page.setViewport({ width: 375, height: 800 });
      await sleep(300);
      const toggleVisible = await isComputedVisible(page, '#menu-toggle');
      if (!toggleVisible) throw new Error('#menu-toggle 未顯示');
      // 側欄手機版應預設收合（transform 移出畫面）
      const collapsed = await page.evaluate(() => {
        const sb = document.querySelector('#sidebar');
        return !sb.classList.contains('mobile-open') && sb.getBoundingClientRect().right <= 0;
      });
      if (!collapsed) throw new Error('#sidebar 手機版應預設收合在畫面外');
      await page.click('#menu-toggle');
      // mobile-open class 是同步加上的，但滑入動畫（transform transition 0.2s）還在跑，
      // 必須等側欄真的完全滑進畫面（left >= 0）再點選單項，否則點擊座標仍在畫面外。
      await page.waitForFunction(
        () => document.querySelector('#sidebar').classList.contains('mobile-open')
          && getComputedStyle(document.querySelector('#sidebar-overlay')).display !== 'none'
          && document.querySelector('#sidebar').getBoundingClientRect().left >= 0,
        { timeout: 5000 },
      );
      // 點選單項後選單自動收合、頁面切換成功
      await page.click('.menu-item[data-page="ga"]');
      await page.waitForFunction(
        () => !document.querySelector('#sidebar').classList.contains('mobile-open')
          && document.querySelector('#page-ga')?.classList.contains('active'),
        { timeout: 5000 },
      );
      // 還原桌面視窗與總覽頁
      await page.setViewport({ width: 1280, height: 900 });
      await sleep(300);
      await page.click('.menu-item[data-page="overview"]');
      await page.waitForFunction(
        () => document.querySelector('#page-overview')?.classList.contains('active'),
        { timeout: 5000 },
      );
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
    // 注意：這裡原樣轉印 server 子行程的 stdout/stderr，
    // 前提是 server.js 從不把密碼、token、request body 等機密寫進 log；
    // 若未來 server 端新增日誌，需維持這個不落機密的原則。
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

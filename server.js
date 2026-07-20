// KK 流量儀表板 — 每日自動抓取 GA4 / FB 粉專 / FB 廣告
const express = require('express');
const fs = require('fs');
const path = require('path');
const helmet = require('helmet');
const rateLimit = require('express-rate-limit');
const { pool } = require('./lib/db');

const app = express();
// Zeabur 反向代理之後：express-rate-limit 需以 X-Forwarded-For 判斷來源 IP，
// 而非代理本身的 socket IP，否則所有請求會被視為同一來源
app.set('trust proxy', 1);

app.use(helmet({
  strictTransportSecurity: { maxAge: 63072000, includeSubDomains: true, preload: true },
}));
app.use(express.json({ limit: '1mb' }));
app.use('/api', rateLimit({
  windowMs: 60 * 1000,
  max: 60,
  standardHeaders: true,
  legacyHeaders: false,
  message: { error: '請求過於頻繁，請稍後再試' },
}));

async function initDB() {
  const sql = fs.readFileSync(path.join(__dirname, 'schema.sql'), 'utf8');
  await pool.query(sql);
  console.log('資料庫初始化完成');

  // R3b-1 一次性遷移：round-1/2 的共用密碼 admin 列尚未有 username，
  // 補上帳號權限系統所需欄位（密碼 hash 不動，沿用原密碼）
  const migrated = await pool.query(`
    UPDATE traf_users SET
      username = 'admin',
      display_name = '管理員',
      role = 'admin',
      allowed_pages = '["overview","ga","fb_insights","fb_posts","fb_ads","custom"]'
    WHERE username IS NULL
  `);
  if (migrated.rowCount > 0) {
    console.log(`已遷移 ${migrated.rowCount} 筆既有帳號至新版 username/role 結構`);
  }

  // 首次啟動：建立預設管理員（僅在 traf_users 整表為空時觸發，遷移後不會是空）
  const { rows } = await pool.query('SELECT COUNT(*)::int AS n FROM traf_users');
  if (rows[0].n === 0) {
    const bcrypt = require('bcryptjs');
    const secret = process.env.INIT_ADMIN_SECRET;
    if (!secret) throw new Error('traf_users 為空且未設定 INIT_ADMIN_SECRET');
    const hash = await bcrypt.hash(secret, 10);
    await pool.query(
      'INSERT INTO traf_users (name, username, display_name, role, secret) VALUES ($1,$2,$3,$4,$5)',
      ['admin', 'admin', '管理員', 'admin', hash]);
    console.log('已建立預設管理員 admin');
  }
}

app.use(express.static(path.join(__dirname, 'public'), {
  setHeaders(res, filePath) {
    if (filePath.endsWith('.html')) res.setHeader('Cache-Control', 'no-cache');
  },
}));

app.get('/health', async (req, res) => {
  try {
    await pool.query('SELECT 1');
    res.json({ ok: true, time: new Date().toISOString() });
  } catch (err) {
    res.status(500).json({ ok: false });
  }
});

const { findUserByCreds, createSession, destroySession, getToken,
  requireAuth, requireAdmin } = require('./lib/auth');
const { runAll, scheduleDaily, backfill } = require('./jobs/daily');
const XLSX = require('xlsx');
const { validateExportPayload, validateReportConfig } = require('./lib/validators');

const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;

// /api/data 回應 key → 需要哪些頁面權限之一才能看到（聯集判斷，非單一頁面歸屬）。
// overview 是彙總頁，會直接消費 ga_daily/fb_page_daily/ads_daily 三個原始 key
// （見 public/js/app.js renderOverview()），故這三個 key 除了各自的細節頁，
// 也要在使用者僅有 overview 權限時保留，否則前端 .map() 在 undefined 上會直接壞掉。
const DATA_KEY_PAGES = {
  ga_daily: ['overview', 'ga'],
  ga_channels: ['ga'],
  ga_pages: ['ga'],
  ga_events: ['ga'],
  fb_page_daily: ['overview', 'fb_insights'],
  fb_posts: ['fb_posts'],
  ads_daily: ['overview', 'fb_ads'],
  // fetch_status：全站共用的抓取健康度 meta，不綁定任何單一頁面，一律保留
};

const loginLimiter = rateLimit({
  windowMs: 60 * 1000, max: 10,
  standardHeaders: true, legacyHeaders: false,
  message: { error: '登入嘗試過於頻繁，請稍後再試' },
});

// 登入改帳密（取代 round-1 的明文密碼比對）
app.post('/api/login', loginLimiter, async (req, res) => {
  const { username, password } = req.body || {};
  const user = await findUserByCreds(String(username || ''), String(password || ''));
  if (!user) return res.status(401).json({ error: '帳號或密碼錯誤' });
  const token = await createSession(user.id);
  res.json({ ok: true, token, username: user.username, display_name: user.display_name,
    role: user.role, allowed_pages: user.allowed_pages, prefs: user.prefs });
});

// 用 token 驗證目前登入狀態（前端啟動時呼叫，取代 round-1 對 /api/login 重放密碼）
app.get('/api/me', requireAuth, (req, res) => {
  const u = req.user;
  res.json({ username: u.username, display_name: u.display_name, role: u.role,
    allowed_pages: u.allowed_pages, prefs: u.prefs });
});

app.post('/api/logout', requireAuth, async (req, res) => {
  await destroySession(getToken(req));
  res.json({ ok: true });
});

// 使用者自助改密碼
app.post('/api/me/password', requireAuth, async (req, res) => {
  const { oldPassword, newPassword } = req.body || {};
  if (typeof newPassword !== 'string' || newPassword.length < 6)
    return res.status(400).json({ error: '新密碼至少 6 字元' });
  const bcrypt = require('bcryptjs');
  const ok = await bcrypt.compare(String(oldPassword || ''), req.user.secret);
  if (!ok) return res.status(401).json({ error: '目前密碼不正確' });
  const hash = await bcrypt.hash(newPassword, 10);
  await pool.query('UPDATE traf_users SET secret = $1 WHERE id = $2', [hash, req.user.id]);
  res.json({ ok: true });
});

// 儀表板資料：一次回傳指定區間的全部數據
app.get('/api/data', requireAuth, async (req, res) => {
  const { from, to } = req.query;
  if (!DATE_RE.test(from || '') || !DATE_RE.test(to || '')) {
    return res.status(400).json({ error: '需要 from/to（YYYY-MM-DD）' });
  }
  try {
    const [gaDaily, gaChannels, gaPages, gaEvents, fbDaily, fbPosts, adsDaily, fetchStatus] =
      await Promise.all([
        pool.query('SELECT * FROM traf_ga_daily WHERE date BETWEEN $1 AND $2 ORDER BY date', [from, to]),
        pool.query('SELECT * FROM traf_ga_channels WHERE date BETWEEN $1 AND $2 ORDER BY date', [from, to]),
        pool.query(
          `SELECT page_path, SUM(views)::int AS views, SUM(users)::int AS users
             FROM traf_ga_pages WHERE date BETWEEN $1 AND $2
            GROUP BY page_path ORDER BY views DESC LIMIT 20`, [from, to]),
        pool.query(
          `SELECT event_name, SUM(count)::int AS count
             FROM traf_ga_events WHERE date BETWEEN $1 AND $2
            GROUP BY event_name ORDER BY count DESC`, [from, to]),
        pool.query('SELECT * FROM traf_fb_page_daily WHERE date BETWEEN $1 AND $2 ORDER BY date', [from, to]),
        (DATE_RE.test(req.query.posts_from || '') && DATE_RE.test(req.query.posts_to || ''))
          ? pool.query(
              `SELECT * FROM traf_fb_posts
                WHERE (created_at AT TIME ZONE 'Asia/Taipei')::date BETWEEN $1 AND $2
                ORDER BY created_at DESC LIMIT 100`,
              [req.query.posts_from, req.query.posts_to])
          : pool.query('SELECT * FROM traf_fb_posts ORDER BY created_at DESC LIMIT 20'),
        pool.query('SELECT * FROM traf_ads_daily WHERE date BETWEEN $1 AND $2 ORDER BY date', [from, to]),
        pool.query(
          `SELECT DISTINCT ON (source) source, fetched_at, status, error
             FROM traf_fetch_log ORDER BY source, id DESC`),
      ]);
    const full = {
      ga_daily: gaDaily.rows,
      ga_channels: gaChannels.rows,
      ga_pages: gaPages.rows,
      ga_events: gaEvents.rows,
      fb_page_daily: fbDaily.rows,
      fb_posts: fbPosts.rows,
      ads_daily: adsDaily.rows,
      fetch_status: fetchStatus.rows,
    };
    const allowed = req.user.allowed_pages || [];
    // 依頁面權限過濾回應：key 只要使用者擁有 DATA_KEY_PAGES 對照的任一頁面權限即保留
    // （聯集判斷，例如 ga_daily 同時服務 overview 與 ga 兩個頁面）
    for (const [key, pages] of Object.entries(DATA_KEY_PAGES)) {
      if (!pages.some(p => allowed.includes(p))) {
        delete full[key];
      }
    }
    res.json(full);
  } catch (err) {
    console.error('[api/data]', err);
    res.status(500).json({ error: '伺服器錯誤' });
  }
});

// 匯出 Excel：前端組好表頭與列，後端只負責產檔
app.post('/api/export', requireAuth, (req, res) => {
  const v = validateExportPayload(req.body);
  if (!v.ok) return res.status(400).json({ error: v.error });
  try {
    const safeName = String(req.body.filename).replace(/[^\w一-鿿-]/g, '_').slice(0, 60) || 'export';
    const ws = XLSX.utils.aoa_to_sheet([req.body.headers, ...req.body.rows]);
    const wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, ws, 'data');
    const buf = XLSX.write(wb, { type: 'buffer', bookType: 'xlsx' });
    res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
    res.setHeader('Content-Disposition', `attachment; filename*=UTF-8''${encodeURIComponent(safeName)}.xlsx`);
    res.send(buf);
  } catch (err) {
    console.error('[api/export]', err);
    res.status(500).json({ error: '匯出失敗' });
  }
});

function validReportName(name) {
  return typeof name === 'string' && name.trim().length >= 1 && name.trim().length <= 50;
}

app.get('/api/reports', requireAuth, async (req, res) => {
  if (!(req.user.allowed_pages || []).includes('custom')) {
    return res.status(403).json({ error: '無此頁面權限' });
  }
  try {
    const { rows } = await pool.query('SELECT * FROM traf_reports ORDER BY id');
    res.json({ reports: rows });
  } catch (err) { console.error('[api/reports]', err); res.status(500).json({ error: '伺服器錯誤' }); }
});

app.post('/api/reports', requireAuth, requireAdmin, async (req, res) => {
  const { name, config } = req.body || {};
  if (!validReportName(name)) return res.status(400).json({ error: '名稱需為 1–50 字' });
  const v = validateReportConfig(config);
  if (!v.ok) return res.status(400).json({ error: v.error });
  try {
    const { rows } = await pool.query(
      'INSERT INTO traf_reports (name, config) VALUES ($1, $2) RETURNING *',
      [name.trim(), JSON.stringify(config)]);
    res.json({ report: rows[0] });
  } catch (err) { console.error('[api/reports]', err); res.status(500).json({ error: '伺服器錯誤' }); }
});

app.put('/api/reports/:id', requireAuth, requireAdmin, async (req, res) => {
  const id = Number(req.params.id);
  if (!Number.isInteger(id)) return res.status(400).json({ error: 'id 不合法' });
  const { name, config } = req.body || {};
  if (!validReportName(name)) return res.status(400).json({ error: '名稱需為 1–50 字' });
  const v = validateReportConfig(config);
  if (!v.ok) return res.status(400).json({ error: v.error });
  try {
    const { rows } = await pool.query(
      'UPDATE traf_reports SET name=$1, config=$2, updated_at=now() WHERE id=$3 RETURNING *',
      [name.trim(), JSON.stringify(config), id]);
    if (!rows[0]) return res.status(404).json({ error: '報表不存在' });
    res.json({ report: rows[0] });
  } catch (err) { console.error('[api/reports]', err); res.status(500).json({ error: '伺服器錯誤' }); }
});

app.delete('/api/reports/:id', requireAuth, requireAdmin, async (req, res) => {
  const id = Number(req.params.id);
  if (!Number.isInteger(id)) return res.status(400).json({ error: 'id 不合法' });
  try {
    await pool.query('DELETE FROM traf_reports WHERE id=$1', [id]);
    res.json({ ok: true });
  } catch (err) { console.error('[api/reports]', err); res.status(500).json({ error: '伺服器錯誤' }); }
});

// 手動重抓（無 body 時各源用自己的預設窗；可帶 {from, to} 指定區間）
// Express 4 不會自動處理 async handler 的 rejection，須自行 try/catch
app.post('/api/refetch', requireAuth, requireAdmin, async (req, res) => {
  try {
    if (req.body?.from && req.body?.to) {
      if (!DATE_RE.test(req.body.from) || !DATE_RE.test(req.body.to)) {
        return res.status(400).json({ error: '日期格式須為 YYYY-MM-DD' });
      }
      res.json(await runAll(pool, req.body.from, req.body.to));
    } else {
      res.json(await runAll(pool));
    }
  } catch (err) {
    if (err?.message === '抓取已在執行中，請稍後再試') {
      return res.status(409).json({ error: err.message });
    }
    res.status(500).json({ error: err?.message || String(err) });
  }
});

// 一次性歷史回補（上線時執行一次；重複執行只是重複 UPSERT，無害但耗時）
app.post('/api/backfill', requireAuth, requireAdmin, async (req, res) => {
  try {
    res.json(await backfill(pool));
  } catch (err) {
    if (err?.message === '抓取已在執行中，請稍後再試') {
      return res.status(409).json({ error: err.message });
    }
    res.status(500).json({ error: err?.message || String(err) });
  }
});

const PORT = process.env.PORT || 3000;
initDB()
  .then(() => {
    scheduleDaily(pool);
    app.listen(PORT, () => console.log(`listening on ${PORT}`));
  })
  .catch(err => { console.error('初始化失敗', err); process.exit(1); });

module.exports = { app };

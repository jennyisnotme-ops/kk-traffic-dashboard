// KK 流量儀表板 — 每日自動抓取 GA4 / FB 粉專 / FB 廣告
const express = require('express');
const fs = require('fs');
const path = require('path');
const helmet = require('helmet');
const rateLimit = require('express-rate-limit');
const { pool } = require('./lib/db');

const app = express();

app.use(helmet({
  contentSecurityPolicy: false,   // 前端 inline JS
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

  // 首次啟動：建立預設管理員
  const { rows } = await pool.query('SELECT COUNT(*)::int AS n FROM traf_users');
  if (rows[0].n === 0) {
    const bcrypt = require('bcryptjs');
    const secret = process.env.INIT_ADMIN_SECRET;
    if (!secret) throw new Error('traf_users 為空且未設定 INIT_ADMIN_SECRET');
    const hash = await bcrypt.hash(secret, 10);
    await pool.query('INSERT INTO traf_users (name, secret) VALUES ($1,$2)', ['admin', hash]);
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
    res.status(500).json({ ok: false, error: err.message });
  }
});

const { requireAuth, findUser, getSecret } = require('./lib/auth');
const { runAll, scheduleDaily, backfill, defaultRange } = require('./jobs/daily');

// 登入驗證：前端用來確認密碼正確，之後每個請求都帶同一個 Bearer secret
app.post('/api/login', async (req, res) => {
  const user = await findUser(String(req.body?.secret || ''));
  if (!user) return res.status(401).json({ error: '密碼錯誤' });
  res.json({ ok: true, name: user.name });
});

// 儀表板資料：一次回傳指定區間的全部數據
app.get('/api/data', requireAuth, async (req, res) => {
  const { from, to } = req.query;
  if (!/^\d{4}-\d{2}-\d{2}$/.test(from || '') || !/^\d{4}-\d{2}-\d{2}$/.test(to || '')) {
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
        pool.query('SELECT * FROM traf_fb_posts ORDER BY created_at DESC LIMIT 20'),
        pool.query('SELECT * FROM traf_ads_daily WHERE date BETWEEN $1 AND $2 ORDER BY date', [from, to]),
        pool.query(
          `SELECT DISTINCT ON (source) source, fetched_at, status, error
             FROM traf_fetch_log ORDER BY source, id DESC`),
      ]);
    res.json({
      ga_daily: gaDaily.rows,
      ga_channels: gaChannels.rows,
      ga_pages: gaPages.rows,
      ga_events: gaEvents.rows,
      fb_page_daily: fbDaily.rows,
      fb_posts: fbPosts.rows,
      ads_daily: adsDaily.rows,
      fetch_status: fetchStatus.rows,
    });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// 手動重抓（預設 D-3 ~ D-1；可帶 {from, to} 指定區間）
// Express 4 不會自動處理 async handler 的 rejection，須自行 try/catch
app.post('/api/refetch', requireAuth, async (req, res) => {
  try {
    const range = (req.body?.from && req.body?.to)
      ? { from: req.body.from, to: req.body.to }
      : defaultRange();
    if (!/^\d{4}-\d{2}-\d{2}$/.test(range.from) || !/^\d{4}-\d{2}-\d{2}$/.test(range.to)) {
      return res.status(400).json({ error: '日期格式須為 YYYY-MM-DD' });
    }
    res.json(await runAll(pool, range.from, range.to));
  } catch (err) {
    res.status(500).json({ error: err?.message || String(err) });
  }
});

// 一次性歷史回補（上線時執行一次；重複執行只是重複 UPSERT，無害但耗時）
app.post('/api/backfill', requireAuth, async (req, res) => {
  try {
    res.json(await backfill(pool));
  } catch (err) {
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

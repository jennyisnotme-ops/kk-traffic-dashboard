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

// 登入驗證：前端用來確認密碼正確，之後每個請求都帶同一個 Bearer secret
app.post('/api/login', async (req, res) => {
  const user = await findUser(String(req.body?.secret || ''));
  if (!user) return res.status(401).json({ error: '密碼錯誤' });
  res.json({ ok: true, name: user.name });
});

const PORT = process.env.PORT || 3000;
initDB()
  .then(() => app.listen(PORT, () => console.log(`listening on ${PORT}`)))
  .catch(err => { console.error('初始化失敗', err); process.exit(1); });

module.exports = { app };

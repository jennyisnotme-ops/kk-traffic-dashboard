// lib/auth.js — 沿用 kkdash 認證模式：Authorization: Bearer <明文密碼> 比對 bcrypt hash
const bcrypt = require('bcryptjs');
const { pool } = require('./db');

function getSecret(req) {
  const raw = req.headers.authorization || '';
  return raw.replace(/^Bearer\s+/i, '').trim();
}

async function findUser(secret) {
  if (!secret) return null;
  const { rows } = await pool.query('SELECT * FROM traf_users');
  for (const u of rows) {
    try {
      if (await bcrypt.compare(secret, u.secret)) return u;
    } catch (_) { /* hash 格式錯誤就跳過 */ }
  }
  return null;
}

async function requireAuth(req, res, next) {
  const user = await findUser(getSecret(req));
  if (!user) return res.status(401).json({ error: '未登入或密碼錯誤' });
  req.user = user;
  next();
}

module.exports = { getSecret, findUser, requireAuth };

// lib/auth.js — 帳密登入 + session token 認證
const bcrypt = require('bcryptjs');
const crypto = require('crypto');
const { pool } = require('./db');

const SESSION_DAYS = 30;

async function findUserByCreds(username, password) {
  if (!username || !password) return null;
  const { rows } = await pool.query(
    'SELECT * FROM traf_users WHERE username = $1 AND enabled = true', [username]);
  const u = rows[0];
  if (!u) return null;
  const ok = await bcrypt.compare(password, u.secret);
  return ok ? u : null;
}

async function createSession(userId) {
  const token = crypto.randomBytes(32).toString('hex');
  const expires = new Date(Date.now() + SESSION_DAYS * 86400000);
  await pool.query(
    'INSERT INTO traf_sessions (token, user_id, expires_at) VALUES ($1,$2,$3)',
    [token, userId, expires]);
  return token;
}

async function destroySession(token) {
  await pool.query('DELETE FROM traf_sessions WHERE token = $1', [token]);
}

function getToken(req) {
  const raw = req.headers.authorization || '';
  return raw.replace(/^Bearer\s+/i, '').trim();
}

// 驗證 token：存在、未過期、對應使用者 enabled；通過則滑動延長 expires_at 並回傳 user
async function findUserByToken(token) {
  if (!token) return null;
  const { rows } = await pool.query(
    `SELECT u.* FROM traf_sessions s JOIN traf_users u ON u.id = s.user_id
      WHERE s.token = $1 AND s.expires_at > now() AND u.enabled = true`, [token]);
  const u = rows[0];
  if (!u) return null;
  const newExpires = new Date(Date.now() + SESSION_DAYS * 86400000);
  pool.query('UPDATE traf_sessions SET last_seen = now(), expires_at = $1 WHERE token = $2',
    [newExpires, token]).catch(e => console.error('[session touch]', e.message));
  return u;
}

async function requireAuth(req, res, next) {
  const user = await findUserByToken(getToken(req));
  if (!user) return res.status(401).json({ error: '未登入或登入已過期' });
  req.user = user;
  next();
}

function requireAdmin(req, res, next) {
  if (req.user?.role !== 'admin') return res.status(403).json({ error: '需要管理員權限' });
  next();
}

module.exports = { findUserByCreds, createSession, destroySession, getToken,
  findUserByToken, requireAuth, requireAdmin };

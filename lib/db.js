// lib/db.js — pg Pool 單例
require('dotenv').config();
const { Pool, types } = require('pg');

types.setTypeParser(1082, v => v);   // DATE 欄位以 'YYYY-MM-DD' 字串回傳，避免時區偏移

const pool = new Pool({ connectionString: process.env.DATABASE_URL });

module.exports = { pool };

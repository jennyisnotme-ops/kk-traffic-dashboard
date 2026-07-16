// lib/validators.js — API payload 驗證（純函式）
function validateExportPayload(p) {
  if (!p || typeof p !== 'object') return { ok: false, error: 'payload 必須是物件' };
  if (typeof p.filename !== 'string' || !p.filename.trim()) return { ok: false, error: 'filename 必填' };
  if (!Array.isArray(p.headers) || p.headers.length < 1 || p.headers.length > 50)
    return { ok: false, error: 'headers 需為 1–50 個字串' };
  if (p.headers.some(h => typeof h !== 'string')) return { ok: false, error: 'headers 需為字串' };
  if (!Array.isArray(p.rows) || p.rows.length > 10000) return { ok: false, error: 'rows 需為陣列且至多 10000 列' };
  if (p.rows.some(r => !Array.isArray(r))) return { ok: false, error: '每一列需為陣列' };
  return { ok: true };
}

module.exports = { validateExportPayload };

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

const REPORT_TYPES = ['line', 'smooth', 'bar', 'pie'];
const REPORT_FIELDS = {
  ga_daily: ['users', 'sessions', 'pageviews', 'engagement_rate'],
  ga_channels: ['sessions', 'users'],
  fb_page_daily: ['reach', 'engagement', 'fans_total', 'fans_change'],
  ads_daily: ['spend', 'impressions', 'clicks', 'conversions'],
};

function validateReportConfig(cfg) {
  if (!cfg || typeof cfg !== 'object') return { ok: false, error: 'config 必須是物件' };
  if (!REPORT_TYPES.includes(cfg.type)) return { ok: false, error: 'type 不合法' };
  if (!Array.isArray(cfg.metrics) || cfg.metrics.length < 1 || cfg.metrics.length > 6)
    return { ok: false, error: 'metrics 需為 1–6 個' };
  for (const m of cfg.metrics) {
    if (!m || typeof m !== 'object') return { ok: false, error: 'metric 必須是物件' };
    if (!REPORT_FIELDS[m.source]?.includes(m.field)) return { ok: false, error: `不支援的指標 ${m.source}.${m.field}` };
    if (m.source === 'ga_channels' && (typeof m.channel !== 'string' || !m.channel || m.channel.length > 100))
      return { ok: false, error: 'ga_channels 指標必須指定 channel' };
    if (m.campaign_id !== undefined && (typeof m.campaign_id !== 'string' || m.campaign_id.length > 50))
      return { ok: false, error: 'campaign_id 不合法' };
    if (m.label !== undefined && (typeof m.label !== 'string' || m.label.length > 50))
      return { ok: false, error: 'label 需為 50 字內字串' };
  }
  return { ok: true };
}

const ALL_PAGES = ['overview', 'ga', 'fb_insights', 'fb_posts', 'fb_ads', 'custom'];

function validateNewUser(p) {
  if (!p || typeof p !== 'object') return { ok: false, error: 'payload 必須是物件' };
  if (typeof p.username !== 'string' || !/^[a-zA-Z0-9_.-]{3,30}$/.test(p.username))
    return { ok: false, error: 'username 需為 3-30 字元（英數._-）' };
  if (typeof p.password !== 'string' || p.password.length < 6)
    return { ok: false, error: '密碼至少 6 字元' };
  if (typeof p.display_name !== 'string' || !p.display_name.trim() || p.display_name.length > 50)
    return { ok: false, error: 'display_name 需為 1-50 字' };
  if (!['admin', 'user'].includes(p.role)) return { ok: false, error: 'role 不合法' };
  if (!Array.isArray(p.allowed_pages) || p.allowed_pages.some(k => !ALL_PAGES.includes(k)))
    return { ok: false, error: 'allowed_pages 不合法' };
  return { ok: true };
}

module.exports = { validateExportPayload, validateReportConfig, REPORT_FIELDS, ALL_PAGES, validateNewUser };

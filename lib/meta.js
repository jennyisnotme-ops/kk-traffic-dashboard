// lib/meta.js — Meta Graph API 共用 helper
const GRAPH = 'https://graph.facebook.com/v23.0';

async function fbGet(path, params = {}, token = process.env.META_ACCESS_TOKEN) {
  const url = new URL(`${GRAPH}/${path}`);
  url.searchParams.set('access_token', token);
  for (const [k, v] of Object.entries(params)) url.searchParams.set(k, String(v));
  const res = await fetch(url);
  if (!res.ok && res.headers.get('content-type')?.includes('json') !== true) {
    throw new Error(`Graph API ${path}: HTTP ${res.status}`);
  }
  let json;
  try { json = await res.json(); }
  catch (_) { throw new Error(`Graph API ${path}: 非 JSON 回應（HTTP ${res.status}）`); }
  if (json.error) throw new Error(`Graph API ${path}: ${json.error.message}`);
  return json;
}

// 粉專 insights/posts 端點要求 Page Access Token（系統使用者 token 直接呼叫會回 #190），
// 用系統使用者 token 即時換取 page token，模組層級快取（同一 process 不重複換取）
let _pageToken = null;
async function getPageToken() {
  if (!_pageToken) {
    const json = await fbGet(`${process.env.META_PAGE_ID}?fields=access_token`);
    // 只快取有效值：沒拿到 access_token 就拋錯（不快取 falsy），下次呼叫會重新換取
    if (!json.access_token) throw new Error('Graph API: page token exchange 未回傳 access_token');
    _pageToken = json.access_token;
  }
  return _pageToken;
}

// 粉專 insights 的 end_time 是「期間結束的隔天早上」（太平洋時區），
// 它代表的日曆日要減一天
function insightDate(endTime) {
  const d = new Date(endTime);
  d.setUTCDate(d.getUTCDate() - 1);
  return d.toISOString().slice(0, 10);
}

module.exports = { fbGet, insightDate, GRAPH, getPageToken };

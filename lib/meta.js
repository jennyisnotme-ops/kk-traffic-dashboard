// lib/meta.js — Meta Graph API 共用 helper
const GRAPH = 'https://graph.facebook.com/v23.0';

async function fbGet(path, params = {}) {
  const url = new URL(`${GRAPH}/${path}`);
  url.searchParams.set('access_token', process.env.META_ACCESS_TOKEN);
  for (const [k, v] of Object.entries(params)) url.searchParams.set(k, String(v));
  const res = await fetch(url);
  const json = await res.json();
  if (json.error) throw new Error(`Graph API ${path}: ${json.error.message}`);
  return json;
}

// 粉專 insights 的 end_time 是「期間結束的隔天早上」（太平洋時區），
// 它代表的日曆日要減一天
function insightDate(endTime) {
  const d = new Date(endTime);
  d.setUTCDate(d.getUTCDate() - 1);
  return d.toISOString().slice(0, 10);
}

module.exports = { fbGet, insightDate, GRAPH };

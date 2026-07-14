// fetchers/ads.js — Marketing API 廣告成效（campaign × 日）→ traf_ads_daily
const { fbGet } = require('../lib/meta');

// 轉換數：電商優先 omni_purchase → purchase → lead；raw actions 另存 JSONB 供日後改定義
const CONVERSION_PRIORITY = ['omni_purchase', 'purchase', 'lead'];
function extractConversions(actions) {
  if (!Array.isArray(actions)) return 0;
  for (const type of CONVERSION_PRIORITY) {
    const hit = actions.find(a => a.action_type === type);
    if (hit) return Number(hit.value) || 0;
  }
  return 0;
}

function insightRowsToRows(data) {
  return (data || []).map(r => ({
    date: r.date_start,
    campaign_id: r.campaign_id,
    campaign_name: r.campaign_name || '',
    spend: Number(r.spend) || 0,
    impressions: Number(r.impressions) || 0,
    clicks: Number(r.clicks) || 0,
    conversions: extractConversions(r.actions),
    actions: r.actions || [],
  }));
}

async function fetchAds(pool, from, to) {
  let json = await fbGet(`${process.env.META_AD_ACCOUNT_ID}/insights`, {
    level: 'campaign',
    fields: 'campaign_id,campaign_name,spend,impressions,clicks,actions',
    time_range: JSON.stringify({ since: from, until: to }),
    time_increment: 1,
    limit: 500,
  });

  const MAX_PAGES = 100; // 防呆：避免 paging.next 異常時無限迴圈
  let count = 0;
  let pages = 0;
  while (true) {
    for (const r of insightRowsToRows(json.data)) {
      await pool.query(
        `INSERT INTO traf_ads_daily
           (date, campaign_id, campaign_name, spend, impressions, clicks, conversions, actions)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8)
         ON CONFLICT (date, campaign_id) DO UPDATE
           SET campaign_name=$3, spend=$4, impressions=$5, clicks=$6, conversions=$7, actions=$8`,
        [r.date, r.campaign_id, r.campaign_name, r.spend,
         r.impressions, r.clicks, r.conversions, JSON.stringify(r.actions)]);
      count++;
    }
    const next = json.paging?.next;
    if (!next) break;
    if (++pages > MAX_PAGES) throw new Error('Graph API paging: 超過最大分頁數');
    // 注意：next URL 含 access_token，錯誤訊息一律不可帶入 URL
    const res = await fetch(next);              // next 已含 token 與所有參數
    if (!res.ok) throw new Error(`Graph API paging: HTTP ${res.status}`);
    try {
      json = await res.json();
    } catch (_) {
      throw new Error('Graph API paging: 非 JSON 回應');
    }
    if (json.error) throw new Error(`Graph API paging: ${json.error.message}`);
  }
  return { rows: count };
}

module.exports = { fetchAds, extractConversions, insightRowsToRows };

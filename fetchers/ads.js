// fetchers/ads.js — Marketing API 廣告成效（campaign × 日）→ traf_ads_daily
const { fbGet, GRAPH } = require('../lib/meta');

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

  let count = 0;
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
    const res = await fetch(next);              // next 已含 token 與所有參數
    json = await res.json();
    if (json.error) throw new Error(`Graph API paging: ${json.error.message}`);
  }
  return { rows: count };
}

module.exports = { fetchAds, extractConversions, insightRowsToRows };

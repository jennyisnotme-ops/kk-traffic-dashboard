// fetchers/fb_page.js — 粉專每日成效 + 近期貼文 → traf_fb_*
const { fbGet, insightDate } = require('../lib/meta');
const { addDays } = require('../lib/dates');

const METRIC_MAP = {
  page_impressions_unique: 'reach',
  page_post_engagements: 'engagement',
  page_fans: 'fans_total',
};

function insightsToDaily(data) {
  const byDate = {};
  for (const metric of data || []) {
    const key = METRIC_MAP[metric.name];
    if (!key) continue;
    for (const v of metric.values || []) {
      const date = insightDate(v.end_time);
      byDate[date] = byDate[date] || { date, reach: 0, engagement: 0, fans_total: 0 };
      byDate[date][key] = Number(v.value) || 0;
    }
  }
  return Object.values(byDate).sort((a, b) => (a.date < b.date ? -1 : 1));
}

function postsToRows(data) {
  return (data || []).map(p => ({
    post_id: p.id,
    created_at: p.created_time,
    message: (p.message || '').slice(0, 200),
    reach: Number(p.insights?.data?.[0]?.values?.[0]?.value) || 0,
    likes: p.likes?.summary?.total_count || 0,
    comments: p.comments?.summary?.total_count || 0,
    shares: p.shares?.count || 0,
  }));
}

async function fetchFbPage(pool, from, to) {
  const pageId = process.env.META_PAGE_ID;

  // 1) 每日 insights（until 要多一天才含 to 當天）
  const insights = await fbGet(`${pageId}/insights`, {
    metric: Object.keys(METRIC_MAP).join(','),
    period: 'day',
    since: from,
    until: addDays(to, 1),
  });
  const daily = insightsToDaily(insights.data).filter(d => d.date >= from && d.date <= to);
  for (const d of daily) {
    await pool.query(
      `INSERT INTO traf_fb_page_daily (date, reach, engagement, fans_total)
       VALUES ($1,$2,$3,$4)
       ON CONFLICT (date) DO UPDATE SET reach=$2, engagement=$3, fans_total=$4`,
      [d.date, d.reach, d.engagement, d.fans_total]);
  }

  // 2) 重算受影響區間的 fans_change（今天總數 - 昨天總數）
  await pool.query(
    `UPDATE traf_fb_page_daily t
        SET fans_change = t.fans_total - p.fans_total
       FROM traf_fb_page_daily p
      WHERE p.date = t.date - 1
        AND t.date BETWEEN $1::date AND $2::date`,
    [from, addDays(to, 1)]);

  // 3) 近 25 篇貼文成效（UPSERT，成效持續更新）
  const posts = await fbGet(`${pageId}/posts`, {
    fields: 'id,created_time,message,likes.summary(true).limit(0),' +
            'comments.summary(true).limit(0),shares,insights.metric(post_impressions_unique)',
    limit: 25,
  });
  const rows = postsToRows(posts.data);
  for (const r of rows) {
    await pool.query(
      `INSERT INTO traf_fb_posts (post_id, created_at, message, reach, likes, comments, shares, fetched_at)
       VALUES ($1,$2,$3,$4,$5,$6,$7,now())
       ON CONFLICT (post_id) DO UPDATE
         SET message=$3, reach=$4, likes=$5, comments=$6, shares=$7, fetched_at=now()`,
      [r.post_id, r.created_at, r.message, r.reach, r.likes, r.comments, r.shares]);
  }

  return { daily: daily.length, posts: rows.length };
}

module.exports = { fetchFbPage, insightsToDaily, postsToRows };

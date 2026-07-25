const { test } = require('node:test');
const assert = require('node:assert');
const { insightDate } = require('../lib/meta');
const { insightsToDaily, postsToRows, normalizePermalink, normalizeThumbnail } = require('../fetchers/fb_page');

test('insightDate：end_time 代表的是前一天', () => {
  assert.equal(insightDate('2026-07-02T07:00:00+0000'), '2026-07-01');
});

test('insightsToDaily 合併三個 metric 成每日列', () => {
  // 2025-11 Meta 淘汰舊 metric：page_impressions_unique → page_media_view、
  // page_fans → page_follows（METRIC_MAP 同步更新，僅 key 改變）
  const data = [
    { name: 'page_media_view',       values: [{ value: 500, end_time: '2026-07-02T07:00:00+0000' }] },
    { name: 'page_post_engagements', values: [{ value: 80,  end_time: '2026-07-02T07:00:00+0000' }] },
    { name: 'page_follows',          values: [{ value: 12000, end_time: '2026-07-02T07:00:00+0000' }] },
    { name: 'unknown_metric',        values: [{ value: 1, end_time: '2026-07-02T07:00:00+0000' }] },
  ];
  assert.deepEqual(insightsToDaily(data), [
    { date: '2026-07-01', reach: 500, engagement: 80, fans_total: 12000 },
  ]);
});

// likes/comments summary 欄位需要 pages_read_user_content（token 沒有），
// 改由 insights 的 post_activity_by_action_type 取 like/comment/share，
// reach 由 post_media_view 取（post_impressions_unique 已於 2025-11 淘汰）
test('postsToRows 攤平貼文欄位', () => {
  const data = [{
    id: '123_456',
    created_time: '2026-07-01T10:00:00+0000',
    message: '測試貼文',
    permalink_url: 'https://www.facebook.com/PageName/posts/123456',
    full_picture: 'https://scontent.xx.fbcdn.net/v/thumb.jpg',
    insights: { data: [
      { name: 'post_media_view', values: [{ value: 900 }] },
      { name: 'post_activity_by_action_type', values: [{ value: { like: 10, comment: 3, share: 2 } }] },
    ] },
  }];
  assert.deepEqual(postsToRows(data), [{
    post_id: '123_456', created_at: '2026-07-01T10:00:00+0000', message: '測試貼文',
    reach: 900, likes: 10, comments: 3, shares: 2,
    permalink_url: 'https://www.facebook.com/PageName/posts/123456',
    thumbnail_url: 'https://scontent.xx.fbcdn.net/v/thumb.jpg',
  }]);
});

test('postsToRows 缺欄位時補 0/空字串，permalink_url/thumbnail_url 缺失時為 null（不可噴錯）', () => {
  const r = postsToRows([{ id: 'x', created_time: '2026-07-01T10:00:00+0000' }])[0];
  assert.equal(r.message, '');
  assert.equal(r.reach, 0);
  assert.equal(r.shares, 0);
  assert.equal(r.permalink_url, null);
  assert.equal(r.thumbnail_url, null);
});

test('normalizeThumbnail：純文字貼文（無 full_picture）回傳 null，不可為 undefined', () => {
  assert.equal(normalizeThumbnail(undefined), null);
  assert.equal(normalizeThumbnail(null), null);
  assert.equal(normalizeThumbnail(''), null);
});

test('normalizeThumbnail：正常 URL 原樣通過', () => {
  assert.equal(
    normalizeThumbnail('https://scontent.xx.fbcdn.net/v/thumb.jpg'),
    'https://scontent.xx.fbcdn.net/v/thumb.jpg');
});

test('normalizePermalink：已是完整 https URL 原樣通過', () => {
  assert.equal(
    normalizePermalink('https://www.facebook.com/PageName/posts/123456'),
    'https://www.facebook.com/PageName/posts/123456');
});

test('normalizePermalink：相對路徑補上網域', () => {
  assert.equal(
    normalizePermalink('/PageName/posts/123456'),
    'https://www.facebook.com/PageName/posts/123456');
});

test('normalizePermalink：缺欄位/null/空字串回傳 null', () => {
  assert.equal(normalizePermalink(null), null);
  assert.equal(normalizePermalink(undefined), null);
  assert.equal(normalizePermalink(''), null);
});

test('normalizePermalink：非 http(s)/非相對路徑的可疑字串回傳 null（防禦性）', () => {
  assert.equal(normalizePermalink('javascript:alert(1)'), null);
});

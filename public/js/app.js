// app.js — 登入、日期區間、載入 /api/data、渲染四個頁籤
(function () {
  const $ = s => document.querySelector(s);
  const state = { secret: localStorage.getItem('traf_secret') || '', from: '', to: '', data: null };

  // ── 日期工具（台北時區）──────────────────────────
  function today() {
    return new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Taipei' }).format(new Date());
  }
  function addDays(s, n) {
    const d = new Date(`${s}T00:00:00Z`);
    d.setUTCDate(d.getUTCDate() + n);
    return d.toISOString().slice(0, 10);
  }
  function setRange(kind) {
    const t = today();
    if (kind === 'thisMonth') { state.from = t.slice(0, 8) + '01'; state.to = t; }
    else if (kind === 'lastMonth') {
      const firstThis = t.slice(0, 8) + '01';
      state.to = addDays(firstThis, -1);
      state.from = state.to.slice(0, 8) + '01';
    } else { state.from = addDays(t, -Number(kind)); state.to = addDays(t, -1); }
    $('#date-from').value = state.from;
    $('#date-to').value = state.to;
  }

  // ── API ──────────────────────────────────────────
  async function api(path, opts = {}) {
    const res = await fetch(path, {
      ...opts,
      headers: { 'Content-Type': 'application/json',
                 'Authorization': `Bearer ${state.secret}`, ...(opts.headers || {}) },
    });
    if (res.status === 401) { logout(); throw new Error('未登入'); }
    const json = await res.json();
    if (!res.ok) throw new Error(json.error || res.statusText);
    return json;
  }
  function logout() {
    localStorage.removeItem('traf_secret');
    state.secret = '';
    $('#main').hidden = true;
    $('#login-overlay').style.display = 'flex';
  }

  // ── 登入 ─────────────────────────────────────────
  $('#login-form').addEventListener('submit', async e => {
    e.preventDefault();
    const secret = $('#login-secret').value;
    try {
      const res = await fetch('/api/login', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ secret }),
      });
      if (!res.ok) throw new Error((await res.json()).error || '登入失敗');
      state.secret = secret;
      localStorage.setItem('traf_secret', secret);
      enter();
    } catch (err) { $('#login-error').textContent = err.message; }
  });
  $('#logout-btn').addEventListener('click', logout);

  function enter() {
    $('#login-overlay').style.display = 'none';
    $('#main').hidden = false;
    load();
  }

  // ── 頁籤與日期列 ─────────────────────────────────
  document.querySelectorAll('#tabs button').forEach(btn => {
    btn.onclick = () => {
      document.querySelectorAll('#tabs button').forEach(b => b.classList.remove('active'));
      document.querySelectorAll('.tab').forEach(t => t.classList.remove('active'));
      btn.classList.add('active');
      $(`#tab-${btn.dataset.tab}`).classList.add('active');
    };
  });
  document.querySelectorAll('#date-controls [data-range]').forEach(btn => {
    btn.onclick = () => {
      document.querySelectorAll('#date-controls [data-range]').forEach(b => b.classList.remove('active'));
      btn.classList.add('active');
      setRange(btn.dataset.range);
      load();
    };
  });
  $('#date-apply').onclick = () => {
    document.querySelectorAll('#date-controls [data-range]').forEach(b => b.classList.remove('active'));
    state.from = $('#date-from').value;
    state.to = $('#date-to').value;
    if (state.from && state.to) load();
  };
  $('#refetch-btn').onclick = async () => {
    $('#refetch-btn').disabled = true;
    $('#refetch-btn').textContent = '抓取中…';
    try { await api('/api/refetch', { method: 'POST', body: '{}' }); await load(); }
    catch (err) { alert(`重抓失敗：${err.message}`); }
    $('#refetch-btn').disabled = false;
    $('#refetch-btn').textContent = '手動重抓';
  };

  // ── 載入與渲染 ───────────────────────────────────
  async function load() {
    state.data = await api(`/api/data?from=${state.from}&to=${state.to}`);
    renderStatus();
    renderOverview();
    renderGa();
    renderFb();
    renderAds();
  }

  const num = v => Number(v || 0).toLocaleString('zh-TW');
  const money = v => 'NT$' + Number(v || 0).toLocaleString('zh-TW', { maximumFractionDigits: 0 });
  // API 回傳的 pg DATE 欄位會被序列化為 UTC 位移的 ISO 字串
  // （例如 "2026-07-06T16:00:00.000Z" 代表台北時間的 2026-07-07），
  // 因此一律用台北時區重新推算日期，避免直接 slice UTC 字串導致日期少一天。
  const taipeiDate = d => new Date(d).toLocaleDateString('en-CA', { timeZone: 'Asia/Taipei' }); // 'YYYY-MM-DD'
  const dstr = d => taipeiDate(d).slice(5);   // MM-DD
  function sum(rows, key) { return rows.reduce((a, r) => a + Number(r[key] || 0), 0); }

  function renderStatus() {
    const st = state.data.fetch_status || [];
    const fails = st.filter(s => s.status !== 'ok');
    const latest = st.map(s => new Date(s.fetched_at)).sort((a, b) => b - a)[0];
    $('#last-update').innerHTML =
      (latest ? `最後更新：${latest.toLocaleString('zh-TW', { timeZone: 'Asia/Taipei' })}` : '尚無抓取紀錄') +
      (fails.length ? ` <span class="warn">⚠ ${fails.map(f => f.source).join('/')} 抓取失敗</span>` : '');
  }

  function renderOverview() {
    const el = $('#tab-overview');
    el.innerHTML = '';
    const d = state.data;
    Cards.kpiCard({ el, label: 'GA 使用者（區間加總）', value: num(sum(d.ga_daily, 'users')) });
    Cards.kpiCard({ el, label: 'GA 工作階段', value: num(sum(d.ga_daily, 'sessions')) });
    Cards.kpiCard({ el, label: '粉專觀看', value: num(sum(d.fb_page_daily, 'reach')) });
    Cards.kpiCard({ el, label: '廣告花費', value: money(sum(d.ads_daily, 'spend')) });
    Cards.chartCard({
      id: 'ov_ga', title: 'GA 每日工作階段', el,
      types: ['line', 'smooth', 'bar'], defaultType: 'smooth',
      datasets: { labels: d.ga_daily.map(r => dstr(r.date)),
        series: [{ label: '工作階段', data: d.ga_daily.map(r => +r.sessions), color: '#1565c0' }] },
    });
    Cards.chartCard({
      id: 'ov_fb', title: '粉專每日觀看', el,
      types: ['line', 'smooth', 'bar'], defaultType: 'smooth',
      datasets: { labels: d.fb_page_daily.map(r => dstr(r.date)),
        series: [{ label: '觀看', data: d.fb_page_daily.map(r => +r.reach), color: '#26a69a' }] },
    });
    const byDate = groupSum(d.ads_daily, 'date', 'spend');
    Cards.chartCard({
      id: 'ov_ads', title: '廣告每日花費', el,
      types: ['line', 'smooth', 'bar'], defaultType: 'bar',
      datasets: { labels: byDate.map(r => dstr(r.key)),
        series: [{ label: '花費', data: byDate.map(r => r.value), color: '#ef6c00' }] },
    });
  }

  function groupSum(rows, keyField, valField) {
    const m = new Map();
    for (const r of rows) m.set(r[keyField], (m.get(r[keyField]) || 0) + Number(r[valField] || 0));
    return [...m.entries()].map(([key, value]) => ({ key, value }))
      .sort((a, b) => (a.key < b.key ? -1 : 1));
  }

  function renderGa() {
    const el = $('#tab-ga');
    el.innerHTML = '';
    const d = state.data;
    Cards.chartCard({
      id: 'ga_trend', title: '每日流量趨勢', el, wide: true,
      types: ['line', 'smooth', 'bar'], defaultType: 'smooth',
      datasets: { labels: d.ga_daily.map(r => dstr(r.date)),
        series: [
          { label: '使用者', data: d.ga_daily.map(r => +r.users), color: '#1565c0' },
          { label: '工作階段', data: d.ga_daily.map(r => +r.sessions), color: '#26a69a' },
          { label: '瀏覽頁數', data: d.ga_daily.map(r => +r.pageviews), color: '#8e24aa' },
        ] },
    });
    const ch = groupSum(d.ga_channels, 'channel', 'sessions').sort((a, b) => b.value - a.value);
    if (ch.length) {
      Cards.chartCard({
        id: 'ga_channels', title: '來源管道（工作階段）', el,
        types: ['pie', 'bar'], defaultType: 'pie',
        datasets: { labels: ch.map(r => r.key),
          series: [{ label: '工作階段', data: ch.map(r => r.value), color: '#1565c0' }] },
      });
    }
    Cards.tableCard({
      title: '熱門頁面 Top 20', el, rows: d.ga_pages,
      columns: [
        { key: 'page_path', label: '頁面' },
        { key: 'views', label: '瀏覽數', num: true, format: num },
        { key: 'users', label: '使用者', num: true, format: num },
      ],
    });
    Cards.tableCard({
      title: '轉換事件', el, rows: d.ga_events,
      columns: [
        { key: 'event_name', label: '事件' },
        { key: 'count', label: '次數', num: true, format: num },
      ],
    });
  }

  function renderFb() {
    const el = $('#tab-fb');
    el.innerHTML = '';
    const d = state.data;
    Cards.chartCard({
      id: 'fb_trend', title: '觀看與互動趨勢', el, wide: true,
      types: ['line', 'smooth', 'bar'], defaultType: 'smooth',
      datasets: { labels: d.fb_page_daily.map(r => dstr(r.date)),
        series: [
          { label: '觀看', data: d.fb_page_daily.map(r => +r.reach), color: '#1565c0' },
          { label: '互動', data: d.fb_page_daily.map(r => +r.engagement), color: '#ef6c00' },
        ] },
    });
    Cards.chartCard({
      id: 'fb_fans', title: '追蹤者數變化', el,
      types: ['line', 'smooth', 'bar'], defaultType: 'line',
      datasets: { labels: d.fb_page_daily.map(r => dstr(r.date)),
        series: [{ label: '追蹤者總數', data: d.fb_page_daily.map(r => +r.fans_total), color: '#26a69a' }] },
    });
    Cards.tableCard({
      title: '近期貼文成效', el, wide: true,
      rows: state.data.fb_posts.map(p => ({
        ...p, created_at: taipeiDate(p.created_at),
      })),
      columns: [
        { key: 'created_at', label: '日期' },
        { key: 'message', label: '內容' },
        { key: 'reach', label: '觀看', num: true, format: num },
        { key: 'likes', label: '反應', num: true, format: num },
        { key: 'comments', label: '留言', num: true, format: num },
        { key: 'shares', label: '分享', num: true, format: num },
      ],
    });
  }

  function renderAds() {
    const el = $('#tab-ads');
    el.innerHTML = '';
    const d = state.data;
    const byDate = groupSum(d.ads_daily, 'date', 'spend');
    const clicksByDate = groupSum(d.ads_daily, 'date', 'clicks');
    Cards.chartCard({
      id: 'ads_spend', title: '每日花費', el,
      types: ['line', 'smooth', 'bar'], defaultType: 'bar',
      datasets: { labels: byDate.map(r => dstr(r.key)),
        series: [{ label: '花費', data: byDate.map(r => r.value), color: '#ef6c00' }] },
    });
    Cards.chartCard({
      id: 'ads_clicks', title: '每日點擊', el,
      types: ['line', 'smooth', 'bar'], defaultType: 'smooth',
      datasets: { labels: clicksByDate.map(r => dstr(r.key)),
        series: [{ label: '點擊', data: clicksByDate.map(r => r.value), color: '#1565c0' }] },
    });
    // 行銷活動彙總表：CPC / CPM 前端計算
    const byCamp = new Map();
    for (const r of d.ads_daily) {
      const c = byCamp.get(r.campaign_id) ||
        { campaign_name: r.campaign_name, spend: 0, impressions: 0, clicks: 0, conversions: 0 };
      c.spend += +r.spend; c.impressions += +r.impressions;
      c.clicks += +r.clicks; c.conversions += +r.conversions;
      c.campaign_name = r.campaign_name;
      byCamp.set(r.campaign_id, c);
    }
    const camps = [...byCamp.values()].sort((a, b) => b.spend - a.spend).map(c => ({
      ...c,
      cpc: c.clicks ? (c.spend / c.clicks).toFixed(1) : '—',
      cpm: c.impressions ? (c.spend / c.impressions * 1000).toFixed(1) : '—',
    }));
    Cards.tableCard({
      title: '行銷活動成效', el, wide: true, rows: camps,
      columns: [
        { key: 'campaign_name', label: '行銷活動' },
        { key: 'spend', label: '花費', num: true, format: money },
        { key: 'impressions', label: '曝光', num: true, format: num },
        { key: 'clicks', label: '點擊', num: true, format: num },
        { key: 'cpc', label: 'CPC', num: true },
        { key: 'cpm', label: 'CPM', num: true },
        { key: 'conversions', label: '轉換', num: true, format: num },
      ],
    });
  }

  // ── 啟動 ─────────────────────────────────────────
  setRange('30');
  if (state.secret) {
    fetch('/api/login', {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ secret: state.secret }),
    }).then(r => (r.ok ? enter() : logout()));
  }
})();

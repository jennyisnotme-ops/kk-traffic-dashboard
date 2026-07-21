// app.js — 登入、日期區間、載入 /api/data、渲染六個頁面（左側選單切換見 sidebar.js）
(function () {
  const $ = s => document.querySelector(s);
  const state = { token: localStorage.getItem('traf_token') || '', me: null,
    from: '', to: '', compareOn: false, compareMode: 'prev', cmpFrom: '', cmpTo: '',
    data: null, cmpData: null, reports: [], overviewCards: null, overviewEditMode: null };

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
  function daySpan(from, to) {   // 含頭尾天數
    return Math.round((new Date(`${to}T00:00:00Z`) - new Date(`${from}T00:00:00Z`)) / 86400000) + 1;
  }
  function prevRange(from, to) {
    const n = daySpan(from, to);
    const t = addDays(from, -1);
    return { from: addDays(t, -(n - 1)), to: t };
  }
  function pct(cur, prev) {
    cur = Number(cur); prev = Number(prev);
    if (!isFinite(cur) || !isFinite(prev) || prev === 0) return null;
    return (cur - prev) / prev * 100;
  }
  function fmtPct(n) {
    if (n === null) return { text: '—', cls: '' };
    const s = `${n >= 0 ? '▲' : '▼'} ${Math.abs(n).toFixed(1)}%`;
    return { text: s, cls: n >= 0 ? 'delta-up' : 'delta-down' };
  }

  // ── API ──────────────────────────────────────────
  async function api(path, opts = {}) {
    const res = await fetch(path, {
      ...opts,
      headers: { 'Content-Type': 'application/json',
                 'Authorization': `Bearer ${state.token}`, ...(opts.headers || {}) },
    });
    if (res.status === 401) { logout(); throw new Error('未登入'); }
    const json = await res.json();
    if (!res.ok) throw new Error(json.error || res.statusText);
    return json;
  }
  function logout() {
    const token = state.token;
    if (token) {
      // 用純 fetch（非 api() helper）：api() 在收到 401 時會呼叫 logout()，
      // 若這裡改用 api() 會造成無窮遞迴
      fetch('/api/logout', { method: 'POST', headers: { 'Authorization': `Bearer ${token}` } })
        .catch(() => {});
    }
    localStorage.removeItem('traf_token');
    state.token = '';
    state.me = null;
    $('#main').hidden = true;
    $('#login-overlay').style.display = 'flex';
  }

  // ── 登入 ─────────────────────────────────────────
  $('#login-form').addEventListener('submit', async e => {
    e.preventDefault();
    const username = $('#login-username').value;
    const password = $('#login-password').value;
    try {
      const res = await fetch('/api/login', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ username, password }),
      });
      const json = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(json.error || '登入失敗');
      state.token = json.token;
      localStorage.setItem('traf_token', json.token);
      const me = await api('/api/me');
      await enter(me);
    } catch (err) { $('#login-error').textContent = err.message; }
  });
  $('#logout-btn').addEventListener('click', logout);

  async function enter(me) {
    state.me = me;
    $('#login-overlay').style.display = 'none';
    $('#main').hidden = false;
    Cards.configureExport({
      post: async payload => {
        const res = await fetch('/api/export', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${state.token}` },
          body: JSON.stringify(payload),
        });
        if (!res.ok) throw new Error((await res.json().catch(() => ({}))).error || '匯出失敗');
        return res.blob();
      },
    });
    applyRoleUI();
    const allowed = new Set(state.me.allowed_pages || []);
    // 「帳號管理」與「設定」子頁不受 allowed_pages 限制：帳號管理只看 role==='admin'，
    // 設定頁（改密碼/外觀主題）任何已登入使用者皆可見，故一律加進 Sidebar 的合法頁面清單，
    // 讓 sidebar.js 的 navigate() 不會因為不在 pageSet 而擋掉點擊。
    const extraPages = SETTINGS_PAGES.concat(isAdmin() ? ['users'] : []);
    Sidebar.init({ pages: PAGES.filter(p => allowed.has(p)).concat(extraPages), onNavigate: onNavigatePage });
    try { await loadReports(); } catch (_) { state.reports = []; }
    load();
  }

  function isAdmin() { return state.me?.role === 'admin'; }

  // 依角色隱藏體驗優化用的按鈕/操作（非安全邊界，後端已各自 403）
  function applyRoleUI() {
    const isUser = state.me?.role === 'user';
    $('#refetch-btn').hidden = isUser;
    $('#menu-users').hidden = !isAdmin();
  }

  function onNavigatePage(page) {
    if (page === 'users') renderUsers();
    else if (page === 'settings_password') renderSettingsPassword();
    // settings_theme：空殼頁，3c 再填內容，這裡不需要處理
  }

  // ── 左側選單與日期列 ─────────────────────────────
  const PAGES = ['overview', 'ga', 'fb_insights', 'fb_posts', 'fb_ads', 'custom'];
  const SETTINGS_PAGES = ['settings_password', 'settings_theme'];

  $('#date-preset').addEventListener('change', () => {
    const v = $('#date-preset').value;
    $('#custom-range').hidden = v !== 'custom';
    if (v !== 'custom') { setRange(v); load(); }
  });
  $('#date-apply').onclick = () => {
    state.from = $('#date-from').value; state.to = $('#date-to').value;
    if (state.from && state.to && state.from <= state.to) load();
  };
  $('#compare-on').addEventListener('change', () => {
    state.compareOn = $('#compare-on').checked;
    $('#compare-controls').hidden = !state.compareOn;
    load();
  });
  $('#compare-mode').addEventListener('change', () => {
    state.compareMode = $('#compare-mode').value;
    $('#compare-custom').hidden = state.compareMode !== 'custom';
    if (state.compareMode === 'prev') load();
  });
  $('#compare-apply').onclick = () => {
    const cf = $('#cmp-from').value, ct = $('#cmp-to').value;
    if (!(cf && ct && cf <= ct)) return;
    const mainDays = daySpan(state.from, state.to);
    const cmpDays = daySpan(cf, ct);
    if (cmpDays !== mainDays) {
      return alert(`比較區間天數需與主區間相同（目前主區間 ${mainDays} 天，你選了 ${cmpDays} 天）`);
    }
    state.cmpFrom = cf; state.cmpTo = ct;
    load();
  };
  $('#refetch-btn').onclick = async () => {
    $('#refetch-btn').disabled = true;
    $('#refetch-btn').textContent = '抓取中…';
    try { await api('/api/refetch', { method: 'POST', body: '{}' }); await load(); }
    catch (err) { alert(`重抓失敗：${err.message}`); }
    $('#refetch-btn').disabled = false;
    $('#refetch-btn').textContent = '手動重抓';
  };

  // ── Sortable 排序記憶 ────────────────────────────
  function initSortable(tabEl, tabName) {
    const key = `traf_card_order_${tabName}`;
    let saved = [];
    try { saved = JSON.parse(localStorage.getItem(key) || '[]'); } catch (_) { saved = []; }
    if (!Array.isArray(saved)) saved = [];
    if (saved.length) {
      for (const cid of saved) {
        const elCard = tabEl.querySelector(`[data-cid="${CSS.escape(cid)}"]`);
        if (elCard) tabEl.appendChild(elCard);
      }
    }
    tabEl._sortable?.destroy?.();
    tabEl._sortable = new Sortable(tabEl, {
      animation: 150,
      handle: '.card-head, .kpi-label',
      onEnd: () => localStorage.setItem(key,
        JSON.stringify([...tabEl.children].map(c => c.dataset.cid).filter(Boolean))),
    });
  }

  // ── 載入與渲染 ───────────────────────────────────
  function cmpRangeUsed() {   // 目前實際使用的比較區間（供 load 與 renderCustom 共用）
    return state.compareMode === 'custom'
      ? { from: state.cmpFrom, to: state.cmpTo }
      : prevRange(state.from, state.to);
  }
  async function load() {
    const q = r => `/api/data?from=${r.from}&to=${r.to}&posts_from=${r.from}&posts_to=${r.to}`;
    state.data = await api(q({ from: state.from, to: state.to }));
    if (state.compareOn) {
      const r = cmpRangeUsed();
      state.cmpData = (r.from && r.to) ? await api(q(r)) : null;
    } else state.cmpData = null;
    renderStatus(); renderOverview(); renderGa(); renderFbInsights(); renderFbPosts(); renderAds(); renderCustom();
    // 總覽卡片不走這裡的 initSortable：總覽拖拉已改為「編輯版面」→ PUT /api/layout 的
    // 正式版面資料（見 renderOverviewCards/openLayoutEdit），與其他頁籤純 localStorage
    // 拖拉記憶徹底區隔，避免共用同一把 key 造成互相污染。
    initSortable($('#page-ga'), 'ga');
    initSortable($('#page-fb_insights'), 'fb');
    initSortable($('#page-fb_posts'), 'fb_posts');
    initSortable($('#page-fb_ads'), 'ads');
    initSortable($('#page-custom'), 'custom');
  }

  // ── 無權限空狀態 ─────────────────────────────────
  // /api/data 依 allowed_pages 過濾回應 key（見 server.js DATA_KEY_PAGES），使用者若無權限，
  // 對應 key 會直接缺席（undefined）。渲染前逐頁檢查所需 key 是否齊全，
  // 缺席時顯示「無權限查看此頁」文字卡而非讓 .map() 撞 undefined 壞掉。
  function renderNoPermission(el) {
    el.innerHTML = '';
    const card = document.createElement('div');
    card.className = 'card';
    card.textContent = '無權限查看此頁';
    el.appendChild(card);
  }
  function hasKeys(...keys) { return keys.every(k => state.data[k] !== undefined); }

  const num = v => Number(v || 0).toLocaleString('zh-TW');
  const money = v => 'NT$' + Number(v || 0).toLocaleString('zh-TW', { maximumFractionDigits: 0 });
  // API 回傳的 pg DATE 欄位會被序列化為 UTC 位移的 ISO 字串
  // （例如 "2026-07-06T16:00:00.000Z" 代表台北時間的 2026-07-07），
  // 因此一律用台北時區重新推算日期，避免直接 slice UTC 字串導致日期少一天。
  const taipeiDate = d => new Date(d).toLocaleDateString('en-CA', { timeZone: 'Asia/Taipei' }); // 'YYYY-MM-DD'
  const dstr = d => taipeiDate(d).slice(5);   // MM-DD
  function sum(rows, key) { return rows.reduce((a, r) => a + Number(r[key] || 0), 0); }

  const cmpOf = key => state.cmpData ? state.cmpData[key] : null;
  function seriesCompare(rows, cmpRows, mapFn) {   // 回傳 {labels, series} 或 null
    if (!cmpRows) return null;
    return { labels: cmpRows.map(r => dstr(r.date)), series: mapFn(cmpRows) };
  }
  function kpiDelta(key, field) {
    const c = cmpOf(key);
    return c ? fmtPct(pct(sum(state.data[key], field), sum(c, field))) : null;
  }

  function renderStatus() {
    const st = state.data.fetch_status || [];
    const fails = st.filter(s => s.status !== 'ok');
    const latest = st.map(s => new Date(s.fetched_at)).sort((a, b) => b - a)[0];
    $('#last-update').innerHTML =
      (latest ? `最後更新：${latest.toLocaleString('zh-TW', { timeZone: 'Asia/Taipei' })}` : '尚無抓取紀錄') +
      (fails.length ? ` <span class="warn">⚠ ${fails.map(f => f.source).join('/')} 抓取失敗</span>` : '');
  }

  // ── 總覽卡片庫 ───────────────────────────────────
  // 內建 7 張卡（4 KPI + 3 趨勢圖），render(el) 各自對應原本 renderOverview() 的寫死內容。
  // 動態卡（自訂報表 custom_<id>）不在此陣列中，由 overviewCatalog() 依 state.reports 附加。
  const OVERVIEW_BUILTIN_CARDS = [
    { cid: 'ov_kpi_ga_users', label: 'GA 使用者（區間加總）', render(el) {
        const d = state.data;
        Cards.kpiCard({ el, cid: 'ov_kpi_ga_users', label: 'GA 使用者（區間加總）',
          value: num(sum(d.ga_daily, 'users')), delta: kpiDelta('ga_daily', 'users') });
      } },
    { cid: 'ov_kpi_ga_sessions', label: 'GA 工作階段', render(el) {
        const d = state.data;
        Cards.kpiCard({ el, cid: 'ov_kpi_ga_sessions', label: 'GA 工作階段',
          value: num(sum(d.ga_daily, 'sessions')), delta: kpiDelta('ga_daily', 'sessions') });
      } },
    { cid: 'ov_kpi_fb_reach', label: '粉專觀看', render(el) {
        const d = state.data;
        Cards.kpiCard({ el, cid: 'ov_kpi_fb_reach', label: '粉專觀看',
          value: num(sum(d.fb_page_daily, 'reach')), delta: kpiDelta('fb_page_daily', 'reach') });
      } },
    { cid: 'ov_kpi_ads_spend', label: '廣告花費', render(el) {
        const d = state.data;
        Cards.kpiCard({ el, cid: 'ov_kpi_ads_spend', label: '廣告花費',
          value: money(sum(d.ads_daily, 'spend')), delta: kpiDelta('ads_daily', 'spend') });
      } },
    { cid: 'ov_ga', label: 'GA 每日工作階段', render(el) {
        const d = state.data;
        Cards.chartCard({
          id: 'ov_ga', title: 'GA 每日工作階段', el,
          types: ['line', 'smooth', 'bar'], defaultType: 'smooth',
          datasets: { labels: d.ga_daily.map(r => dstr(r.date)),
            series: [{ label: '工作階段', data: d.ga_daily.map(r => +r.sessions), color: '#1565c0' }] },
          compare: seriesCompare(d.ga_daily, cmpOf('ga_daily'),
            rows => [{ label: '工作階段', data: rows.map(r => +r.sessions), color: '#1565c0' }]),
          exp: {
            filename: `GA每日工作階段_${state.from}_${state.to}`,
            fields: [{ key: 'date', label: '日期' }, { key: 'sessions', label: '工作階段' },
                     ...(state.cmpData ? [{ key: 'sessionsCmp', label: '工作階段（比較）' }] : [])],
            rows: d.ga_daily.map((r, i) => ({
              date: dstr(r.date), sessions: +r.sessions,
              ...(state.cmpData ? { sessionsCmp: cmpOf('ga_daily')?.[i] ? +cmpOf('ga_daily')[i].sessions : '' } : {}),
            })),
          },
        });
      } },
    { cid: 'ov_fb', label: '粉專每日觀看', render(el) {
        const d = state.data;
        Cards.chartCard({
          id: 'ov_fb', title: '粉專每日觀看', el,
          types: ['line', 'smooth', 'bar'], defaultType: 'smooth',
          datasets: { labels: d.fb_page_daily.map(r => dstr(r.date)),
            series: [{ label: '觀看', data: d.fb_page_daily.map(r => +r.reach), color: '#26a69a' }] },
          compare: seriesCompare(d.fb_page_daily, cmpOf('fb_page_daily'),
            rows => [{ label: '觀看', data: rows.map(r => +r.reach), color: '#26a69a' }]),
          exp: {
            filename: `粉專每日觀看_${state.from}_${state.to}`,
            fields: [{ key: 'date', label: '日期' }, { key: 'reach', label: '觀看' },
                     ...(state.cmpData ? [{ key: 'reachCmp', label: '觀看（比較）' }] : [])],
            rows: d.fb_page_daily.map((r, i) => ({
              date: dstr(r.date), reach: +r.reach,
              ...(state.cmpData ? { reachCmp: cmpOf('fb_page_daily')?.[i] ? +cmpOf('fb_page_daily')[i].reach : '' } : {}),
            })),
          },
        });
      } },
    { cid: 'ov_ads', label: '廣告每日花費', render(el) {
        const d = state.data;
        const byDate = groupSum(d.ads_daily, 'date', 'spend');
        const cb = cmpOf('ads_daily') ? groupSum(cmpOf('ads_daily'), 'date', 'spend') : null;
        Cards.chartCard({
          id: 'ov_ads', title: '廣告每日花費', el,
          types: ['line', 'smooth', 'bar'], defaultType: 'bar',
          datasets: { labels: byDate.map(r => dstr(r.key)),
            series: [{ label: '花費', data: byDate.map(r => r.value), color: '#ef6c00' }] },
          compare: cb ? { labels: cb.map(r => dstr(r.key)),
            series: [{ label: '花費', data: cb.map(r => r.value), color: '#ef6c00' }] } : null,
          exp: {
            filename: `廣告每日花費_${state.from}_${state.to}`,
            fields: [{ key: 'date', label: '日期' }, { key: 'spend', label: '花費' },
                     ...(cb ? [{ key: 'spendCmp', label: '花費（比較）' }] : [])],
            rows: byDate.map((r, i) => ({
              date: dstr(r.key), spend: r.value,
              ...(cb ? { spendCmp: cb[i] ? cb[i].value : '' } : {}),
            })),
          },
        });
      } },
  ];

  // 完整卡片庫（含動態自訂報表項目）：內建卡在前、自訂報表接在後面，
  // 這是「首次上線／mine 與 default 皆未設定」情境的 fallback 順序
  function overviewCatalog() {
    return OVERVIEW_BUILTIN_CARDS.concat(state.reports.map(rep => ({
      cid: `custom_${rep.id}`, label: rep.name, render(el) { renderCustomCard(rep, el, true); },
    })));
  }
  function overviewCardDef(cid) { return overviewCatalog().find(c => c.cid === cid); }

  // mine → default → 全卡片庫 fallback 鏈；三者皆 {cards:null} 時代表首次上線，
  // 直接用卡片庫的天然順序（等同 3c 之前的寫死行為），總覽絕不會因此開天窗。
  async function resolveOverviewCards() {
    try {
      const mine = await api('/api/layout?scope=mine');
      if (mine.cards) return mine.cards;
    } catch (_) { /* 讀取失敗一律往下 fallback，不擋住總覽渲染 */ }
    try {
      const def = await api('/api/layout?scope=default');
      if (def.cards) return def.cards;
    } catch (_) { /* 同上 */ }
    return overviewCatalog().map(c => ({ cid: c.cid }));
  }

  function renderOverview() {
    // 無權限時只清空卡片格線本身、保留 #overview-toolbar 節點（連同其上已綁定的
    // click 監聽器）——若對整個 #page-overview 做 innerHTML=''，會把工具列按鈕
    // 一併從 DOM 移除，之後就算使用者權限又變回可視也再也點不到（監聽器只在
    // 模組載入時綁定一次，不會重新綁）。同時把「編輯版面」相關按鈕先隱藏，
    // 避免無資料可編輯時仍可點開編輯彈窗。
    if (!hasKeys('ga_daily', 'fb_page_daily', 'ads_daily')) {
      $('#edit-layout-btn').hidden = true;
      $('#edit-layout-default-btn').hidden = true;
      return renderNoPermission($('#overview-cards'));
    }
    $('#edit-layout-btn').hidden = false;
    resolveOverviewCards().then(cards => {
      state.overviewCards = cards;
      renderOverviewCards();
    }).catch(() => {
      // 理論上 resolveOverviewCards 內部已吞掉個別請求失敗，這裡是最後防線
      state.overviewCards = overviewCatalog().map(c => ({ cid: c.cid }));
      renderOverviewCards();
    });
  }

  // 依 state.overviewCards 實際渲染卡片格線（唯讀展示，非編輯模式）；
  // 未在卡片庫中的 cid（例如自訂報表已被刪除）直接跳過，不讓 .map()/.find() 撞 undefined
  function renderOverviewCards() {
    const wrap = $('#overview-cards');
    wrap.innerHTML = '';
    wrap._sortable?.destroy?.();
    wrap._sortable = null;
    for (const entry of state.overviewCards || []) {
      const def = overviewCardDef(entry.cid);
      if (!def) continue;
      def.render(wrap);
    }
    updateEditLayoutButtons();
  }

  function updateEditLayoutButtons() {
    $('#edit-layout-default-btn').hidden = !isAdmin();
  }

  // custom_<id> 卡片渲染邏輯（與 renderCustom() 頁籤共用同一份指標運算），
  // fromOverview=true 時卡片加 wide class 維持與趨勢圖一致的視覺寬度
  function renderCustomCard(rep, el, fromOverview) {
    const axis = dateAxis(state.from, state.to);
    const series = rep.config.metrics.map(m => metricSeries(state.data, m, axis));
    let compare = null;
    if (state.cmpData) {
      const cr = cmpRangeUsed();
      const cAxis = dateAxis(cr.from, cr.to);
      compare = { labels: cAxis.map(d => d.slice(5)),
                  series: rep.config.metrics.map(m => metricSeries(state.cmpData, m, cAxis)) };
    }
    const isAdminUser = state.me?.role === 'admin';
    Cards.chartCard({
      id: fromOverview ? `ov_custom_${rep.id}` : `custom_${rep.id}`,
      cid: `custom_${rep.id}`, title: rep.name, el, wide: true,
      types: ['line', 'smooth', 'bar', 'pie'], defaultType: rep.config.type,
      datasets: { labels: axis.map(d => d.slice(5)), series },
      compare,
      exp: {
        filename: `${rep.name}_${state.from}_${state.to}`,
        fields: [{ key: 'date', label: '日期' }, ...series.map((s, i) => ({ key: `m${i}`, label: s.label }))],
        rows: axis.map((d, ri) => Object.fromEntries(
          [['date', d], ...series.map((s, i) => [`m${i}`, s.data[ri]])])),
      },
      actions: (!fromOverview && isAdminUser) ? [
        { label: '編輯', onClick: () => openReportModal(rep) },
        { label: '刪除', onClick: async () => {
            if (!confirm(`刪除報表「${rep.name}」？（全部門共用，刪除影響所有人）`)) return;
            await api(`/api/reports/${rep.id}`, { method: 'DELETE' });
            await loadReports(); renderCustom();
          } },
      ] : [],
    });
  }

  // ── 總覽版面編輯模式（獨立於其他頁籤的 localStorage 拖拉記憶機制，
  //    見檔頭 initSortable：那是被動記憶排序，這裡是主動編輯＋存 DB）────
  let editSortable = null;

  function openLayoutEdit(scope) {   // scope: 'mine' | 'default'
    state.overviewEditMode = scope;
    const modal = $('#layout-edit-modal');
    $('#layout-edit-title').textContent = scope === 'default' ? '編輯全部門預設版' : '編輯個人版面';
    $('#layout-edit-warning').hidden = scope !== 'default';
    const catalog = overviewCatalog();
    const activeCids = (state.overviewCards || []).map(c => c.cid);
    // 顯示順序：目前生效順序在前，卡片庫中未被選用的項目接在後面（未勾選狀態）
    const orderedCids = activeCids.concat(catalog.map(c => c.cid).filter(cid => !activeCids.includes(cid)));
    const activeSet = new Set(activeCids);
    const list = $('#layout-edit-list');
    list.innerHTML = orderedCids.map(cid => {
      const def = catalog.find(c => c.cid === cid);
      if (!def) return '';   // 保險：理論上不會發生（orderedCids 完全來自 catalog）
      return `<div class="layout-edit-row" data-cid="${esc(cid)}">
        <span class="drag-handle">⠿</span>
        <label><input type="checkbox" class="layout-edit-cb" ${activeSet.has(cid) ? 'checked' : ''}> ${esc(def.label)}</label>
      </div>`;
    }).join('');
    editSortable?.destroy?.();
    editSortable = new Sortable(list, { animation: 150, handle: '.drag-handle' });
    modal.hidden = false;
  }

  function closeLayoutEdit() {
    $('#layout-edit-modal').hidden = true;
    editSortable?.destroy?.();
    editSortable = null;
    state.overviewEditMode = null;
  }

  $('#edit-layout-btn').addEventListener('click', () => openLayoutEdit('mine'));
  $('#edit-layout-default-btn').addEventListener('click', () => openLayoutEdit('default'));
  $('#layout-edit-cancel').addEventListener('click', closeLayoutEdit);
  $('#layout-edit-restore').addEventListener('click', async () => {
    try {
      await api('/api/layout/mine', { method: 'DELETE' });
      closeLayoutEdit();
      renderOverview();
    } catch (err) { alert(`恢復預設失敗：${err.message}`); }
  });
  $('#layout-edit-save').addEventListener('click', async () => {
    const rows = [...$('#layout-edit-list').querySelectorAll('.layout-edit-row')];
    const cards = rows.filter(r => r.querySelector('.layout-edit-cb').checked)
      .map(r => ({ cid: r.dataset.cid }));
    if (!cards.length) return alert('至少勾選一張卡片');
    const scope = state.overviewEditMode || 'mine';
    try {
      await api('/api/layout', { method: 'PUT', body: JSON.stringify({ scope, cards }) });
      closeLayoutEdit();
      renderOverview();
    } catch (err) { alert(`儲存失敗：${err.message}`); }
  });

  function groupSum(rows, keyField, valField) {
    const m = new Map();
    for (const r of rows) m.set(r[keyField], (m.get(r[keyField]) || 0) + Number(r[valField] || 0));
    return [...m.entries()].map(([key, value]) => ({ key, value }))
      .sort((a, b) => (a.key < b.key ? -1 : 1));
  }

  function renderGa() {
    const el = $('#page-ga');
    if (!hasKeys('ga_daily', 'ga_channels', 'ga_pages', 'ga_events')) return renderNoPermission(el);
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
      compare: seriesCompare(d.ga_daily, cmpOf('ga_daily'), rows => [
        { label: '使用者', data: rows.map(r => +r.users), color: '#1565c0' },
        { label: '工作階段', data: rows.map(r => +r.sessions), color: '#26a69a' },
        { label: '瀏覽頁數', data: rows.map(r => +r.pageviews), color: '#8e24aa' },
      ]),
      exp: {
        filename: `GA每日流量_${state.from}_${state.to}`,
        fields: [{ key: 'date', label: '日期' }, { key: 'users', label: '使用者' },
                 { key: 'sessions', label: '工作階段' }, { key: 'pageviews', label: '瀏覽頁數' },
                 ...(state.cmpData ? [
                   { key: 'usersCmp', label: '使用者（比較）' },
                   { key: 'sessionsCmp', label: '工作階段（比較）' },
                   { key: 'pageviewsCmp', label: '瀏覽頁數（比較）' },
                 ] : [])],
        rows: d.ga_daily.map((r, i) => {
          const c = cmpOf('ga_daily')?.[i];
          return {
            date: dstr(r.date), users: +r.users, sessions: +r.sessions, pageviews: +r.pageviews,
            ...(state.cmpData ? {
              usersCmp: c ? +c.users : '', sessionsCmp: c ? +c.sessions : '', pageviewsCmp: c ? +c.pageviews : '',
            } : {}),
          };
        }),
      },
    });
    const ch = groupSum(d.ga_channels, 'channel', 'sessions').sort((a, b) => b.value - a.value);
    if (ch.length) {
      Cards.chartCard({
        id: 'ga_channels', title: '來源管道（工作階段）', el,
        types: ['pie', 'bar'], defaultType: 'pie',
        datasets: { labels: ch.map(r => r.key),
          series: [{ label: '工作階段', data: ch.map(r => r.value), color: '#1565c0' }] },
        exp: {
          filename: `GA來源管道_${state.from}_${state.to}`,
          fields: [{ key: 'channel', label: '管道' }, { key: 'sessions', label: '工作階段' }],
          rows: ch.map(r => ({ channel: r.key, sessions: r.value })),
        },
      });
    }
    const cmpPages = new Map((cmpOf('ga_pages') || []).map(r => [r.page_path, +r.views]));
    const pageRows = d.ga_pages.map(r => {
      const p = fmtPct(pct(r.views, cmpPages.get(r.page_path)));
      return { ...r, delta: p.text, deltaCls: p.cls };
    });
    Cards.tableCard({
      title: '熱門頁面 Top 20', el, rows: pageRows,
      columns: [
        { key: 'page_path', label: '頁面' },
        { key: 'views', label: '瀏覽數', num: true, format: num },
        { key: 'users', label: '使用者', num: true, format: num },
        ...(state.cmpData ? [{ key: 'delta', label: '變化', num: true, clsKey: 'deltaCls' }] : []),
      ],
      exp: {
        filename: `GA熱門頁面_${state.from}_${state.to}`,
        fields: [
          { key: 'page_path', label: '頁面' }, { key: 'views', label: '瀏覽數' }, { key: 'users', label: '使用者' },
          ...(state.cmpData ? [{ key: 'delta', label: '變化' }] : []),
        ],
        rows: pageRows,
      },
    });
    const cmpEvents = new Map((cmpOf('ga_events') || []).map(r => [r.event_name, +r.count]));
    const eventRows = d.ga_events.map(r => {
      const p = fmtPct(pct(r.count, cmpEvents.get(r.event_name)));
      return { ...r, delta: p.text, deltaCls: p.cls };
    });
    Cards.tableCard({
      title: '轉換事件', el, rows: eventRows,
      columns: [
        { key: 'event_name', label: '事件' },
        { key: 'count', label: '次數', num: true, format: num },
        ...(state.cmpData ? [{ key: 'delta', label: '變化', num: true, clsKey: 'deltaCls' }] : []),
      ],
      exp: {
        filename: `GA轉換事件_${state.from}_${state.to}`,
        fields: [
          { key: 'event_name', label: '事件' }, { key: 'count', label: '次數' },
          ...(state.cmpData ? [{ key: 'delta', label: '變化' }] : []),
        ],
        rows: eventRows,
      },
    });
  }

  function renderFbInsights() {
    const el = $('#page-fb_insights');
    if (!hasKeys('fb_page_daily')) return renderNoPermission(el);
    el.innerHTML = '';
    const d = state.data;
    Cards.chartCard({
      id: 'fb_trend', title: '觀看與互動趨勢', el, wide: true,
      types: ['line', 'smooth', 'bar'], defaultType: 'smooth',
      // 觀看與互動量級差距大，共用 y 軸會讓互動線貼近 0，改用雙 Y 軸：
      // 觀看留左軸，互動改右軸各自縮放（見 cards.js render() 的 dualAxis）
      dualAxis: true,
      datasets: { labels: d.fb_page_daily.map(r => dstr(r.date)),
        series: [
          { label: '觀看', data: d.fb_page_daily.map(r => +r.reach), color: '#1565c0' },
          { label: '互動', data: d.fb_page_daily.map(r => +r.engagement), color: '#ef6c00' },
        ] },
      compare: seriesCompare(d.fb_page_daily, cmpOf('fb_page_daily'), rows => [
        { label: '觀看', data: rows.map(r => +r.reach), color: '#1565c0' },
        { label: '互動', data: rows.map(r => +r.engagement), color: '#ef6c00' },
      ]),
      exp: {
        filename: `粉專觀看與互動_${state.from}_${state.to}`,
        fields: [{ key: 'date', label: '日期' }, { key: 'reach', label: '觀看' }, { key: 'engagement', label: '互動' },
                 ...(state.cmpData ? [
                   { key: 'reachCmp', label: '觀看（比較）' }, { key: 'engagementCmp', label: '互動（比較）' },
                 ] : [])],
        rows: d.fb_page_daily.map((r, i) => {
          const c = cmpOf('fb_page_daily')?.[i];
          return {
            date: dstr(r.date), reach: +r.reach, engagement: +r.engagement,
            ...(state.cmpData ? { reachCmp: c ? +c.reach : '', engagementCmp: c ? +c.engagement : '' } : {}),
          };
        }),
      },
    });
    Cards.chartCard({
      id: 'fb_fans', title: '追蹤者數變化', el,
      types: ['line', 'smooth', 'bar'], defaultType: 'line',
      // 追蹤者總數基期高（約 12 萬+），每日變動僅個位數～低雙位數，
      // 若 y 軸強制從 0 開始線會看起來完全平坦，改用 Chart.js 預設自動縮放
      beginAtZero: false,
      datasets: { labels: d.fb_page_daily.map(r => dstr(r.date)),
        series: [{ label: '追蹤者總數', data: d.fb_page_daily.map(r => +r.fans_total), color: '#26a69a' }] },
      compare: seriesCompare(d.fb_page_daily, cmpOf('fb_page_daily'),
        rows => [{ label: '追蹤者總數', data: rows.map(r => +r.fans_total), color: '#26a69a' }]),
      exp: {
        filename: `粉專追蹤者數_${state.from}_${state.to}`,
        fields: [{ key: 'date', label: '日期' }, { key: 'fans_total', label: '追蹤者總數' },
                 ...(state.cmpData ? [{ key: 'fansCmp', label: '追蹤者總數（比較）' }] : [])],
        rows: d.fb_page_daily.map((r, i) => ({
          date: dstr(r.date), fans_total: +r.fans_total,
          ...(state.cmpData ? { fansCmp: cmpOf('fb_page_daily')?.[i] ? +cmpOf('fb_page_daily')[i].fans_total : '' } : {}),
        })),
      },
    });
  }

  // 只接受 https:// 開頭的網址才組成可點連結，避免 javascript: 等惡意 URI 或屬性逃逸
  // （esc() 只處理 HTML 實體，貼進 href 屬性前仍需先驗證 scheme）
  function postLinkHtml(url) {
    if (!url || !/^https:\/\//i.test(url)) return '—';
    return `<a href="${esc(url)}" target="_blank" rel="noopener">查看貼文</a>`;
  }

  function renderFbPosts() {
    const el = $('#page-fb_posts');
    if (!hasKeys('fb_posts')) return renderNoPermission(el);
    el.innerHTML = '';
    const postRows = state.data.fb_posts.map(p => ({
      ...p, created_at: taipeiDate(p.created_at),
    }));
    Cards.tableCard({
      title: '近期貼文成效', el, wide: true,
      rows: postRows,
      columns: [
        { key: 'created_at', label: '日期' },
        { key: 'message', label: '內容' },
        { key: 'reach', label: '觀看', num: true, format: num },
        { key: 'likes', label: '反應', num: true, format: num },
        { key: 'comments', label: '留言', num: true, format: num },
        { key: 'shares', label: '分享', num: true, format: num },
        { key: 'permalink_url', label: '連結', format: postLinkHtml, html: true },
      ],
      exp: {
        filename: `粉專貼文成效_${state.from}_${state.to}`,
        fields: [
          { key: 'created_at', label: '日期' }, { key: 'message', label: '內容' },
          { key: 'reach', label: '觀看' }, { key: 'likes', label: '反應' },
          { key: 'comments', label: '留言' }, { key: 'shares', label: '分享' },
          { key: 'permalink_url', label: '連結' },
        ],
        rows: postRows,
      },
    });
  }

  function renderAds() {
    const el = $('#page-fb_ads');
    if (!hasKeys('ads_daily')) return renderNoPermission(el);
    el.innerHTML = '';
    const d = state.data;
    const byDate = groupSum(d.ads_daily, 'date', 'spend');
    const clicksByDate = groupSum(d.ads_daily, 'date', 'clicks');
    const cmpAds = cmpOf('ads_daily');
    const spendCb = cmpAds ? groupSum(cmpAds, 'date', 'spend') : null;
    const clicksCb = cmpAds ? groupSum(cmpAds, 'date', 'clicks') : null;
    Cards.chartCard({
      id: 'ads_spend', title: '每日花費', el,
      types: ['line', 'smooth', 'bar'], defaultType: 'bar',
      datasets: { labels: byDate.map(r => dstr(r.key)),
        series: [{ label: '花費', data: byDate.map(r => r.value), color: '#ef6c00' }] },
      compare: spendCb ? { labels: spendCb.map(r => dstr(r.key)),
        series: [{ label: '花費', data: spendCb.map(r => r.value), color: '#ef6c00' }] } : null,
      exp: {
        filename: `廣告每日花費_${state.from}_${state.to}`,
        fields: [{ key: 'date', label: '日期' }, { key: 'spend', label: '花費' },
                 ...(spendCb ? [{ key: 'spendCmp', label: '花費（比較）' }] : [])],
        rows: byDate.map((r, i) => ({
          date: dstr(r.key), spend: r.value,
          ...(spendCb ? { spendCmp: spendCb[i] ? spendCb[i].value : '' } : {}),
        })),
      },
    });
    Cards.chartCard({
      id: 'ads_clicks', title: '每日點擊', el,
      types: ['line', 'smooth', 'bar'], defaultType: 'smooth',
      datasets: { labels: clicksByDate.map(r => dstr(r.key)),
        series: [{ label: '點擊', data: clicksByDate.map(r => r.value), color: '#1565c0' }] },
      compare: clicksCb ? { labels: clicksCb.map(r => dstr(r.key)),
        series: [{ label: '點擊', data: clicksCb.map(r => r.value), color: '#1565c0' }] } : null,
      exp: {
        filename: `廣告每日點擊_${state.from}_${state.to}`,
        fields: [{ key: 'date', label: '日期' }, { key: 'clicks', label: '點擊' },
                 ...(clicksCb ? [{ key: 'clicksCmp', label: '點擊（比較）' }] : [])],
        rows: clicksByDate.map((r, i) => ({
          date: dstr(r.key), clicks: r.value,
          ...(clicksCb ? { clicksCmp: clicksCb[i] ? clicksCb[i].value : '' } : {}),
        })),
      },
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
    const cmpCampSpend = new Map();
    for (const r of (cmpOf('ads_daily') || [])) {
      cmpCampSpend.set(r.campaign_id, (cmpCampSpend.get(r.campaign_id) || 0) + Number(r.spend || 0));
    }
    const camps = [...byCamp.entries()].sort((a, b) => b[1].spend - a[1].spend).map(([id, c]) => {
      const p = fmtPct(pct(c.spend, cmpCampSpend.get(id)));
      return {
        ...c,
        cpc: c.clicks ? (c.spend / c.clicks).toFixed(1) : '—',
        cpm: c.impressions ? (c.spend / c.impressions * 1000).toFixed(1) : '—',
        spendDelta: p.text, spendDeltaCls: p.cls,
      };
    });
    Cards.tableCard({
      title: '行銷活動成效', el, wide: true, rows: camps,
      columns: [
        { key: 'campaign_name', label: '行銷活動' },
        { key: 'spend', label: '花費', num: true, format: money },
        ...(state.cmpData ? [{ key: 'spendDelta', label: '花費變化', num: true, clsKey: 'spendDeltaCls' }] : []),
        { key: 'impressions', label: '曝光', num: true, format: num },
        { key: 'clicks', label: '點擊', num: true, format: num },
        { key: 'cpc', label: 'CPC', num: true },
        { key: 'cpm', label: 'CPM', num: true },
        { key: 'conversions', label: '轉換', num: true, format: num },
      ],
      exp: {
        filename: `廣告活動成效_${state.from}_${state.to}`,
        fields: [
          { key: 'campaign_name', label: '行銷活動' }, { key: 'spend', label: '花費' },
          ...(state.cmpData ? [{ key: 'spendDelta', label: '花費變化' }] : []),
          { key: 'impressions', label: '曝光' }, { key: 'clicks', label: '點擊' },
          { key: 'cpc', label: 'CPC' }, { key: 'cpm', label: 'CPM' }, { key: 'conversions', label: '轉換' },
        ],
        rows: camps,
      },
    });
  }

  // ── 自訂報表 ─────────────────────────────────────
  const esc = v => String(v ?? '').replace(/[&<>"']/g,
    c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

  // 前端指標目錄 — 必須與後端 lib/validators.js 的 REPORT_FIELDS 一致
  // （ga_channels.users 後端雖允許，前端保留給未來，暫不列出）
  const METRICS = [
    { source: 'ga_daily', field: 'users', label: 'GA 使用者', color: '#1565c0' },
    { source: 'ga_daily', field: 'sessions', label: 'GA 工作階段', color: '#26a69a' },
    { source: 'ga_daily', field: 'pageviews', label: 'GA 瀏覽頁數', color: '#8e24aa' },
    { source: 'ga_daily', field: 'engagement_rate', label: 'GA 互動率', color: '#5c6bc0' },
    { source: 'ga_channels', field: 'sessions', label: 'GA 管道工作階段', color: '#00897b', needsChannel: true },
    { source: 'fb_page_daily', field: 'reach', label: '粉專觀看', color: '#f9a825' },
    { source: 'fb_page_daily', field: 'engagement', label: '粉專互動', color: '#ef6c00' },
    { source: 'fb_page_daily', field: 'fans_total', label: '追蹤者總數', color: '#6d4c41' },
    { source: 'fb_page_daily', field: 'fans_change', label: '追蹤者變化', color: '#78909c' },
    { source: 'ads_daily', field: 'spend', label: '廣告花費', color: '#c62828', canCampaign: true },
    { source: 'ads_daily', field: 'impressions', label: '廣告曝光', color: '#ad1457', canCampaign: true },
    { source: 'ads_daily', field: 'clicks', label: '廣告點擊', color: '#283593', canCampaign: true },
    { source: 'ads_daily', field: 'conversions', label: '廣告轉換', color: '#004d40', canCampaign: true },
  ];
  const metricDef = m => METRICS.find(x => x.source === m.source && x.field === m.field);

  function dateAxis(from, to) {
    const out = [];
    for (let d = from; d <= to; d = addDays(d, 1)) out.push(d);
    return out;
  }
  // data: /api/data 回傳；metric: config.metrics 的一項；axis: 'YYYY-MM-DD'[]
  // DATE 欄位已是 'YYYY-MM-DD' 純字串；taipeiDate 為防禦性正規化（對純字串為 no-op）
  function metricSeries(data, metric, axis) {
    const def = metricDef(metric) || { label: `${metric.source}.${metric.field}`, color: '#78909c' };
    const byDate = new Map();
    if (metric.source === 'ga_channels') {
      for (const r of data.ga_channels) if (r.channel === metric.channel)
        byDate.set(taipeiDate(r.date), (byDate.get(taipeiDate(r.date)) || 0) + Number(r[metric.field] || 0));
    } else if (metric.source === 'ads_daily') {
      for (const r of data.ads_daily) if (!metric.campaign_id || r.campaign_id === metric.campaign_id)
        byDate.set(taipeiDate(r.date), (byDate.get(taipeiDate(r.date)) || 0) + Number(r[metric.field] || 0));
    } else {
      for (const r of data[metric.source] || []) byDate.set(taipeiDate(r.date), Number(r[metric.field] || 0));
    }
    return { label: metric.label || (metric.channel ? `${def.label}（${metric.channel}）` : def.label),
             data: axis.map(d => byDate.get(d) ?? 0), color: def.color };
  }

  async function loadReports() { state.reports = (await api('/api/reports')).reports; }

  function renderCustom() {
    const el = $('#page-custom');
    // custom 報表資料不經 /api/data（見 hasKeys 用法），改直接檢查 allowed_pages：
    // /api/reports 對無權限使用者回 403，loadReports() 已在 catch 裡把 state.reports 清空，
    // 但空陣列本身無法區分「沒有報表」與「沒權限」，需要看 allowed_pages 才準確
    if (!(state.me?.allowed_pages || []).includes('custom')) return renderNoPermission(el);
    el.innerHTML = '';
    const isAdmin = state.me?.role === 'admin';
    for (const rep of state.reports) renderCustomCard(rep, el, false);
    if (isAdmin) {
      const add = document.createElement('button');
      add.id = 'add-report-btn';
      add.textContent = '＋ 新增報表';
      add.onclick = () => openReportModal(null);
      el.appendChild(add);
    }
  }

  // ── 報表精靈 ─────────────────────────────────────
  // Number('') 是 0，空值必須先擋掉，否則未選擇的列會被誤當成 METRICS[0]
  const metricAt = v => (v === '' ? null : METRICS[Number(v)]);

  function metricRowHtml(sel) {   // sel: 既有 metric 或 null
    const opts = METRICS.map((m, i) =>
      `<option value="${i}" ${sel && m.source === sel.source && m.field === sel.field ? 'selected' : ''}>${m.label}</option>`);
    return `<div class="metric-row">
      <select class="mr-metric"><option value="">— 選擇指標 —</option>${opts.join('')}</select>
      <select class="mr-channel" hidden></select>
      <select class="mr-campaign" hidden></select>
      <button type="button" class="mr-del">✕</button>
    </div>`;
  }

  // 既有報表的 channel/campaign 若不在目前區間資料中，需補一個 selected 選項保留原值，
  // 否則原生 select 會默默退回第一個選項，儲存時就改壞全部門共用的報表設定
  function channelOptions(selected) {
    const set = [...new Set(state.data.ga_channels.map(r => r.channel))].sort();
    const stale = selected && !set.includes(selected)
      ? `<option value="${esc(selected)}" selected>${esc(selected)}（不在目前區間）</option>` : '';
    return stale + set.map(c => `<option ${c === selected ? 'selected' : ''}>${esc(c)}</option>`).join('');
  }
  function campaignOptions(selected) {
    const m = new Map(state.data.ads_daily.map(r => [r.campaign_id, r.campaign_name]));
    const stale = selected && !m.has(selected)
      ? `<option value="${esc(selected)}" selected>（不在目前區間的活動 ${esc(selected)}）</option>` : '';
    return ['<option value="">全帳戶</option>', stale,
      ...[...m].map(([id, name]) => `<option value="${esc(id)}" ${id === selected ? 'selected' : ''}>${esc(name)}</option>`)].join('');
  }

  function openReportModal(rep) {
    const modal = $('#report-modal');
    $('#report-title').textContent = rep ? '編輯報表' : '新增報表';
    $('#report-name').value = rep ? rep.name : '';
    $('#report-type').value = rep ? rep.config.type : 'smooth';
    const box = $('#report-metrics');
    const metrics = rep ? rep.config.metrics : [null];
    box.innerHTML = metrics.map(m => metricRowHtml(m)).join('') +
      '<button type="button" id="mr-add">＋ 加一個指標</button>';

    function wireRow(row, sel) {
      const mSel = row.querySelector('.mr-metric');
      const ch = row.querySelector('.mr-channel');
      const cp = row.querySelector('.mr-campaign');
      function refresh() {
        const def = metricAt(mSel.value);
        ch.hidden = !def?.needsChannel; cp.hidden = !def?.canCampaign;
        if (def?.needsChannel && !ch.options.length) ch.innerHTML = channelOptions(sel?.channel);
        if (def?.canCampaign && !cp.options.length) cp.innerHTML = campaignOptions(sel?.campaign_id);
      }
      mSel.onchange = refresh;
      row.querySelector('.mr-del').onclick = () => row.remove();
      refresh();
    }
    [...box.querySelectorAll('.metric-row')].forEach((row, i) => wireRow(row, metrics[i]));
    box.querySelector('#mr-add').onclick = () => {
      const div = document.createElement('div');
      div.innerHTML = metricRowHtml(null);
      const row = div.firstElementChild;
      box.insertBefore(row, box.querySelector('#mr-add'));
      wireRow(row, null);
    };

    modal.hidden = false;
    $('#report-cancel').onclick = () => { modal.hidden = true; };
    $('#report-save').onclick = async () => {
      const name = $('#report-name').value.trim();
      const metricsOut = [...box.querySelectorAll('.metric-row')].map(row => {
        const def = metricAt(row.querySelector('.mr-metric').value);
        if (!def) return null;
        const m = { source: def.source, field: def.field };
        if (def.needsChannel) m.channel = row.querySelector('.mr-channel').value;
        const cpv = row.querySelector('.mr-campaign').value;
        if (def.canCampaign && cpv) m.campaign_id = cpv;
        return m;
      }).filter(Boolean);
      if (!name) return alert('請輸入報表名稱');
      if (!metricsOut.length) return alert('至少選一個指標');
      const body = JSON.stringify({ name, config: { type: $('#report-type').value, metrics: metricsOut } });
      try {
        if (rep) await api(`/api/reports/${rep.id}`, { method: 'PUT', body });
        else await api('/api/reports', { method: 'POST', body });
        modal.hidden = true;
        await loadReports(); renderCustom();
      } catch (err) { alert(`儲存失敗：${err.message}`); }
    };
  }

  // ── 帳號管理（僅 admin）────────────────────────────
  const PAGE_LABELS = {
    overview: '總覽', ga: 'GA 流量', fb_insights: '粉專成效',
    fb_posts: '貼文成效', fb_ads: '廣告', custom: '自訂報表',
  };

  let usersCache = [];

  async function renderUsers() {
    const el = $('#page-users');
    if (!isAdmin()) return renderNoPermission(el);
    el.innerHTML = '<button id="add-user-btn" type="button">＋ 新增帳號</button><div id="users-table-wrap"></div>';
    $('#add-user-btn').onclick = () => openUserModal(null);
    try {
      usersCache = (await api('/api/users')).users || [];
    } catch (err) {
      $('#users-table-wrap').innerHTML = `<p class="form-error">載入失敗：${esc(err.message)}</p>`;
      return;
    }
    renderUsersTable();
  }

  function renderUsersTable() {
    const wrap = $('#users-table-wrap');
    if (!wrap) return;
    const rows = usersCache.map(u => {
      const pagesBadges = (u.allowed_pages || [])
        .map(p => `<span class="badge">${esc(PAGE_LABELS[p] || p)}</span>`).join('') || '—';
      const roleLabel = u.role === 'admin' ? '管理員' : '一般使用者';
      const statusBadge = u.enabled
        ? '<span class="badge">啟用中</span>' : '<span class="badge disabled">已停用</span>';
      return `<tr data-id="${u.id}">
        <td>${esc(u.username)}</td>
        <td>${esc(u.display_name)}</td>
        <td>${esc(roleLabel)}</td>
        <td>${statusBadge}</td>
        <td>${pagesBadges}</td>
        <td class="row-actions">
          <button type="button" class="edit-user-btn">編輯</button>
          <button type="button" class="reset-pw-btn">重設密碼</button>
        </td>
      </tr>`;
    }).join('');
    wrap.innerHTML = `<table>
      <thead><tr><th>帳號</th><th>顯示名稱</th><th>角色</th><th>狀態</th><th>可視頁面</th><th>操作</th></tr></thead>
      <tbody>${rows}</tbody>
    </table>`;
    wrap.querySelectorAll('tr[data-id]').forEach(tr => {
      const id = Number(tr.dataset.id);
      const user = usersCache.find(u => u.id === id);
      tr.querySelector('.edit-user-btn').onclick = () => openUserModal(user);
      tr.querySelector('.reset-pw-btn').onclick = () => openResetPasswordModal(user);
    });
  }

  function userPagesCheckboxesHtml(checked) {
    const set = new Set(checked || []);
    return PAGES.map(p => `<label class="page-check">
        <input type="checkbox" class="user-page-cb" value="${p}" ${set.has(p) ? 'checked' : ''}> ${esc(PAGE_LABELS[p])}
      </label>`).join('');
  }

  function openUserModal(user) {   // user: 既有帳號物件（編輯模式）或 null（新增模式）
    const modal = $('#user-modal');
    const isEdit = Boolean(user);
    $('#user-title').textContent = isEdit ? '編輯帳號' : '新增帳號';
    $('#user-error').textContent = '';
    $('#user-username').value = isEdit ? user.username : '';
    $('#user-username').disabled = isEdit;
    $('#user-password').value = '';
    $('#user-password-field').hidden = isEdit;   // 編輯模式不含密碼欄，改用「重設密碼」
    $('#user-display-name').value = isEdit ? user.display_name : '';
    document.querySelectorAll('input[name="user-role-radio"]').forEach(r => {
      r.checked = r.value === (isEdit ? user.role : 'user');
    });
    $('#user-pages').innerHTML = '可視頁面：' + userPagesCheckboxesHtml(isEdit ? user.allowed_pages : ['overview']);
    // enabled 欄位：新增帳號一律預設啟用（後端 schema 預設值），編輯時才顯示切換，
    // 且必須讀入目前值 —— PUT /api/users/:id 的 enabled 為 Boolean() 強制轉型、無額外檢查，
    // 若送出 undefined 會被轉成 false，靜默停用帳號，所以務必以目前列的值預先勾選。
    $('#user-enabled-field').hidden = !isEdit;
    $('#user-enabled').checked = isEdit ? Boolean(user.enabled) : true;

    modal.hidden = false;
    $('#user-cancel').onclick = () => { modal.hidden = true; };
    $('#user-save').onclick = async () => {
      const display_name = $('#user-display-name').value.trim();
      const role = document.querySelector('input[name="user-role-radio"]:checked')?.value || 'user';
      const allowed_pages = [...document.querySelectorAll('.user-page-cb:checked')].map(cb => cb.value);
      $('#user-error').textContent = '';
      try {
        if (isEdit) {
          const enabled = $('#user-enabled').checked;   // 一律明確送出目前值，絕不省略
          const body = JSON.stringify({ display_name, role, allowed_pages, enabled });
          await api(`/api/users/${user.id}`, { method: 'PUT', body });
        } else {
          const username = $('#user-username').value.trim();
          const password = $('#user-password').value;
          const body = JSON.stringify({ username, password, display_name, role, allowed_pages });
          await api('/api/users', { method: 'POST', body });
        }
        modal.hidden = true;
        await renderUsers();
      } catch (err) {
        $('#user-error').textContent = err.message === '帳號已存在' ? '帳號已存在，請換一個' : err.message;
      }
    };
  }

  function openResetPasswordModal(user) {
    const modal = $('#reset-pw-modal');
    $('#reset-pw-error').textContent = '';
    $('#reset-pw-new').value = '';
    modal.hidden = false;
    $('#reset-pw-cancel').onclick = () => { modal.hidden = true; };
    $('#reset-pw-save').onclick = async () => {
      const newPassword = $('#reset-pw-new').value;
      $('#reset-pw-error').textContent = '';
      try {
        const body = JSON.stringify({ newPassword });
        await api(`/api/users/${user.id}/reset-password`, { method: 'POST', body });
        modal.hidden = true;
      } catch (err) {
        $('#reset-pw-error').textContent = err.message;
      }
    };
  }

  // ── 設定：改密碼 ─────────────────────────────────
  function renderSettingsPassword() {
    const el = $('#page-settings_password');
    el.innerHTML = `<form id="settings-password-form">
      <h3>改密碼</h3>
      <p id="settings-password-error" class="form-error"></p>
      <p id="settings-password-success" class="form-success"></p>
      <label>目前密碼<input type="password" id="cur-password" autocomplete="current-password"></label>
      <label>新密碼<input type="password" id="new-password" autocomplete="new-password"></label>
      <label>確認新密碼<input type="password" id="confirm-password" autocomplete="new-password"></label>
      <button type="submit">儲存</button>
    </form>`;
    $('#settings-password-form').addEventListener('submit', async e => {
      e.preventDefault();
      const oldPassword = $('#cur-password').value;
      const newPassword = $('#new-password').value;
      const confirmPassword = $('#confirm-password').value;
      $('#settings-password-error').textContent = '';
      $('#settings-password-success').textContent = '';
      if (newPassword !== confirmPassword) {
        $('#settings-password-error').textContent = '新密碼與確認新密碼不一致';
        return;
      }
      try {
        const body = JSON.stringify({ oldPassword, newPassword });
        await api('/api/me/password', { method: 'POST', body });
        $('#settings-password-success').textContent = '密碼已更新';
        $('#cur-password').value = ''; $('#new-password').value = ''; $('#confirm-password').value = '';
      } catch (err) {
        $('#settings-password-error').textContent = err.message === '目前密碼不正確' ? '目前密碼不正確' : err.message;
      }
    });
  }

  // ── 啟動 ─────────────────────────────────────────
  setRange('30');
  if (state.token) {
    // 啟動時用既有 token 呼叫 GET /api/me 驗證＋還原登入狀態，不重放帳密；
    // api() 內建 401 → logout()，這裡只需吞掉例外避免 unhandled rejection
    api('/api/me').then(me => enter(me)).catch(() => {});
  }
})();

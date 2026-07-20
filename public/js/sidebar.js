// sidebar.js — 左側選單：頁面切換、粉專群組展開/收合、手機 RWD 漢堡選單
// window.Sidebar.init({ pages, onNavigate })
//   pages: 所有合法頁面鍵值陣列（如 ['overview','ga','fb_insights','fb_posts','fb_ads','custom']）
//   onNavigate(page): 使用者點選某頁面鍵值時呼叫（Sidebar 本身只切 .page.active 的 class，
//                      不負責渲染資料，實際渲染邏輯留給呼叫端）
(function () {
  const MOBILE_BREAKPOINT = 900;
  // app.js 的 enter() 在每次成功登入後都會呼叫 Sidebar.init（同一個 user 重新整理
  // allowed_pages、或換帳號登入時刷新選單顯示範圍），但 #logout-btn 不會重新整理頁面，
  // 同一分頁內可反覆「登出→登入」而不換頁。若每次 init() 都重新 addEventListener，
  // 舊的監聽器不會被清掉，N 次登入後每個 click 會觸發 N 次，尤其是 classList.toggle()
  // 這類「翻轉」邏輯（粉專群組展開/收合、手機漢堡選單開關）會被連續呼叫偶數/奇數次
  // 而看似「隨機失靈」。用模組層級旗標讓監聽器只在同一次頁面載入中真正綁定一次；
  // 之後的 init() 呼叫只重跑 pages 驅動的顯示/隱藏邏輯。
  let initialized = false;

  function init({ pages, onNavigate } = {}) {
    const sidebar = document.querySelector('#sidebar');
    const menu = document.querySelector('#menu');
    const overlay = document.querySelector('#sidebar-overlay');
    const toggleBtn = document.querySelector('#menu-toggle');
    if (!sidebar || !menu) return;

    const pageSet = new Set(pages || []);

    // 依 pages（呼叫端已依 allowed_pages 過濾好的清單）隱藏無權限項目；
    // 粉專群組若三個子頁都被過濾掉，連父項一併隱藏
    // ── 這段每次 init() 呼叫都要重跑（換帳號登入時 allowed_pages 可能不同）──
    menu.querySelectorAll('.menu-item[data-page]').forEach(btn => {
      btn.hidden = !pageSet.has(btn.dataset.page);
    });
    const fbGroupEl = document.querySelector('#menu-fb');
    if (fbGroupEl) {
      const anyFbVisible = ['fb_insights', 'fb_posts', 'fb_ads'].some(p => pageSet.has(p));
      fbGroupEl.hidden = !anyFbVisible;
    }

    // ── 監聽器只在第一次真正綁定，之後的 init() 呼叫到此為止 ──────────
    if (initialized) return;
    initialized = true;

    // 通用群組定義：每個 .menu-group 底下的子頁鍵值集合（粉專、設定皆走同一套展開/收合邏輯，
    // 之後若再新增群組只需在此追加一筆，不必再動 setActivePage/click 綁定邏輯）
    const MENU_GROUPS = [
      { id: '#menu-fb', subPages: ['fb_insights', 'fb_posts', 'fb_ads'] },
      { id: '#menu-settings', subPages: ['settings_password', 'settings_theme'] },
    ];

    function setActivePage(page) {
      document.querySelectorAll('.page').forEach(p => p.classList.remove('active'));
      const target = document.querySelector(`#page-${page}`);
      if (target) target.classList.add('active');

      menu.querySelectorAll('.menu-item[data-page]').forEach(btn => {
        btn.classList.toggle('active', btn.dataset.page === page);
      });

      // 若選到的是某群組的子頁，父項也要顯示 active 狀態並展開群組
      for (const { id, subPages } of MENU_GROUPS) {
        const isSub = subPages.includes(page);
        const group = document.querySelector(id);
        const parent = group && group.querySelector('.menu-parent');
        if (parent) parent.classList.toggle('active', isSub);
        if (isSub && group) group.classList.add('expanded');
      }
    }

    function navigate(page) {
      if (!pageSet.has(page)) return;
      setActivePage(page);
      closeMobileMenu();
      if (typeof onNavigate === 'function') onNavigate(page);
    }

    menu.querySelectorAll('.menu-item[data-page]').forEach(btn => {
      btn.addEventListener('click', () => navigate(btn.dataset.page));
    });

    // 各群組展開/收合（粉專、設定…）
    for (const { id } of MENU_GROUPS) {
      const group = document.querySelector(id);
      const parent = group && group.querySelector('.menu-parent');
      if (parent) {
        parent.addEventListener('click', () => {
          group.classList.toggle('expanded');
        });
      }
    }

    // ── 手機 RWD：<900px 收合為漢堡選單 overlay ──────────
    function isMobile() { return window.innerWidth < MOBILE_BREAKPOINT; }

    function openMobileMenu() {
      sidebar.classList.add('mobile-open');
      if (overlay) overlay.hidden = false;
    }
    function closeMobileMenu() {
      if (!isMobile()) return;
      sidebar.classList.remove('mobile-open');
      if (overlay) overlay.hidden = true;
    }
    function toggleMobileMenu() {
      if (sidebar.classList.contains('mobile-open')) closeMobileMenu();
      else openMobileMenu();
    }

    if (toggleBtn) toggleBtn.addEventListener('click', toggleMobileMenu);
    if (overlay) overlay.addEventListener('click', closeMobileMenu);

    window.addEventListener('resize', () => {
      if (!isMobile()) {
        sidebar.classList.remove('mobile-open');
        if (overlay) overlay.hidden = true;
      }
    });
  }

  window.Sidebar = { init };
})();

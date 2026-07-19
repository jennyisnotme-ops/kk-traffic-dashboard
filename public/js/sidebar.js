// sidebar.js — 左側選單：頁面切換、粉專群組展開/收合、手機 RWD 漢堡選單
// window.Sidebar.init({ pages, onNavigate })
//   pages: 所有合法頁面鍵值陣列（如 ['overview','ga','fb_insights','fb_posts','fb_ads','custom']）
//   onNavigate(page): 使用者點選某頁面鍵值時呼叫（Sidebar 本身只切 .page.active 的 class，
//                      不負責渲染資料，實際渲染邏輯留給呼叫端）
(function () {
  const MOBILE_BREAKPOINT = 900;

  function init({ pages, onNavigate } = {}) {
    const sidebar = document.querySelector('#sidebar');
    const menu = document.querySelector('#menu');
    const overlay = document.querySelector('#sidebar-overlay');
    const toggleBtn = document.querySelector('#menu-toggle');
    if (!sidebar || !menu) return;

    const pageSet = new Set(pages || []);

    function setActivePage(page) {
      document.querySelectorAll('.page').forEach(p => p.classList.remove('active'));
      const target = document.querySelector(`#page-${page}`);
      if (target) target.classList.add('active');

      menu.querySelectorAll('.menu-item[data-page]').forEach(btn => {
        btn.classList.toggle('active', btn.dataset.page === page);
      });

      // 若選到的是粉專子頁，父項也要顯示 active 狀態並展開群組
      const isFbSub = page === 'fb_insights' || page === 'fb_posts' || page === 'fb_ads';
      const fbGroup = document.querySelector('#menu-fb');
      const fbParent = fbGroup && fbGroup.querySelector('.menu-parent');
      if (fbParent) fbParent.classList.toggle('active', isFbSub);
      if (isFbSub && fbGroup) fbGroup.classList.add('expanded');
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

    // 粉專群組展開/收合
    const fbGroup = document.querySelector('#menu-fb');
    const fbParent = fbGroup && fbGroup.querySelector('.menu-parent');
    if (fbParent) {
      fbParent.addEventListener('click', () => {
        fbGroup.classList.toggle('expanded');
      });
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

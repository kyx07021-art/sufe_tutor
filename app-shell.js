/**
 * 壳与路由层（目标分层：状态管理层下游）—— 视图切换 / 侧边栏 / 页面注册表 / 统一装载器 / 红点徽标 / 初始化
 *
 * #175（v0.25.76）：领域脚本（app-region/posts/chat/contracts/chart/admin/demands/teachers/pages 等）不再
 * 于 index.html 同步加载——enterClient 时经 loadDomainScripts() 按 manifest 哈希名动态注入；
 * ROLE_PAGES 的 enter 全为惰性包装（() => 领域函数()），顶层不直接引用领域函数。
 *
 * 职责：
 *   - 视图管理（landing/login/register/invite-gate/client 五视图）
 *   - 侧边栏栏目注册表 ROLE_PAGES（加栏目 = 这里一条 + index.html 一个 section + 一个 enter 函数）
 *   - 统一装载器 loadInto（loading/空态/错误转义/浮入/乱序守卫 四件套，禁止手写）
 *   - 红点徽标慢轮询（30s，全角色；各模块也可即时 setBadge 消点）
 *   - 通知信息页（全角色）
 *   - DOMContentLoaded 初始化（落地页恒为入口 + 新手引导；v0.24.1 删自动登录）
 */
const VIEWS = ['landing', 'login', 'register', 'invite-gate', 'client'];

function showView(name) {
  VIEWS.forEach(v => { const el = document.getElementById(`view-${v}`); if (el) el.classList.add('hidden'); });
  const target = document.getElementById(`view-${name}`);
  if (target) target.classList.remove('hidden');
  state.view = name;
  if (name === 'login') refreshAuthHeader(); // 登录页标题按来路切换（访客被导向 vs 主动登录）
  updateNavbar();
}

function goHome() { state.user ? enterClient() : showView('landing'); }

function updateNavbar() {
  const el = document.getElementById('navbar-actions');
  if (state.user) {
    const u = state.user;
    const roleLabel = DISP.roleLabel(u.role);
    // 退出登录已迁至「账户设置」页底（含二次确认），导航栏只留身份标识
    el.innerHTML = `<div class="navbar-user">
      <span>${escHtml(u.username)}</span><span class="user-badge glass${u.role === 'admin' ? ' admin-badge glass' : ''}">${roleLabel}</span></div>`;
  } else {
    el.innerHTML = `<button class="btn btn-ghost glass glass--pressable" onclick="showView('login')">${UI.NAV_LOGIN}</button>
      <button class="btn btn-sm glass glass--pressable" onclick="showView('register')">${UI.NAV_REGISTER}</button>`;
  }
}

// ============================================================
// 客户端配置：侧边栏栏目注册表
// #175（v0.25.76）：领域脚本懒加载——enter 一律惰性包装（() => 领域函数()），
// 顶层不再直接引用领域函数（领域脚本进入客户端时才注入，顶层引用会 ReferenceError）；
// enterClient 先 await loadDomainScripts() 再 selectPage，点击侧栏时领域必已就绪
// ============================================================
const ROLE_PAGES = {
  student: [
    { id: 'my-demands',       label: UI.PAGE_MY_DEMANDS,      desc: UI.PAGE_MY_DEMANDS_DESC,      enter: () => loadMyDemands() },
    { id: 'browse-teachers',  label: UI.PAGE_BROWSE_TEACHERS, desc: UI.PAGE_BROWSE_TEACHERS_DESC, enter: () => loadTeachers(), auth: false },
    { id: 'my-chats',         label: UI.PAGE_MY_CHATS,        desc: UI.PAGE_MY_CHATS_DESC,        enter: () => enterMyChats() },
    { id: 'my-contracts',     label: UI.PAGE_MY_CONTRACTS,    desc: UI.PAGE_MY_CONTRACTS_DESC,    enter: () => loadMyContracts() },
    { id: 'notifications',    label: UI.PAGE_NOTIFICATIONS,   desc: UI.PAGE_NOTIFICATIONS_DESC,   enter: enterNotifications },
    { id: 'account-settings', label: UI.PAGE_ACCOUNT_SETTINGS, desc: UI.PAGE_ACCOUNT_SETTINGS_DESC, enter: () => enterAccountSettings() },
    { id: 'about',            label: UI.PAGE_ABOUT,           desc: UI.PAGE_ABOUT_DESC,           enter: () => enterAbout(), auth: false },
  ],
  teacher: [
    { id: 'browse-demands',   label: UI.PAGE_BROWSE_DEMANDS,  desc: UI.PAGE_BROWSE_DEMANDS_DESC,  enter: () => loadBrowseDemands(), auth: false },
    { id: 'browse-teachers',  label: UI.PAGE_BROWSE_TEACHERS, desc: UI.PAGE_BROWSE_TEACHERS_PEER_DESC, enter: () => loadTeachers(), auth: false },
    { id: 'resource-share',   label: UI.PAGE_RESOURCE_SHARE,  desc: UI.PAGE_RESOURCE_SHARE_DESC,  enter: () => enterResourceShare(), auth: false },
    { id: 'my-chats',         label: UI.PAGE_MY_CHATS,        desc: UI.PAGE_MY_CHATS_DESC,        enter: () => enterMyChats() },
    { id: 'my-contracts',     label: UI.PAGE_MY_CONTRACTS,    desc: UI.PAGE_MY_CONTRACTS_DESC,    enter: () => loadMyContracts() },
    { id: 'edit-profile',     label: UI.PAGE_EDIT_PROFILE,    desc: UI.PAGE_EDIT_PROFILE_DESC,    enter: () => initProfileForm() },
    { id: 'notifications',    label: UI.PAGE_NOTIFICATIONS,   desc: UI.PAGE_NOTIFICATIONS_DESC,   enter: enterNotifications },
    { id: 'account-settings', label: UI.PAGE_ACCOUNT_SETTINGS, desc: UI.PAGE_ACCOUNT_SETTINGS_DESC, enter: () => enterAccountSettings() },
    { id: 'about',            label: UI.PAGE_ABOUT,           desc: UI.PAGE_ABOUT_DESC,           enter: () => enterAbout(), auth: false },
  ],
  admin: [
    { id: 'admin-stats',      label: UI.PAGE_ADMIN_STATS,    desc: UI.PAGE_ADMIN_STATS_DESC,    enter: () => loadAdminStats() },
    { id: 'admin-traffic',    label: UI.PAGE_ADMIN_TRAFFIC,  desc: UI.PAGE_ADMIN_TRAFFIC_DESC,  enter: () => loadAdminTraffic() },
    { id: 'admin-students',   label: UI.PAGE_ADMIN_STUDENTS, desc: UI.PAGE_ADMIN_STUDENTS_DESC, enter: () => loadAdminStudents() },
    { id: 'admin-teachers',   label: UI.PAGE_ADMIN_TEACHERS, desc: UI.PAGE_ADMIN_TEACHERS_DESC, enter: () => loadAdminTeachers() },
    { id: 'admin-demands',    label: UI.PAGE_ADMIN_DEMANDS,  desc: UI.PAGE_ADMIN_DEMANDS_DESC,  enter: () => loadAdminDemands() },
    { id: 'admin-reviews',    label: UI.PAGE_ADMIN_REVIEWS,  desc: UI.PAGE_ADMIN_REVIEWS_DESC,  enter: () => loadAdminReviews() },
    { id: 'admin-posts',      label: UI.PAGE_ADMIN_POSTS,    desc: UI.PAGE_ADMIN_POSTS_DESC,    enter: () => loadAdminPosts() },
    { id: 'admin-contracts',  label: UI.PAGE_ADMIN_CONTRACTS, desc: UI.PAGE_ADMIN_CONTRACTS_DESC, enter: () => loadAdminContracts() },
    { id: 'admin-feedback',   label: UI.PAGE_ADMIN_FEEDBACK, desc: UI.PAGE_ADMIN_FEEDBACK_DESC, enter: () => loadAdminFeedback() },
    { id: 'admin-complaint',  label: UI.PAGE_ADMIN_COMPLAINT, desc: UI.PAGE_ADMIN_COMPLAINT_DESC, enter: () => loadAdminComplaints() },
    { id: 'notifications',    label: UI.PAGE_NOTIFICATIONS,  desc: UI.PAGE_NOTIFICATIONS_DESC,  enter: enterNotifications },
    { id: 'account-settings', label: UI.PAGE_ACCOUNT_SETTINGS, desc: UI.PAGE_ACCOUNT_SETTINGS_DESC, enter: () => enterAccountSettings() },
    { id: 'about',            label: UI.PAGE_ABOUT,          desc: UI.PAGE_ABOUT_DESC,          enter: () => enterAbout(), auth: false },
  ],
};

// ------------------------------------------------------------
// 领域脚本懒加载（#175 v0.25.76）：领域脚本从 index.html 移除，进入客户端时才按序动态注入。
// - DOMAIN_FILES 与 hash-assets.mjs 的清单必须同步（构建脚本哈希它们 + 写入 manifest）
// - 哈希名：window.ASSET_MANIFEST（构建时内联进 index.html）命中优先，缺省回落基名（源/测试环境）
// - 幂等哨兵：__domainLoaded 或领域函数已存在（测试 FILES 全载）即短路，不重复注入
// - 注入失败/超时 6s 兜底放行（进页后再点侧栏由下次尝试补载），绝不永久挂起
// - 注入按序（经典脚本共享作用域、依赖链按 index.html 原序）→ 用 Promise 链保序
// ------------------------------------------------------------
const DOMAIN_FILES = [
  'region-data.js', 'app-style.js', 'app-region.js', 'app-posts.js', 'app-chat.js',
  'app-contracts.js', 'app-chart.js', 'app-admin.js', 'app-demands.js', 'app-teachers.js', 'app-pages.js', 'app-complaints.js',
];
let __domainLoaded = false;
let __domainLoading = null; // #178 并发防重：预载与 enterClient 同时调 loadDomainScripts 时共享同一次注入
function loadDomainScripts() {
  if (__domainLoaded || typeof globalThis.loadMyDemands === 'function') return Promise.resolve(); // 已载/测试短路
  if (__domainLoading) return __domainLoading; // 注入已在途：复用同一 Promise，杜绝重复注入
  __domainLoading = (async () => {
    const manifest = (window.ASSET_MANIFEST || {}).files || {};
    const inject = f => new Promise(resolve => {
      const s = document.createElement('script');
      s.src = '/' + (manifest[f] || f);
      s.onload = s.onerror = resolve; // 单脚本失败不阻断后续（缺个别模块下次补）
      (document.head || document.documentElement).appendChild(s);
    });
    for (const f of DOMAIN_FILES) await inject(f);
    __domainLoaded = true;
  })();
  return __domainLoading;
}

// #178（v0.25.85）：领域脚本后台静默预载——落地页渲染完成后即开始注入，
// 点击角色按钮进客户端时 loadDomainScripts 已就绪 → 下一帧即进入客户端（消除 ~0.5s 无事发生期）。
// requestIdleCallback 空闲调度（fallback setTimeout），绝不影响首屏；幂等（已载短路）。
let __preloaded = false;
function preloadDomainScripts() {
  if (__preloaded) return;
  __preloaded = true;
  const run = () => loadDomainScripts();
  if (typeof requestIdleCallback === 'function') requestIdleCallback(run, { timeout: 2000 });
  else setTimeout(run, 500);
}

// ------------------------------------------------------------
// 客户端壳：侧边栏 + 页面区（栏目由 ROLE_PAGES 配置驱动）
// ------------------------------------------------------------
function pagesForRole() {
  const role = state.user ? state.user.role : state.guestRole; // 访客以主页按钮所选角色看栏目
  return ROLE_PAGES[role] || [];
}

function defaultPageFor() {
  // 访客落在首个公开浏览页（先逛起来，需要身份时再由 ensureAuth 导向登录）；登录用户落第一栏
  if (!state.user) return state.guestRole === 'teacher' ? 'browse-demands' : 'browse-teachers';
  return (pagesForRole()[0] || { id: 'my-demands' }).id;
}

async function enterClient(pageId) {
  await loadDomainScripts(); // #175：进入客户端前确保领域脚本就绪（首访注入、回访缓存命中秒回）
  renderSidebar();
  showView('client');
  // v0.25.95（用户反馈「刷新不要回首页」）：刷新/进入客户端统一恢复页面停留——selectPage 记录的
  // sufe_last_page 在身份可见时恢复；pageId 显式传入（登录/切角色回跳）优先，身份不可见自动回落默认页
  const stored = getLastPage();
  const valid = pageId && pagesForRole().some(p => p.id === pageId) ? pageId
    : (stored && pagesForRole().some(p => p.id === stored) ? stored : defaultPageFor());
  // v0.24.0：不阻塞登录——默认页签立即渲染（自身走正常加载），
  // 其余模块数据此刻开始后台并行预取（fire-and-forget），用户在页面里待着时就已全部就绪；
  // 预取在途时点进某模块由 dhReady 跳过 loader 闪屏，读取完即显示
  selectPage(valid);
  if (state.user) {
    startBadgePoll(); // 红点轮询仅登录态开启（访客无个人数据可轮询）
    startVersionProbe();
    dhPrefetch(state.user.role);
  } else if (state.guestRole) {
    // v0.24.0：访客预览也开启版本探测 + 静默预取公开数据（与所在模块无关）
    startVersionProbe();
    dhPrefetch(state.guestRole === 'teacher' ? 'teacher-guest' : 'student-guest');
  }
  closeSidebar();
  document.getElementById('client-main').scrollTop = 0;
}

function renderSidebar() {
  const u = state.user;
  const isAdmin = u && u.role === 'admin';
  // 用户块置侧边栏最下方（白底落地）：头像 + id + 灰小字属性。访客态显示「未登录」占位块
  const userBlock = u ? `
    <button type="button" class="sidebar-user-top sidebar-user-btn" onclick="openProfilePanel(${u.id})" title="${UI.PROFILE_PANEL_TITLE}">
      ${renderAvatarHtml(u.avatar, u.username, 'sidebar-user-avatar')}
      <div class="sidebar-user-text">
        <div class="sidebar-user-name">${escHtml(u.username)}</div>
        <div class="sidebar-user-role">${DISP.roleLabel(u.role)}</div>
      </div>
    </button>` : `
    <button type="button" class="sidebar-user-top sidebar-user-btn" onclick="ensureAuth()">
      <span class="avatar sidebar-user-avatar avatar--guest glass" aria-hidden="true">?</span>
      <div class="sidebar-user-text">
        <div class="sidebar-user-name sidebar-user-name--guest">${UI.GUEST_NOT_LOGGED_IN}</div>
        <div class="sidebar-user-role">${UI.GUEST_TAP_TO_LOGIN}</div>
      </div>
    </button>`;
  document.getElementById('sidebar-user').innerHTML = `
    ${userBlock}
    <button type="button" class="sidebar-footnote" onclick="selectPage('about')">${escHtml(UI.ABOUT_FOOTNOTE.replace('{feedback}', UI.BTN_FEEDBACK))}</button>
    <div class="sidebar-version">v${APP_CONSTANTS.APP_VERSION}</div>`;
  document.getElementById('sidebar-nav').innerHTML =
    // v0.25.94（用户反馈「灰色块乱窜，别搞特殊」）：删绝对定位 .sidebar-pill 覆盖层——active 高亮改由
    // 条目自身 .sidebar-item.active 的 background 承载（流内标准组件，缩放/拖动天然同步，零 JS 几何）。
    pagesForRole().map((p, i) => `
    <button type="button" class="sidebar-item${p.id === state.page ? ' active' : ''}" data-page="${p.id}" onclick="selectPage('${p.id}')">
      <span class="sidebar-item-index" aria-hidden="true">${String(i + 1).padStart(CONFIG.SIDEBAR_INDEX_PAD, '0')}</span>
      <span class="sidebar-item-body">
        <span class="sidebar-item-label">
          <span>${p.label}</span>
        </span>
        <span class="sidebar-item-descwrap"><span class="sidebar-item-desc">${p.desc || ''}</span></span>
      </span>
      ${BADGE_PAGES.includes(p.id) ? `<span class="sidebar-dot hidden" id="sidebar-${p.id}-dot"></span>` : ''}
    </button>`).join('');
  document.getElementById('sidebar-invite').classList.toggle('hidden', !isAdmin);
}

// 页面顶部 title 旁「i」信息按钮（用户反馈 2026-08-08：加小 i 的地方是页面内顶上 title 的旁边，不是侧边栏内）：
// selectPage 按当前页幂等注入到 .page-header，点开标准信息浮窗，文案单源 constants UI.MODULE_INFO。
function openModuleInfo(pageId) {
  const cfg = pagesForRole().find(p => p.id === pageId);
  const info = UI.MODULE_INFO && UI.MODULE_INFO[pageId];
  if (!info) return;
  // v0.25.12（反馈 #95）：介绍改为结构化 Markdown（## 小标题 + 段落 + **加粗**），
  // 复用 app-posts 的 mdRender（escHtml 先转义安全）；v0.25.48（需求三十一）文本浮窗统一走 modal--wide
  openModal({
    title: escHtml(cfg ? cfg.label : ''),
    cls: 'modal--wide',
    bodyCls: 'module-info-md',
    body: mdRender(info),
  });
}

/** i 信息按钮构造（v0.25.14 复用单源）：模块 title 旁小圆 i，带 a11y（Enter/Space 同开），
 *  点开标准信息浮窗（openModuleInfo）。聊天自绘 title（.chats-list-title）由 enterMyChats 复用本构造，
 *  页面级 i 由 injectPageHeaderInfo 复用——两处共用同一外观/交互，免维护两套。 */
function createModuleInfoBtn(pageId) {
  const btn = document.createElement('span');
  btn.className = 'page-header-info';
  btn.setAttribute('role', 'button');
  btn.setAttribute('tabindex', '0');
  btn.setAttribute('aria-label', UI.MODULE_INFO_TIP);
  btn.setAttribute('title', UI.MODULE_INFO_TIP);
  btn.textContent = 'i';
  btn.addEventListener('click', e => { e.stopPropagation(); openModuleInfo(pageId); });
  btn.addEventListener('keydown', e => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); e.stopPropagation(); openModuleInfo(pageId); } });
  return btn;
}

/** 页头 i 按钮注入（v0.25.10）：selectPage 切页汇聚点调用，按 pageId 定位当前页 .page-header 幂等插入。
 *  my-chats 页头被 .client-page--flush 隐藏（标题由聊天页自有区渲染，见 enterMyChats），跳过注入。 */
function injectPageHeaderInfo(pageId) {
  const old = document.querySelector('.page-header-info');
  if (old) old.remove();
  const hdr = document.querySelector('#client-main .client-page:not(.hidden) .page-header');
  if (!hdr || pageId === 'my-chats') return;
  const info = UI.MODULE_INFO && UI.MODULE_INFO[pageId];
  if (!info) return;
  const btn = createModuleInfoBtn(pageId);
  // v0.25.12（反馈 #89）：h2 与 i 必须同组靠左——.page-header 是 space-between，直接 after(h2)
  // 会把 i 顶到最右。包进 .page-header-title 组（幂等：已包裹则复用），组 gap 统一间距
  const h2 = hdr.querySelector('h2');
  if (h2) {
    const p = h2.parentNode;
    let group = p && p.classList && p.classList.contains('page-header-title') ? p : null;
    if (!group) {
      group = document.createElement('span');
      group.className = 'page-header-title';
      h2.parentNode.insertBefore(group, h2);
      group.appendChild(h2);
    }
    group.appendChild(btn);
  } else {
    hdr.appendChild(btn);
  }
}

function selectPage(pageId) {
  const prevPage = state.page; // 2026-08-09 反馈：记录离开页，供切出通知/会话页时"看过即消"批量已读
  closeProfilePanel(); // 切页收起个人信息右栏
  document.querySelectorAll('#client-main .client-page').forEach(s =>
    s.classList.toggle('hidden', s.dataset.page !== pageId));
  document.querySelectorAll('#sidebar-nav .sidebar-item').forEach(b =>
    b.classList.toggle('active', b.dataset.page === pageId)); // v0.25.94：active 高亮由条目自身 background 承载，切类即同步
  state.page = pageId;
  savePageState(pageId); // v0.25.95：记录页面停留，供刷新恢复（app-state 会话层统一能力）
  if (pageId !== 'my-chats' && typeof stopChatPolling === 'function') stopChatPolling(); // 切离聊天页即停轮询
  const cfg = pagesForRole().find(p => p.id === pageId);
  if (cfg && cfg.auth !== false && !ensureAuth()) return; // 需要身份的页统一过登录通路
  // 2026-08-09 反馈：看过即消——离开通知页把已展示的未读批量标记正常（免逐条点击）；离开聊天页把当前会话已读
  if (prevPage === 'notifications' && pageId !== 'notifications') markAllNotifsRead();
  if (prevPage === 'my-chats' && pageId !== 'my-chats' && typeof markActiveConvRead === 'function') markActiveConvRead();
  injectPageHeaderInfo(pageId); // v0.25.10：页面顶部 title 旁 i 按钮（侧边栏内的已删）
  if (cfg && cfg.enter) cfg.enter();
  closeSidebar();
  document.getElementById('client-main').scrollTop = 0;
}

// v0.25.94：删 sidebarPillGlide（原 glidePill 逐帧追逐）——active 高亮由条目自身承载，开合/缩放无需重绑
function closeSidebar()  { document.body.classList.remove('sidebar-open'); }
function toggleSidebar() { document.body.classList.toggle('sidebar-open'); }

// ============================================================
// 统一装载器：loading → 取数 → 空态/渲染/浮入，错误转义统一。
// seqKey 有值 → 内置乱序守卫（同 key 后发的请求到达后，先前在途响应一律丢弃）；
// opts: { empty: 空态文案, pick: data→rows 提取器, reveal: 是否接入浮入(默认 true) }
// 返回是否真正渲染了内容（切走页面/乱序丢弃时为 false）
// ============================================================
async function loadInto(elId, fetcher, renderer, opts = {}) {
  const el = document.getElementById(elId);
  if (!el) return false;
  // 计数器首用初始化：++undefined = NaN，而 NaN !== NaN 恒真 → 首次装载会被误判「乱序」而丢弃
  const seq = opts.seqKey ? (loadSeqs[opts.seqKey] = (loadSeqs[opts.seqKey] || 0) + 1) : null;
  // v0.23.0 静默数据层：会话缓存命中 → 跳过 loader 闪烁直出（切 tab 秒开）。
  // 仍走 fetcher（dhGet 瞬时返回缓存）以同步模块级镜像（state.*），保证跨功能查找与渲染一致；
  // 缓存 miss/过期 → 正常 loader + 按需加载
  const cachedHit = typeof opts.peek === 'function' && opts.peek() != null;
  if (!cachedHit) el.innerHTML = `<div class="empty-state">${loaderHtml()}</div>`;
  try {
    const data = await fetcher();
    if (seq != null && seq !== loadSeqs[opts.seqKey]) return false;
    const rows = opts.pick ? opts.pick(data) : data;
    const target = document.getElementById(elId);
    if (!target) return false;
    if (!rows || !rows.length) { target.innerHTML = `<div class="empty-state"><p>${opts.empty || ''}</p></div>`; return true; }
    target.innerHTML = renderer(rows);
    if (opts.reveal !== false && typeof initReveals === 'function') initReveals(target);
    return true;
  } catch (err) {
    if (seq != null && seq !== loadSeqs[opts.seqKey]) return false;
    const target = document.getElementById(elId);
    if (target) target.innerHTML = `<div class="empty-state"><p>${UI.ERROR_LOAD_PREFIX}${escHtml(err.message)}</p></div>`;
    return false;
  }
}

// ============================================================
// 侧边栏红点徽标：未读会话 / 待处理推送(教师) / 未读通知 / 待处理意向(学生) / 待我处理合同 / 未处理反馈(admin)，
// 30s 慢轮询统一刷新；各模块也可即时 setBadge 消点
// ============================================================
// 修复：原缺 'my-demands'——学生「我的需求」待处理意向红点四条 setBadge 写入全空转（dot 元素永不渲染）。
// 此清单 = 允许挂红点的页面 id，须与 ROLE_PAGES 的 id 一致（教师/管理员的 my-demands 不在其角色页表，
// 元素不渲染，setBadge 对 null 静默返回，无副作用）
const BADGE_PAGES = ['my-chats', 'browse-demands', 'my-demands', 'notifications', 'my-contracts', 'admin-feedback'];
let badgePollTimer = null;

function setBadge(pageId, n) {
  const dot = document.getElementById(`sidebar-${pageId}-dot`);
  if (dot) dot.classList.toggle('hidden', !n);
}

function startBadgePoll() { stopBadgePoll(); refreshBadges(); badgePollTimer = setInterval(refreshBadges, CONFIG.BADGE_POLL_MS); }
function stopBadgePoll() { if (badgePollTimer) { clearInterval(badgePollTimer); badgePollTimer = null; } BADGE_PAGES.forEach(p => setBadge(p, 0)); }

async function refreshBadges() {
  if (!state.user) return;
  try {
    // v0.23.0 静默数据层：徽标轮询改走会话数据层统一出口——与 tab 加载共享同一份缓存（单请求源），
    // 版本探测使缓存 ≤8s 新鲜，徽标天然跟得上数据变化
    const [convData, notifData] = await Promise.all([
      dhGet('/api/conversations', { domain: 'chat' }),
      dhGet('/api/notifications', { domain: 'notifications' }),
    ]);
    const chatUnread = (convData.conversations || []).reduce((s, c) => s + (c.unread_count || 0), 0);
    // v0.25.95（用户反馈）：屏蔽系统通知后广播公告未读不再计入侧边栏红点——红点与屏蔽过滤同口径
    // （列表页屏蔽过滤 isBroadcastNotif + notifBlockOn 同源，此二函数声明在下方，function 声明提升可用）
    const notifUnread = (notifData.notifications || []).filter(n => !n.is_read && !(notifBlockOn() && isBroadcastNotif(n))).length;
    // 红点铁律：正在看的页签不写徽标——点开瞬间本地清零后，轮询不许把它再点亮
    if (state.page !== 'my-chats') setBadge('my-chats', chatUnread);
    if (state.page !== 'notifications') setBadge('notifications', notifUnread);
    if (state.user.role === 'teacher') {
      const pushData = await dhGet('/api/demand-pushes', { domain: 'demands' });
      if (state.page !== 'browse-demands') setBadge('browse-demands', (pushData.pushes || []).length);
      setBadge('my-demands', 0);
    } else if (state.user.role === 'student') {
      const demandData = await dhGet('/api/student/demands?scope=mine', { domain: 'demands' });
      setBadge('my-demands', (demandData.demands || []).filter(d => d.pending_intents > 0).length);
      setBadge('browse-demands', 0);
    } else {
      setBadge('browse-demands', 0); setBadge('my-demands', 0);
      // 管理员用户反馈红点：未处理条数
      try {
        const fbData = await dhGet(`/api/feedbacks`, { domain: 'admin' });
        const openFb = (fbData.feedbacks || []).filter(f => f.status !== STATUS.RESOLVED).length;
        if (state.page !== 'admin-feedback') setBadge('admin-feedback', openFb);
      } catch { /* 静默，下一轮自愈 */ }
      // R22 管理员投诉红点：独立通道未处理条数
      try {
        const cpData = await dhGet(`/api/complaints`, { domain: 'admin' });
        const openCp = (cpData.complaints || []).filter(c => c.status !== STATUS.RESOLVED).length;
        if (state.page !== 'admin-complaint') setBadge('admin-complaint', openCp);
      } catch { /* 静默，下一轮自愈 */ }
    }
    // 我的合同红点：待我处理的合同数；正停留在合同页则就地刷新列表（对方改动 ≤30s 可见）。
    // v0.22.8：列表签名未变不整列重渲——原实现每 30s 轮询即使数据没变也 innerHTML 重写整列 + initReveals
    if (state.user.role === 'student' || state.user.role === 'teacher') {
      const ctData = await dhGet('/api/contracts/my', { domain: 'contracts' });
      const contracts = ctData.contracts || [];
      if (state.page === 'my-contracts') {
        const sig = contracts.map(c => `${c.id}:${c.status}`).join(',');
        if (sig !== _lastContractSig) {
          _lastContractSig = sig;
          state.myContracts = contracts;
          if (typeof renderMyContractsList === 'function') renderMyContractsList();
        }
      } else {
        setBadge('my-contracts', contracts.filter(c => typeof contractActionable === 'function' && contractActionable(c)).length);
      }
    } else setBadge('my-contracts', 0);
  } catch { /* 静默，下一轮自愈 */ }
}

// ============================================================
// 通知信息页（全角色）：#151 起未读持久到点击消除（markNotifRead 单条已读，不再进入即批量全读）；
// 屏蔽系统通知为纯客户端偏好（localStorage），只动渲染层
// ============================================================
let _notifList = [];
let _lastContractSig = ''; // 合同列表渲染签名（v0.22.8：30s 轮询数据未变不整列重渲）
// v0.23.1 审计 M1：探测刷新替换缓存数组后重挂 _notifList——屏蔽过滤与已读翻转依赖同引用
if (typeof dhOnDomainRefresh === 'function') {
  dhOnDomainRefresh('notifications', () => {
    const c = dhPeek('/api/notifications');
    if (c && c.notifications) _notifList = c.notifications;
  });
}
// 屏蔽系统通知偏好：纯客户端、跨会话持久化（键名 sufe_block_broadcast，布尔；同 setThemePref 存取模式）
// 广播判定单点（需求四·4b 重构后收敛回来：屏蔽按钮过滤 + 进页渲染两处共用，NOTIFY_BROADCAST_PREFIX 前缀单源）
function isBroadcastNotif(n) { return String(n.text || '').startsWith(UI.NOTIFY_BROADCAST_PREFIX); }
function notifBlockOn() { try { return localStorage.getItem(CONFIG.NOTIF_BLOCK_KEY) === '1'; } catch { return false; } }
function setNotifBlock(v) { try { localStorage.setItem(CONFIG.NOTIF_BLOCK_KEY, v ? '1' : '0'); } catch { /* 存储被禁：本次不持久 */ } }
function renderNotifList() { // 复用渲染逻辑：按偏好过滤 _notifList 即时重排，不重新请求
  const el = document.getElementById('notifications-content');
  if (!el || !_notifList.length) return;
  const shown = notifBlockOn() ? _notifList.filter(n => !isBroadcastNotif(n)) : _notifList;
  el.innerHTML = shown.length ? shown.map(renderNotifItem).join('')
    : `<div class="empty-state"><p>${escHtml(UI.NOTIF_FILTER_EMPTY)}</p></div>`;
}
function syncNotifBlockBtn() { // 按偏好同步按钮文字与选中态（颜色不变，选中态 = 前置小圆点）
  const btn = document.getElementById('btn-notif-block');
  if (!btn) return;
  const on = notifBlockOn();
  btn.classList.toggle('notif-block-btn--on', on);
  btn.textContent = on ? UI.NOTIF_BLOCK_ON : UI.NOTIF_BLOCK_OFF;
}
function toggleNotifBlock() { // 按钮切换：写偏好 + 同步按钮态 + 即时重排列表
  setNotifBlock(!notifBlockOn());
  syncNotifBlockBtn();
  renderNotifList();
}
async function enterNotifications() {
  setBadge('notifications', 0); // 点开瞬间红点即灭（先于任何请求，轮询跳过当前页不复活）
  // 管理员独享「发通知」（系统广播）；其他角色隐藏
  const bb = document.getElementById('btn-broadcast-notif');
  if (bb) bb.classList.toggle('hidden', !(state.user && state.user.role === 'admin'));
  syncNotifBlockBtn(); // 进页按持久化偏好标按钮态
  await loadInto('notifications-content', async () => {
    const data = await dhGet('/api/notifications', { domain: 'notifications' }); // v0.23.0 静默数据层
    _notifList = data.notifications || [];
    return _notifList;
  }, rows => {
    const shown = notifBlockOn() ? rows.filter(n => !isBroadcastNotif(n)) : rows;
    if (!shown.length) return `<div class="empty-state"><p>${escHtml(UI.NOTIF_FILTER_EMPTY)}</p></div>`;
    return shown.map(renderNotifItem).join('');
  }, { empty: UI.EMPTY_NO_NOTIFICATIONS, peek: () => dhReady('/api/notifications') });
  // #151：不再进入即批量全读——未读持久到单条点击消除（markNotifRead），徽标在离开本页后由轮询反映余量
}

function renderNotifItem(n) {
  const id = /^\d+$/.test(String(n.id)) ? String(n.id) : '';
  // #151（v0.25.59）：未读通知可点击/键盘消除——data-id 供 markNotifRead 精确定位；已读项无交互
  const interact = n.is_read ? '' :
    ` role="button" tabindex="0" aria-label="${escHtml(UI.NOTIF_READ_ARIA)}" onclick="markNotifRead('${id}')" onkeydown="notifKeyRead(event, '${id}')"`;
  return `<div class="notif-item glass${n.is_read ? '' : ' unread'}" data-id="${id}"${interact}>
      <span class="notif-dot${n.is_read ? ' read' : ''}"></span>
      <div class="notif-body">
        <div class="notif-text">${renderNotifContent(n.text)}</div>
        <div class="notif-time">${fmtDateTime(n.created_at)}</div>
      </div>
    </div>`;
}

// #151（v0.25.59）：未读通知呼吸遮罩点击消除——单条标记已读。本地先翻（_notifList 与 datahub 缓存
// 同数组引用，徽标/屏蔽重排即时一致），成功后服务端落库；失败回滚。服务端不 bump 版本域
// （纯个人游标，与旧批量已读同口径），客户端翻缓存即全站一致。
async function markNotifRead(id) {
  if (!/^\d+$/.test(String(id || ''))) return;
  const item = _notifList.find(n => String(n.id) === String(id));
  if (!item || item.is_read) return;
  const el = document.querySelector(`.notif-item[data-id="${id}"]`);
  item.is_read = 1;
  if (el) applyNotifReadVisual(el, true);
  try {
    await api(`/api/notifications/${id}/read`, { method: 'POST', body: {} });
  } catch {
    item.is_read = 0;
    if (el) applyNotifReadVisual(el, false);
  }
}
// 2026-08-09 反馈：看过即消——离开通知页批量已读（免逐条点击）。乐观翻转本地（_notifList 与 datahub
// 缓存同数组引用，徽标/重排即时一致），POST read-all 落库；失败回滚本次翻转。未进过通知页则 _notifList 空，天然 no-op。
async function markAllNotifsRead() {
  const unread = _notifList.filter(n => !n.is_read);
  if (!unread.length) return;
  const ids = unread.map(n => String(n.id));
  unread.forEach(n => { n.is_read = 1; });
  ids.forEach(id => { const el = document.querySelector(`.notif-item[data-id="${id}"]`); if (el) applyNotifReadVisual(el, true); });
  try {
    await api('/api/notifications/read-all', { method: 'POST', body: {} });
  } catch {
    unread.forEach(n => { n.is_read = 0; });
    ids.forEach(id => { const el = document.querySelector(`.notif-item[data-id="${id}"]`); if (el) applyNotifReadVisual(el, false); });
  }
}
function notifKeyRead(e, id) {
  if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); markNotifRead(id); }
}
function applyNotifReadVisual(el, read) {
  el.classList.toggle('unread', !read);
  const dot = el.querySelector('.notif-dot');
  if (dot) dot.classList.toggle('read', read);
  const id = el.getAttribute('data-id') || '';
  if (read) {
    el.removeAttribute('role'); el.removeAttribute('tabindex');
    el.removeAttribute('aria-label'); el.removeAttribute('onclick'); el.removeAttribute('onkeydown');
  } else if (id) { // 失败回滚：恢复未读态同时重挂交互属性，否则遮罩回来但不能再点击
    el.setAttribute('role', 'button');
    el.setAttribute('tabindex', '0');
    el.setAttribute('aria-label', UI.NOTIF_READ_ARIA);
    el.setAttribute('onclick', `markNotifRead('${id}')`);
    el.setAttribute('onkeydown', `notifKeyRead(event, '${id}')`);
  }
}

// 系统广播通知拆成标题/正文两段（格式：【系统通知】标题\n正文）；其余通知单段
function renderNotifContent(text) {
  const t = String(text || '');
  const prefix = UI.NOTIFY_BROADCAST_PREFIX;
  if (t.startsWith(prefix)) {
    const nl = t.indexOf('\n');
    const title = (nl === -1 ? t : t.slice(0, nl)).slice(prefix.length);
    const body = nl === -1 ? '' : t.slice(nl + 1);
    return `<span class="notif-broadcast-title">${prefix}${escHtml(title)}</span>
      ${body ? `<span class="notif-broadcast-body">${escHtml(body)}</span>` : ''}`;
  }
  return escHtml(t);
}

// 登出复位：通知列表缓存 + 合同渲染签名清空（防上一账户残留）
registerLogoutReset(() => { _notifList = []; _lastContractSig = ''; });

// ============================================================
// 初始化（DOMContentLoaded）：v0.25.95（用户反馈「刷新不要回首页」）刷新恢复登录/访客 + 页面停留；
// 无可恢复身份才落落地页。推翻 v0.24.1「刷新恒落落地页」：该决定防「链接直达自动登录」，但用户主动刷新
// 应保持刷新前状态——恢复编排按 登录会话 → 访客角色 → 落地页 顺序，能力在 app-state 会话层
// （loadSession/getLastGuestRole/getLastPage），进入复用 app-auth（switchToRole/enterRolePreview）。
// ============================================================
document.addEventListener('DOMContentLoaded', () => {
  initCustomSelects(); // 静态页面上的筛选/评价下拉统一换自定义组件
  const saved = loadSession();
  if (saved && saved.authToken) { switchToRole(saved.user.role, saved); return; } // 校验后进客户端（enterClient 恢复页面）
  const guest = getLastGuestRole();
  if (guest) { enterRolePreview(guest); return; } // 访客预览恢复（含页面停留）
  showView('landing');
  showOnboardingIfNeeded();
  preloadDomainScripts(); // #178：后台静默预载领域脚本（点击入口下一帧即进客户端）
});

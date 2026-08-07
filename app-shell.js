/**
 * 壳与路由层（目标分层：状态管理层下游）—— 视图切换 / 侧边栏 / 页面注册表 / 统一装载器 / 红点徽标 / 初始化
 *
 * 本文件必须最后加载（在全部领域模块之后）：ROLE_PAGES 以 `enter: loadMyDemands` 形式引用领域函数，
 * 顶层 const 求值时刻函数必须已定义，否则 ReferenceError。加载序见 index.html。
 *
 * 职责：
 *   - 视图管理（landing/login/register/invite-gate/client 五视图）
 *   - 侧边栏栏目注册表 ROLE_PAGES（加栏目 = 这里一条 + index.html 一个 section + 一个 enter 函数）
 *   - 统一装载器 loadInto（loading/空态/错误转义/浮入/乱序守卫 四件套，禁止手写）
 *   - 红点徽标慢轮询（30s，全角色；各模块也可即时 setBadge 消点）
 *   - 通知信息页（全角色）
 *   - DOMContentLoaded 初始化（自动登录恢复 + 落地 + 新手引导）
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
// 客户端配置：侧边栏栏目注册表（enter 引用均为顶层函数，声明提升保证前向引用可用；
// 本文件在全部领域模块之后加载，enter 函数此刻已定义）
// ============================================================
const ROLE_PAGES = {
  student: [
    { id: 'my-demands',       label: UI.PAGE_MY_DEMANDS,      desc: UI.PAGE_MY_DEMANDS_DESC,      enter: loadMyDemands },
    { id: 'browse-teachers',  label: UI.PAGE_BROWSE_TEACHERS, desc: UI.PAGE_BROWSE_TEACHERS_DESC, enter: loadTeachers, auth: false },
    { id: 'my-chats',         label: UI.PAGE_MY_CHATS,        desc: UI.PAGE_MY_CHATS_DESC,        enter: () => enterMyChats() },
    { id: 'my-contracts',     label: UI.PAGE_MY_CONTRACTS,    desc: UI.PAGE_MY_CONTRACTS_DESC,    enter: () => loadMyContracts() },
    { id: 'notifications',    label: UI.PAGE_NOTIFICATIONS,   desc: UI.PAGE_NOTIFICATIONS_DESC,   enter: enterNotifications },
    { id: 'account-settings', label: UI.PAGE_ACCOUNT_SETTINGS, desc: UI.PAGE_ACCOUNT_SETTINGS_DESC, enter: enterAccountSettings },
    { id: 'about',            label: UI.PAGE_ABOUT,           desc: UI.PAGE_ABOUT_DESC,           enter: enterAbout, auth: false },
  ],
  teacher: [
    { id: 'browse-demands',   label: UI.PAGE_BROWSE_DEMANDS,  desc: UI.PAGE_BROWSE_DEMANDS_DESC,  enter: loadBrowseDemands, auth: false },
    { id: 'browse-teachers',  label: UI.PAGE_BROWSE_TEACHERS, desc: UI.PAGE_BROWSE_TEACHERS_PEER_DESC, enter: loadTeachers, auth: false },
    { id: 'resource-share',   label: UI.PAGE_RESOURCE_SHARE,  desc: UI.PAGE_RESOURCE_SHARE_DESC,  enter: () => enterResourceShare(), auth: false },
    { id: 'my-chats',         label: UI.PAGE_MY_CHATS,        desc: UI.PAGE_MY_CHATS_DESC,        enter: () => enterMyChats() },
    { id: 'my-contracts',     label: UI.PAGE_MY_CONTRACTS,    desc: UI.PAGE_MY_CONTRACTS_DESC,    enter: () => loadMyContracts() },
    { id: 'edit-profile',     label: UI.PAGE_EDIT_PROFILE,    desc: UI.PAGE_EDIT_PROFILE_DESC,    enter: initProfileForm },
    { id: 'notifications',    label: UI.PAGE_NOTIFICATIONS,   desc: UI.PAGE_NOTIFICATIONS_DESC,   enter: enterNotifications },
    { id: 'account-settings', label: UI.PAGE_ACCOUNT_SETTINGS, desc: UI.PAGE_ACCOUNT_SETTINGS_DESC, enter: enterAccountSettings },
    { id: 'about',            label: UI.PAGE_ABOUT,           desc: UI.PAGE_ABOUT_DESC,           enter: enterAbout, auth: false },
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
    { id: 'notifications',    label: UI.PAGE_NOTIFICATIONS,  desc: UI.PAGE_NOTIFICATIONS_DESC,  enter: enterNotifications },
    { id: 'account-settings', label: UI.PAGE_ACCOUNT_SETTINGS, desc: UI.PAGE_ACCOUNT_SETTINGS_DESC, enter: enterAccountSettings },
    { id: 'about',            label: UI.PAGE_ABOUT,          desc: UI.PAGE_ABOUT_DESC,          enter: enterAbout, auth: false },
  ],
};

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

function enterClient(pageId) {
  renderSidebar();
  showView('client');
  // 刷新恢复：回到刷新前的页签（角色不匹配时回落默认页）
  const valid = pageId && pagesForRole().some(p => p.id === pageId) ? pageId : defaultPageFor();
  selectPage(valid);
  if (state.user) startBadgePoll(); // 红点轮询仅登录态开启（访客无个人数据可轮询）
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
    `<span class="sidebar-pill glass glass--float" id="sidebar-pill" aria-hidden="true"></span>` +
    pagesForRole().map((p, i) => `
    <button type="button" class="sidebar-item${p.id === state.page ? ' active' : ''}" data-page="${p.id}" onclick="selectPage('${p.id}')">
      <span class="sidebar-item-index" aria-hidden="true">${String(i + 1).padStart(CONFIG.SIDEBAR_INDEX_PAD, '0')}</span>
      <span class="sidebar-item-body">
        <span class="sidebar-item-label">${p.label}</span>
        <span class="sidebar-item-descwrap"><span class="sidebar-item-desc">${p.desc || ''}</span></span>
      </span>
      ${BADGE_PAGES.includes(p.id) ? `<span class="sidebar-dot hidden" id="sidebar-${p.id}-dot"></span>` : ''}
    </button>`).join('');
  document.getElementById('sidebar-invite').classList.toggle('hidden', !isAdmin);
  syncPillOnce(document.getElementById('sidebar-pill'), document.getElementById('sidebar-nav'), '.sidebar-item');
}

function selectPage(pageId) {
  closeProfilePanel(); // 切页收起个人信息右栏
  document.querySelectorAll('#client-main .client-page').forEach(s =>
    s.classList.toggle('hidden', s.dataset.page !== pageId));
  document.querySelectorAll('#sidebar-nav .sidebar-item').forEach(b =>
    b.classList.toggle('active', b.dataset.page === pageId));
  // 黑色选中块滑向新栏目；展开/退让动效由 CSS 承担，rAF 追逐保证严格同步
  glidePill(document.getElementById('sidebar-pill'), document.getElementById('sidebar-nav'), '.sidebar-item');
  state.page = pageId;
  storePage(pageId); // 记住当前页签，刷新后回原页
  if (pageId !== 'my-chats' && typeof stopChatPolling === 'function') stopChatPolling(); // 切离聊天页即停轮询
  const cfg = pagesForRole().find(p => p.id === pageId);
  if (cfg && cfg.auth !== false && !ensureAuth()) return; // 需要身份的页统一过登录通路
  if (cfg && cfg.enter) cfg.enter();
  closeSidebar();
  document.getElementById('client-main').scrollTop = 0;
}

// 侧边栏开合时选中黑块跟着宽度/高度过渡逐帧重绑
function sidebarPillGlide() {
  glidePill(document.getElementById('sidebar-pill'), document.getElementById('sidebar-nav'), '.sidebar-item', CONFIG.SIDEBAR_GLIDE_MS);
}
function closeSidebar()  { document.body.classList.remove('sidebar-open'); sidebarPillGlide(); }
function toggleSidebar() { document.body.classList.toggle('sidebar-open'); sidebarPillGlide(); }

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
  el.innerHTML = `<div class="empty-state">${loaderHtml()}</div>`;
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
    const [convData, notifData] = await Promise.all([
      api('/api/conversations'),
      api('/api/notifications'),
    ]);
    const chatUnread = (convData.conversations || []).reduce((s, c) => s + (c.unread_count || 0), 0);
    const notifUnread = (notifData.notifications || []).filter(n => !n.is_read).length;
    // 红点铁律：正在看的页签不写徽标——点开瞬间本地清零后，轮询不许把它再点亮
    if (state.page !== 'my-chats') setBadge('my-chats', chatUnread);
    if (state.page !== 'notifications') setBadge('notifications', notifUnread);
    if (state.user.role === 'teacher') {
      const pushData = await api('/api/demand-pushes');
      if (state.page !== 'browse-demands') setBadge('browse-demands', (pushData.pushes || []).length);
      setBadge('my-demands', 0);
    } else if (state.user.role === 'student') {
      const demandData = await api('/api/student/demands?scope=mine');
      setBadge('my-demands', (demandData.demands || []).filter(d => d.pending_intents > 0).length);
      setBadge('browse-demands', 0);
    } else {
      setBadge('browse-demands', 0); setBadge('my-demands', 0);
      // 管理员用户反馈红点：未处理条数
      try {
        const fbData = await api(`/api/feedbacks`);
        const openFb = (fbData.feedbacks || []).filter(f => f.status !== 'resolved').length;
        if (state.page !== 'admin-feedback') setBadge('admin-feedback', openFb);
      } catch { /* 静默，下一轮自愈 */ }
    }
    // 我的合同红点：待我处理的合同数；正停留在合同页则就地刷新列表（对方改动 ≤30s 可见）
    if (state.user.role === 'student' || state.user.role === 'teacher') {
      const ctData = await api('/api/contracts/my');
      const contracts = ctData.contracts || [];
      if (state.page === 'my-contracts') {
        state.myContracts = contracts;
        if (typeof renderMyContractsList === 'function') renderMyContractsList();
      } else {
        setBadge('my-contracts', contracts.filter(c => typeof contractActionable === 'function' && contractActionable(c)).length);
      }
    } else setBadge('my-contracts', 0);
  } catch { /* 静默，下一轮自愈 */ }
}

// ============================================================
// 通知信息页（全角色）：进入即标记已读并消红点；屏蔽筛选只动渲染层
// ============================================================
let _notifList = [];
function isBroadcastNotif(text) { return String(text || '').startsWith(UI.NOTIFY_BROADCAST_PREFIX); }
function filterNotifRows(rows) {
  const block = document.getElementById('notif-block-mode')?.value === 'block-broadcast';
  return block ? rows.filter(n => !isBroadcastNotif(n.text)) : rows;
}
function applyNotifFilter() { // 筛选 onchange：同步重渲染，不重新请求
  const el = document.getElementById('notifications-content');
  if (!el || !_notifList.length) return;
  const shown = filterNotifRows(_notifList);
  el.innerHTML = shown.length ? shown.map(renderNotifItem).join('')
    : `<div class="empty-state"><p>${escHtml(UI.NOTIF_FILTER_EMPTY)}</p></div>`;
}
async function enterNotifications() {
  setBadge('notifications', 0); // 点开瞬间红点即灭（先于任何请求，轮询跳过当前页不复活）
  // 管理员独享「发通知」（系统广播）；其他角色隐藏
  const bb = document.getElementById('btn-broadcast-notif');
  if (bb) bb.classList.toggle('hidden', !(state.user && state.user.role === 'admin'));
  const rendered = await loadInto('notifications-content', async () => {
    const data = await api('/api/notifications');
    _notifList = data.notifications || [];
    return _notifList;
  }, rows => {
    const shown = filterNotifRows(rows);
    if (!shown.length) return `<div class="empty-state"><p>${escHtml(UI.NOTIF_FILTER_EMPTY)}</p></div>`;
    return shown.map(renderNotifItem).join('');
  }, { empty: UI.EMPTY_NO_NOTIFICATIONS });
  // 渲染成功才批量标已读（切走/报错不清未读，留给下次进入）
  if (rendered && _notifList.some(n => !n.is_read)) {
    api('/api/notifications/read', { method: 'POST', body: {} }).catch(() => {});
  }
}

function renderNotifItem(n) {
  return `<div class="notif-item glass${n.is_read ? '' : ' unread'}">
      <span class="notif-dot${n.is_read ? ' read' : ''}"></span>
      <div class="notif-body">
        <div class="notif-text">${renderNotifContent(n.text)}</div>
        <div class="notif-time">${fmtDateTime(n.created_at)}</div>
      </div>
    </div>`;
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

// 登出复位：通知列表缓存清空（防上一账户的通知残留）
registerLogoutReset(() => { _notifList = []; });

// ============================================================
// 初始化（DOMContentLoaded）：自动登录恢复 → 落地 → 新手引导。
// 令牌持久化后不再重放密码；网络抖动不删会话（否则下次访问变「首次」、新手引导重弹）
// ============================================================
document.addEventListener('DOMContentLoaded', async () => {
  const saved = loadSession();
  if (saved) {
    state.authToken = saved.authToken;
    try {
      const data = await api('/api/auth/me');
      state.user = data.user;
      saveSession(saved.source === 'local'); // 保活：刷新持久化中的 user 快照（记住我仍写 local）
      enterClient(storedPage()); // 回到刷新前的页签
      return;
    } catch (err) {
      // 令牌真正失效由 api() 的 401 处理统一清理；网络抖动不删会话（0.20.1 决策）。
      // 网络错误捕获环节 3/4：断线时弹明确提示（不删会话，恢复后下次自动登录）
      if (err && err.code === 'NETWORK_ERROR' && typeof showToast === 'function') showToast(UI.NETWORK_ERROR);
    }
  }
  initCustomSelects(); // 静态页面上的筛选/评价下拉统一换自定义组件
  showView('landing');
  showOnboardingIfNeeded();
});

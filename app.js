/**
 * 上财家教平台 - 前端应用
 */

// ============================================================
// 常量（来自 constants.js）
// ============================================================
// 科目满分/等第档位等业务数据已迁至 region-data.js（按省份政策驱动），此处仅留 UI 必需集
const { SUBJECTS, STUDENT_GRADES,
        TEACHER_GRADES, GENDERS, TEACHING_METHODS, UI } = APP_CONSTANTS;

// ============================================================
// 状态
// ============================================================
const state = { user: null, view: 'landing', page: null, allTeachers: [], adminTeachers: [], intentTeachers: [],
                adminModalTeacher: null, myReviewOnModal: null,
                myDemands: [], editingDemandId: null, adminPosts: [], adminContracts: [], myContracts: [],
                inviteTimerId: null, currentInviteCode: null, validatedInviteCode: null };

// ============================================================
// 头像组件（全站共用）：圆形，上传图片则居中裁切展示，未上传 = id 首字符 + 米色底
// ============================================================
function renderAvatarHtml(avatar, name, cls) {
  if (avatar) return `<span class="avatar ${cls}"><img src="${escHtml(avatar)}" alt=""></span>`;
  return `<span class="avatar ${cls}" aria-hidden="true">${escHtml((name || '?').charAt(0).toUpperCase())}</span>`;
}

// ============================================================
// 客户端配置：侧边栏栏目注册表
// 加栏目 = 这里加一条 + index.html 加一个 section[data-page] + 一个 enter 函数
// enter 引用的函数均为顶层声明，声明提升保证前向引用可用
// ============================================================
const ROLE_PAGES = {
  student: [
    { id: 'my-demands',       label: UI.PAGE_MY_DEMANDS,      desc: UI.PAGE_MY_DEMANDS_DESC,      enter: loadMyDemands },
    { id: 'browse-teachers',  label: UI.PAGE_BROWSE_TEACHERS, desc: UI.PAGE_BROWSE_TEACHERS_DESC, enter: loadTeachers },
    { id: 'my-chats',         label: UI.PAGE_MY_CHATS,        desc: UI.PAGE_MY_CHATS_DESC,        enter: () => enterMyChats() },
    { id: 'my-contracts',     label: UI.PAGE_MY_CONTRACTS,    desc: UI.PAGE_MY_CONTRACTS_DESC,    enter: loadMyContracts },
    { id: 'notifications',    label: UI.PAGE_NOTIFICATIONS,   desc: UI.PAGE_NOTIFICATIONS_DESC,   enter: enterNotifications },
    { id: 'account-settings', label: UI.PAGE_ACCOUNT_SETTINGS, desc: UI.PAGE_ACCOUNT_SETTINGS_DESC, enter: enterAccountSettings },
    { id: 'about',            label: UI.PAGE_ABOUT,           desc: UI.PAGE_ABOUT_DESC,           enter: enterAbout },
  ],
  teacher: [
    { id: 'browse-demands',   label: UI.PAGE_BROWSE_DEMANDS,  desc: UI.PAGE_BROWSE_DEMANDS_DESC,  enter: loadBrowseDemands },
    { id: 'browse-teachers',  label: UI.PAGE_BROWSE_TEACHERS, desc: UI.PAGE_BROWSE_TEACHERS_PEER_DESC, enter: loadTeachers },
    { id: 'resource-share',   label: UI.PAGE_RESOURCE_SHARE,  desc: UI.PAGE_RESOURCE_SHARE_DESC,  enter: () => enterResourceShare() },
    { id: 'my-chats',         label: UI.PAGE_MY_CHATS,        desc: UI.PAGE_MY_CHATS_DESC,        enter: () => enterMyChats() },
    { id: 'my-contracts',     label: UI.PAGE_MY_CONTRACTS,    desc: UI.PAGE_MY_CONTRACTS_DESC,    enter: loadMyContracts },
    { id: 'edit-profile',     label: UI.PAGE_EDIT_PROFILE,    desc: UI.PAGE_EDIT_PROFILE_DESC,    enter: initProfileForm },
    { id: 'notifications',    label: UI.PAGE_NOTIFICATIONS,   desc: UI.PAGE_NOTIFICATIONS_DESC,   enter: enterNotifications },
    { id: 'account-settings', label: UI.PAGE_ACCOUNT_SETTINGS, desc: UI.PAGE_ACCOUNT_SETTINGS_DESC, enter: enterAccountSettings },
    { id: 'about',            label: UI.PAGE_ABOUT,           desc: UI.PAGE_ABOUT_DESC,           enter: enterAbout },
  ],
  admin: [
    { id: 'admin-stats',      label: UI.PAGE_ADMIN_STATS,    desc: UI.PAGE_ADMIN_STATS_DESC,    enter: loadAdminStats },
    { id: 'admin-students',   label: UI.PAGE_ADMIN_STUDENTS, desc: UI.PAGE_ADMIN_STUDENTS_DESC, enter: loadAdminStudents },
    { id: 'admin-teachers',   label: UI.PAGE_ADMIN_TEACHERS, desc: UI.PAGE_ADMIN_TEACHERS_DESC, enter: loadAdminTeachers },
    { id: 'admin-demands',    label: UI.PAGE_ADMIN_DEMANDS,  desc: UI.PAGE_ADMIN_DEMANDS_DESC,  enter: loadAdminDemands },
    { id: 'admin-reviews',    label: UI.PAGE_ADMIN_REVIEWS,  desc: UI.PAGE_ADMIN_REVIEWS_DESC,  enter: loadAdminReviews },
    { id: 'admin-posts',      label: UI.PAGE_ADMIN_POSTS,    desc: UI.PAGE_ADMIN_POSTS_DESC,    enter: loadAdminPosts },
    { id: 'admin-contracts',  label: UI.PAGE_ADMIN_CONTRACTS, desc: UI.PAGE_ADMIN_CONTRACTS_DESC, enter: loadAdminContracts },
    { id: 'admin-feedback',   label: UI.PAGE_ADMIN_FEEDBACK, desc: UI.PAGE_ADMIN_FEEDBACK_DESC, enter: loadAdminFeedback },
    { id: 'notifications',    label: UI.PAGE_NOTIFICATIONS,  desc: UI.PAGE_NOTIFICATIONS_DESC,  enter: enterNotifications },
    { id: 'account-settings', label: UI.PAGE_ACCOUNT_SETTINGS, desc: UI.PAGE_ACCOUNT_SETTINGS_DESC, enter: enterAccountSettings },
    { id: 'about',            label: UI.PAGE_ABOUT,          desc: UI.PAGE_ABOUT_DESC,          enter: enterAbout },
  ],
};

// 统一下拉开关的 v 形箭头（drop-toggle 共用，currentColor 随文字变色）
const CARET_SVG = '<svg width="10" height="6" viewBox="0 0 10 6" fill="none" aria-hidden="true"><path d="M1 1l4 4 4-4" stroke="currentColor" stroke-width="1.6"/></svg>';

// ============================================================
// 统一下拉组件：替换原生 <select> 的丑弹层。
// 透明触发器 + v 形箭头（开合翻转），选项面板白底细边、选中项墨色实填，
// 原生 select 隐藏保留（id/value/onchange 语义不变，点选项后派发 change）。
// ============================================================
function initCustomSelects(root) {
  (root || document).querySelectorAll('select.form-select, select.filter-select').forEach(sel => {
    if (sel.dataset.customized) { buildCustomSelectPanel(sel); return; } // 已包装：仅重建选项
    sel.dataset.customized = '1';
    const wrap = document.createElement('div');
    wrap.className = 'custom-select';
    sel.insertAdjacentElement('afterend', wrap);
    wrap.appendChild(sel); // select 移入包装层，id 全局仍可寻址
    sel.classList.add('hidden');
    const trigger = document.createElement('button');
    trigger.type = 'button';
    trigger.className = 'custom-select-trigger';
    trigger.setAttribute('onclick', 'toggleCustomSelect(this.closest(".custom-select"))');
    trigger.innerHTML = `<span class="custom-select-text"></span><span class="drop-caret">${CARET_SVG}</span>`;
    const panel = document.createElement('div');
    panel.className = 'custom-select-panel';
    wrap.append(trigger, panel);
    buildCustomSelectPanel(sel);
    // 选项被动态重填（省份/年级等 innerHTML 重写）时自动重建面板
    new MutationObserver(() => buildCustomSelectPanel(sel)).observe(sel, { childList: true });
  });
}

function buildCustomSelectPanel(sel) {
  const wrap = sel.closest('.custom-select');
  if (!wrap) return;
  wrap.querySelector('.custom-select-panel').innerHTML = [...sel.options].map(o =>
    `<button type="button" class="custom-option${o.value === sel.value ? ' selected' : ''}" data-value="${escHtml(o.value)}">${escHtml(o.textContent)}</button>`).join('');
  syncCustomSelectText(sel);
}

function syncCustomSelectText(sel) {
  const wrap = sel.closest('.custom-select');
  if (!wrap) return;
  const text = wrap.querySelector('.custom-select-text');
  const o = sel.options[sel.selectedIndex];
  text.textContent = o ? o.textContent : '';
  text.classList.toggle('custom-select-empty', !sel.value);
  wrap.querySelectorAll('.custom-option').forEach(b => b.classList.toggle('selected', b.dataset.value === sel.value));
}

function toggleCustomSelect(wrap) {
  if (!wrap) return;
  const wasOpen = wrap.classList.contains('open');
  closeAllCustomSelects();
  if (!wasOpen) wrap.classList.add('open');
}
function closeAllCustomSelects() {
  document.querySelectorAll('.custom-select.open').forEach(w => w.classList.remove('open'));
}
// 兜底自愈：任何动态插入的 select 自动包装为自定义下拉（防移动端弹出原生选择器），
// 只处理尚未包装的，避免重复构建干扰已打开的面板
const selectSweepObserver = new MutationObserver(() => {
  document.querySelectorAll('select.form-select:not([data-customized]), select.filter-select:not([data-customized])')
    .forEach(sel => initCustomSelects(sel.closest('.modal') || sel.parentElement));
});
selectSweepObserver.observe(document.documentElement, { childList: true, subtree: true });
// 点空白处收起；点选项写回原生 select 并派发 change（内联 onchange 照常触发）
document.addEventListener('click', e => {
  const opt = e.target.closest('.custom-option');
  if (opt) {
    const wrap = opt.closest('.custom-select');
    const sel = wrap && wrap.querySelector('select');
    if (sel) {
      if (sel.value !== opt.dataset.value) {
        sel.value = opt.dataset.value;
        sel.dispatchEvent(new Event('change', { bubbles: true }));
      }
      wrap.classList.remove('open');
      syncCustomSelectText(sel);
    }
    return;
  }
  if (!e.target.closest('.custom-select')) closeAllCustomSelects();
});

// 内联 onclick 里插值的字符串参数一律过此函数，防引号击穿
function escHtml(s) {
  return String(s ?? '').replace(/[&<>"']/g, c =>
    ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
}

// 全站时间显示统一入口：后端一律存 UTC（workerd 里 datetime('now','localtime') 即 UTC），
// 此函数把 'YYYY-MM-DD HH:MM:SS'（视作 UTC）或 ISO 串转成浏览器本地时区的 'YYYY-MM-DD HH:MM'。
// 凡展示时间必过此函数，禁止裸 slice 原始串。
function fmtDateTime(s) {
  if (!s) return '';
  const str = String(s);
  const d = new Date(/^\d{4}-\d{2}-\d{2} \d{2}:\d{2}/.test(str) ? str.replace(' ', 'T') + 'Z' : str);
  if (isNaN(d)) return str.slice(0, 16); // 解析失败：退回原串截断，不抛错
  const p = n => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())} ${p(d.getHours())}:${p(d.getMinutes())}`;
}

// ============================================================
// 滑动选择块（共享基建）：绝对定位指示块实时跟随 .active 元素。
// 侧边栏大黑块与沟通页会话选中块（app-chat.js syncChatPill）复用同一逻辑。
// 容器须 position:relative，pill 为其直接子元素；选中项自身有展开动效，
// 故用 rAF 逐帧追真实布局，保证指示块与退让的栏目严格同步。
// ============================================================
function syncPillOnce(pill, container, itemSel) {
  if (!pill || !container) return;
  const a = container.querySelector(itemSel + '.active');
  if (!a) { pill.style.opacity = '0'; return; }
  pill.style.opacity = '1';
  pill.style.top = a.offsetTop + 'px';
  pill.style.height = a.offsetHeight + 'px';
}
function glidePill(pill, container, itemSel, dur = 460) {
  if (!pill || !container) return;
  const t0 = performance.now();
  const step = now => {
    syncPillOnce(pill, container, itemSel);
    if (now - t0 < dur) requestAnimationFrame(step);
  };
  requestAnimationFrame(step);
}
// 全局窗口缩放：重对齐侧边栏指示块；沟通页若已挂载也同步（其自行定义 syncChatPill）
window.addEventListener('resize', () => {
  syncPillOnce(document.getElementById('sidebar-pill'), document.getElementById('sidebar-nav'), '.sidebar-item');
  if (typeof syncChatPill === 'function') syncChatPill();
});

// ============================================================
// 卡片浮入（通知/需求/教师信息卡统一动效）：
// 打开栏目即播、滚进视口再播；--reveal-delay 按序错峰，从下往上浮入。
// ============================================================
// 不 unobserve：卡片滚出视口即复位，滚回 / 再次切入模块时重新按序浮入（每次展示都播一遍）
const revealObserver = ('IntersectionObserver' in window) ? new IntersectionObserver(es => {
  es.forEach(e => e.target.classList.toggle('revealed', e.isIntersecting));
}, { threshold: 0.06 }) : null;

function initReveals(root) {
  if (!root) return;
  const items = [...root.querySelectorAll('.list-card, .notif-item, .post-card')];
  items.forEach((el, i) => {
    el.classList.add('reveal');
    el.style.setProperty('--reveal-delay', `${Math.min(i * 45, 360)}ms`);
  });
  if (revealObserver) items.forEach(el => revealObserver.observe(el));
  else items.forEach(el => el.classList.add('revealed'));
}

// ============================================================
// API
// ============================================================
async function api(endpoint, options = {}) {
  const config = { headers: { 'Content-Type': 'application/json' }, ...options };
  if (config.body && typeof config.body === 'object') config.body = JSON.stringify(config.body);
  const res = await fetch(endpoint, config);
  const data = await res.json();
  if (!res.ok) throw new Error(data.error || UI.ERROR_REQUEST_FAILED);
  return data;
}

// ============================================================
// 登录页：用户名输入实时查角色（命中现有账户时输入框下方灰字提示）
// ============================================================
let loginCheckTimer = null, loginCheckSeq = 0;

function checkLoginUsernameDebounced() {
  clearTimeout(loginCheckTimer);
  loginCheckTimer = setTimeout(checkLoginUsername, 300);
}

async function checkLoginUsername() {
  const hint = document.getElementById('login-username-hint');
  const name = document.getElementById('login-username').value.trim();
  const seq = ++loginCheckSeq;
  if (!name || !hint) { if (hint) hint.textContent = ''; return; }
  try {
    const data = await api(`/api/auth/check?username=${encodeURIComponent(name)}`);
    if (seq !== loginCheckSeq) return; // 过期响应丢弃，防输入快于请求时的乱序
    hint.textContent = !data.exists ? ''
      : data.role === 'teacher' ? UI.HINT_ROLE_TEACHER
      : data.role === 'student' ? UI.HINT_ROLE_STUDENT : UI.HINT_ROLE_ADMIN;
  } catch { /* 网络抖动：静默不给提示 */ }
}

// ============================================================
// 视图管理
// ============================================================
const VIEWS = ['landing','login','register','invite-gate','client'];

function showView(name) {
  VIEWS.forEach(v => { const el = document.getElementById(`view-${v}`); if (el) el.classList.add('hidden'); });
  const target = document.getElementById(`view-${name}`);
  if (target) target.classList.remove('hidden');
  state.view = name;
  updateNavbar();
}

function goHome() { state.user ? enterClient() : showView('landing'); }

function updateNavbar() {
  const el = document.getElementById('navbar-actions');
  if (state.user) {
    const u = state.user;
    const roleLabel = u.role === 'student' ? UI.ROLE_STUDENT : u.role === 'teacher' ? UI.ROLE_TEACHER : UI.ADMIN_BADGE;
    // 退出登录已迁至「账户设置」页底（含二次确认），导航栏只留身份标识
    el.innerHTML = `<div class="navbar-user">
      <span>${escHtml(u.username)}</span><span class="user-badge${u.role === 'admin' ? ' admin-badge' : ''}">${roleLabel}</span></div>`;
  } else {
    el.innerHTML = `<button class="btn btn-ghost" onclick="showView('login')">${UI.NAV_LOGIN}</button>
      <button class="btn btn-primary btn-sm" onclick="showView('register')">${UI.NAV_REGISTER}</button>`;
  }
}

// ------------------------------------------------------------
// 客户端壳：侧边栏 + 页面区（栏目由 ROLE_PAGES 配置驱动）
// ------------------------------------------------------------
function pagesForRole() {
  return ROLE_PAGES[state.user.role] || [];
}

function defaultPageFor() {
  return (pagesForRole()[0] || { id: 'my-demands' }).id;
}

function enterClient(pageId) {
  renderSidebar();
  showView('client');
  selectPage(pageId || defaultPageFor());
  startBadgePoll(); // 登录后即开始侧边栏红点慢轮询
}

function renderSidebar() {
  const u = state.user;
  const isAdmin = u.role === 'admin';
  const roleLabel = u.role === 'student' ? UI.ROLE_STUDENT : u.role === 'teacher' ? UI.ROLE_TEACHER : UI.ADMIN_BADGE;
  // 用户块置侧边栏最下方（白底）：最左头像 + id + 灰小字属性
  document.getElementById('sidebar-user').innerHTML = `
    ${renderAvatarHtml(u.avatar, u.username, 'sidebar-user-avatar')}
    <div class="sidebar-user-text">
      <div class="sidebar-user-name">${escHtml(u.username)}</div>
      <div class="sidebar-user-role">${roleLabel}</div>
    </div>`;
  // 栏目 = 主页 entry 同款排布：亮紫序号 + 大字标题 + 选中展开简介；黑色选中块由 .sidebar-pill 滑动承担
  document.getElementById('sidebar-nav').innerHTML =
    `<span class="sidebar-pill" id="sidebar-pill" aria-hidden="true"></span>` +
    pagesForRole().map((p, i) => `
    <button type="button" class="sidebar-item${p.id === state.page ? ' active' : ''}" data-page="${p.id}" onclick="selectPage('${p.id}')">
      <span class="sidebar-item-index" aria-hidden="true">${String(i + 1).padStart(2, '0')}</span>
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
  document.querySelectorAll('#client-main .client-page').forEach(s =>
    s.classList.toggle('hidden', s.dataset.page !== pageId));
  document.querySelectorAll('#sidebar-nav .sidebar-item').forEach(b =>
    b.classList.toggle('active', b.dataset.page === pageId));
  // 黑色选中块滑向新栏目；展开/退让动效由 CSS 承担，rAF 追逐保证严格同步
  glidePill(document.getElementById('sidebar-pill'), document.getElementById('sidebar-nav'), '.sidebar-item');
  state.page = pageId;
  if (pageId !== 'my-chats' && typeof stopChatPolling === 'function') stopChatPolling(); // 切离聊天页即停轮询
  const cfg = pagesForRole().find(p => p.id === pageId);
  if (cfg && cfg.enter) cfg.enter();
  closeSidebar();
  document.getElementById('client-main').scrollTop = 0;
}

function openSidebar()   { document.body.classList.add('sidebar-open'); }
function closeSidebar()  { document.body.classList.remove('sidebar-open'); }
function toggleSidebar() { document.body.classList.toggle('sidebar-open'); }

// ============================================================
// 侧边栏红点徽标：未读会话 / 待处理推送(教师) / 未读通知，30s 慢轮询统一刷新；
// 各模块（如 app-chat 打开会话已读）也可即时回调 setBadge 消点
// ============================================================
const BADGE_PAGES = ['my-chats', 'browse-demands', 'notifications', 'my-contracts', 'admin-feedback'];
let badgePollTimer = null;

function setBadge(pageId, n) {
  const dot = document.getElementById(`sidebar-${pageId}-dot`);
  if (dot) dot.classList.toggle('hidden', !n);
}
function setChatsBadge(n) { setBadge('my-chats', n); } // 兼容 app-chat 既有调用名

function startBadgePoll() { stopBadgePoll(); refreshBadges(); badgePollTimer = setInterval(refreshBadges, 30000); }
function stopBadgePoll() { if (badgePollTimer) { clearInterval(badgePollTimer); badgePollTimer = null; } BADGE_PAGES.forEach(p => setBadge(p, 0)); }

async function refreshBadges() {
  if (!state.user) return;
  try {
    const [convData, notifData] = await Promise.all([
      api(`/api/conversations?userId=${state.user.id}`),
      api(`/api/notifications?userId=${state.user.id}`),
    ]);
    const chatUnread = (convData.conversations || []).reduce((s, c) => s + (c.unread_count || 0), 0);
    const notifUnread = (notifData.notifications || []).filter(n => !n.is_read).length;
    // 红点铁律：正在看的页签不写徽标——点开瞬间本地清零后，轮询不许把它再点亮
    if (state.page !== 'my-chats') setBadge('my-chats', chatUnread);
    if (state.page !== 'notifications') setBadge('notifications', notifUnread);
    if (state.user.role === 'teacher') {
      const pushData = await api(`/api/demand-pushes?teacherUserId=${state.user.id}`);
      if (state.page !== 'browse-demands') setBadge('browse-demands', (pushData.pushes || []).length);
      setBadge('my-demands', 0);
    } else if (state.user.role === 'student') {
      const demandData = await api(`/api/student/demands?userId=${state.user.id}`);
      setBadge('my-demands', (demandData.demands || []).filter(d => d.pending_intents > 0).length);
      setBadge('browse-demands', 0);
    } else {
      setBadge('browse-demands', 0); setBadge('my-demands', 0);
      // 管理员用户反馈红点：未处理条数
      try {
        const fbData = await api(`/api/feedbacks?username=${encodeURIComponent(state.user.username)}`);
        const openFb = (fbData.feedbacks || []).filter(f => f.status !== 'resolved').length;
        if (state.page !== 'admin-feedback') setBadge('admin-feedback', openFb);
      } catch { /* 静默，下一轮自愈 */ }
    }
    // 我的合同红点：待我处理的合同数（学生+教师）；正停留在合同页则就地刷新列表（对方改动 ≤30s 可见）
    if (state.user.role === 'student' || state.user.role === 'teacher') {
      const ctData = await api(`/api/contracts/my?userId=${state.user.id}`);
      const contracts = ctData.contracts || [];
      if (state.page === 'my-contracts') {
        state.myContracts = contracts;
        renderMyContractsList();
      } else {
        setBadge('my-contracts', contracts.filter(contractActionable).length);
      }
      // 聊天窗合同状态灰字行同步刷新
      if (state.page === 'my-chats' && typeof chatConvId !== 'undefined' && chatConvId && typeof loadChatContract === 'function') {
        loadChatContract(chatConvId);
      }
    } else setBadge('my-contracts', 0);
  } catch { /* 静默，下一轮自愈 */ }
}


// ============================================================
// 认证
// ============================================================
function switchRegisterRole(role) {
  document.getElementById('register-role').value = role;
  document.querySelectorAll('#register-role-tabs .role-tab').forEach(t => t.classList.toggle('active', t.dataset.role === role));
  // 教师注册：先验证邀请码再填表
  if (role === 'teacher') {
    showView('invite-gate');
  }
}

function handleFeatureClick(role) {
  if (state.user) { enterClient(); return; }
  showView('login');
}

async function handleLogin(e) {
  e.preventDefault();
  const username = document.getElementById('login-username').value.trim();
  const password = document.getElementById('login-password').value;
  const alertEl = document.getElementById('login-alert');
  const btn = document.getElementById('login-submit');

  try {
    btn.disabled = true; btn.innerHTML = `<span class="spinner"></span> ${UI.LOADING_LOGIN}`;
    const data = await api('/api/auth/login', { method: 'POST', body: { username, password } });
    state.user = data.user;
    alertEl.innerHTML = '';

    // 记住登录状态
    if (document.getElementById('login-remember').checked) {
      localStorage.setItem('sufe_session', JSON.stringify({
        user: state.user, password, expires: Date.now() + 7 * 24 * 3600 * 1000, // 7天
      }));
    } else {
      localStorage.removeItem('sufe_session');
    }

    enterClient();
  } catch (err) {
    alertEl.innerHTML = `<div class="alert alert-error">${err.message}</div>`;
  } finally {
    btn.disabled = false; btn.textContent = UI.BTN_LOGIN;
  }
}

async function handleRegister(e) {
  e.preventDefault();
  const username = document.getElementById('register-username').value.trim();
  const password = document.getElementById('register-password').value;
  const password2 = document.getElementById('register-password2').value;
  const role = document.getElementById('register-role').value;
  const alertEl = document.getElementById('register-alert');

  if (password !== password2) {
    alertEl.innerHTML = `<div class="alert alert-error">${UI.VALIDATE_PASSWORD_MISMATCH}</div>`;
    return;
  }
  if (role === 'teacher') {
    if (!state.validatedInviteCode) {
      alertEl.innerHTML = `<div class="alert alert-error">${UI.VALIDATE_INVITE_FIRST}</div>`;
      showView('invite-gate');
      return;
    }
  }

  try {
    const btn = document.getElementById('register-submit');
    btn.disabled = true; btn.innerHTML = `<span class="spinner"></span> ${UI.LOADING_REGISTER}`;
    const body = { username, password, role };
    if (role === 'teacher') {
      body.inviteCode = state.validatedInviteCode;
      state.validatedInviteCode = null; // 用后即清
    }
    const data = await api('/api/auth/register', { method: 'POST', body });
    state.user = data.user;
    alertEl.innerHTML = '';
    enterClient();
  } catch (err) {
    alertEl.innerHTML = `<div class="alert alert-error">${err.message}</div>`;
  } finally {
    const btn = document.getElementById('register-submit');
    btn.disabled = false; btn.textContent = UI.BTN_REGISTER;
  }
}

async function validateInviteAndRegister() {
  const code = document.getElementById('invite-code-input').value.trim();
  const alertEl = document.getElementById('invite-gate-alert');

  if (!code) { alertEl.innerHTML = `<div class="alert alert-error">${UI.VALIDATE_INVITE_REQUIRED}</div>`; return; }

  // 先验证邀请码有效性（发一个假注册请求不如直接存下来，在真正注册时一起验证）
  // 这里只做格式校验，真正的验证在注册时进行
  if (code.length !== 8) {
    alertEl.innerHTML = `<div class="alert alert-error">${UI.VALIDATE_INVITE_LENGTH}</div>`;
    return;
  }

  // 保存验证过的邀请码，跳转到注册表单
  state.validatedInviteCode = code;
  alertEl.innerHTML = `<div class="alert alert-success">${UI.SUCCESS_INVITE_CONFIRMED}</div>`;

  // 等一秒让用户看到成功提示，然后跳转到注册页
  setTimeout(() => {
    document.getElementById('register-role').value = 'teacher';
    document.querySelectorAll('#register-role-tabs .role-tab').forEach(t =>
      t.classList.toggle('active', t.dataset.role === 'teacher'));
    showView('register');
  }, 800);
}

function handleLogout() {
  if (state.inviteTimerId) clearInterval(state.inviteTimerId);
  stopBadgePoll();
  if (typeof stopChatPolling === 'function') stopChatPolling(); // 模块4：登出即停聊天轮询
  state.user = null; state.page = null;
  state.allTeachers = []; state.adminTeachers = []; state.intentTeachers = []; state.adminModalTeacher = null;
  state.myDemands = []; state.editingDemandId = null; state.adminPosts = []; state.adminContracts = []; state.myContracts = [];
  state.inviteTimerId = null; state.currentInviteCode = null;
  localStorage.removeItem('sufe_session');
  closeSidebar();
  showView('landing');
}

// ============================================================
// 学生需求 Modal
// ============================================================
function openDemandModal(demandId) {
  state.editingDemandId = demandId || null;
  const demand = demandId ? state.myDemands.find(d => d.id === demandId) : null;
  document.getElementById('modal-container').innerHTML = renderDemandModal(demand);
  initDemandForm(demand ? demand.province : null);
  if (demand) prefillDemandForm(demand);
}
function closeModal() { document.getElementById('modal-container').innerHTML = ''; }

function renderDemandModal(demand) {
  return `<div class="modal-overlay">
    <div class="modal">
      <div class="modal-header"><h2>${demand ? UI.MODAL_TITLE_DEMAND_EDIT : UI.MODAL_TITLE_DEMAND_CREATE}</h2><button class="btn btn-ghost btn-icon" onclick="closeModal()">✕</button></div>
      <div class="modal-body">
        <div id="demand-alert"></div>
        <form onsubmit="handleSubmitDemand(event)" id="demand-form">
          <div class="form-group">
            <label class="form-label">${UI.LABEL_PROVINCE} <span class="req">*</span></label>
            <span id="d-province-wrap"></span>
            <div id="d-region-note"></div>
          </div>
          <div class="form-group">
            <label class="form-label">${UI.LABEL_STUDENT_GRADE} <span class="req">*</span></label>
            <select class="form-select" id="d-grade" required onchange="updateDemandSubjects()">
              <option value="">${UI.OPTION_PLACEHOLDER}</option>${STUDENT_GRADES.map(g=>`<option value="${g.id}">${g.name}</option>`).join('')}
            </select>
          </div>
          <div class="form-group">
            <label class="form-label">${UI.LABEL_STUDENT_GENDER} <span class="req">*</span></label>
            <select class="form-select" id="d-gender" required>
              <option value="">${UI.OPTION_PLACEHOLDER}</option>${GENDERS.map(g=>`<option value="${g.id}">${g.name}</option>`).join('')}
            </select>
          </div>
          <div class="form-group">
            <label class="form-label">${UI.LABEL_TARGET_SUBJECTS} <span class="req">*</span>${UI.LABEL_MULTI_SUFFIX}</label>
            <div class="checkbox-grid" id="d-subjects">${SUBJECTS.map(s=>`
              <label class="checkbox-item"><input type="checkbox" value="${s.id}">${s.name}</label>
            `).join('')}</div>
          </div>
          <div class="form-group" id="d-scores-wrap">
            <label class="form-label">${UI.LABEL_CURRENT_SCORES}</label>
            <div id="d-scores"><p class="text-sm text-muted">${UI.HINT_SELECT_TARGET_SUBJECTS}</p></div>
          </div>
          <div class="form-group">
            <label class="form-label">${UI.LABEL_TEACHING_METHOD} <span class="req">*</span></label>
            <select class="form-select" id="d-method" required onchange="toggleAddressField()">
              ${TEACHING_METHODS.map(m=>`<option value="${m.id}">${m.name}</option>`).join('')}
            </select>
          </div>
          <div id="d-address-section">
            <div class="form-group">
              <label class="form-label">${UI.LABEL_ADDRESS} <span class="req">*</span></label>
              <input type="text" class="form-input" id="d-address" placeholder="${UI.ADDRESS_PLACEHOLDER}">
            </div>
          </div>
          <div class="form-group">
            <label class="form-label">${UI.LABEL_BUDGET}</label>
            <div style="display:flex;gap:var(--s3);align-items:center;">
              <input type="number" class="form-input" id="d-budget-min" placeholder="${UI.PLACEHOLDER_MIN}" min="0" step="1" style="flex:1;">
              <span class="text-muted">~</span>
              <input type="number" class="form-input" id="d-budget-max" placeholder="${UI.PLACEHOLDER_MAX}" min="0" step="1" style="flex:1;">
            </div>
          </div>
          <div class="form-divider"></div>
          <div class="form-group">
            <label class="form-label">${UI.LABEL_SUBMITTER} <span class="req">*</span></label>
            <select class="form-select" id="d-submitter" required>
              <option value="parent">${UI.SUBMITTER_PARENT}</option><option value="student">${UI.SUBMITTER_STUDENT}</option>
            </select>
          </div>
          <div class="form-group">
            <label class="form-label">${UI.LABEL_PARENT_CONTACT} <span class="req">*</span><span class="form-label-note">${UI.CONTACT_AFTER_SIGN_NOTE}</span></label>
            <input type="text" class="form-input" id="d-parent-contact" placeholder="${UI.CONTACT_PLACEHOLDER}" required>
          </div>
          <div class="form-group">
            <label class="form-label">${UI.LABEL_STUDENT_CONTACT} <span class="req">*</span><span class="form-label-note">${UI.CONTACT_AFTER_SIGN_NOTE}</span></label>
            <input type="text" class="form-input" id="d-student-contact" placeholder="${UI.CONTACT_PLACEHOLDER}" required>
          </div>
          <div class="form-group">
            <label class="form-label">${UI.LABEL_ADDITIONAL_INFO}</label>
            <textarea class="form-input" id="d-info" rows="3" placeholder="上课时间偏好、特殊要求等"></textarea>
          </div>
          <div class="modal-footer">
            ${demand ? `<button type="button" class="btn btn-danger btn-sm modal-footer-start" onclick="confirmDeleteDemand(${demand.id})">${UI.BTN_DELETE_DEMAND}</button>` : ''}
            <button type="button" class="btn btn-outline" onclick="closeModal()">${UI.BTN_CANCEL}</button>
            <button type="submit" class="btn btn-primary" id="d-submit">${demand ? UI.BTN_SAVE_DEMAND : UI.BTN_SUBMIT_DEMAND}</button>
          </div>
        </form>
      </div>
    </div>
  </div>`;
}

function initDemandForm(selectedProvince) {
  document.getElementById('d-province-wrap').innerHTML =
    renderProvinceSelect('d-province', selectedProvince || '', 'onchange="onDemandProvinceChange()"');
  onDemandProvinceChange(); // 初始即执行：未选省份也给提示、锁线上、科目池给出引导文案
  document.getElementById('d-subjects').addEventListener('change', updateDemandScores);
  toggleAddressField(); // 初始化地址字段可见性
  initCustomSelects(document.getElementById('demand-form')); // 省份/年级/性别/方式/身份下拉统一换自定义组件
}

// 编辑需求时回填表单（复用提交需求组件）。
// 时序关键：勾科目 → 手动 updateDemandScores()（程序改 checkbox 不派发 change）
// → 回填各科分制/分数 → 设教学方式 → 再调 toggleAddressField()
// （initDemandForm 那次跑在默认值上，会把线下需求的地址区错误隐藏）
function prefillDemandForm(d) {
  document.getElementById('d-province').value = d.province || '';
  onDemandProvinceChange(); // 锁线上约束 + 建科目池（科目池还需年级，下行补）
  document.getElementById('d-grade').value  = d.student_grade || '';
  updateDemandSubjects();
  document.getElementById('d-gender').value = d.student_gender || '';
  (d.target_subjects || []).forEach(sid => {
    const cb = document.querySelector(`#d-subjects input[value="${sid}"]`);
    if (cb) cb.checked = true;
  });
  updateDemandScores();
  prefillStudentScores(d.current_scores || []);
  document.getElementById('d-method').value = d.teaching_method || 'offline';
  toggleAddressField();
  document.getElementById('d-address').value        = d.address || '';
  document.getElementById('d-budget-min').value = d.budget_min || '';
  document.getElementById('d-budget-max').value = d.budget_max || '';
  document.getElementById('d-submitter').value      = d.submitter_type || 'parent';
  document.getElementById('d-parent-contact').value = d.parent_contact || '';
  document.getElementById('d-student-contact').value = d.student_contact || '';
  document.getElementById('d-info').value           = d.additional_info || '';
}

// 平时成绩回填：等第数据→点等级 pill（页签默认等第制）；分数数据→先切分数制页签再填值
function prefillStudentScores(scores) {
  (scores || []).forEach(cs => {
    const row = document.querySelector(`#d-scores .region-score-row[data-score-subject="${cs.subject}"]`);
    if (!row) return;
    if (cs.grade) {
      const pill = row.querySelector(`.grade-option[data-grade="${cs.grade}"]`);
      if (pill) pickGrade(pill);
    } else if (cs.score !== '' && cs.score != null) {
      const tab = row.querySelector('.score-mode-tab[data-mode="score"]');
      if (tab) switchScoreMode(tab);
      const inp = row.querySelector('input[data-sg-subject]');
      if (inp) inp.value = cs.score;
    }
  });
  // 程序回填不派发 change：手动同步自定义下拉的触发器文字
  document.querySelectorAll('#demand-form select').forEach(syncCustomSelectText);
}

// checkbox state is now handled by pure CSS (:checked + :has)

function toggleAddressField() {
  const method = document.getElementById('d-method').value;
  const section = document.getElementById('d-address-section');
  const addrInput = document.getElementById('d-address');
  if (method === 'online') {
    section.style.display = 'none';
    addrInput.required = false;
  } else {
    section.style.display = '';
    addrInput.required = true;
  }
}

// 省份变化（模块1）：未选 / 非上海一律提示 + 锁线上；仅明确选中上海才放开线下
function onDemandProvinceChange() {
  const prov = document.getElementById('d-province').value;
  document.getElementById('d-region-note').innerHTML = regionLockNote(prov); // regionLockNote 对空值同样给提示
  const methodSel = document.getElementById('d-method');
  const onlineOnly = prov !== 'shanghai';
  [...methodSel.options].forEach(o => { o.disabled = onlineOnly && o.value !== 'online'; });
  if (onlineOnly) { methodSel.value = 'online'; toggleAddressField(); }
  updateDemandSubjects();
}

// 科目池 = SUFE_REGIONS.subjectsFor(省份, 年级)：地区 + 年级共同决定（需求 1.3）
function updateDemandSubjects() {
  const prov = document.getElementById('d-province').value;
  const grade = document.getElementById('d-grade').value;
  const el = document.getElementById('d-subjects');
  if (!prov || !grade) {
    el.innerHTML = `<p class="text-sm text-muted">${UI.HINT_SELECT_PROVINCE_GRADE}</p>`;
    document.getElementById('d-scores').innerHTML = '';
    return;
  }
  el.innerHTML = buildStudentSubjectsHtml(prov, grade);
  updateDemandScores();
}

// 平时成绩行：app-region.js 按省份等第制渲染「等第制/分数制」双页签。
// 增量更新：勾选/取消科目只增删对应行，保留其余科目已填的分数与等第选择
function updateDemandScores() {
  const prov = document.getElementById('d-province').value;
  const grade = document.getElementById('d-grade').value;
  const checked = [...document.querySelectorAll('#d-subjects input:checked')].map(cb => cb.value);
  const el = document.getElementById('d-scores');
  if (!prov || !grade) { el.innerHTML = ''; return; }
  if (!checked.length) { el.innerHTML = `<p class="text-sm text-muted">${UI.HINT_SELECT_TARGET_SUBJECTS}</p>`; return; }

  // 1) 移除取消勾选的科目行
  el.querySelectorAll('.region-score-row').forEach(row => {
    if (!checked.includes(row.dataset.scoreSubject)) row.remove();
  });
  // 2) 仅为新勾选的科目渲染行（已存在的行连同用户输入原样保留）
  const present = new Set([...el.querySelectorAll('.region-score-row')].map(r => r.dataset.scoreSubject));
  const fresh = checked.filter(sid => !present.has(sid));
  if (fresh.length) {
    const html = buildStudentScoreRows(prov, grade, fresh);
    const ph = el.querySelector(':scope > p'); // 「请先选择目标科目」占位
    if (ph) ph.replaceWith(document.createRange().createContextualFragment(html));
    else el.insertAdjacentHTML('beforeend', html);
  }
  // 3) 行序与科目勾选列表对齐（append 既有行不丢输入）
  checked.forEach(sid => {
    const row = el.querySelector(`.region-score-row[data-score-subject="${sid}"]`);
    if (row) el.appendChild(row);
  });
}

async function handleSubmitDemand(e) {
  e.preventDefault();
  const alertEl = document.getElementById('demand-alert');
  const province = document.getElementById('d-province').value;
  if (!province) { alertEl.innerHTML = `<div class="alert alert-error">${UI.VALIDATE_SELECT_PROVINCE}</div>`; return; }
  const subjects = [...document.querySelectorAll('#d-subjects input:checked')].map(cb => cb.value);
  if (!subjects.length) { alertEl.innerHTML = `<div class="alert alert-error">${UI.VALIDATE_SELECT_SUBJECT}</div>`; return; }

  const scores = collectStudentScores();

  const isEdit = !!state.editingDemandId;
  const payload = { userId: state.user.id, demand: {
    province,
    student_grade: document.getElementById('d-grade').value,
    student_gender: document.getElementById('d-gender').value,
    target_subjects: subjects, current_scores: scores,
    teaching_method: document.getElementById('d-method').value,
    address: document.getElementById('d-address').value.trim(),
    budget_min: +document.getElementById('d-budget-min').value,
    budget_max: +document.getElementById('d-budget-max').value,
    submitter_type: document.getElementById('d-submitter').value,
    parent_contact: document.getElementById('d-parent-contact').value.trim(),
    student_contact: document.getElementById('d-student-contact').value.trim(),
    additional_info: document.getElementById('d-info').value.trim(),
  }};

  try {
    const btn = document.getElementById('d-submit');
    btn.disabled = true; btn.innerHTML = '<span class="spinner"></span>';
    if (isEdit) {
      await api(`/api/student/demands/${state.editingDemandId}`, { method: 'PUT', body: payload });
    } else {
      await api('/api/student/demands', { method: 'POST', body: payload });
    }
    closeModal();
    state.editingDemandId = null;
    showToast(isEdit ? UI.SUCCESS_DEMAND_UPDATED : UI.SUCCESS_DEMAND_SUBMITTED);
    if (state.page === 'my-demands') loadMyDemands();
  } catch (err) {
    alertEl.innerHTML = `<div class="alert alert-error">${err.message}</div>`;
  } finally {
    const btn = document.getElementById('d-submit');
    if (btn) { btn.disabled = false; btn.textContent = isEdit ? UI.BTN_SAVE_DEMAND : UI.BTN_SUBMIT_DEMAND; }
  }
}

// ============================================================
// 浏览教师
// ============================================================
async function loadTeachers() {
  const el = document.getElementById('teachers-list');
  // Populate subject filter
  const subjectFilter = document.getElementById('filter-subject');
  if (subjectFilter.options.length <= 1) {
    SUBJECTS.forEach(s => { const o = document.createElement('option'); o.value = s.id; o.textContent = s.name; subjectFilter.appendChild(o); });
  }

  try {
    const data = await api('/api/teachers');
    state.allTeachers = data.teachers || [];
    renderTeachers(state.allTeachers);
  } catch (err) {
    el.innerHTML = `<div class="empty-state"><p>${UI.ERROR_LOAD_PREFIX}${err.message}</p></div>`;
  }
}

// 科目 + 成绩纵向行（教师卡与教师弹窗共用）：灰小标题 + 极细分隔线，无框
function renderSubjectScoreRows(t) {
  return (t.subjects || []).map(sid => {
    const s = SUBJECTS.find(x => x.id === sid);
    if (!s) return '';
    const gs = (t.gaokao_scores || []).find(x => x.subject === sid);
    const val = gs ? (gs.score !== undefined ? `${gs.score} / ${s.maxScore}分` : (gs.grade || '')) : '';
    return `<div class="subject-row"><span>${s.name}</span><span class="subject-score">${val}</span></div>`;
  }).join('');
}

function renderTeachers(teachers) {
  const el = document.getElementById('teachers-list');
  if (!teachers.length) { el.innerHTML = `<div class="empty-state"><p>${UI.EMPTY_NO_TEACHERS}</p></div>`; return; }
  const isStudent = state.user && state.user.role === 'student';

  // 错落两栏卡：左 头像+用户名(可点查看详情)+星级；右 信息行1(黑稍大)+信息行2(成绩灰可换行)+方形发送需求按钮；简介独占底部一行
  el.innerHTML = teachers.map(t => {
    const grade = TEACHER_GRADES.find(g=>g.id===t.grade)?.name || t.grade || '';
    const gender = GENDERS.find(g=>g.id===t.gender)?.name || '';
    const provName = (typeof SUFE_REGIONS !== 'undefined' && t.province) ? SUFE_REGIONS.provinceName(t.province) : '';
    const info1 = [provName, grade, gender, `${t.price||'?'}${UI.PRICE_UNIT}`].filter(Boolean).join(' · ');
    const info2 = (t.gaokao_scores || []).map(gs => {
      const s = SUBJECTS.find(x => x.id === gs.subject);
      if (!s) return '';
      return gs.score != null ? `${s.name}${gs.score}` : `${s.name}${gs.grade || ''}`;
    }).filter(Boolean).join(' · ');
    return `<div class="list-card list-card--teacher">
      ${renderAvatarHtml(t.avatar, t.username, 'tc-avatar')}
      <div class="tc-identity">
        <span class="tc-username" onclick="openTeacherModal(${t.user_id})">${escHtml(t.username)}</span>
        <span class="tc-rating">${renderStars(t.rating)}<b>${(t.rating||4).toFixed(1)}</b></span>
      </div>
      <div class="tc-right">
        <div class="tc-info1">${escHtml(info1)}</div>
        ${info2 ? `<div class="tc-info2">${escHtml(info2)}</div>` : ''}
        <div class="tc-actions">
          ${isStudent ? renderPushBtn(t) : ''}
        </div>
      </div>
      ${t.intro ? `<div class="tc-intro" title="${escHtml(t.intro)}">${escHtml(t.intro)}</div>` : ''}
    </div>`;
  }).join('');
  initReveals(el);
}

function renderStars(rating) {
  const r = rating || 4;
  let html = '<span class="stars">';
  for (let i = 1; i <= 5; i++) {
    html += `<span class="star ${i <= Math.round(r) ? 'filled' : ''}">★</span>`;
  }
  return html + '</span>';
}

function toggleFilters() {
  const open = document.getElementById('teacher-filters').classList.toggle('open'); // grid-rows 展开动效
  const btn = document.getElementById('filter-toggle-btn');
  if (btn) btn.classList.toggle('open', open); // v 形箭头翻转
}

function applyFilters() {
  const gender = document.getElementById('filter-gender').value;
  const subject = document.getElementById('filter-subject').value;
  const maxPrice = +document.getElementById('filter-price').value || Infinity;
  const minRating = +document.getElementById('filter-rating').value || 0;

  const filtered = state.allTeachers.filter(t => {
    if (gender && t.gender !== gender) return false;
    if (subject && !(t.subjects||[]).includes(subject)) return false;
    if (t.price > maxPrice) return false;
    if ((t.rating||4) < minRating) return false;
    return true;
  });
  renderTeachers(filtered);
}

// ============================================================
// 教师信息弹窗 — 可复用组件（档案 + 高考成绩 + 联系方式 + 评价）
// ============================================================
async function openTeacherModal(userId) {
  const t = state.allTeachers.find(x => x.user_id === userId) || state.adminTeachers.find(x => x.user_id === userId)
         || state.intentTeachers.find(x => x.user_id === userId); // 意向列表里的教师也开得起来
  if (!t) return;
  state.adminModalTeacher = (state.user && state.user.role === 'admin') ? t : null;
  document.getElementById('modal-container').innerHTML = renderTeacherModal(t);
  // 管理员：评价栏走管理端接口（全状态 + 逐条管理）
  if (state.adminModalTeacher) { loadTeacherReviewsAdmin(userId); return; }
  try {
    // reviewerUserId 取回「我的评价」（mine，任意状态），供写评价/修改评价判定
    const data = await api(`/api/reviews?teacherUserId=${userId}&reviewerUserId=${state.user ? state.user.id : ''}`);
    state.myReviewOnModal = data.mine || null;
    const el = document.getElementById('teacher-modal-reviews');
    if (el) el.innerHTML = renderReviewItems(data.reviews || [], t, { mine: data.mine }); // 防竞态：弹窗已关则丢弃
  } catch {
    const el = document.getElementById('teacher-modal-reviews');
    if (el) el.innerHTML = `<p class="text-sm text-muted">${UI.ERROR_LOAD_REVIEWS}</p>`;
  }
}

async function loadTeacherReviewsAdmin(userId) {
  try {
    const data = await api(`/api/admin/reviews?username=${encodeURIComponent(state.user.username)}&teacherUserId=${userId}`);
    const el = document.getElementById('teacher-modal-reviews');
    if (el) el.innerHTML = renderReviewItems(data.reviews || [], state.adminModalTeacher, { admin: true });
  } catch {
    const el = document.getElementById('teacher-modal-reviews');
    if (el) el.innerHTML = `<p class="text-sm text-muted">${UI.ERROR_LOAD_REVIEWS}</p>`;
  }
}

function renderTeacherModal(t) {
  const grade = TEACHER_GRADES.find(g => g.id === t.grade)?.name || '';
  const gender = GENDERS.find(g => g.id === t.gender)?.name || '';
  const provName = (typeof SUFE_REGIONS !== 'undefined' && t.province) ? SUFE_REGIONS.provinceName(t.province) : '';
  const meta = [provName, grade, gender, `${t.price || '?'}${UI.PRICE_UNIT}`].filter(Boolean).join(' · ');
  const rows = renderSubjectScoreRows(t);

  return `<div class="modal-overlay" onclick="if(event.target===this)closeModal()">
    <div class="modal">
      <div class="modal-header"><h2>${escHtml(t.username)}</h2><button type="button" class="btn btn-ghost btn-icon" onclick="closeModal()">✕</button></div>
      <div class="modal-body">
        <div class="teacher-headline">
          <span class="teacher-rating">${renderStars(t.rating)}<b>${(t.rating || 4).toFixed(1)}</b></span>
          <span class="list-card-meta">${meta}</span>
        </div>
        ${(provName || t.address) ? `<div class="subject-block"><div class="section-title">${UI.SECTION_REGION}</div>
          ${provName ? `<div class="subject-row"><span>${escHtml(provName)}</span></div>` : ''}
          ${t.address ? `<div class="subject-row"><span>${UI.LABEL_ADDRESS}</span><span class="subject-score">${escHtml(t.address)}</span></div>` : ''}
        </div>` : ''}
        ${rows ? `<div class="subject-block"><div class="section-title">${UI.SECTION_SUBJECTS}</div>${rows}</div>` : ''}
        ${(t.wechat || t.email) ? `<div class="subject-block"><div class="section-title">${UI.SECTION_CONTACT}</div>
          <p class="contact-sign-note">${UI.CONTACT_AFTER_SIGN_NOTE}</p>
        </div>` : ''}
        <div class="subject-block" id="teacher-modal-reviews">
          <div class="section-title">${UI.SECTION_REVIEWS}</div>
          <p class="text-sm text-muted">${UI.LOADING}</p>
        </div>
      </div>
    </div>
  </div>`;
}

function renderReviewItems(reviews, t, opts = {}) {
  const { admin = false } = opts;
  const statusTag = r => r.status === 'approved' ? `<span class="tag tag-ok">${UI.STATUS_APPROVED}</span>`
    : r.status === 'rejected' ? `<span class="tag tag-danger">${UI.STATUS_REJECTED}</span>`
    : `<span class="tag tag-warn">${UI.STATUS_PENDING}</span>`;
  return `<div class="section-title">${UI.SECTION_REVIEWS} (${reviews.length})</div>
    ${reviews.map(r => `<div class="review-item">
      <div class="review-header">
        <span class="review-author">${escHtml(r.reviewer_name || '')} ${renderStars(r.rating)} ${admin ? statusTag(r) : ''}</span>
        <span class="review-date">${fmtDateTime(r.created_at)}</span>
      </div>
      <div class="review-text">${escHtml(r.comment)}</div>
      ${admin ? `<div class="review-admin-actions">
        ${r.status === 'pending' ? `<button type="button" class="btn btn-accent btn-xs" onclick="adminReviewAction(${r.id},'approve',1)">${UI.BTN_APPROVE}</button>
        <button type="button" class="btn btn-outline btn-xs" onclick="adminReviewAction(${r.id},'reject',1)">${UI.BTN_REJECT}</button>` : ''}
        <button type="button" class="btn btn-danger btn-xs" onclick="confirmDeleteReview(${r.id},1)">${UI.BTN_DELETE_REVIEW}</button>
      </div>` : ''}
    </div>`).join('')}
    ${!reviews.length ? `<p class="text-sm text-muted">${UI.EMPTY_NO_REVIEWS}</p>` : ''}
    ${!admin && state.user && state.user.role === 'student' ? (opts.mine ? `
      <div class="review-mine-note">${UI.MY_REVIEW_PREFIX}${opts.mine.status === 'approved' ? UI.STATUS_APPROVED : opts.mine.status === 'rejected' ? UI.REVIEW_REJECTED_HINT : UI.REVIEW_STATUS_AUDITING}</div>
      <button type="button" class="btn btn-outline btn-sm mt-2" onclick="openReviewModal(${t.user_id}, null, ${opts.mine.id})">${UI.BTN_EDIT_REVIEW}</button>
    ` : `
      <button type="button" class="btn btn-outline btn-sm mt-2" onclick="openReviewModal(${t.user_id})">${UI.BTN_WRITE_REVIEW}</button>
    `) : ''}`;
}

// ============================================================
// 评价 Modal
// ============================================================
// 评价弹窗：editId 有值 = 修改自己的既有评价（自 state.myReviewOnModal 回填）
function openReviewModal(teacherUserId, teacherName, editId) {
  teacherName = teacherName ?? (state.allTeachers.find(x => x.user_id === teacherUserId)?.username || '');
  const existing = editId ? state.myReviewOnModal : null;
  document.getElementById('modal-container').innerHTML = `<div class="modal-overlay">
    <div class="modal">
      <div class="modal-header"><h2>${existing ? UI.BTN_EDIT_REVIEW : UI.REVIEW_MODAL_TITLE_PREFIX + teacherName}</h2><button class="btn btn-ghost btn-icon" onclick="closeModal()">✕</button></div>
      <div class="modal-body">
        <div id="review-alert"></div>
        <div class="form-group">
          <label class="form-label">${UI.LABEL_RATING} <span class="req">*</span></label>
          <div class="star-rating-input" id="review-stars">
            ${[1,2,3,4,5].map(i=>`<button class="star-btn" data-val="${i}" onclick="setReviewStars(${i})" type="button">★</button>`).join('')}
          </div>
          <input type="hidden" id="review-rating" value="${existing ? existing.rating : 0}">
        </div>
        <div class="form-group">
          <label class="form-label">${UI.LABEL_REVIEW_CONTENT} <span class="req">*</span></label>
          <textarea class="form-input" id="review-comment" rows="4" placeholder="${UI.REVIEW_COMMENT_PLACEHOLDER}">${existing ? escHtml(existing.comment) : ''}</textarea>
        </div>
        <div class="modal-footer">
          <button class="btn btn-outline" onclick="closeModal()">${UI.BTN_CANCEL}</button>
          <button class="btn btn-primary" onclick="submitReview(${teacherUserId}, ${existing ? existing.id : 0})">${existing ? UI.BTN_SAVE_DEMAND : UI.BTN_SUBMIT_REVIEW}</button>
        </div>
      </div>
    </div>
  </div>`;
  if (existing) setReviewStars(existing.rating); // 星星高亮回填
}

function setReviewStars(val) {
  document.getElementById('review-rating').value = val;
  document.querySelectorAll('#review-stars .star-btn').forEach(btn => {
    btn.classList.toggle('active', +btn.dataset.val <= val);
  });
}

// reviewId 有值 = PUT 修改既有评价（重回审核）；否则 POST 新评价（签约门槛由后端把关）
async function submitReview(teacherUserId, reviewId) {
  const rating = +document.getElementById('review-rating').value;
  const comment = document.getElementById('review-comment').value.trim();
  const alertEl = document.getElementById('review-alert');

  if (!rating) { alertEl.innerHTML = `<div class="alert alert-error">${UI.VALIDATE_SELECT_RATING}</div>`; return; }
  if (comment.length < 2) { alertEl.innerHTML = `<div class="alert alert-error">${UI.VALIDATE_COMMENT_TOO_SHORT}</div>`; return; }

  try {
    const data = reviewId
      ? await api(`/api/reviews/${reviewId}`, { method: 'PUT', body: { reviewerUserId: state.user.id, rating, comment } })
      : await api('/api/reviews', { method: 'POST', body: { teacherUserId, reviewerUserId: state.user.id, rating, comment } });
    closeModal();
    showToast(data.message || UI.SUCCESS_REVIEW_SUBMITTED);
  } catch (err) {
    alertEl.innerHTML = `<div class="alert alert-error">${err.message}</div>`;
  }
}

// 通用危险操作二次确认（onConfirm 仅由内部以数字 id 拼装全局函数调用串）
function confirmDanger(title, text, onConfirm) {
  document.getElementById('modal-container').innerHTML = `<div class="modal-overlay" onclick="if(event.target===this)closeModal()">
    <div class="modal" style="max-width:400px;">
      <div class="modal-header"><h2>${title}</h2><button type="button" class="btn btn-ghost btn-icon" onclick="closeModal()">✕</button></div>
      <div class="modal-body">
        <p class="text-sm" style="color:var(--ink-3);">${text}</p>
        <div class="modal-footer">
          <button type="button" class="btn btn-outline" onclick="closeModal()">${UI.BTN_CANCEL}</button>
          <button type="button" class="btn btn-danger" onclick="${onConfirm}">${UI.BTN_CONFIRM}</button>
        </div>
      </div>
    </div>
  </div>`;
}

function confirmDeleteDemand(demandId, asAdmin) {
  confirmDanger(UI.BTN_DELETE_DEMAND, UI.CONFIRM_DELETE_DEMAND, `handleDeleteDemand(${demandId}, ${asAdmin ? 1 : 0})`);
}

async function handleDeleteDemand(demandId, asAdmin) {
  try {
    if (asAdmin) {
      await api(`/api/admin/demands/${demandId}`, { method: 'DELETE', body: { username: state.user.username } });
    } else {
      await api(`/api/student/demands/${demandId}`, { method: 'DELETE', body: { userId: state.user.id } });
    }
    closeModal();
    showToast(UI.SUCCESS_DEMAND_DELETED);
    state.myDemands = state.myDemands.filter(d => d.id !== demandId);
    if (asAdmin) { if (state.page === 'admin-demands') loadAdminDemands(); }
    else if (state.page === 'my-demands') loadMyDemands();
  } catch (err) {
    showToast(err.message);
  }
}

function confirmBanUser(userId, banned) {
  confirmDanger(banned ? UI.BAN : UI.UNBAN, banned ? UI.CONFIRM_BAN : UI.CONFIRM_UNBAN, `doBanUser(${userId}, ${banned})`);
}

async function doBanUser(userId, banned) {
  try {
    await api(`/api/admin/users/${userId}/ban`, { method: 'POST', body: { username: state.user.username, banned } });
    closeModal();
    showToast(banned ? UI.SUCCESS_BANNED : UI.SUCCESS_UNBANNED);
    if (state.page === 'admin-students') loadAdminStudents();
    if (state.page === 'admin-teachers') loadAdminTeachers();
  } catch (err) {
    showToast(err.message);
  }
}

function confirmDeleteReview(reviewId, fromModal) {
  confirmDanger(UI.BTN_DELETE_REVIEW, UI.CONFIRM_DELETE_REVIEW, `adminReviewAction(${reviewId},'delete',${fromModal})`);
}

// action: approve / reject / delete；fromModal: 是否从教师详情弹窗内触发（决定刷新哪里）
async function adminReviewAction(reviewId, action, fromModal) {
  try {
    if (action === 'delete') {
      await api(`/api/admin/reviews/${reviewId}`, { method: 'DELETE', body: { username: state.user.username } });
      showToast(UI.REVIEW_DELETED);
    } else {
      await api(`/api/admin/reviews/${reviewId}/${action}`, { method: 'POST', body: { username: state.user.username } });
      showToast(action === 'approve' ? UI.SUCCESS_APPROVED : UI.SUCCESS_REJECTED);
    }
    closeModal();
    if (fromModal && state.adminModalTeacher) {
      document.getElementById('modal-container').innerHTML = renderTeacherModal(state.adminModalTeacher);
      loadTeacherReviewsAdmin(state.adminModalTeacher.user_id);
    } else if (state.page === 'admin-reviews') {
      loadAdminReviews();
    }
  } catch (err) {
    showToast(err.message);
  }
}

// ============================================================
// 需求卡与列表（学生「我的需求」与教师「需求大厅」共用渲染）
// ============================================================
function renderDemandCard(d, opts = {}) {
  const { editable = false, admin = false, teacher = false } = opts;
  const push = opts.push; // 学生主动推送的待处理需求（教师视角置顶卡）
  const provinceName = (typeof SUFE_REGIONS !== 'undefined' && d.province) ? SUFE_REGIONS.provinceName(d.province) : '';
  const subjNames = (d.target_subjects||[]).map(id => SUBJECTS.find(s=>s.id===id)?.name || id);
  const grade = STUDENT_GRADES.find(g=>g.id===d.student_grade)?.name || d.student_grade;
  const gender = GENDERS.find(g=>g.id===d.student_gender)?.name || '';
  const submitter = d.submitter_type === 'parent' ? UI.SUBMITTER_PARENT : UI.SUBMITTER_STUDENT;
  const method = TEACHING_METHODS.find(m=>m.id===d.teaching_method)?.name || (TEACHING_METHODS.find(m=>m.id==='offline')||{name:''}).name;
  // 教师视角：意向按钮四态（未提交 / 待处理 / 已建立联系 / 未获选），状态取自列表接口的 my_intent_status
  const teacherIntentBtn = !teacher ? ''
    : d.my_intent_status === 'accepted' ? `<button type="button" class="btn btn-sm btn-intent-ok" disabled>${UI.INTENT_ACCEPTED}</button>`
    : d.my_intent_status === 'pending'  ? `<button type="button" class="btn btn-sm btn-intent-wait" disabled>${UI.INTENT_PENDING}</button>`
    : d.my_intent_status === 'rejected' ? `<button type="button" class="btn btn-sm btn-intent-wait" disabled>${UI.INTENT_REJECTED}</button>`
    : `<button type="button" class="btn btn-outline btn-sm" onclick="submitIntent(${d.id})">${UI.BTN_SUBMIT_INTENT}</button>`;
  const budget = (d.budget_min || d.budget_max)
    ? `${d.budget_min||UI.BUDGET_NO_LIMIT}~${d.budget_max||UI.BUDGET_NO_LIMIT}${UI.BUDGET_UNIT_SUFFIX}` : UI.BUDGET_NEGOTIABLE;

  // 平时成绩标签：等第制科目（mode:'grade'）只显示等第；分数制显示 分数/满分制；空值跳过
  const scoresHtml = (d.current_scores||[]).map(cs => {
    const n = SUBJECTS.find(s=>s.id===cs.subject)?.name || cs.subject;
    let val = '';
    if (cs.grade || cs.mode === 'grade') val = cs.grade || '';
    else if (cs.score !== '' && cs.score != null) val = `${cs.score}${UI.SCORE_UNIT}/${cs.scale}${UI.SCORE_SCALE_SUFFIX}`;
    return val ? `<span class="tag">${n}: ${escHtml(val)}</span>` : '';
  }).join('');

  return `<div class="list-card list-card--demand">
    ${renderAvatarHtml(d.avatar, d.username || '?', 'demand-avatar')}
    <div class="demand-card-main">
    <div class="list-card-header">
      <span class="list-card-title">${(admin || push) && d.username ? escHtml(d.username) + ' · ' : ''}${grade} · ${gender}</span>
      <span class="demand-card-tools">
        ${push ? `<span class="push-note-row">
          <span class="push-pin-tag">${UI.PUSH_TAG_ACTIVE}</span>
          <span class="list-card-meta">${fmtDateTime(push.push_created_at)}</span>
          <span class="push-note-text">${UI.PUSH_NOTE_TEXT}</span>
          <button type="button" class="btn btn-outline btn-xs" onclick="resolvePush(${push.push_id},'reject')">${UI.BTN_PUSH_REJECT}</button>
          <button type="button" class="btn btn-accent btn-xs" onclick="resolvePush(${push.push_id},'accept')">${UI.BTN_PUSH_ACCEPT}</button>
        </span>` : `<span class="list-card-meta">${fmtDateTime(d.created_at)}</span>${teacherIntentBtn}`}
        ${editable ? `<button type="button" class="btn btn-outline btn-sm" onclick="openDemandModal(${d.id})">${UI.BTN_EDIT}</button>` : ''}
        ${admin ? `<button type="button" class="btn btn-danger btn-xs" onclick="confirmDeleteDemand(${d.id}, true)">${UI.BTN_REMOVE}</button>` : ''}
      </span>
    </div>
    <div class="list-card-body">
      ${provinceName ? `<span class="tag tag-accent">${provinceName}</span>` : ''}
      ${subjNames.map(n=>`<span class="tag tag-accent">${n}</span>`).join('')}
      <span class="tag">${method}</span>
      <span class="tag tag-warn">${budget}</span>
      <span class="tag">${UI.SUBMITTER_PREFIX}${submitter}</span>
    </div>
    ${scoresHtml ? `<div class="list-card-detail" style="display:flex;flex-wrap:wrap;gap:var(--s2);margin-top:var(--s2);">${scoresHtml}</div>` : ''}
    ${d.address ? `<div class="list-card-detail">${UI.ADDRESS_PREFIX}${escHtml(d.address)}</div>` : ''}
    ${d.additional_info ? `<div class="list-card-detail">${UI.ADDITIONAL_PREFIX}${escHtml(d.additional_info)}</div>` : ''}
    <div class="demand-card-foot">
      <div class="list-card-contact">
        <span class="contact-sign-note">${UI.CONTACT_AFTER_SIGN_NOTE}</span>
      </div>
      ${editable ? `<button type="button" class="drop-toggle" id="intent-toggle-${d.id}" onclick="toggleDemandIntents(${d.id})">${UI.INTENTS_TITLE} (${d.intent_count || 0}) <span class="drop-caret">${CARET_SVG}</span><span class="corner-dot${d.pending_intents ? '' : ' hidden'}" id="intent-dot-${d.id}"></span></button>` : ''}
    </div>
    ${editable ? `<div class="intents-box" id="intents-box-${d.id}"><div class="intents-box-inner"></div></div>` : ''}
    </div>
  </div>`;
}

async function loadDemandList(elId, { mine }) {
  const el = document.getElementById(elId);
  el.innerHTML = `<div class="empty-state"><p>${UI.LOADING}</p></div>`;
  try {
    // 教师大厅视角附带你自己的意向状态（my_intent_status），供按钮三态渲染
    const url = mine ? `/api/student/demands?userId=${state.user.id}`
                     : `/api/student/demands?teacherUserId=${state.user.id}`;
    const data = await api(url);
    const demands = data.demands || [];
    if (mine) {
      state.myDemands = demands; // 编辑回填的数据源
      setBadge('my-demands', demands.filter(d => d.pending_intents > 0).length); // 有待处理意向的需求数 → 侧栏红点
    }
    if (!demands.length) {
      el.innerHTML = `<div class="empty-state"><p>${mine ? UI.EMPTY_NO_MY_DEMANDS : UI.EMPTY_NO_DEMANDS}</p></div>`;
      return;
    }
    el.innerHTML = demands.map(d => renderDemandCard(d, { editable: mine, teacher: !mine })).join('');
    initReveals(el);
  } catch (err) {
    el.innerHTML = `<div class="empty-state"><p>${UI.ERROR_LOAD_PREFIX}${err.message}</p></div>`;
  }
}

function loadMyDemands()     { return loadDemandList('my-demands-list', { mine: true }); }

// 教师需求大厅：普通需求 + 学生主动推送的待处理需求（置顶 + 特殊操作行）
async function loadBrowseDemands() {
  const el = document.getElementById('demands-list');
  el.innerHTML = `<div class="empty-state"><p>${UI.LOADING}</p></div>`;
  try {
    const [dData, pData] = await Promise.all([
      api(`/api/student/demands?teacherUserId=${state.user.id}`),
      api(`/api/demand-pushes?teacherUserId=${state.user.id}`),
    ]);
    const pushes = pData.pushes || [];
    const demands = dData.demands || [];
    setBadge('browse-demands', 0); // 进页即视为已读；新推送由轮询在离开本页后重新点亮
    if (!pushes.length && !demands.length) { el.innerHTML = `<div class="empty-state"><p>${UI.EMPTY_NO_DEMANDS}</p></div>`; return; }
    const pushDemandIds = new Set(pushes.map(p => p.id));
    const pinned = pushes.map(p => renderDemandCard(p, { push: p })).join('');
    const normal = demands.filter(d => !pushDemandIds.has(d.id)).map(d => renderDemandCard(d, { teacher: true })).join('');
    el.innerHTML = (pinned ? `<div class="section-title" style="margin-bottom:8px;">${UI.PUSH_SECTION_TITLE}</div>${pinned}` : '') + normal;
    initReveals(el);
  } catch (err) {
    el.innerHTML = `<div class="empty-state"><p>${UI.ERROR_LOAD_PREFIX}${err.message}</p></div>`;
  }
}

// 学生把某条需求主动发给指定教师：弹窗列出自己的需求单选
async function openSendDemandModal(teacherUserId) {
  const t = state.allTeachers.find(x => x.user_id === teacherUserId);
  const tName = t ? t.username : UI.PUSH_TEACHER_FALLBACK;
  let demands = state.myDemands;
  if (!demands.length) {
    try { demands = (await api(`/api/student/demands?userId=${state.user.id}`)).demands || []; state.myDemands = demands; }
    catch { demands = []; }
  }
  const pickHtml = demands.length ? `<div class="push-pick">${demands.map(d => {
    const grade = STUDENT_GRADES.find(g=>g.id===d.student_grade)?.name || d.student_grade || '';
    const subs = (d.target_subjects||[]).map(id=>SUBJECTS.find(s=>s.id===id)?.name||id).join('、');
    const prov = (typeof SUFE_REGIONS !== 'undefined' && d.province) ? SUFE_REGIONS.provinceName(d.province) : '';
    const method = TEACHING_METHODS.find(m=>m.id===d.teaching_method)?.name || '';
    return `<label class="push-pick-item"><input type="radio" name="push-demand" value="${d.id}">
      <span><span class="push-pick-main">${escHtml(grade)}${subs ? ' · ' + escHtml(subs) : ''}</span>
      <span class="push-pick-sub">${[prov, method].filter(Boolean).map(escHtml).join(' · ')}</span></span></label>`;
  }).join('')}</div>` : `<p class="text-sm text-muted">${UI.EMPTY_NO_MY_DEMANDS_SHORT}</p>`;
  document.getElementById('modal-container').innerHTML = `<div class="modal-overlay">
    <div class="modal" style="max-width:480px;">
      <div class="modal-header"><h2>${UI.PUSH_MODAL_TITLE_PREFIX}${escHtml(tName)}</h2><button type="button" class="btn btn-ghost btn-icon" onclick="closeModal()">✕</button></div>
      <div class="modal-body">
        <p class="text-sm text-muted" style="margin-bottom:12px;">${UI.PUSH_MODAL_HINT}</p>
        ${pickHtml}
        <div class="modal-footer">
          <button type="button" class="btn btn-outline" onclick="closeModal()">${UI.BTN_CANCEL}</button>
          <button type="button" class="btn btn-primary" ${demands.length ? '' : 'disabled'} onclick="submitDemandPush(${teacherUserId})">${UI.BTN_SEND}</button>
        </div>
      </div>
    </div>
  </div>`;
}

// 推送限流：每分钟限发一条。发送后全部「发送需求」按钮变灰 + 秒级倒计时
let pushCooldownUntil = 0, pushCooldownTimer = null;
function pushCooldownLeft() { return Math.max(0, Math.ceil((pushCooldownUntil - Date.now()) / 1000)); }
function renderPushBtn(t) {
  const left = pushCooldownLeft();
  return left > 0
    ? `<button type="button" class="tc-push-btn" disabled>${UI.PUSH_BTN_COOLDOWN} ${left}s</button>`
    : `<button type="button" class="tc-push-btn" onclick="openSendDemandModal(${t.user_id})">${UI.BTN_PUSH_DEMAND} <span class="arrow">→</span></button>`;
}
function startPushCooldown(seconds) {
  pushCooldownUntil = Date.now() + seconds * 1000;
  clearInterval(pushCooldownTimer);
  pushCooldownTimer = setInterval(() => {
    const left = pushCooldownLeft();
    document.querySelectorAll('.tc-push-btn').forEach(b => {
      b.disabled = left > 0;
      b.innerHTML = left > 0 ? `${UI.PUSH_BTN_COOLDOWN} ${left}s` : `${UI.BTN_PUSH_DEMAND} <span class="arrow">→</span>`;
    });
    if (left <= 0) clearInterval(pushCooldownTimer);
  }, 1000);
}

async function submitDemandPush(teacherUserId) {
  const sel = document.querySelector('input[name="push-demand"]:checked');
  if (!sel) { showToast(UI.VALIDATE_SELECT_DEMAND); return; }
  if (pushCooldownLeft() > 0) { showToast(`${UI.PUSH_BTN_COOLDOWN} ${pushCooldownLeft()}s`); return; }
  try {
    const data = await api('/api/demand-pushes', { method: 'POST', body: { userId: state.user.id, teacherUserId, demandId: +sel.value } });
    closeModal();
    startPushCooldown(60);
    showToast(data.message || UI.PUSH_SENT_FALLBACK);
  } catch (err) { showToast(err.message); }
}

// 教师处理学生主动推送：确认 = 建会话；拒绝 = 婉拒（学生收通知）
async function resolvePush(pushId, action) {
  try {
    await api(`/api/demand-pushes/${pushId}/resolve`, { method: 'POST', body: { userId: state.user.id, action } });
    showToast(action === 'accept' ? UI.PUSH_ACCEPTED_TOAST : UI.PUSH_REJECTED_TOAST);
    loadBrowseDemands();
  } catch (err) { showToast(err.message); }
}

// ============================================================
// 通知信息页（全角色）：进入即标记已读并消红点
// ============================================================
async function enterNotifications() {
  const el = document.getElementById('notifications-content');
  setBadge('notifications', 0); // 点开瞬间红点即灭（先于任何请求，轮询跳过当前页不复活）
  // 管理员独享「发通知」（系统广播）；其他角色隐藏
  const bb = document.getElementById('btn-broadcast-notif');
  if (bb) bb.classList.toggle('hidden', !(state.user && state.user.role === 'admin'));
  el.innerHTML = `<div class="empty-state"><p>${UI.LOADING}</p></div>`;
  try {
    const data = await api(`/api/notifications?userId=${state.user.id}`);
    const list = data.notifications || [];
    if (!list.length) { el.innerHTML = `<div class="empty-state"><p>${UI.EMPTY_NO_NOTIFICATIONS}</p></div>`; return; }
    el.innerHTML = list.map(n => `<div class="notif-item${n.is_read ? '' : ' unread'}">
      <span class="notif-dot${n.is_read ? ' read' : ''}"></span>
      <div class="notif-body">
        <div class="notif-text">${renderNotifContent(n.text)}</div>
        <div class="notif-time">${fmtDateTime(n.created_at)}</div>
      </div>
    </div>`).join('');
    initReveals(el);
    if (list.some(n => !n.is_read)) {
      api('/api/notifications/read', { method: 'POST', body: { userId: state.user.id } }).catch(() => {});
    }
  } catch (err) {
    el.innerHTML = `<div class="empty-state"><p>${UI.ERROR_LOAD_PREFIX}${escHtml(err.message)}</p></div>`;
  }
}

// ============================================================
// 账户设置页（全角色）：细线分隔的设置行，无白框；退出登录置于页底 + 二次确认。
// 初期仅展示账户信息（电话/邮箱未绑定），修改按钮为占位（功能未开放）。
// ============================================================
function enterAccountSettings() {
  const u = state.user;
  const roleLabel = u.role === 'student' ? UI.ROLE_STUDENT : u.role === 'teacher' ? UI.ROLE_TEACHER : UI.ADMIN_BADGE;
  const row = (label, value, modifiable) => `
    <div class="settings-row">
      <div><div class="settings-label">${label}</div><div class="settings-value">${value}</div></div>
      ${modifiable ? `<button type="button" class="btn btn-outline btn-sm" onclick="showToast('${UI.TOAST_COMING_SOON}')">${UI.BTN_MODIFY}</button>` : ''}
    </div>`;
  document.getElementById('account-settings-content').innerHTML = `
    <div class="settings-row settings-row--avatar">
      <div>
        <div class="settings-label">${UI.SETTINGS_AVATAR}</div>
        <button type="button" class="btn btn-outline btn-sm" onclick="document.getElementById('avatar-file').click()">${UI.BTN_UPLOAD_AVATAR}</button>
        <input type="file" id="avatar-file" accept="image/*" class="hidden" onchange="handleAvatarUpload(this)">
      </div>
      ${renderAvatarHtml(u.avatar, u.username, 'settings-avatar')}
    </div>
    <div class="settings-list">
      ${row(UI.SETTINGS_USERNAME, escHtml(u.username), false)}
      ${row(UI.SETTINGS_ROLE, roleLabel, false)}
      ${row(UI.SETTINGS_PHONE, UI.SETTINGS_UNBOUND, true)}
      ${row(UI.SETTINGS_EMAIL, UI.SETTINGS_UNBOUND, true)}
    </div>
    <button type="button" class="btn btn-danger settings-logout" onclick="confirmLogout()">${UI.BTN_LOGOUT}</button>`;
}

// 头像上传：居中取最大内切正方形缩放至 160px（圆形由 CSS border-radius 呈现），dataURL 落库
function handleAvatarUpload(input) {
  const file = input.files && input.files[0];
  if (!file) return;
  if (!file.type.startsWith('image/')) { showToast(UI.POST_IMAGE_ONLY); return; }
  const reader = new FileReader();
  reader.onload = () => {
    const img = new Image();
    img.onload = async () => {
      const side = Math.min(img.width, img.height);
      const N = 160;
      const cv = document.createElement('canvas');
      cv.width = cv.height = N;
      cv.getContext('2d').drawImage(img, (img.width - side) / 2, (img.height - side) / 2, side, side, 0, 0, N, N);
      const url = cv.toDataURL('image/jpeg', 0.85);
      try {
        await api('/api/user/avatar', { method: 'POST', body: { userId: state.user.id, avatar: url } });
        state.user.avatar = url;
        showToast(UI.AVATAR_SAVED_TOAST);
        renderSidebar(); // 同步侧边栏底部头像（active 态按 state.page 重建）
        if (state.page === 'account-settings') enterAccountSettings(); // 刷新右侧预览
      } catch (err) { showToast(err.message); }
    };
    img.src = reader.result;
  };
  reader.readAsDataURL(file);
}

// 退出登录二次确认（确认类弹窗，保留点遮罩关闭）
function confirmLogout() {
  document.getElementById('modal-container').innerHTML = `<div class="modal-overlay" onclick="if(event.target===this)closeModal()">
    <div class="modal" style="max-width:380px;">
      <div class="modal-body">
        <p style="margin-bottom:16px;">${UI.CONFIRM_LOGOUT}</p>
        <div class="modal-footer">
          <button type="button" class="btn btn-outline" onclick="closeModal()">${UI.BTN_CANCEL}</button>
          <button type="button" class="btn btn-danger" onclick="closeModal();handleLogout()">${UI.BTN_LOGOUT}</button>
        </div>
      </div>
    </div>
  </div>`;
}

// ============================================================
// 管理员：资料管理（教师共享帖子：列表 / 全文查看 / 越权删除）
// ============================================================
async function loadAdminPosts() {
  const el = document.getElementById('admin-posts-list');
  el.innerHTML = `<div class="empty-state"><p>${UI.LOADING}</p></div>`;
  try {
    const data = await api('/api/posts');
    state.adminPosts = data.posts || [];
    if (!state.adminPosts.length) { el.innerHTML = `<div class="empty-state"><p>${UI.ADMIN_POSTS_EMPTY}</p></div>`; return; }
    el.innerHTML = state.adminPosts.map(renderAdminPostRow).join('');
    initReveals(el);
  } catch (err) {
    el.innerHTML = `<div class="empty-state"><p>${UI.ERROR_LOAD_PREFIX}${escHtml(err.message)}</p></div>`;
  }
}

function renderAdminPostRow(p) {
  return `<div class="admin-row">
    <div class="admin-row-main">
      <div class="admin-row-line">
        <strong>${escHtml(p.title)}</strong>
        <span class="text-muted">${escHtml(p.username || '')}</span>
        <span class="list-card-meta">${p.like_count || 0} ${UI.POST_LIKE_ARIA}</span>
      </div>
      <div class="admin-row-meta">${fmtDateTime(p.created_at)}</div>
    </div>
    <div class="admin-row-actions">
      <button type="button" class="btn btn-outline btn-xs" onclick="openPostViewModal(${p.id})">${UI.BTN_VIEW}</button>
      <button type="button" class="btn btn-danger btn-xs" onclick="adminDeletePost(${p.id})">${UI.BTN_REMOVE}</button>
    </div>
  </div>`;
}

// 全文查看：复用发帖组件的 mdRender
function openPostViewModal(postId) {
  const p = state.adminPosts.find(x => x.id === postId);
  if (!p) return;
  document.getElementById('modal-container').innerHTML = `<div class="modal-overlay" onclick="if(event.target===this)closeModal()">
    <div class="modal">
      <div class="modal-header"><h2>${escHtml(p.title)}</h2><button type="button" class="btn btn-ghost btn-icon" onclick="closeModal()">✕</button></div>
      <div class="modal-body">
        <p class="text-sm text-muted" style="margin-bottom:12px;">${escHtml(p.username || '')} · ${fmtDateTime(p.created_at)}</p>
        <div class="md-preview">${mdRender(p.body_md || '')}</div>
      </div>
    </div>
  </div>`;
}

function adminDeletePost(postId) {
  openConfirmModal(UI.POST_DELETE_CONFIRM, async () => {
    try {
      await api(`/api/posts/${postId}`, { method: 'DELETE', body: { userId: state.user.id, adminUsername: state.user.username } });
      showToast(UI.POST_DELETED);
      loadAdminPosts();
    } catch (err) { showToast(err.message); }
  });
}

// ============================================================
// 我的合同（学生+教师）：草案确认 → 正式合同预览/修改 → 双方确认签约 → signed。
// 合同正文为 Markdown（服务端 buildContractMd 生成），修改经 PUT 实时同步给另一方。
// 测试版：确认签约以二次确认代替短信验证（后端 verifySignOtp 预留）。
// ============================================================

// 该合同当前是否需要我处理（侧栏红点口径）
function contractActionable(c) {
  const iAmDrafter = c.drafter_user_id === state.user.id;
  if (c.status === 'pending') return !iAmDrafter;                    // 对方起草，待我确认草案
  if (c.status === 'signing') return !(iAmDrafter ? c.drafter_confirmed : c.other_confirmed); // 待我确认签约
  return false;
}

async function loadMyContracts() {
  const el = document.getElementById('my-contracts-list');
  setBadge('my-contracts', 0); // 点开瞬间红点即灭（有待办由下一轮轮询在离开本页后重新点亮）
  el.innerHTML = `<div class="empty-state"><p>${UI.LOADING}</p></div>`;
  try {
    const data = await api(`/api/contracts/my?userId=${state.user.id}`);
    state.myContracts = data.contracts || [];
    renderMyContractsList();
  } catch (err) {
    el.innerHTML = `<div class="empty-state"><p>${UI.ERROR_LOAD_PREFIX}${escHtml(err.message)}</p></div>`;
  }
}

// 合同列表渲染（进页加载与 30s 轮询就地刷新共用——对方改合同后不必退出重进）
function renderMyContractsList() {
  const el = document.getElementById('my-contracts-list');
  if (!el) return;
  if (!state.myContracts.length) { el.innerHTML = `<div class="empty-state"><p>${UI.CONTRACT_EMPTY_LIST}</p></div>`; return; }
  el.innerHTML = state.myContracts.map(renderContractCard).join('');
  initReveals(el);
}

function renderContractCard(c) {
  const me = state.user.id;
  const iAmDrafter = c.drafter_user_id === me;
  const peerName = me === c.student_user_id ? c.teacher_name : c.student_name;
  const methodName = TEACHING_METHODS.find(m => m.id === c.method)?.name || c.method;
  const statusText = c.status === 'pending' ? UI.CONTRACT_STATUS_PENDING
    : c.status === 'signing' ? UI.CONTRACT_STATUS_SIGNING : UI.CONTRACT_STATUS_SIGNED;
  const statusCls = c.status === 'signed' ? 'tag-ok' : c.status === 'signing' ? 'tag-warn' : 'tag-accent';
  const myConfirmed = iAmDrafter ? c.drafter_confirmed : c.other_confirmed;

  let left = '', right = '';
  if (c.status === 'signed') {
    left = `<button type="button" class="btn btn-outline btn-sm" onclick="viewContract(${c.id})">${UI.BTN_VIEW_CONTRACT}</button>`;
  } else if (c.status === 'pending' && iAmDrafter) {
    // 起草方：等对方处理草案（对方直接看到三按钮，无独立「确认草案」环节）
    left = `<button type="button" class="btn btn-sm btn-intent-wait" disabled>${UI.CONTRACT_WAIT_DRAFT}</button>`;
    right = `<button type="button" class="btn btn-danger btn-sm" onclick="cancelContract(${c.id})">${UI.BTN_CANCEL_CONTRACT}</button>`;
  } else {
    // pending 收草案方 / signing 双方：直接三按钮（确认签约 / 修改内容 / 查看合同）
    left = `${myConfirmed
        ? `<button type="button" class="btn btn-sm btn-intent-wait" disabled>${UI.BTN_SIGN_WAITING}</button>`
        : `<button type="button" class="btn btn-accent btn-sm" onclick="signContract(${c.id})">${UI.BTN_SIGN}</button>`}
      <button type="button" class="btn btn-outline btn-sm" onclick="openContractModifyModal(${c.id})">${UI.BTN_MODIFY_CONTRACT}</button>
      <button type="button" class="btn btn-outline btn-sm" onclick="viewContract(${c.id})">${UI.BTN_VIEW_CONTRACT}</button>`;
    right = `<button type="button" class="btn btn-danger btn-sm" onclick="cancelContract(${c.id})">${UI.BTN_CANCEL_CONTRACT}</button>`;
  }

  return `<div class="list-card">
    <div class="list-card-header">
      <span class="list-card-title">${escHtml(peerName)}</span>
      <span class="tag ${statusCls}">${statusText}</span>
    </div>
    <div class="list-card-body">
      <span class="tag">${escHtml(methodName)}</span>
      <span class="tag tag-warn">${c.hourly_rate}${UI.PRICE_UNIT}</span>
      <span class="list-card-meta">${fmtDateTime(c.updated_at)}</span>
    </div>
    <div class="contract-actions">
      <div class="contract-actions-left">${left}</div>
      ${right}
    </div>
  </div>`;
}

// 通用二次确认弹窗（全站禁止浏览器原生 confirm——必须走内置 modal 组件）
let pendingConfirmAction = null;
function openConfirmModal(message, action) {
  pendingConfirmAction = action;
  document.getElementById('modal-container').innerHTML = `<div class="modal-overlay" onclick="if(event.target===this)closeModal()">
    <div class="modal" style="max-width:380px;">
      <div class="modal-body">
        <p style="margin-bottom:16px;">${message}</p>
        <div class="modal-footer">
          <button type="button" class="btn btn-outline" onclick="closeModal()">${UI.BTN_CANCEL}</button>
          <button type="button" class="btn btn-danger" onclick="runPendingConfirm()">${UI.BTN_CONFIRM}</button>
        </div>
      </div>
    </div>
  </div>`;
}
function runPendingConfirm() {
  closeModal();
  const action = pendingConfirmAction;
  pendingConfirmAction = null;
  if (action) action();
}

// 确认签约：测试版二次确认代替短信验证（后端 verifySignOtp 预留接口）
function signContract(contractId) {
  openConfirmModal(UI.CONFIRM_SIGN, async () => {
    try {
      const data = await api(`/api/contracts/${contractId}/sign`, { method: 'POST', body: { userId: state.user.id } });
      showToast(data.signed ? UI.CONTRACT_SIGNED_TOAST : UI.BTN_SIGN_WAITING);
      loadMyContracts();
    } catch (err) { showToast(err.message); }
  });
}

// 查看正式合同预览（Markdown 渲染，复用发帖组件的 mdRender）
function viewContract(contractId) {
  const c = state.myContracts.find(x => x.id === contractId);
  if (!c) return;
  document.getElementById('modal-container').innerHTML = `<div class="modal-overlay" onclick="if(event.target===this)closeModal()">
    <div class="modal">
      <div class="modal-header"><h2>${UI.BTN_VIEW_CONTRACT}</h2><button type="button" class="btn btn-ghost btn-icon" onclick="closeModal()">✕</button></div>
      <div class="modal-body"><div class="md-preview">${mdRender(c.contract_md || '')}</div></div>
    </div>
  </div>`;
}

// 修改合同内容：复用发帖组件的 Markdown 编辑器（同套 id，弹窗互斥）
function openContractModifyModal(contractId) {
  const c = state.myContracts.find(x => x.id === contractId);
  if (!c) return;
  document.getElementById('modal-container').innerHTML = `<div class="modal-overlay">
    <div class="modal">
      <div class="modal-header"><h2>${UI.MODIFY_CONTRACT_TITLE}</h2><button type="button" class="btn btn-ghost btn-icon" onclick="closeModal()">✕</button></div>
      <div class="modal-body">
        <div id="post-alert"></div>
        <div class="form-group">
          <label class="form-label">${UI.LABEL_CONTRACT_PLAN}</label>
          <div class="md-toolbar">
            <button type="button" class="md-btn" onclick="mdWrap('h2')">H2</button>
            <button type="button" class="md-btn" onclick="mdWrap('h3')">H3</button>
            <button type="button" class="md-btn" onclick="mdWrap('bold')">${UI.POST_MD_BOLD}</button>
            <button type="button" class="md-btn" onclick="pickPostImage()">${UI.POST_MD_IMAGE}</button>
            <input type="file" id="post-image-file" accept="image/*" class="hidden" onchange="insertPostImage(this)">
          </div>
          <textarea id="post-body" class="form-input post-body-input" rows="12" oninput="updatePostPreview()">${escHtml(c.contract_md || '')}</textarea>
        </div>
        <div class="form-group">
          <label class="form-label">${UI.POST_PREVIEW_LABEL}</label>
          <div id="post-preview" class="md-preview"></div>
        </div>
        <div class="modal-footer">
          <button type="button" class="btn btn-outline" onclick="closeModal()">${UI.BTN_CANCEL}</button>
          <button type="button" class="btn btn-primary" onclick="submitContractModify(${c.id})">${UI.BTN_SAVE}</button>
        </div>
      </div>
    </div>
  </div>`;
  updatePostPreview();
}

async function submitContractModify(contractId) {
  const md = (document.getElementById('post-body').value || '').trim();
  const alertEl = document.getElementById('post-alert');
  if (!md) { alertEl.innerHTML = `<div class="alert alert-error">${UI.CONTRACT_EMPTY}</div>`; return; }
  try {
    await api(`/api/contracts/${contractId}`, { method: 'PUT', body: { userId: state.user.id, contractMd: md } });
    closeModal();
    showToast(UI.CONTRACT_MODIFIED_TOAST);
    loadMyContracts();
  } catch (err) {
    alertEl.innerHTML = `<div class="alert alert-error">${escHtml(err.message)}</div>`;
  }
}

// 取消签约：二次确认 → 删合同 + 通知对方（后端），会话保留
function cancelContract(contractId) {
  openConfirmModal(UI.CONFIRM_CANCEL_CONTRACT, async () => {
    try {
      await api(`/api/contracts/${contractId}`, { method: 'DELETE', body: { userId: state.user.id } });
      showToast(UI.CONTRACT_CANCELLED_TOAST);
      loadMyContracts();
    } catch (err) { showToast(err.message); }
  });
}

// 起草合同（聊天窗 + 号呼出）：教学方式 + 约定时薪 + 教学方案（md 编辑器）→ 发送另一方确认
function openContractDraftModal(convId) {
  document.getElementById('modal-container').innerHTML = `<div class="modal-overlay">
    <div class="modal">
      <div class="modal-header"><h2>${UI.DRAFT_MODAL_TITLE}</h2><button type="button" class="btn btn-ghost btn-icon" onclick="closeModal()">✕</button></div>
      <div class="modal-body">
        <div id="contract-alert"></div>
        <div class="form-group">
          <label class="form-label">${UI.LABEL_CONTRACT_METHOD}</label>
          <select class="form-select" id="contract-method">
            <option value="online">线上</option>
            <option value="offline">线下</option>
          </select>
        </div>
        <div class="form-group">
          <label class="form-label">${UI.LABEL_CONTRACT_RATE}</label>
          <input type="number" class="form-input" id="contract-rate" min="0" step="1" placeholder="如：150">
        </div>
        <div class="form-group">
          <label class="form-label">${UI.LABEL_CONTRACT_PLAN}</label>
          <div class="md-toolbar">
            <button type="button" class="md-btn" onclick="mdWrap('h2')">H2</button>
            <button type="button" class="md-btn" onclick="mdWrap('h3')">H3</button>
            <button type="button" class="md-btn" onclick="mdWrap('bold')">${UI.POST_MD_BOLD}</button>
            <button type="button" class="md-btn" onclick="pickPostImage()">${UI.POST_MD_IMAGE}</button>
            <input type="file" id="post-image-file" accept="image/*" class="hidden" onchange="insertPostImage(this)">
          </div>
          <textarea id="post-body" class="form-input post-body-input" rows="8" placeholder="${UI.CONTRACT_PLAN_PLACEHOLDER}" oninput="updatePostPreview()"></textarea>
        </div>
        <div class="form-group">
          <label class="form-label">${UI.POST_PREVIEW_LABEL}</label>
          <div id="post-preview" class="md-preview"></div>
        </div>
        <div class="modal-footer">
          <button type="button" class="btn btn-outline" onclick="closeModal()">${UI.BTN_CANCEL}</button>
          <button type="button" class="btn btn-primary" onclick="submitContractDraft(${convId})">${UI.BTN_SEND}</button>
        </div>
      </div>
    </div>
  </div>`;
  initCustomSelects(document.getElementById('contract-method') && document.getElementById('contract-method').closest('.modal'));
  updatePostPreview();
}

async function submitContractDraft(convId) {
  const alertEl = document.getElementById('contract-alert');
  const method = document.getElementById('contract-method').value;
  const rate = document.getElementById('contract-rate').value;
  const plan = (document.getElementById('post-body').value || '').trim();
  if (!rate || +rate <= 0) { alertEl.innerHTML = `<div class="alert alert-error">${UI.VALIDATE_CONTRACT_RATE}</div>`; return; }
  if (!plan) { alertEl.innerHTML = `<div class="alert alert-error">${UI.VALIDATE_CONTRACT_PLAN}</div>`; return; }
  try {
    const data = await api('/api/contracts', { method: 'POST', body: { userId: state.user.id, conversationId: convId, method, plan, hourlyRate: +rate } });
    closeModal();
    showToast(data.message || UI.CONTRACT_DRAFT_SENT_TOAST);
  } catch (err) {
    alertEl.innerHTML = `<div class="alert alert-error">${escHtml(err.message)}</div>`;
  }
}

// ============================================================
// 管理员：合同管理（查看全部合同 + 测试用移除；全链路留档见后端 contract.* / admin.contract.*）
// ============================================================
async function loadAdminContracts() {
  const el = document.getElementById('admin-contracts-list');
  el.innerHTML = `<div class="empty-state"><p>${UI.LOADING}</p></div>`;
  try {
    const data = await api(`/api/admin/contracts?username=${encodeURIComponent(state.user.username)}`);
    state.adminContracts = data.contracts || [];
    if (!state.adminContracts.length) { el.innerHTML = `<div class="empty-state"><p>${UI.ADMIN_CONTRACTS_EMPTY}</p></div>`; return; }
    el.innerHTML = state.adminContracts.map(renderAdminContractRow).join('');
    initReveals(el);
  } catch (err) {
    el.innerHTML = `<div class="empty-state"><p>${UI.ERROR_LOAD_PREFIX}${escHtml(err.message)}</p></div>`;
  }
}

function renderAdminContractRow(c) {
  const statusText = c.status === 'pending' ? UI.CONTRACT_STATUS_PENDING
    : c.status === 'signing' ? UI.CONTRACT_STATUS_SIGNING : UI.CONTRACT_STATUS_SIGNED;
  const statusCls = c.status === 'signed' ? 'tag-ok' : c.status === 'signing' ? 'tag-warn' : 'tag-accent';
  const methodName = TEACHING_METHODS.find(m => m.id === c.method)?.name || c.method;
  return `<div class="admin-row">
    <div class="admin-row-main">
      <div class="admin-row-line">
        <strong>${escHtml(c.student_name)} × ${escHtml(c.teacher_name)}</strong>
        <span class="tag ${statusCls}">${statusText}</span>
      </div>
      <div class="admin-row-meta">起草 ${escHtml(c.drafter_name)} · ${escHtml(methodName)} · ${c.hourly_rate}${UI.PRICE_UNIT} · ${fmtDateTime(c.updated_at)}</div>
    </div>
    <div class="admin-row-actions">
      <button type="button" class="btn btn-outline btn-xs" onclick="adminViewContract(${c.id})">${UI.BTN_VIEW_CONTRACT}</button>
      <button type="button" class="btn btn-danger btn-xs" onclick="adminRemoveContract(${c.id})">${UI.BTN_REMOVE_CONTRACT}</button>
    </div>
  </div>`;
}

function adminViewContract(contractId) {
  const c = state.adminContracts.find(x => x.id === contractId);
  if (!c) return;
  document.getElementById('modal-container').innerHTML = `<div class="modal-overlay" onclick="if(event.target===this)closeModal()">
    <div class="modal">
      <div class="modal-header"><h2>${UI.BTN_VIEW_CONTRACT}</h2><button type="button" class="btn btn-ghost btn-icon" onclick="closeModal()">✕</button></div>
      <div class="modal-body"><div class="md-preview">${mdRender(c.contract_md || '')}</div></div>
    </div>
  </div>`;
}

function adminRemoveContract(contractId) {
  openConfirmModal(UI.CONFIRM_ADMIN_REMOVE_CONTRACT, async () => {
    try {
      await api(`/api/admin/contracts/${contractId}`, { method: 'DELETE', body: { username: state.user.username } });
      showToast(UI.ADMIN_CONTRACT_REMOVED_TOAST);
      loadAdminContracts();
    } catch (err) { showToast(err.message); }
  });
}

// 系统广播通知拆成标题/正文两段（格式：【系统通知】标题\n正文）；其余通知单段
function renderNotifContent(text) {
  const t = String(text || '');
  const prefix = '【系统通知】';
  if (t.startsWith(prefix)) {
    const nl = t.indexOf('\n');
    const title = (nl === -1 ? t : t.slice(0, nl)).slice(prefix.length);
    const body = nl === -1 ? '' : t.slice(nl + 1);
    return `<span class="notif-broadcast-title">${prefix}${escHtml(title)}</span>
      ${body ? `<span class="notif-broadcast-body">${escHtml(body)}</span>` : ''}`;
  }
  return escHtml(t);
}

// ============================================================
// 关于我们（全角色）：三张白色卡片——我们是谁 / 平台基本用法 / 用户支持（反馈 Bug / 建议）
// ============================================================
function enterAbout() {
  const usage = [
    [UI.ABOUT_USAGE_1_TITLE, UI.ABOUT_USAGE_1_TEXT],
    [UI.ABOUT_USAGE_2_TITLE, UI.ABOUT_USAGE_2_TEXT],
    [UI.ABOUT_USAGE_3_TITLE, UI.ABOUT_USAGE_3_TEXT],
    [UI.ABOUT_USAGE_4_TITLE, UI.ABOUT_USAGE_4_TEXT],
  ].map(([t, x]) => `<div class="about-usage-item">
      <div class="about-usage-title">${escHtml(t)}</div>
      <p class="about-usage-text">${escHtml(x)}</p>
    </div>`).join('');
  document.getElementById('about-content').innerHTML = `
    <div class="list-card about-card">
      <div class="navbar-logo about-logo" aria-hidden="true"><span></span><span></span><span></span><span></span></div>
      <div class="about-card-body">
        <h3 class="about-title">${UI.ABOUT_WHO_TITLE}</h3>
        <p class="about-text">${escHtml(UI.ABOUT_WHO_TEXT)}</p>
      </div>
    </div>
    <div class="list-card about-card-block">
      <h3 class="about-title">${UI.ABOUT_USAGE_TITLE}</h3>
      <div class="about-usage">${usage}</div>
    </div>
    <div class="list-card about-card-block">
      <h3 class="about-title">${UI.ABOUT_SUPPORT_TITLE}</h3>
      <div class="about-support-lines">
        <div>${escHtml(UI.ABOUT_SUPPORT_OWNER)}</div>
        <div>${escHtml(UI.ABOUT_SUPPORT_WECHAT)}</div>
        <div>${escHtml(UI.ABOUT_SUPPORT_EMAIL)}</div>
      </div>
      <div class="about-feedback-btns">
        <button type="button" class="btn btn-outline btn-sm" onclick="openFeedbackModal('suggestion')">${UI.BTN_FEEDBACK}</button>
      </div>
    </div>`;
  initReveals(document.getElementById('about-content'));
}

// ---- 反馈弹窗：Bug / 建议切换 + 复用发帖 Markdown 编辑器 ----
let feedbackKind = 'bug';
function openFeedbackModal(kind) {
  feedbackKind = kind === 'suggestion' ? 'suggestion' : 'bug';
  document.getElementById('modal-container').innerHTML = `<div class="modal-overlay">
    <div class="modal">
      <div class="modal-header"><h2 id="feedback-modal-title">${feedbackKind === 'bug' ? UI.FEEDBACK_MODAL_TITLE_BUG : UI.FEEDBACK_MODAL_TITLE_SUGGEST}</h2><button type="button" class="btn btn-ghost btn-icon" onclick="closeModal()">✕</button></div>
      <div class="modal-body">
        <div id="post-alert"></div>
        <div class="form-group">
          <label class="form-label" for="post-title">${UI.POST_LABEL_TITLE}</label>
          <input type="text" id="post-title" class="form-input" maxlength="60" placeholder="${UI.FEEDBACK_TITLE_PLACEHOLDER}" oninput="updateTitleCount()">
          <span class="title-count" id="post-title-count">0/60</span>
        </div>
        <div class="feedback-kind-row">
          <button type="button" class="feedback-kind-btn${feedbackKind === 'bug' ? ' active' : ''}" data-kind="bug" onclick="switchFeedbackKind('bug')">${UI.BTN_FEEDBACK_BUG}</button>
          <button type="button" class="feedback-kind-btn${feedbackKind === 'suggestion' ? ' active' : ''}" data-kind="suggestion" onclick="switchFeedbackKind('suggestion')">${UI.BTN_FEEDBACK_SUGGEST}</button>
        </div>
        <div class="form-group">
          <label class="form-label">${UI.POST_LABEL_BODY}</label>
          <div class="md-toolbar">
            <button type="button" class="md-btn" onclick="mdWrap('h2')">H2</button>
            <button type="button" class="md-btn" onclick="mdWrap('h3')">H3</button>
            <button type="button" class="md-btn" onclick="mdWrap('bold')">${UI.POST_MD_BOLD}</button>
            <button type="button" class="md-btn" onclick="pickPostImage()">${UI.POST_MD_IMAGE}</button>
            <input type="file" id="post-image-file" accept="image/*" class="hidden" onchange="insertPostImage(this)">
          </div>
          <textarea id="post-body" class="form-input post-body-input" rows="7" placeholder="${UI.FEEDBACK_PLACEHOLDER}" oninput="updatePostPreview()"></textarea>
        </div>
        <div class="form-group">
          <label class="form-label">${UI.POST_PREVIEW_LABEL}</label>
          <div id="post-preview" class="md-preview"></div>
        </div>
        <div class="modal-footer">
          <button type="button" class="btn btn-outline" onclick="closeModal()">${UI.BTN_CANCEL}</button>
          <button type="button" class="btn btn-primary" onclick="submitFeedback()">${UI.BTN_SEND}</button>
        </div>
      </div>
    </div>
  </div>`;
  updatePostPreview();
}

function switchFeedbackKind(kind) {
  feedbackKind = kind;
  document.querySelectorAll('.feedback-kind-btn').forEach(b => b.classList.toggle('active', b.dataset.kind === kind));
  const t = document.getElementById('feedback-modal-title');
  if (t) t.textContent = kind === 'bug' ? UI.FEEDBACK_MODAL_TITLE_BUG : UI.FEEDBACK_MODAL_TITLE_SUGGEST;
}

async function submitFeedback() {
  const title = (document.getElementById('post-title').value || '').trim();
  const content = (document.getElementById('post-body').value || '').trim();
  const alertEl = document.getElementById('post-alert');
  if (!title) { alertEl.innerHTML = `<div class="alert alert-error">${UI.POST_TITLE_REQUIRED}</div>`; return; }
  if (!content) { alertEl.innerHTML = `<div class="alert alert-error">${UI.FEEDBACK_EMPTY}</div>`; return; }
  try {
    await api('/api/feedbacks', { method: 'POST', body: { userId: state.user.id, kind: feedbackKind, title, content } });
    closeModal();
    showToast(UI.FEEDBACK_SENT_TOAST);
  } catch (err) {
    alertEl.innerHTML = `<div class="alert alert-error">${escHtml(err.message)}</div>`;
  }
}

// ============================================================
// 管理员：用户反馈（Bug 卡片红色警示边，建议走常规强调色）
// ============================================================
async function loadAdminFeedback() {
  const el = document.getElementById('admin-feedback-list');
  setBadge('admin-feedback', 0); // 点开瞬间红点即灭（新反馈由轮询在离开本页后重新点亮）
  el.innerHTML = `<div class="empty-state"><p>${UI.LOADING}</p></div>`;
  try {
    const data = await api(`/api/feedbacks?username=${encodeURIComponent(state.user.username)}`);
    const list = data.feedbacks || [];
    if (!list.length) { el.innerHTML = `<div class="empty-state"><p>${UI.ADMIN_FEEDBACK_EMPTY}</p></div>`; return; }
    el.innerHTML = list.map(f => {
      const isBug = f.kind === 'bug';
      const resolved = f.status === 'resolved';
      return `<div class="list-card feedback-card${isBug ? ' feedback-card--bug' : ''}${resolved ? ' feedback-card--resolved' : ''}">
        <div class="list-card-header">
          <span class="list-card-title">${escHtml(f.title || UI.BTN_FEEDBACK)}</span>
          <span class="feedback-tags">
            <span class="tag ${isBug ? 'tag-danger' : 'tag-accent'}">${isBug ? UI.FEEDBACK_TAG_BUG : UI.FEEDBACK_TAG_SUGGEST}</span>
            <span class="tag ${resolved ? 'tag-ok' : 'tag-warn'}">${resolved ? UI.FEEDBACK_STATUS_RESOLVED : UI.FEEDBACK_STATUS_OPEN}</span>
          </span>
        </div>
        <div class="list-card-detail feedback-content">${escHtml(f.content)}</div>
        <div class="feedback-foot">
          <span class="list-card-meta">${escHtml(f.username)} · ${fmtDateTime(f.created_at)}</span>
          ${resolved ? '' : `<button type="button" class="btn btn-outline btn-xs" onclick="resolveAdminFeedback(${f.id})">${UI.BTN_MARK_RESOLVED}</button>`}
        </div>
      </div>`;
    }).join('');
    initReveals(el);
  } catch (err) {
    el.innerHTML = `<div class="empty-state"><p>${UI.ERROR_LOAD_PREFIX}${escHtml(err.message)}</p></div>`;
  }
}

// 标记反馈已处理（后端通知提出者）
async function resolveAdminFeedback(feedbackId) {
  try {
    await api(`/api/feedbacks/${feedbackId}/resolve`, { method: 'POST', body: { username: state.user.username } });
    showToast(UI.FEEDBACK_RESOLVED_TOAST);
    loadAdminFeedback();
  } catch (err) { showToast(err.message); }
}

// ============================================================
// 模块3：试课意向（教师提交 / 学生在需求内展开处理）
// ============================================================
async function submitIntent(demandId) {
  try {
    await api(`/api/demands/${demandId}/intents`, { method: 'POST', body: { userId: state.user.id } });
    showToast(UI.INTENT_SUBMITTED_TOAST);
    if (state.page === 'browse-demands') loadBrowseDemands(); // 按钮刷新为「意向已提交」态
  } catch (err) {
    if (String(err.message).includes('档案不完整')) { showProfileIncompleteModal(); return; }
    showToast(err.message);
  }
}

// 档案不完整：拦截提交并引导去补档案（后端同样把关，弹窗只是更友好的引导）
function showProfileIncompleteModal() {
  document.getElementById('modal-container').innerHTML = `<div class="modal-overlay" onclick="if(event.target===this)closeModal()">
    <div class="modal" style="max-width:420px;">
      <div class="modal-header"><h2>${UI.PROFILE_INCOMPLETE_TITLE}</h2><button type="button" class="btn btn-ghost btn-icon" onclick="closeModal()">✕</button></div>
      <div class="modal-body">
        <p class="text-sm" style="color:var(--ink-3);line-height:1.7;">${UI.PROFILE_INCOMPLETE_HINT}</p>
        <div class="modal-footer">
          <button type="button" class="btn btn-outline" onclick="closeModal()">${UI.BTN_LATER}</button>
          <button type="button" class="btn btn-primary" onclick="closeModal();selectPage('edit-profile')">${UI.BTN_GO_COMPLETE_PROFILE}</button>
        </div>
      </div>
    </div>
  </div>`;
}

// 展开 / 收起某条需求的意向列表（学生端）：grid-rows 动效 + ▾ 翻转，首次展开才拉数据
async function toggleDemandIntents(demandId) {
  const box = document.getElementById(`intents-box-${demandId}`);
  if (!box) return;
  const toggle = document.getElementById(`intent-toggle-${demandId}`);
  const open = box.classList.toggle('open');
  if (toggle) toggle.classList.toggle('open', open); // v 形箭头翻转
  if (open) {
    const dot = document.getElementById(`intent-dot-${demandId}`);
    if (dot) dot.classList.add('hidden'); // 打开即视为已读，红点消除
  }
  if (open && !box.dataset.loaded) await refreshIntentsBox(demandId);
}

async function refreshIntentsBox(demandId) {
  const box = document.getElementById(`intents-box-${demandId}`);
  if (!box) return;
  const inner = box.querySelector('.intents-box-inner') || box;
  inner.innerHTML = `<div class="intents-box-content"><p class="text-sm text-muted">${UI.LOADING}</p></div>`;
  try {
    const data = await api(`/api/demands/${demandId}/intents`);
    const ts = data.teachers || [];
    // 缓存意向教师，供「查看」打开教师详情弹窗复用（openTeacherModal 第三数据源）
    ts.forEach(t => {
      state.intentTeachers = state.intentTeachers.filter(x => x.user_id !== t.user_id);
      state.intentTeachers.push(t);
    });
    const content = `<div class="section-title">${UI.INTENTS_TITLE} (${ts.length})</div>` +
      (ts.length ? ts.map(t => renderIntentTeacherRow(t, demandId)).join('')
                 : `<p class="text-sm text-muted">${UI.EMPTY_NO_INTENTS}</p>`);
    inner.innerHTML = `<div class="intents-box-content">${content}</div>`;
    box.dataset.loaded = '1';
  } catch (err) {
    inner.innerHTML = `<div class="intents-box-content"><p class="text-sm text-muted">${UI.ERROR_LOAD_PREFIX}${err.message}</p></div>`;
  }
}

function renderIntentTeacherRow(t, demandId) {
  const st = t.intent_status;
  const tag = st === 'accepted' ? `<span class="tag tag-ok">${UI.INTENT_STATUS_ACCEPTED}</span>`
    : st === 'rejected' ? `<span class="tag tag-danger">${UI.INTENT_STATUS_REJECTED}</span>` : `<span class="tag tag-warn">${UI.INTENT_STATUS_PENDING}</span>`;
  const provName = (typeof SUFE_REGIONS !== 'undefined' && t.province) ? SUFE_REGIONS.provinceName(t.province) : '';
  const viewBtn = `<button type="button" class="btn btn-outline btn-xs" onclick="openTeacherModal(${t.user_id})">${UI.BTN_VIEW}</button>`;
  const actions = st === 'pending'
    ? `<button type="button" class="btn btn-accent btn-xs" onclick="resolveIntent(${t.intent_id},'accept',${demandId})">${UI.BTN_AGREE}</button>
       <button type="button" class="btn btn-outline btn-xs" onclick="resolveIntent(${t.intent_id},'reject',${demandId})">${UI.BTN_REJECT}</button>` : '';
  return `<div class="admin-row">
    <div class="admin-row-main">
      <div class="admin-row-line"><strong>${escHtml(t.username)}</strong> ${renderStars(t.rating)} ${tag}</div>
      <div class="admin-row-meta">${[provName, `${t.price || '?'}${UI.PRICE_UNIT}`].filter(Boolean).join(' · ')}</div>
    </div>
    <div class="admin-row-actions">${viewBtn}${actions}</div>
  </div>`;
}

// 学生同意 / 拒绝意向；同意后自动建立会话，可前往「我的沟通」
async function resolveIntent(intentId, action, demandId) {
  try {
    await api(`/api/intents/${intentId}/resolve`, { method: 'POST', body: { userId: state.user.id, action } });
    showToast(action === 'accept' ? UI.INTENT_ACCEPTED_TOAST : UI.INTENT_REJECTED_TOAST);
    await refreshIntentsBox(demandId);
    loadMyDemands(); // 刷新意向计数（整列重渲染，意向栏回到收起态）
  } catch (err) { showToast(err.message); }
}

// ============================================================
// 教师档案编辑
// ============================================================
function initProfileForm() {
  document.getElementById('profile-province-wrap').innerHTML =
    renderProvinceSelect('profile-province', '', 'onchange="onTeacherProvinceChange()"');
  const gradeEl = document.getElementById('profile-grade');
  gradeEl.innerHTML = `<option value="">${UI.OPTION_PLACEHOLDER}</option>` + TEACHER_GRADES.map(g=>`<option value="${g.id}">${g.name}</option>`).join('');
  const genderEl = document.getElementById('profile-gender');
  genderEl.innerHTML = `<option value="">${UI.OPTION_PLACEHOLDER}</option>` + GENDERS.map(g=>`<option value="${g.id}">${g.name}</option>`).join('');

  const subjEl = document.getElementById('profile-subjects');
  subjEl.innerHTML = SUBJECTS.map(s=>`
    <label class="checkbox-item"><input type="checkbox" value="${s.id}">${s.name}</label>
  `).join('');
  subjEl.addEventListener('change', onTeacherSubjectsChange); // 擅长科目驱动高考填写组件按需加载
  // 高考成绩区改由省份驱动（app-region.js）：选省份后渲染锁定编辑器；科目勾选仅标记擅长科目
  document.getElementById('profile-gaokao-scores').innerHTML = `<p class="text-sm text-muted">${UI.HINT_SELECT_PROVINCE_GAOKAO}</p>`;
  // 联系方式（微信/邮箱）标签注入「签约后向对方展示」小注（index.html 静态表单，文案统一走常量）
  ['#profile-wechat', '#profile-email'].forEach(sel => {
    const inp = document.querySelector(sel);
    const lab = inp && inp.closest('.form-group') && inp.closest('.form-group').querySelector('.form-label');
    if (lab && !lab.querySelector('.form-label-note')) {
      lab.insertAdjacentHTML('beforeend', `<span class="form-label-note">${UI.CONTACT_AFTER_SIGN_NOTE}</span>`);
    }
  });
  initCustomSelects(document.querySelector('.profile-form')); // 省份/年级/性别下拉统一换自定义组件
  loadProfile();
}

async function loadProfile() {
  try {
    const data = await api(`/api/teacher/profile?userId=${state.user.id}`);
    if (data.profile) {
      const p = data.profile;
      document.getElementById('profile-grade').value = p.grade || '';
      document.getElementById('profile-gender').value = p.gender || '';
      document.getElementById('profile-price').value = p.price || '';
      document.getElementById('profile-wechat').value = p.wechat || '';
      document.getElementById('profile-email').value = p.email || '';
      document.getElementById('profile-intro').value = p.intro || '';
      document.getElementById('profile-address').value = p.address || '';
      if (p.subjects?.length) {
        p.subjects.forEach(id => {
          const cb = document.querySelector(`#profile-subjects input[value="${id}"]`);
          if (cb) cb.checked = true;
        });
      }
      // 省份 + 擅长科目共同决定编辑器：须先勾科目再渲染（编辑器按勾选集按需加载）
      if (p.province) {
        document.getElementById('profile-province').value = p.province;
        document.getElementById('profile-gaokao-scores').innerHTML =
          renderTeacherGaokaoEditor(p.province, p.gaokao_scores || []);
        initCustomSelects(document.getElementById('profile-gaokao-scores'));
      }
      // 程序回填不派发 change：手动同步自定义下拉的触发器文字
      document.querySelectorAll('.profile-form select').forEach(syncCustomSelectText);
    }
  } catch (err) { console.error(err); }
}

function pickGrade(el) {
  el.closest('.grade-selector').querySelectorAll('.grade-option').forEach(o=>o.classList.remove('selected'));
  el.classList.add('selected');
}

async function handleSaveProfile(e) {
  e.preventDefault();
  const alertEl = document.getElementById('profile-alert');
  const province = document.getElementById('profile-province').value;
  if (!province) { alertEl.innerHTML = `<div class="alert alert-error">${UI.VALIDATE_SELECT_PROVINCE}</div>`; return; }
  const subjects = [...document.querySelectorAll('#profile-subjects input:checked')].map(cb=>cb.value);
  if (!subjects.length) { alertEl.innerHTML = `<div class="alert alert-error">${UI.VALIDATE_SELECT_SUBJECT}</div>`; return; }

  // 省份锁定组件的收集函数（app-region.js），输出与旧 gaokao_scores 形状兼容
  const gaokaoScores = collectTeacherGaokao();

  try {
    const btn = document.getElementById('profile-submit');
    btn.disabled = true; btn.innerHTML = '<span class="spinner"></span>';
    await api('/api/teacher/profile', {
      method: 'POST', body: { userId: state.user.id, profile: {
        province,
        grade: document.getElementById('profile-grade').value,
        gender: document.getElementById('profile-gender').value,
        subjects, gaokao_scores: gaokaoScores,
        price: +document.getElementById('profile-price').value || 0,
        wechat: document.getElementById('profile-wechat').value.trim(),
        email: document.getElementById('profile-email').value.trim(),
        intro: document.getElementById('profile-intro').value.trim(),
        address: document.getElementById('profile-address').value.trim(),
      }},
    });
    alertEl.innerHTML = `<div class="alert alert-success">${UI.SUCCESS_PROFILE_SAVED}</div>`;
  } catch (err) {
    alertEl.innerHTML = `<div class="alert alert-error">${err.message}</div>`;
  } finally {
    const btn = document.getElementById('profile-submit');
    btn.disabled = false; btn.textContent = UI.BTN_SAVE;
  }
}

// ============================================================
// 管理员
// ============================================================
async function generateInviteCode() {
  const btn = document.getElementById('gen-invite-btn');
  const display = document.getElementById('invite-code-display');
  try {
    btn.disabled = true; btn.innerHTML = '<span class="spinner"></span>';
    const data = await api('/api/admin/invite', { method: 'POST', body: { username: state.user.username } });
    state.currentInviteCode = data;
    document.getElementById('invite-code-text').textContent = data.code;
    display.classList.remove('hidden');
    startInviteTimer(new Date(data.expiresAt));
  } catch (err) { showToast(UI.ERROR_GENERATE_INVITE + err.message); }
  finally { btn.disabled = false; btn.textContent = UI.BTN_GENERATE_INVITE; }
}

function startInviteTimer(expiresAt) {
  if (state.inviteTimerId) clearInterval(state.inviteTimerId);
  const update = () => {
    const rem = expiresAt - new Date();
    if (rem <= 0) { clearInterval(state.inviteTimerId); document.getElementById('invite-code-timer').textContent = UI.INVITE_EXPIRED; return; }
    const m = Math.floor(rem/60000), s = Math.floor((rem%60000)/1000);
    document.getElementById('invite-code-timer').textContent = `${m}:${String(s).padStart(2,'0')}${UI.INVITE_EXPIRES_SUFFIX}`;
  };
  update();
  state.inviteTimerId = setInterval(update, 1000);
}

function copyInviteCode() {
  if (!state.currentInviteCode) return;
  navigator.clipboard?.writeText(state.currentInviteCode.code).then(() => showToast(UI.SUCCESS_COPIED));
}

// 统计面板（原「管理员面板」，去掉待审核评价——审核并入「评价管理」；
// 结构上保留 stats-grid + 若干 admin-panel 板块，后期扩展统计数据直接加板块即可）
async function loadAdminStats() {
  const el = document.getElementById('admin-stats-content');
  el.innerHTML = `<div class="empty-state"><p>${UI.LOADING}</p></div>`;
  try {
    const statsData = await api(`/api/admin/stats?username=${encodeURIComponent(state.user.username)}`);
    const s = statsData.stats;

    el.innerHTML = `
      <div class="stats-grid">
        <div class="stat-card"><div class="stat-value blue">${s.users.total}</div><div class="stat-label">${UI.ADMIN_TOTAL_USERS}</div></div>
        <div class="stat-card"><div class="stat-value green">${s.users.students}</div><div class="stat-label">${UI.ADMIN_STUDENTS}</div></div>
        <div class="stat-card"><div class="stat-value blue">${s.users.teachers}</div><div class="stat-label">${UI.ADMIN_TEACHERS}</div></div>
        <div class="stat-card"><div class="stat-value amber">${s.demands}</div><div class="stat-label">${UI.ADMIN_DEMANDS}</div></div>
        <div class="stat-card"><div class="stat-value blue">${s.profiles}</div><div class="stat-label">${UI.ADMIN_PROFILES}</div></div>
        <div class="stat-card"><div class="stat-value green">${s.reviews.approved}</div><div class="stat-label">${UI.ADMIN_REVIEWS_APPROVED}</div></div>
        <div class="stat-card"><div class="stat-value amber">${s.reviews.pending}</div><div class="stat-label">${UI.ADMIN_REVIEWS_PENDING}</div></div>
        <div class="stat-card"><div class="stat-value red">${s.invites.used||0}</div><div class="stat-label">${UI.ADMIN_INVITES_USED}</div></div>
      </div>

      <div class="admin-panel">
        <h3>${UI.ADMIN_RECENT_USERS}</h3>
        ${s.recentUsers.map(u => `<div style="display:flex;justify-content:space-between;padding:var(--s2) 0;border-bottom:1px solid var(--border-light);font-size:0.8125rem;">
          <span><strong>${escHtml(u.username)}</strong> <span class="tag">${u.role==='student'?UI.ROLE_STUDENT:u.role==='teacher'?UI.ROLE_TEACHER:UI.ADMIN_BADGE}</span></span>
          <span class="text-muted">${fmtDateTime(u.created_at)}</span>
        </div>`).join('')}
      </div>

      <div class="admin-panel">
        <h3>${UI.ADMIN_RECENT_DEMANDS}</h3>
        ${s.recentDemands.map(d => `<div style="display:flex;justify-content:space-between;padding:var(--s2) 0;border-bottom:1px solid var(--border-light);font-size:0.8125rem;">
          <span><strong>${escHtml(d.username)}</strong> ${STUDENT_GRADES.find(g=>g.id===d.student_grade)?.name||''} ${d.target_subjects.map(id=>SUBJECTS.find(s=>s.id===id)?.name||'').join('、')}</span>
          <span class="text-muted">${fmtDateTime(d.created_at)}</span>
        </div>`).join('')}
      </div>
    `;
  } catch (err) {
    el.innerHTML = `<div class="empty-state"><p>${UI.ERROR_LOAD_PREFIX}${err.message}</p></div>`;
  }
}

// 学生 / 教师管理（封禁的账户无法登录）
async function loadAdminUsers(role, elId) {
  const el = document.getElementById(elId);
  el.innerHTML = `<div class="empty-state"><p>${UI.LOADING}</p></div>`;
  try {
    const data = await api(`/api/admin/users?username=${encodeURIComponent(state.user.username)}&role=${role}`);
    const users = data.users || [];
    if (!users.length) { el.innerHTML = `<div class="empty-state"><p>${UI.EMPTY_NO_USERS}</p></div>`; return; }
    if (role === 'teacher') state.adminTeachers = users; // 教师详情弹窗的数据源
    el.innerHTML = users.map(u => renderAdminUserRow(u, role)).join('');
  } catch (err) {
    el.innerHTML = `<div class="empty-state"><p>${UI.ERROR_LOAD_PREFIX}${err.message}</p></div>`;
  }
}
function loadAdminStudents() { return loadAdminUsers('student', 'admin-students-list'); }
function loadAdminTeachers() { return loadAdminUsers('teacher', 'admin-teachers-list'); }

function renderAdminUserRow(u, role) {
  const uid = role === 'teacher' ? u.user_id : u.id;
  const meta = role === 'teacher'
    ? `${TEACHER_GRADES.find(g => g.id === u.grade)?.name || '—'} · ${(u.rating || 4).toFixed(1)}${UI.RATING_SCORE_SUFFIX} · ${u.price || '?'}${UI.PRICE_UNIT}`
    : `${u.demand_count || 0}${UI.DEMAND_COUNT_SUFFIX}`;
  return `<div class="admin-row">
    <div class="admin-row-main">
      <div class="admin-row-line">
        <strong>${escHtml(u.username)}</strong>
        ${u.banned ? `<span class="tag tag-danger">${UI.TAG_BANNED}</span>` : ''}
      </div>
      <div class="admin-row-meta">${meta} · ${UI.REGISTERED_AT_PREFIX}${fmtDateTime(u.created_at)}</div>
    </div>
    <div class="admin-row-actions">
      ${role === 'teacher' ? `<button type="button" class="btn btn-outline btn-xs" onclick="openTeacherModal(${uid})">${UI.BTN_VIEW_DETAIL}</button>` : ''}
      ${u.banned
        ? `<button type="button" class="btn btn-outline btn-xs" onclick="confirmBanUser(${uid}, 0)">${UI.UNBAN}</button>`
        : `<button type="button" class="btn btn-danger btn-xs" onclick="confirmBanUser(${uid}, 1)">${UI.BAN}</button>`}
    </div>
  </div>`;
}

// 需求管理（移除走管理员通道，不受归属限制）
async function loadAdminDemands() {
  const el = document.getElementById('admin-demands-list');
  el.innerHTML = `<div class="empty-state"><p>${UI.LOADING}</p></div>`;
  try {
    const data = await api('/api/student/demands');
    const demands = data.demands || [];
    if (!demands.length) { el.innerHTML = `<div class="empty-state"><p>${UI.EMPTY_NO_DEMANDS}</p></div>`; return; }
    el.innerHTML = demands.map(d => renderDemandCard(d, { admin: true })).join('');
  } catch (err) {
    el.innerHTML = `<div class="empty-state"><p>${UI.ERROR_LOAD_PREFIX}${err.message}</p></div>`;
  }
}

// 评价管理（含审核：通过 / 拒绝 / 删除；可按状态过滤）
async function loadAdminReviews() {
  const el = document.getElementById('admin-reviews-list');
  const status = document.getElementById('admin-reviews-status')?.value || '';
  el.innerHTML = `<div class="empty-state"><p>${UI.LOADING}</p></div>`;
  try {
    const data = await api(`/api/admin/reviews?username=${encodeURIComponent(state.user.username)}${status ? `&status=${status}` : ''}`);
    const reviews = data.reviews || [];
    if (!reviews.length) { el.innerHTML = `<div class="empty-state"><p>${UI.EMPTY_NO_REVIEWS}</p></div>`; return; }
    el.innerHTML = reviews.map(renderAdminReviewRow).join('');
  } catch (err) {
    el.innerHTML = `<div class="empty-state"><p>${UI.ERROR_LOAD_PREFIX}${err.message}</p></div>`;
  }
}

function renderAdminReviewRow(r) {
  const statusTag = r.status === 'approved' ? `<span class="tag tag-ok">${UI.STATUS_APPROVED}</span>`
    : r.status === 'rejected' ? `<span class="tag tag-danger">${UI.STATUS_REJECTED}</span>`
    : `<span class="tag tag-warn">${UI.STATUS_PENDING}</span>`;
  return `<div class="admin-row">
    <div class="admin-row-main">
      <div class="admin-row-line">
        <strong>${escHtml(r.teacher_name || '')}</strong>
        <span class="text-muted">←</span> ${escHtml(r.reviewer_name || '')}
        ${renderStars(r.rating)} ${statusTag}
      </div>
      <div class="review-text">${escHtml(r.comment)}</div>
      <div class="admin-row-meta">${fmtDateTime(r.created_at)}</div>
    </div>
    <div class="admin-row-actions">
      ${r.status === 'pending' ? `<button type="button" class="btn btn-accent btn-xs" onclick="adminReviewAction(${r.id},'approve',0)">${UI.BTN_APPROVE}</button>
      <button type="button" class="btn btn-outline btn-xs" onclick="adminReviewAction(${r.id},'reject',0)">${UI.BTN_REJECT}</button>` : ''}
      <button type="button" class="btn btn-danger btn-xs" onclick="confirmDeleteReview(${r.id},0)">${UI.BTN_DELETE_REVIEW}</button>
    </div>
  </div>`;
}

// ============================================================
// Toast
// ============================================================
function showToast(msg) {
  const toast = document.createElement('div');
  toast.style.cssText = 'position:fixed;bottom:24px;left:50%;transform:translateX(-50%);background:#0f172a;color:#fff;padding:12px 24px;font-size:0.875rem;font-weight:500;z-index:300;animation:fadeUp 0.3s ease;';
  toast.textContent = msg;
  document.body.appendChild(toast);
  setTimeout(() => { toast.style.opacity = '0'; toast.style.transition = 'opacity 0.3s'; setTimeout(() => toast.remove(), 300); }, 2500);
}

// ============================================================
// Init
// ============================================================
document.addEventListener('DOMContentLoaded', async () => {
  // 尝试自动登录
  try {
    const saved = JSON.parse(localStorage.getItem('sufe_session'));
    if (saved && saved.user && saved.password && saved.expires > Date.now()) {
      const data = await api('/api/auth/login', {
        method: 'POST', body: { username: saved.user.username, password: saved.password },
      });
      state.user = data.user;
      // 更新保存的 user 信息（可能角色或管理员状态有变）
      localStorage.setItem('sufe_session', JSON.stringify({ ...saved, user: state.user }));
      enterClient();
      return;
    } else if (saved) {
      localStorage.removeItem('sufe_session'); // 过期清理
    }
  } catch {
    localStorage.removeItem('sufe_session'); // 登录失败清理
  }
  initCustomSelects(); // 静态页面上的筛选/评价状态下拉统一换自定义组件
  showView('landing');
});

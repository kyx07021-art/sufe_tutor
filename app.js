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
                myDemands: [], editingDemandId: null,
                inviteTimerId: null, currentInviteCode: null, validatedInviteCode: null };

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
    { id: 'notifications',    label: UI.PAGE_NOTIFICATIONS,   desc: UI.PAGE_NOTIFICATIONS_DESC,   enter: enterNotifications },
    { id: 'account-settings', label: UI.PAGE_ACCOUNT_SETTINGS, desc: UI.PAGE_ACCOUNT_SETTINGS_DESC, enter: enterAccountSettings },
  ],
  teacher: [
    { id: 'browse-demands',   label: UI.PAGE_BROWSE_DEMANDS,  desc: UI.PAGE_BROWSE_DEMANDS_DESC,  enter: loadBrowseDemands },
    { id: 'resource-share',   label: UI.PAGE_RESOURCE_SHARE,  desc: UI.PAGE_RESOURCE_SHARE_DESC,  enter: () => enterResourceShare() },
    { id: 'my-chats',         label: UI.PAGE_MY_CHATS,        desc: UI.PAGE_MY_CHATS_DESC,        enter: () => enterMyChats() },
    { id: 'edit-profile',     label: UI.PAGE_EDIT_PROFILE,    desc: UI.PAGE_EDIT_PROFILE_DESC,    enter: initProfileForm },
    { id: 'notifications',    label: UI.PAGE_NOTIFICATIONS,   desc: UI.PAGE_NOTIFICATIONS_DESC,   enter: enterNotifications },
    { id: 'account-settings', label: UI.PAGE_ACCOUNT_SETTINGS, desc: UI.PAGE_ACCOUNT_SETTINGS_DESC, enter: enterAccountSettings },
  ],
  admin: [
    { id: 'admin-stats',      label: UI.PAGE_ADMIN_STATS,    desc: UI.PAGE_ADMIN_STATS_DESC,    enter: loadAdminStats },
    { id: 'admin-students',   label: UI.PAGE_ADMIN_STUDENTS, desc: UI.PAGE_ADMIN_STUDENTS_DESC, enter: loadAdminStudents },
    { id: 'admin-teachers',   label: UI.PAGE_ADMIN_TEACHERS, desc: UI.PAGE_ADMIN_TEACHERS_DESC, enter: loadAdminTeachers },
    { id: 'admin-demands',    label: UI.PAGE_ADMIN_DEMANDS,  desc: UI.PAGE_ADMIN_DEMANDS_DESC,  enter: loadAdminDemands },
    { id: 'admin-reviews',    label: UI.PAGE_ADMIN_REVIEWS,  desc: UI.PAGE_ADMIN_REVIEWS_DESC,  enter: loadAdminReviews },
    { id: 'notifications',    label: UI.PAGE_NOTIFICATIONS,  desc: UI.PAGE_NOTIFICATIONS_DESC,  enter: enterNotifications },
    { id: 'account-settings', label: UI.PAGE_ACCOUNT_SETTINGS, desc: UI.PAGE_ACCOUNT_SETTINGS_DESC, enter: enterAccountSettings },
  ],
};

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
  // 用户块置侧边栏最下方（白底），属性灰小字写在 id 下方
  document.getElementById('sidebar-user').innerHTML = `
    <div class="sidebar-user-name">${escHtml(u.username)}</div>
    <div class="sidebar-user-role">${roleLabel}</div>`;
  // 栏目 = 主页 entry 同款排布：亮紫序号 + 大字标题 + 选中展开简介；黑色选中块由 .sidebar-pill 滑动承担
  document.getElementById('sidebar-nav').innerHTML =
    `<span class="sidebar-pill" id="sidebar-pill" aria-hidden="true"></span>` +
    pagesForRole().map((p, i) => `
    <button type="button" class="sidebar-item" data-page="${p.id}" onclick="selectPage('${p.id}')">
      <span class="sidebar-item-index" aria-hidden="true">${String(i + 1).padStart(2, '0')}</span>
      <span class="sidebar-item-body">
        <span class="sidebar-item-label">${p.label}${BADGE_PAGES.includes(p.id) ? `<span class="sidebar-dot hidden" id="sidebar-${p.id}-dot"></span>` : ''}</span>
        <span class="sidebar-item-descwrap"><span class="sidebar-item-desc">${p.desc || ''}</span></span>
      </span>
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
const BADGE_PAGES = ['my-chats', 'browse-demands', 'notifications'];
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
    setBadge('my-chats', chatUnread);
    setBadge('notifications', notifUnread);
    if (state.user.role === 'teacher') {
      const pushData = await api(`/api/demand-pushes?teacherUserId=${state.user.id}`);
      setBadge('browse-demands', (pushData.pushes || []).length);
    } else setBadge('browse-demands', 0);
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
  state.myDemands = []; state.editingDemandId = null;
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
              <input type="number" class="form-input" id="d-budget-min" placeholder="${UI.PLACEHOLDER_MIN}" min="0" step="10" style="flex:1;">
              <span class="text-muted">~</span>
              <input type="number" class="form-input" id="d-budget-max" placeholder="${UI.PLACEHOLDER_MAX}" min="0" step="10" style="flex:1;">
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
    const initial = escHtml((t.username || '?').charAt(0).toUpperCase());
    return `<div class="list-card list-card--teacher">
      <div class="tc-avatar" aria-hidden="true">${initial}</div>
      <div class="tc-identity">
        <span class="tc-username" onclick="openTeacherModal(${t.user_id})">${escHtml(t.username)}</span>
        <span class="tc-rating">${renderStars(t.rating)}<b>${(t.rating||4).toFixed(1)}</b></span>
      </div>
      <div class="tc-right">
        <div class="tc-info1">${escHtml(info1)}</div>
        ${info2 ? `<div class="tc-info2">${escHtml(info2)}</div>` : ''}
        <div class="tc-actions">
          ${isStudent ? `<button type="button" class="tc-push-btn" onclick="openSendDemandModal(${t.user_id})">${UI.BTN_PUSH_DEMAND} <span class="arrow">→</span></button>` : ''}
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
  document.getElementById('teacher-filters').classList.toggle('hidden');
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
        ${provName ? `<div class="subject-block"><div class="section-title">${UI.SECTION_REGION}</div>
          <div class="subject-row"><span>${escHtml(provName)}</span></div></div>` : ''}
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

  return `<div class="list-card">
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
      ${editable ? `<button type="button" class="btn btn-outline btn-sm" onclick="toggleDemandIntents(${d.id})">${UI.INTENTS_TITLE} (${d.intent_count || 0}) <span class="intent-caret" id="intent-caret-${d.id}">▾</span></button>` : ''}
    </div>
    ${editable ? `<div class="intents-box" id="intents-box-${d.id}"><div class="intents-box-inner"></div></div>` : ''}
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
    if (mine) state.myDemands = demands; // 编辑回填的数据源
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
    setBadge('browse-demands', pushes.length); // 进页即同步红点（轮询也会刷）
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

async function submitDemandPush(teacherUserId) {
  const sel = document.querySelector('input[name="push-demand"]:checked');
  if (!sel) { showToast(UI.VALIDATE_SELECT_DEMAND); return; }
  try {
    const data = await api('/api/demand-pushes', { method: 'POST', body: { userId: state.user.id, teacherUserId, demandId: +sel.value } });
    closeModal();
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
  el.innerHTML = `<div class="empty-state"><p>${UI.LOADING}</p></div>`;
  try {
    const data = await api(`/api/notifications?userId=${state.user.id}`);
    const list = data.notifications || [];
    if (!list.length) { el.innerHTML = `<div class="empty-state"><p>${UI.EMPTY_NO_NOTIFICATIONS}</p></div>`; return; }
    el.innerHTML = list.map(n => `<div class="notif-item${n.is_read ? '' : ' unread'}">
      <span class="notif-dot${n.is_read ? ' read' : ''}"></span>
      <div class="notif-body">
        <div class="notif-text">${escHtml(n.text)}</div>
        <div class="notif-time">${fmtDateTime(n.created_at)}</div>
      </div>
    </div>`).join('');
    initReveals(el);
    if (list.some(n => !n.is_read)) {
      setBadge('notifications', 0);
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
    <div class="settings-list">
      ${row(UI.SETTINGS_USERNAME, escHtml(u.username), false)}
      ${row(UI.SETTINGS_ROLE, roleLabel, false)}
      ${row(UI.SETTINGS_PHONE, UI.SETTINGS_UNBOUND, true)}
      ${row(UI.SETTINGS_EMAIL, UI.SETTINGS_UNBOUND, true)}
    </div>
    <button type="button" class="btn btn-danger settings-logout" onclick="confirmLogout()">${UI.BTN_LOGOUT}</button>`;
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
  const caret = document.getElementById(`intent-caret-${demandId}`);
  const open = box.classList.toggle('open');
  if (caret) caret.classList.toggle('open', open);
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
      }
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
  showView('landing');
});

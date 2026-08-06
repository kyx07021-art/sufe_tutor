/**
 * 上财家教平台 - 前端主模块（壳与状态层）
 *
 * 分层契约（详见 docs/architecture.md 搭积木指南）：
 *   本文件 = 导航/侧边栏/登录通路(ensureAuth)/装载器(loadInto)/缓存协议(invalidate)/各页面 enter。
 *   数据→展示文本一律走 app-display.js（SUFE_DISPLAY 纯函数），本文件不手写枚举映射。
 *   列表装载一律走 loadInto（loading/空态/错误转义/浮入/乱序守卫），不手写四件套。
 *   需要身份的页面/操作经 ensureAuth 唯一通路；子模块 app-chat/app-posts/app-region 可用本文件全局设施。
 */

// ============================================================
// 常量（来自 constants.js）
// ============================================================
// 科目满分/等第档位等业务数据已迁至 region-data.js（按省份政策驱动），此处仅留 UI 必需集
const { SUBJECTS, STUDENT_GRADES,
        TEACHER_GRADES, GENDERS, TEACHING_METHODS, UI } = APP_CONSTANTS;

// 统一显示层（app-display.js，本文件之前加载）：科目/角色/省名/星级/评分/状态 tag 等纯展示函数
const DISP = globalThis.SUFE_DISPLAY;

// ============================================================
// 状态
// ============================================================
const state = { user: null, authToken: null, view: 'landing', page: null, allTeachers: [], adminTeachers: [], intentTeachers: [],
                myReviewOnModal: null,
                myDemands: [], editingDemandId: null, adminPosts: [], adminContracts: [], myContracts: [],
                inviteTimerId: null, currentInviteCode: null, validatedInviteCode: null,
                guestRole: null, guestAuthMode: false }; // 访客模式：guestRole = 主页按钮进入时的角色；guestAuthMode = 正被 ensureAuth 导向登录页

// ============================================================
// 头像组件（全站共用）：圆形，上传图片则居中裁切展示，未上传 = id 首字符 + 米色底。
// profileUserId 有值 → 头像成为个人信息右栏入口（聚焦动效，stopPropagation 防穿透父级点击）
// ============================================================
function renderAvatarHtml(avatar, name, cls, profileUserId) {
  const inner = avatar
    ? `<img src="${escHtml(avatar)}" alt="" loading="lazy">`
    : escHtml((name || '?').charAt(0).toUpperCase());
  const span = `<span class="avatar glass ${cls}${profileUserId ? ' avatar--link' : ''}"${avatar ? '' : ' aria-hidden="true"'}>${inner}</span>`;
  if (!profileUserId) return span;
  return `<span class="avatar-btn" role="button" tabindex="0" title="${UI.PROFILE_PANEL_TITLE}" onclick="event.stopPropagation();openProfilePanel(${profileUserId})">${span}</span>`;
}

// ============================================================
// 客户端配置：侧边栏栏目注册表
// 加栏目 = 这里加一条 + index.html 加一个 section[data-page] + 一个 enter 函数
// enter 引用的函数均为顶层声明，声明提升保证前向引用可用
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
    panel.className = 'custom-select-panel glass glass--float'; // 挂 body：脱离玻璃祖先 isolation 堆叠上下文（v0.19.25）；玻璃体在面板元素自身（v0.19.31），面板自身滚动时背景钉住不滚
    panel._wrap = wrap; // 选项点击经面板回找容器（面板已不在 wrap 内）
    wrap._customPanel = panel;
    document.body.appendChild(panel);
    wrap.append(trigger);
    buildCustomSelectPanel(sel);
    // 选项被动态重填（省份/年级等 innerHTML 重写）时自动重建面板
    new MutationObserver(() => buildCustomSelectPanel(sel)).observe(sel, { childList: true });
  });
}

function buildCustomSelectPanel(sel) {
  const wrap = sel.closest('.custom-select');
  if (!wrap) return;
  const panel = wrap._customPanel;
  if (!panel) return;
  // 选项放透明滚动层（v0.19.32）：玻璃体在面板元素上（磨砂生效），滚动通道纯透明无衬底——字透在玻璃上滚
  panel.innerHTML = `<div class="custom-select-list">${[...sel.options].map(o =>
    `<button type="button" class="custom-option${o.value === sel.value ? ' selected' : ''}" data-value="${escHtml(o.value)}">${escHtml(o.textContent)}</button>`).join('')}</div>`;
  syncCustomSelectText(sel);
}

function syncCustomSelectText(sel) {
  const wrap = sel.closest('.custom-select');
  if (!wrap) return;
  const text = wrap.querySelector('.custom-select-text');
  const o = sel.options[sel.selectedIndex];
  text.textContent = o ? o.textContent : '';
  text.classList.toggle('custom-select-empty', !sel.value);
  const panel = wrap._customPanel;
  if (panel) panel.querySelectorAll('.custom-option').forEach(b => b.classList.toggle('selected', b.dataset.value === sel.value));
}

function toggleCustomSelect(wrap) {
  if (!wrap) return;
  const wasOpen = wrap.classList.contains('open');
  closeAllCustomSelects();
  if (!wasOpen) {
    positionCustomSelectPanel(wrap);
    wrap.classList.add('open');
    if (wrap._customPanel) wrap._customPanel.classList.add('open');
  }
}
function closeAllCustomSelects() {
  document.querySelectorAll('.custom-select.open').forEach(w => {
    w.classList.remove('open');
    if (w._customPanel) w._customPanel.classList.remove('open');
  });
}
// 面板挂 body 后 fixed 定位：以触发器 rect 计算坐标（脱离堆叠上下文，永不被卡片盖住）
function positionCustomSelectPanel(wrap) {
  const panel = wrap._customPanel, trig = wrap.querySelector('.custom-select-trigger');
  if (!panel || !trig) return;
  const r = trig.getBoundingClientRect();
  panel.style.left = `${r.left}px`;
  panel.style.top = `${r.bottom + 6}px`;
  panel.style.width = `${r.width}px`;
}
// 滚动即收起（fixed 面板不跟随滚动；capture 捕获所有滚动容器，但面板自身滚动除外——否则一滚面板就收）
document.addEventListener('scroll', e => {
  if (e.target.closest && e.target.closest('.custom-select-panel')) return;
  closeAllCustomSelects();
}, { capture: true, passive: true });
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
    const panel = opt.closest('.custom-select-panel');
    const wrap = panel && panel._wrap;
    const sel = wrap && wrap.querySelector('select');
    if (sel) {
      if (sel.value !== opt.dataset.value) {
        sel.value = opt.dataset.value;
        sel.dispatchEvent(new Event('change', { bubbles: true }));
      }
      wrap.classList.remove('open');
      if (wrap._customPanel) wrap._customPanel.classList.remove('open');
      syncCustomSelectText(sel);
    }
    return;
  }
  if (!e.target.closest('.custom-select') && !e.target.closest('.custom-select-panel')) closeAllCustomSelects();
});
// 键盘可达：非 button 的 [role=button]（如头像/用户名/等第 pill 等 span 控件）用 Enter/Space 触发其 onclick，补齐 a11y
document.addEventListener('keydown', e => {
  if (e.key !== 'Enter' && e.key !== ' ' && e.key !== 'Spacebar') return;
  const t = e.target;
  if (t && t.getAttribute && t.getAttribute('role') === 'button' && t.tagName !== 'BUTTON' && t.hasAttribute('onclick')) {
    e.preventDefault();
    t.click();
  }
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
  if (isNaN(d)) return escHtml(str.slice(0, 16)); // 解析失败：退回原串截断并转义（防未来攻击可控字段经此渲染）
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
  es.forEach(e => {
    if (e.isIntersecting) {
      // 预热 backdrop-filter 合成层：opacity 0.01（非 0 强制合成路径）渲染一帧让 saturate 滤镜完成 backdrop 采样，
      // 下一帧再播浮入——消除"先灰后艳"（v0.19.17 的 force layout 只预热了布局，合成器没预热）
      const el = e.target;
      el.style.transition = 'none';
      el.style.opacity = '0.01';
      requestAnimationFrame(() => requestAnimationFrame(() => {
        el.style.transition = '';
        el.style.opacity = '';
        el.classList.add('revealed');
      }));
    } else {
      e.target.classList.remove('revealed');
    }
  });
}, { threshold: 0.06 }) : null;

const revealWatched = new Set(); // 观察中的节点登记簿：每次 initReveals 先释放已脱离 DOM 的旧节点（observer 从不 unobserve 会强引用分离树造成泄漏；重播动效行为不变）
function initReveals(root) {
  if (!root) return;
  if (revealObserver) {
    for (const old of revealWatched) {
      if (!old.isConnected) { revealObserver.unobserve(old); revealWatched.delete(old); }
    }
  }
  const items = [...root.querySelectorAll('.list-card, .notif-item, .post-card')];
  items.forEach((el, i) => {
    el.classList.add('reveal');
    // 80ms 基底延迟 + 强制布局：给 ::before 的 backdrop-filter 合成层暖机，
    // 防"文字先出、磨砂提亮层后弹"的灰→艳闪烁（v0.19.17）
    void el.offsetHeight;
    el.style.setProperty('--reveal-delay', `${80 + Math.min(i * 45, 360)}ms`);
  });
  if (revealObserver) items.forEach(el => { revealObserver.observe(el); revealWatched.add(el); });
  else items.forEach(el => el.classList.add('revealed'));
}

// ============================================================
// API
// ============================================================
async function api(endpoint, options = {}) {
  const headers = { 'Content-Type': 'application/json', ...(options.headers || {}) };
  if (state.authToken) headers['X-Auth-Token'] = state.authToken; // 管理员接口凭此令牌鉴权（登录签发，7 天有效）
  const config = { ...options, headers };
  if (config.body && typeof config.body === 'object') config.body = JSON.stringify(config.body);
  const res = await fetch(endpoint, config);
  const data = await res.json();
  if (!res.ok) {
    // 401 兜底：带令牌仍被拒 = 会话已死（7 天过期 / 多端被顶号清会话），必须清本地登录态并汇入登录通路，
    // 否则内存里 state.user 还在、ensureAuth 放行，页面只剩一句「加载失败」假装还登录着
    if (res.status === 401) {
      if (state.authToken) {
        state.authToken = null; state.user = null;
        try { localStorage.removeItem('sufe_session'); } catch {}
        try { sessionStorage.removeItem('sufe_session'); } catch {}
      }
      if (state.view === 'client') ensureAuth(); // user 已清空 → 这次真的会进登录页
    }
    const e = new Error(data.error || UI.ERROR_REQUEST_FAILED);
    e.code = data.code; // C2：后端 error() 带稳定 code，前端按 code 分支（不脆耦合中文 MSG）
    throw e;
  }
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

// 当前页签持久化：刷新后回到原页
function storePage(pageId) { try { localStorage.setItem('sufe_page', pageId); } catch { /* ignore */ } }
function storedPage() { try { return localStorage.getItem('sufe_page') || ''; } catch { return ''; } }

function renderSidebar() {
  const u = state.user;
  const isAdmin = u && u.role === 'admin';
  // 用户块置侧边栏最下方（白底落地）：头像 + id + 灰小字属性，白框内最下层放运营脚注。
  // 访客态显示「未登录」占位块，点击即走 ensureAuth 登录通路
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
  // 栏目 = 主页 entry 同款排布：亮紫序号 + 大字标题 + 选中展开简介；黑色选中块由 .sidebar-pill 滑动承担
  document.getElementById('sidebar-nav').innerHTML =
    `<span class="sidebar-pill glass glass--float" id="sidebar-pill" aria-hidden="true"></span>` +
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
  if (cfg && cfg.auth !== false && !ensureAuth()) return; // 需要身份的页统一过登录通路（访客被导向特制登录页，登录后自动返回）
  if (cfg && cfg.enter) cfg.enter();
  closeSidebar();
  document.getElementById('client-main').scrollTop = 0;
}

// 侧边栏开合时选中黑块跟着宽度/高度过渡逐帧重绑（明确起点→终点，杜绝开闭间乱跳）
function sidebarPillGlide() {
  glidePill(document.getElementById('sidebar-pill'), document.getElementById('sidebar-nav'), '.sidebar-item', 380);
}
function closeSidebar()  { document.body.classList.remove('sidebar-open'); sidebarPillGlide(); }
function toggleSidebar() { document.body.classList.toggle('sidebar-open'); sidebarPillGlide(); }

// ============================================================
// 统一装载器：loading → 取数 → 空态/渲染/浮入，错误转义统一（曾有一半 catch 分支漏 escHtml）。
// seqKey 有值 → 内置乱序守卫（同 key 后发的请求到达后，先前在途响应一律丢弃）；
// opts: { empty: 空态文案, pick: data→rows 提取器, reveal: 是否接入浮入(默认 true) }
// 返回是否真正渲染了内容（切走页面/乱序丢弃时为 false，调用方据此决定是否做后续副作用）
// ============================================================
const loadSeqs = {};

// 缓存失效协议：任何改变数据的动作成功后 invalidate(key) 置空对应缓存，
// 下次读取（页面装载 / 红点轮询 / 个人信息面板）自然重拉——缓存只此一份，消灭「各缓存各自为政、永不失效」
const CACHE_KEYS = { teachers: 'allTeachers', contracts: 'myContracts', demands: 'myDemands', intentTeachers: 'intentTeachers' };
function invalidate(key) { const k = CACHE_KEYS[key]; if (k) state[k] = []; }
// 加载中组件（全站统一入口）：三根有规律伸缩的纵向柱体，非圆圈。
// size='sm' 用于按钮 / 行内（取 .spinner 小号）；默认大号用于整块内容装载占位
function loaderHtml(size) {
  const cls = size === 'sm' ? 'spinner' : 'loader';
  return `<span class="${cls}" role="status" aria-label="${UI.LOADING}"><i></i><i></i><i></i></span>`;
}

async function loadInto(elId, fetcher, renderer, opts = {}) {
  const el = document.getElementById(elId);
  if (!el) return false;
  // 计数器首用初始化：++undefined = NaN，而 NaN !== NaN 恒真 → 首次装载会被误判「乱序」而丢弃（帖子区永卡加载中的根因）
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
// 侧边栏红点徽标：未读会话 / 待处理推送(教师) / 未读通知，30s 慢轮询统一刷新；
// 各模块（如 app-chat 打开会话已读）也可即时回调 setBadge 消点
// ============================================================
const BADGE_PAGES = ['my-chats', 'browse-demands', 'notifications', 'my-contracts', 'admin-feedback'];
let badgePollTimer = null;

function setBadge(pageId, n) {
  const dot = document.getElementById(`sidebar-${pageId}-dot`);
  if (dot) dot.classList.toggle('hidden', !n);
}

function startBadgePoll() { stopBadgePoll(); refreshBadges(); badgePollTimer = setInterval(refreshBadges, 30000); }
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
    // 我的合同红点：待我处理的合同数（学生+教师）；正停留在合同页则就地刷新列表（对方改动 ≤30s 可见）
    if (state.user.role === 'student' || state.user.role === 'teacher') {
      const ctData = await api('/api/contracts/my');
      const contracts = ctData.contracts || [];
      if (state.page === 'my-contracts') {
        state.myContracts = contracts;
        renderMyContractsList();
      } else {
        setBadge('my-contracts', contracts.filter(contractActionable).length);
      }
    } else setBadge('my-contracts', 0);
  } catch { /* 静默，下一轮自愈 */ }
}


// ============================================================
// 认证
// ============================================================

// ------------------------------------------------------------
// 登录通路（全站唯一）：一切需要真实用户信息的页面 / 操作都经 ensureAuth()。
// 未登录 → 记下当前页 → 导向特制登录页（标题「登录以使用更多功能」）→ 登录/注册
// 成功后 enterClient(authReturnPage) 自动回到原页面状态。
// api() 层 401 兜底同样汇入此通路（令牌过期等同未登录）。
// ------------------------------------------------------------
let authReturnPage = null;

function ensureAuth() {
  if (state.user) return true;
  authReturnPage = state.view === 'client' ? state.page : null;
  state.guestAuthMode = true;
  showView('login');
  return false;
}

// 登录页标题按来路切换（index.html 静态文本仅作 JS 前兜底）
function refreshAuthHeader() {
  const h = document.getElementById('login-title');
  const p = document.getElementById('login-subtitle');
  if (!h || !p) return;
  h.textContent = state.guestAuthMode ? UI.AUTH_LOGIN_TITLE_GUEST : UI.AUTH_LOGIN_TITLE;
  p.textContent = state.guestAuthMode ? UI.AUTH_LOGIN_SUB_GUEST : UI.AUTH_LOGIN_SUB;
}

// 登录页「返回」：访客回客户端（取消登录）。注意：若原页面需登录，直接回去会被
// selectPage 的 ensureAuth 立刻再拦回登录页（死循环）→ 需登录的页面一律回落访客默认浏览页
function authGoBack() {
  if (state.guestAuthMode) {
    state.guestAuthMode = false;
    const back = authReturnPage; authReturnPage = null;
    const cfg = back && pagesForRole().find(p => p.id === back);
    enterClient(cfg && cfg.auth === false ? back : undefined);
    return;
  }
  showView('landing');
}

// 登录 / 注册成功统一收口：清访客态 + 自动返回触发登录通路的那个页面
function afterAuthSuccess() {
  state.guestAuthMode = false;
  state.guestRole = null;
  localStorage.setItem('sufe_returning', '1'); // 本设备已登录过 → 首访新手引导不再弹
  const back = authReturnPage; authReturnPage = null;
  enterClient(back || undefined); // 返回页与新角色不匹配时 enterClient 自然回落默认页
}

function switchRegisterRole(role) {
  document.getElementById('register-role').value = role;
  document.querySelectorAll('#register-role-tabs .role-tab').forEach(t => t.classList.toggle('active', t.dataset.role === role));
  // 教师注册：门控休眠期（内测）直接填表；恢复后先验证邀请码再填表
  if (role === 'teacher' && !APP_CONSTANTS.INVITE_GATE_DORMANT) {
    showView('invite-gate');
  }
}

function handleFeatureClick(role) {
  if (state.user) { enterClient(); return; }
  // 访客模式：主页按钮直达对应客户端先逛起来（用户信息栏显示「未登录」），
  // 需要身份的操作经 ensureAuth 统一导向登录页
  state.guestRole = role;
  enterClient();
}

async function handleLogin(e) {
  e.preventDefault();
  const username = document.getElementById('login-username').value.trim();
  const password = document.getElementById('login-password').value;
  const alertEl = document.getElementById('login-alert');
  const btn = document.getElementById('login-submit');

  try {
    btn.disabled = true; btn.innerHTML = `<span class="spinner"><i></i><i></i><i></i></span> ${UI.LOADING_LOGIN}`;
    const data = await api('/api/auth/login', { method: 'POST', body: { username, password } });
    state.user = data.user; state.authToken = data.authToken || null;
    alertEl.innerHTML = '';

    // 会话状态：持久化令牌（绝不存明文密码）；sessionStorage 刷新不死（关标签即焚），
    // 勾「记住我」另存 localStorage 7 天（与服务端令牌有效期一致）
    sessionStorage.setItem('sufe_session', JSON.stringify({ user: state.user, authToken: state.authToken }));
    if (document.getElementById('login-remember').checked) {
      localStorage.setItem('sufe_session', JSON.stringify({
        user: state.user, authToken: state.authToken, expires: Date.now() + 7 * 24 * 3600 * 1000, // 7天
      }));
    } else {
      localStorage.removeItem('sufe_session');
    }

    afterAuthSuccess();
  } catch (err) {
    alertEl.innerHTML = `<div class="alert alert-error glass">${escHtml(err.message)}</div>`;
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
    alertEl.innerHTML = `<div class="alert alert-error glass">${UI.VALIDATE_PASSWORD_MISMATCH}</div>`;
    return;
  }
  if (role === 'teacher' && !APP_CONSTANTS.INVITE_GATE_DORMANT) {
    if (!state.validatedInviteCode) {
      alertEl.innerHTML = `<div class="alert alert-error glass">${UI.VALIDATE_INVITE_FIRST}</div>`;
      showView('invite-gate');
      return;
    }
  }

  try {
    const btn = document.getElementById('register-submit');
    btn.disabled = true; btn.innerHTML = `<span class="spinner"><i></i><i></i><i></i></span> ${UI.LOADING_REGISTER}`;
    const body = { username, password, role };
    if (role === 'teacher' && state.validatedInviteCode) {
      body.inviteCode = state.validatedInviteCode;
      state.validatedInviteCode = null; // 用后即清
    }
    const data = await api('/api/auth/register', { method: 'POST', body });
    state.user = data.user; state.authToken = data.authToken || null;
    alertEl.innerHTML = '';
    // 注册即登录：会话存 sessionStorage（刷新保留，关标签即焚）
    try { sessionStorage.setItem('sufe_session', JSON.stringify({ user: state.user, authToken: state.authToken })); } catch { /* ignore */ }
    afterAuthSuccess();
  } catch (err) {
    alertEl.innerHTML = `<div class="alert alert-error glass">${escHtml(err.message)}</div>`;
  } finally {
    const btn = document.getElementById('register-submit');
    btn.disabled = false; btn.textContent = UI.BTN_REGISTER;
  }
}

async function validateInviteAndRegister() {
  const code = document.getElementById('invite-code-input').value.trim();
  const alertEl = document.getElementById('invite-gate-alert');

  if (!code) { alertEl.innerHTML = `<div class="alert alert-error glass">${UI.VALIDATE_INVITE_REQUIRED}</div>`; return; }

  // 先验证邀请码有效性（发一个假注册请求不如直接存下来，在真正注册时一起验证）
  // 这里只做格式校验，真正的验证在注册时进行
  if (code.length !== 8) {
    alertEl.innerHTML = `<div class="alert alert-error glass">${UI.VALIDATE_INVITE_LENGTH}</div>`;
    return;
  }

  // 保存验证过的邀请码，跳转到注册表单
  state.validatedInviteCode = code;
  alertEl.innerHTML = `<div class="alert alert-success glass">${UI.SUCCESS_INVITE_CONFIRMED}</div>`;

  // 等一秒让用户看到成功提示，然后跳转到注册页
  setTimeout(() => {
    document.getElementById('register-role').value = 'teacher';
    document.querySelectorAll('#register-role-tabs .role-tab').forEach(t =>
      t.classList.toggle('active', t.dataset.role === 'teacher'));
    showView('register');
  }, 800);
}

function handleLogout() {
  if (state.authToken) api('/api/auth/logout', { method: 'POST', body: {} }).catch(() => {}); // 真登出：吊销当前会话（fire-and-forget，头部在 api 内同步取自未清的 state.authToken）
  if (state.inviteTimerId) clearInterval(state.inviteTimerId);
  stopBadgePoll();
  if (typeof stopChatPolling === 'function') stopChatPolling(); // 模块4：登出即停聊天轮询（兼清暂存附件）
  if (pushCooldownTimer) { clearInterval(pushCooldownTimer); pushCooldownTimer = null; }
  pushCooldownUntil = 0; // 推送冷却不跨账号残留
  pendingConfirmAction = null; window._contractDraftDemands = null; // 防上一账户的挂起确认/起草候选被新账户触发
  state.user = null; state.authToken = null; state.page = null;
  state.guestRole = null; state.guestAuthMode = false; authReturnPage = null; closeProfilePanel();
  state.allTeachers = []; state.adminTeachers = []; state.intentTeachers = [];
  state.myDemands = []; state.editingDemandId = null; state.adminPosts = []; state.adminContracts = []; state.myContracts = [];
  state.inviteTimerId = null; state.currentInviteCode = null;
  localStorage.removeItem('sufe_session');
  sessionStorage.removeItem('sufe_session');
  try { localStorage.removeItem('sufe_page'); } catch { /* ignore */ }
  closeSidebar();
  showView('landing');
}

// ============================================================
// 学生需求 Modal
// ============================================================
function openDemandModal(demandId) {
  state.editingDemandId = demandId || null;
  const demand = demandId ? state.myDemands.find(d => d.id === demandId) : null;
  openModal({ title: demand ? UI.MODAL_TITLE_DEMAND_EDIT : UI.MODAL_TITLE_DEMAND_CREATE, body: renderDemandModal(demand) });
  initDemandForm(demand ? demand.province : null);
  if (demand) prefillDemandForm(demand);
}
function closeModal() { document.getElementById('modal-container').innerHTML = ''; }

// ============================================================
// C1 弹窗壳单源：overlay + modal + header + body（+ 可选 footer）
// 渲染结构与原手写模板逐字节一致——title 传 null 则无头栏（image-viewer 等）；
// closable 控制点遮罩关闭；cls/style 透传自定义类与内联样式；bodyCls 透传 body 类。
// ============================================================
function openModal({ title, titleId = '', body = '', footer = '', closable = true, cls = '', style = '', bodyCls = '' } = {}) {
  const clickable = closable ? ' onclick="if(event.target===this)closeModal()"' : '';
  const header = title != null
    ? `<div class="modal-header glass"><h2${titleId ? ` id="${titleId}"` : ''}>${title}</h2><button type="button" class="btn btn-ghost btn-icon glass glass--pressable" aria-label="${UI.BTN_CLOSE}" onclick="closeModal()">✕</button></div>`
    : '';
  const clsAttr = cls ? ` ${cls}` : '';
  const styleAttr = style ? ` style="${style}"` : '';
  const bodyClsAttr = bodyCls ? ` ${bodyCls}` : '';
  document.getElementById('modal-container').innerHTML = `<div class="modal-overlay"${clickable}>
    <div class="modal glass glass--float${clsAttr}"${styleAttr}>
      ${header}
      <div class="modal-body${bodyClsAttr}">
        ${body}
        ${footer ? `<div class="modal-footer">${footer}</div>` : ''}
      </div>
    </div>
  </div>`;
}

function renderDemandModal(demand) {
  return `<div id="demand-alert"></div>
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
              <label class="checkbox-item glass glass--solid"><input type="checkbox" value="${s.id}">${s.name}</label>
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
          <div class="form-group">
            <label class="form-label">${UI.LABEL_EXPECTED_TIME}</label>
            <input type="text" class="form-input" id="d-expected-time" placeholder="${UI.EXPECTED_TIME_PLACEHOLDER}">
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
            <textarea class="form-input" id="d-info" rows="3" placeholder="${UI.DEMAND_INFO_PLACEHOLDER}"></textarea>
          </div>
          <div class="modal-footer">
            ${demand ? `<button type="button" class="btn btn-sm modal-footer-start glass glass--pressable" onclick="confirmDeleteDemand(${demand.id})">${UI.BTN_DELETE_DEMAND}</button>` : ''}
            <button type="button" class="btn btn-outline glass glass--pressable" onclick="closeModal()">${UI.BTN_CANCEL}</button>
            <button type="submit" class="btn glass glass--pressable" id="d-submit">${demand ? UI.BTN_SAVE_DEMAND : UI.BTN_SUBMIT_DEMAND}</button>
          </div>
        </form>`;
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
  document.getElementById('d-expected-time').value  = d.expected_time || '';
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
  if (!province) { alertEl.innerHTML = `<div class="alert alert-error glass">${UI.VALIDATE_SELECT_PROVINCE}</div>`; return; }
  const subjects = [...document.querySelectorAll('#d-subjects input:checked')].map(cb => cb.value);
  if (!subjects.length) { alertEl.innerHTML = `<div class="alert alert-error glass">${UI.VALIDATE_SELECT_SUBJECT}</div>`; return; }

  const scores = collectStudentScores();

  const isEdit = !!state.editingDemandId;
  const payload = { demand: {
    province,
    student_grade: document.getElementById('d-grade').value,
    student_gender: document.getElementById('d-gender').value,
    target_subjects: subjects, current_scores: scores,
    teaching_method: document.getElementById('d-method').value,
    address: document.getElementById('d-address').value.trim(),
    expected_time: document.getElementById('d-expected-time').value.trim(),
    budget_min: +document.getElementById('d-budget-min').value,
    budget_max: +document.getElementById('d-budget-max').value,
    submitter_type: document.getElementById('d-submitter').value,
    parent_contact: document.getElementById('d-parent-contact').value.trim(),
    student_contact: document.getElementById('d-student-contact').value.trim(),
    additional_info: document.getElementById('d-info').value.trim(),
  }};

  try {
    const btn = document.getElementById('d-submit');
    btn.disabled = true; btn.innerHTML = '<span class="spinner"><i></i><i></i><i></i></span>';
    if (isEdit) {
      await api(`/api/student/demands/${state.editingDemandId}`, { method: 'PUT', body: payload });
    } else {
      await api('/api/student/demands', { method: 'POST', body: payload });
    }
    closeModal();
    state.editingDemandId = null;
    showToast(isEdit ? UI.SUCCESS_DEMAND_UPDATED : UI.SUCCESS_DEMAND_SUBMITTED);
    invalidate('demands'); // 提交/编辑后清需求缓存，防非本页提交致 state.myDemands 陈旧（编辑回填读它）
    if (state.page === 'my-demands') loadMyDemands();
  } catch (err) {
    showToast(err.message); // v0.19.43 长表单滚到底部提交：错误条在浮窗顶部不可见，改 Toast
  } finally {
    const btn = document.getElementById('d-submit');
    if (btn) { btn.disabled = false; btn.textContent = isEdit ? UI.BTN_SAVE_DEMAND : UI.BTN_SUBMIT_DEMAND; }
  }
}

// ============================================================
// 浏览教师
// ============================================================
async function loadTeachers() {
  // Populate subject filter
  const subjectFilter = document.getElementById('filter-subject');
  if (subjectFilter.options.length <= 1) {
    SUBJECTS.forEach(s => { const o = document.createElement('option'); o.value = s.id; o.textContent = s.name; subjectFilter.appendChild(o); });
  }

  await loadInto('teachers-list', async () => {
    const data = await api('/api/teachers');
    state.allTeachers = data.teachers || []; // 先回写再判空渲染（保持原顺序）
    return state.allTeachers;
  }, teachers => teachers.map(renderTeacherCard).join(''), { empty: UI.EMPTY_NO_TEACHERS });
}

function renderTeachers(teachers) {
  const el = document.getElementById('teachers-list');
  if (!teachers.length) { el.innerHTML = `<div class="empty-state"><p>${UI.EMPTY_NO_TEACHERS}</p></div>`; return; }
  el.innerHTML = teachers.map(renderTeacherCard).join('');
  initReveals(el);
}

// 错落两栏卡：左 头像+用户名(可点查看详情)+星级；右 信息行1(黑稍大)+信息行2(成绩灰可换行)+方形发送需求按钮；简介独占底部一行
function renderTeacherCard(t) {
  const isStudent = state.user && state.user.role === 'student';
  const grade = DISP.teacherGradeName(t.grade) || t.grade || '';
  const gender = DISP.genderName(t.gender);
  const provName = DISP.provinceName(t.province);
  const info1 = [provName, t.school, grade].filter(Boolean).join(' · '); // 粗体行：地区·学校·年级
  const scoreLine = (t.gaokao_scores || []).map(gs => `${DISP.subjectName(gs.subject)}${DISP.gaokaoCell(gs)}`).filter(Boolean).join(' · ');
  return `<div class="list-card list-card--teacher glass">
      ${renderAvatarHtml(t.avatar, t.username, 'tc-avatar', t.user_id)}
      <div class="tc-identity">
        <span class="tc-username" role="button" tabindex="0" aria-label="${UI.A11Y_VIEW_PROFILE}" onclick="openProfilePanel(${t.user_id})">${renderUsername(t.username)}${t.verified ? ` <span class="glass glass--solid" title="${UI.VERIFIED_TITLE}">${UI.VERIFIED_BADGE}</span>` : ''}</span>
        <span class="tc-rating">${renderStars(t.rating)}<b>${DISP.ratingText(t.rating)}</b></span>
        ${t.intro ? `<span class="tc-intro">${escHtml(t.intro)}</span>` : ''}
      </div>
      <div class="tc-right">
        ${info1 ? `<div class="tc-info1">${escHtml(info1)}</div>` : ''}
        ${gender ? `<div class="tc-info2">${UI.LABEL_GENDER}：${escHtml(gender)}</div>` : ''}
        ${t.price != null ? `<div class="tc-info2">${UI.LABEL_PRICE}：${escHtml(String(t.price))}${UI.PRICE_UNIT}</div>` : ''}
        ${scoreLine ? `<div class="tc-info2">${escHtml(scoreLine)}</div>` : ''}
        <div class="tc-actions">
          ${isStudent ? renderPushBtn(t) : ''}
        </div>
      </div>
    </div>`;
}

// 星级渲染统一走显示层（全局调用方多，保留 renderStars 名字作兼容别名）
const renderStars = globalThis.SUFE_DISPLAY.starsHtml;

// v0.19.46 参数化：教师块默认参数不变；通知页筛选面板同组件复用（index.html 传 id）
function toggleFilters(id = 'teacher-filters', btnId = 'filter-toggle-btn') {
  const open = document.getElementById(id).classList.toggle('open'); // grid-rows 展开动效
  const btn = document.getElementById(btnId);
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
// 个人信息右栏 — 取代旧教师详情弹窗的全站统一个人信息入口：
//   桌面端：屏幕右侧 25vw 右栏（内容长可滚动）；移动端：定宽浮层 + 背景变暗。
//   卡片①头像/用户名/角色（已签约显示绿色标记）；卡片②教师资料（账簿式：
//   title 左对齐、信息自固定 px 处起，逐项成行）；卡片③评价（按钮三态：
//   未签约灰禁 / 已签约写评价 / 已评价改评价）。教师卡片②③仅教师账户有。
//   入口：全站头像（账户设置预览除外）/ 会话窗右上角人头肩线框 / 原教师详情按钮。
//   开闭状态管理（0.20.8 解耦重写）：JS 只切 body.profile-panel-open 类 + 作废在途异步；
//   动画、原子隐藏、时序全由 CSS 呈现层负责，JS 不写任何内联样式。
//   病灶回顾：0.20.5~0.20.7 曾在 close 里写 p.style.visibility='hidden'（JS 直接篡改绘制状态
//   与 CSS transition 耦合）→ 动画被瞬间压死 =「收回去瞬间消失」；0.20.7 又误删 backdrop-filter
//   治耦合，观感崩。本轮把状态与动画彻底分离，两者不再互相干涉。
// ============================================================
let profilePanelSeq = 0;      // 面板序号：异步回来时序号不符即丢弃（防换人/关闭后串号）
let profilePanelUserId = null;

function findCachedTeacher(userId) {
  return state.allTeachers.find(x => x.user_id === userId)
      || state.adminTeachers.find(x => x.user_id === userId)
      || state.intentTeachers.find(x => x.user_id === userId) || null;
}

async function openProfilePanel(userId) {
  const seq = ++profilePanelSeq;
  profilePanelUserId = userId;
  document.body.classList.remove('profile-panel-closing'); // 取消在途关闭动画（快速重开）
  document.body.classList.add('profile-panel-open'); // 唯一状态写入；动画/可见性交 CSS
  const titleEl = document.getElementById('profile-panel-title');
  if (titleEl) titleEl.textContent = UI.PROFILE_PANEL_TITLE; // 标题归口 constants（静态文本仅 JS 前兜底）
  const body = document.getElementById('profile-panel-body');
  body.innerHTML = `<div class="profile-loading">${loaderHtml()}</div>`;
  try {
    // ① 基础名片：公开接口（用户名/角色/头像，墓碑用户名原样返回）
    const base = (await api(`/api/users/${userId}`)).user;
    if (seq !== profilePanelSeq) return;
    const isTeacher = base.role === 'teacher';
    // ② 教师档案：优先页内缓存，未命中现拉一次教师列表（公开接口，访客可用）
    let t = null;
    if (isTeacher) {
      t = findCachedTeacher(userId);
      if (!t) {
        try { state.allTeachers = (await api('/api/teachers')).teachers || []; } catch { /* 无档案或网络抖动：卡片②空态 */ }
        if (seq !== profilePanelSeq) return;
        t = findCachedTeacher(userId);
      }
    }
    // ③ 签约状态 + 评价（评价仅教师有；管理员看全状态管理视图）
    let signed = false, reviewsData = null;
    if (state.user) {
      if (!state.myContracts.length) {
        try { state.myContracts = (await api('/api/contracts/my')).contracts || []; } catch { /* 静默 */ }
      }
      signed = state.myContracts.some(c => c.status === 'signed' && (c.student_user_id === userId || c.teacher_user_id === userId));
    }
    if (isTeacher) {
      const isAdminViewer = state.user && state.user.role === 'admin';
      try {
        reviewsData = isAdminViewer
          ? { admin: true, reviews: (await api(`/api/admin/reviews?teacherUserId=${userId}`)).reviews || [] }
          : await api(`/api/reviews?teacherUserId=${userId}`);
      } catch { reviewsData = { reviews: [] }; }
      if (seq !== profilePanelSeq) return;
    }
    state.myReviewOnModal = (reviewsData && reviewsData.mine) || null;
    // ④ 私密字段（真实姓名/学信网截图/联系方式）：列表接口永不下发，仅本人或双向匹配后定点取回并入缓存行
    // （取过一次打标记，不重复请求；签约时后端追加返回联系方式，兑现「签约后展示」）
    if (isTeacher && t && (t.matched || (state.user && state.user.id === t.user_id)) && !t._matchedDetailLoaded) {
      try {
        const pd = await api(`/api/teacher/profile?userId=${userId}`);
        if (seq !== profilePanelSeq) return;
        if (pd.profile) Object.assign(t, { real_name: pd.profile.real_name || '', credential_image: pd.profile.credential_image || '', wechat: pd.profile.wechat || '', email: pd.profile.email || '' }); // 签约后后端追加返回联系方式，此处一并并入缓存行
      } catch { /* 未匹配后端 403：按不可见处理 */ }
      t._matchedDetailLoaded = true;
    }
    body.innerHTML = renderProfilePanel(base, t, signed, reviewsData);
  } catch (err) {
    if (seq !== profilePanelSeq) return;
    body.innerHTML = `<div class="profile-loading"><p>${UI.ERROR_LOAD_PREFIX}${escHtml(err.message)}</p></div>`;
  }
}

// 个人信息栏关闭（0.20.9）：JS 只做状态管理——加 closing 类触发 CSS 滑出动画（纯 transform，
// 与 modal 同构，用户端不冻结），动画结束（animationend）后移除类回 base（屏外 + 原子隐藏）。
// 状态层与呈现层仅通过「类 + 动画事件」通信，JS 零样式操作。防竞态：seq 作废在途异步；
// userId 置空防「就地刷新重开」；finish 用 seqAt 快照防重开后旧收尾误清。
function closeProfilePanel() {
  const seqAt = ++profilePanelSeq;
  profilePanelUserId = null;
  const bodyCls = document.body.classList;
  const pnl = document.getElementById('profile-panel');
  bodyCls.add('profile-panel-closing');
  const finish = () => {
    if (seqAt !== profilePanelSeq) return; // 期间重新打开/再关闭：新流程自管类
    bodyCls.remove('profile-panel-closing');
    bodyCls.remove('profile-panel-open');
    if (pnl) pnl.removeEventListener('animationend', finish);
  };
  if (pnl) {
    pnl.addEventListener('animationend', finish, { once: true });
    setTimeout(finish, 600); // 兜底：动画未触发/被中断也必收尾
  }
}

// 关闭按钮 + 遮罩：程序化绑定（不写内联 onclick）
document.addEventListener('DOMContentLoaded', () => {
  const btn = document.getElementById('profile-panel-close');
  if (btn) btn.addEventListener('click', closeProfilePanel);
  const bd = document.getElementById('profile-panel-backdrop');
  if (bd) bd.addEventListener('click', closeProfilePanel);
});

// 面板是否正打开且展示某用户（评价提交后据此就地刷新）
function profilePanelShowing(userId) {
  return document.body.classList.contains('profile-panel-open') && profilePanelUserId === userId;
}

function renderProfilePanel(base, t, signed, reviewsData) {
  const roleLabel = DISP.roleLabel(base.role);
  const cardId = `<div class="profile-card profile-card--id glass">
      <div class="profile-id-top">
        ${renderAvatarHtml(base.avatar, base.username, 'profile-avatar')}
        ${signed ? `<span class="profile-signed-tag glass glass--solid">${UI.PROFILE_SIGNED_TAG}</span>` : ''}
      </div>
      <div class="profile-id-name">${renderUsername(base.username)}</div>
      <div class="profile-id-role">${roleLabel}</div>
    </div>`;
  return cardId
    + (base.role === 'teacher' ? renderProfileInfoCard(t, signed) : '')
    + (base.role === 'teacher' && reviewsData ? renderProfileReviewsCard(reviewsData, t, signed) : '');
}

// 卡片②：教师资料账簿行 —— title 最左、信息自固定 px（CSS profile-row grid）处统一开始，逐项成行
// 信息卡「硬展示」：所有字段行常驻——有值显值，无值显占位（未填写 / 建立会话后展示 / 签约后展示），
// 学生据此一眼判断教师资料完善度与信息的可见门槛（占位文案统一灰显）
function renderProfileInfoCard(t, signed) {
  if (!t) return `<div class="profile-card glass"><p class="profile-empty">${UI.PROFILE_EMPTY_TEACHER}</p></div>`;
  const isSelf = state.user && state.user.id === t.user_id;
  const row = (k, cell) => `<div class="profile-row"><span class="profile-row-k">${k}</span><span class="profile-row-v${cell.muted ? ' profile-row-v--muted' : ''}">${cell.v}</span></div>`;
  const cell = v => ({ v: escHtml(v) });
  const empty = label => ({ v: escHtml(label), muted: true });
  const plain = v => v ? cell(v) : empty(UI.PROFILE_FIELD_EMPTY); // 常规字段：空 → 未填写
  const afterMatch = v => !t.matched ? empty(UI.PROFILE_FIELD_AFTER_MATCH) : plain(v); // 匹配门槛字段

  const subjTags = (t.subjects || []).map(sid => {
    const name = DISP.subjectName(sid);
    return name ? `<span class="profile-tag glass glass--solid">${escHtml(name)}</span>` : '';
  }).join('');
  const gkRows = (t.gaokao_scores || []).map(gs => {
    // 分数不带 scale：满分由省份赋分组件决定、行数据里本就不存（与教师卡 scoreLine 同口径）
    const v = DISP.gaokaoCell(gs);
    return v ? row(escHtml(DISP.subjectName(gs.subject)), cell(v)) : '';
  }).join('');
  // 联系方式：本人或已签约（且已取回值）→ 实际值；已取回但教师未填 → 未填写；否则 → 签约后展示
  const hasContact = t.wechat || t.email;
  const contact = (isSelf || signed)
    ? (hasContact
        ? cell([t.wechat ? `${UI.CONTACT_PANEL_WECHAT_PREFIX}${escHtml(t.wechat)}` : '', t.email ? `${UI.CONTACT_PANEL_EMAIL_PREFIX}${escHtml(t.email)}` : ''].filter(Boolean).join(' · '))
        : empty(UI.PROFILE_FIELD_EMPTY))
    : empty(UI.PROFILE_FIELD_AFTER_SIGN);
  const credential = !t.matched ? empty(UI.PROFILE_FIELD_AFTER_MATCH)
    : t.credential_image
      ? { v: `<button type="button" class="btn btn-outline btn-xs glass glass--pressable" onclick="viewTeacherCredential(${t.user_id})">${UI.CREDENTIAL_VIEW}</button>` }
      : empty(UI.PROFILE_FIELD_EMPTY);

  return `<div class="profile-card glass">
    ${row(UI.LABEL_RATING, { v: `<span class="profile-rating">${renderStars(t.rating)}<b>${DISP.ratingText(t.rating)}</b></span>` })}
    ${row(UI.SECTION_REGION, plain(DISP.provinceName(t.province)))}
    ${row(UI.LABEL_SCHOOL, plain(t.school))}
    ${row(UI.LABEL_GRADE, plain(DISP.teacherGradeName(t.grade)))}
    ${row(UI.LABEL_GENDER, plain(DISP.genderName(t.gender)))}
    ${row(UI.LABEL_PRICE, t.price != null ? cell(`${t.price}${UI.PRICE_UNIT}`) : empty(UI.PROFILE_FIELD_EMPTY))}
    ${row(UI.LABEL_ADDRESS, plain(t.address))}
    ${row(UI.SECTION_SUBJECTS, subjTags ? { v: subjTags } : empty(UI.PROFILE_FIELD_EMPTY))}
    ${gkRows || row(UI.LABEL_GAOKAO_SCORES, empty(UI.PROFILE_FIELD_EMPTY))}
    ${row(UI.LABEL_INTRO, plain(t.intro))}
    ${row(UI.LABEL_REAL_NAME, afterMatch(t.real_name))}
    ${row(UI.LABEL_CREDENTIAL, credential)}
    ${row(UI.LABEL_CONTACT, contact)}
  </div>`;
}

// 卡片③：评价列表 + 评价按钮三态（学生视角：未签约灰禁 / 签约可写 / 已评价可改）
function renderProfileReviewsCard(reviewsData, t, signed) {
  const reviews = reviewsData.reviews || [];
  const mine = reviewsData.mine || null;
  const isStudentViewer = state.user && state.user.role === 'student';
  const statusTag = r => DISP.reviewStatusTagHtml(r.status);
  const list = reviews.length ? reviews.map(r => `<div class="review-item">
      <div class="review-header">
        <span class="review-author">${renderUsername(r.reviewer_name || '')} ${renderStars(r.rating)} ${reviewsData.admin ? statusTag(r) : ''}</span>
        <span class="review-date">${fmtDateTime(r.created_at)}</span>
      </div>
      <div class="review-text">${escHtml(r.comment)}</div>
      ${reviewsData.admin ? `<div class="review-admin-actions">
        ${r.status === 'pending' ? `<button type="button" class="btn btn-xs glass glass--pressable" onclick="adminReviewAction(${r.id},'approve',1)">${UI.BTN_APPROVE}</button>
        <button type="button" class="btn btn-outline btn-xs glass glass--pressable" onclick="adminReviewAction(${r.id},'reject',1)">${UI.BTN_REJECT}</button>` : ''}
        <button type="button" class="btn btn-xs glass glass--pressable" onclick="confirmDeleteReview(${r.id},1)">${UI.BTN_DELETE_REVIEW}</button>
      </div>` : ''}
    </div>`).join('') : `<p class="profile-empty">${UI.EMPTY_NO_REVIEWS}</p>`;
  let action = '';
  if (!reviewsData.admin && isStudentViewer) {
    action = mine ? `
      <div class="review-mine-note">${UI.MY_REVIEW_PREFIX}${mine.status === 'approved' ? UI.STATUS_APPROVED : mine.status === 'rejected' ? UI.REVIEW_REJECTED_HINT : UI.REVIEW_STATUS_AUDITING}</div>
      <button type="button" class="btn btn-outline btn-sm profile-review-btn glass glass--pressable" onclick="openReviewModal(${t.user_id}, null, ${mine.id})">${UI.BTN_EDIT_REVIEW}</button>`
      : signed ? `
      <button type="button" class="btn btn-sm profile-review-btn glass glass--pressable" onclick="openReviewModal(${t.user_id})">${UI.BTN_WRITE_REVIEW}</button>`
      : `
      <button type="button" class="btn btn-outline btn-sm profile-review-btn glass glass--pressable" disabled>${UI.BTN_WRITE_REVIEW}</button>
      <p class="profile-review-hint">${UI.REVIEW_LOCKED_HINT}</p>`;
  }
  return `<div class="profile-card glass">
    <div class="profile-card-title">${UI.SECTION_REVIEWS} (${reviews.length})</div>
    ${list}${action}
  </div>`;
}

// ============================================================
// 评价 Modal
// ============================================================
// 评价弹窗：editId 有值 = 修改自己的既有评价（自 state.myReviewOnModal 回填）
function openReviewModal(teacherUserId, teacherName, editId) {
  teacherName = teacherName ?? (state.allTeachers.find(x => x.user_id === teacherUserId)?.username || '');
  const existing = editId ? state.myReviewOnModal : null;
  openModal({
    title: existing ? UI.BTN_EDIT_REVIEW : UI.REVIEW_MODAL_TITLE_PREFIX + escHtml(teacherName),
    body: `<div id="review-alert"></div>
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
        </div>`,
    footer: `<button class="btn btn-outline glass glass--pressable" onclick="closeModal()">${UI.BTN_CANCEL}</button>
          <button class="btn glass glass--pressable" onclick="submitReview(${teacherUserId}, ${existing ? existing.id : 0})">${existing ? UI.BTN_SAVE_DEMAND : UI.BTN_SUBMIT_REVIEW}</button>`,
  });
  if (existing) setReviewStars(existing.rating); // 星星高亮回填
}

function setReviewStars(val) {
  document.getElementById('review-rating').value = val;
  document.querySelectorAll('#review-stars .star-btn').forEach(btn => {
    btn.classList.toggle('active', +btn.dataset.val <= val);
  });
}

let reviewSubmitBusy = false; // 评价提交防双发（双击连发两条待审评价）

// reviewId 有值 = PUT 修改既有评价（重回审核）；否则 POST 新评价（签约门槛由后端把关）
async function submitReview(teacherUserId, reviewId) {
  const rating = +document.getElementById('review-rating').value;
  const comment = document.getElementById('review-comment').value.trim();
  const alertEl = document.getElementById('review-alert');

  if (!rating) { alertEl.innerHTML = `<div class="alert alert-error glass">${UI.VALIDATE_SELECT_RATING}</div>`; return; }
  if (comment.length < 2) { alertEl.innerHTML = `<div class="alert alert-error glass">${UI.VALIDATE_COMMENT_TOO_SHORT}</div>`; return; }
  if (reviewSubmitBusy) return;
  reviewSubmitBusy = true;

  try {
    const data = reviewId
      ? await api(`/api/reviews/${reviewId}`, { method: 'PUT', body: { rating, comment } })
      : await api('/api/reviews', { method: 'POST', body: { teacherUserId, rating, comment } });
    closeModal();
    showToast(data.message || UI.SUCCESS_REVIEW_SUBMITTED);
    if (profilePanelShowing(teacherUserId)) openProfilePanel(teacherUserId); // 面板正展示该教师 → 评价卡片就地刷新（写/改后状态同步）
  } catch (err) {
    alertEl.innerHTML = `<div class="alert alert-error glass">${escHtml(err.message)}</div>`;
  } finally {
    reviewSubmitBusy = false;
  }
}

// 通用危险操作二次确认（onConfirm 仅由内部以数字 id 拼装全局函数调用串）
function confirmDanger(title, text, onConfirm) {
  openModal({
    title,
    style: 'max-width:400px;',
    body: `<p class="text-sm" style="color:var(--ink-3);">${text}</p>`,
    footer: `<button type="button" class="btn btn-outline glass glass--pressable" onclick="closeModal()">${UI.BTN_CANCEL}</button>
          <button type="button" class="btn glass glass--pressable" onclick="${onConfirm}">${UI.BTN_CONFIRM}</button>`,
  });
}

function confirmDeleteDemand(demandId, asAdmin) {
  confirmDanger(UI.BTN_DELETE_DEMAND, UI.CONFIRM_DELETE_DEMAND, `handleDeleteDemand(${demandId}, ${asAdmin ? 1 : 0})`);
}

async function handleDeleteDemand(demandId, asAdmin) {
  try {
    if (asAdmin) {
      await api(`/api/admin/demands/${demandId}`, { method: 'DELETE' });
    } else {
      await api(`/api/student/demands/${demandId}`, { method: 'DELETE', body: {} });
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

function confirmDeleteReview(reviewId, fromModal) {
  confirmDanger(UI.BTN_DELETE_REVIEW, UI.CONFIRM_DELETE_REVIEW, `adminReviewAction(${reviewId},'delete',${fromModal})`);
}

// action: approve / reject / delete；fromModal: 是否从教师详情弹窗内触发（决定刷新哪里）
async function adminReviewAction(reviewId, action, fromModal) {
  try {
    if (action === 'delete') {
      await api(`/api/admin/reviews/${reviewId}`, { method: 'DELETE' });
      showToast(UI.REVIEW_DELETED);
    } else {
      await api(`/api/admin/reviews/${reviewId}/${action}`, { method: 'POST' });
      showToast(action === 'approve' ? UI.SUCCESS_APPROVED : UI.SUCCESS_REJECTED);
    }
    closeModal();
    if (fromModal && profilePanelUserId) {
      openProfilePanel(profilePanelUserId); // 个人信息面板内就地刷新（内部 seq 守卫丢弃在途旧响应）
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

// 用户名展示：注销用户（用户名以「已注销用户」开头）灰斜体墓碑样式——
// 双方数据（需求/会话/合同/评价）保留，但向其他用户明确表明该账户已注销
// 用户名墓碑渲染统一走显示层（调用方不动，保留 renderUsername 名字作兼容别名）
const renderUsername = globalThis.SUFE_DISPLAY.usernameHtml;
// 教师需求匹配度（运营建议 P3/B2 双向画像）：科目(权重60) + 区县(20) + 预算(20) 综合分，
// 按可用维度归一化到 0-100——教师浏览需求时显示「匹配度 N%」，帮助快速判断对错口。纯前端计算零后端改动。
function matchDegree(teacher, demand) {
  if (!teacher) return null;
  let score = 0, total = 0;
  const tSubj = Array.isArray(teacher.subjects) ? teacher.subjects : [];
  const dSubj = Array.isArray(demand.target_subjects) ? demand.target_subjects : [];
  if (tSubj.length && dSubj.length) {
    total += 60;
    score += (dSubj.filter(s => tSubj.includes(s)).length / dSubj.length) * 60;
  }
  if (teacher.province && demand.province) {
    total += 20;
    if (teacher.province === demand.province) score += 20;
  }
  const price = teacher.price;
  if (price != null && (demand.budget_min || demand.budget_max)) {
    total += 20;
    const inRange = (!demand.budget_min || price >= demand.budget_min) && (!demand.budget_max || price <= demand.budget_max);
    if (inRange) score += 20;
  }
  if (!total) return null;
  return Math.min(100, Math.round(score / total * 100));
}

// 匹配度明细悬浮卡（v0.19.45）：分项对齐 matchDegree 口径——科目 60（命中比例）/ 区域 20（同省）/ 预算 20（报价在区间内），
// 缺数据维度不计分并明示。毛度同浮窗纸面（glass.css .match-detail 参数，modal 同级）
function matchDetailHtml(t, d, md) {
  const tSubj = Array.isArray(t.subjects) ? t.subjects : [];
  const dSubj = Array.isArray(d.target_subjects) ? d.target_subjects : [];
  const hit = dSubj.filter(s => tSubj.includes(s)).length;
  const subjOn = tSubj.length > 0 && dSubj.length > 0;
  const subjScore = subjOn ? Math.round(hit / dSubj.length * 60) : null;
  const regionOn = !!(t.province && d.province);
  const regionScore = regionOn ? (t.province === d.province ? 20 : 0) : null;
  const budgetOn = t.price != null && (d.budget_min || d.budget_max);
  const budgetScore = budgetOn
    ? ((!d.budget_min || t.price >= d.budget_min) && (!d.budget_max || t.price <= d.budget_max) ? 20 : 0) : null;
  const bar = (s, max) => `<div class="match-bar${s === 0 ? ' match-bar--zero' : ''}"><i style="width:${s == null ? 0 : Math.round(s / max * 100)}%"></i></div>`;
  const row = (k, s, max, hint) => `<div class="match-row">
    <span class="match-row-top"><span class="match-row-k">${k}</span><span class="match-row-s${s == null ? ' match-row-s--skip' : ''}">${s == null ? UI.MATCH_DIM_SKIP : s + '/' + max}</span></span>
    ${bar(s, max)}
    <span class="match-row-hint">${hint}</span>
  </div>`;
  const subjHint = subjOn ? UI.MATCH_SUBJECT_HIT.replace('{hit}', hit).replace('{total}', dSubj.length) : UI.MATCH_DIM_SKIP;
  const regionHint = !regionOn ? UI.MATCH_DIM_SKIP : (regionScore === 20 ? UI.MATCH_REGION_HIT.replace('{name}', escHtml(DISP.provinceName(d.province))) : UI.MATCH_REGION_MISS);
  const budgetHint = !budgetOn ? UI.MATCH_DIM_SKIP : (budgetScore === 20 ? UI.MATCH_BUDGET_HIT : UI.MATCH_BUDGET_MISS);
  return `<div class="match-detail glass glass--float" role="dialog" aria-label="${UI.MATCH_DETAIL_TITLE}">
    <div class="match-detail-head"><span class="match-detail-pct">${md}%</span><span class="match-detail-title">${UI.MATCH_DETAIL_TITLE}</span></div>
    <p class="match-detail-sub">${UI.MATCH_DETAIL_SUB}</p>
    ${row(UI.MATCH_ITEM_SUBJECT, subjScore, 60, subjHint)}
    ${row(UI.MATCH_ITEM_REGION, regionScore, 20, regionHint)}
    ${row(UI.MATCH_ITEM_BUDGET, budgetScore, 20, budgetHint)}
    <p class="match-note">${UI.MATCH_NOTE}</p>
  </div>`;
}

// 点击开关 + 外部点击 / Esc / 滚动关闭（同一时刻至多一张）。
// v0.19.46 数据从缓存重建（按按钮 data-id 找需求 + state.allTeachers 找本人档案）——
// 原 window._matchDetail 单槽被最后一张卡渲染覆盖：多 tag 时点谁都显示最后一张的数据
let _matchDetailOpen = false;
let _browseDemands = []; // 教师需求大厅当前列表（含置顶推送卡），showMatchDetail 的按 id 取数源
function showMatchDetail(btn) {
  const d = _browseDemands.find(x => x.id === +btn.dataset.id);
  const t = state.allTeachers.find(x => x.user_id === state.user.id);
  if (!d || !t) return;
  if (_matchDetailOpen) { closeMatchDetail(); return; }
  const md = matchDegree(t, d);
  if (md == null) return;
  btn.insertAdjacentHTML('afterend', matchDetailHtml(t, d, md));
  const card = btn.nextElementSibling;
  if (!card || !card.classList.contains('match-detail')) return;
  // v0.19.47 挂 body（custom-select 面板完整模式）：.list-card 常驻 backdrop-filter（--g-f-card 微毛），
  // Chrome 中它是 fixed 后代的 containing block——不挂 body 则 fixed 实际仍相对卡：定位偏移/被 overflow:hidden 切/图层困卡内，
  // 上版只改 CSS 没改挂载点，正是「还是老样子」的根因
  document.body.appendChild(card);
  const r = btn.getBoundingClientRect();
  card.style.left = `${r.left}px`;
  card.style.top = `${r.bottom + 6}px`;
  _matchDetailOpen = true;
}
function closeMatchDetail() {
  const card = document.querySelector('.match-detail');
  if (card) card.remove();
  _matchDetailOpen = false;
}
document.addEventListener('click', e => {
  if (!_matchDetailOpen) return;
  if (!e.target.closest('.match-detail') && !e.target.closest('.tag-match')) closeMatchDetail();
});
document.addEventListener('keydown', e => { if (e.key === 'Escape') closeMatchDetail(); });
// 滚动即收起（fixed 不跟随滚动，同 custom-select 面板模式；capture 捕获所有滚动容器）
document.addEventListener('scroll', () => { if (_matchDetailOpen) closeMatchDetail(); },
  { capture: true, passive: true });

function renderDemandCard(d, opts = {}) {
  const { editable = false, admin = false, teacher = false, myTeacher = null } = opts;
  const push = opts.push; // 学生主动推送的待处理需求（教师视角置顶卡）
  // 需求编号（#0004 四位）：v0.20.0 从小气泡挪出，直接跟在时间标记右侧（与时间同排的普通文本）
  const idTag = d.display_id ? `<span class="demand-id-tag">#${String(d.display_id).padStart(4, '0')}</span>` : '';
  // 匹配度徽章（教师视角 + 教师档案齐全时展示）：v0.19.45 变按钮，点击呼出明细悬浮卡
  const matchTag = (teacher && myTeacher)
    ? (() => { const md = matchDegree(myTeacher, d); if (md == null) return ''; return `<button type="button" class="tag tag-match glass glass--solid" data-id="${d.id}" onclick="showMatchDetail(this)" title="${UI.TAG_MATCH_TITLE}">${UI.TAG_MATCH}${md}%</button>`; })()
    : '';
  const provinceName = DISP.provinceName(d.province);
  const subjNames = (d.target_subjects||[]).map(id => DISP.subjectName(id));
  const grade = STUDENT_GRADES.find(g=>g.id===d.student_grade)?.name || d.student_grade;
  const gender = DISP.genderName(d.student_gender);
  const submitter = d.submitter_type === 'parent' ? UI.SUBMITTER_PARENT : UI.SUBMITTER_STUDENT;
  const method = DISP.methodName(d.teaching_method) || DISP.methodName('offline');
  // 教师视角：意向按钮四态（未提交 / 待处理 / 已建立联系 / 未获选），状态取自列表接口的 my_intent_status
  const teacherIntentBtn = !teacher ? ''
    : d.my_intent_status === 'accepted' ? `<button type="button" class="btn btn-sm btn-intent-ok glass glass--pressable" disabled>${UI.INTENT_ACCEPTED}</button>`
    : d.my_intent_status === 'pending'  ? `<button type="button" class="btn btn-sm btn-intent-wait glass glass--pressable" disabled>${UI.INTENT_PENDING}</button>`
    : d.my_intent_status === 'rejected' ? `<button type="button" class="btn btn-sm btn-intent-wait glass glass--pressable" disabled>${UI.INTENT_REJECTED}</button>`
    : `<button type="button" class="btn btn-outline btn-sm glass glass--pressable" onclick="submitIntent(${d.id})">${UI.BTN_SUBMIT_INTENT}</button>`;
  const budget = (d.budget_min || d.budget_max)
    ? `${d.budget_min||UI.BUDGET_NO_LIMIT}~${d.budget_max||UI.BUDGET_NO_LIMIT}${UI.BUDGET_UNIT_SUFFIX}` : UI.BUDGET_NEGOTIABLE;

  // 三行点号纯文字（同教师卡语言，行间细线分隔）：
  // ① 基本信息：地区·年级·性别·提交者 ② 教学需求：线上/下·报价 ③ 需求科目和成绩：科目: 分数/分制（等第制直接显等第）
  const infoBase = [provinceName, grade, gender, `${UI.SUBMITTER_PREFIX}${submitter}`].filter(Boolean).map(escHtml).join(' · ');
  const timeStr = d.expected_time ? `${UI.LABEL_EXPECTED_TIME}：${d.expected_time}` : '';
  const infoDemandRow = [method, budget, timeStr].filter(Boolean).map(escHtml).join(' · ');
  const scoreItems = (d.current_scores||[]).map(cs => DISP.demandScoreCell(cs)).filter(Boolean);
  const infoScores = (scoreItems.length ? scoreItems : subjNames).map(escHtml).join(' · ');

  return `<div class="list-card list-card--demand glass">
    ${renderAvatarHtml(d.avatar, d.username || '?', 'demand-avatar', d.user_id)}
    <div class="demand-card-main">
    <div class="list-card-header">
      <span class="list-card-title">${renderUsername(d.username || '')}${matchTag}${d.status === 'contracted' ? ` <span class="tag tag-ok glass glass--solid">${UI.DEMAND_TAG_CONTRACTED}</span>` : d.status === 'revoked' ? ` <span class="tag tag-warn glass glass--solid">${UI.DEMAND_TAG_REVOKED}</span>` : ''}</span>
      <span class="demand-card-tools">
        ${push ? `<span class="push-note-row">
          <span class="push-pin-tag">${UI.PUSH_TAG_ACTIVE}</span>
          <span class="list-card-meta">${fmtDateTime(push.push_created_at)}</span>${idTag}
          <span class="push-note-text">${UI.PUSH_NOTE_TEXT}</span>
          <button type="button" class="btn btn-outline btn-xs glass glass--pressable" onclick="resolvePush(${push.push_id},'reject')">${UI.BTN_PUSH_REJECT}</button>
          <button type="button" class="btn btn-xs glass glass--pressable" onclick="resolvePush(${push.push_id},'accept')">${UI.BTN_PUSH_ACCEPT}</button>
        </span>` : `<span class="list-card-meta">${fmtDateTime(d.created_at)}</span>${idTag}${teacherIntentBtn}`}
        ${editable && d.status === 'revoked' ? `<button type="button" class="btn btn-sm glass glass--pressable" onclick="reopenDemand(${d.id})">${UI.BTN_REOPEN_DEMAND}</button>`
          : editable && d.status !== 'contracted' ? `<button type="button" class="btn btn-outline btn-sm glass glass--pressable" onclick="openDemandModal(${d.id})">${UI.BTN_EDIT}</button>` : ''}
        ${admin && d.status !== 'contracted' ? `<button type="button" class="btn btn-xs glass glass--pressable" onclick="confirmDeleteDemand(${d.id}, true)">${UI.BTN_REMOVE}</button>` : ''}
      </span>
    </div>
    <div class="demand-info">
      ${infoBase ? `<div class="demand-info-row">${infoBase}</div>` : ''}
      ${infoDemandRow ? `<div class="demand-info-row">${infoDemandRow}</div>` : ''}
      ${infoScores ? `<div class="demand-info-row">${infoScores}</div>` : ''}
    </div>
    ${d.address ? `<div class="list-card-detail">${UI.ADDRESS_PREFIX}${escHtml(d.address)}</div>` : ''}
    ${d.additional_info ? `<div class="list-card-detail">${UI.ADDITIONAL_PREFIX}${escHtml(d.additional_info)}</div>` : ''}
    <div class="demand-card-foot">
      <div class="list-card-contact">
        <span class="contact-sign-note">${UI.CONTACT_AFTER_SIGN_NOTE}</span>
      </div>
      ${editable && d.status !== 'revoked' ? `<button type="button" class="drop-toggle glass glass--solid" id="intent-toggle-${d.id}" onclick="toggleDemandIntents(${d.id})">${UI.INTENTS_TITLE} (${d.intent_count || 0}) <span class="drop-caret">${CARET_SVG}</span><span class="corner-dot${d.pending_intents ? '' : ' hidden'}" id="intent-dot-${d.id}"></span></button>` : ''}
    </div>
    ${editable && d.status !== 'revoked' ? `<div class="intents-box" id="intents-box-${d.id}"><div class="intents-box-inner"></div></div>` : ''}
    </div>
  </div>`;
}

async function loadDemandList(elId, { mine }) {
  await loadInto(elId, async () => {
    // 教师大厅视角附带你自己的意向状态（my_intent_status），供按钮三态渲染
    const url = mine ? '/api/student/demands?scope=mine'
                     : '/api/student/demands?scope=for-teacher';
    const data = await api(url);
    const demands = data.demands || [];
    if (mine) {
      state.myDemands = demands; // 编辑回填的数据源
      setBadge('my-demands', demands.filter(d => d.pending_intents > 0).length); // 有待处理意向的需求数 → 侧栏红点
    }
    return demands;
  }, demands => demands.map(d => renderDemandCard(d, { editable: mine, teacher: !mine })).join(''),
  { empty: mine ? UI.EMPTY_NO_MY_DEMANDS : UI.EMPTY_NO_DEMANDS });
}

function loadMyDemands()     { return loadDemandList('my-demands-list', { mine: true }); }

// 重开「合同已撤销」的需求：revoked→open 重回广场接收意向（手动触发；后端把关所有者+状态）
function reopenDemand(demandId) {
  openConfirmModal(UI.CONFIRM_REOPEN_DEMAND, async () => {
    try {
      const data = await api(`/api/student/demands/${demandId}/reopen`, { method: 'POST', body: {} });
      showToast(data.message || UI.DEMAND_REOPENED_TOAST);
      invalidate('demands');
      loadMyDemands();
    } catch (err) { showToast(err.message); }
  });
}

// 教师需求大厅：普通需求 + 学生主动推送的待处理需求（置顶 + 特殊操作行）
async function loadBrowseDemands() {
  const el = document.getElementById('demands-list');
  el.innerHTML = `<div class="empty-state">${loaderHtml()}</div>`;
  try {
    const isGuest = !state.user; // 访客教师可浏览公开需求列表；推送卡片与意向操作点了再走登录通路
    const [dData, pData] = await Promise.all([
      api(isGuest ? '/api/student/demands' : '/api/student/demands?scope=for-teacher'),
      isGuest ? Promise.resolve({ pushes: [] }) : api('/api/demand-pushes'),
    ]);
    const pushes = pData.pushes || [];
    const demands = dData.demands || [];
    _browseDemands = [...pushes, ...demands]; // 匹配度明细取数源（push 置顶卡与普通卡同库）
    if (state.page === 'browse-demands') setBadge('browse-demands', 0); // 进页即视为已读；await 期间若已切走，不得掐灭轮询刚点亮的新推送红点
    if (!pushes.length && !demands.length) { el.innerHTML = `<div class="empty-state"><p>${UI.EMPTY_NO_DEMANDS}</p></div>`; return; }
    // 教师档案（匹配度用）：确保 allTeachers 已加载——直接进「浏览需求」页可能没拉过教师列表
    if (!isGuest && state.user.role === 'teacher' && !state.allTeachers.length) {
      try { state.allTeachers = (await api('/api/teachers')).teachers || []; } catch { /* 无档案或网络抖动：无匹配徽章 */ }
    }
    // 当前教师档案（匹配度徽章用）：登录教师 + 已填档案时才有
    const myTeacher = (!isGuest && state.user.role === 'teacher') ? state.allTeachers.find(t => t.user_id === state.user.id) : null;
    const pushDemandIds = new Set(pushes.map(p => p.id));
    const pinned = pushes.map(p => renderDemandCard(p, { push: p, teacher: true, myTeacher })).join('');
    const normal = demands.filter(d => !pushDemandIds.has(d.id)).map(d => renderDemandCard(d, { teacher: true, myTeacher })).join('');
    el.innerHTML = (pinned ? `<div class="section-title" style="margin-bottom:8px;">${UI.PUSH_SECTION_TITLE}</div>${pinned}` : '') + normal;
    initReveals(el);
  } catch (err) {
    el.innerHTML = `<div class="empty-state"><p>${UI.ERROR_LOAD_PREFIX}${escHtml(err.message)}</p></div>`;
  }
}

// 学生把某条需求主动发给指定教师：弹窗列出自己的需求单选
async function openSendDemandModal(teacherUserId) {
  if (!ensureAuth()) return;
  const t = state.allTeachers.find(x => x.user_id === teacherUserId);
  const tName = t ? t.username : UI.PUSH_TEACHER_FALLBACK;
  // 每次现拉自己的需求（不用页内缓存）：签约可能在其他页发生，缓存会把已签约需求漏进候选
  let demands = [];
  try { demands = (await api('/api/student/demands?scope=mine')).demands || []; state.myDemands = demands; }
  catch { demands = state.myDemands; }
  demands = demands.filter(d => d.status !== 'contracted'); // 已签约需求已成交，不可再推送
  const pickHtml = demands.length ? `<div class="push-pick">${demands.map(d => {
    const grade = STUDENT_GRADES.find(g=>g.id===d.student_grade)?.name || d.student_grade || '';
    const subs = DISP.subjectNames(d.target_subjects);
    const prov = DISP.provinceName(d.province);
    const method = DISP.methodName(d.teaching_method);
    return `<label class="push-pick-item glass"><input type="radio" name="push-demand" value="${d.id}">
      <span><span class="push-pick-main">${escHtml(grade)}${subs ? ' · ' + escHtml(subs) : ''}</span>
      <span class="push-pick-sub">${[prov, method].filter(Boolean).map(escHtml).join(' · ')}</span></span></label>`;
  }).join('')}</div>` : `<p class="text-sm text-muted">${state.myDemands.length ? UI.PUSH_NO_AVAILABLE_DEMANDS : UI.EMPTY_NO_MY_DEMANDS_SHORT}</p>`;
  openModal({
    title: `${UI.PUSH_MODAL_TITLE_PREFIX}${escHtml(tName)}`,
    style: 'max-width:480px;',
    closable: false,
    body: `<p class="text-sm text-muted" style="margin-bottom:12px;">${UI.PUSH_MODAL_HINT}</p>
        ${pickHtml}`,
    footer: `<button type="button" class="btn btn-outline glass glass--pressable" onclick="closeModal()">${UI.BTN_CANCEL}</button>
          <button type="button" class="btn glass glass--pressable" ${demands.length ? '' : 'disabled'} onclick="submitDemandPush(${teacherUserId})">${UI.BTN_SEND}</button>`,
  });
}

// 推送限流：每分钟限发一条。发送后全部「发送需求」按钮变灰 + 秒级倒计时
let pushCooldownUntil = 0, pushCooldownTimer = null;
function pushCooldownLeft() { return Math.max(0, Math.ceil((pushCooldownUntil - Date.now()) / 1000)); }
function renderPushBtn(t) {
  const left = pushCooldownLeft();
  return left > 0
    ? `<button type="button" class="tc-push-btn glass glass--pressable" disabled>${UI.PUSH_BTN_COOLDOWN} ${left}s</button>`
    : `<button type="button" class="tc-push-btn glass glass--pressable" onclick="openSendDemandModal(${t.user_id})">${UI.BTN_PUSH_DEMAND} <span class="arrow">→</span></button>`;
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
    const data = await api('/api/demand-pushes', { method: 'POST', body: { teacherUserId, demandId: +sel.value } });
    closeModal();
    startPushCooldown(60);
    showToast(data.message || UI.PUSH_SENT_FALLBACK);
  } catch (err) { showToast(err.message); }
}

// 教师处理学生主动推送：确认 = 建会话；拒绝 = 婉拒（学生收通知）
async function resolvePush(pushId, action) {
  try {
    await api(`/api/demand-pushes/${pushId}/resolve`, { method: 'POST', body: { action } });
    showToast(action === 'accept' ? UI.PUSH_ACCEPTED_TOAST : UI.PUSH_REJECTED_TOAST);
    loadBrowseDemands();
  } catch (err) { showToast(err.message); }
}

// ============================================================
// 通知信息页（全角色）：进入即标记已读并消红点
// ============================================================
// v0.19.46 屏蔽筛选：全量列表驻留模块级，过滤只动渲染层（select 值随 DOM 保留，重进页面续用）
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

// ============================================================
// 账户设置页（全角色）：细线分隔的设置行，无白框；退出登录置于页底 + 二次确认。
// 初期仅展示账户信息（电话/邮箱未绑定），修改按钮为占位（功能未开放）。
// ============================================================
function enterAccountSettings() {
  const u = state.user;
  const roleLabel = DISP.roleLabel(u.role);
  const row = (label, value, modifiable) => `
    <div class="settings-row">
      <div><div class="settings-label">${label}</div><div class="settings-value">${value}</div></div>
      ${modifiable ? `<button type="button" class="btn btn-outline btn-sm glass glass--pressable" onclick="showToast('${UI.TOAST_COMING_SOON}')">${UI.BTN_MODIFY}</button>` : ''}
    </div>`;
  // 外观主题三项：选中态按 localStorage 现值标注，点按走 setThemePref 即时切换
  const themePref = localStorage.getItem('sufe_theme') || 'system';
  const themeOpts = [['light', UI.THEME_LIGHT], ['dark', UI.THEME_DARK], ['system', UI.THEME_SYSTEM]].map(([k, label]) =>
    `<button type="button" class="theme-opt glass glass--pressable${themePref === k ? ' theme-opt--on' : ''}" data-pref="${k}" onclick="setThemePref('${k}')">${label}</button>`).join('');
  document.getElementById('account-settings-content').innerHTML = `
    <div class="settings-section-title">${UI.SETTINGS_APPEARANCE_TITLE}</div>
    <div class="settings-list">
      <div class="settings-row">
        <div>
          <div class="settings-label">${UI.SETTINGS_THEME_LABEL}</div>
          <div class="settings-hint">${UI.SETTINGS_THEME_HINT}</div>
        </div>
        <div class="theme-opts">${themeOpts}</div>
      </div>
    </div>
    <div class="settings-section-title">${UI.SETTINGS_ACCOUNT_TITLE}</div>
    <div class="settings-row settings-row--avatar">
      <div>
        <div class="settings-label">${UI.SETTINGS_AVATAR}</div>
        <label class="btn btn-outline btn-sm glass glass--pressable" for="avatar-file">${UI.BTN_UPLOAD_AVATAR}</label>
        <input type="file" id="avatar-file" accept="image/*" class="sr-file-input" onchange="handleAvatarUpload(this)">
      </div>
      ${renderAvatarHtml(u.avatar, u.username, 'settings-avatar')}
    </div>
    <div class="settings-list">
      ${row(UI.SETTINGS_USERNAME, escHtml(u.username), false)}
      ${row(UI.SETTINGS_ROLE, roleLabel, false)}
      ${row(UI.SETTINGS_PHONE, UI.SETTINGS_UNBOUND, true)}
      ${row(UI.SETTINGS_EMAIL, UI.SETTINGS_UNBOUND, true)}
    </div>
    <div class="settings-devices">
      <div class="settings-label">${UI.SETTINGS_DEVICES}</div>
      <div class="settings-hint">${UI.SETTINGS_DEVICES_HINT}</div>
      <div id="settings-devices-list" class="settings-devices-list">${loaderHtml('sm')}</div>
    </div>
    <button type="button" class="btn settings-logout glass glass--pressable" onclick="confirmLogout()">${UI.BTN_LOGOUT}</button>
    ${u.role !== 'admin' ? `<button type="button" class="btn-text-danger settings-deactivate glass" onclick="openDeactivateModal()">${UI.BTN_DEACTIVATE_ACCOUNT}</button>` : ''}`;
  loadDeviceSessions();
}

// 外观主题点按：写 localStorage → 主题脚本重算 → 切当前页按钮选中态（主题立即生效，无需刷新）
function setThemePref(pref) {
  localStorage.setItem('sufe_theme', pref);
  if (window.__applyTheme) window.__applyTheme();
  document.querySelectorAll('.theme-opt').forEach(b => b.classList.toggle('theme-opt--on', b.dataset.pref === pref));
}

// 新手引导：内测政策小浮窗（确认按钮关掉；本机无登录记录时启动弹出，也可在「关于平台」重温）
function openOnboarding() {
  const policyItems = UI.ONBOARD_POLICY.map(p => `<div class="onboard-policy-item"><span class="about-sec-mark glass" aria-hidden="true"></span><p>${escHtml(p)}</p></div>`).join('');
  openModal({
    title: UI.ONBOARD_TITLE,
    closable: false,
    body: `<p class="onboard-intro">${escHtml(UI.ONBOARD_INTRO)}</p><div class="onboard-policy">${policyItems}</div>`,
    footer: `<button type="button" class="btn btn-outline glass glass--pressable" onclick="openUsageGuide()">${UI.USAGE_GUIDE_BTN}</button>
      <button type="button" class="btn btn-primary glass glass--pressable" onclick="closeModal()">${UI.ONBOARD_CONFIRM}</button>`,
  });
}

// 详细用法介绍：关于页「平台基本用法」底部呼出的完整使用说明浮窗（复用 openModal；文案单源 constants）
function openUsageGuide() {
  const sections = UI.USAGE_GUIDE_SECTIONS.map(s => `
      <div class="usage-guide-section">
        <h4 class="usage-guide-title">${escHtml(s.t)}</h4>
        ${s.p.map(p => `<p class="usage-guide-text">${escHtml(p)}</p>`).join('')}
      </div>`).join('');
  openModal({
    title: UI.USAGE_GUIDE_TITLE,
    body: `<div class="usage-guide">${sections}</div>`,
    footer: `<button type="button" class="btn btn-primary glass glass--pressable" onclick="closeModal()">${UI.ONBOARD_CONFIRM}</button>`,
  });
}

// 登录设备管理：拉本人会话列表逐端展示（token 末 6 位脱敏展示，current 标「当前设备」不给下线按钮）。
// 页签已切走则丢弃结果（防异步串号，同教师弹窗评价教训）
async function loadDeviceSessions() {
  const box = document.getElementById('settings-devices-list');
  if (!box) return;
  try {
    const data = await api('/api/auth/sessions');
    if (state.page !== 'account-settings') return;
    const sessions = data.sessions || [];
    box.innerHTML = sessions.length
      ? sessions.map(renderDeviceRow).join('')
      : `${loaderHtml('sm')}`; // 至少有当前设备，空列表几乎不可能
  } catch {
    const b = document.getElementById('settings-devices-list');
    if (b && state.page === 'account-settings') b.innerHTML = `<div class="text-muted">${UI.ERROR_REQUEST_FAILED}</div>`;
  }
}
function renderDeviceRow(s) {
  // 安全（F-04）：后端只返回 session_id，不再下发 token；掩码展示用 session_id 尾段（非认证信息）
  const masked = '······' + String(s.session_id || '').slice(-6);
  return `<div class="device-row">
    <div class="device-info">
      <div class="device-label">${escHtml(s.label || UI.DEVICE_UNKNOWN)}${s.current ? ` <span class="device-current glass glass--solid">${UI.DEVICE_CURRENT}</span>` : ''}</div>
      <div class="device-meta">${masked} · ${UI.DEVICE_LOGIN_AT}${fmtDateTime(s.created_at)}</div>
    </div>
    ${s.current ? '' : `<button type="button" class="btn btn-outline btn-xs glass glass--pressable" onclick="revokeDeviceSession('${s.session_id}')">${UI.BTN_DEVICE_LOGOUT}</button>`}
  </div>`;
}
function revokeDeviceSession(sessionId) {
  openConfirmModal(UI.DEVICE_REVOKE_CONFIRM, async () => {
    try {
      const data = await api('/api/auth/sessions/revoke', { method: 'POST', body: { sessionId } });
      showToast(UI.DEVICE_REVOKE_DONE);
      if (data.revokedSelf) { handleLogout(); return; } // 踢的是自己 → 本地登出
      loadDeviceSessions();
    } catch (err) { showToast(err.message); }
  });
}

// 注销账户：两级确认（数据影响说明 → 最终危险确认）。后端抹单方数据、墓碑化用户名，
// 双方数据保留；成功后清本地会话回落地页（同登出）。
function openDeactivateModal() {
  openModal({
    title: UI.BTN_DEACTIVATE_ACCOUNT,
    style: 'max-width:430px;',
    body: `<p class="danger-warn">${UI.DEACTIVATE_WARN}</p>`,
    footer: `<button type="button" class="btn btn-outline glass glass--pressable" onclick="closeModal()">${UI.BTN_THINK_AGAIN}</button>
          <button type="button" class="btn btn-outline btn-sm glass glass--pressable" onclick="confirmDeactivateAccount()">${UI.BTN_CONTINUE_DANGER}</button>`,
  });
}
function confirmDeactivateAccount() {
  // 危险操作二次认证（网安报告 F-05）：后端 OTP 恒通过已废除，注销须密码重认证换 capToken
  reAuthModal(UI.DEACTIVATE_FINAL, async capToken => {
    try {
      await api('/api/user/deactivate', { method: 'POST', body: { capToken } });
      showToast(UI.DEACTIVATE_DONE_TOAST);
      setTimeout(handleLogout, 800); // 让用户看到提示再退
    } catch (err) { showToast(err.message); }
  });
}

// 图片压缩通用件：读文件 → canvas 缩放（square=居中取最大内切正方形 / 否则最长边等比缩放）→ JPEG dataURL。
// 头像（160px 方）与学信网截图（最长边 1000px）共用
function compressToDataURL(file, maxSide, quality, square) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onerror = () => reject(new Error(UI.CREDENTIAL_PICK_HINT));
    reader.onload = () => {
      const img = new Image();
      img.onerror = () => reject(new Error(UI.CREDENTIAL_PICK_HINT));
      img.onload = () => {
        let sx = 0, sy = 0, sw = img.width, sh = img.height, w, h;
        if (square) { const side = Math.min(sw, sh); sx = (sw - side) / 2; sy = (sh - side) / 2; sw = sh = side; w = h = maxSide; }
        else { const k = Math.min(1, maxSide / Math.max(sw, sh)); w = Math.round(sw * k); h = Math.round(sh * k); }
        const cv = document.createElement('canvas');
        cv.width = w; cv.height = h;
        cv.getContext('2d').drawImage(img, sx, sy, sw, sh, 0, 0, w, h);
        resolve(cv.toDataURL('image/jpeg', quality));
      };
      img.src = reader.result;
    };
    reader.readAsDataURL(file);
  });
}

// 通用大图查看器（聊天图片放大 / 学信网截图预览共用；点空白关闭）
function openImageViewer(src) {
  openModal({
    title: null,
    cls: 'image-viewer-modal',
    body: `<img src="${escHtml(src)}" alt="">`,
  });
}

// 头像上传：居中取最大内切正方形缩放至 160px（圆形由 CSS border-radius 呈现），dataURL 落库
async function handleAvatarUpload(input) {
  const file = input.files && input.files[0];
  if (!file) return;
  if (!file.type.startsWith('image/')) { showToast(UI.POST_IMAGE_ONLY); return; }
  try {
    const url = await compressToDataURL(file, 160, 0.85, true);
    await api('/api/user/avatar', { method: 'POST', body: { avatar: url } });
    state.user.avatar = url;
    showToast(UI.AVATAR_SAVED_TOAST);
    renderSidebar(); // 同步侧边栏底部头像（active 态按 state.page 重建）
    if (state.page === 'account-settings') enterAccountSettings(); // 刷新右侧预览
  } catch (err) { showToast(err.message); }
}

// ------------------------------------------------------------
// 学信网截图（教师档案页）：dataURL 暂存 _profileCredential，随档案一并提交（双向匹配后对方可见）。
// 控件两态：未上传「上传」(label for 触发选文件)；已上传「已上传，点击查看」+「重新上传」
// ------------------------------------------------------------
let _profileCredential = null;
function renderProfileCredentialCtl() {
  const ctl = document.getElementById('profile-credential-ctl');
  if (!ctl) return;
  ctl.innerHTML = _profileCredential
    ? `<button type="button" class="btn btn-outline btn-sm glass glass--pressable" onclick="viewProfileCredential()">${UI.CREDENTIAL_UPLOADED_VIEW}</button>
       <label class="btn-link-inline glass" for="profile-credential-file">${UI.CREDENTIAL_REUPLOAD}</label>`
    : `<label class="btn btn-outline btn-sm glass glass--pressable" for="profile-credential-file">${UI.CREDENTIAL_UPLOAD}</label>`;
}
async function handleCredentialPicked(input) {
  const files = [...input.files]; input.value = ''; // FileList 是活引用，先拷贝再清（选文件无反应 bug 同款教训）
  const file = files[0];
  if (!file) return;
  if (!file.type.startsWith('image/')) { showToast(UI.POST_IMAGE_ONLY); return; }
  try {
    _profileCredential = await compressToDataURL(file, 1000, 0.8, false);
    renderProfileCredentialCtl();
  } catch (err) { showToast(err.message); }
}
function viewProfileCredential() { if (_profileCredential) openImageViewer(_profileCredential); }
// 个人信息面板查看对方学信网截图（数据已按双向匹配门槛取回缓存于教师行）
function viewTeacherCredential(userId) {
  const t = findCachedTeacher(userId);
  if (t && t.credential_image) openImageViewer(t.credential_image);
}

// 退出登录二次确认（确认类弹窗，保留点遮罩关闭）
function confirmLogout() {
  openModal({
    title: null,
    style: 'max-width:380px;',
    body: `<p style="margin-bottom:16px;">${UI.CONFIRM_LOGOUT}</p>`,
    footer: `<button type="button" class="btn btn-outline glass glass--pressable" onclick="closeModal()">${UI.BTN_CANCEL}</button>
          <button type="button" class="btn glass glass--pressable" onclick="closeModal();handleLogout()">${UI.BTN_LOGOUT}</button>`,
  });
}

// 通用二次确认弹窗（全站禁止浏览器原生 confirm——必须走内置 modal 组件）
let pendingConfirmAction = null;
function openConfirmModal(message, action) {
  pendingConfirmAction = action;
  openModal({
    title: null,
    style: 'max-width:380px;',
    body: `<p style="margin-bottom:16px;">${message}</p>`,
    footer: `<button type="button" class="btn btn-outline glass glass--pressable" onclick="closeModal()">${UI.BTN_CANCEL}</button>
          <button type="button" class="btn glass glass--pressable" onclick="runPendingConfirm()">${UI.BTN_CONFIRM}</button>`,
  });
}
function runPendingConfirm() {
  closeModal();
  const action = pendingConfirmAction;
  pendingConfirmAction = null;
  if (action) action();
}

// 危险操作二次认证弹窗（网安报告 F-05）：确认文案 + 当前密码输入 → /api/auth/re-auth 换一次性
// capToken（5 分钟）→ 执行动作。密码错（403）就地提示，不踢登录（api() 对 401 才弹登录页）
let reAuthAction = null;
function reAuthModal(message, action) {
  reAuthAction = action;
  openModal({
    title: null,
    style: 'max-width:380px;',
    body: `<p style="margin-bottom:14px;">${message}</p>
      <div class="form-group" style="border:none;">
        <label class="form-label">${UI.REAUTH_PASSWORD_LABEL} <span class="req">*</span></label>
        <input type="password" class="form-input" id="reauth-password" placeholder="${UI.REAUTH_PASSWORD_HINT}" autocomplete="current-password" onkeydown="if(event.key==='Enter')runReAuth()">
        <p class="form-hint" id="reauth-err" style="color:var(--danger);display:none;"></p>
      </div>`,
    footer: `<button type="button" class="btn btn-outline glass glass--pressable" onclick="closeModal()">${UI.BTN_CANCEL}</button>
      <button type="button" class="btn glass glass--pressable" onclick="runReAuth()">${UI.BTN_CONFIRM}</button>`,
  });
  setTimeout(() => { const i = document.getElementById('reauth-password'); if (i) i.focus(); }, 50);
}
async function runReAuth() {
  const input = document.getElementById('reauth-password');
  const errEl = document.getElementById('reauth-err');
  if (!input || !errEl) return;
  const password = input.value;
  if (!password) { errEl.textContent = UI.REAUTH_PASSWORD_HINT; errEl.style.display = 'block'; input.focus(); return; }
  try {
    const r = await api('/api/auth/re-auth', { method: 'POST', body: { password } });
    const action = reAuthAction;
    reAuthAction = null;
    closeModal();
    if (action) await action(r.capToken);
  } catch (err) {
    errEl.textContent = err.message;
    errEl.style.display = 'block';
    input.value = '';
    input.focus();
  }
}


// [合同模块函数已迁至 app-contracts.js；管理员面板函数已迁至 app-admin.js]

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

// ============================================================
// 关于平台（全角色）：三张白色卡片——我们是谁 / 平台基本用法 / 用户支持（反馈 Bug / 建议）
// ============================================================
function enterAbout() {
  const aboutTitle = document.getElementById('about-page-title');
  if (aboutTitle) aboutTitle.textContent = UI.PAGE_ABOUT; // 页头标题归口 constants（静态文本仅 JS 前兜底）
  // 学生签约完整流程：纵向数字圆圈 + 细连线 + 每步一句话（无小标题/分隔线，流程图样式）
  const steps = [
    UI.ABOUT_FLOW_STEP_1, UI.ABOUT_FLOW_STEP_2, UI.ABOUT_FLOW_STEP_3, UI.ABOUT_FLOW_STEP_4, UI.ABOUT_FLOW_STEP_5,
  ].map((s, i, arr) => `<div class="about-flow-step">
      <div class="about-flow-rail">
        <span class="about-flow-dot glass">${i + 1}</span>
        ${i < arr.length - 1 ? '<span class="about-flow-line"></span>' : ''}
      </div>
      <p class="about-flow-text">${escHtml(s)}</p>
    </div>`).join('');
  // 安全与隐私保护：逐条「小盾标 + 粗体小标题 + 一句白话说明」（面向学生家长建立信任）
  const secItems = UI.ABOUT_SECURITY_ITEMS.map(it => `<div class="about-sec-item">
      <span class="about-sec-mark glass" aria-hidden="true"></span>
      <div class="about-sec-body"><strong class="about-sec-title">${escHtml(it.t)}</strong><p class="about-sec-desc">${escHtml(it.d)}</p></div>
    </div>`).join('');
  document.getElementById('about-content').innerHTML = `
    <div class="list-card about-card glass">
      <div class="navbar-logo about-logo" aria-hidden="true"><span></span><span></span><span></span><span></span></div>
      <div class="about-card-body">
        <h3 class="about-title">${UI.ABOUT_WHO_TITLE}</h3>
        <p class="about-text">${escHtml(UI.ABOUT_WHO_TEXT)}</p>
      </div>
    </div>
    <div class="list-card about-card-block glass">
      <h3 class="about-title">${UI.ABOUT_USAGE_TITLE}</h3>
      <div class="about-flow">${steps}</div>
      <div class="about-flow-revisit">
        <button type="button" class="btn btn-outline btn-sm glass glass--pressable" onclick="openUsageGuide()">${UI.USAGE_GUIDE_BTN}</button>
        <button type="button" class="btn btn-outline btn-sm glass glass--pressable" onclick="openOnboarding()">${UI.ONBOARD_REVISIT_BTN}</button>
      </div>
    </div>
    <div class="list-card about-card-block glass">
      <h3 class="about-title">${UI.ABOUT_SECURITY_TITLE}</h3>
      <p class="about-text">${escHtml(UI.ABOUT_SECURITY_INTRO)}</p>
      <div class="about-security-list">${secItems}</div>
    </div>
    <div class="list-card about-card-block glass">
      <h3 class="about-title">${UI.ABOUT_SUPPORT_TITLE}</h3>
      <div class="about-support-lines">
        <div>${escHtml(UI.ABOUT_SUPPORT_OWNER)}</div>
        <div>${escHtml(UI.ABOUT_SUPPORT_WECHAT)}</div>
        <div>${escHtml(UI.ABOUT_SUPPORT_EMAIL)}</div>
      </div>
      <div class="about-feedback-btns">
        <button type="button" class="btn btn-outline btn-sm glass glass--pressable" onclick="openFeedbackModal('suggestion')">${UI.BTN_FEEDBACK}</button>
      </div>
    </div>`;
  initReveals(document.getElementById('about-content'));
}

// ---- 反馈弹窗：Bug / 建议切换 + 复用发帖 Markdown 编辑器 ----
let feedbackKind = 'bug';
function openFeedbackModal(kind) {
  if (!ensureAuth()) return;
  feedbackKind = kind === 'suggestion' ? 'suggestion' : 'bug';
  openModal({
    title: `${feedbackKind === 'bug' ? UI.FEEDBACK_MODAL_TITLE_BUG : UI.FEEDBACK_MODAL_TITLE_SUGGEST}`,
    titleId: 'feedback-modal-title',
    closable: false,
    body: `<div id="post-alert"></div>
        <div class="form-group">
          <label class="form-label" for="post-title">${UI.POST_LABEL_TITLE}</label>
          <input type="text" id="post-title" class="form-input" maxlength="60" placeholder="${UI.FEEDBACK_TITLE_PLACEHOLDER}" oninput="updateTitleCount()">
          <span class="title-count" id="post-title-count">0/60</span>
        </div>
        <div class="feedback-kind-row">
          <button type="button" class="feedback-kind-btn glass${feedbackKind === 'bug' ? ' active' : ''}" data-kind="bug" onclick="switchFeedbackKind('bug')">${UI.BTN_FEEDBACK_BUG}</button>
          <button type="button" class="feedback-kind-btn glass${feedbackKind === 'suggestion' ? ' active' : ''}" data-kind="suggestion" onclick="switchFeedbackKind('suggestion')">${UI.BTN_FEEDBACK_SUGGEST}</button>
        </div>
        <div class="form-group">
          <label class="form-label">${UI.POST_LABEL_BODY}</label>
          <div class="md-toolbar">
            <button type="button" class="md-btn glass" onclick="mdWrap('h2')">H2</button>
            <button type="button" class="md-btn glass" onclick="mdWrap('h3')">H3</button>
            <button type="button" class="md-btn glass" onclick="mdWrap('bold')">${UI.POST_MD_BOLD}</button>
            <label class="md-btn glass" for="post-image-file">${UI.POST_MD_IMAGE}</label>
            <input type="file" id="post-image-file" accept="image/*" class="sr-file-input" onchange="insertPostImage(this)">
          </div>
          <textarea id="post-body" class="form-input post-body-input" rows="7" placeholder="${UI.FEEDBACK_PLACEHOLDER}" oninput="updatePostPreview()"></textarea>
        </div>
        <div class="form-group">
          <label class="form-label">${UI.POST_PREVIEW_LABEL}</label>
          <div id="post-preview" class="md-preview glass glass--solid"></div>
        </div>`,
    footer: `<button type="button" class="btn btn-outline glass glass--pressable" onclick="closeModal()">${UI.BTN_CANCEL}</button>
          <button type="button" class="btn glass glass--pressable" onclick="submitFeedback()">${UI.BTN_SEND}</button>`,
  });
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
  if (!title) { alertEl.innerHTML = `<div class="alert alert-error glass">${UI.POST_TITLE_REQUIRED}</div>`; return; }
  if (!content) { alertEl.innerHTML = `<div class="alert alert-error glass">${UI.FEEDBACK_EMPTY}</div>`; return; }
  try {
    await api('/api/feedbacks', { method: 'POST', body: { kind: feedbackKind, title, content } });
    closeModal();
    showToast(UI.FEEDBACK_SENT_TOAST);
  } catch (err) {
    alertEl.innerHTML = `<div class="alert alert-error glass">${escHtml(err.message)}</div>`;
  }
}

// ============================================================
// 模块3：试课意向（教师提交 / 学生在需求内展开处理）
// ============================================================
async function submitIntent(demandId) {
  if (!ensureAuth()) return; // 访客浏览需求大厅可看卡片，点意向即走登录通路
  try {
    await api(`/api/demands/${demandId}/intents`, { method: 'POST', body: {} });
    showToast(UI.INTENT_SUBMITTED_TOAST);
    if (state.page === 'browse-demands') loadBrowseDemands(); // 按钮刷新为「意向已提交」态
  } catch (err) {
    if (err.code === 'PROFILE_INCOMPLETE' || String(err.message).includes('档案不完整')) { showProfileIncompleteModal(); return; }
    showToast(err.message);
  }
}

// 档案不完整：拦截提交并引导去补档案（后端同样把关，弹窗只是更友好的引导）
function showProfileIncompleteModal() {
  openModal({
    title: UI.PROFILE_INCOMPLETE_TITLE,
    style: 'max-width:420px;',
    body: `<p class="text-sm" style="color:var(--ink-3);line-height:1.7;">${UI.PROFILE_INCOMPLETE_HINT}</p>`,
    footer: `<button type="button" class="btn btn-outline glass glass--pressable" onclick="closeModal()">${UI.BTN_LATER}</button>
          <button type="button" class="btn glass glass--pressable" onclick="closeModal();selectPage('edit-profile')">${UI.BTN_GO_COMPLETE_PROFILE}</button>`,
  });
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
  inner.innerHTML = `<div class="intents-box-content">${loaderHtml()}</div>`;
  try {
    const data = await api(`/api/demands/${demandId}/intents`);
    const ts = data.teachers || [];
    // 缓存意向教师，供个人信息面板复用（findCachedTeacher 第三数据源）
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
    inner.innerHTML = `<div class="intents-box-content"><p class="text-sm text-muted">${UI.ERROR_LOAD_PREFIX}${escHtml(err.message)}</p></div>`;
  }
}

function renderIntentTeacherRow(t, demandId) {
  const st = t.intent_status;
  const tag = st === 'accepted' ? `<span class="tag tag-ok glass glass--solid">${UI.INTENT_STATUS_ACCEPTED}</span>`
    : st === 'rejected' ? `<span class="tag tag-danger glass glass--solid">${UI.INTENT_STATUS_REJECTED}</span>` : `<span class="tag tag-warn glass glass--solid">${UI.INTENT_STATUS_PENDING}</span>`;
  const provName = DISP.provinceName(t.province);
  const viewBtn = `<button type="button" class="btn btn-outline btn-xs glass glass--pressable" onclick="openProfilePanel(${t.user_id})">${UI.BTN_VIEW}</button>`;
  const actions = st === 'pending'
    ? `<button type="button" class="btn btn-xs glass glass--pressable" onclick="resolveIntent(${t.intent_id},'accept',${demandId})">${UI.BTN_AGREE}</button>
       <button type="button" class="btn btn-outline btn-xs glass glass--pressable" onclick="resolveIntent(${t.intent_id},'reject',${demandId})">${UI.BTN_REJECT}</button>` : '';
  return `<div class="admin-row glass">
    <div class="admin-row-main">
      <div class="admin-row-line"><strong>${renderUsername(t.username)}</strong> ${renderStars(t.rating)} ${tag}</div>
      <div class="admin-row-meta">${[provName, `${t.price || '?'}${UI.PRICE_UNIT}`].filter(Boolean).join(' · ')}</div>
    </div>
    <div class="admin-row-actions">${viewBtn}${actions}</div>
  </div>`;
}

// 学生同意 / 拒绝意向；同意后自动建立会话，可前往「我的会话」
async function resolveIntent(intentId, action, demandId) {
  try {
    await api(`/api/intents/${intentId}/resolve`, { method: 'POST', body: { action } });
    showToast(action === 'accept' ? UI.INTENT_ACCEPTED_TOAST : UI.INTENT_REJECTED_TOAST);
    await refreshIntentsBox(demandId);
    loadMyDemands(); // 刷新意向计数（整列重渲染，意向栏回到收起态）
  } catch (err) { showToast(err.message); }
}

// ============================================================
// 教师档案编辑
// ============================================================
function initProfileForm() {
  const pageTitle = document.getElementById('profile-page-title');
  if (pageTitle) pageTitle.textContent = UI.PAGE_TITLE_EDIT_PROFILE; // 页头标题归口 constants（index.html 静态文本仅 JS 前的兜底）
  document.getElementById('profile-province-wrap').innerHTML =
    renderProvinceSelect('profile-province', '', 'onchange="onTeacherProvinceChange()"');
  const gradeEl = document.getElementById('profile-grade');
  gradeEl.innerHTML = `<option value="">${UI.OPTION_PLACEHOLDER}</option>` + TEACHER_GRADES.map(g=>`<option value="${g.id}">${g.name}</option>`).join('');
  const genderEl = document.getElementById('profile-gender');
  genderEl.innerHTML = `<option value="">${UI.OPTION_PLACEHOLDER}</option>` + GENDERS.map(g=>`<option value="${g.id}">${g.name}</option>`).join('');

  const subjEl = document.getElementById('profile-subjects');
  subjEl.innerHTML = SUBJECTS.map(s=>`
    <label class="checkbox-item glass glass--solid"><input type="checkbox" value="${s.id}">${s.name}</label>
  `).join('');
  subjEl.removeEventListener('change', onTeacherSubjectsChange); // 静态节点每次进档案页都会初始化，先解绑防叠加（勾一次触发 N 遍）
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
  _profileCredential = null; renderProfileCredentialCtl(); // 学信网截图控件复位（loadProfile 按库内值重绘）
  loadProfile();
}

async function loadProfile() {
  try {
    const data = await api('/api/teacher/profile');
    if (data.profile) {
      const p = data.profile;
      document.getElementById('profile-grade').value = p.grade || '';
      document.getElementById('profile-gender').value = p.gender || '';
      document.getElementById('profile-school').value = p.school || '';
      document.getElementById('profile-real-name').value = p.real_name || '';
      _profileCredential = p.credential_image || null; renderProfileCredentialCtl();
      document.getElementById('profile-price').value = p.price != null ? p.price : ''; // null = 未填报空；0 是合法报价须显示
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
  } catch (err) { console.error('loadProfile failed', err && err.message ? err.message : err); }
}

function pickGrade(el) {
  el.closest('.grade-selector').querySelectorAll('.grade-option').forEach(o=>o.classList.remove('selected'));
  el.classList.add('selected');
}

async function handleSaveProfile(e) {
  e.preventDefault();
  const alertEl = document.getElementById('profile-alert');
  const province = document.getElementById('profile-province').value;
  if (!province) { alertEl.innerHTML = `<div class="alert alert-error glass">${UI.VALIDATE_SELECT_PROVINCE}</div>`; return; }
  const subjects = [...document.querySelectorAll('#profile-subjects input:checked')].map(cb=>cb.value);
  if (!subjects.length) { alertEl.innerHTML = `<div class="alert alert-error glass">${UI.VALIDATE_SELECT_SUBJECT}</div>`; return; }

  // 省份锁定组件的收集函数（app-region.js），输出与旧 gaokao_scores 形状兼容
  const gaokaoScores = collectTeacherGaokao();

  try {
    const btn = document.getElementById('profile-submit');
    btn.disabled = true; btn.innerHTML = '<span class="spinner"><i></i><i></i><i></i></span>';
    await api('/api/teacher/profile', {
      method: 'POST', body: { profile: {
        province,
        grade: document.getElementById('profile-grade').value,
        gender: document.getElementById('profile-gender').value,
        subjects, gaokao_scores: gaokaoScores,
        price: document.getElementById('profile-price').value === '' ? null : +document.getElementById('profile-price').value, // 空 = 未填(null)，档案完整性门槛据此拦截；0 是合法报价
        wechat: document.getElementById('profile-wechat').value.trim(),
        email: document.getElementById('profile-email').value.trim(),
        intro: document.getElementById('profile-intro').value.trim(),
        address: document.getElementById('profile-address').value.trim(),
        school: document.getElementById('profile-school').value.trim(),
        real_name: document.getElementById('profile-real-name').value.trim(),
        credential_image: _profileCredential || '', // 截图 dataURL 暂存件随档案提交（空串 = 未上传/清空）
      }},
    });
    alertEl.innerHTML = `<div class="alert alert-success glass">${UI.SUCCESS_PROFILE_SAVED}</div>`;
    invalidate('teachers'); // 档案已变：清教师列表缓存，浏览页/个人信息面板/推送弹窗下次读取重拉新档
  } catch (err) {
    showToast(err.message); // v0.19.43 档案长表单底部提交：门牌号预警等错误改 Toast，避免被滚动淹没
  } finally {
    const btn = document.getElementById('profile-submit');
    btn.disabled = false; btn.textContent = UI.BTN_SAVE;
  }
}

// ============================================================
// Toast
// ============================================================
function showToast(msg) {
  const toast = document.createElement('div');
  toast.className = 'toast glass glass--float';
  toast.style.cssText = 'position:fixed;bottom:24px;left:50%;transform:translateX(-50%);padding:12px 24px;font-size:0.875rem;font-weight:500;z-index:300;animation:fadeUp 0.3s ease;';
  toast.textContent = msg;
  document.body.appendChild(toast);
  setTimeout(() => { toast.style.opacity = '0'; toast.style.transition = 'opacity 0.3s'; setTimeout(() => toast.remove(), 300); }, 2500);
}

// ============================================================
// Init
// ============================================================
document.addEventListener('DOMContentLoaded', async () => {
  // 自动登录：持久化令牌经 /api/auth/me 恢复用户（不再重放密码，本地无任何明文密码）
  try {
    const saved = JSON.parse(localStorage.getItem('sufe_session'));
    if (saved && saved.authToken && saved.expires > Date.now()) {
      state.authToken = saved.authToken;
      const data = await api('/api/auth/me');
      state.user = data.user;
      localStorage.setItem('sufe_session', JSON.stringify({ user: state.user, authToken: state.authToken, expires: saved.expires }));
      sessionStorage.setItem('sufe_session', JSON.stringify({ user: state.user, authToken: state.authToken }));
      enterClient(storedPage()); // 回到刷新前的页签
      return;
    } else if (saved) {
      localStorage.removeItem('sufe_session'); // 过期 / 旧版含密码格式：一并清理
    }
  } catch {
    // 令牌真正失效由 api() 的 401 处理统一清理（0.20.1）；网络抖动不删会话，否则下次访问变「首次」、新手引导重弹
  }
  try {
    const sess = JSON.parse(sessionStorage.getItem('sufe_session'));
    if (sess && sess.authToken) {
      state.authToken = sess.authToken;
      const data = await api('/api/auth/me');
      state.user = data.user;
      sessionStorage.setItem('sufe_session', JSON.stringify({ user: state.user, authToken: state.authToken }));
      enterClient(storedPage()); // 回到刷新前的页签
      return;
    } else if (sess) {
      sessionStorage.removeItem('sufe_session'); // 旧版含密码格式：清理
    }
  } catch {
    // 同 localStorage：网络抖动不删，仅 401 由 api() 清理
  }
  initCustomSelects(); // 静态页面上的筛选/评价下拉统一换自定义组件
  showView('landing');
  // 新手引导：仅「本设备从未打开过」弹一次（sufe_returning 常驻标记，登录/注册也写；会话过期/自动登录失败不再重弹）
  if (!localStorage.getItem('sufe_returning')) {
    localStorage.setItem('sufe_returning', '1');
    openOnboarding();
  }
});

/**
 * 壳与路由层（目标分层：状态管理层下游）—— 视图切换 / 侧边栏 / 页面注册表 / 统一装载器 / 红点徽标 / 初始化
 *
 * #175：领域脚本（app-region/posts/chat/contracts/chart/admin/demands/teachers/pages 等）不再
 * 于 index.html 同步加载——enterClient 时经 loadDomainScripts() 按 manifest 哈希名动态注入；
 * ROLE_PAGES 的 enter 全为惰性包装（() => 领域函数()），顶层不直接引用领域函数。
 *
 * 职责：
 *   - 视图管理（landing/login/register/invite-gate/client 五视图）
 *   - 侧边栏栏目注册表 ROLE_PAGES（加栏目 = 这里一条 + index.html 一个 section + 一个 enter 函数）
 *   - 统一装载器 loadInto（loading/空态/错误转义/浮入/乱序守卫 四件套，禁止手写）
 *   - 红点徽标慢轮询（30s，全角色；各模块也可即时 setBadge 消点）
 *   - 通知信息页（全角色）
 *   - DOMContentLoaded 初始化（落地页恒为入口 + 新手引导；不自动登录）
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
    el.innerHTML = `<button class="btn glass glass--pressable" onclick="showView('login')">${UI.NAV_LOGIN}</button>
      <button class="btn glass glass--pressable" onclick="showView('register')">${UI.NAV_REGISTER}</button>`;
  }
}

// ============================================================
// 客户端配置：侧边栏栏目注册表
// #175：领域脚本懒加载——enter 一律惰性包装（() => 领域函数()），
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
    { id: 'admin-awards',     label: UI.PAGE_ADMIN_AWARDS,  desc: UI.PAGE_ADMIN_AWARDS_DESC,  enter: () => loadAdminAwards() },
    { id: 'admin-posts',      label: UI.PAGE_ADMIN_POSTS,    desc: UI.PAGE_ADMIN_POSTS_DESC,    enter: () => loadAdminPosts() },
    { id: 'admin-contracts',  label: UI.PAGE_ADMIN_CONTRACTS, desc: UI.PAGE_ADMIN_CONTRACTS_DESC, enter: () => loadAdminContracts() },
    { id: 'admin-feedback',   label: UI.PAGE_ADMIN_FEEDBACK, desc: UI.PAGE_ADMIN_FEEDBACK_DESC, enter: () => loadAdminFeedback() },
    { id: 'admin-complaint',  label: UI.PAGE_ADMIN_COMPLAINT, desc: UI.PAGE_ADMIN_COMPLAINT_DESC, enter: () => loadAdminComplaints() },
    { id: 'admin-content',    label: UI.PAGE_ADMIN_CONTENT, desc: UI.PAGE_ADMIN_CONTENT_DESC, enter: () => loadAdminContent() }, // 统一内容审核
    { id: 'notifications',    label: UI.PAGE_NOTIFICATIONS,  desc: UI.PAGE_NOTIFICATIONS_DESC,  enter: enterNotifications },
    { id: 'account-settings', label: UI.PAGE_ACCOUNT_SETTINGS, desc: UI.PAGE_ACCOUNT_SETTINGS_DESC, enter: () => enterAccountSettings() },
    { id: 'about',            label: UI.PAGE_ABOUT,          desc: UI.PAGE_ABOUT_DESC,          enter: () => enterAbout(), auth: false },
  ],
};

// ------------------------------------------------------------
// 领域脚本懒加载：领域脚本从 index.html 移除，进入客户端时才按序动态注入。
// - DOMAIN_FILES 与 hash-assets.mjs 的清单必须同步（构建脚本哈希它们 + 写入 manifest）
// - 哈希名：window.ASSET_MANIFEST（构建时内联进 index.html）命中优先，缺省回落基名（源/测试环境）
// - 幂等哨兵：__domainLoaded 或领域函数已存在（测试 FILES 全载）即短路，不重复注入
// - 注入失败/超时兜底（CONFIG.DOMAIN_SCRIPT_TIMEOUT_MS 挂起超时 + 404 延迟重试），绝不永久挂起 enterClient
// - F6：经典脚本按 DOM 插入序执行 → Promise.all 并行注入（下载并行执行保序），
//   404 重试脚本插回原兄弟位（A1 审计）不破依赖序
// ------------------------------------------------------------
const DOMAIN_FILES = [
  'region-data.js', 'app-style.js', 'app-region.js', 'app-posts.js', 'app-chat.js',
  'app-contracts.js', 'app-chart.js', 'app-admin.js', 'app-demands.js', 'app-teachers.js',
  'ui-scale-reflow.js', // UI 滑块元素级模拟重排（共享层工具，仅客户端设置页用；app-state typeof 防御访问）
  'app-pages.js', 'app-complaints.js',
];
let __domainLoaded = false;
let __domainReloadOnce = false; // 领域脚本 404 重试耗尽后整页刷新自愈——只触发一次，防死循环
let __domainLoading = null; // #178 并发防重：预载与 enterClient 同时调 loadDomainScripts 时共享同一次注入
function loadDomainScripts() {
  if (__domainLoaded || typeof globalThis.loadMyDemands === 'function') return Promise.resolve(); // 已载/测试短路
  if (__domainLoading) return __domainLoading; // 注入已在途：复用同一 Promise，杜绝重复注入
  __domainLoading = (async () => {
    const manifest = (window.ASSET_MANIFEST || {}).files || {};
    // F6：串行 Promise 链 → 并行注入。经典脚本浏览器按 DOM 插入序执行，
    // 一次性 appendChild 全部 → 下载并行、执行仍保依赖序——冷进客户端 12 次 RTT 瀑布 → 1 波。
    // 404 重试语义不变（逐脚本延迟重试等边缘同步；耗尽整页刷新一次自愈，__domainReloadOnce 防死循环）。
    const inject = f => new Promise(resolve => {
      // Pages 部署滚动窗口（实测发布后约 1-2 分钟）内，manifest 放行的
      // 新哈希资产间歇 404（边缘节点未同步，实测 15 次里 4 次）——领域脚本 404 缺模块 → 教师列表/登录失败。
      // 自愈：先延迟重试等边缘同步（窗口 ~1-2 分钟，逐脚本重试保留页面状态），重试耗尽才整页刷新一次
      // 拿新 index.html（内联新 manifest）；刷新恢复登录/页面停留。
      const tryInject = (attempt, anchor) => {
        const s = document.createElement('script');
        s.src = '/' + (manifest[f] || f);
        let hangTimer = null; // 挂起下载超时（load/error/超时三者互斥，只放行一次）
        let retryTimer = null;
        let settled = false; // 三路只结算一次 + 晚到 onload 取消已排程重试
        // 审计修复（慢下载双执行炸页）：原 fail 重试注入第二份但未摘除原脚本——慢边缘
        // （冷 PoP/发布窗口单脚本下载 >6s）原脚本晚到仍执行 → 顶层 const/let 重复声明 → 领域模块
        // 状态损坏（弹窗打不开/流程中断/交互失灵，实测反复触发）。修 = fail 先摘除原脚本
        // （主流浏览器 de-facto 移除即中止待执行，尽力而为——非规范保证）+ 重试锚定原兄弟位（依赖序不破）。
        // 审计（F5）残余如实标注：settled 哨兵只闭合「晚到 onload 在重试注入前到达」（6-9s 完成 →
        // onload 取消重试）的单执行；「原脚本 >9s 才完成下载且浏览器不中止已摘除脚本」双条件叠加时仍可能
        // 双执行。经典脚本注入层无解（须模块级执行守卫，触及全部领域脚本，成本高），主流 Chromium 摘除即
        // 中止不触发此残余——已接受为文档化残余风险，勿在注入层继续加特例。
        const prev = anchor || (document.head.lastChild || null); // 本脚本插入前的兄弟，重试锚点（首次= head 尾）
        const fail = () => {
          if (settled) return; // 对端已成功（onload 已结算）→ 不摘除不重试
          settled = true;
          if (hangTimer !== null) { clearTimeout(hangTimer); hangTimer = null; }
          try { if (s.parentNode) s.parentNode.removeChild(s); } catch { /* ignore */ }
          if (attempt < CONFIG.DOMAIN_SCRIPT_RETRY) {
            // A1：并行注入下 404 重试若 appendChild 会追加到 head 末尾——
            // 其余 11 脚本早已执行完，被重试的脚本最后执行，依赖链头部（如 region-data → SUFE_REGIONS）
            // 在依赖者之后才就绪 → 窗口内点区域相关交互 ReferenceError；且坏模块顶层求值抛错时
            // onload 仍触发、__domainLoaded=true、不触发整页刷新自愈。重试脚本须插回原失败节点之后
            // （保持经典脚本依赖执行序），自愈语义才成立。
            retryTimer = setTimeout(() => tryInject(attempt + 1, prev), CONFIG.DOMAIN_SCRIPT_RETRY_MS);
          } else {
            if (!__domainReloadOnce) { __domainReloadOnce = true; setTimeout(() => location.reload(), 900); }
            resolve();
          }
        };
        s.onload = () => {
          if (settled) { // 原脚本晚到已执行 → 取消已排程的重试（防双执行竞态，审计 a）
            if (retryTimer !== null) { clearTimeout(retryTimer); retryTimer = null; }
            return;
          }
          settled = true;
          if (hangTimer !== null) { clearTimeout(hangTimer); hangTimer = null; }
          resolve();
        };
        s.onerror = fail;
        // 审计：挂起下载（无 load/error，如边缘节点吞请求）会令 enterClient 永久等待——加超时兜底
        // 按失败走重试/自愈（与 404 同语义），进页绝不卡死在 loading。
        hangTimer = setTimeout(fail, CONFIG.DOMAIN_SCRIPT_TIMEOUT_MS || 6000);
        // 相邻多失败时 prev 可能已被摘除（其自身 fail removeChild）——向前回退到最近存续兄弟，
        // 重试仍落在原区间（审计 c），杜绝追加到 head 末尾破依赖序。
        let ins = prev;
        while (ins && !ins.parentNode) ins = ins.previousSibling;
        if (ins && ins.parentNode) {
          ins.parentNode.insertBefore(s, ins.nextSibling); // 插回原兄弟位：依赖序不破
        } else {
          (document.head || document.documentElement).appendChild(s);
        }
      };
      tryInject(1, null);
    });
    await Promise.all(DOMAIN_FILES.map(f => inject(f)));
    __domainLoaded = true;
  })();
  return __domainLoading;
}

// #178：领域脚本后台静默预载——落地页渲染完成后即开始注入，
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
  // 刷新/进入客户端统一恢复页面停留——selectPage 记录的
  // sufe_last_page 在身份可见时恢复；pageId 显式传入（登录/切角色回跳）优先，身份不可见自动回落默认页
  const stored = getLastPage();
  // 停留页恢复须过「当前身份可见」门——
  // 上一角色登出后 sufe_last_page 残留（如 account-settings），访客恢复它 → selectPage 触发 ensureAuth
  // 弹登录页，且「返回」恢复同一页 → 死循环（返回无效）。访客只允许恢复 auth:false 的公开页。
  const storedOk = stored && pagesForRole().some(p => p.id === stored && (state.user || p.auth === false));
  const valid = pageId && pagesForRole().some(p => p.id === pageId) ? pageId
    : (storedOk ? stored : defaultPageFor());
  // 不阻塞登录——默认页签立即渲染（自身走正常加载），
  // 其余模块数据此刻开始后台并行预取（fire-and-forget），用户在页面里待着时就已全部就绪；
  // 预取在途时点进某模块由 dhReady 跳过 loader 闪屏，读取完即显示
  selectPage(valid);
  if (state.user) {
    // #10：先 dhPrefetch 设好全部预取键 inflight（同步块内完成）——
    // startBadgePoll 的 refreshBadges 随后 dhGet conversations/notifications 共享同一批 → 首波 1 次 batch
    // （原序徽标先跑独立 GET，批内跳过两键，首波实际 4-5 往返非 1）
    dhPrefetch(state.user.role);
    startBadgePoll(); // 红点轮询仅登录态开启（访客无个人数据可轮询）
    startVersionProbe();
  } else if (state.guestRole) {
    // 访客预览也开启版本探测 + 静默预取公开数据（与所在模块无关）
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
    // 删绝对定位 .sidebar-pill 覆盖层——active 高亮改由
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
  // 介绍改为结构化 Markdown（## 小标题 + 段落 + **加粗**），
  // 复用 app-posts 的 mdRender；文本浮窗统一走 modal--wide
  // S2-2：openModal 组件内统一转义，此处传原文（曾传 escHtml() 双重转义，外部审计抓出）
  openModal({
    title: cfg ? cfg.label : '',
    cls: 'modal--wide',
    bodyCls: 'module-info-md',
    body: mdRender(info),
  });
}

/** i 信息按钮构造：模块 title 旁小圆 i，带 a11y（Enter/Space 同开），
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

/** 页头 i 按钮注入：selectPage 切页汇聚点调用，按 pageId 定位当前页 .page-header 幂等插入。
 *  my-chats 页头被 .client-page--flush 隐藏（标题由聊天页自有区渲染，见 enterMyChats），跳过注入。 */
function injectPageHeaderInfo(pageId) {
  const old = document.querySelector('.page-header-info');
  if (old) old.remove();
  const hdr = document.querySelector('#client-main .client-page:not(.hidden) .page-header');
  if (!hdr || pageId === 'my-chats') return;
  const info = UI.MODULE_INFO && UI.MODULE_INFO[pageId];
  if (!info) return;
  const btn = createModuleInfoBtn(pageId);
  // h2 与 i 必须同组靠左——.page-header 是 space-between，直接 after(h2)
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
  // （用户反馈）：模块本身入层级树——切模块关闭所有子窗（新建需求/发送浮窗等
  // openModal 残留），否则切页后浮窗还在（教室列表点发送需求后迅速切侧栏即复现）。
  closeAllModals();
  document.querySelectorAll('#client-main .client-page').forEach(s =>
    s.classList.toggle('hidden', s.dataset.page !== pageId));
  document.querySelectorAll('#sidebar-nav .sidebar-item').forEach(b =>
    b.classList.toggle('active', b.dataset.page === pageId)); // active 高亮由条目自身 background 承载，切类即同步
  state.page = pageId;
  savePageState(pageId); // 记录页面停留，供刷新恢复（app-state 会话层统一能力）
  if (pageId !== 'my-chats' && typeof stopChatPolling === 'function') stopChatPolling(); // 切离聊天页即停轮询
  const cfg = pagesForRole().find(p => p.id === pageId);
  if (cfg && cfg.auth !== false && !ensureAuth()) return; // 需要身份的页统一过登录通路
  // 2026-08-09 反馈：看过即消——离开通知页把已展示的未读批量标记正常（免逐条点击）；离开聊天页把当前会话已读
  if (prevPage === 'notifications' && pageId !== 'notifications') markAllNotifsRead();
  if (prevPage === 'my-chats' && pageId !== 'my-chats' && typeof markActiveConvRead === 'function') markActiveConvRead();
  injectPageHeaderInfo(pageId); // 页面顶部 title 旁 i 按钮（侧边栏内的已删）
  if (cfg && cfg.enter) cfg.enter();
  closeSidebar();
  document.getElementById('client-main').scrollTop = 0;
}

// 删 sidebarPillGlide（原 glidePill 逐帧追逐）——active 高亮由条目自身承载，开合/缩放无需重绑
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
  // 静默数据层：会话缓存命中 → 跳过 loader 闪烁直出（切 tab 秒开）。
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
    // 静默数据层：徽标轮询改走会话数据层统一出口——与 tab 加载共享同一份缓存（单请求源），
    // 版本探测使缓存 ≤8s 新鲜，徽标天然跟得上数据变化
    const [convData, notifData] = await Promise.all([
      dhGet('/api/conversations', { domain: 'chat' }),
      dhGet('/api/notifications', { domain: 'notifications' }),
    ]);
    const chatUnread = (convData.conversations || []).reduce((s, c) => s + (c.unread_count || 0), 0);
    // 屏蔽系统通知后广播公告未读不再计入侧边栏红点——红点与屏蔽过滤同口径
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
    // 列表签名未变不整列重渲——原实现每 30s 轮询即使数据没变也 innerHTML 重写整列 + initReveals
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
let _lastContractSig = ''; // 合同列表渲染签名
// 审计 M1：探测刷新替换缓存数组后重挂 _notifList——屏蔽过滤与已读翻转依赖同引用
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
    const data = await dhGet('/api/notifications', { domain: 'notifications' }); // 静默数据层
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
  // #151：未读通知可点击/键盘消除——data-id 供 markNotifRead 精确定位；已读项无交互
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

// #151：未读通知呼吸遮罩点击消除——单条标记已读。本地先翻（_notifList 与 datahub 缓存
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
// 初始化（DOMContentLoaded）：刷新恢复登录/访客 + 页面停留；
// 无可恢复身份才落落地页。恒落落地页的防「链接直达自动登录」决定已废止——用户主动刷新
// 应保持刷新前状态——恢复编排按 登录会话 → 访客角色 → 落地页 顺序，能力在 app-state 会话层
// （loadSession/getLastGuestRole/getLastPage），进入复用 app-auth（switchToRole/enterRolePreview）。
// ============================================================
document.addEventListener('DOMContentLoaded', () => {
  initCustomSelects(); // 静态页面上的筛选/评价下拉统一换自定义组件
  // 身份恢复三分支 → 首访引导（修复：原访客恢复分支直接 return 不弹首访 + 弹窗被 selectPage 的
  // closeAllModals 清掉——身份恢复完成后（.then）再弹；已登录由 isReturning 拦截。
  // 不用 async 回调：jsdom 测试里挂起的 await 会在测试结束后恢复访问已清理 DOM（unhandledRejection））
  const saved = loadSession();
  // 令牌失效竞态（罕见，审计 noted）：saved 分支 switchToRole 的 /me 失败回落 enterRolePreview →
  // selectPage 的 closeAllModals 可能清掉刚弹的首访弹窗，且 setReturning 已写不再弹——触发需
  // localStorage 被清但 sessionStorage 会话保留 + 令牌失效叠加，接受该降级（用户仍可走落地页入口）
  const after = () => showOnboardingIfNeeded();
  if (saved && saved.authToken) { switchToRole(saved.user.role, saved).then(after, err => console.warn('onboarding after switchToRole skipped', err)); } // 校验后进客户端（enterClient 恢复页面）
  else {
    const guest = getLastGuestRole();
    if (guest) { enterRolePreview(guest).then(after, err => console.warn('onboarding after guest skipped', err)); } // 访客预览恢复（含页面停留）
    else { showView('landing'); after(); }
  }
  preloadDomainScripts(); // #178：后台静默预载领域脚本（同步调度，与身份恢复并行；点击入口下一帧即进客户端）
});

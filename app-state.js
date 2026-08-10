/**
 * 状态管理层（目标分层：状态管理层）—— 全站唯一 state 源 + 会话持久化 + 缓存协议 + 偏好存取
 *
 * 加载序（见 index.html）：constants.js → region-data.js → app-display.js → 本文件 → app-api → ...
 * 本文件在共享层最前加载，因此在此定义「全局词法绑定」：
 *   UI / SUBJECTS / STUDENT_GRADES / TEACHER_GRADES / GENDERS / TEACHING_METHODS / STATUS / CONFIG
 *   DISP（= globalThis.SUFE_DISPLAY）
 * 经典脚本的顶层 const 进全局词法作用域，后续全部模块（app-region/posts/chat/... 裸引 UI.*）共用。
 * 契约：任何模块不得再 `const UI = ...` 重复声明（会撞声明）；加载序若被调整，先动本文件。
 *
 * 会话持久化：令牌存 sessionStorage（刷新不死、关标签即焚）；勾「记住我」另存 localStorage
 * （TTL 同服务端 CONFIG.TOKEN_TTL_MS）。绝不存明文密码。全部经 try/catch 包装（存储被禁环境不炸）。
 *
 * 缓存协议：动作后失效——任何会改变数据的操作成功后调 invalidate(key) 置空对应缓存，
 * 下次读取自然重拉；缓存只此一份，消灭「各缓存各自为政、永不失效」。
 *
 * 登出复位：各领域模块经 registerLogoutReset(fn) 登记自身模块级残留清理，
 * 认证层 handleLogout 调 runLogoutResets() 统一收口（曾漏清 _profileCredential/_browseDemands 等）。
 */
const { SUBJECTS, STUDENT_GRADES, TEACHER_GRADES, GENDERS, TEACHING_METHODS, WEEKDAYS, PERSONALITY_TAGS, NONACADEMIC_PROJECTS, DEMAND_TYPES, UI, STATUS, CONFIG } = APP_CONSTANTS;
const DISP = globalThis.SUFE_DISPLAY; // app-display.js 已加载（本文件之前）

const state = {
  user: null, authToken: null, view: 'landing', page: null,
  allTeachers: [], adminTeachers: [], intentTeachers: [],
  myReviewOnModal: null,
  myDemands: [], editingDemandId: null, adminPosts: [], adminContracts: [], myContracts: [],
  inviteTimerId: null, currentInviteCode: null, validatedInviteCode: null,
  guestRole: null, guestAuthMode: false, // 访客模式：guestRole=主页按钮所选角色；guestAuthMode=正被 ensureAuth 导向登录页
};

// ============================================================
// 装载乱序守卫共享槽（loadInto 与领域手写装载共用；同一 seqKey 后发请求作废旧在途）
const loadSeqs = {};

// ============================================================
// 缓存协议
// ============================================================
const CACHE_KEYS = { teachers: 'allTeachers', contracts: 'myContracts', demands: 'myDemands', intentTeachers: 'intentTeachers', posts: 'adminPosts' };
// v0.23.0 静默数据层：写操作失效必须同时清会话数据层对应域缓存（加载器经 dhGet 读缓存，
// 只清 state 镜像会导致 dhGet 继续服务旧数据）。域映射与 app-datahub DH_PREFETCH 的域口径一致。
// v0.23.1 审计 M1/M5：补 posts/notifications/admin 域——发布/删除帖子、广播、管理员操作写后重载
// 必须清数据层缓存，否则命中写前旧数据（新帖不出现/已删项闪回）
const CACHE_DOMAINS = {
  teachers: 'teachers', contracts: 'contracts', demands: 'demands', intentTeachers: 'teachers',
  posts: 'posts', notifications: 'notifications', admin: 'admin',
};
function invalidate(key) {
  const k = CACHE_KEYS[key];
  if (k) state[k] = [];
  const d = CACHE_DOMAINS[key];
  if (d && typeof dhInvalidateDomain === 'function') dhInvalidateDomain(d);
}

// ============================================================
// 会话持久化（令牌；绝不存明文密码）
// v0.23.1 按角色分键：sufe_session_<role>——主页双按钮分别导向上次登录的学生/教师账户，
// 登出/401 只清当前角色（另一角色会话保留，供下次按角色恢复）。sufe_last_role 记上次使用角色，
// 无角色参数 loadSession() 按它恢复（v0.24.1 删自动登录后，恢复仅由主页角色按钮触发）
// ============================================================
const ROLES = ['student', 'teacher', 'admin'];
const sessionKey = role => `sufe_session_${role || ''}`;

function saveSession(remember) {
  const role = state.user ? state.user.role : '';
  const payload = { user: state.user, authToken: state.authToken };
  try { sessionStorage.setItem(sessionKey(role), JSON.stringify(payload)); } catch { /* 存储被禁：本次不持久 */ }
  if (remember) {
    try { localStorage.setItem(sessionKey(role), JSON.stringify({ ...payload, expires: Date.now() + CONFIG.TOKEN_TTL_MS })); } catch { /* ignore */ }
  } else {
    try { localStorage.removeItem(sessionKey(role)); } catch { /* ignore */ }
  }
  if (role) { try { localStorage.setItem('sufe_last_role', role); } catch { /* ignore */ } }
}

function loadSessionForRole(role) {
  const k = sessionKey(role);
  try {
    const saved = JSON.parse(localStorage.getItem(k));
    if (saved && saved.authToken && saved.expires > Date.now()) return { ...saved, source: 'local' };
    if (saved) { try { localStorage.removeItem(k); } catch { /* ignore */ } } // 过期/旧版含密码格式：清理
  } catch { /* ignore */ }
  try {
    const s = JSON.parse(sessionStorage.getItem(k));
    if (s && s.authToken) return { ...s, source: 'session' };
  } catch { /* ignore */ }
  // v0.24.0 旧键迁移：v0.23.1 改按角色分键前，会话存单一键 sufe_session——
  // 若该键里的用户角色匹配，迁移到角色键（否则老用户全部自动登录失效变访客）
  return loadLegacyAndMigrate(role);
}

/** 旧版单会话键（sufe_session）→ 迁移到 sufe_session_<role>；role 传入时仅角色匹配才迁移 */
function loadLegacyAndMigrate(role) {
  const migrate = (storage, isLocal) => {
    try {
      const raw = storage.getItem('sufe_session');
      if (!raw) return null;
      const saved = JSON.parse(raw);
      if (!(saved && saved.authToken && saved.user && saved.user.role)) {
        try { storage.removeItem('sufe_session'); } catch { /* ignore */ }
        return null;
      }
      if (role && saved.user.role !== role) return null; // 角色不匹配：留给同角色读取时迁移
      if (isLocal && !(saved.expires > Date.now())) {
        try { storage.removeItem('sufe_session'); } catch { /* ignore */ }
        return null;
      }
      storage.setItem(sessionKey(saved.user.role), JSON.stringify(saved)); // 迁移落角色键
      try { storage.removeItem('sufe_session'); } catch { /* ignore */ }
      if (!role) { try { storage.setItem('sufe_last_role', saved.user.role); } catch { /* ignore */ } }
      return { ...saved, source: isLocal ? 'local' : 'session' };
    } catch { /* ignore */ }
    return null;
  };
  return migrate(localStorage, true) || migrate(sessionStorage, false);
}

/** 读取持久化会话：带 role 读该角色；不带 role 按上次使用角色（sufe_last_role）读，
 *  无标记回落任一可用会话（旧存储迁移）。返回 { user, authToken, source } 或 null */
function loadSession(role) {
  if (role) return loadSessionForRole(role);
  try {
    const last = localStorage.getItem('sufe_last_role');
    if (last && ROLES.includes(last)) {
      const s = loadSessionForRole(last);
      if (s) return s;
    }
  } catch { /* ignore */ }
  for (const r of ROLES) {
    const s = loadSessionForRole(r);
    if (s) return s;
  }
  return loadLegacyAndMigrate(); // 兜底：旧键任意角色（v0.24.0 迁移）
}

function clearSession(role) {
  if (!role) return; // v0.24.2 审计：空角色不再清全量——401 兜底在 switchToRole（state.user 为空）曾以 '' 误删
  // 所有角色会话（另一角色有效记住会话被静默抹掉）。登录/登出路径均显式传角色，无合法全量清理调用方
  try { localStorage.removeItem(sessionKey(role)); } catch { /* ignore */ }
  try { sessionStorage.removeItem(sessionKey(role)); } catch { /* ignore */ }
}

// ============================================================
// 刷新恢复（v0.25.95，用户反馈「刷新不要回首页」）——会话/页面/访客角色三态持久化，
// 与 loadSession 同属本层会话能力；boot（app-shell）按 登录会话 → 访客角色 → 落地页 顺序编排恢复。
//   页面停留：selectPage 记录（sufe_last_page），enterClient 恢复（身份不可见自动回落默认页）；
//   访客角色：enterRolePreview 记录 / exitCurrentIdentity 清除（登出后刷新必回落地页）。
// ============================================================
const PAGE_STATE_KEY = 'sufe_last_page';
const GUEST_ROLE_KEY = 'sufe_last_guest_role';
function savePageState(pageId) {
  if (!pageId) return;
  try { localStorage.setItem(PAGE_STATE_KEY, pageId); } catch { /* ignore */ }
}
function getLastPage() {
  try { return localStorage.getItem(PAGE_STATE_KEY); } catch { return null; }
}
function setLastGuestRole(role) {
  try { role ? localStorage.setItem(GUEST_ROLE_KEY, role) : localStorage.removeItem(GUEST_ROLE_KEY); } catch { /* ignore */ }
}
function getLastGuestRole() {
  try { const r = localStorage.getItem(GUEST_ROLE_KEY); return ROLES.includes(r) ? r : null; } catch { return null; }
}

// 设备标识（v0.25.11 设备会话去重）：浏览器档案级持久 id——同一浏览器所有窗口/标签共享，
// 登录/注册随请求上传，服务端按 (user, device) 复用同一会话行（不再每次登录堆一行「设备」）。
// localStorage 按「源×浏览器档案」隔离：无痕/不同 Edge 档案/手机各自独立设备，语义正确。
function getDeviceId() {
  try {
    let id = localStorage.getItem(CONFIG.DEVICE_ID_KEY);
    if (!id || !/^[0-9a-f]{32}$/.test(id)) {
      const b = new Uint8Array(16);
      if (globalThis.crypto && typeof globalThis.crypto.getRandomValues === 'function') {
        globalThis.crypto.getRandomValues(b);
      } else { // 非浏览器/旧环境兜底（仅身份标签非凭证，可降级）
        for (let i = 0; i < 16; i++) b[i] = Math.floor(Math.random() * 256);
      }
      id = Array.from(b, x => x.toString(16).padStart(2, '0')).join('');
      localStorage.setItem(CONFIG.DEVICE_ID_KEY, id);
    }
    return id;
  } catch { return ''; } // 存储被禁（隐私模式等）：无设备标识 → 服务端回落旧 INSERT 行为
}

// ============================================================
// 偏好/标记存取（全部 try/catch，防隐私模式抛异常）
// ============================================================
function getThemePref() { try { return localStorage.getItem(CONFIG.THEME_KEY) || 'system'; } catch { return 'system'; } }
// A8 收口：主题偏好写路径单点（app-pages.setThemePref 点按切换内部调用，不再裸写 localStorage。
// 注意不与 app-pages 的 UI 层 setThemePref 重名——后者还负责 applyTheme/选中态，故本存储访问器前缀 store）
function storeThemePref(pref) { try { localStorage.setItem(CONFIG.THEME_KEY, pref); } catch (e) { /* 存储被禁：本次会话内仍可切换 */ } }
// 需求八·item3 背景光球外观（vivid 鲜艳=elegant 淡雅=hidden 隐藏；缺省鲜艳=当前效果）
function getOrbPref() { try { const v = localStorage.getItem(CONFIG.ORB_KEY || 'sufe_orb'); return (v === 'elegant' || v === 'hidden') ? v : 'vivid'; } catch { return 'vivid'; } }
function isReturning() { try { return !!localStorage.getItem('sufe_returning'); } catch { return false; } }
function setReturning() { try { localStorage.setItem('sufe_returning', '1'); } catch { /* ignore */ } }

// ============================================================
// 需求六·item5：UI 大小滑块（纯客户端，参照 setThemePref 模式）
//   值存 localStorage CONFIG.UI_SCALE_KEY（'sufe_ui_scale'，范围见 CONFIG.UI_SCALE_MIN/MAX，100=现状）；
//   首帧由 index.html 内联脚本把现值换算 --ui-scale 系数注入 <html>（无 FOUC）；
//   滑块经 setUiScale 即时重算 --ui-scale（documentElement 上），全站 CSS calc() 消费，不走服务器。
//   纯函数独立暴露供 jsdom 单测（钳制/读写/填充百分比）。
// ============================================================
function uiScaleClamp(v) {
  const n = Number(v);
  if (!isFinite(n)) return CONFIG.UI_SCALE_DEFAULT;
  return Math.min(CONFIG.UI_SCALE_MAX, Math.max(CONFIG.UI_SCALE_MIN, Math.round(n)));
}
function getUiScale() {
  let v = CONFIG.UI_SCALE_DEFAULT;
  try {
    const raw = parseInt(localStorage.getItem(CONFIG.UI_SCALE_KEY), 10);
    if (!isNaN(raw)) v = raw;
  } catch { /* 存储被禁：回默认 */ }
  return uiScaleClamp(v);
}
function applyUiScale(v) {
  const c = uiScaleClamp(v);
  document.documentElement.style.setProperty('--ui-scale', (c / 100).toFixed(3));
  return c;
}
// v0.25.94 重构（R3）：拖动丝滑根治法——拖动期不再动 --ui-scale（全页每帧重排版+重绘，
// 实测 ~100ms/帧，刷新率暴跌根因），改 html 上 compositor-only 的 transform: scale 实时预览
// （transform 不失效样式/布局，实测失效成本 ~0ms，主线程零排版），松手 commit 才落 --ui-scale
// 真排版（一次性）。
//   setUiScale 拆两段——applyUiScale 同步应用（首帧/落盘路径），联动事件转 rAF 调度；
//   拖动中「事件只记 pending，rAF 每帧最多消费一次」保留（transform 合成本就帧对齐）。
//   U2（v0.25.105）：预览期抑制滚动条（overflow hidden，防放大时滚动条出现导致页面跳）；
//   原点曾改 center（「四边对称，观感稳定」）——v0.25.110 用户返工实证拒绝：整页 scale 居中 = 四个
//   边缘一起动（镜头缩放感，用户：「你就算是把页面拆成侧边栏/个人信息栏/设置栏分别锚定我也都忍了」）。
//   上网检索成熟方案结论：整页/容器缩放必须 transform-origin top left（SitePoint/Chromium 一致，
//   否则内容从左边/上边滑出视口）；center 仅用于 hover/scale 元素动画。故回归 top-left 锚定：
//   放大从左上向右下展开（浏览器 Ctrl+ 缩放同款），缩小从左上收缩右下留白；overflow hidden 保留
//   防滚动条跳变。commit 才落真排版（--ui-scale，左上自然锚定，一次性）。
let _uiScalePending = null;   // 待预览的目标值（拖动合并：同帧多次 oninput 只合成一次）
let _uiScaleRaf = 0;          // rAF 句柄（0 = 空闲）
function _uiScaleClearLive() {
  document.documentElement.style.removeProperty('transform');
  document.documentElement.style.removeProperty('overflow'); // U2：预览期滚动条抑制随预览清除一并恢复
  document.documentElement.style.removeProperty('transformOrigin');
}
function _uiScaleLiveApply(c) {
  document.documentElement.style.transformOrigin = 'top left'; // v0.25.110：整页缩放成熟锚定（见上注释）
  document.documentElement.style.overflow = 'hidden';
  document.documentElement.style.transform = `scale(${(c / 100).toFixed(3)})`;
}
function _uiScaleFlush() {
  _uiScaleRaf = 0;
  const c = _uiScalePending;
  if (c == null) return;
  _uiScalePending = null;
  _uiScaleLiveApply(c);
}
// 同步应用（无合并；首帧/测试路径），返回钳制值
function setUiScale(v) {
  const c = uiScaleClamp(v);
  _uiScaleClearLive();
  const r = applyUiScale(c);
  try { localStorage.setItem(CONFIG.UI_SCALE_KEY, String(c)); } catch { /* ignore */ }
  try { window.dispatchEvent(new window.Event('sufe:ui-scale')); } catch { /* ignore */ }
  return r;
}
// 拖动中：html transform 实时预览（compositor-only，不失效布局），rAF 合并每帧合成一次；
// 不落盘（松手 change 时 commit）。返回钳制值供调用方同步刷标签（预览合成在 rAF 帧，标签即时无妨）。
function setUiScaleLive(v) {
  const c = uiScaleClamp(v);
  _uiScalePending = c;
  if (!_uiScaleRaf) _uiScaleRaf = requestAnimationFrame(_uiScaleFlush);
  return c;
}
// 松手/失焦：清预览 transform → 落真 --ui-scale（一次全页排版）→ 落盘。若拖动 rAF 在途，清掉 pending 防旧值覆盖。
function commitUiScale(v) {
  const c = uiScaleClamp(v);
  if (_uiScaleRaf) { cancelAnimationFrame(_uiScaleRaf); _uiScaleRaf = 0; }
  _uiScalePending = null;
  _uiScaleClearLive();
  const r = applyUiScale(c);
  try { localStorage.setItem(CONFIG.UI_SCALE_KEY, String(c)); } catch { /* ignore */ }
  try { window.dispatchEvent(new window.Event('sufe:ui-scale')); } catch { /* ignore */ }
  return r;
}
// 滑块填充百分比（80→0%、100→100%），供设置页轨道填充渐变；
// 审计修复：min==max 时除零得 Infinity，防御性回 100
function uiScaleFillPct(v) {
  const c = uiScaleClamp(v);
  const span = CONFIG.UI_SCALE_MAX - CONFIG.UI_SCALE_MIN;
  if (span <= 0) return '100.0';
  return ((c - CONFIG.UI_SCALE_MIN) / span * 100).toFixed(1);
}

// M1（v0.25.103）：ctrl/cmd + 滚轮在任意位置调整 UI 大小（成熟网页标配）。
// 参考成熟实现：wheel 监听必须 { passive:false } 才能 preventDefault 拦截浏览器原生缩放；
// ctrlKey||metaKey 双平台（Win/Linux Ctrl、macOS Cmd）；deltaY 符号定方向（上滚放大/下滚缩小）；
// 连续滚轮 rAF 合并成一次落盘（避免每帧全站重排版）；钳制到 UI_SCALE_MIN/MAX。
// 直接复用 --ui-scale 体系（与设置页滑块同源 setUiScale，全站 calc() 消费，真实重排版），
// 不用 transform 预览（那是拖动期帧率策略，正式调整应落真排版）。
function bindUiScaleWheel() {
  let pending = 0;
  let raf = 0;
  document.addEventListener('wheel', (e) => {
    if (!e.ctrlKey && !e.metaKey) return;
    e.preventDefault(); // 拦截浏览器原生页面缩放/滚动
    // U5（v0.25.105）：步长放大 4 倍（用户实证「一格太小、拖沓」）——CONFIG.UI_SCALE_WHEEL_STEP 单源
    pending += e.deltaY < 0 ? CONFIG.UI_SCALE_WHEEL_STEP : -CONFIG.UI_SCALE_WHEEL_STEP;
    if (!raf) raf = requestAnimationFrame(() => {
      raf = 0;
      if (!pending) return;
      setUiScale(getUiScale() + pending); // 钳制 + 落盘 + 应用 --ui-scale
      pending = 0;
    });
  }, { passive: false });
}
// 顶层绑定（jsdom 单测环境无 document 时跳过）
if (typeof document !== 'undefined' && document.addEventListener) bindUiScaleWheel();

// ============================================================
// 登出复位注册表：领域模块登记自身的模块级残留清理
// ============================================================
const logoutResets = [];
function registerLogoutReset(fn) { if (typeof fn === 'function' && !logoutResets.includes(fn)) logoutResets.push(fn); }
function runLogoutResets() {
  for (const fn of logoutResets) { try { fn(); } catch { /* 单个清理失败不阻断其余 */ } }
}

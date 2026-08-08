/**
 * 认证流程（目标分层：壳与主流程下游）—— 登录通路 / 注册 / 登录 / 登出 / 访客模式
 *
 * 登录通路（全站唯一）：一切需要真实用户信息的页面/操作都经 ensureAuth()。
 * 未登录 → 记下当前页 → 导向特制登录页（标题「登录以使用更多功能」）→ 登录/注册
 * 成功后 afterAuthSuccess → enterClient(authReturnPage) 自动回到原页面状态。
 * api() 层 401 兜底同样汇入此通路（令牌过期等同未登录）。
 *
 * 会话持久化收敛到 app-state saveSession/clearSession（绝不存明文密码）；
 * 登出经 runLogoutResets() 统一清理各领域模块登记的模块级残留。
 */
let authReturnPage = null;
let loginCheckTimer = null, loginCheckSeq = 0;

function ensureAuth() {
  if (state.user) return true;
  authReturnPage = state.view === 'client' ? state.page : null;
  state.guestAuthMode = true;
  showView('login');
  return false;
}

// 登录页标题按来路切换（index.html 静态文本仅作 JS 前兜底）。
// v0.23.1：预览端触发登录时按客户端类型提示「请登录教师/学生账户」
// v0.24.0：登录表单用户名按当前客户端角色预填（拉该角色上次登录记录）——
// 学生端预填学生账户、教师端预填教师账户，不再串号
function refreshAuthHeader() {
  const h = document.getElementById('login-title');
  const p = document.getElementById('login-subtitle');
  if (!h || !p) return;
  const u = document.getElementById('login-username');
  if (u) {
    const saved = state.guestRole ? loadSession(state.guestRole) : loadSession();
    const name = saved && saved.user ? saved.user.username : '';
    u.value = name; // 覆盖浏览器自动填充的异角色账密（密码无法按角色预填：绝不存明文密码）
  }
  if (state.guestAuthMode && state.guestRole === 'teacher') {
    h.textContent = UI.AUTH_LOGIN_TITLE_TEACHER;
    p.textContent = UI.AUTH_LOGIN_SUB_TEACHER;
  } else if (state.guestAuthMode && state.guestRole === 'student') {
    h.textContent = UI.AUTH_LOGIN_TITLE_STUDENT;
    p.textContent = UI.AUTH_LOGIN_SUB_STUDENT;
  } else {
    h.textContent = state.guestAuthMode ? UI.AUTH_LOGIN_TITLE_GUEST : UI.AUTH_LOGIN_TITLE;
    p.textContent = state.guestAuthMode ? UI.AUTH_LOGIN_SUB_GUEST : UI.AUTH_LOGIN_SUB;
  }
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

// 登录 / 注册成功统一收口：清访客态 + 本机已登录标记 + 自动返回触发登录通路的那个页面
function afterAuthSuccess() {
  state.guestAuthMode = false;
  state.guestRole = null;
  setReturning(); // 本设备已登录过 → 首访新手引导不再弹
  // v0.23.0 静默数据层：登录/注册成功即清会话缓存——访客浏览期缓存的 anon 视角数据
  // （teachers.matched / posts.liked / demands.my_intent_status）是 per-user 的，不清理会
  // 被新身份读到（dhPeek 命中旧身份缓存）。清理后 enterClient 的预取为当前身份现拉
  if (typeof dhInvalidateAll === 'function') dhInvalidateAll();
  const back = authReturnPage; authReturnPage = null;
  enterClient(back || undefined); // 返回页与新角色不匹配时 enterClient 自然回落默认页
}

function switchRegisterRole(role) {
  document.getElementById('register-role').value = role;
  document.querySelectorAll('#register-role-tabs .seg-tab').forEach(t => t.classList.toggle('active', t.dataset.role === role));
  // 教师注册：门控休眠期（内测）直接填表；恢复后先验证邀请码再填表
  if (role === 'teacher' && !APP_CONSTANTS.INVITE_GATE_DORMANT) {
    showView('invite-gate');
  }
}

function handleFeatureClick(role) {
  // v0.23.1 主页双按钮按角色分流：恢复该角色「上次登录」已存会话，无记录则进入该角色访客预览。
  // v0.24.1 删自动登录后落地页恒为访客态（state.user 恒 null），原「同角色已登录直进」分支已不可达（死代码已删）
  const saved = loadSession(role);
  if (saved && saved.authToken) { switchToRole(role, saved); return; }
  enterRolePreview(role);
}

// 切换到目标角色：先清当前运行时（保留其已存会话，供下次切回），再校验目标角色令牌
function switchToRole(role, saved) {
  exitCurrentIdentity();
  state.authToken = saved.authToken;
  api('/api/auth/me').then(data => {
    state.user = data.user;
    saveSession(saved.source === 'local'); // 保活刷新该角色会话（按 state.user.role 落键）
    enterClient();
  }).catch((err) => {
    state.authToken = null;
    // v0.24.2 审计：死令牌只清目标角色会话（401 兜底在 state.user 为空时曾以 '' 误删全部角色会话）；
    // 网络抖动不删会话——令牌仍可恢复，下次点角色按钮再校验
    if (err && err.code !== 'NETWORK_ERROR') clearSession(role);
    enterRolePreview(role); // 令牌失效：回落该角色访客预览
  });
}

// 进入目标角色访客预览（未登录态，用户信息栏显示「未登录」）
function enterRolePreview(role) {
  exitCurrentIdentity();
  state.guestRole = role;
  state.guestAuthMode = false;
  enterClient();
}

// 清当前运行时身份（登出/切换共用）：停轮询 + 领域残留 + 会话缓存；不删已存会话记录
function exitCurrentIdentity() {
  stopBadgePoll();
  if (typeof stopChatPolling === 'function') stopChatPolling();
  if (typeof runLogoutResets === 'function') runLogoutResets();
  state.user = null; state.authToken = null;
  state.guestRole = null; state.guestAuthMode = false;
}

// ------------------------------------------------------------
// 登录页：用户名输入实时查角色（命中现有账户时输入框下方灰字提示）
// ------------------------------------------------------------
function checkLoginUsernameDebounced() {
  clearTimeout(loginCheckTimer);
  loginCheckTimer = setTimeout(checkLoginUsername, CONFIG.LOGIN_CHECK_DEBOUNCE_MS);
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

async function handleLogin(e) {
  e.preventDefault();
  const username = document.getElementById('login-username').value.trim();
  const password = document.getElementById('login-password').value;
  const alertEl = document.getElementById('login-alert');
  const btn = document.getElementById('login-submit');

  try {
    btnLoading(btn, UI.LOADING_LOGIN);
    const data = await api('/api/auth/login', { method: 'POST', body: { username, password, deviceId: getDeviceId() } });
    state.user = data.user; state.authToken = data.authToken || null;
    alertEl.innerHTML = '';
    saveSession(document.getElementById('login-remember').checked); // 会话持久化（绝不存明文密码）
    afterAuthSuccess();
  } catch (err) {
    alertEl.innerHTML = alertHtml('error', err.message);
  } finally {
    btnDone(btn, UI.BTN_LOGIN);
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
    alertEl.innerHTML = alertHtml('error', UI.VALIDATE_PASSWORD_MISMATCH);
    return;
  }
  if (role === 'teacher' && !APP_CONSTANTS.INVITE_GATE_DORMANT) {
    if (!state.validatedInviteCode) {
      alertEl.innerHTML = alertHtml('error', UI.VALIDATE_INVITE_FIRST);
      showView('invite-gate');
      return;
    }
  }

  try {
    const btn = document.getElementById('register-submit');
    btnLoading(btn, UI.LOADING_REGISTER);
    const body = { username, password, role, deviceId: getDeviceId() };
    if (role === 'teacher' && state.validatedInviteCode) body.inviteCode = state.validatedInviteCode;
    const data = await api('/api/auth/register', { method: 'POST', body });
    state.user = data.user; state.authToken = data.authToken || null;
    if (role === 'teacher') state.validatedInviteCode = null; // 请求成功后清（网络失败保留，重试免重验；原提前清空致失败即需重验）
    alertEl.innerHTML = '';
    saveSession(false); // 注册即登录：会话存 sessionStorage（刷新保留，关标签即焚）
    afterAuthSuccess();
  } catch (err) {
    alertEl.innerHTML = alertHtml('error', err.message);
  } finally {
    const btn = document.getElementById('register-submit');
    btnDone(btn, UI.BTN_REGISTER);
  }
}

async function validateInviteAndRegister() {
  const code = document.getElementById('invite-code-input').value.trim();
  const alertEl = document.getElementById('invite-gate-alert');

  if (!code) { alertEl.innerHTML = alertHtml('error', UI.VALIDATE_INVITE_REQUIRED); return; }

  // 这里只做格式校验，真正的验证在注册时进行
  if (code.length !== CONFIG.INVITE_CODE_LEN) {
    alertEl.innerHTML = alertHtml('error', UI.VALIDATE_INVITE_LENGTH); // 8 位
    return;
  }

  // 保存验证过的邀请码，跳转到注册表单
  state.validatedInviteCode = code;
  alertEl.innerHTML = alertHtml('success', UI.SUCCESS_INVITE_CONFIRMED);

  // 等一秒让用户看到成功提示，然后跳转到注册页
  setTimeout(() => {
    document.getElementById('register-role').value = 'teacher';
    document.querySelectorAll('#register-role-tabs .seg-tab').forEach(t =>
      t.classList.toggle('active', t.dataset.role === 'teacher'));
    showView('register');
  }, CONFIG.REOPEN_DELAY_MS);
}

function handleLogout() {
  const role = state.user ? state.user.role : ''; // v0.23.1：记当前角色，只清该角色会话
  if (state.authToken) api('/api/auth/logout', { method: 'POST', body: {} }).catch(() => {}); // 真登出：吊销当前会话（fire-and-forget）
  stopBadgePoll();
  if (typeof stopChatPolling === 'function') stopChatPolling(); // 登出即停聊天轮询（兼清暂存附件）
  runLogoutResets(); // 各领域模块登记的模块级残留清理（推送冷却/匹配卡/挂起确认/通知缓存/档案截图等）
  window._contractDraftDemands = null; // 防上一账户的起草候选被新账户触发
  state.user = null; state.authToken = null; state.page = null;
  state.guestRole = null; state.guestAuthMode = false; authReturnPage = null;
  closeProfilePanel(); // 内部 seq 作废在途（panel 状态复位由 app-teachers 的 logout reset 兜底）
  state.allTeachers = []; state.adminTeachers = []; state.intentTeachers = [];
  state.myDemands = []; state.editingDemandId = null; state.adminPosts = []; state.adminContracts = []; state.myContracts = [];
  state.inviteTimerId = null; state.currentInviteCode = null; state.validatedInviteCode = null; // 邀请码随账号清（曾漏清）
  clearSession(role); // v0.23.1：只清当前角色会话——另一角色会话保留，供主页按角色分流恢复
  closeSidebar();
  showView('landing');
}

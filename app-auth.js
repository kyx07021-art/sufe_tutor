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
// v0.26.0：唯一输入框 login-identifier（用户名/手机号/邮箱）；进登录页复位密码模式与账户探测态
let loginMode = 'password'; // 密码登录（默认） | 验证码登录（页脚小字切换）
let loginAccountValid = false; // 账户探测是否有效（有效才呼出凭证组）

function refreshAuthHeader() {
  const h = document.getElementById('login-title');
  const p = document.getElementById('login-subtitle');
  if (!h || !p) return;
  const u = document.getElementById('login-identifier');
  if (u) {
    const saved = state.guestRole ? loadSession(state.guestRole) : loadSession();
    const name = saved && saved.user ? saved.user.username : '';
    u.value = name; // 覆盖浏览器自动填充的异角色账密（密码无法按角色预填：绝不存明文密码）
    if (name) checkLoginUsernameDebounced(); // 预填账户立即探测，命中即启用登录按钮（防手输前按钮灰置）
  }
  // 复位登录表单态（v0.26.0：每次进登录页回密码模式 + 隐藏凭证组 + 清探测提示）
  loginMode = 'password'; loginAccountValid = false;
  const pw = document.getElementById('login-password-group');
  const cd = document.getElementById('login-code-group');
  const hint = document.getElementById('login-username-hint');
  const link = document.getElementById('login-switch-mode');
  const btn = document.getElementById('login-submit');
  if (pw) pw.classList.add('hidden');
  if (cd) cd.classList.add('hidden');
  if (hint) { hint.textContent = ''; hint.classList.remove('login-hint--missing'); }
  if (link) link.textContent = UI.LOGIN_SWITCH_CODE;
  if (btn) { btn.disabled = true; btn.classList.add('disabled'); } // 未确认账户前登录按钮灰置
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

// R28（v0.25.93）：主页入口按钮光标跟随光斑（liquid 透镜感）——mousemove 委托更新 --mx/--my，
// 视觉全在 CSS 层（.entry-glow radial-gradient），JS 只写几何变量。仅当入口按钮渲染时更新，零常驻成本。
document.addEventListener('mousemove', (e) => {
  const entry = e.target && e.target.closest ? e.target.closest('.entry') : null;
  if (!entry) return;
  const r = entry.getBoundingClientRect();
  entry.style.setProperty('--mx', (e.clientX - r.left) + 'px');
  entry.style.setProperty('--my', (e.clientY - r.top) + 'px');
});

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
// v0.25.95：持久化访客角色（sufe_last_guest_role）——刷新恢复访客预览与页面停留（用户反馈「刷新不要回首页」）
function enterRolePreview(role) {
  exitCurrentIdentity();
  state.guestRole = role;
  state.guestAuthMode = false;
  setLastGuestRole(role); // exit 已清旧值，此处重写当前访客角色
  enterClient();
}

// 清当前运行时身份（登出/切换共用）：停轮询 + 领域残留 + 会话缓存；不删已存会话记录
// v0.25.95：同步清访客角色标记——登出/切换后刷新必回落地页（无身份可恢复）
function exitCurrentIdentity() {
  stopBadgePoll();
  if (typeof stopChatPolling === 'function') stopChatPolling();
  if (typeof runLogoutResets === 'function') runLogoutResets();
  setLastGuestRole(null);
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
  const identifier = document.getElementById('login-identifier').value.trim();
  const seq = ++loginCheckSeq;
  if (!identifier || !hint) {
    if (hint) hint.textContent = '';
    loginAccountValid = false;      // 清空输入 → 按钮回灰（凭证组已由 refreshAuthHeader 隐藏）
    syncLoginCredGroups();
    return;
  }
  try {
    const data = await api(`/api/auth/check?identifier=${encodeURIComponent(identifier)}`);
    if (seq !== loginCheckSeq) return; // 过期响应丢弃，防输入快于请求时的乱序
    // v0.26.0：账户类型反馈复用「学生账户/教师账户/管理员账户」，加「不存在的账户」红字；
    // 账户有效才呼出密码/验证码凭证组（loginAccountValid 门控）
    const exists = !!data.exists;
    loginAccountValid = exists;
    hint.textContent = !exists ? UI.LOGIN_ACCOUNT_MISSING
      : data.role === 'teacher' ? UI.HINT_ROLE_TEACHER
      : data.role === 'student' ? UI.HINT_ROLE_STUDENT : UI.HINT_ROLE_ADMIN;
    hint.classList.toggle('login-hint--missing', !exists);
    syncLoginCredGroups();
  } catch { /* 网络抖动：静默不给提示 */ }
}

// 同步凭证组显示：账户有效 → 按当前模式（密码/验证码）显示对应组 + 启用登录按钮；
// 无效 → 全隐藏 + 登录按钮灰置（审查补丁：原只切凭证组，登录按钮常显可点，用户未确认账户
// 也显示可提交，与「账户有效后显示密码框 + 登录按钮」需求不符）
function syncLoginCredGroups() {
  const pw = document.getElementById('login-password-group');
  const cd = document.getElementById('login-code-group');
  const btn = document.getElementById('login-submit');
  if (!loginAccountValid) {
    if (pw) pw.classList.add('hidden');
    if (cd) cd.classList.add('hidden');
    if (btn) { btn.disabled = true; btn.classList.add('disabled'); }
    return;
  }
  if (btn) { btn.disabled = false; btn.classList.remove('disabled'); }
  const codeMode = loginMode === 'code';
  if (pw) pw.classList.toggle('hidden', codeMode);
  if (cd) cd.classList.toggle('hidden', !codeMode);
}

// 页脚小字切换：密码登录 ↔ 验证码登录（用户名账户无验证码通道 → 提示并留在密码模式）
function toggleLoginMode(e) {
  if (e) e.preventDefault();
  if (!loginAccountValid) return; // 账户未确认前不切换（凭证组未呼出）
  const next = loginMode === 'code' ? 'password' : 'code';
  if (next === 'code') {
    // v0.26.14 L1：判型收口 classifyIdentifier（与服务端 classifyIdentifier 同语义）——
    // 原 validatePhone 只认带 +86 前缀，裸大陆号被误判为 username 拦下验证码登录（用户实证）。
    const ident = (document.getElementById('login-identifier') || {}).value || '';
    const kind = classifyIdentifier(ident);
    if (kind !== 'phone' && kind !== 'email') {
      showToast('用户名账户请使用密码登录', 'error');
      return;
    }
  }
  loginMode = next;
  const link = document.getElementById('login-switch-mode');
  if (link) link.textContent = next === 'code' ? UI.LOGIN_SWITCH_PASSWORD : UI.LOGIN_SWITCH_CODE;
  syncLoginCredGroups();
}

// v0.26.0 五合一登录提交：密码模式（账密/手机密码/邮箱密码）与验证码模式（手机验证码/邮箱验证码）
// C2 敏感操作门禁：按下「登录」先过一次拼图真人验证，通过后才真正发登录请求（非自动登录须验证）
async function handleLogin(e) {
  e.preventDefault();
  const identifier = document.getElementById('login-identifier').value.trim();
  if (!identifier) { showToast(UI.LOGIN_IDENTIFIER_PLACEHOLDER, 'error'); return; }
  // 账户未确认（按钮灰置）时的兜底：补跑一次探测再判——disabled 拦截的是正常点击/多数浏览器
  // 的 Enter 隐式提交，此守卫防个别浏览器在禁用提交按钮下仍隐式提交绕过门控（审查补丁）
  if (!loginAccountValid) {
    await checkLoginUsername();
    if (!loginAccountValid) { showToast(UI.LOGIN_ACCOUNT_MISSING, 'error'); return; }
  }
  if (loginMode === 'code' && !(document.getElementById('login-code') || {}).value) {
    showToast(UI.CODE_PLACEHOLDER, 'error');
    return;
  }
  if (loginMode !== 'code' && !(document.getElementById('login-password') || {}).value) {
    showToast(UI.LOGIN_REQUIRED, 'error');
    return;
  }
  withCaptcha(() => doLogin(identifier));
}

async function doLogin(identifier) {
  const btn = document.getElementById('login-submit');
  const remember = !!(document.getElementById('login-remember') && document.getElementById('login-remember').checked);
  try {
    btnLoading(btn, UI.LOADING_LOGIN);
    let data;
    if (loginMode === 'code') {
      const code = document.getElementById('login-code').value.trim();
      data = await api('/api/auth/login/code', { method: 'POST', body: { identifier, code, deviceId: getDeviceId() } });
    } else {
      const password = document.getElementById('login-password').value;
      data = await api('/api/auth/login', { method: 'POST', body: { identifier, password, deviceId: getDeviceId() } });
    }
    state.user = data.user; state.authToken = data.authToken || null;
    saveSession(remember); // 会话持久化（绝不存明文密码）
    afterAuthSuccess();
  } catch (err) {
    showToast(err.message, 'error'); // v0.25.99：校验/错误提示走底部 Toast
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

  if (password !== password2) {
    showToast(UI.VALIDATE_PASSWORD_MISMATCH, 'error'); // v0.25.99：校验提示走底部 Toast
    return;
  }
  // 需求三十（v0.25.47）：注册须勾选同意用户协议与隐私政策（两行轻量勾选；服务端同款强校验，双保险）
  const agreeAgreement = document.getElementById('agree-agreement') && document.getElementById('agree-agreement').checked;
  const agreePrivacy = document.getElementById('agree-privacy') && document.getElementById('agree-privacy').checked;
  if (!agreeAgreement || !agreePrivacy) {
    showToast(UI.AGREE_REQUIRED, 'error');
    return;
  }
  if (role === 'teacher' && !APP_CONSTANTS.INVITE_GATE_DORMANT) {
    if (!state.validatedInviteCode) {
      showToast(UI.VALIDATE_INVITE_FIRST, 'error');
      showView('invite-gate');
      return;
    }
  }
  // C2 敏感操作门禁：按下「注册」先过一次拼图真人验证，通过后才真正发注册请求
  withCaptcha(() => doRegister(username, password, role, agreeAgreement, agreePrivacy));
}

async function doRegister(username, password, role, agreeAgreement, agreePrivacy) {
  try {
    const btn = document.getElementById('register-submit');
    btnLoading(btn, UI.LOADING_REGISTER);
    const body = { username, password, role, deviceId: getDeviceId(), agreeAgreement, agreePrivacy };
    if (role === 'teacher' && state.validatedInviteCode) body.inviteCode = state.validatedInviteCode;
    const data = await api('/api/auth/register', { method: 'POST', body });
    state.user = data.user; state.authToken = data.authToken || null;
    if (role === 'teacher') state.validatedInviteCode = null; // 请求成功后清（网络失败保留，重试免重验；原提前清空致失败即需重验）
    saveSession(false); // 注册即登录：会话存 sessionStorage（刷新保留，关标签即焚）
    afterAuthSuccess();
  } catch (err) {
    showToast(err.message, 'error');
  } finally {
    const btn = document.getElementById('register-submit');
    btnDone(btn, UI.BTN_REGISTER);
  }
}

async function validateInviteAndRegister() {
  const code = document.getElementById('invite-code-input').value.trim();

  if (!code) { showToast(UI.VALIDATE_INVITE_REQUIRED, 'error'); return; }

  // 这里只做格式校验，真正的验证在注册时进行
  if (code.length !== CONFIG.INVITE_CODE_LEN) {
    showToast(UI.VALIDATE_INVITE_LENGTH, 'error'); // 8 位
    return;
  }

  // 保存验证过的邀请码，跳转到注册表单
  state.validatedInviteCode = code;
  showToast(UI.SUCCESS_INVITE_CONFIRMED, 'success');

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
  closeAllModals(); // v0.25.98：登出彻底清弹窗栈（清栈+清容器，不恢复任何下层）
  showView('landing');
}

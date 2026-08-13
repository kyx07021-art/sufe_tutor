/**
 * 验证码组件包（v0.26.0 B2/B3/B6）—— 手机号+验证码 / 邮箱+验证码 输入组件 + 绑定浮窗
 *
 * 同步加载（登录页与设置页共用，见 index.html 加载序：app-ui.js 之后）。
 * 地区前缀表单源 CONFIG.PHONE_REGIONS（与后端 server/otp.js 同读，杜绝双源漂移）。
 *
 * id 约定（组件内联 onclick 依赖）：prefix + '-phone' / '-email' / '-code'（验证码输入）/
 * '-send'（发送按钮）。绑定浮窗 prefix='bind'；登录页验证码 prefix='login'。
 * 手机号前缀 v0.26.15 收敛大陆单区：固定 +86（PHONE_REGIONS 仅 +86，无地区 select），
 * 目标恒为 '+86' + 号码；服务端 normalizeIdentifier 对裸大陆号补 +86 同口径。
 *
 * B6 内测短路：requestOtpCode 成功后若响应带 mockCode → toast「模拟验证码（内测期使用）：xxxxxx」
 * （后端 OTP_PROVIDER='mock'，见 server/otp.js；生产拆掉短路后无 mockCode，不弹 toast）。
 */

// ============================================================
// 前端格式校验（与服务端 validateOtpTarget 同口径，双保险）
// ============================================================
function validatePhone(target) {
  const s = String(target || '').trim();
  return CONFIG.PHONE_REGIONS.some(r => s.startsWith(r.prefix) && r.pattern.test(s.slice(r.prefix.length)));
}
function validateEmail(s) {
  return /^[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}$/.test(String(s || '').trim());
}
/** 登录唯一输入框判型（v0.26.14 L1）——与服务端 server/otp.js classifyIdentifier 同语义，杜绝口径漂移：
 * 含 @ → email；带地区前缀合法号或裸大陆号（后端 normalizeIdentifier 自动补 +86）→ phone；否则 username。
 * 背景：登录页唯一输入框无地区前缀选择器，用户直接输裸大陆号（如 138xxxxxxxx）是正常预期，
 * 前端若只认带前缀会把裸号误判为 username → 拦下验证码登录（用户实证，勿回退）。
 * @returns {'username'|'phone'|'email'|null}
 */
function classifyIdentifier(identifier) {
  const s = String(identifier || '').trim();
  if (!s) return null;
  if (s.includes('@')) return 'email';
  if (validatePhone(s)) return 'phone';
  const cn = CONFIG.PHONE_REGIONS.find(r => r.prefix === '+86');
  if (cn && cn.pattern.test(s)) return 'phone'; // 裸大陆号：服务端补 +86 后按手机号处理
  return 'username';
}

// ============================================================
// 输入组件 HTML（label + 输入；验证码为输入框内右缘小按钮，不占左半边输入区）
// ============================================================
function phoneFieldHtml({ prefix = 'bind', label = UI.PHONE_LABEL } = {}) {
  // v0.26.15：前缀选项连根移除（用户拍板：只说支持大陆手机号）——输入框直接输大陆号，
  // 提交时前端补 '+86'（requestOtpCode/submitBind），后端 normalizeIdentifier 对裸号亦补 +86 双保险。
  return `<div class="form-group">
    <label class="form-label">${label}</label>
    <input type="tel" class="form-input" id="${prefix}-phone" placeholder="${UI.PHONE_PLACEHOLDER}" inputmode="tel" autocomplete="tel">
  </div>`;
}
function emailFieldHtml({ prefix = 'bind', label = UI.EMAIL_LABEL } = {}) {
  return `<div class="form-group">
    <label class="form-label">${label}</label>
    <input type="email" class="form-input" id="${prefix}-email" placeholder="${UI.EMAIL_PLACEHOLDER}" inputmode="email" autocomplete="email">
  </div>`;
}
function codeFieldHtml({ prefix = 'bind', channel = 'sms', label = UI.CODE_LABEL } = {}) {
  return `<div class="form-group">
    <label class="form-label">${label}</label>
    <div class="code-input-wrap">
      <input type="text" class="form-input" id="${prefix}-code" placeholder="${UI.CODE_PLACEHOLDER}" inputmode="numeric" autocomplete="one-time-code" maxlength="6">
      <button type="button" class="btn btn-sm code-send-btn glass glass--pressable" id="${prefix}-send" onclick="requestOtpCode('${prefix}', '${channel}')">${UI.CODE_SEND}</button>
    </div>
  </div>`;
}

// ============================================================
// 请求验证码（B6 模拟短路 + B1 60s 倒计时复用）
// ============================================================
async function requestOtpCode(prefix, channel) {
  const sendBtn = document.getElementById(`${prefix}-send`);
  const codeEl = document.getElementById(`${prefix}-code`);
  if (!sendBtn || sendBtn.disabled) return; // 倒计时中不重复请求
  // 组装目标：sms = 固定 +86 前缀 + 大陆手机号（v0.26.15 大陆单区）；email = 邮箱
  let target = '';
  if (prefix === 'login') {
    // 登录页特例：目标来自唯一输入框 login-identifier（用户名/手机号/邮箱），channel 按格式推断。
    // v0.26.16 修（外部审查补漏）：原 validatePhone 门控要求 +86 前缀，裸大陆号在「发送验证码」一步
    // 被拦——toggleLoginMode 已放行裸号切到验证码模式（classifyIdentifier→phone），此处再拦即
    // 「切一段留一段」，用户实证场景最终登录目标不可达。改 classifyIdentifier + 前端 normalize
    // （裸大陆号补 +86），与后端 server/otp.js normalizeIdentifier 同语义。
    const ident = ((document.getElementById('login-identifier') || {}).value || '').trim();
    const kind = classifyIdentifier(ident);
    if (kind === 'email') { channel = 'email'; target = ident; }
    else if (kind === 'phone') {
      channel = 'sms';
      target = ident.startsWith('+') ? ident : '+86' + ident;
    } else { showToast(UI.CRED_IDENT_INVALID, 'error'); return; }
  } else if (channel === 'email') {
    const el = document.getElementById(`${prefix}-email`);
    target = el ? el.value.trim() : '';
  } else {
    // v0.26.15：前缀选项连根移除，目标恒为 '+86' + 号码（输入框只输大陆号）
    const el = document.getElementById(`${prefix}-phone`);
    target = '+86' + (el ? el.value.trim() : '');
  }
  if (!target) { showToast(channel === 'email' ? UI.EMAIL_PLACEHOLDER : UI.PHONE_PLACEHOLDER, 'error'); return; }
  const valid = channel === 'email' ? validateEmail(target) : validatePhone(target);
  if (!valid) {
    showToast(channel === 'email' ? UI.CRED_FORMAT_EMAIL : UI.CRED_FORMAT_PHONE, 'error');
    return;
  }
  sendBtn.disabled = true; // 立即灰化防连点（后端 60s 原子限频兜底）
  try {
    const data = await api('/api/auth/otp/request', {
      method: 'POST',
      body: { channel: channel === 'email' ? 'email' : 'sms', target },
    });
    // B6 内测短路：mock 提供方返回模拟验证码 → toast 给用户（生产接入真实短信/邮件后无 mockCode）
    if (data.mockCode) showToast(UI.OTP_MOCK_TOAST.replace('{code}', data.mockCode), 'info');
    if (codeEl) codeEl.focus();
    bindCountdown(sendBtn, { endAt: Date.now() + CONFIG.OTP_RESEND_SEC * 1000, runningText: UI.CODE_SEND_AGAIN });
  } catch (err) {
    sendBtn.disabled = false;
    showToast(err.message, 'error');
  }
}

// ============================================================
// 绑定浮窗（B3）：手机号+验证码做成一般门控浮窗（未来可复用为任意需手机验证码确认的操作）；
// 邮箱绑定复制同流程，但不注册为门控浮窗模板（用户：除登录外其他门控保持简单，就手机号+验证码）。
// ============================================================
function openPhoneBindModal() {
  openModal({
    title: UI.BIND_PHONE_TITLE,
    cls: 'modal--bind',
    body: phoneFieldHtml({ prefix: 'bind' }) + codeFieldHtml({ prefix: 'bind', channel: 'sms' }),
    footer: `<button type="button" class="btn btn-outline glass glass--pressable" onclick="closeModal()">${UI.BTN_CANCEL}</button>
      <button type="button" class="btn glass glass--pressable" onclick="submitBind('phone')">${UI.BTN_BIND}</button>`,
  });
  // v0.26.15：无地区前缀 select，不再需要 initCustomSelects 包装（删除后无下拉组件）
}

function openEmailBindModal() {
  openModal({
    title: UI.BIND_EMAIL_TITLE,
    cls: 'modal--bind',
    body: emailFieldHtml({ prefix: 'bind' }) + codeFieldHtml({ prefix: 'bind', channel: 'email' }),
    footer: `<button type="button" class="btn btn-outline glass glass--pressable" onclick="closeModal()">${UI.BTN_CANCEL}</button>
      <button type="button" class="btn glass glass--pressable" onclick="submitBind('email')">${UI.BTN_BIND}</button>`,
  });
}

async function submitBind(kind) {
  const isPhone = kind === 'phone';
  let target = '';
  if (isPhone) {
    // v0.26.15：前缀选项连根移除，目标恒为 '+86' + 号码（输入框只输大陆号）
    const el = document.getElementById('bind-phone');
    target = '+86' + (el ? el.value.trim() : '');
    if (!validatePhone(target)) { showToast(UI.CRED_FORMAT_PHONE, 'error'); return; }
  } else {
    const el = document.getElementById('bind-email');
    target = el ? el.value.trim() : '';
    if (!validateEmail(target)) { showToast(UI.CRED_FORMAT_EMAIL, 'error'); return; }
  }
  const code = document.getElementById('bind-code');
  if (!code || !code.value.trim()) { showToast(UI.CODE_PLACEHOLDER, 'error'); return; }
  // C2 敏感操作门禁：确认绑定前先过一次拼图真人验证，通过才真正发绑定请求
  withCaptcha(() => doBind(kind, isPhone, target, code.value.trim()));
}

async function doBind(kind, isPhone, target, code) {
  try {
    const btn = document.querySelector('#modal-container .modal-footer .btn:not(.btn-outline)');
    btnLoading(btn, UI.BTN_BIND);
    const r = await api(`/api/auth/${isPhone ? 'phone' : 'email'}/bind`, {
      method: 'POST',
      body: isPhone ? { phone: target, code } : { email: target, code },
    });
    showToast(r.message || '绑定成功', 'success');
    closeModal();
    // B5 修复（用户反馈：绑定后先闪「未绑定」再更新为缩略）：原 enterAccountSettings 整页重渲染
    // 会重置行占位「未绑定」→ 再异步 loadMyCreds 才更新。改为本地立即用 bind 接口返回的脱敏值
    // 更新目标行（防闪烁），后台 loadMyCreds 只做确认不重置占位。
    const mask = isPhone ? (r.phone || '') : (r.email || '');
    if (mask) {
      const el = document.getElementById(isPhone ? 'settings-phone-val' : 'settings-email-val');
      if (el) el.textContent = mask;
    }
    if (typeof invalidate === 'function') invalidate('account'); // B6：creds 缓存作废，loadMyCreds 拉新
    if (typeof loadMyCreds === 'function') loadMyCreds();
  } catch (err) {
    showToast(err.message, 'error');
  }
}

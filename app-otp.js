/**
 * 验证码组件包（v0.26.0 B2/B3/B6）—— 手机号+验证码 / 邮箱+验证码 输入组件 + 绑定浮窗
 *
 * 同步加载（登录页与设置页共用，见 index.html 加载序：app-ui.js 之后）。
 * 地区前缀表单源 CONFIG.PHONE_REGIONS（与后端 server/otp.js 同读，杜绝双源漂移）。
 *
 * id 约定（组件内联 onclick 依赖）：prefix + '-prefix'（地区 select）/ '-phone' / '-email' /
 * '-code'（验证码输入）/ '-send'（发送按钮）。绑定浮窗 prefix='bind'；登录页验证码 prefix='login'。
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

// ============================================================
// 输入组件 HTML（label + 输入；验证码为输入框内右缘小按钮，不占左半边输入区）
// ============================================================
function phoneFieldHtml({ prefix = 'bind', label = UI.PHONE_LABEL } = {}) {
  const options = CONFIG.PHONE_REGIONS.map(r =>
    `<option value="${r.prefix}"${r.prefix === '+86' ? ' selected' : ''}>${r.prefix} ${r.name}</option>`).join('');
  return `<div class="form-group">
    <label class="form-label">${label}</label>
    <div class="phone-input-row">
      <select class="form-select phone-prefix-select" id="${prefix}-prefix">${options}</select>
      <input type="tel" class="form-input" id="${prefix}-phone" placeholder="${UI.PHONE_PLACEHOLDER}" inputmode="tel" autocomplete="tel">
    </div>
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
  // 组装目标：sms = 地区前缀 + 手机号；email = 邮箱
  let target = '';
  if (prefix === 'login') {
    // 登录页特例：目标来自唯一输入框 login-identifier（用户名/手机号/邮箱），channel 按格式推断
    const ident = ((document.getElementById('login-identifier') || {}).value || '').trim();
    channel = validateEmail(ident) ? 'email' : 'sms';
    if (validateEmail(ident)) target = ident;
    else if (validatePhone(ident)) target = ident.startsWith('+') ? ident : '+86' + ident; // 裸手机号补 +86
    else { showToast('请输入有效的手机号或邮箱', 'error'); return; }
  } else if (channel === 'email') {
    const el = document.getElementById(`${prefix}-email`);
    target = el ? el.value.trim() : '';
  } else {
    const sel = document.getElementById(`${prefix}-prefix`);
    const el = document.getElementById(`${prefix}-phone`);
    target = (sel ? sel.value : '+86') + (el ? el.value.trim() : '');
  }
  if (!target) { showToast(channel === 'email' ? UI.EMAIL_PLACEHOLDER : UI.PHONE_PLACEHOLDER, 'error'); return; }
  const valid = channel === 'email' ? validateEmail(target) : validatePhone(target);
  if (!valid) {
    showToast(channel === 'email' ? '邮箱格式不正确' : '手机号格式不正确', 'error');
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
  initCustomSelects(document.getElementById('modal-container')); // 地区前缀下拉包装
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
    const sel = document.getElementById('bind-prefix');
    const el = document.getElementById('bind-phone');
    target = (sel ? sel.value : '+86') + (el ? el.value.trim() : '');
    if (!validatePhone(target)) { showToast('手机号格式不正确', 'error'); return; }
  } else {
    const el = document.getElementById('bind-email');
    target = el ? el.value.trim() : '';
    if (!validateEmail(target)) { showToast('邮箱格式不正确', 'error'); return; }
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
    if (typeof loadMyCreds === 'function') loadMyCreds();
  } catch (err) {
    showToast(err.message, 'error');
  }
}

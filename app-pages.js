// ============================================================
// app-pages.js — 杂项页面模块（设置 / 关于 / 教师档案编辑 / 设备管理 / 注销 / 头像证件）
// ------------------------------------------------------------
// 模块职责：
//   账户设置页 enterAccountSettings（含外观主题切换 setThemePref）、登录设备管理
//   （loadDeviceSessions / renderDeviceRow / revokeDeviceSession）、注销账户
//   （openDeactivateModal / confirmDeactivateAccount）、头像上传与学信网截图
//   （handleAvatarUpload / 模块级 _profileCredential / renderProfileCredentialCtl /
//    handleCredentialPicked / viewProfileCredential）、退出登录二次确认
//   （confirmLogout）、关于平台（enterAbout）、教师档案编辑
//   （initProfileForm / loadProfile / handleSaveProfile）。
//   模块级残留（_profileCredential）经 registerLogoutReset 随登出统一复位。
//
// 加载序要求：须在共享层（app-state / app-api / app-anim / app-ui / app-onboard /
//   app-display）与 app-region 之后加载；app-posts 可随后加载（enterAbout 内
//   openFeedbackModal 仅以内联 onclick 引用，点击时经全局解析）。
//
// 依赖的共享全局：
//   app-state：state、UI、DISP、SUBJECTS、TEACHER_GRADES、GENDERS、CONFIG、
//     invalidate、registerLogoutReset、getThemePref
//   app-api：api
//   app-anim：showToast、initReveals
//   app-ui：escHtml、fmtDateTime、renderAvatarHtml、loaderHtml、openModal、
//     closeModal、openImageViewer、compressToDataURL、openConfirmModal、
//     reAuthModal、initCustomSelects、syncCustomSelectText
//   app-onboard：openOnboarding、openUsageGuide
//   app-region：renderProvinceSelect、onTeacherProvinceChange、
//     onTeacherSubjectsChange、renderTeacherGaokaoEditor、collectTeacherGaokao
//   handleLogout（app-auth）、renderSidebar（app-shell）、openFeedbackModal（app-posts）
// ============================================================

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
      ${modifiable ? `<button type="button" class="btn btn-outline btn-sm glass glass--pressable" onclick="showToast('${escJsStr(UI.TOAST_COMING_SOON)}')">${UI.BTN_MODIFY}</button>` : ''}
    </div>`;
  // 外观主题三项：选中态按 localStorage 现值标注，点按走 setThemePref 即时切换
  const themePref = getThemePref();
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
    ${s.current ? '' : `<button type="button" class="btn btn-outline btn-xs glass glass--pressable" onclick="revokeDeviceSession('${escJsStr(s.session_id)}')">${UI.BTN_DEVICE_LOGOUT}</button>`}
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
    style: `max-width:${CONFIG.MODAL_W_DEACTIVATE};`,
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
      setTimeout(handleLogout, CONFIG.REOPEN_DELAY_MS); // 让用户看到提示再退
    } catch (err) { showToast(err.message); }
  });
}

// 头像上传：居中取最大内切正方形缩放至 160px（圆形由 CSS border-radius 呈现），dataURL 落库
async function handleAvatarUpload(input) {
  const file = input.files && input.files[0];
  if (!file) return;
  if (!file.type.startsWith('image/')) { showToast(UI.POST_IMAGE_ONLY); return; }
  try {
    const url = await compressToDataURL(file, CONFIG.AVATAR_SIDE, CONFIG.AVATAR_QUALITY, true);
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
    _profileCredential = await compressToDataURL(file, CONFIG.CREDENTIAL_SIDE, CONFIG.CREDENTIAL_QUALITY, false);
    renderProfileCredentialCtl();
  } catch (err) { showToast(err.message); }
}
function viewProfileCredential() { if (_profileCredential) openImageViewer(_profileCredential); }

// 退出登录二次确认（确认类弹窗，保留点遮罩关闭）
function confirmLogout() {
  openModal({
    title: null,
    style: `max-width:${CONFIG.MODAL_W_CONFIRM};`,
    body: `<p style="margin-bottom:16px;">${UI.CONFIRM_LOGOUT}</p>`,
    footer: `<button type="button" class="btn btn-outline glass glass--pressable" onclick="closeModal()">${UI.BTN_CANCEL}</button>
          <button type="button" class="btn glass glass--pressable" onclick="closeModal();handleLogout()">${UI.BTN_LOGOUT}</button>`,
  });
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

// 模块级状态登出复位：登出时清空学信网截图暂存（防下次进入他人档案残留展示）
registerLogoutReset(() => { _profileCredential = null; });

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
                adminModalTeacher: null,
                myDemands: [], editingDemandId: null,
                inviteTimerId: null, currentInviteCode: null, validatedInviteCode: null };

// ============================================================
// 客户端配置：侧边栏栏目注册表
// 加栏目 = 这里加一条 + index.html 加一个 section[data-page] + 一个 enter 函数
// enter 引用的函数均为顶层声明，声明提升保证前向引用可用
// ============================================================
const ROLE_PAGES = {
  student: [
    { id: 'my-demands',      label: '我的需求',     enter: loadMyDemands },
    { id: 'browse-teachers', label: '浏览教师',     enter: loadTeachers },
    { id: 'my-chats',        label: '我的沟通',     enter: () => enterMyChats() },
  ],
  teacher: [
    { id: 'browse-demands',  label: '需求大厅',     enter: loadBrowseDemands },
    { id: 'resource-share',  label: '资料共享',     enter: () => enterResourceShare() },
    { id: 'my-chats',        label: '我的沟通',     enter: () => enterMyChats() },
    { id: 'edit-profile',    label: '编辑自身信息', enter: initProfileForm },
  ],
  admin: [
    { id: 'admin-stats',    label: '统计',     enter: loadAdminStats },
    { id: 'admin-students', label: '学生管理', enter: loadAdminStudents },
    { id: 'admin-teachers', label: '教师管理', enter: loadAdminTeachers },
    { id: 'admin-demands',  label: '需求管理', enter: loadAdminDemands },
    { id: 'admin-reviews',  label: '评价管理', enter: loadAdminReviews },
  ],
};

// 内联 onclick 里插值的字符串参数一律过此函数，防引号击穿
function escHtml(s) {
  return String(s ?? '').replace(/[&<>"']/g, c =>
    ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
}

// ============================================================
// API
// ============================================================
async function api(endpoint, options = {}) {
  const config = { headers: { 'Content-Type': 'application/json' }, ...options };
  if (config.body && typeof config.body === 'object') config.body = JSON.stringify(config.body);
  const res = await fetch(endpoint, config);
  const data = await res.json();
  if (!res.ok) throw new Error(data.error || '请求失败');
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
      : data.role === 'teacher' ? '教师账户'
      : data.role === 'student' ? '学生账户' : '管理员账户';
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
    el.innerHTML = `<div class="navbar-user">
      <span>${escHtml(u.username)}</span><span class="user-badge${u.role === 'admin' ? ' admin-badge' : ''}">${roleLabel}</span>
      <button class="btn btn-ghost btn-sm" onclick="handleLogout()">${UI.NAV_LOGOUT}</button></div>`;
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
}

function renderSidebar() {
  const u = state.user;
  const isAdmin = u.role === 'admin';
  const roleLabel = u.role === 'student' ? UI.ROLE_STUDENT : u.role === 'teacher' ? UI.ROLE_TEACHER : UI.ADMIN_BADGE;
  document.getElementById('sidebar-user').innerHTML = `
    <div class="sidebar-user-name">${escHtml(u.username)}</div>
    <div class="sidebar-user-meta">
      <span class="user-badge${isAdmin ? ' admin-badge' : ''}">${roleLabel}</span>
    </div>`;
  document.getElementById('sidebar-nav').innerHTML = pagesForRole().map((p, i) => `
    <button type="button" class="sidebar-item" data-page="${p.id}" onclick="selectPage('${p.id}')">
      <span class="sidebar-item-index" aria-hidden="true">${String(i + 1).padStart(2, '0')}</span><span>${p.label}</span>
    </button>`).join('');
  document.getElementById('sidebar-invite').classList.toggle('hidden', !isAdmin);
}

function selectPage(pageId) {
  document.querySelectorAll('#client-main .client-page').forEach(s =>
    s.classList.toggle('hidden', s.dataset.page !== pageId));
  document.querySelectorAll('#sidebar-nav .sidebar-item').forEach(b =>
    b.classList.toggle('active', b.dataset.page === pageId));
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
  return `<div class="modal-overlay" onclick="if(event.target===this)closeModal()">
    <div class="modal">
      <div class="modal-header"><h2>${demand ? '编辑学生需求' : '提交学生需求'}</h2><button class="btn btn-ghost btn-icon" onclick="closeModal()">✕</button></div>
      <div class="modal-body">
        <div id="demand-alert"></div>
        <form onsubmit="handleSubmitDemand(event)" id="demand-form">
          <div class="form-group">
            <label class="form-label">省份 <span class="req">*</span></label>
            <span id="d-province-wrap"></span>
            <div id="d-region-note"></div>
          </div>
          <div class="form-group">
            <label class="form-label">学生年级 <span class="req">*</span></label>
            <select class="form-select" id="d-grade" required onchange="updateDemandSubjects()">
              <option value="">请选择</option>${STUDENT_GRADES.map(g=>`<option value="${g.id}">${g.name}</option>`).join('')}
            </select>
          </div>
          <div class="form-group">
            <label class="form-label">学生性别 <span class="req">*</span></label>
            <select class="form-select" id="d-gender" required>
              <option value="">请选择</option>${GENDERS.map(g=>`<option value="${g.id}">${g.name}</option>`).join('')}
            </select>
          </div>
          <div class="form-group">
            <label class="form-label">目标科目 <span class="req">*</span>（可多选）</label>
            <div class="checkbox-grid" id="d-subjects">${SUBJECTS.map(s=>`
              <label class="checkbox-item"><input type="checkbox" value="${s.id}">${s.name}</label>
            `).join('')}</div>
          </div>
          <div class="form-group" id="d-scores-wrap">
            <label class="form-label">各科当前大概成绩</label>
            <div id="d-scores"><p class="text-sm text-muted">请先选择目标科目</p></div>
          </div>
          <div class="form-group">
            <label class="form-label">期望教学方式 <span class="req">*</span></label>
            <select class="form-select" id="d-method" required onchange="toggleAddressField()">
              ${TEACHING_METHODS.map(m=>`<option value="${m.id}">${m.name}</option>`).join('')}
            </select>
          </div>
          <div id="d-address-section">
            <div class="form-group">
              <label class="form-label">地址 <span class="req">*</span></label>
              <input type="text" class="form-input" id="d-address" placeholder="上海市xx区xx路（精确门牌号请后续自行与教师沟通）">
            </div>
          </div>
          <div class="form-group">
            <label class="form-label">预算区间（元/小时）</label>
            <div style="display:flex;gap:var(--s3);align-items:center;">
              <input type="number" class="form-input" id="d-budget-min" placeholder="最低" min="0" step="10" style="flex:1;">
              <span class="text-muted">~</span>
              <input type="number" class="form-input" id="d-budget-max" placeholder="最高" min="0" step="10" style="flex:1;">
            </div>
          </div>
          <div class="form-divider"></div>
          <div class="form-group">
            <label class="form-label">提交者身份 <span class="req">*</span></label>
            <select class="form-select" id="d-submitter" required>
              <option value="parent">家长</option><option value="student">学生</option>
            </select>
          </div>
          <div class="form-group">
            <label class="form-label">家长联系方式 <span class="req">*</span></label>
            <input type="text" class="form-input" id="d-parent-contact" placeholder="手机号或邮箱" required>
          </div>
          <div class="form-group">
            <label class="form-label">学生联系方式 <span class="req">*</span></label>
            <input type="text" class="form-input" id="d-student-contact" placeholder="手机号或邮箱" required>
          </div>
          <div class="form-group">
            <label class="form-label">其他补充信息</label>
            <textarea class="form-input" id="d-info" rows="3" placeholder="上课时间偏好、特殊要求等"></textarea>
          </div>
          <div class="modal-footer">
            ${demand ? `<button type="button" class="btn btn-danger btn-sm modal-footer-start" onclick="confirmDeleteDemand(${demand.id})">${UI.BTN_DELETE_DEMAND}</button>` : ''}
            <button type="button" class="btn btn-outline" onclick="closeModal()">取消</button>
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
    el.innerHTML = '<p class="text-sm text-muted">请先选择省份和年级</p>';
    document.getElementById('d-scores').innerHTML = '';
    return;
  }
  el.innerHTML = buildStudentSubjectsHtml(prov, grade);
  updateDemandScores();
}

// 平时成绩行：app-region.js 按省份等第制渲染「等第制/分数制」双页签
function updateDemandScores() {
  const prov = document.getElementById('d-province').value;
  const grade = document.getElementById('d-grade').value;
  const checked = [...document.querySelectorAll('#d-subjects input:checked')].map(cb => cb.value);
  const el = document.getElementById('d-scores');
  if (!prov || !grade) { el.innerHTML = ''; return; }
  if (!checked.length) { el.innerHTML = '<p class="text-sm text-muted">请先选择目标科目</p>'; return; }
  el.innerHTML = buildStudentScoreRows(prov, grade, checked);
}

async function handleSubmitDemand(e) {
  e.preventDefault();
  const alertEl = document.getElementById('demand-alert');
  const province = document.getElementById('d-province').value;
  if (!province) { alertEl.innerHTML = `<div class="alert alert-error">请选择省份</div>`; return; }
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

  el.innerHTML = teachers.map(t => {
    const grade = TEACHER_GRADES.find(g=>g.id===t.grade)?.name || t.grade || '';
    const gender = GENDERS.find(g=>g.id===t.gender)?.name || '';
    const provName = (typeof SUFE_REGIONS !== 'undefined' && t.province) ? SUFE_REGIONS.provinceName(t.province) : '';
    const meta = [provName, grade, gender, `${t.price||'?'}${UI.PRICE_UNIT}`].filter(Boolean).join(' · ');
    const rows = renderSubjectScoreRows(t);

    return `<div class="list-card list-card--teacher">
      <div class="teacher-card-main">
        <div class="list-card-header">
          <span class="list-card-title">${escHtml(t.username)}<span class="teacher-rating">${renderStars(t.rating)}<b>${(t.rating||4).toFixed(1)}</b></span></span>
          <span class="list-card-meta">${meta}</span>
        </div>
        ${rows ? `<div class="subject-block"><div class="section-title">擅长科目</div>${rows}</div>` : ''}
        <div class="list-card-contact">
          ${t.wechat ? `<span>${UI.CONTACT_WECHAT_PREFIX}${escHtml(t.wechat)}</span>` : ''}
          ${t.email ? `<span>${UI.CONTACT_EMAIL_PREFIX}${escHtml(t.email)}</span>` : ''}
        </div>
        <div class="list-card-actions">
          <button type="button" class="btn btn-outline btn-sm" onclick="openTeacherModal(${t.user_id})">${UI.BTN_VIEW_DETAIL}</button>
        </div>
      </div>
      <div class="teacher-photo" aria-hidden="true"></div>
    </div>`;
  }).join('');
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
    const data = await api(`/api/reviews?teacherUserId=${userId}`);
    const el = document.getElementById('teacher-modal-reviews');
    if (el) el.innerHTML = renderReviewItems(data.reviews || [], t, {}); // 防竞态：弹窗已关则丢弃
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
        ${rows ? `<div class="subject-block"><div class="section-title">擅长科目</div>${rows}</div>` : ''}
        ${(t.wechat || t.email) ? `<div class="subject-block"><div class="section-title">联系方式</div>
          ${t.wechat ? `<div class="subject-row"><span>微信</span><span class="subject-score">${escHtml(t.wechat)}</span></div>` : ''}
          ${t.email ? `<div class="subject-row"><span>邮箱</span><span class="subject-score">${escHtml(t.email)}</span></div>` : ''}
        </div>` : ''}
        <div class="subject-block" id="teacher-modal-reviews">
          <div class="section-title">评价</div>
          <p class="text-sm text-muted">加载中...</p>
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
  return `<div class="section-title">评价 (${reviews.length})</div>
    ${reviews.map(r => `<div class="review-item">
      <div class="review-header">
        <span class="review-author">${escHtml(r.reviewer_name || '')} ${renderStars(r.rating)} ${admin ? statusTag(r) : ''}</span>
        <span class="review-date">${r.created_at || ''}</span>
      </div>
      <div class="review-text">${escHtml(r.comment)}</div>
      ${admin ? `<div class="review-admin-actions">
        ${r.status === 'pending' ? `<button type="button" class="btn btn-accent btn-xs" onclick="adminReviewAction(${r.id},'approve',1)">${UI.BTN_APPROVE}</button>
        <button type="button" class="btn btn-outline btn-xs" onclick="adminReviewAction(${r.id},'reject',1)">${UI.BTN_REJECT}</button>` : ''}
        <button type="button" class="btn btn-danger btn-xs" onclick="confirmDeleteReview(${r.id},1)">${UI.BTN_DELETE_REVIEW}</button>
      </div>` : ''}
    </div>`).join('')}
    ${!reviews.length ? `<p class="text-sm text-muted">${UI.EMPTY_NO_REVIEWS}</p>` : ''}
    ${!admin && state.user && state.user.role === 'student' ? `
      <button type="button" class="btn btn-outline btn-sm mt-2" onclick="openReviewModal(${t.user_id})">写评价</button>
    ` : ''}`;
}

// ============================================================
// 评价 Modal
// ============================================================
function openReviewModal(teacherUserId, teacherName) {
  teacherName = teacherName ?? (state.allTeachers.find(x => x.user_id === teacherUserId)?.username || '');
  document.getElementById('modal-container').innerHTML = `<div class="modal-overlay" onclick="if(event.target===this)closeModal()">
    <div class="modal">
      <div class="modal-header"><h2>评价 ${teacherName}</h2><button class="btn btn-ghost btn-icon" onclick="closeModal()">✕</button></div>
      <div class="modal-body">
        <div id="review-alert"></div>
        <div class="form-group">
          <label class="form-label">评分 <span class="req">*</span></label>
          <div class="star-rating-input" id="review-stars">
            ${[1,2,3,4,5].map(i=>`<button class="star-btn" data-val="${i}" onclick="setReviewStars(${i})" type="button">★</button>`).join('')}
          </div>
          <input type="hidden" id="review-rating" value="0">
        </div>
        <div class="form-group">
          <label class="form-label">评价内容 <span class="req">*</span></label>
          <textarea class="form-input" id="review-comment" rows="4" placeholder="请分享你的体验..."></textarea>
        </div>
        <div class="modal-footer">
          <button class="btn btn-outline" onclick="closeModal()">取消</button>
          <button class="btn btn-primary" onclick="submitReview(${teacherUserId})">提交评价</button>
        </div>
      </div>
    </div>
  </div>`;
}

function setReviewStars(val) {
  document.getElementById('review-rating').value = val;
  document.querySelectorAll('#review-stars .star-btn').forEach(btn => {
    btn.classList.toggle('active', +btn.dataset.val <= val);
  });
}

async function submitReview(teacherUserId) {
  const rating = +document.getElementById('review-rating').value;
  const comment = document.getElementById('review-comment').value.trim();
  const alertEl = document.getElementById('review-alert');

  if (!rating) { alertEl.innerHTML = `<div class="alert alert-error">${UI.VALIDATE_SELECT_RATING}</div>`; return; }
  if (comment.length < 2) { alertEl.innerHTML = `<div class="alert alert-error">${UI.VALIDATE_COMMENT_TOO_SHORT}</div>`; return; }

  try {
    await api('/api/reviews', {
      method: 'POST',
      body: { teacherUserId, reviewerUserId: state.user.id, rating, comment },
    });
    closeModal();
    showToast(UI.SUCCESS_REVIEW_SUBMITTED);
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
  const provinceName = (typeof SUFE_REGIONS !== 'undefined' && d.province) ? SUFE_REGIONS.provinceName(d.province) : '';
  const subjNames = (d.target_subjects||[]).map(id => SUBJECTS.find(s=>s.id===id)?.name || id);
  const grade = STUDENT_GRADES.find(g=>g.id===d.student_grade)?.name || d.student_grade;
  const gender = GENDERS.find(g=>g.id===d.student_gender)?.name || '';
  const submitter = d.submitter_type === 'parent' ? UI.SUBMITTER_PARENT : UI.SUBMITTER_STUDENT;
  const method = TEACHING_METHODS.find(m=>m.id===d.teaching_method)?.name || '线下';
  // 教师视角：意向按钮四态（未提交 / 待处理 / 已建立联系 / 未获选），状态取自列表接口的 my_intent_status
  const teacherIntentBtn = !teacher ? ''
    : d.my_intent_status === 'accepted' ? '<button type="button" class="btn btn-sm btn-intent-ok" disabled>已建立联系</button>'
    : d.my_intent_status === 'pending'  ? '<button type="button" class="btn btn-sm btn-intent-wait" disabled>意向已提交</button>'
    : d.my_intent_status === 'rejected' ? '<button type="button" class="btn btn-sm btn-intent-wait" disabled>未获选</button>'
    : `<button type="button" class="btn btn-outline btn-sm" onclick="submitIntent(${d.id})">提交试课意向</button>`;
  const budget = (d.budget_min || d.budget_max)
    ? `${d.budget_min||'不限'}~${d.budget_max||'不限'}元/h` : '面议';

  const scoresHtml = (d.current_scores||[]).map(cs => {
    const n = SUBJECTS.find(s=>s.id===cs.subject)?.name || cs.subject;
    return `<span class="tag">${n}: ${cs.score||'?'}分/${cs.scale}分制</span>`;
  }).join('');

  return `<div class="list-card">
    <div class="list-card-header">
      <span class="list-card-title">${admin && d.username ? escHtml(d.username) + ' · ' : ''}${grade} · ${gender}</span>
      <span class="demand-card-tools">
        <span class="list-card-meta">${d.created_at||''}</span>
        ${teacherIntentBtn}
        ${editable ? `<button type="button" class="btn btn-outline btn-sm" onclick="openDemandModal(${d.id})">${UI.BTN_EDIT}</button>` : ''}
        ${admin ? `<button type="button" class="btn btn-danger btn-xs" onclick="confirmDeleteDemand(${d.id}, true)">${UI.BTN_REMOVE}</button>` : ''}
      </span>
    </div>
    <div class="list-card-body">
      ${provinceName ? `<span class="tag tag-accent">${provinceName}</span>` : ''}
      ${subjNames.map(n=>`<span class="tag tag-accent">${n}</span>`).join('')}
      <span class="tag">${method}</span>
      <span class="tag tag-warn">${budget}</span>
      <span class="tag">提交者: ${submitter}</span>
    </div>
    ${scoresHtml ? `<div class="list-card-detail" style="display:flex;flex-wrap:wrap;gap:var(--s2);margin-top:var(--s2);">${scoresHtml}</div>` : ''}
    ${d.address ? `<div class="list-card-detail">地址：${escHtml(d.address)}</div>` : ''}
    ${d.additional_info ? `<div class="list-card-detail">补充：${escHtml(d.additional_info)}</div>` : ''}
    <div class="demand-card-foot">
      <div class="list-card-contact">
        ${d.parent_contact ? `<span>家长: ${escHtml(d.parent_contact)}</span>` : ''}
        ${d.student_contact ? `<span>学生: ${escHtml(d.student_contact)}</span>` : ''}
      </div>
      ${editable ? `<button type="button" class="btn btn-outline btn-sm" onclick="toggleDemandIntents(${d.id})">试课意向 (${d.intent_count || 0}) <span class="intent-caret" id="intent-caret-${d.id}">▾</span></button>` : ''}
    </div>
    ${editable ? `<div class="intents-box" id="intents-box-${d.id}"><div class="intents-box-inner"></div></div>` : ''}
  </div>`;
}

async function loadDemandList(elId, { mine }) {
  const el = document.getElementById(elId);
  el.innerHTML = '<div class="empty-state"><p>加载中...</p></div>';
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
  } catch (err) {
    el.innerHTML = `<div class="empty-state"><p>${UI.ERROR_LOAD_PREFIX}${err.message}</p></div>`;
  }
}

function loadMyDemands()     { return loadDemandList('my-demands-list', { mine: true }); }
function loadBrowseDemands() { return loadDemandList('demands-list',    { mine: false }); }

// ============================================================
// 模块3：试课意向（教师提交 / 学生在需求内展开处理）
// ============================================================
async function submitIntent(demandId) {
  try {
    await api(`/api/demands/${demandId}/intents`, { method: 'POST', body: { userId: state.user.id } });
    showToast('试课意向已提交，等待学生处理');
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
      <div class="modal-header"><h2>档案不完整</h2><button type="button" class="btn btn-ghost btn-icon" onclick="closeModal()">✕</button></div>
      <div class="modal-body">
        <p class="text-sm" style="color:var(--ink-3);line-height:1.7;">提交试课意向前，请先完善教师档案：省份、年级、性别、擅长科目、报价均为必填。学生要看到完整的教师信息，才能判断是否接受你的意向。</p>
        <div class="modal-footer">
          <button type="button" class="btn btn-outline" onclick="closeModal()">稍后再说</button>
          <button type="button" class="btn btn-primary" onclick="closeModal();selectPage('edit-profile')">去完善档案</button>
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
  inner.innerHTML = '<div class="intents-box-content"><p class="text-sm text-muted">加载中...</p></div>';
  try {
    const data = await api(`/api/demands/${demandId}/intents`);
    const ts = data.teachers || [];
    // 缓存意向教师，供「查看」打开教师详情弹窗复用（openTeacherModal 第三数据源）
    ts.forEach(t => {
      state.intentTeachers = state.intentTeachers.filter(x => x.user_id !== t.user_id);
      state.intentTeachers.push(t);
    });
    const content = `<div class="section-title">试课意向 (${ts.length})</div>` +
      (ts.length ? ts.map(t => renderIntentTeacherRow(t, demandId)).join('')
                 : '<p class="text-sm text-muted">暂无教师意向</p>');
    inner.innerHTML = `<div class="intents-box-content">${content}</div>`;
    box.dataset.loaded = '1';
  } catch (err) {
    inner.innerHTML = `<div class="intents-box-content"><p class="text-sm text-muted">${UI.ERROR_LOAD_PREFIX}${err.message}</p></div>`;
  }
}

function renderIntentTeacherRow(t, demandId) {
  const st = t.intent_status;
  const tag = st === 'accepted' ? '<span class="tag tag-ok">已同意</span>'
    : st === 'rejected' ? '<span class="tag tag-danger">已拒绝</span>' : '<span class="tag tag-warn">待处理</span>';
  const provName = (typeof SUFE_REGIONS !== 'undefined' && t.province) ? SUFE_REGIONS.provinceName(t.province) : '';
  const viewBtn = `<button type="button" class="btn btn-outline btn-xs" onclick="openTeacherModal(${t.user_id})">查看</button>`;
  const actions = st === 'pending'
    ? `<button type="button" class="btn btn-accent btn-xs" onclick="resolveIntent(${t.intent_id},'accept',${demandId})">同意</button>
       <button type="button" class="btn btn-outline btn-xs" onclick="resolveIntent(${t.intent_id},'reject',${demandId})">拒绝</button>` : '';
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
    showToast(action === 'accept' ? '已同意，可在「我的沟通」中开始对话' : '已拒绝该意向');
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
  gradeEl.innerHTML = '<option value="">请选择</option>' + TEACHER_GRADES.map(g=>`<option value="${g.id}">${g.name}</option>`).join('');
  const genderEl = document.getElementById('profile-gender');
  genderEl.innerHTML = '<option value="">请选择</option>' + GENDERS.map(g=>`<option value="${g.id}">${g.name}</option>`).join('');

  const subjEl = document.getElementById('profile-subjects');
  subjEl.innerHTML = SUBJECTS.map(s=>`
    <label class="checkbox-item"><input type="checkbox" value="${s.id}">${s.name}</label>
  `).join('');
  // 高考成绩区改由省份驱动（app-region.js）：选省份后渲染锁定编辑器；科目勾选仅标记擅长科目
  document.getElementById('profile-gaokao-scores').innerHTML = `<p class="text-sm text-muted">请先选择省份（高考所在地），按该省政策填写高考成绩</p>`;
  loadProfile();
}

async function loadProfile() {
  try {
    const data = await api(`/api/teacher/profile?userId=${state.user.id}`);
    if (data.profile) {
      const p = data.profile;
      if (p.province) {
        document.getElementById('profile-province').value = p.province;
        document.getElementById('profile-gaokao-scores').innerHTML =
          renderTeacherGaokaoEditor(p.province, p.gaokao_scores || []);
      }
      document.getElementById('profile-grade').value = p.grade || '';
      document.getElementById('profile-gender').value = p.gender || '';
      document.getElementById('profile-price').value = p.price || '';
      document.getElementById('profile-wechat').value = p.wechat || '';
      document.getElementById('profile-email').value = p.email || '';
      if (p.subjects?.length) {
        p.subjects.forEach(id => {
          const cb = document.querySelector(`#profile-subjects input[value="${id}"]`);
          if (cb) cb.checked = true;
        });
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
  if (!province) { alertEl.innerHTML = `<div class="alert alert-error">请选择省份</div>`; return; }
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
  el.innerHTML = '<div class="empty-state"><p>加载中...</p></div>';
  try {
    const statsData = await api(`/api/admin/stats?username=${encodeURIComponent(state.user.username)}`);
    const s = statsData.stats;

    el.innerHTML = `
      <div class="stats-grid">
        <div class="stat-card"><div class="stat-value blue">${s.users.total}</div><div class="stat-label">总用户</div></div>
        <div class="stat-card"><div class="stat-value green">${s.users.students}</div><div class="stat-label">学生</div></div>
        <div class="stat-card"><div class="stat-value blue">${s.users.teachers}</div><div class="stat-label">教师</div></div>
        <div class="stat-card"><div class="stat-value amber">${s.demands}</div><div class="stat-label">需求数</div></div>
        <div class="stat-card"><div class="stat-value blue">${s.profiles}</div><div class="stat-label">教师档案</div></div>
        <div class="stat-card"><div class="stat-value green">${s.reviews.approved}</div><div class="stat-label">已通过评价</div></div>
        <div class="stat-card"><div class="stat-value amber">${s.reviews.pending}</div><div class="stat-label">待审评价</div></div>
        <div class="stat-card"><div class="stat-value red">${s.invites.used||0}</div><div class="stat-label">已用邀请码</div></div>
      </div>

      <div class="admin-panel">
        <h3>最近注册用户</h3>
        ${s.recentUsers.map(u => `<div style="display:flex;justify-content:space-between;padding:var(--s2) 0;border-bottom:1px solid var(--border-light);font-size:0.8125rem;">
          <span><strong>${escHtml(u.username)}</strong> <span class="tag">${u.role==='student'?'学生':u.role==='teacher'?'教师':'管理员'}</span></span>
          <span class="text-muted">${u.created_at||''}</span>
        </div>`).join('')}
      </div>

      <div class="admin-panel">
        <h3>最近需求</h3>
        ${s.recentDemands.map(d => `<div style="display:flex;justify-content:space-between;padding:var(--s2) 0;border-bottom:1px solid var(--border-light);font-size:0.8125rem;">
          <span><strong>${escHtml(d.username)}</strong> ${STUDENT_GRADES.find(g=>g.id===d.student_grade)?.name||''} ${d.target_subjects.map(id=>SUBJECTS.find(s=>s.id===id)?.name||'').join('、')}</span>
          <span class="text-muted">${d.created_at||''}</span>
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
  el.innerHTML = '<div class="empty-state"><p>加载中...</p></div>';
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
    ? `${TEACHER_GRADES.find(g => g.id === u.grade)?.name || '—'} · ${(u.rating || 4).toFixed(1)} 分 · ${u.price || '?'}${UI.PRICE_UNIT}`
    : `${u.demand_count || 0} 条需求`;
  return `<div class="admin-row">
    <div class="admin-row-main">
      <div class="admin-row-line">
        <strong>${escHtml(u.username)}</strong>
        ${u.banned ? `<span class="tag tag-danger">已封禁</span>` : ''}
      </div>
      <div class="admin-row-meta">${meta} · 注册于 ${u.created_at || ''}</div>
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
  el.innerHTML = '<div class="empty-state"><p>加载中...</p></div>';
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
  el.innerHTML = '<div class="empty-state"><p>加载中...</p></div>';
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
      <div class="admin-row-meta">${r.created_at || ''}</div>
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

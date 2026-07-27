/**
 * 上财家教平台 - 前端应用
 */

// ============================================================
// 常量（来自 constants.js）
// ============================================================
const { SUBJECTS, ELECTIVE, GRADE_LEVELS, STUDENT_GRADES,
        TEACHER_GRADES, GENDERS, SCORE_SCALES, TEACHING_METHODS,
        BUDGET_OPTIONS, UI } = APP_CONSTANTS;

// ============================================================
// 状态
// ============================================================
const state = { user: null, view: 'landing', allTeachers: [], inviteTimerId: null, currentInviteCode: null, validatedInviteCode: null };

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
// 视图管理
// ============================================================
const VIEWS = ['landing','login','register','invite-gate','student-dashboard','teacher-dashboard',
  'browse-teachers','browse-demands','edit-profile','admin-dashboard'];

function showView(name) {
  VIEWS.forEach(v => { const el = document.getElementById(`view-${v}`); if (el) el.classList.add('hidden'); });
  const target = document.getElementById(`view-${name}`);
  if (target) target.classList.remove('hidden');
  state.view = name;
  updateNavbar();

  if (name === 'browse-teachers') loadTeachers();
  if (name === 'browse-demands') loadDemands();
  if (name === 'edit-profile') initProfileForm();
  if (name === 'admin-dashboard') loadAdminDashboard();
}

function goHome() {
  if (state.user) {
    showView(state.user.role === 'student' ? 'student-dashboard' : 'teacher-dashboard');
  } else {
    showView('landing');
  }
}

function goBack() {
  if (state.user) {
    showView(state.user.role === 'student' ? 'student-dashboard' : 'teacher-dashboard');
  } else {
    showView('landing');
  }
}

function updateNavbar() {
  const el = document.getElementById('navbar-actions');
  if (state.user) {
    const role = state.user.role === 'student' ? UI.ROLE_STUDENT : UI.ROLE_TEACHER;
    const admin = state.user.isAdmin ? `<span class="user-badge admin-badge">${UI.ADMIN_BADGE}</span>` : '';
    el.innerHTML = `<div class="navbar-user">
      <span>${state.user.username}</span><span class="user-badge">${role}</span>${admin}
      <button class="btn btn-ghost btn-sm" onclick="handleLogout()">${UI.NAV_LOGOUT}</button></div>`;
  } else {
    el.innerHTML = `<button class="btn btn-ghost" onclick="showView('login')">${UI.NAV_LOGIN}</button>
      <button class="btn btn-primary btn-sm" onclick="showView('register')">${UI.NAV_REGISTER}</button>`;
  }
}

// ============================================================
// 认证
// ============================================================
function switchLoginRole(role) {
  document.querySelectorAll('#login-role-tabs .role-tab').forEach(t => t.classList.toggle('active', t.dataset.role === role));
}
function switchRegisterRole(role) {
  document.getElementById('register-role').value = role;
  document.querySelectorAll('#register-role-tabs .role-tab').forEach(t => t.classList.toggle('active', t.dataset.role === role));
  // 教师注册：先验证邀请码再填表
  if (role === 'teacher') {
    showView('invite-gate');
  }
}

function handleFeatureClick(role) {
  if (state.user) {
    showView(state.user.role === 'student' ? 'student-dashboard' : 'teacher-dashboard');
    return;
  }
  showView('login');
  switchLoginRole(role);
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
        user: data.user, password, expires: Date.now() + 7 * 24 * 3600 * 1000, // 7天
      }));
    } else {
      localStorage.removeItem('sufe_session');
    }

    // 检查管理员
    if (data.user.role === 'teacher') {
      showView('teacher-dashboard');
      if (data.user.isAdmin) document.getElementById('admin-section').classList.remove('hidden');
    } else if (data.user.isAdmin) {
      // 管理员以 student 角色登录，显示教师端 + 管理员面板
      state.user.role = 'teacher';
      showView('teacher-dashboard');
      document.getElementById('admin-section').classList.remove('hidden');
    } else {
      showView('student-dashboard');
    }
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
    showView(role === 'teacher' ? 'teacher-dashboard' : 'student-dashboard');
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
  state.user = null;
  localStorage.removeItem('sufe_session');
  document.getElementById('admin-section').classList.add('hidden');
  showView('landing');
}

// ============================================================
// 学生需求 Modal
// ============================================================
function openDemandModal() {
  document.getElementById('modal-container').innerHTML = renderDemandModal();
  initDemandForm();
}
function closeModal() { document.getElementById('modal-container').innerHTML = ''; }

function renderDemandModal() {
  return `<div class="modal-overlay" onclick="if(event.target===this)closeModal()">
    <div class="modal">
      <div class="modal-header"><h2>📚 提交学生需求</h2><button class="btn btn-ghost btn-icon" onclick="closeModal()">✕</button></div>
      <div class="modal-body">
        <div id="demand-alert"></div>
        <form onsubmit="handleSubmitDemand(event)" id="demand-form">
          <div class="form-group">
            <label class="form-label">学生年级 <span class="req">*</span></label>
            <select class="form-select" id="d-grade" required>
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
              <input type="text" class="form-input" id="d-address" placeholder="上海市xx区xx路xx弄">
            </div>
            <div class="form-group">
              <label class="form-label">详细门牌号（选填）</label>
              <input type="text" class="form-input" id="d-address-detail" placeholder="如：xx号xx室">
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
          <div class="modal-footer" style="padding:0;border:none;margin-top:var(--s6);">
            <button type="button" class="btn btn-outline" onclick="closeModal()">取消</button>
            <button type="submit" class="btn btn-primary" id="d-submit">提交需求</button>
          </div>
        </form>
      </div>
    </div>
  </div>`;
}

function initDemandForm() {
  document.getElementById('d-subjects').addEventListener('change', updateDemandScores);
  toggleAddressField(); // 初始化地址字段可见性
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

function updateDemandScores() {
  const checked = [...document.querySelectorAll('#d-subjects input:checked')].map(cb => cb.value);
  const el = document.getElementById('d-scores');
  if (!checked.length) { el.innerHTML = '<p class="text-sm text-muted">请先选择目标科目</p>'; return; }

  el.innerHTML = checked.map(sid => {
    const s = SUBJECTS.find(x => x.id === sid);
    return `<div class="score-row">
      <span class="score-subject">${s.name}</span>
      <span class="text-sm text-muted" style="margin-right:4px;">满分：</span>
      <div class="score-options">${SCORE_SCALES.map(sc => `
        <span class="score-option ${sc===s.maxScore?'selected':''}" onclick="pickScale(this)" data-sid="${sid}" data-sc="${sc}">${sc}分制</span>
      `).join('')}</div>
      <input type="number" class="score-inline" data-score-sid="${sid}" placeholder="分数" min="0" max="${s.maxScore}" style="margin-left:8px;">
    </div>`;
  }).join('');
}

function pickScale(el) {
  const row = el.closest('.score-row');
  row.querySelectorAll('.score-option').forEach(o => o.classList.remove('selected'));
  el.classList.add('selected');
  const input = row.querySelector('input[type="number"]');
  if (input) input.max = el.dataset.sc;
}

async function handleSubmitDemand(e) {
  e.preventDefault();
  const alertEl = document.getElementById('demand-alert');
  const subjects = [...document.querySelectorAll('#d-subjects input:checked')].map(cb => cb.value);
  if (!subjects.length) { alertEl.innerHTML = `<div class="alert alert-error">${UI.VALIDATE_SELECT_SUBJECT}</div>`; return; }

  const scores = subjects.map(sid => {
    const sel = document.querySelector(`.score-option.selected[data-sid="${sid}"]`);
    const inp = document.querySelector(`input[data-score-sid="${sid}"]`);
    return { subject: sid, scale: sel ? +sel.dataset.sc : SUBJECTS.find(s=>s.id===sid).maxScore, score: inp ? inp.value : '' };
  });

  try {
    const btn = document.getElementById('d-submit');
    btn.disabled = true; btn.innerHTML = '<span class="spinner"></span>';
    await api('/api/student/demands', {
      method: 'POST',
      body: { userId: state.user.id, demand: {
        student_grade: document.getElementById('d-grade').value,
        student_gender: document.getElementById('d-gender').value,
        target_subjects: subjects, current_scores: scores,
        teaching_method: document.getElementById('d-method').value,
        address: document.getElementById('d-address').value.trim(),
        address_detail: document.getElementById('d-address-detail').value.trim(),
        budget_min: +document.getElementById('d-budget-min').value,
        budget_max: +document.getElementById('d-budget-max').value,
        submitter_type: document.getElementById('d-submitter').value,
        parent_contact: document.getElementById('d-parent-contact').value.trim(),
        student_contact: document.getElementById('d-student-contact').value.trim(),
        additional_info: document.getElementById('d-info').value.trim(),
      }},
    });
    closeModal();
    showToast(UI.SUCCESS_DEMAND_SUBMITTED);
  } catch (err) {
    alertEl.innerHTML = `<div class="alert alert-error">${err.message}</div>`;
  } finally {
    const btn = document.getElementById('d-submit');
    if (btn) { btn.disabled = false; btn.textContent = UI.BTN_SUBMIT_DEMAND; }
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

function renderTeachers(teachers) {
  const el = document.getElementById('teachers-list');
  if (!teachers.length) { el.innerHTML = `<div class="empty-state"><p>${UI.EMPTY_NO_TEACHERS}</p></div>`; return; }

  el.innerHTML = teachers.map(t => {
    const subjNames = (t.subjects||[]).map(id => SUBJECTS.find(s=>s.id===id)?.name || id);
    const grade = TEACHER_GRADES.find(g=>g.id===t.grade)?.name || t.grade || '';
    const gender = GENDERS.find(g=>g.id===t.gender)?.name || '';
    const gaokaoHtml = (t.gaokao_scores||[]).map(gs => {
      const n = SUBJECTS.find(s=>s.id===gs.subject)?.name || gs.subject;
      return `<span class="tag">${n}: ${gs.score!==undefined ? gs.score+'分' : gs.grade||''}</span>`;
    }).join('');

    return `<div class="list-card">
      <div class="list-card-header">
        <span class="list-card-title">${t.username}</span>
        <span class="list-card-meta">${grade} · ${gender} · ${t.price||'?'}元/h</span>
      </div>
      <div class="list-card-body">
        ${subjNames.map(n=>`<span class="tag tag-primary">${n}</span>`).join('')}
        <span class="tag tag-star">${renderStars(t.rating)} ${(t.rating||4).toFixed(1)}</span>
      </div>
      ${gaokaoHtml ? `<div class="list-card-detail" style="display:flex;flex-wrap:wrap;gap:var(--s2);">${gaokaoHtml}</div>` : ''}
      <div class="list-card-contact">
        ${t.wechat ? `<span>${UI.CONTACT_WECHAT_PREFIX}${t.wechat}</span>` : ''}
        ${t.email ? `<span>${UI.CONTACT_EMAIL_PREFIX}${t.email}</span>` : ''}
      </div>
      <div class="list-card-actions">
        <button class="btn btn-outline btn-sm" onclick="loadTeacherDetail(${t.user_id},'${t.username}')">${UI.BTN_VIEW_DETAIL}</button>
      </div>
      <div id="teacher-detail-${t.user_id}"></div>
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

async function loadTeacherDetail(userId, username) {
  const el = document.getElementById(`teacher-detail-${userId}`);
  if (el.innerHTML) { el.innerHTML = ''; return; }

  try {
    const data = await api(`/api/reviews?teacherUserId=${userId}`);
    const reviews = data.reviews || [];

    el.innerHTML = `<div class="reviews-section">
      <h4>评价 (${reviews.length})</h4>
      ${reviews.map(r => `<div class="review-item">
        <div class="review-header">
          <span class="review-author">${r.reviewer_name} ${renderStars(r.rating)}</span>
          <span class="review-date">${r.created_at||''}</span>
        </div>
        <div class="review-text">${r.comment}</div>
      </div>`).join('')}
      ${!reviews.length ? `<p class="text-sm text-muted">${UI.EMPTY_NO_REVIEWS}</p>` : ''}
      ${state.user && state.user.role === 'student' ? `
        <button class="btn btn-outline btn-sm mt-2" onclick="openReviewModal(${userId},'${username}')">写评价</button>
      ` : ''}
    </div>`;
  } catch (err) {
    el.innerHTML = `<p class="text-sm text-muted">${UI.ERROR_LOAD_REVIEWS}</p>`;
  }
}

// ============================================================
// 评价 Modal
// ============================================================
function openReviewModal(teacherUserId, teacherName) {
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
        <div class="modal-footer" style="padding:0;border:none;">
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

// ============================================================
// 浏览需求
// ============================================================
async function loadDemands() {
  const el = document.getElementById('demands-list');
  try {
    const data = await api('/api/student/demands');
    const demands = data.demands || [];
    if (!demands.length) { el.innerHTML = `<div class="empty-state"><p>${UI.EMPTY_NO_DEMANDS}</p></div>`; return; }

    el.innerHTML = demands.map(d => {
      const subjNames = (d.target_subjects||[]).map(id => SUBJECTS.find(s=>s.id===id)?.name || id);
      const grade = STUDENT_GRADES.find(g=>g.id===d.student_grade)?.name || d.student_grade;
      const gender = GENDERS.find(g=>g.id===d.student_gender)?.name || '';
      const submitter = d.submitter_type === 'parent' ? UI.SUBMITTER_PARENT : UI.SUBMITTER_STUDENT;
      const method = TEACHING_METHODS.find(m=>m.id===d.teaching_method)?.name || '线下';
      const budget = (d.budget_min || d.budget_max)
        ? `${d.budget_min||'不限'}~${d.budget_max||'不限'}元/h` : '面议';

      const scoresHtml = (d.current_scores||[]).map(cs => {
        const n = SUBJECTS.find(s=>s.id===cs.subject)?.name || cs.subject;
        return `<span class="tag">${n}: ${cs.score||'?'}分/${cs.scale}分制</span>`;
      }).join('');

      return `<div class="list-card">
        <div class="list-card-header">
          <span class="list-card-title">${grade} · ${gender}</span>
          <span class="list-card-meta">${d.created_at||''}</span>
        </div>
        <div class="list-card-body">
          ${subjNames.map(n=>`<span class="tag tag-accent">${n}</span>`).join('')}
          <span class="tag">${method}</span>
          <span class="tag tag-warn">${budget}</span>
          <span class="tag">提交者: ${submitter}</span>
        </div>
        ${scoresHtml ? `<div class="list-card-detail" style="display:flex;flex-wrap:wrap;gap:var(--s2);margin-top:var(--s2);">${scoresHtml}</div>` : ''}
        ${d.address ? `<div class="list-card-detail">📍 ${d.address}${d.address_detail ? ' '+d.address_detail : ''}</div>` : ''}
        ${d.additional_info ? `<div class="list-card-detail">💬 ${d.additional_info}</div>` : ''}
        <div class="list-card-contact">
          ${d.parent_contact ? `<span>家长: ${d.parent_contact}</span>` : ''}
          ${d.student_contact ? `<span>学生: ${d.student_contact}</span>` : ''}
        </div>
      </div>`;
    }).join('');
  } catch (err) {
    el.innerHTML = `<div class="empty-state"><p>${UI.ERROR_LOAD_PREFIX}${err.message}</p></div>`;
  }
}

// ============================================================
// 教师档案编辑
// ============================================================
function initProfileForm() {
  const gradeEl = document.getElementById('profile-grade');
  gradeEl.innerHTML = '<option value="">请选择</option>' + TEACHER_GRADES.map(g=>`<option value="${g.id}">${g.name}</option>`).join('');
  const genderEl = document.getElementById('profile-gender');
  genderEl.innerHTML = '<option value="">请选择</option>' + GENDERS.map(g=>`<option value="${g.id}">${g.name}</option>`).join('');

  const subjEl = document.getElementById('profile-subjects');
  subjEl.innerHTML = SUBJECTS.map(s=>`
    <label class="checkbox-item"><input type="checkbox" value="${s.id}">${s.name}</label>
  `).join('');
  subjEl.addEventListener('change', () => updateGaokaoScores([]));
  document.getElementById('profile-gaokao-scores').innerHTML = `<p class="text-sm text-muted">${UI.LABEL_SELECT_HINT}</p>`;
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
      if (p.subjects?.length) {
        p.subjects.forEach(id => {
          const cb = document.querySelector(`#profile-subjects input[value="${id}"]`);
          if (cb) cb.checked = true;
        });
        updateGaokaoScores(p.gaokao_scores || []);
      }
    }
  } catch (err) { console.error(err); }
}

function updateGaokaoScores(existing) {
  const checked = [...document.querySelectorAll('#profile-subjects input:checked')].map(cb=>cb.value);
  const el = document.getElementById('profile-gaokao-scores');
  if (!checked.length) { el.innerHTML = `<p class="text-sm text-muted">${UI.LABEL_SELECT_HINT}</p>`; return; }

  const main = checked.filter(id => ['chinese','math','english'].includes(id));
  const elec = checked.filter(id => ELECTIVE.includes(id));

  let html = '';
  if (main.length) {
    html += `<div class="gaokao-section"><h4>${UI.GAOKAO_MAIN}</h4>`;
    main.forEach(sid => {
      const s = SUBJECTS.find(x=>x.id===sid);
      const ex = existing.find(x=>x.subject===sid);
      html += `<div class="gaokao-row"><span class="subject-name">${s.name}</span>
        <input type="number" class="score-inline" data-gk-subject="${sid}" data-gk-type="score"
          value="${ex?.score||''}" placeholder="分数" min="0" max="${s.maxScore}">
        <span class="score-max">/ ${s.maxScore}</span></div>`;
    });
    html += '</div>';
  }
  if (elec.length) {
    html += `<div class="gaokao-section"><h4>${UI.GAOKAO_ELECTIVE}</h4>`;
    elec.forEach(sid => {
      const s = SUBJECTS.find(x=>x.id===sid);
      const ex = existing.find(x=>x.subject===sid);
      html += `<div class="gaokao-row"><span class="subject-name">${s.name}</span>
        <div class="grade-selector" data-gk-subject="${sid}">
          ${GRADE_LEVELS.map(g=>`<span class="grade-option ${ex?.grade===g?'selected':''}" onclick="pickGrade(this)" data-grade="${g}">${g}</span>`).join('')}
        </div></div>`;
    });
    html += '</div>';
  }
  el.innerHTML = html;
}

function pickGrade(el) {
  el.closest('.grade-selector').querySelectorAll('.grade-option').forEach(o=>o.classList.remove('selected'));
  el.classList.add('selected');
}

async function handleSaveProfile(e) {
  e.preventDefault();
  const alertEl = document.getElementById('profile-alert');
  const subjects = [...document.querySelectorAll('#profile-subjects input:checked')].map(cb=>cb.value);
  if (!subjects.length) { alertEl.innerHTML = `<div class="alert alert-error">${UI.VALIDATE_SELECT_SUBJECT}</div>`; return; }

  const gaokaoScores = [];
  document.querySelectorAll('input[data-gk-type="score"]').forEach(inp => {
    if (inp.value) gaokaoScores.push({ subject: inp.dataset.gkSubject, score: +inp.value });
  });
  document.querySelectorAll('.grade-selector').forEach(sel => {
    const s = sel.querySelector('.grade-option.selected');
    if (s) gaokaoScores.push({ subject: sel.dataset.gkSubject, grade: s.dataset.grade });
  });

  try {
    const btn = document.getElementById('profile-submit');
    btn.disabled = true; btn.innerHTML = '<span class="spinner"></span>';
    await api('/api/teacher/profile', {
      method: 'POST', body: { userId: state.user.id, profile: {
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

async function loadAdminDashboard() {
  const el = document.getElementById('admin-content');
  try {
    const [statsData, reviewsData] = await Promise.all([
      api(`/api/admin/stats?username=${state.user.username}`),
      api(`/api/admin/reviews?username=${state.user.username}`),
    ]);
    const s = statsData.stats;
    const pendingReviews = reviewsData.reviews || [];

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
        <h3>待审核评价 (${pendingReviews.length})</h3>
        ${pendingReviews.length ? pendingReviews.map(r => `
          <div class="review-admin-item">
            <div class="review-info">
              <strong>${r.teacher_name}</strong> ← ${r.reviewer_name}
              <span class="stars">${renderStars(r.rating)}</span>
              <div style="margin-top:4px;color:var(--text-2);">${r.comment}</div>
              <div class="review-date">${r.created_at||''}</div>
            </div>
            <div class="review-actions">
              <button class="btn btn-accent btn-sm" onclick="adminReview(${r.id},'approve')">通过</button>
              <button class="btn btn-danger btn-sm" onclick="adminReview(${r.id},'reject')">拒绝</button>
            </div>
          </div>
        `).join('') : '<p class="text-sm text-muted">暂无待审核评价</p>'}
      </div>

      <div class="admin-panel">
        <h3>最近注册用户</h3>
        ${s.recentUsers.map(u => `<div style="display:flex;justify-content:space-between;padding:var(--s2) 0;border-bottom:1px solid var(--border-light);font-size:0.8125rem;">
          <span><strong>${u.username}</strong> <span class="tag">${u.role==='student'?'学生':'教师'}</span></span>
          <span class="text-muted">${u.created_at||''}</span>
        </div>`).join('')}
      </div>

      <div class="admin-panel">
        <h3>最近需求</h3>
        ${s.recentDemands.map(d => `<div style="display:flex;justify-content:space-between;padding:var(--s2) 0;border-bottom:1px solid var(--border-light);font-size:0.8125rem;">
          <span><strong>${d.username}</strong> ${STUDENT_GRADES.find(g=>g.id===d.student_grade)?.name||''} ${d.target_subjects.map(id=>SUBJECTS.find(s=>s.id===id)?.name||'').join('、')}</span>
          <span class="text-muted">${d.created_at||''}</span>
        </div>`).join('')}
      </div>
    `;
  } catch (err) {
    el.innerHTML = `<div class="empty-state"><p>${UI.ERROR_LOAD_PREFIX}${err.message}</p></div>`;
  }
}

async function adminReview(reviewId, action) {
  try {
    await api(`/api/admin/reviews/${reviewId}/${action}`, {
      method: 'POST', body: { username: state.user.username },
    });
    showToast(action === 'approve' ? UI.SUCCESS_APPROVED : UI.SUCCESS_REJECTED);
    loadAdminDashboard();
  } catch (err) { showToast(err.message); }
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
      localStorage.setItem('sufe_session', JSON.stringify({ ...saved, user: data.user }));

      if (data.user.role === 'teacher') {
        showView('teacher-dashboard');
        if (data.user.isAdmin) document.getElementById('admin-section').classList.remove('hidden');
      } else if (data.user.isAdmin) {
        state.user.role = 'teacher';
        showView('teacher-dashboard');
        document.getElementById('admin-section').classList.remove('hidden');
      } else {
        showView('student-dashboard');
      }
      return;
    } else if (saved) {
      localStorage.removeItem('sufe_session'); // 过期清理
    }
  } catch {
    localStorage.removeItem('sufe_session'); // 登录失败清理
  }
  showView('landing');
});

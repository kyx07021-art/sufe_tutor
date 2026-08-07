// ============================================================
// app-teachers.js — 教师领域（教师浏览/筛选 + 个人信息右栏 + 评价）
// ============================================================
// 模块职责：
//   1) 教师浏览与筛选：loadTeachers / renderTeachers / renderTeacherCard /
//      toggleFilters / applyFilters —— 错落两栏卡 + 星级/成绩行 + 方形发送需求按钮。
//   2) 全站统一个人信息右栏（取代旧教师详情弹窗）：openProfilePanel /
//      closeProfilePanel / profilePanelShowing / renderProfilePanel /
//      renderProfileInfoCard / renderProfileReviewsCard / viewTeacherCredential。
//   3) 评价：openReviewModal / setReviewStars / submitReview /
//      confirmDeleteReview / adminReviewAction。
//
// 加载序要求：本文件必须加载于共享层之后（app-state.js → app-api.js →
// app-anim.js → app-ui.js → app-display.js，运行时再叠加 app-shell/app-auth）。
// 共享层已暴露的全局（state/UI/SUBJECTS/DISP/api/escHtml/loaderHtml/openModal/
// DISP.starsHtml/…）一律直接引用，绝不在此重复定义；renderUsername/renderStars
// 兼容别名已删，本文件统一写 DISP.usernameHtml / DISP.starsHtml。
//
// 个人信息栏「开闭状态管理与动画彻底解耦」（CLAUDE.md 前端渲染/动画铁律）：
//   JS 只切 body.profile-panel-open / .profile-panel-closing 类 + animationend 收尾，
//   动画、原子隐藏、时序全由 CSS 呈现层负责，JS 零内联样式操作；panelSeq 作废在途异步。
//
// 依赖的共享全局：
//   state、UI、SUBJECTS、DISP、invalidate()、registerLogoutReset()（app-state.js）
//   api()（app-api.js）；showToast()、initReveals()（app-anim.js）
//   escHtml()、fmtDateTime()、loaderHtml()、renderAvatarHtml()、openModal()、
//   closeModal()、openImageViewer()、confirmDanger()（app-ui.js）
//   DISP.starsHtml / usernameHtml / subjectName / roleLabel / provinceName /
//   genderName / teacherGradeName / gaokaoCell / ratingText / reviewStatusTagHtml（app-display.js）
//   loadInto()（app-shell）；renderPushBtn()（app-demands）、loadAdminReviews()（app-admin）
// ============================================================

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
    const data = await dhGet('/api/teachers', { domain: 'teachers' }); // v0.23.0 静默数据层
    state.allTeachers = data.teachers || []; // 先回写再判空渲染（保持原顺序）
    return state.allTeachers;
  }, teachers => teachers.map(renderTeacherCard).join(''),
    { empty: UI.EMPTY_NO_TEACHERS, peek: () => dhPeek('/api/teachers') });
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
        <span class="tc-username" role="button" tabindex="0" aria-label="${UI.A11Y_VIEW_PROFILE}" onclick="openProfilePanel(${t.user_id})">${DISP.usernameHtml(t.username)}${t.verified ? ` <span class="glass glass--solid" title="${UI.VERIFIED_TITLE}">${UI.VERIFIED_BADGE}</span>` : ''}</span>
        <span class="tc-rating">${DISP.starsHtml(t.rating)}<b>${DISP.ratingText(t.rating)}</b></span>
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
        try { state.allTeachers = (await dhGet('/api/teachers', { domain: 'teachers' })).teachers || []; } catch { /* 无档案或网络抖动：卡片②空态 */ }
        if (seq !== profilePanelSeq) return;
        t = findCachedTeacher(userId);
      }
    }
    // ③ 签约状态 + 评价（评价仅教师有；管理员看全状态管理视图）
    let signed = false, reviewsData = null;
    if (state.user) {
      if (!state.myContracts.length) {
        try { state.myContracts = (await dhGet('/api/contracts/my', { domain: 'contracts' })).contracts || []; } catch { /* 静默 */ }
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
      <div class="profile-id-name">${DISP.usernameHtml(base.username)}</div>
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
    ${row(UI.LABEL_RATING, { v: `<span class="profile-rating">${DISP.starsHtml(t.rating)}<b>${DISP.ratingText(t.rating)}</b></span>` })}
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
        <span class="review-author">${DISP.usernameHtml(r.reviewer_name || '')} ${DISP.starsHtml(r.rating)} ${reviewsData.admin ? statusTag(r) : ''}</span>
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

// 个人信息面板查看对方学信网截图（数据已按双向匹配门槛取回缓存于教师行）
function viewTeacherCredential(userId) {
  const t = findCachedTeacher(userId);
  if (t && t.credential_image) openImageViewer(t.credential_image);
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

// 模块级状态登出复位：profilePanelUserId 置空 + 评价弹窗回填态清空。
// 注意不 reset profilePanelSeq —— closeProfilePanel 靠它作废旧在途异步，登出流程会调 closeProfilePanel。
registerLogoutReset(() => { profilePanelUserId = null; state.myReviewOnModal = null; });

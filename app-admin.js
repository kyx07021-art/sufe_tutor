/**
 * 上财家教平台 - 管理员面板模块
 *
 * 职责：管理员各子页装载器（统计/用户/需求/评价审核/资料管理/合同管理/用户反馈）/
 *       邀请码签发与计时 / 封禁解封 / 越权删帖 / 反馈标记处理。
 * 本文件在 app.js 之后加载，可安全调用 app.js 全局设施（api/state/UI/loadInto/escHtml/showToast 等）。
 * 函数一律保持 function 声明式（内联 onclick 靠它挂全局）。
 */

// ============================================================
// 管理员：资料管理（教师共享帖子：列表 / 全文查看 / 越权删除）
// ============================================================
async function loadAdminPosts() {
  await loadInto('admin-posts-list', async () => {
    const data = await api('/api/posts');
    state.adminPosts = data.posts || []; // 全文查看弹窗的数据源
    return state.adminPosts;
  }, rows => rows.map(renderAdminPostRow).join(''), { empty: UI.ADMIN_POSTS_EMPTY });
}

function renderAdminPostRow(p) {
  return `<div class="admin-row glass">
    <div class="admin-row-main">
      <div class="admin-row-line">
        <strong>${escHtml(p.title)}</strong>
        <span class="text-muted">${escHtml(p.username || '')}</span>
        <span class="list-card-meta">${p.like_count || 0} ${UI.POST_LIKE_ARIA}</span>
      </div>
      <div class="admin-row-meta">${fmtDateTime(p.created_at)}</div>
    </div>
    <div class="admin-row-actions">
      <button type="button" class="btn btn-outline btn-xs glass glass--pressable" onclick="openPostViewModal(${p.id})">${UI.BTN_VIEW}</button>
      <button type="button" class="btn btn-xs glass glass--pressable" onclick="adminDeletePost(${p.id})">${UI.BTN_REMOVE}</button>
    </div>
  </div>`;
}

// 全文查看：复用发帖组件的 mdRender
function openPostViewModal(postId) {
  const p = state.adminPosts.find(x => x.id === postId);
  if (!p) return;
  document.getElementById('modal-container').innerHTML = `<div class="modal-overlay" onclick="if(event.target===this)closeModal()">
    <div class="modal glass glass--float">
      <div class="modal-header glass"><h2>${escHtml(p.title)}</h2><button type="button" class="btn btn-ghost btn-icon glass glass--pressable" aria-label="${UI.BTN_CLOSE}" onclick="closeModal()">✕</button></div>
      <div class="modal-body">
        <p class="text-sm text-muted" style="margin-bottom:12px;">${escHtml(p.username || '')} · ${fmtDateTime(p.created_at)}</p>
        <div class="md-preview glass glass--solid">${mdRender(p.body_md || '')}</div>
      </div>
    </div>
  </div>`;
}

function adminDeletePost(postId) {
  openConfirmModal(UI.POST_DELETE_CONFIRM, async () => {
    try {
      await api(`/api/posts/${postId}`, { method: 'DELETE', body: {} });
      showToast(UI.POST_DELETED);
      loadAdminPosts();
    } catch (err) { showToast(err.message); }
  });
}

// ============================================================
// 管理员：合同管理（查看全部合同 + 测试用移除；全链路留档见后端 contract.* / admin.contract.*）
// ============================================================
async function loadAdminContracts() {
  await loadInto('admin-contracts-list', async () => {
    const data = await api(`/api/admin/contracts?username=${encodeURIComponent(state.user.username)}`);
    state.adminContracts = data.contracts || []; // 查看/移除弹窗的数据源
    return state.adminContracts;
  }, rows => rows.map(renderAdminContractRow).join(''), { empty: UI.ADMIN_CONTRACTS_EMPTY });
}

function renderAdminContractRow(c) {
  const statusText = c.status === 'pending' ? UI.CONTRACT_STATUS_PENDING
    : c.status === 'signing' ? UI.CONTRACT_STATUS_SIGNING : UI.CONTRACT_STATUS_SIGNED;
  const statusCls = c.status === 'signed' ? 'tag-ok' : c.status === 'signing' ? 'tag-warn' : 'tag-accent';
  const methodName = DISP.methodName(c.method) || c.method;
  return `<div class="admin-row glass">
    <div class="admin-row-main">
      <div class="admin-row-line">
        <strong>${escHtml(c.student_name)} × ${escHtml(c.teacher_name)}</strong>
        <span class="tag glass glass--solid ${statusCls}">${statusText}</span>
      </div>
      <div class="admin-row-meta">${UI.ADMIN_CONTRACT_DRAFTER_PREFIX}${escHtml(c.drafter_name)} · ${escHtml(methodName)} · ${c.hourly_rate}${UI.PRICE_UNIT} · ${fmtDateTime(c.updated_at)}</div>
    </div>
    <div class="admin-row-actions">
      <button type="button" class="btn btn-outline btn-xs glass glass--pressable" onclick="adminViewContract(${c.id})">${UI.BTN_VIEW_CONTRACT}</button>
      <button type="button" class="btn btn-xs glass glass--pressable" onclick="adminRemoveContract(${c.id})">${UI.BTN_REMOVE_CONTRACT}</button>
    </div>
  </div>`;
}

function adminViewContract(contractId) {
  const c = state.adminContracts.find(x => x.id === contractId);
  if (!c) return;
  document.getElementById('modal-container').innerHTML = `<div class="modal-overlay" onclick="if(event.target===this)closeModal()">
    <div class="modal glass glass--float">
      <div class="modal-header glass"><h2>${UI.BTN_VIEW_CONTRACT}</h2><button type="button" class="btn btn-ghost btn-icon glass glass--pressable" aria-label="${UI.BTN_CLOSE}" onclick="closeModal()">✕</button></div>
      <div class="modal-body contract-md">${mdRender(c.contract_md || '')}</div>
    </div>
  </div>`;
}

function adminRemoveContract(contractId) {
  openConfirmModal(UI.CONFIRM_ADMIN_REMOVE_CONTRACT, async () => {
    try {
      await api(`/api/admin/contracts/${contractId}`, { method: 'DELETE', body: { username: state.user.username } });
      showToast(UI.ADMIN_CONTRACT_REMOVED_TOAST);
      loadAdminContracts();
    } catch (err) { showToast(err.message); }
  });
}

// ============================================================
// 管理员：用户反馈（Bug 卡片红色警示边，建议走常规强调色）
// ============================================================
async function loadAdminFeedback() {
  setBadge('admin-feedback', 0); // 点开瞬间红点即灭（新反馈由轮询在离开本页后重新点亮）
  await loadInto('admin-feedback-list', async () => {
    const data = await api(`/api/feedbacks?username=${encodeURIComponent(state.user.username)}`);
    return data.feedbacks || [];
  }, list => list.map(f => {
    const isBug = f.kind === 'bug';
    const resolved = f.status === 'resolved';
    return `<div class="list-card glass feedback-card${isBug ? ' feedback-card--bug' : ''}${resolved ? ' feedback-card--resolved' : ''}">
        <div class="list-card-header">
          <span class="list-card-title">${escHtml(f.title || UI.BTN_FEEDBACK)}</span>
          <span class="feedback-tags">
            <span class="tag glass glass--solid ${isBug ? 'tag-danger' : 'tag-accent'}">${isBug ? UI.FEEDBACK_TAG_BUG : UI.FEEDBACK_TAG_SUGGEST}</span>
            <span class="tag glass glass--solid ${resolved ? 'tag-ok' : 'tag-warn'}">${resolved ? UI.FEEDBACK_STATUS_RESOLVED : UI.FEEDBACK_STATUS_OPEN}</span>
          </span>
        </div>
        <div class="list-card-detail feedback-content">${escHtml(f.content)}</div>
        <div class="feedback-foot">
          <span class="list-card-meta">${escHtml(f.username)} · ${fmtDateTime(f.created_at)}</span>
          ${resolved ? '' : `<button type="button" class="btn btn-outline btn-xs glass glass--pressable" onclick="resolveAdminFeedback(${f.id})">${UI.BTN_MARK_RESOLVED}</button>`}
        </div>
      </div>`;
  }).join(''), { empty: UI.ADMIN_FEEDBACK_EMPTY });
}

// 标记反馈已处理（后端通知提出者）
async function resolveAdminFeedback(feedbackId) {
  try {
    await api(`/api/feedbacks/${feedbackId}/resolve`, { method: 'POST', body: { username: state.user.username } });
    showToast(UI.FEEDBACK_RESOLVED_TOAST);
    loadAdminFeedback();
  } catch (err) { showToast(err.message); }
}

// ============================================================
// 管理员：封禁 / 解封用户
// ============================================================
function confirmBanUser(userId, banned) {
  confirmDanger(banned ? UI.BAN : UI.UNBAN, banned ? UI.CONFIRM_BAN : UI.CONFIRM_UNBAN, `doBanUser(${userId}, ${banned})`);
}

async function doBanUser(userId, banned) {
  try {
    await api(`/api/admin/users/${userId}/ban`, { method: 'POST', body: { username: state.user.username, banned } });
    closeModal();
    showToast(banned ? UI.SUCCESS_BANNED : UI.SUCCESS_UNBANNED);
    invalidate('teachers'); // 封禁/解封后清教师缓存，防被封教师滞留浏览列表
    if (state.page === 'admin-students') loadAdminStudents();
    if (state.page === 'admin-teachers') loadAdminTeachers();
  } catch (err) {
    showToast(err.message);
  }
}

// ============================================================
// 管理员：邀请码签发与计时
// ============================================================
async function generateInviteCode() {
  const btn = document.getElementById('gen-invite-btn');
  const display = document.getElementById('invite-code-display');
  try {
    btn.disabled = true; btn.innerHTML = '<span class="spinner"><i></i><i></i><i></i></span>';
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

// ============================================================
// 管理员：统计面板
// ============================================================
// 统计面板（原「管理员面板」，去掉待审核评价——审核并入「评价管理」；
// 结构上保留 stats-grid + 若干 admin-panel 板块，后期扩展统计数据直接加板块即可）
async function loadAdminStats() {
  const el = document.getElementById('admin-stats-content');
  el.innerHTML = `<div class="empty-state">${loaderHtml()}</div>`;
  try {
    const statsData = await api(`/api/admin/stats?username=${encodeURIComponent(state.user.username)}`);
    const s = statsData.stats;

    el.innerHTML = `
      <div class="stats-grid">
        <div class="stat-card glass"><div class="stat-value blue">${s.users.total}</div><div class="stat-label">${UI.ADMIN_TOTAL_USERS}</div></div>
        <div class="stat-card glass"><div class="stat-value green">${s.users.students}</div><div class="stat-label">${UI.ADMIN_STUDENTS}</div></div>
        <div class="stat-card glass"><div class="stat-value blue">${s.users.teachers}</div><div class="stat-label">${UI.ADMIN_TEACHERS}</div></div>
        <div class="stat-card glass"><div class="stat-value amber">${s.demands}</div><div class="stat-label">${UI.ADMIN_DEMANDS}</div></div>
        <div class="stat-card glass"><div class="stat-value blue">${s.profiles}</div><div class="stat-label">${UI.ADMIN_PROFILES}</div></div>
        <div class="stat-card glass"><div class="stat-value green">${s.reviews.approved}</div><div class="stat-label">${UI.ADMIN_REVIEWS_APPROVED}</div></div>
        <div class="stat-card glass"><div class="stat-value amber">${s.reviews.pending}</div><div class="stat-label">${UI.ADMIN_REVIEWS_PENDING}</div></div>
        <div class="stat-card glass"><div class="stat-value red">${s.invites.used||0}</div><div class="stat-label">${UI.ADMIN_INVITES_USED}</div></div>
      </div>

      <div class="admin-panel glass">
        <h3>${UI.ADMIN_RECENT_USERS}</h3>
        ${s.recentUsers.map(u => `<div style="display:flex;justify-content:space-between;padding:var(--s2) 0;border-bottom:1px solid var(--border-light);font-size:0.8125rem;">
          <span><strong>${escHtml(u.username)}</strong> <span class="tag glass glass--solid">${DISP.roleLabel(u.role)}</span></span>
          <span class="text-muted">${fmtDateTime(u.created_at)}</span>
        </div>`).join('')}
      </div>

      <div class="admin-panel glass">
        <h3>${UI.ADMIN_RECENT_DEMANDS}</h3>
        ${s.recentDemands.map(d => `<div style="display:flex;justify-content:space-between;padding:var(--s2) 0;border-bottom:1px solid var(--border-light);font-size:0.8125rem;">
          <span><strong>${escHtml(d.username)}</strong> ${STUDENT_GRADES.find(g=>g.id===d.student_grade)?.name||''} ${DISP.subjectNames(d.target_subjects)}</span>
          <span class="text-muted">${fmtDateTime(d.created_at)}</span>
        </div>`).join('')}
      </div>
    `;
  } catch (err) {
    el.innerHTML = `<div class="empty-state"><p>${UI.ERROR_LOAD_PREFIX}${escHtml(err.message)}</p></div>`;
  }
}

// ============================================================
// 管理员：学生 / 教师管理（封禁的账户无法登录）
// ============================================================
async function loadAdminUsers(role, elId) {
  await loadInto(elId, async () => {
    const data = await api(`/api/admin/users?username=${encodeURIComponent(state.user.username)}&role=${role}`);
    const users = data.users || [];
    if (role === 'teacher' && users.length) state.adminTeachers = users; // 教师详情弹窗的数据源（原口径：非空才回写）
    return users;
  }, users => users.map(u => renderAdminUserRow(u, role)).join(''), { empty: UI.EMPTY_NO_USERS, reveal: false });
}
function loadAdminStudents() { return loadAdminUsers('student', 'admin-students-list'); }
function loadAdminTeachers() { return loadAdminUsers('teacher', 'admin-teachers-list'); }

function renderAdminUserRow(u, role) {
  const uid = role === 'teacher' ? u.user_id : u.id;
  const meta = role === 'teacher'
    ? `${DISP.teacherGradeName(u.grade) || '—'} · ${DISP.ratingText(u.rating)}${UI.RATING_SCORE_SUFFIX} · ${u.price || '?'}${UI.PRICE_UNIT}`
    : `${u.demand_count || 0}${UI.DEMAND_COUNT_SUFFIX}`;
  return `<div class="admin-row glass">
    <div class="admin-row-main">
      <div class="admin-row-line">
        <strong>${escHtml(u.username)}</strong>
        ${u.verified ? `<span class="tag tag-ok glass glass--solid">${UI.VERIFIED_BADGE}</span>` : ''}
        ${u.banned ? `<span class="tag tag-danger glass glass--solid">${UI.TAG_BANNED}</span>` : ''}
      </div>
      <div class="admin-row-meta">${meta} · ${UI.REGISTERED_AT_PREFIX}${fmtDateTime(u.created_at)}</div>
    </div>
    <div class="admin-row-actions">
      ${role === 'teacher' ? `<button type="button" class="btn btn-outline btn-xs glass glass--pressable" onclick="openProfilePanel(${uid})">${UI.BTN_VIEW_DETAIL}</button>` : ''}
      ${role === 'teacher' && u.credential_image
        ? (u.verified
          ? `<button type="button" class="btn btn-outline btn-xs glass glass--pressable" onclick="toggleTeacherVerify(${uid}, 0)">${UI.UNVERIFY}</button>`
          : `<button type="button" class="btn btn-xs glass glass--pressable" onclick="toggleTeacherVerify(${uid}, 1)">${UI.VERIFY_TEACHER}</button>`)
        : ''}
      ${u.banned
        ? `<button type="button" class="btn btn-outline btn-xs glass glass--pressable" onclick="confirmBanUser(${uid}, 0)">${UI.UNBAN}</button>`
        : `<button type="button" class="btn btn-xs glass glass--pressable" onclick="confirmBanUser(${uid}, 1)">${UI.BAN}</button>`}
    </div>
  </div>`;
}

// 学籍认证审核：管理员核对学信网截图后置 verified（运营建议——「真实可验证在校生」信任锚点）
async function toggleTeacherVerify(userId, verified) {
  try {
    const data = await api(`/api/admin/teachers/${userId}/verify`, { method: 'POST', body: { verified } });
    showToast(verified ? UI.VERIFY_DONE : UI.UNVERIFY_DONE);
    loadAdminTeachers();
  } catch (err) { showToast(err.message); }
}

// ============================================================
// 管理员：需求管理（移除走管理员通道，不受归属限制）
// ============================================================
async function loadAdminDemands() {
  await loadInto('admin-demands-list', async () => {
    const data = await api(`/api/admin/demands?username=${encodeURIComponent(state.user.username)}`); // 管理员全量端点（含已签约，广场端点排除 contracted）
    return data.demands || [];
  }, demands => demands.map(d => renderDemandCard(d, { admin: true })).join(''), { empty: UI.EMPTY_NO_DEMANDS, reveal: false });
}

// ============================================================
// 管理员：评价管理（含审核：通过 / 拒绝 / 删除；可按状态过滤）
// ============================================================
async function loadAdminReviews() {
  const status = document.getElementById('admin-reviews-status')?.value || '';
  await loadInto('admin-reviews-list', async () => {
    const data = await api(`/api/admin/reviews?username=${encodeURIComponent(state.user.username)}${status ? `&status=${status}` : ''}`);
    return data.reviews || [];
  }, reviews => reviews.map(renderAdminReviewRow).join(''), { empty: UI.EMPTY_NO_REVIEWS, reveal: false });
}

function renderAdminReviewRow(r) {
  const statusTag = DISP.reviewStatusTagHtml(r.status);
  return `<div class="admin-row glass">
    <div class="admin-row-main">
      <div class="admin-row-line">
        <strong>${escHtml(r.teacher_name || '')}</strong>
        <span class="text-muted">←</span> ${escHtml(r.reviewer_name || '')}
        ${renderStars(r.rating)} ${statusTag}
      </div>
      <div class="review-text">${escHtml(r.comment)}</div>
      <div class="admin-row-meta">${fmtDateTime(r.created_at)}</div>
    </div>
    <div class="admin-row-actions">
      ${r.status === 'pending' ? `<button type="button" class="btn btn-xs glass glass--pressable" onclick="adminReviewAction(${r.id},'approve',0)">${UI.BTN_APPROVE}</button>
      <button type="button" class="btn btn-outline btn-xs glass glass--pressable" onclick="adminReviewAction(${r.id},'reject',0)">${UI.BTN_REJECT}</button>` : ''}
      <button type="button" class="btn btn-xs glass glass--pressable" onclick="confirmDeleteReview(${r.id},0)">${UI.BTN_DELETE_REVIEW}</button>
    </div>
  </div>`;
}

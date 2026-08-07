/**
 * 经途·伴学信息门户 - 管理员面板模块
 *
 * 职责：管理员各子页装载器（统计/用户/需求/评价审核/资料管理/合同管理/用户反馈）/
 *       邀请码签发与计时 / 封禁解封 / 越权删帖 / 反馈标记处理。
 * 本文件在共享层（app-state/app-api/app-anim/app-ui）之后加载，可安全调用全局设施（api/state/UI/loadInto/escHtml/showToast 等）。
 * 函数一律保持 function 声明式（内联 onclick 靠它挂全局）。
 */

// ============================================================
// 管理员：资料管理（教师共享帖子：列表 / 全文查看 / 越权删除）
// ============================================================
async function loadAdminPosts() {
  await loadInto('admin-posts-list', async () => {
    const data = await dhGet('/api/posts', { domain: 'posts' }); // v0.23.0 静默数据层（与教师资料广场同端点同域）
    state.adminPosts = data.posts || []; // 全文查看弹窗的数据源
    return state.adminPosts;
  }, rows => rows.map(renderAdminPostRow).join(''),
    { empty: UI.ADMIN_POSTS_EMPTY, peek: () => dhPeek('/api/posts') });
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
  openModal({
    title: escHtml(p.title),
    body: `<p class="text-sm text-muted" style="margin-bottom:12px;">${escHtml(p.username || '')} · ${fmtDateTime(p.created_at)}</p>
        <div class="md-preview glass glass--solid">${mdRender(p.body_md || '')}</div>`,
  });
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
    // v0.23.0 静默数据层：管理端合同列表归 contracts 域——合同变动（含学生/教师侧签约）一并静默重拉
    const data = await dhGet('/api/admin/contracts', { domain: 'contracts' });
    state.adminContracts = data.contracts || []; // 查看/移除弹窗的数据源
    return state.adminContracts;
  }, rows => rows.map(renderAdminContractRow).join(''),
    { empty: UI.ADMIN_CONTRACTS_EMPTY, peek: () => dhPeek('/api/admin/contracts') });
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
  openModal({
    title: UI.BTN_VIEW_CONTRACT,
    bodyCls: 'contract-md',
    body: `${mdRender(c.contract_md || '')}`,
  });
}

function adminRemoveContract(contractId) {
  openConfirmModal(UI.CONFIRM_ADMIN_REMOVE_CONTRACT, async () => {
    try {
      await api(`/api/admin/contracts/${contractId}`, { method: 'DELETE' });
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
    const data = await dhGet('/api/feedbacks', { domain: 'admin' }); // v0.23.0 静默数据层
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
    await api(`/api/feedbacks/${feedbackId}/resolve`, { method: 'POST' });
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
    await api(`/api/admin/users/${userId}/ban`, { method: 'POST', body: { banned } });
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
    const data = await api('/api/admin/invite', { method: 'POST' });
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
    const statsData = await dhGet('/api/admin/stats', { domain: 'admin' }); // v0.23.0 静默数据层
    const s = statsData.stats;

    // 网安审计 N-14：统计数值本应都是数字，但防御性转义（服务端异常/未来字段改文案时防存储型 XSS）
    const num = x => escHtml(Number(x) || 0);
    el.innerHTML = `
      <div class="stats-grid">
        <div class="stat-card glass"><div class="stat-value blue">${num(s.users.total)}</div><div class="stat-label">${UI.ADMIN_TOTAL_USERS}</div></div>
        <div class="stat-card glass"><div class="stat-value green">${num(s.users.students)}</div><div class="stat-label">${UI.ADMIN_STUDENTS}</div></div>
        <div class="stat-card glass"><div class="stat-value blue">${num(s.users.teachers)}</div><div class="stat-label">${UI.ADMIN_TEACHERS}</div></div>
        <div class="stat-card glass"><div class="stat-value amber">${num(s.demands)}</div><div class="stat-label">${UI.ADMIN_DEMANDS}</div></div>
        <div class="stat-card glass"><div class="stat-value blue">${num(s.profiles)}</div><div class="stat-label">${UI.ADMIN_PROFILES}</div></div>
        <div class="stat-card glass"><div class="stat-value green">${num(s.reviews.approved)}</div><div class="stat-label">${UI.ADMIN_REVIEWS_APPROVED}</div></div>
        <div class="stat-card glass"><div class="stat-value amber">${num(s.reviews.pending)}</div><div class="stat-label">${UI.ADMIN_REVIEWS_PENDING}</div></div>
        <div class="stat-card glass"><div class="stat-value red">${num(s.invites.used)}</div><div class="stat-label">${UI.ADMIN_INVITES_USED}</div></div>
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
          <span><strong>${escHtml(d.username)}</strong> ${escHtml(STUDENT_GRADES.find(g=>g.id===d.student_grade)?.name||'')} ${escHtml(DISP.subjectNames(d.target_subjects))}</span>
          <span class="text-muted">${fmtDateTime(d.created_at)}</span>
        </div>`).join('')}
      </div>
    `;
  } catch (err) {
    el.innerHTML = `<div class="empty-state"><p>${UI.ERROR_LOAD_PREFIX}${escHtml(err.message)}</p></div>`;
  }
}

// 流量监测（v0.22.1）：站点总流量 + 平均延迟。范围切换 + 独立图表组件（app-chart.js）渲染。
// 口径见 UI.TRAFFIC_HINT；接口 /api/admin/traffic 由服务端聚合 activity_log。
let _trafficRange = '24h';
async function loadAdminTraffic() {
  const el = document.getElementById('admin-traffic-content');
  if (!el) return;
  const render = async () => {
    el.innerHTML = `<div class="empty-state">${loaderHtml()}</div>`;
    try {
      const d = await api(`/api/admin/traffic?range=${_trafficRange}`);
      const ranges = [['24h', UI.TRAFFIC_RANGE_24H], ['7d', UI.TRAFFIC_RANGE_7D], ['30d', UI.TRAFFIC_RANGE_30D]];
      el.innerHTML = `
        <div class="traffic-range glass glass--solid">${ranges.map(([r, label]) =>
          `<button type="button" class="traffic-range-btn${r === _trafficRange ? ' on' : ''}" data-range="${r}" onclick="setTrafficRange('${r}')">${label}</button>`).join('')}
        </div>
        <p class="text-muted" style="font-size:.78rem;margin:0 0 10px;">${UI.TRAFFIC_HINT}</p>
        <div id="traffic-chart-req"></div>
        <div id="traffic-chart-lat"></div>`;
      renderGlassLineChart(document.getElementById('traffic-chart-req'), {
        title: UI.TRAFFIC_TITLE,
        colorVar: '--chart-traffic',
        data: d.buckets.map(b => ({ label: b.label, value: b.requests })),
        unit: d.unit,
        baselineAtZero: true,
        statFmt: total => `合计 ${Number(total).toLocaleString('zh-CN')} 次`,
      });
      renderGlassLineChart(document.getElementById('traffic-chart-lat'), {
        title: UI.TRAFFIC_LATENCY_TITLE,
        colorVar: '--chart-latency',
        data: d.buckets.map(b => ({ label: b.label, value: b.avgMs })),
        unit: d.unit,
        baselineAtZero: false,
        valueFmt: v => (v == null ? '—' : `${Math.round(v)} ms`),
        statFmt: (total, n) => (n ? `样本 ${n} 桶` : ''),
      });
    } catch (err) {
      el.innerHTML = `<div class="empty-state"><p>${UI.ERROR_LOAD_PREFIX}${escHtml(err.message)}</p></div>`;
    }
  };
  render();
}
// 范围切换（内联 onclick 挂全局，重新拉取并渲染）
function setTrafficRange(r) { _trafficRange = r; loadAdminTraffic(); }

// ============================================================
// 管理员：学生 / 教师管理（封禁的账户无法登录）
// ============================================================
async function loadAdminUsers(role, elId) {
  const url = `/api/admin/users?role=${role}`;
  await loadInto(elId, async () => {
    const data = await dhGet(url, { domain: 'admin' }); // v0.23.0 静默数据层
    const users = data.users || [];
    if (role === 'teacher') state.adminTeachers = users; // 空数组也回写：封禁最后一个教师后旧缓存不滞留 // 教师详情弹窗的数据源（原口径：非空才回写）
    return users;
  }, users => users.map(u => renderAdminUserRow(u, role)).join(''),
    { empty: UI.EMPTY_NO_USERS, reveal: false, peek: () => dhPeek(url) });
}
function loadAdminStudents() { return loadAdminUsers('student', 'admin-students-list'); }
function loadAdminTeachers() { return loadAdminUsers('teacher', 'admin-teachers-list'); }

function renderAdminUserRow(u, role) {
  const uid = role === 'teacher' ? u.user_id : u.id;
  const meta = role === 'teacher'
    ? `${DISP.teacherGradeName(u.grade) || '—'} · ${DISP.ratingText(u.rating)}${UI.RATING_SCORE_SUFFIX} · ${u.price != null ? u.price : '?'}${UI.PRICE_UNIT}`
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
// 网安报告 F-09：全量端点改 keyset 游标分页 → 首次 loadAdminDemands() 全量重载，
// 有 nextCursor 时按钮追加加载下一页；reset=false 追加页
let adminDemandsCursor = null;
let adminDemandsAll = [];
async function loadAdminDemands(reset = true) {
  const el = document.getElementById('admin-demands-list');
  if (!el) return;
  if (reset) { adminDemandsCursor = null; adminDemandsAll = []; el.innerHTML = `<div class="empty-state">${loaderHtml()}</div>`; }
  try {
    const qs = adminDemandsCursor ? `?cursor=${encodeURIComponent(adminDemandsCursor)}` : '';
    const data = await api(`/api/admin/demands${qs}`);
    adminDemandsAll = adminDemandsAll.concat(data.demands || []);
    adminDemandsCursor = data.nextCursor || null;
    if (!adminDemandsAll.length) { el.innerHTML = `<div class="empty-state"><p>${UI.EMPTY_NO_DEMANDS}</p></div>`; return; }
    el.innerHTML = adminDemandsAll.map(d => renderDemandCard(d, { admin: true })).join('') +
      (adminDemandsCursor ? `<div class="list-more-row"><button type="button" class="btn btn-outline glass glass--pressable" onclick="loadAdminDemands(false)">${UI.BTN_LOAD_MORE}</button></div>` : '');
  } catch (err) {
    if (reset) el.innerHTML = `<div class="empty-state"><p>${UI.ERROR_LOAD_PREFIX}${escHtml(err.message)}</p></div>`;
    else showToast(err.message);
  }
}

// ============================================================
// 管理员：评价管理（含审核：通过 / 拒绝 / 删除；可按状态过滤）
// ============================================================
async function loadAdminReviews() {
  const status = document.getElementById('admin-reviews-status')?.value || '';
  const url = `/api/admin/reviews${status ? `?status=${status}` : ''}`;
  await loadInto('admin-reviews-list', async () => {
    // 修：原用 &status 开头（无 ? 前缀，服务端无法解析，按状态过滤失效）→ 改 ?status
    const data = await dhGet(url, { domain: 'admin' }); // v0.23.0 静默数据层
    return data.reviews || [];
  }, reviews => reviews.map(renderAdminReviewRow).join(''),
    { empty: UI.EMPTY_NO_REVIEWS, reveal: false, peek: () => dhPeek(url) });
}

function renderAdminReviewRow(r) {
  const statusTag = DISP.reviewStatusTagHtml(r.status);
  return `<div class="admin-row glass">
    <div class="admin-row-main">
      <div class="admin-row-line">
        <strong>${escHtml(r.teacher_name || '')}</strong>
        <span class="text-muted">←</span> ${escHtml(r.reviewer_name || '')}
        ${DISP.starsHtml(r.rating)} ${statusTag}
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

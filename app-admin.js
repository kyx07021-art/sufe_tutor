/**
 * 经途·伴学信息门户 - 管理员面板模块
 *
 * 职责：管理员各子页装载器（统计/用户/需求/评价审核/资料管理/合同管理/用户反馈）/
 *       邀请码签发与计时 / 封禁解封 / 越权删帖 / 反馈标记处理。
 * 本文件在共享层（app-state/app-api/app-anim/app-ui）之后加载，可安全调用全局设施（api/state/UI/loadInto/escHtml/showToast 等）。
 * 函数一律保持 function 声明式（内联 onclick 靠它挂全局）。
 */

// 审计 M6：探测刷新替换缓存数组后重挂管理端镜像——全文查看/移除弹窗与教师详情
// 的数据源，不重挂则展示旧数据（自愈但误导）
if (typeof dhOnDomainRefresh === 'function') {
  dhOnDomainRefresh('admin', () => {
    const t = dhPeek('/api/admin/users?role=teacher');
    if (t && t.users) state.adminTeachers = t.users;
  });
  dhOnDomainRefresh('contracts', () => {
    const c = dhPeek('/api/admin/contracts');
    if (c && c.contracts) state.adminContracts = c.contracts;
  });
  dhOnDomainRefresh('posts', () => {
    const c = dhPeek('/api/posts');
    if (c && c.posts) state.adminPosts = c.posts;
  });
}

// ============================================================
// 管理员：资料管理（教师共享帖子：列表 / 全文查看 / 越权删除）
// ============================================================
async function loadAdminPosts() {
  await loadInto('admin-posts-list', async () => {
    const data = await dhGet('/api/posts', { domain: 'posts' }); // 静默数据层（与教师资料广场同端点同域）
    state.adminPosts = data.posts || []; // 全文查看弹窗的数据源
    return state.adminPosts;
  }, rows => rows.map(renderAdminPostRow).join(''),
    { empty: UI.ADMIN_POSTS_EMPTY, peek: () => dhReady('/api/posts') });
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
      <button type="button" class="btn btn-soft btn-xs glass glass--pressable" onclick="openPostViewModal(${p.id})">${UI.BTN_VIEW}</button>
      <button type="button" class="btn btn-soft btn-xs glass glass--pressable" onclick="adminDeletePost(${p.id})">${UI.BTN_REMOVE}</button>
    </div>
  </div>`;
}

// 全文查看：复用发帖组件的 mdRender
function openPostViewModal(postId) {
  const p = state.adminPosts.find(x => x.id === postId);
  if (!p) return;
  openModal({
    title: p.title, // S2-2：openModal 组件内统一转义（调用方传原文）
    cls: 'modal--wide', // 需求三十一：管理端全文阅读拓宽
    body: `<p class="text-sm text-muted modal-sub-info">${escHtml(p.username || '')} · ${fmtDateTime(p.created_at)}</p>
        <div class="md-preview glass glass--solid">${mdRender(p.body_md || '')}</div>`,
  });
}

function adminDeletePost(postId) {
  confirm({ message: UI.POST_DELETE_CONFIRM, onConfirm: async () => {
    try {
      await api(`/api/posts/${postId}`, { method: 'DELETE', body: {} });
      showToast(UI.POST_DELETED);
      invalidate('posts'); // 审计 M1：否则 loadAdminPosts 命中旧列表，被删帖闪回
      loadAdminPosts();
    } catch (err) { showToast(err.message); }
  }});
}

// ============================================================
// 管理员：合同管理（查看全部合同 + 测试用移除；全链路留档见后端 contract.* / admin.contract.*）
// ============================================================
async function loadAdminContracts() {
  await loadInto('admin-contracts-list', async () => {
    // 静默数据层：管理端合同列表归 contracts 域——合同变动（含学生/教师侧签约）一并静默重拉
    const data = await dhGet('/api/admin/contracts', { domain: 'contracts' });
    state.adminContracts = data.contracts || []; // 查看/移除弹窗的数据源
    return state.adminContracts;
  }, rows => rows.map(renderAdminContractRow).join(''),
    { empty: UI.ADMIN_CONTRACTS_EMPTY, peek: () => dhReady('/api/admin/contracts') });
}

function renderAdminContractRow(c) {
  const { text: statusText, cls: statusCls } = DISP.contractStatusMeta(c);
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
      <button type="button" class="btn btn-soft btn-xs glass glass--pressable" onclick="adminViewContract(${c.id})">${UI.BTN_VIEW_CONTRACT}</button>
      <button type="button" class="btn btn-soft btn-xs glass glass--pressable" onclick="adminRemoveContract(${c.id})">${UI.BTN_REMOVE_CONTRACT}</button>
    </div>
  </div>`;
}

function adminViewContract(contractId) {
  const c = state.adminContracts.find(x => x.id === contractId);
  if (!c) return;
  // 与用户端同口径——修改过的合同（prev_business 非空）先渲染改动 diff 块再显示当前全文
  const diffHtml = c.prev_business && typeof renderContractDiff === 'function'
    ? renderContractDiff(c.prev_business, splitContractBiz(c.contract_md)) : '';
  openModal({
    title: diffHtml ? UI.CONTRACT_VIEW_DIFF_TITLE : UI.BTN_VIEW_CONTRACT,
    cls: 'modal--wide', // 需求三十一：管理端合同全文拓宽
    bodyCls: 'contract-md',
    body: `${diffHtml ? `<div class="contract-diff-head">${escHtml(UI.CONTRACT_DIFF_HINT)}</div>
        <div class="contract-diff">${diffHtml}</div>
        <div class="contract-diff-divider"></div>` : ''}
      ${mdRender(stripContractMarker(c.contract_md))}`, // 去除内部标记行（stripContractMarker 单源）
  });
}

function adminRemoveContract(contractId) {
  confirm({ message: UI.CONFIRM_ADMIN_REMOVE_CONTRACT, onConfirm: async () => {
    try {
      await api(`/api/admin/contracts/${contractId}`, { method: 'DELETE' });
      showToast(UI.ADMIN_CONTRACT_REMOVED_TOAST);
      invalidate('contracts'); // 审计 M5：否则 loadAdminContracts 命中旧列表
      loadAdminContracts();
    } catch (err) { showToast(err.message); }
  }});
}

// ============================================================
// 管理员：用户反馈（Bug 卡片红色警示边，建议走常规强调色）
// ============================================================
async function loadAdminFeedback() {
  setBadge('admin-feedback', 0); // 点开瞬间红点即灭（新反馈由轮询在离开本页后重新点亮）
  await loadInto('admin-feedback-list', async () => {
    const data = await dhGet('/api/feedbacks', { domain: 'admin' }); // 静默数据层
    return data.feedbacks || [];
  }, list => list.map(f => {
    const resolved = f.status === STATUS.RESOLVED;
    const kindTagCls = DISP.feedbackKindCls(f.kind); // #165：投诉走警示色
    const subject = DISP.feedbackSubjectName(f.subject); // 非投诉恒 ''
    return `<div class="list-card glass feedback-card${f.kind === 'bug' ? ' feedback-card--bug' : ''}${resolved ? ' feedback-card--resolved' : ''}">
        <div class="list-card-header">
          <span class="list-card-title">${escHtml(f.title || UI.BTN_FEEDBACK)}</span>
          <span class="feedback-tags">
            <span class="tag glass glass--solid ${kindTagCls}">${escHtml(DISP.feedbackKindName(f.kind))}</span>
            ${subject ? `<span class="tag glass glass--solid tag-ok">${escHtml(subject)}</span>` : ''}
            <span class="tag glass glass--solid ${resolved ? 'tag-ok' : 'tag-warn'}">${resolved ? UI.FEEDBACK_STATUS_RESOLVED : UI.FEEDBACK_STATUS_OPEN}</span>
          </span>
        </div>
        <div class="list-card-detail feedback-content">${escHtml(f.content)}</div>
        <div class="feedback-foot">
          <span class="list-card-meta">${escHtml(f.username)} · ${fmtDateTime(f.created_at)}</span>
          ${resolved ? '' : `<button type="button" class="btn btn-soft btn-xs glass glass--pressable" onclick="resolveAdminFeedback(${f.id})">${UI.BTN_MARK_RESOLVED}</button>`}
        </div>
      </div>`;
  }).join(''), { empty: UI.ADMIN_FEEDBACK_EMPTY });
}

// 标记反馈已处理（后端通知提出者）
async function resolveAdminFeedback(feedbackId) {
  try {
    await api(`/api/feedbacks/${feedbackId}/resolve`, { method: 'POST' });
    showToast(UI.FEEDBACK_RESOLVED_TOAST);
    invalidate('admin'); // 审计 M5：否则 loadAdminFeedback 命中旧列表
    loadAdminFeedback();
  } catch (err) { showToast(err.message); }
}

// ============================================================
// 管理员：封禁 / 解封用户
// ============================================================
function confirmBanUser(userId, banned) {
  // 危险操作（同签约/注销口径）：needReAuth 换 capToken 后 doBanUser 才发请求，服务端 confirmDangerOtp 校验
  confirm({ title: banned ? UI.BAN : UI.UNBAN, message: banned ? UI.CONFIRM_BAN : UI.CONFIRM_UNBAN, needReAuth: true, onConfirm: (capToken) => doBanUser(userId, banned, capToken) });
}

async function doBanUser(userId, banned, capToken) {
  try {
    await api(`/api/admin/users/${userId}/ban`, { method: 'POST', body: { banned, capToken } });
    closeModal();
    showToast(banned ? UI.SUCCESS_BANNED : UI.SUCCESS_UNBANNED);
    invalidate('teachers'); // 封禁/解封后清教师缓存，防被封教师滞留浏览列表
    invalidate('admin'); // admin 用户列表也是缓存，不清则封禁状态滞留 60s
    if (state.page === 'admin-students') loadAdminStudents();
    if (state.page === 'admin-teachers') loadAdminTeachers();
  } catch (err) {
    showToast(err.message);
  }
}

// ============================================================
// 管理员：邀请码签发与管理（v1.2.0 T4：无过期时间，一人使用即失效）
// ============================================================
async function generateInviteCode() {
  const btn = document.getElementById('gen-invite-btn');
  const display = document.getElementById('invite-code-display');
  try {
    btnLoading(btn);
    const data = await api('/api/admin/invite', { method: 'POST' });
    state.currentInviteCode = data;
    document.getElementById('invite-code-text').textContent = data.code;
    document.getElementById('invite-code-timer').textContent = UI.INVITE_NO_EXPIRY;
    display.classList.remove('hidden');
  } catch (err) { showToast(UI.ERROR_GENERATE_INVITE + err.message); }
  finally { btnDone(btn, UI.BTN_GENERATE_INVITE); }
}

/** 邀请码管理浮窗：全部邀请码列表（状态/使用者/时间）+ 作废未用码 */
async function openInviteManager() {
  const body = '<div class="invite-manager" id="invite-manager-body"><div class="empty-state empty-state--small"><p>' + loaderHtml('sm') + '</p></div></div>';
  openModal({
    title: UI.INVITE_MANAGER_TITLE,
    cls: 'modal--wide',
    body,
    footer: `<button type="button" class="btn glass glass--pressable" onclick="closeModal()">${UI.ONBOARD_CONFIRM}</button>`,
  });
  try {
    const r = await api('/api/admin/invites');
    const list = r.invites || [];
    const el = document.getElementById('invite-manager-body');
    if (!el) return;
    if (!list.length) { el.innerHTML = `<p class="profile-empty">${escHtml(UI.INVITE_MANAGER_EMPTY)}</p>`; return; }
    el.innerHTML = `<table class="invite-manager-table">
      <thead><tr><th>${escHtml(UI.INVITE_MANAGER_CODE)}</th><th>${escHtml(UI.INVITE_MANAGER_STATUS)}</th><th>${escHtml(UI.INVITE_MANAGER_USED_BY)}</th><th>${escHtml(UI.INVITE_MANAGER_CREATED)}</th><th></th></tr></thead>
      <tbody>${list.map(inv => `<tr>
        <td class="invite-m-code">${escHtml(inv.code)}</td>
        <td>${inv.used_by ? `<span class="tag tag-ok glass glass--solid">${escHtml(UI.INVITE_MANAGER_USED)}</span>` : `<span class="tag tag-accent glass glass--solid">${escHtml(UI.INVITE_MANAGER_ACTIVE)}</span>`}</td>
        <td>${inv.used_by ? escHtml(inv.used_by_username || ('#' + inv.used_by)) : '—'}</td>
        <td class="invite-m-meta">${fmtDateTime(inv.created_at)}</td>
        <td>${inv.used_by ? '' : `<button type="button" class="btn btn-soft btn-xs glass glass--pressable" onclick="revokeInvite('${escHtml(inv.code)}')">${escHtml(UI.INVITE_MANAGER_REVOKE)}</button>`}</td>
      </tr>`).join('')}</tbody>
    </table>`;
  } catch (err) {
    const el = document.getElementById('invite-manager-body');
    if (el) el.innerHTML = `<p class="profile-empty">${escHtml(err.message)}</p>`;
  }
}

async function revokeInvite(code) {
  try {
    await api(`/api/admin/invites/${encodeURIComponent(code)}`, { method: 'DELETE', body: {} });
    showToast(UI.INVITE_MANAGER_REVOKED, 'success');
    openInviteManager(); // 刷新列表
  } catch (err) { showToast(err.message, 'error'); }
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
// 待办卡（渐进式披露：管理员最关心的「今日必办」置顶；点击直达对应管理页）
const todoItem = (pageId, label, count) => {
  const n = Number(count) || 0;
  return `<button type="button" class="todo-item glass glass--pressable" onclick="selectPage('${pageId}')">
    <span class="todo-count${n > 0 ? ' todo-count--hot' : ''}">${n}</span>
    <span class="todo-label">${label}</span>
    ${n > 0 ? `<span class="todo-arrow">→</span>` : ''}
  </button>`;
};

async function loadAdminStats() {
  const el = document.getElementById('admin-stats-content');
  el.innerHTML = `<div class="empty-state">${loaderHtml()}</div>`;
  try {
    const statsData = await dhGet('/api/admin/stats', { domain: 'admin' }); // 静默数据层
    const s = statsData.stats;

    // 网安审计 N-14：统计数值本应都是数字，但防御性转义（服务端异常/未来字段改文案时防存储型 XSS）
    const num = x => escHtml(Number(x) || 0);
    el.innerHTML = `
      <div class="admin-panel glass todo-panel">
        <h3>${UI.ADMIN_TODO_TITLE}</h3>
        <div class="todo-grid">
          ${todoItem('admin-reviews', UI.ADMIN_TODO_REVIEWS, s.reviews?.pending)}
          ${todoItem('admin-awards', UI.ADMIN_TODO_AWARDS, s.todo?.awardsPending)}
          ${todoItem('admin-feedback', UI.ADMIN_TODO_FEEDBACKS, s.todo?.feedbacksOpen)}
          ${todoItem('admin-complaint', UI.ADMIN_TODO_COMPLAINTS, s.todo?.complaintsOpen)}
        </div>
      </div>
      <div class="stats-grid">
        <div class="stat-card glass"><div class="stat-value blue">${num(s.users?.total)}</div><div class="stat-label">${UI.ADMIN_TOTAL_USERS}</div></div>
        <div class="stat-card glass"><div class="stat-value green">${num(s.users?.students)}</div><div class="stat-label">${UI.ADMIN_STUDENTS}</div></div>
        <div class="stat-card glass"><div class="stat-value blue">${num(s.users?.teachers)}</div><div class="stat-label">${UI.ADMIN_TEACHERS}</div></div>
        <div class="stat-card glass"><div class="stat-value amber">${num(s.demands)}</div><div class="stat-label">${UI.ADMIN_DEMANDS}</div></div>
        <div class="stat-card glass"><div class="stat-value blue">${num(s.profiles)}</div><div class="stat-label">${UI.ADMIN_PROFILES}</div></div>
        <div class="stat-card glass"><div class="stat-value green">${num(s.reviews?.approved)}</div><div class="stat-label">${UI.ADMIN_REVIEWS_APPROVED}</div></div>
        <div class="stat-card glass"><div class="stat-value amber">${num(s.reviews?.pending)}</div><div class="stat-label">${UI.ADMIN_REVIEWS_PENDING}</div></div>
        <div class="stat-card glass"><div class="stat-value red">${num(s.invites?.used)}</div><div class="stat-label">${UI.ADMIN_INVITES_USED}</div></div>
      </div>

      <div class="admin-panel glass">
        <h3>${UI.ADMIN_RECENT_USERS}</h3>
        ${s.recentUsers.map(u => `<div class="recent-row">
          <span><strong>${escHtml(u.username)}</strong> <span class="tag glass glass--solid">${DISP.roleLabel(u.role)}</span></span>
          <span class="text-muted">${fmtDateTime(u.created_at)}</span>
        </div>`).join('')}
      </div>

      <div class="admin-panel glass">
        <h3>${UI.ADMIN_RECENT_DEMANDS}</h3>
        ${s.recentDemands.map(d => `<div class="recent-row">
          <span><strong>${escHtml(d.username)}</strong> ${escHtml(DISP.studentGradeName(d.student_grade))} ${escHtml(DISP.demandTargetNames(d.target_subjects, d.target_type))}</span>
          <span class="text-muted">${fmtDateTime(d.created_at)}</span>
        </div>`).join('')}
      </div>
    `;
  } catch (err) {
    el.innerHTML = `<div class="empty-state"><p>${UI.ERROR_LOAD_PREFIX}${escHtml(err.message)}</p></div>`;
  }
}

// 流量监测：站点总流量 + 平均延迟。范围切换 + 独立图表组件（app-chart.js）渲染。
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
        ${segTabsHtml(ranges.map(([r, label]) => ({ key: r, label, onclick: `setTrafficRange('${r}')` })), _trafficRange, { containerClass: 'traffic-range', attr: 'range' })}
        <p class="text-muted traffic-hint">${UI.TRAFFIC_HINT}</p>
        <div id="traffic-chart-req"></div>
        <div id="traffic-chart-lat"></div>`;
      renderGlassLineChart(document.getElementById('traffic-chart-req'), {
        title: UI.TRAFFIC_TITLE,
        colorVar: '--chart-traffic',
        data: d.buckets.map(b => ({ label: b.label, value: b.requests })),
        unit: d.unit,
        baselineAtZero: true,
        statFmt: total => UI.TRAFFIC_TOTAL_FMT.replace('{n}', Number(total).toLocaleString('zh-CN')),
      });
      renderGlassLineChart(document.getElementById('traffic-chart-lat'), {
        title: UI.TRAFFIC_LATENCY_TITLE,
        colorVar: '--chart-latency',
        data: d.buckets.map(b => ({ label: b.label, value: b.avgMs })),
        unit: d.unit,
        baselineAtZero: false,
        valueFmt: v => (v == null ? '—' : `${Math.round(v)}${UI.TRAFFIC_MS_UNIT}`),
        statFmt: (total, n) => (n ? UI.TRAFFIC_SAMPLE_FMT.replace('{n}', n) : ''),
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
async function loadAdminUsers(role, elId, q = '') {
  const url = `/api/admin/users?role=${role}${q ? `&q=${encodeURIComponent(q)}` : ''}`;
  await loadInto(elId, async () => {
    const data = await dhGet(url, { domain: 'admin' }); // 静默数据层
    const users = data.users || [];
    if (role === 'teacher' && !q) state.adminTeachers = users; // 空数组也回写：封禁最后一个教师后旧缓存不滞留（教师详情弹窗的数据源）；搜索态不回写缓存
    return users;
  }, users => users.map(u => renderAdminUserRow(u, role)).join(''),
    { empty: UI.EMPTY_NO_USERS, reveal: false, peek: () => dhReady(url) });
}
function loadAdminStudents() { return loadAdminUsers('student', 'admin-students-list'); }
function loadAdminTeachers() { return loadAdminUsers('teacher', 'admin-teachers-list'); }

// 用户搜索（防抖 300ms；空串回落全量列表）
let _adminUsersSearchTimer = 0;
function adminUsersSearchDebounced(role, q) {
  clearTimeout(_adminUsersSearchTimer);
  _adminUsersSearchTimer = setTimeout(() => {
    loadAdminUsers(role, role === 'student' ? 'admin-students-list' : 'admin-teachers-list', q.trim());
  }, 300);
}

function renderAdminUserRow(u, role) {
  const uid = role === 'teacher' ? u.user_id : u.id;
  const meta = role === 'teacher'
    ? `${DISP.teacherGradeName(u.grade) || '—'} · ${DISP.ratingText(u.rating)}${UI.RATING_SCORE_SUFFIX} · ${DISP.priceRangeText(u.price_min, u.price_max, UI.PRICE_UNIT) || '?'}` // R2-5 报价区间
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
      ${role === 'teacher' ? `<button type="button" class="btn btn-soft btn-xs glass glass--pressable" onclick="openProfilePanel(${uid})">${UI.BTN_VIEW_DETAIL}</button>` : ''}
      ${role === 'teacher' && u.credential_image
        ? (u.verified
          ? `<button type="button" class="btn btn-soft btn-xs glass glass--pressable" onclick="toggleTeacherVerify(${uid}, 0)">${UI.UNVERIFY}</button>`
          : `<button type="button" class="btn btn-soft btn-xs glass glass--pressable" onclick="toggleTeacherVerify(${uid}, 1)">${UI.VERIFY_TEACHER}</button>`)
        : ''}
      ${u.banned
        ? `<button type="button" class="btn btn-soft btn-xs glass glass--pressable" onclick="confirmBanUser(${uid}, 0)">${UI.UNBAN}</button>`
        : `<button type="button" class="btn btn-soft btn-xs glass glass--pressable" onclick="confirmBanUser(${uid}, 1)">${UI.BAN}</button>`}
    </div>
  </div>`;
}

// 学籍认证审核：管理员核对学信网截图后置 verified（运营建议——「真实可验证在校生」信任锚点）
function toggleTeacherVerify(userId, verified) {
  // 学籍认证 = 信任锚点操作（高危）：先二次认证换 capToken（服务端 confirmDangerOtp 校验）
  confirm({
    title: verified ? UI.VERIFY_TEACHER : UI.UNVERIFY,
    message: verified ? UI.VERIFY_CONFIRM : UI.UNVERIFY_CONFIRM,
    needReAuth: true,
    onConfirm: (capToken) => doTeacherVerify(userId, verified, capToken),
  });
}

async function doTeacherVerify(userId, verified, capToken) {
  try {
    await api(`/api/admin/teachers/${userId}/verify`, { method: 'POST', body: { verified, capToken } });
    showToast(verified ? UI.VERIFY_DONE : UI.UNVERIFY_DONE);
    invalidate('admin'); // admin 教师列表缓存不清则核验状态滞留
    invalidate('teachers'); // 教师列表 verified 徽章同步刷新
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
    const data = await dhGet(url, { domain: 'admin' }); // 静默数据层
    return data.reviews || [];
  }, reviews => reviews.map(renderAdminReviewRow).join(''),
    { empty: UI.EMPTY_NO_REVIEWS, reveal: false, peek: () => dhReady(url) });
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
      ${r.status === STATUS.PENDING ? `<button type="button" class="btn btn-soft btn-xs glass glass--pressable" onclick="adminReviewAction(${r.id},'approve',0)">${UI.BTN_APPROVE}</button>
      <button type="button" class="btn btn-soft btn-xs glass glass--pressable" onclick="adminReviewAction(${r.id},'reject',0)">${UI.BTN_REJECT}</button>` : ''}
      <button type="button" class="btn btn-soft btn-xs glass glass--pressable" onclick="confirmDeleteReview(${r.id},0)">${UI.BTN_DELETE_REVIEW}</button>
    </div>
  </div>`;
}

// ============================================================
// ：统一内容审核页（全站内容提取 + 一键处罚）
// ============================================================
const _contentTypeName = t => ({
  post: UI.ADMIN_CONTENT_TYPE_POST, demand: UI.ADMIN_CONTENT_TYPE_DEMAND, teacher: UI.ADMIN_CONTENT_TYPE_TEACHER,
  review: UI.ADMIN_CONTENT_TYPE_REVIEW, message: UI.ADMIN_CONTENT_TYPE_MESSAGE, feedback: UI.ADMIN_CONTENT_TYPE_FEEDBACK,
  complaint: UI.ADMIN_CONTENT_TYPE_COMPLAINT, upload: UI.ADMIN_CONTENT_TYPE_UPLOAD,
  contract: UI.ADMIN_CONTENT_TYPE_CONTRACT, signing: UI.ADMIN_CONTENT_TYPE_SIGNING,
}[t] || t);

async function loadAdminContent(type = '') {
  // 选中态（全部/单类型 tab）
  document.querySelectorAll('#admin-content-tabs .seg-tab').forEach(b => b.classList.toggle('active', String(b.dataset.type) === String(type)));
  const el = document.getElementById('admin-content-list');
  if (!el) return;
  el.innerHTML = `<div class="empty-state">${loaderHtml()}</div>`;
  try {
    const data = await api(`/api/admin/content${type ? `?type=${encodeURIComponent(type)}` : ''}`);
    const items = data.items || [];
    if (!document.getElementById('admin-content-list')) return; // 已离开页面
    if (!items.length) { el.innerHTML = `<div class="empty-state"><p>${UI.ADMIN_CONTENT_EMPTY}</p></div>`; return; }
    el.innerHTML = items.map(renderAdminContentRow).join('');
    initReveals(el);
  } catch (err) {
    if (document.getElementById('admin-content-list')) el.innerHTML = `<div class="empty-state"><p>${escHtml(err.message)}</p></div>`;
  }
}

function renderAdminContentRow(it) {
  const author = it.author && it.author.username ? escHtml(it.author.username) : '已注销用户';
  const roleTag = it.author && it.author.role ? `<span class="tag glass glass--solid">${escHtml(DISP.roleLabel(it.author.role))}</span>` : '';
  const statusTag = it.status ? `<span class="tag glass glass--solid ${it.status === STATUS.OPEN || it.status === STATUS.PENDING ? 'tag-warn' : 'tag-ok'}">${escHtml(it.status)}</span>` : '';
  return `<div class="list-card glass content-card" data-type="${escHtml(it.type)}" data-id="${it.id}">
    <div class="list-card-header">
      <span class="list-card-title">${escHtml(it.title || it.type)}</span>
      <span class="feedback-tags">
        <span class="tag glass glass--solid">${escHtml(_contentTypeName(it.type))}</span>
        ${statusTag}${roleTag}
      </span>
    </div>
    <div class="list-card-detail content-card-body">${escHtml(String(it.body || '').slice(0, 160))}</div>
    <div class="feedback-foot">
      <span class="list-card-meta">${author} · ${fmtDateTime(it.created_at)}</span>
      <div class="admin-row-actions">
        <button type="button" class="btn btn-soft btn-xs glass glass--pressable" onclick="openContentPenaltyModal('${it.type}',${it.id})">${it.type === 'teacher' ? UI.ADMIN_CONTENT_PENALTY_BAN : UI.ADMIN_CONTENT_PENALTY_DELETE + ' / ' + UI.ADMIN_CONTENT_PENALTY_BAN}</button>
      </div>
    </div>
  </div>`;
}

// 处罚弹窗：原因（必填）+ 触犯规则 → 删除 / 封禁作者
// teacher 档案无硬删分支（后端 doDeleteContent 对 teacher 跳过）——只给封禁，不展示 no-op 删除
function openContentPenaltyModal(type, id) {
  const onlyBan = type === 'teacher';
  // type 来自服务端提取枚举（CONTENT_TYPES），拼入 onclick 前仍按白名单断言（属性上下文纵深防御）
  const t = /^[a-z]+$/.test(type) ? type : 'post';
  openModal({
    title: `处罚${_contentTypeName(t)} #${id}`,
    style: `max-width:${CONFIG.MODAL_W_CONFIRM};`,
    body: `<div class="form-group">
        <label class="form-label">${UI.ADMIN_CONTENT_PENALTY_REASON} <span class="req">*</span></label>
        <input type="text" class="form-input" id="penalty-reason" maxlength="80" placeholder="如：含详细门牌号，违反平台隐私红线">
      </div>
      <div class="form-group">
        <label class="form-label">${UI.ADMIN_CONTENT_PENALTY_RULE}</label>
        <input type="text" class="form-input" id="penalty-rule" maxlength="30" placeholder="如：地址门控 / 内容安全">
      </div>
      <p class="form-hint">处罚后将自动通知作者（含原因、规则与触发内容摘要）</p>`,
    footer: `<button type="button" class="btn btn-outline glass glass--pressable" onclick="closeModal()">${UI.BTN_CANCEL}</button>
      ${onlyBan ? '' : `<button type="button" class="btn btn-soft btn-xs glass glass--pressable" onclick="submitContentPenalty('${t}',${id},'remove')">${UI.ADMIN_CONTENT_PENALTY_DELETE}</button>`}
      <button type="button" class="btn glass glass--pressable" onclick="submitContentPenalty('${t}',${id},'ban')">${UI.ADMIN_CONTENT_PENALTY_BAN}</button>`,
  });
}

async function submitContentPenalty(type, id, action) {
  const reason = document.getElementById('penalty-reason').value.trim();
  if (!reason) { showToast(UI.ADMIN_CONTENT_PENALTY_REASON, 'error'); return; }
  const rule = document.getElementById('penalty-rule').value.trim();
  // 处罚 = 危险操作（后端 confirmDangerOtp 强制 capToken）：先二次认证换 capToken 再发请求
  closeModal();
  confirm({
    title: `处罚${_contentTypeName(type)} #${id}`,
    message: `将${action === 'ban' ? '封禁' : '移除'}该内容并通知作者，确认继续？`,
    needReAuth: true,
    onConfirm: (capToken) => doSubmitContentPenalty(type, id, action, reason, rule, capToken),
  });
}

async function doSubmitContentPenalty(type, id, action, reason, rule, capToken) {
  try {
    const r = await api(`/api/admin/content/${type}/${id}/action`, { method: 'POST', body: { action, reason, rule, capToken } });
    showToast(r.message || '已处理', 'success');
    closeModal();
    loadAdminContent(document.querySelector('#admin-content-tabs .seg-tab.active')?.dataset.type || '');
  } catch (err) { showToast(err.message, 'error'); }
}

// ============================================================
// 教师荣誉奖项审核（v1.0 R2：奖状证明人工审核，先审后展示）
// ============================================================
function loadAdminAwards() {
  const statusEl = document.getElementById('admin-awards-status');
  const status = statusEl ? statusEl.value : 'pending';
  loadInto('admin-awards-list',
    () => api(`/api/admin/awards${status ? `?status=${status}` : ''}`, { method: 'GET' }),
    d => {
      const list = d.awards || [];
      if (!list.length) return { html: `<div class="empty-state"><p>${UI.ADMIN_AWARD_NONE}</p></div>` };
      return { html: list.map(a => {
        const statusTag = a.status === STATUS.APPROVED
          ? `<span class="tag tag-ok glass glass--solid">${UI.AWARD_STATUS_APPROVED}</span>`
          : a.status === STATUS.REJECTED
            ? `<span class="tag tag-danger glass glass--solid">${UI.AWARD_STATUS_REJECTED}</span>`
            : `<span class="tag tag-warn glass glass--solid">${UI.AWARD_STATUS_PENDING}</span>`;
        return `<div class="list-card list-card--teacher glass">
          <div class="admin-award-head">
            <span class="list-card-title">${escHtml(a.title)}${a.issuer ? ` · ${escHtml(a.issuer)}` : ''}${a.award_date ? ` · ${escHtml(a.award_date)}` : ''}</span>
            ${statusTag}
          </div>
          <div class="admin-award-meta">教师：${escHtml(a.teacher_username || `#${a.teacher_user_id}`)}</div>
          ${a.admin_note ? `<div class="admin-award-note">${escHtml(UI.AWARD_REJECTED_NOTE_PREFIX)}${escHtml(a.admin_note)}</div>` : ''}
          <div class="admin-row-actions">
            ${a.proof_upload_id ? `<button type="button" class="btn btn-soft btn-xs glass glass--pressable" onclick="viewAwardProof(${a.id})">${UI.ADMIN_AWARD_PROOF_VIEW}</button>` : ''}
            ${a.status === STATUS.PENDING ? `<button type="button" class="btn btn-soft btn-xs glass glass--pressable" onclick="approveAward(${a.id})">${UI.ADMIN_AWARD_APPROVE}</button>
              <button type="button" class="btn btn-soft btn-xs glass glass--pressable" onclick="rejectAwardModal(${a.id})">${UI.ADMIN_AWARD_REJECT}</button>` : ''}
          </div>
        </div>`;
      }).join('') };
    },
    { empty: UI.ADMIN_AWARD_NONE, pick: d => d.awards });
}

// 奖状证明查看（管理员鉴权端点解密返回 dataURL）
async function viewAwardProof(awardId) {
  try {
    const d = await api(`/api/admin/awards/${awardId}/proof`, { method: 'GET' });
    if (d.dataUrl) openImageViewer(d.dataUrl, d.name || '');
  } catch (err) { showToast(err.message, 'error'); }
}

// 通过：危险操作二次认证（同封禁/处罚口径）
function approveAward(awardId) {
  confirm({
    title: UI.ADMIN_AWARD_APPROVE,
    message: UI.ADMIN_AWARD_APPROVE_CONFIRM,
    needReAuth: true,
    onConfirm: (capToken) => doAwardAction(awardId, 'approve', '', capToken),
  });
}

function rejectAwardModal(awardId) {
  openModal({
    title: UI.ADMIN_AWARD_REJECT,
    style: `max-width:${CONFIG.MODAL_W_CONFIRM};`,
    body: `<div class="form-group">
        <label class="form-label">${UI.ADMIN_AWARD_REJECT_HINT} <span class="req">*</span></label>
        <input type="text" class="form-input" id="award-reject-note" maxlength="200" placeholder="如：奖状模糊无法辨认">
      </div>`,
    footer: `<button type="button" class="btn btn-outline glass glass--pressable" onclick="closeModal()">${UI.BTN_CANCEL}</button>
      <button type="button" class="btn glass glass--pressable" onclick="submitAwardReject(${awardId})">${UI.ADMIN_AWARD_REJECT}</button>`,
  });
}

function submitAwardReject(awardId) {
  const note = (document.getElementById('award-reject-note')?.value || '').trim();
  if (!note) { showToast(UI.ADMIN_AWARD_REJECT_HINT, 'error'); return; }
  closeModal();
  confirm({
    title: UI.ADMIN_AWARD_REJECT,
    message: UI.ADMIN_AWARD_REJECT_CONFIRM,
    needReAuth: true,
    onConfirm: (capToken) => doAwardAction(awardId, 'reject', note, capToken),
  });
}

async function doAwardAction(awardId, action, note, capToken) {
  try {
    await api(`/api/admin/awards/${awardId}/action`, { method: 'POST', body: { action, note, capToken } });
    closeModal();
    showToast(action === 'approve' ? UI.AWARD_STATUS_APPROVED : UI.AWARD_STATUS_REJECTED, 'success');
    loadAdminAwards();
    invalidate('teachers'); // 奖项状态变：教师卡荣誉徽章缓存刷新
  } catch (err) { showToast(err.message, 'error'); }
}

// ============================================================
// v1.2.0 T6：学信网核验队列（管理员）——结构化录入（无 API 时管理员按官方核验页查证后手动填写）
// ============================================================
async function loadAdminVerifications() {
  const el = document.getElementById('admin-verif-list');
  if (!el) return;
  const status = (document.getElementById('admin-verif-status') || {}).value || 'all';
  el.innerHTML = '<div class="empty-state"><span class="loader" role="status" aria-label="加载中..."><i></i><i></i><i></i></span></div>';
  try {
    const r = await api('/api/admin/verifications?status=' + encodeURIComponent(status));
    const list = r.verifications || [];
    if (!list.length) { el.innerHTML = `<p class="profile-empty">${escHtml(UI.VERIF_EMPTY)}</p>`; return; }
    el.innerHTML = list.map(v => `<div class="list-card glass verif-card" data-id="${v.id}">
      <div class="verif-head">
        <span class="verif-user">${escHtml(v.username || ('#' + v.user_id))}</span>
        ${v.status === STATUS.PENDING ? `<span class="tag tag-warn glass glass--solid">${escHtml(UI.VERIF_PENDING)}</span>`
          : v.status === STATUS.APPROVED ? `<span class="tag tag-ok glass glass--solid">${escHtml(UI.VERIF_APPROVED)}</span>`
          : `<span class="tag tag-danger glass glass--solid">${escHtml(UI.VERIF_REJECTED)}</span>`}
        <span class="verif-code">${escHtml(v.verify_code)}</span>
      </div>
      <div class="verif-meta">${fmtDateTime(v.created_at)}${v.verified_at ? ' · ' + fmtDateTime(v.verified_at) : ''}</div>
      ${v.status === STATUS.APPROVED ? `<div class="verif-result">${escHtml([v.school, v.level, v.major, v.enrollment_status, v.enroll_year].filter(Boolean).join(' · '))}</div>
        <div class="verif-actions"><button type="button" class="btn btn-soft btn-sm glass glass--pressable" onclick="verifRevoke(${v.id})">${escHtml(UI.VERIF_REVOKE_BTN)}</button></div>` : ''}
      ${v.status === STATUS.PENDING ? renderVerifForm(v) : ''}
    </div>`).join('');
  } catch (err) {
    el.innerHTML = `<p class="profile-empty">${escHtml(err.message)}</p>`;
  }
}

function renderVerifForm(v) {
  return `<div class="verif-form">
    <p class="verif-form-hint">${escHtml(UI.VERIF_FORM_HINT)}</p>
    <div class="verif-grid">
      <div class="form-group"><label class="form-label">${escHtml(UI.CHSI_INFO_SCHOOL)} <span class="req">*</span></label>
        <input type="text" class="form-input" id="verif-school-${v.id}" maxlength="30" placeholder="如：上海财经大学"></div>
      <div class="form-group"><label class="form-label">${escHtml(UI.CHSI_INFO_LEVEL)} <span class="req">*</span></label>
        <input type="text" class="form-input" id="verif-level-${v.id}" maxlength="20" placeholder="本科 / 硕士"></div>
      <div class="form-group"><label class="form-label">${escHtml(UI.CHSI_INFO_MAJOR)}</label>
        <input type="text" class="form-input" id="verif-major-${v.id}" maxlength="60"></div>
      <div class="form-group"><label class="form-label">${escHtml(UI.CHSI_INFO_STATUS)}</label>
        <input type="text" class="form-input" id="verif-status-${v.id}" maxlength="20" placeholder="在籍 / 已毕业"></div>
      <div class="form-group"><label class="form-label">${escHtml(UI.CHSI_INFO_YEAR)}</label>
        <input type="text" class="form-input" id="verif-year-${v.id}" maxlength="10" placeholder="如 2024"></div>
    </div>
    <div class="verif-actions">
      <button type="button" class="btn btn-soft btn-sm glass glass--pressable" onclick="verifApprove(${v.id})">${escHtml(UI.VERIF_APPROVE_BTN)}</button>
      <button type="button" class="btn btn-soft btn-sm glass glass--pressable" onclick="verifReject(${v.id})">${escHtml(UI.VERIF_REJECT_BTN)}</button>
    </div>
  </div>`;
}

async function verifApprove(id) {
  const g = s => ((document.getElementById(s) || {}).value || '').trim();
  const body = {
    action: 'approve',
    school: g(`verif-school-${id}`), level: g(`verif-level-${id}`),
    major: g(`verif-major-${id}`), enrollment_status: g(`verif-status-${id}`),
    enroll_year: g(`verif-year-${id}`),
  };
  if (!body.school || !body.level) { showToast(UI.VERIF_APPROVE_REQUIRED, 'error'); return; }
  try {
    await api(`/api/admin/verifications/${id}/action`, { method: 'POST', body });
    showToast(UI.VERIF_APPROVED_OK, 'success');
    loadAdminVerifications();
  } catch (err) { showToast(err.message, 'error'); }
}

async function verifRevoke(id) {
  try {
    await api(`/api/admin/verifications/${id}/action`, { method: 'POST', body: { action: 'revoke' } });
    showToast(UI.VERIF_REVOKED_OK, 'success');
    loadAdminVerifications();
  } catch (err) { showToast(err.message, 'error'); }
}

async function verifReject(id) {
  try {
    await api(`/api/admin/verifications/${id}/action`, { method: 'POST', body: { action: 'reject' } });
    showToast(UI.VERIF_REJECTED_OK, 'success');
    loadAdminVerifications();
  } catch (err) { showToast(err.message, 'error'); }
}

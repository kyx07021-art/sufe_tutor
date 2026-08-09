// ============================================================
// R22（v0.25.87）· 投诉独立通道（前端）
//
// 与用户反馈彻底分离：独立浮窗组件（openComplaintModal，不复用 openFeedbackModal）、
// 独立数据通道（/api/complaints*）、独立管理员处理页（admin-complaint 侧栏项）。
// 参考正规平台举报流程收敛：对象（教师/学生/帖子）→ 预设理由 → 补充描述 → 确认提交。
//
// 对象选择组件人性化：
//   - 教师 / 学生选择组件分开（各自 pane），支持「最近联系的人」快捷选取 + id/昵称搜索；
//   - 帖子选择组件独立（id/标题搜索）；
//   - 组件内部子件用独立 cmp-* 类名，不受表单/弹窗祖先作用域污染（复合组件隔离铁律）。
//
// 提交后服务端快照被投诉对象、自投诉拦截、每日限额；用户可查「我的投诉」状态，
// 管理员在「投诉处理」页标记已处理并通知投诉人。
// ============================================================

// —— 状态（单实例；弹窗关闭不销毁，重开直接复用）——
const _cpSel = { teacher: null, student: null, post: null }; // 各 tab 独立选中槽
let _cpTab = 'teacher';                                        // 当前 tab
let _cpReason = '';                                            // 选中的理由
let _cpSeq = 0;                                                // 搜索竞态序号（防旧响应覆盖新结果）
let _cpTimer = null;                                           // 搜索防抖
let _cpRecentLoaded = new Set();                               // 各 pane 最近交互已拉取标记

// ============================================================
// 投诉浮窗（独立组件）——入口：设置页「投诉」按钮
// ============================================================
function openComplaintModal() {
  if (!ensureAuth()) return;
  _cpRecentLoaded.clear(); // 重开浮窗重拉「最近联系的人」（随会话变化）
  const picker = (type, withRecent) => {
    const recent = withRecent ? `<div class="cmp-recent" id="cmp-recent-${type}"></div>` : '';
    return `<div class="cmp-block">
      ${recent}
      <input type="text" class="form-input cmp-search" id="cmp-search-${type}"
        placeholder="${type === 'post' ? UI.COMPLAINT_SEARCH_POST_PLACEHOLDER : UI.COMPLAINT_SEARCH_PLACEHOLDER}"
        oninput="complaintSearchInput('${type}')" aria-label="${UI.COMPLAINT_SEARCH_PLACEHOLDER}">
      <div class="cmp-results" id="cmp-results-${type}"></div>
      <div class="cmp-selected" id="cmp-selected-${type}"></div>
    </div>`;
  };
  openModal({
    title: UI.COMPLAINT_MODAL_TITLE,
    titleId: 'complaint-modal-title',
    closable: false,
    body: `
      ${segTabsHtml([
        { key: 'teacher', label: UI.COMPLAINT_TAB_TEACHER, onclick: "switchComplaintTab('teacher')" },
        { key: 'student', label: UI.COMPLAINT_TAB_STUDENT, onclick: "switchComplaintTab('student')" },
        { key: 'post',    label: UI.COMPLAINT_TAB_POST,    onclick: "switchComplaintTab('post')" },
      ], _cpTab, { containerClass: 'complaint-tabs', attr: 'tab' })}
      <div class="complaint-pane" id="cmp-pane-teacher">${picker('teacher', true)}</div>
      <div class="complaint-pane hidden" id="cmp-pane-student">${picker('student', true)}</div>
      <div class="complaint-pane hidden" id="cmp-pane-post">${picker('post', false)}</div>
      <div class="form-group">
        <label class="form-label" id="complaint-reason-label">${UI.COMPLAINT_REASON_LABEL}</label>
        ${segTabsHtml(UI.COMPLAINT_REASONS.map((r, i) =>
          ({ key: String(i), label: r, onclick: `switchComplaintReason(${i})` })),
          '', { containerClass: 'complaint-reasons', attr: 'reason' })}
      </div>
      <div class="form-group">
        <label class="form-label" for="complaint-detail">${UI.COMPLAINT_DETAIL_LABEL}</label>
        <textarea id="complaint-detail" class="form-input" rows="5"
          placeholder="${UI.COMPLAINT_DETAIL_PLACEHOLDER}"></textarea>
      </div>`,
    footer: `<button type="button" class="btn btn-outline glass glass--pressable" onclick="closeModal()">${UI.BTN_CANCEL}</button>
      <button type="button" class="btn glass glass--pressable" onclick="submitComplaint()">${UI.BTN_SEND}</button>`,
  });
  // 打开即拉当前 tab 的最近交互
  complaintLoadRecent(_cpTab);
}

// 切 tab：显隐 pane + 激活 tab + 懒拉最近交互
function switchComplaintTab(tab) {
  _cpTab = tab;
  document.querySelectorAll('.complaint-tabs .seg-tab').forEach(b => b.classList.toggle('active', b.dataset.tab === tab));
  ['teacher', 'student', 'post'].forEach(t => {
    const pane = document.getElementById(`cmp-pane-${t}`);
    if (pane) pane.classList.toggle('hidden', t !== tab);
  });
  complaintLoadRecent(tab);
}

// 理由 pill 单选
function switchComplaintReason(i) {
  _cpReason = UI.COMPLAINT_REASONS[i] || '';
  document.querySelectorAll('.complaint-reasons .seg-tab').forEach(b => b.classList.toggle('active', b.dataset.reason === String(i)));
}

// ============================================================
// 对象选择组件：最近联系的人（懒拉一次）+ 搜索候选
// ============================================================
async function complaintLoadRecent(type) {
  if (!['teacher', 'student'].includes(type) || _cpRecentLoaded.has(type)) return;
  _cpRecentLoaded.add(type);
  const box = document.getElementById(`cmp-recent-${type}`);
  if (!box) return;
  try {
    const data = await api(`/api/complaints/recent?target=${type}`, { method: 'GET' });
    const list = data.candidates || [];
    if (!list.length) { box.innerHTML = ''; return; }
    box.innerHTML = `<span class="cmp-recent-label">${UI.COMPLAINT_RECENT_LABEL}</span>` +
      list.map(c => `<button type="button" class="cmp-chip glass glass--pressable" onclick="pickComplaintTarget('${type}',${c.id},this.dataset.name)" data-name="${escHtml(c.name)}">${escHtml(c.name)}</button>`).join('');
  } catch { box.innerHTML = ''; } // 静默：搜索兜底
}

// 搜索防抖 → 拉候选
function complaintSearchInput(type) {
  clearTimeout(_cpTimer);
  _cpTimer = setTimeout(() => complaintSearch(type, (document.getElementById(`cmp-search-${type}`)?.value || '').trim()), 300);
}

async function complaintSearch(type, q) {
  const box = document.getElementById(`cmp-results-${type}`);
  if (!box) return;
  if (!q) { box.innerHTML = ''; return; }
  const seq = ++_cpSeq;
  try {
    const data = await api(`/api/complaints/candidates?target=${type}&q=${encodeURIComponent(q)}`, { method: 'GET' });
    if (seq !== _cpSeq) return; // 已超车，丢弃
    const list = data.candidates || [];
    box.innerHTML = list.length
      ? list.map(c => `<button type="button" class="cmp-result glass glass--pressable" onclick="pickComplaintTarget('${type}',${c.id},this.dataset.name)" data-name="${escHtml(c.name)}">
          <span class="cmp-result-name">${escHtml(c.name)}</span>
          <span class="cmp-result-sub">${escHtml(c.subtitle || '')}</span></button>`).join('')
      : `<div class="cmp-empty">${UI.COMPLAINT_SEARCH_EMPTY}</div>`;
  } catch (err) {
    if (seq !== _cpSeq) return;
    box.innerHTML = `<div class="cmp-empty">${escHtml(err.message)}</div>`;
  }
}

// 选中对象：存槽 + 渲染选中区 + 清搜索。
// nameArg 双形态兼容：内联 onclick 传 this.dataset.name（字符串），jsdom 测试可传 {dataset:{name}}
function pickComplaintTarget(type, id, nameArg) {
  _cpSel[type] = { id, name: typeof nameArg === 'string' ? nameArg : nameArg.dataset.name };
  const name = escHtml(_cpSel[type].name);
  const box = document.getElementById(`cmp-selected-${type}`);
  if (box) box.innerHTML = `<span class="cmp-selected-chip glass glass--solid">${name}
    <button type="button" class="cmp-selected-x" aria-label="${UI.BTN_CANCEL}" onclick="clearComplaintTarget('${type}')">✕</button></span>`;
  const search = document.getElementById(`cmp-search-${type}`);
  if (search) { search.value = ''; document.getElementById(`cmp-results-${type}`).innerHTML = ''; }
  const alert = document.getElementById('complaint-alert');
  if (alert) alert.innerHTML = '';
}

function clearComplaintTarget(type) {
  _cpSel[type] = null;
  const box = document.getElementById(`cmp-selected-${type}`);
  if (box) box.innerHTML = '';
}

// ============================================================
// 提交投诉
// ============================================================
async function submitComplaint() {
  const target = _cpSel[_cpTab];
  if (!target) { showToast(UI.COMPLAINT_TARGET_REQUIRED, 'error'); return; }
  if (!_cpReason) { showToast(UI.COMPLAINT_REASON_REQUIRED, 'error'); return; }
  const detail = (document.getElementById('complaint-detail').value || '').trim();
  try {
    await api('/api/complaints', { method: 'POST', body: { targetType: _cpTab, targetId: target.id, reason: _cpReason, detail } });
    closeModal();
    showToast(UI.COMPLAINT_SENT_TOAST);
  } catch (err) {
    showToast(err.message, 'error');
  }
}

// ============================================================
// 我的投诉（状态跟踪闭环）——入口：设置页「我的投诉」按钮
// ============================================================
async function openMyComplaints() {
  if (!ensureAuth()) return;
  openModal({
    title: UI.COMPLAINT_MINE_TITLE,
    cls: 'modal--wide',
    bodyCls: 'my-complaints-body',
    body: `<div class="my-complaints-list">${loaderHtml()}</div>`,
  });
  try {
    const data = await api('/api/complaints/mine', { method: 'GET' });
    const list = data.complaints || [];
    const box = document.querySelector('#modal-container .my-complaints-list');
    if (!list.length) { box.innerHTML = `<div class="list-empty">${UI.COMPLAINT_MINE_EMPTY}</div>`; return; }
    box.innerHTML = list.map(c => {
      const resolved = c.status === STATUS.RESOLVED;
      const snap = c.target_snapshot || {};
      const typeName = c.target_type === 'teacher' ? UI.COMPLAINT_TAB_TEACHER : c.target_type === 'student' ? UI.COMPLAINT_TAB_STUDENT : UI.COMPLAINT_TAB_POST;
      return `<div class="list-card glass complaint-card${resolved ? ' complaint-card--resolved' : ''}">
        <div class="list-card-header">
          <span class="list-card-title">${escHtml(snap.name || '')}</span>
          <span class="complaint-tags">
            <span class="tag glass glass--solid tag-accent">${escHtml(typeName)}</span>
            <span class="tag glass glass--solid ${resolved ? 'tag-ok' : 'tag-warn'}">${resolved ? UI.COMPLAINT_STATUS_RESOLVED : UI.COMPLAINT_STATUS_OPEN}</span>
          </span>
        </div>
        <div class="list-card-detail">${escHtml(c.reason)}${c.detail ? `<div class="complaint-detail">${escHtml(c.detail)}</div>` : ''}</div>
        <div class="complaint-foot"><span class="list-card-meta">${fmtDateTime(c.created_at)}</span></div>
      </div>`;
    }).join('');
  } catch (err) {
    const box = document.querySelector('#modal-container .my-complaints-list');
    box.innerHTML = `<div class="list-empty">${escHtml(err.message)}</div>`;
  }
}

// ============================================================
// 管理员：投诉处理（独立侧栏页 admin-complaint，仅此一层接入管理员）
// ============================================================
async function loadAdminComplaints() {
  setBadge('admin-complaint', 0); // 点开瞬间红点即灭（新投诉由轮询在离开本页后重新点亮）
  await loadInto('admin-complaint-list', async () => {
    const data = await dhGet('/api/complaints', { domain: 'admin' });
    return data.complaints || [];
  }, list => list.map(c => {
    const resolved = c.status === STATUS.RESOLVED;
    const snap = c.target_snapshot || {};
    const typeName = c.target_type === 'teacher' ? UI.COMPLAINT_TAB_TEACHER : c.target_type === 'student' ? UI.COMPLAINT_TAB_STUDENT : UI.COMPLAINT_TAB_POST;
    return `<div class="list-card glass complaint-card${resolved ? ' complaint-card--resolved' : ''}">
      <div class="list-card-header">
        <span class="list-card-title">${escHtml(snap.name || '')}</span>
        <span class="complaint-tags">
          <span class="tag glass glass--solid tag-accent">${escHtml(typeName)}</span>
          <span class="tag glass glass--solid ${resolved ? 'tag-ok' : 'tag-warn'}">${resolved ? UI.COMPLAINT_STATUS_RESOLVED : UI.COMPLAINT_STATUS_OPEN}</span>
        </span>
      </div>
      <div class="list-card-detail">${escHtml(c.reason)}${c.detail ? `<div class="complaint-detail">${escHtml(c.detail)}</div>` : ''}</div>
      <div class="complaint-foot">
        <span class="list-card-meta">投诉人 ${escHtml(c.reporter)} · ${fmtDateTime(c.created_at)}</span>
        ${resolved ? '' : `<button type="button" class="btn btn-outline btn-xs glass glass--pressable" onclick="resolveAdminComplaint(${c.id})">${UI.BTN_COMPLAINT_RESOLVE}</button>`}
      </div>
    </div>`;
  }).join(''), { empty: UI.ADMIN_COMPLAINT_EMPTY });
}

// 标记投诉已处理（后端通知投诉人）
async function resolveAdminComplaint(complaintId) {
  try {
    await api(`/api/complaints/${complaintId}/resolve`, { method: 'POST' });
    showToast(UI.COMPLAINT_RESOLVED_TOAST);
    invalidate('admin');
    loadAdminComplaints();
  } catch (err) { showToast(err.message); }
}

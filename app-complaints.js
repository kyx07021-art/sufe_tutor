// ============================================================
// 投诉独立通道（前端）：独立浮窗 + 独立数据通道 + 独立处理页（admin-complaint）
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
let _cpStaged = [];    // U11：投诉附件暂存项（预览/上传逻辑复用聊天暂存区，状态独立防跨模块耦合）
let _cpStageSeq = 0;   // U11：暂存项自增序号（与聊天 chatStageSeq 互不干扰）

// ============================================================
// 投诉浮窗（独立组件）——入口：设置页「投诉」按钮
// ============================================================
function openComplaintModal() {
  if (!ensureAuth()) return;
  // U11 审查 F1：重开浮窗先清上一会话的暂存——头部 ✕（app-ui 写死 closeModal）与登出 closeAllModals
  // 都不经底部取消的 complaintResetStage，残留会占满附件容量（room=0 无法再加）且旧 uploadId 被静默带进下次投诉
  complaintResetStage();
  _cpRecentLoaded.clear(); // 重开浮窗重拉「最近联系的人」（随会话变化）
  const picker = (type, withRecent) => {
    // M10：三 tab 布局统一——搜索框在选项卡下、最近联系区在搜索框下边；
    // 帖子 tab 也渲染同高占位的 .cmp-recent（aria-hidden），三界面「最近联系过」区域
    // 至少空出一行同高，不因数据多寡动态撑高度（用户反馈：三 tab 页面尺寸不一致）。
    const recent = withRecent
      ? `<div class="cmp-recent" id="cmp-recent-${type}"></div>`
      : `<div class="cmp-recent cmp-recent--reserved" aria-hidden="true"></div>`;
    return `<div class="cmp-block">
      <input type="text" class="form-input cmp-search" id="cmp-search-${type}"
        placeholder="${type === 'post' ? UI.COMPLAINT_SEARCH_POST_PLACEHOLDER : UI.COMPLAINT_SEARCH_PLACEHOLDER}"
        oninput="complaintSearchInput('${type}')" aria-label="${UI.COMPLAINT_SEARCH_PLACEHOLDER}">
      <div class="cmp-results" id="cmp-results-${type}"></div>
      <div class="cmp-selected" id="cmp-selected-${type}"></div>
      ${recent}
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
        <!-- M8：投诉理由从切换式 tab（理由多、总宽固定必换行变高）改下拉栏 -->
        <select class="form-select complaint-reason-sel" id="complaint-reason" onchange="switchComplaintReason(this)">
          <option value="">${UI.COMPLAINT_REASON_PLACEHOLDER}</option>
          ${UI.COMPLAINT_REASONS.map(r => `<option value="${escHtml(r)}">${escHtml(r)}</option>`).join('')}
        </select>
      </div>
      <div class="form-group">
        <label class="form-label" for="complaint-detail">${UI.COMPLAINT_DETAIL_LABEL}</label>
        <textarea id="complaint-detail" class="form-input" rows="5"
          placeholder="${UI.COMPLAINT_DETAIL_PLACEHOLDER}"></textarea>
      </div>
      <div class="form-group">
        <label class="form-label">${UI.COMPLAINT_ATTACH_LABEL}</label>
        <div class="complaint-attach-row">
          <label class="complaint-attach-btn glass glass--pressable" for="complaint-file-input">${UI.COMPLAINT_ATTACH_ADD}</label>
          <input type="file" id="complaint-file-input" class="sr-file-input" multiple
            accept="image/*,.pdf,.doc,.docx,.txt,.xls,.xlsx,.ppt,.pptx,.zip" onchange="complaintStageFiles(this)">
          <div class="chat-stage hidden glass" id="complaint-stage"></div>
        </div>
      </div>`,
    footer: `<button type="button" class="btn btn-outline glass glass--pressable" onclick="closeComplaintModal()">${UI.BTN_CANCEL}</button>
      <button type="button" class="btn glass glass--pressable" onclick="submitComplaint()">${UI.BTN_SEND}</button>`,
  });
  // 打开即拉当前 tab 的最近交互
  complaintLoadRecent(_cpTab);
  // M8：投诉理由下拉换自定义组件（同签约/合同 modal 先例）
  initCustomSelects(document.getElementById('complaint-reason') && document.getElementById('complaint-reason').closest('.modal'));
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

// 理由下拉选择（M8：替代原 pill 单选）
function switchComplaintReason(sel) {
  _cpReason = sel && sel.value ? sel.value : '';
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
// M9：呈现从「可叉掉小 tag」改「已选择：xxx + 更换」单选行（radio 语义，
// 替换按钮代替 ✕ 叉，候选行保留高亮供直接换选）。nameArg 双形态兼容：
// 内联 onclick 传 this.dataset.name（字符串），jsdom 测试可传 {dataset:{name}}
function pickComplaintTarget(type, id, nameArg) {
  _cpSel[type] = { id, name: typeof nameArg === 'string' ? nameArg : nameArg.dataset.name };
  const name = escHtml(_cpSel[type].name);
  const box = document.getElementById(`cmp-selected-${type}`);
  if (box) box.innerHTML = `<span class="cmp-selected-line">${UI.COMPLAINT_SELECTED_PREFIX}<strong>${name}</strong>
    <button type="button" class="btn-text cmp-selected-change" onclick="clearComplaintTarget('${type}')">${UI.COMPLAINT_CHANGE_TARGET}</button></span>`;
  // 最近候选行高亮当前选中（单选反馈；搜索结果选中后已清空）
  document.querySelectorAll(`#cmp-recent-${type} .cmp-chip`).forEach(el => {
    el.classList.toggle('selected', el.dataset.name === _cpSel[type].name);
  });
  const search = document.getElementById(`cmp-search-${type}`);
  if (search) { search.value = ''; document.getElementById(`cmp-results-${type}`).innerHTML = ''; }
  const alert = document.getElementById('complaint-alert');
  if (alert) alert.innerHTML = '';
}

function clearComplaintTarget(type) {
  _cpSel[type] = null;
  const box = document.getElementById(`cmp-selected-${type}`);
  if (box) box.innerHTML = '';
  document.querySelectorAll(`#cmp-recent-${type} .cmp-chip`).forEach(el => el.classList.remove('selected'));
}

// ============================================================
// U11：投诉附件暂存区（预览样式/上传/压缩完全复用聊天附件暂存逻辑；状态独立防跨模块耦合）
// ============================================================
function complaintStageFiles(input) {
  const files = input ? [...input.files] : []; // 活引用先拷贝（input.files 铁律）
  if (input) input.value = '';                 // 清空允许重复选同一文件
  const room = CONFIG.COMPLAINT_ATTACH_MAX - _cpStaged.length;
  if (files.length > room) { showToast(UI.COMPLAINT_ATTACH_TOO_MANY, 'error'); files.length = room; }
  files.forEach(f => {
    const item = { id: ++_cpStageSeq, name: f.name || UI.CHAT_FILE_FALLBACK, progress: 0, ready: false, uploadId: null, dataUrl: '', thumb: '' };
    if ((f.type || '').startsWith('image/')) {
      item.kind = 'image';
      _cpStaged.push(item);
      renderComplaintStage();
      const reader = new FileReader();
      reader.onload = () => chatShrinkImage(reader.result, (url, thumb) => complaintDoUpload(item, url, thumb)); // 先本地压缩+缩略图再传（同聊天）
      reader.onerror = () => { complaintUnstage(item.id); showToast(UI.CHAT_FILE_TOO_LARGE); };
      reader.readAsDataURL(f);
    } else {
      if (f.size > CONFIG.CHAT_FILE_MAX_BYTES) { showToast(UI.CHAT_FILE_TOO_LARGE); return; }
      item.kind = 'file';
      _cpStaged.push(item);
      renderComplaintStage();
      const reader = new FileReader();
      reader.onload = () => complaintDoUpload(item, reader.result);
      reader.onerror = () => { complaintUnstage(item.id); showToast(UI.CHAT_FILE_TOO_LARGE); };
      reader.readAsDataURL(f);
    }
  });
}

// 进暂存 = 真实上传（XHR 进度圈），传完拿 uploadId 变为可提交（同聊天 chatDoUpload）
async function complaintDoUpload(item, dataUrl, thumbUrl) {
  item.dataUrl = dataUrl;
  item.thumb = thumbUrl || '';
  renderComplaintStage(); // 图片缩略先亮（本地数据），进度圈转真实上传进度
  try {
    const data = await chatUploadToServer(item, dataUrl, p => { item.progress = p; renderComplaintStage(); });
    if (item._aborted) return; // 上传期间浮窗已关：不把 uploadId 写进孤儿项
    item.uploadId = data.id;
    item.progress = 100;
    item.ready = true;
    renderComplaintStage();
  } catch (err) {
    if (item._aborted) return;
    complaintUnstage(item.id);
    showToast(err.message);
  }
}

function complaintUnstage(id) {
  const it = _cpStaged.find(x => x.id === id);
  _cpStaged = _cpStaged.filter(x => x.id !== id);
  renderComplaintStage();
  if (it && it.uploadId) {
    api(`/api/uploads/${it.uploadId}`, { method: 'DELETE', body: {} }).catch(() => {}); // 已上传：best-effort 删暂存
  }
}

// 浮窗关闭/提交成功：abort 在途上传 + 已上传 best-effort 删（与聊天切会话 chatAbortStagedUploads 同款，防孤儿暂存）
function complaintResetStage() {
  _cpStaged.forEach(it => {
    if (it._xhr) { it._xhr.abort(); it._aborted = true; }
    if (it.uploadId) api(`/api/uploads/${it.uploadId}`, { method: 'DELETE', body: {} }).catch(() => {});
  });
  _cpStaged = [];
  const box = document.getElementById('complaint-stage');
  if (box) { box.classList.add('hidden'); box.innerHTML = ''; }
}

function renderComplaintStage() {
  renderStageBox(_cpStaged, document.getElementById('complaint-stage'), it => `complaintUnstage(${it.id})`);
}

function closeComplaintModal() {
  complaintResetStage();
  closeModal();
}

// ============================================================
// 提交投诉
// ============================================================
async function submitComplaint() {
  const target = _cpSel[_cpTab];
  if (!target) { showToast(UI.COMPLAINT_TARGET_REQUIRED, 'error'); return; }
  if (!_cpReason) { showToast(UI.COMPLAINT_REASON_REQUIRED, 'error'); return; }
  if (_cpStaged.some(it => !it.ready)) { showToast(UI.COMPLAINT_ATTACH_UPLOADING, 'error'); return; } // 在途/未传完拦截（同聊天 CHAT_STAGE_WAIT）
  const detail = (document.getElementById('complaint-detail').value || '').trim();
  const uploadIds = _cpStaged.map(it => it.uploadId).filter(Boolean);
  try {
    await api('/api/complaints', { method: 'POST', body: { targetType: _cpTab, targetId: target.id, reason: _cpReason, detail, uploadIds } });
    complaintResetStage(); // 后端已从暂存复制入投诉并删除暂存，本地清空（幂等：_cpStaged 已空则 no-op）
    closeModal();
    showToast(UI.COMPLAINT_SENT_TOAST);
  } catch (err) {
    showToast(err.message, 'error');
  }
}

// ============================================================
// 我的投诉展示合并进 openMyFeedback（app-posts）「我的投诉与反馈」浮窗，本文件不重复实现。
// ============================================================
// 管理员：投诉处理（独立侧栏页 admin-complaint，仅此一层接入管理员）
// ============================================================
// A1 审计：投诉卡 HTML 单源——管理员处理页（本函数）与「我的投诉与反馈」合并浮窗
// （app-posts.openMyFeedback）共用同一份卡片结构/状态 tag/对象类型映射（DISP.complaintTargetName）。
// opts.foot：默认管理员版（投诉人 + 标记已处理按钮）；用户端 openMyFeedback 传只含时间戳的 foot。
function complaintCardHtml(c, opts = {}) {
  const resolved = c.status === STATUS.RESOLVED;
  const snap = c.target_snapshot || {};
  const typeName = DISP.complaintTargetName(c.target_type);
  const foot = opts.foot ?? `<span class="list-card-meta">投诉人 ${escHtml(c.reporter)} · ${fmtDateTime(c.created_at)}</span>
      ${resolved ? '' : `<button type="button" class="btn btn-outline btn-xs glass glass--pressable" onclick="resolveAdminComplaint(${c.id})">${UI.BTN_COMPLAINT_RESOLVE}</button>`}`;
  // U11：附件缩略行——图片显示缩略图（点开拉原图）、文件显示扩展名徽标（点开下载）；本人/管理员均可看（服务端鉴权）
  const attaches = (c.attachments || []).length
    ? `<div class="complaint-attaches">${(c.attachments || []).map((a, i) => a.kind === 'image'
        ? `<button type="button" class="complaint-attach glass glass--solid" onclick="complaintOpenAttachment(${c.id},${i})" aria-label="${UI.CHAT_ATTACH_IMAGE}">
            <img src="${escHtml(a.thumb || '')}" alt="${UI.CHAT_ATTACH_IMAGE}" loading="lazy"></button>`
        : `<button type="button" class="complaint-attach complaint-attach--file glass glass--solid" onclick="complaintOpenAttachment(${c.id},${i})" title="${escHtml(a.name || '')}">
            <span class="chat-stage-ext">${escHtml(chatFileExt(a.name))}</span></button>`).join('')}</div>`
    : '';
  return `<div class="list-card glass complaint-card${resolved ? ' complaint-card--resolved' : ''}">
    <div class="list-card-header">
      <span class="list-card-title">${escHtml(snap.name || '')}</span>
      <span class="complaint-tags">
        <span class="tag glass glass--solid tag-accent">${escHtml(typeName)}</span>
        <span class="tag glass glass--solid ${resolved ? 'tag-ok' : 'tag-warn'}">${resolved ? UI.COMPLAINT_STATUS_RESOLVED : UI.COMPLAINT_STATUS_OPEN}</span>
      </span>
    </div>
    <div class="list-card-detail">${escHtml(c.reason)}${c.detail ? `<div class="complaint-detail">${escHtml(c.detail)}</div>` : ''}${attaches}</div>
    <div class="complaint-foot">${foot}</div>
  </div>`;
}

// U11：投诉附件懒加载（body 大字段随列表不下发，与聊天附件同款按需拉取）
async function complaintOpenAttachment(complaintId, idx) {
  try {
    const data = await api(`/api/complaints/${complaintId}/attachment?idx=${idx}`, { method: 'GET' });
    if (!data.body) { showToast(UI.COMPLAINT_ATTACH_FAIL); return; }
    if (data.kind === 'image') { openImageViewer(data.body); return; } // 通用大图查看器（app-ui）
    const href = String(data.body).startsWith('data:') ? data.body : '#'; // 客户端 scheme 自守（同聊天文件卡）
    const a = document.createElement('a');
    a.href = href; a.download = data.name || UI.CHAT_FILE_FALLBACK;
    document.body.appendChild(a); a.click(); a.remove();
  } catch (err) { showToast(err.message || UI.COMPLAINT_ATTACH_FAIL); }
}

async function loadAdminComplaints() {
  setBadge('admin-complaint', 0); // 点开瞬间红点即灭（新投诉由轮询在离开本页后重新点亮）
  await loadInto('admin-complaint-list', async () => {
    const data = await dhGet('/api/complaints', { domain: 'admin' });
    return data.complaints || [];
  }, list => list.map(c => complaintCardHtml(c)).join(''), { empty: UI.ADMIN_COMPLAINT_EMPTY });
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

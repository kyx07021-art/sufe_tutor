/**
 * 上财家教平台 - 合同模块（学生+教师）
 *
 * 职责：我的合同列表 / 合同卡片渲染 / 签约·修改·撤销·取消 / 合同起草（聊天窗呼出）/ 存证校验。
 * 本文件在 app.js 之后加载，可安全调用 app.js 全局设施（api/state/UI/loadInto/invalidate/escHtml 等）。
 * 函数一律保持 function 声明式（内联 onclick 靠它挂全局）。
 */

// ============================================================
// 我的合同（学生+教师）：草案确认 → 正式合同预览/修改 → 双方确认签约 → signed。
// 合同正文为 Markdown（服务端 buildContractMd 生成），修改经 PUT 实时同步给另一方。
// 测试版：确认签约以二次确认代替短信验证（后端 verifySignOtp 预留）。
// ============================================================

// 该合同当前是否需要我处理（侧栏红点口径）
function contractActionable(c) {
  const iAmDrafter = c.drafter_user_id === state.user.id;
  if (c.status === 'pending') return !iAmDrafter;                    // 对方起草，待我确认草案
  if (c.status === 'signing') return !(iAmDrafter ? c.drafter_confirmed : c.other_confirmed); // 待我确认签约
  return false;
}

async function loadMyContracts() {
  const el = document.getElementById('my-contracts-list');
  setBadge('my-contracts', 0); // 点开瞬间红点即灭（有待办由下一轮轮询在离开本页后重新点亮）
  el.innerHTML = `<div class="empty-state">${loaderHtml()}</div>`;
  try {
    const data = await api('/api/contracts/my');
    state.myContracts = data.contracts || [];
    renderMyContractsList();
  } catch (err) {
    el.innerHTML = `<div class="empty-state"><p>${UI.ERROR_LOAD_PREFIX}${escHtml(err.message)}</p></div>`;
  }
}

// 合同列表渲染（进页加载与 30s 轮询就地刷新共用——对方改合同后不必退出重进）
function renderMyContractsList() {
  const el = document.getElementById('my-contracts-list');
  if (!el) return;
  if (!state.myContracts.length) { el.innerHTML = `<div class="empty-state"><p>${UI.CONTRACT_EMPTY_LIST}</p></div>`; return; }
  el.innerHTML = state.myContracts.map(renderContractCard).join('');
  initReveals(el);
}

function renderContractCard(c) {
  const me = state.user.id;
  const iAmDrafter = c.drafter_user_id === me;
  const peerName = me === c.student_user_id ? c.teacher_name : c.student_name;
  const methodName = TEACHING_METHODS.find(m => m.id === c.method)?.name || c.method;
  const statusText = c.status === 'pending' ? UI.CONTRACT_STATUS_PENDING
    : c.status === 'signing' ? UI.CONTRACT_STATUS_SIGNING : UI.CONTRACT_STATUS_SIGNED;
  const statusCls = c.status === 'signed' ? 'tag-ok' : c.status === 'signing' ? 'tag-warn' : 'tag-accent';
  const myConfirmed = iAmDrafter ? c.drafter_confirmed : c.other_confirmed;

  let left = '', right = '';
  if (c.status === 'signed') {
    left = `<button type="button" class="btn btn-outline btn-sm" onclick="viewContract(${c.id})">${UI.BTN_VIEW_CONTRACT}</button>
      <button type="button" class="btn btn-ghost btn-sm" onclick="verifyContractLedgerUi(${c.id})">${UI.BTN_VERIFY_LEDGER}</button>`;
    right = `<button type="button" class="btn-text-danger" onclick="openRevokeContractModal(${c.id})">${UI.BTN_REVOKE_CONTRACT}</button>`; // 撤销入口刻意低调
  } else if (c.status === 'pending' && iAmDrafter) {
    // 起草方：等对方处理草案（对方直接看到三按钮，无独立「确认草案」环节）
    left = `<button type="button" class="btn btn-sm btn-intent-wait" disabled>${UI.CONTRACT_WAIT_DRAFT}</button>`;
    right = `<button type="button" class="btn btn-danger btn-sm" onclick="cancelContract(${c.id})">${UI.BTN_CANCEL_CONTRACT}</button>`;
  } else {
    // pending 收草案方 / signing 双方：直接三按钮（确认签约 / 修改内容 / 查看合同）
    left = `${myConfirmed
        ? `<button type="button" class="btn btn-sm btn-intent-wait" disabled>${UI.BTN_SIGN_WAITING}</button>`
        : `<button type="button" class="btn btn-accent btn-sm" onclick="signContract(${c.id})">${UI.BTN_SIGN}</button>`}
      <button type="button" class="btn btn-outline btn-sm" onclick="openContractModifyModal(${c.id})">${UI.BTN_MODIFY_CONTRACT}</button>
      <button type="button" class="btn btn-outline btn-sm" onclick="viewContract(${c.id})">${UI.BTN_VIEW_CONTRACT}</button>`;
    right = `<button type="button" class="btn btn-danger btn-sm" onclick="cancelContract(${c.id})">${UI.BTN_CANCEL_CONTRACT}</button>`;
  }

  return `<div class="list-card">
    <div class="list-card-header">
      <span class="list-card-title">${renderUsername(peerName)}</span>
      <span class="tag ${statusCls}">${statusText}</span>
    </div>
    <div class="list-card-body">
      <span class="tag">${escHtml(methodName)}</span>
      <span class="tag tag-warn">${c.hourly_rate}${UI.PRICE_UNIT}</span>
      ${c.demand_display_id ? `<span class="tag">${escHtml(UI.DEMAND_PREFIX)}#${String(c.demand_display_id).padStart(4, '0')}</span>` : ''}
      <span class="list-card-meta">${fmtDateTime(c.updated_at)}</span>
    </div>
    <div class="contract-actions">
      <div class="contract-actions-left">${left}</div>
      ${right}
    </div>
  </div>`;
}

// 确认签约：测试版二次确认代替短信验证（后端 verifySignOtp 预留接口）
function signContract(contractId) {
  openConfirmModal(UI.CONFIRM_SIGN, async () => {
    try {
      const data = await api(`/api/contracts/${contractId}/sign`, { method: 'POST', body: {} });
      showToast(data.signed ? UI.CONTRACT_SIGNED_TOAST : UI.BTN_SIGN_WAITING);
      invalidate('contracts'); // 签约改合同状态：清缓存，面板「已签约」标记/合同页下次读取重拉
      loadMyContracts();
    } catch (err) { showToast(err.message); }
  });
}

// 查看正式合同预览（Markdown 渲染，复用发帖组件的 mdRender）
function viewContract(contractId) {
  const c = state.myContracts.find(x => x.id === contractId);
  if (!c) return;
  document.getElementById('modal-container').innerHTML = `<div class="modal-overlay" onclick="if(event.target===this)closeModal()">
    <div class="modal">
      <div class="modal-header"><h2>${UI.BTN_VIEW_CONTRACT}</h2><button type="button" class="btn btn-ghost btn-icon" onclick="closeModal()">✕</button></div>
      <div class="modal-body contract-md">${mdRender(c.contract_md || '')}</div>
    </div>
  </div>`;
}

// 修改合同内容：复用发帖组件的 Markdown 编辑器（同套 id，弹窗互斥）
function openContractModifyModal(contractId) {
  const c = state.myContracts.find(x => x.id === contractId);
  if (!c) return;
  window._contractModifyUpdatedAt = c.updated_at; // 乐观锁版本：提交时带上，期间被对方改过则 409 强制重载
  document.getElementById('modal-container').innerHTML = `<div class="modal-overlay">
    <div class="modal">
      <div class="modal-header"><h2>${UI.MODIFY_CONTRACT_TITLE}</h2><button type="button" class="btn btn-ghost btn-icon" onclick="closeModal()">✕</button></div>
      <div class="modal-body">
        <div id="post-alert"></div>
        <div class="form-group">
          <label class="form-label">${UI.LABEL_CONTRACT_PLAN}</label>
          <div class="md-toolbar">
            <button type="button" class="md-btn" onclick="mdWrap('h2')">H2</button>
            <button type="button" class="md-btn" onclick="mdWrap('h3')">H3</button>
            <button type="button" class="md-btn" onclick="mdWrap('bold')">${UI.POST_MD_BOLD}</button>
            <!-- 合同编辑器禁插图：合同正文须为纯文本条款 -->
          </div>
          <textarea id="post-body" class="form-input post-body-input" rows="12" oninput="updatePostPreview()">${escHtml(c.contract_md || '')}</textarea>
        </div>
        <div class="form-group">
          <label class="form-label">${UI.POST_PREVIEW_LABEL}</label>
          <div id="post-preview" class="md-preview"></div>
        </div>
        <div class="modal-footer">
          <button type="button" class="btn btn-outline" onclick="closeModal()">${UI.BTN_CANCEL}</button>
          <button type="button" class="btn btn-primary" onclick="submitContractModify(${c.id})">${UI.BTN_SAVE}</button>
        </div>
      </div>
    </div>
  </div>`;
  updatePostPreview();
}

// 撤销已签约合同：两级确认。第一级告知法律后果与数据影响（不显眼，防误触），
// 第二级复用 openConfirmModal 危险确认。活跃库抹除合同，签署台账与加密留档保留。
function openRevokeContractModal(contractId) {
  document.getElementById('modal-container').innerHTML = `<div class="modal-overlay" onclick="if(event.target===this)closeModal()">
    <div class="modal" style="max-width:430px;">
      <div class="modal-header"><h2>${UI.REVOKE_MODAL_TITLE}</h2><button type="button" class="btn btn-ghost btn-icon" onclick="closeModal()">✕</button></div>
      <div class="modal-body">
        <p class="danger-warn">${UI.REVOKE_CONTRACT_WARN}</p>
        <div class="modal-footer">
          <button type="button" class="btn btn-outline" onclick="closeModal()">${UI.BTN_THINK_AGAIN}</button>
          <button type="button" class="btn btn-outline btn-sm" onclick="confirmRevokeContract(${contractId})">${UI.BTN_CONTINUE_DANGER}</button>
        </div>
      </div>
    </div>
  </div>`;
}
function confirmRevokeContract(contractId) {
  openConfirmModal(UI.REVOKE_CONTRACT_FINAL, async () => {
    try {
      await api(`/api/contracts/${contractId}/revoke`, { method: 'POST', body: {} });
      showToast(UI.CONTRACT_REVOKED_TOAST);
      invalidate('contracts'); // 撤销后签约标记须消失
      loadMyContracts();
    } catch (err) { showToast(err.message); }
  });
}

// 存证校验：重算合同文本哈希对比签署时的台账指纹（后端 /api/contracts/:id/verify）
async function verifyContractLedgerUi(contractId) {
  try {
    const data = await api(`/api/contracts/${contractId}/verify`);
    showToast(!data.recorded ? UI.CONTRACT_LEDGER_NONE : data.archived ? UI.CONTRACT_LEDGER_ARCHIVED
      : data.valid ? UI.CONTRACT_LEDGER_VALID : UI.CONTRACT_LEDGER_INVALID);
  } catch (err) { showToast(err.message); }
}

async function submitContractModify(contractId) {
  const md = (document.getElementById('post-body').value || '').trim();
  const alertEl = document.getElementById('post-alert');
  if (!md) { alertEl.innerHTML = `<div class="alert alert-error">${UI.CONTRACT_EMPTY}</div>`; return; }
  try {
    await api(`/api/contracts/${contractId}`, { method: 'PUT', body: { contractMd: md, updatedAt: window._contractModifyUpdatedAt } });
    closeModal();
    showToast(UI.CONTRACT_MODIFIED_TOAST);
    loadMyContracts();
  } catch (err) {
    alertEl.innerHTML = `<div class="alert alert-error">${escHtml(err.message)}</div>`;
  }
}

// 取消签约：二次确认 → 删合同 + 通知对方（后端），会话保留
function cancelContract(contractId) {
  openConfirmModal(UI.CONFIRM_CANCEL_CONTRACT, async () => {
    try {
      await api(`/api/contracts/${contractId}`, { method: 'DELETE', body: {} });
      showToast(UI.CONTRACT_CANCELLED_TOAST);
      invalidate('contracts');
      loadMyContracts();
    } catch (err) { showToast(err.message); }
  });
}

// 起草合同（聊天窗 + 号呼出）：先选对应需求 → 预载配置（科目/方式/预算）→ 教学方式 / 授课时间 /
// 授课地点 / 约定时薪 / 教学方案（md 编辑器，合同文本禁插图）→ 发送另一方确认
async function openContractDraftModal(convId) {
  document.getElementById('modal-container').innerHTML = `<div class="modal-overlay"><div class="modal"><div class="modal-body">${loaderHtml()}</div></div></div>`;
  let demands = [], demandsFailed = false;
  try { const data = await api('/api/student/demands'); demands = data.demands || []; } catch { demandsFailed = true; /* 拉取失败仍可起草（不绑需求），弹窗内明示 */ }
  const conv = (typeof chatConvById === 'function') ? chatConvById(convId) : null;
  // 学生：自己全部 open 需求；教师：该会话学生方的全部 open 需求（同一师生对多需求共用一个会话，
  // 不只限会话绑定那一条；绑到他人需求的越权由服务端归属硬校验拦截）
  const options = state.user.role === 'student'
    ? demands.filter(d => d.user_id === state.user.id && d.status !== 'contracted')
    : demands.filter(d => conv && d.user_id === conv.student_user_id && d.status !== 'contracted');
  const preselect = (conv && options.find(d => d.id === conv.demand_id)) || options[0] || null;
  window._contractDraftDemands = options; // 供 prefillContractFromDemand 取数
  document.getElementById('modal-container').innerHTML = `<div class="modal-overlay">
    <div class="modal">
      <div class="modal-header"><h2>${UI.DRAFT_MODAL_TITLE}</h2><button type="button" class="btn btn-ghost btn-icon" onclick="closeModal()">✕</button></div>
      <div class="modal-body">
        <div id="contract-alert">${demandsFailed ? `<div class="alert alert-error">${UI.CONTRACT_DEMANDS_LOAD_FAIL}</div>` : ''}</div>
        <div class="form-group">
          <label class="form-label">${UI.LABEL_CONTRACT_DEMAND}</label>
          <select class="form-select" id="contract-demand" onchange="prefillContractFromDemand()">
            <option value="">${UI.CONTRACT_NO_DEMAND_OPTION}</option>
            ${options.map(d => `<option value="${d.id}"${preselect && d.id === preselect.id ? ' selected' : ''}>#${String(d.display_id || d.id).padStart(4, '0')} · ${escHtml(DISP.subjectNames(d.target_subjects) || '—')}</option>`).join('')}
          </select>
        </div>
        <div class="form-group">
          <label class="form-label">${UI.LABEL_CONTRACT_METHOD}</label>
          <select class="form-select" id="contract-method">
            ${TEACHING_METHODS.map(m => `<option value="${m.id}">${m.name}</option>`).join('')}
          </select>
        </div>
        <div class="form-group">
          <label class="form-label">${UI.LABEL_CONTRACT_SCHEDULE}</label>
          <input type="text" class="form-input" id="contract-schedule" maxlength="200" placeholder="${UI.CONTRACT_SCHEDULE_PLACEHOLDER}">
        </div>
        <div class="form-group">
          <label class="form-label">${UI.LABEL_CONTRACT_LOCATION}</label>
          <input type="text" class="form-input" id="contract-location" maxlength="100" placeholder="${UI.CONTRACT_LOCATION_PLACEHOLDER}">
          <div class="form-note-block">${UI.CONTRACT_LOCATION_NOTE}</div>
        </div>
        <div class="form-group">
          <label class="form-label">${UI.LABEL_CONTRACT_RATE}</label>
          <input type="number" class="form-input" id="contract-rate" min="0" step="1" placeholder="${UI.CONTRACT_PRICE_PLACEHOLDER}">
        </div>
        <div class="form-group">
          <label class="form-label">${UI.LABEL_CONTRACT_PAY_METHOD}</label>
          <select class="form-select" id="contract-pay-method" onchange="contractToggleOther('contract-pay-method','contract-pay-method-other-wrap')">
            <option value="per_session">${UI.PAY_METHOD_PER_SESSION}</option>
            <option value="weekly">${UI.PAY_METHOD_WEEKLY}</option>
            <option value="monthly">${UI.PAY_METHOD_MONTHLY}</option>
            <option value="other">${UI.PAY_METHOD_OTHER}</option>
          </select>
          <div class="form-other-wrap hidden" id="contract-pay-method-other-wrap">
            <input type="text" class="form-input" id="contract-pay-method-other" maxlength="100" placeholder="${UI.CONTRACT_PAY_METHOD_OTHER_PLACEHOLDER}">
          </div>
        </div>
        <div class="form-group">
          <label class="form-label">${UI.LABEL_CONTRACT_FIRST_LESSON}</label>
          <input type="date" class="form-input" id="contract-first-lesson">
        </div>
        <div class="form-group">
          <label class="form-label">${UI.LABEL_CONTRACT_TRIAL_PAY}</label>
          <select class="form-select" id="contract-trial-pay" onchange="contractToggleOther('contract-trial-pay','contract-trial-pay-other-wrap')">
            <option value="first_free">${UI.TRIAL_PAY_FIRST_FREE}</option>
            <option value="first_hour_free">${UI.TRIAL_PAY_FIRST_HOUR_FREE}</option>
            <option value="normal">${UI.TRIAL_PAY_NORMAL}</option>
            <option value="other">${UI.TRIAL_PAY_OTHER}</option>
          </select>
          <div class="form-other-wrap hidden" id="contract-trial-pay-other-wrap">
            <input type="text" class="form-input" id="contract-trial-pay-other" maxlength="100" placeholder="${UI.CONTRACT_TRIAL_PAY_OTHER_PLACEHOLDER}">
          </div>
        </div>
        <div class="form-group">
          <label class="form-label">${UI.LABEL_CONTRACT_PLAN}</label>
          <div class="md-toolbar">
            <button type="button" class="md-btn" onclick="mdWrap('h2')">H2</button>
            <button type="button" class="md-btn" onclick="mdWrap('h3')">H3</button>
            <button type="button" class="md-btn" onclick="mdWrap('bold')">${UI.POST_MD_BOLD}</button>
          </div>
          <textarea id="post-body" class="form-input post-body-input" rows="8" placeholder="${UI.CONTRACT_PLAN_PLACEHOLDER}" oninput="updatePostPreview()"></textarea>
        </div>
        <div class="form-group">
          <label class="form-label">${UI.POST_PREVIEW_LABEL}</label>
          <div id="post-preview" class="md-preview"></div>
        </div>
        <div class="modal-footer">
          <button type="button" class="btn btn-outline" onclick="closeModal()">${UI.BTN_CANCEL}</button>
          <button type="button" class="btn btn-primary" onclick="submitContractDraft(${convId})">${UI.BTN_SEND}</button>
        </div>
      </div>
    </div>
  </div>`;
  initCustomSelects(document.getElementById('contract-method') && document.getElementById('contract-method').closest('.modal'));
  contractToggleOther('contract-pay-method', 'contract-pay-method-other-wrap');
  contractToggleOther('contract-trial-pay', 'contract-trial-pay-other-wrap');
  updatePostPreview();
  prefillContractFromDemand(); // 初始选中项的预载
}

// 「其他」选项展开文字输入：自定义下拉点选会派发原生 change，统一由此函数切换显隐
function contractToggleOther(selectId, wrapId) {
  const sel = document.getElementById(selectId);
  const wrap = document.getElementById(wrapId);
  if (sel && wrap) wrap.classList.toggle('hidden', sel.value !== 'other');
}

// 起草预载：按所选需求填 教学方式 / 时薪（预算中值）/ 科目（写入方案首行）——仅填空白项，用户改过的不覆盖
function prefillContractFromDemand() {
  const sel = document.getElementById('contract-demand');
  const d = (window._contractDraftDemands || []).find(x => String(x.id) === sel.value);
  if (!d) return;
  if (d.teaching_method) {
    const mSel = document.getElementById('contract-method');
    if (mSel && [...mSel.options].some(o => o.value === d.teaching_method)) { mSel.value = d.teaching_method; syncCustomSelectText(mSel); }
  }
  const rateEl = document.getElementById('contract-rate');
  if (rateEl && !rateEl.value && (d.budget_min || d.budget_max)) {
    rateEl.value = Math.round(((+d.budget_min || 0) + (+d.budget_max || 0)) / 2) || (+d.budget_max || +d.budget_min);
  }
  const plan = document.getElementById('post-body');
  const subjLine = DISP.subjectNames(d.target_subjects);
  if (plan && !plan.value.trim() && subjLine) { plan.value = `授课科目：${subjLine}\n\n`; updatePostPreview(); }
}

let contractDraftBusy = false; // 合同起草防双发（双击生成两份草案）

async function submitContractDraft(convId) {
  const alertEl = document.getElementById('contract-alert');
  const method = document.getElementById('contract-method').value;
  const rate = document.getElementById('contract-rate').value;
  const plan = (document.getElementById('post-body').value || '').trim();
  const payMethod = document.getElementById('contract-pay-method').value;
  const payMethodOther = payMethod === 'other' ? (document.getElementById('contract-pay-method-other').value || '').trim() : '';
  const firstLessonDate = document.getElementById('contract-first-lesson').value || '';
  const trialPay = document.getElementById('contract-trial-pay').value;
  const trialPayOther = trialPay === 'other' ? (document.getElementById('contract-trial-pay-other').value || '').trim() : '';
  if (!rate || +rate <= 0) { alertEl.innerHTML = `<div class="alert alert-error">${UI.VALIDATE_CONTRACT_RATE}</div>`; return; }
  if (payMethod === 'other' && !payMethodOther) { alertEl.innerHTML = `<div class="alert alert-error">${UI.VALIDATE_CONTRACT_PAY_METHOD_OTHER}</div>`; return; }
  if (trialPay === 'other' && !trialPayOther) { alertEl.innerHTML = `<div class="alert alert-error">${UI.VALIDATE_CONTRACT_TRIAL_PAY_OTHER}</div>`; return; }
  if (!plan) { alertEl.innerHTML = `<div class="alert alert-error">${UI.VALIDATE_CONTRACT_PLAN}</div>`; return; }
  if (contractDraftBusy) return;
  contractDraftBusy = true;
  try {
    const schedule = (document.getElementById('contract-schedule').value || '').trim();
    const location = (document.getElementById('contract-location').value || '').trim();
    const demandId = parseInt(document.getElementById('contract-demand').value) || null;
    const data = await api('/api/contracts', { method: 'POST', body: { conversationId: convId, method, plan, hourlyRate: +rate, schedule, location, demandId, payMethod, payMethodOther, firstLessonDate, trialPay, trialPayOther } });
    invalidate('contracts'); // 新草案须即时可见，不等 30s 轮询
    closeModal();
    showToast(data.message || UI.CONTRACT_DRAFT_SENT_TOAST);
  } catch (err) {
    alertEl.innerHTML = `<div class="alert alert-error">${escHtml(err.message)}</div>`;
  } finally {
    contractDraftBusy = false;
  }
}

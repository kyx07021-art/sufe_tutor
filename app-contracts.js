/**
 * 经途·伴学信息门户 - 合同模块（学生+教师）
 *
 * 职责：我的合同列表 / 合同卡片渲染 / 签约·修改·撤销·取消 / 合同起草（聊天窗呼出）/ 存证校验。
 * 本文件在共享层（app-state/app-api/app-anim/app-ui）之后加载，可安全调用全局设施（api/state/UI/loadInto/invalidate/escHtml/mdRender 等）。
 * 函数一律保持 function 声明式（内联 onclick 靠它挂全局）。
 */

// ============================================================
// 我的合同（学生+教师）：草案确认 → 正式合同预览/修改 → 双方确认签约 → signed。
// 合同正文为 Markdown（服务端 buildContractMd 生成），修改经 PUT 实时同步给另一方。
// 确认签约/撤销：危险操作密码重认证换 capToken（danger-ops 一次性二次认证；短信验证未接入）。
// ============================================================

// 该合同当前是否需要我处理（侧栏红点口径）
// v0.25.94：pending 遗留态与 signing 同口径——都按「我方未确认签约」判定
function contractActionable(c) {
  const iAmDrafter = c.drafter_user_id === state.user.id;
  if (c.status === STATUS.PENDING || c.status === STATUS.SIGNING) return !(iAmDrafter ? c.drafter_confirmed : c.other_confirmed); // 待我确认签约
  return false;
}

async function loadMyContracts() {
  const el = document.getElementById('my-contracts-list');
  setBadge('my-contracts', 0); // 点开瞬间红点即灭（有待办由下一轮轮询在离开本页后重新点亮）
  // v0.23.0 静默数据层：缓存命中直出（dhGet 瞬时返缓存，同帧完成不闪 loader）
  const cached = dhPeek('/api/contracts/my');
  if (cached !== null) { state.myContracts = cached.contracts || []; renderMyContractsList(); return; }
  el.innerHTML = `<div class="empty-state">${loaderHtml()}</div>`;
  try {
    const data = await dhGet('/api/contracts/my', { domain: 'contracts' });
    state.myContracts = data.contracts || [];
    renderMyContractsList();
  } catch (err) {
    el.innerHTML = `<div class="empty-state"><p>${UI.ERROR_LOAD_PREFIX}${escHtml(err.message)}</p></div>`;
  }
}

// v0.23.1 审计 M6：探测刷新替换缓存数组后重挂 state.myContracts——徽标轮询就地刷新
// （_lastContractSig 重渲）与跨功能读取依赖镜像，不重挂则展示旧合同状态
if (typeof dhOnDomainRefresh === 'function') {
  dhOnDomainRefresh('contracts', () => {
    const c = dhPeek('/api/contracts/my');
    if (c && c.contracts) state.myContracts = c.contracts;
  });
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
  const methodName = DISP.methodName(c.method) || c.method;
  const { text: statusText, cls: statusCls } = DISP.contractStatusMeta(c);
  const myConfirmed = iAmDrafter ? c.drafter_confirmed : c.other_confirmed;

  let left = '', right = '';
  // v0.25.94（用户反馈「按钮颜色不一致、有的有边框有的没有」）：白卡上卡片动作按钮统一 .btn-soft
  // 轻量描边族（白调面+细边框，白卡/灰底都可见）——sign/cancel/view/modify 从裸 btn/btn-outline 归口；
  // verify-ledger 保留 btn-ghost（三级存证动作）、revoke 保留 btn-text-danger（刻意低调）。
  if (c.revoked) {
    // v0.25.87 R7：撤销后合同保留——显示「你/对方已撤销合同」状态文案 + 查看合同，无操作按钮
    const revokeText = c.revoked_by === me ? UI.CONTRACT_REVOKED_BY_ME : UI.CONTRACT_REVOKED_BY_PEER;
    left = `<span class="contract-wait-text ${c.revoked_by === me ? 'text-danger' : 'text-muted'}">${revokeText}</span>
      <button type="button" class="btn btn-soft btn-sm glass glass--pressable" onclick="viewContract(${c.id})">${UI.BTN_VIEW_CONTRACT}</button>`;
  } else if (c.status === STATUS.SIGNED) {
    left = `<button type="button" class="btn btn-soft btn-sm glass glass--pressable" onclick="viewContract(${c.id})">${UI.BTN_VIEW_CONTRACT}</button>
      <button type="button" class="btn btn-ghost btn-sm glass glass--pressable" onclick="verifyContractLedgerUi(${c.id})">${UI.BTN_VERIFY_LEDGER}</button>`;
    right = `<button type="button" class="btn-text-danger glass" onclick="openRevokeContractModal(${c.id})">${UI.BTN_REVOKE_CONTRACT}</button>`; // 撤销入口刻意低调
  } else {
    // signing（含历史 pending 遗留）：确认签约（已确认则灰字提示等待对方）+ 修改内容 + 查看合同
    // v0.25.87 R6：我方已确认后修改按钮隐藏（合同内容锁定；后端同款 409 门禁兜底）
    // v0.25.94：删 pending&&iAmDrafter 起草方特例分支——新合同创建即 signing，取消回退也归 signing
    left = `${myConfirmed
        ? `<span class="contract-wait-text text-muted">${UI.BTN_SIGN_WAITING}</span>`
        : `<button type="button" class="btn btn-soft btn-sm glass glass--pressable" onclick="signContract(${c.id})">${UI.BTN_SIGN}</button>`}
      ${myConfirmed ? '' : `<button type="button" class="btn btn-soft btn-sm glass glass--pressable" onclick="openContractModifyModal(${c.id})">${UI.BTN_MODIFY_CONTRACT}</button>`}
      <button type="button" class="btn btn-soft btn-sm glass glass--pressable" onclick="viewContract(${c.id})">${UI.BTN_VIEW_CONTRACT}</button>`;
    right = `<button type="button" class="btn btn-soft btn-sm glass glass--pressable" onclick="cancelContract(${c.id})">${UI.BTN_CANCEL_CONTRACT}</button>`;
  }

  return `<div class="list-card glass">
    <div class="list-card-header">
      <span class="list-card-title">${DISP.usernameHtml(peerName)}${DISP.deactivatedTag(peerName)}</span>
      <span class="tag glass glass--solid ${statusCls}">${statusText}</span>
    </div>
    <div class="list-card-body">
      <span class="tag glass glass--solid">${escHtml(methodName)}</span>
      <span class="tag tag-warn glass glass--solid">${c.hourly_rate}${UI.PRICE_UNIT}</span>
      ${c.demand_display_id ? `<span class="tag glass glass--solid">${escHtml(DISP.demandIdText(c.demand_display_id))}</span>` : ''}
      <span class="list-card-meta">${fmtDateTime(c.updated_at)}</span>
    </div>
    ${c.status === STATUS.SIGNING
      ? `<p class="contract-sign-progress text-sm text-muted">${contractSignProgress(c)}</p>`
      : c.status === STATUS.SIGNED
        ? `<p class="contract-sign-progress text-sm">${escHtml(UI.CONTRACT_SIGN_DONE_BOTH)}</p>`
        : ''}
    <div class="contract-actions">
      <div class="contract-actions-left">${left}</div>
      ${right}
    </div>
  </div>`;
}

// v0.25.37 签署合规：甲方/乙方（学生/教师）各自签署进度——confirmed 标志按 drafter 归属映射到两方
function contractSignProgress(c) {
  const studentSigned = (c.drafter_user_id === c.student_user_id ? c.drafter_confirmed : c.other_confirmed) ? 1 : 0;
  const teacherSigned = (c.drafter_user_id === c.teacher_user_id ? c.drafter_confirmed : c.other_confirmed) ? 1 : 0;
  return `${studentSigned ? UI.CONTRACT_PARTY_SIGNED_A : UI.CONTRACT_PARTY_PENDING_A} · ${teacherSigned ? UI.CONTRACT_PARTY_SIGNED_B : UI.CONTRACT_PARTY_PENDING_B}`;
}

// 开始签约（v0.25.32 加固）：读合同全文 → 滚动到底 + 待够时长（CONFIG.CONTRACT_SIGN_READ_SECONDS）
// 解锁确认 → 二次确认 → 密码最终确认（危险操作二次认证，原 verifySignOtp 恒通过已废除；后期改短信验证码）。
// 时间状态放 window 侧（_signing*），防模块闭包与 openModal 重建 #modal-container 时状态丢失。
function signContract(contractId) {
  const c = state.myContracts.find(x => x.id === contractId);
  if (!c) return;
  window._signingContractId = contractId;
  window._signingElapsed = false;
  window._signingScrolled = false;
  openModal({
    title: UI.SIGN_MODAL_TITLE,
    closable: false, // 表单/阅读类：点遮罩不关，防误触丢阅读进度
    cls: 'modal--wide', // 需求三十一：签署前通读全文拓宽
    body: `<div class="contract-md contract-sign-scroll" id="contract-sign-scroll" onscroll="onContractSignScroll()">${mdRender(stripContractMarker(c.contract_md || ''))}</div>
      <p class="contract-sign-disclose text-sm text-muted">${escHtml(UI.SIGN_MODAL_DISCLOSE.replace('{username}', (state.user && state.user.username) || ''))}</p>`,
    footer: `<button type="button" class="btn btn-outline glass glass--pressable" onclick="closeModal()">${UI.BTN_CANCEL}</button>
      <span class="text-sm text-muted contract-sign-hint" id="contract-sign-hint">${signReadHint()}</span>
      <button type="button" id="contract-sign-btn" class="btn glass glass--pressable" disabled onclick="confirmSignContract()">${UI.SIGN_COUNTDOWN_HINT.replace('{secs}', String(CONFIG.CONTRACT_SIGN_READ_SECONDS))}</button>`,
  });
  // 待够时长解锁；先按当前滚态初始化一次（短合同无溢出视同已到底，仍需待够时长）
  // v0.25.87 R5：倒计时从开窗起算，每秒刷新提示「x秒后可确认签约」（原静态"请阅读…N 秒后"无倒计时反馈）。
  window._signingOpenedAt = Date.now();
  window._signingTimer = setInterval(() => {
    const remain = Math.max(0, CONFIG.CONTRACT_SIGN_READ_SECONDS * 1000 - (Date.now() - window._signingOpenedAt));
    if (remain <= 0) {
      clearInterval(window._signingTimer);
      window._signingElapsed = true;
      updateSignBtnState();
    } else {
      updateSignBtnState(Math.ceil(remain / 1000));
    }
  }, 250);
  setTimeout(onContractSignScroll, 0);
}

// 阅读时长提示文案（v0.25.94 起纯静态：倒计时已上确认按钮，不再渲染 {secs}）
function signReadHint() {
  return UI.SIGN_READ_HINT;
}

// 滚动到底判定：无溢出（短合同）视同已到底；有溢出须触底（容差 CONFIG.CONTRACT_SIGN_SCROLL_EPS）
function onContractSignScroll() {
  const el = document.getElementById('contract-sign-scroll');
  if (!el) return;
  const overflow = el.scrollHeight - el.clientHeight;
  window._signingScrolled = overflow <= CONFIG.CONTRACT_SIGN_SCROLL_EPS
    || (el.scrollHeight - el.scrollTop - el.clientHeight) <= CONFIG.CONTRACT_SIGN_SCROLL_EPS;
  updateSignBtnState();
}

// 确认按钮使能：滚动到底 && 待够时长 双条件
// v0.25.94（用户反馈「灰字轮番闪」）：倒计时放回「确认签约」按钮上——计时阶段按钮文本=
// 「N秒后可确认签约」（取代按钮标签），就绪恢复「我已阅读并确认签约」；
// 灰字提示只做静态阅读指引（未就绪恒 SIGN_READ_HINT / 就绪 SIGN_READY_HINT），不再切倒计时。
function updateSignBtnState(remainSec) {
  const btn = document.getElementById('contract-sign-btn');
  if (!btn) return;
  const ready = window._signingElapsed && window._signingScrolled;
  btn.disabled = !ready;
  btn.textContent = ready ? UI.SIGN_READ_DONE_BTN
    : (remainSec != null ? UI.SIGN_COUNTDOWN_HINT.replace('{secs}', String(remainSec)) : UI.SIGN_READ_DONE_BTN);
  const hint = document.getElementById('contract-sign-hint');
  if (!hint) return;
  hint.textContent = ready ? UI.SIGN_READY_HINT : UI.SIGN_READ_HINT;
}

// 确认按钮 → 二次确认 → 密码最终确认（needReAuth 换 capToken）→ POST 签约
function confirmSignContract() {
  const id = window._signingContractId;
  clearInterval(window._signingTimer);
  confirm({ message: UI.CONFIRM_SIGN_TWICE, onConfirm: () => {
    confirm({ message: UI.CONFIRM_SIGN_FINAL, needReAuth: true, onConfirm: async capToken => {
      try {
        const data = await api(`/api/contracts/${id}/sign`, { method: 'POST', body: { capToken } });
        showToast(data.signed ? UI.CONTRACT_SIGNED_TOAST : UI.BTN_SIGN_WAITING);
        invalidate('contracts'); // 签约改合同状态：清缓存，面板「已签约」标记/合同页下次读取重拉
        loadMyContracts();
      } catch (err) { showToast(err.message); }
    }});
  }});
}

// 查看正式合同预览（Markdown 渲染，复用发帖组件的 mdRender）
function viewContract(contractId) {
  const c = state.myContracts.find(x => x.id === contractId);
  if (!c) return;
  // v0.24.3 改动留痕+高亮：修改过的合同（prev_business 非空）先渲染改动 diff 块，再显示当前全文。
  // prev_business 为上次业务条款（服务端留痕，签署确认后清空）——diff 仅存在于重新确认窗口期
  const diffHtml = c.prev_business ? renderContractDiff(c.prev_business, splitContractBiz(c.contract_md || '')) : '';
  openModal({
    title: diffHtml ? UI.CONTRACT_VIEW_DIFF_TITLE : UI.BTN_VIEW_CONTRACT,
    cls: 'modal--wide', // 需求三十一：合同正文长文拓宽
    bodyCls: 'contract-md',
    body: `${diffHtml ? `<div class="contract-diff-head">${escHtml(UI.CONTRACT_DIFF_HINT)}</div>
        <div class="contract-diff glass glass--solid">${diffHtml}</div>
        <div class="contract-diff-divider"></div>` : ''}
      ${mdRender(stripContractMarker(c.contract_md || ''))}`,
  });
}

// 去除平台内部「业务条款结束」标记行（HTML 注释经 escHtml 后以文本泄漏到合同查看渲染）
// A8 收口：正则基于本地常量 CONTRACT_BIZ_END 拼接（与 server/contract.js CONTRACT_BUSINESS_END 前缀一致，杜绝双写漂移）
const stripContractMarker = (md) => String(md || '').replace(new RegExp(CONTRACT_BIZ_END.replace(' ', '\\s*') + '[^\\n]*\\n?', 'g'), '');

// v0.24.3 合同改动 diff 渲染：prev（上次业务条款）→ current（当前业务条款）行级 LCS 对比。
// 复用 app-display.diffLines（纯函数）；escHtml 由 app-ui 提供（本文件加载序在其后）。
// 返回 diff HTML（绿=新增 / 红删除线=移除 / 普通=未变）；无实际改动返回空串
function renderContractDiff(prev, current) {
  const ops = (typeof DISP !== 'undefined' && DISP.diffLines) ? DISP.diffLines(prev, current) : [];
  const changed = ops.some(o => o.t !== 'same');
  if (!changed) return '';
  return ops.map(o => {
    const cls = o.t === 'del' ? 'diff-line diff-del' : o.t === 'add' ? 'diff-line diff-add' : 'diff-line diff-same';
    const sign = o.t === 'del' ? '−' : o.t === 'add' ? '+' : ' ';
    return `<div class="${cls}"><span class="diff-sign">${sign}</span><span>${escHtml(o.text) || '&nbsp;'}</span></div>`;
  }).join('');
}

// 修改合同内容：复用发帖组件的 Markdown 编辑器（同套 id，弹窗互斥）
function openContractModifyModal(contractId) {
  const c = state.myContracts.find(x => x.id === contractId);
  if (!c) return;
  window._contractModifyVersion = c.version != null ? c.version : 0; // 乐观锁版本：提交时带上，期间被对方改过则 409 强制重载（后端 v0.21.0 起用自增 version，秒级 updated_at 已弃用）
  openModal({
    title: `${UI.MODIFY_CONTRACT_TITLE}`,
    closable: false,
    body: `<div id="post-alert"></div>
        <div class="form-group">
          <label class="form-label">${UI.LABEL_CONTRACT_PLAN}</label>
          <div class="md-toolbar">
            <button type="button" class="md-btn glass" onclick="mdWrap('h2')">H2</button>
            <button type="button" class="md-btn glass" onclick="mdWrap('h3')">H3</button>
            <button type="button" class="md-btn glass" onclick="mdWrap('bold')">${UI.POST_MD_BOLD}</button>
            <!-- 合同编辑器禁插图：合同正文须为纯文本条款 -->
            <button type="button" class="md-btn glass" onclick="openPostPreview()">${UI.POST_PREVIEW_BTN}</button> <!-- v0.24.0 -->
          </div>
          <textarea id="post-body" class="form-input post-body-input" rows="12">${escHtml(splitContractBiz(c.contract_md))}</textarea>
          <p class="text-muted text-sm contract-modify-hint">${UI.CONTRACT_MODIFY_BIZ_HINT}</p>
        </div>`,
    footer: `<button type="button" class="btn btn-outline glass glass--pressable" onclick="closeModal()">${UI.BTN_CANCEL}</button>
          <button type="button" class="btn glass glass--pressable" onclick="submitContractModify(${c.id})">${UI.BTN_SAVE}</button>`,
  });
}

// 撤销已签约合同：两级确认。第一级告知法律后果与数据影响（不显眼，防误触），
// 第二级 confirm() 危险确认（needReAuth 密码换 capToken）。活跃库抹除合同，签署台账与加密留档保留。
function openRevokeContractModal(contractId) {
  openModal({
    title: UI.REVOKE_MODAL_TITLE,
    style: `max-width:${CONFIG.MODAL_W_DEACTIVATE};`,
    body: `<p class="danger-warn">${UI.REVOKE_CONTRACT_WARN}</p>`,
    footer: `<button type="button" class="btn btn-outline glass glass--pressable" onclick="closeModal()">${UI.BTN_THINK_AGAIN}</button>
          <button type="button" class="btn btn-outline btn-sm glass glass--pressable" onclick="confirmRevokeContract(${contractId})">${UI.BTN_CONTINUE_DANGER}</button>`,
  });
}
function confirmRevokeContract(contractId) {
  // 撤销=危险操作（网安报告 F-05）：密码重认证换 capToken（原 confirmDangerOtp 恒通过已废除）
  confirm({ message: UI.REVOKE_CONTRACT_FINAL, needReAuth: true, onConfirm: async capToken => {
    try {
      await api(`/api/contracts/${contractId}/revoke`, { method: 'POST', body: { capToken } });
      showToast(UI.CONTRACT_REVOKED_TOAST);
      invalidate('contracts'); // 撤销后签约标记须消失
      loadMyContracts();
    } catch (err) { showToast(err.message); }
  }});
}

// 存证校验（v0.25.37 toast 升级小面板）：重算合同文本哈希对比签署时的台账指纹（后端 /verify），
// 展示当前指纹、台账条目数与各条记档时间（签署历史）——哈希链由服务端校验并回传各环节结果
async function verifyContractLedgerUi(contractId) {
  try {
    const data = await api(`/api/contracts/${contractId}/verify`);
    if (!data.recorded) { showToast(UI.CONTRACT_LEDGER_NONE); return; }
    const verdict = data.archived ? UI.CONTRACT_LEDGER_ARCHIVED
      : data.valid ? UI.CONTRACT_LEDGER_VALID : UI.CONTRACT_LEDGER_INVALID;
    const chainBits = [
      `${data.headValid ? '✓' : '✗'}${UI.CONTRACT_VERIFY_LABEL_HEAD}`,
      `${data.linksValid ? '✓' : '✗'}${UI.CONTRACT_VERIFY_LABEL_LINK}`,
      `${data.seqValid ? '✓' : '✗'}${UI.CONTRACT_VERIFY_LABEL_SEQ}`,
    ].join('　');
    const rows = data.entryList || [];
    openModal({
      title: UI.CONTRACT_VERIFY_PANEL_TITLE,
      cls: 'modal--wide', // 需求三十一：存证明细长文拓宽
      bodyCls: 'contract-md',
      body: `<p class="contract-verify-verdict ${data.valid ? 'contract-verify--ok' : 'contract-verify--bad'}">${escHtml(verdict)}</p>
        <div class="contract-verify-grid">
          <div class="contract-verify-row"><span class="text-muted">${escHtml(UI.CONTRACT_VERIFY_FLOW)}</span><code>${UI.CONTRACT_VERIFY_CD_PREFIX}${String(contractId).padStart(6, '0')}</code></div>
          <div class="contract-verify-row"><span class="text-muted">${escHtml(UI.CONTRACT_VERIFY_HASH)}</span><code class="contract-verify-hash">${escHtml(data.contentHash)}</code></div>
          <div class="contract-verify-row"><span class="text-muted">${escHtml(UI.CONTRACT_VERIFY_ENTRIES)}</span><span>${data.entries} ${UI.CONTRACT_VERIFY_ENTRY_UNIT} · ${escHtml(chainBits)}</span></div>
        </div>
        ${rows.length ? `<div class="contract-verify-list">${rows.map(e =>
          `<div class="contract-verify-entry"><span>#${e.seq == null ? '?' : e.seq}</span><span>${fmtDateTime(e.createdAt)}</span></div>`).join('')}</div>` : ''}`,
    });
  } catch (err) { showToast(err.message); }
}

async function submitContractModify(contractId) {
  const md = (document.getElementById('post-body').value || '').trim();
  const alertEl = document.getElementById('post-alert');
  if (!md) { alertEl.innerHTML = alertHtml('error', UI.CONTRACT_EMPTY); return; }
  try {
    const data = await api(`/api/contracts/${contractId}`, { method: 'PUT', body: { contractMd: md, version: window._contractModifyVersion } });
    closeModal();
    if (!(data && data.unchanged)) showToast(UI.CONTRACT_MODIFIED_TOAST); // v0.24.2 审计：未改动不误导「已同步需重新确认」
    invalidate('contracts'); // v0.23.1 审计 M5：否则 loadMyContracts 命中旧正文
    loadMyContracts();
  } catch (err) {
    // v0.24.2 审计：409 乐观锁冲突后刷新本地版本号（否则重复保存恒 409，只能关弹窗重开）
    if (err.code === 'CONTRACT_MODIFIED_CONFLICT') {
      try {
        const fresh = await api('/api/contracts/my');
        const c = (fresh.contracts || []).find(x => x.id === contractId);
        if (c && c.version != null) window._contractModifyVersion = c.version;
      } catch { /* 刷新失败静默，用户可关弹窗重开 */ }
    }
    alertEl.innerHTML = alertHtml('error', err.message);
  }
}

// 取消签约（v0.25.87 R7）：弹窗 + 密码验证（取消签署承诺 = 危险操作，needReAuth 换 capToken）→
// 后端回退我方待签约态（合同保留，不删除）+ 通知对方；会话保留
function cancelContract(contractId) {
  confirm({ message: UI.CONFIRM_CANCEL_CONTRACT, needReAuth: true, onConfirm: async capToken => {
    try {
      await api(`/api/contracts/${contractId}`, { method: 'DELETE', body: { capToken } });
      showToast(UI.CONTRACT_CANCELLED_TOAST);
      invalidate('contracts');
      loadMyContracts();
    } catch (err) { showToast(err.message); }
  }});
}

// v0.24.0 合同修改只放出业务条款：法律条款由服务端固定重拼（不可修改）。
// 标记前缀与 server/contract.js CONTRACT_BUSINESS_END 一致
const CONTRACT_BIZ_END = '<!-- 业务条款结束';
function splitContractBiz(md) {
  return String(md || '').split(CONTRACT_BIZ_END)[0].trim();
}
// v0.25.86 审计：stripContractMarker 已由 app-contracts 定义（见下），app-admin 复用，不再双写

// v0.24.0 发起签约（极简签约流，加号栏呼出）：需求四·第2条加「选择需求」下拉（会话学生方开放需求，
// 每项 #编号 · 目标名 · 预算），再确认报价 / 时间（自然语言）/ 教学方式线上或线下，
// 发送后会话内出现「对方向你发送了签约请求」气泡，由对方确认或拒绝（见 app-chat.js 气泡渲染）
async function openSigningModal(convId) {
  if (!ensureAuth()) return;
  openModal({ title: UI.SIGNING_MODAL_TITLE, closable: false, body: `<div class="empty-state">${loaderHtml()}</div>` });
  let demands = [], demandsFailed = false;
  try { const data = await api(`/api/conversations/${convId}/bindable-demands?phase=signing`); demands = data.demands || []; }
  catch { demandsFailed = true; }
  window._signingDemands = demands; // 供 prefillSigningTimeSlots 按所选需求预填时间段
  openModal({
    title: UI.SIGNING_MODAL_TITLE,
    closable: false,
    body: `<div id="post-alert"></div>
        <p class="text-sm text-muted signing-modal-hint">${UI.SIGNING_MODAL_HINT}</p>
        <div class="form-group">
          <label class="form-label">${UI.SIGNING_DEMAND_LABEL} <span class="req">*</span></label>
          <select class="form-select" id="signing-demand" onchange="prefillSigningTimeSlots()">
            ${demands.length
              ? `<option value="">${UI.SIGNING_DEMAND_PLACEHOLDER}</option>` +
                demands.map(d => `<option value="${d.id}">${escHtml(DISP.demandOptionText(d))}</option>`).join('')
              : `<option value="" disabled>${UI.SIGNING_NO_DEMAND_HINT}</option>`}
          </select>
          ${demandsFailed ? `<p class="text-sm text-muted">${UI.SIGNING_DEMANDS_LOAD_FAIL}</p>` : ''}
        </div>
        <div class="form-group">
          <label class="form-label">${UI.LABEL_SIGNING_PRICE} <span class="req">*</span></label>
          <input type="number" id="signing-price" class="form-input" min="0" step="1" placeholder="${UI.SIGNING_PRICE_PLACEHOLDER}">
        </div>
        <div class="form-group">
          <label class="form-label">${UI.LABEL_SIGNING_SCHEDULE} <span class="req">*</span></label>
          <div id="signing-time-slots" class="time-slots">${renderTimeSlotContainerHtml()}</div> <!-- v0.25.35 复用结构化时间组件；需求四十四：提示行已删（与「+ 新建时间段」文案重复） -->
        </div>
        <div class="form-group">
          <label class="form-label">${UI.LABEL_SIGNING_METHOD}</label>
          <select id="signing-method" class="form-select">
            <option value="online">${UI.SIGNING_METHOD_ONLINE}</option>
            <option value="offline" selected>${UI.SIGNING_METHOD_OFFLINE}</option>
          </select>
        </div>
        <p class="funds-note">${UI.FUNDS_NOTE}</p>`, <!-- 需求四（v0.25.44）：报价资金触点明示平台不走资金 -->
    footer: `<button type="button" class="btn btn-outline glass glass--pressable" onclick="closeModal()">${UI.BTN_CANCEL}</button>
          <button type="button" class="btn glass glass--pressable" onclick="submitSigning(${convId})">${UI.BTN_SIGNING_SEND}</button>`,
  });
  initCustomSelects(document.getElementById('signing-method') && document.getElementById('signing-method').closest('.modal'));
}

// v0.25.35 签约/草拟共用：收集时间组件 → 人类可读 schedule 串（结构化 slots 经 DISP.expectedTimeText
// 格式化为「周一 18:00-20:00、周三 16:00-18:00」；空 → ''；半填/起止颠倒由 validateTimeSlots 先行拦截）
function collectScheduleText(containerId) {
  const container = document.getElementById(containerId);
  if (!container) return '';
  const slots = collectTimeSlots(container);
  return slots.length ? DISP.expectedTimeText(JSON.stringify(slots)) : '';
}

// 发起签约：切换需求 → 按其 expected_time 预填时间组件（仅容器为空时预填，用户改过的不覆盖）
function prefillSigningTimeSlots() {
  const sel = document.getElementById('signing-demand');
  if (!sel) return;
  const d = (window._signingDemands || []).find(x => String(x.id) === String(sel.value));
  const container = document.getElementById('signing-time-slots');
  if (!d || !container || container.querySelectorAll('.time-slot').length) return;
  prefillTimeSlots(container, d.expected_time || '');
}

async function submitSigning(convId) {
  const demandId = parseInt(document.getElementById('signing-demand').value) || null;
  const price = +document.getElementById('signing-price').value || 0;
  const tsErr = validateTimeSlots(document.getElementById('signing-time-slots'));
  const schedule = collectScheduleText('signing-time-slots');
  const method = document.getElementById('signing-method').value;
  if (!demandId) { showToast(UI.VALIDATE_SIGNING_DEMAND); return; } // 需求四·第2条：每次签约绑定一份需求
  if (price <= 0) { showToast(UI.VALIDATE_SIGNING_PRICE); return; }
  if (tsErr) { showToast(tsErr); return; } // v0.25.35 结构化时间校验（半填/起止颠倒就地拦截）
  if (!schedule) { showToast(UI.VALIDATE_SIGNING_SCHEDULE); return; }
  try {
    await api(`/api/conversations/${convId}/signing`, { method: 'POST', body: { demandId, price, schedule, method } });
    closeModal();
    showToast(UI.SIGNING_REQUEST_SENT_TOAST);
  } catch (err) { showToast(err.message); }
}

// 起草合同（聊天窗 + 号呼出）：需求四·第3条——入口始终可打开，但只能选「已签约」需求继续
// （发起签约确认 → demand contracted 后才可起草；前端下拉只列已签约需求，服务端同款门禁）。
// 先选对应需求 → 预载配置（科目/方式/预算）→ 教学方式 / 授课时间 / 授课地点 / 约定时薪 /
// 教学方案（md 编辑器，合同文本禁插图）→ 发送另一方确认
async function openContractDraftModal(convId) {
  if (!ensureAuth()) return; // 网安审计修复：与 openSigningModal 防御口径一致（入口虽在聊天窗内，统一过登录通路）
  openModal({ title: null, closable: false, body: `${loaderHtml()}` });
  let demands = [], demandsFailed = false;
  try { const data = await api(`/api/conversations/${convId}/bindable-demands?phase=contract`); demands = data.demands || []; }
  catch { demandsFailed = true; /* 拉取失败则下拉空 + 前端 demandId 必选校验拦截起草，弹窗内明示 */ }
  const conv = (typeof chatConvById === 'function') ? chatConvById(convId) : null;
  // 审计修复：仅当会话绑定的需求确在可绑（已签约）列表内才预选；不在（未达已签约/被别教师签走）
  // 则置空占位，由用户显式选择——不再静默回退列表首项（可能与会话实际绑定需求不符）
  const preselect = (conv && demands.find(d => d.id === conv.demand_id)) || null;
  window._contractDraftDemands = demands; // 供 prefillContractFromDemand 取数
  openModal({
    title: `${UI.DRAFT_MODAL_TITLE}`,
    closable: false,
    body: `<div id="contract-alert">${demandsFailed ? alertHtml('error', UI.CONTRACT_DEMANDS_LOAD_FAIL) : ''}</div>
        <div class="form-group">
          <label class="form-label">${UI.LABEL_CONTRACT_DEMAND} <span class="req">*</span></label>
          <p class="text-sm text-muted contract-demand-hint">${UI.CONTRACT_DEMANDS_SIGNED_HINT}</p>
          <select class="form-select" id="contract-demand" onchange="prefillContractFromDemand()">
            ${demands.length
              ? (preselect
                ? demands.map(d => `<option value="${d.id}"${d.id === preselect.id ? ' selected' : ''}>${escHtml(DISP.demandOptionText(d))}</option>`).join('')
                : `<option value="" selected disabled>${UI.OPTION_PLACEHOLDER}</option>` + demands.map(d => `<option value="${d.id}">${escHtml(DISP.demandOptionText(d))}</option>`).join(''))
              : `<option value="" disabled>${UI.CONTRACT_DEMANDS_EMPTY}</option>`}
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
          <div id="contract-time-slots" class="time-slots">${renderTimeSlotContainerHtml()}</div> <!-- v0.25.35 复用结构化时间组件；需求四十四：提示行已删（与「+ 新建时间段」文案重复） -->
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
          ${dateFieldHtml()} <!-- 需求四十五（v0.25.53）：分段日期输入（年-月-日），复用底层段输入原语，空=由双方另行协商 -->
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
            <button type="button" class="md-btn glass" onclick="mdWrap('h2')">H2</button>
            <button type="button" class="md-btn glass" onclick="mdWrap('h3')">H3</button>
            <button type="button" class="md-btn glass" onclick="mdWrap('bold')">${UI.POST_MD_BOLD}</button>
            <button type="button" class="md-btn glass" onclick="openPostPreview()">${UI.POST_PREVIEW_BTN}</button> <!-- v0.24.0 -->
          </div>
          <textarea id="post-body" class="form-input post-body-input" rows="8" placeholder="${UI.CONTRACT_PLAN_PLACEHOLDER}"></textarea>
        </div>
        <p class="funds-note">${UI.FUNDS_NOTE}</p>`, <!-- 需求四（v0.25.44）：时薪资金触点明示平台不走资金 -->
    footer: `<button type="button" class="btn btn-outline glass glass--pressable" onclick="closeModal()">${UI.BTN_CANCEL}</button>
          <button type="button" class="btn glass glass--pressable" onclick="submitContractDraft(${convId})">${UI.BTN_SEND}</button>`,
  });
  initCustomSelects(document.getElementById('contract-method') && document.getElementById('contract-method').closest('.modal'));
  contractToggleOther('contract-pay-method', 'contract-pay-method-other-wrap');
  contractToggleOther('contract-trial-pay', 'contract-trial-pay-other-wrap');
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
  const subjLine = DISP.demandTargetNames(d.target_subjects, d.target_type); // R2-b 合同详情按需求类型显示目标名
  if (plan && !plan.value.trim() && subjLine) { plan.value = `${UI.CONTRACT_SUBJECT_LINE_PREFIX}${subjLine}\n\n`; }
  // v0.25.35 授课时间段：按需求 expected_time 预填时间组件（仅未填时，用户改过的不覆盖）
  const ts = document.getElementById('contract-time-slots');
  if (ts && !ts.querySelectorAll('.time-slot').length) prefillTimeSlots(ts, d.expected_time || '');
}

let contractDraftBusy = false; // 合同起草防双发（双击生成两份草案）

async function submitContractDraft(convId) {
  const alertEl = document.getElementById('contract-alert');
  const method = document.getElementById('contract-method').value;
  const rate = document.getElementById('contract-rate').value;
  const plan = (document.getElementById('post-body').value || '').trim();
  const payMethod = document.getElementById('contract-pay-method').value;
  const payMethodOther = payMethod === 'other' ? (document.getElementById('contract-pay-method-other').value || '').trim() : '';
  const firstLessonDateRaw = readDateField(document.getElementById('contract-first-lesson-field'));
  const trialPay = document.getElementById('contract-trial-pay').value;
  const trialPayOther = trialPay === 'other' ? (document.getElementById('contract-trial-pay-other').value || '').trim() : '';
  const demandId = parseInt(document.getElementById('contract-demand').value) || null;
  if (!demandId) { alertEl.innerHTML = alertHtml('error', UI.CONTRACT_REQUIRE_SIGNED); return; } // 需求四·第3条：只能选已签约需求
  if (!rate || +rate <= 0) { alertEl.innerHTML = alertHtml('error', UI.VALIDATE_CONTRACT_RATE); return; }
  if (payMethod === 'other' && !payMethodOther) { alertEl.innerHTML = alertHtml('error', UI.VALIDATE_CONTRACT_PAY_METHOD_OTHER); return; }
  if (trialPay === 'other' && !trialPayOther) { alertEl.innerHTML = alertHtml('error', UI.VALIDATE_CONTRACT_TRIAL_PAY_OTHER); return; }
  if (!plan) { alertEl.innerHTML = alertHtml('error', UI.VALIDATE_CONTRACT_PLAN); return; }
  const tsErr = validateTimeSlots(document.getElementById('contract-time-slots'));
  if (tsErr) { alertEl.innerHTML = alertHtml('error', tsErr); return; } // v0.25.35 结构化时间校验（空=可协商，不强制）
  if (firstLessonDateRaw === null) { alertEl.innerHTML = alertHtml('error', UI.VALIDATE_CONTRACT_FIRST_LESSON_INCOMPLETE); return; } // 需求四十五：日期半填拦截（空=另行协商合法）
  const firstLessonDate = firstLessonDateRaw; // '' 或 'YYYY-MM-DD'（readDateField 已按真实日历钳制）
  if (contractDraftBusy) return;
  contractDraftBusy = true;
  try {
    const schedule = collectScheduleText('contract-time-slots');
    const location = (document.getElementById('contract-location').value || '').trim();
    const data = await api('/api/contracts', { method: 'POST', body: { conversationId: convId, method, plan, hourlyRate: +rate, schedule, location, demandId, payMethod, payMethodOther, firstLessonDate, trialPay, trialPayOther } });
    invalidate('contracts'); // 新草案须即时可见，不等 30s 轮询
    closeModal();
    showToast(data.message || UI.CONTRACT_DRAFT_SENT_TOAST);
  } catch (err) {
    alertEl.innerHTML = alertHtml('error', err.message);
  } finally {
    contractDraftBusy = false;
  }
}

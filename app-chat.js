/**
 * 我的会话（学生 / 教师侧边栏「我的会话」页，模块4）
 *
 * 经典脚本：全部顶层全局函数 + 内联 onclick（全站同一约定）。
 * 仅依赖共享层提供的基础设施：state / api / escHtml / showToast / loaderHtml / setBadge（app-state/app-api/app-anim/app-ui 先行加载）。
 * 会话列表选中高亮由 .conv-item.active 自身背景承载（禁绝对定位覆盖层）。
 *
 * 数据来源（后端已上线，身份一律凭 X-Auth-Token，无自报 userId 参数）：
 *   GET  /api/conversations                          会话列表（含对方用户名 + 最后消息预览）
 *   GET  /api/conversations/:id/messages?sinceId=    消息（id 升序；sinceId=0 即全量）
 *   POST /api/conversations/:id/messages             发送文本消息，返回 { id }
 *
 * 轮询生命周期：
 *   openConversation() 拉完全量后 chatStartPolling() 挂 4s 定时器；
 *   每次 tick 先自检（state.page==='my-chats' 且会话仍打开 且已登录），不满足则不发请求；
 *   stopChatPolling() 为对外硬终止口（clearInterval + 清空会话状态），供登出 / 切页等外部清理调用；
 *   重新进入本页（enterMyChats）也会先 stopChatPolling() 再重建界面，杜绝定时器叠加。
 */

// ============================================================
// 模块内状态
// ============================================================
let chatConvId = null;      // 当前打开的会话 id（null = 未选中任何会话）
let chatConvList = [];      // 已加载的会话列表（收发后就地更新预览，避免整列重拉）
// 审计 M1：探测刷新替换缓存数组后重挂别名——markReadConv/收发预览的就地变更
// 依赖「chatConvList === 缓存数组同引用」，不重挂则变更落在游离旧数组、红点复亮
if (typeof dhOnDomainRefresh === 'function') {
  dhOnDomainRefresh('chat', () => {
    const c = dhPeek('/api/conversations');
    if (c && c.conversations) chatConvList = c.conversations;
  });
}
let chatPollTimer = null;   // 轮询定时器（setInterval 句柄）
let chatLastMsgId = 0;      // 已见最大消息 id，作轮询 sinceId
let chatPollBusy = false;   // 上一次轮询未返回时跳过本 tick，防请求叠加
let chatSending = false;    // 发送中，防连点
let chatOptimisticSending = false; // F10：乐观发送在途——轮询跳过，防乐观临时气泡与轮询真实气泡双插（去重窗口）
let chatPendingOpen = null; // R26：跨页待打开的会话目标（按学生 id），会话列表就绪后自动打开

// ============================================================
// 页面入口
// ============================================================

// 侧边栏项入口（ROLE_PAGES → enterMyChats）：
// 左栏会话列表 + 右栏聊天窗（未选中时占位）。每次进入都重置会话选中态并重建轮询。
function enterMyChats() {
  stopChatPolling();
  if (typeof setBadge === 'function') setBadge('my-chats', 0); // 点开瞬间红点即灭（轮询跳过当前页）
  document.getElementById('chats-content').innerHTML = `
    <div class="chats-shell" id="chats-shell">
      <aside class="chats-list-pane">
        <div class="chats-list-head">
          <span class="chats-list-title-group">
            <span class="chats-list-title">${UI.CHAT_TITLE}</span>
          </span>
        </div>
        <div class="conv-list" id="conv-list"><div class="empty-state empty-state--small">${loaderHtml()}</div></div>
      </aside>
      <section class="chat-pane" id="chat-pane">
        ${renderChatPlaceholder()}
      </section>
    </div>`;
  // 需求四·10：会话 title 旁挂 i 信息按钮（复用 app-shell createModuleInfoBtn，运行期可用）
  const titleGroup = document.querySelector('.chats-list-title-group');
  if (titleGroup && typeof createModuleInfoBtn === 'function') {
    titleGroup.appendChild(createModuleInfoBtn('my-chats'));
  }
  // 加号弹层「点外面关闭」：全局只绑一次（切页重建 shell 不影响 document 级监听）
  if (!window._chatPlusBound) {
    window._chatPlusBound = true;
    document.addEventListener('click', e => {
      const w = document.getElementById('chat-plus-wrap');
      if (w && !e.target.closest('.chat-plus-wrap')) w.classList.remove('open');
    });
  }
  loadConversations();
}

// 拉取会话列表（服务端已按最后活跃时间倒序）
async function loadConversations() {
  try {
    const data = await dhGet('/api/conversations', { domain: 'chat' }); // 静默数据层
    chatConvList = data.conversations || [];
    renderConvList();
    if (typeof setBadge === 'function') setBadge('my-chats', chatsUnreadTotal()); // 同步侧边栏红点
    // R26：跨页「已建立联系→」跳会话——列表就绪后打开目标会话（goChatWithStudent 设置）
    if (chatPendingOpen != null) {
      const target = chatPendingOpen;
      chatPendingOpen = null;
      const conv = chatConvList.find(c => c.student_user_id === target);
      if (conv) openConversation(conv.id);
      else if (typeof showToast === 'function') showToast(UI.CHAT_CONV_NOT_FOUND);
    }
  } catch (err) {
    const el = document.getElementById('conv-list');
    if (el) el.innerHTML = `<div class="empty-state empty-state--small"><p>${UI.ERROR_LOAD_PREFIX}${escHtml(err.message)}</p></div>`;
  }
}

// R26：需求大厅「已建立联系→」→ 跳到与该学生的会话页并打开。
// 会话已在列表 → 就地打开；否则设待开目标并切到会话页（loadConversations 完成后自动打开）。
function goChatWithStudent(studentId) {
  if (!ensureAuth()) return;
  if (!Number.isInteger(+studentId)) return;
  const conv = chatConvList.find(c => c.student_user_id === +studentId);
  if (conv && state.page === 'my-chats') { openConversation(conv.id); return; }
  chatPendingOpen = +studentId;
  if (state.page === 'my-chats') loadConversations(); // 已在会话页：刷新列表后自动打开（防列表陈旧缺目标）
  else selectPage('my-chats');
}

// ============================================================
// 左栏：会话列表
// ============================================================
function renderConvList() {
  const el = document.getElementById('conv-list');
  if (!el) return;
  if (!chatConvList.length) {
    el.innerHTML = `<div class="empty-state empty-state--small"><p>${UI.CHAT_EMPTY_NO_CONVS}</p></div>`;
    return;
  }
  // 删绝对定位覆盖层——选中高亮改由
  // 条目自身 .conv-item.active 的 background 承载（流内标准组件，缩放/拖动天然同步，零 JS 几何）。
  el.innerHTML = chatConvList.map(renderConvItem).join('');
}

// 对方名字：学生看 teacher_name，教师看 student_name
function chatPeerOf(c) {
  const isTeacherViewer = state.user && state.user.role === 'teacher';
  return {
    id: isTeacherViewer ? c.student_user_id : c.teacher_user_id, // 个人信息右栏入口用
    name: isTeacherViewer ? c.student_name : c.teacher_name,
    role: isTeacherViewer ? UI.ROLE_STUDENT : UI.ROLE_TEACHER,
    avatar: isTeacherViewer ? c.student_avatar : c.teacher_avatar,
  };
}

// ---- 未读红点 ----
function chatsUnreadTotal() { return chatConvList.reduce((s, c) => s + (c.unread_count || 0), 0); }

// 会话已读：就地消红点 + 同步侧边栏徽标 + 静默上报后端（失败下一轮轮询自愈）
async function markReadConv(convId) {
  const c = chatConvList.find(x => x.id === convId);
  if (c) c.unread_count = 0;
  const dot = document.querySelector(`.conv-unread-dot[data-unread-dot="${convId}"]`);
  if (dot) dot.remove();
  if (typeof setBadge === 'function') setBadge('my-chats', chatsUnreadTotal());
  try {
    await api(`/api/conversations/${convId}/read`, { method: 'POST', body: {} });
  } catch { /* 静默 */ }
}

// 2026-08-09 反馈：离开聊天页时把当前打开的会话已读（看过即消——打开时已 markReadConv，此处兜底
// 覆盖"打开后又有新消息/上报失败"的情形；app-shell selectPage 离开 my-chats 时 typeof 守卫调用）
function markActiveConvRead() {
  if (chatConvId != null) markReadConv(chatConvId);
}

function renderConvItem(c) {
  const peer = chatPeerOf(c);
  const me = state.user.id;
  let preview = UI.CHAT_EMPTY_NO_MESSAGES;
  if (c.last_kind === 'contract') {
    preview = UI.CHAT_PREVIEW_CONTRACT;
  } else if (c.last_kind === 'signing_request' || c.last_kind === 'signing_response') {
    // 签约消息必须先于「非 text → [文件]」分支判定，否则新功能主入口被误标
    preview = c.last_kind === 'signing_request' ? UI.CHAT_PREVIEW_SIGNING_REQ : UI.CHAT_PREVIEW_SIGNING_RESP;
  } else if (c.last_kind && c.last_kind !== 'text') {
    preview = (c.last_sender === me ? UI.CHAT_PREVIEW_ME_PREFIX : '') + (c.last_kind === 'image' ? UI.CHAT_PREVIEW_IMAGE : UI.CHAT_PREVIEW_FILE);
  } else if (c.last_body) {
    preview = (c.last_sender === me ? UI.CHAT_PREVIEW_ME_PREFIX : '') + c.last_body;
  }
  const time = fmtChatTime(c.last_at || c.created_at);
  return `<button type="button" class="conv-item${c.id === chatConvId ? ' active' : ''}" data-conv-id="${c.id}" onclick="openConversation(${c.id})">
    ${(c.unread_count || 0) > 0 ? `<span class="conv-unread-dot" data-unread-dot="${c.id}"></span>` : ''}
    ${renderAvatarHtml(peer.avatar, peer.name, 'conv-avatar', peer.id)}
    <span class="conv-item-top">
      <span class="conv-item-name">${DISP.usernameHtml(peer.name || UI.CHAT_UNKNOWN_USER)}${DISP.deactivatedTag(peer.name)}</span>
      <span class="conv-item-role glass glass--solid">${peer.role}</span>
      <span class="conv-item-time">${escHtml(time)}</span>
    </span>
    <span class="conv-item-preview">${escHtml(preview)}</span>
  </button>`;
}

// 收 / 发后更新左栏预览，并把该会话移到列表顶部（与服务端按最后活跃倒序一致）
function chatBumpConvPreview(convId, lastMsg) {
  const c = chatConvList.find(x => x.id === convId);
  if (!c) return;
  c.last_body = lastMsg.body;
  c.last_kind = lastMsg.kind;
  c.last_at = lastMsg.created_at;
  c.last_sender = lastMsg.sender_user_id;
  chatConvList.splice(chatConvList.indexOf(c), 1);
  chatConvList.unshift(c);
  renderConvList(); // 列表内无输入态，整体重渲染安全
}

// ============================================================
// 右栏：打开会话 / 渲染聊天窗
// ============================================================
// 清空暂存附件：abort 在途上传 + 已上传的同步删服务器暂存区（修：原只处理已拿到 uploadId 的项，
// 上传中 XHR 不中止、完成后在服务器残留孤儿附件——切会话/登出/跨账号切换尤甚）
function chatAbortStagedUploads() {
  chatStaged.forEach(it => {
    if (it._xhr) { it._xhr.abort(); it._aborted = true; } // 在途：中断，防完成回调把 uploadId 写进孤儿项
    if (it.uploadId) api(`/api/uploads/${it.uploadId}`, { method: 'DELETE', body: {} }).catch(() => {}); // 已上传：best-effort 删
  });
  chatStaged = [];
}

async function openConversation(convId) {
  closeChatPlus();            // 切会话先收拢加号弹层
  stopChatPolling();          // 清掉上一段会话的定时器与状态
  chatConvId = convId;

  // 左栏高亮 + 移动端切到聊天窗
  document.querySelectorAll('#conv-list .conv-item').forEach(b =>
    b.classList.toggle('active', +b.dataset.convId === convId));
  const shell = document.getElementById('chats-shell');
  if (shell) shell.classList.add('chats-show-chat');

  const pane = document.getElementById('chat-pane');
  if (!pane) return;
  // 切会话清空上一会话的暂存附件（含在途上传 abort）
  chatAbortStagedUploads();
  const conv = chatConvList.find(c => c.id === convId);
  pane.innerHTML = renderChatFrame(conv);
  chatBindDropzone(); // 拖入聊天区直接加入暂存区

  try {
    const data = await api(`/api/conversations/${convId}/messages`);
    if (chatConvId !== convId) return; // 用户已切走，丢弃过期响应
    // 消息接口自带的会话快照校正列表缓存（demand_id 回填 / 状态变更等陈旧字段就地刷新）
    if (data.conversation) {
      const ex = chatConvList.find(c => c.id === convId);
      if (ex) Object.assign(ex, data.conversation);
    }
    const msgs = data.messages || [];
    const box = document.getElementById('chat-messages');
    if (!box) return;
    box.innerHTML = msgs.length
      ? msgs.map((m, i) => renderChatBubble(m, i)).join('')
      : `<div class="empty-state empty-state--small"><p>${UI.CHAT_EMPTY_NO_MESSAGES}</p></div>`;
    // #150：已签约提示随请求气泡模板渲染（status='signed' 自带 caption），无需额外注入
    chatLastMsgId = msgs.length ? msgs[msgs.length - 1].id : 0;
    chatScrollToBottom(false);
    if (msgs.some(m => (m.kind === 'image' || m.kind === 'file') && !m.body)) chatLazyLoadAttachments(); // 骨架占位延迟补载
    markReadConv(convId); // 打开即已读：会话项与侧边栏红点点掉
    chatStartPolling();
    if (window.innerWidth > CONFIG.BREAKPOINT_MOBILE) { // 移动端不自动聚焦，避免键盘弹出遮挡
      const ta = document.getElementById('chat-input');
      if (ta) ta.focus();
    }
  } catch (err) {
    if (chatConvId !== convId) return;
    const box = document.getElementById('chat-messages');
    if (box) box.innerHTML = `<div class="empty-state empty-state--small"><p>${UI.ERROR_LOAD_PREFIX}${escHtml(err.message)}</p></div>`;
  }
}

// 聊天窗骨架：头部（对方名 + 身份）+ 气泡区 + 输入区。
// 会话关闭（status 非 active，服务端亦会 403）时输入区换成提示条。
// 需求四·第1条：会话与需求/签约解耦——头部不显示需求编号、不显示「已签约」tag，会话只是发起签约的入口；
// 第4条：签约确认后「已建议签合同」提示随签约请求气泡渲染（模板终态渲染 + 在途注入），
// 不再独立于消息流顶部。
function renderChatFrame(conv) {
  const peer = conv ? chatPeerOf(conv) : { name: '', role: '' };
  const closed = conv && conv.status && conv.status !== STATUS.ACTIVE;
  return `
    <div class="chat-head glass">
      <button type="button" class="chat-back glass" onclick="backToConvList()">&larr; ${UI.CHAT_BACK_TO_LIST}</button>
      <div class="chat-head-main">
        <span class="chat-peer-name">${peer.name ? DISP.usernameHtml(peer.name) : escHtml(UI.CHAT_UNKNOWN_USER)}${DISP.deactivatedTag(peer.name)}</span>
        <span class="chat-peer-tag glass glass--solid">${peer.role}</span>
      </div>
      ${peer.id ? `<button type="button" class="chat-peer-profile-btn" title="${UI.PROFILE_PANEL_TITLE}" onclick="openProfilePanel(${peer.id})">
        <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" aria-hidden="true">
          <circle cx="12" cy="8" r="3.6"/><path d="M4.6 19.4c1.6-3.3 4.2-5 7.4-5s5.8 1.7 7.4 5"/>
        </svg>
      </button>` : ''}
    </div>
    <div class="chat-messages" id="chat-messages"><div class="empty-state empty-state--small">${loaderHtml()}</div></div>
    <div class="chat-drop-hint hidden" id="chat-drop-hint">${UI.CHAT_DROP_HINT}</div>
    <div class="chat-stage hidden glass" id="chat-stage"></div>
    <div class="chat-input-bar glass${closed ? ' chat-input-bar--closed' : ''}">
      ${closed
        ? `<p class="chat-closed-tip">${UI.CHAT_CLOSED_TIP}</p>`
        : `<textarea id="chat-input" class="form-input chat-textarea" rows="1"
             placeholder="${UI.CHAT_INPUT_PLACEHOLDER}"
             onkeydown="chatInputKeydown(event)" oninput="chatAutogrow(this)"></textarea>
           <div class="chat-actions">
             <div class="chat-plus-wrap" id="chat-plus-wrap">
               <div class="chat-plus-pop glass glass--float">
                 <label class="chat-pop-item" for="chat-image-input" onclick="closeChatPlus()">${UI.CHAT_ATTACH_IMAGE}</label>
                 <label class="chat-pop-item" for="chat-file-input" onclick="closeChatPlus()">${UI.CHAT_ATTACH_FILE}</label>
                 <button type="button" class="chat-pop-item" onclick="chatPlusSigning()">${UI.SIGNING_MODAL_TITLE}</button> <!-- 发起签约 -->
                 <button type="button" class="chat-pop-item" onclick="chatPlusDraft()">${UI.CHAT_BTN_DRAFT_CONTRACT}</button>
               </div>
               <input type="file" id="chat-image-input" accept="image/*" class="sr-file-input" onchange="chatOnImagePicked(this)">
               <input type="file" id="chat-file-input" class="sr-file-input" onchange="chatOnFilePicked(this)">
               <button type="button" class="chat-plus-btn glass glass--pressable" aria-label="${UI.CHAT_PLUS_ARIA}" onclick="toggleChatPlus()">
                 <span class="plus-bar plus-h"></span><span class="plus-bar plus-v"></span>
               </button>
             </div>
             <button type="button" class="btn btn-sm chat-send glass glass--pressable" id="chat-send-btn" onclick="sendChatMessage()">${UI.CHAT_BTN_SEND}</button>
           </div>`}
    </div>`;
}

// 未选中会话时的占位（桌面端常驻右栏）
function renderChatPlaceholder() {
  return `<div class="chat-placeholder">
    <span class="chat-placeholder-dots" aria-hidden="true"><span></span><span></span><span></span><span></span></span>
    <p class="chat-placeholder-title">${UI.CHAT_PLACEHOLDER_TITLE}</p>
    <p class="chat-placeholder-sub">${UI.CHAT_PLACEHOLDER_SUB}</p>
  </div>`;
}

// 单条消息气泡：自己靠右（墨底纸字），对方靠左（浅棕底墨字）
function renderChatBubble(m, i) {
  const mine = state.user && m.sender_user_id === state.user.id;
  const delay = `--i:${Math.min(i || 0, CONFIG.CHAT_BUBBLE_DELAY_MS)}`;
  const time = `<span class="chat-msg-time">${escHtml(fmtChatTime(m.created_at))}</span>`;
  const side = mine ? 'chat-msg--mine' : 'chat-msg--theirs';
  const skin = mine ? 'chat-bubble--mine' : 'chat-bubble--theirs';
  // 合同事件消息：不再居中系统胶囊——改为对应用户一侧的普通气泡
  // （起草方右侧 / 接收方左侧，同普通消息皮肤与对齐）。用户反馈：居中灰泡观感突兀，应融入消息流。
  // 整改：合同请求气泡加呼吸遮罩（chat-bubble--breathe，柔和呼吸光环强调新合同动作）。
  if (m.kind === 'contract') {
    const text = mine ? UI.CHAT_CONTRACT_BUBBLE_MINE : UI.CHAT_CONTRACT_BUBBLE_OTHER;
    return `<div class="chat-msg ${side}" data-mid="${m.id}" style="${delay}">
      <div class="chat-bubble glass ${skin} chat-bubble--breathe">${escHtml(text)}</div>${time}</div>`;
  }
  // 发起签约气泡（极简签约流）：报价/时间/方式三条信息 + 底部确认/拒绝按钮；
  // 对方回应后气泡变灰、按钮消失为无组件小灰字（data-signing-id 供 respondSigning 就地刷新）
  // 重构：细长居中系统条 → 对应用户（发起方）一侧的大气泡，与普通消息同皮肤同对齐
  // ：与合同提示统一引用同一种底层样式 chat-bubble--breathe（用户质询「不统一=没有引用同一种底层样式」）
  //   ——合同气泡/签约请求/签约回应三系流程提示气泡恒挂 breathe，不再按状态条件引用
  if (m.kind === 'signing_request') {
    let s = {};
    try { s = JSON.parse(m.body || '{}'); } catch { /* 坏 body 兜底为空 */ }
    const recipient = !mine; // 接收方（非消息发送者）可确认/拒绝
    const price = Number(s.price) || 0;
    const methodName = s.method === 'online' ? UI.SIGNING_METHOD_ONLINE : UI.SIGNING_METHOD_OFFLINE;
    // 网安加固（审计修复）：signing id 仅接受纯数字——历史/异常消息体可含任意串，直接插值会
    // 注入 data 属性与 onclick 上下文（respondSigning 内部还按该值拼属性选择器）；非数字视为无效 id
    const signingId = /^\d+$/.test(String(s.id || '')) ? String(s.id) : '';
    const pending = s.status === STATUS.PENDING;
    const rejected = s.status === STATUS.REJECTED;
    return `<div class="chat-msg ${side}" data-mid="${m.id}" style="${delay}">
      <div class="chat-bubble glass ${skin} signing-bubble${rejected ? ' signing-bubble--done' : ''} chat-bubble--breathe" data-signing-id="${escHtml(signingId)}">
        <div class="signing-bubble-title">${mine ? UI.CHAT_SIGNING_MINE_TITLE : UI.CHAT_SIGNING_REQUEST_TITLE}</div>
        <div class="signing-bubble-row"><span>${UI.CHAT_SIGNING_PRICE}</span><b>${price} ${UI.PRICE_UNIT}/小时</b></div>
        <div class="signing-bubble-row"><span>${UI.CHAT_SIGNING_SCHEDULE}</span><b>${escHtml(String(s.schedule || ''))}</b></div>
        <div class="signing-bubble-row"><span>${UI.CHAT_SIGNING_METHOD}</span><b>${methodName}</b></div>
        ${pending && recipient && signingId ? `<div class="signing-bubble-actions">
          <button type="button" class="btn btn-sm glass glass--pressable" onclick="respondSigning(${signingId}, true)">${UI.BTN_SIGNING_CONFIRM}</button>
          <button type="button" class="btn btn-sm btn-outline glass glass--pressable" onclick="respondSigning(${signingId}, false)">${UI.BTN_SIGNING_REJECT}</button>
        </div>` : ''}
        ${rejected ? `<p class="signing-bubble-status">${escHtml(UI.SIGNING_REJECTED_TEXT)}</p>` : ''}
        ${s.status === STATUS.SIGNED ? `
          <p class="signing-bubble-signed-tip">${escHtml(UI.CHAT_SIGN_TIP)}</p>
          <button type="button" class="btn glass glass--pressable signing-bubble-draft-btn" onclick="chatPlusDraft()">${UI.CHAT_BTN_DRAFT_CONTRACT}</button>` : ''}
        ${s.status !== STATUS.SIGNED ? `<p class="signing-bubble-funds">${UI.FUNDS_NOTE_SHORT}</p>` : ''}
      </div>${time}</div>`;
  }
  // 签约回应气泡（对方确认/拒绝后落一条，在途会话实时刷新）
  // 审计：视角修正——回应方看到「你已…」，发起方看到「对方已…」（原恒显「对方已…」颠倒）
  // 重构：与签约请求同口径——对齐回应方一侧（sender=回应方），风格统一
  // ：与合同提示统一呼吸样式（chat-bubble--breathe）——用户质询「提示之间亦有区别吗」：
  //   合同草案/签约请求/签约回应同属流程提示，一致使用柔和呼吸强调，不再区分样式
  if (m.kind === 'signing_response') {
    let r = {};
    try { r = JSON.parse(m.body || '{}'); } catch { /* 兜底 */ }
    const text = mine
      ? (r.accept ? UI.SIGNING_MY_CONFIRMED : UI.SIGNING_MY_REJECTED)
      // 会话统一「对方已确认/已拒绝」——通知不含具体用户 id
      : (r.accept ? UI.SIGNING_CONFIRMED : UI.SIGNING_REJECTED);
    return `<div class="chat-msg ${side}" data-mid="${m.id}" style="${delay}">
      <div class="chat-bubble glass ${skin} chat-bubble--breathe">${escHtml(text)}</div>${time}</div>`;
  }
  // 图片 / 文件消息：列表接口不下发 dataURL 本体（性能）；图片带缩略图（thumb）预载
  // 立即展示、点开拉原图；无缩略图（文件/历史图片）先渲染骨架，由 chatLazyLoadAttachments 补载
  if (m.kind === 'image' || m.kind === 'file') {
    // 修正：媒体内容（thumb/全图/文件卡）一律包气泡 div；仅两者皆空才走骨架占位
    // 文件卡与图片分流——图片全出血无内衬，文件卡带圆角内衬（.chat-bubble--file）
    const mediaCls = m.kind === 'file' ? ' chat-bubble--file' : '';
    const media = (m.body || m.thumb)
      ? `<div class="chat-bubble glass ${skin} chat-bubble--media${mediaCls}">${renderChatMediaInner(m.kind, m.body, m.name, m.thumb, m.id)}</div>`
      : `<div class="chat-bubble glass ${skin} chat-bubble--media${mediaCls} chat-bubble--loading" data-attach="${m.id}" data-attach-kind="${m.kind}">${chatStageRing(30)}</div>`;
    return `<div class="chat-msg ${side}" data-mid="${m.id}" style="${delay}">${media}${time}</div>`;
  }
  return `<div class="chat-msg ${side}" data-mid="${m.id}" style="${delay}">
    <div class="chat-bubble glass ${skin}">${escHtml(m.body)}</div>${time}</div>`;
}

// 图片/ 文件卡片
function renderChatMediaInner(kind, body, name, thumb, mid) {
  // 网安审计 N-03：发送方注销后附件本体被服务端清空（body=''），此处占位而非渲染死链接/空图
  if (!body && !thumb) return `<span class="chat-attach-fail">${UI.CHAT_ATTACH_REMOVED}</span>`;
  if (kind === 'image') {
    // body=全图（本人刚发/历史懒加载已补载）→ data-full 标记，点击直开大图；
    // 否则展示 thumb（列表预载），点击 chatOpenImage 经 attachment 接口拉原图
    const full = body ? ' data-full="1"' : '';
    return `<img src="${escHtml(thumb || body || '')}" alt="${UI.CHAT_ATTACH_IMAGE}" loading="lazy" data-mid="${escHtml(String(mid || ''))}"${full} onclick="chatOpenImage(${Number(mid) || 0}, this)">`;
  }
  // 客户端 scheme 自守：仅 data: 才作可下载 href（服务端已强制 data: 前缀，此为纵深防御，杜绝 javascript: 等）
  const href = String(body || '').startsWith('data:') ? body : '#';
  return `<div class="chat-file">
    <span class="chat-file-icon">${escHtml(chatFileExt(name))}</span>
    <span class="chat-file-info">
      <span class="chat-file-name">${escHtml(name || UI.CHAT_FILE_FALLBACK)}</span>
      <span class="chat-file-size">${chatFileSize(body)}</span>
    </span>
    <a class="chat-file-dl" href="${escHtml(href)}" download="${escHtml(name || '')}">${UI.CHAT_DOWNLOAD}</a>
  </div>`;
}

// 人性化文件大小（dataURL 长度 → 字节；base64 按 3/4 换算，非 base64 按原始长度）
function chatFileSize(dataUrl) {
  try {
    const s = String(dataUrl || '');
    const b64Idx = s.indexOf(';base64,');
    const bytes = b64Idx >= 0 ? Math.round((s.length - b64Idx - 8) * 3 / 4) : s.length;
    if (bytes < 1024) return `${bytes} B`;
    if (bytes < 1048576) return `${(bytes / 1024).toFixed(1)} KB`;
    return `${(bytes / 1048576).toFixed(2)} MB`;
  } catch { return ''; }
}

// 附件懒加载：消息区渲染完（页面可操作）后延迟补载骨架占位的真实 dataURL
function chatLazyLoadAttachments() {
  const convId = chatConvId;
  setTimeout(async () => {
    const pending = [...document.querySelectorAll('.chat-bubble--loading[data-attach]')];
    // F11：串行 await 循环 → 有界并发（~4 波）——历史多附件会话
    // N 次串行往返 → ~N/4 波（每波一个 RTT 内并行）；会话切换丢弃语义不变（每波检查 chatConvId）。
    const CONCURRENCY = 4;
    let i = 0;
    const worker = async () => {
      while (i < pending.length) {
        const el = pending[i++];
        if (chatConvId !== convId) return; // 会话已切走，丢弃
        const mid = el.dataset.attach;
        try {
          const data = await api(`/api/conversations/${convId}/messages/${mid}/attachment`);
          if (chatConvId !== convId) return;
          el.innerHTML = renderChatMediaInner(el.dataset.attachKind, data.body || '', data.name || '');
          el.classList.remove('chat-bubble--loading');
          delete el.dataset.attach;
        } catch {
          el.classList.remove('chat-bubble--loading');
          el.innerHTML = `<span class="chat-attach-fail">${UI.CHAT_ATTACH_FAIL}</span>`;
          // 审计 C：失败也删 data-attach——否则永久失败附件（对方注销后附件清空等）每次懒加载
          // 触发（轮询带回新附件）都被反复重拉重失败
          delete el.dataset.attach;
        }
      }
    };
    await Promise.all(Array.from({ length: Math.min(CONCURRENCY, pending.length) }, worker));
  }, CONFIG.CHAT_SLIDE_DELAY_MS);
}

// 点开图片：缩略图（无 data-full）→ 拉原图后开大图并把气泡 src 升级为原图（二次点击直开）；
// 已带原图（本人刚发/历史懒加载，data-full=1）→ 直开。大图查看器通用件在 app-ui openImageViewer。
async function chatOpenImage(mid, img) {
  if (img && img.dataset.full === '1') { openImageViewer(img.src); return; }
  const convId = chatConvId;
  if (!convId || !mid) { showToast(UI.CHAT_ATTACH_FAIL); return; }
  try {
    const data = await api(`/api/conversations/${convId}/messages/${mid}/attachment`);
    if (!data.body) { showToast(UI.CHAT_ATTACH_FAIL); return; } // 注销方附件清空/取不到
    if (img) { img.dataset.full = '1'; img.src = data.body; }
    openImageViewer(data.body);
  } catch { showToast(UI.CHAT_ATTACH_FAIL); }
}

// ============================================================
// 轮询：4s 拉增量（sinceId = 已见最大 id），追加并滚底
// ============================================================
function chatStartPolling() {
  if (chatPollTimer) clearInterval(chatPollTimer);
  chatPollTimer = setInterval(chatPollTick, CONFIG.CHAT_POLL_MS);
}

// 对外清理口：登出 / 切页等场景调用，干净终止定时器与会话状态
function stopChatPolling() {
  if (chatPollTimer) { clearInterval(chatPollTimer); chatPollTimer = null; }
  // 清未发送的暂存项：在途上传 abort + 已上传 best-effort 删（防跨账号残留与孤儿堆积）
  chatAbortStagedUploads();
  chatConvId = null;
  chatLastMsgId = 0;
  chatPollBusy = false;
}

async function chatPollTick() {
  // 每次 tick 自检：切页 / 登出 / 会话已关 / 上一轮未回 / 乐观发送在途 → 不发请求
  // （乐观发送在途时轮询若拉回刚发的消息会与临时气泡双插，F10 用此标志关窗口）
  if (state.page !== 'my-chats' || !state.user || !chatConvId || chatPollBusy || chatOptimisticSending) return;
  const convId = chatConvId;
  chatPollBusy = true;
  try {
    const data = await api(`/api/conversations/${convId}/messages?sinceId=${chatLastMsgId}`);
    if (chatConvId !== convId) return; // 会话已切换，丢弃过期响应
    // 过滤掉 id 不大于已见的（防与发送后的本地追加竞态重复）
    const fresh = (data.messages || []).filter(m => m.id > chatLastMsgId);
    if (!fresh.length) return;
    const box = document.getElementById('chat-messages');
    if (!box) return;
    if (box.querySelector('.empty-state')) box.innerHTML = '';
    fresh.forEach((m, idx) => {
      if (!box.querySelector(`.chat-msg[data-mid="${m.id}"]`)) {
        box.insertAdjacentHTML('beforeend', renderChatBubble(m, idx));
      }
    });
    chatLastMsgId = fresh[fresh.length - 1].id;
    chatScrollToBottom(true);
    if (fresh.some(m => (m.kind === 'image' || m.kind === 'file') && !m.body)) chatLazyLoadAttachments(); // 轮询带回的附件补载
    chatBumpConvPreview(convId, fresh[fresh.length - 1]); // 左栏预览同步 + 置顶
    // #150：对方确认签约 → 把提示卡注入到配对的签约请求气泡底下（幂等；重开会话走模板终态渲染）
    fresh.filter(m => m.kind === 'signing_response').forEach(m => {
      let r = {};
      try { r = JSON.parse(m.body || '{}'); } catch { /* 兜底 */ }
      if (r.accept && /^\d+$/.test(String(r.requestId || ''))) chatInjectSignCaption(r.requestId);
    });
    if (fresh.some(m => m.sender_user_id !== state.user.id)) markReadConv(convId); // 看着的会话收到对方消息：就地已读
  } catch (err) {
    // 网络抖动静默，下一 tick 自愈
  } finally {
    chatPollBusy = false;
  }
}

// ============================================================
// 发送
// ============================================================
async function sendChatMessage() {
  if (chatSending) return;
  const ta = document.getElementById('chat-input');
  const convId = chatConvId;
  if (!ta || !convId) return;
  const text = ta.value.trim();
  const staged = chatStaged.slice();
  if (!text && !staged.length) { ta.focus(); return; }
  if (staged.some(it => !it.ready)) { showToast(UI.CHAT_STAGE_WAIT); return; } // 进度圈未走完不许发

  const btn = document.getElementById('chat-send-btn');
  chatSending = true;
  chatOptimisticSending = true; // F10：乐观发送在途关轮询窗口（防临时气泡与轮询真实气泡双插）
  btnLoading(btn);

  // F10乐观发送：本地立即插入临时气泡（负 id），一次批量 POST 落库，响应替换真实 id；
  // 失败移除临时气泡 + 恢复输入/暂存（audit-flow 断点可能驳回，须回滚）。data-mid 去重语义对齐旧实现。
  // F9 批量：附件确认 + 文字一次写往返（2N+1 串行写 → 1），服务端单事务 db.batch
  // （服务端每附件 1 次归属读 + 1 写批，边界 MSG_BATCH_MAX=13 封顶）。
  const box = document.getElementById('chat-messages');
  const optimistic = [];        // { tempId, kind, body, name }
  let tempSeq = -900000 - Date.now() % 1000; // 负临时 id（与真实自增 id 空间不冲突）
  const stagedCopy = staged.map(it => ({ ...it }));

  // 乐观 UI：先清输入框 + 暂存区，立即渲染全部消息气泡
  if (text) { ta.value = ''; chatAutogrow(ta); }
  chatStaged = [];
  renderChatStage();
  const appendOptimistic = (m) => {
    const tempId = --tempSeq;
    optimistic.push({ tempId, kind: m.kind || 'text', body: m.body, name: m.name || '' });
    if (box) {
      if (box.querySelector('.empty-state')) box.innerHTML = '';
      box.insertAdjacentHTML('beforeend', renderChatBubble({
        id: tempId, sender_user_id: state.user.id, kind: m.kind || 'text', body: m.body, name: m.name || '', created_at: chatNowStamp(),
      }, 0));
      chatScrollToBottom(true);
    }
  };
  for (const it of stagedCopy) appendOptimistic({ kind: it.kind, body: it.dataUrl, name: it.name });
  if (text) appendOptimistic({ kind: 'text', body: text });

  try {
    // 批量发送：附件凭 uploadId（数据已暂存），文字随批
    const batch = stagedCopy.map(it => ({ kind: it.kind, uploadId: it.uploadId }));
    if (text) batch.push({ kind: 'text', body: text });
    const data = await api(`/api/conversations/${convId}/messages`, { method: 'POST', body: { batch } });
    if (chatConvId !== convId) return; // 发送中切走会话：丢弃（乐观气泡随会话重开消失）
    // 响应按批序返回真实 id：替换临时气泡 data-mid。
    // 竞态（审计）：发送发起前已在途的轮询不受 chatOptimisticSending 关窗约束——若服务端 GET 排在
    // batch POST 之后处理，会带回刚发的真实 id；轮询去重查 data-mid 因临时气泡还是负 id 而 miss，
    // 先插了真实气泡。此处若发现真实 id 气泡已被轮询抢插 → 移除临时气泡去重（否则同消息双气泡）。
    const created = data.messages || [];
    let maxId = chatLastMsgId;
    created.forEach((m, i) => {
      const op = optimistic[i];
      if (!op || !m.id) return;
      const el = box && box.querySelector(`.chat-msg[data-mid="${op.tempId}"]`);
      if (el) {
        if (box.querySelector(`.chat-msg[data-mid="${m.id}"]`)) {
          el.remove(); // 轮询已抢插真实气泡 → 移除临时气泡（双气泡去重）
        } else {
          el.dataset.mid = String(m.id);
        }
      }
      if (m.id > maxId) maxId = m.id;
    });
    chatLastMsgId = maxId; // 防下一轮轮询重复拉回自己这批
    const lastOp = optimistic[optimistic.length - 1];
    if (lastOp) chatBumpConvPreview(convId, {
      body: lastOp.kind === 'text' ? lastOp.body : '', kind: lastOp.kind, name: lastOp.name,
      created_at: chatNowStamp(), sender_user_id: state.user.id,
    });
    // 按钮微反馈：弹一下
    if (btn) { btn.classList.remove('chat-send--flash'); void btn.offsetWidth; btn.classList.add('chat-send--flash'); }
  } catch (err) {
    // 失败回滚：移除乐观临时气泡 + 恢复输入/暂存（audit-flow 驳回/网络错误均可重试）
    if (chatConvId === convId) {
      for (const op of optimistic) {
        const el = box && box.querySelector(`.chat-msg[data-mid="${op.tempId}"]`);
        if (el) el.remove();
      }
      if (text) { ta.value = text; chatAutogrow(ta); }
      chatStaged = stagedCopy;
      renderChatStage();
    }
    showToast(err.message);
  } finally {
    chatOptimisticSending = false;
    chatSending = false;
    btnDone(btn, UI.CHAT_BTN_SEND);
    ta.focus();
  }
}

// Enter 发送 / Shift+Enter 换行；中文输入法组词期的 Enter（选字）不触发发送
function chatInputKeydown(e) {
  if (e.key === 'Enter' && !e.shiftKey && !e.isComposing) {
    e.preventDefault();
    sendChatMessage();
  }
}

// 输入框随内容自适应增高（上限 120px，再多内部滚动）
function chatAutogrow(ta) {
  ta.style.height = 'auto';
  ta.style.height = Math.min(ta.scrollHeight, 120) + 'px';
}

// ---------- 图片 / 文件：暂存预览 + 圆圈进度 + 拖入聊天区 ----------
// 选中/拖入的附件先进输入框上方暂存区（小圆角缩略 + 圆圈进度），处理完成才可发送；
// 点发送才真正逐个发请求（类 AI 聊天端流程）
let chatStaged = [];
let chatStageSeq = 0;

// 弹层选项是 <label for> 指向文件框（原生激活 = 真实用户手势，无需程序化 click，iOS 全兼容）；
// 取文件必须先拷贝再清空：input.files 是活引用，先清 value 会连持有的一份一起清空（选完文件无反应的根因）
function chatOnImagePicked(input) { const files = [...input.files]; input.value = ''; if (files.length) chatStageFiles(files); }
function chatOnFilePicked(input) { const files = [...input.files]; input.value = ''; if (files.length) chatStageFiles(files); }

function chatStageFiles(files) {
  [...files].forEach(f => {
    const item = { id: ++chatStageSeq, name: f.name || UI.CHAT_FILE_FALLBACK, progress: 0, ready: false, uploadId: null, dataUrl: '' };
    if ((f.type || '').startsWith('image/')) {
      item.kind = 'image';
      chatStaged.push(item);
      renderChatStage();
      const reader = new FileReader();
      reader.onload = () => chatShrinkImage(reader.result, (url, thumb) => chatDoUpload(item, url, thumb)); // 先本地压缩+出缩略图再传
      reader.onerror = () => { chatUnstage(item.id); showToast(UI.CHAT_FILE_TOO_LARGE); };
      reader.readAsDataURL(f);
    } else {
      if (f.size > CONFIG.CHAT_FILE_MAX_BYTES) { showToast(UI.CHAT_FILE_TOO_LARGE); return; }
      item.kind = 'file';
      chatStaged.push(item);
      renderChatStage();
      const reader = new FileReader();
      reader.onload = () => chatDoUpload(item, reader.result);
      reader.onerror = () => { chatUnstage(item.id); showToast(UI.CHAT_FILE_TOO_LARGE); };
      reader.readAsDataURL(f);
    }
  });
}

// 进暂存区 = 真实上传服务器：进度圈即 XHR 上传字节进度（肉眼可见的真实进度）；
// 传完拿到 uploadId 变为可发送——发送按钮只是「确认载入会话」，不再传数据
function chatUploadToServer(item, dataUrl, onProgress) {
  return new Promise((resolve, reject) => {
    const xhr = new XMLHttpRequest();
    item._xhr = xhr; // 挂到暂存项：切会话/登出时可 abort（防孤儿附件）
    xhr.open('POST', '/api/uploads');
    xhr.setRequestHeader('Content-Type', 'application/json');
    if (state.authToken) xhr.setRequestHeader('X-Auth-Token', state.authToken); // 裸 XHR 不继承 api() 的令牌头；缺此则上传恒 401（令牌化迁移漏网）
    xhr.upload.onprogress = e => { if (e.lengthComputable) onProgress(Math.min(99, Math.round(e.loaded / e.total * 100))); };
    xhr.onload = () => {
      item._xhr = null; // 完成即摘牌
      let data = {};
      try { data = JSON.parse(xhr.responseText); } catch { /* ignore */ }
      if (xhr.status >= 200 && xhr.status < 300) resolve(data);
      else reject(new Error(data.error || ('HTTP ' + xhr.status)));
    };
    xhr.onerror = () => { item._xhr = null; const e = new Error(UI.NETWORK_ERROR); e.code = 'NETWORK_ERROR'; reject(e); }; // 网络错误捕获环节 4/4：上传断线明确文案
    xhr.send(JSON.stringify({ kind: item.kind, fileData: dataUrl, fileName: item.name, thumb: item.thumb || '' })); // 缩略图随传；身份一律凭令牌，移除自报 userId（服务端早已忽略）
  });
}

async function chatDoUpload(item, dataUrl, thumbUrl) {
  item.dataUrl = dataUrl;
  item.thumb = thumbUrl || ''; // 缩略图随暂存项保存，发送时随 uploadId 落库
  renderChatStage(); // 图片缩略先亮（本地数据），进度圈开始转真实上传进度
  try {
    const data = await chatUploadToServer(item, dataUrl, p => { item.progress = p; renderChatStage(); });
    if (item._aborted) return; // 上传期间会话已切换/登出：不把 uploadId 写进孤儿项（服务器残留由 abort 的请求自行终结）
    item.uploadId = data.id;
    item.progress = 100;
    item.ready = true;
    renderChatStage();
  } catch (err) {
    if (item._aborted) return; // abort 触发的错误不算失败：项已被清空，不弹错
    chatUnstage(item.id);
    showToast(err.message);
  }
}

// 图片压缩 + 缩略图：最长边缩至 CONFIG.CHAT_IMG_MAX_SIDE 内出全图，再缩至
// CHAT_IMG_THUMB_SIDE 出缩略图（预载展示、点开拉原图）。一次 onload 双画布（复用同一压缩源）。
function chatShrinkImage(src, cb) {
  const img = new Image();
  img.onload = () => {
    const MAX = CONFIG.CHAT_IMG_MAX_SIDE;
    const scale = Math.min(1, MAX / Math.max(img.width, img.height));
    const w = Math.max(1, Math.round(img.width * scale));
    const h = Math.max(1, Math.round(img.height * scale));
    const cv = document.createElement('canvas');
    cv.width = w; cv.height = h;
    cv.getContext('2d').drawImage(img, 0, 0, w, h);
    const full = cv.toDataURL('image/jpeg', CONFIG.CHAT_IMG_QUALITY);
    const TS = CONFIG.CHAT_IMG_THUMB_SIDE;
    const ts = Math.min(1, TS / Math.max(w, h));
    const tw = Math.max(1, Math.round(w * ts));
    const th = Math.max(1, Math.round(h * ts));
    const tcv = document.createElement('canvas');
    tcv.width = tw; tcv.height = th;
    tcv.getContext('2d').drawImage(cv, 0, 0, tw, th);
    cb(full, tcv.toDataURL('image/jpeg', CONFIG.CHAT_IMG_THUMB_QUALITY));
  };
  img.onerror = () => showToast(UI.CHAT_FILE_TOO_LARGE);
  img.src = src;
}

function chatUnstage(id) {
  const it = chatStaged.find(x => x.id === id);
  chatStaged = chatStaged.filter(x => x.id !== id);
  renderChatStage();
  if (it && it.uploadId) {
    // 已上传的文件同步从服务器暂存区删除（best effort）
    api(`/api/uploads/${it.uploadId}`, { method: 'DELETE', body: {} }).catch(() => {});
  }
}

function chatFileExt(name) { const m = /\.([a-zA-Z0-9]+)$/.exec(name || ''); return m ? m[1].toUpperCase() : 'FILE'; }

function chatStageRing(p) {
  const C = 2 * Math.PI * 13;
  const off = C * (1 - Math.max(0, Math.min(100, p)) / 100);
  return `<svg class="chat-stage-ring" viewBox="0 0 32 32" aria-hidden="true">
    <circle class="ring-track" cx="16" cy="16" r="13"></circle>
    <circle class="ring-bar" cx="16" cy="16" r="13" stroke-dasharray="${C.toFixed(1)}" stroke-dashoffset="${off.toFixed(1)}"></circle>
  </svg>`;
}

// 渲染暂存区（聊天/投诉附件共用；U11 泛化）：items = 宿主暂存数组，delExpr(it) = 删除回调内联表达式
function renderStageBox(items, el, delExpr) {
  if (!el) return;
  if (!items.length) { el.classList.add('hidden'); el.innerHTML = ''; return; }
  el.classList.remove('hidden');
  el.innerHTML = items.map(it => {
    const media = it.kind === 'image' && it.dataUrl
      ? `<img src="${escHtml(it.dataUrl)}" alt="${UI.CHAT_ATTACH_IMAGE}">`
      : `<span class="chat-stage-file"><span class="chat-stage-ext">${escHtml(chatFileExt(it.name))}</span></span>`;
    const nameRow = it.kind === 'file' ? `<span class="chat-stage-name">${escHtml(it.name)}</span>` : '';
    return `<div class="chat-stage-item glass glass--solid${it.kind === 'file' ? ' chat-stage-item--file' : ''}">
      <div class="chat-stage-thumb glass glass--solid">${media}${it.ready ? '' : chatStageRing(it.progress)}</div>
      ${nameRow}
      <button type="button" class="chat-stage-del glass glass--float" onclick="${delExpr(it)}" aria-label="${UI.BTN_CANCEL}">✕</button>
    </div>`;
  }).join('');
}

function renderChatStage() {
  renderStageBox(chatStaged, document.getElementById('chat-stage'), it => `chatUnstage(${it.id})`);
}

// 发送统一走批量乐观发送（附件确认+文字一次 POST /batch 落库）；暂存上传路径 chatUploadToServer 保留不动

// 拖入聊天区：松开即加入暂存区（桌面 / 平板拖放均可）
// 审计修复：hint 由闭包捕获改为事件内现查——openConversation 每次重建
// #chat-drop-hint（随 innerHTML），旧引用指向已脱离文档节点 → 首次切会话后提示永不显示；
// zone（#chat-pane）本身不重建，dataset 防重仍成立
function chatBindDropzone() {
  const zone = document.getElementById('chat-pane');
  if (!zone || zone.dataset.dropBound) return;
  zone.dataset.dropBound = '1';
  zone.addEventListener('dragover', e => {
    e.preventDefault();
    const hint = zone.querySelector('.chat-drop-hint');
    if (hint) hint.classList.remove('hidden');
  });
  zone.addEventListener('dragleave', e => {
    const hint = zone.querySelector('.chat-drop-hint');
    if (!zone.contains(e.relatedTarget) && hint) hint.classList.add('hidden');
  });
  zone.addEventListener('drop', e => {
    e.preventDefault();
    const hint = zone.querySelector('.chat-drop-hint');
    if (hint) hint.classList.add('hidden');
    if (e.dataTransfer && e.dataTransfer.files && e.dataTransfer.files.length) chatStageFiles(e.dataTransfer.files);
  });
}

// ---------- 加号弹层（附件 + 发起签约 + 起草合同）----------
function toggleChatPlus() { document.getElementById('chat-plus-wrap').classList.toggle('open'); }
function closeChatPlus() { const w = document.getElementById('chat-plus-wrap'); if (w) w.classList.remove('open'); }
function chatPlusDraft() { closeChatPlus(); if (chatConvId) openContractDraftModal(chatConvId); }
function chatPlusSigning() { closeChatPlus(); if (chatConvId) openSigningModal(chatConvId); }

// 起：签约确认后「已与对方确认签约 + 起草合同」并入请求气泡内部。
// 底部结构钉死为
//   ① 合并提示文案（UI.CHAT_SIGN_TIP，已并入资金声明）→ ② 撑满气泡宽度的「起草合同」按钮；
// 独立 funds 小字、旧小按钮结构废除。双路呈现：1) 终态模板：重开会话拉历史，
// signing_request 气泡 status='signed' 时模板直接渲染；2) 在途注入：轮询/回应方就地确认时，
// 配对 data-signing-id 就地重建底部（幂等）。signingId 仅接受纯数字（防 CSS 选择器注入）。
function chatInjectSignCaption(signingId) {
  if (!/^\d+$/.test(String(signingId || ''))) return;
  const bubble = document.querySelector(`.chat-bubble[data-signing-id="${signingId}"]`);
  if (!bubble) return;
  if (bubble.querySelector('.signing-bubble-draft-btn')) return; // 幂等：起草按钮在即已重建
  // ① 提示文案（合并资金声明，单源 UI.CHAT_SIGN_TIP）
  let tip = bubble.querySelector('.signing-bubble-status');
  if (!tip) { tip = document.createElement('p'); bubble.appendChild(tip); }
  tip.className = 'signing-bubble-signed-tip';
  tip.textContent = UI.CHAT_SIGN_TIP;
  // 资金声明已并入提示文案：删独立 funds
  const funds = bubble.querySelector('.signing-bubble-funds');
  if (funds) funds.remove();
  // ② 起草合同按钮：左右撑满气泡（block width:100%）
  const btn = document.createElement('button');
  btn.type = 'button';
  btn.className = 'btn glass glass--pressable signing-bubble-draft-btn';
  btn.textContent = UI.CHAT_BTN_DRAFT_CONTRACT;
  btn.addEventListener('click', chatPlusDraft);
  bubble.appendChild(btn);
}

// 回应签约请求：确认/拒绝。成功后就地把请求气泡变灰 + 按钮消失为小灰字
// （服务端已更新原气泡 body 为终态并落 signing_response 响应气泡，轮询也会拉到）
// S2-2：确认签约 = 危险操作（需求锁定成交 + 自动拒绝其余意向）——接密码重认证换 capToken
// 二次认证（同合同签署/撤销口径 confirm needReAuth）；拒绝仍为普通确认。
async function respondSigning(signingId, accept) {
  const doRespond = async capToken => {
    try {
      await api(`/api/signing-requests/${signingId}/respond`, { method: 'POST', body: accept ? { accept, capToken } : { accept } });
      document.querySelectorAll(`[data-signing-id="${signingId}"]`).forEach(el => {
        const actions = el.querySelector('.signing-bubble-actions');
        if (actions) actions.remove();
        if (!accept) {
          // 拒绝：整泡变灰（终态）+ status 拒绝文案；funds 保留
          el.classList.add('signing-bubble--done');
          const status = el.querySelector('.signing-bubble-status');
          if (status) status.textContent = UI.SIGNING_REJECTED_TEXT;
          else { const p = document.createElement('p'); p.className = 'signing-bubble-status'; p.textContent = UI.SIGNING_REJECTED_TEXT; el.appendChild(p); }
        }
      });
      if (accept) chatInjectSignCaption(signingId); // 确认签约 → 就地重建气泡底部（合并提示 + 撑满起草按钮）
      showToast(accept ? UI.SIGNING_MY_CONFIRMED : UI.SIGNING_MY_REJECTED); // 回应方视角
    } catch (err) { showToast(err.message); }
  };
  if (accept) {
    confirm({ message: UI.CONFIRM_SIGNING_ACCEPT, needReAuth: true, onConfirm: capToken => doRespond(capToken) });
    return;
  }
  doRespond();
}

// 移动端：从聊天窗返回会话列表（会话保持打开，轮询继续，预览照常刷新）
function backToConvList() {
  const shell = document.getElementById('chats-shell');
  if (shell) shell.classList.remove('chats-show-chat');
}

// 跨模块查当前会话（合同起草弹窗绑定会话需求用；经典脚本共享全局作用域）
function chatConvById(id) { return chatConvList.find(c => c.id === id) || null; }

// ============================================================
// 小工具
// ============================================================

// 时间显示：服务端存 UTC，统一过 fmtDateTime 转本地时区（'YYYY-MM-DD HH:MM'）
function fmtChatTime(t) {
  return t ? fmtDateTime(t) : '';
}

// 即时时间戳（发送成功瞬间展示用，下一轮渲染被服务端时间取代）：
// 输出 ISO（UTC），与后端存储格式同源，经 fmtDateTime 转本地显示
function chatNowStamp() {
  return new Date().toISOString();
}

function chatScrollToBottom(smooth) {
  const box = document.getElementById('chat-messages');
  if (!box) return;
  const reduce = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
  box.scrollTo({ top: box.scrollHeight, behavior: smooth && !reduce ? 'smooth' : 'auto' });
}

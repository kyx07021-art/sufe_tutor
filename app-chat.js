/**
 * 我的会话（学生 / 教师侧边栏「我的会话」页，模块4）
 *
 * 经典脚本：全部顶层全局函数 + 内联 onclick（全站同一约定）。
 * 仅依赖共享层提供的基础设施：state / api / escHtml / showToast / loaderHtml / setBadge / syncPillOnce / glidePill（app-state/app-api/app-anim/app-ui 先行加载）。
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
// v0.23.1 审计 M1：探测刷新替换缓存数组后重挂别名——markReadConv/收发预览的就地变更
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
          <span class="chats-list-title">${UI.CHAT_TITLE}</span>
        </div>
        <div class="conv-list" id="conv-list"><div class="empty-state empty-state--small">${loaderHtml()}</div></div>
      </aside>
      <section class="chat-pane" id="chat-pane">
        ${renderChatPlaceholder()}
      </section>
    </div>`;
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
    const data = await dhGet('/api/conversations', { domain: 'chat' }); // v0.23.0 静默数据层
    chatConvList = data.conversations || [];
    renderConvList();
    if (typeof setBadge === 'function') setBadge('my-chats', chatsUnreadTotal()); // 同步侧边栏红点
  } catch (err) {
    const el = document.getElementById('conv-list');
    if (el) el.innerHTML = `<div class="empty-state empty-state--small"><p>${UI.ERROR_LOAD_PREFIX}${escHtml(err.message)}</p></div>`;
  }
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
  // 选中滑块（米色大色块）始终是首个子元素，glidePill/syncPillOnce 以它为指示块
  el.innerHTML = '<span class="conv-pill glass glass--solid" id="conv-pill" aria-hidden="true"></span>' +
    chatConvList.map(renderConvItem).join('');
  syncChatPill(); // 全量重渲染后条目刚布局完，pill 立即归位（无滑动）
}

// 共享滑块同步口（app-anim syncPillOnce 的本页封装）。
// app-anim 的全局 window resize 处理会在本函数存在时调用它，缩放时选中块即时重对齐。
function syncChatPill() {
  syncPillOnce(document.getElementById('conv-pill'), document.getElementById('conv-list'), '.conv-item');
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

function renderConvItem(c) {
  const peer = chatPeerOf(c);
  const me = state.user.id;
  let preview = UI.CHAT_EMPTY_NO_MESSAGES;
  if (c.last_kind === 'contract') {
    preview = UI.CHAT_PREVIEW_CONTRACT;
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
      <span class="conv-item-name">${DISP.usernameHtml(peer.name || UI.CHAT_UNKNOWN_USER)}</span>
      <span class="conv-item-role glass glass--solid">${peer.role}</span>
      ${c.contracted ? `<span class="conv-signed-tag glass glass--solid">${UI.PROFILE_SIGNED_TAG}</span>` : ''}
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
  glidePill(document.getElementById('conv-pill'), document.getElementById('conv-list'), '.conv-item'); // 米色块滑向新会话
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

// 聊天窗骨架：头部（对方名 + 身份 + 需求编号）+ 气泡区 + 输入区。
// 会话关闭（status 非 active，服务端亦会 403）时输入区换成提示条。
function renderChatFrame(conv) {
  const peer = conv ? chatPeerOf(conv) : { name: '', role: '' };
  const closed = conv && conv.status && conv.status !== 'active';
  return `
    <div class="chat-head glass">
      <button type="button" class="chat-back glass" onclick="backToConvList()">&larr; ${UI.CHAT_BACK_TO_LIST}</button>
      <div class="chat-head-main">
        <span class="chat-peer-name">${peer.name ? DISP.usernameHtml(peer.name) : escHtml(UI.CHAT_UNKNOWN_USER)}</span>
        <span class="chat-peer-tag glass glass--solid">${peer.role}</span>
        ${conv && conv.contracted ? `<span class="chat-head-signed glass glass--solid">${UI.PROFILE_SIGNED_TAG}</span>` : ''}
        ${conv && conv.demand_display_id ? `<span class="chat-head-demand">${UI.CHAT_DEMAND_PREFIX}${String(conv.demand_display_id).padStart(4, '0')}</span>` : ''}
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
                 <button type="button" class="chat-pop-item" onclick="chatPlusSigning()">${UI.SIGNING_MODAL_TITLE}</button> <!-- v0.24.0 发起签约（极简签约流） -->
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
  const delay = `--i:${Math.min(i || 0, 12)}`;
  const time = `<span class="chat-msg-time">${escHtml(fmtChatTime(m.created_at))}</span>`;
  const side = mine ? 'chat-msg--mine' : 'chat-msg--theirs';
  const skin = mine ? 'chat-bubble--mine' : 'chat-bubble--theirs';
  // 合同事件系统气泡：独立淡紫块居中，文案按查看者区分（起草方 / 接收方）
  if (m.kind === 'contract') {
    const text = mine ? UI.CHAT_CONTRACT_BUBBLE_MINE : UI.CHAT_CONTRACT_BUBBLE_OTHER;
    return `<div class="chat-msg chat-msg--system" data-mid="${m.id}" style="${delay}">
      <div class="chat-bubble chat-bubble--system glass">${escHtml(text)}</div>${time}</div>`;
  }
  // v0.24.0 发起签约气泡（极简签约流）：报价/时间/方式三条信息 + 底部确认/拒绝按钮；
  // 对方回应后气泡变灰、按钮消失为无组件小灰字（data-signing-id 供 respondSigning 就地刷新）
  if (m.kind === 'signing_request') {
    let s = {};
    try { s = JSON.parse(m.body || '{}'); } catch { /* 坏 body 兜底为空 */ }
    const recipient = !mine; // 接收方（非消息发送者）可确认/拒绝
    const price = Number(s.price) || 0;
    const methodName = s.method === 'online' ? UI.SIGNING_METHOD_ONLINE : UI.SIGNING_METHOD_OFFLINE;
    const pending = s.status === 'pending';
    const done = s.status === 'signed' ? UI.SIGNING_CONFIRMED_TEXT : (s.status === 'rejected' ? UI.SIGNING_REJECTED_TEXT : '');
    return `<div class="chat-msg chat-msg--system" data-mid="${m.id}" style="${delay}">
      <div class="chat-bubble chat-bubble--system glass signing-bubble${done ? ' signing-bubble--done' : ''}" data-signing-id="${s.id}">
        <div class="signing-bubble-title">${mine ? UI.CHAT_SIGNING_MINE_TITLE : UI.CHAT_SIGNING_REQUEST_TITLE}</div>
        <div class="signing-bubble-row"><span>${UI.CHAT_SIGNING_PRICE}</span><b>${price} ${UI.PRICE_UNIT}/小时</b></div>
        <div class="signing-bubble-row"><span>${UI.CHAT_SIGNING_SCHEDULE}</span><b>${escHtml(String(s.schedule || ''))}</b></div>
        <div class="signing-bubble-row"><span>${UI.CHAT_SIGNING_METHOD}</span><b>${methodName}</b></div>
        ${pending && recipient ? `<div class="signing-bubble-actions">
          <button type="button" class="btn btn-sm glass glass--pressable" onclick="respondSigning(${s.id}, true)">${UI.BTN_SIGNING_CONFIRM}</button>
          <button type="button" class="btn btn-sm btn-outline glass glass--pressable" onclick="respondSigning(${s.id}, false)">${UI.BTN_SIGNING_REJECT}</button>
        </div>` : ''}
        ${done ? `<p class="signing-bubble-status">${done}</p>` : ''}
      </div>${time}</div>`;
  }
  // v0.24.0 签约回应系统气泡（对方确认/拒绝后落一条，在途会话实时刷新）
  if (m.kind === 'signing_response') {
    let r = {};
    try { r = JSON.parse(m.body || '{}'); } catch { /* 兜底 */ }
    const text = r.accept ? UI.SIGNING_CONFIRMED : UI.SIGNING_REJECTED;
    return `<div class="chat-msg chat-msg--system" data-mid="${m.id}" style="${delay}">
      <div class="chat-bubble chat-bubble--system glass">${escHtml(text)}</div>${time}</div>`;
  }
  // 图片 / 文件消息：列表接口不下发 dataURL 本体（性能），先渲染骨架占位，
  // 页面可操作后由 chatLazyLoadAttachments 逐条补载真实内容
  if (m.kind === 'image' || m.kind === 'file') {
    const inner = m.body
      ? renderChatMediaInner(m.kind, m.body, m.name)
      : `<div class="chat-bubble glass ${skin} chat-bubble--media chat-bubble--loading" data-attach="${m.id}" data-attach-kind="${m.kind}">${chatStageRing(30)}</div>`;
    const bubble = m.body
      ? `<div class="chat-bubble glass ${skin} chat-bubble--media">${inner}</div>`
      : inner;
    return `<div class="chat-msg ${side}" data-mid="${m.id}" style="${delay}">${bubble}${time}</div>`;
  }
  return `<div class="chat-msg ${side}" data-mid="${m.id}" style="${delay}">
    <div class="chat-bubble glass ${skin}">${escHtml(m.body)}</div>${time}</div>`;
}

// 图片缩略（点开放大）/ 文件 chip（dataURL 直接 download）
function renderChatMediaInner(kind, body, name) {
  // 网安审计 N-03：发送方注销后附件本体被服务端清空（body=''），此处占位而非渲染死链接/空图
  if (!body) return `<span class="chat-attach-fail">${UI.CHAT_ATTACH_REMOVED}</span>`;
  if (kind === 'image') {
    return `<img src="${escHtml(body)}" alt="${UI.CHAT_ATTACH_IMAGE}" loading="lazy" onclick="chatViewImage(this.src)">`;
  }
  // 客户端 scheme 自守：仅 data: 才作可下载 href（服务端已强制 data: 前缀，此为纵深防御，杜绝 javascript: 等）
  const href = String(body || '').startsWith('data:') ? body : '#';
  return `<a class="chat-file-chip glass glass--solid" href="${escHtml(href)}" download="${escHtml(name || '')}">
    <span class="chat-file-name">${escHtml(name || UI.CHAT_FILE_FALLBACK)}</span>
    <span class="chat-file-dl">${UI.CHAT_DOWNLOAD}</span></a>`;
}

// 附件懒加载：消息区渲染完（页面可操作）后延迟补载骨架占位的真实 dataURL
function chatLazyLoadAttachments() {
  const convId = chatConvId;
  setTimeout(async () => {
    const pending = [...document.querySelectorAll('.chat-bubble--loading[data-attach]')];
    for (const el of pending) {
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
      }
    }
  }, CONFIG.CHAT_SLIDE_DELAY_MS);
}

// 图片消息点开看大图（通用大图查看器在 app-ui openImageViewer，学信网截图预览亦复用）
function chatViewImage(src) { openImageViewer(src); }

// ============================================================
// 轮询：4s 拉增量（sinceId = 已见最大 id），追加并滚底
// ============================================================
function chatStartPolling() {
  if (chatPollTimer) clearInterval(chatPollTimer);
  chatPollTimer = setInterval(chatPollTick, 4000);
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
  // 每次 tick 自检：切页 / 登出 / 会话已关 / 上一轮未回 → 不发请求
  if (state.page !== 'my-chats' || !state.user || !chatConvId || chatPollBusy) return;
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
  if (btn) { btn.disabled = true; btn.innerHTML = '<span class="spinner"><i></i><i></i><i></i></span>'; }
  try {
    // 先逐个发暂存附件（成功一条移出暂存区），再发文字
    for (const it of staged) await chatSendAttachment(it, convId);
    if (text) {
      ta.value = '';
      chatAutogrow(ta);
      const data = await api(`/api/conversations/${convId}/messages`, {
        method: 'POST',
        body: { body: text, kind: 'text' },
      });
      if (chatConvId !== convId) return;
      ta.focus();
      const newId = data.id || 0;
      const stamp = chatNowStamp();
      const box = document.getElementById('chat-messages');
      if (box) {
        if (box.querySelector('.empty-state')) box.innerHTML = '';
        if (!newId || !box.querySelector(`.chat-msg[data-mid="${newId}"]`)) {
          box.insertAdjacentHTML('beforeend', renderChatBubble({
            id: newId, sender_user_id: state.user.id, body: text, created_at: stamp,
          }, 0));
        }
        chatScrollToBottom(true);
      }
      if (newId > chatLastMsgId) chatLastMsgId = newId; // 避免下一轮轮询重复拉回自己这条
      chatBumpConvPreview(convId, { body: text, kind: 'text', created_at: stamp, sender_user_id: state.user.id });
    }
    // 按钮微反馈：弹一下
    if (btn) { btn.classList.remove('chat-send--flash'); void btn.offsetWidth; btn.classList.add('chat-send--flash'); }
  } catch (err) {
    showToast(err.message); // 失败保留输入内容与剩余暂存项，便于重试
  } finally {
    chatSending = false;
    if (btn) { btn.disabled = false; btn.textContent = UI.CHAT_BTN_SEND; }
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
      reader.onload = () => chatShrinkImage(reader.result, url => chatDoUpload(item, url)); // 先本地压缩再传
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
    xhr.send(JSON.stringify({ kind: item.kind, fileData: dataUrl, fileName: item.name })); // 身份一律凭令牌，移除自报 userId（服务端早已忽略）
  });
}

async function chatDoUpload(item, dataUrl) {
  item.dataUrl = dataUrl;
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

// 图片压缩：最长边缩至 CONFIG.CHAT_IMG_MAX_SIDE 内，jpeg CHAT_IMG_QUALITY 落 dataURL（控制 D1 单元格体积）
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
    cb(cv.toDataURL('image/jpeg', CONFIG.CHAT_IMG_QUALITY));
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

function renderChatStage() {
  const el = document.getElementById('chat-stage');
  if (!el) return;
  if (!chatStaged.length) { el.classList.add('hidden'); el.innerHTML = ''; return; }
  el.classList.remove('hidden');
  el.innerHTML = chatStaged.map(it => {
    const media = it.kind === 'image' && it.dataUrl
      ? `<img src="${escHtml(it.dataUrl)}" alt="${UI.CHAT_ATTACH_IMAGE}">`
      : `<span class="chat-stage-file"><span class="chat-stage-ext">${escHtml(chatFileExt(it.name))}</span></span>`;
    const nameRow = it.kind === 'file' ? `<span class="chat-stage-name">${escHtml(it.name)}</span>` : '';
    return `<div class="chat-stage-item glass glass--solid${it.kind === 'file' ? ' chat-stage-item--file' : ''}">
      <div class="chat-stage-thumb glass glass--solid">${media}${it.ready ? '' : chatStageRing(it.progress)}</div>
      ${nameRow}
      <button type="button" class="chat-stage-del glass glass--float" onclick="chatUnstage(${it.id})" aria-label="${UI.BTN_CANCEL}">✕</button>
    </div>`;
  }).join('');
}

// 发送单条附件 = 确认载入会话：数据已在上传阶段进服务器，这里只凭 uploadId 落成消息
async function chatSendAttachment(item, convId) {
  const data = await api(`/api/conversations/${convId}/messages`, {
    method: 'POST',
    body: { uploadId: item.uploadId },
  });
  if (chatConvId !== convId) return; // 发送中切走会话：丢弃
  chatStaged = chatStaged.filter(it => it.id !== item.id);
  renderChatStage();
  const kind = data.kind || item.kind;
  const name = data.name != null ? data.name : item.name;
  const box = document.getElementById('chat-messages');
  if (box) {
    if (box.querySelector('.empty-state')) box.innerHTML = '';
    // 与轮询互为真相：在途 poll 可能先把这条拉回渲染，本地插入必须按 data-mid 去重（对齐文本路径）
    if (!data.id || !box.querySelector(`.chat-msg[data-mid="${data.id}"]`)) {
      box.insertAdjacentHTML('beforeend', renderChatBubble({
        id: data.id || 0, sender_user_id: state.user.id, kind, body: item.dataUrl, name, created_at: chatNowStamp(),
      }, 0));
      chatScrollToBottom(true);
    }
  }
  if (data.id && data.id > chatLastMsgId) chatLastMsgId = data.id;
  chatBumpConvPreview(convId, { body: '', kind, created_at: chatNowStamp(), sender_user_id: state.user.id });
}

// 拖入聊天区：松开即加入暂存区（桌面 / 平板拖放均可）
function chatBindDropzone() {
  const zone = document.getElementById('chat-pane');
  if (!zone || zone.dataset.dropBound) return;
  zone.dataset.dropBound = '1';
  const hint = document.getElementById('chat-drop-hint');
  zone.addEventListener('dragover', e => { e.preventDefault(); if (hint) hint.classList.remove('hidden'); });
  zone.addEventListener('dragleave', e => { if (!zone.contains(e.relatedTarget) && hint) hint.classList.add('hidden'); });
  zone.addEventListener('drop', e => {
    e.preventDefault();
    if (hint) hint.classList.add('hidden');
    if (e.dataTransfer && e.dataTransfer.files && e.dataTransfer.files.length) chatStageFiles(e.dataTransfer.files);
  });
}

// ---------- 加号弹层（附件 + 发起签约 + 起草合同）----------
function toggleChatPlus() { document.getElementById('chat-plus-wrap').classList.toggle('open'); }
function closeChatPlus() { const w = document.getElementById('chat-plus-wrap'); if (w) w.classList.remove('open'); }
function chatPlusDraft() { closeChatPlus(); if (chatConvId) openContractDraftModal(chatConvId); }
function chatPlusSigning() { closeChatPlus(); if (chatConvId) openSigningModal(chatConvId); }

// v0.24.0 回应签约请求：确认/拒绝。成功后就地把请求气泡变灰 + 按钮消失为小灰字
// （服务端已更新原气泡 body 为终态并落 signing_response 响应气泡，轮询也会拉到）
async function respondSigning(signingId, accept) {
  try {
    await api(`/api/signing-requests/${signingId}/respond`, { method: 'POST', body: { accept } });
    document.querySelectorAll(`[data-signing-id="${signingId}"]`).forEach(el => {
      el.classList.add('signing-bubble--done');
      const actions = el.querySelector('.signing-bubble-actions');
      if (actions) actions.remove();
      const status = el.querySelector('.signing-bubble-status');
      const text = accept ? UI.SIGNING_CONFIRMED_TEXT : UI.SIGNING_REJECTED_TEXT;
      if (status) status.textContent = text;
      else { const p = document.createElement('p'); p.className = 'signing-bubble-status'; p.textContent = text; el.appendChild(p); }
    });
    showToast(accept ? UI.SIGNING_CONFIRMED : UI.SIGNING_REJECTED);
  } catch (err) { showToast(err.message); }
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

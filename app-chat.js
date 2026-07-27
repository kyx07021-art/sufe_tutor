/**
 * 我的沟通（学生 / 教师侧边栏「我的沟通」页，模块4）
 *
 * 经典脚本：全部顶层全局函数 + 内联 onclick，与 app.js / app-posts.js 同一约定。
 * 仅依赖 app.js 提供的基础设施：state / api / escHtml / showToast。
 *
 * 数据来源（后端已上线）：
 *   GET  /api/conversations?userId=                          会话列表（含对方用户名 + 最后消息预览）
 *   GET  /api/conversations/:id/messages?userId=&sinceId=    消息（id 升序；sinceId=0 即全量）
 *   POST /api/conversations/:id/messages                     发送文本消息，返回 { id }
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
let chatPollTimer = null;   // 轮询定时器（setInterval 句柄）
let chatLastMsgId = 0;      // 已见最大消息 id，作轮询 sinceId
let chatPollBusy = false;   // 上一次轮询未返回时跳过本 tick，防请求叠加
let chatSending = false;    // 发送中，防连点
let chatResizeBound = false;// resize 监听只绑一次
let chatResizeTimer = null; // resize 防抖定时器

// ============================================================
// 页面入口
// ============================================================

// 侧边栏项入口（ROLE_PAGES → enterMyChats）：
// 左栏会话列表 + 右栏聊天窗（未选中时占位）。每次进入都重置会话选中态并重建轮询。
function enterMyChats() {
  stopChatPolling();
  document.getElementById('chats-content').innerHTML = `
    <div class="chats-shell" id="chats-shell">
      <aside class="chats-list-pane">
        <div class="chats-list-head">
          <span class="chats-list-title">会话</span>
          <span class="chats-list-count" id="chats-conv-count">--</span>
        </div>
        <div class="conv-list" id="conv-list"><div class="empty-state empty-state--small"><p>加载中...</p></div></div>
      </aside>
      <section class="chat-pane" id="chat-pane">
        ${renderChatPlaceholder()}
      </section>
    </div>`;
  chatBindResize();
  chatFitHeight();
  loadConversations();
}

// 拉取会话列表（服务端已按最后活跃时间倒序）
async function loadConversations() {
  try {
    const data = await api(`/api/conversations?userId=${state.user.id}`);
    chatConvList = data.conversations || [];
    renderConvList();
  } catch (err) {
    const el = document.getElementById('conv-list');
    if (el) el.innerHTML = `<div class="empty-state empty-state--small"><p>加载失败：${escHtml(err.message)}</p></div>`;
  }
}

// ============================================================
// 左栏：会话列表
// ============================================================
function renderConvList() {
  const el = document.getElementById('conv-list');
  if (!el) return;
  const countEl = document.getElementById('chats-conv-count');
  if (countEl) countEl.textContent = String(chatConvList.length).padStart(2, '0');
  if (!chatConvList.length) {
    el.innerHTML = '<div class="empty-state empty-state--small"><p>暂无沟通——同意教师试课意向后自动建立</p></div>';
    return;
  }
  el.innerHTML = chatConvList.map(renderConvItem).join('');
}

// 对方名字：学生看 teacher_name，教师看 student_name
function chatPeerOf(c) {
  const isTeacherViewer = state.user && state.user.role === 'teacher';
  return {
    name: isTeacherViewer ? c.student_name : c.teacher_name,
    role: isTeacherViewer ? '学生' : '教师',
  };
}

function renderConvItem(c) {
  const peer = chatPeerOf(c);
  const me = state.user.id;
  let preview = '还没有消息，先打个招呼吧';
  if (c.last_kind && c.last_kind !== 'text') {
    preview = (c.last_sender === me ? '我：' : '') + (c.last_kind === 'image' ? '[图片]' : '[文件]');
  } else if (c.last_body) {
    preview = (c.last_sender === me ? '我：' : '') + c.last_body;
  }
  const time = fmtChatTime(c.last_at || c.created_at);
  return `<button type="button" class="conv-item${c.id === chatConvId ? ' active' : ''}" data-conv-id="${c.id}" onclick="openConversation(${c.id})">
    <span class="conv-item-top">
      <span class="conv-item-name">${escHtml(peer.name || '未知用户')}</span>
      <span class="conv-item-role">${peer.role}</span>
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
async function openConversation(convId) {
  stopChatPolling();          // 清掉上一段会话的定时器与状态
  chatConvId = convId;

  // 左栏高亮 + 移动端切到聊天窗
  document.querySelectorAll('#conv-list .conv-item').forEach(b =>
    b.classList.toggle('active', +b.dataset.convId === convId));
  const shell = document.getElementById('chats-shell');
  if (shell) shell.classList.add('chats-show-chat');

  const pane = document.getElementById('chat-pane');
  if (!pane) return;
  const conv = chatConvList.find(c => c.id === convId);
  pane.innerHTML = renderChatFrame(conv);
  chatFitHeight();

  try {
    const data = await api(`/api/conversations/${convId}/messages?userId=${state.user.id}`);
    if (chatConvId !== convId) return; // 用户已切走，丢弃过期响应
    const msgs = data.messages || [];
    const box = document.getElementById('chat-messages');
    if (!box) return;
    box.innerHTML = msgs.length
      ? msgs.map((m, i) => renderChatBubble(m, i)).join('')
      : '<div class="empty-state empty-state--small"><p>还没有消息，先打个招呼吧</p></div>';
    chatLastMsgId = msgs.length ? msgs[msgs.length - 1].id : 0;
    chatScrollToBottom(false);
    chatStartPolling();
    if (window.innerWidth > 860) { // 移动端不自动聚焦，避免键盘弹出遮挡
      const ta = document.getElementById('chat-input');
      if (ta) ta.focus();
    }
  } catch (err) {
    if (chatConvId !== convId) return;
    const box = document.getElementById('chat-messages');
    if (box) box.innerHTML = `<div class="empty-state empty-state--small"><p>加载失败：${escHtml(err.message)}</p></div>`;
  }
}

// 聊天窗骨架：头部（对方名 + 身份 + 需求编号）+ 气泡区 + 输入区。
// 会话关闭（status 非 active，服务端亦会 403）时输入区换成提示条。
function renderChatFrame(conv) {
  const peer = conv ? chatPeerOf(conv) : { name: '', role: '' };
  const closed = conv && conv.status && conv.status !== 'active';
  return `
    <div class="chat-head">
      <button type="button" class="chat-back" onclick="backToConvList()">&larr; 会话列表</button>
      <div class="chat-head-main">
        <span class="chat-peer-name">${escHtml(peer.name) || '未知用户'}</span>
        <span class="chat-peer-tag">${peer.role}</span>
        ${conv && conv.demand_id ? `<span class="chat-head-demand">需求 #${conv.demand_id}</span>` : ''}
      </div>
    </div>
    <div class="chat-messages" id="chat-messages"><div class="empty-state empty-state--small"><p>加载中...</p></div></div>
    <div class="chat-input-bar${closed ? ' chat-input-bar--closed' : ''}">
      ${closed
        ? '<p class="chat-closed-tip">该会话已关闭，不能再发送消息</p>'
        : `<button type="button" class="chat-attach" onclick="chatTodo()">图片</button>
           <button type="button" class="chat-attach" onclick="chatTodo()">文件</button>
           <textarea id="chat-input" class="form-input chat-textarea" rows="1"
             placeholder="输入消息，Enter 发送，Shift+Enter 换行"
             onkeydown="chatInputKeydown(event)" oninput="chatAutogrow(this)"></textarea>
           <button type="button" class="btn btn-primary btn-sm chat-send" id="chat-send-btn" onclick="sendChatMessage()">发送</button>`}
    </div>`;
}

// 未选中会话时的占位（桌面端常驻右栏）
function renderChatPlaceholder() {
  return `<div class="chat-placeholder">
    <span class="chat-placeholder-dots" aria-hidden="true"><span></span><span></span><span></span><span></span></span>
    <p class="chat-placeholder-title">选择左侧会话，开始沟通</p>
    <p class="chat-placeholder-sub">同意试课意向后自动建立会话，消息每 4 秒自动刷新</p>
  </div>`;
}

// 单条消息气泡：自己靠右（墨底纸字），对方靠左（浅棕底墨字）
function renderChatBubble(m, i) {
  const mine = state.user && m.sender_user_id === state.user.id;
  return `<div class="chat-msg ${mine ? 'chat-msg--mine' : 'chat-msg--theirs'}" data-mid="${m.id}" style="--i:${Math.min(i || 0, 12)}">
    <div class="chat-bubble ${mine ? 'chat-bubble--mine' : 'chat-bubble--theirs'}">${escHtml(m.body)}</div>
    <span class="chat-msg-time">${escHtml(fmtChatTime(m.created_at))}</span>
  </div>`;
}

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
    const data = await api(`/api/conversations/${convId}/messages?userId=${state.user.id}&sinceId=${chatLastMsgId}`);
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
    chatBumpConvPreview(convId, fresh[fresh.length - 1]); // 左栏预览同步 + 置顶
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
  const body = ta.value.trim();
  if (!body) { ta.focus(); return; }

  const btn = document.getElementById('chat-send-btn');
  chatSending = true;
  if (btn) { btn.disabled = true; btn.innerHTML = '<span class="spinner"></span>'; }
  try {
    const data = await api(`/api/conversations/${convId}/messages`, {
      method: 'POST',
      body: { userId: state.user.id, body, kind: 'text' },
    });
    if (chatConvId !== convId) return;
    // 发送瞬间：输入框清空并复位高度，气泡立即入场
    ta.value = '';
    chatAutogrow(ta);
    ta.focus();
    const newId = data.id || 0;
    const stamp = chatNowStamp();
    const box = document.getElementById('chat-messages');
    if (box) {
      if (box.querySelector('.empty-state')) box.innerHTML = '';
      if (!newId || !box.querySelector(`.chat-msg[data-mid="${newId}"]`)) {
        box.insertAdjacentHTML('beforeend', renderChatBubble({
          id: newId, sender_user_id: state.user.id, body, created_at: stamp,
        }, 0));
      }
      chatScrollToBottom(true);
    }
    if (newId > chatLastMsgId) chatLastMsgId = newId; // 避免下一轮轮询重复拉回自己这条
    chatBumpConvPreview(convId, { body, kind: 'text', created_at: stamp, sender_user_id: state.user.id });
    // 按钮微反馈：弹一下
    if (btn) { btn.classList.remove('chat-send--flash'); void btn.offsetWidth; btn.classList.add('chat-send--flash'); }
  } catch (err) {
    showToast(err.message); // 失败时保留输入内容，便于重试
  } finally {
    chatSending = false;
    if (btn) { btn.disabled = false; btn.textContent = '发送'; }
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

// 图片 / 文件占位按钮：服务端 kind 暂未开放（501），前端先给预期提示
function chatTodo() {
  showToast('该功能即将开放，敬请期待');
}

// 移动端：从聊天窗返回会话列表（会话保持打开，轮询继续，预览照常刷新）
function backToConvList() {
  const shell = document.getElementById('chats-shell');
  if (shell) shell.classList.remove('chats-show-chat');
  chatFitHeight();
}

// ============================================================
// 小工具
// ============================================================

// 时间显示：created_at 原串截到分钟（'YYYY-MM-DD HH:MM'）
function fmtChatTime(t) {
  return t ? String(t).slice(0, 16) : '';
}

// 本地时间戳（仅用于发送成功后的即时展示，下一轮渲染会被服务端时间取代）
function chatNowStamp() {
  const d = new Date();
  const p = n => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())} ${p(d.getHours())}:${p(d.getMinutes())}`;
}

function chatScrollToBottom(smooth) {
  const box = document.getElementById('chat-messages');
  if (!box) return;
  const reduce = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
  box.scrollTo({ top: box.scrollHeight, behavior: smooth && !reduce ? 'smooth' : 'auto' });
}

// 壳高自适应：撑满 client-main 可视区剩余高度（减去顶部页头占位），内部两栏各自滚动。
// enterMyChats / 切会话 / 返回 / 窗口缩放时调用；selectPage 进页已重置 client-main 滚动位。
function chatFitHeight() {
  const shell = document.getElementById('chats-shell');
  const main = document.getElementById('client-main');
  if (!shell || !main) return;
  const top = shell.getBoundingClientRect().top - main.getBoundingClientRect().top;
  shell.style.height = Math.max(380, main.clientHeight - top - 24) + 'px';
}

function chatBindResize() {
  if (chatResizeBound) return;
  chatResizeBound = true;
  window.addEventListener('resize', () => {
    clearTimeout(chatResizeTimer);
    chatResizeTimer = setTimeout(chatFitHeight, 120);
  });
}

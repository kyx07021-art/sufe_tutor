/**
 * 资料共享广场（教师侧边栏「资料共享」页，模块2）
 *
 * 经典脚本：全部顶层全局函数 + 内联 onclick（全站同一约定）。
 * 仅依赖共享层提供的基础设施：state / api / escHtml / showToast / closeModal / loaderHtml / loadInto / initCustomSelects；
 * 删除确认复用共享 confirm() 原语（v0.25.10 反馈 #82 合并，原自写 postConfirmDelete 小弹窗已连根删）。
 * mdRender 为自研轻量 markdown-lite：先 escHtml 全转义再逐行识别语法，不引任何外部库。
 * section 恒 'plaza'，当前不做分区 UI（接口已预留 section 参数）。
 */

// ============================================================
// 模块内状态
// ============================================================
let postsList = [];          // 当前已加载的帖子（点赞后本地同步的数据源）
let postsUrl = '/api/posts?sort=new'; // 最近一次加载的帖子 URL（探测刷新后按它重挂 postsList）
let postsSearchTimer = null; // 搜索防抖定时器
// v0.23.1 审计 M1：探测刷新替换缓存数组后重挂别名——点赞就地变更（togglePostLike 改 postsList）
// 依赖「postsList === 缓存数组同引用」，不重挂则点赞态被缓存旧值弹回
if (typeof dhOnDomainRefresh === 'function') {
  dhOnDomainRefresh('posts', () => {
    const c = dhPeek(postsUrl);
    if (c && c.posts) postsList = c.posts;
  });
}

// ============================================================
// 页面入口与列表加载
// ============================================================

// 侧边栏项入口（ROLE_PAGES.teacher → enterResourceShare）：
// 渲染工具条（搜索 / 排序 / 发布）+ 列表容器到 #posts-content，然后拉数据
function enterResourceShare() {
  clearTimeout(postsSearchTimer); // 清掉上一次停留时挂起的防抖回调，防切回瞬间打到隐藏页
  const isTeacher = state.user && state.user.role === 'teacher';
  document.getElementById('posts-content').innerHTML = `
    <div class="posts-toolbar glass">
      <input type="search" id="posts-search" class="form-input posts-search"
        placeholder="${UI.POSTS_SEARCH_PLACEHOLDER}" oninput="postsSearchDebounced()">
      <select id="posts-sort" class="form-select posts-sort" onchange="loadPosts()">
        <option value="new">${UI.POSTS_SORT_NEW}</option>
        <option value="hot">${UI.POSTS_SORT_HOT}</option>
      </select>
      ${isTeacher ? `<button type="button" class="btn btn-sm glass glass--pressable posts-create-btn" onclick="openPostEditor()">${UI.BTN_CREATE_POST}</button>` : ''}
    </div>
    <div id="posts-list"><div class="empty-state">${loaderHtml()}</div></div>`;
  initCustomSelects(document.getElementById('posts-content')); // 工具条是动态渲染，须显式接线自定义下拉
  loadPosts();
}

// 搜索框防抖：停止输入 350ms 后再触发 loadPosts
function postsSearchDebounced() {
  clearTimeout(postsSearchTimer);
  postsSearchTimer = setTimeout(() => loadPosts(), 350);
}

// 拉取帖子列表：sort / q 取自工具条；liked 标记由后端凭令牌判定（访客恒 false）
// 乱序守卫由 loadInto 的 seqKey:'posts' 接管（搜索/排序快速切换时旧响应丢弃）
function loadPosts() {
  const q = (document.getElementById('posts-search')?.value || '').trim();
  const sort = document.getElementById('posts-sort')?.value || 'new';
  const url = `/api/posts?sort=${sort}` + (q ? `&q=${encodeURIComponent(q)}` : '');
  postsUrl = url; // 记录最近 URL，探测刷新后按其重挂 postsList（审计 M1）
  return loadInto('posts-list', async () => {
    const data = await dhGet(url, { domain: 'posts' }); // v0.23.0 静默数据层
    postsList = data.posts || []; // 渲染前同步：点赞就地更新依赖此数据源
    return data;
  }, rows => rows.map(renderPostCard).join(''),
  { seqKey: 'posts', empty: UI.POSTS_EMPTY, pick: d => d.posts, reveal: true, peek: () => dhReady(url) });
}

// #161（v0.25.69）：点赞 pill 组件（列表卡 + 详情浮窗共用）——#160 复选逻辑单点
function likePillHtml(p) {
  return `<label class="post-like glass" data-id="${p.id}"> <!-- #160（v0.25.68）：点赞接复选框逻辑——liked 态骑原生
    checkbox checked（同 .checkbox-item 的 :has(input:checked) 单源），告别自定义 .liked 类 + aria-pressed 手管；
    原生翻转即乐观即时反馈，服务端返回后以 data.liked 收敛，失败回滚到点前态 -->
    <input type="checkbox"${p.liked ? ' checked' : ''} aria-label="${UI.POST_LIKE_ARIA}" onchange="togglePostLike(${p.id}, this)">
    <svg class="like-icon" viewBox="0 0 24 24" width="15" height="15" aria-hidden="true"
      fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
      <path d="M14 9V5a3 3 0 0 0-3-3l-4 9v11h11.28a2 2 0 0 0 2-1.7l1.38-9a2 2 0 0 0-2-2.3zM7 22H4a2 2 0 0 1-2-2v-7a2 2 0 0 1 2-2h3"/>
    </svg>
    <span class="like-count">${p.like_count || 0}</span>
  </label>`;
}

// 帖子卡：标题 / 作者+时间 / 正文摘要（md 原文前 80 字，escHtml）/ 点赞 / 作者可删。
// #161（v0.25.69）：整卡可点击查看全文浮窗——卡 onclick 统一接管，点赞/删除内部控件用 closest 守卫不透传；
// 标题转 button（键盘焦点 + Enter/Space 原生 click 冒泡到卡），正文摘要过长时点击即看全文。
function renderPostCard(p, i) {
  const mine = state.user && p.user_id === state.user.id;
  const raw = String(p.body_md || '');
  const snippet = raw.slice(0, CONFIG.POST_SNIPPET);
  const time = p.created_at ? fmtDateTime(p.created_at) : '';
  return `<div class="post-card glass" style="--i:${Math.min(i, 8)}" onclick="postCardClick(event, ${p.id})">
    <div class="post-card-head">
      <button type="button" class="post-title" aria-label="${UI.POST_VIEW_ARIA}">${escHtml(p.title)}</button>
      ${mine ? `<button type="button" class="post-del" onclick="postConfirmDelete(${p.id})">${UI.POST_BTN_DELETE}</button>` : ''}
    </div>
    <div class="post-meta">
      <span class="post-author">${DISP.usernameHtml(p.username || UI.POST_ANONYMOUS)}${DISP.deactivatedTag(p.username)}</span>
      <span class="post-time">${escHtml(time)}</span>
    </div>
    ${snippet ? `<p class="post-snippet">${escHtml(snippet)}${raw.length > CONFIG.POST_SNIPPET ? '…' : ''}</p>` : ''}
    <div class="post-actions">
      ${likePillHtml(p)}
    </div>
  </div>`;
}

// #161（v0.25.69）：帖子卡点击守卫——点赞/删除等内部控件点击不透传（事件从控件冒泡上来，closest 命中即返回）
function postCardClick(event, id) {
  if (!event || (event.target.closest && event.target.closest('.post-like, .post-del'))) return;
  openPostDetail(id);
}

// #161（v0.25.69）：帖子全文浮窗——列表 payload 已含完整 body_md（列表只截 80 字摘要），直接本地渲染零网络；
// 正文走 .md-preview 排版（--full 放开高度封顶，浮窗整体在 overlay 滚动），点赞 pill 与列表卡共用组件
function openPostDetail(id) {
  const p = postsList.find(x => x.id === id);
  if (!p) return;
  const mine = state.user && p.user_id === state.user.id;
  const time = p.created_at ? fmtDateTime(p.created_at) : '';
  openModal({
    title: escHtml(p.title),
    cls: 'modal--wide', // 长文拓宽（同 md 预览）
    bodyCls: 'md-preview md-preview--full',
    body: `
      <div class="post-meta">
        <span class="post-author">${DISP.usernameHtml(p.username || UI.POST_ANONYMOUS)}${DISP.deactivatedTag(p.username)}</span>
        <span class="post-time">${escHtml(time)}</span>
      </div>
      <div class="post-detail-body">${mdRender(p.body_md) || `<p>${UI.POST_PREVIEW_EMPTY}</p>`}</div>`,
    footer: `<div class="post-detail-foot">${likePillHtml(p)}${mine ? `<button type="button" class="btn btn-text-danger glass glass--pressable" onclick="postConfirmDelete(${p.id})">${UI.POST_BTN_DELETE}</button>` : ''}</div>`,
  });
}

// ============================================================
// 点赞（就地更新按钮，避免整列重渲染重放入场动画）
// ============================================================
const postLikeSeq = {}; // 每帖独立序号：双击连发时乱序到达的旧响应丢弃，UI 态以最后一次为准
async function togglePostLike(id, input) {
  // #160（v0.25.68）：复选逻辑接入——change 在原生翻转后触发，input.checked 即新态，
  // 取反得点前态；访客/失败回滚靠它还原。视觉由 CSS :has(input:checked) 单源，不再管 .liked 类。
  if (!input) return;
  const wasChecked = !input.checked; // 点前态
  const revert = () => { if (input && input.checked !== wasChecked) input.checked = wasChecked; };
  if (!ensureAuth()) { revert(); return; } // 访客可浏览广场，点赞需登录（原生已翻转，须回滚）
  const seq = (postLikeSeq[id] = (postLikeSeq[id] || 0) + 1);
  try {
    const data = await api(`/api/posts/${id}/like`, { method: 'POST', body: {} });
    if (postLikeSeq[id] !== seq) return; // 已有更新的点赞请求，丢弃过期响应
    const p = postsList.find(x => x.id === id);
    if (p) { p.liked = data.liked; p.like_count = data.likeCount; }
    // #161（v0.25.69）：同步全部 .post-like（列表卡 + 详情浮窗），不限于 #posts-list
    document.querySelectorAll(`.post-like[data-id="${id}"]`).forEach(label => {
      const box = label.querySelector('input[type="checkbox"]');
      if (box) box.checked = data.liked; // 服务端为准：并发对端取消/失败兜底由这里收敛
      const cnt = label.querySelector('.like-count');
      if (cnt) cnt.textContent = data.likeCount;
    });
    showToast(data.liked ? UI.POST_LIKED_TOAST : UI.POST_UNLIKED_TOAST);
  } catch (err) {
    if (postLikeSeq[id] !== seq) return; // 过期请求的错误不覆盖新请求的 UI 态
    revert();
    showToast(err.message);
  }
}

// ============================================================
// 发布弹窗（标题 + Markdown 工具条 + 实时预览）
// ============================================================
function openPostEditor() {
  if (!ensureAuth()) return;
  // 防误触：点遮罩不关（编辑成本高，只能 ✕ / 取消关闭）
  openModal({
    title: `${UI.POST_MODAL_TITLE_CREATE}`,
    closable: false,
    body: `<div id="post-alert"></div>
        <div class="form-group">
          <label class="form-label" for="post-title">${UI.POST_LABEL_TITLE} <span class="req">*</span></label>
          <input type="text" id="post-title" class="form-input" maxlength="60" placeholder="${UI.POST_TITLE_PLACEHOLDER}" oninput="updateTitleCount()">
          <span class="title-count" id="post-title-count">0/60</span>
        </div>
        <div class="form-group">
          <label class="form-label" for="post-body">${UI.POST_LABEL_BODY}</label>
          <div class="md-toolbar">
            <button type="button" class="md-btn glass" onclick="mdWrap('h2')">H2</button>
            <button type="button" class="md-btn glass" onclick="mdWrap('h3')">H3</button>
            <button type="button" class="md-btn glass" onclick="mdWrap('bold')">${UI.POST_MD_BOLD}</button>
            <label class="md-btn glass" for="post-image-file">${UI.POST_MD_IMAGE}</label>
            <input type="file" id="post-image-file" accept="image/*" class="sr-file-input" onchange="insertPostImage(this)">
            <button type="button" class="md-btn glass" onclick="openPostPreview()">${UI.POST_PREVIEW_BTN}</button> <!-- v0.24.0：实时预览删，改按钮+浮窗 -->
          </div>
          <textarea id="post-body" class="form-input post-body-input" rows="9"
            placeholder="${UI.POST_BODY_PLACEHOLDER}"></textarea>
        </div>`,
    footer: `<button type="button" class="btn btn-outline glass glass--pressable" onclick="closeModal()">${UI.BTN_CANCEL}</button>
          <button type="button" class="btn glass glass--pressable" id="post-submit" onclick="submitPost()">${UI.BTN_PUBLISH}</button>`,
  });
  document.getElementById('post-title').focus();
}

// 对 #post-body 的选区做 markdown 包装：
// h2 / h3 = 对所选各行行首切换 '## ' / '### ' 前缀（可再按一次取消）；
// bold = 选区两侧加 **（选区自带标记或位于标记内侧时反向解开），未选中时插入占位文本并选中它
function mdWrap(mode) {
  const ta = document.getElementById('post-body');
  if (!ta) return;
  const start = ta.selectionStart, end = ta.selectionEnd;

  if (mode === 'bold') {
    const sel = ta.value.slice(start, end);
    const surrounded = ta.value.slice(Math.max(0, start - 2), start) === '**'
                    && ta.value.slice(end, end + 2) === '**';
    if (sel.length >= 4 && sel.startsWith('**') && sel.endsWith('**')) {
      // 选区自带标记：解开
      const inner = sel.slice(2, -2);
      ta.value = ta.value.slice(0, start) + inner + ta.value.slice(end);
      ta.setSelectionRange(start, start + inner.length);
    } else if (surrounded) {
      // 选区位于已有标记内侧：移除外侧一对
      ta.value = ta.value.slice(0, start - 2) + sel + ta.value.slice(end + 2);
      ta.setSelectionRange(start - 2, start - 2 + sel.length);
    } else {
      const inner = sel || UI.POST_MD_BOLD_DEFAULT;
      ta.value = ta.value.slice(0, start) + '**' + inner + '**' + ta.value.slice(end);
      ta.setSelectionRange(start + 2, start + 2 + inner.length);
    }
  } else {
    const prefix = mode === 'h3' ? '### ' : '## ';
    const other  = mode === 'h3' ? '## ' : '### ';
    // 把选区扩展到覆盖的完整行
    const lineStart = ta.value.lastIndexOf('\n', start - 1) + 1;
    let lineEnd = ta.value.indexOf('\n', end);
    if (lineEnd === -1) lineEnd = ta.value.length;
    const block = ta.value.slice(lineStart, lineEnd);
    const newBlock = block.split('\n').map(ln => {
      if (ln.startsWith(prefix)) return ln.slice(prefix.length);          // 再按一次：取消标题
      const bare = ln.startsWith(other) ? ln.slice(other.length) : ln;    // 两级标题互换
      return prefix + bare;
    }).join('\n');
    ta.value = ta.value.slice(0, lineStart) + newBlock + ta.value.slice(lineEnd);
    ta.setSelectionRange(lineStart, lineStart + newBlock.length);
  }
  ta.focus();
}

// 图片 → FileReader 读成 dataURL → 在光标处插入 ![图片](dataURL)，并独占一行
function insertPostImage(input) {
  const file = input.files && input.files[0];
  input.value = ''; // 清空以便可再次选择同一文件
  if (!file) return;
  if (!file.type.startsWith('image/')) { showToast(UI.POST_IMAGE_ONLY); return; }
  const reader = new FileReader();
  reader.onload = () => {
    const ta = document.getElementById('post-body');
    if (!ta) return;
    const pos = ta.selectionStart ?? ta.value.length;
    const before = ta.value.slice(0, pos);
    const after = ta.value.slice(pos);
    const sep1 = before && !before.endsWith('\n') ? '\n' : '';
    const sep2 = after && !after.startsWith('\n') ? '\n' : '';
    ta.value = before + sep1 + `![${UI.POST_IMAGE_ALT}](${reader.result})` + sep2 + after;
    ta.focus();
  };
  reader.readAsDataURL(file);
}

/**
 * 轻量 markdown-lite 渲染器（自研，零依赖）
 * 安全策略：先 escHtml 全转义（任何注入文本已失效），再逐行识别语法。
 * 规则：'#'×1~6 → h1~h6（v0.24.0 全支持）；**x** → strong；
 *       ![alt](url) → <img>，url 仅放行 http(s): 与 data:image 前缀且不含空白，
 *       其余（含 javascript: 等伪协议）占位不渲染；其余非空行包 <p>，空行跳过。
 * 返回 HTML 字符串。
 */
/** v0.24.0：「预览效果」按钮 → 独立浮窗展示 markdown 解析结果（实时预览连根删） */
function openPostPreview() {
  const ta = document.getElementById('post-body');
  const html = ta ? mdRender(ta.value) : '';
  openModal({
    title: UI.POST_PREVIEW_TITLE,
    cls: 'modal--wide', // 需求三十一：md 预览长文拓宽
    bodyCls: 'contract-md',
    body: html || `<p class="md-preview-empty">${UI.POST_PREVIEW_EMPTY}</p>`,
  });
}

// ============================================================
// 发布 / 删除
// ============================================================
async function submitPost() {
  const titleEl = document.getElementById('post-title');
  const bodyEl = document.getElementById('post-body');
  const alertEl = document.getElementById('post-alert');
  const btn = document.getElementById('post-submit');
  const title = (titleEl.value || '').trim();

  if (!title) {
    alertEl.innerHTML = alertHtml('error', UI.POST_TITLE_REQUIRED);
    titleEl.focus();
    return;
  }
  try {
    btnLoading(btn, UI.POST_PUBLISHING);
    await api('/api/posts', {
      method: 'POST',
      body: { title, bodyMd: bodyEl.value || '' },
    });
    closeModal();
    showToast(UI.POST_PUBLISHED);
    invalidate('posts'); // v0.23.1 审计 M1：写后清数据层缓存，否则 loadPosts 命中旧列表新帖不出现
    loadPosts();
  } catch (err) {
    alertEl.innerHTML = alertHtml('error', err.message);
    btnDone(btn, UI.BTN_PUBLISH);
  }
}

// 删除二次确认：薄封装复用共享 confirm() 原语（v0.25.10 反馈 #82 合并，连根删自写小弹窗）
function postConfirmDelete(id) {
  confirm({ title: UI.POST_DELETE_TITLE, message: UI.POST_DELETE_CONFIRM, okText: UI.BTN_CONFIRM_DELETE, onConfirm: () => deletePost(id) });
}

async function deletePost(id) {
  try {
    await api(`/api/posts/${id}`, { method: 'DELETE', body: {} });
    closeModal();
    showToast(UI.POST_DELETED);
    invalidate('posts'); // v0.23.1 审计 M1：否则被删帖子从缓存闪回
    loadPosts();
  } catch (err) {
    showToast(err.message);
    if (err.code === 'POST_NOT_FOUND' || /不存在/.test(err.message)) { closeModal(); loadPosts(); } // C2：帖子已被（管理员）删除：按 code 判定，刷新列表消除陈旧卡片
  }
}

// ============================================================
// 标题字数计数：最右灰色小字 n/60，超 55 变红，超 60 截断
function updateTitleCount() {
  const inp = document.getElementById('post-title');
  const el = document.getElementById('post-title-count');
  if (!inp || !el) return;
  if (inp.value.length > CONFIG.POST_TITLE_MAX) inp.value = inp.value.slice(0, CONFIG.POST_TITLE_MAX);
  el.textContent = `${inp.value.length}/${CONFIG.POST_TITLE_MAX}`;
  el.classList.toggle('over', inp.value.length > CONFIG.POST_TITLE_WARN);
}

// 管理员系统通知广播：复用发帖组件的 Markdown 编辑器（同一套 ID，弹窗互斥不冲突）
// ============================================================
function openBroadcastModal() {
  openModal({
    title: `${UI.BROADCAST_MODAL_TITLE}`,
    closable: false,
    body: `<div id="post-alert"></div>
        <div class="form-group">
          <label class="form-label" for="post-title">${UI.POST_LABEL_TITLE}</label>
          <input type="text" id="post-title" class="form-input" maxlength="60" placeholder="${UI.BROADCAST_TITLE_PLACEHOLDER}" oninput="updateTitleCount()">
          <span class="title-count" id="post-title-count">0/60</span>
        </div>
        <div class="form-group">
          <label class="form-label">${UI.POST_LABEL_BODY}</label>
          <div class="md-toolbar">
            <button type="button" class="md-btn glass" onclick="mdWrap('h2')">H2</button>
            <button type="button" class="md-btn glass" onclick="mdWrap('h3')">H3</button>
            <button type="button" class="md-btn glass" onclick="mdWrap('bold')">${UI.POST_MD_BOLD}</button>
            <label class="md-btn glass" for="post-image-file">${UI.POST_MD_IMAGE}</label>
            <input type="file" id="post-image-file" accept="image/*" class="sr-file-input" onchange="insertPostImage(this)">
            <button type="button" class="md-btn glass" onclick="openPostPreview()">${UI.POST_PREVIEW_BTN}</button> <!-- v0.24.0 -->
          </div>
          <textarea id="post-body" class="form-input post-body-input" rows="7"
            placeholder="${UI.BROADCAST_BODY_PLACEHOLDER}"></textarea>
        </div>`,
    footer: `<button type="button" class="btn btn-outline glass glass--pressable" onclick="closeModal()">${UI.BTN_CANCEL}</button>
          <button type="button" class="btn glass glass--pressable" id="broadcast-submit" onclick="submitBroadcast()">${UI.BTN_SEND_NOTIFICATION}</button>`,
  });
  document.getElementById('post-body').focus();
}

async function submitBroadcast() {
  const title = (document.getElementById('post-title').value || '').trim();
  const text = (document.getElementById('post-body').value || '').trim();
  const alertEl = document.getElementById('post-alert');
  if (!title) { alertEl.innerHTML = alertHtml('error', UI.POST_TITLE_REQUIRED); return; }
  if (!text) { alertEl.innerHTML = alertHtml('error', UI.VALIDATE_BROADCAST_EMPTY); return; }
  const btn = document.getElementById('broadcast-submit');
  btnLoading(btn);
  try {
    // 服务端给标题加【系统通知】前缀后群发
    await api('/api/notifications/broadcast', { method: 'POST', body: { title, text } });
    closeModal();
    showToast(UI.BROADCAST_SENT_TOAST);
    if (state.page === 'notifications') enterNotifications(); // 自己也收一条，列表即时刷新
  } catch (err) {
    alertEl.innerHTML = alertHtml('error', err.message);
    btnDone(btn);
  }
}

// ============================================================
// 用户反馈（关于平台页 Bug/建议提交）：复用发帖组件的 Markdown 编辑器（同一套 ID，弹窗互斥不冲突）
// —— 与发帖/广播同为「内容提交」领域，并入本模块（功能相近合并）
// ============================================================
let feedbackKind = 'bug';
function openFeedbackModal(kind) {
  if (!ensureAuth()) return;
  // #165（v0.25.73）：投诉通道——kind 白名单扩 complaint
  feedbackKind = (kind === 'bug' || kind === 'complaint') ? kind : 'suggestion';
  const feedbackPlaceholder = feedbackKind === 'complaint' ? UI.FEEDBACK_COMPLAINT_PLACEHOLDER : UI.FEEDBACK_PLACEHOLDER;
  openModal({
    title: `${feedbackKind === 'bug' ? UI.FEEDBACK_MODAL_TITLE_BUG : feedbackKind === 'complaint' ? UI.FEEDBACK_MODAL_TITLE_COMPLAINT : UI.FEEDBACK_MODAL_TITLE_SUGGEST}`,
    titleId: 'feedback-modal-title',
    closable: false,
    body: `<div id="post-alert"></div>
        <div class="form-group">
          <label class="form-label" for="post-title">${UI.POST_LABEL_TITLE}</label>
          <input type="text" id="post-title" class="form-input" maxlength="60" placeholder="${UI.FEEDBACK_TITLE_PLACEHOLDER}" oninput="updateTitleCount()">
          <span class="title-count" id="post-title-count">0/60</span>
        </div>
        ${segTabsHtml([
          { key: 'bug', label: UI.BTN_FEEDBACK_BUG, onclick: "switchFeedbackKind('bug')" },
          { key: 'suggestion', label: UI.BTN_FEEDBACK_SUGGEST, onclick: "switchFeedbackKind('suggestion')" },
          { key: 'complaint', label: UI.BTN_COMPLAINT, onclick: "switchFeedbackKind('complaint')" },
        ], feedbackKind, { containerClass: 'feedback-kind-row', attr: 'kind' })}
        <div class="form-group${feedbackKind === 'complaint' ? '' : ' hidden'}" id="feedback-subject-row">
          <label class="form-label" for="feedback-subject">${UI.FEEDBACK_COMPLAINT_SUBJECT_LABEL}</label>
          <select id="feedback-subject" class="form-select" aria-label="${UI.FEEDBACK_COMPLAINT_SUBJECT_LABEL}">
            <option value="teacher" selected>${UI.FEEDBACK_COMPLAINT_SUBJECT_TEACHER}</option>
            <option value="student">${UI.FEEDBACK_COMPLAINT_SUBJECT_STUDENT}</option>
            <option value="platform">${UI.FEEDBACK_COMPLAINT_SUBJECT_PLATFORM}</option>
          </select>
        </div>
        <div class="form-group">
          <label class="form-label">${UI.POST_LABEL_BODY}</label>
          <div class="md-toolbar">
            <button type="button" class="md-btn glass" onclick="mdWrap('h2')">H2</button>
            <button type="button" class="md-btn glass" onclick="mdWrap('h3')">H3</button>
            <button type="button" class="md-btn glass" onclick="mdWrap('bold')">${UI.POST_MD_BOLD}</button>
            <label class="md-btn glass" for="post-image-file">${UI.POST_MD_IMAGE}</label>
            <input type="file" id="post-image-file" accept="image/*" class="sr-file-input" onchange="insertPostImage(this)">
            <button type="button" class="md-btn glass" onclick="openPostPreview()">${UI.POST_PREVIEW_BTN}</button> <!-- v0.24.0 -->
          </div>
          <textarea id="post-body" class="form-input post-body-input" rows="7" placeholder="${feedbackPlaceholder}"></textarea>
        </div>`,
    footer: `<button type="button" class="btn btn-outline glass glass--pressable" onclick="closeModal()">${UI.BTN_CANCEL}</button>
          <button type="button" class="btn glass glass--pressable" onclick="submitFeedback()">${UI.BTN_SEND}</button>`,
  });
}

function switchFeedbackKind(kind) {
  feedbackKind = kind;
  document.querySelectorAll('.feedback-kind-row .seg-tab').forEach(b => b.classList.toggle('active', b.dataset.kind === kind));
  const t = document.getElementById('feedback-modal-title');
  if (t) t.textContent = kind === 'bug' ? UI.FEEDBACK_MODAL_TITLE_BUG : kind === 'complaint' ? UI.FEEDBACK_MODAL_TITLE_COMPLAINT : UI.FEEDBACK_MODAL_TITLE_SUGGEST;
  const subj = document.getElementById('feedback-subject-row');
  if (subj) subj.classList.toggle('hidden', kind !== 'complaint'); // 投诉对象行仅投诉档显示
  const ph = document.getElementById('post-body');
  if (ph) ph.placeholder = kind === 'complaint' ? UI.FEEDBACK_COMPLAINT_PLACEHOLDER : UI.FEEDBACK_PLACEHOLDER;
}

async function submitFeedback() {
  const title = (document.getElementById('post-title').value || '').trim();
  const content = (document.getElementById('post-body').value || '').trim();
  const alertEl = document.getElementById('post-alert');
  if (!title) { alertEl.innerHTML = alertHtml('error', UI.POST_TITLE_REQUIRED); return; }
  if (!content) { alertEl.innerHTML = alertHtml('error', UI.FEEDBACK_EMPTY); return; }
  // #165：投诉档须带对象（非投诉恒空；服务端白名单二次把关）
  const subject = feedbackKind === 'complaint'
    ? (document.getElementById('feedback-subject')?.value || '')
    : '';
  if (feedbackKind === 'complaint' && !['teacher', 'student', 'platform'].includes(subject)) {
    alertEl.innerHTML = alertHtml('error', UI.FEEDBACK_COMPLAINT_SUBJECT_REQUIRED);
    return;
  }
  try {
    await api('/api/feedbacks', { method: 'POST', body: { kind: feedbackKind, title, content, subject } });
    closeModal();
    showToast(feedbackKind === 'complaint' ? UI.FEEDBACK_COMPLAINT_SENT_TOAST : UI.FEEDBACK_SENT_TOAST);
  } catch (err) {
    alertEl.innerHTML = alertHtml('error', err.message);
  }
}

// #165（v0.25.73）：我的反馈与投诉——GET /api/feedbacks/mine 渲染浮窗
// 类型 tag 走 DISP.feedbackKindName、投诉对象走 DISP.feedbackSubjectName（显示映射单源）；
// 正文走 mdRender 排版（反馈内容支持轻量 Markdown）；空态 UI.MY_FEEDBACK_EMPTY。
async function openMyFeedback() {
  if (!ensureAuth()) return;
  openModal({
    title: UI.MY_FEEDBACK_TITLE,
    cls: 'modal--wide',
    bodyCls: 'my-feedback-body',
    body: `<div class="my-feedback-list">${loaderHtml()}</div>`,
  });
  try {
    const data = await api('/api/feedbacks/mine', { method: 'GET' });
    const list = data.feedbacks || [];
    const bodyEl = document.querySelector('#modal-container .my-feedback-list');
    if (!bodyEl) return; // 浮窗已被关闭
    if (!list.length) { bodyEl.innerHTML = `<div class="empty-state">${UI.MY_FEEDBACK_EMPTY}</div>`; return; }
    bodyEl.innerHTML = list.map(f => {
      const resolved = f.status === 'resolved';
      const subject = DISP.feedbackSubjectName(f.subject);
      return `<div class="list-card glass my-feedback-card">
          <div class="list-card-header">
            <span class="list-card-title">${escHtml(f.title || '')}</span>
            <span class="feedback-tags">
              <span class="tag glass glass--solid ${f.kind === 'bug' ? 'tag-danger' : f.kind === 'complaint' ? 'tag-warn' : 'tag-accent'}">${escHtml(DISP.feedbackKindName(f.kind))}</span>
              ${subject ? `<span class="tag glass glass--solid tag-ok">${escHtml(subject)}</span>` : ''}
              <span class="tag glass glass--solid ${resolved ? 'tag-ok' : 'tag-warn'}">${resolved ? UI.FEEDBACK_STATUS_RESOLVED : UI.FEEDBACK_STATUS_OPEN}</span>
            </span>
          </div>
          ${f.content ? `<div class="list-card-detail feedback-content md-preview md-preview--full">${mdRender(f.content) || ''}</div>` : ''}
          <div class="feedback-foot"><span class="list-card-meta">${fmtDateTime(f.created_at)}</span></div>
        </div>`;
    }).join('');
  } catch (err) {
    const bodyEl = document.querySelector('#modal-container .my-feedback-list');
    if (bodyEl) bodyEl.innerHTML = `<div class="empty-state">${escHtml(err.message)}</div>`;
  }
}

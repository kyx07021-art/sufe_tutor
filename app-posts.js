/**
 * 资料共享广场（教师侧边栏「资料共享」页，模块2）
 *
 * 经典脚本：全部顶层全局函数 + 内联 onclick，与 app.js 同一约定。
 * 仅依赖 app.js 提供的基础设施：state / api / escHtml / showToast / closeModal；
 * 删除确认弹窗自写（postConfirmDelete），不调用 app.js 的 confirmDanger，避免跨模块耦合。
 * mdRender 为自研轻量 markdown-lite：先 escHtml 全转义再逐行识别语法，不引任何外部库。
 * section 恒 'plaza'，当前不做分区 UI（接口已预留 section 参数）。
 */

// ============================================================
// 模块内状态
// ============================================================
let postsList = [];          // 当前已加载的帖子（点赞后本地同步的数据源）
let postsSearchTimer = null; // 搜索防抖定时器

// ============================================================
// 页面入口与列表加载
// ============================================================

// 侧边栏项入口（ROLE_PAGES.teacher → enterResourceShare）：
// 渲染工具条（搜索 / 排序 / 发布）+ 列表容器到 #posts-content，然后拉数据
function enterResourceShare() {
  clearTimeout(postsSearchTimer); // 清掉上一次停留时挂起的防抖回调，防切回瞬间打到隐藏页
  const isTeacher = state.user && state.user.role === 'teacher';
  document.getElementById('posts-content').innerHTML = `
    <div class="posts-toolbar">
      <input type="search" id="posts-search" class="form-input posts-search"
        placeholder="${UI.POSTS_SEARCH_PLACEHOLDER}" oninput="postsSearchDebounced()">
      <select id="posts-sort" class="form-select posts-sort" onchange="loadPosts()">
        <option value="new">${UI.POSTS_SORT_NEW}</option>
        <option value="hot">${UI.POSTS_SORT_HOT}</option>
      </select>
      ${isTeacher ? `<button type="button" class="btn btn-primary btn-sm" onclick="openPostEditor()">${UI.BTN_CREATE_POST}</button>` : ''}
    </div>
    <div id="posts-list"><div class="empty-state"><p>${UI.LOADING}</p></div></div>`;
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
  return loadInto('posts-list', async () => {
    const q = (document.getElementById('posts-search')?.value || '').trim();
    const sort = document.getElementById('posts-sort')?.value || 'new';
    const url = `/api/posts?sort=${sort}` + (q ? `&q=${encodeURIComponent(q)}` : '');
    const data = await api(url);
    postsList = data.posts || []; // 渲染前同步：点赞就地更新依赖此数据源
    return data;
  }, rows => rows.map(renderPostCard).join(''),
  { seqKey: 'posts', empty: UI.POSTS_EMPTY, pick: d => d.posts, reveal: true });
}

// 帖子卡：标题 / 作者+时间 / 正文摘要（md 原文前 80 字，escHtml）/ 点赞 / 作者可删
function renderPostCard(p, i) {
  const mine = state.user && p.user_id === state.user.id;
  const raw = String(p.body_md || '');
  const snippet = raw.slice(0, 80);
  const time = typeof fmtDateTime === 'function' ? fmtDateTime(p.created_at) : String(p.created_at || '').slice(0, 16);
  return `<div class="post-card" style="--i:${Math.min(i, 8)}">
    <div class="post-card-head">
      <h3 class="post-title">${escHtml(p.title)}</h3>
      ${mine ? `<button type="button" class="post-del" onclick="postConfirmDelete(${p.id})">${UI.POST_BTN_DELETE}</button>` : ''}
    </div>
    <div class="post-meta">
      <span class="post-author">${globalThis.SUFE_DISPLAY.usernameHtml(p.username || UI.POST_ANONYMOUS)}</span>
      <span class="post-time">${escHtml(time)}</span>
    </div>
    ${snippet ? `<p class="post-snippet">${escHtml(snippet)}${raw.length > 80 ? '…' : ''}</p>` : ''}
    <div class="post-actions">
      <button type="button" class="post-like${p.liked ? ' liked' : ''}" data-id="${p.id}"
        aria-pressed="${p.liked ? 'true' : 'false'}" aria-label="${UI.POST_LIKE_ARIA}" onclick="togglePostLike(${p.id})">
        <svg class="like-icon" viewBox="0 0 24 24" width="15" height="15" aria-hidden="true"
          fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
          <path d="M14 9V5a3 3 0 0 0-3-3l-4 9v11h11.28a2 2 0 0 0 2-1.7l1.38-9a2 2 0 0 0-2-2.3zM7 22H4a2 2 0 0 1-2-2v-7a2 2 0 0 1 2-2h3"/>
        </svg>
        <span class="like-count">${p.like_count || 0}</span>
      </button>
    </div>
  </div>`;
}

// ============================================================
// 点赞（就地更新按钮，避免整列重渲染重放入场动画）
// ============================================================
const postLikeSeq = {}; // 每帖独立序号：双击连发时乱序到达的旧响应丢弃，UI 态以最后一次为准
async function togglePostLike(id) {
  if (!ensureAuth()) return; // 访客可浏览广场，点赞需登录
  const seq = (postLikeSeq[id] = (postLikeSeq[id] || 0) + 1);
  try {
    const data = await api(`/api/posts/${id}/like`, { method: 'POST', body: {} });
    if (postLikeSeq[id] !== seq) return; // 已有更新的点赞请求，丢弃过期响应
    const p = postsList.find(x => x.id === id);
    if (p) { p.liked = data.liked; p.like_count = data.likeCount; }
    const btn = document.querySelector(`#posts-list .post-like[data-id="${id}"]`);
    if (btn) {
      btn.classList.toggle('liked', data.liked);
      btn.setAttribute('aria-pressed', data.liked ? 'true' : 'false');
      const cnt = btn.querySelector('.like-count');
      if (cnt) cnt.textContent = data.likeCount;
    }
    showToast(data.liked ? UI.POST_LIKED_TOAST : UI.POST_UNLIKED_TOAST);
  } catch (err) {
    showToast(err.message);
  }
}

// ============================================================
// 发布弹窗（标题 + Markdown 工具条 + 实时预览）
// ============================================================
function openPostEditor() {
  if (!ensureAuth()) return;
  // 防误触：点遮罩不关（编辑成本高，只能 ✕ / 取消关闭）
  document.getElementById('modal-container').innerHTML = `<div class="modal-overlay">
    <div class="modal">
      <div class="modal-header"><h2>${UI.POST_MODAL_TITLE_CREATE}</h2><button type="button" class="btn btn-ghost btn-icon" onclick="closeModal()">✕</button></div>
      <div class="modal-body">
        <div id="post-alert"></div>
        <div class="form-group">
          <label class="form-label" for="post-title">${UI.POST_LABEL_TITLE} <span class="req">*</span></label>
          <input type="text" id="post-title" class="form-input" maxlength="60" placeholder="${UI.POST_TITLE_PLACEHOLDER}" oninput="updateTitleCount()">
          <span class="title-count" id="post-title-count">0/60</span>
        </div>
        <div class="form-group">
          <label class="form-label" for="post-body">${UI.POST_LABEL_BODY}</label>
          <div class="md-toolbar">
            <button type="button" class="md-btn" onclick="mdWrap('h2')">H2</button>
            <button type="button" class="md-btn" onclick="mdWrap('h3')">H3</button>
            <button type="button" class="md-btn" onclick="mdWrap('bold')">${UI.POST_MD_BOLD}</button>
            <label class="md-btn" for="post-image-file">${UI.POST_MD_IMAGE}</label>
            <input type="file" id="post-image-file" accept="image/*" class="sr-file-input" onchange="insertPostImage(this)">
          </div>
          <textarea id="post-body" class="form-input post-body-input" rows="9"
            placeholder="${UI.POST_BODY_PLACEHOLDER}"
            oninput="updatePostPreview()"></textarea>
        </div>
        <div class="form-group">
          <label class="form-label">${UI.POST_PREVIEW_LABEL}</label>
          <div id="post-preview" class="md-preview"></div>
        </div>
        <div class="modal-footer">
          <button type="button" class="btn btn-outline" onclick="closeModal()">${UI.BTN_CANCEL}</button>
          <button type="button" class="btn btn-primary" id="post-submit" onclick="submitPost()">${UI.BTN_PUBLISH}</button>
        </div>
      </div>
    </div>
  </div>`;
  updatePostPreview();
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
  updatePostPreview();
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
    updatePostPreview();
  };
  reader.readAsDataURL(file);
}

// 实时预览：textarea oninput → mdRender
function updatePostPreview() {
  const el = document.getElementById('post-preview');
  const ta = document.getElementById('post-body');
  if (!el || !ta) return;
  el.innerHTML = mdRender(ta.value) || `<p class="md-preview-empty">${UI.POST_PREVIEW_EMPTY}</p>`;
}

/**
 * 轻量 markdown-lite 渲染器（自研，零依赖）
 * 安全策略：先 escHtml 全转义（任何注入文本已失效），再逐行识别语法。
 * 规则：'### ' → h4；'## ' → h3；**x** → strong；
 *       ![alt](url) → <img>，url 仅放行 http(s): 与 data:image 前缀且不含空白，
 *       其余（含 javascript: 等伪协议）占位不渲染；其余非空行包 <p>，空行跳过。
 * 返回 HTML 字符串。
 */
function mdRender(src) {
  const escaped = escHtml(String(src ?? ''));
  const IMG_OK = /^(https?:|data:image\/)/i;
  const inline = s => s
    .replace(/!\[([^\]]*)\]\(([^)]*)\)/g, (m, alt, url) =>
      (IMG_OK.test(url) && !/\s/.test(url))
        ? `<img src="${url}" alt="${alt}">`
        : `<span class="md-img-blocked">${UI.POST_IMG_BLOCKED}</span>`)
    .replace(/\*\*([^*]+)\*\*/g, '<strong>$1</strong>');
  const out = [];
  for (const line of escaped.split('\n')) {
    if (!line.trim()) continue;
    if (line.startsWith('### ')) out.push(`<h4>${inline(line.slice(4))}</h4>`);
    else if (line.startsWith('## ')) out.push(`<h3>${inline(line.slice(3))}</h3>`);
    else out.push(`<p>${inline(line)}</p>`);
  }
  return out.join('');
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
    alertEl.innerHTML = `<div class="alert alert-error">${UI.POST_TITLE_REQUIRED}</div>`;
    titleEl.focus();
    return;
  }
  try {
    btn.disabled = true;
    btn.innerHTML = `<span class="spinner"></span> ${UI.POST_PUBLISHING}`;
    await api('/api/posts', {
      method: 'POST',
      body: { title, bodyMd: bodyEl.value || '' },
    });
    closeModal();
    showToast(UI.POST_PUBLISHED);
    loadPosts();
  } catch (err) {
    alertEl.innerHTML = `<div class="alert alert-error">${escHtml(err.message)}</div>`;
    btn.disabled = false;
    btn.textContent = UI.BTN_PUBLISH;
  }
}

// 删除二次确认（自写小弹窗，模式同 app.js 的 confirmDanger，但不调用它以免耦合）
function postConfirmDelete(id) {
  document.getElementById('modal-container').innerHTML = `<div class="modal-overlay" onclick="if(event.target===this)closeModal()">
    <div class="modal post-confirm-modal">
      <div class="modal-header"><h2>${UI.POST_DELETE_TITLE}</h2><button type="button" class="btn btn-ghost btn-icon" onclick="closeModal()">✕</button></div>
      <div class="modal-body">
        <p class="text-sm post-confirm-text">${UI.POST_DELETE_CONFIRM}</p>
        <div class="modal-footer">
          <button type="button" class="btn btn-outline" onclick="closeModal()">${UI.BTN_CANCEL}</button>
          <button type="button" class="btn btn-danger" onclick="deletePost(${id})">${UI.BTN_CONFIRM_DELETE}</button>
        </div>
      </div>
    </div>
  </div>`;
}

async function deletePost(id) {
  try {
    await api(`/api/posts/${id}`, { method: 'DELETE', body: {} });
    closeModal();
    showToast(UI.POST_DELETED);
    loadPosts();
  } catch (err) {
    showToast(err.message);
    if (/不存在/.test(err.message)) { closeModal(); loadPosts(); } // 帖子已被（管理员）删除：刷新列表消除陈旧卡片
  }
}

// ============================================================
// 标题字数计数：最右灰色小字 n/60，超 55 变红，超 60 截断
function updateTitleCount() {
  const inp = document.getElementById('post-title');
  const el = document.getElementById('post-title-count');
  if (!inp || !el) return;
  if (inp.value.length > 60) inp.value = inp.value.slice(0, 60);
  el.textContent = `${inp.value.length}/60`;
  el.classList.toggle('over', inp.value.length > 55);
}

// 管理员系统通知广播：复用发帖组件的 Markdown 编辑器（同一套 ID，弹窗互斥不冲突）
// ============================================================
function openBroadcastModal() {
  document.getElementById('modal-container').innerHTML = `<div class="modal-overlay">
    <div class="modal">
      <div class="modal-header"><h2>${UI.BROADCAST_MODAL_TITLE}</h2><button type="button" class="btn btn-ghost btn-icon" onclick="closeModal()">✕</button></div>
      <div class="modal-body">
        <div id="post-alert"></div>
        <div class="form-group">
          <label class="form-label" for="post-title">${UI.POST_LABEL_TITLE}</label>
          <input type="text" id="post-title" class="form-input" maxlength="60" placeholder="${UI.BROADCAST_TITLE_PLACEHOLDER}" oninput="updateTitleCount()">
          <span class="title-count" id="post-title-count">0/60</span>
        </div>
        <div class="form-group">
          <label class="form-label">${UI.POST_LABEL_BODY}</label>
          <div class="md-toolbar">
            <button type="button" class="md-btn" onclick="mdWrap('h2')">H2</button>
            <button type="button" class="md-btn" onclick="mdWrap('h3')">H3</button>
            <button type="button" class="md-btn" onclick="mdWrap('bold')">${UI.POST_MD_BOLD}</button>
            <label class="md-btn" for="post-image-file">${UI.POST_MD_IMAGE}</label>
            <input type="file" id="post-image-file" accept="image/*" class="sr-file-input" onchange="insertPostImage(this)">
          </div>
          <textarea id="post-body" class="form-input post-body-input" rows="7"
            placeholder="${UI.BROADCAST_BODY_PLACEHOLDER}"
            oninput="updatePostPreview()"></textarea>
        </div>
        <div class="form-group">
          <label class="form-label">${UI.POST_PREVIEW_LABEL}</label>
          <div id="post-preview" class="md-preview"></div>
        </div>
        <div class="modal-footer">
          <button type="button" class="btn btn-outline" onclick="closeModal()">${UI.BTN_CANCEL}</button>
          <button type="button" class="btn btn-primary" id="broadcast-submit" onclick="submitBroadcast()">${UI.BTN_SEND_NOTIFICATION}</button>
        </div>
      </div>
    </div>
  </div>`;
  updatePostPreview();
  document.getElementById('post-body').focus();
}

async function submitBroadcast() {
  const title = (document.getElementById('post-title').value || '').trim();
  const text = (document.getElementById('post-body').value || '').trim();
  const alertEl = document.getElementById('post-alert');
  if (!title) { alertEl.innerHTML = `<div class="alert alert-error">${UI.POST_TITLE_REQUIRED}</div>`; return; }
  if (!text) { alertEl.innerHTML = `<div class="alert alert-error">${UI.VALIDATE_BROADCAST_EMPTY}</div>`; return; }
  const btn = document.getElementById('broadcast-submit');
  btn.disabled = true;
  try {
    // 服务端给标题加【系统通知】前缀后群发
    await api('/api/notifications/broadcast', { method: 'POST', body: { username: state.user.username, title, text } });
    closeModal();
    showToast(UI.BROADCAST_SENT_TOAST);
    if (state.page === 'notifications') enterNotifications(); // 自己也收一条，列表即时刷新
  } catch (err) {
    alertEl.innerHTML = `<div class="alert alert-error">${escHtml(err.message)}</div>`;
    btn.disabled = false;
  }
}

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
// 渲染工具条（视图切换 / 搜索 / 排序 / 发布）+ 列表容器到 #posts-content，然后拉数据
let postsView = 'all'; // R23：'all' 广场全部 / 'fav' 我的收藏（收藏即保存，仅本人可见）
function enterResourceShare() {
  clearTimeout(postsSearchTimer); // 清掉上一次停留时挂起的防抖回调，防切回瞬间打到隐藏页
  const isTeacher = state.user && state.user.role === 'teacher';
  document.getElementById('posts-content').innerHTML = `
    <div class="posts-toolbar glass">
      <!-- M7（v0.25.103）+ B7（v0.26.4 返工）：我的收藏从切换式 tab 改单个 toggle 按钮，
           复用「屏蔽系统通知」按钮的 SVG 描边勾模式——进入收藏态前置勾（.posts-fav-btn--on::before，
           同 .notif-block-btn SVG data-uri 单源，非字符 √），再点回全部 -->
      <button type="button" class="btn btn-sm glass glass--pressable posts-fav-btn${postsView === 'fav' ? ' posts-fav-btn--on' : ''}" id="posts-fav-btn"
        onclick="togglePostsFav()" aria-pressed="${postsView === 'fav'}">${postsView === 'fav' ? UI.POSTS_FAV_ACTIVE : UI.POSTS_VIEW_FAV}</button>
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

// M7：收藏视图 toggle（替代原 seg-tab 切换）——收藏视图清空搜索框（列表按收藏时间倒序，不受搜索/排序影响）
function togglePostsFav() {
  postsView = postsView === 'all' ? 'fav' : 'all';
  const btn = document.getElementById('posts-fav-btn');
  if (btn) {
    btn.textContent = postsView === 'fav' ? UI.POSTS_FAV_ACTIVE : UI.POSTS_VIEW_FAV;
    btn.classList.toggle('posts-fav-btn--on', postsView === 'fav'); // B7：选中态前置 SVG 勾
    btn.setAttribute('aria-pressed', postsView === 'fav');
  }
  const search = document.getElementById('posts-search');
  if (search) search.value = '';
  loadPosts();
}

// 搜索框防抖：停止输入 350ms 后再触发 loadPosts
function postsSearchDebounced() {
  clearTimeout(postsSearchTimer);
  postsSearchTimer = setTimeout(() => loadPosts(), CONFIG.POSTS_SEARCH_DEBOUNCE_MS);
}

// 拉取帖子列表：全部视图 sort / q 取自工具条；我的收藏视图走独立接口（按收藏时间倒序）。
// liked / favorited 标记由后端凭令牌判定（访客恒 false）；乱序守卫由 loadInto 的 seqKey:'posts' 接管
function loadPosts() {
  const q = (document.getElementById('posts-search')?.value || '').trim();
  const sort = document.getElementById('posts-sort')?.value || 'new';
  const url = postsView === 'fav'
    ? '/api/posts/favorites/mine' // R23：我的收藏（独立数据源，不受搜索/排序影响）
    : `/api/posts?sort=${sort}` + (q ? `&q=${encodeURIComponent(q)}` : '');
  postsUrl = url; // 记录最近 URL，探测刷新后按其重挂 postsList（审计 M1）
  return loadInto('posts-list', async () => {
    const data = await dhGet(url, { domain: 'posts' }); // v0.23.0 静默数据层
    postsList = data.posts || []; // 渲染前同步：点赞/收藏就地更新依赖此数据源
    return data;
  }, rows => rows.map(renderPostCard).join(''),
  { seqKey: 'posts', empty: postsView === 'fav' ? UI.POSTS_FAV_EMPTY : UI.POSTS_EMPTY, pick: d => d.posts, reveal: true, peek: () => dhReady(url) });
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

// R23（v0.25.87）：收藏 pill 组件（列表卡 + 详情浮窗共用）——同点赞的复选框逻辑：
// favorited 态骑原生 checkbox checked（:has(input:checked) 单源），原生翻转即乐观即时反馈，
// 服务端返回后以 data.favorited 收敛，失败回滚。收藏是私人的，无公开计数，仅图标 + 状态文案。
function favPillHtml(p) {
  return `<label class="post-fav glass" data-id="${p.id}">
    <input type="checkbox"${p.favorited ? ' checked' : ''} aria-label="${UI.POST_FAV_ARIA}" onchange="togglePostFavorite(${p.id}, this)">
    <svg class="fav-icon" viewBox="0 0 24 24" width="15" height="15" aria-hidden="true"
      fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
      <path d="M19 21l-7-5-7 5V5a2 2 0 0 1 2-2h10a2 2 0 0 1 2 2z"/>
    </svg>
    <span class="fav-label">${p.favorited ? UI.BTN_FAVORITED : UI.BTN_FAVORITE}</span>
  </label>`;
}

// 帖子卡：标题 / 作者+时间 / 正文摘要（md 原文前 80 字，escHtml）/ 点赞 / 收藏 / 作者可删。
// #161（v0.25.69）：整卡可点击查看全文浮窗——卡 onclick 统一接管，点赞/收藏/删除内部控件用 closest 守卫不透传；
// 标题转 button（键盘焦点 + Enter/Space 原生 click 冒泡到卡），正文摘要过长时点击即看全文。
function renderPostCard(p, i) {
  const mine = state.user && p.user_id === state.user.id;
  const raw = String(p.body_md || '');
  const snippet = raw.slice(0, CONFIG.POST_SNIPPET);
  const time = p.created_at ? fmtDateTime(p.created_at) : '';
  return `<div class="post-card glass" style="--i:${Math.min(i, 8)}" data-post-id="${p.id}" onclick="postCardClick(event, ${p.id})">
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
      ${favPillHtml(p)}
    </div>
  </div>`;
}

// #161（v0.25.69）：帖子卡点击守卫——点赞/收藏/删除等内部控件点击不透传（事件从控件冒泡上来，closest 命中即返回）
function postCardClick(event, id) {
  if (!event || (event.target.closest && event.target.closest('.post-like, .post-fav, .post-del'))) return;
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
    title: p.title, // S2-2：openModal 组件内统一转义（调用方传原文）
    cls: 'modal--wide', // 长文拓宽（同 md 预览）
    bodyCls: 'md-preview md-preview--full',
    body: `
      <div class="post-meta">
        <span class="post-author">${DISP.usernameHtml(p.username || UI.POST_ANONYMOUS)}${DISP.deactivatedTag(p.username)}</span>
        <span class="post-time">${escHtml(time)}</span>
      </div>
      <div class="post-detail-body">${mdRender(p.body_md) || `<p>${UI.POST_PREVIEW_EMPTY}</p>`}</div>`,
    footer: `<div class="post-detail-foot">${likePillHtml(p)}${favPillHtml(p)}${mine ? `<button type="button" class="btn btn-text-danger glass glass--pressable" onclick="postConfirmDelete(${p.id})">${UI.POST_BTN_DELETE}</button>` : ''}</div>`,
  });
}

// ============================================================
// 点赞（就地更新按钮，避免整列重渲染重放入场动画）
// ============================================================
const postLikeSeq = {}; // 每帖独立序号：双击连发时乱序到达的旧响应丢弃，UI 态以最后一次为准
// U10（网络层架构债）：点赞/收藏状态就地收敛（列表卡 + 详情浮窗 + postsList 数据源单点）
function applyPostLikeState(id, liked, likeCount) {
  const p = postsList.find(x => x.id === id);
  if (p) { p.liked = liked; p.like_count = likeCount; }
  document.querySelectorAll(`.post-like[data-id="${id}"]`).forEach(label => {
    const box = label.querySelector('input[type="checkbox"]');
    if (box) box.checked = liked;
    const cnt = label.querySelector('.like-count');
    if (cnt) cnt.textContent = likeCount;
  });
}
async function togglePostLike(id, input) {
  // #160（v0.25.68）：复选逻辑接入——change 在原生翻转后触发，input.checked 即新态，
  // 取反得点前态；访客/失败回滚靠它还原。视觉由 CSS :has(input:checked) 单源，不再管 .liked 类。
  if (!input) return;
  const wasChecked = !input.checked; // 点前态
  const target = input.checked;      // 目标态（原生已翻转）
  const p0 = postsList.find(x => x.id === id);
  const cnt0 = document.querySelector(`.post-like[data-id="${id}"] .like-count`);
  const origLiked = p0 ? p0.liked : wasChecked;
  const origCount = p0 ? (p0.like_count ?? 0) : (cnt0 ? (Number(cnt0.textContent) || 0) : 0);
  const revert = () => {
    if (input && input.checked !== wasChecked) input.checked = wasChecked;
    document.querySelectorAll(`.post-like[data-id="${id}"]`).forEach(label => {
      const box = label.querySelector('input[type="checkbox"]');
      if (box) box.checked = wasChecked;
      const cnt = label.querySelector('.like-count');
      if (cnt) cnt.textContent = origCount;
    });
    if (p0) { p0.liked = origLiked; p0.like_count = origCount; }
  };
  if (!ensureAuth()) { revert(); return; } // 访客可浏览广场，点赞需登录（原生已翻转，须回滚）
  const seq = (postLikeSeq[id] = (postLikeSeq[id] || 0) + 1);
  // U10 乐观反馈：文字/计数/toast 本地立即（不等服务端往返），服务端返回后再收敛；失败回滚
  applyPostLikeState(id, target, origCount + (target ? 1 : -1));
  showToast(target ? UI.POST_LIKED_TOAST : UI.POST_UNLIKED_TOAST);
  try {
    const data = await api(`/api/posts/${id}/like`, { method: 'POST', body: {} });
    if (postLikeSeq[id] !== seq) return; // 已有更新的点赞请求，丢弃过期响应
    applyPostLikeState(id, data.liked, data.likeCount); // 服务端为准：并发对端取消/失败兜底由这里收敛
  } catch (err) {
    if (postLikeSeq[id] !== seq) return; // 过期请求的错误不覆盖新请求的 UI 态
    revert();
    showToast(err.message);
  }
}

// ============================================================
// 收藏（R23）：就地更新按钮，避免整列重渲染重放入场动画
// ============================================================
const postFavSeq = {}; // 每帖独立序号：连点时乱序旧响应丢弃（同点赞口径）
// U10：收藏状态就地收敛（checkbox + 文案 + postsList 数据源）
function applyPostFavState(id, favorited) {
  const p = postsList.find(x => x.id === id);
  if (p) p.favorited = favorited;
  document.querySelectorAll(`.post-fav[data-id="${id}"]`).forEach(label => {
    const box = label.querySelector('input[type="checkbox"]');
    if (box) box.checked = favorited;
    const txt = label.querySelector('.fav-label');
    if (txt) txt.textContent = favorited ? UI.BTN_FAVORITED : UI.BTN_FAVORITE;
  });
}
async function togglePostFavorite(id, input) {
  if (!input) return;
  const wasChecked = !input.checked; // 点前态
  const target = input.checked;      // 目标态（原生已翻转）
  const p0 = postsList.find(x => x.id === id);
  const origFav = p0 ? p0.favorited : wasChecked;
  const revert = () => {
    if (input && input.checked !== wasChecked) input.checked = wasChecked;
    document.querySelectorAll(`.post-fav[data-id="${id}"]`).forEach(label => {
      const box = label.querySelector('input[type="checkbox"]');
      if (box) box.checked = wasChecked;
      const txt = label.querySelector('.fav-label');
      if (txt) txt.textContent = origFav ? UI.BTN_FAVORITED : UI.BTN_FAVORITE;
    });
    if (p0) p0.favorited = origFav;
  };
  if (!ensureAuth()) { revert(); return; } // 访客可浏览广场，收藏需登录（原生已翻转，须回滚）
  const seq = (postFavSeq[id] = (postFavSeq[id] || 0) + 1);
  // U10 乐观反馈：文案/toast 本地立即（不等服务端往返），服务端返回后再收敛；失败回滚
  applyPostFavState(id, target);
  showToast(target ? UI.POST_FAVORITED_TOAST : UI.POST_UNFAVORITED_TOAST);
  try {
    const data = await api(`/api/posts/${id}/favorite`, { method: 'POST', body: {} });
    if (postFavSeq[id] !== seq) return; // 连点：过期响应丢弃，新响应收敛
    applyPostFavState(id, data.favorited); // 服务端为准
    // 我的收藏视图：取消收藏就地移除卡（服务端确认后才移除，失败卡片留在原位可再点）
    if (!data.favorited && postsView === 'fav') {
      const card = document.querySelector(`#posts-list .post-fav[data-id="${id}"]`)?.closest('.post-card');
      if (card) card.remove();
    }
  } catch (err) {
    if (postFavSeq[id] !== seq) return; // 过期请求的错误不覆盖新请求的 UI 态
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
    body: `
        <div class="form-group">
          <label class="form-label" for="post-title">${UI.POST_LABEL_TITLE} <span class="req">*</span></label>
          <input type="text" id="post-title" class="form-input" maxlength="${CONFIG.POST_TITLE_MAX}" placeholder="${UI.POST_TITLE_PLACEHOLDER}" oninput="updateTitleCount()">
          <span class="title-count" id="post-title-count">0/${CONFIG.POST_TITLE_MAX}</span>
        </div>
        ${mdEditorHtml({ rows: 9, placeholder: UI.POST_BODY_PLACEHOLDER, labelFor: 'post-body' })}`,
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
  const btn = document.getElementById('post-submit');
  const title = (titleEl.value || '').trim();

  if (!title) {
    showToast(UI.POST_TITLE_REQUIRED, 'error'); // v0.25.99：校验提示走底部 Toast
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
    showToast(err.message, 'error');
    btnDone(btn, UI.BTN_PUBLISH);
  }
}

// 删除二次确认：薄封装复用共享 confirm() 原语（v0.25.10 反馈 #82 合并，连根删自写小弹窗）
function postConfirmDelete(id) {
  confirm({ title: UI.POST_DELETE_TITLE, message: UI.POST_DELETE_CONFIRM, okText: UI.BTN_CONFIRM_DELETE, onConfirm: () => deletePost(id) });
}

async function deletePost(id) {
  // F12（v0.27.0）乐观删除：确认后卡片立即移除，失败整列重渲染恢复——不再等服务端往返
  closeModal();
  const card = document.querySelector(`.post-card[data-post-id="${id}"]`);
  if (card) card.remove(); // 乐观：卡片立即消失
  try {
    await api(`/api/posts/${id}`, { method: 'DELETE', body: {} });
    showToast(UI.POST_DELETED);
    invalidate('posts'); // v0.23.1 审计 M1：否则被删帖子从缓存闪回
  } catch (err) {
    loadPosts(); // 失败回滚：整列重渲染恢复卡片
    if (err.code === 'POST_NOT_FOUND') { closeModal(); loadPosts(); } // C2：帖子已被（管理员）删除：只认 code（A8 删人类文案依赖）
    showToast(err.message);
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
    body: `
        <div class="form-group">
          <label class="form-label" for="post-title">${UI.POST_LABEL_TITLE}</label>
          <input type="text" id="post-title" class="form-input" maxlength="${CONFIG.POST_TITLE_MAX}" placeholder="${UI.BROADCAST_TITLE_PLACEHOLDER}" oninput="updateTitleCount()">
          <span class="title-count" id="post-title-count">0/${CONFIG.POST_TITLE_MAX}</span>
        </div>
        ${mdEditorHtml({ rows: 7, placeholder: UI.BROADCAST_BODY_PLACEHOLDER })}`,
    footer: `<button type="button" class="btn btn-outline glass glass--pressable" onclick="closeModal()">${UI.BTN_CANCEL}</button>
          <button type="button" class="btn glass glass--pressable" id="broadcast-submit" onclick="submitBroadcast()">${UI.BTN_SEND_NOTIFICATION}</button>`,
  });
  document.getElementById('post-body').focus();
}

async function submitBroadcast() {
  const title = (document.getElementById('post-title').value || '').trim();
  const text = (document.getElementById('post-body').value || '').trim();
  if (!title) { showToast(UI.POST_TITLE_REQUIRED, 'error'); return; }
  if (!text) { showToast(UI.VALIDATE_BROADCAST_EMPTY, 'error'); return; }
  const btn = document.getElementById('broadcast-submit');
  btnLoading(btn);
  try {
    // 服务端给标题加【系统通知】前缀后群发
    await api('/api/notifications/broadcast', { method: 'POST', body: { title, text } });
    closeModal();
    showToast(UI.BROADCAST_SENT_TOAST);
    if (state.page === 'notifications') enterNotifications(); // 自己也收一条，列表即时刷新
  } catch (err) {
    showToast(err.message, 'error');
    btnDone(btn);
  }
}

// ============================================================
// 用户反馈（关于平台页 Bug/建议提交）：复用发帖组件的 Markdown 编辑器（同一套 ID，弹窗互斥不冲突）
// —— 与发帖/广播同为「内容提交」领域，并入本模块（功能相近合并）
// ============================================================
let feedbackKind = 'bug';
// R22（v0.25.87）：投诉已独立为 openComplaintModal（app-complaints.js），
// 此处反馈浮窗仅保留 bug / 建议两档，complaint 档连根拔除。
// M11（v0.25.103）：用户支持入口合并——「投诉与反馈」先出三选浮窗（Bug/建议/投诉），
// 选中后关闭 chooser 再开对应专线浮窗（反馈 Bug 与建议浮窗本已独立，符合专线原则）。
function openFeedbackComplaintChooser() {
  if (!ensureAuth()) return;
  openModal({
    title: UI.BTN_COMPLAINT_FEEDBACK,
    body: `
      <div class="chooser-grid">
        <button type="button" class="btn glass glass--pressable chooser-item" onclick="closeModal(); openFeedbackModal('bug')">${escHtml(UI.FEEDBACK_CHOOSE_BUG)}</button>
        <button type="button" class="btn glass glass--pressable chooser-item" onclick="closeModal(); openFeedbackModal('suggestion')">${escHtml(UI.FEEDBACK_CHOOSE_SUGGESTION)}</button>
        <button type="button" class="btn glass glass--pressable chooser-item" onclick="closeModal(); openComplaintModal()">${escHtml(UI.FEEDBACK_CHOOSE_COMPLAINT)}</button>
      </div>`,
  });
}

function openFeedbackModal(kind) {
  if (!ensureAuth()) return;
  // A1 审计（v0.25.104）：M11 chooser 三选后 kind 即固定（专线原则真正落地）——原浮窗内仍渲染
  // Bug/建议 切换 tab（segTabsHtml + switchFeedbackKind），chooser 的选择在浮窗内可被推翻，冗余
  // 入口层已移除；本函数现在唯一调用方就是 chooser 三个 onclick（kind 恒有值）。
  feedbackKind = (kind === 'bug') ? kind : 'suggestion';
  openModal({
    title: feedbackKind === 'bug' ? UI.FEEDBACK_MODAL_TITLE_BUG : UI.FEEDBACK_MODAL_TITLE_SUGGEST,
    closable: false,
    body: `
        <div class="form-group">
          <label class="form-label" for="post-title">${UI.POST_LABEL_TITLE}</label>
          <input type="text" id="post-title" class="form-input" maxlength="${CONFIG.POST_TITLE_MAX}" placeholder="${UI.FEEDBACK_TITLE_PLACEHOLDER}" oninput="updateTitleCount()">
          <span class="title-count" id="post-title-count">0/${CONFIG.POST_TITLE_MAX}</span>
        </div>
        ${mdEditorHtml({ rows: 7, placeholder: UI.FEEDBACK_PLACEHOLDER })}`,
    footer: `<button type="button" class="btn btn-outline glass glass--pressable" onclick="closeModal()">${UI.BTN_CANCEL}</button>
          <button type="button" class="btn glass glass--pressable" onclick="submitFeedback()">${UI.BTN_SEND}</button>`,
  });
}

async function submitFeedback() {
  const title = (document.getElementById('post-title').value || '').trim();
  const content = (document.getElementById('post-body').value || '').trim();
  if (!title) { showToast(UI.POST_TITLE_REQUIRED, 'error'); return; }
  if (!content) { showToast(UI.FEEDBACK_EMPTY, 'error'); return; }
  try {
    await api('/api/feedbacks', { method: 'POST', body: { kind: feedbackKind, title, content } });
    closeModal();
    showToast(UI.FEEDBACK_SENT_TOAST);
  } catch (err) {
    showToast(err.message, 'error');
  }
}

// #165（v0.25.73）：我的投诉与反馈（M12 合并）——并行拉反馈 + 投诉两通道，同一浮窗展示。
// 类型 tag 走 DISP.feedbackKindName、投诉对象走 DISP.feedbackSubjectName（显示映射单源）；
// 反馈正文走 mdRender 排版；空态 UI.MY_FEEDBACK_EMPTY。
async function openMyFeedback() {
  if (!ensureAuth()) return;
  openModal({
    title: UI.MY_FEEDBACK_TITLE,
    cls: 'modal--wide',
    bodyCls: 'my-feedback-body',
    body: `<div class="my-feedback-list">${loaderHtml()}</div>`,
  });
  try {
    const [fb, cp] = await Promise.all([
      api('/api/feedbacks/mine', { method: 'GET' }),
      api('/api/complaints/mine', { method: 'GET' }), // M12：投诉独立通道并入同一浮窗
    ]);
    const feedbacks = fb.feedbacks || [];
    const complaints = cp.complaints || [];
    const bodyEl = document.querySelector('#modal-container .my-feedback-list');
    if (!bodyEl) return; // 浮窗已被关闭
    if (!feedbacks.length && !complaints.length) { bodyEl.innerHTML = `<div class="empty-state">${UI.MY_FEEDBACK_EMPTY}</div>`; return; }
    const fbHtml = feedbacks.map(f => {
      const resolved = f.status === STATUS.RESOLVED;
      const subject = DISP.feedbackSubjectName(f.subject);
      return `<div class="list-card glass my-feedback-card">
          <div class="list-card-header">
            <span class="list-card-title">${escHtml(f.title || '')}</span>
            <span class="feedback-tags">
              <span class="tag glass glass--solid ${DISP.feedbackKindCls(f.kind)}">${escHtml(DISP.feedbackKindName(f.kind))}</span>
              ${subject ? `<span class="tag glass glass--solid tag-ok">${escHtml(subject)}</span>` : ''}
              <span class="tag glass glass--solid ${resolved ? 'tag-ok' : 'tag-warn'}">${resolved ? UI.FEEDBACK_STATUS_RESOLVED : UI.FEEDBACK_STATUS_OPEN}</span>
            </span>
          </div>
          ${f.content ? `<div class="list-card-detail feedback-content md-preview md-preview--full">${mdRender(f.content) || ''}</div>` : ''}
          <div class="feedback-foot"><span class="list-card-meta">${fmtDateTime(f.created_at)}</span></div>
        </div>`;
    }).join('');
    // A1 审计（v0.25.104）：投诉卡渲染上收 complaintCardHtml（app-complaints）——与管理员处理页共用
    // 一份结构/状态 tag/对象类型映射（DISP.complaintTargetName 单源），本处仅换脚部时间戳。
    const cpHtml = complaints.map(c => complaintCardHtml(c, {
      foot: `<span class="list-card-meta">${fmtDateTime(c.created_at)}</span>`,
    })).join('');
    bodyEl.innerHTML = fbHtml + cpHtml;
  } catch (err) {
    const bodyEl = document.querySelector('#modal-container .my-feedback-list');
    if (bodyEl) bodyEl.innerHTML = `<div class="empty-state">${escHtml(err.message)}</div>`;
  }
}

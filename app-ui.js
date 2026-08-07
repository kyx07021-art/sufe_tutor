/**
 * 外观层（目标分层：外观层）—— 共享视觉组件与展示工具 单点
 *
 * 职责：HTML 转义/时间格式化（escHtml/fmtDateTime）、头像/加载件（renderAvatarHtml/loaderHtml）、
 *       弹窗壳（openModal/closeModal）、自定义下拉组件（DOM 构建，开闭在 app-anim）、
 *       大图查看器/图片压缩（openImageViewer/compressToDataURL）、确认/二次认证弹窗原语。
 * 领域视图（教师卡/需求卡/个人信息栏/表单模板等）随各自领域模块，本文件只放全站共享件。
 *
 * 约定：内联 onclick 里插值的字符串参数一律过 escHtml（防引号击穿）；
 *       展示时间一律过 fmtDateTime（后端 UTC → 本地时区，禁止裸 slice 原始串）；
 *       自定义下拉组件负责把原生 select 换装为触发按钮 + 玻璃面板（原生 id/value/onchange 语义保留）。
 */
const CARET_SVG = '<svg width="10" height="6" viewBox="0 0 10 6" fill="none" aria-hidden="true"><path d="M1 1l4 4 4-4" stroke="currentColor" stroke-width="1.6"/></svg>';

// ============================================================
// 展示工具
// ============================================================
/** HTML 转义：&<>"' 五字符（插值进 innerHTML 前必过） */
function escHtml(s) {
  return String(s ?? '').replace(/[&<>"']/g, c =>
    ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
}

/** 全站时间显示统一入口：后端存 UTC（'YYYY-MM-DD HH:MM:SS' 视作 UTC 或 ISO 串），转浏览器本地时区 */
function fmtDateTime(s) {
  if (!s) return '';
  const str = String(s);
  const d = new Date(/^\d{4}-\d{2}-\d{2} \d{2}:\d{2}/.test(str) ? str.replace(' ', 'T') + 'Z' : str);
  if (isNaN(d)) return escHtml(str.slice(0, 16)); // 解析失败：退回原串截断并转义
  const p = n => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())} ${p(d.getHours())}:${p(d.getMinutes())}`;
}

// ============================================================
// 头像组件（全站共用）：圆形，上传图片则居中裁切展示，未上传 = id 首字符 + 米色底。
// profileUserId 有值 → 头像成为个人信息右栏入口（聚焦动效，stopPropagation 防穿透父级点击）
// ============================================================
function renderAvatarHtml(avatar, name, cls, profileUserId) {
  const inner = avatar
    ? `<img src="${escHtml(avatar)}" alt="" loading="lazy">`
    : escHtml((name || '?').charAt(0).toUpperCase());
  const span = `<span class="avatar glass ${cls}${profileUserId ? ' avatar--link' : ''}"${avatar ? '' : ' aria-hidden="true"'}>${inner}</span>`;
  if (!profileUserId) return span;
  return `<span class="avatar-btn" role="button" tabindex="0" title="${UI.PROFILE_PANEL_TITLE}" onclick="event.stopPropagation();openProfilePanel(${profileUserId})">${span}</span>`;
}

/** 加载中组件（全站统一入口）：三根有规律伸缩的纵向柱体。size='sm' 用于按钮/行内，默认大号整块占位 */
function loaderHtml(size) {
  const cls = size === 'sm' ? 'spinner' : 'loader';
  return `<span class="${cls}" role="status" aria-label="${UI.LOADING}"><i></i><i></i><i></i></span>`;
}

// ============================================================
// 统一下拉组件：替换原生 <select> 的丑弹层。
// 透明触发器 + v 形箭头（开合翻转），选项面板白底细边、选中项墨色实填，
// 原生 select 隐藏保留（id/value/onchange 语义不变，点选项后派发 change）。
// 开合状态与 fixed 定位在 app-anim.js；本文件只管 DOM 构建与文字同步
// ============================================================
function initCustomSelects(root) {
  (root || document).querySelectorAll('select.form-select, select.filter-select').forEach(sel => {
    if (sel.dataset.customized) { buildCustomSelectPanel(sel); return; } // 已包装：仅重建选项
    sel.dataset.customized = '1';
    const wrap = document.createElement('div');
    wrap.className = 'custom-select';
    sel.insertAdjacentElement('afterend', wrap);
    wrap.appendChild(sel); // select 移入包装层，id 全局仍可寻址
    sel.classList.add('hidden');
    const trigger = document.createElement('button');
    trigger.type = 'button';
    trigger.className = 'custom-select-trigger';
    trigger.setAttribute('onclick', 'toggleCustomSelect(this.closest(".custom-select"))');
    trigger.innerHTML = `<span class="custom-select-text"></span><span class="drop-caret">${CARET_SVG}</span>`;
    const panel = document.createElement('div');
    panel.className = 'custom-select-panel glass glass--float'; // 挂 body：脱离玻璃祖先 isolation 堆叠上下文
    panel._wrap = wrap; // 选项点击经面板回找容器（面板已不在 wrap 内）
    wrap._customPanel = panel;
    document.body.appendChild(panel);
    wrap.append(trigger);
    buildCustomSelectPanel(sel);
    // 选项被动态重填（省份/年级等 innerHTML 重写）时自动重建面板
    new MutationObserver(() => buildCustomSelectPanel(sel)).observe(sel, { childList: true });
  });
}

function buildCustomSelectPanel(sel) {
  const wrap = sel.closest('.custom-select');
  if (!wrap) return;
  const panel = wrap._customPanel;
  if (!panel) return;
  // 选项放透明滚动层：玻璃体在面板元素上（磨砂生效），滚动通道纯透明无衬底——字透在玻璃上滚
  panel.innerHTML = `<div class="custom-select-list">${[...sel.options].map(o =>
    `<button type="button" class="custom-option${o.value === sel.value ? ' selected' : ''}" data-value="${escHtml(o.value)}">${escHtml(o.textContent)}</button>`).join('')}</div>`;
  syncCustomSelectText(sel);
}

function syncCustomSelectText(sel) {
  const wrap = sel.closest('.custom-select');
  if (!wrap) return;
  const text = wrap.querySelector('.custom-select-text');
  const o = sel.options[sel.selectedIndex];
  text.textContent = o ? o.textContent : '';
  text.classList.toggle('custom-select-empty', !sel.value);
  const panel = wrap._customPanel;
  if (panel) panel.querySelectorAll('.custom-option').forEach(b => b.classList.toggle('selected', b.dataset.value === sel.value));
}

// 兜底自愈：任何动态插入的 select 自动包装为自定义下拉（防移动端弹出原生选择器），
// 只处理尚未包装的，避免重复构建干扰已打开的面板
const selectSweepObserver = new MutationObserver(() => {
  document.querySelectorAll('select.form-select:not([data-customized]), select.filter-select:not([data-customized])')
    .forEach(sel => initCustomSelects(sel.closest('.modal') || sel.parentElement));
});
selectSweepObserver.observe(document.documentElement, { childList: true, subtree: true });

// ============================================================
// 弹窗壳单源：overlay + modal + header + body（+ 可选 footer）。
// 渲染结构与原手写模板逐字节一致——title 传 null 则无头栏（image-viewer 等）；
// closable 控制点遮罩关闭；cls/style 透传自定义类与内联样式；bodyCls 透传 body 类。
// 开合动画在 CSS（modal-in），JS 只增删 #modal-container 内容
// ============================================================
function openModal({ title, titleId = '', body = '', footer = '', closable = true, cls = '', style = '', bodyCls = '' } = {}) {
  const clickable = closable ? ' onclick="if(event.target===this)closeModal()"' : '';
  const header = title != null
    ? `<div class="modal-header glass"><h2${titleId ? ` id="${titleId}"` : ''}>${title}</h2><button type="button" class="btn btn-ghost btn-icon glass glass--pressable" aria-label="${UI.BTN_CLOSE}" onclick="closeModal()">✕</button></div>`
    : '';
  const clsAttr = cls ? ` ${cls}` : '';
  const styleAttr = style ? ` style="${style}"` : '';
  const bodyClsAttr = bodyCls ? ` ${bodyCls}` : '';
  document.getElementById('modal-container').innerHTML = `<div class="modal-overlay"${clickable}>
    <div class="modal glass glass--float${clsAttr}"${styleAttr}>
      ${header}
      <div class="modal-body${bodyClsAttr}">
        ${body}
        ${footer ? `<div class="modal-footer">${footer}</div>` : ''}
      </div>
    </div>
  </div>`;
}
function closeModal() { document.getElementById('modal-container').innerHTML = ''; }

// ============================================================
// 图片压缩通用件：读文件 → canvas 缩放（square=居中取最大内切正方形 / 否则最长边等比缩放）→ JPEG dataURL。
// 头像（AVATAR_SIDE 方）与学信网截图（CREDENTIAL_SIDE 最长边）共用
// ============================================================
function compressToDataURL(file, maxSide, quality, square) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onerror = () => reject(new Error(UI.CREDENTIAL_PICK_HINT));
    reader.onload = () => {
      const img = new Image();
      img.onerror = () => reject(new Error(UI.CREDENTIAL_PICK_HINT));
      img.onload = () => {
        let sx = 0, sy = 0, sw = img.width, sh = img.height, w, h;
        if (square) { const side = Math.min(sw, sh); sx = (sw - side) / 2; sy = (sh - side) / 2; sw = sh = side; w = h = maxSide; }
        else { const k = Math.min(1, maxSide / Math.max(sw, sh)); w = Math.round(sw * k); h = Math.round(sh * k); }
        const cv = document.createElement('canvas');
        cv.width = w; cv.height = h;
        cv.getContext('2d').drawImage(img, sx, sy, sw, sh, 0, 0, w, h);
        resolve(cv.toDataURL('image/jpeg', quality));
      };
      img.src = reader.result;
    };
    reader.readAsDataURL(file);
  });
}

/** 通用大图查看器（聊天图片放大 / 学信网截图预览共用；点空白关闭） */
function openImageViewer(src) {
  openModal({
    title: null,
    cls: 'image-viewer-modal',
    body: `<img src="${escHtml(src)}" alt="">`,
  });
}

// 图片加载失败统一兜底（capture 捕获全部 img error）：头像/缩略图/聊天图/预览图破碎不显示裂图
// （网络断线或源被删时静默隐藏，不弹错不打断页面）。网络错误捕获环节 4/4
document.addEventListener('error', e => {
  const t = e.target;
  if (t && t.tagName === 'IMG' && t.closest &&
      (t.closest('.avatar, .image-viewer-modal, .chat-bubble, .md-preview, .post-card, .conv-item'))) {
    t.style.visibility = 'hidden';
  }
}, true);

// ============================================================
// 等第 pill 单选（全站共享：教师档案/学生成绩/高考赋分组件均用 .grade-option，选中互斥）
// ============================================================
function pickGrade(el) {
  const group = el.closest('.grade-selector');
  if (!group) return;
  group.querySelectorAll('.grade-option').forEach(o => o.classList.remove('selected'));
  el.classList.add('selected');
}

// ============================================================
// 确认/二次认证弹窗原语（全站禁止浏览器原生 confirm）
// ============================================================
let pendingConfirmAction = null;
let reAuthAction = null;

/** 通用二次确认弹窗：message + 确认/取消（动作闭包，禁字符串拼装 onConfirm） */
function openConfirmModal(message, action) {
  pendingConfirmAction = action;
  openModal({
    title: null,
    style: `max-width:${CONFIG.MODAL_W_CONFIRM};`,
    body: `<p style="margin-bottom:16px;">${message}</p>`,
    footer: `<button type="button" class="btn btn-outline glass glass--pressable" onclick="closeModal()">${UI.BTN_CANCEL}</button>
          <button type="button" class="btn glass glass--pressable" onclick="runPendingConfirm()">${UI.BTN_CONFIRM}</button>`,
  });
}
function runPendingConfirm() {
  closeModal();
  const action = pendingConfirmAction;
  pendingConfirmAction = null;
  if (action) action();
}

/** 通用危险操作二次确认：title/正文/确认动作（onConfirm 由调用方以数字 id 拼装全局函数调用串） */
function confirmDanger(title, text, onConfirm) {
  openModal({
    title,
    style: `max-width:${CONFIG.MODAL_W_CONFIRM};`,
    body: `<p class="text-sm" style="color:var(--ink-3);">${text}</p>`,
    footer: `<button type="button" class="btn btn-outline glass glass--pressable" onclick="closeModal()">${UI.BTN_CANCEL}</button>
          <button type="button" class="btn glass glass--pressable" onclick="${onConfirm}">${UI.BTN_CONFIRM}</button>`,
  });
}

/**
 * 危险操作二次认证弹窗（网安报告 F-05）：确认文案 + 当前密码输入 → /api/auth/re-auth 换一次性
 * capToken（5 分钟）→ 执行动作。密码错（403）就地提示，不踢登录（api() 对 401 才弹登录页）
 */
function reAuthModal(message, action) {
  reAuthAction = action;
  openModal({
    title: null,
    style: `max-width:${CONFIG.MODAL_W_CONFIRM};`,
    body: `<p style="margin-bottom:14px;">${message}</p>
      <div class="form-group" style="border:none;">
        <label class="form-label">${UI.REAUTH_PASSWORD_LABEL} <span class="req">*</span></label>
        <input type="password" class="form-input" id="reauth-password" placeholder="${UI.REAUTH_PASSWORD_HINT}" autocomplete="current-password" onkeydown="if(event.key==='Enter')runReAuth()">
        <p class="form-hint" id="reauth-err" style="color:var(--danger);display:none;"></p>
      </div>`,
    footer: `<button type="button" class="btn btn-outline glass glass--pressable" onclick="closeModal()">${UI.BTN_CANCEL}</button>
      <button type="button" class="btn glass glass--pressable" onclick="runReAuth()">${UI.BTN_CONFIRM}</button>`,
  });
  setTimeout(() => { const i = document.getElementById('reauth-password'); if (i) i.focus(); }, CONFIG.REAUTH_FOCUS_MS);
}
async function runReAuth() {
  const input = document.getElementById('reauth-password');
  const errEl = document.getElementById('reauth-err');
  if (!input || !errEl) return;
  const password = input.value;
  if (!password) { errEl.textContent = UI.REAUTH_PASSWORD_HINT; errEl.style.display = 'block'; input.focus(); return; }
  try {
    const r = await api('/api/auth/re-auth', { method: 'POST', body: { password } });
    const action = reAuthAction;
    reAuthAction = null;
    closeModal();
    if (action) await action(r.capToken);
  } catch (err) {
    errEl.textContent = err.message;
    errEl.style.display = 'block';
    input.value = '';
    input.focus();
  }
}

// 登出复位：确认类弹窗的挂起动作一并清（防上一账户的挂起确认被新账户触发）
registerLogoutReset(() => { pendingConfirmAction = null; reAuthAction = null; });

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

/**
 * 转义「嵌入双引号 HTML 属性内的单引号 JS 字符串字面量」：onclick="fn('${escJsStr(v)}')"。
 * 注意不能复用 escHtml——HTML 解析属性时会把 &amp;#39; 等实体解码回原字符，值含 ' 时 onclick 的
 * JS 字符串即被截断（SyntaxError）。本函数按双层上下文分别转义：\\ 与 ' 走 JS 字符串转义，
 * & 与 " 走 HTML 属性实体（" 不转义会提前终结双引号属性）。两者叠加后任意字符值恒安全。
 */
function escJsStr(v) {
  return String(v ?? '')
    .replace(/\\/g, '\\\\')
    .replace(/'/g, "\\'")
    .replace(/[&"]/g, c => ({ '&': '&amp;', '"': '&quot;' }[c]));
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
  (root || document).querySelectorAll('select.form-select, select.filter-select, select.time-pick-select').forEach(sel => {
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
    if (sel.classList.contains('time-pick-select')) panel.classList.add('time-pick-panel'); // 整点面板：定宽类（面板挂 body，后代选择器够不着）
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
  document.querySelectorAll('select.form-select:not([data-customized]), select.filter-select:not([data-customized]), select.time-pick-select:not([data-customized])')
    .forEach(sel => initCustomSelects(sel.closest('.modal') || sel.parentElement));
});
selectSweepObserver.observe(document.documentElement, { childList: true, subtree: true });

// ============================================================
// 结构化时间组件（v0.25.0 需求一）：期望开课 / 可授课时间段
// 纵向多条组件（无分隔线、组件间空几 px 缝隙），行内 = 星期下拉 + 起止时间栏 + 删除按钮；
// 容器底部「+ 新建时间段」行在流内自然落位（新增组件插到它前面，它即闪现到新组件正下方）。
// 时间栏 = 文本框 + 内部靠右小 v（整点下拉 00:00~23:00）+ 严格编辑限制：
//   冒号两侧是两个独立数字框（天然只能拉选一边，无法整段拉选）；禁黏贴/禁 delete/backspace/
//   禁非数字、最多两位、左≤23 右≤59（输入拦截 + blur 钳制双保险）。
// 存储格式（不拟合当前周制，未来扩展 type）：[{type:'week',dow:1..7,start:'HH:MM',end:'HH:MM'}]
// 接口（全局函数，内联事件可直接引用）：renderTimeSlotContainerHtml / addTimeSlot /
//   removeTimeSlot / collectTimeSlots / validateTimeSlots / prefillTimeSlots
// ============================================================

/** 一条时间组件行 HTML（slot 缺省 = 空组件；各子件均无 id，按容器内 class 寻址，多容器共存不冲突） */
function renderTimeSlotRowHtml(slot) {
  slot = slot || {};
  const dow = slot.dow || '';
  const dowOpts = WEEKDAYS.map(w => `<option value="${w.id}"${w.id === dow ? ' selected' : ''}>${w.name}</option>`).join('');
  const sh = typeof slot.start === 'string' && slot.start.includes(':') ? slot.start.split(':')[0] : '';
  const sm = typeof slot.start === 'string' && slot.start.includes(':') ? slot.start.split(':')[1] : '';
  const eh = typeof slot.end === 'string' && slot.end.includes(':') ? slot.end.split(':')[0] : '';
  const em = typeof slot.end === 'string' && slot.end.includes(':') ? slot.end.split(':')[1] : '';
  return `<select class="form-select slot-dow"><option value="">${UI.SLOT_DOW_PLACEHOLDER}</option>${dowOpts}</select>
    <div class="time-range">
      ${timeFieldHtml('start', sh, sm)}
      <span class="time-slot-tilde">~</span>
      ${timeFieldHtml('end', eh, em)}
    </div>
    <button type="button" class="time-slot-del" aria-label="${UI.TIME_DEL_ARIA}" title="${UI.TIME_DEL_ARIA}" onclick="removeTimeSlot(this)">✕</button>`;
}

/** 单个时间栏（role: start|end）：文本框 + 内部靠右小 v；灰字占位由 .time-field-ghost 承载 */
function timeFieldHtml(role, hh, mm) {
  const ghost = role === 'start' ? UI.SLOT_TIME_START_GHOST : UI.SLOT_TIME_END_GHOST;
  const filled = (hh || mm) ? ' has-value' : '';
  const hourOptions = Array.from({ length: 24 }, (_, i) => `${String(i).padStart(2, '0')}:00`)
    .map(t => `<option value="${t}"${t === (hh ? `${hh}:00` : '') ? ' selected' : ''}>${t}</option>`).join('');
  const guarded = 'onkeydown="guardTimeKey(event)" onbeforeinput="guardTimeBeforeInput(event)" oninput="onTimeInput(this)" onblur="clampTime(this)" onpaste="return false" ondrop="return false"';
  return `<div class="time-field${filled}" data-time-role="${role}">
    <span class="time-field-ghost">${ghost}</span>
    <input type="text" class="slot-time-hh" inputmode="numeric" maxlength="2" value="${escHtml(hh)}" aria-label="时" autocomplete="off" spellcheck="false" ${guarded}>
    <span class="time-colon">:</span>
    <input type="text" class="slot-time-mm" inputmode="numeric" maxlength="2" value="${escHtml(mm)}" aria-label="分" autocomplete="off" spellcheck="false" ${guarded}>
    <div class="custom-select time-picker">
      <select class="time-pick-select" onchange="applyTimePick(this)" aria-label="${UI.TIME_PICKER_ARIA}">${hourOptions}</select>
    </div>
  </div>`;
}

/** 时间组件容器 HTML（默认空：仅「+ 新建时间段」行，落位于首条组件将处的位置） */
function renderTimeSlotContainerHtml() {
  return `<div class="time-slots-add">
    <button type="button" class="time-add-btn" aria-label="${UI.SLOT_ADD_LABEL}" onclick="addTimeSlot(this)">+</button>
    <span class="time-add-label">${UI.SLOT_ADD_LABEL}</span>
  </div>`;
}

/** 新建时间段：往容器插入一条空组件，+ 行自然下移到它正下方 */
function addTimeSlot(btn) {
  const container = btn.closest('.time-slots');
  if (!container) return;
  const count = container.querySelectorAll('.time-slot').length;
  if (count >= CONFIG.TIME_SLOTS_MAX) return; // 达上限：不再新建（按钮已置灰）
  const row = document.createElement('div');
  row.className = 'time-slot';
  row.innerHTML = renderTimeSlotRowHtml(null);
  container.insertBefore(row, container.querySelector('.time-slots-add'));
  if (count + 1 >= CONFIG.TIME_SLOTS_MAX) setAddDisabled(container, true);
}

/** 删除该时间段：行移除，下方组件（含 + 行）自然上移一格 */
function removeTimeSlot(btn) {
  const row = btn.closest('.time-slot');
  if (!row) return;
  const container = row.closest('.time-slots');
  row.remove();
  if (container) setAddDisabled(container, false);
}

function setAddDisabled(container, disabled) {
  const b = container.querySelector('.time-add-btn');
  if (b) b.disabled = disabled;
}

/** 整点下拉选中：写回对应时间栏（整点 → 分位补 00） */
function applyTimePick(sel) {
  const field = sel.closest('.time-field');
  if (!field || !sel.value) return;
  const parts = sel.value.split(':');
  const hhInp = field.querySelector('.slot-time-hh');
  const mmInp = field.querySelector('.slot-time-mm');
  if (hhInp) hhInp.value = parts[0] || '';
  if (mmInp) mmInp.value = parts[1] || '00';
  refreshTimeField(field);
}

// --- 时间栏编辑限制（只许老老实实编辑时间） ---

/** 键盘拦截：允许数字、导航键、复制/全选（Ctrl/Cmd+A/C）、自由逐位删除（Backspace/Delete）；
 *  拦截其余组合键（含 Ctrl+V/X）与单字符非数字插入。
 *  v0.25.3：放开 Backspace/Delete（用户指令）——之前「两位数字不能删、又不让打第三字」没法自行改写；
 *  冒号是独立元素（.time-colon），删数字天然碰不到它，无需再把删除当风险拦掉。 */
function guardTimeKey(e) {
  if (e.key === 'Backspace' || e.key === 'Delete') return; // 自由删改本侧数字（含 Ctrl+Backspace 清空）
  if (e.ctrlKey || e.metaKey || e.altKey) {
    const k = (e.key || '').toLowerCase();
    if (k === 'a' || k === 'c') return; // 复制/全选（只作用于冒号单侧，无碍整体约束）
    e.preventDefault(); return;        // 其余组合键（含 Ctrl+V/X）一律拦截
  }
  if (['Tab', 'Enter', 'Escape', 'ArrowLeft', 'ArrowRight', 'ArrowUp', 'ArrowDown', 'Home', 'End'].includes(e.key)) return;
  if (e.key.length === 1 && !/[0-9]/.test(e.key)) e.preventDefault(); // 单字符非数字拦截
}

/** beforeinput 兜底（IME/移动端虚拟键盘不走 keydown）：拦截黏贴/拖入与非数字插入；删除放行（同 keydown 口径） */
function guardTimeBeforeInput(e) {
  const t = e.inputType || '';
  if (t === 'insertFromPaste' || t === 'insertFromDrop') { e.preventDefault(); return; }
  if (t === 'insertText' && e.data != null && !/^[0-9]+$/.test(e.data)) e.preventDefault(); // 多数字符串由 oninput 裁剪
}

/** input 兜底：只留数字、至多两位（IME/移动端最终防线） */
function onTimeInput(inp) {
  const v = inp.value.replace(/[^0-9]/g, '').slice(0, 2);
  if (inp.value !== v) inp.value = v;
  refreshTimeField(inp.closest('.time-field'));
}

/** blur 钳制：补零到两位 + 范围钳制（时≤23、分≤59） */
function clampTime(inp) {
  const isHh = inp.classList.contains('slot-time-hh');
  let v = inp.value.replace(/[^0-9]/g, '');
  if (v !== '') {
    let n = Math.min(isHh ? 23 : 59, Math.max(0, +v));
    inp.value = String(n).padStart(2, '0');
  }
  refreshTimeField(inp.closest('.time-field'));
}

function refreshTimeField(field) {
  if (!field) return;
  const hh = (field.querySelector('.slot-time-hh') || {}).value || '';
  const mm = (field.querySelector('.slot-time-mm') || {}).value || '';
  field.classList.toggle('has-value', !!(hh || mm));
}

/** 读时间栏：全空 → ''；半填 → null；完整 → 'HH:MM'（补零） */
function readTimeField(field) {
  if (!field) return '';
  const hh = (field.querySelector('.slot-time-hh') || {}).value || '';
  const mm = (field.querySelector('.slot-time-mm') || {}).value || '';
  if (!hh && !mm) return '';
  if (!hh || !mm) return null;
  return `${hh.padStart(2, '0')}:${mm.padStart(2, '0')}`;
}

/** 校验容器：返回错误文案，'' = 通过（全空行跳过；半填/缺起止/结束早于开始均报错） */
function validateTimeSlots(container) {
  if (!container) return '';
  for (const row of container.querySelectorAll('.time-slot')) {
    const dow = row.querySelector('.slot-dow').value;
    const start = readTimeField(row.querySelector('.time-field[data-time-role="start"]'));
    const end = readTimeField(row.querySelector('.time-field[data-time-role="end"]'));
    if (!dow && !start && !end) continue; // 全空行：忽略（纯新增的空脚手架）
    if (!dow || !start || !end) return UI.VALIDATE_TIME_SLOT_INCOMPLETE;
    if (start >= end) return UI.VALIDATE_TIME_SLOT_RANGE;
  }
  return '';
}

/** 收集容器 → [{type:'week',dow,start,end}]（空行/不完整行剔除；调用方应先过 validateTimeSlots） */
function collectTimeSlots(container) {
  const out = [];
  if (!container) return out;
  container.querySelectorAll('.time-slot').forEach(row => {
    const dow = row.querySelector('.slot-dow').value;
    const start = readTimeField(row.querySelector('.time-field[data-time-role="start"]'));
    const end = readTimeField(row.querySelector('.time-field[data-time-role="end"]'));
    if (!dow || !start || !end) return;
    out.push({ type: 'week', dow: +dow, start, end });
  });
  return out;
}

/** 回填容器：按存储 JSON（旧纯文本原样忽略）重建组件行 */
function prefillTimeSlots(container, raw) {
  if (!container) return;
  let slots = [];
  if (raw) {
    try { const p = JSON.parse(raw); if (Array.isArray(p)) slots = p.filter(s => s && typeof s === 'object' && s.type === 'week'); } catch { slots = []; }
  }
  slots.forEach(s => {
    const row = document.createElement('div');
    row.className = 'time-slot';
    row.innerHTML = renderTimeSlotRowHtml({ dow: s.dow, start: s.start, end: s.end });
    container.insertBefore(row, container.querySelector('.time-slots-add'));
  });
  setAddDisabled(container, slots.length >= CONFIG.TIME_SLOTS_MAX);
}

// ============================================================
// 弹窗壳单源：overlay + modal + header + body（+ 可选 footer）。
// 渲染结构与原手写模板逐字节一致——title 传 null 则无头栏（image-viewer 等）；
// closable 控制点遮罩关闭；cls/style 透传自定义类与内联样式；bodyCls 透传 body 类。
// 开合动画在 CSS（modal-in），JS 只增删 #modal-container 内容
// ============================================================
function openModal({ title, titleId = '', body = '', footer = '', closable = true, cls = '', style = '', bodyCls = '' } = {}) {
  const clickable = closable ? ' onclick="if(event.target===this)closeModal()"' : '';
  // v0.25.10（反馈 #82）：去独立玻璃表头——header 不再独占玻璃层/分隔线，
  // 标题直接坐弹窗顶端（毛玻璃归属整窗 .modal，表头只是自然流首行），整页滚动在 .modal-overlay
  const header = title != null
    ? `<div class="modal-header"><h2${titleId ? ` id="${titleId}"` : ''}>${title}</h2><button type="button" class="btn btn-ghost btn-icon glass glass--pressable" aria-label="${UI.BTN_CLOSE}" onclick="closeModal()">✕</button></div>`
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

// tag-pick 多选 pill 通用切换（R2-3 性格关键词 / R2-4 非学科项目共用）：
// 复用勾选框语义但不显示勾选框——渲染成 pill 按钮，点击切换 .selected（选中态紫色）；
// 超出 max 拒绝并 toast 提示；max<=0 = 不设上限（非学科项目用）
function toggleTagPick(el, containerId, max) {
  const container = document.getElementById(containerId);
  if (!container) return;
  const nowSelected = !el.classList.contains('selected');
  if (nowSelected && max && max > 0) {
    const count = container.querySelectorAll('.tag-pick.selected').length;
    if (count >= max) {
      showToast((UI.TAG_PICK_LIMIT || '最多选 {max} 个').replace('{max}', max));
      return;
    }
  }
  el.classList.toggle('selected', nowSelected);
}

// ============================================================
// 确认/二次认证弹窗原语（全站禁止浏览器原生 confirm）。
// v0.25.10（反馈 #82）：原 openConfirmModal / confirmDanger / reAuthModal 三套
// 自建弹窗 + app-posts 自写 postConfirmDelete 是四处造轮子，合并为单一 confirm()：
//   confirm({ title, message, needReAuth, okText, onConfirm })
//   - needReAuth=false：普通二次确认；动作必须传闭包 onConfirm（禁字符串拼装）
//   - needReAuth=true ：危险操作二次认证（网安 F-05）——当前密码 → /api/auth/re-auth
//     换一次性 capToken（5 分钟）→ onConfirm(capToken)；密码错（403）就地提示不踢登录
//   - okText 覆盖确认按钮文案（默认 UI.BTN_CONFIRM）
// 视觉统一走 openModal：表头放弹窗顶端、整页滚动
// ============================================================
let pendingConfirmAction = null;
let reAuthAction = null;

function confirm({ title = null, message = '', needReAuth = false, okText = UI.BTN_CONFIRM, onConfirm } = {}) {
  const footer = `<button type="button" class="btn btn-outline glass glass--pressable" onclick="closeModal()">${UI.BTN_CANCEL}</button>
      <button type="button" class="btn glass glass--pressable" onclick="${needReAuth ? 'runReAuth()' : 'runPendingConfirm()'}">${okText}</button>`;
  const body = needReAuth
    ? `<p class="confirm-msg">${message}</p>
      <div class="form-group" style="border:none;">
        <label class="form-label">${UI.REAUTH_PASSWORD_LABEL} <span class="req">*</span></label>
        <input type="password" class="form-input" id="reauth-password" placeholder="${UI.REAUTH_PASSWORD_HINT}" autocomplete="current-password" onkeydown="if(event.key==='Enter')runReAuth()">
        <p class="form-hint" id="reauth-err" style="color:var(--danger);display:none;"></p>
      </div>`
    : `<p class="confirm-msg">${message}</p>`;
  if (needReAuth) reAuthAction = onConfirm; else pendingConfirmAction = onConfirm;
  openModal({
    title,
    style: `max-width:${CONFIG.MODAL_W_CONFIRM};`,
    body,
    footer,
  });
  if (needReAuth) setTimeout(() => { const i = document.getElementById('reauth-password'); if (i) i.focus(); }, CONFIG.REAUTH_FOCUS_MS);
}
function runPendingConfirm() {
  closeModal();
  const action = pendingConfirmAction;
  pendingConfirmAction = null;
  if (action) action();
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

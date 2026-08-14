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
// #175：轻量 markdown 渲染——用户协议/政策浮窗在登录前
// （领域脚本未加载）就要用，故从领域层 app-posts 上移到共享层；帖子/详情预览同源复用。
function mdRender(src) {
  // 安全铁律：先 escHtml 全转义，后续一切正则只作用在转义串上、只产出白名单固定标签，
  // 用户原文里的任何 HTML/事件属性都已被转义为纯文本，天然免疫 XSS（escHtml 转义 < > & " '）。
  const escaped = escHtml(String(src ?? ''));
  const IMG_OK = /^(https?:\/\/|data:image\/(?!svg))/i; // 外链/位图放行；svg 可内嵌脚本，一律不渲染
  // #162：链接白名单 http/https 内联在下方链接正则（不匹配即原样文本，无需单独 const）
  // 行内：代码 span 先抽离占位（防内部 ** 粗体/链接误染），处理完图/链/粗体再还原
  const inline = s => {
    const codes = [];
    let t = s.replace(/`([^`]+)`/g, (m, c) => { codes.push(c); return `\u0000${codes.length - 1}\u0000`; });
    t = t
      .replace(/!\[([^\]]*)\]\(([^)]*)\)/g, (m, alt, url) =>
        (IMG_OK.test(url) && !/\s/.test(url))
          ? `<img src="${url}" alt="${alt}">`
          : `<span class="md-img-blocked">${UI.POST_IMG_BLOCKED}</span>`)
      .replace(/\[([^\]]+)\]\((https?:\/\/[^)\s]+)\)/g, // #162：链接仅命中 http/https（javascript:/data: 不匹配即原样文本）
        '<a href="$2" target="_blank" rel="noopener noreferrer">$1</a>')
      .replace(/\*\*([^*]+)\*\*/g, '<strong>$1</strong>');
    return t.replace(/\u0000(\d+)\u0000/g, (m, n) => `<code>${codes[+n]}</code>`);
  };
  // #162：块级分组——列表/引用需连续多行聚合（escHtml 把 > 转成 &gt;，引用检测匹配转义形态）
  const isUl = l => /^[-*] +/.test(l);
  const isOl = l => /^\d+\. +/.test(l);
  const isQt = l => /^&gt; ?/.test(l);
  const lines = escaped.split('\n');
  const out = [];
  let i = 0;
  while (i < lines.length) {
    const line = lines[i];
    if (!line.trim()) { i++; continue; }
    if (isUl(line)) {
      const items = [];
      while (i < lines.length && isUl(lines[i])) { items.push(lines[i].replace(/^[-*] +/, '')); i++; }
      out.push(`<ul>${items.map(x => `<li>${inline(x)}</li>`).join('')}</ul>`);
      continue;
    }
    if (isOl(line)) {
      const items = [];
      while (i < lines.length && isOl(lines[i])) { items.push(lines[i].replace(/^\d+\. +/, '')); i++; }
      out.push(`<ol>${items.map(x => `<li>${inline(x)}</li>`).join('')}</ol>`);
      continue;
    }
    if (isQt(line)) {
      const parts = [];
      while (i < lines.length && isQt(lines[i])) {
        const c = lines[i].replace(/^&gt; ?/, '');
        if (c.trim()) parts.push(`<p>${inline(c)}</p>`);
        i++;
      }
      out.push(`<blockquote>${parts.join('')}</blockquote>`);
      continue;
    }
    const head = line.match(/^(#{1,6})\s+(.*)$/); // v0.24.0：1~6 级标题全支持
    if (head) { out.push(`<h${head[1].length}>${inline(head[2])}</h${head[1].length}>`); i++; }
    else { out.push(`<p>${inline(line)}</p>`); i++; }
  }
  return out.join('');
}

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

/** 仅日期（YYYY-MM-DD）：需求卡片等「日内时间无意义」场景 */
function fmtDate(s) {
  if (!s) return '';
  const str = String(s);
  const d = new Date(/^\d{4}-\d{2}-\d{2}/.test(str) ? str.replace(' ', 'T') + 'Z' : str);
  if (isNaN(d)) return escHtml(str.slice(0, 10));
  const p = n => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`;
}

// ============================================================
// 头像组件（全站共用）：圆形，上传图片则居中裁切展示，未上传 = id 首字符 + 米色底。
// profileUserId 有值 → 头像成为个人信息右栏入口（聚焦动效，stopPropagation 防穿透父级点击）
// ============================================================
function renderAvatarHtml(avatar, name, cls, profileUserId) {
  const inner = avatar
    ? `<img src="${escHtml(avatar)}" alt="" loading="lazy">`
    : escHtml((name || '?').charAt(0).toUpperCase());
  // R13：无 profileUserId 的头像 = 纯装饰组件——恒 aria-hidden（惰性、不可聚焦、无交互），
  // 视觉/行为只随宿主（如教师卡整卡可点）；有 profileUserId 才成独立交互入口（avatar-btn）
  const decorative = !profileUserId;
  const span = `<span class="avatar glass ${cls}${profileUserId ? ' avatar--link' : ''}"${decorative ? ' aria-hidden="true"' : ''}>${inner}</span>`;
  if (decorative) return span;
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
    // P4（「所有本质上是按钮而非输入框的下拉栏组件都应该用按钮配置」）：
    // 按钮语境（筛选组/页头操作区）的下拉触发器接入标准按钮组件（.btn .btn-soft .glass .glass--pressable）——
    // 玻璃引擎消费标准按钮 token（透明磨砂透镜+弯月环+白洗 hover+涟漪），与并列按钮同族；
    // 表单/面板内下拉保持输入控件族。只设 --g-fill/--g-frost 引擎变量而不挂 .glass，引擎不消费
    // =观感仍是输入框（引擎变量必须配消费类才生效）。
    trigger.className = (sel.closest('.filter-group') || sel.closest('.page-header-actions'))
      ? 'custom-select-trigger btn btn-soft glass glass--pressable'
      : 'custom-select-trigger';
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
  // v0.25.94（用户反馈「无可用需求时下拉无提示文字、塌成细条」）：唯一选项为 disabled 时
  // selectedIndex=-1，读 options[-1] 得空 → 触发器无文字。回落 options[0]：空态灰字提示（
  // SIGNING_NO_DEMAND_HINT / CONTRACT_DEMANDS_EMPTY）仍显示，不再塌成无字细条。
  const o = sel.options[sel.selectedIndex] || sel.options[0] || null;
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
// 结构化时间组件：期望开课 / 可授课时间段
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

/** 单个时间栏（role: start|end）：文本框 + 内部靠右小 v；灰字占位由 .time-field-ghost 承载。
 *  v0.25.27 空栏冒号恒显：hh/冒号/mm 包进 .time-hms（relative 锚点），ghost 拆两半
 *  「开始|时间」以 flex 居中于 .time-hms——hh/mm 等宽对称，冒号恰在 .time-hms 中心，
 *  ghost 两半之间的间隙（style.css gap）正好落在冒号上，整体观感「开始:时间」零魔法偏移。
 *  （位置提示消失；改回恒显 + 灰字让位。）
 *  v0.25.53（需求四十五）：段输入改用底层原语 segInputAttrs（通用守卫 + data-* 段配置），
 *  DOM 类名/结构不变；冒号/整点下拉为时间专用件保留在本函数。 */
function timeFieldHtml(role, hh, mm) {
  const ghost = role === 'start' ? UI.SLOT_TIME_START_GHOST : UI.SLOT_TIME_END_GHOST;
  const filled = (hh || mm) ? ' has-value' : '';
  // 灰字占位拆两半（固定四字文案如「开始时间」→「开始」+「时间」，间隙留给冒号；half 取 ceil 防奇数）
  const half = Math.ceil(ghost.length / 2);
  const ghostHtml = `<span class="time-field-ghost"><span>${escHtml(ghost.slice(0, half))}</span><span>${escHtml(ghost.slice(half))}</span></span>`;
  const hourOptions = Array.from({ length: 24 }, (_, i) => `${String(i).padStart(2, '0')}:00`)
    .map(t => `<option value="${t}"${t === (hh ? `${hh}:00` : '') ? ' selected' : ''}>${t}</option>`).join('');
  const hhAttrs = segInputAttrs({ maxLen: 2, max: 23, min: 0, pad: 2, label: UI.SEG_HOUR_ARIA, cls: 'slot-time-hh', value: hh });
  const mmAttrs = segInputAttrs({ maxLen: 2, max: 59, min: 0, pad: 2, label: UI.SEG_MINUTE_ARIA, cls: 'slot-time-mm', value: mm });
  return `<div class="time-field${filled}" data-time-role="${role}">
    <div class="time-hms">
      ${ghostHtml}
      <input ${hhAttrs}>
      <span class="time-colon">:</span>
      <input ${mmAttrs}>
    </div>
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
  refreshSegmentField(field);
}

// ============================================================
// 底层数字段输入原语：时间(时:分) 与 日期(年-月-日) 同族共用。
// 由 guardTimeKey/onTimeInput/clampTime/refreshTimeField 泛化（改名）而来：段配置走元素 data-* 属性
// （data-maxlen/data-max/data-min/data-pad），守卫不再写死时间语义。冒号、整点下拉、时段校验等
// 时间专用件不并入（见 timeFieldHtml / validateTimeSlots）；日期特有件（真实日历校验）见段末。
// ============================================================

/** 单段输入框属性串（时间/日期两字段同用）：数字键盘 + 长度/范围/补零走 data-* + 三层防线内联守卫。
 *  spec: { maxLen, max, min, pad, label, cls, value, extra }——extra 覆盖 onblur（如日期日段日历校验） */
function segInputAttrs(spec) {
  return `type="text" class="seg-input ${spec.cls || ''}" inputmode="numeric" maxlength="${spec.maxLen}" value="${escHtml(spec.value || '')}" aria-label="${spec.label}" data-maxlen="${spec.maxLen}" data-max="${spec.max}" data-min="${spec.min || 0}" data-pad="${spec.pad || 2}" autocomplete="off" spellcheck="false" onkeydown="guardSegmentKey(event)" onbeforeinput="guardSegmentBeforeInput(event)" oninput="onSegmentInput(this)" onblur="${spec.extra || 'clampSegment(this)'}" onpaste="return false" ondrop="return false"`;
}

/** 键盘拦截：允许数字、导航键、复制/全选（Ctrl/Cmd+A/C）、自由逐位删除（Backspace/Delete）；
 *  拦截其余组合键（含 Ctrl+V/X）与单字符非数字插入。段无关（时间/日期同用）。
 *  v0.25.3：放开 Backspace/Delete（用户指令）——之前「两位数字不能删、又不让打第三字」没法自行改写；
 *  分隔符是独立元素，删数字天然碰不到它，无需再把删除当风险拦掉。 */
function guardSegmentKey(e) {
  if (e.key === 'Backspace' || e.key === 'Delete') return; // 自由删改本侧数字（含 Ctrl+Backspace 清空）
  if (e.ctrlKey || e.metaKey || e.altKey) {
    const k = (e.key || '').toLowerCase();
    if (k === 'a' || k === 'c') return; // 复制/全选（只作用于分隔符单侧，无碍整体约束）
    e.preventDefault(); return;        // 其余组合键（含 Ctrl+V/X）一律拦截
  }
  // ：左右键在段边界跨分隔符（:/~-）跳到相邻段——时间/日期多段组件常用导航
  const t = e.target;
  if (t && t.selectionStart != null) {
    if (e.key === 'ArrowLeft' && t.selectionStart === 0 && t.selectionEnd === 0) {
      const prev = segmentSibling(t, -1);
      if (prev) { e.preventDefault(); prev.focus(); placeCaret(prev, prev.value.length); }
      return;
    }
    if (e.key === 'ArrowRight' && t.selectionStart === t.value.length) {
      const next = segmentSibling(t, 1);
      if (next) { e.preventDefault(); next.focus(); placeCaret(next, 0); }
      return;
    }
  }
  if (['Tab', 'Enter', 'Escape', 'ArrowLeft', 'ArrowRight', 'ArrowUp', 'ArrowDown', 'Home', 'End'].includes(e.key)) return;
  if (e.key.length === 1 && !/[0-9]/.test(e.key)) e.preventDefault(); // 单字符非数字拦截
}

// R4：同 field 内相邻数字段（时↔分、月↔日、日↔年；跨过冒号/横杠分隔符）。
// 只在分隔符两侧的 .seg-input 间跳（时间栏 .time-hms / 日期栏 .seg-date 容器内），不越出时间栏。
// A1 审计：日期容器已随 M5 从 .seg-hms 改为 .seg-date——原选择器永为空，
// 日期三段左右键跨段导航静默失效（只剩时间栏有效，注释自称的「月↔日、日↔年」不成立），此处同步。
function segmentSibling(inp, dir) {
  const hms = inp.closest('.time-hms, .seg-date');
  if (!hms) return null;
  const segs = [...hms.querySelectorAll('.seg-input')];
  const idx = segs.indexOf(inp);
  return segs[idx + dir] || null;
}
function placeCaret(inp, pos) {
  try { inp.setSelectionRange(pos, pos); } catch { /* 部分环境不支持 setSelectionRange（早退） */ }
}

/** beforeinput 兜底（IME/移动端虚拟键盘不走 keydown）：拦截黏贴/拖入与非数字插入；删除放行（同 keydown 口径） */
function guardSegmentBeforeInput(e) {
  const t = e.inputType || '';
  if (t === 'insertFromPaste' || t === 'insertFromDrop') { e.preventDefault(); return; }
  if (t === 'insertText' && e.data != null && !/^[0-9]+$/.test(e.data)) e.preventDefault(); // 多数字符串由 oninput 裁剪
}

/** input 兜底：只留数字、按 data-maxlen 截位（IME/移动端最终防线；时间 2 位、日期 年4/月2/日2） */
function onSegmentInput(inp) {
  const len = +(inp.dataset.maxlen) || 2;
  const v = inp.value.replace(/[^0-9]/g, '').slice(0, len);
  if (inp.value !== v) inp.value = v;
  refreshSegmentField(inp.closest('.seg-date, .time-field'));
}

/** blur 钳制：按 data-max/data-min 范围 + data-pad 补零（时间 时≤23/分≤59；日期 年9999/月12/日31）。
 *  年份段由 clampYear 专用（不补零，见段末）；日段由 clampDateDay 追加真实月末钳制。 */
function clampSegment(inp) {
  const max = +(inp.dataset.max) || 9999;
  const min = +(inp.dataset.min) || 0;
  const pad = +(inp.dataset.pad) || 2;
  let v = inp.value.replace(/[^0-9]/g, '');
  if (v !== '') {
    let n = Math.min(max, Math.max(min, +v));
    inp.value = String(n).padStart(pad, '0');
  }
  refreshSegmentField(inp.closest('.seg-date, .time-field'));
}

/** 容器灰字显隐：任一段有值 → has-value（对应 ghost 渐隐） */
function refreshSegmentField(field) {
  if (!field) return;
  const filled = [...field.querySelectorAll('.seg-input')].some(i => i.value);
  field.classList.toggle('has-value', filled);
}

// --- 日期段（首次上课日期）扩展：真实日历校验（防 2/31、4/31 之类经服务端 regex 漏网入库） ---

/** 年份段 blur 钳制：只做范围（1-9999），不补零——年份无前导零语义（「25」不得变「0025」） */
function clampYear(inp) {
  let v = inp.value.replace(/[^0-9]/g, '');
  if (v !== '') {
    const n = Math.min(9999, Math.max(1, +v));
    inp.value = String(n);
  }
  refreshSegmentField(inp.closest('.seg-date, .time-field'));
}

/** 年月天数（new Date(y, m, 0) = 第 m 月的最后一天；闰年由 Date 内建处理） */
function daysInMonth(y, m) { return new Date(y, m, 0).getDate(); }

/** 日段 blur 钳制：先通用钳制（1-31），再按已填年/月钳到真实月末（2026-02-31 → 02-28） */
function clampDateDay(inp) {
  clampSegment(inp);
  const field = inp.closest('.seg-date, .time-field');
  if (!field || !inp.value) return;
  const year = +(field.querySelector('.seg-year').value || '0');
  const month = +(field.querySelector('.seg-month').value || '0');
  if (!year || !month) return; // 年月未填齐：日段暂按 data-max(31) 上限
  const dim = daysInMonth(year, month);
  const d = +inp.value;
  if (d > dim) { inp.value = String(dim).padStart(2, '0'); refreshSegmentField(field); }
}

/** 日期段容器 HTML（首次上课日期）：M5重做——三个独立输入框 + 单位后缀
 *  【】年【】月【】日（用户反馈旧版「长条玻璃面 + 居中 ghost 像能点但只能输 + 输入区集中在中间」）。
 *  value: 'YYYY-MM-DD' 或 ''。保留 .seg-input/.seg-year/.seg-month/.seg-day 类与 id
 *  （readDateField/clampDateDay 依赖），序列化契约 YYYY-MM-DD 不变。 */
function dateFieldHtml(value) {
  const [y, m, d] = (value || '').split('-');
  return `<div class="seg-date" id="contract-first-lesson-field">
    <span class="seg-part"><input ${segInputAttrs({ maxLen: 4, max: 9999, min: 1, pad: 4, label: UI.SEG_YEAR_ARIA, cls: 'seg-year', value: y, extra: 'clampYear(this)' })}><span class="seg-unit">${UI.SEG_YEAR_ARIA}</span></span>
    <span class="seg-part"><input ${segInputAttrs({ maxLen: 2, max: 12, min: 1, pad: 2, label: UI.SEG_MONTH_ARIA, cls: 'seg-month', value: m })}><span class="seg-unit">${UI.SEG_MONTH_ARIA}</span></span>
    <span class="seg-part"><input ${segInputAttrs({ maxLen: 2, max: 31, min: 1, pad: 2, label: UI.SEG_DAY_ARIA, cls: 'seg-day', value: d, extra: 'clampDateDay(this)' })}><span class="seg-unit">${UI.SEG_DAY_ARIA}</span></span>
  </div>`; // A1 审计：单位后缀复用 aria 常量单源（原硬编码 年/月/日）
}

/** 日期字段读：全空 → ''（= 由双方另行协商）；半填/年份不足四位 → null（调用方拦截）；
 *  完整 → 真实日历回验钳制后的 'YYYY-MM-DD'（如 2026-02-31 → 2026-02-28）。 */
function readDateField(field) {
  if (!field) return '';
  const segs = [...field.querySelectorAll('.seg-input')];
  const vals = segs.map(i => i.value);
  if (vals.every(v => !v)) return '';
  if (vals.some(v => !v)) return null;
  const yRaw = vals[0], mRaw = vals[1], dRaw = vals[2];
  if (yRaw.length < 4) return null; // 年份必须完整四位（拒绝「25 → 0025」的歧义）
  const y = Math.min(9999, Math.max(1, +yRaw));
  const m = Math.min(12, Math.max(1, +mRaw));
  const dim = daysInMonth(y, m);
  const d = Math.min(dim, Math.max(1, +dRaw));
  return `${String(y).padStart(4, '0')}-${String(m).padStart(2, '0')}-${String(d).padStart(2, '0')}`;
}

/** 读时间栏：全空 → ''；半填 → null；完整 → 'HH:MM'（补零 + 范围钳制）。
 *  v0.25.15 审计修复：此前不钳制——用户填 99:00 不触发 blur 直接提交时，validateTimeSlots 的
 *  start<end 串比会放行非法时间（99:00>18:00），落服务端才被 sanitizeTimeSlots 正则拒；现读时即钳
 *  （时≤23、分≤59，同 clampSegment blur 口径），前端拦截与收集值双一致。 */
function readTimeField(field) {
  if (!field) return '';
  const hhRaw = (field.querySelector('.slot-time-hh') || {}).value || '';
  const mmRaw = (field.querySelector('.slot-time-mm') || {}).value || '';
  if (!hhRaw && !mmRaw) return '';
  if (!hhRaw || !mmRaw) return null;
  const hh = Math.min(23, Math.max(0, parseInt(hhRaw, 10) || 0)).toString().padStart(2, '0');
  const mm = Math.min(59, Math.max(0, parseInt(mmRaw, 10) || 0)).toString().padStart(2, '0');
  return `${hh}:${mm}`;
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
// closable 配置「点击界外区域是否便捷关闭」：默认 true 点遮罩即关；表单类一律传 false
// （仅 ✕/取消按钮关闭，防误触丢输入——发帖/签约/需求/反馈/广播同口径）。
// cls/style 透传自定义类与内联样式；bodyCls 透传 body 类。
// 开合动画在 CSS（modal-in），JS 只增删 #modal-container 内容
// ============================================================
// 弹窗栈（用户反馈「表单里开预览/协议/确认，叉掉后表单浮窗也没了」）：
// 原单容器覆盖式（innerHTML 直接替换）——表单内开新浮窗会丢失下层表单。改栈式：
//   openModal 默认压栈当前 modal 节点（节点引用保留 → 表单输入值/滚动位置不丢），closeModal 弹栈恢复；
//   replace:true 供同流程 loading→表单（openSigningModal/openContractDraftModal）直接替换，不恢复旧 loading。
let _modalStack = [];
function openModal({ title, titleId = '', body = '', footer = '', closable = true, cls = '', style = '', bodyCls = '', replace = false } = {}) {
  closeHostOverlays(document.getElementById('modal-container')); // 附属树：换弹窗前先级联关旧弹窗的子覆盖层
  const container = document.getElementById('modal-container');
  const cur = container.firstElementChild;
  if (cur && !replace) _modalStack.push(cur); // 压栈：下层 modal（表单等）移出容器，节点保留
  const clickable = closable ? ' onclick="if(event.target===this)closeModal()"' : '';
  // v0.25.10（反馈 #82）：去独立玻璃表头——header 不再独占玻璃层/分隔线，
  // 标题直接坐弹窗顶端（毛玻璃归属整窗 .modal，表头只是自然流首行），整页滚动在 .modal-overlay
  // S2-2（XSS 审计防御加固）：title 组件内统一转义——调用方一律传原文，不再各自 escHtml（防双重转义）
  const header = title != null
    ? `<div class="modal-header"><h2${titleId ? ` id="${titleId}"` : ''}>${escHtml(title)}</h2><button type="button" class="btn btn-ghost btn-icon glass glass--pressable" aria-label="${UI.BTN_CLOSE}" onclick="closeModal()">✕</button></div>`
    : '';
  const clsAttr = cls ? ` ${cls}` : '';
  const styleAttr = style ? ` style="${style}"` : '';
  const bodyClsAttr = bodyCls ? ` ${bodyCls}` : '';
  container.innerHTML = `<div class="modal-overlay"${clickable}>
    <div class="modal glass glass--float${clsAttr}"${styleAttr}>
      ${header}
      <div class="modal-body${bodyClsAttr}">
        ${body}
        ${footer ? `<div class="modal-footer">${footer}</div>` : ''}
      </div>
    </div>
  </div>`;
}
function closeModal() {
  closeHostOverlays(document.getElementById('modal-container')); // 附属树：关父组件先级联关子覆盖层（下拉面板等），防幽灵组件残留
  const container = document.getElementById('modal-container');
  const prev = _modalStack.pop(); // v0.25.98：恢复被压栈的下层 modal；栈空则彻底关闭
  container.innerHTML = '';
  if (prev) container.appendChild(prev);
}
// v0.25.98：彻底关闭所有弹窗（登出等场景）——清栈 + 清容器，不恢复任何下层
function closeAllModals() {
  _modalStack.length = 0;
  const container = document.getElementById('modal-container');
  if (container) container.innerHTML = '';
}

// 需求三十+ v0.25.51 修正：用户协议/隐私政策浮窗——policy 全文硬编码在 constants
// UI.POLICY_AGREEMENT/PRIVACY（单源原则），mdRender 同步渲染，无网络依赖。
// key 单源 constants UI.POLICY_KEY_AGREEMENT/PRIVACY（index.html 注册勾选行 onclick 传入）；标题取 UI.AGREE_LINK_*。
function openPolicyModal(key) {
  const isPrivacy = key === UI.POLICY_KEY_PRIVACY;
  const name = isPrivacy ? UI.AGREE_LINK_PRIVACY : UI.AGREE_LINK_AGREEMENT;
  const md = isPrivacy ? UI.POLICY_PRIVACY : UI.POLICY_AGREEMENT;
  openModal({ title: name, cls: 'modal--wide', bodyCls: 'contract-md policy-md', body: `<div class="policy-body">${mdRender(md)}</div>` }); // 需求三十一：文本浮窗拓宽
}

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
    t.classList.add('img-broken');
  }
}, true);

// ============================================================
// 标准组件壳（2026-08-08 审计收编 G-10）：按钮 loading / 勾选框组。
// ——把散落在各领域模块的手拼 HTML 收敛到单点，转义与视觉单源（原 7 文件 36 处内联拼接）。
// v0.25.99：Alert 提示条连根删——提示统一走底部 Toast（showToast 全风格，app-anim.js）
// ============================================================
/** 按钮 loading：禁用 + 三柱 spinner（+ 可选右侧文案）；label 传 null 则纯 spinner。
    恢复用 btnDone(btn, label)（textContent 还原——原 innerHTML 拼 spinner 会把原文本冲掉）。 */
function btnLoading(btn, label) {
  if (!btn) return;
  btn.disabled = true;
  btn.innerHTML = `<span class="spinner"><i></i><i></i><i></i></span>${label ? ' ' + escHtml(label) : ''}`;
}
function btnDone(btn, label) {
  if (!btn) return;
  btn.disabled = false;
  if (label) btn.textContent = label;
}

/** 勾选框组：items=[{id,name}]，checkedIds 为已勾选 id 集合（可空）。返回 checkbox-item label 组 HTML。
    视觉/转义单源（原 app-region/app-demands/app-pages 三处手拼同款 label） */
function checkboxItemsHtml(items, checkedIds) {
  const checked = new Set((checkedIds || []).map(String));
  return items.map(it =>
    `<label class="checkbox-item glass glass--solid"><input type="checkbox" value="${escHtml(String(it.id))}"${checked.has(String(it.id)) ? ' checked' : ''}>${escHtml(it.name)}</label>`).join('');
}

/** 标准分段控件（
    容器微透灰底 + 选项间 gap（删分隔线），选中项=白色抬升药丸（白底+墨字+字重 700+轻浮影）。
    CSS 层统一收编原 6 处散装分段（role-tabs/demand-type-tabs/score-mode-tabs/traffic-range/feedback-kind-btn），
    JS 构造走本壳（角色分段在 index.html 静态标记，其余 4 处 JS 站点收编）。
    items=[{ key, label, onclick }]；activeKey 初始选中；onclick 为字符串表达式（内联 onclick 约定，
    key 经 escHtml 转义）；opts={ containerClass, containerId, attr }——attr 决定 data-* 属性名
    （各站 JS 选择器依赖 data-type/data-mode/data-kind/data-range，须保留）。
    返回 <div class="seg-tabs glass glass--solid"> + <button class="seg-tab"> 组。
    切换逻辑由调用方自建（classList.toggle('active') 同现有约定），本壳只管统一视觉与构造。 */
function segTabsHtml(items, activeKey, opts = {}) {
  const attr = opts.attr || 'key';
  const cls = opts.containerClass ? ' ' + opts.containerClass : '';
  const id = opts.containerId ? ` id="${escHtml(opts.containerId)}"` : '';
  return `<div class="seg-tabs glass glass--solid${cls}"${id}>${items.map(it =>
    `<button type="button" class="seg-tab glass${String(it.key) === String(activeKey) ? ' active' : ''}" data-${attr}="${escHtml(String(it.key))}" onclick="${it.onclick}">${escHtml(it.label)}</button>`).join('')}</div>`;
}

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
      showToast(UI.TAG_PICK_LIMIT.replace('{max}', max));
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
  // message 组件内统一转义（与 openModal title 同口径）——调用方传原文（含用户输入）即可，
  // 禁止调用方自行 escHtml（双重转义会出现 &amp;lt; 类乱码）
  const msg = escHtml(message);
  const footer = `<button type="button" class="btn btn-outline glass glass--pressable" onclick="closeModal()">${UI.BTN_CANCEL}</button>
      <button type="button" class="btn glass glass--pressable" onclick="${needReAuth ? 'runReAuth()' : 'runPendingConfirm()'}">${okText}</button>`;
  const body = needReAuth
    ? `<p class="confirm-msg">${msg}</p>
      <div class="form-group reauth-group">
        <label class="form-label">${UI.REAUTH_PASSWORD_LABEL} <span class="req">*</span></label>
        <input type="password" class="form-input" id="reauth-password" placeholder="${UI.REAUTH_PASSWORD_HINT}" autocomplete="current-password" onkeydown="if(event.key==='Enter')runReAuth()">
        <p class="form-hint form-hint--error hidden" id="reauth-err"></p>
      </div>`
    : `<p class="confirm-msg">${msg}</p>`;
  if (needReAuth) reAuthAction = onConfirm; else pendingConfirmAction = onConfirm;
  openModal({
    title,
    style: `max-width:${CONFIG.MODAL_W_CONFIRM};`,
    body,
    footer,
    // 重认证（密码输入）属表单类：点遮罩不关，防误触丢已输入密码；普通确认保留点遮罩快捷关闭
    closable: !needReAuth,
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
  if (!password) { errEl.textContent = UI.REAUTH_PASSWORD_HINT; errEl.classList.remove('hidden'); input.focus(); return; }
  try {
    const r = await api('/api/auth/re-auth', { method: 'POST', body: { password } });
    const action = reAuthAction;
    reAuthAction = null;
    closeModal();
    if (action) await action(r.capToken);
  } catch (err) {
    errEl.textContent = err.message;
    errEl.classList.remove('hidden');
    input.value = '';
    input.focus();
  }
}

// ============================================================
// 通用倒计时组件（B1，用户需求：倒计时+按钮组件抽象待复用）：
//   智能单位（>1 天 → 向下取整 x 天；<1 天 >1 分 → 向下取整 x 时 x 分；<1 分 → 向下取整 x 秒）
//   + 按钮灰化不可点 + 完成复原。复用点：用户名 7 天冷却、验证码 60s 重发、邀请码到期。
//   formatCountdown(ms) 纯函数独立暴露供单测。
// ============================================================
function formatCountdown(ms) {
  const t = Math.max(0, Math.floor(ms / 1000));
  if (t <= 0) return '';
  const D = 24 * 3600, H = 3600, M = 60;
  if (t >= D) return `${Math.floor(t / D)}天`;                     // >1 天：向下取整 x 天
  if (t >= M) {                                                    // <1 天且 ≥1 分：向下取整 x 时 x 分
    const h = Math.floor(t / H), m = Math.floor((t % H) / M);
    return h > 0 ? `${h}时${m}分` : `${m}分`;
  }
  return `${t}秒`;                                                 // <1 分：向下取整 x 秒
}

/**
 * 倒计时按钮绑定（按钮灰化不可点 + 内部文字随单位切换 + 完成复原）。
 * @param el 按钮/文本节点（按钮自动 disabled）
 * @param opts { endAt, runningText, onDone }
 *   endAt      结束时间戳（Date.now() + ms）
 *   runningText 倒计时文案模板，含 {time} 占位（如 '{time}后重发'）
 *   onDone     倒计时结束回调（复原后触发；按钮文本还原为原文案）
 * @returns stop 函数（组件销毁/页面切换时调用，清 interval）
 */
function bindCountdown(el, { endAt, runningText = '{time}', onDone = null } = {}) {
  if (!el) return () => {};
  if (!isFinite(endAt)) return () => {}; // 防御：endAt 非法（NaN/Infinity）→ 不启动倒计时（防 interval 永续挂起事件循环）
  const orig = el.textContent;
  const tick = () => {
    const rem = endAt - Date.now();
    if (rem <= 0) {
      clearInterval(iv);
      el.disabled = false;
      el.textContent = orig;
      if (onDone) onDone();
      return;
    }
    el.textContent = runningText.replace('{time}', formatCountdown(rem));
  };
  el.disabled = true;
  tick();
  const iv = setInterval(tick, 1000);
  return () => { clearInterval(iv); el.disabled = false; el.textContent = orig; };
}

// ============================================================
// 敏感操作门禁（放在 boot 共享层：签约/合同/登录/注册等各领域与登录页都调用；
// openCaptchaModal 由 app-captcha.js（同步加载，紧随本文件）提供）——
// 确认按钮按下 → 先拦实际请求过一次拼图真人验证，通过才执行 action。
// 防御降级：captcha 组件未就绪（vm 测试/异常环境）时直接执行 action——
// 生产 captcha 同步加载必就绪，走拼图；测试专注业务逻辑自动直通。
// ============================================================
function withCaptcha(action) {
  if (typeof action !== 'function') return;
  if (typeof openCaptchaModal === 'function') openCaptchaModal({ onPass: action });
  else action();
}

// md 编辑器壳（A6 收口 v0.25.80）：发帖/广播/反馈三弹窗共用模板（label + 工具栏 + 正文输入）。
// labelFor 传 textarea id 时给 label 补 for（发帖用）；placeholder/rows 按弹窗差异传参
function mdEditorHtml({ rows = 7, placeholder = '', label = UI.POST_LABEL_BODY, labelFor = '' } = {}) {
  const forAttr = labelFor ? ` for="${labelFor}"` : '';
  return `<div class="form-group">
      <label class="form-label"${forAttr}>${label}</label>
      <div class="md-toolbar">
        <button type="button" class="md-btn glass" onclick="mdWrap('h2')">H2</button>
        <button type="button" class="md-btn glass" onclick="mdWrap('h3')">H3</button>
        <button type="button" class="md-btn glass" onclick="mdWrap('bold')">${UI.POST_MD_BOLD}</button>
        <label class="md-btn glass" for="post-image-file">${UI.POST_MD_IMAGE}</label>
        <input type="file" id="post-image-file" accept="image/*" class="sr-file-input" onchange="insertPostImage(this)">
        <button type="button" class="md-btn glass" onclick="openPostPreview()">${UI.POST_PREVIEW_BTN}</button>
      </div>
      <textarea id="post-body" class="form-input post-body-input" rows="${rows}" placeholder="${placeholder}"></textarea>
    </div>`;
}

// 登出复位：确认类弹窗的挂起动作一并清（防上一账户的挂起确认被新账户触发）
registerLogoutReset(() => { pendingConfirmAction = null; reAuthAction = null; });

/**
 * 结构化时间组件前端回归（v0.25.0 需求一）
 *
 * 在真实 index.html DOM + 全脚本 vm 沙箱中验证组件行为（app-ui.js 提供）：
 *   渲染（容器/行结构）→ 新建/删除/上移 → 收集 → 校验（半填/范围）→ 回填（含旧纯文本忽略）
 *   → 条数上限 → 编辑限制（guardTimeKey/guardTimeBeforeInput/onTimeInput/clampTime/applyTimePick）。
 *
 * 跨 realm 归一化：组件返回值原型属沙箱域，deepEqual 判不等 → JSON 序列化还原（同 diff-lines.test.js）。
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { JSDOM } from 'jsdom';
import { readFileSync } from 'node:fs';
import vm from 'node:vm';

const FILES = [
  'constants.js', 'region-data.js', 'app-display.js', 'app-state.js', 'app-api.js',
  'app-datahub.js', 'app-anim.js', 'app-ui.js', 'app-otp.js', 'app-captcha.js', 'app-onboard.js', 'app-region.js',
  'app-posts.js', 'app-chat.js', 'app-contracts.js', 'app-chart.js', 'app-admin.js',
  'app-demands.js', 'app-teachers.js', 'app-style.js', 'app-pages.js', 'app-shell.js', 'app-auth.js',
];

function makeCtx() {
  const html = readFileSync('./index.html', 'utf8')
    .replace(/<script src="\/app-[a-z-]+\.js"><\/script>/g, '');
  const dom = new JSDOM(html, {
    url: 'http://localhost/', pretendToBeVisual: true, runScripts: 'dangerously',
  });
  const w = dom.window;
  w.HTMLCanvasElement.prototype.getContext = function () { // jsdom 无 canvas：patch 链式 2d 替身（app-captcha 进 boot FILES 后 vm 测试走到 canvas 路径）
    const mk = () => new Proxy(() => {}, { get: (t, k) => (k === 'canvas' ? {} : mk()), apply: () => mk() });
    return mk();
  };
  const ctx = vm.createContext({
    window: w, document: w.document,
    getComputedStyle: w.getComputedStyle.bind(w),
    localStorage: w.localStorage, sessionStorage: w.sessionStorage,
    console, crypto: globalThis.crypto, fetch: globalThis.fetch, setTimeout: globalThis.setTimeout,
    clearTimeout: globalThis.clearTimeout, setInterval: globalThis.setInterval,
    clearInterval: globalThis.clearInterval, Request: globalThis.Request,
    MutationObserver: class { observe() {} disconnect() {} takeRecords() { return []; } },
    Image: class { set src(v) { this._s = v; } },
    requestAnimationFrame: (cb) => setTimeout(cb, 16), cancelAnimationFrame: () => {},
    matchMedia: () => ({ matches: false, addEventListener: () => {} }),
  });
  for (const f of FILES) vm.runInContext(readFileSync('./' + f, 'utf8'), ctx, { filename: f });
  vm.runInContext(`if (typeof openCaptchaModal === 'function') { const _ocm = openCaptchaModal; openCaptchaModal = (o) => { if (o && o.onPass) o.onPass(); }; }`, ctx); // vm 测试直通拼图（生产走真验证）
  const fns = vm.runInContext(`({
    renderTimeSlotContainerHtml, renderTimeSlotRowHtml, addTimeSlot, removeTimeSlot,
    collectTimeSlots, validateTimeSlots, prefillTimeSlots, guardSegmentKey, guardSegmentBeforeInput,
    onSegmentInput, clampSegment, applyTimePick,
  })`, ctx);
  return { dom, fns };
}

function mount(doc) {
  const container = doc.createElement('div');
  container.className = 'time-slots';
  doc.body.appendChild(container);
  return container;
}

test('时间组件：空容器 + 新建/删除/上移', () => {
  const { dom, fns } = makeCtx();
  const doc = dom.window.document;
  const container = mount(doc);
  container.innerHTML = fns.renderTimeSlotContainerHtml();

  assert.equal(container.querySelectorAll('.time-slot').length, 0, '初始无组件');
  assert.ok(container.querySelector('.time-add-btn'), '有 + 按钮');
  assert.equal(container.querySelector('.time-add-label').textContent, '新建时间段');

  fns.addTimeSlot(container.querySelector('.time-add-btn'));
  assert.equal(container.querySelectorAll('.time-slot').length, 1, '新建后 1 条');
  // + 行在新组件正下方（流内：紧随其后）
  const addRow = container.querySelector('.time-slots-add');
  assert.equal(addRow.previousElementSibling.classList.contains('time-slot'), true, '+ 行紧邻新组件下方');

  // 空组件三栏：星期下拉占位 + 起止灰字占位 + 删除按钮
  const row = container.querySelector('.time-slot');
  assert.equal(row.querySelector('.slot-dow').value, '');
  assert.equal(row.querySelector('.time-field[data-time-role="start"] .time-field-ghost').textContent, '开始时间');
  assert.equal(row.querySelector('.time-field[data-time-role="end"] .time-field-ghost').textContent, '结束时间');
  assert.ok(row.querySelector('.time-slot-del'), '有删除按钮');

  fns.addTimeSlot(container.querySelector('.time-add-btn'));
  assert.equal(container.querySelectorAll('.time-slot').length, 2);
  fns.removeTimeSlot(container.querySelector('.time-slot-del')); // 删第一条
  const remain = container.querySelector('.time-slot');
  assert.equal(container.querySelectorAll('.time-slot').length, 1, '删除后剩 1 条');
  assert.equal(remain.querySelector('.slot-dow').value, '', '下方组件上移（原第二条仍是空）');
});

test('时间组件：收集与校验', () => {
  const { dom, fns } = makeCtx();
  const doc = dom.window.document;
  const container = mount(doc);
  container.innerHTML = fns.renderTimeSlotContainerHtml();
  fns.addTimeSlot(container.querySelector('.time-add-btn'));
  const row = container.querySelector('.time-slot');
  const hhS = row.querySelector('.time-field[data-time-role="start"] .slot-time-hh');
  const mmS = row.querySelector('.time-field[data-time-role="start"] .slot-time-mm');
  const hhE = row.querySelector('.time-field[data-time-role="end"] .slot-time-hh');
  const mmE = row.querySelector('.time-field[data-time-role="end"] .slot-time-mm');

  // 空行：通过校验、收集为空
  assert.equal(fns.validateTimeSlots(container), '');
  assert.deepEqual(JSON.parse(JSON.stringify(fns.collectTimeSlots(container))), []);

  // 半填（有星期无时间）：校验报不完整
  row.querySelector('.slot-dow').value = '1';
  assert.equal(fns.validateTimeSlots(container), '请补全时间段（星期与起止时间），或删除不完整的时间段');

  // 填完整：通过并收集为结构化对象
  hhS.value = '18'; mmS.value = '30'; hhE.value = '20'; mmE.value = '0';
  assert.equal(fns.validateTimeSlots(container), '');
  assert.deepEqual(JSON.parse(JSON.stringify(fns.collectTimeSlots(container))),
    [{ type: 'week', dow: 1, start: '18:30', end: '20:00' }]);

  // 结束早于开始：报范围错误
  hhE.value = '17';
  assert.equal(fns.validateTimeSlots(container), '时间段的结束时间需晚于开始时间');
});

test('时间组件：回填（结构化 JSON / 旧纯文本忽略）与上限', () => {
  const { dom, fns } = makeCtx();
  const doc = dom.window.document;
  const container = mount(doc);
  container.innerHTML = fns.renderTimeSlotContainerHtml();

  // 旧纯文本（非 JSON）：不建行
  fns.prefillTimeSlots(container, '工作日晚上');
  assert.equal(container.querySelectorAll('.time-slot').length, 0, '旧纯文本忽略');

  const raw = JSON.stringify([
    { type: 'week', dow: 3, start: '18:00', end: '21:00' },
    { type: 'week', dow: 7, start: '09:00', end: '11:00' },
  ]);
  fns.prefillTimeSlots(container, raw);
  assert.equal(container.querySelectorAll('.time-slot').length, 2, '回填 2 行');
  const r0 = container.querySelectorAll('.time-slot')[0];
  assert.equal(r0.querySelector('.slot-dow').value, '3');
  assert.equal(r0.querySelector('.time-field[data-time-role="start"] .slot-time-hh').value, '18');
  assert.equal(r0.querySelector('.time-field[data-time-role="start"] .slot-time-mm').value, '00');
  assert.equal(r0.querySelector('.time-field[data-time-role="end"] .slot-time-hh').value, '21');
  assert.ok(r0.querySelector('.time-field[data-time-role="start"]').classList.contains('has-value'), '有值时间栏隐藏灰字');

  // 条数上限：回填 8 条后 + 按钮置灰，再点不新增
  const many = Array.from({ length: 8 }, (_, i) => ({ type: 'week', dow: (i % 7) + 1, start: '10:00', end: '11:00' }));
  const container2 = mount(doc);
  container2.innerHTML = fns.renderTimeSlotContainerHtml();
  fns.prefillTimeSlots(container2, JSON.stringify(many));
  assert.equal(container2.querySelectorAll('.time-slot').length, 8);
  assert.equal(container2.querySelector('.time-add-btn').disabled, true, '达上限置灰');
  fns.addTimeSlot(container2.querySelector('.time-add-btn'));
  assert.equal(container2.querySelectorAll('.time-slot').length, 8, '超上限不再新增');
});

test('时间组件：编辑限制（v0.25.3 允许自由删除；禁粘贴/禁非数字，允许数字/导航/复制）', () => {
  const { dom, fns } = makeCtx();
  const w = dom.window;
  w.HTMLCanvasElement.prototype.getContext = function () { // jsdom 无 canvas：patch 链式 2d 替身（app-captcha 进 boot FILES 后 vm 测试走到 canvas 路径）
    const mk = () => new Proxy(() => {}, { get: (t, k) => (k === 'canvas' ? {} : mk()), apply: () => mk() });
    return mk();
  };
  const inp = w.document.createElement('input');
  inp.className = 'slot-time-hh';
  w.document.body.appendChild(inp);

  const keyEv = (init) => new w.KeyboardEvent('keydown', { cancelable: true, bubbles: true, ...init });
  const prevented = (ev) => { fns.guardSegmentKey(ev); return ev.defaultPrevented; };

  // v0.25.3：自由逐位删除放行（用户指令——数字删到空再重打，冒号独立元素天然碰不到）
  assert.equal(prevented(keyEv({ key: 'Backspace' })), false, 'Backspace 放行');
  assert.equal(prevented(keyEv({ key: 'Delete' })), false, 'Delete 放行');
  assert.equal(prevented(keyEv({ key: 'Backspace', ctrlKey: true })), false, 'Ctrl+Backspace 放行（清空本侧）');
  assert.equal(prevented(keyEv({ key: 'v', ctrlKey: true })), true, 'Ctrl+V 拦截');
  assert.equal(prevented(keyEv({ key: 'x', ctrlKey: true })), true, 'Ctrl+X 拦截');
  assert.equal(prevented(keyEv({ key: 'a' })), true, '字母 a 拦截');
  assert.equal(prevented(keyEv({ key: '5' })), false, '数字放行');
  assert.equal(prevented(keyEv({ key: 'Tab' })), false, 'Tab 放行');
  assert.equal(prevented(keyEv({ key: 'ArrowLeft' })), false, '方向键放行');
  assert.equal(prevented(keyEv({ key: 'c', ctrlKey: true })), false, 'Ctrl+C 放行（复制）');
  assert.equal(prevented(keyEv({ key: 'a', ctrlKey: true })), false, 'Ctrl+A 放行（全选本侧）');

  // beforeinput 兜底（IME/移动端）：删除放行（同 keydown 口径）；黏贴/拖入/非数字插入拦截
  const mkBefore = (inputType, data) => ({ inputType, data, _p: false, preventDefault() { this._p = true; } });
  const before = (it, data) => { const m = mkBefore(it, data); fns.guardSegmentBeforeInput(m); return m._p; };
  assert.equal(before('deleteContentBackward', null), false, '删除放行（IME/移动端虚拟键盘）');
  assert.equal(before('deleteByCut', null), false, '剪切（拖拽）删除放行');
  assert.equal(before('insertFromPaste', 'abc'), true, '黏贴拦截');
  assert.equal(before('insertFromDrop', '18'), true, '拖入拦截');
  assert.equal(before('insertText', 'a'), true, '非数字插入拦截');
  assert.equal(before('insertText', '5'), false, '数字插入放行');
  assert.equal(before('insertText', '123'), false, '多数字符串由 oninput 裁剪');
});

test('时间组件：v0.25.27 空栏冒号恒显 + 灰字占位拆两半夹冒号', () => {
  const { dom, fns } = makeCtx();
  const doc = dom.window.document;
  const container = mount(doc);
  container.innerHTML = fns.renderTimeSlotContainerHtml();
  fns.addTimeSlot(container.querySelector('.time-add-btn'));
  const field = container.querySelector('.time-field[data-time-role="start"]');
  const hh = field.querySelector('.slot-time-hh');
  const mm = field.querySelector('.slot-time-mm');
  assert.ok(field.querySelector('.time-colon'), '冒号元素在栏内（hh 与 mm 之间）');
  assert.ok(field.querySelector('.time-hms'), 'hh/冒号/mm 包进 .time-hms 锚点（ghost 居中于它）');
  assert.ok(field.querySelector('.time-hms .time-colon'), '冒号位于 .time-hms 组内');

  // ghost 拆两半：空栏灰字「开始 时间」，两半之间留间隙容纳恒显冒号（观感「开始:时间」）
  const ghost = field.querySelector('.time-field-ghost');
  assert.equal(ghost.textContent, '开始时间', 'ghost 整体文案不变（拆开仅结构）');
  const halves = ghost.querySelectorAll(':scope > span');
  assert.equal(halves.length, 2, 'ghost 拆成两半');
  assert.equal(halves[0].textContent, '开始', '前半「开始」');
  assert.equal(halves[1].textContent, '时间', '后半「时间」');
  assert.ok(field.querySelector('.time-hms .time-colon'), '冒号仍在组内供间隙容纳');

  // has-value 状态链仍生效：空栏无 → 填值有 → 删空无 → 半填有（控制 ghost 淡出 + 冒号变色）
  assert.equal(field.classList.contains('has-value'), false, '空栏无 has-value');
  hh.value = '18'; mm.value = '00'; fns.onSegmentInput(hh); fns.onSegmentInput(mm);
  assert.equal(field.classList.contains('has-value'), true, '有值后 has-value 出现');
  hh.value = ''; mm.value = ''; fns.onSegmentInput(hh); fns.onSegmentInput(mm);
  assert.equal(field.classList.contains('has-value'), false, '删空后 has-value 消失');
  hh.value = '1'; fns.onSegmentInput(hh);
  assert.equal(field.classList.contains('has-value'), true, '半填也算有值');

  // CSS 回归：v0.25.3 的「空栏藏冒号」规则必须已删（用户反转：冒号恒显，灰字让位）
  const css = readFileSync('./style.css', 'utf8');
  assert.ok(!/\.time-field:not\(\.has-value\) \.time-colon\s*\{\s*visibility:\s*hidden/.test(css), '旧「空栏冒号隐藏」规则已删（冒号恒显）');
  assert.match(css, /\.time-hms\s*\{/, 'style.css .time-hms 锚点规则在位');
});

test('时间组件：输入清洗与钳制（onSegmentInput/clampSegment/applyTimePick）', () => {
  const { dom, fns } = makeCtx();
  const doc = dom.window.document;
  const container = mount(doc);
  container.innerHTML = fns.renderTimeSlotContainerHtml();
  fns.addTimeSlot(container.querySelector('.time-add-btn'));
  const row = container.querySelector('.time-slot');
  const hh = row.querySelector('.time-field[data-time-role="start"] .slot-time-hh');
  const mm = row.querySelector('.time-field[data-time-role="start"] .slot-time-mm');

  hh.value = '1a2b'; fns.onSegmentInput(hh);
  assert.equal(hh.value, '12', 'input 清洗只留数字');
  hh.value = '123'; fns.onSegmentInput(hh);
  assert.equal(hh.value, '12', 'input 至多两位');
  mm.value = '0'; fns.onSegmentInput(mm);
  assert.equal(mm.value, '0');

  hh.value = '9'; fns.clampSegment(hh);
  assert.equal(hh.value, '09', 'blur 补零');
  hh.value = '25'; fns.clampSegment(hh);
  assert.equal(hh.value, '23', '时钳制 23');
  mm.value = '75'; fns.clampSegment(mm);
  assert.equal(mm.value, '59', '分钳制 59');

  // 整点下拉选中：写回 HH + :00
  const sel = row.querySelector('.time-pick-select');
  sel.value = '18:00';
  fns.applyTimePick(sel);
  assert.equal(hh.value, '18');
  assert.equal(mm.value, '00');
});

test('时间组件：左右键跨分隔符跳到相邻段（v0.25.87 R4）', () => {
  const { dom, fns } = makeCtx();
  const doc = dom.window.document;
  const container = mount(doc);
  container.innerHTML = fns.renderTimeSlotContainerHtml();
  fns.addTimeSlot(container.querySelector('.time-add-btn'));
  const row = container.querySelector('.time-slot');
  const hh = row.querySelector('.time-field[data-time-role="start"] .slot-time-hh');
  const mm = row.querySelector('.time-field[data-time-role="start"] .slot-time-mm');
  hh.value = '12'; mm.value = '34';

  const fire = (inp, key, caretStart, caretEnd) => {
    const ev = new dom.window.KeyboardEvent('keydown', { key, bubbles: true, cancelable: true });
    Object.defineProperty(ev, 'target', { value: inp, configurable: true });
    Object.defineProperty(inp, 'selectionStart', { value: caretStart, configurable: true });
    Object.defineProperty(inp, 'selectionEnd', { value: caretEnd, configurable: true });
    fns.guardSegmentKey(ev);
    return ev;
  };

  // 光标在 hh 末尾 → ArrowRight 跨冒号跳到 mm 开头
  const evR = fire(hh, 'ArrowRight', 2, 2);
  assert.equal(evR.defaultPrevented, true, '段尾 ArrowRight 被接管（跨冒号）');
  assert.equal(doc.activeElement, mm, '焦点跳到分位');
  // 光标在 mm 开头 → ArrowLeft 跨冒号跳回 hh 末尾
  const evL = fire(mm, 'ArrowLeft', 0, 0);
  assert.equal(evL.defaultPrevented, true, '段首 ArrowLeft 被接管（跨冒号）');
  assert.equal(doc.activeElement, hh, '焦点跳回时位');
  // 段内移动（非边界）不接管
  const evMid = fire(hh, 'ArrowLeft', 1, 1);
  assert.equal(evMid.defaultPrevented, false, '段内 ArrowLeft 不接管（光标不越段）');
  const evMidR = fire(mm, 'ArrowRight', 1, 1);
  assert.equal(evMidR.defaultPrevented, false, '段内 ArrowRight 不接管（光标不越段）');
});

test('时间组件：框选 Backspace/Delete 正常删选区内数字（v0.25.87 R9）', () => {
  const { dom, fns } = makeCtx();
  const doc = dom.window.document;
  const inp = doc.createElement('input');
  inp.className = 'slot-time-hh';
  inp.value = '12';
  doc.body.appendChild(inp);
  const fire = (key, caretStart, caretEnd) => {
    const ev = new dom.window.KeyboardEvent('keydown', { key, bubbles: true, cancelable: true });
    Object.defineProperty(ev, 'target', { value: inp, configurable: true });
    Object.defineProperty(inp, 'selectionStart', { value: caretStart, configurable: true });
    Object.defineProperty(inp, 'selectionEnd', { value: caretEnd, configurable: true });
    fns.guardSegmentKey(ev);
    return ev;
  };
  // 框选两位（光标 0→2）后 Backspace/Delete：放行（浏览器删选区，冒号独立元素不受影响）
  assert.equal(fire('Backspace', 0, 2).defaultPrevented, false, '框选全段 Backspace 放行');
  assert.equal(fire('Delete', 0, 2).defaultPrevented, false, '框选全段 Delete 放行');
  // 框选单字符
  assert.equal(fire('Backspace', 0, 1).defaultPrevented, false, '框选单字符 Backspace 放行');
  // 框选后输入数字（替换选区）放行
  const ev = fire('5', 0, 2);
  assert.equal(ev.defaultPrevented, false, '框选后数字替换放行');
});

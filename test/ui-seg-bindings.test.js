/**
 * Z-13-F2：ui-bindings / seg-input 行为测试——guardSegmentKey 键守卫（非数字拦截 +
 * 段间方向键迁移）、guardSegmentBeforeInput（粘贴/拖放/非数字 insertText 拦截）、
 * onSegmentInput（数字清洗 + maxlen 截断）、segmentSibling（相邻段定位）、
 * bindSegmentInputs（幂等绑定）、installFormBindings（一次性安装 + MutationObserver
 * 自动绑定新节点）。clampSegment/clampYear/clampDateDay 已由 date-field.test.js 覆盖。
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { JSDOM } from 'jsdom';
import { guardSegmentKey, guardSegmentBeforeInput, onSegmentInput, segmentSibling, bindSegmentInputs } from '../src/client/core/ui-form.js';
import { installFormBindings } from '../src/client/core/ui-bindings.js';

function setup(html) {
  const dom = new JSDOM(`<!DOCTYPE html><html><body>${html || ''}</body></html>`, { url: 'http://localhost/' });
  globalThis.document = dom.window.document;
  globalThis.window = dom.window;
  return dom;
}
function teardown() {
  delete globalThis.document; delete globalThis.window;
}

test('guardSegmentKey：非数字字符拦截（preventDefault），数字与编辑键放行', () => {
  const dom = setup('<input class="seg-input" value="">');
  const inp = dom.window.document.querySelector('.seg-input');
  const key = (k, extra = {}) => {
    const ev = { key: k, target: inp, selectionStart: 0, selectionEnd: 0, ctrlKey: false, metaKey: false, altKey: false, prevented: false, preventDefault() { this.prevented = true; } };
    Object.assign(ev, extra);
    guardSegmentKey(ev);
    return ev;
  };
  assert.ok(key('a').prevented, '字母拦截');
  assert.ok(key(' ').prevented, '空格拦截');
  assert.ok(!key('5').prevented, '数字放行');
  assert.ok(!key('Backspace').prevented, '退格放行');
  assert.ok(!key('Delete').prevented, '删除放行');
  assert.ok(!key('Tab').prevented, 'Tab 放行（表单迁移）');
  assert.ok(!key('ArrowLeft').prevented, '方向键放行');
  // 段首 ArrowLeft 迁移到前一格；无前格则不拦截
  const dom2 = setup('<div class="time-hms"><input class="seg-input" value="08"><input class="seg-input" value="30"></div>');
  const first = dom2.window.document.querySelectorAll('.seg-input')[0];
  const ev = { key: 'ArrowLeft', target: first, selectionStart: 0, selectionEnd: 0, ctrlKey: false, metaKey: false, altKey: false, prevented: false, preventDefault() { this.prevented = true; } };
  guardSegmentKey(ev);
  assert.ok(!ev.prevented, '首格无前邻段，ArrowLeft 不拦截');
  // 段尾 ArrowRight 想迁移到下一段：中格有下一段 → 拦截并 focus 下一格
  // （jsdom selectionStart 默认 0，需 focus + setSelectionRange 置位到段尾）
  const dom3 = setup('<div class="time-hms"><input class="seg-input" value="08"><input class="seg-input" value="30"><input class="seg-input" value="00"></div>');
  const segs3 = dom3.window.document.querySelectorAll('.seg-input');
  segs3[0].focus(); segs3[0].setSelectionRange(2, 2);
  const evMid = { key: 'ArrowRight', target: segs3[0], ctrlKey: false, metaKey: false, altKey: false, prevented: false, preventDefault() { this.prevented = true; } };
  let focused = null;
  const origFocus = segs3[1].focus;
  segs3[1].focus = () => { focused = segs3[1]; };
  guardSegmentKey(evMid);
  assert.ok(evMid.prevented, '中格段尾 ArrowRight 拦截迁移');
  assert.equal(focused, segs3[1], '焦点迁移到下一格');
  segs3[1].focus = origFocus;
  // 末格无下一段 → 不拦截（让默认光标行为继续）
  const last = segs3[2];
  last.focus(); last.setSelectionRange(2, 2);
  const ev2 = { key: 'ArrowRight', target: last, ctrlKey: false, metaKey: false, altKey: false, prevented: false, preventDefault() { this.prevented = true; } };
  guardSegmentKey(ev2);
  assert.ok(!ev2.prevented, '末格无下一段，ArrowRight 不拦截');
  teardown();
});

test('guardSegmentBeforeInput：粘贴/拖放与非数字 insertText 拦截，数字 insertText 放行', () => {
  const dom = setup('<input class="seg-input">');
  const inp = dom.window.document.querySelector('.seg-input');
  const bi = (inputType, data) => {
    const ev = { inputType, data, prevented: false, preventDefault() { this.prevented = true; } };
    guardSegmentBeforeInput(ev);
    return ev;
  };
  assert.ok(bi('insertFromPaste', '12').prevented, '粘贴拦截');
  assert.ok(bi('insertFromDrop', '12').prevented, '拖放拦截');
  assert.ok(bi('insertText', 'a').prevented, '非数字 insertText 拦截');
  assert.ok(!bi('insertText', '5').prevented, '数字 insertText 放行');
  teardown();
});

test('onSegmentInput：非数字清洗 + maxlen 截断', () => {
  const dom = setup('<input class="seg-input" data-maxlen="2">');
  const inp = dom.window.document.querySelector('.seg-input');
  inp.value = '1a2b3';
  onSegmentInput(inp);
  assert.equal(inp.value, '12', '字母被清 + 超 2 位截断');
  inp.value = '7';
  onSegmentInput(inp);
  assert.equal(inp.value, '7', '合法数字保留');
  teardown();
});

test('segmentSibling：time-hms 内返回相邻段', () => {
  const dom = setup('<div class="time-hms"><input class="seg-input" value="08"><input class="seg-input" value="30"><input class="seg-input" value="00"></div>');
  const segs = dom.window.document.querySelectorAll('.seg-input');
  assert.equal(segmentSibling(segs[0], 1), segs[1], '首格向后 → 第二格');
  assert.equal(segmentSibling(segs[1], -1), segs[0], '中格向前 → 首格');
  assert.equal(segmentSibling(segs[2], 1), null, '末格向后 → null');
  teardown();
});

test('bindSegmentInputs：幂等绑定（data-seg-bound 标记，二次调用跳过）', () => {
  const dom = setup('<input class="seg-input" data-maxlen="2">');
  const inp = dom.window.document.querySelector('.seg-input');
  bindSegmentInputs(document);
  assert.equal(inp.dataset.segBound, '1', '首绑打标');
  bindSegmentInputs(document);
  assert.ok(true, '二次调用不抛错（已绑定跳过）');
  teardown();
});

test('installFormBindings：一次性安装 + MutationObserver 自动绑定新节点', async () => {
  const dom = new JSDOM('<!DOCTYPE html><html><body></body></html>', { url: 'http://localhost/' });
  globalThis.document = dom.window.document;
  globalThis.window = dom.window;
  globalThis.MutationObserver = dom.window.MutationObserver;
  installFormBindings();
  const box = document.createElement('div');
  box.innerHTML = '<input class="seg-input" data-maxlen="2">';
  document.body.appendChild(box);
  await new Promise(r => setTimeout(r, 20)); // 等 MutationObserver 微任务/回调
  assert.equal(box.querySelector('.seg-input').dataset.segBound, '1', '动态新增 seg-input 被自动绑定');
  delete globalThis.MutationObserver;
  teardown();
});

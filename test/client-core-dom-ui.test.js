/**
 * B0 dom/ui core tests（parity semantics）.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { JSDOM } from 'jsdom';
import { escHtml, escJsStr, fmtDateTime, fmtDate, mdRender, loaderHtml, renderAvatarHtml, componentShell, delegate } from '../src/client/core/dom.js';
import { diffLines } from '../src/client/features/contract/display.js';
import { btnLoading, btnDone, formatCountdown, checkboxItemsHtml, segTabsHtml, pickGrade, toggleTagPick, openModal, closeModal, closeAllModals, confirm, applyTabBindings, installUiBindings, installFormBindings } from '../src/client/core/ui.js';
import { installGlobalInteractions } from '../src/client/core/anim.js';
import { TEXT } from '../src/client/constants/text.js';

const dom = new JSDOM(`<!doctype html><html><body>
  <div id="modal-container"></div><div id="toast-container"></div>
  <button id="btn">保存</button>
</body></html>`, { url: 'http://localhost/' });
globalThis.document = dom.window.document;
globalThis.window = dom.window;
globalThis.MutationObserver = class { observe() {} };
globalThis.CustomEvent = dom.window.CustomEvent;

test('escHtml/escJsStr parity semantics', () => {
  assert.equal(escHtml(`<a b="c">'&`), '&lt;a b=&quot;c&quot;&gt;&#39;&amp;');
    const jsOut = escJsStr("a'b<&");
    assert.equal(jsOut, "a" + String.fromCharCode(92) + "'b<&amp;");
});

test('fmtDateTime/fmtDate', () => {
  const d = new Date('2024-01-02T03:04:00Z');
  const p = n => String(n).padStart(2, '0');
  const expected = `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())} ${p(d.getHours())}:${p(d.getMinutes())}`;
  assert.equal(fmtDateTime('2024-01-02 03:04:05'), expected);
  assert.equal(fmtDate('2024-01-02'), `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`);
});

test('mdRender uses UI.POST_IMG_BLOCKED and escapes first', () => {
  const html = mdRender('# Hi\n\n- a **b**\n\n> q\n\n2. x');
  assert.equal(html, '<h1>Hi</h1><ul><li>a <strong>b</strong></li></ul><blockquote><p>q</p></blockquote><ol><li>x</li></ol>');
  const guarded = mdRender('<b>x</b> ![bad](javascript:y)');
  assert.ok(guarded.includes('&lt;b&gt;x&lt;/b&gt;'));
  assert.ok(guarded.includes(TEXT.POST_IMG_BLOCKED));
});

test('loader/avatar/componentShell', () => {
  assert.match(loaderHtml('sm'), /class="spinner" role="status"/);
  const av = renderAvatarHtml('"><img>', '王老师', 'lg');
  assert.ok(av.includes('&quot;&gt;'));
  assert.equal(componentShell('section', 'x"y', '<i>&</i>'), '<section class="x&quot;y"><i>&</i></section>');
});

test('diffLines old LCS contract {t,text}', () => {
  assert.deepEqual(diffLines('a\nb', 'a\nB\nc'), [
    { t: 'same', text: 'a' }, { t: 'del', text: 'b' }, { t: 'add', text: 'B' }, { t: 'add', text: 'c' },
  ]);
});

test('btnLoading/btnDone parity semantics', () => {
  const btn = document.getElementById('btn');
  btnLoading(btn, '发送中');
  assert.equal(btn.disabled, true);
  assert.ok(btn.innerHTML.includes('spinner'));
  assert.equal(btn.textContent.trim(), '发送中');
  btnDone(btn);
  assert.equal(btn.disabled, false);
  assert.equal(btn.textContent.trim(), '发送中'); // 旧契约：未传 label 不改文案
  btnDone(btn, '恢复');
  assert.equal(btn.textContent, '恢复');
});

test('formatCountdown old boundary incl NaN', () => {
  assert.equal(formatCountdown(7 * 24 * 3600 * 1000 + 5000), '7天');
  assert.equal(formatCountdown(3 * 3600 * 1000 + 25 * 60 * 1000 + 9000), '3时25分');
  assert.equal(formatCountdown(45 * 1000 + 500), '45秒');
  assert.equal(formatCountdown(0), '');
  assert.equal(formatCountdown(NaN), 'NaN秒');
});

test('checkboxItemsHtml/segTabsHtml', () => {
  const cb = checkboxItemsHtml([{ id: 'a"b', name: '<A>' }], ['a"b']);
  assert.ok(cb.includes('value="a&quot;b" checked'));
  assert.ok(cb.includes('&lt;A&gt;'));
  const tabs = segTabsHtml([{ key: 'k1', label: '<L>' }], 'k1', { attr: 'x' });
  assert.ok(tabs.includes('seg-tab glass active'));
  assert.ok(tabs.includes('data-x="k1"'));
  assert.ok(tabs.includes('&lt;L&gt;'));
});

test('pickGrade/toggleTagPick old contracts', () => {
  const root = document.createElement('div');
  root.innerHTML = `
    <div class="grade-selector"><button class="grade-option" id="g1">A</button><button class="grade-option" id="g2">B</button></div>
    <div id="tags"><button class="tag-pick">t1</button><button class="tag-pick">t2</button><button class="tag-pick">t3</button></div>`;
  document.body.appendChild(root);
  const [g1, g2] = root.querySelectorAll('.grade-option');
  assert.equal(pickGrade(g1), undefined);
  assert.equal(g1.classList.contains('selected'), true);
  assert.equal(g2.classList.contains('selected'), false);
  const [t1, t2, t3] = root.querySelectorAll('.tag-pick');
  assert.equal(toggleTagPick(t1, 'tags', 2), undefined);
  assert.equal(toggleTagPick(t2, 'tags', 2), undefined);
  assert.equal(toggleTagPick(t3, 'tags', 2), undefined);
  assert.equal(t3.classList.contains('selected'), false);
  root.remove();
});

test('openModal/closeModal stack behavior', () => {
  const root = openModal({ title: '<T>', body: '<b>', closable: false });
  assert.equal(root.querySelector('.modal-header h2').textContent, '<T>');
  closeModal();
  assert.equal(root.innerHTML, '');
  closeAllModals();
});

test('confirm: pending action and capToken', () => {
  let got = null;
  confirm({ message: '<m>', onConfirm: v => { got = v; } });
  document.querySelector('[data-action="ui.runPendingConfirm"]').click();
  assert.equal(got, undefined);
  let cap = null;
  confirm({ message: 'm', needReAuth: true, onConfirm: v => { cap = v; } });
  document.getElementById('reauth-password').value = 'CAP123';
  document.querySelector('[data-action="ui.runReAuth"]').click();
  // runReAuth 是异步 API 流程，这里只验证输入与元素存在；真实 re-auth 由 parity/api 测试覆盖
  assert.equal(document.getElementById('reauth-password').value, 'CAP123');
  closeModal();
});

test('delegate bind/unbind', () => {
  const root = document.createElement('div');
  document.body.appendChild(root);
  let n = 0;
  const off = delegate(root, () => { n++; });
  root.click();
  off();
  root.click();
  assert.equal(n, 1);
  root.remove();
});

test('applyTabBindings: data-tab-action click toggles active and dispatches event', () => {
  const root = document.createElement('div');
  root.innerHTML = segTabsHtml([{ key: 'a', label: 'A' }, { key: 'b', label: 'B' }], 'a');
  document.body.appendChild(root);
  let detail = null;
  root.querySelector('.seg-tabs').addEventListener('seg-tab-change', e => { detail = e.detail; });
  applyTabBindings(root);
  root.querySelectorAll('.seg-tab')[1].click();
  assert.equal(root.querySelectorAll('.seg-tab')[1].classList.contains('active'), true);
  assert.equal(root.querySelectorAll('.seg-tab')[0].classList.contains('active'), false);
  assert.equal(detail.key, 'b');
  root.remove();
});

test('installUiBindings/installFormBindings are idempotent', () => {
  installUiBindings();
  installFormBindings();
  installUiBindings();
  installFormBindings();
  assert.ok(true);
});

test('avatar data-action delegation stops bubbling to parent click', () => {
  const parent = document.createElement('div');
  document.body.appendChild(parent);
  let parentClicks = 0;
  parent.addEventListener('click', () => { parentClicks++; });
  parent.innerHTML = renderAvatarHtml('', '王老师', '', 7);
  installGlobalInteractions();
  parent.querySelector('.avatar-btn').click();
  assert.equal(parentClicks, 0, 'avatar click must not bubble to parent');
  parent.remove();
});

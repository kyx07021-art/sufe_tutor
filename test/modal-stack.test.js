/**
 * v0.25.98 弹窗栈（用户反馈「表单里开预览/协议/确认，叉掉后表单浮窗也没了」）
 *
 * 根因：openModal 单容器覆盖式（#modal-container.innerHTML 直接替换）——表单内打开
 * 新浮窗（发帖预览/协议/二次确认）会把下层表单 modal 整棵销毁，closeModal 又只清容器，
 * 关闭后留下空容器，表单连同已输入内容一并丢失。
 *
 * 修复：openModal 默认把当前容器首节点压入 _modalStack（节点引用保留 → 输入值/滚动位置不丢），
 * closeModal 弹栈 appendChild 恢复；replace:true 供同流程 loading→表单（openSigningModal /
 * openContractDraftModal）直接替换，不恢复旧 loading 壳；closeAllModals 供登出彻底清栈。
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { JSDOM } from 'jsdom';
import vm from 'node:vm';

const FILES = [
  'constants.js', 'region-data.js', 'app-display.js', 'app-state.js', 'app-api.js',
  'app-datahub.js', 'app-anim.js', 'app-ui.js', 'app-onboard.js', 'app-region.js',
  'app-posts.js', 'app-chat.js', 'app-contracts.js', 'app-chart.js', 'app-admin.js',
  'app-demands.js', 'app-teachers.js', 'app-style.js', 'app-pages.js', 'app-shell.js', 'app-auth.js',
];

function makeCtx() {
  const html = readFileSync('./index.html', 'utf8')
    .replace(/<script src="\/app-[a-z-]+\.js"><\/script>/g, '');
  const dom = new JSDOM(html, { url: 'http://localhost/', pretendToBeVisual: true, runScripts: 'dangerously' });
  const w = dom.window;
  const ctx = vm.createContext({
    window: w, document: w.document,
    getComputedStyle: w.getComputedStyle.bind(w),
    localStorage: w.localStorage, sessionStorage: w.sessionStorage,
    console: { log() {}, warn() {}, error() {} },
    fetch: async () => ({ ok: true, status: 200, json: async () => ({}) }),
    setTimeout: globalThis.setTimeout, clearTimeout: globalThis.clearTimeout,
    setInterval: globalThis.setInterval, clearInterval: globalThis.clearInterval,
    Request: globalThis.Request, AbortController: globalThis.AbortController,
    performance: globalThis.performance,
    MutationObserver: class { observe() {} disconnect() {} takeRecords() { return []; } },
    Image: class { set src(v) { this._s = v; } },
    requestAnimationFrame: (cb) => setTimeout(cb, 16), cancelAnimationFrame: () => {},
    matchMedia: () => ({ matches: false, addEventListener: () => {} }),
  });
  for (const f of FILES) vm.runInContext(readFileSync('./' + f, 'utf8'), ctx, { filename: f });
  vm.runInContext('window.APP_CONSTANTS = globalThis.APP_CONSTANTS;', ctx);
  // 屏蔽首访欢迎弹窗（onboarding 会覆盖 #modal-container，干扰弹窗断言）
  vm.runInContext(`try { localStorage.setItem('sufe_returning', '1'); } catch (e) {}`, ctx);
  return { dom, ctx };
}

const title = (ctx) => vm.runInContext(
  `(() => { const h = document.querySelector('#modal-container .modal-header h2'); return h ? h.textContent : null; })()`, ctx);

test('核心回归：表单 → 预览 → 关闭 → 下层表单恢复且已输入内容保留', () => {
  const { ctx } = makeCtx();
  vm.runInContext(`
    openModal({ title: '发帖表单', closable: false, body: '<input id="post-title" class="form-input">' });
    document.getElementById('post-title').value = '用户已输入标题';
    openModal({ title: '预览', body: '<p>preview</p>' }); // 表单内开预览 → 压栈
  `, ctx);
  assert.equal(title(ctx), '预览', '顶层是预览');
  vm.runInContext('closeModal();', ctx);
  assert.equal(title(ctx), '发帖表单', '关闭预览后恢复下层表单');
  assert.equal(vm.runInContext('document.getElementById("post-title").value', ctx), '用户已输入标题',
    '表单输入值不丢（节点引用保留，非重建）');
});

test('confirm 二次确认：关闭后恢复下层表单', () => {
  const { ctx } = makeCtx();
  vm.runInContext(`
    openModal({ title: '需求表单', closable: false, body: '<input id="f" value="v">' });
    confirm({ message: '确定要这么做吗？', onConfirm: () => {} });
  `, ctx);
  assert.ok(vm.runInContext(`document.querySelector('#modal-container .confirm-msg') !== null`, ctx),
    '顶层是确认框');
  vm.runInContext('closeModal();', ctx);
  assert.equal(title(ctx), '需求表单', '关闭确认恢复下层表单');
  assert.equal(vm.runInContext('document.getElementById("f").value', ctx), 'v', '表单内容保留');
});

test('replace:true：同流程 loading→表单直接替换，关闭后不恢复旧 loading 壳', () => {
  const { ctx } = makeCtx();
  vm.runInContext(`
    openModal({ title: '加载中', closable: false, body: '<div class="empty-state">loading</div>' });
    openModal({ title: '签约表单', closable: false, replace: true, body: '<div id="form-marker"></div>' });
  `, ctx);
  assert.equal(title(ctx), '签约表单', 'replace 后顶层是表单');
  assert.equal(vm.runInContext('document.querySelectorAll("#modal-container .modal").length', ctx), 1,
    'replace 只保留一个 modal（loading 被替换非压栈）');
  vm.runInContext('closeModal();', ctx);
  assert.equal(vm.runInContext('document.getElementById("modal-container").innerHTML', ctx), '',
    '关闭后容器为空，不复活旧 loading');
});

test('三层连续嵌套：依次弹栈恢复到底，最后清空', () => {
  const { ctx } = makeCtx();
  vm.runInContext(`
    openModal({ title: 'A', body: '1' });
    openModal({ title: 'B', body: '2' });
    openModal({ title: 'C', body: '3' });
  `, ctx);
  assert.equal(title(ctx), 'C', '顶层 C');
  vm.runInContext('closeModal();', ctx);
  assert.equal(title(ctx), 'B', '关 C 恢复 B');
  vm.runInContext('closeModal();', ctx);
  assert.equal(title(ctx), 'A', '关 B 恢复 A');
  vm.runInContext('closeModal();', ctx);
  assert.equal(vm.runInContext('document.getElementById("modal-container").innerHTML', ctx), '',
    '关 A 后栈空清空');
});

test('closeAllModals（登出场景）：清栈 + 清容器，且后续 closeModal 不复活', () => {
  const { ctx } = makeCtx();
  vm.runInContext(`
    openModal({ title: 'A', body: '1' });
    openModal({ title: 'B', body: '2' });
    closeAllModals();
  `, ctx);
  assert.equal(vm.runInContext('document.getElementById("modal-container").innerHTML', ctx), '',
    '登出清空所有弹窗');
  vm.runInContext('closeModal();', ctx);
  assert.equal(vm.runInContext('document.getElementById("modal-container").innerHTML', ctx), '',
    '栈已清空，再 close 不复活任何下层');
});

test('真实路径 openSigningModal：loading→表单（replace），关闭后无 loading 残留', async () => {
  const { ctx } = makeCtx();
  vm.runInContext(`
    state.user = { id: 39, role: 'student', username: 'qa_student' };
    state.authToken = 'x';
  `, ctx);
  await vm.runInContext('openSigningModal(1);', ctx); // fetch mock 返回空 demands
  assert.equal(vm.runInContext('document.querySelectorAll("#modal-container .modal").length', ctx), 1,
    'async 完成后仅一个 modal（loading 被 replace 替换）');
  assert.ok(vm.runInContext(`document.querySelector('#modal-container #signing-demand') !== null`, ctx),
    '顶层是签约表单（含需求下拉）');
  assert.ok(!vm.runInContext(`document.querySelector('#modal-container .empty-state') !== null`, ctx),
    '无 loading 壳残留');
  vm.runInContext('closeModal();', ctx);
  assert.equal(vm.runInContext('document.getElementById("modal-container").innerHTML', ctx), '',
    '关闭表单后容器为空，不恢复 loading');
});

// v0.25.103 B4（用户反馈）：切换侧栏模块必须关闭所有子窗（modal stack）——模块本身入层级树。
// 复现路径：教室列表页点「发送需求」（openModal 新建需求浮窗）→ 页面响应前迅速切侧栏模块 → 浮窗残留。
test('B4 切模块关闭所有子窗：selectPage 后 modal 容器清空（含压栈下层）', () => {
  const { ctx } = makeCtx();
  vm.runInContext(`
    state.user = { id: 1, role: 'teacher', username: 'qa_teacher' };
    state.authToken = 't';
    // 教室列表页打开新建需求浮窗（openModal 压栈两层：底层 A + 新建需求 B）
    openModal({ title: 'A', body: '底层', closable: false });
    openModal({ title: '新建需求', body: '<div id="demand-form-marker"></div>', closable: false });
  `, ctx);
  assert.equal(vm.runInContext('document.querySelectorAll("#modal-container .modal").length', ctx), 1,
    '浮窗已打开（modal 容器有顶层）');
  assert.ok(vm.runInContext('document.querySelector("#modal-container #demand-form-marker") !== null', ctx),
    '顶层是新建需求浮窗');
  // 快速切侧栏模块（用户在浮窗打开后立即点其他模块）
  vm.runInContext('selectPage("my-demands");', ctx);
  assert.equal(vm.runInContext('document.getElementById("modal-container").innerHTML', ctx), '',
    '切模块后 modal 容器清空（浮窗不残留）');
  // 栈已被清：后续 closeModal 不复活任何下层
  vm.runInContext('closeModal();', ctx);
  assert.equal(vm.runInContext('document.getElementById("modal-container").innerHTML', ctx), '',
    '栈已清空，closeModal 不复活下层');
});

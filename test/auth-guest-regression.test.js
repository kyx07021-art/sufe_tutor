/**
 * 用户反馈（2026-08-10）：主站登录教师 → 退登 → 主页点学生客户端入口 → 不自动登录学生、
 * 不进游客客户端、直接弹登录弹窗，且弹窗「返回」按钮没反应。
 *
 * 根因（v0.25.110 修复）：登出前停留在需登录页（如 account-settings），sufe_last_page 残留。
 * 访客进客户端按「上次停留页」恢复该页 → selectPage 触发 ensureAuth → 弹登录页；
 * 「返回」authGoBack 又恢复同一页 → 死循环，返回无效。
 * 修：访客恢复停留页须过 auth 门（只恢复 auth:false 的公开页）。
 *
 * 覆盖：
 *   1. 无学生会话点学生入口 → 学生访客客户端（browse-teachers），不弹登录；
 *   2. 有效学生会话点学生入口 → 自动登录学生客户端（switchToRole）；
 *   3. sufe_last_page 残留需登录页 → 访客不恢复，回落公开页（回归根因）；
 *   4. 登录页「返回」→ 离开登录页进客户端（不死循环）。
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
  'app-complaints.js',
];

function makeCtx({ apiHandlers = {} } = {}) {
  const html = readFileSync('./index.html', 'utf8')
    .replace(/<script src="\/app-[a-z-]+\.js"><\/script>/g, '');
  const dom = new JSDOM(html, { url: 'http://localhost/', pretendToBeVisual: true, runScripts: 'dangerously' });
  const w = dom.window;
  w.HTMLCanvasElement.prototype.getContext = function () { // jsdom 无 canvas：patch 链式 2d 替身（app-captcha 进 boot FILES 后 vm 测试走到 canvas 路径）
    const mk = () => new Proxy(() => {}, { get: (t, k) => (k === 'canvas' ? {} : mk()), apply: () => mk() });
    return mk();
  };
  const errors = [];
  w.addEventListener('error', (e) => errors.push('window.onerror: ' + (e.message || e)));
  const ctx = vm.createContext({
    window: w, document: w.document,
    getComputedStyle: w.getComputedStyle.bind(w),
    localStorage: w.localStorage, sessionStorage: w.sessionStorage,
    console, setTimeout: globalThis.setTimeout, clearTimeout: globalThis.clearTimeout,
    setInterval: globalThis.setInterval, clearInterval: globalThis.clearInterval,
    Request: globalThis.Request, AbortController: globalThis.AbortController,
    performance: globalThis.performance,
    MutationObserver: class { observe() {} disconnect() {} takeRecords() { return []; } },
    Image: class { set src(v) { this._s = v; } },
    requestAnimationFrame: (cb) => setTimeout(cb, 16), cancelAnimationFrame: () => {},
    matchMedia: () => ({ matches: false, addEventListener: () => {} }),
    fetch: async (url) => {
      const u = String(url);
      const h = apiHandlers[u] || apiHandlers['*'];
      if (h) return { ok: true, status: 200, json: async () => h() };
      return { ok: true, status: 200, json: async () => ({}) };
    },
  });
  for (const f of FILES) {
    try { vm.runInContext(readFileSync('./' + f, 'utf8'), ctx, { filename: f }); }
    catch (err) { errors.push(`加载 ${f}: ${err.message}`); }
  }
  vm.runInContext(`
    startVersionProbe = () => {};   // 访客/登录态进客户端会开 setInterval——测试要退出的，桩掉
    startBadgePoll = () => {};
    try { localStorage.setItem('sufe_returning', '1'); } catch (e) {} // 跳过首访引导
  `, ctx);
  return { dom, ctx, errors };
}

/** 确定性 boot：手动派发 DOMContentLoaded + 等 jsdom 自带的迟到派发也跑完（否则中途再触发会干扰断言） */
async function settleBoot(ctx) {
  await vm.runInContext(`document.dispatchEvent(new window.Event('DOMContentLoaded'));`, ctx);
  await new Promise(r => setTimeout(r, 150));
}

const tick = (ms = 20) => new Promise(r => setTimeout(r, ms));
const viewOf = ctx => vm.runInContext(`(function(){const v=id=>{const e=document.getElementById(id);return e&&!e.classList.contains('hidden')};return v('view-landing')?'landing':v('view-login')?'login':v('view-client')?'client':'?'})()`, ctx);

const STUDENT = { id: 39, username: 'qa_student', role: 'student', avatar: '' };

test('无学生会话点学生入口 → 学生访客客户端（browse-teachers），不弹登录', async () => {
  const { ctx, errors } = makeCtx({ apiHandlers: {} });
  await settleBoot(ctx);
  await vm.runInContext(`handleFeatureClick('student')`, ctx);
  await tick(40);
  assert.equal(errors.length, 0, '无 JS 错误：' + errors.join('\n'));
  assert.equal(viewOf(ctx), 'client', '点学生入口应进客户端而非登录页');
  assert.equal(vm.runInContext('state.guestRole', ctx), 'student', '学生访客态');
});

test('有效学生会话点学生入口 → 自动登录学生客户端（switchToRole）', async () => {
  const { ctx } = makeCtx({
    apiHandlers: { '/api/auth/me': () => ({ user: STUDENT }) },
  });
  await settleBoot(ctx);
  // 预置有效学生会话（「以前上过的学生账户」记住登录）
  await vm.runInContext(`
    state.user = ${JSON.stringify(STUDENT)};
    state.authToken = 'stu-token';
    saveSession(true);
    state.user = null; state.authToken = null;
  `, ctx);
  await vm.runInContext(`handleFeatureClick('student')`, ctx);
  await tick(60);
  assert.equal(vm.runInContext('state.user && state.user.role', ctx), 'student', '应自动登录学生账户');
  assert.equal(viewOf(ctx), 'client', '学生客户端视图');
});

test('B1 /me 拒绝不覆盖登出：/me 在途时身份已被替换 → 拒绝回调不回落访客预览', async () => {
  let rejectMe;
  const { ctx, errors } = makeCtx({
    apiHandlers: { '/api/auth/me': () => new Promise((_, rej) => { rejectMe = rej; }) },
  });
  await settleBoot(ctx);
  // 有效学生会话进客户端（switchToRole，/me 挂起中）
  await vm.runInContext(`
    state.user = ${JSON.stringify(STUDENT)};
    state.authToken = 'stu-token';
    saveSession(true);
    state.user = null; state.authToken = null;
  `, ctx);
  await vm.runInContext(`handleFeatureClick('student')`, ctx);
  await tick(20);
  assert.equal(vm.runInContext('state.user && state.user.role', ctx), 'student', '已进学生客户端');
  // /me 在途期间用户登出（身份被清空）——过期拒绝回调不得把它拉回学生访客预览
  vm.runInContext(`state.authToken = null; state.user = null;`, ctx);
  rejectMe(Object.assign(new Error('dead token'), { code: 401 }));
  await tick(30);
  assert.notEqual(vm.runInContext('state.guestRole', ctx), 'student',
    '拒绝回调不得覆盖已发生的登出（B1 身份守卫）');
  assert.equal(errors.length, 0, '无 JS 错误：' + errors.join('\n'));
});

test('sufe_last_page 残留需登录页：访客不恢复，回落公开页（v0.25.110 根因回归）', async () => {
  const { ctx, errors } = makeCtx({ apiHandlers: {} });
  await settleBoot(ctx);
  // 模拟上一角色（教师）在 account-settings 登出 → 停留页残留
  await vm.runInContext(`localStorage.setItem('sufe_last_page', 'account-settings');`, ctx);
  await vm.runInContext(`handleFeatureClick('student')`, ctx);
  await tick(40);
  assert.equal(errors.length, 0, '无 JS 错误：' + errors.join('\n'));
  assert.equal(viewOf(ctx), 'client', `点学生入口应进客户端而非登录页（实际=${viewOf(ctx)}）`);
  assert.equal(vm.runInContext('state.page', ctx), 'browse-teachers', '访客回落公开页（不恢复需登录停留页）');
});

test('登录页「返回」：离开登录页进客户端，不再被需登录停留页拦回（死循环修复）', async () => {
  const { ctx, errors } = makeCtx({ apiHandlers: {} });
  await settleBoot(ctx);
  await vm.runInContext(`localStorage.setItem('sufe_last_page', 'account-settings');`, ctx); // 上一角色残留
  await vm.runInContext(`state.view = 'landing'; ensureAuth();`, ctx); // 落地页触发登录通路
  await tick();
  assert.equal(viewOf(ctx), 'login', 'ensureAuth 导向登录页');
  await vm.runInContext(`authGoBack()`, ctx);
  await tick(40);
  assert.equal(errors.length, 0, 'authGoBack 无 JS 错误：' + errors.join('\n'));
  assert.equal(viewOf(ctx), 'client', `返回应离开登录页进客户端（实际=${viewOf(ctx)}）`);
});

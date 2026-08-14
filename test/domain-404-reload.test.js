/**
 * v0.25.100 发布后资产 404 自愈（老妖根治之二）
 *
 * 实测证据：Pages 部署滚动窗口（发布后约 1-2 分钟）内，manifest 放行的新哈希资产间歇性 404
 * （连续 12 次取 2 次 / 15 次取 4 次，窗口过后全 200）——领域脚本 404 → 模块缺失 → 教师列表/登录加载失败。
 * 修复：loadDomainScripts 注入失败先延迟重试（CONFIG.DOMAIN_SCRIPT_RETRY × RETRY_MS，等边缘同步、
 * 保留页面状态），重试耗尽才整页刷新一次拿新 index.html（内联新 manifest）；__domainReloadOnce 防死循环。
 *
 * jsdom 不自动加载外部 script（load/error 事件不触发），测试手动派发事件驱动注入逻辑。
 * loadDomainScripts 以 loadMyDemands 存在短路，先置空再触发；注入串行 await，首个 script
 * （DOMAIN_FILES[0]=region-data）即承载 onerror 自愈路径。
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { JSDOM } from 'jsdom';
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
  const dom = new JSDOM(html, { url: 'http://localhost/', pretendToBeVisual: true, runScripts: 'dangerously' });
  const w = dom.window;
  w.HTMLCanvasElement.prototype.getContext = function () { // jsdom 无 canvas：patch 链式 2d 替身（app-captcha 进 boot FILES 后 vm 测试走到 canvas 路径）
    const mk = () => new Proxy(() => {}, { get: (t, k) => (k === 'canvas' ? {} : mk()), apply: () => mk() });
    return mk();
  };
  const ctx = vm.createContext({
    window: w, document: w.document, location: w.location,
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
  vm.runInContext(`if (typeof openCaptchaModal === 'function') { const _ocm = openCaptchaModal; openCaptchaModal = (o) => { if (o && o.onPass) o.onPass(); }; }`, ctx); // vm 测试直通拼图（生产走真验证）
  vm.runInContext('window.APP_CONSTANTS = globalThis.APP_CONSTANTS;', ctx);
  vm.runInContext(`try { localStorage.setItem('sufe_returning', '1'); } catch (e) {}`, ctx);
  return { dom, ctx };
}

const tick = () => new Promise(r => setTimeout(r, 40));

test('脚本 404 先延迟重试（窗口内不刷新），重试耗尽才整页刷新自愈', async () => {
  const { ctx, dom } = makeCtx();
  vm.runInContext(`
    globalThis.loadMyDemands = undefined; // 取消 loadDomainScripts 的已载短路
    CONFIG.DOMAIN_SCRIPT_RETRY = 2; CONFIG.DOMAIN_SCRIPT_RETRY_MS = 10; // 测试用小参数
    __domainLoaded = false; __domainLoading = null; __domainReloadOnce = false;
    loadDomainScripts(); // fire-and-forget（jsdom 不自动触发 script 事件，下方手动驱动）
  `, ctx);
  await tick();
  let s = dom.window.document.querySelector('script[src*="region-data"]');
  assert.ok(s, '领域脚本已注入');
  // 第 1 次 404 → 进入重试（未刷新）
  s.dispatchEvent(new dom.window.Event('error'));
  await tick();
  assert.equal(vm.runInContext('__domainReloadOnce', ctx), false, '第一次 404 不刷新（延迟重试等边缘同步）');
  // 重试注入的新脚本（attempt 2）→ 再 404 → 重试耗尽
  s = dom.window.document.querySelectorAll('script[src*="region-data"]');
  s[s.length - 1].dispatchEvent(new dom.window.Event('error'));
  await tick();
  assert.equal(vm.runInContext('__domainReloadOnce', ctx), true,
    '重试耗尽 → 自愈标记置位（整页刷新拿新 manifest）');
});

test('重试期间成功加载则不刷新，领域正常就绪', async () => {
  const { ctx, dom } = makeCtx();
  vm.runInContext(`
    globalThis.loadMyDemands = undefined;
    CONFIG.DOMAIN_SCRIPT_RETRY = 4; CONFIG.DOMAIN_SCRIPT_RETRY_MS = 10;
    __domainLoaded = false; __domainLoading = null; __domainReloadOnce = false;
    loadDomainScripts();
  `, ctx);
  await tick();
  const s = dom.window.document.querySelector('script[src*="region-data"]');
  assert.ok(s, '脚本已注入');
  s.dispatchEvent(new dom.window.Event('error')); // 第一次 404
  await tick();
  // 重试注入的新脚本成功加载
  const all = dom.window.document.querySelectorAll('script[src*="region-data"]');
  all[all.length - 1].dispatchEvent(new dom.window.Event('load'));
  await tick();
  assert.equal(vm.runInContext('__domainReloadOnce', ctx), false, '重试成功不触发刷新');
});

test('A1 重试保序：region-data 404 后重试脚本插回原兄弟位（非 head 末尾，依赖序不破）', async () => {
  const { ctx, dom } = makeCtx();
  vm.runInContext(`
    globalThis.loadMyDemands = undefined;
    CONFIG.DOMAIN_SCRIPT_RETRY = 2; CONFIG.DOMAIN_SCRIPT_RETRY_MS = 10; // RETRY=2：attempt1 404 → 重试 attempt2
    __domainLoaded = false; __domainLoading = null; __domainReloadOnce = false;
    loadDomainScripts();
  `, ctx);
  await tick();
  const scripts = () => [...dom.window.document.querySelectorAll('script[src]')].map(s => s.getAttribute('src'));
  assert.equal(scripts().filter(s => s.includes('region-data')).length, 1, 'region-data 已注入（首个）');
  // region-data 404 → 重试（10ms 后）
  const first = dom.window.document.querySelector('script[src*="region-data"]');
  first.dispatchEvent(new dom.window.Event('error'));
  await tick();
  const all = [...dom.window.document.querySelectorAll('script[src]')];
  const srcs = all.map(s => s.getAttribute('src'));
  // v0.31.0 慢下载双执行修复：失败原脚本被摘除（HTML spec：移除中止待执行），仅重试副本留在原兄弟位
  assert.equal(srcs.filter(s => s.includes('region-data')).length, 1, '原脚本摘除、仅重试副本保留（杜绝双执行重复声明炸页）');
  const retryIdx = srcs.findIndex(s => s.includes('region-data'));
  // 且它必须仍排在 app-style 等依赖者之前（执行序 = DOM 序，依赖序不破）
  const styleIdx = srcs.findIndex(s => s.includes('app-style'));
  assert.ok(retryIdx < styleIdx, '重试的 region-data 仍排在 app-style 之前执行（依赖序不破）');
});

test('T5 并行注入：loadDomainScripts 同 tick 注入全部 12 个领域脚本（F6 瀑布 → 1 波）', async () => {
  const { ctx, dom } = makeCtx();
  const DOMAIN = [
    'region-data', 'app-style', 'app-region', 'app-posts', 'app-chat', 'app-contracts',
    'app-chart', 'app-admin', 'app-demands', 'app-teachers', 'app-pages', 'app-complaints',
  ];
  vm.runInContext(`
    globalThis.loadMyDemands = undefined;
    __domainLoaded = false; __domainLoading = null; __domainReloadOnce = false;
    loadDomainScripts(); // fire-and-forget：Promise.all 同步 append 全部脚本
  `, ctx);
  // 关键断言：此刻（同一同步块后、任何 onload 事件前）全部 12 个 script 已在 DOM——
  // 串行实现只会在首个脚本 onload 后才注入下一个（瀑布），并行实现一次全放。
  // 注：index.html 残留 /constants.js 标签（剥离正则只匹配 app-*），按领域名过滤计数。
  const srcs = [...dom.window.document.querySelectorAll('script[src]')].map(s => s.getAttribute('src'));
  for (const name of DOMAIN) {
    assert.ok(srcs.some(s => s.includes(name)), `${name} 已注入（同 tick 并行）`);
  }
  const injected = srcs.filter(s => DOMAIN.some(name => s.includes(name)));
  assert.equal(injected.length, 12, '全部 12 个领域脚本一次性注入');
});

// v0.31.2（审计 a）回归：挂起超时 fail 摘除原脚本并排程重试后，原脚本晚到触发 onload——
// 说明它已成功加载执行，必须取消已排程的重试，否则重试副本注入后双执行（重复声明炸页）。
test('settled 哨兵：晚到 onload 取消已排程重试（杜绝残余双执行窗口）', async () => {
  const { ctx, dom } = makeCtx();
  vm.runInContext(`
    globalThis.loadMyDemands = undefined;
    CONFIG.DOMAIN_SCRIPT_TIMEOUT_MS = 120; CONFIG.DOMAIN_SCRIPT_RETRY = 2; CONFIG.DOMAIN_SCRIPT_RETRY_MS = 500;
    __domainLoaded = false; __domainLoading = null; __domainReloadOnce = false;
    loadDomainScripts();
  `, ctx);
  const first = dom.window.document.querySelector('script[src*="region-data"]');
  assert.ok(first, '首份 region-data 已注入');
  // 不派发 load/error，轮询等挂起超时（120ms）→ fail 摘除原脚本 + 排程重试（+500ms）
  for (let i = 0; i < 30; i++) {
    await new Promise(r => setTimeout(r, 20));
    if (first.parentNode === null) break;
  }
  assert.equal(first.parentNode, null, '原脚本已被 fail 摘除');
  // 原脚本晚到成功（load 事件派发在被摘除的节点上）→ 应取消重试
  first.dispatchEvent(new dom.window.Event('load'));
  await tick();
  // 等过原重试时点（120+500ms）仍无重试副本注入 → 晚到 onload 已取消重试
  await new Promise(r => setTimeout(r, 620));
  const remaining = [...dom.window.document.querySelectorAll('script[src*="region-data"]')];
  assert.equal(remaining.length, 0, '晚到 onload 后无重试副本注入（settled 哨兵生效）');
  // 注：不断言 __domainReloadOnce——其余 11 个领域脚本各持独立 timer，会在本窗口内自行挂起→
  // 重试→耗尽（置位自愈标记），与本测试验证的 region-data 晚到取消重试无关。
});

// v0.31.0 慢下载双执行修复回归：挂起超时触发重试时，原脚本必须被摘除（否则晚到仍执行 →
// 顶层 const/let 重复声明炸页——发布窗口冷 PoP 单脚本 >6s 时实测反复触发，弹窗打不开/交互失灵）。
test('挂起超时重试：原脚本被摘除，仅重试副本保留（防慢下载晚到双执行）', async () => {
  const { ctx, dom } = makeCtx();
  vm.runInContext(`
    globalThis.loadMyDemands = undefined;
    CONFIG.DOMAIN_SCRIPT_TIMEOUT_MS = 150; CONFIG.DOMAIN_SCRIPT_RETRY = 2; CONFIG.DOMAIN_SCRIPT_RETRY_MS = 30;
    __domainLoaded = false; __domainLoading = null; __domainReloadOnce = false;
    loadDomainScripts(); // fire-and-forget（同步注入即刻在 DOM，T5 已验证）
  `, ctx);
  // 同步注入已发生：在挂起超时（150ms）前捕获首份脚本引用
  const first = dom.window.document.querySelector('script[src*="region-data"]');
  assert.ok(first, '首份 region-data 已注入');
  // 不派发 load/error，轮询等挂起超时（150ms）→ fail 摘除原脚本 + 重试（+30ms 注入）。
  // 轮询（30ms×N）容忍 timer 抖动；重试副本自身的挂起超时在 180+150=330ms，轮询窗口内可捕获。
  let retry = null;
  for (let i = 0; i < 30; i++) {
    await new Promise(r => setTimeout(r, 30));
    const nodes = [...dom.window.document.querySelectorAll('script[src*="region-data"]')];
    if (nodes.length === 1 && nodes[0] !== first) { retry = nodes[0]; break; }
  }
  assert.ok(retry, '挂起重试后重试副本注入');
  assert.equal(first.parentNode, null, '原脚本已从 DOM 摘除（HTML spec：移除中止待执行，晚到不再执行）');
  // 重试副本成功加载 → 自愈标记不置位（不误刷新）
  retry.dispatchEvent(new dom.window.Event('load'));
  await tick();
  assert.equal(vm.runInContext('__domainReloadOnce', ctx), false, '重试成功不触发刷新');
});

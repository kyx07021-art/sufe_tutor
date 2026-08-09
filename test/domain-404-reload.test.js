/**
 * v0.25.100 发布后资产 404 自愈（老妖根治之二）
 *
 * 实测证据：Pages 部署滚动窗口内，manifest 放行的新哈希资产间歇性 404（连续 12 次取 2 次 404，
 * 未改动资产全 200）——领域脚本 404 → 模块缺失 → 教师列表/登录加载失败。
 * 修复：loadDomainScripts 注入失败（onerror）→ 整页刷新一次拿新 index.html（内联新 manifest），
 * __domainReloadOnce 防死循环；刷新恢复登录/页面停留（v0.25.95 会话层），不踢用户。
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
  vm.runInContext('window.APP_CONSTANTS = globalThis.APP_CONSTANTS;', ctx);
  vm.runInContext(`try { localStorage.setItem('sufe_returning', '1'); } catch (e) {}`, ctx);
  return { dom, ctx };
}

const tick = () => new Promise(r => setTimeout(r, 30));

test('领域脚本注入失败（404）触发整页刷新自愈标记，重复失败不重复触发（防死循环）', async () => {
  const { ctx, dom } = makeCtx();
  vm.runInContext(`
    globalThis.loadMyDemands = undefined; // 取消 loadDomainScripts 的已载短路
    __domainLoaded = false; __domainLoading = null; __domainReloadOnce = false;
    loadDomainScripts(); // fire-and-forget（jsdom 不自动触发 script 事件，下方手动驱动）
  `, ctx);
  await tick();
  const s = dom.window.document.querySelector('script[src*="region-data"]'); // 首个注入脚本（onerror 自愈路径）
  assert.ok(s, '领域脚本已注入');
  s.dispatchEvent(new dom.window.Event('error')); // 部署滚动窗口 404 → onerror
  await tick();
  assert.equal(vm.runInContext('__domainReloadOnce', ctx), true,
    '脚本 404 → 自愈标记置位（调度整页刷新拿新 manifest）');
  // 同一脚本再次失败 / 后续脚本失败 → 标记已置位，不再重复触发（防无限刷新死循环）
  s.dispatchEvent(new dom.window.Event('error'));
  await tick();
  assert.equal(vm.runInContext('__domainReloadOnce', ctx), true, '防死循环：重复失败不再重复触发');
});

test('注入成功（onload）不触发刷新自愈', async () => {
  const { ctx, dom } = makeCtx();
  vm.runInContext(`
    globalThis.loadMyDemands = undefined;
    __domainLoaded = false; __domainLoading = null; __domainReloadOnce = false;
    loadDomainScripts();
  `, ctx);
  await tick();
  const s = dom.window.document.querySelector('script[src*="region-data"]');
  assert.ok(s, '脚本已注入');
  s.dispatchEvent(new dom.window.Event('load')); // 成功加载
  await tick();
  assert.equal(vm.runInContext('__domainReloadOnce', ctx), false, '加载成功不触发刷新自愈');
});

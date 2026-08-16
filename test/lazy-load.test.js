/**
 * #175 领域脚本懒加载——首屏只载 boot 脚本，进入客户端才注入领域脚本
 *  - index.html 只同步引用 13 个 boot 脚本（style-pref/constants/display/state/api/datahub/anim/ui/otp/captcha/onboard/shell/auth），
 *    领域脚本（region-data/style/region/posts/chat/contracts/chart/admin/demands/teachers/pages/complaints）不在其中
 *  - loadDomainScripts 幂等：领域函数已存在（测试 FILES 全载）即短路，不创建 script 标签
 *  - mdRender 已上移到 app-ui（boot 共享层）——登录前政策浮窗可用，不依赖领域脚本
 *  - preloadDomainScripts 在 DOMContentLoaded 末尾后台静默预载领域脚本
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { JSDOM } from 'jsdom';
import vm from 'node:vm';

const BOOT = ['style-pref.js','constants.js','app-display.js','app-state.js','app-api.js','app-datahub.js','app-anim.js','app-ui.js','app-otp.js','app-captcha.js','app-onboard.js','app-shell.js','app-auth.js'];
const DOMAIN = ['region-data.js','app-style.js','app-region.js','app-posts.js','app-chat.js','app-contracts.js','app-chart.js','app-admin.js','app-demands.js','app-teachers.js','ui-scale-reflow.js','app-pages.js','app-complaints.js'];
const ALL = [...BOOT, ...DOMAIN];


test('index.html 只同步加载 13 个 boot 脚本（含 style-pref），12 个领域脚本全部移除', () => {
  const html = readFileSync('./index.html', 'utf8');
  const refs = [...html.matchAll(/src="\/([a-z-]+\.js)"/g)].map(m => m[1]);
  assert.deepEqual([...refs].sort(), [...BOOT].sort(), '仅 boot 脚本在位');
  for (const f of DOMAIN) {
    const re = new RegExp('src="/' + f.replace(/\./g, '\\.') + '"');
    assert.ok(!re.test(html), `领域脚本 ${f} 不在 index.html`);
  }
});

test('loadDomainScripts 幂等：领域函数已存在（测试全载）即短路，不注入 script', async () => {
  const dom = new JSDOM('<html><head></head><body></body></html>', { url: 'http://localhost/', runScripts: 'dangerously' });
  const w = dom.window;
  const ctx = vm.createContext({ window: w, document: w.document, localStorage: w.localStorage, sessionStorage: w.sessionStorage,
    console, fetch: async () => ({ ok: true, status: 200, json: async () => ({}) }),
    setTimeout, clearTimeout, setInterval, clearInterval, Request, AbortController, performance,
    MutationObserver: class { observe() {} disconnect() {} takeRecords() { return []; } },
    Image: class { set src(v) { this._s = v; } },
    HTMLCanvasElement: class { getContext() { return new Proxy({}, { get: (t, k) => (k === 'canvas') ? {} : (...a) => ({}) }); } }, requestAnimationFrame: (cb) => setTimeout(cb, 16), cancelAnimationFrame: () => {},
    matchMedia: () => ({ matches: false, addEventListener: () => {} }) });
  for (const f of ALL) vm.runInContext(readFileSync('./' + f, 'utf8'), ctx, { filename: f });
  await vm.runInContext('loadDomainScripts()', ctx);
  assert.equal(dom.window.document.querySelectorAll('script[src]').length, 0, '领域函数已存在 → 不注入任何 script');
});

test('mdRender 在 boot 共享层（app-ui），app-posts 不再定义', () => {
  const ui = readFileSync('./app-ui.js', 'utf8');
  const posts = readFileSync('./app-posts.js', 'utf8');
  assert.ok(ui.includes('function mdRender(src)'), 'mdRender 已上移 app-ui');
  assert.ok(!posts.includes('function mdRender(src)'), 'app-posts 不再持有 mdRender');
  assert.ok(posts.includes('mdRender('), 'app-posts 仍调用（全局函数）');
});

test('ROLE_PAGES enter 全惰性包装：app-shell 顶层不直接引用领域函数', () => {
  const shell = readFileSync('./app-shell.js', 'utf8');
  // 顶层 const ROLE_PAGES 块内不应出现 `enter: 领域函数名`（直接引用）
  const block = shell.split('const ROLE_PAGES = {')[1]?.split('};')[0] || '';
  for (const f of ['loadMyDemands','loadBrowseDemands','loadTeachers','enterAccountSettings','enterAbout','initProfileForm']) {
    assert.ok(!new RegExp(`enter: ${f}\\b`).test(block), `${f} 已改惰性包装`);
  }
  assert.ok(shell.includes('enter: () => loadMyDemands()'), '惰性包装在位');
  assert.ok(shell.includes('enter: () => enterAbout()'), 'about 惰性包装在位');
});

test('A1 审计：ROLE_PAGES 每个页 id 都有对应 data-page section（防 admin-complaint 漏建空白页复发）', () => {
  const shell = readFileSync('./app-shell.js', 'utf8');
  const html = readFileSync('./index.html', 'utf8');
  const block = shell.split('const ROLE_PAGES = {')[1]?.split('};')[0] || '';
  const pageIds = [...block.matchAll(/id: '([a-z0-9-]+)'/g)].map(m => m[1]);
  const sectionIds = [...html.matchAll(/data-page="([^"]+)"/g)].map(m => m[1]);
  assert.ok(pageIds.length >= 20, `ROLE_PAGES 应注册 20+ 页（实际 ${pageIds.length}）`);
  const missing = pageIds.filter(id => !sectionIds.includes(id));
  assert.deepEqual(missing, [], '每个注册页在 index.html 必须有 section（缺失 → selectPage 全隐藏整页空白）');
});

test('#178 后台静默预载：DOMContentLoaded 即调度领域脚本（点击入口下一帧进客户端）', () => {
  const shell = readFileSync('./app-shell.js', 'utf8');
  assert.ok(shell.includes('function preloadDomainScripts()'), '预载调度函数在位');
  assert.ok(shell.includes("requestIdleCallback(run, { timeout: 2000 })"), '空闲回调优先（不挤占首屏）');
  assert.ok(shell.includes('setTimeout(run, 500)'), '无 rIC 环境 setTimeout 兜底');
  assert.ok(shell.includes('preloadDomainScripts(); // #178'), 'DOMContentLoaded 末尾触发预载');
  assert.ok(shell.includes('if (__preloaded) return;'), '幂等防重复调度');
  assert.ok(shell.includes('if (__domainLoading) return __domainLoading;'), '预载与 enterClient 并发注入共享同一 Promise（防重复注入）');
});

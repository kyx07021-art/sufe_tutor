/**
 * 前端启动回归（v0.24.1）
 *
 * 教训来源：
 *   - v0.22.4：loadBrowseDemands 乱序守卫首用 ++loadSeqs[...] = NaN 恒真 → 需求大厅恒停加载占位；
 *   - v0.24.0：桌面端发版后「加载不出 + 登不上」——根因是 SW 服务陈旧/混合资产（已连根拔除）。
 *     Service Worker 删除后，浏览器 HTTP 缓存（Pages 静态资源 max-age=0 + must-revalidate + ETag）
 *     发版后自动重验取新，资产恒新；本测试守卫「客户端启动/加载序」本身不崩——任一脚本加载期
 *     抛错 = 其后脚本不执行 = 整站停在静态占位、登录按钮失效。
 *
 * 覆盖：
 *   - 按 index.html 脚本顺序在 vm 沙箱依次加载全部前端文件，任一加载期异常即失败；
 *   - 真实 index.html DOM 上派发 DOMContentLoaded 完整走一遍启动引导（落地页渲染），
 *     window.onerror / unhandledRejection 全捕获。
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { JSDOM } from 'jsdom';
import { readFileSync } from 'node:fs';
import vm from 'node:vm';

const FILES = [
  'constants.js', 'region-data.js', 'app-display.js', 'app-state.js', 'app-api.js',
  'app-datahub.js', 'app-anim.js', 'app-ui.js', 'app-onboard.js', 'app-region.js',
  'app-posts.js', 'app-chat.js', 'app-contracts.js', 'app-chart.js', 'app-admin.js',
  'app-demands.js', 'app-teachers.js', 'app-style.js', 'app-pages.js', 'app-shell.js', 'app-auth.js',
];

function makeCtx() {
  const html = readFileSync('./index.html', 'utf8')
    .replace(/<script src="\/app-[a-z-]+\.js"><\/script>/g, ''); // 外部脚本改由 vm 注入
  const dom = new JSDOM(html, {
    url: 'http://localhost/', pretendToBeVisual: true, runScripts: 'dangerously',
  });
  const w = dom.window;
  const errors = [];
  w.addEventListener('error', (e) => errors.push('window.onerror: ' + (e.message || e)));
  return {
    ctx: vm.createContext({
      window: w, document: w.document,
      getComputedStyle: w.getComputedStyle.bind(w),
      localStorage: w.localStorage, sessionStorage: w.sessionStorage,
      console, fetch: globalThis.fetch, setTimeout: globalThis.setTimeout,
      clearTimeout: globalThis.clearTimeout, setInterval: globalThis.setInterval,
      clearInterval: globalThis.clearInterval, Request: globalThis.Request,
      MutationObserver: class { observe() {} disconnect() {} takeRecords() { return []; } },
      Image: class { set src(v) { this._s = v; } },
      requestAnimationFrame: (cb) => setTimeout(cb, 16), cancelAnimationFrame: () => {},
      matchMedia: () => ({ matches: false, addEventListener: () => {} }),
    }),
    dom, errors,
  };
}

test('index.html 加载序全脚本无顶层崩溃', () => {
  const { ctx, errors } = makeCtx();
  for (const f of FILES) {
    try { vm.runInContext(readFileSync('./' + f, 'utf8'), ctx, { filename: f }); }
    catch (err) { errors.push(`加载 ${f}: ${err.message}`); }
  }
  assert.deepEqual(errors, [], '任一文件加载期崩溃 = 整站启动即死。\n' + errors.join('\n'));
});

test('真实 DOM 启动引导可执行（落地页渲染不抛错）', async () => {
  const { ctx, dom, errors } = makeCtx();
  for (const f of FILES) {
    try { vm.runInContext(readFileSync('./' + f, 'utf8'), ctx, { filename: f }); }
    catch (err) { errors.push(`加载 ${f}: ${err.message}`); }
  }
  const rejections = [];
  const onRej = (r) => rejections.push(String((r && r.message) || r));
  process.on('unhandledRejection', onRej);
  try {
    await vm.runInContext(`new Promise(res => {
      document.dispatchEvent(new window.Event('DOMContentLoaded'));
      setTimeout(res, 200);
    })`, ctx);
  } catch (err) { errors.push('boot: ' + err.message); }
  await new Promise(r => setTimeout(r, 250));
  process.removeListener('unhandledRejection', onRej);
  assert.deepEqual(errors, [], '启动期同步异常：\n' + errors.join('\n'));
  assert.deepEqual(rejections, [], '启动期异步异常：\n' + rejections.join('\n'));
  const landing = dom.window.document.getElementById('view-landing');
  assert.ok(landing, '落地页 #view-landing 应存在');
  assert.ok(!landing.classList.contains('hidden'), '落地页应处于可见（未 hidden）——v0.24.1 落地页恒为入口');
});

/**
 * V-3-1e CSP 收口浏览器实机验证（playwright chromium；不进 npm test glob，交付前手动跑）。
 * 用法：node test/verify-csp-strict.mjs（内部先跑 npm run build 生成 dist）
 *
 * 验证目标：
 *   1. 注入面四类真实拦截语义（fixture 页与 web/index.html 同源严格 meta CSP）：
 *      内联 script / onclick handler / <style> 元素三路被拦；style 属性数据通道放行
 *      （style-src-attr 'unsafe-inline' 是有意保留，c1/c2 CSS 变量通道 + ui-modal cssText 依赖）。
 *   2. v2 真实页面（dist/v2.html，build 产物）首绘/登录/客户端壳/领域页/弹窗零 CSP 报错：
 *      - returning 上下文（无 onboarding 弹窗）：landing 首绘 → 访客进客户端壳 → sidebar 领域页切换；
 *        另一次加载验证登录视图。
 *      - fresh 上下文（首访）：onboarding 弹窗正常弹出与关闭。
 *      - 全程收集 console/pageerror，断言零 CSP 违规。
 */
import { chromium } from 'playwright';
import { createServer } from 'node:http';
import { readFileSync } from 'node:fs';
import { resolve, sep } from 'node:path';
import { execFileSync } from 'node:child_process';

// 保证 dist 新鲜（verify-captcha 同模式：本地自建验证面；execFileSync 参数数组避免 shell 注入面）
execFileSync(process.execPath, ['scripts/build.mjs'], { stdio: 'inherit' });

const port = 8936;
const base = `http://localhost:${port}`;
// Chromium 违规文案是 "Content Security Policy"（空格），规范名是 Content-Security-Policy（连字符）——两种都匹配
const CSP_RE = /Content[\s-]+Security[\s-]+Policy/i;

const server = createServer((req, res) => {
  const u = (req.url || '/').split('?')[0];
  if (u.startsWith('/api/')) {
    if (u === '/api/health' || u === '/api/keepalive') {
      const b = JSON.stringify({ status: 'ok', ready: true, checks: {} });
      res.writeHead(200, { 'Content-Type': 'application/json' }); res.end(b); return;
    }
    res.writeHead(404, { 'Content-Type': 'application/json' }); res.end(JSON.stringify({ error: 'not found' })); return;
  }
  if (u === '/csp-payload-verify.html') {
    res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
    res.end(readFileSync('test/csp-payload-verify.html')); return;
  }
  const file = u === '/' ? '/v2.html' : u;
  // 路径遍历防御（安全审查）：realpath 约束在 dist/ 内，禁越界读
  const safePath = resolve('dist', '.' + file);
  const distRoot = resolve('dist');
  if (!safePath.startsWith(distRoot + sep)) { res.writeHead(400); res.end(); return; }
  try {
    const body = readFileSync(safePath);
    const type = file.endsWith('.js') ? 'application/javascript'
      : file.endsWith('.css') ? 'text/css'
      : file.endsWith('.html') ? 'text/html; charset=utf-8' : 'application/octet-stream';
    res.writeHead(200, { 'Content-Type': type }); res.end(body);
  } catch {
    res.writeHead(404); res.end('Not Found');
  }
});

function fail(...a) { console.error('✖', ...a); process.exitCode = 1; }
function ok(...a) { console.log('✔', ...a); }

await new Promise(r => server.listen(port, '127.0.0.1', r)); // 只绑回环，不外露网络接口
const browser = await chromium.launch();

try {
  // ---------- 1. 注入面四类真实拦截语义（fixture） ----------
  {
    const page = await browser.newPage();
    // Chromium 的 CSP 违规走 CDP Log.entryAdded（source=security），亦经 console API（error 类型）可见（审计 a0bdd3b F1）
    const cdp = await page.context().newCDPSession(page);
    const cspViolations = [];
    await cdp.send('Log.enable'); // CDP 域必须先 enable 才派发 entryAdded
    cdp.on('Log.entryAdded', ({ entry }) => {
      if (entry && CSP_RE.test(entry.text || '')) cspViolations.push(entry.text);
    });
    await page.goto(base + '/csp-payload-verify.html', { waitUntil: 'load' });
    const inlineRan = await page.evaluate(() => window.__csp_inline === 1);
    await page.click('#csp-onclick');
    const onclickRan = await page.evaluate(() => window.__csp_onclick === 1);
    const elemColor = await page.evaluate(() => getComputedStyle(document.getElementById('csp-elem')).color);
    const attrColor = await page.evaluate(() => getComputedStyle(document.getElementById('csp-attr')).color);
    await page.waitForTimeout(400); // CDP 违规事件异步派发，settle 后再计数

    inlineRan ? fail('内联 script 未拦截（__csp_inline 被置位）') : ok('内联 script 被 script-src 拦');
    onclickRan ? fail('onclick handler 未拦截（__csp_onclick 被置位）') : ok('onclick handler 被 script-src 拦');
    elemColor === 'rgb(1, 2, 3)' ? fail(`<style> 元素注入未被拦（计算色 ${elemColor}）`) : ok('<style> 元素被 style-src-elem 拦');
    attrColor === 'rgb(9, 8, 7)' ? ok(`style 属性数据通道放行（计算色 ${attrColor}）`) : fail(`style 属性数据通道被误拦（计算色 ${attrColor}）`);
    cspViolations.length >= 3
      ? ok(`三路被拦各触发 CSP 违规日志（CDP ${cspViolations.length} 条）`)
      : fail(`CSP 违规日志不足（${cspViolations.length} 条，期望 ≥3 证明真实拦截）：`, cspViolations.join(' | '));
    await page.close();
  }

  // ---------- 2. v2 真实页面：landing 首绘 + 访客进客户端壳 + 领域页切换 ----------
  {
    const page = await browser.newPage();
    const consoleMsgs = [];
    page.on('console', m => consoleMsgs.push(m.text()));
    page.on('pageerror', e => consoleMsgs.push('PAGEERROR: ' + e.message));
    await page.addInitScript(() => { try { localStorage.setItem('sufe_returning', '1'); } catch {} });
    await page.goto(base + '/v2.html', { waitUntil: 'load' });
    await page.waitForTimeout(1500); // boot + version probe settle

    const appChildren = await page.evaluate(() => {
      const app = document.getElementById('app');
      return app ? app.children.length : -1;
    });
    appChildren > 0 ? ok(`landing 首绘（#app ${appChildren} 子节点）`) : fail('landing 未渲染');

    await page.click('[data-action="auth.enterGuest"]');
    await page.waitForSelector('#sidebar-nav .sidebar-item', { timeout: 5000 });
    ok('访客进入客户端壳（#sidebar-nav 渲染）');
    const pageBefore = await page.evaluate(() => document.querySelector('#client-main .client-page:not(.hidden)')?.dataset.page || null);
    ok(`领域页已渲染（${pageBefore}）`);
    await page.click('#sidebar-nav .sidebar-item');
    await page.waitForTimeout(300);
    const pageAfter = await page.evaluate(() => document.querySelector('#client-main .client-page:not(.hidden)')?.dataset.page || null);
    pageAfter !== pageBefore
      ? ok(`领域页切换正常（${pageBefore} → ${pageAfter}）`)
      : fail(`领域页切换无变化（${pageBefore} → ${pageAfter}）`);

    const cspViol = consoleMsgs.filter(m => CSP_RE.test(m));
    cspViol.length === 0 ? ok('客户端链路零 CSP 违规') : fail(`客户端链路 CSP 违规 ${cspViol.length} 条：`, cspViol.join(' | '));
    await page.close();
  }

  // ---------- 3. v2 真实页面：登录视图 ----------
  {
    const page = await browser.newPage();
    const consoleMsgs = [];
    page.on('console', m => consoleMsgs.push(m.text()));
    page.on('pageerror', e => consoleMsgs.push('PAGEERROR: ' + e.message));
    await page.addInitScript(() => { try { localStorage.setItem('sufe_returning', '1'); } catch {} });
    await page.goto(base + '/v2.html', { waitUntil: 'load' });
    await page.waitForTimeout(1000);
    await page.click('[data-action="auth.viewLogin"]');
    await page.waitForSelector('#login-title', { timeout: 5000 });
    ok('登录视图渲染（#login-title）');
    const cspViol = consoleMsgs.filter(m => CSP_RE.test(m));
    cspViol.length === 0 ? ok('登录视图零 CSP 违规') : fail(`登录视图 CSP 违规 ${cspViol.length} 条：`, cspViol.join(' | '));
    await page.close();
  }

  // ---------- 4. v2 真实页面：首访 onboarding 弹窗 ----------
  {
    const page = await browser.newPage();
    const consoleMsgs = [];
    page.on('console', m => consoleMsgs.push(m.text()));
    page.on('pageerror', e => consoleMsgs.push('PAGEERROR: ' + e.message));
    await page.goto(base + '/v2.html', { waitUntil: 'load' });
    await page.waitForSelector('.onboard-intro', { timeout: 5000 });
    ok('首访 onboarding 弹窗渲染（.onboard-intro）');
    await page.click('[data-action="onboard.browseGuest"]');
    await page.waitForSelector('#sidebar-nav .sidebar-item', { timeout: 5000 });
    ok('弹窗引导关闭并进入客户端壳');
    const cspViol = consoleMsgs.filter(m => CSP_RE.test(m));
    cspViol.length === 0 ? ok('弹窗链路零 CSP 违规') : fail(`弹窗链路 CSP 违规 ${cspViol.length} 条：`, cspViol.join(' | '));
    await page.close();
  }

  console.log('\n验证完成。');
} finally {
  await browser.close();
  server.close();
}
if (process.exitCode) process.exit(process.exitCode);

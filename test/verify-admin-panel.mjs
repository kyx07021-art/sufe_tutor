/**
 * U-5：admin 面板 13 管理页生产实机验证（G5 几何 + 零 console/pageerror/CSP）。
 * 真实生产 https://sufe-tutor.pages.dev，admin 登录 → 遍历全部管理页 →
 * 断言列表/图表容器渲染（非初始 loader、非错误态）+ 全程零 JS/CSP 违规。
 * 用法：ADMIN_TEST_PASSWORD=<口令> node test/verify-admin-panel.mjs
 * （admin 生产口令只存 Worker Secrets，仓库不记录明文；CLAUDE.md 常量 admin_sufe_07210）
 * 不进 npm test glob。
 */
import { createRequire } from 'node:module';
const require = createRequire(import.meta.url);
const { chromium } = require('playwright');

const BASE = 'https://sufe-tutor.pages.dev';
const USER = process.env.ADMIN_TEST_USER || 'admin_sufe_07210';
const PASS = process.env.ADMIN_TEST_PASSWORD;
if (!PASS) { console.error('需要 ADMIN_TEST_PASSWORD=<生产口令> node test/verify-admin-panel.mjs'); process.exit(2); }
let failures = 0;
const fail = (...a) => { console.error('✖', ...a); failures++; };
const ok = (...a) => { console.log('✔', ...a); };

// pageId -> 主列表/内容容器（shell.js 静态骨架 + 各 loader getElementById 目标）
const PAGES = [
  ['admin-stats', 'admin-stats-box'],
  ['admin-traffic', 'admin-traffic-box'],
  ['admin-students', 'admin-students-list'],
  ['admin-teachers', 'admin-teachers-list'],
  ['admin-demands', 'admin-demands-list'],
  ['admin-reviews', 'admin-reviews-list'],
  ['admin-awards', 'admin-awards-list'],
  ['admin-verifications', 'admin-verifications-list'],
  ['admin-posts', 'admin-posts-list'],
  ['admin-contracts', 'admin-contracts-list'],
  ['admin-feedback', 'admin-feedback-list'],
  ['admin-content', 'admin-content-list'],
  ['admin-complaint', 'admin-complaint-list'],
];

const browser = await chromium.launch();

async function checkPage(page) {
  const issues = [];
  page.on('console', m => { if (m.type() === 'error') issues.push('console: ' + m.text()); });
  page.on('pageerror', e => issues.push('pageerror: ' + e.message));
  const cdp = await page.context().newCDPSession(page);
  const csp = [];
  await cdp.send('Log.enable');
  cdp.on('Log.entryAdded', e => { const t = e.entry && e.entry.text || ''; if (/Content Security Policy/i.test(t)) csp.push(t); });
  return { issues, csp };
}

async function login(page) {
  await page.goto(BASE + '/', { waitUntil: 'load' });
  await page.waitForTimeout(2500);
  const mask = page.locator('.modal-overlay').first();
  if (await mask.count() && await mask.isVisible()) {
    await mask.click({ position: { x: 5, y: 5 } });
    await page.waitForTimeout(600);
  }
  const deviceId = 'av-' + Math.random().toString(36).slice(2, 10);
  const resp = await page.evaluate(async ({ u, p, d }) => {
    const r = await fetch('/api/auth/login', {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ identifier: u, password: p, deviceId: d }),
    });
    return { status: r.status, body: await r.text() };
  }, { u: USER, p: PASS, d: deviceId });
  const data = JSON.parse(resp.body);
  if (resp.status !== 200 || !data.authToken) throw new Error('admin login failed ' + resp.status + ' ' + String(resp.body).slice(0, 200));
  await page.evaluate(({ user, authToken, role }) => {
    localStorage.setItem('sufe_session_' + role, JSON.stringify({ user, authToken, expires: Date.now() + 7 * 86400000 }));
    localStorage.setItem('sufe_last_role', role);
    localStorage.setItem('sufe_returning', '1');
  }, { user: data.user, authToken: data.authToken, role: data.user.role });
  await page.reload();
  await page.waitForTimeout(3000);
}

// 单 viewport 全页遍历
async function walkPages(page, label) {
  const watch = await checkPage(page);
  await login(page);
  const g = await page.evaluate(() => ({
    role: (JSON.parse(localStorage.getItem('sufe_session_admin') || 'null') || {}).user?.role,
    inShell: !!document.querySelector('#sidebar-nav .sidebar-item'),
    noHScroll: document.documentElement.scrollWidth <= innerWidth + 1,
  }));
  if (g.role === 'admin') ok(`${label} admin 会话生效`);
  else fail(`${label} 未以 admin 登录: ` + JSON.stringify(g));
  if (g.inShell) ok(`${label} 进入客户端壳`);
  else fail(`${label} 客户端壳未渲染`);
  for (const [pageId, boxId] of PAGES) {
    const item = page.locator(`#sidebar-nav [data-page="${pageId}"]`);
    if (!(await item.count())) { fail(`${label} ${pageId} 侧栏页项缺失`); continue; }
    await item.click();
    await page.waitForTimeout(1800);
    const st = await page.evaluate((boxId) => {
      const el = document.getElementById(boxId);
      if (!el) return { missing: true, html: '' };
      return { missing: false, len: el.innerHTML.length, text: (el.textContent || '').slice(0, 40), viewError: !!document.querySelector('.view-error'), scrollW: document.documentElement.scrollWidth, innerW: innerWidth };
    }, boxId);
    const noHScroll = !st.missing && st.scrollW <= st.innerW + 1;
    if (st.missing) fail(`${label} ${pageId} 容器 #${boxId} 缺失`);
    else if (st.len <= 0 || st.viewError) fail(`${label} ${pageId} 容器空或错误视图: ${JSON.stringify(st)}`);
    else if (!noHScroll) fail(`${label} ${pageId} 横向溢出: scrollW=${st.scrollW} innerW=${st.innerW}`);
    else ok(`${label} ${pageId} 渲染（${st.len} 字节）`);
  }
  await page.waitForTimeout(600);
  if (watch.issues.length) { fail(`${label} JS 错误 ${watch.issues.length} 条`); watch.issues.slice(0, 8).forEach(i => console.error('   ', i)); }
  else ok(`${label} 零 console/pageerror`);
  if (watch.csp.length) { fail(`${label} CSP 违规 ${watch.csp.length} 条`); }
  else ok(`${label} 零 CSP 违规`);
  await page.close();
}

{
  const page = await browser.newPage({ viewport: { width: 1440, height: 900 } });
  await walkPages(page, '桌面端');
}
{
  const page = await browser.newPage({ viewport: { width: 390, height: 844 } });
  await walkPages(page, '移动端');
}
await browser.close();
console.log(failures ? `\n${failures} 处失败` : '\n全部通过');
process.exit(failures ? 1 : 0);

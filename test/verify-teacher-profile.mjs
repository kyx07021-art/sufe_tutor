/**
 * Z-3-F1 F1g：教师档案页生产实机验证（G5 几何断言 + W43 首访心智 + 零 CSP 违规）。
 * 真实生产 https://sufe-tutor.pages.dev，qa_teacher 登录 → teacher-profile 页 →
 * 断言四区表单 + 核验区块渲染在视口内 + 全程零 console/pageerror/CSP 违规。
 * 用法：node test/verify-teacher-profile.mjs（需 playwright；不进 npm test glob）
 */
import { createRequire } from 'node:module';
const require = createRequire(import.meta.url);
const { chromium } = require('playwright');

const BASE = 'https://sufe-tutor.pages.dev';
const USER = 'qa_teacher';
const PASS = 'SufeQa2026!';
let failures = 0;
const fail = (...a) => { console.error('✖', ...a); failures++; };
const ok = (...a) => { console.log('✔', ...a); };

const browser = await chromium.launch();

async function checkPage(page, label) {
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
  // 首访 onboarding（closable:true）：点遮罩关闭（W43 负路径 = 用户可能先点页面/遮罩）
  await page.goto(BASE + '/', { waitUntil: 'load' });
  await page.waitForTimeout(2500);
  const mask = page.locator('.modal-overlay').first();
  if (await mask.count() && await mask.isVisible()) {
    await mask.click({ position: { x: 5, y: 5 } }); // 点遮罩边缘关闭（非 ✕，验证 closable 路径）
    await page.waitForTimeout(600);
  }
  // API 直登注入会话（UI 登录有滑块验证码，非本页验证目标；qa 固定测试账户）
  const deviceId = 'vf-' + Math.random().toString(36).slice(2, 10);
  const resp = await page.evaluate(async ({ u, p, d }) => {
    const r = await fetch('/api/auth/login', {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ identifier: u, password: p, deviceId: d }),
    });
    return { status: r.status, body: await r.text() };
  }, { u: USER, p: PASS, d: deviceId });
  const data = JSON.parse(resp.body);
  if (resp.status !== 200 || !data.authToken) throw new Error('login failed ' + resp.status + ' ' + String(resp.body).slice(0, 200));
  await page.evaluate(({ user, authToken, role }) => {
    localStorage.setItem('sufe_session_' + role, JSON.stringify({ user, authToken, expires: Date.now() + 7 * 86400000 }));
    localStorage.setItem('sufe_last_role', role);
    localStorage.setItem('sufe_returning', '1');
  }, { user: data.user, authToken: data.authToken, role: data.user.role });
  await page.reload();
  await page.waitForTimeout(3000);
}

// 桌面端：登录 → teacher-profile → 表单 + 核验区块几何
{
  const page = await browser.newPage({ viewport: { width: 1440, height: 900 } });
  const watch = await checkPage(page, 'desktop');
  await login(page);
  // 侧栏教师档案页项（F1b 注册，教师角色可见）
  const sideItem = page.locator('#sidebar-nav [data-page="teacher-profile"]');
  if (!(await sideItem.count())) { fail('教师侧栏无 teacher-profile 页项'); await page.screenshot({ path: '$CLAUDE_JOB_DIR'.replace('$CLAUDE_JOB_DIR', process.env.CLAUDE_JOB_DIR || 'tmp') + '/f1g-nosideitem.png' }).catch(() => {}); }
  else await sideItem.click();
  await page.waitForTimeout(2500);
  const g = await page.evaluate(() => {
    const rect = el => { if (!el) return null; const r = el.getBoundingClientRect(); return { y: Math.round(r.y), h: Math.round(r.height), bottom: Math.round(r.bottom), inViewport: r.y >= 0 && r.bottom <= innerHeight && r.height > 0 }; };
    return {
      form: !!document.querySelector('.profile-form'),
      verify: !!document.getElementById('teacher-verify'),
      verifyRect: rect(document.getElementById('teacher-verify')),
      tag: document.getElementById('teacher-verify') ? document.getElementById('teacher-verify').textContent : '',
      hasErrorEl: !!document.querySelector('.view-error'),
    };
  });
  if (g.form) ok('四区档案表单渲染');
  else fail('档案表单未渲染');
  if (!g.verify) fail('核验区块未渲染');
  else {
    // 核验区块在表单下方（合理布局）：滚动可达 + 进入视口 + 无横向溢出（G5 几何）
    await page.evaluate(() => document.getElementById('teacher-verify').scrollIntoView({ block: 'center' }));
    await page.waitForTimeout(600);
    const v2 = await page.evaluate(() => {
      const el = document.getElementById('teacher-verify');
      const r = el.getBoundingClientRect();
      return { y: Math.round(r.y), h: Math.round(r.height), bottom: Math.round(r.bottom), inViewport: r.y >= 0 && r.bottom <= innerHeight && r.height > 0, scrollW: document.documentElement.scrollWidth, innerW: innerWidth };
    });
    const noHScroll = v2.scrollW <= v2.innerW + 1;
    if (v2.inViewport && v2.h > 0 && noHScroll) ok('核验区块滚动可达、在视口内、无横向溢出（G5）');
    else fail('核验区块几何异常: ' + JSON.stringify(v2));
  }
  if (g.tag.includes('验证学信网') || g.tag.includes('核验')) ok('核验区块标题在位');
  else fail('核验区块标题缺失: ' + g.tag.slice(0, 60));
  if (g.hasErrorEl) fail('出现错误视图');
  else ok('零错误视图');
  await page.waitForTimeout(800);
  await page.close();
  if (watch.issues.length) { fail('桌面端 JS 错误 ' + watch.issues.length + ' 条'); watch.issues.slice(0, 5).forEach(i => console.error('   ', i)); }
  else ok('桌面端零 console/pageerror');
  if (watch.csp.length) { fail('桌面端 CSP 违规 ' + watch.csp.length + ' 条'); }
  else ok('桌面端零 CSP 违规');
}

// 移动端：teacher-profile 核验区块不溢出视口
{
  const page = await browser.newPage({ viewport: { width: 390, height: 844 } });
  const watch = await checkPage(page, 'mobile');
  await login(page);
  const sideItem = page.locator('#sidebar-nav [data-page="teacher-profile"]');
  if (await sideItem.count()) await sideItem.click();
  await page.waitForTimeout(2500);
  const g = await page.evaluate(() => ({ verify: !!document.getElementById('teacher-verify') }));
  if (g.verify) {
    await page.evaluate(() => document.getElementById('teacher-verify').scrollIntoView({ block: 'center' }));
    await page.waitForTimeout(600);
    const v2 = await page.evaluate(() => {
      const r = document.getElementById('teacher-verify').getBoundingClientRect();
      return { y: Math.round(r.y), h: Math.round(r.height), bottom: Math.round(r.bottom), inViewport: r.y >= 0 && r.bottom <= innerHeight && r.height > 0, scrollW: document.documentElement.scrollWidth, innerW: innerWidth };
    });
    const noHScroll = v2.scrollW <= v2.innerW + 1;
    if (v2.inViewport && v2.h > 0 && noHScroll) ok('移动端核验区块滚动可达、在视口内、无横向溢出');
    else fail('移动端核验区块几何异常: ' + JSON.stringify(v2));
  } else fail('移动端核验区块未渲染');
  await page.close();
  if (watch.issues.length) { fail('移动端 JS 错误 ' + watch.issues.length + ' 条'); watch.issues.slice(0, 5).forEach(i => console.error('   ', i)); }
  else ok('移动端零 console/pageerror');
  if (watch.csp.length) fail('移动端 CSP 违规 ' + watch.csp.length + ' 条');
  else ok('移动端零 CSP 违规');
}

await browser.close();
if (failures) { console.error(`✖ 教师档案页验证失败 ${failures} 项`); process.exit(1); }
console.log('✔ 教师档案页生产实机验证全通过');
process.exit(0);

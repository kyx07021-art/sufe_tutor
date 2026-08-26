/**
 * ZD-13：v2.1.0（签约/合同休眠批）生产实机验证。
 * 覆盖：教师档案联系方式「建立会话后可见」（ZD-2 正向，写入→学生验证→还原）→
 * 侧栏无签约/合同页 → chat 加号菜单仅附件 → 聊天正常发送 → 存量历史消息渲染 →
 * 首访 onboarding → 全程零 console/pageerror/CSP 违规。
 * 用法：node test/verify-zd13-online.mjs（需 playwright；不进 npm test glob）
 * 注意：v2 登录限流 8/10min/IP，本脚本固定 2 次登录（qa_teacher/qa_student）。
 */
import { createRequire } from 'node:module';
const require = createRequire(import.meta.url);
const { chromium } = require('playwright');

const BASE = 'https://sufe-tutor.pages.dev';
const TEACHER = process.env.QA_TEACHER_USER || 'qa_teacher';
const STUDENT = 'qa_student';
const PASS = process.env.QA_TEACHER_PASS || 'SufeQa2026!';

let failures = 0;
const fail = (...a) => { console.error('✖', ...a); failures++; };
const ok = (...a) => { console.log('✔', ...a); };

async function login(u, p, deviceId) {
  const r = await fetch(BASE + '/api/auth/login', {
    method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ identifier: u, password: p, deviceId }),
  });
  const body = await r.text();
  if (r.status !== 200) throw new Error(`login ${u} ${r.status} ${body.slice(0, 160)}`);
  const j = JSON.parse(body);
  return { user: j.user, authToken: j.authToken };
}

async function apiGet(path, token) {
  const r = await fetch(BASE + path, { headers: token ? { 'X-Auth-Token': token } : {} });
  return { status: r.status, json: await r.json().catch(() => null) };
}

// 冷却：等待登录限流窗口（若上一轮验证已触发 429）
console.log('冷却 30s（v2 登录限流 8/10min/IP）…');
await new Promise(r => setTimeout(r, 30000));

// ---- 1. ZD-2 正向：教师写入临时联系方式 → 学生（有会话）可见 → 还原 ----
const dev = 'zd13-' + Date.now();
let te, st;
try {
  te = await login(TEACHER, PASS, dev + '-t');
  st = await login(STUDENT, PASS, dev + '-s');
} catch (e) {
  fail('登录失败（可能仍限流）: ' + e.message);
  console.error('请稍后重跑本脚本（限流窗口 10 分钟）。');
  process.exit(1);
}

{
  const me = (await apiGet('/api/teacher/profile', te.authToken)).json;
  const profile = me.profile;
  if (!profile) { fail('教师档案读取为空'); }
  else {
    const orig = { wechat: profile.wechat, email: profile.email, real_name: profile.real_name };
    profile.wechat = 'zd13-test-wechat'; profile.email = 'zd13@test.cn'; profile.real_name = 'QA测试教师';
    const save = await fetch(BASE + '/api/teacher/profile', {
      method: 'POST', headers: { 'Content-Type': 'application/json', 'X-Auth-Token': te.authToken },
      body: JSON.stringify({ profile }),
    });
    if (save.status !== 200) fail('档案保存失败 ' + save.status);
    const detail = (await apiGet('/api/teacher/profile?userId=' + te.user.id, st.authToken)).json.profile;
    if (detail && detail.wechat === 'zd13-test-wechat' && detail.email === 'zd13@test.cn' && detail.real_name === 'QA测试教师') {
      ok('ZD-2 正向：建立会话后学生可见 wechat/email/real_name');
    } else {
      fail('ZD-2 联系方式不可见 matched=' + (detail && detail.matched) + ' wechat=' + JSON.stringify(detail && detail.wechat));
    }
    // 还原（审计中项修复：断言还原响应 2xx + 回读确认字段已还原，防测试数据残留生产 QA 档案）
    profile.wechat = orig.wechat; profile.email = orig.email; profile.real_name = orig.real_name;
    const restore = await fetch(BASE + '/api/teacher/profile', {
      method: 'POST', headers: { 'Content-Type': 'application/json', 'X-Auth-Token': te.authToken },
      body: JSON.stringify({ profile }),
    });
    const restored = (await apiGet('/api/teacher/profile', te.authToken)).json.profile || {};
    if (restore.status === 200 && restored.wechat === (orig.wechat || '') && restored.email === (orig.email || '') && restored.real_name === (orig.real_name || '')) {
      ok('QA 档案已还原（响应 2xx + 回读字段逐位一致）');
    } else {
      fail('档案还原失败 status=' + restore.status + ' 回读 wechat=' + JSON.stringify(restored.wechat));
    }
  }
}

// 会话 20 消息种类盘点（存量历史气泡渲染依据）
{
  const msgs = (await apiGet('/api/conversations/20/messages', st.authToken)).json;
  const list = Array.isArray(msgs) ? msgs : (msgs.messages || []);
  const kinds = [...new Set(list.map(m => m.kind).filter(Boolean))];
  console.log('  会话 20 消息种类:', JSON.stringify(kinds), '条数', list.length);
}

// ---- 2. 浏览器实机（注入会话，零额外登录） ----
const browser = await chromium.launch();

async function watchPage(page) {
  const issues = [];
  page.on('console', m => { if (m.type() === 'error') issues.push('console: ' + m.text()); });
  page.on('pageerror', e => issues.push('pageerror: ' + e.message));
  const cdp = await page.context().newCDPSession(page);
  const csp = [];
  await cdp.send('Log.enable');
  cdp.on('Log.entryAdded', e => { const t = (e.entry && e.entry.text) || ''; if (/Content Security Policy/i.test(t)) csp.push(t); });
  return { issues, csp };
}

function injectSession(initScriptOpts) {
  return { addInitScript: async (ctx) => ctx.addInitScript(({ user, authToken, role }) => {
    localStorage.setItem('sufe_session_' + role, JSON.stringify({ user, authToken, expires: Date.now() + 7 * 86400000 }));
    localStorage.setItem('sufe_last_role', role);
    localStorage.setItem('sufe_returning', '1');
  }, initScriptOpts) };
}

// 2a. 学生端：侧栏无签约页 + chat 加号仅附件 + 发送消息
{
  const ctx = await browser.newContext({ viewport: { width: 1440, height: 900 } });
  await injectSession({ user: st.user, authToken: st.authToken, role: st.user.role }).addInitScript(ctx);
  const page = await ctx.newPage();
  const watch = await watchPage(page);
  await page.goto(BASE + '/', { waitUntil: 'load' });
  await page.waitForTimeout(3500);

  // 侧栏无 contract 页
  const sidebarPages = await page.evaluate(() => [...document.querySelectorAll('#sidebar-nav [data-page]')].map(el => el.getAttribute('data-page')));
  if (sidebarPages.includes('my-contracts')) fail('学生侧栏仍有 my-contracts');
  else ok('学生侧栏无 my-contracts（休眠生效）; 页项=' + sidebarPages.join(','));
  if (sidebarPages.includes('admin-contracts')) fail('学生侧栏仍有 admin-contracts');

  // 进入会话页（chat 模块注册 id=my-chats；v2 无首行自动打开，需点击会话项）
  await page.evaluate(() => { const el = document.querySelector('#sidebar-nav [data-page="my-chats"]'); if (el) el.click(); });
  await page.waitForTimeout(2500);
  const convItem = page.locator('[data-action="chat.openConv"]').first();
  if (await convItem.count()) {
    await convItem.click();
    await page.waitForTimeout(2500); // 打开会话 20（含存量 signing/contract 历史气泡渲染）
  } else {
    fail('会话列表为空（未找到 chat.openConv 项）');
  }
  // 加号菜单：仅附件（图片/文件），无签约/合同
  const plusBtn = page.locator('.chat-plus-btn[data-action="chat.plus"]');
  if (await plusBtn.count()) {
    await plusBtn.click();
    await page.waitForTimeout(600);
    const pop = await page.evaluate(() => {
      const wrap = document.getElementById('chat-plus-wrap');
      const open = wrap && wrap.classList.contains('open');
      const labels = [...document.querySelectorAll('.chat-plus-pop .chat-pop-item')].map(l => l.textContent.trim());
      return { open, labels };
    });
    if (pop.open) ok('加号菜单打开');
    else fail('加号菜单未打开');
    if (pop.labels.length === 2 && pop.labels.includes('图片') && pop.labels.includes('文件')) {
      ok('加号菜单仅「图片/文件」（无签约/合同入口）: ' + pop.labels.join('/'));
    } else {
      fail('加号菜单项异常: ' + JSON.stringify(pop.labels));
    }
    await page.keyboard.press('Escape');
    await page.waitForTimeout(400);
  } else {
    fail('未找到加号按钮（chat.plus）');
  }

  // 发送一条消息
  const input = page.locator('textarea#chat-input');
  if (await input.count()) {
    await input.fill('ZD-13 线上冒烟 ' + Date.now());
    await input.press('Enter');
    await page.waitForTimeout(2500);
    const sent = await page.evaluate(() => {
      const bubbles = [...document.querySelectorAll('.chat-bubble[data-mid]')];
      return bubbles.some(b => b.textContent.includes('ZD-13 线上冒烟'));
    });
    if (sent) ok('聊天发送成功（消息气泡出现）');
    else fail('发送后气泡未出现');
  } else {
    fail('未找到聊天输入框 #chat-input');
  }
  await page.waitForTimeout(800);
  await page.close();
  if (watch.issues.length) { fail('学生端 JS 错误 ' + watch.issues.length + ' 条'); watch.issues.slice(0, 5).forEach(i => console.error('   ', i)); }
  else ok('学生端零 console/pageerror');
  if (watch.csp.length) fail('学生端 CSP 违规 ' + watch.csp.length + ' 条');
  else ok('学生端零 CSP 违规');
  await ctx.close();
}

// 2b. 教师端：侧栏无 my-contracts
{
  const ctx = await browser.newContext({ viewport: { width: 1440, height: 900 } });
  await injectSession({ user: te.user, authToken: te.authToken, role: te.user.role }).addInitScript(ctx);
  const page = await ctx.newPage();
  const watch = await watchPage(page);
  await page.goto(BASE + '/', { waitUntil: 'load' });
  await page.waitForTimeout(3000);
  const sidebarPages = await page.evaluate(() => [...document.querySelectorAll('#sidebar-nav [data-page]')].map(el => el.getAttribute('data-page')));
  if (sidebarPages.includes('my-contracts')) fail('教师侧栏仍有 my-contracts');
  else ok('教师侧栏无 my-contracts; 页项=' + sidebarPages.join(','));
  await page.close();
  if (watch.issues.length) { fail('教师端 JS 错误 ' + watch.issues.length + ' 条'); }
  else ok('教师端零 console/pageerror');
  if (watch.csp.length) fail('教师端 CSP 违规');
  else ok('教师端零 CSP 违规');
  await ctx.close();
}

// 2c. 首访 onboarding（全新 context 零缓存，W43 心智）
{
  const ctx = await browser.newContext({ viewport: { width: 1440, height: 900 } });
  const page = await ctx.newPage();
  const watch = await watchPage(page);
  await page.goto(BASE + '/', { waitUntil: 'load' });
  await page.waitForTimeout(3000);
  const modal = await page.evaluate(() => {
    const ov = document.querySelector('.modal-overlay');
    const intro = document.querySelector('.onboard-intro, [data-cap*="onboard"], .tour-pop, [class*="tour"]');
    return { overlay: !!ov, intro: !!intro };
  });
  if (modal.overlay || modal.intro) {
    ok('首访 onboarding 弹出');
    const mask = page.locator('.modal-overlay').first();
    if (await mask.count() && await mask.isVisible()) { await mask.click({ position: { x: 5, y: 5 } }); await page.waitForTimeout(600); ok('遮罩点击关闭（closable 路径）'); }
  } else {
    fail('首访未出现 onboarding 浮层');
  }
  await page.close();
  if (watch.issues.length) { fail('首访 JS 错误 ' + watch.issues.length + ' 条'); watch.issues.slice(0, 5).forEach(i => console.error('   ', i)); }
  else ok('首访零 console/pageerror');
  if (watch.csp.length) fail('首访 CSP 违规 ' + watch.csp.length + ' 条');
  else ok('首访零 CSP 违规');
  await ctx.close();
}

await browser.close();
if (failures) { console.error(`✖ ZD-13 线上验证失败 ${failures} 项`); process.exit(1); }
console.log('✔ ZD-13 线上实机验证全通过');
process.exit(0);

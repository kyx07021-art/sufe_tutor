// v0.28.0 生产验证：打招呼消息全链路（M1）——qa_student 推送带消息 / qa_teacher 意向带消息 / 超限 400 / 卡片渲染
// 用 QA 固定账户；临时需求验证后删除，不污染生产数据。
import { chromium } from 'playwright';

const BASE = 'https://sufe-tutor.pages.dev';
const results = [];
const ok = (name, pass, detail = '') => results.push(`${pass ? 'PASS' : 'FAIL'} ${name}${detail ? ' | ' + detail : ''}`);

const AUTH = async (identifier, password) => {
  const r = await fetch(BASE + '/api/auth/login', {
    method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ identifier, password }),
  });
  if (r.status !== 200) throw new Error(`login ${identifier} failed: ${r.status} ${await r.text()}`);
  return r.json();
};
const J = h => ({ ...h, 'Content-Type': 'application/json' });
const post = (url, token, body) => fetch(BASE + url, { method: 'POST', headers: J(token ? { 'X-Auth-Token': token } : {}), body: JSON.stringify(body) });
const del = (url, token) => fetch(BASE + url, { method: 'DELETE', headers: J({ 'X-Auth-Token': token }) });

let demandId = null, stuTok = null, tchTok = null;
const greetStu = '老师您好，孩子初二数学偏弱，看到您带过三届中考班，想请您试试。';
const greetTch = '我教初中数学五年，带过三届中考班，对您孩子的分数情况很有把握。';

try {
  const stu = await AUTH('qa_student', 'SufeQa2026!');
  const tch = await AUTH('qa_teacher', 'SufeQa2026!');
  stuTok = stu.authToken; tchTok = tch.authToken;
  ok('登录 qa_student/qa_teacher', true, `student=${stu.user.id} teacher=${tch.user.id}`);

  // 1) 学生建一条临时需求（上海，线下）
  const create = await post('/api/student/demands', stuTok, {
    demand: { province: 'shanghai', student_grade: 'senior1', student_gender: 'female',
      target_type: 'academic', target_subjects: ['math'], current_scores: [],
      teaching_method: 'offline', address: '杨浦区', additional_info: '',
      budget_min: 100, budget_max: 200, submitter_type: 'parent',
      parent_contact: '13800138000', student_contact: '13900139000' },
  });
  const created = await create.json();
  ok('创建临时需求', create.status === 200, JSON.stringify(created).slice(0, 60));
  demandId = created.id;
  if (!demandId) { console.log(results.join('\n')); process.exit(1); }

  // 2) 学生带打招呼消息推送 → 201
  const push = await post('/api/demand-pushes', stuTok, { teacherUserId: tch.user.id, demandId, message: greetStu });
  ok('推送带打招呼消息', push.status === 201, `status=${push.status}`);

  // 3) 教师侧取推送 → push_message 透传
  const pushes = await (await fetch(BASE + '/api/demand-pushes', { headers: { 'X-Auth-Token': tchTok } })).json();
  const myPush = (pushes.pushes || []).find(p => p.id === demandId && p.push_message === greetStu);
  ok('教师推送列表透传 push_message', !!myPush, myPush ? '' : JSON.stringify(pushes.pushes || []).slice(0, 120));

  // 4) 学生推送超长 → 400 + 专用文案
  const overPush = await post('/api/demand-pushes', stuTok, { teacherUserId: tch.user.id, demandId, message: '啊'.repeat(301) });
  const overPushBody = await overPush.json();
  ok('推送超长拒绝 400', overPush.status === 400, `status=${overPush.status}`);
  ok('推送超长文案专用', overPushBody.error === '打招呼消息太长（上限 300 字）', overPushBody.error);

  // 5) 前端 UI 走查（playwright）：注入教师会话 → 需求大厅推送卡渲染「学生留言」引用块 + 全文
  let browser = null;
  try {
    browser = await chromium.launch({ executablePath: 'C:/Program Files/Google/Chrome/Application/chrome.exe', headless: true });
    const page = await browser.newPage({ viewport: { width: 1280, height: 900 } });
    page.on('dialog', d => d.dismiss().catch(() => {}));
    await page.addInitScript(({ user, authToken }) => {
      try { localStorage.clear(); sessionStorage.clear(); } catch {}
      // 本地会话须带未来 expires（loadSessionForRole 过期即清），模拟「记住我」
      localStorage.setItem('sufe_session_teacher', JSON.stringify({ user, authToken, expires: Date.now() + 3600e3 }));
      localStorage.setItem('sufe_last_role', 'teacher');
    }, { user: tch.user, authToken: tchTok });
    await page.goto(BASE + '/', { waitUntil: 'domcontentloaded', timeout: 60000 });
    // 等客户端进入 + 需求大厅推送卡出现（版本探针/校验在途时轮询等待）
    let cardHtml = null;
    for (let i = 0; i < 40; i++) {
      await page.waitForTimeout(1500);
      cardHtml = await page.evaluate(() => {
        const c = document.querySelector('.list-card--demand[data-push-id]');
        return c ? c.outerHTML : null;
      });
      if (cardHtml) break;
    }
    ok('教师需求大厅推送卡渲染', !!cardHtml, cardHtml ? '' : '未找到 [data-push-id] 卡');
    ok('推送卡含「学生留言」引用块', !!cardHtml && cardHtml.includes('greet-bubble') && cardHtml.includes('学生留言'),
      cardHtml && cardHtml.includes('greet-bubble') ? '气泡在' : '无 greet-bubble');
    ok('推送卡打招呼全文渲染（无省略号）', !!cardHtml && cardHtml.includes(greetStu), '');
    await browser.close(); browser = null;
  } catch (e) { ok('前端 UI 走查', false, e.message); }

  // 6) 教师带打招呼消息提交意向 → 201
  const intent = await post(`/api/demands/${demandId}/intents`, tchTok, { message: greetTch });
  ok('意向带打招呼消息', intent.status === 201, `status=${intent.status}`);

  // 7) 教师意向超长 → 400 + 专用文案
  const overIntent = await post(`/api/demands/${demandId}/intents`, tchTok, { message: '啊'.repeat(301) });
  const overIntentBody = await overIntent.json();
  ok('意向超长拒绝 400', overIntent.status === 400, `status=${overIntent.status}`);

  // 8) 学生侧取意向 → intent_message 透传
  const intents = await (await fetch(BASE + `/api/demands/${demandId}/intents`, { headers: { 'X-Auth-Token': stuTok } })).json();
  const myIntent = (intents.teachers || []).find(t => t.intent_message === greetTch);
  ok('学生意向列表透传 intent_message', !!myIntent, myIntent ? '' : JSON.stringify(intents).slice(0, 160));

  // 9) 学生端意向卡渲染「教师留言」引用块（同页 UI：学生会话注入）
  try {
    browser = await chromium.launch({ executablePath: 'C:/Program Files/Google/Chrome/Application/chrome.exe', headless: true });
    const page = await browser.newPage({ viewport: { width: 1280, height: 900 } });
    page.on('dialog', d => d.dismiss().catch(() => {}));
    await page.addInitScript(({ user, authToken }) => {
      try { localStorage.clear(); sessionStorage.clear(); } catch {}
      localStorage.setItem('sufe_session_student', JSON.stringify({ user, authToken, expires: Date.now() + 3600e3 }));
      localStorage.setItem('sufe_last_role', 'student');
    }, { user: stu.user, authToken: stuTok });
    await page.goto(BASE + '/', { waitUntil: 'domcontentloaded', timeout: 60000 });
    // 等客户端壳就绪（领域脚本注入完成：selectPage 依赖 closeProfilePanel 等懒加载全局）
    for (let i = 0; i < 40; i++) {
      await page.waitForTimeout(1200);
      const ready = await page.evaluate(() => {
        const client = document.getElementById('view-client');
        return !!(client && getComputedStyle(client).display !== 'none' && typeof closeProfilePanel === 'function' && typeof selectPage === 'function');
      });
      if (ready) break;
    }
    // 切到「我的需求」页
    await page.evaluate(() => selectPage('my-demands')).catch(() => {});
    // 等需求卡出现 → 展开试课意向下拉栏
    for (let i = 0; i < 30; i++) {
      await page.waitForTimeout(1200);
      const card = await page.evaluate((id) => !!document.querySelector(`[data-demand-id="${id}"]`), demandId);
      if (card) { await page.evaluate((id) => { const t = document.getElementById('intent-toggle-' + id); if (t) t.click(); }, demandId); break; }
    }
    // 等意向卡渲染（refreshIntentsBox 拉取后出现）
    let rowHtml = null;
    for (let i = 0; i < 30; i++) {
      await page.waitForTimeout(1200);
      rowHtml = await page.evaluate(() => {
        const el = document.querySelector('.admin-row[data-intent-id]');
        return el ? el.outerHTML : null;
      });
      if (rowHtml && rowHtml.includes('教师留言')) break;
    }
    ok('学生意向卡渲染「教师留言」引用块', !!rowHtml && rowHtml.includes('greet-bubble') && rowHtml.includes('教师留言'), rowHtml ? '' : '未找到意向卡');
    ok('意向卡打招呼全文渲染（无省略号）', !!rowHtml && rowHtml.includes(greetTch), '');
    await browser.close(); browser = null;
  } catch (e) { ok('学生端意向卡 UI', false, e.message); }
} catch (e) {
  ok('验证执行', false, e.message);
} finally {
  // 清理：无论成败删除临时需求（级联删推送/意向），不污染生产数据
  if (demandId && stuTok) {
    try {
      const rm = await del(`/api/student/demands/${demandId}`, stuTok);
      ok('清理临时需求', rm.status === 200, `status=${rm.status}`);
    } catch (e2) { ok('清理临时需求', false, e2.message); }
  }
}

console.log('\n=== v0.28.0 打招呼消息生产验证 ===');
console.log(results.join('\n'));
process.exit(results.some(r => r.startsWith('FAIL')) ? 1 : 0);

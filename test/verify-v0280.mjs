// v0.28.0 生产验证：打招呼消息全链路（M1）——qa_student 推送带消息 / qa_teacher 意向带消息 / 超限 400 / 卡片透传
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
try {
  const stu = await AUTH('qa_student', 'SufeQa2026!');
  const tch = await AUTH('qa_teacher', 'SufeQa2026!');
  stuTok = stu.authToken; tchTok = tch.authToken;
  ok('登录 qa_student/qa_teacher', true, `student=${stu.user.id} teacher=${tch.user.id}`);

  // 1) 学生建一条临时需求（上海，线下）
  const demandBody = {
    province: 'shanghai', student_grade: 'senior1', student_gender: 'female',
    target_type: 'academic', target_subjects: ['math'], current_scores: [],
    teaching_method: 'offline', address: '杨浦区', additional_info: '',
    budget_min: 100, budget_max: 200, submitter_type: 'parent',
    parent_contact: '13800138000', student_contact: '13900139000',
  };
  let create = await post('/api/student/demands', stuTok, { demand: demandBody });
  const created = await create.json();
  ok('创建临时需求', create.status === 200, JSON.stringify(created).slice(0, 80));
  demandId = created.id;
  if (!demandId) { console.log(results.join('\n')); process.exit(1); }

  // 2) 学生带打招呼消息推送 → 201
  const greetStu = '老师您好，孩子初二数学偏弱，看到您带过三届中考班，想请您试试。';
  let push = await post('/api/demand-pushes', stuTok, { teacherUserId: tch.user.id, demandId, message: greetStu });
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

  // 5) 教师带打招呼消息提交意向 → 201
  const greetTch = '我教初中数学五年，带过三届中考班，对您孩子的分数情况很有把握。';
  let intent = await post(`/api/demands/${demandId}/intents`, tchTok, { message: greetTch });
  ok('意向带打招呼消息', intent.status === 201, `status=${intent.status}`);

  // 6) 教师意向超长 → 400 + 专用文案
  const overIntent = await post(`/api/demands/${demandId}/intents`, tchTok, { message: '啊'.repeat(301) });
  const overIntentBody = await overIntent.json();
  ok('意向超长拒绝 400', overIntent.status === 400, `status=${overIntent.status}`);

  // 7) 学生侧取意向 → intent_message 透传
  const intents = await (await fetch(BASE + `/api/demands/${demandId}/intents`, { headers: { 'X-Auth-Token': stuTok } })).json();
  const myIntent = (intents.teachers || []).find(t => t.intent_message === greetTch);
  ok('学生意向列表透传 intent_message', !!myIntent, myIntent ? '' : JSON.stringify(intents).slice(0, 160));

  // 8) 前端 UI 走查（playwright）：教师登录 → 需求大厅推送卡含「学生留言」引用块 + 全文
  const browser = await chromium.launch({ executablePath: 'C:/Program Files/Google/Chrome/Application/chrome.exe', headless: true });
  const page = await browser.newPage({ viewport: { width: 1280, height: 900 } });
  page.on('dialog', d => d.dismiss().catch(() => {}));
  await page.goto(BASE + '/', { waitUntil: 'networkidle', timeout: 120000 });
  // 登录教师
  await page.evaluate(() => { try { if (typeof showView === 'function') showView('login'); } catch {} });
  await page.waitForSelector('#login-identifier', { state: 'visible', timeout: 30000 }).catch(() => {});
  await page.fill('#login-identifier', 'qa_teacher');
  await page.waitForTimeout(1800);
  await page.fill('#login-password', 'SufeQa2026!').catch(() => {});
  await page.evaluate(() => { const b = document.querySelector('#login-submit, .auth-submit'); if (b) b.click(); });
  await page.waitForTimeout(6000);
  const pushCardHtml = await page.evaluate(() => {
    const c = document.querySelector('.list-card--demand[data-push-id]');
    return c ? c.outerHTML : null;
  });
  ok('教师需求大厅推送卡渲染「学生留言」引用块', !!pushCardHtml && pushCardHtml.includes('greet-bubble') && pushCardHtml.includes('学生留言'),
    pushCardHtml && pushCardHtml.includes(greetStu) ? '全文渲染' : '缺全文/缺气泡');
  ok('推送卡打招呼全文无省略号', !!pushCardHtml && pushCardHtml.includes(greetStu), '');
  await browser.close();

} catch (e) {
  ok('验证执行', false, e.message);
} finally {
  // 9) 清理：无论成败删除临时需求（级联删推送/意向），不污染生产数据
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

/**
 * v0.28.0 M1 打招呼消息流程回归
 *
 * 学生推送需求 / 教师提交试课意向改为附带打招呼消息（Airbnb 租客对房东式）：
 *   - 服务端 handlePushDemand / handleCreateIntent：trim 后入库、超 GREETING_MSG_MAX 拒绝
 *     （MSG.GREETING_TOO_LONG，不误用聊天 MESSAGE_TOO_LONG）、缺省落空串；
 *   - dbGetPendingPushesForTeacher / dbGetIntentTeachers 透传 push_message / intent_message；
 *   - 前端：教师置顶推送卡渲染「学生留言」引用块（全文无省略号）、学生意向卡渲染「教师留言」、
 *     推送/意向浮窗含打招呼 textarea（maxlength 与服务端同源）且提交带上 message。
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { DatabaseSync } from 'node:sqlite';
import { JSDOM } from 'jsdom';
import { readFileSync } from 'node:fs';
import vm from 'node:vm';
import { initDb, dbCreatePush, dbGetPendingPushesForTeacher, dbCreateIntent, dbGetIntentTeachers } from '../server/db.js';
import { handlePushDemand, handleCreateIntent } from '../server/routes-demands.js';
import { tokenDigest } from '../server/crypto.js';

const ENV = { ADMIN_USERNAMES: ['admin_sufe'], ADMIN_DEFAULT_PASSWORD: 'test-pw-123', OTP_PROVIDER: 'mock' }; // mock：测试不真实发信

// ---- D1 shim（同 demand-type-guard：db.prepare().bind() + db.batch 事务） ----
function d1Shim(raw) {
  return {
    prepare(sql) {
      const st = {
        _sql: sql, _params: [],
        bind(...p) { st._params = p; return st; },
        all(...p) { return { results: raw.prepare(st._sql).all(...(p.length ? p : st._params)) }; },
        first(...p) { return raw.prepare(st._sql).get(...(p.length ? p : st._params)) ?? undefined; },
        run(...p) {
          const info = raw.prepare(st._sql).run(...(p.length ? p : st._params));
          return { meta: { changes: Number(info.changes), last_row_id: Number(info.lastInsertRowid) } };
        },
      };
      return st;
    },
    async batch(stmts) {
      raw.exec('BEGIN');
      try {
        const out = [];
        for (const s of stmts) {
          if (/^\s*(SELECT|PRAGMA|WITH|EXPLAIN)/i.test(s._sql)) out.push({ results: raw.prepare(s._sql).all(...s._params) });
          else { const info = raw.prepare(s._sql).run(...s._params); out.push({ meta: { changes: Number(info.changes), last_row_id: Number(info.lastInsertRowid) } }); }
        }
        raw.exec('COMMIT');
        return out;
      } catch (e) { try { raw.exec('ROLLBACK'); } catch { /* ignore */ } throw e; }
    },
  };
}
const rawOf = () => { const r = new DatabaseSync(':memory:'); r.exec('PRAGMA foreign_keys = ON'); return r; };
const reqOf = token => ({ headers: new Headers({ 'X-Auth-Token': token }) });

async function seedStudent(db, raw, username = 's1') {
  await initDb(db, ENV);
  raw.exec(`INSERT INTO users (username,password_hash,salt,role) VALUES ('${username}','h','s','student')`);
  const id = raw.prepare(`SELECT id FROM users WHERE username='${username}'`).get().id;
  const token = `${username}-token`;
  raw.prepare('INSERT INTO auth_sessions (token_hash,user_id,label,expires_at) VALUES (?,?,?,?)')
    .run(await tokenDigest(token), id, 'x', '2099-01-01 00:00:00');
  return { token, id };
}
async function seedTeacher(db, raw, username = 't1', complete = true) {
  raw.exec(`INSERT INTO users (username,password_hash,salt,role) VALUES ('${username}','h','s','teacher')`);
  const id = raw.prepare(`SELECT id FROM users WHERE username='${username}'`).get().id;
  const token = `${username}-token`;
  raw.prepare('INSERT INTO auth_sessions (token_hash,user_id,label,expires_at) VALUES (?,?,?,?)')
    .run(await tokenDigest(token), id, 'x', '2099-01-01 00:00:00');
  if (complete) {
    // v1.2.0 T3：合格接单教师档案（chsi_verified=1 + 必填齐全：科目/报价/时间/方式）
    raw.prepare('INSERT INTO teacher_profiles (user_id, province, grade, gender, subjects, price_min, price_max, time_slots, teaching_method, chsi_verified) VALUES (?,?,?,?,?,?,?,?,?,1)')
      .run(id, 'shanghai', 'senior1', 'male', JSON.stringify(['math']), 150, 150, '[{"day":"sat"}]', 'online');
  }
  return { token, id };
}
async function seedDemand(db, raw, studentId) {
  const r = raw.prepare(`INSERT INTO student_demands (user_id, student_grade, student_gender, target_subjects, current_scores,
      teaching_method, address, submitter_type, parent_contact, student_contact, province)
    VALUES (?,?,?,?,?,?,?,?,?,?,?)`)
    .run(studentId, 'senior1', 'female', JSON.stringify(['math']), '[]', 'offline', '杨浦区',
      'parent', '13800138000', '13900139000', 'shanghai');
  return Number(r.lastInsertRowid);
}

// ============================================================
// 服务端：推送 / 意向的打招呼消息
// ============================================================

test('handlePushDemand：message trim 后入库；超限 400 + GREETING_TOO_LONG；缺省空串', async () => {
  const raw = rawOf(); const db = d1Shim(raw);
  const { token, id: stu } = await seedStudent(db, raw);
  const { id: tch } = await seedTeacher(db, raw, 't1', false);
  const demandId = await seedDemand(db, raw, stu);

  // 带消息：trim 后落库
  let r = await handlePushDemand(db, { teacherUserId: tch, demandId, message: '  老师您好，孩子初二数学偏弱  ' }, reqOf(token));
  assert.equal(r.status, 201, '推送成功');
  let row = raw.prepare('SELECT message FROM demand_pushes WHERE teacher_user_id=?').get(tch);
  assert.equal(row.message, '老师您好，孩子初二数学偏弱', '打招呼消息 trim 后入库');

  // 超限：300 字上限，301 字拒绝
  const longMsg = '啊'.repeat(301);
  r = await handlePushDemand(db, { teacherUserId: tch, demandId, message: longMsg }, reqOf(token));
  assert.equal(r.status, 400, '超限拒绝');
  const errBody = JSON.parse(await r.text());
  assert.equal(errBody.error, '打招呼消息太长（上限 300 字）', '专用文案（非聊天 MESSAGE_TOO_LONG）');
  assert.equal(raw.prepare('SELECT COUNT(*) c FROM demand_pushes WHERE teacher_user_id=?').get(tch).c, 1, '超限不落库');
});

test('handleCreateIntent：message trim 后入库；超限 400；缺省空串；档案不完整仍拦', async () => {
  const raw = rawOf(); const db = d1Shim(raw);
  const { token: stuTok, id: stu } = await seedStudent(db, raw);
  const demandId = await seedDemand(db, raw, stu);
  const { token: tchTok, id: tch } = await seedTeacher(db, raw, 't1');

  // 带消息：trim 后落库
  let r = await handleCreateIntent(db, demandId, { message: '  我教初中数学五年，想试试  ' }, reqOf(tchTok));
  assert.equal(r.status, 201, '意向提交成功');
  let row = raw.prepare('SELECT message FROM demand_intents WHERE teacher_user_id=?').get(tch);
  assert.equal(row.message, '我教初中数学五年，想试试', '打招呼消息 trim 后入库');

  // 超限：301 字拒绝
  r = await handleCreateIntent(db, demandId, { message: '啊'.repeat(301) }, reqOf(tchTok));
  assert.equal(r.status, 400, '超限拒绝');
  assert.equal(JSON.parse(await r.text()).error, '打招呼消息太长（上限 300 字）', '专用文案');
  assert.equal(raw.prepare('SELECT COUNT(*) c FROM demand_intents WHERE teacher_user_id=?').get(tch).c, 1, '超限不落库');

  // 缺省 message：落空串
  const raw2 = rawOf(); const db2 = d1Shim(raw2);
  const { token: stuTok2, id: stu2 } = await seedStudent(db2, raw2);
  const demandId2 = await seedDemand(db2, raw2, stu2);
  const { token: tchTok2, id: tch2 } = await seedTeacher(db2, raw2, 't2');
  r = await handleCreateIntent(db2, demandId2, {}, reqOf(tchTok2));
  assert.equal(r.status, 201, '缺省消息仍可提交');
  row = raw2.prepare('SELECT message FROM demand_intents WHERE teacher_user_id=?').get(tch2);
  assert.equal(row.message, '', '缺省落空串');

  // 档案不完整（无档案教师）→ 仍 403 PROFILE_INCOMPLETE（打招呼改造不破坏完整性门槛）
  const { token: rawTchTok, id: rawTch } = await seedTeacher(db, raw, 't3', false);
  r = await handleCreateIntent(db, demandId, { message: '你好' }, reqOf(rawTchTok));
  assert.equal(r.status, 403, '档案不完整仍拦截');
  assert.equal(raw.prepare('SELECT COUNT(*) c FROM demand_intents WHERE teacher_user_id=?').get(rawTch).c, 0, '不落库');
});

test('db 读取透传：dbGetPendingPushesForTeacher.push_message / dbGetIntentTeachers.intent_message', async () => {
  const raw = rawOf(); const db = d1Shim(raw);
  const { id: stu } = await seedStudent(db, raw);
  const { id: tch } = await seedTeacher(db, raw, 't1');
  const demandId = await seedDemand(db, raw, stu);

  await dbCreatePush(db, demandId, stu, tch, '学生留言你好');
  await dbCreateIntent(db, demandId, tch, '教师留言你好');

  const pushes = await dbGetPendingPushesForTeacher(db, tch);
  assert.equal(pushes.length, 1, '待处理推送');
  assert.equal(pushes[0].push_message, '学生留言你好', '推送消息透传 push_message');

  const intents = await dbGetIntentTeachers(db, demandId);
  assert.equal(intents.length, 1, '意向列表');
  assert.equal(intents[0].intent_message, '教师留言你好', '意向消息透传 intent_message');
});

// ============================================================
// 前端：渲染 + 浮窗（node:vm 模拟浏览器脚本全局）
// ============================================================
function makeCtx(html) {
  const dom = new JSDOM(html || '<!DOCTYPE html><html><body><div id="modal-container"></div></body></html>', {
    url: 'http://localhost/', pretendToBeVisual: true,
  });
  const w = dom.window;
  return {
    ctx: vm.createContext({
      window: w, document: w.document,
      getComputedStyle: w.getComputedStyle.bind(w),
      localStorage: w.localStorage,
      console, crypto: globalThis.crypto, fetch: globalThis.fetch, setTimeout: globalThis.setTimeout, clearTimeout: globalThis.clearTimeout,
      setInterval: globalThis.setInterval, clearInterval: globalThis.clearInterval, Request: globalThis.Request,
      MutationObserver: class { observe() {} disconnect() {} takeRecords() { return []; } },
    }),
    dom,
  };
}
function loadAppScripts(ctx) {
  for (const f of ['constants.js', 'region-data.js', 'app-display.js', 'app-state.js', 'app-api.js',
    'app-datahub.js', 'app-anim.js', 'app-ui.js', 'app-demands.js']) {
    vm.runInContext(readFileSync('./' + f, 'utf8'), ctx, { filename: f });
  }
}
function stubBasics(ctx) {
  vm.runInContext(`
    setBadge = () => {};
    initReveals = () => {};
    ensureAuth = () => true;
    showToast = () => {};
    invalidate = () => {};
  `, ctx);
}

test('教师置顶推送卡：学生打招呼消息以引用块完整渲染（无省略号）', () => {
  const { ctx } = makeCtx();
  loadAppScripts(ctx);
  const pushDemand = {
    id: 3, user_id: 39, username: '学生A', display_id: 7, avatar: '',
    student_grade: 'senior1', student_gender: 'female', target_type: 'academic',
    target_subjects: ['math'], current_scores: [], teaching_method: 'offline',
    province: 'shanghai', budget_min: 0, budget_max: 0, address: '杨浦区', additional_info: '',
    status: 'open', created_at: '2026-08-08 04:27:09',
    push_id: 9, push_created_at: '2026-08-08 05:00:00', push_status: 'pending',
    push_message: '老师您好，孩子初二数学偏弱，看到您带过三届中考班，想请您试试。',
  };
  const html = vm.runInContext(`renderDemandCard(${JSON.stringify(pushDemand)}, { push: ${JSON.stringify({ push_id: 9, push_created_at: '2026-08-08 05:00:00', push_status: 'pending', push_message: pushDemand.push_message })}, teacher: true, myTeacher: null })`, ctx);
  assert.ok(html.includes('greet-bubble'), '渲染引用块');
  assert.ok(html.includes('学生留言'), '头标 GREET_HEAD_STUDENT');
  assert.ok(html.includes('老师您好，孩子初二数学偏弱，看到您带过三届中考班，想请您试试。'), '消息全文渲染（无省略号）');
  assert.ok(!html.includes('text-overflow') && !html.includes('ellipsis'), '不引入省略号样式');
});

test('学生意向卡：教师打招呼消息渲染在 meta 下方（卡片随内容增高）', () => {
  const { ctx } = makeCtx();
  loadAppScripts(ctx);
  const t = {
    user_id: 38, username: 'kkkk', rating: 4, province: 'shanghai', price_min: 150, price_max: 150,
    intent_id: 11, intent_status: 'pending', intent_message: '我教初中数学五年，带过三届中考班，对您孩子的分数情况很有把握。',
  };
  const html = vm.runInContext(`renderIntentTeacherRow(${JSON.stringify(t)}, 3)`, ctx);
  assert.ok(html.includes('greet-bubble'), '渲染引用块');
  assert.ok(html.includes('教师留言'), '头标 GREET_HEAD_TEACHER');
  assert.ok(html.includes('我教初中数学五年，带过三届中考班，对您孩子的分数情况很有把握。'), '消息全文渲染');
  // 卡片随内容增高：admin-row 无 max-height 注入
  assert.ok(!html.includes('max-height'), '无限高');
});

test('推送浮窗：含打招呼 textarea（maxlength 同源）+ 提交携带 message', async () => {
  const { ctx, dom } = makeCtx('<div id="modal-container"></div>');
  loadAppScripts(ctx);
  stubBasics(ctx);
  vm.runInContext(`
    dhGet = async () => ({ demands: [{
      id: 1, user_id: 39, username: '学生A', student_grade: 'senior1', student_gender: 'female',
      target_subjects: ['math'], current_scores: [], teaching_method: 'offline', address: '杨浦区',
      province: 'shanghai', budget_min: 0, budget_max: 0, status: 'open', display_id: 7 }] });
    api = async (url, opts) => { globalThis.__apiCalls = (globalThis.__apiCalls || []).concat([{ url, opts }]); return { message: 'ok' }; };
    state.user = { id: 40, username: '学生A', role: 'student' };
    state.allTeachers = [{ user_id: 38, username: 'kkkk' }];
    state.myDemands = [];
  `, ctx);

  await vm.runInContext('openSendDemandModal(38)', ctx);
  const modalBody = dom.window.document.querySelector('#modal-container .modal-body').innerHTML;
  assert.ok(modalBody.includes('push-greet'), '含打招呼 textarea');
  assert.ok(modalBody.includes('maxlength="300"'), 'maxlength 与服务端 GREETING_MSG_MAX 同源');
  assert.ok(modalBody.includes('和老师打个招呼'), '提示语');

  // 先选需求再填消息提交 → api body 携带 message
  vm.runInContext(`document.querySelector('input[name="push-demand"]').checked = true;
    document.getElementById('push-greet').value = ' 老师您好，想请您辅导孩子  '; submitDemandPush(38)`, ctx);
  await new Promise(r => setTimeout(r, 10));
  const calls = vm.runInContext('globalThis.__apiCalls', ctx);
  assert.equal(calls.length, 1, '提交一次');
  assert.equal(calls[0].url, '/api/demand-pushes');
  assert.equal(calls[0].opts.body.message, '老师您好，想请您辅导孩子', 'message trim 后随提交');
});

test('意向浮窗：打招呼 textarea + 提交携带 message；缺省可直提', async () => {
  const { ctx, dom } = makeCtx('<div id="modal-container"></div>');
  loadAppScripts(ctx);
  stubBasics(ctx);
  vm.runInContext(`
    api = async (url, opts) => { globalThis.__apiCalls = (globalThis.__apiCalls || []).concat([{ url, opts }]); return { message: 'ok' }; };
    state.user = { id: 38, username: 'kkkk', role: 'teacher' };
    _browseDemands = [{ id: 5, user_id: 39, username: '学生A', display_id: 8, target_subjects: ['math'], target_type: 'academic' }];
  `, ctx);

  await vm.runInContext('submitIntent(5)', ctx);
  const modalBody = dom.window.document.querySelector('#modal-container .modal-body').innerHTML;
  assert.ok(modalBody.includes('intent-greet-5'), '含打招呼 textarea');
  assert.ok(modalBody.includes('maxlength="300"'), 'maxlength 同源');
  assert.ok(modalBody.includes('提交试课意向'), '标题由确认改为打招呼');

  // 填消息提交 → api body 携带 message
  vm.runInContext(`document.getElementById('intent-greet-5').value = ' 我教初中数学五年，想试试  '; doSubmitIntent(5)`, ctx);
  await new Promise(r => setTimeout(r, 10));
  let calls = vm.runInContext('globalThis.__apiCalls', ctx);
  assert.equal(calls[0].url, '/api/demands/5/intents');
  assert.equal(calls[0].opts.body.message, '我教初中数学五年，想试试', 'message trim 后随提交');

  // 缺省消息 → message 空串（可直接提交；重开浮窗清空再提，走真实 textarea 空值路径）
  await vm.runInContext('submitIntent(5)', ctx);
  vm.runInContext(`document.getElementById('intent-greet-5').value = ''; doSubmitIntent(5)`, ctx);
  await new Promise(r => setTimeout(r, 10));
  calls = vm.runInContext('globalThis.__apiCalls', ctx);
  assert.equal(calls.length, 2, '第二次提交');
  assert.equal(calls[1].opts.body.message, '', '缺省 message 空串');
});

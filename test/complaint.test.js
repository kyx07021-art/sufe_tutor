/**
 * #165（v0.25.73）：投诉通道全链路
 *  - 服务端：handleCreateFeedback kind 白名单（bug/complaint/suggestion）+ 投诉对象白名单（非投诉恒空）+ 空正文 400；
 *    handleMyFeedbacks requireUser 守卫 + 用户隔离（只回本人）；handleResolveFeedback 投诉专属回执文案、幂等；
 *    CHECK 迁移放行 complaint 写入。
 *  - 前端：关于平台按钮（反馈/投诉/我的反馈）；投诉浮窗对象行显隐与标题切换；
 *    提交带 subject；我的反馈浮窗渲染（类型 tag/对象 tag/状态）与空态。
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { DatabaseSync } from 'node:sqlite';
import { initDb, dbCreateFeedback, dbGetFeedbacksByUser, dbGetFeedbackById } from '../server/db.js';
import { handleCreateFeedback, handleMyFeedbacks, handleResolveFeedback } from '../server/routes-admin.js';
import { tokenDigest } from '../server/crypto.js';
import { readFileSync } from 'node:fs';
import { JSDOM } from 'jsdom';
import vm from 'node:vm';

const ENV = { ADMIN_USERNAMES: ['admin_sufe'], ADMIN_DEFAULT_PASSWORD: 'test-pw-123' };

// ==================== 服务端 ====================

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

async function seed(db, raw) {
  await initDb(db, ENV);
  raw.exec(`INSERT INTO users (username,password_hash,salt,role) VALUES ('stu','h','s','student'),('tea','h','s','teacher')`); // admin_sufe 由 initDb 种子创建
  const idOf = name => raw.prepare("SELECT id FROM users WHERE username=?").get(name).id;
  const admin = idOf('admin_sufe'); // initDb 依 ADMIN_USERNAMES 已建
  const mkToken = async name => {
    const token = `${name}-token`;
    raw.prepare('INSERT INTO auth_sessions (token_hash,user_id,label,expires_at) VALUES (?,?,?,?)')
      .run(await tokenDigest(token), idOf(name), 'x', '2099-01-01 00:00:00');
    return token;
  };
  return { stu: idOf('stu'), tea: idOf('tea'), admin,
    stuToken: await mkToken('stu'), teaToken: await mkToken('tea'), adminToken: await mkToken('admin_sufe') };
}

test('创建反馈：投诉 + 合法对象落库 subject；非投诉恒空；白名单外 kind 回落建议', async () => {
  const raw = rawOf(); const db = d1Shim(raw);
  const { stu, stuToken } = await seed(db, raw);
  const c = await handleCreateFeedback(db, { kind: 'complaint', subject: 'teacher', title: '老师迟到', content: '多次迟到' }, reqOf(stuToken));
  assert.equal(c.status, 201);
  const row = raw.prepare('SELECT * FROM feedbacks ORDER BY id DESC LIMIT 1').get();
  assert.equal(row.kind, 'complaint'); assert.equal(row.subject, 'teacher'); assert.equal(row.user_id, stu);

  // 非法对象 → 空；kind 白名单外 → suggestion 且 subject 恒空
  await handleCreateFeedback(db, { kind: 'complaint', subject: 'hacker', title: 'x', content: '内容' }, reqOf(stuToken));
  let r = raw.prepare('SELECT * FROM feedbacks ORDER BY id DESC LIMIT 1').get();
  assert.equal(r.subject, '', '非法投诉对象消毒为空');
  await handleCreateFeedback(db, { kind: 'spam', subject: 'platform', title: 'x', content: '内容' }, reqOf(stuToken));
  r = raw.prepare('SELECT * FROM feedbacks ORDER BY id DESC LIMIT 1').get();
  assert.equal(r.kind, 'suggestion', '白名单外 kind 回落建议'); assert.equal(r.subject, '', '非投诉 subject 恒空');
  // 普通 bug 带 subject → 空（不信任客户端）
  await handleCreateFeedback(db, { kind: 'bug', subject: 'teacher', title: 'x', content: '内容' }, reqOf(stuToken));
  r = raw.prepare('SELECT * FROM feedbacks ORDER BY id DESC LIMIT 1').get();
  assert.equal(r.kind, 'bug'); assert.equal(r.subject, '');
});

test('创建反馈：空正文 400；requireUser 守卫', async () => {
  const raw = rawOf(); const db = d1Shim(raw);
  const { stuToken } = await seed(db, raw);
  const e = await handleCreateFeedback(db, { kind: 'complaint', subject: 'platform', title: '', content: '  ' }, reqOf(stuToken));
  assert.equal(e.status, 400, '空正文被拒');
  const unauth = await handleCreateFeedback(db, { kind: 'complaint', subject: 'platform', title: 'x', content: '内容' }, reqOf('bad-token'));
  assert.equal(unauth.status, 401, '无令牌被拒');
});

test('我的反馈：requireUser 守卫 + 用户隔离（只回本人、不泄他人）', async () => {
  const raw = rawOf(); const db = d1Shim(raw);
  const { stu, tea, stuToken, teaToken } = await seed(db, raw);
  await dbCreateFeedback(db, stu, 'complaint', '投诉A', '内容A', 'teacher');
  await dbCreateFeedback(db, tea, 'bug', 'BugB', '内容B');
  const unauth = await handleMyFeedbacks(db, reqOf('bad'));
  assert.equal(unauth.status, 401, '未登录被拒');
  const mine = await handleMyFeedbacks(db, reqOf(stuToken));
  assert.equal(mine.status, 200);
  const list = (await mine.json()).feedbacks;
  assert.equal(list.length, 1, '只看得到本人 1 条');
  assert.equal(list[0].kind, 'complaint'); assert.equal(list[0].subject, 'teacher');
  const t = await handleMyFeedbacks(db, reqOf(teaToken));
  const tList = (await t.json()).feedbacks;
  assert.equal(tList.length, 1, '教师看到自己的');
  assert.equal(tList[0].kind, 'bug');
});

test('标记处理：投诉回执专属文案；Bug/建议通用文案；幂等', async () => {
  const raw = rawOf(); const db = d1Shim(raw);
  const { stu, adminToken } = await seed(db, raw);
  await dbCreateFeedback(db, stu, 'complaint', '投诉', '内容', 'platform');
  await dbCreateFeedback(db, stu, 'suggestion', '建议', '内容');
  const complaintId = (await dbGetFeedbackById(db, 1)).id; // dbGetFeedbackById 是 async，须 await 取 id
  await handleResolveFeedback(db, complaintId, {}, reqOf(adminToken));
  let n = raw.prepare('SELECT text FROM notifications ORDER BY id DESC LIMIT 1').get();
  assert.equal(n.text, globalThis.APP_CONSTANTS.UI.FEEDBACK_COMPLAINT_RESOLVED, '投诉回执用专属文案');
  await handleResolveFeedback(db, 2, {}, reqOf(adminToken));
  n = raw.prepare('SELECT text FROM notifications ORDER BY id DESC LIMIT 1').get();
  assert.equal(n.text, globalThis.APP_CONSTANTS.UI.FEEDBACK_RESOLVED, '建议回执用通用文案');
  const before = raw.prepare('SELECT COUNT(*) c FROM notifications').get().c;
  await handleResolveFeedback(db, complaintId, {}, reqOf(adminToken)); // 已处理再点 → 不再发通知
  assert.equal(raw.prepare('SELECT COUNT(*) c FROM notifications').get().c, before, '幂等：已处理不重复通知');
  const unauth = await handleResolveFeedback(db, 1, {}, reqOf('bad'));
  assert.equal(unauth.status, 401, '非管理员被拒');
});

test('CHECK 迁移放行 complaint 写入；dbGetFeedbacksByUser 逆序', async () => {
  const raw = rawOf(); const db = d1Shim(raw);
  const { stu, tea, stuToken } = await seed(db, raw);
  await dbCreateFeedback(db, stu, 'complaint', '一', 'A', 'student');
  await dbCreateFeedback(db, stu, 'bug', '二', 'B');
  await dbCreateFeedback(db, tea, 'suggestion', '三', 'C');
  const mine = await dbGetFeedbacksByUser(db, stu);
  assert.deepEqual(mine.map(f => f.title), ['二', '一'], '逆序（新在前）且只含本人');
  assert.equal(mine[1].subject, 'student');
});

// ==================== 前端 ====================

const FILES = [
  'constants.js', 'region-data.js', 'app-display.js', 'app-state.js', 'app-api.js',
  'app-datahub.js', 'app-anim.js', 'app-ui.js', 'app-style.js', 'app-onboard.js', 'app-region.js',
  'app-posts.js', 'app-chat.js', 'app-contracts.js', 'app-chart.js', 'app-admin.js',
  'app-demands.js', 'app-teachers.js', 'app-pages.js', 'app-shell.js', 'app-auth.js',
];
const tick = (ms = 20) => new Promise(r => setTimeout(r, ms));

function makeCtx({ mineRows = [] } = {}) {
  const html = readFileSync('./index.html', 'utf8')
    .replace(/<script src="\/app-[a-z-]+\.js"><\/script>/g, '');
  const dom = new JSDOM(html, { url: 'http://localhost/', pretendToBeVisual: true, runScripts: 'dangerously' });
  const w = dom.window;
  const posts = []; // 记录 POST 提交（feedback 创建）
  const ctx = vm.createContext({
    window: w, document: w.document,
    getComputedStyle: w.getComputedStyle.bind(w),
    localStorage: w.localStorage, sessionStorage: w.sessionStorage,
    console: { log() {}, warn() {}, error() {} },
    fetch: async (url, opts = {}) => {
      const u = String(url);
      if (u === '/api/feedbacks' && opts.method === 'POST') {
        posts.push({ body: JSON.parse(opts.body) });
        return { ok: true, status: 201, json: async () => ({ ok: true }) };
      }
      if (u === '/api/feedbacks/mine') return { ok: true, status: 200, json: async () => ({ feedbacks: mineRows }) };
      return { ok: true, status: 200, json: async () => ({}) };
    },
    setTimeout: globalThis.setTimeout, clearTimeout: globalThis.clearTimeout,
    setInterval: globalThis.setInterval, clearInterval: globalThis.clearInterval,
    Request: globalThis.Request, AbortController: globalThis.AbortController,
    performance: globalThis.performance,
    MutationObserver: class { observe() {} disconnect() {} takeRecords() { return []; } },
    Image: class { set src(v) { this._s = v; } },
    requestAnimationFrame: (cb) => setTimeout(cb, 16), cancelAnimationFrame: () => {},
    matchMedia: () => ({ matches: false, addEventListener: () => {} }),
  });
  vm.runInContext(`try { localStorage.setItem('sufe_returning', '1'); } catch (e) {}`, ctx); // 首访欢迎浮窗让路
  for (const f of FILES) vm.runInContext(readFileSync('./' + f, 'utf8'), ctx, { filename: f });
  vm.runInContext(`
    state.user = { id: 1, role: 'student', username: 's' };
    window.APP_CONSTANTS = globalThis.APP_CONSTANTS;
    ['openFeedbackModal','switchFeedbackKind','submitFeedback','openMyFeedback','enterAbout','closeModal'].forEach(function (k) {
      if (typeof globalThis[k] === 'function') window[k] = globalThis[k];
    });
  `, ctx);
  return { dom, ctx, posts };
}

const MINE = [
  { id: 3, kind: 'complaint', subject: 'teacher', title: '老师迟到', content: '**多次**迟到', status: 'open', created_at: '2026-08-09 10:00:00' },
  { id: 2, kind: 'bug', subject: '', title: '闪退', content: '打开就退', status: 'resolved', created_at: '2026-08-08 09:00:00' },
];

test('关于平台：支持卡三按钮（反馈/投诉/我的反馈）', async () => {
  const { dom, ctx } = makeCtx();
  const doc = dom.window.document;
  await vm.runInContext(`state.page = 'about'; enterAbout()`, ctx);
  const btns = [...doc.querySelectorAll('.about-feedback-btns button')];
  assert.equal(btns.length, 3, '三个入口按钮');
  assert.equal(btns[0].textContent, globalThis.APP_CONSTANTS.UI.BTN_FEEDBACK);
  assert.equal(btns[1].textContent, globalThis.APP_CONSTANTS.UI.BTN_COMPLAINT);
  assert.equal(btns[2].textContent, globalThis.APP_CONSTANTS.UI.BTN_MY_FEEDBACK);
});

test('投诉浮窗：对象行仅投诉档显示；标题与占位随档切换', async () => {
  const { dom, ctx } = makeCtx();
  const doc = dom.window.document;
  await vm.runInContext(`openFeedbackModal('complaint')`, ctx);
  const subj = doc.getElementById('feedback-subject-row');
  assert.ok(subj && !subj.classList.contains('hidden'), '投诉档对象行可见');
  assert.equal(doc.getElementById('feedback-modal-title').textContent, globalThis.APP_CONSTANTS.UI.FEEDBACK_MODAL_TITLE_COMPLAINT);
  assert.equal(doc.querySelectorAll('.feedback-kind-row .seg-tab').length, 3, '三段选项卡（Bug/建议/投诉）');
  assert.equal(doc.getElementById('post-body').placeholder, globalThis.APP_CONSTANTS.UI.FEEDBACK_COMPLAINT_PLACEHOLDER, '投诉占位专属');
  await vm.runInContext(`switchFeedbackKind('suggestion')`, ctx);
  assert.ok(subj.classList.contains('hidden'), '切建议档对象行隐藏');
  assert.equal(doc.getElementById('feedback-modal-title').textContent, globalThis.APP_CONSTANTS.UI.FEEDBACK_MODAL_TITLE_SUGGEST);
});

test('普通建议档打开：对象行默认隐藏', async () => {
  const { dom, ctx } = makeCtx();
  const doc = dom.window.document;
  await vm.runInContext(`openFeedbackModal('suggestion')`, ctx);
  const subj = doc.getElementById('feedback-subject-row');
  assert.ok(subj.classList.contains('hidden'), '建议档对象行隐藏');
});

test('投诉提交：POST 带 kind=complaint + subject；建议提交不带 subject', async () => {
  const { dom, ctx, posts } = makeCtx();
  const doc = dom.window.document;
  await vm.runInContext(`openFeedbackModal('complaint')`, ctx);
  doc.getElementById('post-title').value = '老师迟到';
  doc.getElementById('post-body').value = '多次迟到';
  await vm.runInContext(`submitFeedback()`, ctx);
  await tick();
  assert.equal(posts.length, 1);
  assert.deepEqual(posts[0].body, { kind: 'complaint', title: '老师迟到', content: '多次迟到', subject: 'teacher' }, '默认对象 teacher');
  assert.equal(doc.getElementById('modal-container').innerHTML, '', '提交后浮窗关闭');

  await vm.runInContext(`openFeedbackModal('bug')`, ctx);
  doc.getElementById('post-title').value = '闪退';
  doc.getElementById('post-body').value = '打开就退';
  await vm.runInContext(`submitFeedback()`, ctx);
  await tick();
  assert.deepEqual(posts[1].body, { kind: 'bug', title: '闪退', content: '打开就退', subject: '' }, '非投诉 subject 恒空');
});

test('我的反馈浮窗：渲染类型/对象/状态 tag + Markdown 正文；空态', async () => {
  const { dom, ctx } = makeCtx({ mineRows: MINE });
  const doc = dom.window.document;
  const UI = globalThis.APP_CONSTANTS.UI;
  await vm.runInContext(`openMyFeedback()`, ctx);
  await tick();
  const cards = doc.querySelectorAll('.my-feedback-card');
  assert.equal(cards.length, 2, '两条反馈');
  const c0 = cards[0];
  assert.ok(c0.textContent.includes('投诉'), '类型 tag 投诉');
  assert.ok(c0.textContent.includes(UI.FEEDBACK_COMPLAINT_SUBJECT_TEACHER), '对象 tag 教师');
  assert.ok(c0.textContent.includes(UI.FEEDBACK_STATUS_OPEN), '状态未处理');
  assert.ok(c0.querySelector('.md-preview strong'), 'Markdown 加粗渲染');
  assert.ok(c0.textContent.includes('老师迟到'), '标题');
  const c1 = cards[1];
  assert.ok(c1.textContent.includes('Bug'), '类型 tag Bug');
  assert.ok(c1.textContent.includes(UI.FEEDBACK_STATUS_RESOLVED), '状态已处理');
  // 空态
  const { dom: dom2, ctx: ctx2 } = makeCtx({ mineRows: [] });
  await vm.runInContext(`openMyFeedback()`, ctx2);
  await tick();
  assert.ok(dom2.window.document.querySelector('.my-feedback-list').textContent.includes(UI.MY_FEEDBACK_EMPTY), '空态文案');
});

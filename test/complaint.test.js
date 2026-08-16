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
import { initDb, dbCreateFeedback, dbGetFeedbacksByUser, dbGetFeedbackById, dbCreateComplaint } from '../server/db.js';
import { handleCreateFeedback, handleMyFeedbacks, handleResolveFeedback } from '../server/routes-admin.js';
import { handleCreateComplaint, handleMyComplaints, handleComplaintAttachment } from '../server/routes-complaints.js';
import { tokenDigest } from '../server/crypto.js';
import { LIMITS } from '../server/constants.js';
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

// ==================== U11 投诉附件（服务端） ====================

test('U11 投诉附件：凭 uploadId 从暂存复制入投诉并删暂存（密文原样搬移）', async () => {
  const raw = rawOf(); const db = d1Shim(raw);
  const { stu, tea, stuToken } = await seed(db, raw);
  // 学生暂存两张 + 教师暂存一张（借 id 越权场景）
  const u1 = raw.prepare("INSERT INTO uploads (user_id,kind,body,name) VALUES (?,?,?,?)").run(stu, 'image', 'data:image/png;base64,AAA', 'a.png').lastInsertRowid;
  const u2 = raw.prepare("INSERT INTO uploads (user_id,kind,body,name) VALUES (?,?,?,?)").run(stu, 'file', 'data:text/plain;base64,QQ==', 'b.txt').lastInsertRowid;
  const teaU = raw.prepare("INSERT INTO uploads (user_id,kind,body,name) VALUES (?,?,?,?)").run(tea, 'image', 'data:image/png;base64,BBB', 't.png').lastInsertRowid;
  const c = await handleCreateComplaint(db,
    { targetType: 'teacher', targetId: tea, reason: '虚假信息或欺诈', detail: '含截图', uploadIds: [u1, u2] }, reqOf(stuToken));
  assert.equal(c.status, 201);
  const row = raw.prepare('SELECT attachments FROM complaints ORDER BY id DESC LIMIT 1').get();
  const atts = JSON.parse(row.attachments);
  assert.equal(atts.length, 2, '两附件随投诉落库');
  assert.deepEqual(atts.map(a => a.name), ['a.png', 'b.txt']);
  assert.equal(atts[0].kind, 'image'); assert.equal(atts[0].body, 'data:image/png;base64,AAA', '密文原样搬移');
  assert.equal(raw.prepare('SELECT COUNT(*) c FROM uploads').get().c, 1, '复制成功后暂存删除（仅剩教师那张）');
  // 越权借他人 uploadId → 404（不复制不落库）
  const c2 = await handleCreateComplaint(db,
    { targetType: 'teacher', targetId: tea, reason: '虚假信息或欺诈', detail: '', uploadIds: [teaU] }, reqOf(stuToken));
  assert.equal(c2.status, 400, '借他人暂存 id 被拒');
  assert.equal(raw.prepare('SELECT COUNT(*) c FROM uploads').get().c, 1, '越权场景不删任何暂存');
  // 超上限 → 400 COMPLAINT_ATTACH_TOO_MANY
  const many = Array.from({ length: LIMITS.COMPLAINT_ATTACH_MAX + 1 }, (_, i) => i + 1);
  const c3 = await handleCreateComplaint(db,
    { targetType: 'teacher', targetId: tea, reason: '虚假信息或欺诈', detail: '', uploadIds: many }, reqOf(stuToken));
  assert.equal(c3.status, 400);
  assert.ok((await c3.json()).error.includes('最多'), '超上限提示');
});

test('U11 投诉附件懒加载：本人/管理员可取密文出门解密；他人 403；越界 404', async () => {
  const raw = rawOf(); const db = d1Shim(raw);
  const { stu, tea, admin, stuToken, teaToken, adminToken } = await seed(db, raw);
  const id = await dbCreateComplaint(db, stu, 'teacher', tea, { id: tea, name: '李老师', role: 'teacher' }, '虚假信息或欺诈', '含截图',
    [{ kind: 'image', name: 'a.png', body: 'data:image/png;base64,AAA', thumb: 'data:image/jpeg;base64,TT' }]);
  const url = new URL(`http://x/api/complaints/${id}/attachment?idx=0`);
  // 本人
  const mine = await handleComplaintAttachment(db, id, url, reqOf(stuToken));
  assert.equal(mine.status, 200);
  const m = (await mine.json());
  assert.equal(m.body, 'data:image/png;base64,AAA', 'body 密文出门解密');
  // 管理员
  const adm = await handleComplaintAttachment(db, id, url, reqOf(adminToken));
  assert.equal(adm.status, 200, '管理员可看');
  // 他人（teacher 既是被投诉对象又不是投诉人/管理员）
  const other = await handleComplaintAttachment(db, id, url, reqOf(teaToken));
  assert.equal(other.status, 403, '非本人非管理员 403');
  // 越界 idx → 404
  const oob = await handleComplaintAttachment(db, id, new URL(`http://x/api/complaints/${id}/attachment?idx=5`), reqOf(stuToken));
  assert.equal(oob.status, 404, '附件越界 404');
  // 列表接口不下发 body 本体（缩略图出门解密）
  const list = await handleMyComplaints(db, reqOf(stuToken));
  const l = (await list.json()).complaints[0];
  assert.equal(l.attachments[0].body, '', '列表不下发附件本体');
  assert.equal(l.attachments[0].thumb, 'data:image/jpeg;base64,TT', '列表含解密缩略图');
});

// ==================== 前端 ====================

const FILES = [
  'constants.js', 'region-data.js', 'app-display.js', 'app-state.js', 'app-api.js',
  'app-datahub.js', 'app-anim.js', 'app-ui.js', 'app-style.js', 'app-onboard.js', 'app-region.js',
  'app-posts.js', 'app-chat.js', 'app-contracts.js', 'app-chart.js', 'app-admin.js',
  'app-demands.js', 'app-teachers.js', 'app-pages.js', 'app-complaints.js', 'app-shell.js', 'app-auth.js',
];
const tick = (ms = 20) => new Promise(r => setTimeout(r, ms));

function makeCtx({ mineRows = [], myComplaints = [], recentByType = {}, searchRows = [], attachKind = 'image', attachBody = 'data:image/png;base64,ZZZ' } = {}) {
  const html = readFileSync('./index.html', 'utf8')
    .replace(/<script src="\/app-[a-z-]+\.js"><\/script>/g, '');
  const dom = new JSDOM(html, { url: 'http://localhost/', pretendToBeVisual: true, runScripts: 'dangerously' });
  const w = dom.window;
  w.HTMLCanvasElement.prototype.getContext = function () { // jsdom 无 canvas：patch 链式 2d 替身（app-captcha 进 boot FILES 后 vm 测试走到 canvas 路径）
    const mk = () => new Proxy(() => {}, { get: (t, k) => (k === 'canvas' ? {} : mk()), apply: () => mk() });
    return mk();
  };
  const posts = []; // 记录 POST 提交（feedback 创建）
  const complaints = []; // 记录 POST 提交（投诉创建）
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
      if (u === '/api/complaints' && opts.method === 'POST') {
        complaints.push({ body: JSON.parse(opts.body) });
        return { ok: true, status: 201, json: async () => ({ ok: true }) };
      }
      if (u === '/api/complaints/mine') return { ok: true, status: 200, json: async () => ({ complaints: myComplaints }) };
      if (u.startsWith('/api/complaints/recent')) {
        const t = new URL(u, 'http://x').searchParams.get('target');
        return { ok: true, status: 200, json: async () => ({ candidates: recentByType[t] || [] }) };
      }
      if (u.startsWith('/api/complaints/candidates')) {
        return { ok: true, status: 200, json: async () => ({ candidates: searchRows }) };
      }
      if (u.includes('/api/complaints/') && u.includes('/attachment?')) { // U11：附件懒加载
        return { ok: true, status: 200, json: async () => ({ kind: attachKind, name: 'x.png', body: attachBody }) };
      }
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
  vm.runInContext(`if (typeof openCaptchaModal === 'function') { const _ocm = openCaptchaModal; openCaptchaModal = (o) => { if (o && o.onPass) o.onPass(); }; }`, ctx); // vm 测试直通拼图（生产走真验证）
  vm.runInContext(`
    state.user = { id: 1, role: 'student', username: 's' };
    window.APP_CONSTANTS = globalThis.APP_CONSTANTS;
    ['openFeedbackModal','submitFeedback','openMyFeedback','enterAbout','closeModal',
     'openComplaintModal','switchComplaintTab','switchComplaintReason','pickComplaintTarget','clearComplaintTarget',
     'complaintSearchInput','complaintSearch','submitComplaint','openMyFeedback',
     'complaintStageFiles','complaintUnstage','complaintOpenAttachment','closeComplaintModal'].forEach(function (k) { // M12：openMyComplaints 已删，合并入口=openMyFeedback；U11：附件区内联 handler 同注册
      if (typeof globalThis[k] === 'function') window[k] = globalThis[k];
    });
  `, ctx);
  return { dom, ctx, posts, complaints };
}

const MINE = [
  { id: 3, kind: 'complaint', subject: 'teacher', title: '老师迟到', content: '**多次**迟到', status: 'open', created_at: '2026-08-09 10:00:00' },
  { id: 2, kind: 'bug', subject: '', title: '闪退', content: '打开就退', status: 'resolved', created_at: '2026-08-08 09:00:00' },
];

test('M11+M12 关于平台：支持卡两按钮（投诉与反馈/我的投诉与反馈，四入口收口）', async () => {
  const { dom, ctx } = makeCtx();
  const doc = dom.window.document;
  await vm.runInContext(`state.page = 'about'; enterAbout()`, ctx);
  const btns = [...doc.querySelectorAll('.about-feedback-btns button')];
  const UI = globalThis.APP_CONSTANTS.UI;
  assert.equal(btns.length, 2, '两个入口按钮（用户反馈+投诉→投诉与反馈；我的投诉+我的反馈→我的投诉与反馈）');
  assert.equal(btns[0].textContent, UI.BTN_COMPLAINT_FEEDBACK);
  assert.equal(btns[1].textContent, UI.BTN_MY_COMPLAINTS_FEEDBACK);
});

test('M11 投诉与反馈：chooser 浮窗三选（Bug/建议/投诉），选中后开对应专线浮窗', async () => {
  const { dom, ctx } = makeCtx();
  const doc = dom.window.document;
  const UI = globalThis.APP_CONSTANTS.UI;
  await vm.runInContext(`openFeedbackComplaintChooser()`, ctx);
  const items = doc.querySelectorAll('.chooser-grid .chooser-item');
  assert.equal(items.length, 3, '三选通道');
  assert.equal(items[0].textContent, UI.FEEDBACK_CHOOSE_BUG);
  assert.equal(items[1].textContent, UI.FEEDBACK_CHOOSE_SUGGESTION);
  assert.equal(items[2].textContent, UI.FEEDBACK_CHOOSE_COMPLAINT);
  // 选「我要投诉」→ chooser 关闭 + 投诉浮窗打开（closeModal 再 openComplaintModal）
  await vm.runInContext(`closeModal(); openComplaintModal()`, ctx);
  await tick();
  assert.equal(doc.getElementById('complaint-modal-title').textContent, UI.COMPLAINT_MODAL_TITLE, '投诉专线浮窗打开');
});

test('R22 投诉独立浮窗：三 tab + pane 显隐 + 理由下拉栏；反馈浮窗已无投诉档', async () => {
  const { dom, ctx } = makeCtx();
  const doc = dom.window.document;
  const UI = globalThis.APP_CONSTANTS.UI;
  await vm.runInContext(`openComplaintModal()`, ctx);
  await tick();
  assert.equal(doc.getElementById('complaint-modal-title').textContent, UI.COMPLAINT_MODAL_TITLE);
  const tabs = doc.querySelectorAll('.complaint-tabs .seg-tab');
  assert.equal(tabs.length, 3, '投诉教师/学生/帖子三段');
  assert.equal(tabs[0].textContent, UI.COMPLAINT_TAB_TEACHER);
  assert.ok(!doc.getElementById('cmp-pane-teacher').classList.contains('hidden'), '教师 pane 默认可见');
  assert.ok(doc.getElementById('cmp-pane-student').classList.contains('hidden'), '学生 pane 初始隐藏');
  assert.ok(doc.getElementById('cmp-pane-post').classList.contains('hidden'), '帖子 pane 初始隐藏');
  // M8：投诉理由从切换式改下拉栏——select 选项 = 占位 + 白名单理由
  const reasonSel = doc.getElementById('complaint-reason');
  assert.ok(reasonSel, '投诉理由下拉栏存在');
  assert.equal(reasonSel.tagName.toLowerCase(), 'select', '是下拉栏（非切换式）');
  assert.equal(reasonSel.options.length, UI.COMPLAINT_REASONS.length + 1, '下拉选项 = 占位项 + 白名单');
  assert.equal(reasonSel.value, '', '默认选中占位项（未选理由）');
  assert.equal(reasonSel.options[1].textContent, UI.COMPLAINT_REASONS[0], '首个理由是白名单第一项');
  // 切学生 tab：pane 显隐互斥
  await vm.runInContext(`switchComplaintTab('student')`, ctx);
  assert.ok(!doc.getElementById('cmp-pane-student').classList.contains('hidden'), '学生 pane 显示');
  assert.ok(doc.getElementById('cmp-pane-teacher').classList.contains('hidden'), '教师 pane 隐藏');
  // 反馈浮窗不再含投诉档（组件隔离）；M11 三选后 kind 即固定——无内层切换 tab（A1 审计连根删）
  await vm.runInContext(`openFeedbackModal('bug')`, ctx);
  assert.equal(doc.querySelectorAll('.feedback-kind-row').length, 0, '反馈浮窗无内层分段切换（chooser 三选即专线固定）');
  assert.equal(doc.getElementById('feedback-modal-title'), null, '无标题切换逻辑（titleId 已随 switchFeedbackKind 移除）');
  assert.ok(!doc.getElementById('feedback-subject-row'), '反馈浮窗已无投诉对象行');
});

test('R22 最近联系的人：打开后按 tab 拉取并渲染 chips', async () => {
  const { dom, ctx } = makeCtx({ recentByType: { teacher: [{ id: 7, name: '李老师', subtitle: '教师', role: 'teacher' }] } });
  const doc = dom.window.document;
  await vm.runInContext(`openComplaintModal()`, ctx);
  await tick();
  const chips = doc.querySelectorAll('#cmp-recent-teacher .cmp-chip');
  assert.equal(chips.length, 1, '最近交互教师 chip');
  assert.ok(chips[0].textContent.includes('李老师'));
});

test('R22 对象选择与提交：选对象 + 理由 → POST /api/complaints；未选对象拦截', async () => {
  const { dom, ctx, complaints } = makeCtx();
  const doc = dom.window.document;
  const UI = globalThis.APP_CONSTANTS.UI;
  await vm.runInContext(`openComplaintModal()`, ctx);
  await tick();
  // 未选对象提交 → 拦截提示，不发请求（v0.25.99：提示走底部 Toast）
  await vm.runInContext(`document.getElementById('complaint-reason').value = UI.COMPLAINT_REASONS[0]; switchComplaintReason(document.getElementById('complaint-reason')); submitComplaint()`, ctx);
  assert.equal(complaints.length, 0, '未选对象不发请求');
  assert.ok([...doc.querySelectorAll('#toast-container .toast')].some(t => t.textContent.includes(UI.COMPLAINT_TARGET_REQUIRED)), '未选对象 Toast 提示');
  // 选对象（教师 tab）+ 理由 + 详情 → 提交
  await vm.runInContext(`pickComplaintTarget('teacher', 5, { dataset: { name: '李老师' } })`, ctx);
  assert.ok(doc.getElementById('cmp-selected-teacher').textContent.includes('李老师'), '选中区显示对象名');
  doc.getElementById('complaint-detail').value = '多次迟到';
  await vm.runInContext(`submitComplaint()`, ctx);
  await tick();
  assert.equal(complaints.length, 1, '提交一次');
  assert.deepEqual(complaints[0].body, { targetType: 'teacher', targetId: 5, reason: UI.COMPLAINT_REASONS[0], detail: '多次迟到', uploadIds: [] }, 'U11：无附件时 uploadIds 为空数组');
  assert.equal(doc.getElementById('modal-container').innerHTML, '', '提交后浮窗关闭');
});

test('R22 对象按 tab 隔离：学生 tab 选择不影响教师 tab，提交当前 tab', async () => {
  const { dom, ctx, complaints } = makeCtx();
  const doc = dom.window.document;
  const UI = globalThis.APP_CONSTANTS.UI;
  await vm.runInContext(`openComplaintModal()`, ctx);
  await tick();
  await vm.runInContext(`pickComplaintTarget('teacher', 5, { dataset: { name: '李老师' } })`, ctx);
  await vm.runInContext(`switchComplaintTab('student'); pickComplaintTarget('student', 9, { dataset: { name: '王同学' } })`, ctx);
  await vm.runInContext(`document.getElementById('complaint-reason').value = UI.COMPLAINT_REASONS[1]; switchComplaintReason(document.getElementById('complaint-reason')); submitComplaint()`, ctx);
  await tick();
  assert.deepEqual(complaints[0].body, { targetType: 'student', targetId: 9, reason: UI.COMPLAINT_REASONS[1], detail: '', uploadIds: [] }, '提交当前 tab 的选中对象');
});

test('R22 对象搜索：候选渲染 + 点击选中后清空结果', async () => {
  const { dom, ctx } = makeCtx({ searchRows: [{ id: 3, name: '赵老师', subtitle: '教师', role: 'teacher' }] });
  const doc = dom.window.document;
  await vm.runInContext(`openComplaintModal()`, ctx);
  await tick();
  await vm.runInContext(`complaintSearch('teacher', '赵')`, ctx);
  await tick();
  const items = doc.querySelectorAll('#cmp-results-teacher .cmp-result');
  assert.equal(items.length, 1, '候选渲染');
  await vm.runInContext(`pickComplaintTarget('teacher', 3, { dataset: { name: '赵老师' } })`, ctx);
  assert.ok(doc.getElementById('cmp-selected-teacher').textContent.includes('赵老师'));
  assert.equal(doc.getElementById('cmp-results-teacher').innerHTML, '', '选中后清空搜索结果');
});

test('M12 我的投诉与反馈（合并）：投诉卡渲染对象/理由/状态；与反馈同浮窗；空态', async () => {
  const { dom, ctx } = makeCtx({ myComplaints: [
    { id: 1, target_type: 'teacher', target_snapshot: { name: '李老师' }, reason: '虚假信息或欺诈', detail: '多次迟到', status: 'open', created_at: '2026-08-09 10:00:00' },
  ] });
  const doc = dom.window.document;
  const UI = globalThis.APP_CONSTANTS.UI;
  await vm.runInContext(`openMyFeedback()`, ctx); // M12：合并入口统一走 openMyFeedback
  await tick();
  const cards = doc.querySelectorAll('.my-feedback-list .complaint-card');
  assert.equal(cards.length, 1, '一条投诉（并入合并浮窗）');
  assert.ok(cards[0].textContent.includes('李老师'), '对象名');
  assert.ok(cards[0].textContent.includes('虚假信息或欺诈'), '理由');
  assert.ok(cards[0].textContent.includes(UI.COMPLAINT_STATUS_OPEN), '状态处理中');
  assert.ok(cards[0].textContent.includes('多次迟到'), '详情');
  // 反馈+投诉共存：mineRows 有反馈时两张卡都在同一浮窗
  const { dom: dom3, ctx: ctx3 } = makeCtx({ mineRows: [{ kind: 'bug', title: '卡顿', content: 'x', status: 'open', created_at: '2026-08-09 09:00:00' }], myComplaints: [
    { id: 2, target_type: 'post', target_snapshot: { name: '帖子' }, reason: '违法违规内容', detail: '', status: 'open', created_at: '2026-08-09 11:00:00' },
  ] });
  await vm.runInContext(`openMyFeedback()`, ctx3);
  await tick();
  assert.equal(dom3.window.document.querySelectorAll('.my-feedback-list .my-feedback-card').length, 1, '反馈卡在合并浮窗');
  assert.equal(dom3.window.document.querySelectorAll('.my-feedback-list .complaint-card').length, 1, '投诉卡在合并浮窗');
  // 空态（反馈与投诉都空）
  const { dom: dom2, ctx: ctx2 } = makeCtx({ myComplaints: [] });
  await vm.runInContext(`openMyFeedback()`, ctx2);
  await tick();
  assert.ok(dom2.window.document.querySelector('.my-feedback-list').textContent.includes(UI.MY_FEEDBACK_EMPTY), '空态文案');
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

// ==================== U11 投诉附件（前端） ====================

test('U11 投诉浮窗：附件上传区（添加按钮 + 多选文件输入 + 复用 .chat-stage 暂存容器）', async () => {
  const { dom, ctx } = makeCtx();
  const doc = dom.window.document;
  await vm.runInContext(`openComplaintModal()`, ctx);
  await tick();
  assert.ok(doc.querySelector('.complaint-attach-btn'), '添加附件按钮');
  const input = doc.getElementById('complaint-file-input');
  assert.ok(input, '文件输入在 DOM');
  assert.ok(input.multiple, '支持多选');
  const stage = doc.getElementById('complaint-stage');
  assert.ok(stage, '暂存区容器存在');
  assert.ok(stage.classList.contains('chat-stage'), '复用聊天暂存区样式类 .chat-stage');
  assert.equal(doc.querySelectorAll('.complaint-attach-row .chat-stage').length, 1, '暂存区挂在附件行内');
});

test('U11 提交投诉：携带已传完附件 uploadIds；在途附件拦截提交', async () => {
  const { dom, ctx, complaints } = makeCtx();
  const doc = dom.window.document;
  const UI = globalThis.APP_CONSTANTS.UI;
  await vm.runInContext(`openComplaintModal()`, ctx);
  await tick();
  // 桩两条暂存：一条就绪(uploadId=7)、一条在途(ready=false)——直接驱动 renderComplaintStage（FileReader 在 jsdom 不实现，桩化状态）
  await vm.runInContext(`
    _cpStaged = [
      { id: 1, kind: 'image', name: 'a.png', dataUrl: 'data:image/png;base64,AAA', thumb: '', progress: 100, ready: true, uploadId: 7 },
      { id: 2, kind: 'file', name: 'b.txt', dataUrl: 'data:text/plain;base64,QQ==', progress: 30, ready: false, uploadId: null }
    ];
    renderComplaintStage();
    pickComplaintTarget('teacher', 5, { dataset: { name: '李老师' } });
    document.getElementById('complaint-reason').value = UI.COMPLAINT_REASONS[0];
    switchComplaintReason(document.getElementById('complaint-reason'));
    submitComplaint();
  `, ctx);
  await tick();
  assert.equal(complaints.length, 0, '在途附件未传完 → 拦截不发请求');
  assert.ok([...doc.querySelectorAll('#toast-container .toast')].some(t => t.textContent.includes(UI.COMPLAINT_ATTACH_UPLOADING)), '提示等待附件上传');
  assert.equal(doc.querySelectorAll('#complaint-stage .chat-stage-item').length, 2, '暂存区渲染两项（含进度圈未完成项）');
  assert.ok(doc.querySelector('#complaint-stage img'), '图片项显示本地缩略图');
  // 全部就绪 → 提交携带 uploadIds
  await vm.runInContext(`
    _cpStaged[1].ready = true; _cpStaged[1].progress = 100; _cpStaged[1].uploadId = 8;
    submitComplaint();
  `, ctx);
  await tick();
  assert.equal(complaints.length, 1, '就绪后提交成功');
  assert.deepEqual(complaints[0].body, { targetType: 'teacher', targetId: 5, reason: UI.COMPLAINT_REASONS[0], detail: '', uploadIds: [7, 8] });
});

test('U11 审查 F1：头部 ✕ 关闭后重开浮窗清旧暂存，新投诉不静默携带旧 uploadId', async () => {
  const { dom, ctx, complaints } = makeCtx();
  const doc = dom.window.document;
  const UI = globalThis.APP_CONSTANTS.UI;
  await vm.runInContext(`openComplaintModal()`, ctx);
  await tick();
  await vm.runInContext(`
    _cpStaged = [ { id: 1, kind: 'file', name: 'old.txt', progress: 100, ready: true, uploadId: 99, _xhr: { abort: () => {} } } ];
    renderComplaintStage();
  `, ctx);
  // 头部 ✕ 写死 closeModal()（app-ui），不经 closeComplaintModal → 模拟该关闭路径
  await vm.runInContext(`closeModal()`, ctx);
  await tick();
  // 重开：openComplaintModal 须重置暂存（否则 room=0 加不进新附件 + 旧 uploadId 静默带入）
  await vm.runInContext(`openComplaintModal()`, ctx);
  await tick();
  assert.equal(vm.runInContext('_cpStaged.length', ctx), 0, '重开即清旧暂存（含 closeModal 绕过路径）');
  // 新会话提交：不带旧 uploadId
  await vm.runInContext(`
    pickComplaintTarget('teacher', 5, { dataset: { name: '李老师' } });
    document.getElementById('complaint-reason').value = UI.COMPLAINT_REASONS[0];
    switchComplaintReason(document.getElementById('complaint-reason'));
    submitComplaint();
  `, ctx);
  await tick();
  assert.equal(complaints.length, 1, '重开后正常提交');
  assert.deepEqual(complaints[0].body, { targetType: 'teacher', targetId: 5, reason: UI.COMPLAINT_REASONS[0], detail: '', uploadIds: [] }, '不携带旧暂存 uploadId');
});

test('U11 取消浮窗：清理暂存（在途 abort + 已上传 best-effort 删）', async () => {
  const { dom, ctx } = makeCtx();
  const doc = dom.window.document;
  const deletes = [];
  await vm.runInContext(`openComplaintModal()`, ctx);
  await tick();
  await vm.runInContext(`
    _cpStaged = [ { id: 9, kind: 'file', name: 'b.txt', progress: 100, ready: true, uploadId: 11, _xhr: { abort: () => {} } } ];
    renderComplaintStage();
  `, ctx);
  // 把 DELETE /api/uploads 也记入（验证 best-effort 删暂存）——fetch mock 未拦截 DELETE，默认返回 {}；改在 vm 层看 api 调用
  const origApi = vm.runInContext(`api`, ctx);
  vm.runInContext(`
    globalThis.__del = [];
    api = async (u, o) => { if (o && o.method === 'DELETE') globalThis.__del.push(u); return origApi(u, o); };
  `, ctx);
  await vm.runInContext(`closeComplaintModal()`, ctx);
  await tick();
  assert.equal(doc.getElementById('modal-container').innerHTML, '', '浮窗已关');
  const dels = vm.runInContext('globalThis.__del', ctx);
  assert.ok(dels.includes('/api/uploads/11'), '已上传附件 best-effort 删暂存');
});

test('U11 我的投诉：投诉卡渲染附件缩略行（图片缩略图 + 文件徽标）', async () => {
  const { dom, ctx } = makeCtx({ myComplaints: [
    { id: 1, target_type: 'teacher', target_snapshot: { name: '李老师' }, reason: '虚假信息或欺诈', detail: '', status: 'open', created_at: '2026-08-09 10:00:00',
      attachments: [ { kind: 'image', name: 'a.png', thumb: 'data:image/png;base64,T', body: '' }, { kind: 'file', name: 'b.txt', body: '' } ] },
  ] });
  const doc = dom.window.document;
  await vm.runInContext(`openMyFeedback()`, ctx);
  await tick();
  const card = doc.querySelector('.complaint-card');
  assert.ok(card, '投诉卡渲染');
  const imgs = card.querySelectorAll('.complaint-attach img');
  assert.equal(imgs.length, 1, '图片附件缩略图');
  assert.ok(imgs[0].src.includes('base64,T'), '缩略图 src 即列表下发的解密 thumb');
  const fileBtn = card.querySelector('.complaint-attach--file');
  assert.ok(fileBtn, '文件附件徽标按钮');
  assert.ok(fileBtn.textContent.includes('TXT'), '扩展名徽标（chatFileExt 复用）');
});

test('U11 附件懒加载：点击图片附件拉原图开大图查看器', async () => {
  const { dom, ctx } = makeCtx({ myComplaints: [
    { id: 1, target_type: 'teacher', target_snapshot: { name: '李老师' }, reason: '虚假信息或欺诈', detail: '', status: 'open', created_at: '2026-08-09 10:00:00',
      attachments: [ { kind: 'image', name: 'a.png', thumb: 'data:image/png;base64,T', body: '' } ] },
  ] });
  const doc = dom.window.document;
  await vm.runInContext(`openMyFeedback()`, ctx);
  await tick();
  const btn = doc.querySelector('.complaint-attach');
  assert.ok(btn, '图片附件按钮');
  btn.click();
  await tick();
  const viewer = doc.querySelector('.image-viewer-modal');
  assert.ok(viewer, '点击后开大图查看器（openImageViewer）');
  const img = viewer.querySelector('img');
  assert.ok(img && img.src.includes('base64,ZZZ'), '查看器加载懒加载接口下发的原图 body');
});

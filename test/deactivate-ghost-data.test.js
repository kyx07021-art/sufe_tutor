/**
 * 需求二（2026-08-08）·注销幽灵数据 + 一方注销 tag + 广场门控（v0.25.42）
 *
 * 缺陷实证：注销用户的幽灵需求还在大厅挂着、幽灵帖子在广场挂着——注销只改 users.username
 * 墓碑与清凭证，广场查询无 deactivated 门控，且合同正文嵌入的是起草/签署时的原始用户名
 * （墓碑只改了 users.username，合同正文里的原名仍可被对方读到，墓碑机制被绕过）。
 *
 * 改造（双保险：门控是皮带、purge 是吊带）：
 *   广场门控：dbGetDemands / dbListPosts / dbGetPendingPushesForTeacher / dbGetIntentTeachers /
 *     dbGetApprovedReviews 全部加 u.deactivated=0；广播通知不带已注销用户。
 *   purge 收束：注销时删尽单方数据；发起方待处理签约请求收束为「已拒绝」终态（行 + 会话气泡
 *     同步终态，防接收方死按钮 404——不能 DELETE，气泡自包含渲染 body JSON）。
 *   合同不可修改性铁律（v0.25.46 返工）：合同正文一个字都不许碰——注销绝不改写 contract_md
 *     （业务头/第十条签署记录保持原文，台账不追加）；对端「一方已注销」tag 由前端 JOIN users
 *     墓碑名自然呈现（合同是双方数据，对方本就知道本人用户名，无真实隐私增益，改文却毁存证）。
 *   前端 tag：DISP.isDeactivated / deactivatedTag，七个对端姓名面（会话项/聊天头/合同卡/需求卡/
 *     帖子卡/资料面板/评价卡）追加「一方已注销」中性灰 tag。
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { DatabaseSync } from 'node:sqlite';
import { readFileSync } from 'node:fs';
import { JSDOM } from 'jsdom';
import vm from 'node:vm';
import {
  initDb, dbGetDemands, dbListPosts, dbDeactivateUser, dbPurgeUserOwnedData, dbGetContractById,
} from '../server/db.js';
import {
  initLedgerTable, handleCreateContract, handleSignContract, handleVerifyContract,
} from '../server/contract.js';
import { handleDeactivateAccount } from '../server/routes-auth.js';
import { tokenDigest } from '../server/crypto.js';

const ENV = { ADMIN_USERNAMES: ['admin_sufe'], ADMIN_DEFAULT_PASSWORD: 'test-pw-123', OTP_PROVIDER: 'mock' }; // mock：测试不真实发信

function d1Shim(raw) {
  return {
    prepare(sql) {
      const st = { _sql: sql, _params: [], bind(...p) { st._params = p; return st; },
        all(...p) { return { results: raw.prepare(st._sql).all(...(p.length ? p : st._params)) }; },
        first(...p) { return raw.prepare(st._sql).get(...(p.length ? p : st._params)) ?? undefined; },
        run(...p) { const info = raw.prepare(st._sql).run(...(p.length ? p : st._params)); return { meta: { changes: Number(info.changes), last_row_id: Number(info.lastInsertRowid) } }; } };
      return st;
    },
    batch(stmts) {
      if (!stmts.length) throw new Error('D1 batch requires at least one statement'); // 真实 D1 空 batch 抛错（同 content-admin shim 口径）
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
const idOf = (raw, name) => raw.prepare('SELECT id FROM users WHERE username=?').get(name).id;
const mkSession = async (raw, name) => {
  const token = `${name}-token`, sessionId = `sess-${name}`;
  raw.prepare('INSERT INTO auth_sessions (token_hash,user_id,session_id,label,expires_at) VALUES (?,?,?,?,?)')
    .run(await tokenDigest(token), idOf(raw, name), sessionId, 'x', '2099-01-01 00:00:00');
  return { token, sessionId };
};
const capOf = async (raw, name, sessionId) => {
  const cap = `cap-${name}`;
  raw.prepare('INSERT INTO danger_caps (user_id, session_id, token_hash, expires_at) VALUES (?,?,?,?)')
    .run(idOf(raw, name), sessionId, await tokenDigest(cap), '2099-01-01 00:00:00');
  return cap;
};

/** 基础种子：s1/s2 学生 + t1 教师；d1=s1 已签约需求（起草合同用）、d2=s2（待注销）活跃需求（幽灵）、
 *  d3=s1 活跃需求（大厅对照组）；会话 C1=s1-t1（绑 d1） */
async function seed(raw, db) {
  await initDb(db, ENV);
  await initLedgerTable(db);
  raw.exec(`INSERT INTO users (username,password_hash,salt,role) VALUES
    ('s1','h','s','student'),('s2','h','s','student'),('t1','h','s','teacher')`);
  const s1 = idOf(raw, 's1'), s2 = idOf(raw, 's2'), t1 = idOf(raw, 't1');
  const demand = (uid, status) => {
    raw.prepare(`INSERT INTO student_demands (user_id,student_grade,student_gender,target_subjects,current_scores,submitter_type,parent_contact,student_contact,status)
      VALUES (?,?,?,?,?,?,?,?,?)`).run(uid, 'senior1', 'female', '["math"]', '[]', 'self', '13800000000', '13800000000', status);
    return raw.prepare('SELECT id FROM student_demands ORDER BY id DESC LIMIT 1').get().id;
  };
  const d1 = demand(s1, 'contracted'); // 起草合同只能绑已签约需求
  const d2 = demand(s2, 'open');       // 幽灵需求（s2 待注销）
  const d3 = demand(s1, 'open');       // 大厅对照组
  raw.prepare('INSERT INTO conversations (student_user_id, teacher_user_id, demand_id) VALUES (?,?,?)').run(s1, t1, d1);
  return { s1, s2, t1, d1, d2, d3, s1S: await mkSession(raw, 's1'), s2S: await mkSession(raw, 's2'), t1S: await mkSession(raw, 't1') };
}

const contractBody = (convId, demandId) => ({
  conversationId: convId, demandId, method: 'online', plan: '补基础', hourlyRate: 150,
  schedule: '每周六晚', location: '线上', payMethod: 'per_session', payMethodOther: '',
  firstLessonDate: '2026-09-01', trialPay: 'normal', trialPayOther: '',
});

// ============================================================
// 服务端：广场门控（皮带）——已注销数据严禁入场
// ============================================================

test('广场门控：已注销学生的活跃需求不进需求大厅', async () => {
  const raw = rawOf(); const db = d1Shim(raw);
  const { s2 } = await seed(raw, db);
  // 注销 s2（墓碑 + 标记）：大厅查询必须拒绝其需求（d2 幽灵，仅剩 s1 的 d3）
  await dbDeactivateUser(db, s2, '已注销用户#2');
  const demands = await dbGetDemands(db, {});
  assert.equal(demands.length, 1, '大厅只留活跃学生 s1 的需求');
  assert.equal(demands[0].username, 's1', '幽灵需求（s2 的 d2）被门控拒绝');
  // 管理员视图不受门控（管理端须见全量，墓碑用户名原样呈现）
  const admin = await dbGetDemands(db, { admin: true });
  assert.ok(admin.demands.some(x => x.username.startsWith('已注销用户#')), '管理员视图保留全量（含已注销者需求行，墓碑呈现）');
});

test('广场门控：已注销用户的帖子不进资料广场', async () => {
  const raw = rawOf(); const db = d1Shim(raw);
  const { s1, s2 } = await seed(raw, db);
  raw.prepare('INSERT INTO posts (user_id, section, title, body_md) VALUES (?,?,?,?)').run(s1, 'plaza', '数学笔记', 'p1');
  raw.prepare('INSERT INTO posts (user_id, section, title, body_md) VALUES (?,?,?,?)').run(s2, 'plaza', '幽灵帖子', 'p2');
  await dbDeactivateUser(db, s2, '已注销用户#2');
  const posts = await dbListPosts(db, {});
  assert.equal(posts.length, 1, '广场只留活跃用户帖子');
  assert.equal(posts[0].username, 's1', '幽灵帖子（s2 的 p2）被门控拒绝');
});

// ============================================================
// 服务端：purge 收束（吊带）——单方数据带根拔 + 签约请求收束终态
// ============================================================

test('注销 purge：活跃需求删除、已签约需求转 revoked、意向/推送清空、签约请求收束「已拒绝」终态', async () => {
  const raw = rawOf(); const db = d1Shim(raw);
  const { s1, s2, t1 } = await seed(raw, db);
  // s2 有：活跃需求（删）、已签约需求（转 revoked）、对 t1 的推送、t1 对 s2 需求的意向、一条待处理签约请求（收束）
  raw.prepare(`INSERT INTO student_demands (user_id,student_grade,student_gender,target_subjects,current_scores,submitter_type,parent_contact,student_contact,status)
    VALUES (?,?,?,?,?,?,?,?,?)`).run(s2, 'senior1', 'female', '["math"]', '[]', 'self', '13800000000', '13800000000', 'contracted');
  const contractedId = raw.prepare('SELECT id FROM student_demands ORDER BY id DESC LIMIT 1').get().id;
  raw.prepare('INSERT INTO demand_pushes (student_user_id, teacher_user_id, demand_id, status) VALUES (?,?,?,?)')
    .run(s2, t1, contractedId, 'pending');
  raw.prepare('INSERT INTO demand_intents (teacher_user_id, demand_id, status) VALUES (?,?,?)').run(t1, contractedId, 'pending');
  // s2 发起一条待处理签约请求（往 s1 方向；会话内落 signing_request 气泡）
  raw.prepare('INSERT INTO conversations (student_user_id, teacher_user_id, demand_id) VALUES (?,?,?)').run(s2, s1, null);
  const c2 = raw.prepare('SELECT id FROM conversations ORDER BY id DESC LIMIT 1').get().id;
  const msgId = raw.prepare("INSERT INTO messages (conversation_id, sender_user_id, kind, body) VALUES (?,?,?,?)")
    .run(c2, s2, 'signing_request', JSON.stringify({ id: 9, price: 100, schedule: '周六', method: 'offline', status: 'pending' })).lastInsertRowid;
  raw.prepare('INSERT INTO signing_requests (conversation_id, initiator_user_id, message_id, price, schedule, method, status) VALUES (?,?,?,?,?,?,?)')
    .run(c2, s2, Number(msgId), 100, '周六', 'offline', 'pending');

  await dbDeactivateUser(db, s2, '已注销用户#2');
  await dbPurgeUserOwnedData(db, s2, 'student');

  const openCount = raw.prepare('SELECT COUNT(*) AS c FROM student_demands WHERE user_id=? AND status=?').get(s2, 'open').c;
  assert.equal(openCount, 0, '活跃需求连根拔');
  const contractedRow = raw.prepare('SELECT status FROM student_demands WHERE id=?').get(contractedId);
  assert.equal(contractedRow.status, 'revoked', '已签约需求转 revoked（合同 demand_id 不悬空）');
  const pushCount = raw.prepare('SELECT COUNT(*) AS c FROM demand_pushes WHERE student_user_id=?').get(s2).c;
  assert.equal(pushCount, 0, '学生侧推送清空');
  const sr = raw.prepare('SELECT status FROM signing_requests WHERE conversation_id=?').get(c2);
  assert.equal(sr.status, 'rejected', '待处理签约请求收束为已拒绝（行保留为双方协商记录）');
  const bubble = raw.prepare('SELECT body FROM messages WHERE id=?').get(Number(msgId));
  const b = JSON.parse(bubble.body);
  assert.equal(b.status, 'rejected', '会话内 signing_request 气泡同步终态（接收方无死按钮）');
});

// ============================================================
// 服务端：合同不可修改性铁律（v0.25.46 返工）——注销一个字都不许碰合同正文
// ============================================================

test('合同不可修改性：注销不改 contract_md（业务头/签署记录保持原文），台账不追加，verify 仍通过', async () => {
  const raw = rawOf(); const db = d1Shim(raw);
  const { s1, t1, d1, s1S, t1S } = await seed(raw, db);
  assert.equal((await handleCreateContract(db, contractBody(1, d1), reqOf(t1S.token))).status, 201);
  await handleSignContract(db, 1, { capToken: await capOf(raw, 't1', t1S.sessionId) }, reqOf(t1S.token));
  await handleSignContract(db, 1, { capToken: await capOf(raw, 's1', s1S.sessionId) }, reqOf(s1S.token));
  const before = await dbGetContractById(db, 1);
  assert.ok(before.contract_md.includes('s1'), '签署前正文含学生原始用户名');
  const ledgerBefore = raw.prepare('SELECT COUNT(*) AS c FROM contract_ledger WHERE contract_id=1').get().c;

  // 注销 s1（墓碑 + purge）——合同正文必须一字不动
  await dbDeactivateUser(db, s1, `已注销用户#${s1}`);
  await dbPurgeUserOwnedData(db, s1, 'student');

  const after = await dbGetContractById(db, 1);
  assert.equal(after.contract_md, before.contract_md, '注销后合同正文逐字不变（不可修改性铁律）');
  assert.equal(after.prev_business, before.prev_business, 'prev_business 留痕不变');
  assert.equal(after.updated_at, before.updated_at, 'updated_at 不被注销触碰');
  const ledgerAfter = raw.prepare('SELECT COUNT(*) AS c FROM contract_ledger WHERE contract_id=1').get().c;
  assert.equal(ledgerAfter, ledgerBefore, '注销不追加台账（正文没变，无新哈希）');
  const v = await handleVerifyContract(db, 1, reqOf(t1S.token));
  assert.equal(v.status, 200);
  const data = await v.json();
  assert.equal(data.valid, true, '哈希链校验通过');
});

test('handleDeactivateAccount 端到端：注销后合同正文逐字不变（一字不碰）', async () => {
  const raw = rawOf(); const db = d1Shim(raw);
  const { s1, t1, d1, s1S, t1S } = await seed(raw, db);
  assert.equal((await handleCreateContract(db, contractBody(1, d1), reqOf(t1S.token))).status, 201);
  await handleSignContract(db, 1, { capToken: await capOf(raw, 't1', t1S.sessionId) }, reqOf(t1S.token));
  await handleSignContract(db, 1, { capToken: await capOf(raw, 's1', s1S.sessionId) }, reqOf(s1S.token));
  const before = await dbGetContractById(db, 1);
  const cap = await capOf(raw, 's1', s1S.sessionId);
  const res = await handleDeactivateAccount(db, { capToken: cap }, reqOf(s1S.token));
  assert.equal(res.status, 200);
  const ct = await dbGetContractById(db, 1);
  assert.equal(ct.contract_md, before.contract_md, '注销接口不碰合同正文');
  assert.ok(ct.contract_md.includes('s1'), '正文仍含原始用户名（对端本就知晓，合同不可修改）');
});

// ============================================================
// 前端：DISP 助手 + 七个渲染点 tag 注入 + CSS
// ============================================================

const FILES = [
  'constants.js', 'region-data.js', 'app-display.js', 'app-state.js', 'app-api.js',
  'app-datahub.js', 'app-anim.js', 'app-ui.js', 'app-otp.js', 'app-captcha.js', 'app-onboard.js', 'app-region.js',
  'app-posts.js', 'app-chat.js', 'app-contracts.js', 'app-chart.js', 'app-admin.js',
  'app-demands.js', 'app-teachers.js', 'app-style.js', 'app-pages.js', 'app-shell.js', 'app-auth.js',
];

function makeCtx() {
  const html = readFileSync('./index.html', 'utf8')
    .replace(/<script src="\/app-[a-z-]+\.js"><\/script>/g, '');
  const dom = new JSDOM(html, { url: 'http://localhost/', pretendToBeVisual: true, runScripts: 'dangerously' });
  const w = dom.window;
  w.HTMLCanvasElement.prototype.getContext = function () { // jsdom 无 canvas：patch 链式 2d 替身（app-captcha 进 boot FILES 后 vm 测试走到 canvas 路径）
    const mk = () => new Proxy(() => {}, { get: (t, k) => (k === 'canvas' ? {} : mk()), apply: () => mk() });
    return mk();
  };
  const ctx = vm.createContext({
    window: w, document: w.document,
    getComputedStyle: w.getComputedStyle.bind(w),
    localStorage: w.localStorage, sessionStorage: w.sessionStorage,
    console: { log() {}, warn() {}, error() {} },
    fetch: async (url) => ({ ok: true, status: 200, json: async () => ({}) }),
    setTimeout: globalThis.setTimeout, clearTimeout: globalThis.clearTimeout,
    setInterval: globalThis.setInterval, clearInterval: globalThis.clearInterval,
    Request: globalThis.Request, AbortController: globalThis.AbortController,
    performance: globalThis.performance,
    MutationObserver: class { observe() {} disconnect() {} takeRecords() { return []; } },
    Image: class { set src(v) { this._s = v; } },
    requestAnimationFrame: (cb) => setTimeout(cb, 16), cancelAnimationFrame: () => {},
    matchMedia: () => ({ matches: false, addEventListener: () => {} }),
  });
  for (const f of FILES) vm.runInContext(readFileSync('./' + f, 'utf8'), ctx, { filename: f });
  vm.runInContext(`if (typeof openCaptchaModal === 'function') { const _ocm = openCaptchaModal; openCaptchaModal = (o) => { if (o && o.onPass) o.onPass(); }; }`, ctx); // vm 测试直通拼图（生产走真验证）
  vm.runInContext('window.APP_CONSTANTS = globalThis.APP_CONSTANTS;', ctx);
  return { dom, ctx };
}

test('前端：DISP.isDeactivated / deactivatedTag 识别墓碑并渲染「一方已注销」tag', () => {
  const { ctx } = makeCtx();
  const tomb = vm.runInContext(`'${'已注销用户#7'}'`, ctx);
  assert.equal(vm.runInContext('DISP.isDeactivated(' + JSON.stringify(tomb) + ')', ctx), true, '墓碑前缀命中');
  assert.equal(vm.runInContext('DISP.isDeactivated("teacher_li")', ctx), false, '正常用户名不命中');
  const tag = vm.runInContext('DISP.deactivatedTag(' + JSON.stringify(tomb) + ')', ctx);
  assert.ok(tag.includes('tag-deactivated'), '渲染 tag 类');
  assert.ok(tag.includes('一方已注销'), '文案单源 constants.UI.PEER_DEACTIVATED_TAG');
  assert.equal(vm.runInContext('DISP.deactivatedTag("teacher_li")', ctx), '', '正常用户名无 tag');
});

test('前端：需求卡/帖子卡对端已注销时追加「一方已注销」tag', () => {
  const { ctx } = makeCtx();
  const tomb = '已注销用户#7';
  vm.runInContext(`state.user = { id: 1, role: 'student', username: 'me' };`, ctx);
  const demandHtml = vm.runInContext(`renderDemandCard({
      id: 3, user_id: 7, username: ${JSON.stringify(tomb)}, student_grade: 'senior1',
      target_type: 'academic', target_subjects: ['math'], status: 'open', province: 'zhejiang',
      teaching_method: 'offline', budget_min: 100, budget_max: 200,
    }, {})`, ctx);
  assert.ok(demandHtml.includes('tag-deactivated'), '需求卡渲染一方已注销 tag');
  assert.ok(demandHtml.includes('一方已注销'), '需求卡 tag 文案');
  const postHtml = vm.runInContext(`renderPostCard({
      id: 5, user_id: 7, username: ${JSON.stringify(tomb)}, title: '题', body_md: '内容', like_count: 0,
    }, 0)`, ctx);
  assert.ok(postHtml.includes('tag-deactivated'), '帖子卡渲染一方已注销 tag');
  assert.ok(postHtml.includes('一方已注销'), '帖子卡 tag 文案');
  // 正常用户名不误伤
  const normalDemand = vm.runInContext(`renderDemandCard({
      id: 4, user_id: 8, username: 'teacher_li', student_grade: 'senior1',
      target_type: 'academic', target_subjects: ['math'], status: 'open',
    }, {})`, ctx);
  assert.ok(!normalDemand.includes('tag-deactivated'), '正常用户名需求卡无 tag');
});

test('前端：CSS 提供 .tag-deactivated 中性弱玻璃面（注销是状态中性信息，不惊扰）', () => {
  const glass = readFileSync('./glass.css', 'utf8');
  const rule = glass.split('.tag-deactivated {')[1] || '';
  assert.ok(rule.split('}')[0].includes('var(--g-fill-weak)'), '弱玻璃面');
  assert.ok(rule.split('}')[0].includes('var(--muted)'), '灰字（弱语义，不惊扰）');
});

// 七个渲染点全部接入 DISP.deactivatedTag（防漏抄；漏一处即失败）
test('七个对端姓名渲染点全部接入一方已注销 tag', () => {
  const chat = readFileSync('./app-chat.js', 'utf8');
  const contracts = readFileSync('./app-contracts.js', 'utf8');
  const demands = readFileSync('./app-demands.js', 'utf8');
  const posts = readFileSync('./app-posts.js', 'utf8');
  const teachers = readFileSync('./app-teachers.js', 'utf8');
  assert.ok((chat.match(/DISP\.deactivatedTag\(peer\.name\)/g) || []).length >= 2, '会话左栏项 + 聊天窗头部两处');
  assert.ok(contracts.includes('DISP.deactivatedTag(peerName)'), '合同卡');
  assert.ok(demands.includes('DISP.deactivatedTag(d.username)'), '需求卡');
  assert.ok(posts.includes('DISP.deactivatedTag(p.username)'), '帖子卡');
  assert.ok(teachers.includes('DISP.deactivatedTag(base.username)'), '资料面板');
  assert.ok(teachers.includes('DISP.deactivatedTag(r.reviewer_name)'), '评价卡');
});

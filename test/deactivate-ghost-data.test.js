/**
 * 需求二（2026-08-08）·注销幽灵数据 + 一方注销 tag + 广场门控（v0.25.42）
 *
 * 缺陷实证：注销用户的幽灵需求还在大厅挂着、幽灵帖子在广场挂着——注销只改 users.username
 * 墓碑与清凭证，广场查询无 deactivated 门控，且合同正文嵌入的是起草/签署时的原始用户名
 * （墓碑只改了 users.username，合同正文里的原名仍可被对方读到，墓碑机制被绕过）。
 *
 * 改造（双保险：门控是皮带、purge 是吊带）：
 *   广场门控：dbGetDemands / dbListPosts / dbGetApprovedReviews 全部加 u.deactivated=0；
 *     （intents/pushes 已随 S2 删除，无对应门控面）广播通知不带已注销用户。
 *   purge 收束：注销时删尽单方数据；发起方待处理签约请求收束为「已拒绝」终态（行 + 会话气泡
 *     同步终态，防接收方死按钮 404——不能 DELETE，气泡自包含渲染 body JSON）。
 *   合同不可修改性铁律（v0.25.46 返工）：合同正文一个字都不许碰——注销绝不改写 contract_md
 *     （业务头/第十条签署记录保持原文，台账不追加）；对端「一方已注销」tag 由前端 JOIN users
 *     墓碑名自然呈现（合同是双方数据，对方本就知道本人用户名，无真实隐私增益，改文却毁存证）。
 *   前端 tag：DISP.isDeactivated / deactivatedTag，七个对端姓名面（会话项/聊天头/合同卡/需求卡/
 *     帖子卡/资料面板/评价卡）追加「一方已注销」中性灰 tag。
 */
import { test } from 'node:test';
import { TEST_SECRETS } from './_test-secrets.js';
import assert from 'node:assert/strict';
import { DatabaseSync } from 'node:sqlite';
import { readFileSync } from 'node:fs';
import { initDb } from '../src/server/core/db.js';
import { isDeactivated, deactivatedTag } from '../src/client/core/display.js';
import { renderDemandCard } from '../src/client/features/student/render.js';
import { renderPostCard } from '../src/client/features/posts/render.js';
import { dbGetDemands } from '../src/server/domains/demand/repo.js';
import { dbListPosts } from '../src/server/domains/posts/repo.js';
import { dbDeactivateUser, dbPurgeUserOwnedData } from '../src/server/domains/auth/repo.js';
import { dbGetContractById } from '../src/server/domains/contract/repo.js';
import { initLedgerTable } from '../src/server/domains/contract/schema.js';
import { handleCreateContract, handleSignContract, handleVerifyContract } from '../src/server/domains/contract/api.js';
import { handleDeactivateAccount } from '../src/server/domains/auth/api.js';
import { tokenDigest } from '../src/server/core/crypto.js';

const ENV = { ...TEST_SECRETS, ADMIN_USERNAMES: ['admin_sufe'], ADMIN_DEFAULT_PASSWORD: 'test-pw-123' };

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
  // v1.2.0 T3：合格接单教师档案（chsi_verified=1 + 必填齐全），合同创建门禁依赖
  raw.prepare('INSERT INTO teacher_profiles (user_id, province, grade, gender, subjects, price_min, price_max, time_slots, teaching_method, chsi_verified) VALUES (?,?,?,?,?,?,?,?,?,1)')
    .run(t1, 'shanghai', 'freshman', 'male', '["math"]', 100, 200, '[{"day":"sat"}]', 'online');
  const demand = (uid, status) => {
    // S3 单科目新模型：subject 单值 + grade/province/teaching_method/current_score/address_area 等新列；
    // 联系方式（parent/student_contact）、display_id 等整列删除。
    raw.prepare(`INSERT INTO student_demands (user_id,subject,grade,province,teaching_method,current_score,address_area,expected_time,preferred_tags,preferred_gender,budget_min,budget_max,additional_info,status)
      VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?)`)
      .run(uid, 'math', 'senior1', 'shanghai', 'offline', '', '黄浦区·南京东路街道', '', '[]', '', 100, 200, '', status);
    return raw.prepare('SELECT id FROM student_demands ORDER BY id DESC LIMIT 1').get().id;
  };
  const d1 = demand(s1, 'closed'); // S3：状态仅 open/closed——closed 不进广场；合同创建不依赖需求状态（S5 独立，conversation active 即可）
  const d2 = demand(s2, 'open');   // 幽灵需求（s2 待注销）
  const d3 = demand(s1, 'open');   // 大厅对照组
  raw.prepare('INSERT INTO conversations (student_user_id, teacher_user_id, demand_id) VALUES (?,?,?)').run(s1, t1, d1);
  return { s1, s2, t1, d1, d2, d3, s1S: await mkSession(raw, 's1'), s2S: await mkSession(raw, 's2'), t1S: await mkSession(raw, 't1') };
}

// S5：合同独立化——全字段自填 INSERT，不绑需求（无 demandId）；时薪字段为 rate（旧 hourlyRate 已删）。
const contractBody = (convId) => ({
  conversationId: convId, method: 'online', plan: '补基础', rate: 150,
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
  assert.equal(demands[0].studentName, 's1', '幽灵需求（s2 的 d2）被门控拒绝（mapper 出口 studentName）');
  // 管理员视图不受门控（管理端须见全量，墓碑用户名原样呈现）
  const admin = await dbGetDemands(db, { admin: true });
  assert.ok(admin.demands.some(x => x.studentName.startsWith('已注销用户#')), '管理员视图保留全量（含已注销者需求行，墓碑呈现）');
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

// S3 单科目 + S5 合同独立：注销 purge 语义收敛——学生全部需求删除（无 contracted/revoked 保留，
// 合同不绑需求）；intents/pushes/signing_contracts 已随 S2/S5 删除，无清理面；聊天正文/附件匿名化保留。
test('注销 purge：学生全部需求删除（open+closed）；聊天正文与附件文件名匿名化', async () => {
  const raw = rawOf(); const db = d1Shim(raw);
  const { s1, s2 } = await seed(raw, db);
  // s2 另有一条手动 closed 需求（seed 已有 open 的 d2）——purge 后 open/closed 全部删除
  raw.prepare(`INSERT INTO student_demands (user_id,subject,grade,province,teaching_method,current_score,address_area,expected_time,preferred_tags,preferred_gender,budget_min,budget_max,additional_info,status)
    VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?)`)
    .run(s2, 'english', 'junior1', 'shanghai', 'online', '', '', '', '[]', '', 100, 200, '', 'closed');
  // s2 发一条聊天正文（purge 后匿名化清空 body/name）
  raw.prepare('INSERT INTO conversations (student_user_id, teacher_user_id, demand_id) VALUES (?,?,?)').run(s2, s1, null);
  const c2 = raw.prepare('SELECT id FROM conversations ORDER BY id DESC LIMIT 1').get().id;
  const msgId = raw.prepare("INSERT INTO messages (conversation_id, sender_user_id, kind, body, name) VALUES (?,?,?,?,?)")
    .run(c2, s2, 'text', '这是我的手机号 13800000000', 'photo.jpg').lastInsertRowid;

  await dbDeactivateUser(db, s2, '已注销用户#2');
  await dbPurgeUserOwnedData(db, s2, 'student');

  const s2Count = raw.prepare('SELECT COUNT(*) AS c FROM student_demands WHERE user_id=?').get(s2).c;
  assert.equal(s2Count, 0, '注销学生全部需求删除（open+closed；合同独立无「已签约保留」语义）');
  const msgRow = raw.prepare('SELECT body, name FROM messages WHERE id=?').get(Number(msgId));
  assert.equal(msgRow.body, '', '聊天正文匿名化清空');
  assert.equal(msgRow.name, '', '附件文件名清空');
});

// ============================================================
// 服务端：合同不可修改性铁律（v0.25.46 返工）——注销一个字都不许碰合同正文
// ============================================================

test('合同不可修改性：注销不改 contract_md（业务头/签署记录保持原文），台账不追加，verify 仍通过', async () => {
  const raw = rawOf(); const db = d1Shim(raw);
  const { s1, t1, d1, s1S, t1S } = await seed(raw, db);
  // S5：起草合同是危险操作（confirmDangerOtp）——须带起草方一次性 capToken
  assert.equal((await handleCreateContract(db, { ...contractBody(1), capToken: await capOf(raw, 't1', t1S.sessionId) }, reqOf(t1S.token))).status, 201);
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
  // S5：起草合同是危险操作（confirmDangerOtp）——须带起草方一次性 capToken
  assert.equal((await handleCreateContract(db, { ...contractBody(1), capToken: await capOf(raw, 't1', t1S.sessionId) }, reqOf(t1S.token))).status, 201);
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
// 前端：display 助手 + 七个渲染点 tag 注入 + CSS（B4：直接 import ESM）
// ============================================================

test('前端：isDeactivated / deactivatedTag 识别墓碑并渲染「一方已注销」tag', () => {
  const tomb = '已注销用户#7';
  assert.equal(isDeactivated(tomb), true, '墓碑前缀命中');
  assert.equal(isDeactivated('teacher_li'), false, '正常用户名不命中');
  const tag = deactivatedTag(tomb);
  assert.ok(tag.includes('tag-deactivated'), '渲染 tag 类');
  assert.ok(tag.includes('一方已注销'), '文案单源 PEER_DEACTIVATED_TAG');
  assert.equal(deactivatedTag('teacher_li'), '', '正常用户名无 tag');
});

test('前端：需求卡/帖子卡对端已注销时追加「一方已注销」tag', () => {
  const tomb = '已注销用户#7';
  const demandHtml = renderDemandCard({
    id: 3, user_id: 7, username: tomb, student_grade: 'senior1',
    target_type: 'academic', target_subjects: ['math'], status: 'open', province: 'zhejiang',
    teaching_method: 'offline', budget_min: 100, budget_max: 200,
  }, {});
  assert.ok(demandHtml.includes('tag-deactivated'), '需求卡渲染一方已注销 tag');
  assert.ok(demandHtml.includes('一方已注销'), '需求卡 tag 文案');
  const postHtml = renderPostCard({
    id: 5, user_id: 7, username: tomb, title: '题', body_md: '内容', like_count: 0,
  }, 0);
  assert.ok(postHtml.includes('tag-deactivated'), '帖子卡渲染一方已注销 tag');
  assert.ok(postHtml.includes('一方已注销'), '帖子卡 tag 文案');
  // 正常用户名不误伤
  const normalDemand = renderDemandCard({
    id: 4, user_id: 8, username: 'teacher_li', student_grade: 'senior1',
    target_type: 'academic', target_subjects: ['math'], status: 'open',
  }, {});
  assert.ok(!normalDemand.includes('tag-deactivated'), '正常用户名需求卡无 tag');
});

test('前端：CSS 提供 .tag-deactivated 中性弱玻璃面（注销是状态中性信息，不惊扰）', () => {
  const glass = readFileSync('./glass.css', 'utf8');
  const rule = glass.split('.tag-deactivated {')[1] || '';
  assert.ok(rule.split('}')[0].includes('var(--g-fill-weak)'), '弱玻璃面');
  assert.ok(rule.split('}')[0].includes('var(--muted)'), '灰字（弱语义，不惊扰）');
});

// 七个渲染点全部接入 deactivatedTag（防漏抄；漏一处即失败）
test('七个对端姓名渲染点全部接入一方已注销 tag', () => {
  const chat = readFileSync('./src/client/features/chat/render.js', 'utf8');
  const contracts = readFileSync('./src/client/features/contract/render.js', 'utf8');
  const demands = readFileSync('./src/client/features/student/render.js', 'utf8');
  const posts = readFileSync('./src/client/features/posts/render.js', 'utf8');
  const teachers = readFileSync('./src/client/features/teacher/render.js', 'utf8');
  assert.ok((chat.match(/deactivatedTag\(peer\.name\)/g) || []).length >= 2, '会话左栏项 + 聊天窗头部两处');
  assert.ok(contracts.includes('deactivatedTag(peerName)'), '合同卡');
  assert.ok(demands.includes('deactivatedTag(d.username)'), '需求卡');
  assert.ok(posts.includes('deactivatedTag(p.username)'), '帖子卡');
  assert.ok(teachers.includes('deactivatedTag(p.username)'), '资料面板');
  assert.ok(teachers.includes('deactivatedTag(r.reviewer_name)'), '评价卡');
});

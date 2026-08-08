/**
 * v0.25.6 审计加固回归（需求四·4a 双路审计发现修复）：
 *
 *  1. handleCreateSigning 强制 demandId（无回落）：无/非法 demandId → 400，杜绝 demand_id=NULL
 *     的无需求签约绕过「每次签约绑定一份需求」门禁（原缺省回落 conv.demand_id 可落 NULL）。
 *  2. handleRespondSigning db.batch 原子化：sr 置 signed 与需求置 contracted 同一事务——
 *     同需求两会话并发双确认只单赢（一个 200 一个 410），杜绝双 signed 双评价门槛。
 *  3. handleCreateContract 收紧：无 demandId → 410；别教师签成的 contracted 需求 → 410
 *     （签约成交方与合同缔结方必须同一教师，同对师生换会话放行）；INSERT 守卫补 status='contracted'。
 *  4. bindable-demands phase=contract：别教师签成的需求不列出（同口径，防下拉可选、提交被拒的错位）。
 *
 * D1 形状同 signing-demand.test.js：db.prepare.bind.all/first/run + db.batch（事务 shim）。
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { DatabaseSync } from 'node:sqlite';
import { initDb } from '../server/db.js';
import { handleCreateSigning, handleRespondSigning } from '../server/signing.js';
import { handleCreateContract } from '../server/contract.js';
import { handleGetConversationBindableDemands } from '../server/routes-chat.js';
import { dbGetMyConversations } from '../server/db.js';
import { tokenDigest } from '../server/crypto.js';

const ENV = { ADMIN_USERNAMES: ['admin_sufe'], ADMIN_DEFAULT_PASSWORD: 'test-pw-123' };

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
const bindUrl = (convId, phase) => new URL(`http://localhost/api/conversations/${convId}/bindable-demands?phase=${phase}`);

/** 播种：s1/s2 学生 + t1/t2 教师；d1=s1 open、d2=s1 contracted；C1=s1-t1（conv id1）、C2=s1-t2（conv id2） */
async function seed(db, raw) {
  await initDb(db, ENV);
  raw.exec(`INSERT INTO users (username,password_hash,salt,role) VALUES
    ('s1','h','s','student'),('s2','h','s','student'),('t1','h','s','teacher'),('t2','h','s','teacher')`);
  const idOf = name => raw.prepare("SELECT id FROM users WHERE username=?").get(name).id;
  const s1 = idOf('s1'), s2 = idOf('s2'), t1 = idOf('t1'), t2 = idOf('t2');
  const insDemand = (owner, status) => {
    raw.prepare(`INSERT INTO student_demands (user_id,student_grade,student_gender,target_subjects,current_scores,submitter_type,parent_contact,student_contact,status)
      VALUES (?,?,?,?,?,?,?,?,?)`).run(owner, 'senior1', 'female', '["math"]', '[]', 'self', '13800000000', '13800000000', status);
    return raw.prepare('SELECT id FROM student_demands ORDER BY id DESC LIMIT 1').get().id;
  };
  const d1 = insDemand(s1, 'open');
  const d2 = insDemand(s1, 'contracted');
  raw.prepare('INSERT INTO conversations (student_user_id, teacher_user_id, demand_id) VALUES (?,?,?),(?,?,?)')
    .run(s1, t1, d1, s1, t2, d1); // C1=s1-t1, C2=s1-t2（同一需求 d1 两会话并存——并发双确认场景）
  const mkToken = async name => {
    const token = `${name}-token`;
    raw.prepare('INSERT INTO auth_sessions (token_hash,user_id,label,expires_at) VALUES (?,?,?,?)')
      .run(await tokenDigest(token), idOf(name), 'x', '2099-01-01 00:00:00');
    return token;
  };
  return { s1, s2, t1, t2, d1, d2, t1Token: await mkToken('t1'), t2Token: await mkToken('t2'), s1Token: await mkToken('s1') };
}
const signBody = (convId, demandId) => ({ conversationId: convId, demandId, price: 150, schedule: '每周六', method: 'offline' });
// handleCreateContract 最小合法 body（需求四·第3条：起草合同绑定已签约需求）
const contractBody = (convId, demandId) => ({
  conversationId: convId, demandId, method: 'online', plan: '补基础', hourlyRate: 150,
  schedule: '每周六晚', location: '线上', payMethod: 'per_session', payMethodOther: '',
  firstLessonDate: '2026-09-01', trialPay: 'normal', trialPayOther: '',
});

// ============ 1. handleCreateSigning 强制 demandId ============

test('发起签约：body 无 demandId → 400，不落库（无回落，杜绝无需求签约）', async () => {
  const raw = rawOf(); const db = d1Shim(raw);
  const { s1Token, d1 } = await seed(db, raw);
  const r = await handleCreateSigning(db, { conversationId: 1, demandId: undefined, price: 150, schedule: 'x', method: 'offline' }, reqOf(s1Token));
  assert.equal(r.status, 400, '缺 demandId 必须拒绝（原回落 conv.demand_id 可落 NULL 需求签约）');
  assert.equal(raw.prepare('SELECT COUNT(*) AS c FROM signing_requests').get().c, 0);
  assert.equal(raw.prepare('SELECT status FROM student_demands WHERE id=?').get(d1).status, 'open', '需求状态不受影响');
});

test('发起签约：demandId 非法（非数字/0/负数/小数）→ 400，不落库', async () => {
  for (const bad of ['abc', 0, -3, 1.5, null, '']) {
    const raw = rawOf(); const db = d1Shim(raw);
    const { s1Token } = await seed(db, raw);
    const r = await handleCreateSigning(db, { conversationId: 1, demandId: bad, price: 150, schedule: 'x', method: 'offline' }, reqOf(s1Token));
    assert.equal(r.status, 400, `demandId=${JSON.stringify(bad)} 应被拒`);
    assert.equal(raw.prepare('SELECT COUNT(*) AS c FROM signing_requests').get().c, 0, `demandId=${JSON.stringify(bad)} 不落库`);
  }
});

// ============ 2. handleRespondSigning 并发双确认只单赢 ============

test('同需求两会话并发双确认：只单赢（一个 200 一个 410，signed 仅一条）', async () => {
  const raw = rawOf(); const db = d1Shim(raw);
  const { s1Token, t1Token, t2Token, d1 } = await seed(db, raw);
  // t1 在 C1、t2 在 C2 分别对同一需求 d1 发起签约（两会话并存，可并行 pending）
  const r1 = await handleCreateSigning(db, signBody(1, d1), reqOf(t1Token));
  const r2 = await handleCreateSigning(db, signBody(2, d1), reqOf(t2Token));
  assert.equal(r1.status, 201); assert.equal(r2.status, 201);
  const { id: srA } = await r1.json();
  const { id: srB } = await r2.json();
  // s1 对两条请求并发确认：db.batch 原子化保证后到的批事务 EXISTS(open) 守卫失败 → 410
  const [resA, resB] = await Promise.all([
    handleRespondSigning(db, srA, { accept: true }, reqOf(s1Token)),
    handleRespondSigning(db, srB, { accept: true }, reqOf(s1Token)),
  ]);
  const statuses = [resA.status, resB.status].sort();
  assert.deepEqual(statuses, [200, 410], '并发双确认只单赢（一个确认成功，另一个被需求已签拦截）');
  assert.equal(raw.prepare(`SELECT COUNT(*) AS c FROM signing_requests WHERE status='signed'`).get().c, 1, '仅一条签约请求置 signed（杜绝双评价门槛）');
  assert.equal(raw.prepare('SELECT status FROM student_demands WHERE id=?').get(d1).status, 'contracted', '需求收敛为 contracted');
  assert.equal(raw.prepare(`SELECT COUNT(*) AS c FROM signing_requests WHERE status='pending'`).get().c, 1, '输家保持 pending（未被改 signed）');
});

test('确认签约后同需求再发起签约被拒（410）', async () => {
  const raw = rawOf(); const db = d1Shim(raw);
  const { s1Token, t1Token, t2Token, d1 } = await seed(db, raw);
  const r1 = await handleCreateSigning(db, signBody(1, d1), reqOf(t1Token));
  const { id: srA } = await r1.json();
  const r2 = await handleRespondSigning(db, srA, { accept: true }, reqOf(s1Token));
  assert.equal(r2.status, 200);
  // 需求已 contracted，t2 在 C2 再发起签约 → 410
  const r3 = await handleCreateSigning(db, signBody(2, d1), reqOf(t2Token));
  assert.equal(r3.status, 410, '已签约成交的需求不可再发起签约');
});

// ============ 3. handleCreateContract 收紧 ============

test('起草合同：无 demandId → 410；open 需求 → 410（须已签约）；contracted → 201', async () => {
  const raw = rawOf(); const db = d1Shim(raw);
  const { t1Token, d1, d2 } = await seed(db, raw);
  // 无 demandId → 410（conv 尚无合同，走 demandId 门禁；会话已有合同时由 CONTRACT_EXISTS 先行 409）
  const noId = contractBody(1, d2); noId.demandId = undefined;
  const r0 = await handleCreateContract(db, noId, reqOf(t1Token));
  assert.equal(r0.status, 410, '起草合同必须选已签约需求');
  // open 需求 → 410（须先签约）
  const r1 = await handleCreateContract(db, contractBody(1, d1), reqOf(t1Token));
  assert.equal(r1.status, 410, 'open 需求不可起草合同');
  // d2 已 contracted（seed 直插，无 signing_request）→ 同教师可起草
  const r2 = await handleCreateContract(db, contractBody(1, d2), reqOf(t1Token));
  assert.equal(r2.status, 201, '已签约（contracted）需求可起草合同');
});

test('起草合同：别教师签成的 contracted 需求 → 410；本会话同教师 → 201', async () => {
  const raw = rawOf(); const db = d1Shim(raw);
  const { s1Token, t1Token, t2Token, d1 } = await seed(db, raw);
  // t1 在 C1 与 s1 签约 d1（走完整 API 流，生成 signed signing_request）
  const r1 = await handleCreateSigning(db, signBody(1, d1), reqOf(t1Token));
  const { id: srA } = await r1.json();
  assert.equal((await handleRespondSigning(db, srA, { accept: true }, reqOf(s1Token))).status, 200);
  // t2 在 C2 起草合同绑 d1 → 410（d1 由别教师 t1 签成，签约成交方与合同缔结方必须同一教师）
  const r2 = await handleCreateContract(db, contractBody(2, d1), reqOf(t2Token));
  assert.equal(r2.status, 410, '别教师签成的需求不可跨会话抢绑起草合同');
  assert.equal(raw.prepare('SELECT COUNT(*) AS c FROM contracts').get().c, 0, '被拒不落合同');
  // t1 在 C1 起草合同绑 d1 → 201（成交方本人）
  const r3 = await handleCreateContract(db, contractBody(1, d1), reqOf(t1Token));
  assert.equal(r3.status, 201, '签约成交教师本人可起草合同');
  assert.equal(raw.prepare('SELECT COUNT(*) AS c FROM contracts').get().c, 1);
});

test('起草合同：同需求重复起草 → 409（一条需求一份合同）', async () => {
  const raw = rawOf(); const db = d1Shim(raw);
  const { t1Token, d2 } = await seed(db, raw);
  assert.equal((await handleCreateContract(db, contractBody(1, d2), reqOf(t1Token))).status, 201);
  const r2 = await handleCreateContract(db, contractBody(1, d2), reqOf(t1Token));
  assert.equal(r2.status, 409, '一条需求只允许一份合同');
});

// ============ 5. v0.25.32 签约加固：发起方不自动确认 ============

test('v0.25.32 加固：起草合同后发起方不自动确认（drafter_confirmed=0），须双方显式签署', async () => {
  const raw = rawOf(); const db = d1Shim(raw);
  const { t1Token, d2 } = await seed(db, raw);
  const r = await handleCreateContract(db, contractBody(1, d2), reqOf(t1Token));
  assert.equal(r.status, 201, '已签约（contracted）需求可起草合同');
  const row = raw.prepare('SELECT drafter_confirmed, other_confirmed, status FROM contracts').get();
  assert.equal(row.drafter_confirmed, 0, '发起方不自动置为已确认（原 drafter_confirmed=1 自动已签约）');
  assert.equal(row.other_confirmed, 0, '对方同样未确认');
  assert.equal(row.status, 'signing', '状态为待签约：双方各自确认后才 signed');
});

// ============ 4. bindable-demands phase=contract 别教师过滤 ============

test('会话列表不再返回 demand_display_id（4a 解耦删字段）；contracted 保留供灰字提示', async () => {
  const raw = rawOf(); const db = d1Shim(raw);
  const { s1 } = await seed(db, raw);
  const rows = await dbGetMyConversations(db, s1);
  assert.ok(rows.length > 0, '会话存在');
  assert.ok(!('demand_display_id' in rows[0]), '会话列表不再带需求编号（仅合同模块自持字段）');
  assert.equal('contracted' in rows[0], true, 'contracted 字段保留（.chat-sign-tip 显隐判定）');
});

test('bindable-demands phase=contract：别教师签成的需求不列出；同教师会话列出', async () => {
  const raw = rawOf(); const db = d1Shim(raw);
  const { s1Token, t1Token, t2Token, d1 } = await seed(db, raw);
  const r1 = await handleCreateSigning(db, signBody(1, d1), reqOf(t1Token));
  const { id: srA } = await r1.json();
  assert.equal((await handleRespondSigning(db, srA, { accept: true }, reqOf(s1Token))).status, 200);
  // t1 本会话（C1）：phase=contract 应列出 d1（自己签成）
  const mine = await handleGetConversationBindableDemands(db, 1, bindUrl(1, 'contract'), reqOf(t1Token));
  assert.equal(mine.status, 200);
  assert.ok((await mine.json()).demands.some(d => d.id === d1), '成交教师本人会话应列出该需求');
  // t2 会话（C2）：phase=contract 不应列出 d1（别教师 t1 签成）
  const other = await handleGetConversationBindableDemands(db, 2, bindUrl(2, 'contract'), reqOf(t2Token));
  assert.equal(other.status, 200);
  assert.ok(!(await other.json()).demands.some(d => d.id === d1), '别教师签成的需求不可被其他会话列出');
});

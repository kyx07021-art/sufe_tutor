/**
 * 发起签约绑定需求（需求四·第2/3条）回归
 *
 * handleCreateSigning 从 body.demandId 收需求（不再只用 conv.demand_id）：
 *   - 合法：会话学生方的 open 需求 → 201，signing_requests.demand_id 落库；
 *   - 归属不符（他人需求）→ 403；需求不存在 → 404；已签约/已撤销 → 410；
 *   - 教师发起亦可绑定「会话学生方」的 open 需求（归属 = conv.student_user_id）。
 * handleRespondSigning 确认后需求状态 open → contracted（状态机迁移，含并发赢家语义由既有
 * signing-guard.test.js 覆盖，此处验正常路径迁移）。
 *
 * D1 形状：db.prepare(sql).bind(...).all()/.first()/.run() + db.batch（与 signing-guard 同款 shim）。
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { DatabaseSync } from 'node:sqlite';
import { initDb } from '../src/server/core/db.js';
import { dbGetDemandsByUser } from '../src/server/domains/demand/repo.js';
import { handleCreateSigning, handleRespondSigning } from '../src/server/domains/contract/api.js';
import { handleGetConversationBindableDemands } from '../src/server/domains/chat/api.js';
import { tokenDigest } from '../src/server/core/crypto.js';

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

/** 播种：s1/s2 学生 + t1 教师；d1=s1 open、d2=s1 contracted、d3=s1 revoked、d4=s2 open；s1-t1 会话 */
async function seed(db, raw) {
  await initDb(db, ENV);
  raw.exec(`INSERT INTO users (username,password_hash,salt,role) VALUES ('s1','h','s','student'),('s2','h','s','student'),('t1','h','s','teacher')`);
  const idOf = name => raw.prepare("SELECT id FROM users WHERE username=?").get(name).id;
  const s1 = idOf('s1'), s2 = idOf('s2'), t1 = idOf('t1');
  const insDemand = (owner, status) => {
    raw.prepare(`INSERT INTO student_demands (user_id,student_grade,student_gender,target_subjects,current_scores,submitter_type,parent_contact,student_contact,status)
      VALUES (?,?,?,?,?,?,?,?,?)`).run(owner, 'senior1', 'female', '["math"]', '[]', 'self', '13800000000', '13800000000', status);
    return raw.prepare('SELECT id FROM student_demands ORDER BY id DESC LIMIT 1').get().id;
  };
  const d1 = insDemand(s1, 'open');
  const d2 = insDemand(s1, 'contracted');
  const d3 = insDemand(s1, 'revoked');
  const d4 = insDemand(s2, 'open');
  raw.prepare('INSERT INTO conversations (student_user_id, teacher_user_id, demand_id) VALUES (?,?,?)').run(s1, t1, d1);
  const mkToken = async name => {
    const token = `${name}-token`;
    // session_id 显式非空：confirmDangerOtp 对 '' 会话直接拒绝（生产恒生成，空串只可能 fixture 直插）
    const sessionId = `${name}-sess`;
    raw.prepare('INSERT INTO auth_sessions (token_hash,user_id,label,expires_at,session_id) VALUES (?,?,?,?,?)')
      .run(await tokenDigest(token), idOf(name), 'x', '2099-01-01 00:00:00', sessionId);
    return { token, sessionId };
  };
  const t1s = await mkToken('t1'), s1s = await mkToken('s1');
  return { s1, s2, t1, d1, d2, d3, d4, t1Token: t1s.token, s1Token: s1s.token, s1SessionId: s1s.sessionId };
}
const signBody = demandId => ({ conversationId: 1, demandId, price: 150, schedule: '每周六', method: 'offline' });
// S2-2（v0.30.0）：确认签约须 capToken 二次认证——直接落 danger_caps（session_id 与种子会话一致即命中）
const capOf = async (raw, userId, sessionId, value = 'cap-stu') => {
  raw.prepare('INSERT INTO danger_caps (user_id, session_id, token_hash, expires_at) VALUES (?,?,?,?)')
    .run(userId, sessionId, await tokenDigest(value), '2099-01-01 00:00:00');
  return value;
};

test('发起签约：body.demandId 合法（会话学生方 open 需求）→ 201 且需求落库', async () => {
  const raw = rawOf(); const db = d1Shim(raw);
  const { s1Token, d1 } = await seed(db, raw);
  const r = await handleCreateSigning(db, signBody(d1), reqOf(s1Token));
  assert.equal(r.status, 201, '学生发起绑定自己的开放需求应成功');
  const sr = raw.prepare('SELECT demand_id FROM signing_requests').get();
  assert.equal(sr.demand_id, d1, 'signing_requests.demand_id 落库为所选需求');
});

test('发起签约：教师发起亦可绑定「会话学生方」的 open 需求（归属 = conv.student_user_id）', async () => {
  const raw = rawOf(); const db = d1Shim(raw);
  const { t1Token, d1 } = await seed(db, raw);
  const r = await handleCreateSigning(db, signBody(d1), reqOf(t1Token));
  assert.equal(r.status, 201, '教师发起绑定会话学生方的开放需求应成功');
  const sr = raw.prepare('SELECT demand_id FROM signing_requests').get();
  assert.equal(sr.demand_id, d1);
});

test('发起签约：归属不符（他人需求）→ 403，不落库', async () => {
  const raw = rawOf(); const db = d1Shim(raw);
  const { s1Token, d4 } = await seed(db, raw);
  const r = await handleCreateSigning(db, signBody(d4), reqOf(s1Token));
  assert.equal(r.status, 403, '绑定他人需求必须被拒');
  assert.equal(raw.prepare('SELECT COUNT(*) AS c FROM signing_requests').get().c, 0);
});

test('发起签约：需求不存在 → 404', async () => {
  const raw = rawOf(); const db = d1Shim(raw);
  const { s1Token } = await seed(db, raw);
  const r = await handleCreateSigning(db, signBody(9999), reqOf(s1Token));
  assert.equal(r.status, 404);
  assert.equal(raw.prepare('SELECT COUNT(*) AS c FROM signing_requests').get().c, 0);
});

test('发起签约：已签约（contracted）需求 → 410，不落库', async () => {
  const raw = rawOf(); const db = d1Shim(raw);
  const { s1Token, d2 } = await seed(db, raw);
  const r = await handleCreateSigning(db, signBody(d2), reqOf(s1Token));
  assert.equal(r.status, 410, '已签约成交的需求不可再发起签约');
  assert.equal(raw.prepare('SELECT COUNT(*) AS c FROM signing_requests').get().c, 0);
});

test('发起签约：已撤销（revoked）需求 → 410，不落库', async () => {
  const raw = rawOf(); const db = d1Shim(raw);
  const { s1Token, d3 } = await seed(db, raw);
  const r = await handleCreateSigning(db, signBody(d3), reqOf(s1Token));
  assert.equal(r.status, 410);
  assert.equal(raw.prepare('SELECT COUNT(*) AS c FROM signing_requests').get().c, 0);
});

const bindUrl = phase => new URL(`http://localhost/api/conversations/1/bindable-demands?phase=${phase}`);

test('bindable-demands phase=signing：只返会话学生方「开放」需求', async () => {
  const raw = rawOf(); const db = d1Shim(raw);
  const { s1Token, d1, d2, d3 } = await seed(db, raw);
  const r = await handleGetConversationBindableDemands(db, 1, bindUrl('signing'), reqOf(s1Token));
  assert.equal(r.status, 200);
  const { demands } = await r.json();
  const ids = demands.map(d => d.id);
  assert.ok(ids.includes(d1), '应含开放需求 d1');
  assert.ok(!ids.includes(d2), '不得含已签约需求 d2');
  assert.ok(!ids.includes(d3), '不得含已撤销需求 d3');
  assert.ok(!demands.some(d => 'parent_contact' in d), '出口不得含联系方式');
});

test('bindable-demands phase=contract：只返会话学生方「已签约」且未绑合同的需求', async () => {
  const raw = rawOf(); const db = d1Shim(raw);
  const { s1Token, t1, d1, d2, d3 } = await seed(db, raw);
  // 给 d2 挂一份进行中合同（signing）→ phase=contract 应剔除 d2
  raw.prepare(`INSERT INTO contracts (conversation_id, drafter_user_id, demand_id, status)
    VALUES (1, ?, ?, 'signing')`).run(t1, d2);
  const r = await handleGetConversationBindableDemands(db, 1, bindUrl('contract'), reqOf(s1Token));
  assert.equal(r.status, 200);
  const { demands } = await r.json();
  const ids = demands.map(d => d.id);
  assert.ok(!ids.includes(d2), '已绑进行中合同的需求不可再起草');
  assert.ok(!ids.includes(d1), '开放需求不可起草合同（须先签约）');
  assert.ok(!ids.includes(d3), '已撤销需求不可起草合同');
});

test('bindable-demands：非会话参与方 → 404（不泄露会话存在性）', async () => {
  const raw = rawOf(); const db = d1Shim(raw);
  await seed(db, raw);
  // 额外一个无关用户（非会话参与方）
  raw.exec(`INSERT INTO users (username,password_hash,salt,role) VALUES ('s3','h','s','student')`);
  const s3 = raw.prepare("SELECT id FROM users WHERE username='s3'").get().id;
  const token = 's3-token';
  raw.prepare('INSERT INTO auth_sessions (token_hash,user_id,label,expires_at) VALUES (?,?,?,?)')
    .run(await tokenDigest(token), s3, 'x', '2099-01-01 00:00:00');
  const r = await handleGetConversationBindableDemands(db, 1, bindUrl('signing'), reqOf(token));
  assert.equal(r.status, 404, '非参与方不可拉会话绑定需求');
});

test('确认签约：需求状态 open → contracted，签约请求置 signed', async () => {
  const raw = rawOf(); const db = d1Shim(raw);
  const { s1, s1Token, s1SessionId, t1Token, d1 } = await seed(db, raw);
  // t1 发起、s1 确认（发起者不能确认自己的请求，须对方回应）
  const r1 = await handleCreateSigning(db, signBody(d1), reqOf(t1Token));
  assert.equal(r1.status, 201);
  const { id: srId } = await r1.json();
  assert.ok(srId > 0);
  const r2 = await handleRespondSigning(db, srId, { accept: true, capToken: await capOf(raw, s1, s1SessionId) }, reqOf(s1Token));
  assert.equal(r2.status, 200, '需求 open 时确认应成功');
  assert.equal(raw.prepare('SELECT status FROM student_demands WHERE id=?').get(d1).status, 'contracted', '确认签约后需求置 contracted');
  assert.equal(raw.prepare('SELECT status FROM signing_requests WHERE id=?').get(srId).status, 'signed', '签约请求置 signed');
});

// #152（v0.25.60）：发起签约通知带上发送者用户名——原模板无 {name} 占位 + nameOf 取错边，
// 通知恒为无身份标识的「对方向你发送了签约请求」
test('发起签约：通知文案带发送者用户名（学生发起 → 教师收到「s1」）', async () => {
  const raw = rawOf(); const db = d1Shim(raw);
  const { t1, s1Token, d1 } = await seed(db, raw);
  const r = await handleCreateSigning(db, signBody(d1), reqOf(s1Token));
  assert.equal(r.status, 201);
  const notif = raw.prepare('SELECT text FROM notifications WHERE user_id=? ORDER BY id DESC LIMIT 1').get(t1);
  assert.ok(notif, '教师收到通知');
  assert.ok(notif.text.includes('「s1」'), `通知含发送者用户名（实际：${notif.text}）`);
  assert.ok(notif.text.includes('向你发送了签约请求'), '文案语义完整');
});

test('发起签约：通知文案带发送者用户名（教师发起 → 学生收到「t1」）', async () => {
  const raw = rawOf(); const db = d1Shim(raw);
  const { s1, t1Token, d1 } = await seed(db, raw);
  const r = await handleCreateSigning(db, signBody(d1), reqOf(t1Token));
  assert.equal(r.status, 201);
  const notif = raw.prepare('SELECT text FROM notifications WHERE user_id=? ORDER BY id DESC LIMIT 1').get(s1);
  assert.ok(notif, '学生收到通知');
  assert.ok(notif.text.includes('「t1」'), `通知含发送者用户名（实际：${notif.text}）`);
});

// #157（v0.25.65）：我的需求排序——已签约沉底（开放/已撤销按时间在前，revoked 可重开归活跃侧）
test('我的需求排序：已签约沉底，开放/已撤销在前（#157）', async () => {
  const raw = rawOf(); const db = d1Shim(raw);
  const { s1 } = await seed(db, raw); // d1 open、d2 contracted、d3 revoked（同秒插入）
  const rows = await dbGetDemandsByUser(db, s1);
  const statuses = rows.map(r => r.status);
  const idx = {};
  statuses.forEach((s, i) => { idx[s] = i; });
  assert.ok(idx['contracted'] > idx['open'], '已签约需求沉底（不再与开放需求按时间穿插）');
  assert.ok(idx['contracted'] > idx['revoked'], '已签约需求排在已撤销之后（revoked 可重开归活跃侧）');
  assert.equal(statuses.filter(s => s === 'open').length, 1, '仅本人需求');
});

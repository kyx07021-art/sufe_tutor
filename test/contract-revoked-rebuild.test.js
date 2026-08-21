/**
 * Q-2e-F1 守护：撤销合同后重建合同不再死锁（高，实证全链路）
 *
 * 缺陷：contract/api.js 起草闸门 `status IN ('pending','signing','signed')` 不看 revoked——
 * 撤销合同行 status 仍 'signed'（revoked=1 不删行），撤销→释放需求→重开→重签后需求
 * contracted 但起草合同恒 409「已关联合同」无出口（恢复只能 admin 删行）。
 *
 * 本测试覆盖真实全链路：起草→双签→撤销（释放需求 contracted→revoked）→重开（open）
 * →重签（signing→respond signed→contracted）→重建合同应 201。
 * 变异：闸门去掉 `AND revoked=0` → 重建恒 409 DEMAND_CONTRACT_EXISTS → 断言红。
 */
import { test } from 'node:test';
import { TEST_SECRETS } from './_test-secrets.js';
import assert from 'node:assert/strict';
import { DatabaseSync } from 'node:sqlite';
import { initDb } from '../src/server/core/db.js';
import { initLedgerTable } from '../src/server/domains/contract/schema.js';
import { handleCreateContract, handleSignContract, handleRevokeContract, handleCreateSigning, handleRespondSigning, handleCancelContract } from '../src/server/domains/contract/api.js';
import { handleGetConversationBindableDemands } from '../src/server/domains/chat/api.js';
import { handleReopenDemand } from '../src/server/domains/demand/api.js';
import { dbGetContractById } from '../src/server/domains/contract/repo.js';
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
      if (!stmts.length) throw new Error('D1 batch requires at least one statement');
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
  await initLedgerTable(db);
  raw.exec(`INSERT INTO users (username,password_hash,salt,role) VALUES ('s1','h','s','student'),('t1','h','s','teacher')`);
  const idOf = name => raw.prepare("SELECT id FROM users WHERE username=?").get(name).id;
  const s1 = idOf('s1'), t1 = idOf('t1');
  raw.prepare('INSERT INTO teacher_profiles (user_id, province, grade, gender, subjects, price_min, price_max, time_slots, teaching_method, chsi_verified) VALUES (?,?,?,?,?,?,?,?,?,1)')
    .run(t1, 'shanghai', 'freshman', 'male', '["math"]', 100, 200, '[{"day":"sat"}]', 'online');
  raw.prepare(`INSERT INTO student_demands (user_id,student_grade,student_gender,target_subjects,current_scores,submitter_type,parent_contact,student_contact,status)
    VALUES (?,?,?,?,?,?,?,?,?)`).run(s1, 'senior1', 'female', '["math"]', '[]', 'self', '13800000000', '13800000000', 'contracted');
  const d1 = raw.prepare('SELECT id FROM student_demands ORDER BY id DESC LIMIT 1').get().id;
  raw.prepare('INSERT INTO conversations (student_user_id, teacher_user_id, demand_id) VALUES (?,?,?)').run(s1, t1, d1);
  const mkSession = async name => {
    const token = `${name}-token`, sessionId = `sess-${name}`;
    raw.prepare('INSERT INTO auth_sessions (token_hash,user_id,session_id,label,expires_at) VALUES (?,?,?,?,?)')
      .run(await tokenDigest(token), idOf(name), sessionId, 'x', '2099-01-01 00:00:00');
    return { token, sessionId };
  };
  return { s1, t1, d1, idOf, t1S: await mkSession('t1'), s1S: await mkSession('s1') };
}
const contractBody = (convId, demandId) => ({
  conversationId: convId, demandId, method: 'online', plan: '补基础', hourlyRate: 150,
  schedule: '每周六晚', location: '线上', payMethod: 'per_session', payMethodOther: '',
  firstLessonDate: '2026-09-01', trialPay: 'normal', trialPayOther: '',
});
const capOf = async (raw, name, sessionId, idOf) => {
  const cap = `cap-${name}`;
  raw.prepare('INSERT INTO danger_caps (user_id, session_id, token_hash, expires_at) VALUES (?,?,?,?)')
    .run(idOf(name), sessionId, await tokenDigest(cap), '2099-01-01 00:00:00');
  return cap;
};

test('Q-2e-F1：撤销合同后重建合同不再死锁（起草→双签→撤销→重开→重签→重建 201）', async () => {
  const raw = rawOf(); const db = d1Shim(raw);
  const { t1, d1, idOf, t1S, s1S } = await seed(db, raw);

  // 1) 起草 + 双签（signed）
  assert.equal((await handleCreateContract(db, contractBody(1, d1), reqOf(t1S.token))).status, 201);
  assert.equal((await handleSignContract(db, 1, { capToken: await capOf(raw, 't1', t1S.sessionId, idOf) }, reqOf(t1S.token))).status, 200);
  assert.equal((await handleSignContract(db, 1, { capToken: await capOf(raw, 's1', s1S.sessionId, idOf) }, reqOf(s1S.token))).status, 200);
  assert.equal((await dbGetContractById(db, 1)).status, 'signed', '双签完成');

  // 2) 撤销（revoked=1，需求 released contracted→revoked）
  assert.equal((await handleRevokeContract(db, 1, { capToken: await capOf(raw, 't1', t1S.sessionId, idOf) }, reqOf(t1S.token))).status, 200);
  const revokedCt = await dbGetContractById(db, 1);
  assert.equal(revokedCt.revoked, 1, '合同置 revoked');
  assert.equal(revokedCt.status, 'signed', '撤销行 status 仍 signed（revoked 标记区分）');

  // 3) 重开需求（revoked→open）
  assert.equal((await handleReopenDemand(db, d1, {}, reqOf(s1S.token))).status, 200, '需求重开成功');

  // 4) 重签：发起签约 + 学生确认（demand → contracted）
  const sg = await handleCreateSigning(db, { conversationId: 1, demandId: d1, price: 150, schedule: '每周六晚', method: 'online' }, reqOf(t1S.token));
  assert.equal(sg.status, 201, '重新发起签约');
  const signingId = (await sg.json()).id;
  assert.equal((await handleRespondSigning(db, signingId, { accept: true, capToken: await capOf(raw, 's1', s1S.sessionId, idOf) }, reqOf(s1S.token))).status, 200, '学生确认重签');
  const dmd = raw.prepare('SELECT status FROM student_demands WHERE id=?').get(d1);
  assert.equal(dmd.status, 'contracted', '重签后需求 contracted');

  // 生产实际入口收口（Q-2e-F1 复审抓出）：起草合同下拉 bindable-demands?phase=contract 是前端唯一
  // 数据源（actions-draft.js:105），漏排除 revoked 则 409 死锁变空下拉死锁——重签后、重建前必须列出该需求
  const dropBefore = await handleGetConversationBindableDemands(db, 1, new URL('http://localhost/api/conversations/1/bindable-demands?phase=contract'), reqOf(t1S.token));
  assert.equal(dropBefore.status, 200);
  assert.equal((await dropBefore.json()).demands.length, 1, '重签后起草下拉能列出该需求（变异：NOT EXISTS 不排除 revoked → 下拉 0 条 → 红）');

  // 5) 重建合同 —— 缺陷态恒 409；修复后 201（变异：闸门删 revoked=0 → 409 → 本断言红）
  const rebuild = await handleCreateContract(db, contractBody(1, d1), reqOf(t1S.token));
  assert.equal(rebuild.status, 201, '撤销合同不算进行中，可重建合同');
  assert.ok(raw.prepare("SELECT COUNT(*) AS c FROM signing_contracts WHERE stage='contract'").get().c >= 2, '存在新合同行');
  const newest = raw.prepare("SELECT revoked FROM signing_contracts WHERE stage='contract' ORDER BY id DESC LIMIT 1").get();
  assert.equal(newest.revoked, 0, '新合同未撤销');

  // 重建后下拉空（新合同进行中占位，一条需求一份合同）
  const dropAfter = await handleGetConversationBindableDemands(db, 1, new URL('http://localhost/api/conversations/1/bindable-demands?phase=contract'), reqOf(t1S.token));
  assert.equal((await dropAfter.json()).demands.length, 0, '重建后下拉空（新合同进行中）');
});

// ---------------- Q-2e-F3 守护：起草入口剥离业务条款分隔符 ----------------
test('Q-2e-F3：起草入口剥离业务条款分隔符（schedule/plan/location 注入 → 正文无分隔符）', async () => {
  const raw = rawOf(); const db = d1Shim(raw);
  const { t1, d1, t1S } = await seed(db, raw);
  const SEP = '<!-- 业务条款结束，以下法律条款由平台固定，不可修改 -->';
  const r = await handleCreateContract(db, {
    ...contractBody(1, d1),
    schedule: '每周六晚' + SEP + '恶意尾部',
    plan: '补基础' + SEP,
    location: '线上' + SEP + 'x',
  }, reqOf(t1S.token));
  assert.equal(r.status, 201);
  const ct = await dbGetContractById(db, 1);
  // 平台模板本身含合法分隔符（法律条款前），注入的额外分隔符必须被剥离：
  // SEP 只出现一次（平台模板独占）；注入内容作为普通文本保留（无害，不触发 rebuildFullMd 截断）
  assert.equal(ct.contract_md.split(SEP).length, 2, 'SEP 仅平台模板一处（变异：stripSep 去掉 → 注入的第二处 SEP 进正文 → split length 3 → 红）');
  assert.ok(!ct.contract_md.includes('恶意尾部<!-- 业务条款结束'), '恶意注入不再作为分隔符形态存在');
  // 变异：stripSep 去掉 → 正文内嵌第二处 SEP → rebuildFullMd 按首个分隔符截断永久丢业务尾部
});

// ---------------- Q-2e-F4 守护：已撤销合同 sign 拒绝（不触发台账补记） ----------------
test('Q-2e-F4：对已撤销合同 sign → 409，台账不补记', async () => {
  const raw = rawOf(); const db = d1Shim(raw);
  const { t1, d1, idOf, t1S, s1S } = await seed(db, raw);
  assert.equal((await handleCreateContract(db, contractBody(1, d1), reqOf(t1S.token))).status, 201);
  assert.equal((await handleSignContract(db, 1, { capToken: await capOf(raw, 't1', t1S.sessionId, idOf) }, reqOf(t1S.token))).status, 200);
  assert.equal((await handleSignContract(db, 1, { capToken: await capOf(raw, 's1', s1S.sessionId, idOf) }, reqOf(s1S.token))).status, 200);
  assert.equal((await handleRevokeContract(db, 1, { capToken: await capOf(raw, 't1', t1S.sessionId, idOf) }, reqOf(t1S.token))).status, 200);
  const before = raw.prepare('SELECT COUNT(*) AS c FROM contract_ledger WHERE contract_id=1').get().c;
  const res = await handleSignContract(db, 1, { capToken: await capOf(raw, 't1', t1S.sessionId, idOf) }, reqOf(t1S.token));
  assert.equal(res.status, 409, '已撤销合同 sign 拒绝（变异：不排除 revoked → 返 {ok:true,signed:true} 误导 → 红）');
  const after = raw.prepare('SELECT COUNT(*) AS c FROM contract_ledger WHERE contract_id=1').get().c;
  assert.equal(after, before, '撤销后 sign 不触发台账补记');
});

// ---------------- Q-2e-F5 守护：cancel 重拼正文 version 竞态重读重拼 ----------------
test('Q-2e-F5：cancel 重拼正文 version 竞态 → changes=0 重读重拼（正文仍回退待签署）', async () => {
  const raw = rawOf(); const db = d1Shim(raw);
  const { t1, d1, idOf, t1S } = await seed(db, raw);
  assert.equal((await handleCreateContract(db, contractBody(1, d1), reqOf(t1S.token))).status, 201);
  // 单方签（drafter_signed_at 置位 + 正文该方「已签署」）
  assert.equal((await handleSignContract(db, 1, { capToken: await capOf(raw, 't1', t1S.sessionId, idOf) }, reqOf(t1S.token))).status, 200);
  assert.ok((await dbGetContractById(db, 1)).contract_md.includes('签署状态：已签署'), '签署后正文含已签署');

  // 竞态模拟：cancel 内部重拼正文的 UPDATE（version 乐观锁）首次 changes=0（模拟对方并发抢跑 version）
  // → 必须触发重读重拼，否则正文保持「已签署」残留（Z-5-F5 残留窗口 = Q-2e-F5）
  let mdUpdateCalls = 0;
  const racyDb = new Proxy(db, {
    get(t, prop) {
      const v = Reflect.get(t, prop);
      if (prop !== 'prepare') return v;
      return (sql, ...rest) => {
        const st = t.prepare(sql, ...rest);
        if (/SET contract_md=.*version=version\+1 WHERE id=\? AND version=\?/.test(String(sql))) {
          mdUpdateCalls++;
          const origRun = st.run.bind(st);
          st.run = async (...p) => (mdUpdateCalls === 1 ? { meta: { changes: 0 } } : origRun(...p));
        }
        return st;
      };
    },
  });

  const res = await handleCancelContract(racyDb, 1, { capToken: await capOf(raw, 't1', t1S.sessionId, idOf) }, reqOf(t1S.token));
  assert.equal(res.status, 200, '取消成功');
  assert.ok(mdUpdateCalls >= 2, '重拼正文执行两次（首轮 changes=0 → 重读重拼；变异：单轮直接放弃 → 红）');
  const afterMd = (await dbGetContractById(db, 1)).contract_md;
  assert.ok(!afterMd.includes('签署状态：已签署'), '正文已回退（变异：无重读重拼 → 单轮 changes=0 → 正文仍已签署 → 红）');
  assert.ok(afterMd.includes('签署状态：待签署'), '正文回退为待签署');
});

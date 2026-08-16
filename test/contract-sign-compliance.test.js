/**
 * 需求十五（2026-08-08）·合同签署合规改造（v0.25.37）
 *
 * 缺陷实证：合同落款是空占位「甲方确认：＿＿ 乙方确认：＿＿」，从未写入确认人姓名与时间；
 * handleSignContract 只置 confirmed 标志、台账仅在双方确认后记一条，未留单方签署事件与身份。
 *
 * 法律结论：普通家教服务合同不在《电子签名法》排除清单，当事人可依 13 条 2 款约定「可靠条件」
 * （实名账号 + 密码二次确认 + 服务端时间戳 + 内容哈希链），无需 CA 数字证书。
 *
 * 改造：签名区块（第十条 签署记录）内嵌 contract_md（谁签/何时签/平台账号 + 存证流水号 #CD{id}）；
 * contracts 表补 drafter_signed_at/other_signed_at；每次签署都落一条台账（正文哈希自然覆盖签名态）；
 * 修改合同清空 signed_at 并重建全部「待签署」签名区块；verify 接口回传逐条台账明细。
 *
 * 本测试覆盖（服务端全链路）：
 *   - 起草后正文含第十条 签署记录、双方「待签署」、无空占位；
 *   - 单方签署：signed_at 置位 + 正文该方「已签署·时间」+ 台账落一条 + status 仍 signing；
 *   - 双方签署：status=signed + 正文双方已签署 + 台账两条 + verify 通过且 entryList 两条；
 *   - 修改合同：清空 signed_at/confirmed，正文重建全部「待签署」（回退签约选择态）；
 *   - verify 响应含 entryList（逐条 seq + created_at）。
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { DatabaseSync } from 'node:sqlite';
import { initDb } from '../server/db.js';
import { initLedgerTable, handleCreateContract, handleSignContract, handleModifyContract, handleVerifyContract, handleCancelContract, handleRevokeContract } from '../server/contract.js';
import { dbGetContractById } from '../server/db.js';
import { tokenDigest } from '../server/crypto.js';

const ENV = { ADMIN_USERNAMES: ['admin_sufe'], ADMIN_DEFAULT_PASSWORD: 'test-pw-123' };

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

/** 播种：s1 学生 + t1 教师；d1=s1 的 contracted 需求；C1=s1-t1 会话 */
async function seed(db, raw) {
  await initDb(db, ENV);
  await initLedgerTable(db); // worker 启动链 initDb → initLedgerTable（env.LEDGER_DB || env.DB）
  raw.exec(`INSERT INTO users (username,password_hash,salt,role) VALUES ('s1','h','s','student'),('t1','h','s','teacher')`);
  const idOf = name => raw.prepare("SELECT id FROM users WHERE username=?").get(name).id;
  const s1 = idOf('s1'), t1 = idOf('t1');
  // v1.2.0 T3：合格接单教师档案（chsi_verified=1 + 必填齐全），合同创建门禁依赖
  raw.prepare('INSERT INTO teacher_profiles (user_id, province, grade, gender, subjects, price_min, price_max, time_slots, teaching_method, chsi_verified) VALUES (?,?,?,?,?,?,?,?,?,1)')
    .run(t1, 'shanghai', 'freshman', 'male', '["math"]', 100, 200, '[{"day":"sat"}]', 'online');
  raw.prepare(`INSERT INTO student_demands (user_id,student_grade,student_gender,target_subjects,current_scores,submitter_type,parent_contact,student_contact,status)
    VALUES (?,?,?,?,?,?,?,?,?)`).run(s1, 'senior1', 'female', '["math"]', '[]', 'self', '13800000000', '13800000000', 'contracted');
  const d1 = raw.prepare('SELECT id FROM student_demands ORDER BY id DESC LIMIT 1').get().id;
  raw.prepare('INSERT INTO conversations (student_user_id, teacher_user_id, demand_id) VALUES (?,?,?)').run(s1, t1, d1);
  // 会话带 session_id（danger_caps 会话绑定；签发/校验走 currentSessionId 反查）
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
// capToken 直接落 danger_caps（真实 confirmDangerOtp SQL 全链路：会话绑定 + 命中即删 + 过期比较）。
// 不用 issueCapToken：其 exp 写 UTC ISO、比对 datetime('now','localtime')，仅 Cloudflare Worker（UTC）
// 时区自洽；本机 UTC+8 下签发即「已过期」→ 恒 403（测试环境时区伪象，非生产缺陷）。
// expires_at 取 2099 规避时区比较差异；校验逻辑（DELETE 命中即删）本身仍被完整覆盖。
const capOf = async (raw, name, sessionId, idOf) => {
  const cap = `cap-${name}`;
  raw.prepare('INSERT INTO danger_caps (user_id, session_id, token_hash, expires_at) VALUES (?,?,?,?)')
    .run(idOf(name), sessionId, await tokenDigest(cap), '2099-01-01 00:00:00');
  return cap;
};

test('起草后正文含第十条 签署记录（双方待签署），无空占位「甲方确认：＿＿」', async () => {
  const raw = rawOf(); const db = d1Shim(raw);
  const { t1, d1, t1S } = await seed(db, raw);
  const r = await handleCreateContract(db, contractBody(1, d1), reqOf(t1S.token));
  assert.equal(r.status, 201);
  const ct = await dbGetContractById(db, 1);
  assert.ok(ct.contract_md.includes('## 第十条 签署记录'), '正文内嵌签署记录');
  assert.ok(!ct.contract_md.includes('甲方确认：'), '空占位落款已删除（缺陷源头）');
  assert.ok(ct.contract_md.includes('签署状态：待签署'), '起草后双方待签署');
  assert.ok(ct.contract_md.includes('#CD000001'), '正文含存证流水号');
  assert.ok(ct.contract_md.includes('可靠条件'), '第九条明文约定电子签名可靠条件（电子签名法 13 条 2 款）');
  assert.equal(ct.drafter_signed_at, '', '起草后无签署时间');
  assert.equal(ct.other_signed_at, '', '起草后无签署时间');
});

test('单方签署：signed_at 置位 + 正文该方已签署（含时间）+ 台账落一条 + 仍 signing', async () => {
  const raw = rawOf(); const db = d1Shim(raw);
  const { t1, d1, idOf, t1S } = await seed(db, raw);
  assert.equal((await handleCreateContract(db, contractBody(1, d1), reqOf(t1S.token))).status, 201);
  // 起草方 t1 签署（capToken 二次认证）
  const cap = await capOf(raw, 't1', t1S.sessionId, idOf);
  const res = await handleSignContract(db, 1, { capToken: cap }, reqOf(t1S.token));
  assert.equal(res.status, 200);
  assert.deepEqual(await res.json(), { ok: true, signed: false }, '单方签署后仍未 signed');
  const ct = await dbGetContractById(db, 1);
  assert.ok(ct.drafter_signed_at, '起草方 signed_at 已置位');
  assert.equal(ct.other_signed_at, '', '对方未签');
  assert.ok(ct.contract_md.includes('签署状态：已签署　签署时间：'), '正文该方已签署 + 时间');
  assert.ok(ct.contract_md.includes('签署状态：待签署'), '对方仍待签署');
  const n = raw.prepare('SELECT COUNT(*) AS c FROM contract_ledger WHERE contract_id=1').get().c;
  assert.equal(n, 1, '单方签署也落台账（不再仅双方确认后）');
  const row = raw.prepare('SELECT status FROM contracts WHERE id=1').get();
  assert.equal(row.status, 'signing', '单方签署后状态仍 signing');
  // capToken 一次性：复用被拒（危险操作二次认证不可重放）
  const again = await handleSignContract(db, 1, { capToken: cap }, reqOf(t1S.token));
  assert.equal(again.status, 403, 'capToken 一次性，复用被拒');
});

test('双方签署：status=signed + 正文双方已签署 + 台账两条 + verify 通过且 entryList 两条', async () => {
  const raw = rawOf(); const db = d1Shim(raw);
  const { t1, d1, idOf, t1S, s1S } = await seed(db, raw);
  assert.equal((await handleCreateContract(db, contractBody(1, d1), reqOf(t1S.token))).status, 201);
  const r1 = await handleSignContract(db, 1, { capToken: await capOf(raw, 't1', t1S.sessionId, idOf) }, reqOf(t1S.token));
  assert.equal(r1.status, 200);
  const r2 = await handleSignContract(db, 1, { capToken: await capOf(raw, 's1', s1S.sessionId, idOf) }, reqOf(s1S.token));
  assert.deepEqual(await r2.json(), { ok: true, signed: true }, '双方签署后 signed');
  const ct = await dbGetContractById(db, 1);
  assert.equal(ct.status, 'signed');
  assert.ok(ct.drafter_signed_at && ct.other_signed_at, '双方 signed_at 置位');
  assert.ok(!ct.contract_md.includes('待签署'), '正文无「待签署」残留');
  const signedCount = (ct.contract_md.match(/已签署/g) || []).length;
  assert.equal(signedCount, 2, '正文双方均已签署');
  const n = raw.prepare('SELECT COUNT(*) AS c FROM contract_ledger WHERE contract_id=1').get().c;
  assert.equal(n, 2, '每次签署一条台账（单方正文 + 双方正文各一条哈希链）');
  // verify：链结构 + 最新条目正文重放
  const v = await handleVerifyContract(db, 1, reqOf(t1S.token));
  assert.equal(v.status, 200);
  const data = await v.json();
  assert.equal(data.recorded, true);
  assert.equal(data.valid, true, '哈希链校验通过');
  assert.equal(data.entries, 2);
  assert.equal(data.entryList.length, 2, 'verify 回传逐条台账明细');
  assert.equal(data.entryList[0].seq, 1);
  assert.ok(data.entryList[0].createdAt, '条目含记档时间');
});

test('修改合同（v0.25.87 R6）：已确认方禁改（409）；未确认方修改 → 清空 signed_at/confirmed 重建「待签署」', async () => {
  const raw = rawOf(); const db = d1Shim(raw);
  const { t1, d1, idOf, t1S, s1S } = await seed(db, raw);
  assert.equal((await handleCreateContract(db, contractBody(1, d1), reqOf(t1S.token))).status, 201);
  await handleSignContract(db, 1, { capToken: await capOf(raw, 't1', t1S.sessionId, idOf) }, reqOf(t1S.token));
  const before = await dbGetContractById(db, 1);
  assert.ok(before.drafter_signed_at, '修改前起草方已签');
  // R6：已确认方（起草方 t1）修改 → 409 拒绝（合同内容锁定）
  const ver = before.version;
  const locked = await handleModifyContract(db, 1, { contractMd: '补基础+真题演练', version: ver }, reqOf(t1S.token));
  assert.equal(locked.status, 409, '已确认方修改被拒');
  // 未确认方（接收方 s1）修改 → 回退签约选择态（对方已签态被重置，符合协商预期）
  const upd = await handleModifyContract(db, 1, { contractMd: '补基础+真题演练', version: ver }, reqOf(s1S.token));
  assert.equal(upd.status, 200);
  const after = await dbGetContractById(db, 1);
  assert.equal(after.drafter_signed_at, '', '修改后签署时间清空（含对方已签）');
  assert.equal(after.other_signed_at, '', '修改后签署时间清空');
  assert.equal(after.drafter_confirmed, 0, '确认标志回退');
  assert.ok(after.contract_md.includes('签署状态：待签署'), '正文重建全部待签署');
  assert.ok(after.contract_md.includes('补基础+真题演练'), '新业务条款生效');
  assert.ok(!after.contract_md.includes('已签署'), '旧签名区块被重拼丢弃');
});

test('R7 取消签约：我方已签对方未签 → 回退待签约、合同保留不删（v0.25.87）', async () => {
  const raw = rawOf(); const db = d1Shim(raw);
  const { t1, d1, idOf, t1S, s1S } = await seed(db, raw);
  assert.equal((await handleCreateContract(db, contractBody(1, d1), reqOf(t1S.token))).status, 201);
  // 起草方 t1 已签，接收方 s1 未签
  await handleSignContract(db, 1, { capToken: await capOf(raw, 't1', t1S.sessionId, idOf) }, reqOf(t1S.token));
  const before = await dbGetContractById(db, 1);
  assert.ok(before.drafter_confirmed, '起草方已确认');
  // t1 取消（密码验证 capToken）→ 回退 signing（待签约）、清我方确认、合同保留
  // v0.25.94（用户反馈去重）：回退态为 signing——'pending' 遗留态连根删，无「草案待确认」
  const res = await handleCancelContract(db, 1, { capToken: await capOf(raw, 't1', t1S.sessionId, idOf) }, reqOf(t1S.token));
  assert.equal(res.status, 200);
  const after = await dbGetContractById(db, 1);
  assert.ok(after, '合同保留未删除');
  assert.equal(after.status, 'signing', '状态回退「待签约」');
  assert.equal(after.drafter_confirmed, 0, '我方确认标志清空');
  assert.equal(after.drafter_signed_at, '', '我方签署时间清空');
  // 未签方 s1 取消也可（signing 态）
  const res2 = await handleCancelContract(db, 1, { capToken: await capOf(raw, 's1', s1S.sessionId, idOf) }, reqOf(s1S.token));
  assert.equal(res2.status, 200);
});

test('R7 撤销合同：双方签后撤销 → 置 revoked 标记、合同保留、幂等拒绝（v0.25.87）', async () => {
  const raw = rawOf(); const db = d1Shim(raw);
  const { t1, d1, idOf, t1S, s1S } = await seed(db, raw);
  assert.equal((await handleCreateContract(db, contractBody(1, d1), reqOf(t1S.token))).status, 201);
  await handleSignContract(db, 1, { capToken: await capOf(raw, 't1', t1S.sessionId, idOf) }, reqOf(t1S.token));
  await handleSignContract(db, 1, { capToken: await capOf(raw, 's1', s1S.sessionId, idOf) }, reqOf(s1S.token));
  const before = await dbGetContractById(db, 1);
  assert.equal(before.status, 'signed', '双方已签');
  // 撤销（密码验证）→ 置 revoked，不删行
  const res = await handleRevokeContract(db, 1, { capToken: await capOf(raw, 't1', t1S.sessionId, idOf) }, reqOf(t1S.token));
  assert.equal(res.status, 200);
  const after = await dbGetContractById(db, 1);
  assert.ok(after, '撤销后合同保留');
  assert.equal(after.revoked, 1, '置撤销标记');
  assert.equal(after.revoked_by, idOf('t1'), '记录撤销人');
  // 幂等拒绝
  const again = await handleRevokeContract(db, 1, { capToken: await capOf(raw, 's1', s1S.sessionId, idOf) }, reqOf(s1S.token));
  assert.equal(again.status, 409, '已撤销拒绝重复操作');
  // 双方已签后 cancel 走撤销引导（409）
  const cancelRes = await handleCancelContract(db, 1, { capToken: await capOf(raw, 't1', t1S.sessionId, idOf) }, reqOf(t1S.token));
  assert.equal(cancelRes.status, 409, '双方已签不可取消，须撤销');
});

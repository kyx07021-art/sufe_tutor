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
import { TEST_SECRETS } from './_test-secrets.js';
import assert from 'node:assert/strict';
import { DatabaseSync } from 'node:sqlite';
import { initDb } from '../src/server/core/db.js';
import { initLedgerTable } from '../src/server/domains/contract/schema.js';
import { handleCreateContract, handleSignContract, handleModifyContract, handleVerifyContract, handleCancelContract, handleRevokeContract } from '../src/server/domains/contract/api.js';
import { dbGetContractById, dbGetMyContracts } from '../src/server/domains/contract/repo.js';
import { tokenDigest } from '../src/server/core/crypto.js';
import { LIMITS } from '../src/shared/config.js';

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

// Z-5-F4 回归：台账写入失败 → 合同仍进 signed（不卡死）——返 500 会卡在双方已确认的 signing 态
// （审计实证：claim 之前返回 → 双 confirmed 无操作入口 → 不可恢复死锁）
test('Z-5-F4 回归：台账失败不返 500，合同进 signed 缺口可 verify 暴露', async () => {
  const raw = rawOf(); const db = d1Shim(raw);
  const { t1, d1, idOf, t1S, s1S } = await seed(db, raw);
  assert.equal((await handleCreateContract(db, contractBody(1, d1), reqOf(t1S.token))).status, 201);
  await handleSignContract(db, 1, { capToken: await capOf(raw, 't1', t1S.sessionId, idOf) }, reqOf(t1S.token));
  raw.exec('DROP TABLE contract_ledger'); // 制造台账写入失败（INSERT 抛错 → ledgerRecord 重试耗尽 throw）
  const r2 = await handleSignContract(db, 1, { capToken: await capOf(raw, 's1', s1S.sessionId, idOf) }, reqOf(s1S.token));
  assert.equal(r2.status, 200, '台账失败不返 500（原返 500 卡死双确认 signing 态）');
  const data = await r2.json();
  assert.equal(data.signed, true, '合同仍进 signed（不卡死）');
  const ct = await dbGetContractById(db, 1);
  assert.equal(ct.status, 'signed', '终态 signed（缺口经 verify 面板暴露，非静默）');
});

// Z-5-F4 (d) 恢复路径回归：合同已进 signed 但台账缺口（DROP 表）→ 重建台账表后对 SIGNED 合同
// 重签 → 签署门禁含 SIGNED（复审 FAIL 点修复）→ flag UPDATE changes=0 → backfill 幂等补记。
// 修复前该路径 409 CONTRACT_STATE_INVALID 不可达（backfill 死代码 + 误导注释）。
test('Z-5-F4 恢复路径：SIGNED 重签幂等补记台账缺口', async () => {
  const raw = rawOf(); const db = d1Shim(raw);
  const { d1, idOf, t1S, s1S } = await seed(db, raw);
  assert.equal((await handleCreateContract(db, contractBody(1, d1), reqOf(t1S.token))).status, 201);
  await handleSignContract(db, 1, { capToken: await capOf(raw, 't1', t1S.sessionId, idOf) }, reqOf(t1S.token));
  raw.exec('DROP TABLE contract_ledger'); // 制造台账失败（DROP 后 INSERT 抛错）
  const r2 = await handleSignContract(db, 1, { capToken: await capOf(raw, 's1', s1S.sessionId, idOf) }, reqOf(s1S.token));
  assert.equal(r2.status, 200);
  assert.equal((await r2.json()).signed, true, '缺口后仍进 signed（不卡死）');
  assert.equal((await dbGetContractById(db, 1)).status, 'signed');
  await initLedgerTable(db); // 模拟运维修复：重建台账表（空表 = 缺口仍在）
  assert.equal(raw.prepare('SELECT COUNT(*) c FROM contract_ledger').get().c, 0, '重建后空表（缺口存在）');
  // 对已 signed 合同重签 → 门禁含 SIGNED 放行 → flag status 守卫 changes=0 → backfill 幂等补记
  const r3 = await handleSignContract(db, 1, { capToken: await capOf(raw, 't1', t1S.sessionId, idOf) }, reqOf(t1S.token));
  assert.equal(r3.status, 200, 'SIGNED 重签放行（修复前 409 CONTRACT_STATE_INVALID）');
  assert.equal((await r3.json()).signed, true, '幂等返回已签署');
  assert.equal(raw.prepare('SELECT COUNT(*) c FROM contract_ledger').get().c, 1, 'backfill 幂等补记一条（缺口可恢复，非死代码）');
  // 再次重签零副作用（幂等：NOT EXISTS 判定不重复挂链）
  const r4 = await handleSignContract(db, 1, { capToken: await capOf(raw, 's1', s1S.sessionId, idOf) }, reqOf(s1S.token));
  assert.equal(r4.status, 200);
  assert.equal(raw.prepare('SELECT COUNT(*) c FROM contract_ledger').get().c, 1, '重复重签仍一条（幂等）');
});

// Z-5-O2/O3 回归：起草合同门禁补强——已关闭会话禁起草（原缺会话状态校验，同发起签约/发消息门禁）+ 时薪钳制 BUDGET_MAX（原无上限，可越限存储）
test('Z-5-O2/O3 回归：关闭会话禁起草 + 时薪钳制 BUDGET_MAX', async () => {
  const raw = rawOf(); const db = d1Shim(raw);
  const { d1, idOf, t1S } = await seed(db, raw);
  // O2：会话关闭 → 403
  raw.prepare("UPDATE conversations SET status='closed' WHERE id=1").run();
  const closed = await handleCreateContract(db, contractBody(1, d1), reqOf(t1S.token));
  assert.equal(closed.status, 403, '关闭会话起草合同 → 403（修复前放行）');
  // 恢复 active 后起草成功；O3：超大时薪被钳制
  raw.prepare("UPDATE conversations SET status='active' WHERE id=1").run();
  const body = { ...contractBody(1, d1), hourlyRate: 999999999 };
  assert.equal((await handleCreateContract(db, body, reqOf(t1S.token))).status, 201, 'active 会话可起草');
  const ct = await dbGetContractById(db, 1);
  assert.equal(ct.hourly_rate, LIMITS.BUDGET_MAX, '时薪钳制为 BUDGET_MAX（修复前存 999999999）');
});

// Z-5-F5 回归：取消后正文第十条反映回退签署态（原只清列不清正文，对方仍见「已签署」）
test('Z-5-F5 回归：取消后正文重拼为回退签署态', async () => {
  const raw = rawOf(); const db = d1Shim(raw);
  const { t1, d1, idOf, t1S } = await seed(db, raw);
  assert.equal((await handleCreateContract(db, contractBody(1, d1), reqOf(t1S.token))).status, 201);
  await handleSignContract(db, 1, { capToken: await capOf(raw, 't1', t1S.sessionId, idOf) }, reqOf(t1S.token));
  let ct = await dbGetContractById(db, 1);
  assert.ok(ct.contract_md.includes('签署状态：已签署'), '前置：签署后正文已签署');
  const res = await handleCancelContract(db, 1, { capToken: await capOf(raw, 't1', t1S.sessionId, idOf) }, reqOf(t1S.token));
  assert.equal(res.status, 200);
  ct = await dbGetContractById(db, 1);
  assert.ok(!ct.contract_md.includes('签署状态：已签署'), '取消后正文不再显示已签署（F5 修复：原正文残留）');
  assert.equal((ct.contract_md.match(/待签署/g) || []).length, 2, '双方均回退待签署');
});

// Z-5-F7 回归：合同修改 prev_business 加密落库（与 contract_md 同 N-05 口径；mapper 出口解密）
test('Z-5-F7 回归：prev_business 密文落库 + mapper 出口解密', async () => {
  const raw = rawOf(); const db = d1Shim(raw);
  const { s1, t1, d1, idOf, t1S, s1S } = await seed(db, raw);
  assert.equal((await handleCreateContract(db, contractBody(1, d1), reqOf(t1S.token))).status, 201);
  const ct0 = await dbGetContractById(db, 1);
  const ver = ct0.version;
  const upd = await handleModifyContract(db, 1, { contractMd: '补基础+真题演练', version: ver }, reqOf(s1S.token));
  assert.equal(upd.status, 200);
  const row = raw.prepare('SELECT prev_business FROM contracts WHERE id=1').get();
  assert.ok(String(row.prev_business).startsWith('enc:v1:'), 'prev_business 密文落库（F7 修复：原明文）');
  // 前端 diff 走列表接口（dbGetMyContracts mapper 出口解密）；dbGetContractById 不解密 prev_business
  const ct = await dbGetContractById(db, 1);
  assert.ok(String(ct.prev_business).startsWith('enc:v1:'), 'dbGetContractById 不透传明文（无泄漏面）');
  const mine = await dbGetMyContracts(db, s1); // s1 为接收方（参与方）
  const mineCt = mine.find(x => x.id === 1);
  assert.ok(mineCt && mineCt.prev_business, '列表 mapper 出口有 prev_business');
  assert.ok(!String(mineCt.prev_business).startsWith('enc:v1:'), '列表出口已解密为明文（前端 diff 可用）');
  assert.ok(String(mineCt.prev_business).includes('家教服务合同'), 'prev_business = 修改前业务部分（diff 基线）');
});

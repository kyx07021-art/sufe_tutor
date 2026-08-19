/**
 * v1.5.0 密钥轮换重加密（server/reencrypt.js）
 *   - 旧 FIELD_ENC_KEY 密文 → 新 FIELD_ENC_KEY 重写；
 *   - activity_log.detail 旧 LOG_ENCRYPT_KEY → 新 LOG_ENCRYPT_KEY 重写；
 *   - 无法解密的行只计数、不覆盖。
 *   - A-12 分片：reencryptChunk 单调用 ≤ REENCRYPT_ROW_BUDGET 行，cursor 续跑；
 *     分片汇总总计数 == 全量 reencryptAll；REENCRYPT_ROW_BUDGET ≤ 30 契约锁
 *     （D1 Free 单调用 50 次查询上限，防未来调大导致生产重加密回归 COMMON_SERVER_ERROR）。
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { DatabaseSync } from 'node:sqlite';
import { initDb } from '../src/server/core/db.js';
import { bindCryptoEnv, encryptField, decryptField, encryptDetail, decryptDetail } from '../src/server/core/crypto.js';
import { reencryptAll, reencryptChunk, REENCRYPT_ROW_BUDGET } from '../server/reencrypt.js';
import { initLogDb } from '../src/server/core/log.js';

const ENV = { ADMIN_USERNAMES: ['admin_sufe'], ADMIN_DEFAULT_PASSWORD: 'test-pw-123' };
const b64buf = (fill, mark) => Buffer.from(new Uint8Array(32).fill(fill).map((v, i) => i === 31 ? mark : v)).toString('base64');
const OLD_FIELD = b64buf(1, 0xa1);
const NEW_FIELD = b64buf(2, 0xb2);
const OLD_LOG = b64buf(3, 0xc3);
const NEW_LOG = b64buf(4, 0xd4);

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

test('旧字段密文与旧日志密文重加密为新钥；不可读行不覆盖', async () => {
  const raw = new DatabaseSync(':memory:');
  raw.exec('PRAGMA foreign_keys = ON');
  const db = d1Shim(raw);
  await initDb(db, ENV);

  // 用旧钥制造存量密文
  bindCryptoEnv({ FIELD_ENC_KEY: OLD_FIELD, LOG_ENCRYPT_KEY: OLD_LOG });
  const oldPhone = await encryptField('13800001111');
  const oldEmail = await encryptField('a@b.com');
  raw.prepare("INSERT INTO users (username,password_hash,salt,role,phone,email) VALUES ('u1','h','s','student',?,?)").run(oldPhone, oldEmail);
  const uid = raw.prepare("SELECT id FROM users WHERE username='u1'").get().id;
  const oldDetail = (await encryptDetail({ action: 'test', secret: 'x' })).text;
  raw.prepare('INSERT INTO activity_log (schema_v, encrypted, actor_user_id, actor_username, actor_role, action, entity, entity_id, detail) VALUES (2,1,?,?,?,?,?,?,?)')
    .run(uid, 'u1', 'student', 'test', 'u', String(uid), oldDetail);
  // 不可读行：不是合法密文
  raw.prepare("INSERT INTO users (username,password_hash,salt,role,email) VALUES ('u2','h','s','student','enc:v1:broken')").run();

  // 切换到新钥 + 旧钥候选，执行全量重加密
  bindCryptoEnv({ FIELD_ENC_KEY: NEW_FIELD, FIELD_ENC_KEY_OLD: OLD_FIELD, LOG_ENCRYPT_KEY: NEW_LOG, LOG_ENCRYPT_KEY_OLD: OLD_LOG });
  const summary = await reencryptAll(db);

  assert.ok(summary.fields.rewritten >= 1, '字段密文至少重写 1 行');
  assert.ok(summary.fields.unreadable >= 1, '不可读字段计数');
  assert.ok(summary.logs.rewritten >= 1, '日志 detail 重写');

  // 新钥可读，且旧钥不再可读
  const phoneRow = raw.prepare('SELECT phone, email FROM users WHERE id=?').get(uid);
  assert.notEqual(phoneRow.phone, oldPhone, '库内密文已换新');
  assert.equal(await decryptField(phoneRow.phone), '13800001111', '新钥可解');
  bindCryptoEnv({ FIELD_ENC_KEY: OLD_FIELD });
  assert.equal(await decryptField(phoneRow.phone), '[undecryptable]', '旧钥不再可解');
  // 不可读行原样保留
  const broken = raw.prepare("SELECT email FROM users WHERE username='u2'").get();
  assert.equal(broken.email, 'enc:v1:broken', '不可读行未被覆盖');
});

test('历史「无 FIELD 钥时期」由 LOG 旧钥加密的字段：轮换期可读并可重加密', async () => {
  const raw = new DatabaseSync(':memory:');
  raw.exec('PRAGMA foreign_keys = ON');
  const db = d1Shim(raw);
  await initDb(db, ENV);
  bindCryptoEnv({ LOG_ENCRYPT_KEY: OLD_LOG }); // 旧生产只有 LOG 钥
  const oldEmail = await encryptField('old-log@example.com');
  raw.prepare("INSERT INTO users (username,password_hash,salt,role,email) VALUES ('u3','h','s','student',?)").run(oldEmail);
  const uid = raw.prepare("SELECT id FROM users WHERE username='u3'").get().id;
  bindCryptoEnv({ FIELD_ENC_KEY: NEW_FIELD, LOG_ENCRYPT_KEY: NEW_LOG, LOG_ENCRYPT_KEY_OLD: OLD_LOG });
  assert.equal(await decryptField(oldEmail), 'old-log@example.com', '轮换期旧 LOG 密文可读');
  await reencryptAll(db);
  const row = raw.prepare('SELECT email FROM users WHERE id=?').get(uid);
  assert.notEqual(row.email, oldEmail);
  assert.equal(await decryptField(row.email), 'old-log@example.com', '重加密后新字段钥可读');
});

test('N1：独立 LOG_DB 场景重加密同时覆盖业务库与留档库', async () => {
  const raw = new DatabaseSync(':memory:'); raw.exec('PRAGMA foreign_keys = ON');
  const db = d1Shim(raw);
  await initDb(db, ENV);
  const logRaw = new DatabaseSync(':memory:'); logRaw.exec('PRAGMA foreign_keys = ON');
  const logDb = d1Shim(logRaw);
  await initLogDb(logDb);
  bindCryptoEnv({ LOG_ENCRYPT_KEY: OLD_LOG });
  const oldDetail = (await encryptDetail(JSON.stringify({ action: 'audit', secret: 'old-log-db' }))).text;
  logRaw.prepare('INSERT INTO activity_log (schema_v, encrypted, action, detail) VALUES (2,1,?,?)').run('audit', oldDetail);
  bindCryptoEnv({ FIELD_ENC_KEY: NEW_FIELD, LOG_ENCRYPT_KEY: NEW_LOG, LOG_ENCRYPT_KEY_OLD: OLD_LOG });
  const summary = await reencryptAll(db, logDb);
  assert.equal(summary.logs.rewritten, 1, '独立留档库 detail 已重写');
  const row = logRaw.prepare('SELECT detail FROM activity_log LIMIT 1').get();
  assert.notEqual(row.detail, oldDetail);
  assert.equal(await decryptDetail(row.detail), JSON.stringify({ action: 'audit', secret: 'old-log-db' }), '新钥可读独立留档库');
});

test('A-12：分片续跑总计数 == 全量 reencryptAll；段内恰满 budget 不重不漏', async () => {
  // 造 >budget 的数据：45 行仅 phone + 20 行仅 email（多列 OR 混合，验证 WHERE 括号续跑不拉回）+ 45 附件 + 45 日志
  const build = async () => {
    const raw = new DatabaseSync(':memory:');
    raw.exec('PRAGMA foreign_keys = ON');
    const db = d1Shim(raw);
    await initDb(db, ENV);
    bindCryptoEnv({ FIELD_ENC_KEY: OLD_FIELD, LOG_ENCRYPT_KEY: OLD_LOG });
    for (let i = 0; i < 45; i++) raw.prepare("INSERT INTO users (username,password_hash,salt,role,phone) VALUES (?,?,?,?,?)").run('p' + i, 'h', 's', 'student', await encryptField('1390000' + String(1000 + i)));
    for (let i = 0; i < 20; i++) raw.prepare("INSERT INTO users (username,password_hash,salt,role,email) VALUES (?,?,?,?,?)").run('e' + i, 'h', 's', 'student', await encryptField('e' + i + '@x.com'));
    const uid = raw.prepare("SELECT id FROM users WHERE username='p0'").get().id;
    for (let i = 0; i < 45; i++) raw.prepare('INSERT INTO complaints (user_id, target_type, target_id, attachments) VALUES (?, ?, ?, ?)').run(uid, 'teacher', i, JSON.stringify([{ body: await encryptField('data:image/' + i) }]));
    for (let i = 0; i < 45; i++) raw.prepare('INSERT INTO activity_log (schema_v, encrypted, action, detail) VALUES (2, 1, ?, ?)').run('a' + i, (await encryptDetail(JSON.stringify({ i }))).text);
    bindCryptoEnv({ FIELD_ENC_KEY: NEW_FIELD, LOG_ENCRYPT_KEY: NEW_LOG, LOG_ENCRYPT_KEY_OLD: OLD_LOG, FIELD_ENC_KEY_OLD: OLD_FIELD });
    return { raw, db };
  };

  // 全量
  const a = await build();
  const full = await reencryptAll(a.db);
  // 分片续跑
  const b = await build();
  let cursor = null, chunked = { fields: 0, attachments: 0, logs: 0 }, calls = 0;
  for (;;) {
    const { summary, cursor: next } = await reencryptChunk(b.db, cursor);
    chunked.fields += summary.fields.rewritten;
    chunked.attachments += summary.attachments.rewritten;
    chunked.logs += summary.logs.rewritten;
    calls++;
    if (!next) break;
    cursor = next;
  }
  assert.equal(full.fields.rewritten, 65, '全量字段重写 65');
  assert.equal(full.attachments.rewritten, 45, '全量附件重写 45'); // 审计建议：绝对锚（防两路径同错相等）
  assert.equal(full.logs.rewritten, 45, '全量日志重写 45');
  assert.equal(chunked.fields, full.fields.rewritten, '分片字段汇总 == 全量');
  assert.equal(chunked.attachments, full.attachments.rewritten, '分片附件汇总 == 全量');
  assert.equal(chunked.logs, full.logs.rewritten, '分片日志汇总 == 全量');
  assert.ok(calls > 1, `段内恰满 budget 触发多调用续跑（calls=${calls}）`);
  // 不重不漏：users 表行数不变（65 数据行 + 1 admin 种子）
  const rows = b.raw.prepare('SELECT COUNT(*) AS n FROM users').get().n;
  assert.equal(rows, 66, '无重复插入/处理（65 数据 + 1 admin 种子）');
});

test('A-12：REENCRYPT_ROW_BUDGET ≤ 30 契约（D1 单调用 50 查询上限防回归）', async () => {
  // D1 Free 单调用 50 次查询上限；handler 固定开销（requireAdmin/confirmDangerOtp/logEvent/logRequest）
  // ≈ 10 次 + 每段 1 次扫描 SELECT。budget 必须 ≤ 30 才保证单调用不超限——调大即回归生产事故。
  assert.ok(REENCRYPT_ROW_BUDGET > 0 && REENCRYPT_ROW_BUDGET <= 30,
    `REENCRYPT_ROW_BUDGET=${REENCRYPT_ROW_BUDGET} 超出 30 上限（防 D1 50 查询回归）`);
});

test('A-12：reencryptChunk 游标语义（首调无 cursor 返回续跑游标；日志取尽 done）', async () => {
  const raw = new DatabaseSync(':memory:');
  raw.exec('PRAGMA foreign_keys = ON');
  const db = d1Shim(raw);
  await initDb(db, ENV);
  bindCryptoEnv({ FIELD_ENC_KEY: OLD_FIELD, LOG_ENCRYPT_KEY: OLD_LOG });
  for (let i = 0; i < 5; i++) raw.prepare('INSERT INTO activity_log (schema_v, encrypted, action, detail) VALUES (2, 1, ?, ?)').run('a' + i, (await encryptDetail(JSON.stringify({ i }))).text);
  bindCryptoEnv({ FIELD_ENC_KEY: NEW_FIELD, LOG_ENCRYPT_KEY: NEW_LOG, LOG_ENCRYPT_KEY_OLD: OLD_LOG, FIELD_ENC_KEY_OLD: OLD_FIELD });
  // 首调：字段/附件空，日志 5 行 < budget → 一次完成，cursor=null
  const first = await reencryptChunk(db, null);
  assert.equal(first.cursor, null, '日志取尽 → cursor=null（全部完成）');
  assert.equal(first.summary.logs.rewritten, 5, '首调全量日志重写');
  // 幂等：完成后从头重跑（随机 IV 恒重写，无害）
  const second = await reencryptChunk(db, null);
  assert.equal(second.summary.logs.rewritten, 5, '幂等重跑');
});

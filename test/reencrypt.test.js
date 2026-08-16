/**
 * v1.5.0 密钥轮换重加密（server/reencrypt.js）
 *   - 旧 FIELD_ENC_KEY 密文 → 新 FIELD_ENC_KEY 重写；
 *   - activity_log.detail 旧 LOG_ENCRYPT_KEY → 新 LOG_ENCRYPT_KEY 重写；
 *   - 无法解密的行只计数、不覆盖。
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { DatabaseSync } from 'node:sqlite';
import { initDb } from '../server/db.js';
import { bindCryptoEnv, encryptField, decryptField, encryptDetail, decryptDetail } from '../server/crypto.js';
import { reencryptAll } from '../server/reencrypt.js';
import { initLogDb } from '../server/log.js';

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

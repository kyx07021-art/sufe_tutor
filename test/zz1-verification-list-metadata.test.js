/**
 * ZZ-1（2026-08-27，用户③）：核验列表元数据化 + 单点取图守护测试。
 * 用户原话：「学信网核验列表不再先加载全量图片，连缩略图也不加载，而是点开一个图片再加载并留存一个大图，把加载工作拆分开来」。
 * 根因：列表 SELECT v.* 全量含 admission_image 逐行解密 → 生产 9 行 1.47MB → 慢网超时 NETWORK_ERROR。
 *
 * G2 变异守护：还原 dbListTeacherVerifications 为 `SELECT v.*, u.username`（列表含 admission_image）
 * → 本文件「列表零 admission_image 键」断言必红；删 handleGetVerificationImage 单点解密 → 单点断言红。
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { DatabaseSync } from 'node:sqlite';
import { TEST_SECRETS } from './_test-secrets.js';
import { initDb } from '../src/server/core/db.js';
import { dbListTeacherVerifications } from '../src/server/domains/teacher/repo.js';
import { handleGetVerificationImage } from '../src/server/domains/teacher/api.js';
import { tokenDigest, encryptField } from '../src/server/core/crypto.js';

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

async function seed() {
  const raw = new DatabaseSync(':memory:');
  raw.exec('PRAGMA foreign_keys = ON');
  const db = d1Shim(raw);
  await initDb(db, ENV);
  raw.exec(`INSERT INTO users (username,password_hash,salt,role) VALUES
    ('t1','h','s','teacher'),('t2','h','s','teacher')`);
  const t1 = raw.prepare("SELECT id FROM users WHERE username='t1'").get().id;
  const t2 = raw.prepare("SELECT id FROM users WHERE username='t2'").get().id;
  // 录取通知大图（真实形状，加密落库）+ 验证码
  const bigImg = 'data:image/png;base64,' + 'A'.repeat(400000);
  raw.prepare('INSERT INTO teacher_verifications (user_id, verify_code, status, verify_type, admission_image) VALUES (?,?,?,?,?)')
    .run(t1, await encryptField('ABCD1234EFGH'), 'pending', 'admission', await encryptField(bigImg));
  raw.prepare('INSERT INTO teacher_verifications (user_id, verify_code, status, verify_type) VALUES (?,?,?,?)')
    .run(t2, await encryptField('WXYZ9876ABCD'), 'approved', 'chsi');
  // ZZ-1：单点端点 :id = 核验记录 id（自增 1/2），非用户 id（t1=2/t2=3 实证）
  const ver1 = raw.prepare('SELECT id FROM teacher_verifications WHERE user_id=?').get(t1).id;
  const ver2 = raw.prepare('SELECT id FROM teacher_verifications WHERE user_id=?').get(t2).id;
  const adminId = raw.prepare("SELECT id FROM users WHERE username='admin_sufe'").get().id;
  const adminToken = 'admin-zz1';
  raw.prepare('INSERT INTO auth_sessions (token_hash,user_id,label,expires_at) VALUES (?,?,?,?)')
    .run(await tokenDigest(adminToken), adminId, 'x', '2099-01-01 00:00:00');
  return { db, ver1, ver2, adminReq: { headers: new Headers({ 'X-Auth-Token': adminToken }) } };
}

test('ZZ-1 列表元数据化：零 admission_image 键 + verify_code 解密在场（列表 KB 级）', async () => {
  const { db } = await seed();
  const rows = await dbListTeacherVerifications(db, 'all');
  assert.equal(rows.length, 2);
  for (const r of rows) {
    assert.ok(!('admission_image' in r), `列表行不得含 admission_image（变异：还原 SELECT v.* → 红）`);
    assert.ok(!('admission_image' in r) || r.admission_image === undefined, 'admission_image 键零出现');
    assert.ok(r.verify_code && !String(r.verify_code).startsWith('enc:v1:'), 'verify_code 解密在场（管理员核验需明文）');
    assert.ok('username' in r && 'status' in r && 'verify_type' in r, '元数据字段完整');
  }
});

test('ZZ-1 单点取图：按 id 返回解密 admission_image（点开再加载）', async () => {
  const { db, ver1, adminReq } = await seed();
  const r = await handleGetVerificationImage(db, ver1, adminReq);
  assert.equal(r.status, 200);
  const body = JSON.parse(await r.text());
  assert.ok(body.admission_image.startsWith('data:image/png;base64,') && body.admission_image.length > 100000, '单点取图应返回解密大图');
});

test('ZZ-1 单点取图：chsi 行无图返回空串；非法 id 404 先于解密', async () => {
  const { db, ver2, adminReq } = await seed();
  const r = await handleGetVerificationImage(db, ver2, adminReq);
  assert.equal(r.status, 200);
  assert.equal(JSON.parse(await r.text()).admission_image, '', 'chsi 行无图返回空串');
  const r404 = await handleGetVerificationImage(db, 99999, adminReq);
  assert.equal(r404.status, 404, '非法 id 404');
});

test('ZZ-1 单点取图：无 admin 会话 401（门禁保留）', async () => {
  const { db, ver1 } = await seed();
  const r = await handleGetVerificationImage(db, ver1, { headers: new Headers() });
  assert.equal(r.status, 401);
});

/**
 * ZR-A3a 审计修正（F-1，2026-08-27）：handleBanUser / handleVerifyTeacher 直调守护测试。
 * 背景：admin 操作验证休眠（用户④）删除 7 处 capToken 门禁；审计实证其中封禁/学籍认证
 * 两端点此前无任何直调测试（存量盲区），还原门禁的 G2 变异存活。
 *
 * 变异守护：还原任一 confirmDangerOtp 门禁（无 capToken → 403 REAUTH_FAILED）→ 本文件对应断言红。
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { DatabaseSync } from 'node:sqlite';
import { TEST_SECRETS } from './_test-secrets.js';
import { initDb } from '../src/server/core/db.js';
import { tokenDigest } from '../src/server/core/crypto.js';
import { handleBanUser } from '../src/server/domains/admin/api.js';
import { handleVerifyTeacher } from '../src/server/domains/teacher/api.js';

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

async function setup() {
  const raw = new DatabaseSync(':memory:');
  raw.exec('PRAGMA foreign_keys = ON');
  const db = d1Shim(raw);
  await initDb(db, ENV);
  raw.exec(`INSERT INTO users (username,password_hash,salt,role) VALUES ('tea_x','h','s','teacher')`);
  const teaId = raw.prepare("SELECT id FROM users WHERE username='tea_x'").get().id;
  const adminToken = 'admin-sufe-direct-token';
  raw.prepare('INSERT INTO auth_sessions (token_hash,user_id,session_id,label,expires_at) VALUES (?,?,?,?,?)')
    .run(await tokenDigest(adminToken), raw.prepare("SELECT id FROM users WHERE username='admin_sufe'").get().id, 'sess-direct', 'x', '2099-01-01 00:00:00');
  const req = { headers: new Headers({ 'X-Auth-Token': adminToken }) };
  return { raw, db, teaId, req };
}

test('ZR-A3a F-1：handleBanUser 无 capToken 直调放行（封禁生效）', async () => {
  const { raw, db, teaId, req } = await setup();
  const r = await handleBanUser(db, teaId, { banned: 1 }, req);
  assert.equal(r.status, 200, '无 capToken 直调 200（变异：还原门禁 → 403 → 红）');
  assert.equal(raw.prepare('SELECT banned FROM users WHERE id=?').get(teaId).banned, 1, '封禁生效');
});

test('ZR-A3a F-1：handleVerifyTeacher 无 capToken 直调放行（学籍认证生效）', async () => {
  const { raw, db, teaId, req } = await setup();
  raw.prepare('INSERT INTO teacher_profiles (user_id) VALUES (?)').run(teaId); // verified 列在 teacher_profiles
  const r = await handleVerifyTeacher(db, teaId, { verified: true }, req);
  assert.equal(r.status, 200, '无 capToken 直调 200（变异：还原门禁 → 403 → 红）');
  assert.equal(raw.prepare('SELECT verified FROM teacher_profiles WHERE user_id=?').get(teaId).verified, 1, '认证生效');
});

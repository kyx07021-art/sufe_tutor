/**
 * Q-2a-L1 守护：头像 MIME 大小写不敏感（Data:Image/SVG 大写变体绕过旧 startsWith 字面量比较）
 */
import { test } from 'node:test';
import { TEST_SECRETS } from './_test-secrets.js';
import assert from 'node:assert/strict';
import { DatabaseSync } from 'node:sqlite';
import { initDb } from '../src/server/core/db.js';
import { handleSaveAvatar } from '../src/server/domains/auth/api.js';
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
  raw.exec(`INSERT INTO users (username,password_hash,salt,role) VALUES ('u1','h','s','student')`);
  const uid = raw.prepare("SELECT id FROM users WHERE username='u1'").get().id;
  const token = 'u1-token';
  raw.prepare('INSERT INTO auth_sessions (token_hash,user_id,label,expires_at) VALUES (?,?,?,?)')
    .run(await tokenDigest(token), uid, 'x', '2099-01-01 00:00:00');
  return { token, uid };
}

test('Q-2a-L1：头像 SVG MIME 大小写变体一律拒收（Data:Image/SVG 大写绕过），位图放行', async () => {
  const raw = rawOf(); const db = d1Shim(raw);
  const { token } = await seed(db, raw);
  // 小写 svg 拒绝
  let r = await handleSaveAvatar(db, { avatar: 'data:image/svg+xml;base64,xxx' }, reqOf(token));
  assert.equal(r.status, 400);
  assert.equal((await r.json()).code, 'TEACHER_AVATAR_INVALID');
  // 大小写变体一律拒收——真绕过是「前缀正确小写 + 类型大写」'data:image/SVG'（旧 startsWith
  // 字面量比较大小写敏感 → 放行落库）；全大写/首字母大写因第一个条件 startsWith 大小写敏感本身就被拒
  //（变异：还原字面量 startsWith → 'data:image/SVG+xml' 放行落库 → 红）
  for (const v of ['data:image/SVG+xml;base64,xxx', 'data:image/SvG;base64,xxx', 'Data:Image/SVG+xml;base64,xxx', 'DATA:IMAGE/SVG;BASE64,xxx', 'data:image/svg;base64,xxx']) {
    r = await handleSaveAvatar(db, { avatar: v }, reqOf(token));
    assert.equal(r.status, 400, `${v} 大小写变体拒收`);
  }
  // 非 image 拒绝
  r = await handleSaveAvatar(db, { avatar: 'data:text/html;base64,xxx' }, reqOf(token));
  assert.equal(r.status, 400, 'html 拒收');
  // 超长拒绝
  r = await handleSaveAvatar(db, { avatar: 'data:image/png;base64,' + 'A'.repeat(20001) }, reqOf(token));
  assert.equal(r.status, 400, '超长拒收');
  // 位图放行
  const ok = await handleSaveAvatar(db, { avatar: 'data:image/png;base64,iVBORw0KGgo=' }, reqOf(token));
  assert.equal(ok.status, 200, '位图放行');
});

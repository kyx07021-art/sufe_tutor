/**
 * #163（v0.25.71）：隐私设置大层级——访客可见性控制
 *  - user_settings 无行 = 全默认可见（COALESCE 1）；upsert 单点写（只传一字段另一保持）；
 *  - GET/POST /api/privacy-settings requireUser 守卫、非法字段 400；
 *  - 游客浏览过滤：allow_guest_demand/profile=0 → 游客列表剔除、登录用户不受影响；
 *  - 隐私写 bump teachers+demands 版本域（访客可见性变化 → 两域缓存刷新）。
 */
import { test } from 'node:test';
import { TEST_SECRETS } from './_test-secrets.js';
import assert from 'node:assert/strict';
import { DatabaseSync } from 'node:sqlite';
import { initDb } from '../src/server/core/db.js';
import { dbGetPrivacySettings, dbSetPrivacySettings } from '../src/server/domains/settings/repo.js';
import { dbGetDemands } from '../src/server/domains/demand/repo.js';
import { dbGetTeachers } from '../src/server/domains/teacher/repo.js';
import { handleGetPrivacySettings, handleSetPrivacySettings } from '../src/server/domains/settings/api.js';
import { handleGetDemands } from '../src/server/domains/demand/api.js';
import { handleGetTeachers } from '../src/server/domains/teacher/api.js';
import { tokenDigest } from '../src/server/core/crypto.js';
import { versionDomainOf } from '../server/version.js';

const ENV = { ...TEST_SECRETS, ADMIN_USERNAMES: ['admin_sufe'], ADMIN_DEFAULT_PASSWORD: 'test-pw-123' };

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

/** 播种：t1 教师 + s1 学生；t1 档案、s1 open 需求各一条 */
async function seed(db, raw) {
  await initDb(db, ENV);
  raw.exec(`INSERT INTO users (username,password_hash,salt,role) VALUES ('t1','h','s','teacher'),('s1','h','s','student')`);
  const idOf = name => raw.prepare("SELECT id FROM users WHERE username=?").get(name).id;
  const t1 = idOf('t1'), s1 = idOf('s1');
  raw.prepare(`INSERT INTO teacher_profiles (user_id,subjects,province,price_min,price_max) VALUES (?,?,?,?,?)`)
    .run(t1, '["math"]', 'shanghai', 150, 200);
  raw.prepare(`INSERT INTO student_demands (user_id,student_grade,student_gender,target_subjects,current_scores,submitter_type,parent_contact,student_contact,status,display_id)
    VALUES (?,?,?,?,?,?,?,?,?,?)`)
    .run(s1, 'senior1', 'female', '["math"]', '[]', 'self', '13800000000', '13800000000', 'open', 1);
  const mkToken = async name => {
    const token = `${name}-token`;
    raw.prepare('INSERT INTO auth_sessions (token_hash,user_id,label,expires_at) VALUES (?,?,?,?)')
      .run(await tokenDigest(token), idOf(name), 'x', '2099-01-01 00:00:00');
    return token;
  };
  return { t1, s1, t1Token: await mkToken('t1'), s1Token: await mkToken('s1') };
}

test('隐私默认：无 user_settings 行 → 全允许（1/1）', async () => {
  const raw = rawOf(); const db = d1Shim(raw);
  const { t1 } = await seed(db, raw);
  assert.deepEqual(await dbGetPrivacySettings(db, t1), { allowGuestProfile: 1, allowGuestDemand: 1 });
});

test('dbSetPrivacySettings upsert：写 0 → 读 0；只传一字段另一保持原值', async () => {
  const raw = rawOf(); const db = d1Shim(raw);
  const { t1 } = await seed(db, raw);
  let s = await dbSetPrivacySettings(db, t1, { allowGuestProfile: 0 });
  assert.deepEqual(s, { allowGuestProfile: 0, allowGuestDemand: 1 }, '写档案关 → 档案 0、需求保持 1');
  s = await dbSetPrivacySettings(db, t1, { allowGuestDemand: 0 });
  assert.deepEqual(s, { allowGuestProfile: 0, allowGuestDemand: 0 }, '只写需求 → 档案保持 0');
  s = await dbSetPrivacySettings(db, t1, { allowGuestProfile: 1 });
  assert.deepEqual(s, { allowGuestProfile: 1, allowGuestDemand: 0 }, '只写档案 → 需求保持 0');
});

test('隐私路由：requireUser 守卫；GET 读默认；POST 非法字段 400；正常写落库', async () => {
  const raw = rawOf(); const db = d1Shim(raw);
  const { s1Token, s1 } = await seed(db, raw);
  const unauth = await handleGetPrivacySettings(db, reqOf('bad-token'));
  assert.equal(unauth.status, 401, '无令牌被拒');
  const r = await handleGetPrivacySettings(db, reqOf(s1Token));
  assert.equal(r.status, 200);
  assert.deepEqual((await r.json()).allowGuestDemand, 1, 'GET 默认允许');
  const bad = await handleSetPrivacySettings(db, { allowGuestProfile: 'yes' }, reqOf(s1Token));
  assert.equal(bad.status, 400, '非法字段被拒');
  const w = await handleSetPrivacySettings(db, { allowGuestDemand: 0 }, reqOf(s1Token));
  assert.equal(w.status, 200);
  assert.equal((await w.json()).allowGuestDemand, 0, '写后读 0');
  assert.equal(raw.prepare('SELECT allow_guest_demand FROM user_settings WHERE user_id=?').get(s1).allow_guest_demand, 0, '落库');
});

test('访客需求过滤：allow_guest_demand=0 → 游客列表剔除、登录学生可见', async () => {
  const raw = rawOf(); const db = d1Shim(raw);
  const { s1, s1Token } = await seed(db, raw);
  // 默认（允许）：游客也可见
  let guest = await dbGetDemands(db, { forGuest: true });
  assert.equal(guest.length, 1, '默认游客可见需求');
  // 关掉需求可见性
  await dbSetPrivacySettings(db, s1, { allowGuestDemand: 0 });
  guest = await dbGetDemands(db, { forGuest: true });
  assert.equal(guest.length, 0, '关闭后游客列表剔除');
  // 登录学生（非游客）仍可见
  const me = await dbGetDemands(db, { forGuest: false });
  assert.equal(me.length, 1, '登录用户不受影响');
  // 路由层：游客请求走 forGuest
  const guestReq = await handleGetDemands(db, new URL('http://x/api/student/demands'), reqOf('bad'));
  assert.equal((await guestReq.json()).demands.length, 0, '路由游客分支剔除');
  const authReq = await handleGetDemands(db, new URL('http://x/api/student/demands'), reqOf(s1Token));
  assert.equal((await authReq.json()).demands.length, 1, '路由登录分支可见');
});

test('访客教师过滤：allow_guest_profile=0 → 游客列表剔除、登录用户可见', async () => {
  const raw = rawOf(); const db = d1Shim(raw);
  const { t1, t1Token } = await seed(db, raw);
  let guest = await dbGetTeachers(db, { viewerId: null });
  assert.equal(guest.length, 1, '默认游客可见教师');
  await dbSetPrivacySettings(db, t1, { allowGuestProfile: 0 });
  guest = await dbGetTeachers(db, { viewerId: null });
  assert.equal(guest.length, 0, '关闭后游客列表剔除');
  const authed = await dbGetTeachers(db, { viewerId: t1 });
  assert.equal(authed.length, 1, '登录用户不受影响');
  // 路由层游客分支
  const routeGuest = await handleGetTeachers(db, reqOf('bad'));
  assert.equal((await routeGuest.json()).teachers.length, 0, '路由游客分支剔除');
  const routeAuthed = await handleGetTeachers(db, reqOf(t1Token));
  assert.equal((await routeAuthed.json()).teachers.length, 1, '路由登录分支可见');
});

test('隐私写 bump 版本域：teachers+demands 双域刷新（访客可见性变化影响两浏览面）', () => {
  const domains = versionDomainOf('/api/privacy-settings');
  assert.ok(domains.includes('teachers'), '教师域刷新');
  assert.ok(domains.includes('demands'), '需求域刷新');
});

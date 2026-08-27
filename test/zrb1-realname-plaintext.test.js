/**
 * ZR-B1（用户①裁决，2026-08-26）：教师 real_name（真实姓名 → 平台内名称）加密私有列 → 明文公开列。
 * 数据层守护（写路径 + 读路径 + 广场列表公开分支全链一致，A1 字段变换全路径一致）：
 *   ① dbUpsertTeacherProfile INSERT/UPDATE 两路径明文直写（库内无 enc: 前缀）+ 截断先于落库；
 *   ② dbGetTeacherProfile 明文直读回显（本人档案）；
 *   ③ dbGetTeachers 公开分支（访客/登录态）含 real_name 明文——广场裁剪不再覆盖 real_name，
 *      wechat/email/credential_image 仍裁剪为空（私密字段口径不变）；
 *   ④ adminView 明文直读。
 * G2 变异守护：还原写路径 `encryptField(...)`（明文断言必红）/ 还原广场裁剪
 * `: ['', '', '', '']`（列表含 real_name 断言必红）。
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { DatabaseSync } from 'node:sqlite';
import { TEST_SECRETS } from './_test-secrets.js';
import { initDb } from '../src/server/core/db.js';
import { dbUpsertTeacherProfile, dbGetTeacherProfile, dbGetTeachers, dbApplyChsiToProfile } from '../src/server/domains/teacher/repo.js';
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

async function seedBase() {
  const raw = new DatabaseSync(':memory:');
  raw.exec('PRAGMA foreign_keys = ON');
  const db = d1Shim(raw);
  await initDb(db, ENV);
  raw.prepare("INSERT INTO users (username,password_hash,salt,role) VALUES ('t1','h','s','teacher'),('s1','h','s','student')").run();
  const tea = raw.prepare("SELECT id FROM users WHERE username='t1'").get().id;
  const stu = raw.prepare("SELECT id FROM users WHERE username='s1'").get().id;
  return { raw, db, tea, stu };
}

const PROFILE_OF = realName => ({
  province: 'shanghai', grade: 'freshman', gender: 'male', subjects: ['math'], gaokao_scores: [],
  price_min: 100, price_max: 200, wechat: 'wx_zrb1', email: 'zrb1@t.com', intro: '', address: '',
  school: '上海财经大学', real_name: realName, credential_image: 'data:image/png;base64,ZRB1',
});

test('ZR-B1 INSERT 路径：real_name 明文直写（库内零 enc: 前缀）+ 本人档案明文回读', async () => {
  const { raw, db, tea } = await seedBase();
  await dbUpsertTeacherProfile(db, tea, PROFILE_OF('王老师'));
  const stored = raw.prepare('SELECT real_name, wechat FROM teacher_profiles WHERE user_id=?').get(tea);
  assert.equal(stored.real_name, '王老师', 'real_name 明文落库（变异：还原 encryptField → 此处见 enc: 密文必红）');
  assert.ok(!String(stored.real_name).startsWith('enc:'), '库内零加密前缀');
  assert.ok(String(stored.wechat).startsWith('enc:v1:'), 'wechat 加密口径不变（对照列）');
  const prof = await dbGetTeacherProfile(db, tea);
  assert.equal(prof.real_name, '王老师', '本人档案明文直读');
  assert.equal(prof.wechat, 'wx_zrb1', 'wechat 仍解密回读（口径不变）');
});

test('ZR-B1 UPDATE 路径：二次保存仍明文（两写路径一致，A1）', async () => {
  const { raw, db, tea } = await seedBase();
  await dbUpsertTeacherProfile(db, tea, PROFILE_OF('旧名字'));
  await dbUpsertTeacherProfile(db, tea, PROFILE_OF('新名字')); // existing 命中 → UPDATE 分支
  const stored = raw.prepare('SELECT real_name FROM teacher_profiles WHERE user_id=?').get(tea);
  assert.equal(stored.real_name, '新名字', 'UPDATE 路径明文覆写');
  assert.ok(!String(stored.real_name).startsWith('enc:'), 'UPDATE 后库内零加密前缀');
});

test('ZR-B1 截断先于落库：超 REAL_NAME_MAX 截到上限', async () => {
  const { raw, db, tea } = await seedBase();
  const long = '名'.repeat(LIMITS.REAL_NAME_MAX + 5);
  await dbUpsertTeacherProfile(db, tea, PROFILE_OF(long));
  const stored = raw.prepare('SELECT real_name FROM teacher_profiles WHERE user_id=?').get(tea);
  assert.equal(stored.real_name, '名'.repeat(LIMITS.REAL_NAME_MAX), '截断到 REAL_NAME_MAX');
});

test('ZR-B1 广场列表公开分支：访客/登录态均含 real_name 明文，私密三件仍裁剪', async () => {
  const { raw, db, tea, stu } = await seedBase();
  await dbUpsertTeacherProfile(db, tea, PROFILE_OF('广场名'));
  // ZH-1：公开列表过滤 chsi_verified=1——认证后才进广场
  await dbApplyChsiToProfile(db, tea, { school: '测试大学', level: '本科', major: '', enrollmentStatus: '在籍', enrollYear: '2026' });

  const guestList = await dbGetTeachers(db, {});
  assert.equal(guestList.length, 1, '认证教师进广场');
  assert.equal(guestList[0].real_name, '广场名', '访客列表含 real_name 明文（变异：还原裁剪置空必红）');
  assert.equal(guestList[0].wechat, '', 'wechat 仍裁剪');
  assert.equal(guestList[0].email, '', 'email 仍裁剪');
  assert.equal(guestList[0].credential_image, '', 'credential_image 仍裁剪');

  raw.prepare('INSERT INTO conversations (student_user_id, teacher_user_id) VALUES (?,?)').run(stu, tea);
  const matchedList = await dbGetTeachers(db, { viewerId: stu });
  assert.equal(matchedList[0].real_name, '广场名', '登录态列表含 real_name 明文');
  assert.equal(matchedList[0].matched, true, 'matched 标记照常');
  assert.equal(matchedList[0].credential_image, '', '登录态 credential_image 仍裁剪');
});

test('ZR-B1 adminView：real_name 明文直读', async () => {
  const { db, tea } = await seedBase();
  await dbUpsertTeacherProfile(db, tea, PROFILE_OF('管理名'));
  const adminList = await dbGetTeachers(db, { adminView: true });
  const row = adminList.find(t => t.user_id === tea);
  assert.equal(row.real_name, '管理名', '管理端明文直读');
  assert.equal(row.wechat, 'wx_zrb1', '管理端 wechat 解密口径不变');
});

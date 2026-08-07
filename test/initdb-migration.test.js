/**
 * initDb 全链路 + 遗留迁移回归（node:sqlite 真库，替代既有 fake-D1 的轻量桩）
 *
 * 覆盖（v0.21.4 审计修复批次）：
 *   - 全新库 initDb 完整可跑：管理员播种 + 全表建成 + 子表 FK 正常（重构迁移顺序后的回归）
 *   - 遗留迁移 N-19：旧表经历次 ensureColumns 比迁移 DDL 多/少列 → 列交集拷贝不炸、数据保留
 *   - 遗留迁移 FK 悬空：迁移若在初始建表之后跑，子表 FK 会被改名腾位改写指向 _*_old 后悬空，
 *     全站 INSERT 报 no such table——现迁移先行，子表引用最终表（实证回归）
 *   - 空 ADMIN_USERNAMES：不再拼出 IN () 语法错误
 *   - notify.js 管理删通知（requireAdmin 未导入 → ReferenceError 500 的断点回归）
 *   - 登出清理 danger_caps（孤儿行清理回归）
 *
 * D1 形状：db.prepare(sql).bind(...).all()/.first()/.run() + db.batch([...])
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { DatabaseSync } from 'node:sqlite';
import { initDb } from '../server/db.js';
import { issueAuthToken, getSessionByToken } from '../server/session.js';
import { handleAdminDeleteNotification } from '../server/notify.js';
import { handleLogout } from '../server/routes-auth.js';
import { tokenDigest } from '../server/crypto.js';

// node:sqlite → D1 形状薄封装
function d1Shim(raw) {
  return {
    prepare(sql) {
      const st = {
        _sql: sql, _params: [],
        bind(...p) { st._params = p; return st; },
        _exec() {
          const info = raw.prepare(st._sql).run(...st._params);
          return { meta: { changes: Number(info.changes), last_row_id: Number(info.lastInsertRowid) } };
        },
        all(...p) {
          return { results: raw.prepare(st._sql).all(...(p.length ? p : st._params)) };
        },
        first(...p) {
          return raw.prepare(st._sql).get(...(p.length ? p : st._params)) ?? undefined;
        },
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
        for (const s of stmts) s._exec();
        raw.exec('COMMIT');
      } catch (e) {
        try { raw.exec('ROLLBACK'); } catch { /* ignore */ }
        throw e;
      }
    },
  };
}

const ENV = { ADMIN_USERNAMES: ['admin_sufe'], ADMIN_DEFAULT_PASSWORD: 'test-pw-123' };
const rawOf = () => { const r = new DatabaseSync(':memory:'); r.exec('PRAGMA foreign_keys = ON'); return r; };

/** 建一张遗留 users（role 不含 admin，触发迁移守卫） */
function legacyUsers(raw) {
  raw.exec(`CREATE TABLE users (
    id INTEGER PRIMARY KEY AUTOINCREMENT, username TEXT UNIQUE NOT NULL,
    password_hash TEXT NOT NULL, salt TEXT NOT NULL,
    role TEXT NOT NULL CHECK(role IN ('student','teacher')),
    created_at DATETIME DEFAULT (datetime('now','localtime')))`);
  raw.exec(`INSERT INTO users (username,password_hash,salt,role) VALUES
    ('legacy_student','h','s','student'), ('legacy_teacher','h','s','teacher')`);
}

// Case A：旧 teacher_profiles 已含 school/real_name/credential_image（16 列，曾致 INSERT SELECT * 列数错位必炸）
function legacyTeacherProfilesFull(raw) {
  raw.exec(`CREATE TABLE teacher_profiles (
    id INTEGER PRIMARY KEY AUTOINCREMENT, user_id INTEGER UNIQUE NOT NULL,
    grade TEXT, gender TEXT, subjects TEXT, gaokao_scores TEXT,
    price REAL DEFAULT 0, wechat TEXT, email TEXT,
    school TEXT DEFAULT '', real_name TEXT DEFAULT '', credential_image TEXT DEFAULT '',
    rating REAL DEFAULT 4.0, rating_count INTEGER DEFAULT 0, rating_sum REAL DEFAULT 0,
    updated_at DATETIME DEFAULT (datetime('now','localtime')),
    FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE)`);
  raw.exec(`INSERT INTO teacher_profiles (user_id,grade,subjects,school,real_name,credential_image,rating)
    VALUES (2,'高三','[1]','上海中学','张三','data:image/png;base64,AAAA',4.5)`);
}

// Case A：旧 student_demands 已含 expected_time（17 列）
function legacyDemandsFull(raw) {
  raw.exec(`CREATE TABLE student_demands (
    id INTEGER PRIMARY KEY AUTOINCREMENT, user_id INTEGER NOT NULL,
    student_grade TEXT NOT NULL, student_gender TEXT NOT NULL,
    target_subjects TEXT NOT NULL, current_scores TEXT NOT NULL,
    teaching_method TEXT NOT NULL DEFAULT 'offline',
    address TEXT DEFAULT '', address_detail TEXT DEFAULT '',
    expected_time TEXT DEFAULT '',
    budget_min REAL DEFAULT 0, budget_max REAL DEFAULT 0,
    submitter_type TEXT NOT NULL, parent_contact TEXT NOT NULL,
    student_contact TEXT NOT NULL, additional_info TEXT DEFAULT '',
    created_at DATETIME DEFAULT (datetime('now','localtime')),
    FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE)`);
  raw.exec(`INSERT INTO student_demands (user_id,student_grade,student_gender,target_subjects,current_scores,submitter_type,parent_contact,student_contact,expected_time)
    VALUES (1,'高三','男','[1]','[]','parent','13800138000','x','开学前')`);
}

// Case B：旧 teacher_profiles 只有 13 列（无 school/real_name/credential_image）
function legacyTeacherProfilesMin(raw) {
  raw.exec(`CREATE TABLE teacher_profiles (
    id INTEGER PRIMARY KEY AUTOINCREMENT, user_id INTEGER UNIQUE NOT NULL,
    grade TEXT, gender TEXT, subjects TEXT, gaokao_scores TEXT,
    price REAL DEFAULT 0, wechat TEXT, email TEXT,
    rating REAL DEFAULT 4.0, rating_count INTEGER DEFAULT 0, rating_sum REAL DEFAULT 0,
    updated_at DATETIME DEFAULT (datetime('now','localtime')),
    FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE)`);
  raw.exec(`INSERT INTO teacher_profiles (user_id,grade,subjects,rating)
    VALUES (2,'高一','[2]',4.0)`);
}

// Case B：旧 student_demands 无 expected_time（16 列）
function legacyDemandsMin(raw) {
  raw.exec(`CREATE TABLE student_demands (
    id INTEGER PRIMARY KEY AUTOINCREMENT, user_id INTEGER NOT NULL,
    student_grade TEXT NOT NULL, student_gender TEXT NOT NULL,
    target_subjects TEXT NOT NULL, current_scores TEXT NOT NULL,
    teaching_method TEXT NOT NULL DEFAULT 'offline',
    address TEXT DEFAULT '', address_detail TEXT DEFAULT '',
    budget_min REAL DEFAULT 0, budget_max REAL DEFAULT 0,
    submitter_type TEXT NOT NULL, parent_contact TEXT NOT NULL,
    student_contact TEXT NOT NULL, additional_info TEXT DEFAULT '',
    created_at DATETIME DEFAULT (datetime('now','localtime')),
    FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE)`);
  raw.exec(`INSERT INTO student_demands (user_id,student_grade,student_gender,target_subjects,current_scores,submitter_type,parent_contact,student_contact)
    VALUES (1,'高一','女','[2]','[]','parent','13900139000','y')`);
}

/** 公共断言：迁移完成 + 管理员播种 + 子表 FK 未悬空 */
async function assertMigratedOk(db, raw) {
  // 迁移幂等守卫生效：users 定义已含 admin，二次 initDb 不再触发（不炸）
  const u = db.prepare("SELECT sql FROM sqlite_master WHERE type='table' AND name='users'").first();
  assert.ok(u.sql.includes("'admin'"), 'users 应已升级为含 admin 的形状');
  // 管理员播种
  const admin = db.prepare("SELECT role FROM users WHERE username='admin_sufe'").first();
  assert.ok(admin && admin.role === 'admin', '应播种 admin_sufe 管理员');
  // 子表 FK 未悬空：迁移先行后 auth_sessions 引用最终 users，INSERT 应成功
  db.prepare("INSERT INTO auth_sessions (token_hash,user_id,label,expires_at) VALUES (?,?,?,?)")
    .run('t0', 1, 'x', '2099-01-01 00:00:00');
  // 无 _*_old 残留
  const olds = db.prepare("SELECT name FROM sqlite_master WHERE type='table' AND name LIKE '\\_%\\_old' ESCAPE '\\'").all().results;
  assert.equal(olds.length, 0, '不应残留 _*_old 表');
}

test('全新库：initDb 完整可跑 + 管理员播种 + 子表 FK 正常', async () => {
  const raw = rawOf();
  const db = d1Shim(raw);
  await initDb(db, ENV);
  const admin = db.prepare("SELECT role FROM users WHERE username='admin_sufe'").first();
  assert.ok(admin && admin.role === 'admin');
  // 全表建成
  for (const t of ['users', 'auth_sessions', 'teacher_profiles', 'student_demands', 'contracts', 'conversations', 'messages', 'notifications', 'danger_caps']) {
    const row = db.prepare("SELECT 1 AS x FROM sqlite_master WHERE type='table' AND name=?").first(t);
    assert.ok(row, `表 ${t} 应已建成`);
  }
  // 子表 FK 正常（新库不经迁移，FK 直指 users）
  db.prepare("INSERT INTO auth_sessions (token_hash,user_id,label,expires_at) VALUES ('t1',1,'x','2099-01-01 00:00:00')").run();
});

test('遗留迁移 Case A：旧表已含额外列 → 列交集拷贝、数据保留、FK 不悬空', async () => {
  const raw = rawOf();
  legacyUsers(raw);
  legacyTeacherProfilesFull(raw);
  legacyDemandsFull(raw);
  const db = d1Shim(raw);
  await initDb(db, ENV); // 不应抛（修复前 teacher_profiles 16列→13列 INSERT SELECT * 必炸）
  await assertMigratedOk(db, raw);
  const tp = db.prepare("SELECT school,real_name,credential_image,rating FROM teacher_profiles WHERE user_id=2").first();
  assert.equal(tp.school, '上海中学');
  assert.equal(tp.real_name, '张三');
  assert.equal(tp.credential_image, 'data:image/png;base64,AAAA');
  assert.equal(tp.rating, 4.5);
  const sd = db.prepare("SELECT expected_time FROM student_demands WHERE user_id=1").first();
  assert.equal(sd.expected_time, '开学前');
});

test('遗留迁移 Case B：旧表缺列 → 数据保留、缺列由 ensureColumns 补齐', async () => {
  const raw = rawOf();
  legacyUsers(raw);
  legacyTeacherProfilesMin(raw);
  legacyDemandsMin(raw);
  const db = d1Shim(raw);
  await initDb(db, ENV);
  await assertMigratedOk(db, raw);
  const tp = db.prepare("SELECT grade,subjects,rating,school FROM teacher_profiles WHERE user_id=2").first();
  assert.equal(tp.grade, '高一');
  assert.equal(tp.rating, 4.0);
  assert.equal(tp.school, '', '缺列应由 ensureColumns 补空列');
  // ensureColumns 幂等：school 列已存在
  const cols = db.prepare('PRAGMA table_info(teacher_profiles)').all().results.map(c => c.name);
  assert.ok(cols.includes('school') && cols.includes('credential_image'));
});

test('遗留迁移空 ADMIN_USERNAMES：不拼 IN () 语法错误', async () => {
  const raw = rawOf();
  legacyUsers(raw);
  legacyTeacherProfilesMin(raw);
  legacyDemandsMin(raw);
  const db = d1Shim(raw);
  await initDb(db, { ADMIN_USERNAMES: [], ADMIN_DEFAULT_PASSWORD: '' });
  const u = db.prepare("SELECT sql FROM sqlite_master WHERE type='table' AND name='users'").first();
  assert.ok(u.sql.includes("'admin'"));
  // 无管理员播种（空列表），但不炸
  const anyAdmin = db.prepare("SELECT 1 AS x FROM users WHERE role='admin'").first();
  assert.ok(!anyAdmin);
});

test('notify.js 管理删通知：requireAdmin 导入回归（曾 ReferenceError 500）', async () => {
  const raw = rawOf();
  const db = d1Shim(raw);
  await initDb(db, ENV);
  const adminId = db.prepare("SELECT id FROM users WHERE username='admin_sufe'").first().id;
  const adminToken = await issueAuthToken(db, adminId, 'test');
  // 普通学生
  db.prepare("INSERT INTO users (username,password_hash,salt,role) VALUES ('stu1','h','s','student')").run();
  const stuId = db.prepare("SELECT id FROM users WHERE username='stu1'").first().id;
  const stuToken = await issueAuthToken(db, stuId, 'test');
  db.prepare("INSERT INTO notifications (user_id,text,batch_id) VALUES (?,?,?)").run(1, '公告A', 'BATCH-X');
  db.prepare("INSERT INTO notifications (user_id,text,batch_id) VALUES (?,?,?)").run(2, '公告B', 'BATCH-X');
  const notifId = db.prepare('SELECT id FROM notifications WHERE user_id=1').first().id;

  // 非管理员 → 403（requireAdmin 角色门）
  const deny = await handleAdminDeleteNotification(db, notifId, new Request('https://t.test', { headers: { 'X-Auth-Token': stuToken } }));
  assert.equal(deny.status, 403);

  // 管理员 → 按 batch 整批删（修复前此处 ReferenceError → 500）
  const ok = await handleAdminDeleteNotification(db, notifId, new Request('https://t.test', { headers: { 'X-Auth-Token': adminToken } }));
  assert.equal(ok.status, 200);
  const data = await ok.json();
  assert.equal(data.count, 2);
  const left = db.prepare('SELECT COUNT(*) AS n FROM notifications').first().n;
  assert.equal(left, 0);
});

test('登出清理 danger_caps：孤儿行随登出删除', async () => {
  const raw = rawOf();
  const db = d1Shim(raw);
  await initDb(db, ENV);
  const adminId = db.prepare("SELECT id FROM users WHERE username='admin_sufe'").first().id;
  const token = await issueAuthToken(db, adminId, 'test');
  const sess = await getSessionByToken(db, adminId, token);
  assert.ok(sess);
  db.prepare("INSERT INTO danger_caps (user_id, session_id, token_hash, expires_at) VALUES (?,?,?,?)")
    .run(adminId, sess.session_id, await tokenDigest('dummy-captoken'), '2099-01-01 00:00:00');

  const res = await handleLogout(db, new Request('https://t.test', { headers: { 'X-Auth-Token': token } }));
  assert.equal(res.status, 200);
  const left = db.prepare('SELECT COUNT(*) AS n FROM danger_caps').first().n;
  assert.equal(left, 0, '登出后该会话 capToken 应被清理');
});

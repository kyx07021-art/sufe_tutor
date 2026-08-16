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
import {
  initDb, dbUpsertTeacherProfile, dbGetTeacherProfile, dbGetContractById,
  dbCreateMessage, dbGetMessageAttachment, dbGetTeachers,
} from '../server/db.js';
import { dbRun } from '../server/util.js';
import { issueAuthToken, getSessionByToken } from '../server/session.js';
import { handleAdminDeleteNotification } from '../server/notify.js';
import { handleLogout, handleLogin } from '../server/routes-auth.js';
import { logRequest, dbGetTrafficBuckets } from '../server/log.js';
import { tokenDigest, encryptField, decryptField } from '../server/crypto.js';

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
        const out = [];
        for (const s of stmts) {
          if (/^\s*(SELECT|PRAGMA|WITH|EXPLAIN)/i.test(s._sql)) {
            out.push({ results: raw.prepare(s._sql).all(...s._params) });
          } else {
            const info = raw.prepare(s._sql).run(...s._params);
            out.push({ meta: { changes: Number(info.changes), last_row_id: Number(info.lastInsertRowid) } });
          }
        }
        raw.exec('COMMIT');
        return out; // 与 D1 db.batch 一致：逐条返回 {results}/{meta}
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
  assert.equal(tp.rating, 4.5, 'R16：存量未评价教师（rating_count=0 旧默认 4.0）回填新默认 4.5');
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

test('N-05 加密列：合同正文/学信网截图/附件 写加密读解密、老明文行原样放行', async () => {
  const raw = rawOf();
  const db = d1Shim(raw);
  await initDb(db, ENV);
  db.prepare("INSERT INTO users (username,password_hash,salt,role) VALUES ('stu1','h','s','student'),('t1','h','s','teacher')").run();
  const stu = db.prepare("SELECT id FROM users WHERE username='stu1'").first().id;
  const tea = db.prepare("SELECT id FROM users WHERE username='t1'").first().id;
  db.prepare('INSERT INTO conversations (student_user_id, teacher_user_id) VALUES (?,?)').run(stu, tea);
  const conv = db.prepare('SELECT id FROM conversations LIMIT 1').first().id;

  // 学信网截图：写入加密、出门解密
  await dbUpsertTeacherProfile(db, tea, { province: '', grade: '', gender: '', subjects: ['数学'], gaokao_scores: [], price: null, wechat: '', email: '', intro: '', address: '', school: '', real_name: '', credential_image: 'data:image/png;base64,CRED123' });
  const storedCred = db.prepare('SELECT credential_image FROM teacher_profiles WHERE user_id=?').first(tea);
  assert.ok(storedCred.credential_image.startsWith('enc:v1:'), 'credential_image 应加密落库');
  const prof = await dbGetTeacherProfile(db, tea);
  assert.equal(prof.credential_image, 'data:image/png;base64,CRED123');

  // 合同正文：加密写 → 读解密；老明文行原样放行（decryptField 向后兼容）
  await dbRun(db, 'INSERT INTO contracts (conversation_id, drafter_user_id, contract_md) VALUES (?,?,?)', [conv, tea, await encryptField('合同正文X')]);
  const cid = db.prepare('SELECT id FROM contracts ORDER BY id DESC LIMIT 1').first().id;
  assert.equal((await dbGetContractById(db, cid)).contract_md, '合同正文X');
  await dbRun(db, 'INSERT INTO contracts (conversation_id, drafter_user_id, contract_md) VALUES (?,?,?)', [conv, tea, '老明文合同']);
  const oldCid = db.prepare("SELECT id FROM contracts WHERE contract_md='老明文合同'").first().id;
  assert.equal((await dbGetContractById(db, oldCid)).contract_md, '老明文合同', '老明文合同行应原样放行');

  // 附件：消息正文加密落库、读侧 decryptField 还原（route 层解密等价的往返验证）
  const mid = await dbCreateMessage(db, conv, tea, 'image', await encryptField('data:image/png;base64,ATT'), 'a.png');
  const att = await dbGetMessageAttachment(db, mid, conv);
  assert.ok(att.body.startsWith('enc:v1:'), '附件正文应加密落库');
  assert.equal(await decryptField(att.body), 'data:image/png;base64,ATT');
});

test('登录链路 3 次往返架构：限流+取用户同批、会话批、留档统一落', async () => {
  const raw = rawOf();
  const db = d1Shim(raw);
  await initDb(db, ENV);
  const req = new Request('https://t.test', { method: 'POST', headers: { 'CF-Connecting-IP': '1.2.3.4', 'Content-Type': 'application/json' } });

  const ok = await handleLogin(db, { username: 'admin_sufe', password: 'test-pw-123' }, req);
  assert.equal(ok.status, 200);
  assert.ok((await ok.json()).authToken);
  const bad = await handleLogin(db, { username: 'admin_sufe', password: 'wrong' }, req);
  assert.equal(bad.status, 401);
  const noUser = await handleLogin(db, { username: 'ghost_user', password: 'x' }, req);
  assert.equal(noUser.status, 401);
  // 会话批（DELETE 过期 + INSERT）已生效：仅成功那次建了会话
  assert.equal(db.prepare('SELECT COUNT(*) AS n FROM auth_sessions').first().n, 1);
  // 收尾统一落库：与线上同款——logRequest 用同一 req，把业务留档 + 访问留档一次 batch 落出
  await logRequest(db, { method: 'POST', path: '/api/auth/login', body: { username: 'admin_sufe' }, status: 200, req, durationMs: 123 });
  const logs = db.prepare('SELECT action, duration_ms FROM activity_log ORDER BY id DESC LIMIT 6').all().results;
  const actions = logs.map(l => l.action);
  assert.ok(actions.some(a => a.startsWith('auth.login.')), '业务留档已落（auth.login.*）');
  assert.ok(actions.some(a => a.startsWith('http.')), '访问留档已落（http.<METHOD>.*）');
  assert.equal(logs[0].duration_ms, 123, 'duration_ms 已记录（D 可观测性）');
});

test('访问留档只记写操作与失败请求：成功 GET（列表/轮询/探测）不入留档', async () => {
  const raw = rawOf();
  const db = d1Shim(raw);
  await initDb(db, ENV);
  const mk = m => new Request('https://t.test', { method: m, headers: { 'CF-Connecting-IP': '1.1.1.1' } });
  // 成功 GET（徽标轮询/用户名探测/列表）一律不留档
  await logRequest(db, { method: 'GET', path: '/api/notifications', status: 200, req: mk('GET') });
  await logRequest(db, { method: 'GET', path: '/api/auth/check?username=x', status: 200, req: mk('GET') });
  await logRequest(db, { method: 'GET', path: '/api/student/demands', status: 200, req: mk('GET') });
  assert.equal(db.prepare('SELECT COUNT(*) AS n FROM activity_log').first().n, 0, '成功 GET 不应产生留档行');
  // 写操作与失败请求留档
  await logRequest(db, { method: 'POST', path: '/api/auth/login', status: 200, req: mk('POST'), durationMs: 55 });
  await logRequest(db, { method: 'GET', path: '/api/student/demands/999', status: 404, req: mk('GET') });
  const rows = db.prepare('SELECT action FROM activity_log ORDER BY id').all().results;
  assert.deepEqual(rows.map(r => r.action), ['http.POST.ok', 'http.GET.err']);
});

test('流量监测聚合：dbGetTrafficBuckets 按桶统计请求数与平均耗时', async () => {
  const raw = rawOf();
  const db = d1Shim(raw);
  await initDb(db, ENV);
  await dbRun(db, `INSERT INTO activity_log (ts, action, duration_ms) VALUES
    ('2026-08-07 07:10:00', 'http.GET.ok', 50),
    ('2026-08-07 07:30:00', 'http.POST.ok', 150),
    ('2026-08-07 08:05:00', 'http.GET.ok', 100),
    ('2026-08-07 07:20:00', 'auth.login.success', NULL)`); // 业务留档不计入
  const hourly = await dbGetTrafficBuckets(db, 'hour', '2026-08-07 07:00:00');
  const b07 = hourly.find(b => b.bucket === '2026-08-07 07:00');
  assert.equal(b07.requests, 2);
  assert.equal(b07.avg_ms, 100); // (50+150)/2，NULL duration 不影响
  const b08 = hourly.find(b => b.bucket === '2026-08-07 08:00');
  assert.equal(b08.requests, 1);
  assert.equal(b08.avg_ms, 100);
  const daily = await dbGetTrafficBuckets(db, 'day', '2026-08-07');
  assert.equal(daily[0].requests, 3);
});

test('登录限流：第 9 次超限 429（authRateBatch D1 计数）', async () => {
  const raw = rawOf();
  const db = d1Shim(raw);
  await initDb(db, ENV);
  const req = new Request('https://t.test', { method: 'POST', headers: { 'CF-Connecting-IP': '9.9.9.9' } });
  let last;
  for (let i = 0; i < 8; i++) last = await handleLogin(db, { username: 'admin_sufe', password: 'wrong' }, req);
  assert.equal(last.status, 401); // 前 8 次计数≤8 仍放行
  const ninth = await handleLogin(db, { username: 'admin_sufe', password: 'wrong' }, req);
  assert.equal(ninth.status, 429); // 第 9 次计数 9>8 → 超限
});

test('dbGetTeachers：广场列表一律裁剪私密字段，管理端全量可见（v0.22.8 数据最小化）', async () => {
  const raw = rawOf();
  const db = d1Shim(raw);
  await initDb(db, ENV);
  raw.prepare("INSERT INTO users (username,password_hash,salt,role) VALUES ('stu1','h','s','student'),('t1','h','s','teacher')").run();
  const stu = raw.prepare("SELECT id FROM users WHERE username='stu1'").get().id;
  const tea = raw.prepare("SELECT id FROM users WHERE username='t1'").get().id;
  await dbUpsertTeacherProfile(db, tea, { province: 'shanghai', grade: '', gender: '', subjects: ['数学'], gaokao_scores: [], price: 100, wechat: 'wx_test', email: 'e@t.com', intro: '', address: '', school: '', real_name: '实名甲', credential_image: 'data:image/png;base64,CRED123' });
  // 确认确实加密落库（裁剪后才有效验意义）
  const stored = raw.prepare('SELECT wechat FROM teacher_profiles WHERE user_id=?').get(tea);
  assert.ok(String(stored.wechat).startsWith('enc:v1:'), 'wechat 应加密落库');

  // 访客（无 viewerId）：私密字段全部裁剪为空
  const guestList = await dbGetTeachers(db, {});
  assert.equal(guestList[0].wechat, '', '访客视图 wechat 应裁剪');
  assert.equal(guestList[0].email, '', '访客视图 email 应裁剪');
  assert.equal(guestList[0].real_name, '', '访客视图 real_name 应裁剪');
  assert.equal(guestList[0].credential_image, '', '访客视图 credential_image 应裁剪');

  // 已双向匹配的登录学生（存在会话）：列表仍裁剪（私密字段只经 /api/teacher/profile 定点取回）
  raw.prepare('INSERT INTO conversations (student_user_id, teacher_user_id) VALUES (?,?)').run(stu, tea);
  const matchedList = await dbGetTeachers(db, { viewerId: stu });
  assert.equal(matchedList[0].wechat, '', '匹配视图列表 wechat 仍裁剪');
  assert.equal(matchedList[0].credential_image, '', '匹配视图列表 credential_image 仍裁剪');
  assert.equal(matchedList[0].matched, true, '匹配标记照常下发（前端门控显示用）');

  // 管理端：wechat/email 解密可见（管理端 SQL 本就不 SELECT real_name/credential_image，
  // 管理视图该两字段恒空——既有 admin 查询形态，非本裁剪引入；管理员核验凭证走独立入口）
  const adminList = await dbGetTeachers(db, { adminView: true });
  const row = adminList.find(t => t.user_id === tea);
  assert.equal(row.wechat, 'wx_test', '管理端应解密看到 wechat');
  assert.equal(row.email, 'e@t.com', '管理端应解密看到 email');
});

// B3（v0.25.103，用户反馈）：默认评分 4.0→4.5 后，存量「有评论」教师评分仍按旧默认加权——
// 迁移只回填无评论教师，有评论的未重算。本测试验证新迁移按新公式全量重算（幂等）。
test('B3 迁移：默认评分改 4.5 后，有评论教师评分按新公式重算（幂等）', async () => {
  const raw = rawOf();
  const db = d1Shim(raw);
  await initDb(db, ENV); // 新库建表 + 迁移
  // 播种 学生+教师，有评论教师给旧评分（rating 按旧默认 4.0 加权：(4.0*10+8.6)/(10+2)=4.2167）
  db.prepare("INSERT INTO users (username,password_hash,salt,role) VALUES ('stu1','h','s','student'),('t1','h','s','teacher')").run();
  db.prepare("INSERT INTO teacher_profiles (user_id,grade,rating,rating_count,rating_sum) VALUES (2,'高三',4.2167,2,8.6)").run();
  // v0.26.12：schema 版本化——重跑迁移前降版本（模拟旧库升级触发迁移）
  db.prepare(`INSERT OR REPLACE INTO schema_meta (k, v) VALUES ('schema', 0)`).run();
  // 重跑迁移 → 有评论教师按新公式 (4.5*10 + 8.6)/(10+2) 重算
  await initDb(db, ENV);
  const expect = (4.5 * 10 + 8.6) / 12;
  const r1 = db.prepare('SELECT rating FROM teacher_profiles WHERE user_id=2').first();
  assert.ok(Math.abs(r1.rating - expect) < 0.0001, `有评论教师重算 = ${expect.toFixed(4)}（实 ${r1.rating}）`);
  // 幂等：再跑一次结果不变
  await initDb(db, ENV);
  const r2 = db.prepare('SELECT rating FROM teacher_profiles WHERE user_id=2').first();
  assert.ok(Math.abs(r2.rating - expect) < 0.0001, '重复迁移结果不变（幂等）');
  // 无评论教师：仍按 4.5 回填（原 R16 行为不回归）
  db.prepare("INSERT INTO users (username,password_hash,salt,role) VALUES ('t2','h','s','teacher')").run();
  db.prepare("INSERT INTO teacher_profiles (user_id,grade,rating,rating_count,rating_sum) VALUES (3,'高一',4.0,0,0)").run();
  db.prepare(`INSERT OR REPLACE INTO schema_meta (k, v) VALUES ('schema', 0)`).run(); // v0.26.12：版本落后触发回填
  await initDb(db, ENV);
  const r3 = db.prepare('SELECT rating FROM teacher_profiles WHERE user_id=3').first();
  assert.equal(r3.rating, 4.5, '无评论教师回填 4.5（原行为保持）');
});

test('v1.5.0 K7：已有管理员不会被历史默认口令覆写（非默认新口令才轮换）', async () => {
  const raw = rawOf(); const db = d1Shim(raw);
  await initDb(db, { ADMIN_USERNAMES: ['admin_sufe'], ADMIN_DEFAULT_PASSWORD: 'first-strong-pw' });
  const before = raw.prepare("SELECT password_hash, salt FROM users WHERE username='admin_sufe'").get();
  db.prepare(`INSERT OR REPLACE INTO schema_meta (k, v) VALUES ('schema', 0)`).run();
  await initDb(db, { ADMIN_USERNAMES: ['admin_sufe'], ADMIN_DEFAULT_PASSWORD: 'admin_sufe' }); // 历史默认值：只首次种子化，不覆写
  const afterLegacy = raw.prepare("SELECT password_hash, salt FROM users WHERE username='admin_sufe'").get();
  assert.equal(afterLegacy.password_hash, before.password_hash, '默认口令不覆写已有管理员');
  db.prepare(`INSERT OR REPLACE INTO schema_meta (k, v) VALUES ('schema', 0)`).run();
  await initDb(db, { ADMIN_USERNAMES: ['admin_sufe'], ADMIN_DEFAULT_PASSWORD: 'second-strong-pw' }); // 新强口令：自动轮换
  const afterNew = raw.prepare("SELECT password_hash FROM users WHERE username='admin_sufe'").get();
  assert.notEqual(afterNew.password_hash, before.password_hash, '非默认新口令轮换生效');
});

test('v1.5.0 管理员账号迁移：改 ADMIN_USERNAMES 后旧 admin 自动降为 student', async () => {
  const raw = rawOf(); const db = d1Shim(raw);
  await initDb(db, { ADMIN_USERNAMES: ['admin_old'], ADMIN_DEFAULT_PASSWORD: 'old-admin-pw-123' });
  const oldId = raw.prepare("SELECT id FROM users WHERE username='admin_old'").get().id;
  db.prepare(`INSERT OR REPLACE INTO schema_meta (k, v) VALUES ('schema', 0)`).run();
  await initDb(db, { ADMIN_USERNAMES: ['admin_new'], ADMIN_DEFAULT_PASSWORD: 'new-admin-pw-456' });
  const old = raw.prepare("SELECT role FROM users WHERE id=?").get(oldId);
  assert.equal(old.role, 'student', '旧名单之外的历史 admin 已降级');
  const fresh = raw.prepare("SELECT role FROM users WHERE username='admin_new'").get();
  assert.equal(fresh.role, 'admin', '新名单账号为 admin');
});

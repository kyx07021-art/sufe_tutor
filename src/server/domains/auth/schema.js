/**
 * auth 域 schema（V-1-4b）：用户 / 会话 / 限流 / 邀请码 DDL、列迁移与全部 auth 域迁移。
 * 注意：migrateLegacyRoles 是一次性跨域遗留迁移（users role 扩展 admin + banned），
 * 为保「父先子后 + 引用闭包」整体性，历史上决定它连同其子表闭包一起放在 auth 域。
 */
import { dbAll, dbGet, dbRun } from '../../core/util.js';
import { hashPassword } from '../../core/crypto.js';
import { INITIAL_RATING, LEGACY_ADMIN_PASSWORD } from '../../../shared/config.js';
import { dbPurgeUserOwnedData } from './repo.js';

export const USERS_DDL = `CREATE TABLE IF NOT EXISTS users (
      id INTEGER PRIMARY KEY AUTOINCREMENT, username TEXT UNIQUE NOT NULL,
      password_hash TEXT NOT NULL, salt TEXT NOT NULL,
      role TEXT NOT NULL CHECK(role IN ('student','teacher','admin')),
      banned INTEGER NOT NULL DEFAULT 0,
      created_at DATETIME DEFAULT (datetime('now','localtime')))`;
export const AUTH_SESSIONS_DDL = `CREATE TABLE IF NOT EXISTS auth_sessions (
      token_hash TEXT PRIMARY KEY, user_id INTEGER NOT NULL,
      session_id TEXT NOT NULL DEFAULT '',
      label TEXT NOT NULL DEFAULT '',
      device_id TEXT NOT NULL DEFAULT '',
      created_at DATETIME DEFAULT (datetime('now','localtime')),
      expires_at DATETIME NOT NULL,
      FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE)`;
export const RATE_LIMITS_DDL = `CREATE TABLE IF NOT EXISTS rate_limits (
      bucket TEXT PRIMARY KEY,
      n INTEGER NOT NULL DEFAULT 0,
      reset_at DATETIME NOT NULL)`;
export const INVITE_CODES_DDL = `CREATE TABLE IF NOT EXISTS invite_codes (
      code TEXT PRIMARY KEY, created_by INTEGER NOT NULL,
      created_at DATETIME DEFAULT (datetime('now','localtime')),
      used_by INTEGER DEFAULT NULL,
      used_at DATETIME DEFAULT NULL,
      FOREIGN KEY (created_by) REFERENCES users(id),
      FOREIGN KEY (used_by) REFERENCES users(id))`;

export const createStatements = [USERS_DDL, AUTH_SESSIONS_DDL, RATE_LIMITS_DDL, INVITE_CODES_DDL];

export const ensureColumns = [
  { table: 'users', columns: [
    ['avatar', "TEXT DEFAULT ''"], ['deactivated', 'INTEGER NOT NULL DEFAULT 0'],
    ['phone', "TEXT DEFAULT ''"], ['phone_hash', "TEXT DEFAULT ''"],
    ['email', "TEXT DEFAULT ''"], ['email_hash', "TEXT DEFAULT ''"],
    ['username_changed_at', 'DATETIME'],
  ] },
  { table: 'auth_sessions', columns: [
    ['device_id', "TEXT NOT NULL DEFAULT ''"],
  ] },
];

// ============================================================
// postCreate：清理迁移残留 / 令牌摘要化 / 播种管理员
// ============================================================
async function cleanupLegacyLeftovers(db) {
  await db.batch([
    db.prepare('DROP TABLE IF EXISTS _demand_intents_old'),
    db.prepare('DROP TABLE IF EXISTS _invite_codes_old'),
    db.prepare('DROP TABLE IF EXISTS _reviews_old'),
    db.prepare('DROP TABLE IF EXISTS _student_demands_old'),
    db.prepare('DROP TABLE IF EXISTS _teacher_profiles_old'),
    db.prepare('DROP TABLE IF EXISTS _users_old'),
  ]);
}

async function migrateTokenHashes(db) {
  const authCols = await dbAll(db, 'PRAGMA table_info(auth_sessions)');
  if (authCols.some(c => c.name === 'token')) {
    await db.batch([
      db.prepare('DROP TABLE auth_sessions'),
      db.prepare(`CREATE TABLE auth_sessions (
        token_hash TEXT PRIMARY KEY, user_id INTEGER NOT NULL,
        session_id TEXT NOT NULL DEFAULT '',
        label TEXT NOT NULL DEFAULT '',
        device_id TEXT NOT NULL DEFAULT '',
        created_at DATETIME DEFAULT (datetime('now','localtime')),
        expires_at DATETIME NOT NULL,
        FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE)`),
    ]);
  }
}

async function seedAdmins(db, ctx) {
  for (const name of ctx.adminNames) {
    const existing = await dbGet(db, 'SELECT id, password_hash FROM users WHERE username = ?', [name]);
    if (!existing) {
      const { hash, salt } = await hashPassword(ctx.adminPassword);
      await dbRun(db, 'INSERT INTO users (username,password_hash,salt,role) VALUES (?,?,?,?)',
        [name, hash, salt, 'admin']);
    } else if (ctx.adminPassword && ctx.adminPassword !== LEGACY_ADMIN_PASSWORD) {
      // v1.5.0：已有 admin 只接受非历史默认口令轮换；历史默认口令一律不覆写（kill-list K7）
      const { hash, salt } = await hashPassword(ctx.adminPassword);
      if (hash !== existing.password_hash) {
        await dbRun(db, 'UPDATE users SET password_hash=?, salt=? WHERE id=?', [hash, salt, existing.id]);
      }
    }
  }
}

// ============================================================
// postEnsure：旧管理员彻底删除 / 索引 / 存量用户名消毒
// ============================================================
async function hardDeleteStaleAdmins(db, ctx) {
  if (!ctx.adminNames.length) return;
  const oldAdmins = await dbAll(db, 'SELECT id, username FROM users WHERE role=?', ['admin']);
  for (const a of oldAdmins) {
    if (ctx.adminNames.includes(a.username)) continue;
    // 先清显式引用（无 ON DELETE CASCADE 的列），再清用户自有数据，最后删用户本体——旧 admin 连根清除，绝不降级残留
    await dbRun(db, 'UPDATE teacher_verifications SET verified_by=NULL WHERE verified_by=?', [a.id]);
    await dbRun(db, 'DELETE FROM invite_codes WHERE created_by=? OR used_by=?', [a.id, a.id]);
    await dbRun(db, 'DELETE FROM danger_caps WHERE user_id=?', [a.id]);
    await dbPurgeUserOwnedData(db, a.id, 'admin');
    await dbRun(db, 'DELETE FROM users WHERE id=?', [a.id]);
  }
}

async function cleanLegacyAuthTokenColumns(db) {
  const userCols = (await dbAll(db, 'PRAGMA table_info(users)')).map(c => c.name);
  if (userCols.includes('auth_token')) {
    await dbRun(db, `UPDATE users SET auth_token='', token_expires='' WHERE auth_token != '' OR token_expires != ''`);
  }
}

async function sanitizeUsernames(db) {
  const dirtyUsers = await dbAll(db, `SELECT id, username FROM users WHERE username LIKE '%@%' OR CAST(username AS TEXT) GLOB '[0-9]*' AND CAST(username AS TEXT) NOT GLOB '*[^0-9]*'`);
  for (const r of dirtyUsers) {
    await dbRun(db, 'UPDATE users SET username=? WHERE id=?', [`${r.username}_sufe`, r.id]);
  }
  const dirtyNames = await dbAll(db, `SELECT id FROM users WHERE username GLOB '*[<>"'']*'`);
  for (const r of dirtyNames) {
    await dbRun(db, `UPDATE users SET username=? WHERE id=?`, [`用户#${r.id}#${Date.now()}`, r.id]);
  }
}

export async function migrate(db, ctx) {
  if (ctx.phase === 'preCreate') {
    await migrateLegacyRoles(db, ctx.adminNames);
    await rebuildTables(db, ctx.adminNames);
    return;
  }
  if (ctx.phase === 'postCreate') {
    await cleanupLegacyLeftovers(db);
    await migrateTokenHashes(db);
    await seedAdmins(db, ctx);
    return;
  }
  if (ctx.phase !== 'postEnsure') return;
  await hardDeleteStaleAdmins(db, ctx);
  await cleanLegacyAuthTokenColumns(db);
  await dbRun(db, `CREATE UNIQUE INDEX IF NOT EXISTS idx_auth_sessions_user_device
    ON auth_sessions(user_id, device_id) WHERE device_id != ''`);
  await dbRun(db, 'CREATE INDEX IF NOT EXISTS idx_users_role ON users(role, banned, deactivated)');
  try {
    await dbRun(db, "CREATE UNIQUE INDEX IF NOT EXISTS idx_users_phone_hash ON users(phone_hash) WHERE phone_hash != ''");
    await dbRun(db, "CREATE UNIQUE INDEX IF NOT EXISTS idx_users_email_hash ON users(email_hash) WHERE email_hash != ''");
  } catch { /* 存量重复绑定数据（理论不出现）：跳过索引，路由层兜底 */ }
  await sanitizeUsernames(db);
}


async function migrateLegacyRoles(db, adminNames) {
  const meta = await dbGet(db, "SELECT sql FROM sqlite_master WHERE type='table' AND name='users'");
  if (!meta || meta.sql.includes("'admin'")) return;

  // users 专属重建（角色 CHECK + banned 列；users 被全站 FK 引用，重建必须全表闭包——
  // 旧库该迁移本身重建全表使引用方 FK 一并重建，勿拆）。非 users 表重建见 rebuildTables。
  const exists = async t => !!(await dbGet(db, "SELECT 1 AS x FROM sqlite_master WHERE type='table' AND name=?", [t]));
  const oldColsOf = async t => (await dbAll(db, `PRAGMA table_info(${t})`)).map(c => c.name);
  const sharedCols = (old, fresh) => fresh.filter(c => old.includes(c));
  // 迁移目标（父先于子）：新表 DDL 与初始 batch 当前形状一致；cols 用于交集拷贝
  const T = [
    {
      t: 'users',
      cols: ['id', 'username', 'password_hash', 'salt', 'role', 'banned', 'created_at'],
      ddl: `CREATE TABLE users_new (
        id INTEGER PRIMARY KEY AUTOINCREMENT, username TEXT UNIQUE NOT NULL,
        password_hash TEXT NOT NULL, salt TEXT NOT NULL,
        role TEXT NOT NULL CHECK(role IN ('student','teacher','admin')),
        banned INTEGER NOT NULL DEFAULT 0,
        created_at DATETIME DEFAULT (datetime('now','localtime')))`,
    },
    {
      t: 'teacher_profiles',
      cols: ['id', 'user_id', 'grade', 'gender', 'subjects', 'gaokao_scores', 'price', 'wechat', 'email', 'school', 'real_name', 'credential_image', 'rating', 'rating_count', 'rating_sum', 'updated_at', 'chsi_school', 'chsi_level', 'chsi_major', 'chsi_status', 'chsi_enroll_year', 'chsi_verified'],
      ddl: `CREATE TABLE teacher_profiles_new (
        id INTEGER PRIMARY KEY AUTOINCREMENT, user_id INTEGER UNIQUE NOT NULL,
        grade TEXT, gender TEXT, subjects TEXT, gaokao_scores TEXT,
        price REAL DEFAULT 0, price_min REAL, price_max REAL, wechat TEXT, email TEXT,
        school TEXT DEFAULT '', real_name TEXT DEFAULT '', credential_image TEXT DEFAULT '',
        time_slots TEXT DEFAULT '', teaching_method TEXT DEFAULT '',
        personality_tags TEXT DEFAULT '', nonacademic_projects TEXT DEFAULT '', nonacademic_prices TEXT DEFAULT '',
        graduation_year INTEGER,
        chsi_school TEXT DEFAULT '', chsi_level TEXT DEFAULT '', chsi_major TEXT DEFAULT '',
        chsi_status TEXT DEFAULT '', chsi_enroll_year TEXT DEFAULT '', chsi_verified INTEGER NOT NULL DEFAULT 0,
        rating REAL DEFAULT ${INITIAL_RATING},
        rating_count INTEGER DEFAULT 0, rating_sum REAL DEFAULT 0,
        updated_at DATETIME DEFAULT (datetime('now','localtime')),
        FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE)`,
    },
    {
      t: 'student_demands',
      cols: ['id', 'user_id', 'student_grade', 'student_gender', 'target_subjects', 'current_scores', 'teaching_method', 'address', 'address_detail', 'expected_time', 'budget_min', 'budget_max', 'submitter_type', 'parent_contact', 'student_contact', 'additional_info', 'created_at'],
      ddl: `CREATE TABLE student_demands_new (
        id INTEGER PRIMARY KEY AUTOINCREMENT, user_id INTEGER NOT NULL,
        student_grade TEXT NOT NULL, student_gender TEXT NOT NULL,
        target_subjects TEXT NOT NULL, current_scores TEXT NOT NULL,
        teaching_method TEXT NOT NULL DEFAULT 'offline',
        address TEXT DEFAULT '', address_detail TEXT DEFAULT '',
        expected_time TEXT DEFAULT '',
        budget_min REAL DEFAULT 0, budget_max REAL DEFAULT 0,
        submitter_type TEXT NOT NULL, parent_contact TEXT NOT NULL,
        student_contact TEXT NOT NULL, additional_info TEXT DEFAULT '',
        target_type TEXT NOT NULL DEFAULT 'academic',
        preferred_personality_tags TEXT NOT NULL DEFAULT '[]',
        preferred_teacher_gender TEXT NOT NULL DEFAULT '',
        teaching_goal TEXT NOT NULL DEFAULT '[]',
        skill_notes TEXT NOT NULL DEFAULT '[]',
        created_at DATETIME DEFAULT (datetime('now','localtime')),
        FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE)`,
    },
    {
      t: 'reviews',
      cols: ['id', 'teacher_user_id', 'reviewer_user_id', 'rating', 'comment', 'status', 'created_at', 'reviewed_at', 'reviewed_by'],
      ddl: `CREATE TABLE reviews_new (
        id INTEGER PRIMARY KEY AUTOINCREMENT, teacher_user_id INTEGER NOT NULL,
        reviewer_user_id INTEGER NOT NULL, rating INTEGER NOT NULL CHECK(rating>=1 AND rating<=5),
        comment TEXT NOT NULL, status TEXT DEFAULT 'pending'
          CHECK(status IN ('pending','approved','rejected')),
        created_at DATETIME DEFAULT (datetime('now','localtime')),
        reviewed_at DATETIME, reviewed_by INTEGER,
        FOREIGN KEY (teacher_user_id) REFERENCES users(id) ON DELETE CASCADE,
        FOREIGN KEY (reviewer_user_id) REFERENCES users(id) ON DELETE CASCADE)`,
    },
    {
      t: 'invite_codes',
      cols: ['code', 'created_by', 'created_at', 'used_by', 'used_at'],
      ddl: `CREATE TABLE invite_codes_new (
        code TEXT PRIMARY KEY, created_by INTEGER NOT NULL,
        created_at DATETIME DEFAULT (datetime('now','localtime')),
        used_by INTEGER DEFAULT NULL,
        used_at DATETIME DEFAULT NULL,
        FOREIGN KEY (created_by) REFERENCES users(id),
        FOREIGN KEY (used_by) REFERENCES users(id))`,
    },
    {
      t: 'demand_intents',
      cols: ['id', 'demand_id', 'teacher_user_id', 'created_at'],
      ddl: `CREATE TABLE demand_intents_new (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        demand_id INTEGER NOT NULL, teacher_user_id INTEGER NOT NULL,
        created_at DATETIME DEFAULT (datetime('now','localtime')),
        UNIQUE(demand_id, teacher_user_id),
        FOREIGN KEY (demand_id) REFERENCES student_demands(id) ON DELETE CASCADE,
        FOREIGN KEY (teacher_user_id) REFERENCES users(id) ON DELETE CASCADE)`,
    },
    {
      // 教师学信网核验记录（验证码 + 核验结果；provider=manual 管理员核验，v1.5.0 起无 mock/thirdparty）
      t: 'teacher_verifications',
      cols: ['id', 'user_id', 'verify_code', 'status', 'school', 'level', 'major', 'enrollment_status', 'enroll_year', 'provider', 'verified_by', 'verified_at', 'created_at'],
      ddl: `CREATE TABLE teacher_verifications_new (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        user_id INTEGER NOT NULL UNIQUE, verify_code TEXT NOT NULL,
        status TEXT NOT NULL DEFAULT 'pending' CHECK(status IN ('pending','approved','rejected')),
        school TEXT DEFAULT '', level TEXT DEFAULT '', major TEXT DEFAULT '',
        enrollment_status TEXT DEFAULT '', enroll_year TEXT DEFAULT '',
        provider TEXT NOT NULL DEFAULT 'manual',
        verified_by INTEGER DEFAULT NULL, verified_at DATETIME DEFAULT NULL,
        created_at DATETIME DEFAULT (datetime('now','localtime')),
        FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE,
        FOREIGN KEY (verified_by) REFERENCES users(id))`,
    },
  ];
  const ready = [];
  for (const p of T) {
    if (!(await exists(p.t))) continue;
    const old = await oldColsOf(p.t);
    const cols = sharedCols(old, p.cols).join(',');
    ready.push({ ...p, cols });
  }
  if (!ready.length) return;
  const stmts = [];
  for (const p of ready) {
    stmts.push(db.prepare(`ALTER TABLE ${p.t} RENAME TO _${p.t}_old`));
    stmts.push(db.prepare(p.ddl));
    if (p.cols) stmts.push(db.prepare(`INSERT INTO ${p.t}_new (${p.cols}) SELECT ${p.cols} FROM _${p.t}_old`));
    if (p.t === 'users' && adminNames.length) {
      stmts.push(db.prepare(`UPDATE users_new SET role='admin' WHERE username IN (${adminNames.map(() => '?').join(',')})`).bind(...adminNames));
    }
    stmts.push(db.prepare(`ALTER TABLE ${p.t}_new RENAME TO ${p.t}`));
  }
  for (const p of [...ready].reverse()) stmts.push(db.prepare(`DROP TABLE _${p.t}_old`));
  await db.batch(stmts);
}

async function rebuildTables(db, adminNames) {
  const exists = async t => !!(await dbGet(db, "SELECT 1 AS x FROM sqlite_master WHERE type='table' AND name=?", [t]));
  const oldColsOf = async t => (await dbAll(db, `PRAGMA table_info(${t})`)).map(c => c.name);
  const sharedCols = (old, fresh) => fresh.filter(c => old.includes(c));

  // 迁移目标（父先于子）：新表 DDL 与初始 batch 当前形状一致；cols 用于交集拷贝。
  // 注意：仅保留「无被引用表」（invite_codes/reviews）——被 FK 引用的表（users/teacher_profiles/
  // student_demands 等）重建会把引用方 FK 改写为 _old 名且不改正（SQLite RENAME 语义），
  // 部分重建即 FK 悬空；其加列走 ensureColumns，删列类变更需先做引用闭包重建设计。
  const T = [
    {
      t: 'reviews',
      cols: ['id', 'teacher_user_id', 'reviewer_user_id', 'rating', 'comment', 'status', 'created_at', 'reviewed_at', 'reviewed_by'],
      ddl: `CREATE TABLE reviews_new (
        id INTEGER PRIMARY KEY AUTOINCREMENT, teacher_user_id INTEGER NOT NULL,
        reviewer_user_id INTEGER NOT NULL, rating INTEGER NOT NULL CHECK(rating>=1 AND rating<=5),
        comment TEXT NOT NULL, status TEXT DEFAULT 'pending'
          CHECK(status IN ('pending','approved','rejected')),
        created_at DATETIME DEFAULT (datetime('now','localtime')),
        reviewed_at DATETIME, reviewed_by INTEGER,
        FOREIGN KEY (teacher_user_id) REFERENCES users(id) ON DELETE CASCADE,
        FOREIGN KEY (reviewer_user_id) REFERENCES users(id) ON DELETE CASCADE)`,
    },
    {
      t: 'invite_codes',
      cols: ['code', 'created_by', 'created_at', 'used_by', 'used_at'],
      ddl: `CREATE TABLE invite_codes_new (
        code TEXT PRIMARY KEY, created_by INTEGER NOT NULL,
        created_at DATETIME DEFAULT (datetime('now','localtime')),
        used_by INTEGER DEFAULT NULL,
        used_at DATETIME DEFAULT NULL,
        FOREIGN KEY (created_by) REFERENCES users(id),
        FOREIGN KEY (used_by) REFERENCES users(id))`,
    },
  ];

  // 先查存在性 + 旧表列交集（PRAGMA 均在 batch 前执行）
  const ready = [];
  for (const p of T) {
    if (!(await exists(p.t))) continue;
    const old = await oldColsOf(p.t);
    // v1.2.0：结构一致（新旧列名集合相同）→ 跳过重建（幂等优化：全新库/无重建型变更零开销；
    // 重建只由「删列/改表形」类变更触发——列差异即信号，如 invite_codes 去 expires_at）
    if (old.length === p.cols.length && p.cols.every(c => old.includes(c))) continue;
    const cols = sharedCols(old, p.cols).join(',');
    ready.push({ ...p, cols });
  }
  if (!ready.length) return;

  const stmts = [];
  for (const p of ready) {
    stmts.push(db.prepare(`ALTER TABLE ${p.t} RENAME TO _${p.t}_old`));
    stmts.push(db.prepare(p.ddl));
    if (p.cols) stmts.push(db.prepare(`INSERT INTO ${p.t}_new (${p.cols}) SELECT ${p.cols} FROM _${p.t}_old`));
    if (p.t === 'users' && adminNames.length) {
      stmts.push(db.prepare(`UPDATE users_new SET role='admin' WHERE username IN (${adminNames.map(() => '?').join(',')})`).bind(...adminNames));
    }
    stmts.push(db.prepare(`ALTER TABLE ${p.t}_new RENAME TO ${p.t}`));
  }
  // ③ 清旧（先子后父：逆序删，父表最后）
  for (const p of [...ready].reverse()) stmts.push(db.prepare(`DROP TABLE _${p.t}_old`));

  await db.batch(stmts);
}

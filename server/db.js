/**
 * 数据访问层 — 全部 SQL 操作封装于此
 * 路由处理函数只调用这些函数，不直接写 SQL（initDb 除外）
 * 换数据库时只需重写本文件
 */
import {
  dbAll, dbGet, dbRun, hashPassword,
  ADMIN_USERNAMES, ADMIN_DEFAULT_PASSWORD, INITIAL_RATING,
} from './core.js';
import { initLogDb } from './log.js';

// ============================================================
// 数据库初始化 + 迁移
// ============================================================
export async function initDb(db) {
  await db.batch([
    db.prepare(`CREATE TABLE IF NOT EXISTS users (
      id INTEGER PRIMARY KEY AUTOINCREMENT, username TEXT UNIQUE NOT NULL,
      password_hash TEXT NOT NULL, salt TEXT NOT NULL,
      role TEXT NOT NULL CHECK(role IN ('student','teacher','admin')),
      banned INTEGER NOT NULL DEFAULT 0,
      created_at DATETIME DEFAULT (datetime('now','localtime')))`),
    db.prepare(`CREATE TABLE IF NOT EXISTS teacher_profiles (
      id INTEGER PRIMARY KEY AUTOINCREMENT, user_id INTEGER UNIQUE NOT NULL,
      grade TEXT, gender TEXT, subjects TEXT, gaokao_scores TEXT,
      price REAL DEFAULT 0, wechat TEXT, email TEXT,
      rating REAL DEFAULT ${INITIAL_RATING},
      rating_count INTEGER DEFAULT 0, rating_sum REAL DEFAULT 0,
      updated_at DATETIME DEFAULT (datetime('now','localtime')),
      FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE)`),
    db.prepare(`CREATE TABLE IF NOT EXISTS student_demands (
      id INTEGER PRIMARY KEY AUTOINCREMENT, user_id INTEGER NOT NULL,
      student_grade TEXT NOT NULL, student_gender TEXT NOT NULL,
      target_subjects TEXT NOT NULL, current_scores TEXT NOT NULL,
      teaching_method TEXT NOT NULL DEFAULT 'offline',
      address TEXT DEFAULT '', address_detail TEXT DEFAULT '',
      budget_min REAL DEFAULT 0, budget_max REAL DEFAULT 0,
      submitter_type TEXT NOT NULL, parent_contact TEXT NOT NULL,
      student_contact TEXT NOT NULL, additional_info TEXT DEFAULT '',
      created_at DATETIME DEFAULT (datetime('now','localtime')),
      FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE)`),
    db.prepare(`CREATE TABLE IF NOT EXISTS reviews (
      id INTEGER PRIMARY KEY AUTOINCREMENT, teacher_user_id INTEGER NOT NULL,
      reviewer_user_id INTEGER NOT NULL, rating INTEGER NOT NULL CHECK(rating>=1 AND rating<=5),
      comment TEXT NOT NULL, status TEXT DEFAULT 'pending'
        CHECK(status IN ('pending','approved','rejected')),
      created_at DATETIME DEFAULT (datetime('now','localtime')),
      reviewed_at DATETIME, reviewed_by INTEGER,
      FOREIGN KEY (teacher_user_id) REFERENCES users(id) ON DELETE CASCADE,
      FOREIGN KEY (reviewer_user_id) REFERENCES users(id) ON DELETE CASCADE)`),
    // 签约关系（预留：签约机制未上线前此表恒空，评价门槛经 dbIsContracted 查本表）
    db.prepare(`CREATE TABLE IF NOT EXISTS contracts (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      student_user_id INTEGER NOT NULL, teacher_user_id INTEGER NOT NULL,
      status TEXT NOT NULL DEFAULT 'active' CHECK(status IN ('active','ended')),
      created_at DATETIME DEFAULT (datetime('now','localtime')),
      UNIQUE(student_user_id, teacher_user_id),
      FOREIGN KEY (student_user_id) REFERENCES users(id) ON DELETE CASCADE,
      FOREIGN KEY (teacher_user_id) REFERENCES users(id) ON DELETE CASCADE)`),
    db.prepare(`CREATE TABLE IF NOT EXISTS invite_codes (
      code TEXT PRIMARY KEY, created_by INTEGER NOT NULL,
      created_at DATETIME DEFAULT (datetime('now','localtime')),
      expires_at DATETIME NOT NULL, used_by INTEGER DEFAULT NULL,
      used_at DATETIME DEFAULT NULL,
      FOREIGN KEY (created_by) REFERENCES users(id),
      FOREIGN KEY (used_by) REFERENCES users(id))`),
    db.prepare(`CREATE TABLE IF NOT EXISTS demand_intents (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      demand_id INTEGER NOT NULL, teacher_user_id INTEGER NOT NULL,
      created_at DATETIME DEFAULT (datetime('now','localtime')),
      UNIQUE(demand_id, teacher_user_id),
      FOREIGN KEY (demand_id) REFERENCES student_demands(id) ON DELETE CASCADE,
      FOREIGN KEY (teacher_user_id) REFERENCES users(id) ON DELETE CASCADE)`),
    // 模块3：意向状态列经 ensureColumns 幂等补齐（旧表不能重建）
    // 模块4：会话与消息（意向同意后建立；kind 预留 image/file）
    db.prepare(`CREATE TABLE IF NOT EXISTS conversations (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      student_user_id INTEGER NOT NULL, teacher_user_id INTEGER NOT NULL,
      demand_id INTEGER, status TEXT NOT NULL DEFAULT 'active' CHECK(status IN ('active','closed')),
      created_at DATETIME DEFAULT (datetime('now','localtime')),
      UNIQUE(student_user_id, teacher_user_id),
      FOREIGN KEY (student_user_id) REFERENCES users(id) ON DELETE CASCADE,
      FOREIGN KEY (teacher_user_id) REFERENCES users(id) ON DELETE CASCADE,
      FOREIGN KEY (demand_id) REFERENCES student_demands(id) ON DELETE SET NULL)`),
    db.prepare(`CREATE TABLE IF NOT EXISTS messages (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      conversation_id INTEGER NOT NULL, sender_user_id INTEGER NOT NULL,
      kind TEXT NOT NULL DEFAULT 'text' CHECK(kind IN ('text','image','file')),
      body TEXT NOT NULL DEFAULT '',
      created_at DATETIME DEFAULT (datetime('now','localtime')),
      FOREIGN KEY (conversation_id) REFERENCES conversations(id) ON DELETE CASCADE,
      FOREIGN KEY (sender_user_id) REFERENCES users(id) ON DELETE CASCADE)`),
    db.prepare('CREATE INDEX IF NOT EXISTS idx_messages_conv ON messages(conversation_id, id)'),
    // 模块2：资料共享帖子（section 预留分区，当前恒 'plaza'）
    db.prepare(`CREATE TABLE IF NOT EXISTS posts (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      user_id INTEGER NOT NULL, section TEXT NOT NULL DEFAULT 'plaza',
      title TEXT NOT NULL, body_md TEXT NOT NULL DEFAULT '',
      like_count INTEGER NOT NULL DEFAULT 0,
      created_at DATETIME DEFAULT (datetime('now','localtime')),
      updated_at DATETIME,
      FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE)`),
    db.prepare(`CREATE TABLE IF NOT EXISTS post_likes (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      post_id INTEGER NOT NULL, user_id INTEGER NOT NULL,
      created_at DATETIME DEFAULT (datetime('now','localtime')),
      UNIQUE(post_id, user_id),
      FOREIGN KEY (post_id) REFERENCES posts(id) ON DELETE CASCADE,
      FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE)`),
  ]);

  // 一人一评唯一索引（幂等）；旧数据若有重复对则建不上，回落路由层成对检查，不阻塞启动
  try {
    await dbRun(db, 'CREATE UNIQUE INDEX IF NOT EXISTS idx_reviews_reviewer_teacher ON reviews(reviewer_user_id, teacher_user_id)');
  } catch { /* 旧重复数据：跳过索引 */ }

  // 一次性迁移：users 的 role 扩展支持 admin + 新增 banned 列。
  // D1 强制开启外键且不可关闭，DROP 被引用表会失败，故用"改名腾位"策略，
  // 每一步都单独满足外键约束（生产环境的原子 batch 可一次完成，本地逐句执行也安全）：
  //   ① 旧表整体改名为 _*_old（SQLite 自动同步改写旧表间的 FK 引用）
  //   ② 按"父先于子"建新表并改名回终名，数据从 _*_old 全量拷贝
  //   ③ 先子后父删 _*_old
  // 幂等守卫：检查 sqlite_master 里 users 表定义是否已含 'admin'。
  const meta = await dbGet(db, "SELECT sql FROM sqlite_master WHERE type='table' AND name='users'");
  if (meta && !meta.sql.includes("'admin'")) {
    await db.batch([
      // ① 腾位
      db.prepare('ALTER TABLE users RENAME TO _users_old'),
      db.prepare('ALTER TABLE teacher_profiles RENAME TO _teacher_profiles_old'),
      db.prepare('ALTER TABLE student_demands RENAME TO _student_demands_old'),
      db.prepare('ALTER TABLE reviews RENAME TO _reviews_old'),
      db.prepare('ALTER TABLE invite_codes RENAME TO _invite_codes_old'),
      db.prepare('ALTER TABLE demand_intents RENAME TO _demand_intents_old'),

      // ② 新 users：建 → 拷贝 → 管理员升级 → 改回终名（此后子表 FK 即可引用 users）
      db.prepare(`CREATE TABLE users_new (
        id INTEGER PRIMARY KEY AUTOINCREMENT, username TEXT UNIQUE NOT NULL,
        password_hash TEXT NOT NULL, salt TEXT NOT NULL,
        role TEXT NOT NULL CHECK(role IN ('student','teacher','admin')),
        banned INTEGER NOT NULL DEFAULT 0,
        created_at DATETIME DEFAULT (datetime('now','localtime')))`),
      db.prepare(`INSERT INTO users_new (id,username,password_hash,salt,role,banned,created_at)
        SELECT id,username,password_hash,salt,role,0,created_at FROM _users_old`),
      db.prepare(`UPDATE users_new SET role='admin' WHERE username IN (${ADMIN_USERNAMES.map(() => '?').join(',')})`).bind(...ADMIN_USERNAMES),
      db.prepare('ALTER TABLE users_new RENAME TO users'),

      db.prepare(`CREATE TABLE teacher_profiles_new (
        id INTEGER PRIMARY KEY AUTOINCREMENT, user_id INTEGER UNIQUE NOT NULL,
        grade TEXT, gender TEXT, subjects TEXT, gaokao_scores TEXT,
        price REAL DEFAULT 0, wechat TEXT, email TEXT,
        rating REAL DEFAULT ${INITIAL_RATING},
        rating_count INTEGER DEFAULT 0, rating_sum REAL DEFAULT 0,
        updated_at DATETIME DEFAULT (datetime('now','localtime')),
        FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE)`),
      db.prepare(`INSERT INTO teacher_profiles_new SELECT * FROM _teacher_profiles_old`),
      db.prepare('ALTER TABLE teacher_profiles_new RENAME TO teacher_profiles'),

      db.prepare(`CREATE TABLE student_demands_new (
        id INTEGER PRIMARY KEY AUTOINCREMENT, user_id INTEGER NOT NULL,
        student_grade TEXT NOT NULL, student_gender TEXT NOT NULL,
        target_subjects TEXT NOT NULL, current_scores TEXT NOT NULL,
        teaching_method TEXT NOT NULL DEFAULT 'offline',
        address TEXT DEFAULT '', address_detail TEXT DEFAULT '',
        budget_min REAL DEFAULT 0, budget_max REAL DEFAULT 0,
        submitter_type TEXT NOT NULL, parent_contact TEXT NOT NULL,
        student_contact TEXT NOT NULL, additional_info TEXT DEFAULT '',
        created_at DATETIME DEFAULT (datetime('now','localtime')),
        FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE)`),
      db.prepare(`INSERT INTO student_demands_new SELECT * FROM _student_demands_old`),
      db.prepare('ALTER TABLE student_demands_new RENAME TO student_demands'),

      db.prepare(`CREATE TABLE reviews_new (
        id INTEGER PRIMARY KEY AUTOINCREMENT, teacher_user_id INTEGER NOT NULL,
        reviewer_user_id INTEGER NOT NULL, rating INTEGER NOT NULL CHECK(rating>=1 AND rating<=5),
        comment TEXT NOT NULL, status TEXT DEFAULT 'pending'
          CHECK(status IN ('pending','approved','rejected')),
        created_at DATETIME DEFAULT (datetime('now','localtime')),
        reviewed_at DATETIME, reviewed_by INTEGER,
        FOREIGN KEY (teacher_user_id) REFERENCES users(id) ON DELETE CASCADE,
        FOREIGN KEY (reviewer_user_id) REFERENCES users(id) ON DELETE CASCADE)`),
      db.prepare(`INSERT INTO reviews_new SELECT * FROM _reviews_old`),
      db.prepare('ALTER TABLE reviews_new RENAME TO reviews'),

      db.prepare(`CREATE TABLE invite_codes_new (
        code TEXT PRIMARY KEY, created_by INTEGER NOT NULL,
        created_at DATETIME DEFAULT (datetime('now','localtime')),
        expires_at DATETIME NOT NULL, used_by INTEGER DEFAULT NULL,
        used_at DATETIME DEFAULT NULL,
        FOREIGN KEY (created_by) REFERENCES users(id),
        FOREIGN KEY (used_by) REFERENCES users(id))`),
      db.prepare(`INSERT INTO invite_codes_new SELECT * FROM _invite_codes_old`),
      db.prepare('ALTER TABLE invite_codes_new RENAME TO invite_codes'),

      db.prepare(`CREATE TABLE demand_intents_new (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        demand_id INTEGER NOT NULL, teacher_user_id INTEGER NOT NULL,
        created_at DATETIME DEFAULT (datetime('now','localtime')),
        UNIQUE(demand_id, teacher_user_id),
        FOREIGN KEY (demand_id) REFERENCES student_demands(id) ON DELETE CASCADE,
        FOREIGN KEY (teacher_user_id) REFERENCES users(id) ON DELETE CASCADE)`),
      db.prepare(`INSERT INTO demand_intents_new SELECT * FROM _demand_intents_old`),
      db.prepare('ALTER TABLE demand_intents_new RENAME TO demand_intents'),

      // ③ 清旧（先子后父；_*_old 已无任何表引用）
      db.prepare('DROP TABLE _demand_intents_old'),
      db.prepare('DROP TABLE _invite_codes_old'),
      db.prepare('DROP TABLE _reviews_old'),
      db.prepare('DROP TABLE _student_demands_old'),
      db.prepare('DROP TABLE _teacher_profiles_old'),
      db.prepare('DROP TABLE _users_old'),
    ]);
  }
  // 迁移残留清理（IF EXISTS 恒安全；兜底任何半途状态遗留下的 _*_old）
  await db.batch([
    db.prepare('DROP TABLE IF EXISTS _demand_intents_old'),
    db.prepare('DROP TABLE IF EXISTS _invite_codes_old'),
    db.prepare('DROP TABLE IF EXISTS _reviews_old'),
    db.prepare('DROP TABLE IF EXISTS _student_demands_old'),
    db.prepare('DROP TABLE IF EXISTS _teacher_profiles_old'),
    db.prepare('DROP TABLE IF EXISTS _users_old'),
  ]);

  // 种子管理员（独立 admin 角色）
  for (const name of ADMIN_USERNAMES) {
    const existing = await dbGet(db, 'SELECT id FROM users WHERE username = ?', [name]);
    if (!existing) {
      const { hash, salt } = await hashPassword(ADMIN_DEFAULT_PASSWORD);
      await dbRun(db, 'INSERT INTO users (username,password_hash,salt,role) VALUES (?,?,?,?)',
        [name, hash, salt, 'admin']);
    }
  }

  // 留档表（模块5；绑定独立 LOG_DB 时此表建在业务库亦无害，查询走 getLogDb 路由）
  await initLogDb(db);

  // 幂等加列（模块1：地区档案；模块3：意向状态机）
  await ensureColumns(db, 'teacher_profiles', [['province', "TEXT DEFAULT ''"]]);
  await ensureColumns(db, 'student_demands', [['province', "TEXT DEFAULT ''"]]);
  await ensureColumns(db, 'demand_intents', [
    ['status', "TEXT NOT NULL DEFAULT 'pending' CHECK(status IN ('pending','accepted','rejected'))"],
    ['resolved_at', 'DATETIME'],
  ]);
  // 会话已读游标（红点未读用：双方各自一个，指向自己已读到的最大消息 id）
  await ensureColumns(db, 'conversations', [
    ['student_last_read_id', 'INTEGER NOT NULL DEFAULT 0'],
    ['teacher_last_read_id', 'INTEGER NOT NULL DEFAULT 0'],
  ]);
}

// 幂等加列迁移：PRAGMA 探测后再 ALTER（D1 无 ADD COLUMN IF NOT EXISTS）
async function ensureColumns(db, table, cols) {
  const info = await dbAll(db, `PRAGMA table_info(${table})`);
  const have = new Set(info.map(c => c.name));
  for (const [name, ddl] of cols) {
    if (!have.has(name)) await dbRun(db, `ALTER TABLE ${table} ADD COLUMN ${name} ${ddl}`);
  }
}

// ============================================================
// 用户
// ============================================================
export async function dbFindUserByUsername(db, username) {
  return await dbGet(db, 'SELECT * FROM users WHERE username=?', [username]);
}

export async function dbFindUserById(db, id) {
  return await dbGet(db, 'SELECT id,role FROM users WHERE id=?', [id]);
}

export async function dbCreateUser(db, username, hash, salt, role) {
  const result = await dbRun(db,
    'INSERT INTO users (username,password_hash,salt,role) VALUES (?,?,?,?)',
    [username, hash, salt, role]);
  return Number(result.meta.last_row_id);
}

// ============================================================
// 邀请码
// ============================================================
export async function dbFindValidInviteCode(db, code) {
  return await dbGet(db,
    "SELECT * FROM invite_codes WHERE code=? AND used_by IS NULL AND expires_at > datetime('now','localtime')",
    [code]);
}

export async function dbUseInviteCode(db, code, userId) {
  await dbRun(db,
    "UPDATE invite_codes SET used_by=?, used_at=datetime('now','localtime') WHERE code=?",
    [userId, code]);
}

export async function dbCreateInviteCode(db, code, adminId, expiresAt) {
  await dbRun(db,
    'INSERT INTO invite_codes (code,created_by,expires_at) VALUES (?,?,?)',
    [code, adminId, expiresAt]);
}

export async function dbGetAllInvites(db) {
  return await dbAll(db, `SELECT ic.*, u1.username as creator_name, u2.username as used_by_name
    FROM invite_codes ic LEFT JOIN users u1 ON ic.created_by=u1.id
    LEFT JOIN users u2 ON ic.used_by=u2.id ORDER BY ic.created_at DESC`);
}

// ============================================================
// 教师档案
// ============================================================
export async function dbGetTeacherProfile(db, userId) {
  const profile = await dbGet(db, 'SELECT * FROM teacher_profiles WHERE user_id=?', [userId]);
  if (profile) {
    profile.subjects = profile.subjects ? JSON.parse(profile.subjects) : [];
    profile.gaokao_scores = profile.gaokao_scores ? JSON.parse(profile.gaokao_scores) : [];
  }
  return profile;
}

export async function dbUpsertTeacherProfile(db, userId, profile) {
  const existing = await dbGet(db, 'SELECT id FROM teacher_profiles WHERE user_id=?', [userId]);
  const subjects = JSON.stringify(profile.subjects);
  const gaokao = JSON.stringify(profile.gaokao_scores);

  if (existing) {
    await dbRun(db, `UPDATE teacher_profiles SET province=?,grade=?,gender=?,subjects=?,gaokao_scores=?,
      price=?,wechat=?,email=?,updated_at=datetime('now','localtime') WHERE user_id=?`,
      [profile.province || '', profile.grade, profile.gender, subjects, gaokao, profile.price||0, profile.wechat, profile.email, userId]);
  } else {
    await dbRun(db, `INSERT INTO teacher_profiles (user_id,province,grade,gender,subjects,gaokao_scores,price,wechat,email)
      VALUES (?,?,?,?,?,?,?,?,?)`,
      [userId, profile.province || '', profile.grade, profile.gender, subjects, gaokao, profile.price||0, profile.wechat, profile.email]);
  }
}

// 教师行映射器：教师列表与需求意向教师列表共用，保证两处返回形状一致
export function mapTeacherProfileRow(p) {
  return {
    id: p.id, user_id: p.user_id, username: p.username,
    province: p.province || '', grade: p.grade, gender: p.gender,
    subjects: p.subjects ? JSON.parse(p.subjects) : [],
    gaokao_scores: p.gaokao_scores ? JSON.parse(p.gaokao_scores) : [],
    price: p.price || 0, wechat: p.wechat, email: p.email,
    rating: p.rating, rating_count: p.rating_count, updatedAt: p.updated_at,
  };
}

export async function dbGetAllTeachers(db) {
  const profiles = await dbAll(db, `SELECT tp.*, u.username
    FROM teacher_profiles tp JOIN users u ON tp.user_id=u.id ORDER BY tp.updated_at DESC`);
  return profiles.map(mapTeacherProfileRow);
}

export async function dbUpdateTeacherRating(db, teacherUserId, rating, count, sum) {
  await dbRun(db,
    'UPDATE teacher_profiles SET rating=?, rating_count=?, rating_sum=? WHERE user_id=?',
    [rating, count, sum, teacherUserId]);
}

// ============================================================
// 学生需求
// ============================================================
export async function dbCreateDemand(db, userId, demand) {
  // address_detail（详细门牌号）已因合规原因停用：不再收集、不再写入，列保留但恒为空
  const result = await dbRun(db, `INSERT INTO student_demands
    (user_id,province,student_grade,student_gender,target_subjects,current_scores,
     teaching_method,address,budget_min,budget_max,
     submitter_type,parent_contact,student_contact,additional_info)
    VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?)`, [
    userId, demand.province || '', demand.student_grade, demand.student_gender,
    JSON.stringify(demand.target_subjects), JSON.stringify(demand.current_scores),
    demand.teaching_method || 'offline', demand.address || '',
    demand.budget_min || 0, demand.budget_max || 0,
    demand.submitter_type, demand.parent_contact, demand.student_contact, demand.additional_info || '',
  ]);
  return Number(result.meta.last_row_id);
}

// 需求列表统一查询：JOIN 用户名 + LEFT JOIN 聚合出意向计数（向后兼容的附加字段）
export const DEMANDS_SELECT = `SELECT sd.*, u.username, COALESCE(ic.cnt, 0) AS intent_count
  FROM student_demands sd JOIN users u ON sd.user_id=u.id
  LEFT JOIN (SELECT demand_id, COUNT(*) AS cnt FROM demand_intents GROUP BY demand_id) ic
    ON ic.demand_id=sd.id`;

export function mapDemandRow(r) {
  const { address_detail, ...rest } = r; // 合规：该字段不再向前端暴露
  return {
    ...rest,
    target_subjects: JSON.parse(r.target_subjects || '[]'),
    current_scores: JSON.parse(r.current_scores || '[]'),
  };
}

export async function dbGetAllDemands(db, teacherUserId = null) {
  // 传 teacherUserId 时追加该教师在各需求上的意向状态（my_intent_status），供前端按钮三态渲染
  let sel = DEMANDS_SELECT, extra = '', params = [];
  if (teacherUserId) {
    sel = DEMANDS_SELECT.replace('COALESCE(ic.cnt, 0) AS intent_count',
      'COALESCE(ic.cnt, 0) AS intent_count, mi.status AS my_intent_status');
    extra = ' LEFT JOIN demand_intents mi ON mi.demand_id=sd.id AND mi.teacher_user_id=?';
    params = [teacherUserId];
  }
  const rows = await dbAll(db, sel + extra + ' ORDER BY sd.created_at DESC', params);
  return rows.map(mapDemandRow);
}

export async function dbGetDemandsByUser(db, userId) {
  const rows = await dbAll(db, DEMANDS_SELECT + ' WHERE sd.user_id=? ORDER BY sd.created_at DESC', [userId]);
  return rows.map(mapDemandRow);
}

export async function dbGetDemandById(db, id) {
  return await dbGet(db, 'SELECT * FROM student_demands WHERE id=?', [id]);
}

export async function dbUpdateDemand(db, id, d) {
  await dbRun(db, `UPDATE student_demands SET province=?,student_grade=?,student_gender=?,
    target_subjects=?,current_scores=?,teaching_method=?,address=?,address_detail='',
    budget_min=?,budget_max=?,submitter_type=?,parent_contact=?,student_contact=?,
    additional_info=? WHERE id=?`, [
    d.province || '', d.student_grade, d.student_gender,
    JSON.stringify(d.target_subjects), JSON.stringify(d.current_scores),
    d.teaching_method || 'offline', d.address || '',
    d.budget_min || 0, d.budget_max || 0,
    d.submitter_type, d.parent_contact, d.student_contact, d.additional_info || '', id,
  ]);
}

export async function dbDeleteDemand(db, id) {
  await dbRun(db, 'DELETE FROM demand_intents WHERE demand_id=?', [id]);
  await dbRun(db, 'DELETE FROM student_demands WHERE id=?', [id]);
}

// ============================================================
// 意向
// ============================================================
export async function dbCreateIntent(db, demandId, teacherUserId) {
  const result = await dbRun(db,
    'INSERT INTO demand_intents (demand_id, teacher_user_id) VALUES (?,?)',
    [demandId, teacherUserId]);
  return Number(result.meta.last_row_id);
}

export async function dbGetIntentTeachers(db, demandId) {
  const rows = await dbAll(db, `SELECT tp.*, di.teacher_user_id AS user_id, u.username,
      di.id AS intent_id, di.status AS intent_status, di.created_at AS intent_created_at
    FROM demand_intents di
    JOIN users u ON u.id=di.teacher_user_id
    LEFT JOIN teacher_profiles tp ON tp.user_id=di.teacher_user_id
    WHERE di.demand_id=? ORDER BY di.created_at DESC`, [demandId]);
  // 附加意向自身字段（id/状态/时间），供学生端同意/拒绝按钮使用
  return rows.map(r => ({ ...mapTeacherProfileRow(r),
    intent_id: r.intent_id, intent_status: r.intent_status, intent_created_at: r.intent_created_at }));
}

export async function dbGetIntentWithDemand(db, intentId) {
  return await dbGet(db, `SELECT di.*, sd.user_id AS demand_owner
    FROM demand_intents di JOIN student_demands sd ON sd.id=di.demand_id
    WHERE di.id=?`, [intentId]);
}

export async function dbResolveIntent(db, intentId, status) {
  await dbRun(db,
    "UPDATE demand_intents SET status=?, resolved_at=datetime('now','localtime') WHERE id=?",
    [status, intentId]);
}

// 学生视角：自己所有需求上收到的意向（含状态与教师名）
export async function dbGetIntentsForStudent(db, userId) {
  return await dbAll(db, `SELECT di.id, di.demand_id, di.status, di.created_at,
      di.teacher_user_id, u.username AS teacher_name
    FROM demand_intents di
    JOIN student_demands sd ON sd.id=di.demand_id
    JOIN users u ON u.id=di.teacher_user_id
    WHERE sd.user_id=? ORDER BY di.created_at DESC`, [userId]);
}

// ============================================================
// 评价
// ============================================================
export async function dbCreateReview(db, teacherUserId, reviewerUserId, rating, comment) {
  const result = await dbRun(db,
    'INSERT INTO reviews (teacher_user_id,reviewer_user_id,rating,comment) VALUES (?,?,?,?)',
    [teacherUserId, reviewerUserId, rating, comment]);
  return Number(result.meta.last_row_id);
}

export async function dbGetApprovedReviews(db, teacherUserId) {
  return await dbAll(db, `SELECT r.*, u.username as reviewer_name
    FROM reviews r JOIN users u ON r.reviewer_user_id=u.id
    WHERE r.teacher_user_id=? AND r.status='approved' ORDER BY r.created_at DESC`,
    [teacherUserId]);
}

// 某学生对某教师的自有评价（任意状态；「已有评价只能修改」与编辑回填用）
export async function dbGetReviewByPair(db, reviewerUserId, teacherUserId) {
  return await dbGet(db, 'SELECT * FROM reviews WHERE reviewer_user_id=? AND teacher_user_id=?',
    [reviewerUserId, teacherUserId]);
}

// 修改评价：重置为待审核（内容变更须重审）
export async function dbUpdateReview(db, reviewId, rating, comment) {
  await dbRun(db,
    'UPDATE reviews SET rating=?, comment=?, status=\'pending\', reviewed_at=NULL, reviewed_by=NULL WHERE id=?',
    [rating, comment, reviewId]);
}

// 签约门槛查询（预留接口）：签约机制上线前 contracts 恒空 → 一律不可评价，
// 上线后只需往本表写数据，评价门禁自动生效
export async function dbIsContracted(db, studentUserId, teacherUserId) {
  return !!(await dbGet(db,
    "SELECT 1 FROM contracts WHERE student_user_id=? AND teacher_user_id=? AND status='active'",
    [studentUserId, teacherUserId]));
}

// 管理端评价查询：可按状态 / 教师过滤（评价管理页与教师详情内评价栏共用）
export async function dbGetReviewsAdmin(db, { status, teacherUserId } = {}) {
  let sql = `SELECT r.*, u1.username as reviewer_name, u2.username as teacher_name
    FROM reviews r JOIN users u1 ON r.reviewer_user_id=u1.id JOIN users u2 ON r.teacher_user_id=u2.id`;
  const cond = [], params = [];
  if (status) { cond.push('r.status=?'); params.push(status); }
  if (teacherUserId) { cond.push('r.teacher_user_id=?'); params.push(teacherUserId); }
  if (cond.length) sql += ' WHERE ' + cond.join(' AND ');
  return await dbAll(db, sql + ' ORDER BY r.created_at DESC', params);
}

export async function dbDeleteReview(db, reviewId) {
  await dbRun(db, 'DELETE FROM reviews WHERE id=?', [reviewId]);
}

export async function dbUpdateReviewStatus(db, reviewId, status) {
  await dbRun(db,
    "UPDATE reviews SET status=?, reviewed_at=datetime('now','localtime') WHERE id=?",
    [status, reviewId]);
}

export async function dbGetReviewById(db, reviewId) {
  return await dbGet(db, 'SELECT * FROM reviews WHERE id=?', [reviewId]);
}

export async function dbGetApprovedReviewStats(db, teacherUserId) {
  return await dbGet(db, `SELECT COUNT(*) as cnt, COALESCE(SUM(rating),0) as total
    FROM reviews WHERE teacher_user_id=? AND status='approved'`, [teacherUserId]);
}

// ============================================================
// 管理员统计
// ============================================================
export async function dbGetUserStats(db) {
  return await dbGet(db, `SELECT COUNT(*) as total,
    SUM(CASE WHEN role='student' THEN 1 ELSE 0 END) as students,
    SUM(CASE WHEN role='teacher' THEN 1 ELSE 0 END) as teachers FROM users`);
}

export async function dbGetCount(db, table) {
  const row = await dbGet(db, `SELECT COUNT(*) as cnt FROM ${table}`);
  return row?.cnt || 0;
}

export async function dbGetReviewStats(db) {
  return await dbGet(db, `SELECT COUNT(*) as total,
    SUM(CASE WHEN status='approved' THEN 1 ELSE 0 END) as approved,
    SUM(CASE WHEN status='pending' THEN 1 ELSE 0 END) as pending,
    SUM(CASE WHEN status='rejected' THEN 1 ELSE 0 END) as rejected FROM reviews`);
}

export async function dbGetInviteStats(db) {
  return await dbGet(db, `SELECT COUNT(*) as total,
    SUM(CASE WHEN used_by IS NOT NULL THEN 1 ELSE 0 END) as used,
    SUM(CASE WHEN used_by IS NULL AND expires_at>datetime('now','localtime') THEN 1 ELSE 0 END) as active
    FROM invite_codes`);
}

export async function dbGetRecentUsers(db, limit = 8) {
  return await dbAll(db, 'SELECT id,username,role,created_at FROM users ORDER BY created_at DESC LIMIT ?', [limit]);
}

export async function dbGetRecentDemands(db, limit = 8) {
  const rows = await dbAll(db, `SELECT sd.id,sd.student_grade,sd.target_subjects,sd.created_at,u.username
    FROM student_demands sd JOIN users u ON sd.user_id=u.id ORDER BY sd.created_at DESC LIMIT ?`, [limit]);
  return rows.map(d => ({ ...d, target_subjects: JSON.parse(d.target_subjects || '[]') }));
}

// ============================================================
// 会话与消息（模块4）
// ============================================================

// 同一师生对唯一会话（UNIQUE(student,teacher)）；已存在则返回既有 id
export async function dbUpsertConversation(db, studentUserId, teacherUserId, demandId) {
  await dbRun(db,
    'INSERT OR IGNORE INTO conversations (student_user_id, teacher_user_id, demand_id) VALUES (?,?,?)',
    [studentUserId, teacherUserId, demandId || null]);
  const row = await dbGet(db,
    'SELECT id FROM conversations WHERE student_user_id=? AND teacher_user_id=?',
    [studentUserId, teacherUserId]);
  return row?.id || null;
}

export async function dbGetConversationById(db, id) {
  return await dbGet(db, 'SELECT * FROM conversations WHERE id=?', [id]);
}

// 我参与的会话列表（含对方用户名 + 最后一条消息预览）
export async function dbGetMyConversations(db, userId) {
  // unread_count：对方发的、id 大于「我这一侧已读游标」的消息数（游标按我在会话中的角色取列）
  return await dbAll(db, `SELECT c.*,
      us.username AS student_name, ut.username AS teacher_name,
      lm.body AS last_body, lm.kind AS last_kind, lm.created_at AS last_at, lm.sender_user_id AS last_sender,
      (SELECT COUNT(*) FROM messages m WHERE m.conversation_id=c.id AND m.sender_user_id<>?
        AND m.id > (CASE WHEN c.student_user_id=? THEN c.student_last_read_id ELSE c.teacher_last_read_id END)
      ) AS unread_count
    FROM conversations c
    JOIN users us ON us.id=c.student_user_id
    JOIN users ut ON ut.id=c.teacher_user_id
    LEFT JOIN (
      SELECT m.conversation_id, m.body, m.kind, m.created_at, m.sender_user_id
      FROM messages m JOIN (SELECT conversation_id, MAX(id) AS mid FROM messages GROUP BY conversation_id) x
        ON x.mid=m.id
    ) lm ON lm.conversation_id=c.id
    WHERE c.student_user_id=? OR c.teacher_user_id=?
    ORDER BY COALESCE(lm.created_at, c.created_at) DESC`, [userId, userId, userId, userId]);
}

// 标记已读：把我在该会话的已读游标推到最新一条消息（按角色更新对应列）
export async function dbMarkConversationRead(db, convId, userId) {
  await dbRun(db, `UPDATE conversations SET
      student_last_read_id=CASE WHEN student_user_id=? THEN (SELECT COALESCE(MAX(id),0) FROM messages WHERE conversation_id=?) ELSE student_last_read_id END,
      teacher_last_read_id=CASE WHEN teacher_user_id=? THEN (SELECT COALESCE(MAX(id),0) FROM messages WHERE conversation_id=?) ELSE teacher_last_read_id END
    WHERE id=?`, [userId, convId, userId, convId, convId]);
}

export async function dbGetMessages(db, convId, sinceId = 0, limit = 100) {
  return await dbAll(db, `SELECT m.id, m.conversation_id, m.sender_user_id, m.kind, m.body, m.created_at,
      u.username AS sender_name
    FROM messages m JOIN users u ON u.id=m.sender_user_id
    WHERE m.conversation_id=? AND m.id>? ORDER BY m.id ASC LIMIT ?`, [convId, sinceId, limit]);
}

export async function dbCreateMessage(db, convId, senderUserId, kind, body) {
  const result = await dbRun(db,
    'INSERT INTO messages (conversation_id, sender_user_id, kind, body) VALUES (?,?,?,?)',
    [convId, senderUserId, kind, body]);
  return Number(result.meta.last_row_id);
}

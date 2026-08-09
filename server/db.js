/**
 * 数据访问层 — 业务数据表 SQL 收敛于此（路由层只调用 dbXxx，不直接写业务 SQL）
 * 有意决定（CLAUDE.md）：日志表建表/插入在 server/log.js，通知表在 server/notify.js，
 * 合同状态机与台账 SQL 在 server/contract.js——各模块自持其表域，不在本文件重复。
 * signing_requests 表 DDL 由 server/signing.js 自持（initSigningTable），但该表的业务 SQL
 * （增/查/确认签约事务）已收口在本文件 mapper（v0.25.78 A5），signing.js 只调 dbXxx。
 * 换数据库时业务层只需重写本文件（咽喉层 util.js 的 dbAll/dbGet/dbRun 为通用封装）。
 */
import { dbAll, dbGet, dbRun, ensureColumns } from './util.js';
import { hashPassword, encryptField, decryptField, bindCryptoEnv } from './crypto.js'; // 密码哈希/敏感字段加密（网安报告 F-06）
import { INITIAL_RATING, INITIAL_WEIGHT, LIMITS, STATUS } from './constants.js';
import { getSecret } from './secrets.js'; // 敏感配置唯一网关（env 优先，回落本地 secrets.js）
import { initLogDb } from './log.js';
import { initNotifyTable } from './notify.js'; // 通知表建表（独立模块，仅借 init，无循环依赖）
import { initVersionTable } from './version.js'; // 数据版本戳表建表（v0.23.0 静默数据层，仅借 init）
import { initSigningTable } from './signing.js'; // 发起签约请求表建表（v0.24.0 极简签约流，仅借 init）
import { initDangerCaps } from './danger-ops.js'; // capToken 表建表（独立模块，仅借 init，无循环依赖）

// ============================================================
// 数据库初始化 + 迁移
// ============================================================
// 数据层契约（详见 docs/architecture.md）：本文件是唯一写 SQL 的地方。
// JSON 列经 safeJsonArray 单点容错反序列化，行经 mapXxxRow 出门——路由层零 JSON.parse。
// 合同表 DDL（新 schema：一条会话一份合同，草案→签约状态机）
const CONTRACTS_DDL = `CREATE TABLE IF NOT EXISTS contracts (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  conversation_id INTEGER NOT NULL,
  drafter_user_id INTEGER NOT NULL,
  method TEXT NOT NULL DEFAULT 'online',
  plan TEXT NOT NULL DEFAULT '',
  hourly_rate INTEGER NOT NULL DEFAULT 0,
  pay_method TEXT NOT NULL DEFAULT '',
  pay_method_other TEXT NOT NULL DEFAULT '',
  first_lesson_date TEXT NOT NULL DEFAULT '',
  trial_pay TEXT NOT NULL DEFAULT '',
  trial_pay_other TEXT NOT NULL DEFAULT '',
  contract_md TEXT NOT NULL DEFAULT '',
  status TEXT NOT NULL DEFAULT 'pending' CHECK(status IN ('pending','signing','signed')),
  drafter_confirmed INTEGER NOT NULL DEFAULT 0,
  other_confirmed INTEGER NOT NULL DEFAULT 0,
  drafter_signed_at TEXT NOT NULL DEFAULT '',
  other_signed_at TEXT NOT NULL DEFAULT '',
  version INTEGER NOT NULL DEFAULT 0,
  revoked INTEGER NOT NULL DEFAULT 0,   -- v0.25.87 R7：撤销标记（合同不删除，status 保持 signed）
  revoked_by INTEGER NOT NULL DEFAULT 0,
  created_at DATETIME DEFAULT (datetime('now','localtime')),
  updated_at DATETIME DEFAULT (datetime('now','localtime')),
  FOREIGN KEY (conversation_id) REFERENCES conversations(id) ON DELETE CASCADE)`;

// 管理员配置统一经 secrets 网关读取（env 优先，回落本地 secrets.js）；兼容 env 为逗号分隔串 / 文件为数组
const adminNamesOf = v => Array.isArray(v) ? v : String(v || '').split(',').map(s => s.trim()).filter(Boolean);

// 一次性遗留迁移：users 的 role 扩展支持 admin + 新增 banned 列（含子表同步重建）。
// D1 强制开启外键且不可关闭，DROP 被引用表会失败，故用「改名腾位」策略：
//   ① 旧表整体改名为 _*_old（SQLite 自动同步改写旧表间的 FK 引用）
//   ② 建当前形状新表并改名回终名，数据从 _*_old 拷贝（列交集）
//   ③ 先子后父删 _*_old
// 必须由 initDb 在初始建表【之前】调用：若初始 batch 先建出 auth_sessions/conversations 等子表，
// 本迁移改名 users 时会把它们的 FK 一并改写指向 _users_old，随后 _users_old 被删 → 子表 FK 悬空，
// 任何 INSERT 报 no such table: _users_old（实证复现）。迁移在前则子表直接引用迁移后的最终表。
// 幂等守卫：users 定义已含 'admin' 即跳过（全新库/已迁移库零开销）。
// 网安审计 N-19：旧表可能经历次 ensureColumns 比迁移 DDL 多/少列，逐表取「新旧列交集」显式列名拷贝，
// 缺列/多列均不炸；更老库缺失的表跳过、由初始 batch 按当前形状补建；补列仍由后续 ensureColumns 统一补齐。
async function migrateLegacyRoles(db, adminNames) {
  const meta = await dbGet(db, "SELECT sql FROM sqlite_master WHERE type='table' AND name='users'");
  if (!meta || meta.sql.includes("'admin'")) return;

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
      cols: ['id', 'user_id', 'grade', 'gender', 'subjects', 'gaokao_scores', 'price', 'wechat', 'email', 'school', 'real_name', 'credential_image', 'rating', 'rating_count', 'rating_sum', 'updated_at'],
      ddl: `CREATE TABLE teacher_profiles_new (
        id INTEGER PRIMARY KEY AUTOINCREMENT, user_id INTEGER UNIQUE NOT NULL,
        grade TEXT, gender TEXT, subjects TEXT, gaokao_scores TEXT,
        price REAL DEFAULT 0, price_min REAL, price_max REAL, wechat TEXT, email TEXT,
        school TEXT DEFAULT '', real_name TEXT DEFAULT '', credential_image TEXT DEFAULT '',
        time_slots TEXT DEFAULT '', teaching_method TEXT DEFAULT '',
        personality_tags TEXT DEFAULT '', nonacademic_projects TEXT DEFAULT '', nonacademic_prices TEXT DEFAULT '',
        graduation_year INTEGER,
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
      cols: ['code', 'created_by', 'created_at', 'expires_at', 'used_by', 'used_at'],
      ddl: `CREATE TABLE invite_codes_new (
        code TEXT PRIMARY KEY, created_by INTEGER NOT NULL,
        created_at DATETIME DEFAULT (datetime('now','localtime')),
        expires_at DATETIME NOT NULL, used_by INTEGER DEFAULT NULL,
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
  ];

  // 先查存在性 + 旧表列交集（PRAGMA 均在 batch 前执行）
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
  // ③ 清旧（先子后父：逆序删，父表最后）
  for (const p of [...ready].reverse()) stmts.push(db.prepare(`DROP TABLE _${p.t}_old`));

  await db.batch(stmts);
}

export async function initDb(db, env = {}) {
  bindCryptoEnv(env); // 字段加密密钥（FIELD_ENC_KEY 优先回落 LOG_ENCRYPT_KEY），env 变更重派生
  const adminNames = adminNamesOf(getSecret(env, 'ADMIN_USERNAMES'));
  const adminPassword = getSecret(env, 'ADMIN_DEFAULT_PASSWORD') || '';
  // 遗留角色迁移必须先于初始建表执行：若在初始 batch 之后跑，新建子表（auth_sessions/conversations…）
  // 的 FK 会在改名腾位时被改写指向 _*_old，随后 _*_old 被删 → 子表 FK 悬空，全站 INSERT 报
  // no such table（实证复现）。迁移在前时子表直接引用迁移后的最终表，从根上规避。
  await migrateLegacyRoles(db, adminNames);
  await db.batch([
    db.prepare(`CREATE TABLE IF NOT EXISTS users (
      id INTEGER PRIMARY KEY AUTOINCREMENT, username TEXT UNIQUE NOT NULL,
      password_hash TEXT NOT NULL, salt TEXT NOT NULL,
      role TEXT NOT NULL CHECK(role IN ('student','teacher','admin')),
      banned INTEGER NOT NULL DEFAULT 0,
      created_at DATETIME DEFAULT (datetime('now','localtime')))`),
    // 登录设备（多端会话）：每枚登录令牌一行；身份解析 authUser 一律 JOIN 本表（server/security.js）。
    // 网安报告 F-04：主键 token_hash（SHA-256 摘要），令牌明文永不落库；session_id 独立随机 id 供设备管理展示
    db.prepare(`CREATE TABLE IF NOT EXISTS auth_sessions (
      token_hash TEXT PRIMARY KEY, user_id INTEGER NOT NULL,
      session_id TEXT NOT NULL DEFAULT '',
      label TEXT NOT NULL DEFAULT '',
      device_id TEXT NOT NULL DEFAULT '', /* v0.25.11：设备去重键（浏览器档案持久 id；'' = 无设备标识的老客户端/脚本，不受部分唯一索引约束） */
      created_at DATETIME DEFAULT (datetime('now','localtime')),
      expires_at DATETIME NOT NULL,
      FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE)`),
    // 限流持久化表（网安报告 F-09）：登录/注册/密码重认证/三振/封禁低频键落此，跨实例生效；
    // 读写全在 server/security.js rateGate（SQL 内同口径 localtime 比较），此处只管建表
    db.prepare(`CREATE TABLE IF NOT EXISTS rate_limits (
      bucket TEXT PRIMARY KEY,
      n INTEGER NOT NULL DEFAULT 0,
      reset_at DATETIME NOT NULL)`),
    db.prepare(`CREATE TABLE IF NOT EXISTS teacher_profiles (
      id INTEGER PRIMARY KEY AUTOINCREMENT, user_id INTEGER UNIQUE NOT NULL,
      grade TEXT, gender TEXT, subjects TEXT, gaokao_scores TEXT,
      price REAL DEFAULT 0, price_min REAL, price_max REAL, wechat TEXT, email TEXT,
      school TEXT DEFAULT '', real_name TEXT DEFAULT '', credential_image TEXT DEFAULT '',
      time_slots TEXT DEFAULT '', teaching_method TEXT DEFAULT '',
      personality_tags TEXT DEFAULT '', nonacademic_projects TEXT DEFAULT '', nonacademic_prices TEXT DEFAULT '',
      graduation_year INTEGER,
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
      expected_time TEXT DEFAULT '',   /* 期望开课时间（运营 P3.1：纯文本，撮合参考） */
      budget_min REAL DEFAULT 0, budget_max REAL DEFAULT 0,
      submitter_type TEXT NOT NULL, parent_contact TEXT NOT NULL,
      student_contact TEXT NOT NULL, additional_info TEXT DEFAULT '',
      target_type TEXT NOT NULL DEFAULT 'academic',
      preferred_personality_tags TEXT NOT NULL DEFAULT '[]',
      preferred_teacher_gender TEXT NOT NULL DEFAULT '',
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
    // 合同（草案→签约全链路，见 server/contract.js；signed 状态即评价门槛 dbIsContracted 的放行条件）
    db.prepare(CONTRACTS_DDL),
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
      kind TEXT NOT NULL DEFAULT 'text' CHECK(kind IN ('text','image','file','contract')),
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
    // R23：帖子收藏（教师共享资料——收藏即保存，仅本人可见；UNIQUE 防重复收藏）
    db.prepare(`CREATE TABLE IF NOT EXISTS post_favorites (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      post_id INTEGER NOT NULL, user_id INTEGER NOT NULL,
      created_at DATETIME DEFAULT (datetime('now','localtime')),
      UNIQUE(post_id, user_id),
      FOREIGN KEY (post_id) REFERENCES posts(id) ON DELETE CASCADE,
      FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE)`),
    // R22：投诉独立通道（与 feedbacks 分表分通道；target_snapshot = 被投诉对象快照防删后失标）
    db.prepare(`CREATE TABLE IF NOT EXISTS complaints (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      user_id INTEGER NOT NULL,
      target_type TEXT NOT NULL CHECK(target_type IN ('teacher','student','post')),
      target_id INTEGER NOT NULL,
      target_snapshot TEXT NOT NULL DEFAULT '{}',
      reason TEXT NOT NULL DEFAULT '',
      detail TEXT NOT NULL DEFAULT '',
      status TEXT NOT NULL DEFAULT 'open' CHECK(status IN ('open','resolved')),
      created_at DATETIME DEFAULT (datetime('now','localtime')),
      resolved_at DATETIME,
      FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE)`),
    // 学生主动把需求推送给指定教师（与 demand_intents 方向相反；pending 时置顶 + 红点）
    db.prepare(`CREATE TABLE IF NOT EXISTS demand_pushes (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      demand_id INTEGER NOT NULL, student_user_id INTEGER NOT NULL, teacher_user_id INTEGER NOT NULL,
      status TEXT NOT NULL DEFAULT 'pending' CHECK(status IN ('pending','accepted','rejected')),
      created_at DATETIME DEFAULT (datetime('now','localtime')),
      UNIQUE(demand_id, teacher_user_id),
      FOREIGN KEY (demand_id) REFERENCES student_demands(id) ON DELETE CASCADE,
      FOREIGN KEY (student_user_id) REFERENCES users(id) ON DELETE CASCADE,
      FOREIGN KEY (teacher_user_id) REFERENCES users(id) ON DELETE CASCADE)`),
    // 聊天附件暂存区：文件拖入/选中即真实上传至此（XHR 进度），发送时才确认落入会话消息
    db.prepare(`CREATE TABLE IF NOT EXISTS uploads (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      user_id INTEGER NOT NULL,
      kind TEXT NOT NULL CHECK(kind IN ('image','file')),
      body TEXT NOT NULL,
      name TEXT NOT NULL DEFAULT '',
      created_at DATETIME DEFAULT (datetime('now','localtime')),
      FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE)`),
    // 用户反馈（关于平台页提交，管理员在「用户反馈」模块查看，可标记已处理）
    db.prepare(`CREATE TABLE IF NOT EXISTS feedbacks (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      user_id INTEGER NOT NULL,
      kind TEXT NOT NULL DEFAULT 'suggestion' CHECK(kind IN ('bug','suggestion','complaint')),
      subject TEXT NOT NULL DEFAULT '', /* #165（v0.25.73）：投诉对象（teacher/student/platform），非投诉恒空 */
      title TEXT NOT NULL DEFAULT '',
      content TEXT NOT NULL,
      status TEXT NOT NULL DEFAULT 'open' CHECK(status IN ('open','resolved')),
      created_at DATETIME DEFAULT (datetime('now','localtime')),
      FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE)`),
    db.prepare(`CREATE TABLE IF NOT EXISTS user_settings (
      user_id INTEGER PRIMARY KEY,
      allow_guest_profile INTEGER NOT NULL DEFAULT 1, /* #163（v0.25.71）：访客可见性——教师档案对未登录游客可见 */
      allow_guest_demand INTEGER NOT NULL DEFAULT 1,  /* #163：需求对未登录游客可见 */
      updated_at DATETIME DEFAULT (datetime('now','localtime')),
      FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE)`), /* #163：隐私设置大层级——无行=全默认可见（COALESCE 1） */
  ]);

  // 合同表 schema 迁移：旧预留表（student/teacher 直连 + active/ended 状态）从未启用过，
  // 检测到旧形状即整体换新（旧表恒空，无数据损失）
  const ctCols = (await db.prepare('PRAGMA table_info(contracts)').all()).results || [];
  if (ctCols.length && !ctCols.some(c => c.name === 'conversation_id')) {
    await dbRun(db, 'DROP TABLE contracts');
    await dbRun(db, CONTRACTS_DDL);
  }

  // messages.kind CHECK 迁移：约束缺 'contract'（合同气泡）→ v0.24.0 再补 'signing_request'/'signing_response'
  // （发起签约气泡与响应），检测到缺任一即保数据换表（rename → 新建 → 拷贝 → 删旧 → 补索引）
  const msgMeta = await dbGet(db, `SELECT sql FROM sqlite_master WHERE type='table' AND name='messages'`);
  if (msgMeta && msgMeta.sql && !(msgMeta.sql.includes("'contract'") && msgMeta.sql.includes("'signing_request'"))) {
    await db.batch([
      db.prepare(`ALTER TABLE messages RENAME TO messages_old`),
      db.prepare(`CREATE TABLE messages (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        conversation_id INTEGER NOT NULL, sender_user_id INTEGER NOT NULL,
        kind TEXT NOT NULL DEFAULT 'text' CHECK(kind IN ('text','image','file','contract','signing_request','signing_response')),
        body TEXT NOT NULL DEFAULT '',
        created_at DATETIME DEFAULT (datetime('now','localtime')),
        FOREIGN KEY (conversation_id) REFERENCES conversations(id) ON DELETE CASCADE,
        FOREIGN KEY (sender_user_id) REFERENCES users(id) ON DELETE CASCADE)`),
      db.prepare(`INSERT INTO messages (id, conversation_id, sender_user_id, kind, body, created_at)
        SELECT id, conversation_id, sender_user_id, kind, body, created_at FROM messages_old`),
      db.prepare(`DROP TABLE messages_old`),
      db.prepare(`CREATE INDEX IF NOT EXISTS idx_messages_conv ON messages(conversation_id, id)`),
    ]);
  }

  // feedbacks.kind CHECK 迁移（#165 v0.25.73）：约束缺 'complaint'（投诉通道）→ 保数据换表
  const fbMeta = await dbGet(db, `SELECT sql FROM sqlite_master WHERE type='table' AND name='feedbacks'`);
  if (fbMeta && fbMeta.sql && !fbMeta.sql.includes("'complaint'")) {
    await db.batch([
      db.prepare('ALTER TABLE feedbacks RENAME TO feedbacks_old'),
      db.prepare(`CREATE TABLE feedbacks (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        user_id INTEGER NOT NULL,
        kind TEXT NOT NULL DEFAULT 'suggestion' CHECK(kind IN ('bug','suggestion','complaint')),
        subject TEXT NOT NULL DEFAULT '',
        title TEXT NOT NULL DEFAULT '',
        content TEXT NOT NULL,
        status TEXT NOT NULL DEFAULT 'open' CHECK(status IN ('open','resolved')),
        created_at DATETIME DEFAULT (datetime('now','localtime')),
        FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE)`),
      db.prepare(`INSERT INTO feedbacks (id, user_id, kind, title, content, status, created_at)
        SELECT id, user_id, kind, title, content, status, created_at FROM feedbacks_old`),
      db.prepare('DROP TABLE feedbacks_old'),
    ]);
  }

  // 一人一评唯一索引（幂等）；旧数据若有重复对则建不上，回落路由层成对检查，不阻塞启动
  try {
    await dbRun(db, 'CREATE UNIQUE INDEX IF NOT EXISTS idx_reviews_reviewer_teacher ON reviews(reviewer_user_id, teacher_user_id)');
  } catch { /* 旧重复数据：跳过索引 */ }

  // 迁移残留清理（IF EXISTS 恒安全；兜底任何半途状态遗留下的 _*_old）
  await db.batch([
    db.prepare('DROP TABLE IF EXISTS _demand_intents_old'),
    db.prepare('DROP TABLE IF EXISTS _invite_codes_old'),
    db.prepare('DROP TABLE IF EXISTS _reviews_old'),
    db.prepare('DROP TABLE IF EXISTS _student_demands_old'),
    db.prepare('DROP TABLE IF EXISTS _teacher_profiles_old'),
    db.prepare('DROP TABLE IF EXISTS _users_old'),
  ]);

  // 令牌摘要化迁移（网安报告 F-04）：旧库 auth_sessions 存 token 明文（token 主键）——
  // 探测到旧结构即 DROP 重建为 token_hash 主键，语义 = 吊销全部历史会话（存量明文令牌连根清除，
  // 所有已登录设备需重新登录；auth_sessions 无子表引用，安全）。新库无 token 列，探测不命中，跳过
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

  // 种子管理员（独立 admin 角色；凭证经 secrets 网关：env.Worker Secrets 优先，回落本地 secrets.js）
  // 网安报告 F-01：upsert 语义——存在且密码哈希与当前种子不同则更新（管理员在环境变量里轮换密码
  // 即生效，生产管理员口令可脱离仓库明文；「知道仓库凭据」不再等于「能接管生产」）
  for (const name of adminNames) {
    const existing = await dbGet(db, 'SELECT id, password_hash FROM users WHERE username = ?', [name]);
    if (!existing) {
      const { hash, salt } = await hashPassword(adminPassword);
      await dbRun(db, 'INSERT INTO users (username,password_hash,salt,role) VALUES (?,?,?,?)',
        [name, hash, salt, 'admin']);
    } else if (adminPassword) {
      const { hash, salt } = await hashPassword(adminPassword);
      if (hash !== existing.password_hash) {
        await dbRun(db, 'UPDATE users SET password_hash=?, salt=? WHERE id=?', [hash, salt, existing.id]);
      }
    }
  }

  // 留档表（模块5；绑定独立 LOG_DB 时此表建在业务库亦无害，查询走 getLogDb 路由）
  await initLogDb(db);

  // 幂等加列（模块1：地区档案；模块3：意向状态机）
  await ensureColumns(db, 'users', [['avatar', "TEXT DEFAULT ''"], ['deactivated', 'INTEGER NOT NULL DEFAULT 0']]);
  // 旧单令牌残留清空（网安报告 F-04：auth_token/token_expires 列已无读者，清值缩泄露面）。
  // 列仅存于历史库、不在任何 DDL（旧 schema 迁移残留）；全新库无这两列，须先 PRAGMA 探测再执行，
  // 否则 initDb 在全新 D1 上必抛 no such column（曾致初始化永久失败、全站 500 的 CRITICAL 缺陷）
  const userCols = (await dbAll(db, 'PRAGMA table_info(users)')).map(c => c.name);
  if (userCols.includes('auth_token')) {
    await dbRun(db, `UPDATE users SET auth_token='', token_expires='' WHERE auth_token != '' OR token_expires != ''`);
  }
  await ensureColumns(db, 'feedbacks', [['title', "TEXT NOT NULL DEFAULT ''"], ['status', "TEXT NOT NULL DEFAULT 'open'"],
    ['subject', "TEXT NOT NULL DEFAULT ''"]]); // #165：投诉对象列（补列兜底）
  await ensureColumns(db, 'messages', [['name', "TEXT NOT NULL DEFAULT ''"], ['thumb', "TEXT NOT NULL DEFAULT ''"]]); // v0.25.36 图片缩略图列
  await ensureColumns(db, 'uploads', [['thumb', "TEXT NOT NULL DEFAULT ''"]]);
  await ensureColumns(db, 'teacher_profiles', [['province', "TEXT DEFAULT ''"], ['intro', "TEXT DEFAULT ''"], ['address', "TEXT DEFAULT ''"],
    ['school', "TEXT DEFAULT ''"], ['real_name', "TEXT DEFAULT ''"], ['credential_image', "TEXT DEFAULT ''"],
    ['verified', 'INTEGER NOT NULL DEFAULT 0'], // 学籍认证（运营建议：管理员审核学信网截图后置 1，前端显示「已认证」徽章）
    ['price_min', 'REAL'], ['price_max', 'REAL'], // R2-5 报价区间化（可空，null=未填；不落 DEFAULT 0）
    ['time_slots', "TEXT DEFAULT ''"], ['teaching_method', "TEXT DEFAULT ''"], // R2-1 可授课时间段 / R2-2 授课方式
    ['personality_tags', "TEXT DEFAULT ''"], ['nonacademic_projects', "TEXT DEFAULT ''"], ['nonacademic_prices', "TEXT DEFAULT ''"], // R2-3 性格关键词 / R2-4 非学科项目+报价
    ['graduation_year', 'INTEGER'] // R2-12 毕业年份（可空；null=未填按最新政策，非 null 决定教师当年赋分政策）
  ]);
  // R2-5 存量教师单报价转区间（幂等）：price 列保留不动（重建表不值当），仅按旧价回填 min==max，
  // 防档案完整性门槛（price_min==null）误拦历史教师接单。price 列此后不再写入。
  await dbRun(db, `UPDATE teacher_profiles SET price_min=price, price_max=price WHERE price_min IS NULL AND price IS NOT NULL`);
  // R16：默认评分 4.0→4.5 对所有用户生效——存量从未被评价的教师（rating_count=0，rating=旧默认）回填 4.5；
  // 被评价过的保留实际加权分。幂等：回填后 rating=4.5 不再命中；新库新建即 4.5。
  await dbRun(db, `UPDATE teacher_profiles SET rating=${INITIAL_RATING} WHERE rating_count = 0 AND rating < ${INITIAL_RATING}`);
  await ensureColumns(db, 'student_demands', [['province', "TEXT DEFAULT ''"], ['status', "TEXT NOT NULL DEFAULT 'open'"], ['display_id', 'INTEGER'], ['expected_time', "TEXT DEFAULT ''"],
    ['intent_locked', 'INTEGER NOT NULL DEFAULT 0'], // 意向单接受锁：并发 accept 抢占（防同需求双 accepted 意向）
    // R2-b 需求侧扩充：需求类型（学科/非学科）/ 偏好老师性格 / 偏好老师性别
    ['target_type', "TEXT NOT NULL DEFAULT 'academic'"],
    ['preferred_personality_tags', "TEXT NOT NULL DEFAULT '[]'"],
    ['preferred_teacher_gender', "TEXT NOT NULL DEFAULT ''"]]);
  await ensureColumns(db, 'contracts', [['demand_id', 'INTEGER'], ['schedule', "TEXT NOT NULL DEFAULT ''"], ['location', "TEXT NOT NULL DEFAULT ''"],
    ['pay_method', "TEXT NOT NULL DEFAULT ''"], ['pay_method_other', "TEXT NOT NULL DEFAULT ''"],
    ['first_lesson_date', "TEXT NOT NULL DEFAULT ''"], ['trial_pay', "TEXT NOT NULL DEFAULT ''"], ['trial_pay_other', "TEXT NOT NULL DEFAULT ''"],
    ['version', 'INTEGER NOT NULL DEFAULT 0'], // 合同乐观锁版本（秒级 updated_at 不可靠，修同秒双改互相覆盖）
    ['prev_business', 'TEXT'], // v0.24.0 改动留痕：上次业务条款（前端 diff 高亮；签署确认后清空）
    // v0.25.37 签署合规：双方签署时间（空=未签；UTC SQLite 时间戳），签名区块内嵌正文据此渲染
    ['drafter_signed_at', "TEXT NOT NULL DEFAULT ''"],
    ['other_signed_at', "TEXT NOT NULL DEFAULT ''"],
    // v0.25.87 R7：撤销标记（双方签后撤销合同：合同不删除，status 保持 signed，置 revoked 标记 + 撤销人）
    ['revoked', 'INTEGER NOT NULL DEFAULT 0'],
    ['revoked_by', 'INTEGER NOT NULL DEFAULT 0']]);

  // 存量需求编号补发：按 id（生成顺序）依次取号，四位展示自 0001 起；已编号跳过（幂等）
  const unnumbered = await dbAll(db, 'SELECT id FROM student_demands WHERE display_id IS NULL ORDER BY id');
  for (const r of unnumbered) {
    await dbRun(db, 'UPDATE student_demands SET display_id=(SELECT COALESCE(MAX(display_id),0)+1 FROM student_demands) WHERE id=?', [r.id]);
  }

  // 意向状态列先行补齐：下方「存量会话需求绑定修复」回填引用 di.status，须先建列再回填——
  // 否则全新 D1 上 initDb 在 prepare 阶段即报 no such column（曾致全新库初始化失败的 CRITICAL 缺陷）
  await ensureColumns(db, 'demand_intents', [
    ['status', "TEXT NOT NULL DEFAULT 'pending' CHECK(status IN ('pending','accepted','rejected'))"],
    ['resolved_at', 'DATETIME'],
  ]);
  // 存量会话需求绑定修复：旧会话 demand_id 为空 → 从已接受意向 / 已接受推送反查回填（幂等，仅填空不覆写）
  await dbRun(db, `UPDATE conversations SET demand_id = (
      SELECT di.demand_id FROM demand_intents di
      WHERE di.teacher_user_id = conversations.teacher_user_id AND di.status='accepted' AND di.demand_id IS NOT NULL
      ORDER BY di.id DESC LIMIT 1)
    WHERE demand_id IS NULL AND EXISTS (
      SELECT 1 FROM demand_intents di WHERE di.teacher_user_id = conversations.teacher_user_id AND di.status='accepted')`);
  await dbRun(db, `UPDATE conversations SET demand_id = (
      SELECT dp.demand_id FROM demand_pushes dp
      WHERE dp.teacher_user_id = conversations.teacher_user_id AND dp.status='accepted' AND dp.demand_id IS NOT NULL
      ORDER BY dp.id DESC LIMIT 1)
    WHERE demand_id IS NULL AND EXISTS (
      SELECT 1 FROM demand_pushes dp WHERE dp.teacher_user_id = conversations.teacher_user_id AND dp.status='accepted')`);
  // 会话已读游标（红点未读用：双方各自一个，指向自己已读到的最大消息 id）
  await ensureColumns(db, 'conversations', [
    ['student_last_read_id', 'INTEGER NOT NULL DEFAULT 0'],
    ['teacher_last_read_id', 'INTEGER NOT NULL DEFAULT 0'],
  ]);
  // 设备管理安全（网安报告 F-04）：auth_sessions.session_id 已入 DDL 与重建迁移，设备接口只暴露
  // session_id、token 永不进响应体（旧表经上方 DROP 重建后自然带列，无需回填迁移）
  // v0.25.11 设备去重：老库补 device_id 列（新库 DDL 已带）。列补齐后建部分唯一索引——
  // 同一 (user, device) 至多一行活跃会话（issueAuthToken UPSERT 复用行）；device_id=''（无标识的
  // 老客户端/curl 脚本）不受约束，保持历史多行行为。旧数据 device_id 全空，无冲突，建索引安全
  await ensureColumns(db, 'auth_sessions', [['device_id', "TEXT NOT NULL DEFAULT ''"]]);
  await dbRun(db, `CREATE UNIQUE INDEX IF NOT EXISTS idx_auth_sessions_user_device
    ON auth_sessions(user_id, device_id) WHERE device_id != ''`);

  // 热点查询索引（v0.22.8，查询优化杠杆）：幂等 CREATE INDEX IF NOT EXISTS。
  // 必须置于全部换表迁移 + ensureColumns 之后——迁移重建表不继承旧索引、后补列（demand_intents.status、
  // users.deactivated）在此前尚不存在，早建会 no such column（实证踩坑）。依据审计：
  // 教师列表 matched EXISTS 走 teacher 前置、需求聚合子查询走 demand 前置、分页 ORDER BY 走复合等。
  await db.batch([
    db.prepare('CREATE INDEX IF NOT EXISTS idx_conv_teacher ON conversations(teacher_user_id, student_user_id)'),
    db.prepare('CREATE INDEX IF NOT EXISTS idx_demands_created ON student_demands(created_at, id)'),
    db.prepare('CREATE INDEX IF NOT EXISTS idx_demands_user ON student_demands(user_id)'),
    db.prepare('CREATE INDEX IF NOT EXISTS idx_intents_demand_status ON demand_intents(demand_id, status)'),
    db.prepare('CREATE INDEX IF NOT EXISTS idx_contracts_conv ON contracts(conversation_id)'),
    db.prepare('CREATE INDEX IF NOT EXISTS idx_contracts_demand ON contracts(demand_id)'),
    db.prepare('CREATE INDEX IF NOT EXISTS idx_tp_updated ON teacher_profiles(updated_at)'),
    db.prepare('CREATE INDEX IF NOT EXISTS idx_users_role ON users(role, banned, deactivated)'),
    db.prepare('CREATE INDEX IF NOT EXISTS idx_pushes_teacher ON demand_pushes(teacher_user_id, status)'),
  ]);

  // 通知表（独立模块 notify.js 提供建表与推送咽喉）
  await initNotifyTable(db);
  // 数据版本戳表（v0.23.0 静默数据层：客户端 8s 探测版本，只重拉变化域）
  await initVersionTable(db);
  // 发起签约请求表（v0.24.0 极简签约流：确认签约关系；需求-会话解耦后唯一「签约才拒其他」的触发点）
  await initSigningTable(db);
  // 危险操作二次认证 capToken 表（独立模块 danger-ops.js 提供签发/校验；D1 持久化跨实例一致，网安审计 N-02）
  await initDangerCaps(db);

  // 存量用户名消毒：注册白名单仅约束新注册，旧库若残留含 < > " ' 的用户名会命中各转义汇点，
  // 一次性改名「用户#id#时间戳」（幂等：GLOB 不再匹配已消毒名；时间戳后缀保 UNIQUE）
  const dirtyNames = await dbAll(db, `SELECT id FROM users WHERE username GLOB '*[<>"'']*'`);
  for (const r of dirtyNames) {
    await dbRun(db, `UPDATE users SET username=? WHERE id=?`, [`用户#${r.id}#${Date.now()}`, r.id]);
  }
}

// ============================================================
// 用户
// ============================================================
// 显式列集：凭证列（password_hash/salt）仅登录/重认证出层，其余列不随裸行外溢
const USER_BY_USERNAME_SQL = 'SELECT id, username, role, avatar, banned, deactivated, password_hash, salt FROM users WHERE username=?';

export async function dbFindUserByUsername(db, username) {
  return await dbGet(db, USER_BY_USERNAME_SQL, [username]);
}

// B1：认证路由限流同批的用户查询语句（与 dbFindUserByUsername 同 SQL 单源；供 authRateBatch 的附加查询）
export function dbUserLookupStmt(db, username) {
  return db.prepare(USER_BY_USERNAME_SQL).bind(username);
}
export function dbUsernameExistsStmt(db, username) {
  return db.prepare('SELECT id FROM users WHERE username=?').bind(username);
}

export async function dbFindUserById(db, id) {
  return await dbGet(db, 'SELECT id,role FROM users WHERE id=?', [id]);
}

// 用户卡片（公开名片 / 封禁态判定 / 管理员封禁 / 帖子作者留档共用）：固定列集，不含口令盐等凭证
export async function dbGetUserById(db, id) {
  return await dbGet(db, 'SELECT id, username, role, avatar, banned, deactivated FROM users WHERE id=?', [id]);
}

export async function dbCreateUser(db, username, hash, salt, role) {
  const result = await dbRun(db,
    'INSERT INTO users (username,password_hash,salt,role) VALUES (?,?,?,?)',
    [username, hash, salt, role]);
  return Number(result.meta.last_row_id);
}

// 注册邀请码消费输家的回滚：删除刚建的用户（子表 FK 均 ON DELETE CASCADE，无需逐表清）
export async function dbDeleteUser(db, userId) {
  await dbRun(db, 'DELETE FROM users WHERE id=?', [userId]);
}

// 注销账户：用户名墓碑化 + 凭证清空 + 封禁/注销标记（墓碑全站展示 + 登录阻断）
export async function dbDeactivateUser(db, userId, tombstone) {
  await dbRun(db, `UPDATE users SET username=?, password_hash='', salt='', avatar='', banned=1, deactivated=1 WHERE id=?`,
    [tombstone, userId]);
}

// 教师评分重算（评价通过 / 已通过评价被拒绝或删除时统一调用；注销清理同款口径，单点下沉于此）
export async function dbRecomputeTeacherRating(db, teacherUserId) {
  const stats = await dbGetApprovedReviewStats(db, teacherUserId);
  const cnt = stats?.cnt || 0;
  const sum = stats?.total || 0;
  const rating = (INITIAL_RATING * INITIAL_WEIGHT + sum) / (INITIAL_WEIGHT + cnt);
  await dbUpdateTeacherRating(db, teacherUserId, rating, cnt, sum);
}

// 注销清理：吊销全部登录态 + 单方数据全删；双方共享数据（会话/聊天/合同）匿名化本人侧后保留，
// JOIN username 处自然显示墓碑。学生侧需求（含联系方式）/意向/推送/自写评价一律删除
// （网安报告 F-06：原实现漏删学生侧表，敏感数据永久保留）。
export async function dbPurgeUserOwnedData(db, userId, role) {
  await dbRun(db, 'DELETE FROM auth_sessions WHERE user_id=?', [userId]); // 注销即吊销全部设备的登录态
  await dbRun(db, 'DELETE FROM teacher_profiles WHERE user_id=?', [userId]);
  await dbRun(db, 'DELETE FROM notifications WHERE user_id=?', [userId]);
  await dbRun(db, 'DELETE FROM feedbacks WHERE user_id=?', [userId]);
  await dbRun(db, 'DELETE FROM complaints WHERE user_id=?', [userId]); // R22：注销清理投诉记录
  await dbRun(db, 'DELETE FROM uploads WHERE user_id=?', [userId]);
  await dbRun(db, 'DELETE FROM post_likes WHERE user_id=?', [userId]);
  await dbRun(db, 'DELETE FROM post_favorites WHERE user_id=?', [userId]); // R23：注销清理收藏
  await dbRun(db, 'DELETE FROM posts WHERE user_id=?', [userId]);

  if (role === 'student') {
    // 学生侧：删自建需求（级联删意向/推送，含联系方式与地址）。
    // 网安 N-12：已签约（contracted）需求不删、置 revoked 保留行——否则合同 demand_id 悬空（裸 INTEGER 无 FK）
    await dbRun(db, `DELETE FROM student_demands WHERE user_id=? AND status <> ?`, [userId, STATUS.CONTRACTED]);
    await dbRun(db, `UPDATE student_demands SET status=? WHERE user_id=? AND status=?`, [STATUS.REVOKED, userId, STATUS.CONTRACTED]);
    // 删除本人对教师的评价并重算受影响教师评分
    await dbRun(db, 'DELETE FROM demand_pushes WHERE student_user_id=?', [userId]);
    const myReviews = await dbAll(db, 'SELECT id, teacher_user_id FROM reviews WHERE reviewer_user_id=?', [userId]);
    await dbRun(db, 'DELETE FROM reviews WHERE reviewer_user_id=?', [userId]);
    for (const rv of myReviews) await dbRecomputeTeacherRating(db, rv.teacher_user_id);
  } else if (role === 'teacher') {
    // 教师侧：删其发出的意向/收到的推送；被评价记录保留（评价格局归学生，教师不可自删）
    await dbRun(db, 'DELETE FROM demand_intents WHERE teacher_user_id=?', [userId]);
    await dbRun(db, 'DELETE FROM demand_pushes WHERE teacher_user_id=?', [userId]);
  }

  // v0.25.41（注销幽灵数据）：发起方的待处理签约请求收束为「已拒绝」终态——行 + 会话内气泡同步终态。
  // 不能 DELETE：气泡自包含（kind='signing_request' 渲染自 body JSON），行删了气泡仍显 pending 按钮、
  // 接收方点击必 404 死按钮（死签约请求）；也不可留 pending：注销者永不可回应、对方永远悬着。
  // 置 rejected = 单方 offer 收走（offer 作历史双方协商记录保留），气泡终态灰字「已拒绝此次签约请求」。
  const myPendingSignings = await dbAll(db,
    'SELECT id, message_id, price, schedule, method FROM signing_requests WHERE initiator_user_id=? AND status=?',
    [userId, STATUS.PENDING]);
  for (const sr of myPendingSignings) {
    await dbRun(db, `UPDATE signing_requests SET status=?, responded_at=datetime('now','localtime') WHERE id=? AND status=?`,
      [STATUS.REJECTED, sr.id, STATUS.PENDING]);
    if (sr.message_id) {
      await dbRun(db, 'UPDATE messages SET body=? WHERE id=?',
        [JSON.stringify({ id: sr.id, price: sr.price, schedule: sr.schedule, method: sr.method, status: STATUS.REJECTED }), sr.message_id]);
    }
  }

  // 匿名化本人发出的聊天正文与附件（会话/合同行保留，正文清空 + 墓碑用户名显示，符合 F-06 保留分级）。
  // 网安审计 N-03：image/file 消息的 dataURL 本体（最高 700KB）与文件名同样清空——原只清 kind='text'，
  // 注销者历史照片/文件会永久留在库中、可被会话对方经 attachment 接口无限期下载。
  // contract 类型的合同事件气泡无隐私本体（body 为固定事件标记），保留以供聊天窗事件展示。
  await dbRun(db, `UPDATE messages SET body='', name='' WHERE sender_user_id=? AND kind IN ('text','image','file')`, [userId]);
}

// 账户设置：头像更新
export async function dbUpdateUserAvatar(db, userId, avatar) {
  await dbRun(db, 'UPDATE users SET avatar=? WHERE id=?', [avatar, userId]);
}

// 管理员封禁 / 解封
export async function dbSetUserBanned(db, userId, banned) {
  await dbRun(db, 'UPDATE users SET banned=? WHERE id=?', [banned, userId]);
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
  // 赢家模式：并发双注册同码时仅 changes>0 的一方消费成功（防一枚码两人用，调用方回滚输家）
  const r = await dbRun(db,
    "UPDATE invite_codes SET used_by=?, used_at=datetime('now','localtime') WHERE code=? AND used_by IS NULL",
    [userId, code]);
  return !!(r && r.meta && r.meta.changes > 0);
}

export async function dbCreateInviteCode(db, code, adminId, expiresAt) {
  await dbRun(db,
    'INSERT INTO invite_codes (code,created_by,expires_at) VALUES (?,?,?)',
    [code, adminId, expiresAt]);
}


// ============================================================
// JSON 列反序列化单点：subjects / gaokao_scores / target_subjects / current_scores
// 四列在库里是 JSON 字符串，出 db.js 一律经此函数变数组——容错（脏数据不炸全列表），
// 调用方拿到的永远是数组，严禁在路由层再 JSON.parse（双重解析曾炸 500）
// ============================================================
function safeJsonArray(text) {
  if (!text) return [];
  try { const v = JSON.parse(text); return Array.isArray(v) ? v : []; }
  catch { return []; }
}

// ============================================================
// 教师档案
// ============================================================
// 本人档案（含联系方式，编辑预填用）：与教师列表共用 mapper，反序列化只此一条路径
export async function dbGetTeacherProfile(db, userId) {
  const row = await dbGet(db, 'SELECT * FROM teacher_profiles WHERE user_id=?', [userId]);
  return row ? await mapTeacherProfileRow(row) : null;
}

// 双向匹配判定：两人间存在会话（意向被接受/推送被确认 = 建立联系）→ 真实姓名/学信网截图可见门槛
export async function dbIsMatched(db, userIdA, userIdB) {
  return !!(await dbGet(db,
    'SELECT id FROM conversations WHERE (student_user_id=? AND teacher_user_id=?) OR (student_user_id=? AND teacher_user_id=?)',
    [userIdA, userIdB, userIdB, userIdA]));
}

export async function dbUpsertTeacherProfile(db, userId, profile) {
  const existing = await dbGet(db, 'SELECT id FROM teacher_profiles WHERE user_id=?', [userId]);
  const subjects = JSON.stringify(profile.subjects);
  const gaokao = JSON.stringify(profile.gaokao_scores);
  // 网安报告 F-06：wechat/email/real_name 加密落库（D1 泄露/备份不暴露教师私密信息；real_name 截断先于加密）
  // 网安 N-05：credential_image（学信网截图 dataURL）同款加密——D1 泄露/备份不暴露证件图
  const [wechat, email, realName, credentialImage] = await Promise.all([
    encryptField(profile.wechat || ''), encryptField(profile.email || ''),
    encryptField((profile.real_name || '').slice(0, LIMITS.REAL_NAME_MAX)), encryptField(profile.credential_image || ''),
  ]);

  // R2-5 报价区间化：price_min/price_max 保留 null=未填语义（完整性门槛据此拦截，勿落 0）；0 是合法报价
  const priceMin = profile.price_min != null ? profile.price_min : null;
  const priceMax = profile.price_max != null ? profile.price_max : null;
  const timeSlots = profile.time_slots || ''; // R2-1 结构化时间段 JSON（空串 = 未填）
  const teachingMethod = profile.teaching_method || ''; // R2-2 授课方式白名单（routes 已校验）
  const personalityTags = JSON.stringify(Array.isArray(profile.personality_tags) ? profile.personality_tags : []); // R2-3 JSON 数组
  const nonacademicProjects = JSON.stringify(Array.isArray(profile.nonacademic_projects) ? profile.nonacademic_projects : []); // R2-4 JSON 数组
  const nonacademicPrices = JSON.stringify(Array.isArray(profile.nonacademic_prices) ? profile.nonacademic_prices : []); // R2-4 JSON 数组
  // R2-12 毕业年份：''/null/非法（routes 已回 ''）一律归一为 null 落库（null = 未填，按最新政策）
  const gradYear = profile.graduation_year != null && profile.graduation_year !== '' ? profile.graduation_year : null;

  // price 列保留 = price_min 同步镜像（v0.25.2 审计修复）：INSERT/UPDATE 显式写 price=priceMin，
  // 防新行吃 DEFAULT 0 后，被存量回填 `WHERE price_min IS NULL AND price IS NOT NULL` 误抓成「报价 0」。
  // 语义：price 为只读残留（历史迁移用），业务读写一律走 price_min/price_max。
  if (existing) {
    await dbRun(db, `UPDATE teacher_profiles SET province=?,grade=?,gender=?,subjects=?,gaokao_scores=?,
      price=?,price_min=?,price_max=?,wechat=?,email=?,intro=?,address=?,school=?,real_name=?,credential_image=?,
      time_slots=?,teaching_method=?,personality_tags=?,nonacademic_projects=?,nonacademic_prices=?,
      graduation_year=?,
      updated_at=datetime('now','localtime') WHERE user_id=?`,
      [profile.province || '', profile.grade, profile.gender, subjects, gaokao, priceMin, priceMin, priceMax, wechat, email, (profile.intro || '').slice(0, LIMITS.INTRO_MAX), (profile.address || '').slice(0, LIMITS.ADDRESS_FIELD_MAX), (profile.school || '').slice(0, LIMITS.SCHOOL_MAX), realName, credentialImage,
        timeSlots, teachingMethod, personalityTags, nonacademicProjects, nonacademicPrices, gradYear, userId]);
  } else {
    await dbRun(db, `INSERT INTO teacher_profiles (user_id,province,grade,gender,subjects,gaokao_scores,
        price,price_min,price_max,wechat,email,intro,address,school,real_name,credential_image,
        time_slots,teaching_method,personality_tags,nonacademic_projects,nonacademic_prices,graduation_year)
      VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`,
      [userId, profile.province || '', profile.grade, profile.gender, subjects, gaokao, priceMin, priceMin, priceMax, wechat, email, (profile.intro || '').slice(0, LIMITS.INTRO_MAX), (profile.address || '').slice(0, LIMITS.ADDRESS_FIELD_MAX), (profile.school || '').slice(0, LIMITS.SCHOOL_MAX), realName, credentialImage,
        timeSlots, teachingMethod, personalityTags, nonacademicProjects, nonacademicPrices, gradYear]);
  }
}

// 教师行映射器：教师列表 / 意向教师列表 / 本人档案共用，返回形状永远一致
// （JOIN 来的 username/avatar 在裸档案行上缺省为 undefined，JSON 序列化时自动略去）
// 网安报告 F-06：wechat/email/real_name 是加密列，出门即解密（调用方均为 async，Promise.all 收敛）
// 网安 N-05：credential_image 同款加密列，出门解密
// v0.22.8 数据最小化：private:false 时私密字段不解密、置空——广场列表非匹配行（viewerId 缺省或未匹配）
// 一律裁剪，服务端硬把关（前端仅按 matched/signed 门控显示，但数据此前已随列表发给所有人）
async function mapTeacherProfileRow(p, { private: includePrivate = true } = {}) {
  const [wechat, email, realName, credentialImage] = includePrivate
    ? await Promise.all([
        decryptField(p.wechat), decryptField(p.email), decryptField(p.real_name), decryptField(p.credential_image),
      ])
    : ['', '', '', ''];
  return {
    id: p.id, user_id: p.user_id, username: p.username,
    province: p.province || '', grade: p.grade, gender: p.gender, intro: p.intro || '', address: p.address || '',
    school: p.school || '', real_name: realName || '', credential_image: credentialImage || '',
    verified: p.verified ? true : false, // 学籍认证（管理员审核通过）
    subjects: safeJsonArray(p.subjects),
    gaokao_scores: safeJsonArray(p.gaokao_scores),
    // R2-5 报价区间化：price_min/price_max 保留 null=未填（完整性门槛据此拦截）；price 保留供历史兼容，前端不再用
    price_min: p.price_min != null ? p.price_min : null,
    price_max: p.price_max != null ? p.price_max : null,
    price: p.price != null ? p.price : null,
    // R2-1/R2-2/R2-3/R2-4：教师档案扩展字段
    time_slots: p.time_slots || '',
    teaching_method: p.teaching_method || '',
    personality_tags: safeJsonArray(p.personality_tags),
    nonacademic_projects: safeJsonArray(p.nonacademic_projects),
    nonacademic_prices: safeJsonArray(p.nonacademic_prices),
    // R2-12 毕业年份（null = 未填，前端按最新政策渲染赋分组件）。
    // 网安审计 M1 决策：公开模式不裁剪——毕业年份仅能粗推成人教师年龄（远弱于联系方式/门牌），
    // 且是学生判断「该教师高考分按哪套政策」的必读信息（2c 需求），刻意公开；不仿 real_name 门控。
    graduation_year: p.graduation_year != null ? p.graduation_year : null,
    wechat, email, avatar: p.avatar || '',
    rating: p.rating, rating_count: p.rating_count, matched: p.matched ? true : false, updatedAt: p.updated_at,
  };
}

// 教师列表统一出口（v0.19.40 合并 dbGetAllTeachers / dbGetTeacherUsersAdmin 双胞胎）：
// 广场视图（默认）：viewerId 有值（登录态）时附 matched 标记（双向匹配 = 与该教师已建立会话），
//   前端据此决定是否拉取真实姓名/学信网截图等仅匹配可见字段；
// adminView：管理端教师管理列表——LEFT JOIN（无档案教师也显示）+ 附 role/banned/created_at
export async function dbGetTeachers(db, { adminView = false, viewerId = null } = {}) {
  if (adminView) {
    const rows = await dbAll(db, `SELECT u.id AS user_id, u.username, u.role, u.banned, u.created_at,
        tp.id, tp.grade, tp.gender, tp.subjects, tp.gaokao_scores, tp.price, tp.price_min, tp.price_max,
        tp.wechat, tp.email, tp.time_slots, tp.teaching_method,
        tp.personality_tags, tp.nonacademic_projects, tp.nonacademic_prices,
        tp.graduation_year,
        tp.rating, tp.rating_count, tp.province, tp.intro, tp.address, tp.updated_at
      FROM users u LEFT JOIN teacher_profiles tp ON tp.user_id=u.id
      WHERE u.role='teacher' ORDER BY u.created_at DESC`);
    return await Promise.all(rows.map(async r => ({ ...(await mapTeacherProfileRow(r)), role: r.role, banned: r.banned, created_at: r.created_at })));
  }
  const matchedSel = viewerId
    ? `EXISTS(SELECT 1 FROM conversations cv WHERE (cv.student_user_id=? AND cv.teacher_user_id=tp.user_id) OR (cv.student_user_id=tp.user_id AND cv.teacher_user_id=?)) AS matched`
    : '0 AS matched';
  const params = viewerId ? [viewerId, viewerId] : [];
  // #163（v0.25.71）：访客可见性——游客只看 allow_guest_profile=1 的教师（无 user_settings 行=默认可见）
  const joinUs = viewerId ? '' : ' LEFT JOIN user_settings us ON us.user_id=tp.user_id';
  const privWhere = viewerId ? '' : ' AND COALESCE(us.allow_guest_profile, 1) = 1';
  const profiles = await dbAll(db, `SELECT tp.*, u.username, u.avatar, ${matchedSel}
    FROM teacher_profiles tp JOIN users u ON tp.user_id=u.id${joinUs}
    WHERE u.role='teacher' AND u.banned=0 AND u.deactivated=0${privWhere}
    ORDER BY tp.updated_at DESC`, params);
  // v0.22.8：广场列表一律裁剪私密字段（real_name/credential_image/wechat/email 置空不解密）——
  // 对齐前端文档化契约「列表接口永不下发」（app-teachers.js:171 注释），私密字段仅经
  // /api/teacher/profile 定点取回（该端点按 本人/双向匹配 门控，未匹配 403）。
  // 收益：列表免逐行 AES 解密 + payload 瘦身（含 base64 学信网截图）+ 数据最小化。
  return await Promise.all(profiles.map(p => mapTeacherProfileRow(p, { private: false })));
}

async function dbUpdateTeacherRating(db, teacherUserId, rating, count, sum) {
  await dbRun(db,
    'UPDATE teacher_profiles SET rating=?, rating_count=?, rating_sum=? WHERE user_id=?',
    [rating, count, sum, teacherUserId]);
}

// 学籍认证：管理员审核通过/撤销教师认证（运营建议——「真实可验证在校生」信任锚点）
export async function dbSetTeacherVerified(db, userId, verified) {
  await dbRun(db, 'UPDATE teacher_profiles SET verified=? WHERE user_id=?', [verified ? 1 : 0, userId]);
}

// ============================================================
// 学生需求
// ============================================================
export async function dbCreateDemand(db, userId, demand) {
  // address_detail（详细门牌号）已因合规原因停用：不再收集、不再写入，列保留但恒为空
  // display_id：对外需求编号（四位，按生成顺序自 0001 起），子查询取号保证顺序单调
  // 网安报告 F-06：parent_contact/student_contact 加密落库（联系方式是需求最高敏字段）
  const [parentContact, studentContact] = await Promise.all([encryptField(demand.parent_contact), encryptField(demand.student_contact)]);
  const result = await dbRun(db, `INSERT INTO student_demands
    (user_id,province,student_grade,student_gender,target_subjects,current_scores,
     teaching_method,address,expected_time,budget_min,budget_max,
     submitter_type,parent_contact,student_contact,additional_info,display_id,
     target_type,preferred_personality_tags,preferred_teacher_gender)
    VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?, (SELECT COALESCE(MAX(display_id),0)+1 FROM student_demands),
      ?,?,?)`, [
    userId, demand.province || '', demand.student_grade, demand.student_gender,
    JSON.stringify(demand.target_subjects), JSON.stringify(demand.current_scores),
    demand.teaching_method || 'offline', demand.address || '', demand.expected_time || '',
    demand.budget_min || 0, demand.budget_max || 0,
    demand.submitter_type, parentContact, studentContact, demand.additional_info || '',
    demand.target_type || 'academic',
    JSON.stringify(Array.isArray(demand.preferred_personality_tags) ? demand.preferred_personality_tags : []),
    demand.preferred_teacher_gender || '',
  ]);
  return Number(result.meta.last_row_id);
}

// 需求列表统一查询：JOIN 用户名 + LEFT JOIN 聚合出意向计数（向后兼容的附加字段）
const DEMANDS_SELECT = `SELECT sd.*, u.username, u.avatar, COALESCE(ic.cnt, 0) AS intent_count,
    COALESCE(ic.pending, 0) AS pending_intents
  FROM student_demands sd JOIN users u ON sd.user_id=u.id
  LEFT JOIN (SELECT demand_id, COUNT(*) AS cnt,
      SUM(CASE WHEN status='pending' THEN 1 ELSE 0 END) AS pending
    FROM demand_intents GROUP BY demand_id) ic
    ON ic.demand_id=sd.id`;

// 需求行默认脱敏出口：parent_contact/student_contact（产品规则：签约后才向对方展示，服务端硬把关）、
// address_detail（详细门牌号，合规停用）一律在此剥除，任何走 mapper 的出口都拿不到联系方式。
// 需要联系方式的场景（本人「我的需求」、管理员全量）显式用 mapDemandRowFull。
function mapDemandRow(r) {
  // 警示：...rest 透传 student_demands 全部其余列——未来新增敏感列必须在此显式剥除，否则默认外泄
  const { parent_contact, student_contact, address_detail, ...rest } = r;
  return {
    ...rest,
    target_subjects: safeJsonArray(r.target_subjects),
    current_scores: safeJsonArray(r.current_scores),
    // R2-b：偏好老师性格 JSON 列单点反序列化（target_type/preferred_teacher_gender 随 rest 透传）
    preferred_personality_tags: safeJsonArray(r.preferred_personality_tags),
  };
}

// 含联系方式变体：仅「本人需求」与「管理员全量」两处显式调用（归属/角色已由调用方校验）。
// 网安报告 F-06：联系方式加密列，出门即解密（调用方均为 async）
async function mapDemandRowFull(r) {
  const [parentContact, studentContact] = await Promise.all([decryptField(r.parent_contact), decryptField(r.student_contact)]);
  return { ...mapDemandRow(r), parent_contact: parentContact || '', student_contact: studentContact || '' };
}

// 需求列表统一出口（v0.19.40 合并 dbGetAllDemands / dbGetAllDemandsAdmin）：
// 广场（默认）：status NOT IN (contracted,revoked)，传 teacherUserId 时附该教师的意向状态
// （my_intent_status，供前端按钮三态渲染）；admin：管理员全量（含已签约，管理端查看联系方式）
export async function dbGetDemands(db, { admin = false, cursor = null, teacherUserId = null, forGuest = false } = {}) {
  if (admin) {
    // 网安报告 F-09：keyset 游标分页（created_at,id 复合倒序；游标=末行编码，前端以 nextCursor 翻页）。
    // LIMIT 取 PAGE_HAS_MORE 判 hasMore，不额外查询；页大小单源自 constants.LIMITS
    const params = [];
    let where = '';
    if (cursor) {
      const [cCreated, cId] = String(cursor).split('|');
      if (cCreated && cId) {
        where = ' WHERE (sd.created_at < ? OR (sd.created_at = ? AND sd.id < ?))';
        params.push(cCreated, cCreated, parseInt(cId, 10) || 0);
      }
    }
    const rows = await dbAll(db,
      `SELECT sd.*, u.username, u.avatar FROM student_demands sd JOIN users u ON u.id=sd.user_id${where}
       ORDER BY sd.created_at DESC, sd.id DESC LIMIT ${LIMITS.PAGE_HAS_MORE}`, params);
    const hasMore = rows.length > LIMITS.PAGE_SIZE;
    const page = hasMore ? rows.slice(0, LIMITS.PAGE_SIZE) : rows;
    const last = page.length ? page[page.length - 1] : null;
    return {
      demands: await Promise.all(page.map(mapDemandRowFull)), // 管理员：管理端查看联系方式；F-06 解密为 async
      nextCursor: hasMore && last ? `${last.created_at}|${last.id}` : null,
    };
  }
  let sel = DEMANDS_SELECT, extra = '', params = [], where = ` WHERE sd.status='open' AND u.deactivated=0`;
  if (teacherUserId) {
    sel = DEMANDS_SELECT.replace('COALESCE(ic.cnt, 0) AS intent_count',
      'COALESCE(ic.cnt, 0) AS intent_count, mi.status AS my_intent_status');
    extra = ' LEFT JOIN demand_intents mi ON mi.demand_id=sd.id AND mi.teacher_user_id=?';
    params = [teacherUserId];
  }
  // #163（v0.25.71）：访客可见性——未登录游客只看 allow_guest_demand=1 的需求（无 user_settings 行=默认可见）
  if (forGuest) {
    extra += ' LEFT JOIN user_settings us ON us.user_id=sd.user_id';
    where += ' AND COALESCE(us.allow_guest_demand, 1) = 1';
  }
  // 广场只展示活跃需求（v0.25.10 用户反馈：统一口径 status='open'——此前排除式 NOT IN ('contracted','revoked')
  // 会把未来新增状态/NULL 当活跃，与 dbCreatePush/dbCreateIntent 的原子守卫（WHERE status='open'）口径漂移）
  // v0.25.41（注销幽灵数据）：广场门控——已注销用户数据严禁入场（不依赖 purge 完整性，双保险）
  const rows = await dbAll(db, sel + extra + where + ' ORDER BY sd.created_at DESC LIMIT ?',
    [...params, LIMITS.PUBLIC_LIST_MAX]);
  return rows.map(mapDemandRow);
}

export async function dbGetDemandsByUser(db, userId) {
  // #157（v0.25.65）：我的需求已签约沉底——contract 需求不再与开放需求按时间穿插，
  // 活跃需求优先（可按创建时间排），已签约的堆列表最下；revoked 仍可重开，归活跃侧。
  const rows = await dbAll(db, DEMANDS_SELECT +
    ` WHERE sd.user_id=? ORDER BY CASE WHEN sd.status='contracted' THEN 1 ELSE 0 END, sd.created_at DESC`, [userId]);
  return await Promise.all(rows.map(mapDemandRowFull)); // 本人「我的需求」：编辑回填需要联系方式；F-06 解密为 async
}

// 单条需求也走 mapper（与列表同形状；调用方统一拿数组字段，裸行分叉已消灭）
// 单条需求：出口经 mapDemandRow（与列表 dbGetDemands 同 mapper，形状一致：路由层零 JSON.parse、
// mapper 出口剥私密字段；price 保留 null 语义）。契约注释补记（v0.25.84 v0.21 审计遗留）
export async function dbGetDemandById(db, id) {
  const row = await dbGet(db, 'SELECT * FROM student_demands WHERE id=?', [id]);
  return row ? mapDemandRow(row) : null;
}

export async function dbUpdateDemand(db, id, d) {
  // 网安报告 F-06：联系方式加密落库（与 dbCreateDemand 同款加密）
  const [parentContact, studentContact] = await Promise.all([encryptField(d.parent_contact), encryptField(d.student_contact)]);
  await dbRun(db, `UPDATE student_demands SET province=?,student_grade=?,student_gender=?,
    target_subjects=?,current_scores=?,teaching_method=?,address=?,expected_time=?,address_detail='',
    budget_min=?,budget_max=?,submitter_type=?,parent_contact=?,student_contact=?,
    additional_info=?,target_type=?,preferred_personality_tags=?,preferred_teacher_gender=? WHERE id=?`, [
    d.province || '', d.student_grade, d.student_gender,
    JSON.stringify(d.target_subjects), JSON.stringify(d.current_scores),
    d.teaching_method || 'offline', d.address || '', d.expected_time || '',
    d.budget_min || 0, d.budget_max || 0,
    d.submitter_type, parentContact, studentContact, d.additional_info || '',
    d.target_type || 'academic',
    JSON.stringify(Array.isArray(d.preferred_personality_tags) ? d.preferred_personality_tags : []),
    d.preferred_teacher_gender || '', id,
  ]);
}

// 删除需求：数据层强制保护——只要存在 pending/signing/signed 合同引用该需求，即返回 false（调用方拒绝删除）。
// 悬空 demand_id 曾导致签约 410 后合同仍 signed 的线上事故（网安报告 F-03b），此门禁在 db.js 单点收口。
export async function dbDeleteDemand(db, id) {
  // 原子守卫（替代 check-then-delete）：DELETE 携带 NOT EXISTS(活跃合同引用)，
  // 并发起草窗口内合同先落库则本删除不命中→false，杜绝悬空 demand_id（F-03b）
  const r = await dbRun(db,
    `DELETE FROM student_demands WHERE id=? AND NOT EXISTS (
      SELECT 1 FROM contracts WHERE demand_id=? AND status IN ('pending','signing','signed'))`, [id, id]);
  if (!(r && r.meta && r.meta.changes > 0)) return false;
  // demand_intents 经外键 ON DELETE CASCADE 级联清理，无需显式删（原冗余 DELETE 已删，避免误导读者以为级联不存在）
  return true;
}

// 需求重开（revoked→open）：条件 UPDATE 赢家模式，返回是否命中（防并发双触发）。
// 同时复位意向锁 intent_locked（网安审计：锁只置位不复位，撤销→重开→重收意向流程会永久断裂）
export async function dbReopenDemand(db, id) {
  const r = await dbRun(db, `UPDATE student_demands SET status='open', intent_locked=0 WHERE id=? AND status='revoked'`, [id]);
  return !!(r && r.meta && r.meta.changes > 0);
}

// 需求意向单接受锁：条件 UPDATE 抢占（intent_locked 0→1），赢家才继续。
// 防并发 accept 两条意向产生双 accepted + 双会话（审计发现的聚合不变量缺口）
// ============================================================
// 需求主动推送（学生 → 指定教师）
// ============================================================
// 推送创建原子化（网安审计 TOCTOU：同 dbCreateIntent，仅当需求 status='open' 才插入；changes=0 返回 0）
export async function dbCreatePush(db, demandId, studentUserId, teacherUserId) {
  const r = await dbRun(db,
    `INSERT INTO demand_pushes (demand_id, student_user_id, teacher_user_id)
     SELECT ?, ?, ? FROM student_demands WHERE id=? AND status='open'`,
    [demandId, studentUserId, teacherUserId, demandId]);
  return (r && r.meta && r.meta.changes > 0) ? Number(r.meta.last_row_id) : 0;
}

// 某教师待处理推送（含需求全字段 + 学生用户名），供需求大厅置顶 + 红点计数
export async function dbGetPendingPushesForTeacher(db, teacherUserId) {
  const rows = await dbAll(db, `SELECT dp.id AS push_id, dp.status AS push_status, dp.created_at AS push_created_at,
      sd.*, u.username
    FROM demand_pushes dp
    JOIN student_demands sd ON sd.id=dp.demand_id
    JOIN users u ON u.id=sd.user_id
    WHERE dp.teacher_user_id=? AND dp.status='pending' AND u.deactivated=0 -- v0.25.41 门控：已注销学生推送不进场
    ORDER BY dp.created_at DESC`, [teacherUserId]);
  return rows.map(mapDemandRow); // push_* 字段随 rest 透传
}

export async function dbGetPushById(db, pushId) {
  return await dbGet(db, 'SELECT * FROM demand_pushes WHERE id=?', [pushId]);
}

// 条件 UPDATE + changes 判定：并发双触发时仅一个请求 changes>0（赢家），副作用只由赢家执行
export async function dbResolvePush(db, pushId, status) {
  const res = await dbRun(db, `UPDATE demand_pushes SET status=? WHERE id=? AND status='pending'`, [status, pushId]);
  return !!(res && res.meta && res.meta.changes > 0);
}

// 某需求的全部待处理推送（签约自动下架时系统批量拒绝用；逐条留档在调用方循环内）
export async function dbGetPendingPushesForDemand(db, demandId) {
  return await dbAll(db,
    `SELECT id, teacher_user_id FROM demand_pushes WHERE demand_id=? AND status='pending'`, [demandId]);
}

// 推送被教师确认：写一条「已接受」意向（复用学生端意向/会话视图）+ 由路由层建立会话。
// DO UPDATE 覆写守卫：学生对意向的明确拒绝（status='rejected'）不可被推送确认静默撤销
export async function dbAcceptPushAsIntent(db, demandId, teacherUserId) {
  await dbRun(db, `INSERT INTO demand_intents (demand_id,teacher_user_id,status,resolved_at)
      VALUES (?,?,'accepted',datetime('now','localtime'))
    ON CONFLICT(demand_id,teacher_user_id) DO UPDATE SET status='accepted', resolved_at=datetime('now','localtime')
      WHERE demand_intents.status <> 'rejected'`,
    [demandId, teacherUserId]);
}

// ============================================================
// 意向
// ============================================================
// 意向创建原子化（网安审计 TOCTOU：路由层先查需求状态再 INSERT 存在窗口——查询与插入之间需求被签约/撤销，
// 意向会落在已关闭需求上。改为条件 INSERT：仅当需求 status='open' 才插入，changes=0 即需求非开放，
// 调用方据返回 0 判定 410）。UNIQUE(demand_id, teacher_user_id) 冲突仍抛错由路由转 409
export async function dbCreateIntent(db, demandId, teacherUserId) {
  const result = await dbRun(db,
    `INSERT INTO demand_intents (demand_id, teacher_user_id)
     SELECT ?, ? FROM student_demands WHERE id=? AND status='open'`,
    [demandId, teacherUserId, demandId]);
  return (result && result.meta && result.meta.changes > 0) ? Number(result.meta.last_row_id) : 0;
}

export async function dbGetIntentTeachers(db, demandId) {
  const rows = await dbAll(db, `SELECT tp.*, di.teacher_user_id AS user_id, u.username,
      di.id AS intent_id, di.status AS intent_status, di.created_at AS intent_created_at
    FROM demand_intents di
    JOIN users u ON u.id=di.teacher_user_id
    LEFT JOIN teacher_profiles tp ON tp.user_id=di.teacher_user_id
    WHERE di.demand_id=? AND u.deactivated=0 -- v0.25.41 门控：已注销教师意向不进场
    ORDER BY di.created_at DESC`, [demandId]);
  // 附加意向自身字段（id/状态/时间），供学生端同意/拒绝按钮使用
  // 出口剥私密字段（mapper 出口剥私密字段契约，v0.19.40 自路由层内收）：
  // 联系方式签约后展示；真实姓名/学信网截图仅双向匹配后按档案端点定点取
  return (await Promise.all(rows.map(async r => ({
    ...(await mapTeacherProfileRow(r)),
    intent_id: r.intent_id, intent_status: r.intent_status, intent_created_at: r.intent_created_at,
  })))).map(({ wechat, email, real_name, credential_image, matched, ...rest }) => rest);
}

export async function dbGetIntentWithDemand(db, intentId) {
  return await dbGet(db, `SELECT di.*, sd.user_id AS demand_owner
    FROM demand_intents di JOIN student_demands sd ON sd.id=di.demand_id
    WHERE di.id=?`, [intentId]);
}

export async function dbResolveIntent(db, intentId, status) {
  const res = await dbRun(db,
    "UPDATE demand_intents SET status=?, resolved_at=datetime('now','localtime') WHERE id=? AND status='pending'",
    [status, intentId]);
  return !!(res && res.meta && res.meta.changes > 0); // 仅赢家（changes>0）执行建会话/通知等副作用
}

// 某需求的全部待处理意向（签约自动下架时系统批量拒绝用；逐条留档在调用方循环内）
export async function dbGetPendingIntentsForDemand(db, demandId) {
  return await dbAll(db,
    `SELECT id, teacher_user_id FROM demand_intents WHERE demand_id=? AND status='pending'`, [demandId]);
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
  // v0.25.41 门控：已注销评价者/被评教师的数据不对外（教师注销后评价行保留留档，但不再经此公开出口）
  return await dbAll(db, `SELECT r.*, u.username as reviewer_name
    FROM reviews r JOIN users u ON r.reviewer_user_id=u.id
    WHERE r.teacher_user_id=? AND r.status='approved'
      AND u.deactivated=0
      AND EXISTS (SELECT 1 FROM users u2 WHERE u2.id=r.teacher_user_id AND u2.deactivated=0)
    ORDER BY r.created_at DESC LIMIT ${LIMITS.REVIEW_LIST_MAX}`,
    [teacherUserId]); // 防全表返回（面板滚动查看；上限单源自 constants.LIMITS）
}

// 某学生对某教师的自有评价（任意状态；「已有评价只能修改」与编辑回填用）
export async function dbGetReviewByPair(db, reviewerUserId, teacherUserId) {
  return await dbGet(db, 'SELECT * FROM reviews WHERE reviewer_user_id=? AND teacher_user_id=?',
    [reviewerUserId, teacherUserId]);
}

// 修改评价：重置为待审核（内容变更须重审）
// 网安审计 N-09：若原评价已通过（评分已计入教师 rating_sum/count），修改时立即摘除旧贡献——
// 否则「通过→改→被管理员拒绝」路径下 wasApproved=false 不再重算，教师评分永久残留旧版本贡献。
// 摘除 = 对本评价落 pending 后重算该教师评分（重算只统计 approved 评价，旧贡献自然出局）。
export async function dbUpdateReview(db, reviewId, rating, comment) {
  const existing = await dbGetReviewById(db, reviewId);
  const teacherUserId = existing && existing.teacher_user_id;
  const wasApproved = !!(existing && existing.status === STATUS.APPROVED);
  await dbRun(db,
    'UPDATE reviews SET rating=?, comment=?, status=\'pending\', reviewed_at=NULL, reviewed_by=NULL WHERE id=?',
    [rating, comment, reviewId]);
  if (wasApproved && teacherUserId) await dbRecomputeTeacherRating(db, teacherUserId);
}

// 签约门槛查询：该师生会话存在已签约合同（文档或 v0.24.0 发起签约请求）即放行评价
export async function dbIsContracted(db, studentUserId, teacherUserId) {
  return !!(await dbGet(db,
    `SELECT 1 FROM conversations c
     WHERE c.student_user_id=? AND c.teacher_user_id=?
       AND (EXISTS(SELECT 1 FROM contracts ct WHERE ct.conversation_id=c.id AND ct.status='signed')
         OR EXISTS(SELECT 1 FROM signing_requests sr WHERE sr.conversation_id=c.id AND sr.status='signed'))
     LIMIT 1`,
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

async function dbGetApprovedReviewStats(db, teacherUserId) {
  return await dbGet(db, `SELECT COUNT(*) as cnt, COALESCE(SUM(rating),0) as total
    FROM reviews WHERE teacher_user_id=? AND status='approved'`, [teacherUserId]);
}

// ============================================================
// 帖子（模块2：资料共享广场）
// ============================================================
// LIKE 通配符转义：让用户输入中的 % 与 _ 按字面匹配
function likeEscape(s) {
  return String(s).replace(/[\\%_]/g, c => '\\' + c);
}

// 帖子列表：LEFT JOIN users 取作者名；viewerId 有值时 LEFT JOIN post_likes / post_favorites
// 产出 liked / favorited 布尔，否则恒 0。
// section 不传 = 不过滤（分区预留）；q 对 title + body_md 做 LIKE 模糊匹配；
// sort: new=时间倒序（默认）；hot=like_count 倒序、同值时间倒序
export async function dbListPosts(db, { section, q, viewerId, sort } = {}) {
  const cond = [], params = [];
  // v0.25.41（注销幽灵数据）：广场门控——已注销用户帖子严禁入场（LEFT JOIN 下该条件等效丢弃墓碑作者行）
  cond.push('u.deactivated = 0');
  if (section) { cond.push('p.section = ?'); params.push(section); }
  if (q) {
    cond.push("(p.title LIKE ? ESCAPE '\\' OR p.body_md LIKE ? ESCAPE '\\')");
    const w = '%' + likeEscape(q) + '%';
    params.push(w, w);
  }
  const where = cond.length ? ' WHERE ' + cond.join(' AND ') : '';
  const order = sort === 'hot'
    ? 'p.like_count DESC, p.created_at DESC, p.id DESC'
    : 'p.created_at DESC, p.id DESC';
  const hasViewer = !!viewerId;
  const join = hasViewer
    ? `LEFT JOIN post_likes pl ON pl.post_id = p.id AND pl.user_id = ?
       LEFT JOIN post_favorites pf ON pf.post_id = p.id AND pf.user_id = ?`
    : '';
  const sel = hasViewer ? '(pl.id IS NOT NULL) AS liked, (pf.id IS NOT NULL) AS favorited' : '0 AS liked, 0 AS favorited';
  const bind = hasViewer ? [viewerId, viewerId, ...params] : params;
  const rows = await dbAll(db,
    `SELECT p.id, p.user_id, p.section, p.title, p.body_md, p.like_count,
            p.created_at, p.updated_at, u.username, ${sel}
     FROM posts p
     LEFT JOIN users u ON u.id = p.user_id
     ${join}${where}
     ORDER BY ${order} LIMIT ?`, [...bind, LIMITS.PUBLIC_LIST_MAX]);
  return rows.map(r => ({ ...r, liked: !!r.liked, favorited: !!r.favorited }));
}

// 我的收藏帖子列表（R23）：仅本人收藏，按收藏时间倒序；已注销作者帖子不入场。
// 复用广场卡渲染字段集（id/title/body_md/like_count/username/created_at/liked/favorited）
export async function dbListMyFavoritePosts(db, userId) {
  const rows = await dbAll(db,
    `SELECT p.id, p.user_id, p.section, p.title, p.body_md, p.like_count, p.created_at, p.updated_at,
            u.username, (pl.id IS NOT NULL) AS liked, 1 AS favorited
     FROM post_favorites pf
     JOIN posts p ON p.id = pf.post_id
     LEFT JOIN users u ON u.id = p.user_id
     LEFT JOIN post_likes pl ON pl.post_id = p.id AND pl.user_id = ?
     WHERE pf.user_id = ? AND u.deactivated = 0
     ORDER BY pf.created_at DESC, pf.id DESC LIMIT ?`,
    [userId, userId, LIMITS.PUBLIC_LIST_MAX]);
  return rows.map(r => ({ ...r, liked: !!r.liked, favorited: true }));
}

export async function dbGetPostFavorite(db, postId, userId) {
  return await dbGet(db, 'SELECT id FROM post_favorites WHERE post_id=? AND user_id=?', [postId, userId]);
}

export async function dbCreatePostFavorite(db, postId, userId) {
  await dbRun(db, 'INSERT INTO post_favorites (post_id, user_id) VALUES (?,?)', [postId, userId]);
}

export async function dbDeletePostFavorite(db, favoriteId) {
  await dbRun(db, 'DELETE FROM post_favorites WHERE id=?', [favoriteId]);
}

export async function dbCreatePost(db, userId, title, bodyMd) {
  const result = await dbRun(db,
    "INSERT INTO posts (user_id, section, title, body_md) VALUES (?, 'plaza', ?, ?)",
    [userId, title, bodyMd]);
  return Number(result.meta.last_row_id);
}

export async function dbGetPostById(db, postId) {
  return await dbGet(db, 'SELECT id, user_id, title FROM posts WHERE id=?', [postId]);
}

export async function dbGetPostLike(db, postId, userId) {
  return await dbGet(db, 'SELECT id FROM post_likes WHERE post_id=? AND user_id=?', [postId, userId]);
}

export async function dbCreatePostLike(db, postId, userId) {
  await dbRun(db, 'INSERT INTO post_likes (post_id, user_id) VALUES (?,?)', [postId, userId]);
}

export async function dbDeletePostLike(db, likeId) {
  await dbRun(db, 'DELETE FROM post_likes WHERE id=?', [likeId]);
}

// 以 COUNT 为唯一事实源同步计数，杜绝 like_count 增减漂移
export async function dbSyncPostLikeCount(db, postId) {
  await dbRun(db,
    'UPDATE posts SET like_count = (SELECT COUNT(*) FROM post_likes WHERE post_id=?) WHERE id=?',
    [postId, postId]);
}

export async function dbGetPostLikeCount(db, postId) {
  const row = await dbGet(db, 'SELECT like_count FROM posts WHERE id=?', [postId]);
  return row?.like_count || 0;
}

// post_likes 由外键 ON DELETE CASCADE 连带清理，无需手工删
export async function dbDeletePost(db, postId) {
  await dbRun(db, 'DELETE FROM posts WHERE id=?', [postId]);
}

// ============================================================
// 用户反馈（关于平台模块）
// ============================================================
export async function dbCreateFeedback(db, userId, kind, title, content, subject = '') {
  const res = await dbRun(db,
    'INSERT INTO feedbacks (user_id, kind, title, content, subject) VALUES (?,?,?,?,?)',
    [userId, kind, title, content, subject]);
  return (res && res.meta && res.meta.last_row_id) || 0;
}

// #165（v0.25.73）：我的反馈/投诉列表——用户侧状态跟踪闭环（本人可见，无他人数据）
export async function dbGetFeedbacksByUser(db, userId) {
  return await dbAll(db, `SELECT * FROM feedbacks WHERE user_id=? ORDER BY id DESC LIMIT ${LIMITS.FEEDBACK_MINE_MAX}`, [userId]);
}

export async function dbGetFeedbacksAdmin(db, status) {
  // 可选 status 下推过滤（白名单，防注入）；不传则返回全部。
  // feedbacks.status 合法值仅 'open'/'resolved'（曾误用 'pending' 致「未处理」过滤恒空，已修）
  const where = (status === 'open' || status === 'resolved') ? ' WHERE f.status=?' : '';
  const params = where ? [status] : [];
  return await dbAll(db,
    'SELECT f.*, u.username FROM feedbacks f JOIN users u ON u.id = f.user_id' + where + ` ORDER BY f.id DESC LIMIT ${LIMITS.FEEDBACK_ADMIN_MAX}`, params);
}

export async function dbGetFeedbackById(db, feedbackId) {
  return await dbGet(db, 'SELECT * FROM feedbacks WHERE id=?', [feedbackId]);
}

export async function dbResolveFeedback(db, feedbackId) {
  await dbRun(db, `UPDATE feedbacks SET status='resolved' WHERE id=?`, [feedbackId]);
}

// ============================================================
// R22 投诉独立通道（与 feedbacks 分表分通道；仅外层接口接管理员临时通路）
// ============================================================
export async function dbCreateComplaint(db, userId, targetType, targetId, snapshot, reason, detail) {
  const res = await dbRun(db,
    'INSERT INTO complaints (user_id, target_type, target_id, target_snapshot, reason, detail) VALUES (?,?,?,?,?,?)',
    [userId, targetType, targetId, JSON.stringify(snapshot), reason, detail]);
  return (res && res.meta && res.meta.last_row_id) || 0;
}

// 今日投诉计数（防滥用：COMPLAINT_DAILY_LIMIT/日）
export async function dbCountComplaintsToday(db, userId) {
  const row = await dbGet(db,
    `SELECT COUNT(*) AS c FROM complaints WHERE user_id=? AND date(created_at)=date('now','localtime')`, [userId]);
  return (row && row.c) || 0;
}

// 我的投诉（状态跟踪闭环；target_snapshot 单点反序列化）
export async function dbGetComplaintsByUser(db, userId) {
  const rows = await dbAll(db, `SELECT * FROM complaints WHERE user_id=? ORDER BY id DESC LIMIT ${LIMITS.COMPLAINT_MINE_MAX}`, [userId]);
  return rows.map(mapComplaint);
}

export async function dbGetComplaintsAdmin(db, status) {
  const where = (status === 'open' || status === 'resolved') ? ' WHERE c.status=?' : '';
  const params = where ? [status] : [];
  const rows = await dbAll(db,
    'SELECT c.*, u.username AS reporter FROM complaints c JOIN users u ON u.id = c.user_id' + where
    + ` ORDER BY c.id DESC LIMIT ${LIMITS.COMPLAINT_ADMIN_MAX}`, params);
  return rows.map(mapComplaint);
}

function mapComplaint(row) {
  let snapshot = {};
  try { snapshot = JSON.parse(row.target_snapshot || '{}'); } catch { snapshot = {}; }
  return { ...row, target_snapshot: snapshot };
}

export async function dbGetComplaintById(db, complaintId) {
  const row = await dbGet(db, 'SELECT * FROM complaints WHERE id=?', [complaintId]);
  return row ? mapComplaint(row) : null;
}

export async function dbResolveComplaint(db, complaintId) {
  await dbRun(db, `UPDATE complaints SET status='resolved', resolved_at=datetime('now','localtime') WHERE id=?`, [complaintId]);
}

// —— 投诉对象候选：按角色搜用户（id 精确 / 昵称模糊），排除自己 ——
export async function dbSearchUsersByRole(db, role, q, excludeId, limit = LIMITS.COMPLAINT_CANDIDATE_MAX) {
  const num = /^\d+$/.test(q) ? +q : 0;
  const like = `%${q}%`;
  return await dbAll(db,
    `SELECT id, username, role FROM users WHERE role=? AND id<>? AND (username LIKE ? OR (? > 0 AND id = ?))
     ORDER BY id DESC LIMIT ${limit}`, [role, excludeId, like, num, num]);
}

// 最近交互用户（会话另一侧；type='teacher' 对教师 / 'student' 对学生；按最近消息时间排序）
export async function dbRecentInteractions(db, userId, role, limit = LIMITS.COMPLAINT_CANDIDATE_MAX) {
  return await dbAll(db,
    `SELECT u.id, u.username, u.role, MAX(m.created_at) AS last_at
     FROM conversations c
     JOIN users u ON u.id = CASE WHEN c.student_user_id=? THEN c.teacher_user_id ELSE c.student_user_id END
     JOIN messages m ON m.conversation_id = c.id
     WHERE (c.student_user_id=? OR c.teacher_user_id=?) AND u.role=?
     GROUP BY u.id ORDER BY last_at DESC LIMIT ${limit}`,
    [userId, userId, userId, role]);
}

// 帖子候选：按标题模糊 / id 精确
export async function dbSearchPosts(db, q, limit = LIMITS.COMPLAINT_CANDIDATE_MAX) {
  const num = /^\d+$/.test(q) ? +q : 0;
  const like = `%${q}%`;
  return await dbAll(db,
    `SELECT id, title, user_id FROM posts WHERE title LIKE ? OR (? > 0 AND id = ?)
     ORDER BY id DESC LIMIT ${limit}`, [like, num, num]);
}

// ============================================================
// 管理员统计
// ============================================================
export async function dbGetUserStats(db) {
  return await dbGet(db, `SELECT COUNT(*) as total,
    SUM(CASE WHEN role='student' THEN 1 ELSE 0 END) as students,
    SUM(CASE WHEN role='teacher' THEN 1 ELSE 0 END) as teachers FROM users`);
}

// 网安审计 N-17：表名白名单映射（消除调用方拼表名进 SQL 的注入形状；未知表返回 0 不炸）
const COUNT_TABLES = { teacher_profiles: 1, student_demands: 1 };
export async function dbGetCount(db, table) {
  if (!COUNT_TABLES[table]) return 0;
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

export async function dbGetRecentUsers(db, limit = LIMITS.RECENT_LIMIT) {
  return await dbAll(db, 'SELECT id,username,role,created_at FROM users ORDER BY created_at DESC LIMIT ?', [limit]);
}

export async function dbGetRecentDemands(db, limit = LIMITS.RECENT_LIMIT) {
  // R2-b：含 target_type，管理端统计「最近需求」按学科/非学科显示对应目标名
  const rows = await dbAll(db, `SELECT sd.id,sd.student_grade,sd.target_subjects,sd.target_type,sd.created_at,u.username
    FROM student_demands sd JOIN users u ON sd.user_id=u.id ORDER BY sd.created_at DESC LIMIT ?`, [limit]);
  return rows.map(d => ({ ...d, target_subjects: safeJsonArray(d.target_subjects) }));
}

// ============================================================
// 管理员用户管理
// ============================================================
// 学生列表：LEFT JOIN 统计需求数
export async function dbGetStudentUsersAdmin(db) {
  return await dbAll(db, `SELECT u.id,u.username,u.role,u.banned,u.created_at,COUNT(sd.id) AS demand_count
    FROM users u LEFT JOIN student_demands sd ON sd.user_id=u.id
    WHERE u.role='student' GROUP BY u.id ORDER BY u.created_at DESC`);
}

// ============================================================
// 合同（纯数据层取行；状态机关口在 server/contract.js）
// ============================================================
// 网安 N-05：contract_md 加密列，出门即解密（写点加密在 server/contract.js；老明文行经 decryptField 原样放行）
export async function dbGetContractById(db, id) {
  const row = await dbGet(db, 'SELECT * FROM contracts WHERE id=?', [id]);
  if (row) row.contract_md = await decryptField(row.contract_md);
  return row;
}

// v0.25.57 需求四十九：dbGetContractByConv 已连根拔——会话级查任意状态合同过宽（把已拒绝/已撤销历史合同
// 当「进行中」，阻塞重新起草）；「一条需求一份合同」由需求级门禁（status IN pending/signing/signed）把关。
// 我参与的合同列表（含双方用户名 + 需求编号，「我的合同」页用）
export async function dbGetMyContracts(db, userId) {
  const rows = await dbAll(db, `SELECT ct.*, c.student_user_id, c.teacher_user_id,
      us.username AS student_name, ut.username AS teacher_name, sd.display_id AS demand_display_id
    FROM contracts ct
    JOIN conversations c ON c.id = ct.conversation_id
    JOIN users us ON us.id = c.student_user_id
    JOIN users ut ON ut.id = c.teacher_user_id
    LEFT JOIN student_demands sd ON sd.id = ct.demand_id
    WHERE c.student_user_id = ? OR c.teacher_user_id = ?
    ORDER BY ct.updated_at DESC`, [userId, userId]);
  for (const r of rows) {
    r.contract_md = await decryptField(r.contract_md); // N-05：合同正文加密列出门解密
    if (r.prev_business) r.prev_business = await decryptField(r.prev_business); // v0.24.0 留痕 diff 基线
  }
  return rows;
}

// 管理员全量合同列表（含双方用户名 + 起草者用户名；管理员合同页用）
export async function dbGetAllContractsAdmin(db) {
  const rows = await dbAll(db, `SELECT ct.*, c.student_user_id, c.teacher_user_id,
      us.username AS student_name, ut.username AS teacher_name, du.username AS drafter_name
    FROM contracts ct
    JOIN conversations c ON c.id = ct.conversation_id
    JOIN users us ON us.id = c.student_user_id
    JOIN users ut ON ut.id = c.teacher_user_id
    JOIN users du ON du.id = ct.drafter_user_id
    ORDER BY ct.updated_at DESC`);
  for (const r of rows) {
    r.contract_md = await decryptField(r.contract_md); // N-05：合同正文加密列出门解密
    if (r.prev_business) r.prev_business = await decryptField(r.prev_business); // v0.24.3：与 dbGetMyContracts 同口径，管理员改动对比可用
  }
  return rows;
}

// 删除合同行。statuses 非空时仅删该状态集内的行（取消签约的并发守卫：翻到 signed/revoked 的行拒删）。
// 返回原生 result：调用方凭 meta.changes 判定赢家
// （并发双撤销/双取消/管理员删除场景仅 changes>0 的一方执行通知/留档等副作用）
export async function dbDeleteContract(db, contractId, statuses = null) {
  if (!statuses || !statuses.length) return dbRun(db, 'DELETE FROM contracts WHERE id=?', [contractId]);
  const q = statuses.map(() => '?').join(',');
  return dbRun(db, `DELETE FROM contracts WHERE id=? AND status IN (${q})`, [contractId, ...statuses]);
}

// 清会话内的合同系统气泡（撤销合同步双方聊天窗；kind='contract' 仅合同事件消息）
export async function dbDeleteContractMessages(db, conversationId) {
  await dbRun(db, `DELETE FROM messages WHERE conversation_id=? AND kind='contract'`, [conversationId]);
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
    'SELECT id, demand_id FROM conversations WHERE student_user_id=? AND teacher_user_id=?',
    [studentUserId, teacherUserId]);
  // INSERT OR IGNORE 命中既有会话时不更新任何列——旧会话 demand_id 为空必须回填，
  // 否则教师起草合同选不到需求（会话需求绑定丢失事故根因）
  if (row && !row.demand_id && demandId) {
    await dbRun(db, 'UPDATE conversations SET demand_id=? WHERE id=?', [demandId, row.id]);
  }
  return row?.id || null;
}

export async function dbGetConversationById(db, id) {
  return await dbGet(db, 'SELECT * FROM conversations WHERE id=?', [id]);
}

// 会话行 + 双方用户名（合同模块的通知文案 / 对方判定 helper 共用；student_name/teacher_name 随行附带）
export async function dbGetConversationWithNames(db, conversationId) {
  return await dbGet(db, `SELECT c.*, us.username AS student_name, ut.username AS teacher_name
    FROM conversations c
    JOIN users us ON us.id = c.student_user_id
    JOIN users ut ON ut.id = c.teacher_user_id
    WHERE c.id = ?`, [conversationId]);
}

// 会话可绑定需求下拉单源（需求四·第2/3条：发起签约 / 起草合同共用）：
//   phase='signing'   会话学生方「开放」需求（可发起签约）
//   phase='contract'  会话学生方「已签约」需求（签约确认后可起草合同；已绑进行中/已签合同的需求除外；
//                     且须由本会话教师促成签约——v0.25.6 收紧：被别教师 signed 签约驱动的需求不列出，
//                     防跨会话绑别教师签成的需求起草合同；同对师生换会话的 contracted 需求仍可列出）
// 归属硬约束：只取会话学生方（sd.user_id = c.student_user_id），师生身份由路由层参与方校验保证；
// 出口走 mapDemandRow（剥联系方式，师生双方均不可在绑定下拉里看到学生联系方式）
export async function dbGetConversationBindableDemands(db, conversationId, phase) {
  const cond = phase === 'contract'
    ? `AND sd.status='contracted'
       AND NOT EXISTS (SELECT 1 FROM contracts ct WHERE ct.demand_id=sd.id AND ct.status IN ('pending','signing','signed'))
       AND NOT EXISTS (SELECT 1 FROM signing_requests sr JOIN conversations c2 ON c2.id=sr.conversation_id
            WHERE sr.demand_id=sd.id AND sr.status='signed' AND c2.teacher_user_id != c.teacher_user_id)`
    : `AND sd.status='open'`;
  const rows = await dbAll(db, `
    SELECT sd.*, u.username
    FROM student_demands sd
    JOIN users u ON u.id=sd.user_id
    JOIN conversations c ON c.id=?
    WHERE sd.user_id=c.student_user_id ${cond}
    ORDER BY sd.created_at DESC, sd.id DESC`, [conversationId]);
  return rows.map(mapDemandRow);
}

// 我参与的会话列表（含对方用户名 + 最后一条消息预览 + 签约状态）
export async function dbGetMyConversations(db, userId) {
  // unread_count：对方发的、id 大于「我这一侧已读游标」的消息数（游标按我在会话中的角色取列）
  // v0.25.58（#150）：contracted 字段连根拔——原仅供「签约确认后背景灰字提示」（.chat-sign-tip）判定，
  // 提示已并入签约请求气泡底下（status='signed' 模板渲染），会话列表字段无消费者后删除。
  // 显式列集（不用 c.*）：双方已读游标（student_last_read_id/teacher_last_read_id）不下发，
  // 避免向对方暴露己方已读位置（低敏信息泄露面收口）
  return await dbAll(db, `SELECT c.id, c.student_user_id, c.teacher_user_id, c.demand_id, c.status, c.created_at,
      us.username AS student_name, ut.username AS teacher_name,
      us.avatar AS student_avatar, ut.avatar AS teacher_avatar,
      CASE WHEN lm.kind IN ('image','file') THEN '' ELSE lm.body END AS last_body,
      lm.kind AS last_kind, lm.created_at AS last_at, lm.sender_user_id AS last_sender,
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

export async function dbGetMessages(db, convId, sinceId = 0, limit = LIMITS.MSG_LIMIT) {
  // 图片/文件消息不在列表查询里下发 dataURL 本体（大字段懒加载，走 attachment 接口）；
  // v0.25.36 缩略图随列表下发（小字段）：thumb 列（加密）由路由层解密；图片无缩略图（历史数据）回 ''
  return await dbAll(db, `SELECT m.id, m.conversation_id, m.sender_user_id, m.kind, m.name, m.created_at,
      CASE WHEN m.kind IN ('image','file') THEN '' ELSE m.body END AS body,
      CASE WHEN m.kind='image' THEN m.thumb ELSE '' END AS thumb,
      u.username AS sender_name
    FROM messages m JOIN users u ON u.id=m.sender_user_id
    WHERE m.conversation_id=? AND m.id>? ORDER BY m.id ASC LIMIT ?`, [convId, sinceId, limit]);
}

export async function dbCreateMessage(db, convId, senderUserId, kind, body, name = '', thumb = '') { // v0.25.36 缩略图随消息落库
  const result = await dbRun(db,
    'INSERT INTO messages (conversation_id, sender_user_id, kind, body, name, thumb) VALUES (?,?,?,?,?,?)',
    [convId, senderUserId, kind, body, name, thumb]);
  return Number(result.meta.last_row_id);
}

// 管理员删除消息前置查询：取会话/发送者/类型供留档
export async function dbGetMessageById(db, messageId) {
  return await dbGet(db, 'SELECT id, conversation_id, sender_user_id, kind FROM messages WHERE id=?', [messageId]);
}

// 单条附件懒加载取 body（图片/文件大字段不随列表下发，气泡骨架渲染后逐条补载）
export async function dbGetMessageAttachment(db, messageId, conversationId) {
  return await dbGet(db, 'SELECT body, name FROM messages WHERE id=? AND conversation_id=?', [messageId, conversationId]);
}

// 管理员删除单条消息（聊天内容管理）
export async function dbDeleteMessage(db, messageId) {
  return dbRun(db, 'DELETE FROM messages WHERE id=?', [messageId]);
}

// 更新消息 body（A5 收口：signing.js 发起回填/终态覆写用，曾手写 UPDATE messages）
export async function dbSetMessageBody(db, messageId, body) {
  return dbRun(db, 'UPDATE messages SET body=? WHERE id=?', [body, messageId]);
}

// ============================================================
// 签约请求（signing_requests）——A5 收口：业务 SQL 自 signing.js 内收（DDL 仍由 signing.js 自持）
// ============================================================
export async function dbGetSigningById(db, id) {
  return await dbGet(db, 'SELECT * FROM signing_requests WHERE id=?', [id]);
}

export async function dbGetPendingSigningForConversation(db, conversationId) {
  return await dbGet(db,
    "SELECT id FROM signing_requests WHERE conversation_id=? AND status='pending' LIMIT 1", [conversationId]);
}

export async function dbCreateSigning(db, conversationId, demandId, userId, msgId, price, schedule, method) {
  const res = await dbRun(db,
    'INSERT INTO signing_requests (conversation_id, demand_id, initiator_user_id, message_id, price, schedule, method) VALUES (?,?,?,?,?,?,?)',
    [conversationId, demandId, userId, msgId, price, schedule, method]);
  return Number(res.meta.last_row_id);
}

// 确认签约原子事务（v0.25.6 TOCTOU 修复 + A5 收口）：sr 置 signed + 需求置 contracted 同一 batch 事务，
// 需求守卫 EXISTS(open) 防同需求多会话并发双签（后到的批事务守卫失败 → changes[0]=0 → 调用方 410）。
// 返回 [srChanges, demandChanges]；auto-reject 副作用只由需求收缩赢家（demandChanges>0）驱动。
export async function dbConfirmSigning(db, signingId, demandId) {
  const results = await db.batch([
    db.prepare(`UPDATE signing_requests SET status='signed', responded_at=datetime('now','localtime')
      WHERE id=? AND status='pending'
      AND EXISTS(SELECT 1 FROM student_demands WHERE id=? AND status='open')`).bind(signingId, demandId),
    db.prepare(`UPDATE student_demands SET status='contracted' WHERE id=? AND status='open'`).bind(demandId),
  ]);
  return results.map(r => (r && r.meta && r.meta.changes) || 0);
}

// 拒绝/收束签约单条（respond 拒绝分支 + 注销收束共用）：条件 UPDATE + changes 判定（赢家模式）
export async function dbRejectSigning(db, signingId) {
  const res = await dbRun(db,
    `UPDATE signing_requests SET status=?, responded_at=datetime('now','localtime') WHERE id=? AND status='pending'`,
    [STATUS.REJECTED, signingId]);
  return !!(res && res.meta && res.meta.changes > 0);
}

// ============================================================
// 聊天附件暂存区（uploads）：文件拖入/选中即真实上传至此（XHR 进度），
// 发送时凭 uploadId 确认落入 messages 后删除暂存
// ============================================================
// 暂存配额自愈：清本人滞留暂存件（窗口单源自 constants.LIMITS，防弃传暂存填满库）
export async function dbPurgeStaleUploads(db, userId) {
  await dbRun(db, `DELETE FROM uploads WHERE user_id=? AND created_at < datetime('now','localtime', ?)`,
    [userId, LIMITS.STALE_UPLOAD_WINDOW]);
}

// 本人当前暂存件数（每人 12 件封顶用）
export async function dbCountUploads(db, userId) {
  const row = await dbGet(db, 'SELECT COUNT(*) AS cnt FROM uploads WHERE user_id=?', [userId]);
  return row?.cnt || 0;
}

// 上传创建原子化（网安审计 TOCTOU：配额 check-then-act 有窗口——并发上传可越过 LIMITS.UPLOAD_STAGING_MAX。
// 改为条件 INSERT：仅当本人暂存件数 < 上限才插入，changes=0 即超配额，调用方据返回 0 判定 413）
export async function dbCreateUpload(db, userId, kind, body, name, thumb = '') { // v0.25.36 缩略图随传
  const res = await dbRun(db,
    `INSERT INTO uploads (user_id, kind, body, name, thumb)
     SELECT ?, ?, ?, ?, ? WHERE (SELECT COUNT(*) FROM uploads WHERE user_id=?) < ${LIMITS.UPLOAD_STAGING_MAX}`,
    [userId, kind, body, name, thumb, userId]);
  return (res && res.meta && res.meta.changes > 0) ? Number(res.meta.last_row_id) : 0;
}

export async function dbGetUpload(db, uploadId) {
  return await dbGet(db, 'SELECT * FROM uploads WHERE id=?', [uploadId]);
}

export async function dbDeleteUpload(db, uploadId) {
  await dbRun(db, 'DELETE FROM uploads WHERE id=?', [uploadId]);
}

// ============================================================
// 隐私设置（#163 v0.25.71）：访客可见性控制
// user_settings 无行 = 全默认可见（COALESCE 1）；upsert 单点写
// ============================================================
export async function dbGetPrivacySettings(db, userId) {
  const row = await dbGet(db,
    'SELECT allow_guest_profile, allow_guest_demand FROM user_settings WHERE user_id=?', [userId]);
  return {
    allowGuestProfile: row ? row.allow_guest_profile : 1,
    allowGuestDemand: row ? row.allow_guest_demand : 1,
  };
}

// 显式传 0 才关（=== 0 → 0，其余一律 1）；两字段任一缺失保持原值（undefined 走原值）
export async function dbSetPrivacySettings(db, userId, { allowGuestProfile, allowGuestDemand } = {}) {
  const cur = await dbGetPrivacySettings(db, userId);
  const p = allowGuestProfile === 0 ? 0 : (allowGuestProfile === undefined ? cur.allowGuestProfile : 1);
  const d = allowGuestDemand === 0 ? 0 : (allowGuestDemand === undefined ? cur.allowGuestDemand : 1);
  await dbRun(db, `INSERT INTO user_settings (user_id, allow_guest_profile, allow_guest_demand, updated_at)
    VALUES (?, ?, ?, datetime('now','localtime'))
    ON CONFLICT(user_id) DO UPDATE SET
      allow_guest_profile=excluded.allow_guest_profile,
      allow_guest_demand=excluded.allow_guest_demand,
      updated_at=excluded.updated_at`, [userId, p, d]);
  return dbGetPrivacySettings(db, userId);
}

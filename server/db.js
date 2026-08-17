/**
 * 数据访问层 — 业务数据表 SQL 收敛于此（路由层只调用 dbXxx，不直接写业务 SQL）
 * 有意决定（CLAUDE.md）：日志表建表/插入在 server/log.js，通知表在 server/notify.js，
 * 合同状态机与台账 SQL 在 server/contract.js——各模块自持其表域，不在本文件重复。
 * signing_requests 表 DDL 由 server/signing.js 自持（initSigningTable），但该表的业务 SQL
 * （增/查/确认签约事务）已收口在本文件 mapper，signing.js 只调 dbXxx。
 * 换数据库时业务层只需重写本文件（咽喉层 util.js 的 dbAll/dbGet/dbRun 为通用封装）。
 */
import { dbAll, dbGet, dbRun, ensureColumns } from '../src/server/core/util.js';
import { hashPassword, encryptField, decryptField, bindCryptoEnv } from '../src/server/core/crypto.js'; // 密码哈希/敏感字段加密（网安报告 F-06）
import { INITIAL_RATING, INITIAL_WEIGHT, LIMITS, STATUS, PHONE_HASH_COND, EMAIL_HASH_COND, LEGACY_ADMIN_PASSWORD } from './constants.js'; // PHONE/EMAIL_HASH_COND：哈希定位条件单源
import { getSecret } from './secrets.js'; // 敏感配置唯一网关（env 优先，回落本地 secrets.js）
import { initMetrics } from './telemetry.js'; // v1.5.0 观测指标表（请求聚合）

// JSON 列反序列化单点（V-1-3 提取；旧 import 路径经 db.js 出口）
import { safeJsonArray, safeJsonObject } from '../src/server/core/json.js';
// 认证域数据层（V-1-4 提取；旧 import 路径经 db.js 出口）
import {
  dbFindUserByUsername, dbUserLookupStmt, dbUsernameExistsStmt, dbUserPhoneHashStmt, dbUserEmailHashStmt,
  dbGetUserById, dbCreateUser, dbDeleteUser, dbDeactivateUser, dbRecomputeTeacherRating, dbPurgeUserOwnedData,
  dbUpdateUserAvatar, dbSetUserBanned, dbFindValidInviteCode, dbUseInviteCode, dbCreateInviteCode,
} from '../src/server/domains/auth/repo.js';

export {
  safeJsonArray, safeJsonObject,
  dbFindUserByUsername, dbUserLookupStmt, dbUsernameExistsStmt, dbUserPhoneHashStmt, dbUserEmailHashStmt,
  dbGetUserById, dbCreateUser, dbDeleteUser, dbDeactivateUser, dbRecomputeTeacherRating, dbPurgeUserOwnedData,
  dbUpdateUserAvatar, dbSetUserBanned, dbFindValidInviteCode, dbUseInviteCode, dbCreateInviteCode,
};

import {
  dbGetTeacherProfile, dbIsMatched, dbUpsertTeacherProfile, dbGetTeachers, dbSetTeacherVerified, mapTeacherProfileRow,
  dbGetTeacherVerification, dbUpsertTeacherVerification, dbClearChsiFromProfile, dbApplyChsiToProfile,
  dbListTeacherVerifications, dbGetTeacherVerificationById,
} from '../src/server/domains/teacher/repo.js';

export {
  dbGetTeacherProfile, dbIsMatched, dbUpsertTeacherProfile, dbGetTeachers, dbSetTeacherVerified,
  dbGetTeacherVerification, dbUpsertTeacherVerification, dbClearChsiFromProfile, dbApplyChsiToProfile,
  dbListTeacherVerifications, dbGetTeacherVerificationById,
};

import {
  mapDemandRow,
  dbCreateDemand, dbGetDemands, dbGetDemandsByUser, dbGetDemandById, dbUpdateDemand, dbDeleteDemand,
  dbAdminForceDeleteDemand, dbReopenDemand, dbReleaseDemandAfterRevoke,
  dbCreatePush, dbGetPendingPushesForTeacher, dbGetPushById, dbResolvePush, dbGetPendingPushesForDemand, dbAcceptPushAsIntent,
  dbCreateIntent, dbGetIntentTeachers, dbGetIntentWithDemand, dbResolveIntent, dbGetPendingIntentsForDemand,
} from '../src/server/domains/demand/repo.js';

export {
  dbCreateDemand, dbGetDemands, dbGetDemandsByUser, dbGetDemandById, dbUpdateDemand, dbDeleteDemand,
  dbAdminForceDeleteDemand, dbReopenDemand, dbReleaseDemandAfterRevoke,
  dbCreatePush, dbGetPendingPushesForTeacher, dbGetPushById, dbResolvePush, dbGetPendingPushesForDemand, dbAcceptPushAsIntent,
  dbCreateIntent, dbGetIntentTeachers, dbGetIntentWithDemand, dbResolveIntent, dbGetPendingIntentsForDemand,
};

import {
  dbUpsertConversation, dbGetConversationById, dbGetConversationWithNames, dbGetConversationBindableDemands,
  dbGetMyConversations, dbMarkConversationRead, dbGetMessages, dbPrepareMessageInsert, dbCreateMessage,
  dbGetMessageById, dbGetMessageAttachment, dbDeleteMessage, dbSetMessageBody,
  dbGetSigningById, dbDeleteSigning, dbGetPendingSigningForConversation, dbCreateSigning, dbConfirmSigning, dbRejectSigning,
  dbPurgeStaleUploads, dbCountUploads, dbCreateUpload, dbGetUpload, dbGetUploads, dbDeleteUpload, dbPrepareUploadDelete,
} from '../src/server/domains/chat/repo.js';

export {
  dbUpsertConversation, dbGetConversationById, dbGetConversationWithNames, dbGetConversationBindableDemands,
  dbGetMyConversations, dbMarkConversationRead, dbGetMessages, dbPrepareMessageInsert, dbCreateMessage,
  dbGetMessageById, dbGetMessageAttachment, dbDeleteMessage, dbSetMessageBody,
  dbGetSigningById, dbDeleteSigning, dbGetPendingSigningForConversation, dbCreateSigning, dbConfirmSigning, dbRejectSigning,
  dbPurgeStaleUploads, dbCountUploads, dbCreateUpload, dbGetUpload, dbGetUploads, dbDeleteUpload, dbPrepareUploadDelete,
};

import { dbGetContractById, dbGetMyContracts, dbGetAllContractsAdmin, dbDeleteContract } from '../src/server/domains/contract/repo.js';
export { dbGetContractById, dbGetMyContracts, dbGetAllContractsAdmin, dbDeleteContract };

import { dbGetPrivacySettings, dbSetPrivacySettings } from '../src/server/domains/settings/repo.js';
export { dbGetPrivacySettings, dbSetPrivacySettings };





import { initLogDb } from '../src/server/core/log.js';
import { initNotifyTable } from '../src/server/core/notify.js'; // 通知表建表（独立模块，仅借 init，无循环依赖）
import { initVersionTable } from './version.js'; // 数据版本戳表建表（仅借 init）
import { initSigningTable } from './signing.js'; // 发起签约请求表建表（仅借 init）
import { initDangerCaps } from '../src/server/core/danger-ops.js'; // capToken 表建表（独立模块，仅借 init，无循环依赖）
import { initOtpTable, bindOtpEnv } from '../src/server/core/otp.js'; // 验证码表建表（独立模块，仅借 init，无循环依赖）
import { bindChsiEnv } from './chsi.js'; // 学信网核验 provider 部署级配置（缺省 manual fail-closed）
import { initAwardsTable } from './awards.js'; // 教师荣誉奖项表建表（独立模块，仅借 init）

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
  revoked INTEGER NOT NULL DEFAULT 0,   -- 撤销标记（合同不删除，status 保持 signed）
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
// 契约：本迁移必须由 initDb 在初始建表【之前】调用——若初始 batch 先建出子表，
// 改名 users 时会把它们的 FK 一并改写指向 _users_old，随后 _users_old 被删 → 子表 FK 悬空，
// 任何 INSERT 报 no such table: _users_old。迁移在前则子表直接引用迁移后的最终表。
// 幂等守卫：users 定义已含 'admin' 即跳过（全新库/已迁移库零开销）。
// 网安审计 N-19：旧表可能经历次 ensureColumns 比迁移 DDL 多/少列，逐表取「新旧列交集」显式列名拷贝，
// 缺列/多列均不炸；更老库缺失的表跳过、由初始 batch 按当前形状补建；补列仍由后续 ensureColumns 统一补齐。
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

// ============================================================
// 表结构重建（父先于子）：旧表整体改名腾位 → 建当前形状新表 → 列交集拷贝 → 删旧。
// 幂等（sharedCols 交集 + IF NOT EXISTS）；仅 schema 版本落后时由 runFullMigration 调用。
// 契约：任何需要「删列/改约束/改表形」的变更必须 SCHEMA_VERSION +1 并在此数组更新
// 目标 DDL（纯 ensureColumns 加列不需要重建）。
// ============================================================
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

// ============================================================
// initDb 采用 schema 版本判断：冷 isolate 首击 1 次 batch（CREATE schema_meta 幂等 + SELECT 版本）
// 命中已最新即跳过全量迁移（全量跑 ≈13-20 次 D1 往返会让冷 isolate 首击超时）。
// 纪律：任何建表/加列/迁移改动必须 SCHEMA_VERSION +1，否则冷 isolate 跳过迁移导致缺列（生产事故）。
// ============================================================
export const SCHEMA_VERSION = 7; // v1.5.0：+ request_metrics 观测表 + provider 默认 manual + 录取通知书列（存量 v6 库需跑全量迁移）

export async function initDb(db, env = {}) {
  bindCryptoEnv(env); // 字段加密密钥（FIELD_ENC_KEY 优先回落 LOG_ENCRYPT_KEY），env 变更重派生
  bindOtpEnv(env);    // OTP 部署级配置（SMS/EMAIL_OTP_TEMPLATE_CODE 模板编码；测试经 test/_otp-stub.js stub fetch 防真实发信）
  bindChsiEnv(env);   // CHSI 部署级配置（v1.5.0：只允许 manual，其他 provider fail-closed）
  // 1 次 batch：建 schema_meta（幂等）+ 读版本（batch 顺序执行，CREATE 后 SELECT 可见）
  let rows = null;
  try {
    rows = await db.batch([
      db.prepare(`CREATE TABLE IF NOT EXISTS schema_meta (k TEXT PRIMARY KEY, v INTEGER NOT NULL)`),
      db.prepare(`SELECT v FROM schema_meta WHERE k='schema'`),
    ]);
  } catch { /* batch 异常：保守视为版本落后，走全量幂等迁移（不阻塞初始化） */ }
  const cur = rows && rows[1] && rows[1].results && rows[1].results[0] ? rows[1].results[0].v : 0;
  if (cur >= SCHEMA_VERSION) return; // schema 已最新：冷 isolate 首击跳过全量迁移（1 次 D1 即完成）
  await runFullMigration(db, env); // 首次部署/版本落后：跑完整幂等迁移
  try { await db.prepare(`INSERT OR REPLACE INTO schema_meta (k, v) VALUES ('schema', ?)`).bind(SCHEMA_VERSION).run(); } catch { /* 版本写失败静默：下次重跑幂等迁移 */ }
}

// 原 initDb 全量迁移体（幂等：CREATE IF NOT EXISTS + ensureColumns；仅 schema 版本落后时执行）
async function runFullMigration(db, env) {
  bindCryptoEnv(env); // 字段加密密钥（FIELD_ENC_KEY 优先回落 LOG_ENCRYPT_KEY），env 变更重派生
  const adminNames = adminNamesOf(getSecret(env, 'ADMIN_USERNAMES'));
  const adminPassword = getSecret(env, 'ADMIN_DEFAULT_PASSWORD') || '';
  // 遗留角色迁移必须先于初始建表执行：否则新建子表的 FK 会在改名腾位时被改写指向 _*_old，
  // 随后 _*_old 被删 → 子表 FK 悬空，全站 INSERT 报 no such table。
  await migrateLegacyRoles(db, adminNames);
  await rebuildTables(db, adminNames); // v1.2.0：表重建（删列/改表形）与 users 角色迁移解耦，幂等
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
      device_id TEXT NOT NULL DEFAULT '', /* 设备去重键（浏览器档案持久 id；'' = 无设备标识的老客户端/脚本，不受部分唯一索引约束） */
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
      teaching_goal TEXT NOT NULL DEFAULT '[]',
      skill_notes TEXT NOT NULL DEFAULT '[]',
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
    // 合同（草案→签约全链路，见 server/contract.js；v1.4.14 起评价门槛 dbIsContracted 只认 signing_request signed——合同是附加保障非签约依据）
    db.prepare(CONTRACTS_DDL),
    db.prepare(`CREATE TABLE IF NOT EXISTS invite_codes (
      code TEXT PRIMARY KEY, created_by INTEGER NOT NULL,
      created_at DATETIME DEFAULT (datetime('now','localtime')),
      used_by INTEGER DEFAULT NULL,
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
      subject TEXT NOT NULL DEFAULT '', /* 投诉对象（teacher/student/platform），非投诉恒空 */
      title TEXT NOT NULL DEFAULT '',
      content TEXT NOT NULL,
      status TEXT NOT NULL DEFAULT 'open' CHECK(status IN ('open','resolved')),
      created_at DATETIME DEFAULT (datetime('now','localtime')),
      FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE)`),
    db.prepare(`CREATE TABLE IF NOT EXISTS user_settings (
      user_id INTEGER PRIMARY KEY,
      allow_guest_profile INTEGER NOT NULL DEFAULT 1, /* 访客可见性——教师档案对未登录游客可见 */
      allow_guest_demand INTEGER NOT NULL DEFAULT 1,  /* 需求对未登录游客可见 */
      updated_at DATETIME DEFAULT (datetime('now','localtime')),
      FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE)`), /* 隐私设置大层级——无行=全默认可见（COALESCE 1） */
    // 教师学信网核验记录（provider=manual 管理员核验；v1.5.0 起无 mock/thirdparty）
    db.prepare(`CREATE TABLE IF NOT EXISTS teacher_verifications (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      user_id INTEGER NOT NULL UNIQUE, verify_code TEXT NOT NULL,
      status TEXT NOT NULL DEFAULT 'pending' CHECK(status IN ('pending','approved','rejected')),
      school TEXT DEFAULT '', level TEXT DEFAULT '', major TEXT DEFAULT '',
      enrollment_status TEXT DEFAULT '', enroll_year TEXT DEFAULT '',
      provider TEXT NOT NULL DEFAULT 'manual',
      verify_type TEXT NOT NULL DEFAULT 'chsi',  -- v1.4.16：'chsi' 学信网验证码 | 'admission' 大一新生录取通知书（人工核验）
      admission_image TEXT DEFAULT '',          -- v1.4.16：录取通知书图片（加密 data URL，仅 admission 类型使用）
      verified_by INTEGER DEFAULT NULL, verified_at DATETIME DEFAULT NULL,
      created_at DATETIME DEFAULT (datetime('now','localtime')),
      FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE,
      FOREIGN KEY (verified_by) REFERENCES users(id))`),
  ]);

  // 合同表 schema 迁移：旧预留表（student/teacher 直连 + active/ended 状态）从未启用过，
  // 检测到旧形状即整体换新（旧表恒空，无数据损失）
  const ctCols = (await db.prepare('PRAGMA table_info(contracts)').all()).results || [];
  if (ctCols.length && !ctCols.some(c => c.name === 'conversation_id')) {
    await dbRun(db, 'DROP TABLE contracts');
    await dbRun(db, CONTRACTS_DDL);
  }

  // messages.kind CHECK 迁移：约束缺 'contract'/'signing_request'/'signing_response'（合同/签约气泡）
  // 检测到缺任一即保数据换表（rename → 新建 → 拷贝 → 删旧 → 补索引）
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

  // feedbacks.kind CHECK 迁移：约束缺 'complaint'（投诉通道）→ 保数据换表
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
    } else if (adminPassword && adminPassword !== LEGACY_ADMIN_PASSWORD) {
      // v1.5.0：已有 admin 只接受非历史默认口令轮换；历史默认口令一律不覆写（kill-list K7）
      const { hash, salt } = await hashPassword(adminPassword);
      if (hash !== existing.password_hash) {
        await dbRun(db, 'UPDATE users SET password_hash=?, salt=? WHERE id=?', [hash, salt, existing.id]);
      }
    }
  }

  // v1.5.0 管理员账号迁移：ADMIN_USERNAMES 变更时，旧名单之外的历史 admin 一律降为 student
  // （不再保留第二个可登录的管理入口；新名单缺失时本地/测试仍可正常初始化）
  if (adminNames.length) {
    const oldAdmins = await dbAll(db, 'SELECT id, username FROM users WHERE role=?', ['admin']);
    for (const a of oldAdmins) {
      if (!adminNames.includes(a.username)) {
        await dbRun(db, "UPDATE users SET role='student' WHERE id=?", [a.id]);
      }
    }
  }

  // 留档表（模块5；绑定独立 LOG_DB 时此表建在业务库亦无害，查询走 getLogDb 路由）
  await initLogDb(db);
  await initMetrics(db); // v1.5.0 观测指标表（请求聚合）

  // 幂等加列（模块1：地区档案；模块3：意向状态机）
  // 凭证扩展（内测增量凭证，详见 docs/0.26-认证与审核架构.md）：
  //   phone/email 为 AES 加密列（可展示，解密出门）；phone_hash/email_hash 为 SHA-256 可查询列
  //   （AES 不可查询，登录按手机号/邮箱定位账户的唯一手段，同 auth_sessions.token_hash 模式）。
  //   username_changed_at：用户名最近修改时间（7 天冷却判定，A5）。
  await ensureColumns(db, 'users', [['avatar', "TEXT DEFAULT ''"], ['deactivated', 'INTEGER NOT NULL DEFAULT 0'],
    ['phone', "TEXT DEFAULT ''"], ['phone_hash', "TEXT DEFAULT ''"],
    ['email', "TEXT DEFAULT ''"], ['email_hash', "TEXT DEFAULT ''"],
    ['username_changed_at', 'DATETIME']]);
  // 旧单令牌残留清空（auth_token/token_expires 列已无读者，清值缩泄露面）。
  // 列仅存于历史库、不在任何 DDL；全新库无这两列，必须先 PRAGMA 探测再执行，
  // 否则 initDb 在全新 D1 上必抛 no such column
  const userCols = (await dbAll(db, 'PRAGMA table_info(users)')).map(c => c.name);
  if (userCols.includes('auth_token')) {
    await dbRun(db, `UPDATE users SET auth_token='', token_expires='' WHERE auth_token != '' OR token_expires != ''`);
  }
  await ensureColumns(db, 'feedbacks', [['title', "TEXT NOT NULL DEFAULT ''"], ['status', "TEXT NOT NULL DEFAULT 'open'"],
    ['subject', "TEXT NOT NULL DEFAULT ''"]]); // 投诉对象列（补列兜底）
  await ensureColumns(db, 'messages', [['name', "TEXT NOT NULL DEFAULT ''"], ['thumb', "TEXT NOT NULL DEFAULT ''"]]); // 图片缩略图列
  await ensureColumns(db, 'complaints', [['attachments', "TEXT NOT NULL DEFAULT '[]'"]]); // U11：投诉附件 JSON（从 uploads 暂存复制，密文原样）
  await ensureColumns(db, 'uploads', [['thumb', "TEXT NOT NULL DEFAULT ''"]]);
  await ensureColumns(db, 'teacher_verifications', [['verify_type', "TEXT NOT NULL DEFAULT 'chsi'"], ['admission_image', "TEXT DEFAULT ''"]]); // v1.4.16：录取通知书验证（大一新生）
  await ensureColumns(db, 'teacher_profiles', [['province', "TEXT DEFAULT ''"], ['intro', "TEXT DEFAULT ''"], ['address', "TEXT DEFAULT ''"],
    ['school', "TEXT DEFAULT ''"], ['real_name', "TEXT DEFAULT ''"], ['credential_image', "TEXT DEFAULT ''"],
    ['verified', 'INTEGER NOT NULL DEFAULT 0'], // 学籍认证（运营建议：管理员审核学信网截图后置 1，前端显示「已认证」徽章）
    ['price_min', 'REAL'], ['price_max', 'REAL'], // 报价区间化（可空，null=未填；不落 DEFAULT 0）
    ['time_slots', "TEXT DEFAULT ''"], ['teaching_method', "TEXT DEFAULT ''"], // 可授课时间段 / 授课方式
    ['personality_tags', "TEXT DEFAULT ''"], ['nonacademic_projects', "TEXT DEFAULT ''"], ['nonacademic_prices', "TEXT DEFAULT ''"], // 性格关键词 / 非学科项目+报价
    ['graduation_year', 'INTEGER'], // 毕业年份（可空；null=未填按最新政策，非 null 决定教师当年赋分政策）
    ['chsi_school', "TEXT DEFAULT ''"], ['chsi_level', "TEXT DEFAULT ''"], ['chsi_major', "TEXT DEFAULT ''"],
    ['chsi_status', "TEXT DEFAULT ''"], ['chsi_enroll_year', "TEXT DEFAULT ''"], ['chsi_verified', 'INTEGER NOT NULL DEFAULT 0'] // v1.2.0 T1：学信网核验自动填入字段（只读，禁手动改）
  ]);
  // R2-5 存量教师单报价转区间（幂等）：price 列保留不动（重建表不值当），仅按旧价回填 min==max，
  // 防档案完整性门槛（price_min==null）误拦历史教师接单。price 列此后不再写入。
  await dbRun(db, `UPDATE teacher_profiles SET price_min=price, price_max=price WHERE price_min IS NULL AND price IS NOT NULL`);
  // R16：默认评分 4.0→4.5 对所有用户生效——存量从未被评价的教师（rating_count=0，rating=旧默认）回填 4.5；
  // 被评价过的保留实际加权分。幂等：回填后 rating=4.5 不再命中；新库新建即 4.5。
  await dbRun(db, `UPDATE teacher_profiles SET rating=${INITIAL_RATING} WHERE rating_count = 0 AND rating < ${INITIAL_RATING}`);
  // 有评论教师的 rating 按新公式全量重算（rating=(4.5*INITIAL_WEIGHT + rating_sum)/(INITIAL_WEIGHT + rating_count)，
  // 与 dbRecomputeTeacherRating 同口径，单点下沉迁移）。幂等：rating_sum/rating_count 不变 → 结果不变。
  await dbRun(db, `UPDATE teacher_profiles SET rating=(${INITIAL_RATING} * ${INITIAL_WEIGHT} + COALESCE(rating_sum,0)) / (${INITIAL_WEIGHT} + rating_count) WHERE rating_count > 0`);
  await ensureColumns(db, 'student_demands', [['province', "TEXT DEFAULT ''"], ['status', "TEXT NOT NULL DEFAULT 'open'"], ['display_id', 'INTEGER'], ['expected_time', "TEXT DEFAULT ''"],
    ['intent_locked', 'INTEGER NOT NULL DEFAULT 0'], // 意向单接受锁：并发 accept 抢占（防同需求双 accepted 意向）
    // R2-b 需求侧扩充：需求类型（学科/非学科）/ 偏好老师性格 / 偏好老师性别
    ['target_type', "TEXT NOT NULL DEFAULT 'academic'"],
    ['preferred_personality_tags', "TEXT NOT NULL DEFAULT '[]'"],
    ['preferred_teacher_gender', "TEXT NOT NULL DEFAULT ''"],
    // 教学目标（JSON 数组）/ 非学科技能现状（JSON [{project,note}]）
    ['teaching_goal', "TEXT NOT NULL DEFAULT '[]'"],
    ['skill_notes', "TEXT NOT NULL DEFAULT '[]'"]]);
  await ensureColumns(db, 'contracts', [['demand_id', 'INTEGER'], ['schedule', "TEXT NOT NULL DEFAULT ''"], ['location', "TEXT NOT NULL DEFAULT ''"],
    ['pay_method', "TEXT NOT NULL DEFAULT ''"], ['pay_method_other', "TEXT NOT NULL DEFAULT ''"],
    ['first_lesson_date', "TEXT NOT NULL DEFAULT ''"], ['trial_pay', "TEXT NOT NULL DEFAULT ''"], ['trial_pay_other', "TEXT NOT NULL DEFAULT ''"],
    ['version', 'INTEGER NOT NULL DEFAULT 0'], // 合同乐观锁版本（秒级 updated_at 不可靠，修同秒双改互相覆盖）
    ['prev_business', 'TEXT'], // 改动留痕：上次业务条款（前端 diff 高亮；签署确认后清空）
    // 双方签署时间（空=未签；UTC SQLite 时间戳），签名区块内嵌正文据此渲染
    ['drafter_signed_at', "TEXT NOT NULL DEFAULT ''"],
    ['other_signed_at', "TEXT NOT NULL DEFAULT ''"],
    // 撤销标记（双方签后撤销合同：合同不删除，status 保持 signed，置 revoked 标记 + 撤销人）
    ['revoked', 'INTEGER NOT NULL DEFAULT 0'],
    ['revoked_by', 'INTEGER NOT NULL DEFAULT 0']]);

  // 存量需求编号补发：按 id（生成顺序）依次取号，四位展示自 0001 起；已编号跳过（幂等）
  const unnumbered = await dbAll(db, 'SELECT id FROM student_demands WHERE display_id IS NULL ORDER BY id');
  for (const r of unnumbered) {
    await dbRun(db, 'UPDATE student_demands SET display_id=(SELECT COALESCE(MAX(display_id),0)+1 FROM student_demands) WHERE id=?', [r.id]);
  }

  // 意向状态列先行补齐：下方「存量会话需求绑定修复」回填引用 di.status，须先建列再回填——
  // 否则全新 D1 上 initDb 在 prepare 阶段即报 no such column
  await ensureColumns(db, 'demand_intents', [
    ['status', "TEXT NOT NULL DEFAULT 'pending' CHECK(status IN ('pending','accepted','rejected'))"],
    ['resolved_at', 'DATETIME'],
    ['message', "TEXT NOT NULL DEFAULT ''"], // 教师试课意向打招呼消息
  ]);
  // 学生主动推送需求附带打招呼消息（自我介绍+为什么选这位老师）
  await ensureColumns(db, 'demand_pushes', [
    ['message', "TEXT NOT NULL DEFAULT ''"],
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
  // 设备去重：老库补 device_id 列（新库 DDL 已带）。列补齐后建部分唯一索引——
  // 同一 (user, device) 至多一行活跃会话（issueAuthToken UPSERT 复用行）；device_id=''（无标识的
  // 老客户端/curl 脚本）不受约束，保持历史多行行为
  await ensureColumns(db, 'auth_sessions', [['device_id', "TEXT NOT NULL DEFAULT ''"]]);
  await dbRun(db, `CREATE UNIQUE INDEX IF NOT EXISTS idx_auth_sessions_user_device
    ON auth_sessions(user_id, device_id) WHERE device_id != ''`);

  // 热点查询索引：幂等 CREATE INDEX IF NOT EXISTS。契约：必须置于全部换表迁移 + ensureColumns 之后——
  // 迁移重建表不继承旧索引、后补列（demand_intents.status、users.deactivated）在此前尚不存在，
  // 早建会 no such column。教师列表 matched EXISTS 走 teacher 前置、需求聚合子查询走 demand 前置、
  // 分页 ORDER BY 走复合等。
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
  // 凭证哈希唯一索引：同一手机号/邮箱至多绑一个账户（防撞库串号）。存量全空无冲突；
  // 万一未来出现重复绑定数据，try/catch 保启动（登录按 hash 命中多行时路由层按首行处理并留档）
  try {
    await dbRun(db, 'CREATE UNIQUE INDEX IF NOT EXISTS idx_users_phone_hash ON users(phone_hash) WHERE phone_hash != \'\'');
    await dbRun(db, 'CREATE UNIQUE INDEX IF NOT EXISTS idx_users_email_hash ON users(email_hash) WHERE email_hash != \'\'');
  } catch { /* 存量重复绑定数据（理论不出现）：跳过索引，路由层兜底 */ }

  // 通知表（独立模块 notify.js 提供建表与推送咽喉）
  await initNotifyTable(db);
  // 数据版本戳表（客户端 8s 探测版本，只重拉变化域）
  await initVersionTable(db);
  // 发起签约请求表（确认签约关系；需求-会话解耦后唯一「签约才拒其他」的触发点）
  await initSigningTable(db);
  await initAwardsTable(db);
  // 危险操作二次认证 capToken 表（独立模块 danger-ops.js 提供签发/校验；D1 持久化跨实例一致，网安审计 N-02）
  await initDangerCaps(db);
  // 验证码表（独立模块 otp.js 提供请求/校验/限频；表域自持）
  await initOtpTable(db);

  // 存量用户名消毒（幂等）：登录唯一输入框按格式初判，含 @ / 纯数字的用户名会歧义为
  // 邮箱/手机号，一次性改名「原名_sufe」（后缀避 UNIQUE 冲突；幂等——已消毒名不含 @ / 纯数字不再命中）。
  // 须在凭证哈希唯一索引之后执行（消毒不触碰 phone_hash/email_hash，无冲突）。
  const dirtyUsers = await dbAll(db, `SELECT id, username FROM users WHERE username LIKE '%@%' OR CAST(username AS TEXT) GLOB '[0-9]*' AND CAST(username AS TEXT) NOT GLOB '*[^0-9]*'`);
  for (const r of dirtyUsers) {
    await dbRun(db, 'UPDATE users SET username=? WHERE id=?', [`${r.username}_sufe`, r.id]);
  }

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

// ============================================================
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
  // 门控：已注销评价者/被评教师的数据不对外（教师注销后评价行保留留档，但不再经此公开出口）
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

// 签约门槛查询（v1.4.14 用户拍板：联系方式/评价统一按「已签约」开放——signing_request signed 即已签约；
// 文档合同 signed 不作依据（合同是附加保障，与签约状态无关），发起签约过程中（pending）不算。
export async function dbIsContracted(db, studentUserId, teacherUserId) {
  return !!(await dbGet(db,
    `SELECT 1 FROM conversations c
     WHERE c.student_user_id=? AND c.teacher_user_id=?
       AND EXISTS(SELECT 1 FROM signing_requests sr WHERE sr.conversation_id=c.id AND sr.status='signed')
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
  // 广场门控——已注销用户帖子严禁入场（LEFT JOIN 下该条件等效丢弃墓碑作者行）
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
            p.created_at, u.username, ${sel}
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

// U10（网络层架构债）：点赞/收藏切换把「读帖 + 读本人记录」合成一步 batch（串行 2 次往返 → 1 次）。
// D1 batch 结果元素对 SELECT 含 .results 数组（与 login authRateBatch 同解析口径）。
export async function dbGetPostLikeToggleRead(db, postId, userId) {
  const out = await db.batch([
    db.prepare('SELECT id, user_id, title FROM posts WHERE id=?').bind(postId),
    db.prepare('SELECT id FROM post_likes WHERE post_id=? AND user_id=?').bind(postId, userId),
  ]);
  return { post: out[0]?.results?.[0] ?? null, like: out[1]?.results?.[0] ?? null };
}

export async function dbGetPostFavoriteToggleRead(db, postId, userId) {
  const out = await db.batch([
    db.prepare('SELECT id, user_id, title FROM posts WHERE id=?').bind(postId),
    db.prepare('SELECT id FROM post_favorites WHERE post_id=? AND user_id=?').bind(postId, userId),
  ]);
  return { post: out[0]?.results?.[0] ?? null, fav: out[1]?.results?.[0] ?? null };
}

// U10：点赞写入 + 计数同步 + 计数回读 同一 batch（事务内顺序执行；串行 3 次往返 → 1 次）。
// likeId 有 → 删（取消赞），无 → 插（点赞）；计数以子查询 COUNT 为唯一事实源，杜绝漂移。
export async function dbTogglePostLike(db, postId, userId, likeId) {
  const stmts = likeId
    ? [db.prepare('DELETE FROM post_likes WHERE id=?').bind(likeId)]
    : [db.prepare('INSERT INTO post_likes (post_id, user_id) VALUES (?,?)').bind(postId, userId)];
  stmts.push(db.prepare('UPDATE posts SET like_count = (SELECT COUNT(*) FROM post_likes WHERE post_id=?) WHERE id=?').bind(postId, postId));
  stmts.push(db.prepare('SELECT like_count FROM posts WHERE id=?').bind(postId));
  const out = await db.batch(stmts);
  const countRow = out[out.length - 1]?.results?.[0];
  return { likeCount: countRow?.like_count || 0 };
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

// 我的反馈/投诉列表——用户侧状态跟踪闭环（本人可见，无他人数据）
export async function dbGetFeedbacksByUser(db, userId) {
  return await dbAll(db, `SELECT * FROM feedbacks WHERE user_id=? ORDER BY id DESC LIMIT ${LIMITS.FEEDBACK_MINE_MAX}`, [userId]);
}

export async function dbGetFeedbacksAdmin(db, status) {
  // 可选 status 下推过滤（白名单，防注入）；不传则返回全部。
  // feedbacks.status 合法值仅 'open'/'resolved'（'pending' 会使「未处理」过滤恒空）
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
export async function dbCreateComplaint(db, userId, targetType, targetId, snapshot, reason, detail, attachments = []) {
  const res = await dbRun(db,
    'INSERT INTO complaints (user_id, target_type, target_id, target_snapshot, reason, detail, attachments) VALUES (?,?,?,?,?,?,?)',
    [userId, targetType, targetId, JSON.stringify(snapshot), reason, detail, JSON.stringify(attachments)]);
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
  return { ...row, target_snapshot: safeJsonObject(row.target_snapshot), attachments: safeJsonArray(row.attachments) };
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
  // S2-2（SQLi 审计）：q 中 %/_ 转义字面 + ESCAPE 子句（对齐 dbListPosts）——防 LIKE 通配符注入放大匹配/枚举
  const like = `%${likeEscape(q)}%`;
  return await dbAll(db,
    `SELECT id, username, role FROM users WHERE role=? AND id<>? AND (username LIKE ? ESCAPE '\\' OR (? > 0 AND id = ?))
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
  // S2-2（SQLi 审计）：同 dbSearchUsersByRole——q 中 %/_ 转义字面 + ESCAPE
  const like = `%${likeEscape(q)}%`;
  return await dbAll(db,
    `SELECT id, title, user_id FROM posts WHERE title LIKE ? ESCAPE '\\' OR (? > 0 AND id = ?)
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
const COUNT_TABLES = { teacher_profiles: 1, student_demands: 1, teacher_awards: 1, feedbacks: 1, complaints: 1 };
// 条件计数（统计页待办队列用）：表名必须过 COUNT_TABLES 白名单（防注入），
// where 为内部硬编码字面量（status 枚举），禁止拼接用户输入
export async function dbGetCountWhere(db, table, where) {
  if (!COUNT_TABLES[table]) return 0;
  const r = await dbGet(db, `SELECT COUNT(*) AS c FROM ${table} WHERE ${where}`, []);
  return r ? Number(r.c) : 0;
}

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
  // v1.2.0 T4：邀请码无过期时间——active = 未使用（used_by IS NULL）
  return await dbGet(db, `SELECT COUNT(*) as total,
    SUM(CASE WHEN used_by IS NOT NULL THEN 1 ELSE 0 END) as used,
    SUM(CASE WHEN used_by IS NULL THEN 1 ELSE 0 END) as active
    FROM invite_codes`);
}

/** v1.2.0 T4：邀请码列表（管理员管理模块）——含使用者用户名；未用在前，按创建倒序 */
export async function dbListInviteCodes(db) {
  return await dbAll(db, `SELECT i.code, i.created_at, i.used_by, i.used_at, u.username AS used_by_username
    FROM invite_codes i LEFT JOIN users u ON u.id=i.used_by
    ORDER BY (i.used_by IS NOT NULL), i.created_at DESC LIMIT 200`);
}

/** v1.2.0 T4：作废未使用邀请码（已使用不可作废——使用即永久失效） */
export async function dbRevokeInviteCode(db, code) {
  const r = await dbRun(db, 'DELETE FROM invite_codes WHERE code=? AND used_by IS NULL', [code]);
  return !!(r && r.meta && r.meta.changes > 0);
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
// ============================================================
// D1 统一内容提取（审核者「一声令下看所有数据」）：逐表查询全部用户可操作内容，
// 归拢统一结构 { type, id, author:{id,username,role}, title, body, status, created_at, extra }。
// 增量改造：只新增本查询出口，不改变任何现有内容流转；私密字段（联系方式/附件本体）不提取。
// type 过滤参数：不传 = 全类型（每类型取 limit 条最新）；传 = 单类型。
// ============================================================
// 逐表串行 10 次 dbAll → 单次 db.batch（1 往返原子读，
// 无 type 过滤的全类型内容页是最重单查询：10 次串行 D1 → 1 次）。SQL 与行映射各自集中，
// 语义与旧实现逐字节一致（测试仍逐类型断言形状）。私密字段（联系方式/附件本体）不提取不变。
const CONTENT_SQL = {
  post: `SELECT p.id, p.user_id, u.username, u.role, p.section, p.title, p.body_md, p.like_count, p.created_at
    FROM posts p LEFT JOIN users u ON u.id=p.user_id ORDER BY p.id DESC LIMIT ?`,
  demand: `SELECT sd.id, sd.user_id, u.username, u.role, sd.status, sd.target_subjects, sd.address, sd.additional_info, sd.display_id, sd.created_at
    FROM student_demands sd LEFT JOIN users u ON u.id=sd.user_id ORDER BY sd.id DESC LIMIT ?`,
  teacher: `SELECT tp.user_id, u.username, u.role, tp.intro, tp.address, tp.school, tp.verified, tp.updated_at
    FROM teacher_profiles tp LEFT JOIN users u ON u.id=tp.user_id ORDER BY tp.updated_at DESC LIMIT ?`,
  review: `SELECT r.id, r.reviewer_user_id, u.username, u.role, r.rating, r.comment, r.status, r.created_at
    FROM reviews r LEFT JOIN users u ON u.id=r.reviewer_user_id ORDER BY r.id DESC LIMIT ?`,
  message: `SELECT m.id, m.conversation_id, m.sender_user_id, u.username, u.role, m.kind, m.body, m.name, m.created_at
    FROM messages m LEFT JOIN users u ON u.id=m.sender_user_id ORDER BY m.id DESC LIMIT ?`,
  feedback: `SELECT f.id, f.user_id, u.username, u.role, f.kind, f.title, f.content, f.status, f.created_at
    FROM feedbacks f LEFT JOIN users u ON u.id=f.user_id ORDER BY f.id DESC LIMIT ?`,
  complaint: `SELECT c.id, c.user_id, u.username, u.role, c.target_type, c.target_id, c.reason, c.detail, c.status, c.created_at
    FROM complaints c LEFT JOIN users u ON u.id=c.user_id ORDER BY c.id DESC LIMIT ?`,
  upload: `SELECT o.id, o.user_id, u.username, u.role, o.kind, o.name, o.created_at
    FROM uploads o LEFT JOIN users u ON u.id=o.user_id ORDER BY o.id DESC LIMIT ?`,
  contract: `SELECT c.id, c.drafter_user_id, u.username, u.role, c.plan, c.schedule, c.status, c.created_at
    FROM contracts c LEFT JOIN users u ON u.id=c.drafter_user_id ORDER BY c.id DESC LIMIT ?`,
  signing: `SELECT s.id, s.initiator_user_id, u.username, u.role, s.price, s.schedule, s.method, s.status, s.created_at
    FROM signing_requests s LEFT JOIN users u ON u.id=s.initiator_user_id ORDER BY s.id DESC LIMIT ?`,
};

// SQL 与行映射都按类型字符串键控（CONTENT_MAPPER[t]），
// 类型清单由 CONTENT_SQL 的键派生（CONTENT_TYPES）——增类型只改 CONTENT_SQL + CONTENT_MAPPER
// 两处同名键，清单自动跟随，杜绝「硬编码清单与表域错位」。
// 无效 type（非键）→ 返回空列表，不再崩溃。
const CONTENT_MAPPER = {
  post: r => ({ type: 'post', id: r.id, author: { id: r.user_id, username: r.username, role: r.role }, title: r.title, body: r.body_md, status: '', created_at: r.created_at, extra: { section: r.section, like_count: r.like_count } }),
  demand: r => ({ type: 'demand', id: r.id, author: { id: r.user_id, username: r.username, role: r.role }, title: `需求 #${r.display_id || r.id}`, body: [safeJsonArray(r.target_subjects).join('、'), r.address, r.additional_info].filter(Boolean).join(' · '), status: r.status, created_at: r.created_at, extra: {} }),
  teacher: r => ({ type: 'teacher', id: r.user_id, author: { id: r.user_id, username: r.username, role: r.role }, title: `教师档案 · ${r.username || ''}`, body: [r.intro, r.address, r.school].filter(Boolean).join(' · '), status: r.verified ? 'verified' : '', created_at: r.updated_at, extra: {} }),
  review: r => ({ type: 'review', id: r.id, author: { id: r.reviewer_user_id, username: r.username, role: r.role }, title: `评价 ${r.rating} 星`, body: r.comment, status: r.status, created_at: r.created_at, extra: {} }),
  message: r => ({ type: 'message', id: r.id, author: { id: r.sender_user_id, username: r.username, role: r.role }, title: r.kind === 'text' ? '聊天消息' : `附件（${r.kind}${r.name ? ' · ' + r.name : ''}）`, body: r.body, status: '', created_at: r.created_at, extra: { conversation_id: r.conversation_id, kind: r.kind } }),
  feedback: r => ({ type: 'feedback', id: r.id, author: { id: r.user_id, username: r.username, role: r.role }, title: r.title || `反馈（${r.kind}）`, body: r.content, status: r.status, created_at: r.created_at, extra: { kind: r.kind } }),
  complaint: r => ({ type: 'complaint', id: r.id, author: { id: r.user_id, username: r.username, role: r.role }, title: `投诉 ${r.target_type} #${r.target_id}（${r.reason}）`, body: r.detail, status: r.status, created_at: r.created_at, extra: { target_type: r.target_type, target_id: r.target_id } }),
  upload: r => ({ type: 'upload', id: r.id, author: { id: r.user_id, username: r.username, role: r.role }, title: `暂存附件（${r.kind}${r.name ? ' · ' + r.name : ''}）`, body: '', status: '', created_at: r.created_at, extra: { kind: r.kind } }),
  contract: r => ({ type: 'contract', id: r.id, author: { id: r.drafter_user_id, username: r.username, role: r.role }, title: '合同', body: [r.plan, r.schedule].filter(Boolean).join(' · '), status: r.status, created_at: r.created_at, extra: {} }),
  signing: r => ({ type: 'signing', id: r.id, author: { id: r.initiator_user_id, username: r.username, role: r.role }, title: `签约请求 ${r.price > 0 ? r.price + ' 元/时' : ''}`, body: [r.schedule, r.method].filter(Boolean).join(' · '), status: r.status, created_at: r.created_at, extra: {} }),
};

function mapContentRows(t, rows, out) {
  const m = CONTENT_MAPPER[t];
  if (!m) return; // 类型键无映射（新增表域忘补映射）→ 跳过；清单本身由 CONTENT_SQL 键派生不会漏列
  for (const r of rows) out.push(m(r));
}

export const CONTENT_TYPES = Object.keys(CONTENT_SQL); // 单源：类型清单自动跟随 CONTENT_SQL 键

export async function dbGetAllContentAdmin(db, { type = null, limit = LIMITS.PUBLIC_LIST_MAX } = {}) {
  // 补 contract（合同正文——最敏感的用户内容）与 signing（签约请求），
  // 统一内容页现在可审全部用户可操作内容。
  const types = (type && CONTENT_SQL[type]) ? [type] : (type ? [] : CONTENT_TYPES);
  if (!types.length) return []; // 无效 type/空清单 → 空结果；不调 D1 batch([])（真实 D1 空数组 batch 会抛错，
    // 真实 D1 空数组 batch 会抛错，空清单必须提前 return（mock shim 同行为回归拦截）
  const results = await db.batch(types.map(t => db.prepare(CONTENT_SQL[t]).bind(limit)));
  const out = [];
  results.forEach((r, i) => mapContentRows(types[i], (r && r.results) || [], out));
  return out;
}

// D2 处罚所需删除 mapper（反馈/投诉此前仅有 resolve，无删除；内容审核通道需硬删）
export async function dbDeleteFeedback(db, id) {
  await dbRun(db, 'DELETE FROM feedbacks WHERE id=?', [id]);
}
export async function dbDeleteComplaint(db, id) {
  await dbRun(db, 'DELETE FROM complaints WHERE id=?', [id]);
}


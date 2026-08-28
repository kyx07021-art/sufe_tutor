/**
 * teacher 域 schema（V-1-4b）：教师档案 / 学籍核验记录 DDL、列迁移与评分回填迁移。
 */
import { dbRun } from '../../core/util.js';
import { INITIAL_RATING, INITIAL_WEIGHT } from '../../../shared/config.js';

export const TEACHER_PROFILES_DDL = `CREATE TABLE IF NOT EXISTS teacher_profiles (
      id INTEGER PRIMARY KEY AUTOINCREMENT, user_id INTEGER UNIQUE NOT NULL,
      grade TEXT, gender TEXT, subjects TEXT, gaokao_scores TEXT,
      price REAL DEFAULT 0, price_min REAL, price_max REAL, wechat TEXT, email TEXT,
      school TEXT DEFAULT '', real_name TEXT DEFAULT '', credential_image TEXT DEFAULT '',
      time_slots TEXT DEFAULT '', teaching_method TEXT DEFAULT '',
      personality_tags TEXT DEFAULT '', nonacademic_projects TEXT DEFAULT '', nonacademic_prices TEXT DEFAULT '',
      graduation_year INTEGER,
      rating REAL DEFAULT ${INITIAL_RATING},
      rating_count INTEGER DEFAULT 0, rating_sum REAL DEFAULT 0,
      updated_at DATETIME DEFAULT (datetime('now')),
      FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE)`;
export const TEACHER_VERIFICATIONS_DDL = `CREATE TABLE IF NOT EXISTS teacher_verifications (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      user_id INTEGER NOT NULL UNIQUE, verify_code TEXT NOT NULL,
      status TEXT NOT NULL DEFAULT 'pending' CHECK(status IN ('pending','approved','rejected')),
      school TEXT DEFAULT '', level TEXT DEFAULT '', major TEXT DEFAULT '',
      enrollment_status TEXT DEFAULT '', enroll_year TEXT DEFAULT '',
      provider TEXT NOT NULL DEFAULT 'manual',
      verify_type TEXT NOT NULL DEFAULT 'chsi',
      admission_image TEXT DEFAULT '',
      reason TEXT DEFAULT '',
      verified_by INTEGER DEFAULT NULL, verified_at DATETIME DEFAULT NULL,
      created_at DATETIME DEFAULT (datetime('now')),
      FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE,
      FOREIGN KEY (verified_by) REFERENCES users(id))`;

export const createStatements = [TEACHER_PROFILES_DDL, TEACHER_VERIFICATIONS_DDL];

export const ensureColumns = [
  { table: 'teacher_verifications', columns: [
    ['verify_type', "TEXT NOT NULL DEFAULT 'chsi'"], ['admission_image', "TEXT DEFAULT ''"],
    ['reason', "TEXT DEFAULT ''"], // ZC-1: admin reject/revoke 驳回理由落库（教师核验区内联显示）
  ] },
  { table: 'teacher_profiles', columns: [
    ['province', "TEXT DEFAULT ''"], ['intro', "TEXT DEFAULT ''"], ['address', "TEXT DEFAULT ''"],
    ['school', "TEXT DEFAULT ''"], ['real_name', "TEXT DEFAULT ''"], ['credential_image', "TEXT DEFAULT ''"],
    ['verified', 'INTEGER NOT NULL DEFAULT 0'],
    ['price_min', 'REAL'], ['price_max', 'REAL'],
    ['time_slots', "TEXT DEFAULT ''"], ['teaching_method', "TEXT DEFAULT ''"],
    ['personality_tags', "TEXT DEFAULT ''"], ['nonacademic_projects', "TEXT DEFAULT ''"], ['nonacademic_prices', "TEXT DEFAULT ''"],
    ['graduation_year', 'INTEGER'],
    ['chsi_school', "TEXT DEFAULT ''"], ['chsi_level', "TEXT DEFAULT ''"], ['chsi_major', "TEXT DEFAULT ''"],
    ['chsi_status', "TEXT DEFAULT ''"], ['chsi_enroll_year', "TEXT DEFAULT ''"], ['chsi_verified', 'INTEGER NOT NULL DEFAULT 0'],
  ] },
];

export async function migrate(db, ctx) {
  if (ctx.phase !== 'postEnsure') return;
  // R2-5 存量教师单报价转区间（幂等）
  await dbRun(db, `UPDATE teacher_profiles SET price_min=price, price_max=price WHERE price_min IS NULL AND price IS NOT NULL`);
  // R16：默认评分 4.0→4.5 回填 + 已评价教师按新公式全量重算（幂等）
  // ZO-1（2026-08-26）：条件由 `rating < 4.5` 改 `rating IS NULL OR rating != 4.5`——生产表烤死
  // DEFAULT 4 致新行恒 4.0（rating < 4.5 本可命中，但此前版本门控短路从未跑过；改不等号覆盖
  // NULL 与一切非 4.5 值，含未来默认值再变的情形）。
  await dbRun(db, `UPDATE teacher_profiles SET rating=${INITIAL_RATING} WHERE rating_count = 0 AND (rating IS NULL OR rating <> ${INITIAL_RATING})`);
  await dbRun(db, `UPDATE teacher_profiles SET rating=(${INITIAL_RATING} * ${INITIAL_WEIGHT} + COALESCE(rating_sum,0)) / (${INITIAL_WEIGHT} + rating_count) WHERE rating_count > 0`);
  await dbRun(db, 'CREATE INDEX IF NOT EXISTS idx_tp_updated ON teacher_profiles(updated_at)');
}

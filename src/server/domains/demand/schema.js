/**
 * demand 域 schema（S3 单科目新模型）：学生需求单科目化 DDL / 列迁移 / 热点索引。
 *
 * §15 定案：①联系方式整列删除（parent_contact/student_contact/address_detail/submitter_type 不存储）
 * ②teaching_method 三态 online/offline/both ③target_type 由 subject 派生（不落库）
 * ④display_id 删除 ⑤intents/pushes 归 S2 统一删除（表在 postEnsure 幂等 DROP）
 * ⑥状态收敛 open/closed（删 contracted/revoked）。
 *
 * 旧表（v13 前）迁移：数据拆分（target_subjects 数组→单科目拆行 + current_scores 单值化）由
 * scripts/migrate-demands-single-subject.mjs（S3-3）在部署前对生产库执行；本文件 DDL 面向新形状，
 * 存量库经 ensureColumns 补新列（旧列残留不主动删——W1 无兼容层，S5 收口时随表重建一并清理）。
 */
import { dbAll, dbRun } from '../../core/util.js';

export const STUDENT_DEMANDS_DDL = `CREATE TABLE IF NOT EXISTS student_demands (
      id INTEGER PRIMARY KEY AUTOINCREMENT, user_id INTEGER NOT NULL,
      subject TEXT NOT NULL,                -- 单科目（原 target_subjects 数组 → 单值；academic: SUBJECTS / nonacademic: NONACADEMIC_PROJECTS）
      grade TEXT NOT NULL,                  -- 原 student_grade（p1..senior3 / prep）
      province TEXT DEFAULT '',
      teaching_method TEXT NOT NULL DEFAULT 'online',   -- 三态 online/offline/both（§15②）
      current_score TEXT DEFAULT '',        -- 原 current_scores 数组 → 单值（分数串或等第字母）
      address_area TEXT DEFAULT '',         -- 原 address（结构化「区·镇/街道」；online 清空，offline/both 仅上海合法）
      expected_time TEXT DEFAULT '',
      preferred_tags TEXT NOT NULL DEFAULT '[]',        -- 原 preferred_personality_tags（性格标签 JSON 数组）
      preferred_gender TEXT NOT NULL DEFAULT '',        -- 原 preferred_teacher_gender（''=不限 / male / female）
      budget_min REAL DEFAULT 0, budget_max REAL DEFAULT 0,
      additional_info TEXT DEFAULT '',
      status TEXT NOT NULL DEFAULT 'open',  -- 状态收敛 open/closed（§15⑥；历史 contracted/revoked 迁移见 S3-3 脚本）
      created_at DATETIME DEFAULT (datetime('now')),
      FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE)`;

export const createStatements = [STUDENT_DEMANDS_DDL];

// 存量库（旧形状）补新列：CREATE IF NOT EXISTS 对新库零生效，这里兜底旧库升级路径——
// subject/grade 等新列缺则补，旧列（target_subjects 等）不主动删（S2/S5 表重建时随清理）。
export const ensureColumns = [
  { table: 'student_demands', columns: [
    ['province', "TEXT DEFAULT ''"], ['status', "TEXT NOT NULL DEFAULT 'open'"],
    ['subject', "TEXT NOT NULL DEFAULT ''"], ['grade', "TEXT NOT NULL DEFAULT ''"],
    ['teaching_method', "TEXT NOT NULL DEFAULT 'online'"],
    ['current_score', "TEXT DEFAULT ''"], ['address_area', "TEXT DEFAULT ''"],
    ['preferred_tags', "TEXT NOT NULL DEFAULT '[]'"],
    ['preferred_gender', "TEXT NOT NULL DEFAULT ''"],
  ] },
];

export async function migrate(db, ctx) {
  if (ctx.phase !== 'postEnsure') return;
  // 热点查询索引（单科目模型：广场按 subject/status/budget 筛选 + 我的需求按 user_id）
  await dbRun(db, 'CREATE INDEX IF NOT EXISTS idx_demands_created ON student_demands(created_at, id)');
  await dbRun(db, 'CREATE INDEX IF NOT EXISTS idx_demands_user ON student_demands(user_id)');
  await dbRun(db, 'CREATE INDEX IF NOT EXISTS idx_demands_subject_status ON student_demands(subject, status)');
  // S2 (intents/pushes removed): drop legacy tables idempotently so existing DBs converge.
  await dbRun(db, 'DROP TABLE IF EXISTS demand_intents');
  await dbRun(db, 'DROP TABLE IF EXISTS demand_pushes');
}

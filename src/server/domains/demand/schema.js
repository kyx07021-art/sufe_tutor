/**
 * demand 域 schema（V-1-4b）：学生需求 / 意向 / 推送 DDL、列迁移与存量编号回填。
 */
import { dbAll, dbRun } from '../../core/util.js';

export const STUDENT_DEMANDS_DDL = `CREATE TABLE IF NOT EXISTS student_demands (
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
      FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE)`;
export const DEMAND_INTENTS_DDL = `CREATE TABLE IF NOT EXISTS demand_intents (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      demand_id INTEGER NOT NULL, teacher_user_id INTEGER NOT NULL,
      created_at DATETIME DEFAULT (datetime('now','localtime')),
      UNIQUE(demand_id, teacher_user_id),
      FOREIGN KEY (demand_id) REFERENCES student_demands(id) ON DELETE CASCADE,
      FOREIGN KEY (teacher_user_id) REFERENCES users(id) ON DELETE CASCADE)`;
export const DEMAND_PUSHES_DDL = `CREATE TABLE IF NOT EXISTS demand_pushes (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      demand_id INTEGER NOT NULL, student_user_id INTEGER NOT NULL, teacher_user_id INTEGER NOT NULL,
      status TEXT NOT NULL DEFAULT 'pending' CHECK(status IN ('pending','accepted','rejected')),
      created_at DATETIME DEFAULT (datetime('now','localtime')),
      UNIQUE(demand_id, teacher_user_id),
      FOREIGN KEY (demand_id) REFERENCES student_demands(id) ON DELETE CASCADE,
      FOREIGN KEY (student_user_id) REFERENCES users(id) ON DELETE CASCADE,
      FOREIGN KEY (teacher_user_id) REFERENCES users(id) ON DELETE CASCADE)`;

export const createStatements = [STUDENT_DEMANDS_DDL, DEMAND_INTENTS_DDL, DEMAND_PUSHES_DDL];

export const ensureColumns = [
  { table: 'student_demands', columns: [
    ['province', "TEXT DEFAULT ''"], ['status', "TEXT NOT NULL DEFAULT 'open'"], ['display_id', 'INTEGER'], ['expected_time', "TEXT DEFAULT ''"],
    ['target_type', "TEXT NOT NULL DEFAULT 'academic'"],
    ['preferred_personality_tags', "TEXT NOT NULL DEFAULT '[]'"],
    ['preferred_teacher_gender', "TEXT NOT NULL DEFAULT ''"],
    ['teaching_goal', "TEXT NOT NULL DEFAULT '[]'"],
    ['skill_notes', "TEXT NOT NULL DEFAULT '[]'"],
  ] },
  { table: 'demand_intents', columns: [
    ['status', "TEXT NOT NULL DEFAULT 'pending' CHECK(status IN ('pending','accepted','rejected'))"],
    ['resolved_at', 'DATETIME'],
    ['message', "TEXT NOT NULL DEFAULT ''"],
  ] },
  { table: 'demand_pushes', columns: [
    ['message', "TEXT NOT NULL DEFAULT ''"],
  ] },
];

export async function migrate(db, ctx) {
  if (ctx.phase !== 'postEnsure') return;
  // 存量需求编号补发：按 id 依次取号（已编号跳过，幂等）
  const unnumbered = await dbAll(db, 'SELECT id FROM student_demands WHERE display_id IS NULL ORDER BY id');
  for (const r of unnumbered) {
    await dbRun(db, 'UPDATE student_demands SET display_id=(SELECT COALESCE(MAX(display_id),0)+1 FROM student_demands) WHERE id=?', [r.id]);
  }
  // 热点查询索引（须在所有补列之后）
  await dbRun(db, 'CREATE INDEX IF NOT EXISTS idx_demands_created ON student_demands(created_at, id)');
  await dbRun(db, 'CREATE INDEX IF NOT EXISTS idx_demands_user ON student_demands(user_id)');
  await dbRun(db, 'CREATE INDEX IF NOT EXISTS idx_intents_demand_status ON demand_intents(demand_id, status)');
  await dbRun(db, 'CREATE INDEX IF NOT EXISTS idx_pushes_teacher ON demand_pushes(teacher_user_id, status)');
}

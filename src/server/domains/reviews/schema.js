/**
 * reviews 域 schema（V-1-4b）：评价 DDL、旧表重建（删列类迁移）与一人一评唯一索引。
 */
import { dbAll, dbGet, dbRun } from '../../core/util.js';

export const REVIEWS_DDL = `CREATE TABLE IF NOT EXISTS reviews (
      id INTEGER PRIMARY KEY AUTOINCREMENT, teacher_user_id INTEGER NOT NULL,
      reviewer_user_id INTEGER NOT NULL, rating INTEGER NOT NULL CHECK(rating>=1 AND rating<=5),
      comment TEXT NOT NULL, status TEXT DEFAULT 'pending'
        CHECK(status IN ('pending','approved','rejected')),
      created_at DATETIME DEFAULT (datetime('now')),
      reviewed_at DATETIME, reviewed_by INTEGER,
      FOREIGN KEY (teacher_user_id) REFERENCES users(id) ON DELETE CASCADE,
      FOREIGN KEY (reviewer_user_id) REFERENCES users(id) ON DELETE CASCADE)`;

export const createStatements = [REVIEWS_DDL];
export const ensureColumns = [];

// reviews 无被引用表（可安全重建）：列集合与目标不一致（删列类变更）→ 改名腾位、交集拷贝、删旧
async function rebuildReviews(db) {
  const exists = await dbGet(db, "SELECT 1 AS x FROM sqlite_master WHERE type='table' AND name='reviews'");
  if (!exists) return;
  const old = (await dbAll(db, 'PRAGMA table_info(reviews)')).map(c => c.name);
  const cols = ['id', 'teacher_user_id', 'reviewer_user_id', 'rating', 'comment', 'status', 'created_at', 'reviewed_at', 'reviewed_by'];
  if (old.length === cols.length && cols.every(c => old.includes(c))) return;
  const shared = cols.filter(c => old.includes(c)).join(',');
  const ddl = `CREATE TABLE reviews_new (
        id INTEGER PRIMARY KEY AUTOINCREMENT, teacher_user_id INTEGER NOT NULL,
        reviewer_user_id INTEGER NOT NULL, rating INTEGER NOT NULL CHECK(rating>=1 AND rating<=5),
        comment TEXT NOT NULL, status TEXT DEFAULT 'pending'
          CHECK(status IN ('pending','approved','rejected')),
        created_at DATETIME DEFAULT (datetime('now')),
        reviewed_at DATETIME, reviewed_by INTEGER,
        FOREIGN KEY (teacher_user_id) REFERENCES users(id) ON DELETE CASCADE,
        FOREIGN KEY (reviewer_user_id) REFERENCES users(id) ON DELETE CASCADE)`;
  const stmts = [db.prepare('ALTER TABLE reviews RENAME TO _reviews_old'), db.prepare(ddl)];
  if (shared) stmts.push(db.prepare(`INSERT INTO reviews_new (${shared}) SELECT ${shared} FROM _reviews_old`));
  stmts.push(db.prepare('ALTER TABLE reviews_new RENAME TO reviews'));
  stmts.push(db.prepare('DROP TABLE _reviews_old'));
  await db.batch(stmts);
}

export async function migrate(db, ctx) {
  if (ctx.phase === 'preCreate') {
    await rebuildReviews(db);
  } else if (ctx.phase === 'postCreate') {
    // 一人一评唯一索引（幂等）；旧数据若有重复对则建不上，回落路由层成对检查，不阻塞启动
    try {
      await dbRun(db, 'CREATE UNIQUE INDEX IF NOT EXISTS idx_reviews_reviewer_teacher ON reviews(reviewer_user_id, teacher_user_id)');
    } catch { /* 旧重复数据：跳过索引 */ }
  }
}

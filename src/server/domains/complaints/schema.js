/**
 * complaints 域 schema（V-1-4b）：投诉 / 反馈 DDL、列迁移与 feedbacks.kind CHECK 保数据换表。
 */
import { dbGet } from '../../core/util.js';

export const COMPLAINTS_DDL = `CREATE TABLE IF NOT EXISTS complaints (
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
      FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE)`;
export const FEEDBACKS_DDL = `CREATE TABLE IF NOT EXISTS feedbacks (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      user_id INTEGER NOT NULL,
      kind TEXT NOT NULL DEFAULT 'suggestion' CHECK(kind IN ('bug','suggestion','complaint')),
      subject TEXT NOT NULL DEFAULT '',
      title TEXT NOT NULL DEFAULT '',
      content TEXT NOT NULL,
      status TEXT NOT NULL DEFAULT 'open' CHECK(status IN ('open','resolved')),
      created_at DATETIME DEFAULT (datetime('now','localtime')),
      FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE)`;

export const createStatements = [COMPLAINTS_DDL, FEEDBACKS_DDL];

export const ensureColumns = [
  { table: 'feedbacks', columns: [
    ['title', "TEXT NOT NULL DEFAULT ''"], ['status', "TEXT NOT NULL DEFAULT 'open'"],
    ['subject', "TEXT NOT NULL DEFAULT ''"],
  ] },
  { table: 'complaints', columns: [
    ['attachments', "TEXT NOT NULL DEFAULT '[]'"],
  ] },
];

// feedbacks.kind CHECK 迁移：约束缺 'complaint'（投诉通道）→ 保数据换表
export async function migrate(db, ctx) {
  if (ctx.phase !== 'postCreate') return;
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
}

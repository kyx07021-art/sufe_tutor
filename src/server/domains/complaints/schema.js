/**
 * complaints 域 schema（V-1-4b；S6-C4 匿名反馈模型改造）：投诉 / 反馈 DDL、列迁移与
 * feedbacks.kind CHECK 保数据换表。
 *
 * S6-C4 变更（2026-08-22，new-site）：
 *   - feedbacks.kind 白名单 bug|suggestion|complaint → bug|suggestion|report（interfaces §15）；
 *     存量 complaint 行迁移映射为 report（语义 = 举报内容，subject 保留举报对象类型）。
 *   - 匿名提交模型：user_id 改为可空（匿名行 NULL），新增 client_token 列存匿名身份标识，
 *     新增 contact（匿名联系字段）与 attrs（结构化举报元数据 JSON）列。
 *   - 换表迁移检测条件由「缺 complaint」升级为「缺 report」，保数据重建含全部新列。
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
      created_at DATETIME DEFAULT (datetime('now')),
      resolved_at DATETIME,
      FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE)`;
export const FEEDBACKS_DDL = `CREATE TABLE IF NOT EXISTS feedbacks (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      user_id INTEGER,
      client_token TEXT NOT NULL DEFAULT '',
      kind TEXT NOT NULL DEFAULT 'suggestion' CHECK(kind IN ('bug','suggestion','report')),
      subject TEXT NOT NULL DEFAULT '',
      title TEXT NOT NULL DEFAULT '',
      content TEXT NOT NULL,
      contact TEXT NOT NULL DEFAULT '',
      attrs TEXT NOT NULL DEFAULT '{}',
      status TEXT NOT NULL DEFAULT 'open' CHECK(status IN ('open','resolved')),
      created_at DATETIME DEFAULT (datetime('now')),
      FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE)`;

export const createStatements = [COMPLAINTS_DDL, FEEDBACKS_DDL];

export const ensureColumns = [
  { table: 'feedbacks', columns: [
    ['title', "TEXT NOT NULL DEFAULT ''"], ['status', "TEXT NOT NULL DEFAULT 'open'"],
    ['subject', "TEXT NOT NULL DEFAULT ''"],
    ['client_token', "TEXT NOT NULL DEFAULT ''"],
    ['contact', "TEXT NOT NULL DEFAULT ''"],
    ['attrs', "TEXT NOT NULL DEFAULT '{}'"],
  ] },
  { table: 'complaints', columns: [
    ['attachments', "TEXT NOT NULL DEFAULT '[]'"],
  ] },
];

// feedbacks.kind CHECK 迁移（S6-C4）：约束缺 'report'（v2 complaint 白名单 / 更早形状）
// → 保数据换表：user_id 改可空（匿名）、补 client_token/contact/attrs 列、
//   kind 白名单换 bug|suggestion|report，存量 complaint 行映射为 report。
// ensureColumns 无法改 CHECK/NOT NULL，故必须整表重建。
export async function migrate(db, ctx) {
  if (ctx.phase !== 'postCreate') return;
  const fbMeta = await dbGet(db, `SELECT sql FROM sqlite_master WHERE type='table' AND name='feedbacks'`);
  if (fbMeta && fbMeta.sql && !fbMeta.sql.includes("'report'")) {
    await db.batch([
      db.prepare('ALTER TABLE feedbacks RENAME TO feedbacks_old'),
      db.prepare(FEEDBACKS_DDL),
      db.prepare(`INSERT INTO feedbacks (id, user_id, client_token, kind, subject, title, content, contact, attrs, status, created_at)
        SELECT id, user_id, '', CASE WHEN kind='complaint' THEN 'report' ELSE kind END, subject, title, content, '', '{}', status, created_at FROM feedbacks_old`),
      db.prepare('DROP TABLE feedbacks_old'),
    ]);
  }
}

/**
 * chat 域 schema（V-1-4b）：会话 / 消息 / 附件 / 签约请求 DDL、列迁移与存量绑定回填。
 */
import { dbGet, dbRun } from '../../core/util.js';

export const CONVERSATIONS_DDL = `CREATE TABLE IF NOT EXISTS conversations (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      student_user_id INTEGER NOT NULL, teacher_user_id INTEGER NOT NULL,
      demand_id INTEGER, status TEXT NOT NULL DEFAULT 'active' CHECK(status IN ('active','closed')),
      created_at DATETIME DEFAULT (datetime('now','localtime')),
      UNIQUE(student_user_id, teacher_user_id),
      FOREIGN KEY (student_user_id) REFERENCES users(id) ON DELETE CASCADE,
      FOREIGN KEY (teacher_user_id) REFERENCES users(id) ON DELETE CASCADE,
      FOREIGN KEY (demand_id) REFERENCES student_demands(id) ON DELETE SET NULL)`;
export const MESSAGES_DDL = `CREATE TABLE IF NOT EXISTS messages (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      conversation_id INTEGER NOT NULL, sender_user_id INTEGER NOT NULL,
      kind TEXT NOT NULL DEFAULT 'text' CHECK(kind IN ('text','image','file','contract')),
      body TEXT NOT NULL DEFAULT '',
      created_at DATETIME DEFAULT (datetime('now','localtime')),
      FOREIGN KEY (conversation_id) REFERENCES conversations(id) ON DELETE CASCADE,
      FOREIGN KEY (sender_user_id) REFERENCES users(id) ON DELETE CASCADE)`;
export const UPLOADS_DDL = `CREATE TABLE IF NOT EXISTS uploads (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      user_id INTEGER NOT NULL,
      kind TEXT NOT NULL CHECK(kind IN ('image','file')),
      body TEXT NOT NULL,
      name TEXT NOT NULL DEFAULT '',
      created_at DATETIME DEFAULT (datetime('now','localtime')),
      FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE)`;

export const createStatements = [CONVERSATIONS_DDL, MESSAGES_DDL, UPLOADS_DDL];

export const ensureColumns = [
  { table: 'messages', columns: [
    ['name', "TEXT NOT NULL DEFAULT ''"], ['thumb', "TEXT NOT NULL DEFAULT ''"],
  ] },
  { table: 'uploads', columns: [
    ['thumb', "TEXT NOT NULL DEFAULT ''"],
  ] },
  { table: 'conversations', columns: [
    ['student_last_read_id', 'INTEGER NOT NULL DEFAULT 0'],
    ['teacher_last_read_id', 'INTEGER NOT NULL DEFAULT 0'],
  ] },
];

// messages.kind CHECK 迁移：约束缺 'contract'/'signing_request'/'signing_response' 即保数据换表
async function migrateMessagesKind(db) {
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
}

export async function initSigningTable(db) {
  await dbRun(db, `CREATE TABLE IF NOT EXISTS signing_requests (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    conversation_id INTEGER NOT NULL,
    demand_id INTEGER,
    initiator_user_id INTEGER NOT NULL,
    message_id INTEGER,
    price REAL NOT NULL DEFAULT 0,
    schedule TEXT NOT NULL DEFAULT '',
    method TEXT NOT NULL DEFAULT 'offline',
    status TEXT NOT NULL DEFAULT 'pending' CHECK(status IN ('pending','signed','rejected')),
    created_at DATETIME DEFAULT (datetime('now','localtime')),
    responded_at DATETIME,
    FOREIGN KEY (conversation_id) REFERENCES conversations(id) ON DELETE CASCADE,
    FOREIGN KEY (initiator_user_id) REFERENCES users(id) ON DELETE CASCADE)`);
  try { await dbRun(db, 'CREATE INDEX IF NOT EXISTS idx_signing_conv ON signing_requests(conversation_id, status)'); }
  catch { /* 已存在则忽略 */ }
}

export async function migrate(db, ctx) {
  if (ctx.phase === 'postCreate') {
    await migrateMessagesKind(db);
    await initSigningTable(db);
    return;
  }
  if (ctx.phase !== 'postEnsure') return;
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
  await dbRun(db, 'CREATE INDEX IF NOT EXISTS idx_conv_teacher ON conversations(teacher_user_id, student_user_id)');
}

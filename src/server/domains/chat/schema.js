/**
 * chat 域 schema（V-1-4b + AI-5）：会话 / 消息 / 附件 DDL、列迁移与存量绑定回填（签约请求表已并 signing_contracts）。
 */
import { dbGet, dbRun } from '../../core/util.js';

export const CONVERSATIONS_DDL = `CREATE TABLE IF NOT EXISTS conversations (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      student_user_id INTEGER NOT NULL, teacher_user_id INTEGER NOT NULL,
      demand_id INTEGER, status TEXT NOT NULL DEFAULT 'active' CHECK(status IN ('active','closed')),
      created_at DATETIME DEFAULT (datetime('now')),
      temp_status TEXT DEFAULT NULL CHECK(temp_status IS NULL OR temp_status IN ('init','sent')),
      temp_initiator_user_id INTEGER DEFAULT NULL,
      UNIQUE(student_user_id, teacher_user_id),
      FOREIGN KEY (student_user_id) REFERENCES users(id) ON DELETE CASCADE,
      FOREIGN KEY (teacher_user_id) REFERENCES users(id) ON DELETE CASCADE,
      FOREIGN KEY (demand_id) REFERENCES student_demands(id) ON DELETE SET NULL)`;
export const MESSAGES_DDL = `CREATE TABLE IF NOT EXISTS messages (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      conversation_id INTEGER NOT NULL, sender_user_id INTEGER NOT NULL,
      kind TEXT NOT NULL DEFAULT 'text' CHECK(kind IN ('text','image','file','contract','signing_request','signing_response')),
      body TEXT NOT NULL DEFAULT '',
      name TEXT NOT NULL DEFAULT '', thumb TEXT NOT NULL DEFAULT '',
      created_at DATETIME DEFAULT (datetime('now')),
      FOREIGN KEY (conversation_id) REFERENCES conversations(id) ON DELETE CASCADE,
      FOREIGN KEY (sender_user_id) REFERENCES users(id) ON DELETE CASCADE)`;
export const UPLOADS_DDL = `CREATE TABLE IF NOT EXISTS uploads (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      user_id INTEGER NOT NULL,
      kind TEXT NOT NULL CHECK(kind IN ('image','file')),
      body TEXT NOT NULL,
      name TEXT NOT NULL DEFAULT '',
      created_at DATETIME DEFAULT (datetime('now')),
      FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE)`;

export const createStatements = [CONVERSATIONS_DDL, MESSAGES_DDL, UPLOADS_DDL];

export const ensureColumns = [
  { table: 'messages', columns: [
    ['name', "TEXT NOT NULL DEFAULT ''"], ['thumb', "TEXT NOT NULL DEFAULT ''"],
    ['client_key', 'TEXT'], // Q-2d-F2: chat 批量发送幂等键（服务端按键去重防超时重发落两条；NULL=老协议不带键）
  ] },
  { table: 'uploads', columns: [
    ['thumb', "TEXT NOT NULL DEFAULT ''"],
  ] },
  { table: 'conversations', columns: [
    ['student_last_read_id', 'INTEGER NOT NULL DEFAULT 0'],
    ['teacher_last_read_id', 'INTEGER NOT NULL DEFAULT 0'],
    // S2-T1: temp conversation state machine (init -> sent -> formal). NULL = formal conversation.
    ['temp_status', "TEXT DEFAULT NULL CHECK(temp_status IS NULL OR temp_status IN ('init','sent'))"],
    // S2-T1: initiator of a temp conversation; retained as wasTemp once formalized.
    ['temp_initiator_user_id', 'INTEGER DEFAULT NULL'],
  ] },
]; // AI-5: signing_requests 表已删（AI-3 双方元组 ensureColumns 随表清理）

// messages.kind CHECK 迁移：约束缺任一合法 kind 即保数据换表（SQLite CHECK 不可 ALTER，只能重建）。
// Z-4-F1：探测旧表列动态 carry（旧库可能无 name/thumb 或只有部分），终态新表含 name/thumb 列；
// 条件显式检查全部 6 个 kind（缺任一即换表）——修复前只查 contract+signing_request，
// 中间态「有 signing_request 无 signing_response」会漏迁；无谓换表消除 = 终态库短路跳过。
// 索引 idx_messages_conv 不在此处（曾因放条件分支内致新库短路跳过永不建索引——见 migrate postEnsure）
async function migrateMessagesKind(db) {
  const msgMeta = await dbGet(db, `SELECT sql FROM sqlite_master WHERE type='table' AND name='messages'`);
  if (!(msgMeta && msgMeta.sql)) return;
  const kinds = ["'text'", "'image'", "'file'", "'contract'", "'signing_request'", "'signing_response'"];
  if (!kinds.every(k => msgMeta.sql.includes(k))) {
    const cols = (await dbGet(db, 'SELECT group_concat(name) AS names FROM pragma_table_info(\'messages\')'))?.names || '';
    const have = new Set(cols.split(',').filter(Boolean));
    const carry = ['id', 'conversation_id', 'sender_user_id', 'kind', 'body', 'created_at']
      .concat(['name', 'thumb'].filter(c => have.has(c))); // 旧表已有 name/thumb 才随迁（无谓换表后数据保真）
    await db.batch([
      db.prepare(`ALTER TABLE messages RENAME TO messages_old`),
      db.prepare(`CREATE TABLE messages (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        conversation_id INTEGER NOT NULL, sender_user_id INTEGER NOT NULL,
        kind TEXT NOT NULL DEFAULT 'text' CHECK(kind IN ('text','image','file','contract','signing_request','signing_response')),
        body TEXT NOT NULL DEFAULT '',
        name TEXT NOT NULL DEFAULT '', thumb TEXT NOT NULL DEFAULT '',
        created_at DATETIME DEFAULT (datetime('now')),
        FOREIGN KEY (conversation_id) REFERENCES conversations(id) ON DELETE CASCADE,
        FOREIGN KEY (sender_user_id) REFERENCES users(id) ON DELETE CASCADE)`),
      db.prepare(`INSERT INTO messages (${carry.join(',')}) SELECT ${carry.join(',')} FROM messages_old`),
      db.prepare(`DROP TABLE messages_old`),
    ]);
  }
}

export async function migrate(db, ctx) {
  if (ctx.phase === 'postCreate') {
    await migrateMessagesKind(db);
    return;
  }
  if (ctx.phase !== 'postEnsure') return;
  // S2: demand_intents / demand_pushes tables are deleted (S2 intents/pushes removal).
  // The legacy conversation.demand_id backfill from accepted intents/pushes no longer applies.
  await dbRun(db, 'CREATE INDEX IF NOT EXISTS idx_conv_teacher ON conversations(teacher_user_id, student_user_id)');
  // Z-4-F1：idx_messages_conv 无条件路径（新库与换表库都建）——曾放在 migrateMessagesKind 条件分支内，
  // 新库 MESSAGES_DDL 已含终态 CHECK 短路跳过 → 索引永不创建，conversation_id+id 查询回退全表扫描
  await dbRun(db, 'CREATE INDEX IF NOT EXISTS idx_messages_conv ON messages(conversation_id, id)');
  // Q-2d-F2：幂等键唯一索引（部分索引仅约束非空键）——check-then-insert 之外的 DB 级并发兜底，
  // 同会话同发送者同键双写（双端并发重发竞态）→ 唯一约束兜底不落重复行
  await dbRun(db, `CREATE UNIQUE INDEX IF NOT EXISTS idx_messages_client_key
    ON messages(conversation_id, sender_user_id, client_key) WHERE client_key IS NOT NULL`);
  // AI-5: 旧 signing_requests 表数据已由 AI-4a 迁入 signing_contracts、读写已由 AI-4b 全切——删表（幂等清理）
  await dbRun(db, 'DROP TABLE IF EXISTS signing_requests');
}

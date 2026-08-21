/**
 * chat 域 schema（V-1-4b）：会话 / 消息 / 附件 / 签约请求 DDL、列迁移与存量绑定回填。
 */
import { dbGet, dbRun } from '../../core/util.js';

export const CONVERSATIONS_DDL = `CREATE TABLE IF NOT EXISTS conversations (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      student_user_id INTEGER NOT NULL, teacher_user_id INTEGER NOT NULL,
      demand_id INTEGER, status TEXT NOT NULL DEFAULT 'active' CHECK(status IN ('active','closed')),
      created_at DATETIME DEFAULT (datetime('now')),
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
  ] },
  // AI-3：signing_requests 自持双方元组（relation 抽象父类下平级子实体，业务不再依赖 conversation join；
  // conversation_id 列保留作历史关联与 FK 级联，归属/门禁全走双方元组）
  { table: 'signing_requests', columns: [
    ['student_user_id', 'INTEGER'], ['teacher_user_id', 'INTEGER'],
  ] },
];

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
    created_at DATETIME DEFAULT (datetime('now')),
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
  // Z-4-F1：idx_messages_conv 无条件路径（新库与换表库都建）——曾放在 migrateMessagesKind 条件分支内，
  // 新库 MESSAGES_DDL 已含终态 CHECK 短路跳过 → 索引永不创建，conversation_id+id 查询回退全表扫描
  await dbRun(db, 'CREATE INDEX IF NOT EXISTS idx_messages_conv ON messages(conversation_id, id)');
  // Q-2d-F2：幂等键唯一索引（部分索引仅约束非空键）——check-then-insert 之外的 DB 级并发兜底，
  // 同会话同发送者同键双写（双端并发重发竞态）→ 唯一约束兜底不落重复行
  await dbRun(db, `CREATE UNIQUE INDEX IF NOT EXISTS idx_messages_client_key
    ON messages(conversation_id, sender_user_id, client_key) WHERE client_key IS NOT NULL`);
  // AI-3：signing_requests 双方元组存量回填（按 conversation_id 反查会话，幂等只填空不覆写）
  await dbRun(db, `UPDATE signing_requests SET
      student_user_id = (SELECT c.student_user_id FROM conversations c WHERE c.id = signing_requests.conversation_id),
      teacher_user_id = (SELECT c.teacher_user_id FROM conversations c WHERE c.id = signing_requests.conversation_id)
    WHERE student_user_id IS NULL OR teacher_user_id IS NULL`);
}

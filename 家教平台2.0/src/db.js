export const one = (db, sql, args = []) =>
  db
    .prepare(sql)
    .bind(...args)
    .first();
export const all = (db, sql, args = []) =>
  db
    .prepare(sql)
    .bind(...args)
    .all()
    .then((x) => x.results);
export const run = (db, sql, args = []) =>
  db
    .prepare(sql)
    .bind(...args)
    .run();
export const batch = (db, statements) => db.batch(statements);

// 沿用生产最终表名和列名；额外历史表不参与新平台。
export const schema = [
  `CREATE TABLE IF NOT EXISTS users (id INTEGER PRIMARY KEY AUTOINCREMENT, username TEXT UNIQUE NOT NULL, password_hash TEXT NOT NULL, salt TEXT NOT NULL, role TEXT NOT NULL CHECK(role IN ('student','teacher','admin')), avatar TEXT DEFAULT '', phone TEXT DEFAULT '', phone_hash TEXT DEFAULT '', email TEXT DEFAULT '', email_hash TEXT DEFAULT '', banned INTEGER NOT NULL DEFAULT 0, deactivated INTEGER NOT NULL DEFAULT 0, blockSystemNotifications INTEGER NOT NULL DEFAULT 0, notifyBroadcastMuted INTEGER NOT NULL DEFAULT 0, created_at TEXT DEFAULT (datetime('now')))`,
  `CREATE TABLE IF NOT EXISTS auth_sessions (token_hash TEXT PRIMARY KEY, user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE, expires_at TEXT NOT NULL, created_at TEXT DEFAULT (datetime('now')))`,
  `CREATE TABLE IF NOT EXISTS verification_codes (id INTEGER PRIMARY KEY AUTOINCREMENT, channel TEXT NOT NULL, target_hash TEXT NOT NULL, code_hash TEXT NOT NULL, expires_at TEXT NOT NULL, used INTEGER DEFAULT 0, created_at TEXT DEFAULT (datetime('now')))`,
  `CREATE TABLE IF NOT EXISTS invite_codes (code TEXT PRIMARY KEY, created_by INTEGER NOT NULL REFERENCES users(id), used_by INTEGER REFERENCES users(id), created_at TEXT DEFAULT (datetime('now')), used_at TEXT)`,
  `CREATE TABLE IF NOT EXISTS teacher_profiles (id INTEGER PRIMARY KEY AUTOINCREMENT, user_id INTEGER UNIQUE NOT NULL REFERENCES users(id) ON DELETE CASCADE, grade TEXT DEFAULT '', gender TEXT DEFAULT 'undeclared', school TEXT DEFAULT '', real_name TEXT DEFAULT '', teacher_name TEXT DEFAULT '', province TEXT DEFAULT '', address TEXT DEFAULT '', subjects TEXT DEFAULT '[]', gaokao_scores TEXT DEFAULT '[]', price_min REAL DEFAULT 0, price_max REAL DEFAULT 0, teaching_method TEXT DEFAULT 'both', time_slots TEXT DEFAULT '', personality_tags TEXT DEFAULT '[]', nonacademic_projects TEXT DEFAULT '[]', nonacademic_prices TEXT DEFAULT '[]', graduation_year INTEGER, experience_years INTEGER, philosophy TEXT DEFAULT '', intro TEXT DEFAULT '', wechat TEXT DEFAULT '', email TEXT DEFAULT '', verified INTEGER DEFAULT 0, rating REAL DEFAULT 4.5, rating_count INTEGER DEFAULT 0, updated_at TEXT DEFAULT (datetime('now')))`,
  `CREATE TABLE IF NOT EXISTS teacher_verifications (id INTEGER PRIMARY KEY AUTOINCREMENT, user_id INTEGER UNIQUE NOT NULL REFERENCES users(id) ON DELETE CASCADE, verify_type TEXT DEFAULT 'chsi', verify_code TEXT NOT NULL DEFAULT '', admission_image TEXT DEFAULT '', school TEXT DEFAULT '', level TEXT DEFAULT '', major TEXT DEFAULT '', enrollment_status TEXT DEFAULT '', enroll_year TEXT DEFAULT '', status TEXT DEFAULT 'pending', verified_by INTEGER REFERENCES users(id), verified_at TEXT, created_at TEXT DEFAULT (datetime('now')))`,
  `CREATE TABLE IF NOT EXISTS student_demands (id INTEGER PRIMARY KEY AUTOINCREMENT, user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE, subject TEXT NOT NULL, grade TEXT NOT NULL, province TEXT DEFAULT '', teaching_method TEXT DEFAULT 'online', current_score TEXT DEFAULT '', address_area TEXT DEFAULT '', expected_time TEXT DEFAULT '', preferred_tags TEXT DEFAULT '[]', preferred_gender TEXT DEFAULT '', budget_min REAL DEFAULT 0, budget_max REAL DEFAULT 0, additional_info TEXT DEFAULT '', status TEXT DEFAULT 'open', created_at TEXT DEFAULT (datetime('now')))`,
  `CREATE TABLE IF NOT EXISTS conversations (id INTEGER PRIMARY KEY AUTOINCREMENT, student_user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE, teacher_user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE, demand_id INTEGER REFERENCES student_demands(id) ON DELETE SET NULL, status TEXT DEFAULT 'active', temp_status TEXT, temp_initiator_user_id INTEGER, student_last_read_id INTEGER DEFAULT 0, teacher_last_read_id INTEGER DEFAULT 0, created_at TEXT DEFAULT (datetime('now')), UNIQUE(student_user_id, teacher_user_id))`,
  `CREATE TABLE IF NOT EXISTS messages (id INTEGER PRIMARY KEY AUTOINCREMENT, conversation_id INTEGER NOT NULL REFERENCES conversations(id) ON DELETE CASCADE, sender_user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE, kind TEXT DEFAULT 'text', body TEXT NOT NULL DEFAULT '', name TEXT DEFAULT '', thumb TEXT DEFAULT '', created_at TEXT DEFAULT (datetime('now')))`,
  `CREATE TABLE IF NOT EXISTS posts (id INTEGER PRIMARY KEY AUTOINCREMENT, user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE, title TEXT NOT NULL, body_md TEXT DEFAULT '', like_count INTEGER DEFAULT 0, created_at TEXT DEFAULT (datetime('now')), updated_at TEXT)`,
  `CREATE TABLE IF NOT EXISTS post_likes (post_id INTEGER NOT NULL REFERENCES posts(id) ON DELETE CASCADE, user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE, UNIQUE(post_id,user_id))`,
  `CREATE TABLE IF NOT EXISTS post_favorites (post_id INTEGER NOT NULL REFERENCES posts(id) ON DELETE CASCADE, user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE, created_at TEXT DEFAULT (datetime('now')), UNIQUE(post_id,user_id))`,
  `CREATE TABLE IF NOT EXISTS reviews (id INTEGER PRIMARY KEY AUTOINCREMENT, teacher_user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE, reviewer_user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE, rating INTEGER NOT NULL CHECK(rating BETWEEN 1 AND 5), comment TEXT NOT NULL, status TEXT DEFAULT 'pending', reviewed_by INTEGER, reviewed_at TEXT, created_at TEXT DEFAULT (datetime('now')))`,
  `CREATE TABLE IF NOT EXISTS complaints (id INTEGER PRIMARY KEY AUTOINCREMENT, user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE, target_type TEXT NOT NULL, target_id INTEGER NOT NULL, target_snapshot TEXT DEFAULT '{}', reason TEXT DEFAULT '', detail TEXT DEFAULT '', attachments TEXT DEFAULT '[]', status TEXT DEFAULT 'open', created_at TEXT DEFAULT (datetime('now')), resolved_at TEXT)`,
  `CREATE TABLE IF NOT EXISTS feedbacks (id INTEGER PRIMARY KEY AUTOINCREMENT, user_id INTEGER REFERENCES users(id) ON DELETE CASCADE, client_token TEXT DEFAULT '', kind TEXT DEFAULT 'suggestion', subject TEXT DEFAULT '', title TEXT DEFAULT '', content TEXT NOT NULL, contact TEXT DEFAULT '', attrs TEXT DEFAULT '{}', status TEXT DEFAULT 'open', created_at TEXT DEFAULT (datetime('now')))`,
  `CREATE TABLE IF NOT EXISTS notifications (id INTEGER PRIMARY KEY AUTOINCREMENT, user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE, type TEXT, params TEXT, text TEXT NOT NULL DEFAULT '', is_read INTEGER DEFAULT 0, created_at TEXT DEFAULT (datetime('now')))`,
  `CREATE TABLE IF NOT EXISTS uploads (id INTEGER PRIMARY KEY AUTOINCREMENT, user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE, kind TEXT NOT NULL, body TEXT NOT NULL, name TEXT DEFAULT '', thumb TEXT DEFAULT '', created_at TEXT DEFAULT (datetime('now')))`,
  `CREATE INDEX IF NOT EXISTS idx_v2_messages ON messages(conversation_id,id)`,
  `CREATE INDEX IF NOT EXISTS idx_v2_notifications ON notifications(user_id,id)`,
];
export async function init(db) {
  await db.batch(schema.map((sql) => db.prepare(sql)));
}
export class HttpError extends Error {
  constructor(status, code, message) {
    super(message);
    this.status = status;
    this.code = code;
  }
}

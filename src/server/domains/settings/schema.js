/**
 * settings 域 schema（V-1-4b）：隐私设置 DDL。
 */
export const USER_SETTINGS_DDL = `CREATE TABLE IF NOT EXISTS user_settings (
      user_id INTEGER PRIMARY KEY,
      allow_guest_profile INTEGER NOT NULL DEFAULT 1,
      allow_guest_demand INTEGER NOT NULL DEFAULT 1,
      updated_at DATETIME DEFAULT (datetime('now')),
      FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE)`;

export const createStatements = [USER_SETTINGS_DDL];
export const ensureColumns = [];
export async function migrate(db, ctx) { /* settings 域暂无专属迁移 */ }

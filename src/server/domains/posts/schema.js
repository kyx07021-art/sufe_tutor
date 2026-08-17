/**
 * posts 域 schema（V-1-4b）：帖子 / 点赞 / 收藏 DDL。
 */
export const POSTS_DDL = `CREATE TABLE IF NOT EXISTS posts (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      user_id INTEGER NOT NULL, section TEXT NOT NULL DEFAULT 'plaza',
      title TEXT NOT NULL, body_md TEXT NOT NULL DEFAULT '',
      like_count INTEGER NOT NULL DEFAULT 0,
      created_at DATETIME DEFAULT (datetime('now','localtime')),
      updated_at DATETIME,
      FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE)`;
export const POST_LIKES_DDL = `CREATE TABLE IF NOT EXISTS post_likes (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      post_id INTEGER NOT NULL, user_id INTEGER NOT NULL,
      created_at DATETIME DEFAULT (datetime('now','localtime')),
      UNIQUE(post_id, user_id),
      FOREIGN KEY (post_id) REFERENCES posts(id) ON DELETE CASCADE,
      FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE)`;
export const POST_FAVORITES_DDL = `CREATE TABLE IF NOT EXISTS post_favorites (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      post_id INTEGER NOT NULL, user_id INTEGER NOT NULL,
      created_at DATETIME DEFAULT (datetime('now','localtime')),
      UNIQUE(post_id, user_id),
      FOREIGN KEY (post_id) REFERENCES posts(id) ON DELETE CASCADE,
      FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE)`;

export const createStatements = [POSTS_DDL, POST_LIKES_DDL, POST_FAVORITES_DDL];
export const ensureColumns = [];
export async function migrate(db, ctx) { /* posts 域暂无专属迁移 */ }

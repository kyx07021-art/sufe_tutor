/**
 * posts 域 schema（V-1-4b）：帖子 / 点赞 / 收藏 DDL。
 */
import { dbRun } from '../../core/util.js';

export const POSTS_DDL = `CREATE TABLE IF NOT EXISTS posts (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      user_id INTEGER NOT NULL, section TEXT NOT NULL DEFAULT 'plaza',
      title TEXT NOT NULL, body_md TEXT NOT NULL DEFAULT '',
      like_count INTEGER NOT NULL DEFAULT 0,
      created_at DATETIME DEFAULT (datetime('now')),
      updated_at DATETIME,
      FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE)`;
export const POST_LIKES_DDL = `CREATE TABLE IF NOT EXISTS post_likes (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      post_id INTEGER NOT NULL, user_id INTEGER NOT NULL,
      created_at DATETIME DEFAULT (datetime('now')),
      UNIQUE(post_id, user_id),
      FOREIGN KEY (post_id) REFERENCES posts(id) ON DELETE CASCADE,
      FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE)`;
export const POST_FAVORITES_DDL = `CREATE TABLE IF NOT EXISTS post_favorites (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      post_id INTEGER NOT NULL, user_id INTEGER NOT NULL,
      created_at DATETIME DEFAULT (datetime('now')),
      UNIQUE(post_id, user_id),
      FOREIGN KEY (post_id) REFERENCES posts(id) ON DELETE CASCADE,
      FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE)`;

export const createStatements = [POSTS_DDL, POST_LIKES_DDL, POST_FAVORITES_DDL];
export const ensureColumns = [];
export async function migrate(db, ctx) {
  if (ctx.phase !== 'postCreate') return;
  // PA-3-F3（PA-3d L1）：dbListPosts 按 created_at DESC, id DESC 排序取前 200（/api/posts 唯一公开列表，
  // 30s 边缘缓存兜底）——补 (created_at, id) 索引消除全表扫+排序（对齐 demand 域 idx_demands_created 同型）。
  await dbRun(db, 'CREATE INDEX IF NOT EXISTS idx_posts_created ON posts(created_at, id)');
}

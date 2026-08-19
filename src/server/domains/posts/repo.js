/**
 * 帖子域数据层（V-1-4 从 server/db.js 提取）：posts / likes / favorites。
 */
import { dbAll, dbGet, dbRun } from '../../core/util.js';
import { LIMITS } from '../../../shared/config.js';

// ============================================================
// 帖子（模块2：资料共享广场）
// ============================================================
// LIKE 通配符转义：让用户输入中的 % 与 _ 按字面匹配
export function likeEscape(s) {
  return String(s).replace(/[\\%_]/g, c => '\\' + c);
}

// 帖子列表：LEFT JOIN users 取作者名；viewerId 有值时 LEFT JOIN post_likes / post_favorites
// 产出 liked / favorited 布尔，否则恒 0。
// section 不传 = 不过滤（分区预留）；q 对 title + body_md 做 LIKE 模糊匹配；
// sort: new=时间倒序（默认）；hot=like_count 倒序、同值时间倒序
export async function dbListPosts(db, { section, q, viewerId, sort } = {}) {
  const cond = [], params = [];
  // 广场门控——已注销用户帖子严禁入场（LEFT JOIN 下该条件等效丢弃墓碑作者行）
  cond.push('u.deactivated = 0');
  if (section) { cond.push('p.section = ?'); params.push(section); }
  if (q) {
    cond.push("(p.title LIKE ? ESCAPE '\\' OR p.body_md LIKE ? ESCAPE '\\')");
    const w = '%' + likeEscape(q) + '%';
    params.push(w, w);
  }
  const where = cond.length ? ' WHERE ' + cond.join(' AND ') : '';
  const order = sort === 'hot'
    ? 'p.like_count DESC, p.created_at DESC, p.id DESC'
    : 'p.created_at DESC, p.id DESC';
  const hasViewer = !!viewerId;
  const join = hasViewer
    ? `LEFT JOIN post_likes pl ON pl.post_id = p.id AND pl.user_id = ?
       LEFT JOIN post_favorites pf ON pf.post_id = p.id AND pf.user_id = ?`
    : '';
  const sel = hasViewer ? '(pl.id IS NOT NULL) AS liked, (pf.id IS NOT NULL) AS favorited' : '0 AS liked, 0 AS favorited';
  const bind = hasViewer ? [viewerId, viewerId, ...params] : params;
  const rows = await dbAll(db,
    `SELECT p.id, p.user_id, p.section, p.title, p.body_md, p.like_count,
            p.created_at, u.username, ${sel}
     FROM posts p
     LEFT JOIN users u ON u.id = p.user_id
     ${join}${where}
     ORDER BY ${order} LIMIT ?`, [...bind, LIMITS.PUBLIC_LIST_MAX]);
  return rows.map(r => ({ ...r, liked: !!r.liked, favorited: !!r.favorited }));
}

// 我的收藏帖子列表（R23）：仅本人收藏，按收藏时间倒序；已注销作者帖子不入场。
// 复用广场卡渲染字段集（id/title/body_md/like_count/username/created_at/liked/favorited）
export async function dbListMyFavoritePosts(db, userId) {
  const rows = await dbAll(db,
    `SELECT p.id, p.user_id, p.section, p.title, p.body_md, p.like_count, p.created_at, p.updated_at,
            u.username, (pl.id IS NOT NULL) AS liked, 1 AS favorited
     FROM post_favorites pf
     JOIN posts p ON p.id = pf.post_id
     LEFT JOIN users u ON u.id = p.user_id
     LEFT JOIN post_likes pl ON pl.post_id = p.id AND pl.user_id = ?
     WHERE pf.user_id = ? AND u.deactivated = 0
     ORDER BY pf.created_at DESC, pf.id DESC LIMIT ?`,
    [userId, userId, LIMITS.PUBLIC_LIST_MAX]);
  return rows.map(r => ({ ...r, liked: !!r.liked, favorited: true }));
}

export async function dbCreatePostFavorite(db, postId, userId) {
  await dbRun(db, 'INSERT INTO post_favorites (post_id, user_id) VALUES (?,?)', [postId, userId]);
}

export async function dbDeletePostFavorite(db, favoriteId) {
  await dbRun(db, 'DELETE FROM post_favorites WHERE id=?', [favoriteId]);
}

export async function dbCreatePost(db, userId, title, bodyMd) {
  const result = await dbRun(db,
    "INSERT INTO posts (user_id, section, title, body_md) VALUES (?, 'plaza', ?, ?)",
    [userId, title, bodyMd]);
  return Number(result.meta.last_row_id);
}

export async function dbGetPostById(db, postId) {
  return await dbGet(db, 'SELECT id, user_id, title FROM posts WHERE id=?', [postId]);
}

// U10（网络层架构债）：点赞/收藏切换把「读帖 + 读本人记录」合成一步 batch（串行 2 次往返 → 1 次）。
// D1 batch 结果元素对 SELECT 含 .results 数组（与 login authRateBatch 同解析口径）。
export async function dbGetPostLikeToggleRead(db, postId, userId) {
  const out = await db.batch([
    db.prepare('SELECT id, user_id, title FROM posts WHERE id=?').bind(postId),
    db.prepare('SELECT id FROM post_likes WHERE post_id=? AND user_id=?').bind(postId, userId),
  ]);
  return { post: out[0]?.results?.[0] ?? null, like: out[1]?.results?.[0] ?? null };
}

export async function dbGetPostFavoriteToggleRead(db, postId, userId) {
  const out = await db.batch([
    db.prepare('SELECT id, user_id, title FROM posts WHERE id=?').bind(postId),
    db.prepare('SELECT id FROM post_favorites WHERE post_id=? AND user_id=?').bind(postId, userId),
  ]);
  return { post: out[0]?.results?.[0] ?? null, fav: out[1]?.results?.[0] ?? null };
}

// U10：点赞写入 + 计数同步 + 计数回读 同一 batch（事务内顺序执行；串行 3 次往返 → 1 次）。
// likeId 有 → 删（取消赞），无 → 插（点赞）；计数以子查询 COUNT 为唯一事实源，杜绝漂移。
export async function dbTogglePostLike(db, postId, userId, likeId) {
  const stmts = likeId
    ? [db.prepare('DELETE FROM post_likes WHERE id=?').bind(likeId)]
    : [db.prepare('INSERT INTO post_likes (post_id, user_id) VALUES (?,?)').bind(postId, userId)];
  stmts.push(db.prepare('UPDATE posts SET like_count = (SELECT COUNT(*) FROM post_likes WHERE post_id=?) WHERE id=?').bind(postId, postId));
  stmts.push(db.prepare('SELECT like_count FROM posts WHERE id=?').bind(postId));
  const out = await db.batch(stmts);
  const countRow = out[out.length - 1]?.results?.[0];
  return { likeCount: countRow?.like_count || 0 };
}

// post_likes 由外键 ON DELETE CASCADE 连带清理，无需手工删
export async function dbDeletePost(db, postId) {
  await dbRun(db, 'DELETE FROM posts WHERE id=?', [postId]);
}

// ============================================================

/**
 * 路由模块：资料共享广场（帖子列表 / 发布 / 点赞切换 / 删除）
 *
 * section 字段恒透传 'plaza'：表结构与接口均支持 section 参数（未来分区 UI 的架构预留），
 * 当前不做分区过滤（不传 section 即查全部），也不写死单分区逻辑。
 * 关键动作发语义留档：post.create / post.like / post.unlike / post.delete
 */
import { json, error, dbAll, dbGet, dbRun } from './core.js';
import { dbFindUserById } from './db.js';
import { logEvent } from './log.js';

// ============================================================
// 本模块消息常量（自持，不改 core.js 的 MSG）
// ============================================================
const PMSG = {
  USER_NOT_FOUND: '用户不存在',
  TEACHER_ONLY: '仅教师可发布帖子',
  TITLE_REQUIRED: '标题不能为空',
  TITLE_TOO_LONG: '标题不能超过 60 个字符',
  BODY_TOO_LONG: '正文不能超过 20000 个字符',
  POST_NOT_FOUND: '帖子不存在',
  DELETE_FORBIDDEN: '仅作者本人可删除该帖子',
  POST_PUBLISHED: '发布成功',
  POST_DELETED: '帖子已删除',
};

// LIKE 通配符转义：让用户输入中的 % 与 _ 按字面匹配
function likeEscape(s) {
  return String(s).replace(/[\\%_]/g, c => '\\' + c);
}

/**
 * GET /api/posts?sort=new|hot&section=&q=&userId=
 * → { posts: [...] }，每条含 username（JOIN users）与 liked 布尔（传了 userId 时查 post_likes）
 * sort: new=created_at DESC（默认）；hot=like_count DESC, created_at DESC
 * section: 不传则不过滤（分区预留）；q: 对 title + body_md 做 LIKE 模糊匹配
 */
export async function handleListPosts(db, url) {
  const sort = url.searchParams.get('sort') === 'hot' ? 'hot' : 'new';
  const section = url.searchParams.get('section');
  const q = (url.searchParams.get('q') || '').trim();
  const viewerId = parseInt(url.searchParams.get('userId'));
  const hasViewer = Number.isFinite(viewerId);

  const cond = [], params = [];
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

  // 传了 userId：LEFT JOIN post_likes 产出 liked 布尔；未传则恒 0
  const likeJoin = hasViewer
    ? 'LEFT JOIN post_likes pl ON pl.post_id = p.id AND pl.user_id = ?' : '';
  const likeSel = hasViewer ? '(pl.id IS NOT NULL) AS liked' : '0 AS liked';
  const bind = hasViewer ? [viewerId, ...params] : params;

  const rows = await dbAll(db,
    `SELECT p.id, p.user_id, p.section, p.title, p.body_md, p.like_count,
            p.created_at, p.updated_at, u.username, ${likeSel}
     FROM posts p
     LEFT JOIN users u ON u.id = p.user_id
     ${likeJoin}${where}
     ORDER BY ${order}`, bind);

  return json({ posts: rows.map(r => ({ ...r, liked: !!r.liked })) });
}

/**
 * POST /api/posts  body: { userId, title, bodyMd }
 * 校验教师角色（dbFindUserById）、title 非空且 ≤60、bodyMd ≤20000；
 * section 恒 'plaza'；返回 { id, message }
 */
export async function handleCreatePost(db, body, req) {
  const userId = parseInt(body.userId);
  const title = String(body.title || '').trim();
  const bodyMd = String(body.bodyMd || '');

  const user = await dbFindUserById(db, userId);
  if (!user) return error(PMSG.USER_NOT_FOUND, 404);
  if (user.role !== 'teacher') return error(PMSG.TEACHER_ONLY, 403);
  if (!title) return error(PMSG.TITLE_REQUIRED);
  if (title.length > 60) return error(PMSG.TITLE_TOO_LONG);
  if (bodyMd.length > 20000) return error(PMSG.BODY_TOO_LONG);

  const result = await dbRun(db,
    "INSERT INTO posts (user_id, section, title, body_md) VALUES (?, 'plaza', ?, ?)",
    [userId, title, bodyMd]);
  const id = Number(result.meta.last_row_id);

  const author = await dbGet(db, 'SELECT username FROM users WHERE id=?', [userId]);
  logEvent(db, {
    action: 'post.create', actorUserId: userId, actorUsername: author?.username || null,
    actorRole: user.role, entity: 'post', entityId: id, detail: { title }, req,
  });
  return json({ id, message: PMSG.POST_PUBLISHED });
}

/**
 * POST /api/posts/:id/like  body: { userId }
 * 有则删、无则插（UNIQUE(post_id,user_id) 兜底），再用 COUNT 回写 posts.like_count，杜绝计数漂移
 * → { liked, likeCount }
 */
export async function handleToggleLike(db, postId, body, req) {
  const userId = parseInt(body.userId);
  const user = await dbFindUserById(db, userId);
  if (!user) return error(PMSG.USER_NOT_FOUND, 404);

  const post = await dbGet(db, 'SELECT id FROM posts WHERE id=?', [postId]);
  if (!post) return error(PMSG.POST_NOT_FOUND, 404);

  const existing = await dbGet(db,
    'SELECT id FROM post_likes WHERE post_id=? AND user_id=?', [postId, userId]);
  let liked;
  if (existing) {
    await dbRun(db, 'DELETE FROM post_likes WHERE id=?', [existing.id]);
    liked = false;
  } else {
    await dbRun(db, 'INSERT INTO post_likes (post_id, user_id) VALUES (?,?)', [postId, userId]);
    liked = true;
  }

  // 以 COUNT 为唯一事实源同步计数
  await dbRun(db,
    'UPDATE posts SET like_count = (SELECT COUNT(*) FROM post_likes WHERE post_id=?) WHERE id=?',
    [postId, postId]);
  const row = await dbGet(db, 'SELECT like_count FROM posts WHERE id=?', [postId]);

  logEvent(db, {
    action: liked ? 'post.like' : 'post.unlike', actorUserId: userId,
    actorRole: user.role, entity: 'post', entityId: postId, req,
  });
  return json({ liked, likeCount: row?.like_count || 0 });
}

/**
 * DELETE /api/posts/:id  body: { userId }
 * 仅作者本人可删：帖子不存在 → 404；非作者 → 403。
 * post_likes 由外键 ON DELETE CASCADE 连带清理，无需手工删。
 */
export async function handleDeletePost(db, postId, body, req) {
  const userId = parseInt(body.userId);
  const user = await dbFindUserById(db, userId);
  if (!user) return error(PMSG.USER_NOT_FOUND, 404);

  const post = await dbGet(db, 'SELECT id, user_id, title FROM posts WHERE id=?', [postId]);
  if (!post) return error(PMSG.POST_NOT_FOUND, 404);
  if (userId !== Number(post.user_id)) return error(PMSG.DELETE_FORBIDDEN, 403);

  await dbRun(db, 'DELETE FROM posts WHERE id=?', [postId]);
  logEvent(db, {
    action: 'post.delete', actorUserId: userId, actorRole: user.role,
    entity: 'post', entityId: postId, detail: { title: post.title }, req,
  });
  return json({ message: PMSG.POST_DELETED });
}

/**
 * 路由模块：资料共享广场（帖子列表 / 发布 / 点赞切换 / 删除）
 *
 * section 字段恒透传 'plaza'：表结构与接口均支持 section 参数（未来分区 UI 的架构预留），
 * 当前不做分区过滤（不传 section 即查全部），也不写死单分区逻辑。
 * 关键动作发语义留档：post.create / post.like / post.unlike / post.delete
 */
import { json, error, authUser, MSG } from './core.js';
import {
  dbListPosts, dbCreatePost, dbGetPostById, dbGetPostLike,
  dbCreatePostLike, dbDeletePostLike, dbSyncPostLikeCount, dbGetPostLikeCount,
  dbDeletePost, dbGetUserById,
} from './db.js';
import { logEvent } from './log.js';

// ============================================================
// 本模块消息常量：仅保留帖子业务专属文案（标题/正文长度、删除权限、发布/删除结果）。
// 通用错误（登录/角色/不存在）一律复用 core.js MSG，避免文案第三来源（CLAUDE.md 纪律）
// ============================================================
const PMSG = {
  TITLE_REQUIRED: '标题不能为空',
  TITLE_TOO_LONG: '标题不能超过 60 个字符',
  BODY_TOO_LONG: '正文不能超过 20000 个字符',
  DELETE_FORBIDDEN: '仅作者本人可删除该帖子',
  POST_PUBLISHED: '发布成功',
  POST_DELETED: '帖子已删除',
};
// 注：帖子不存在改复用 MSG.USER_NOT_FOUND（core.js 无帖子专属「不存在」文案，避免新增第三来源）

/**
 * GET /api/posts?sort=new|hot&section=&q=&userId=
 * → { posts: [...] }，每条含 username（JOIN users）与 liked 布尔（凭令牌查本人点赞）
 * sort: new=created_at DESC（默认）；hot=like_count DESC, created_at DESC
 * section: 不传则不过滤（分区预留）；q: 对 title + body_md 做 LIKE 模糊匹配
 */
export async function handleListPosts(db, url, req) {
  const sort = url.searchParams.get('sort') === 'hot' ? 'hot' : 'new';
  const section = url.searchParams.get('section');
  const q = (url.searchParams.get('q') || '').trim();
  const viewer = await authUser(db, req); // liked 标记凭令牌取本人点赞；访客列表照常公开、liked 恒 false
  const posts = await dbListPosts(db, { section, q, viewerId: viewer ? viewer.id : null, sort });
  return json({ posts });
}

/**
 * POST /api/posts  body: { title, bodyMd }
 * 身份凭令牌、校验教师角色；title 非空且 ≤60、bodyMd ≤20000；
 * section 恒 'plaza'；返回 { id, message }
 */
export async function handleCreatePost(db, body, req) {
  const user = await authUser(db, req); // 身份凭令牌（曾凭自报 userId 可冒名教师发帖）
  if (!user) return error(MSG.LOGIN_REQUIRED, 401);
  const userId = user.id;
  const title = String(body.title || '').trim();
  const bodyMd = String(body.bodyMd || '');

  if (user.role !== 'teacher') return error(MSG.TEACHER_ONLY, 403);
  if (!title) return error(PMSG.TITLE_REQUIRED);
  if (title.length > 60) return error(PMSG.TITLE_TOO_LONG);
  if (bodyMd.length > 20000) return error(PMSG.BODY_TOO_LONG);

  const id = await dbCreatePost(db, userId, title, bodyMd);

  const author = await dbGetUserById(db, userId);
  await logEvent(db, {
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
  const user = await authUser(db, req); // 身份凭令牌（曾凭自报 userId 可用他人 id 点赞）
  if (!user) return error(MSG.LOGIN_REQUIRED, 401);
  const userId = user.id;

  const post = await dbGetPostById(db, postId);
  if (!post) return error(MSG.POST_NOT_FOUND, 404);

  const existing = await dbGetPostLike(db, postId, userId);
  let liked;
  if (existing) {
    await dbDeletePostLike(db, existing.id);
    liked = false;
  } else {
    await dbCreatePostLike(db, postId, userId);
    liked = true;
  }

  // 以 COUNT 为唯一事实源同步计数
  await dbSyncPostLikeCount(db, postId);
  const likeCount = await dbGetPostLikeCount(db, postId);

  await logEvent(db, {
    action: liked ? 'post.like' : 'post.unlike', actorUserId: userId,
    actorRole: user.role, entity: 'post', entityId: postId, req,
  });
  return json({ liked, likeCount });
}

/**
 * DELETE /api/posts/:id  body: { userId }
 * 仅作者本人可删：帖子不存在 → 404；非作者 → 403。
 * post_likes 由外键 ON DELETE CASCADE 连带清理，无需手工删。
 */
export async function handleDeletePost(db, postId, body, req) {
  const user = await authUser(db, req); // 身份凭令牌（曾凭自报 userId 可非管理员删他人帖）
  if (!user) return error(MSG.LOGIN_REQUIRED, 401);

  const post = await dbGetPostById(db, postId);
  if (!post) return error(MSG.USER_NOT_FOUND, 404);
  // 仅作者本人可删；管理员凭令牌越权删除（资料管理页）
  const admin = user.role === 'admin' ? user : null;
  if (user.id !== Number(post.user_id) && !admin) return error(PMSG.DELETE_FORBIDDEN, 403);

  await dbDeletePost(db, postId);
  await logEvent(db, {
    action: admin ? 'admin.post.delete' : 'post.delete',
    actorUserId: user.id, actorRole: admin ? 'admin' : user.role,
    entity: 'post', entityId: postId, detail: { title: post.title, ownerUserId: post.user_id }, req,
  });
  return json({ message: PMSG.POST_DELETED });
}

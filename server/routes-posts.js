/**
 * 路由模块：资料共享广场（帖子列表 / 发布 / 点赞切换 / 删除）
 *
 * section 字段恒透传 'plaza'：表结构与接口均支持 section 参数（未来分区 UI 的架构预留），
 * 当前不做分区过滤（不传 section 即查全部）。
 * 关键动作发语义留档：post.create / post.like / post.unlike / post.delete / admin.post.delete
 * 安全补丁已并入主线：身份一律凭令牌（曾凭自报 userId 可冒名/越权）、管理员判定单点。
 */
import { json, error } from './util.js';
import { authUser, requireUser, requireAdminOrError } from './security.js';
import { MSG, LIMITS } from './constants.js';
import '../constants.js'; // 副作用导入（v0.25.86 审计补）：UI() 惰性读 globalThis.APP_CONSTANTS 依赖其就绪——曾靠 routes-auth 先加载碰巧生效，删除别处 import 即静默变 {error: undefined}
import {
  dbListPosts, dbCreatePost, dbGetPostById, dbDeletePost, dbGetUserById, dbListMyFavoritePosts,
  dbCreatePostFavorite, dbDeletePostFavorite,
  dbGetPostLikeToggleRead, dbGetPostFavoriteToggleRead, dbTogglePostLike, // U10：批量读写 helper
} from './db.js';
import { logEvent } from './log.js';

// 文案单源（A3 收口 v0.25.78）：帖子业务文案全部读 globalThis.APP_CONSTANTS.UI（与前端同源），
// 本模块不再自持 PMSG——曾与 constants UI 逐字重复，双源迟早漂移
const UI = () => (globalThis.APP_CONSTANTS && globalThis.APP_CONSTANTS.UI) || {};

/**
 * GET /api/posts?sort=new|hot&section=&q=
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
 * 身份凭令牌、校验教师角色；title 非空且 ≤LIMITS.TITLE_MAX、bodyMd ≤LIMITS.POST_BODY_MAX；
 * section 恒 'plaza'；返回 { id, message }
 */
export async function handleCreatePost(db, body, req) {
  const { user, err } = await requireUser(db, req, 'teacher'); // 身份凭令牌 + 角色门（曾凭自报 userId 可冒名教师发帖）
  if (err) return err;
  const userId = user.id;
  const title = String(body.title || '').trim();
  const bodyMd = String(body.bodyMd || '');

  if (!title) return error(UI().POST_TITLE_REQUIRED);
  if (title.length > LIMITS.TITLE_MAX) return error(UI().POST_TITLE_TOO_LONG);
  if (bodyMd.length > LIMITS.POST_BODY_MAX) return error(UI().POST_BODY_TOO_LONG);

  const id = await dbCreatePost(db, userId, title, bodyMd);

  const author = await dbGetUserById(db, userId);
  await logEvent(db, {
    action: 'post.create', actorUserId: userId, actorUsername: author?.username || null,
    actorRole: user.role, entity: 'post', entityId: id, detail: { title }, req,
  });
  return json({ id, message: UI().POST_PUBLISHED });
}

/**
 * POST /api/posts/:id/like
 * 有则删、无则插（UNIQUE(post_id,user_id) 兜底），再用 COUNT 回写 posts.like_count，杜绝计数漂移
 * → { liked, likeCount }
 */
export async function handleToggleLike(db, postId, body, req) {
  const { user, err } = await requireUser(db, req); // 身份凭令牌（曾凭自报 userId 可用他人 id 点赞）
  if (err) return err;
  const userId = user.id;

  // U10（网络层架构债）：帖 + 本人点赞记录一步 batch 取回（原 2 次串行 D1 往返 → 1 次）
  const { post, like } = await dbGetPostLikeToggleRead(db, postId, userId);
  if (!post) return error(MSG.POST_NOT_FOUND, 404, 'POST_NOT_FOUND');

  const liked = !like;
  // U10：写入 + 计数同步 + 计数回读同一 batch（原 3 次串行 → 1 次；点赞 6 次往返 → 3 次）
  const { likeCount } = await dbTogglePostLike(db, postId, userId, like ? like.id : null);

  await logEvent(db, {
    action: liked ? 'post.like' : 'post.unlike', actorUserId: userId,
    actorRole: user.role, entity: 'post', entityId: postId, req,
  });
  return json({ liked, likeCount });
}

/**
 * GET /api/posts/favorites/mine —— 我的收藏（R23）
 * 仅登录本人可见自己的收藏；复用广场卡字段集，按收藏时间倒序。
 */
export async function handleMyFavorites(db, req) {
  const { user, err } = await requireUser(db, req);
  if (err) return err;
  return json({ posts: await dbListMyFavoritePosts(db, user.id) });
}

/**
 * POST /api/posts/:id/favorite —— 收藏/取消收藏切换（R23）
 * 有则删、无则插（UNIQUE(post_id,user_id) 兜底）；收藏是私人的，无公开计数。
 * → { favorited }
 */
export async function handleToggleFavorite(db, postId, body, req) {
  const { user, err } = await requireUser(db, req);
  if (err) return err;
  // U10（网络层架构债）：帖 + 本人收藏记录一步 batch 取回（原 2 次串行 D1 往返 → 1 次）
  const { post, fav } = await dbGetPostFavoriteToggleRead(db, postId, user.id);
  if (!post) return error(MSG.POST_NOT_FOUND, 404, 'POST_NOT_FOUND');

  let favorited;
  if (fav) {
    await dbDeletePostFavorite(db, fav.id);
    favorited = false;
  } else {
    await dbCreatePostFavorite(db, postId, user.id);
    favorited = true;
  }
  await logEvent(db, {
    action: favorited ? 'post.favorite' : 'post.unfavorite', actorUserId: user.id,
    actorRole: user.role, entity: 'post', entityId: postId, req,
  });
  return json({ favorited });
}

/**
 * DELETE /api/posts/:id
 * 仅作者本人可删；管理员凭令牌越权删除（资料管理页）——管理员判定走 requireAdminOrError 单点。
 * post_likes / post_favorites 由外键 ON DELETE CASCADE 连带清理，无需手工删。
 */
export async function handleDeletePost(db, postId, body, req) {
  const { user, err } = await requireUser(db, req); // 身份凭令牌（曾凭自报 userId 可非管理员删他人帖）
  if (err) return err;

  const post = await dbGetPostById(db, postId);
  if (!post) return error(MSG.POST_NOT_FOUND, 404, 'POST_NOT_FOUND');
  const isAdmin = requireAdminOrError(user) === null; // 管理员判定单点
  if (user.id !== Number(post.user_id) && !isAdmin) return error(UI().POST_DELETE_FORBIDDEN, 403); // 非作者且非管理员 → 拒

  await dbDeletePost(db, postId);
  await logEvent(db, {
    action: isAdmin ? 'admin.post.delete' : 'post.delete',
    actorUserId: user.id, actorRole: isAdmin ? 'admin' : user.role,
    entity: 'post', entityId: postId, detail: { title: post.title, ownerUserId: post.user_id }, req,
  });
  return json({ message: UI().POST_DELETED });
}

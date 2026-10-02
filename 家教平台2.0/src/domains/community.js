import { one, all, run, HttpError } from "../db.js";
import { currentUser, requireUser } from "../auth.js";
import { LIMIT, INITIAL_RATING, INITIAL_WEIGHT } from "../shared.js";

export async function updateRating(db, teacherId) {
  await run(
    db,
    "UPDATE teacher_profiles SET rating_count=(SELECT count(*) FROM reviews WHERE teacher_user_id=? AND status='approved'),rating=(?*?+coalesce((SELECT sum(rating) FROM reviews WHERE teacher_user_id=? AND status='approved'),0))/(?+(SELECT count(*) FROM reviews WHERE teacher_user_id=? AND status='approved')) WHERE user_id=?",
    [
      teacherId,
      INITIAL_RATING,
      INITIAL_WEIGHT,
      teacherId,
      INITIAL_WEIGHT,
      teacherId,
      teacherId,
    ],
  );
}
async function posts(ctx, favorites = false) {
  const me = favorites
    ? await requireUser(ctx.db, ctx.request)
    : await currentUser(ctx.db, ctx.request);
  const page = Number(ctx.url.searchParams.get("page") || 1);
  const where = ["u.banned=0", "u.deactivated=0"],
    args = [];
  if (favorites) {
    where.push(
      "EXISTS(SELECT 1 FROM post_favorites f WHERE f.post_id=p.id AND f.user_id=?)",
    );
    args.push(me.id);
  }
  const q = ctx.url.searchParams.get("q");
  if (q) {
    where.push("(p.title LIKE ? OR p.body_md LIKE ?)");
    args.push("%" + q + "%", "%" + q + "%");
  }
  const total = (
    await one(
      ctx.db,
      `SELECT count(*) AS n FROM posts p JOIN users u ON u.id=p.user_id WHERE ${where.join(" AND ")}`,
      args,
    )
  ).n;
  return {
    posts: await all(
      ctx.db,
      `SELECT p.id,p.user_id,p.title,substr(p.body_md,1,180) AS excerpt,p.like_count,p.created_at,p.updated_at,u.username,EXISTS(SELECT 1 FROM post_likes l WHERE l.post_id=p.id AND l.user_id=?) AS liked,EXISTS(SELECT 1 FROM post_favorites f WHERE f.post_id=p.id AND f.user_id=?) AS favorited FROM posts p JOIN users u ON u.id=p.user_id WHERE ${where.join(" AND ")} ORDER BY p.id DESC LIMIT 24 OFFSET ?`,
      [me?.id || 0, me?.id || 0, ...args, (page - 1) * 24],
    ),
    total,
    page,
  };
}
async function post(ctx) {
  const me = await currentUser(ctx.db, ctx.request);
  const row = await one(
    ctx.db,
    "SELECT p.*,u.username FROM posts p JOIN users u ON u.id=p.user_id WHERE p.id=? AND u.deactivated=0 AND u.banned=0",
    [ctx.params.id],
  );
  if (!row) throw new HttpError(404, "NOT_FOUND", "资料帖不存在");
  const flags = me
    ? await one(
        ctx.db,
        "SELECT EXISTS(SELECT 1 FROM post_likes WHERE post_id=? AND user_id=?) AS liked,EXISTS(SELECT 1 FROM post_favorites WHERE post_id=? AND user_id=?) AS favorited",
        [row.id, me.id, row.id, me.id],
      )
    : {};
  return { post: { ...row, ...flags } };
}
async function save(ctx, update = false) {
  const me = await requireUser(ctx.db, ctx.request, "teacher");
  const b = ctx.body;
  if (!b.title || !b.body_md)
    throw new HttpError(400, "POST", "请填写标题和正文");
  if (
    b.title.length > LIMIT.postTitleMax ||
    b.body_md.length > LIMIT.postBodyMax
  )
    throw new HttpError(
      400,
      "POST_LENGTH",
      "标题最多 60 字，正文最多 20000 字",
    );
  if (update) {
    const row = await one(ctx.db, "SELECT user_id FROM posts WHERE id=?", [
      ctx.params.id,
    ]);
    if (!row || row.user_id !== me.id)
      throw new HttpError(403, "NO_PERMISSION", "只能编辑自己的资料帖");
    await run(
      ctx.db,
      "UPDATE posts SET title=?,body_md=?,updated_at=datetime('now') WHERE id=?",
      [b.title, b.body_md, ctx.params.id],
    );
    return { id: Number(ctx.params.id) };
  }
  const result = await run(
    ctx.db,
    "INSERT INTO posts(user_id,title,body_md) VALUES (?,?,?)",
    [me.id, b.title, b.body_md],
  );
  return { id: result.meta.last_row_id };
}
async function remove(ctx) {
  const me = await requireUser(ctx.db, ctx.request);
  const p = await one(ctx.db, "SELECT user_id FROM posts WHERE id=?", [
    ctx.params.id,
  ]);
  if (!p) throw new HttpError(404, "NOT_FOUND", "资料帖不存在");
  if (p.user_id !== me.id && me.role !== "admin")
    throw new HttpError(403, "NO_PERMISSION", "只能删除自己的资料帖");
  await run(ctx.db, "DELETE FROM posts WHERE id=?", [ctx.params.id]);
  return { ok: true };
}
async function toggle(ctx, favorite = false) {
  const me = await requireUser(ctx.db, ctx.request);
  if (!(await one(ctx.db, "SELECT id FROM posts WHERE id=?", [ctx.params.id])))
    throw new HttpError(404, "NOT_FOUND", "资料帖不存在");
  const table = favorite ? "post_favorites" : "post_likes";
  const existing = await one(
    ctx.db,
    `SELECT user_id FROM ${table} WHERE post_id=? AND user_id=?`,
    [ctx.params.id, me.id],
  );
  if (existing)
    await run(ctx.db, `DELETE FROM ${table} WHERE post_id=? AND user_id=?`, [
      ctx.params.id,
      me.id,
    ]);
  else
    await run(ctx.db, `INSERT INTO ${table}(post_id,user_id) VALUES (?,?)`, [
      ctx.params.id,
      me.id,
    ]);
  if (!favorite)
    await run(
      ctx.db,
      "UPDATE posts SET like_count=(SELECT count(*) FROM post_likes WHERE post_id=?) WHERE id=?",
      [ctx.params.id, ctx.params.id],
    );
  return { active: !existing };
}
async function reviews(ctx) {
  const teacher = ctx.url.searchParams.get("teacher_id");
  const me = await currentUser(ctx.db, ctx.request);
  return {
    reviews: await all(
      ctx.db,
      "SELECT r.id,r.teacher_user_id,r.rating,r.comment,r.created_at,u.username FROM reviews r JOIN users u ON u.id=r.reviewer_user_id WHERE r.teacher_user_id=? AND r.status='approved' ORDER BY r.id DESC",
      [teacher],
    ),
    mine: me
      ? await one(
          ctx.db,
          "SELECT id,rating,comment,status FROM reviews WHERE teacher_user_id=? AND reviewer_user_id=?",
          [teacher, me.id],
        )
      : null,
  };
}
async function review(ctx, update = false) {
  const me = await requireUser(ctx.db, ctx.request, "student");
  const b = ctx.body;
  let existing = update
    ? await one(
        ctx.db,
        "SELECT * FROM reviews WHERE id=? AND reviewer_user_id=?",
        [ctx.params.id, me.id],
      )
    : null;
  if (update && !existing) throw new HttpError(404, "NOT_FOUND", "评价不存在");
  const teacherId = existing ? existing.teacher_user_id : b.teacher_user_id;
  const c = await one(
    ctx.db,
    "SELECT c.id FROM conversations c JOIN teacher_profiles p ON p.user_id=c.teacher_user_id WHERE c.student_user_id=? AND c.teacher_user_id=? AND c.temp_status IS NULL AND p.verified=1 AND EXISTS(SELECT 1 FROM messages m WHERE m.conversation_id=c.id AND m.sender_user_id=c.student_user_id AND m.kind IN ('text','image','file')) AND EXISTS(SELECT 1 FROM messages m WHERE m.conversation_id=c.id AND m.sender_user_id=c.teacher_user_id AND m.kind IN ('text','image','file'))",
    [me.id, teacherId],
  );
  if (!c)
    throw new HttpError(
      403,
      "REVIEW_ELIGIBILITY",
      "需与已认证教师建立正式会话且双方均发过消息",
    );
  if (!Number.isInteger(b.rating) || b.rating < 1 || b.rating > 5 || !b.comment)
    throw new HttpError(400, "REVIEW", "请填写 1–5 分和评价内容");
  existing ||= await one(
    ctx.db,
    "SELECT id FROM reviews WHERE teacher_user_id=? AND reviewer_user_id=?",
    [teacherId, me.id],
  );
  let id = existing?.id;
  if (existing)
    await run(
      ctx.db,
      "UPDATE reviews SET rating=?,comment=?,status='pending',reviewed_by=NULL,reviewed_at=NULL WHERE id=?",
      [b.rating, b.comment, id],
    );
  else
    id = (
      await run(
        ctx.db,
        "INSERT INTO reviews(teacher_user_id,reviewer_user_id,rating,comment) VALUES (?,?,?,?)",
        [teacherId, me.id, b.rating, b.comment],
      )
    ).meta.last_row_id;
  await updateRating(ctx.db, teacherId);
  return { id, message: "评价已提交，等待审核" };
}
export const routes = [
  ["GET", "/api/posts", (c) => posts(c)],
  ["GET", "/api/posts/favorites/mine", (c) => posts(c, true)],
  ["GET", "/api/posts/:id", post],
  ["POST", "/api/posts", (c) => save(c)],
  ["PUT", "/api/posts/:id", (c) => save(c, true)],
  ["DELETE", "/api/posts/:id", remove],
  ["POST", "/api/posts/:id/like", (c) => toggle(c)],
  ["POST", "/api/posts/:id/favorite", (c) => toggle(c, true)],
  ["GET", "/api/reviews", reviews],
  ["POST", "/api/reviews", (c) => review(c)],
  ["PUT", "/api/reviews/:id", (c) => review(c, true)],
];

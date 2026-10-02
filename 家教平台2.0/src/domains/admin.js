import { one, all, run, HttpError } from "../db.js";
import { requireUser, decodeField } from "../auth.js";
import { updateRating } from "./community.js";
import { notify } from "./feedback.js";

const tables = {
  demands: "student_demands",
  posts: "posts",
  messages: "messages",
  reviews: "reviews",
  complaints: "complaints",
  feedbacks: "feedbacks",
  conversations: "conversations",
};
async function dashboard(ctx) {
  await requireUser(ctx.db, ctx.request, "admin");
  const counts = {};
  for (const [name, sql] of Object.entries({
    users: "SELECT count(*) AS n FROM users WHERE deactivated=0",
    teachers:
      "SELECT count(*) AS n FROM users WHERE role='teacher' AND deactivated=0",
    demands: "SELECT count(*) AS n FROM student_demands WHERE status='open'",
    conversations:
      "SELECT count(*) AS n FROM conversations WHERE status='active' AND temp_status IS NULL",
    verifications:
      "SELECT count(*) AS n FROM teacher_verifications WHERE status='pending'",
    reviews: "SELECT count(*) AS n FROM reviews WHERE status='pending'",
    complaints: "SELECT count(*) AS n FROM complaints WHERE status='open'",
    feedbacks: "SELECT count(*) AS n FROM feedbacks WHERE status='open'",
  }))
    counts[name] = (await one(ctx.db, sql)).n;
  return { counts };
}
async function users(ctx) {
  await requireUser(ctx.db, ctx.request, "admin");
  const q = ctx.url.searchParams.get("q") || "",
    role = ctx.url.searchParams.get("role"),
    args = ["%" + q + "%"];
  const where = ["username LIKE ?"];
  if (role) {
    where.push("role=?");
    args.push(role);
  }
  const page = Number(ctx.url.searchParams.get("page") || 1);
  return {
    users: await all(
      ctx.db,
      `SELECT id,username,role,avatar,banned,deactivated,created_at FROM users WHERE ${where.join(" AND ")} ORDER BY id DESC LIMIT 50 OFFSET ?`,
      [...args, (page - 1) * 50],
    ),
    total: (
      await one(
        ctx.db,
        `SELECT count(*) AS n FROM users WHERE ${where.join(" AND ")}`,
        args,
      )
    ).n,
    page,
  };
}
async function content(ctx) {
  await requireUser(ctx.db, ctx.request, "admin");
  const type = ctx.url.searchParams.get("type"),
    table = tables[type];
  if (!table) throw new HttpError(400, "TYPE", "请选择内容类型");
  const page = Number(ctx.url.searchParams.get("page") || 1),
    status = ctx.url.searchParams.get("status");
  const where = [],
    args = [];
  if (status) {
    where.push("t.status=?");
    args.push(status);
  }
  if (type === "messages") where.push("t.kind IN ('text','image','file')");
  const filter = where.length ? " WHERE " + where.join(" AND ") : "";
  const owner =
    type === "messages"
      ? "sender_user_id"
      : type === "reviews"
        ? "reviewer_user_id"
        : type === "conversations"
          ? "student_user_id"
          : "user_id";
  const items = await all(
    ctx.db,
    `SELECT t.*,u.username FROM ${table} t LEFT JOIN users u ON u.id=t.${owner}${filter} ORDER BY t.id DESC LIMIT 50 OFFSET ?`,
    [...args, (page - 1) * 50],
  );
  for (const row of items) {
    if (type === "messages" && row.kind !== "text") {
      row.body = "";
      row.thumb = await decodeField(ctx.env, row.thumb);
    }
    if (type === "complaints") {
      row.target_snapshot = JSON.parse(row.target_snapshot);
      row.attachments = JSON.parse(row.attachments);
      for (const a of row.attachments) {
        if (a.body) a.body = await decodeField(ctx.env, a.body);
        if (a.thumb) a.thumb = await decodeField(ctx.env, a.thumb);
      }
    }
  }
  return {
    items,
    total: (
      await one(ctx.db, `SELECT count(*) AS n FROM ${table} t${filter}`, args)
    ).n,
    page,
  };
}
async function action(ctx) {
  const admin = await requireUser(ctx.db, ctx.request, "admin");
  const { type, id } = ctx.params;
  const { action, reason = "" } = ctx.body;
  if (type === "users") {
    const user = await one(ctx.db, "SELECT id,role FROM users WHERE id=?", [
      id,
    ]);
    if (!user) throw new HttpError(404, "NOT_FOUND", "用户不存在");
    if (user.role === "admin")
      throw new HttpError(403, "ADMIN", "无法封禁管理员");
    if (!["ban", "unban"].includes(action))
      throw new HttpError(400, "ACTION", "操作不存在");
    await run(ctx.db, "UPDATE users SET banned=? WHERE id=?", [
      action === "ban" ? 1 : 0,
      id,
    ]);
    if (action === "ban")
      await run(ctx.db, "DELETE FROM auth_sessions WHERE user_id=?", [id]);
    await notify(ctx.db, Number(id), "CONTENT_PENALTY", {
      label: "账户",
      reason,
      action: action === "ban" ? "封禁" : "恢复",
    });
    return { ok: true };
  }
  const table = tables[type];
  if (!table) throw new HttpError(400, "TYPE", "内容类型不存在");
  const row = await one(ctx.db, `SELECT * FROM ${table} WHERE id=?`, [id]);
  if (!row) throw new HttpError(404, "NOT_FOUND", "内容不存在");
  if (type === "reviews" && ["approve", "reject"].includes(action)) {
    await run(
      ctx.db,
      "UPDATE reviews SET status=?,reviewed_by=?,reviewed_at=datetime('now') WHERE id=?",
      [action === "approve" ? "approved" : "rejected", admin.id, id],
    );
    await updateRating(ctx.db, row.teacher_user_id);
    await notify(ctx.db, row.reviewer_user_id, "CONTENT_PENALTY", {
      label: "评价",
      action: action === "approve" ? "审核通过" : "审核拒绝",
      reason,
    });
    return { ok: true };
  }
  if (["complaints", "feedbacks"].includes(type) && action === "resolve") {
    await run(
      ctx.db,
      `UPDATE ${table} SET status='resolved'${type === "complaints" ? ",resolved_at=datetime('now')" : ""} WHERE id=?`,
      [id],
    );
    if (row.user_id)
      await notify(ctx.db, row.user_id, "FEEDBACK_RESOLVED", {
        title: row.title || "投诉",
        reason,
      });
    return { ok: true };
  }
  if (type === "conversations" && action === "close") {
    if (row.temp_status) {
      await ctx.db.batch([
        ctx.db.prepare("DELETE FROM messages WHERE conversation_id=?").bind(id),
        ctx.db.prepare("DELETE FROM conversations WHERE id=?").bind(id),
      ]);
      return { ok: true };
    }
    await run(ctx.db, "UPDATE conversations SET status='closed' WHERE id=?", [
      id,
    ]);
    for (const uid of [row.student_user_id, row.teacher_user_id])
      await notify(ctx.db, uid, "CONVERSATION_CLOSED", { name: "管理员" });
    return { ok: true };
  }
  if (type === "demands" && action === "close") {
    await run(ctx.db, "UPDATE student_demands SET status='closed' WHERE id=?", [
      id,
    ]);
    return { ok: true };
  }
  if (action !== "delete")
    throw new HttpError(400, "ACTION", "当前内容不支持此操作");
  if (type === "conversations")
    throw new HttpError(400, "ACTION", "正式会话通过关闭保留历史");
  await run(ctx.db, `DELETE FROM ${table} WHERE id=?`, [id]);
  if (type === "reviews") await updateRating(ctx.db, row.teacher_user_id);
  const owner = row.user_id || row.sender_user_id || row.reviewer_user_id;
  if (owner)
    await notify(ctx.db, owner, "CONTENT_PENALTY", {
      label: {
        posts: "资料",
        demands: "需求",
        messages: "消息",
        reviews: "评价",
        complaints: "投诉",
        feedbacks: "反馈",
      }[type],
      action: "删除",
      reason,
    });
  return { ok: true };
}
async function verifications(ctx) {
  await requireUser(ctx.db, ctx.request, "admin");
  const status = ctx.url.searchParams.get("status");
  const list = await all(
    ctx.db,
    `SELECT v.*,u.username,p.real_name,p.school AS profile_school FROM teacher_verifications v JOIN users u ON u.id=v.user_id LEFT JOIN teacher_profiles p ON p.user_id=v.user_id ${status ? "WHERE v.status=?" : ""} ORDER BY v.id DESC LIMIT 100`,
    status ? [status] : [],
  );
  for (const v of list)
    for (const k of ["verify_code", "admission_image", "real_name"])
      v[k] = await decodeField(ctx.env, v[k]);
  return { verifications: list };
}
async function verifyAction(ctx) {
  const admin = await requireUser(ctx.db, ctx.request, "admin");
  const v = await one(
    ctx.db,
    "SELECT id,user_id,verify_type FROM teacher_verifications WHERE id=?",
    [ctx.params.id],
  );
  if (!v) throw new HttpError(404, "NOT_FOUND", "核验记录不存在");
  const b = ctx.body;
  if (!["approve", "reject"].includes(b.action))
    throw new HttpError(400, "ACTION", "请选择通过或拒绝");
  if (b.action === "reject" && !b.reason)
    throw new HttpError(400, "REASON", "请填写拒绝原因");
  const approved = b.action === "approve";
  await ctx.db.batch([
    ctx.db
      .prepare(
        "UPDATE teacher_verifications SET status=?,school=?,level=?,major=?,enrollment_status=?,enroll_year=?,verified_by=?,verified_at=datetime('now') WHERE id=?",
      )
      .bind(
        approved ? "approved" : "rejected",
        b.school || "",
        b.level || "",
        b.major || "",
        b.enrollment_status || "",
        b.enroll_year || "",
        admin.id,
        v.id,
      ),
    ctx.db
      .prepare("UPDATE teacher_profiles SET verified=? WHERE user_id=?")
      .bind(approved ? 1 : 0, v.user_id),
  ]);
  await notify(
    ctx.db,
    v.user_id,
    approved ? "VERIFY_APPROVED" : "VERIFY_REJECTED",
    approved
      ? { verifyType: v.verify_type, detail: b.school || "" }
      : { reason: b.reason },
  );
  return { ok: true };
}
async function invites(ctx) {
  const me = await requireUser(ctx.db, ctx.request, "admin");
  if (ctx.request.method === "GET")
    return {
      invites: await all(
        ctx.db,
        "SELECT i.*,u.username AS used_name FROM invite_codes i LEFT JOIN users u ON u.id=i.used_by ORDER BY i.created_at DESC LIMIT 200",
      ),
    };
  if (ctx.request.method === "DELETE") {
    if (
      await one(
        ctx.db,
        "SELECT code FROM invite_codes WHERE code=? AND used_by IS NOT NULL",
        [ctx.params.code],
      )
    )
      throw new HttpError(400, "USED", "已使用的邀请码保留记录");
    await run(ctx.db, "DELETE FROM invite_codes WHERE code=?", [
      ctx.params.code,
    ]);
    return { ok: true };
  }
  const code = crypto
    .randomUUID()
    .replaceAll("-", "")
    .slice(0, 10)
    .toUpperCase();
  await run(ctx.db, "INSERT INTO invite_codes(code,created_by) VALUES (?,?)", [
    code,
    me.id,
  ]);
  return { code };
}
async function broadcast(ctx) {
  await requireUser(ctx.db, ctx.request, "admin");
  if (!ctx.body.title || !ctx.body.text)
    throw new HttpError(400, "CONTENT", "请填写标题和通知正文");
  await run(
    ctx.db,
    "INSERT INTO notifications(user_id,text,type,params) SELECT id,'','BROADCAST',? FROM users WHERE deactivated=0",
    [JSON.stringify({ title: ctx.body.title, text: ctx.body.text })],
  );
  return { message: "通知已发给全体用户" };
}
export const routes = [
  ["GET", "/api/admin/dashboard", dashboard],
  ["GET", "/api/admin/users", users],
  ["GET", "/api/admin/content", content],
  ["POST", "/api/admin/content/:type/:id/action", action],
  ["GET", "/api/admin/verifications", verifications],
  ["POST", "/api/admin/verifications/:id/action", verifyAction],
  ["GET", "/api/admin/invites", invites],
  ["POST", "/api/admin/invites", invites],
  ["DELETE", "/api/admin/invites/:code", invites],
  ["POST", "/api/admin/broadcast", broadcast],
];

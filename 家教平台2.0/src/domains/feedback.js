import { one, all, run, HttpError } from "../db.js";
import { currentUser, requireUser, encodeField, decodeField } from "../auth.js";
import { LIMIT } from "../shared.js";

export async function notify(db, userId, type, params = {}) {
  await run(
    db,
    "INSERT INTO notifications(user_id,text,type,params) VALUES (?,?,?,?)",
    [userId, "", type, JSON.stringify(params)],
  );
}
async function notifications(ctx) {
  const me = await requireUser(ctx.db, ctx.request);
  const conditions = [
      "user_id=?",
      "(type IS NULL OR type NOT LIKE 'CONTRACT_%')",
    ],
    args = [me.id];
  if (me.notifyBroadcastMuted)
    conditions.push("(type IS NULL OR type<>'BROADCAST')");
  if (me.blockSystemNotifications)
    conditions.push("(type IS NULL OR type<>'CONTENT_PENALTY')");
  return {
    notifications: (
      await all(
        ctx.db,
        `SELECT id,type,params,text,is_read,created_at FROM notifications WHERE ${conditions.join(" AND ")} ORDER BY id DESC LIMIT 200`,
        args,
      )
    ).map((n) => ({ ...n, params: JSON.parse(n.params || "{}") })),
  };
}
async function complaint(ctx) {
  const me = await requireUser(ctx.db, ctx.request);
  const b = ctx.body;
  if (
    !["teacher", "student", "post"].includes(b.target_type) ||
    !b.target_id ||
    !b.reason
  )
    throw new HttpError(400, "COMPLAINT", "请选择举报对象并填写原因");
  const target =
    b.target_type === "post"
      ? await one(ctx.db, "SELECT id,title,user_id FROM posts WHERE id=?", [
          b.target_id,
        ])
      : await one(
          ctx.db,
          "SELECT id,username,role FROM users WHERE id=? AND role=?",
          [b.target_id, b.target_type],
        );
  if (!target) throw new HttpError(404, "NOT_FOUND", "举报对象不存在");
  if ((b.detail || "").length > LIMIT.complaintMax)
    throw new HttpError(400, "DETAIL", "详细说明最多 2000 字");
  const attachments = [];
  for (const a of b.attachments || []) {
    if (a.body.length > LIMIT.fileMaxBytes * 1.4)
      throw new HttpError(400, "FILE_SIZE", "附件需要小于 700 KB");
    attachments.push({ ...a, body: await encodeField(ctx.env, a.body) });
  }
  const result = await run(
    ctx.db,
    "INSERT INTO complaints(user_id,target_type,target_id,target_snapshot,reason,detail,attachments) VALUES (?,?,?,?,?,?,?)",
    [
      me.id,
      b.target_type,
      b.target_id,
      JSON.stringify(target),
      b.reason,
      b.detail || "",
      JSON.stringify(attachments),
    ],
  );
  return { id: result.meta.last_row_id };
}
async function complaints(ctx) {
  const me = await requireUser(ctx.db, ctx.request);
  const list = await all(
    ctx.db,
    "SELECT * FROM complaints WHERE user_id=? ORDER BY id DESC",
    [me.id],
  );
  for (const c of list) {
    c.target_snapshot = JSON.parse(c.target_snapshot);
    c.attachments = JSON.parse(c.attachments);
    for (const a of c.attachments) a.body = await decodeField(ctx.env, a.body);
  }
  return { complaints: list };
}
async function feedback(ctx) {
  const me = await currentUser(ctx.db, ctx.request);
  const b = ctx.body;
  if (
    !b.title ||
    !b.content ||
    !["bug", "suggestion", "report"].includes(b.kind)
  )
    throw new HttpError(400, "FEEDBACK", "请填写反馈标题和内容");
  if (b.content.length > LIMIT.feedbackMax)
    throw new HttpError(400, "LENGTH", "反馈最多 5000 字");
  if (!me && !b.client_token)
    throw new HttpError(400, "TOKEN", "请刷新页面后提交");
  const result = await run(
    ctx.db,
    "INSERT INTO feedbacks(user_id,client_token,kind,subject,title,content,contact,attrs) VALUES (?,?,?,?,?,?,?,?)",
    [
      me?.id || null,
      me ? "" : b.client_token,
      b.kind,
      b.subject || "",
      b.title,
      b.content,
      b.contact || "",
      JSON.stringify(b.attrs || {}),
    ],
  );
  return { id: result.meta.last_row_id };
}
async function feedbacks(ctx) {
  const me = await currentUser(ctx.db, ctx.request);
  const token = ctx.url.searchParams.get("client_token");
  if (!me && !token) throw new HttpError(401, "TOKEN", "缺少反馈查询标识");
  return {
    feedbacks: await all(
      ctx.db,
      `SELECT id,kind,subject,title,content,status,created_at FROM feedbacks WHERE ${me ? "user_id=?" : "user_id IS NULL AND client_token=?"} ORDER BY id DESC`,
      [me ? me.id : token],
    ),
  };
}
export const routes = [
  ["GET", "/api/notifications", notifications],
  [
    "POST",
    "/api/notifications/read-all",
    async (c) => {
      const me = await requireUser(c.db, c.request);
      await run(c.db, "UPDATE notifications SET is_read=1 WHERE user_id=?", [
        me.id,
      ]);
      return { ok: true };
    },
  ],
  [
    "POST",
    "/api/notifications/:id/read",
    async (c) => {
      const me = await requireUser(c.db, c.request);
      await run(
        c.db,
        "UPDATE notifications SET is_read=1 WHERE id=? AND user_id=?",
        [c.params.id, me.id],
      );
      return { ok: true };
    },
  ],
  ["POST", "/api/complaints", complaint],
  ["GET", "/api/complaints/mine", complaints],
  ["POST", "/api/feedbacks", feedback],
  ["GET", "/api/feedbacks/mine", feedbacks],
];

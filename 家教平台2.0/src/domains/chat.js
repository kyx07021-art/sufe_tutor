import { one, all, run, HttpError } from "../db.js";
import { requireUser, encodeField, decodeField } from "../auth.js";
import { LIMIT } from "../shared.js";
import { notify } from "./feedback.js";

async function conversation(ctx) {
  const me = await requireUser(ctx.db, ctx.request);
  const row = await one(ctx.db, "SELECT * FROM conversations WHERE id=?", [
    ctx.params.id,
  ]);
  if (!row) throw new HttpError(404, "NOT_FOUND", "会话不存在");
  if (
    me.role !== "admin" &&
    me.id !== row.student_user_id &&
    me.id !== row.teacher_user_id
  )
    throw new HttpError(403, "NO_PERMISSION", "只有双方可以查看会话");
  if (
    row.temp_status === "init" &&
    row.temp_initiator_user_id !== me.id &&
    me.role !== "admin"
  )
    throw new HttpError(404, "NOT_FOUND", "会话尚未发起");
  return { me, row };
}
async function list(ctx) {
  const me = await requireUser(ctx.db, ctx.request);
  const conversations = await all(
    ctx.db,
    `SELECT c.*,u.id AS other_id,u.username AS other_name,u.avatar AS other_avatar,
    (SELECT count(*) FROM messages m WHERE m.conversation_id=c.id AND m.sender_user_id<>? AND m.kind IN ('text','image','file') AND m.id>CASE WHEN c.student_user_id=? THEN c.student_last_read_id ELSE c.teacher_last_read_id END) AS unread,
    (SELECT body FROM messages m WHERE m.conversation_id=c.id AND m.kind='text' ORDER BY m.id DESC LIMIT 1) AS last_message,
    (SELECT max(id) FROM messages m WHERE m.conversation_id=c.id) AS last_message_id
    FROM conversations c JOIN users u ON u.id=CASE WHEN c.student_user_id=? THEN c.teacher_user_id ELSE c.student_user_id END
    WHERE (c.student_user_id=? OR c.teacher_user_id=?) AND (c.temp_status IS NULL OR c.temp_status='sent' OR c.temp_initiator_user_id=?) ORDER BY coalesce(last_message_id,0) DESC,c.id DESC`,
    [me.id, me.id, me.id, me.id, me.id, me.id],
  );
  return { conversations };
}
async function start(ctx) {
  const me = await requireUser(ctx.db, ctx.request);
  if (!["student", "teacher"].includes(me.role))
    throw new HttpError(403, "ROLE", "仅学生与教师可以发起会话");
  const target = await one(
    ctx.db,
    "SELECT id,role FROM users WHERE id=? AND banned=0 AND deactivated=0",
    [ctx.body.target_id],
  );
  if (
    !target ||
    target.role !== (me.role === "student" ? "teacher" : "student")
  )
    throw new HttpError(400, "ROLE", "请选择另一类角色的用户");
  const student = me.role === "student" ? me.id : target.id,
    teacher = me.role === "teacher" ? me.id : target.id;
  if (
    ctx.body.demand_id &&
    !(await one(
      ctx.db,
      "SELECT id FROM student_demands WHERE id=? AND user_id=?",
      [ctx.body.demand_id, student],
    ))
  )
    throw new HttpError(400, "DEMAND", "该需求不属于会话学生");
  const existing = await one(
    ctx.db,
    "SELECT id,status FROM conversations WHERE student_user_id=? AND teacher_user_id=?",
    [student, teacher],
  );
  if (existing) {
    if (existing.status === "closed")
      await run(ctx.db, "UPDATE conversations SET status='active' WHERE id=?", [
        existing.id,
      ]);
    return { id: existing.id };
  }
  const result = await run(
    ctx.db,
    "INSERT INTO conversations(student_user_id,teacher_user_id,demand_id,temp_status,temp_initiator_user_id) VALUES (?,?,?,'init',?)",
    [student, teacher, ctx.body.demand_id || null, me.id],
  );
  return { id: result.meta.last_row_id };
}
async function messages(ctx) {
  const { row } = await conversation(ctx);
  const args = [row.id];
  let condition = "";
  if (ctx.url.searchParams.has("after")) {
    condition = " AND m.id>?";
    args.push(Number(ctx.url.searchParams.get("after")));
  }
  if (ctx.url.searchParams.has("before")) {
    condition = " AND m.id<?";
    args.push(Number(ctx.url.searchParams.get("before")));
  }
  const list = await all(
    ctx.db,
    `SELECT * FROM (SELECT m.id,m.conversation_id,m.sender_user_id,m.kind,CASE WHEN m.kind='text' THEN m.body ELSE '' END AS body,m.name,m.thumb,m.created_at,u.username FROM messages m JOIN users u ON u.id=m.sender_user_id WHERE m.conversation_id=? AND m.kind IN ('text','image','file')${condition} ORDER BY m.id DESC LIMIT 50) ORDER BY id`,
    args,
  );
  for (const m of list)
    if (m.thumb) m.thumb = await decodeField(ctx.env, m.thumb);
  return { conversation: row, messages: list };
}
async function send(ctx) {
  const { me, row } = await conversation(ctx);
  const { kind, body, name = "", thumb = "" } = ctx.body;
  if (me.role === "admin")
    throw new HttpError(403, "NO_PERMISSION", "管理员只能查看会话");
  if (row.status !== "active")
    throw new HttpError(400, "CLOSED", "该会话已经关闭");
  const other =
    me.id === row.student_user_id ? row.teacher_user_id : row.student_user_id;
  if (
    !(await one(
      ctx.db,
      "SELECT id FROM users WHERE id=? AND banned=0 AND deactivated=0",
      [other],
    ))
  )
    throw new HttpError(400, "ACCOUNT_UNAVAILABLE", "对方账户已停用");
  if (!["text", "image", "file"].includes(kind) || !body)
    throw new HttpError(400, "MESSAGE", "请输入消息内容");
  if (row.temp_status === "sent" && row.temp_initiator_user_id === me.id)
    throw new HttpError(400, "WAIT_REPLY", "请等待对方回复第一条消息");
  if (row.temp_status && kind !== "text")
    throw new HttpError(400, "TEMP", "建立正式会话后可发送附件");
  if (
    kind === "text" &&
    body.length > (row.temp_status ? LIMIT.greetingMax : LIMIT.messageMax)
  )
    throw new HttpError(
      400,
      "MESSAGE_LENGTH",
      row.temp_status ? "首次问候最多 300 字" : "消息最多 2000 字",
    );
  if (kind !== "text" && body.length > LIMIT.fileMaxBytes * 1.4)
    throw new HttpError(400, "FILE_SIZE", "附件需要小于 700 KB");
  const result = await run(
    ctx.db,
    "INSERT INTO messages(conversation_id,sender_user_id,kind,body,name,thumb) VALUES (?,?,?,?,?,?)",
    [
      row.id,
      me.id,
      kind,
      kind === "text" ? body : await encodeField(ctx.env, body),
      name,
      thumb ? await encodeField(ctx.env, thumb) : "",
    ],
  );
  const field =
    me.id === row.student_user_id
      ? "student_last_read_id"
      : "teacher_last_read_id";
  await run(
    ctx.db,
    `UPDATE conversations SET temp_status=?,${field}=? WHERE id=?`,
    [
      row.temp_status === "init" ? "sent" : null,
      result.meta.last_row_id,
      row.id,
    ],
  );
  return { id: result.meta.last_row_id };
}
async function close(ctx) {
  const { me, row } = await conversation(ctx);
  if (row.temp_status) {
    await ctx.db.batch([
      ctx.db
        .prepare("DELETE FROM messages WHERE conversation_id=?")
        .bind(row.id),
      ctx.db.prepare("DELETE FROM conversations WHERE id=?").bind(row.id),
    ]);
  } else {
    await run(ctx.db, "UPDATE conversations SET status='closed' WHERE id=?", [
      row.id,
    ]);
    await notify(
      ctx.db,
      me.id === row.student_user_id ? row.teacher_user_id : row.student_user_id,
      "CONVERSATION_CLOSED",
      { name: me.username },
    );
  }
  return { ok: true };
}
async function read(ctx) {
  const { me, row } = await conversation(ctx);
  if (me.role === "admin") return { ok: true };
  const field =
    me.id === row.student_user_id
      ? "student_last_read_id"
      : "teacher_last_read_id";
  await run(
    ctx.db,
    `UPDATE conversations SET ${field}=coalesce((SELECT max(id) FROM messages WHERE conversation_id=?),0) WHERE id=?`,
    [row.id, row.id],
  );
  return { ok: true };
}
async function attachment(ctx) {
  const me = await requireUser(ctx.db, ctx.request);
  const m = await one(
    ctx.db,
    "SELECT m.*,c.student_user_id,c.teacher_user_id FROM messages m JOIN conversations c ON c.id=m.conversation_id WHERE m.id=?",
    [ctx.params.id],
  );
  if (!m) throw new HttpError(404, "NOT_FOUND", "附件不存在");
  if (
    me.role !== "admin" &&
    me.id !== m.student_user_id &&
    me.id !== m.teacher_user_id
  )
    throw new HttpError(403, "NO_PERMISSION", "只有双方可以查看附件");
  return {
    body: await decodeField(ctx.env, m.body),
    name: m.name,
    kind: m.kind,
  };
}
export const routes = [
  ["GET", "/api/conversations", list],
  ["GET", "/api/my-relations", list],
  ["POST", "/api/conversations/temp", start],
  ["POST", "/api/conversations/:id/close", close],
  ["POST", "/api/conversations/:id/read", read],
  ["GET", "/api/conversations/:id/messages", messages],
  ["POST", "/api/conversations/:id/messages", send],
  ["GET", "/api/messages/:id/attachment", attachment],
];

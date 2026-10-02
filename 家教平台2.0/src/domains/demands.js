import { one, all, run, HttpError } from "../db.js";
import { requireUser } from "../auth.js";
import { SUBJECTS, PROJECTS, STUDENT_GRADES, METHODS } from "../shared.js";
const demand = (row) => ({
  ...row,
  preferred_tags: JSON.parse(row.preferred_tags || "[]"),
  expected_time: JSON.parse(row.expected_time || "[]"),
});
async function list(ctx, mine = false) {
  const user = await requireUser(
    ctx.db,
    ctx.request,
    mine ? "student" : undefined,
  );
  const where = mine
    ? ["d.user_id=?"]
    : ["d.status='open'", "u.banned=0", "u.deactivated=0"];
  const args = mine ? [user.id] : [];
  for (const key of ["subject", "grade", "province", "teaching_method"]) {
    const value = ctx.url.searchParams.get(key);
    if (value) {
      where.push(`d.${key}=?`);
      args.push(value);
    }
  }
  const page = Number(ctx.url.searchParams.get("page") || 1);
  const q = ctx.url.searchParams.get("q");
  if (q) {
    where.push("(u.username LIKE ? OR d.additional_info LIKE ?)");
    args.push("%" + q + "%", "%" + q + "%");
  }
  const total = (
    await one(
      ctx.db,
      `SELECT count(*) AS n FROM student_demands d JOIN users u ON u.id=d.user_id WHERE ${where.join(" AND ")}`,
      args,
    )
  ).n;
  return {
    demands: (
      await all(
        ctx.db,
        `SELECT d.*,u.username,u.avatar FROM student_demands d JOIN users u ON u.id=d.user_id WHERE ${where.join(" AND ")} ORDER BY d.id DESC LIMIT 24 OFFSET ?`,
        [...args, (page - 1) * 24],
      )
    ).map(demand),
    total,
    page,
  };
}
async function owned(ctx) {
  const me = await requireUser(ctx.db, ctx.request, "student");
  const row = await one(
    ctx.db,
    "SELECT * FROM student_demands WHERE id=? AND user_id=?",
    [ctx.params.id, me.id],
  );
  if (!row) throw new HttpError(404, "NOT_FOUND", "需求不存在");
  return { me, row };
}
async function save(ctx, update = false) {
  const me = update
    ? (await owned(ctx)).me
    : await requireUser(ctx.db, ctx.request, "student");
  const b = ctx.body;
  if (
    ![...SUBJECTS, ...PROJECTS].some((x) => x[0] === b.subject) ||
    !STUDENT_GRADES.some((x) => x[0] === b.grade) ||
    !METHODS.some((x) => x[0] === b.teaching_method)
  )
    throw new HttpError(400, "DEMAND", "请选择科目、年级和授课方式");
  if (Number(b.budget_min) < 0 || Number(b.budget_max) < Number(b.budget_min))
    throw new HttpError(400, "BUDGET", "预算区间不正确");
  if (b.teaching_method !== "online" && !b.address_area)
    throw new HttpError(400, "REGION", "线下授课需填写区域");
  const fields = [
    "subject",
    "grade",
    "province",
    "teaching_method",
    "current_score",
    "address_area",
    "expected_time",
    "preferred_tags",
    "preferred_gender",
    "budget_min",
    "budget_max",
    "additional_info",
  ];
  const values = fields.map((k) =>
    ["preferred_tags", "expected_time"].includes(k)
      ? JSON.stringify(b[k])
      : k === "address_area" && b.teaching_method === "online"
        ? ""
        : b[k],
  );
  if (update) {
    await run(
      ctx.db,
      `UPDATE student_demands SET ${fields.map((k) => k + "=?").join(",")} WHERE id=?`,
      [...values, ctx.params.id],
    );
    return { id: Number(ctx.params.id) };
  }
  const result = await run(
    ctx.db,
    `INSERT INTO student_demands(user_id,${fields.join(",")}) VALUES (?,${fields.map(() => "?").join(",")})`,
    [me.id, ...values],
  );
  return { id: result.meta.last_row_id };
}
async function status(ctx, value) {
  await owned(ctx);
  await run(ctx.db, "UPDATE student_demands SET status=? WHERE id=?", [
    value,
    ctx.params.id,
  ]);
  return { ok: true };
}
export const routes = [
  ["GET", "/api/demands", (c) => list(c)],
  ["GET", "/api/demands/mine", (c) => list(c, true)],
  [
    "GET",
    "/api/demands/:id",
    async (c) => {
      await requireUser(c.db, c.request);
      const row = await one(
        c.db,
        "SELECT d.*,u.username FROM student_demands d JOIN users u ON u.id=d.user_id WHERE d.id=? AND u.deactivated=0",
        [c.params.id],
      );
      if (!row) throw new HttpError(404, "NOT_FOUND", "需求不存在");
      return { demand: demand(row) };
    },
  ],
  ["POST", "/api/demands", (c) => save(c)],
  ["PUT", "/api/demands/:id", (c) => save(c, true)],
  [
    "DELETE",
    "/api/demands/:id",
    async (c) => {
      await owned(c);
      await run(c.db, "DELETE FROM student_demands WHERE id=?", [c.params.id]);
      return { ok: true };
    },
  ],
  ["POST", "/api/demands/:id/open", (c) => status(c, "open")],
  ["POST", "/api/demands/:id/close", (c) => status(c, "closed")],
];

import { one, all, run, HttpError } from "../db.js";
import { requireUser, encodeField, decodeField } from "../auth.js";
import { MATCH_WEIGHT, TOWN_COORDS } from "../shared.js";

const columns =
  "p.user_id,p.grade,p.gender,p.school,p.teacher_name,p.province,p.address,p.subjects,p.gaokao_scores,p.price_min,p.price_max,p.teaching_method,p.time_slots,p.personality_tags,p.nonacademic_projects,p.nonacademic_prices,p.graduation_year,p.experience_years,p.philosophy,p.intro,p.verified,p.rating,p.rating_count,p.updated_at,u.username,u.avatar";
const jsonFields = [
  "time_slots",
  "subjects",
  "gaokao_scores",
  "personality_tags",
  "nonacademic_projects",
  "nonacademic_prices",
];
function profile(row) {
  if (!row) return null;
  for (const field of jsonFields) row[field] = JSON.parse(row[field] || "[]");
  row.subjects = row.subjects.map((x) =>
    typeof x === "string"
      ? { subject: x, score: null, full: null, awards: [] }
      : x,
  );
  return row;
}
export function matchScore(teacher, demand) {
  if (!demand) return null;
  let score = 0,
    weight = 0;
  const add = (name, value) => {
    score += MATCH_WEIGHT[name] * value;
    weight += MATCH_WEIGHT[name];
  };
  if (demand.subject)
    add(
      "subject",
      [
        ...teacher.subjects.map((x) => x.subject),
        ...teacher.nonacademic_projects,
      ].includes(demand.subject)
        ? 1
        : 0,
    );
  if (demand.teaching_method)
    add(
      "method",
      teacher.teaching_method === "both" ||
        demand.teaching_method === "both" ||
        teacher.teaching_method === demand.teaching_method
        ? 1
        : 0,
    );
  if (demand.teaching_method !== "online" && demand.province) {
    if (teacher.province !== demand.province) add("region", 0);
    else if (demand.province === "shanghai") {
      const [a, b] = (teacher.address || "").split("·");
      const [c, d] = (demand.address_area || "").split("·");
      const x = TOWN_COORDS[a]?.[b],
        y = TOWN_COORDS[c]?.[d];
      if (x && y) {
        const rad = (n) => (n * Math.PI) / 180;
        const lat = rad(y[0] - x[0]),
          lng = rad(y[1] - x[1]);
        const h =
          Math.sin(lat / 2) ** 2 +
          Math.cos(rad(x[0])) * Math.cos(rad(y[0])) * Math.sin(lng / 2) ** 2;
        const distance = 6371 * 2 * Math.atan2(Math.sqrt(h), Math.sqrt(1 - h));
        add("region", Math.max(0, 1 - distance / 20));
      }
    } else add("region", 1);
  }
  const quote =
    teacher.nonacademic_prices.find((p) => p.project === demand.subject) ||
    teacher;
  if (demand.budget_max > 0 && quote.price_max > 0) {
    const lo = Math.max(demand.budget_min, quote.price_min),
      hi = Math.min(demand.budget_max, quote.price_max);
    const span = Math.min(
      demand.budget_max - demand.budget_min,
      quote.price_max - quote.price_min,
    );
    add("budget", hi < lo ? 0 : span === 0 ? 1 : (hi - lo) / span);
  }
  if (demand.preferred_tags.length)
    add(
      "personality",
      demand.preferred_tags.filter((t) => teacher.personality_tags.includes(t))
        .length / demand.preferred_tags.length,
    );
  if (demand.preferred_gender)
    add(
      "gender",
      teacher.gender === "undeclared"
        ? 0.5
        : teacher.gender === demand.preferred_gender
          ? 1
          : 0,
    );
  return weight ? Math.round((score / weight) * 100) : null;
}
async function list(ctx) {
  const where = ["u.banned=0", "u.deactivated=0"],
    args = [];
  for (const field of ["gender", "teaching_method", "province"]) {
    const value = ctx.url.searchParams.get(field);
    if (value) {
      where.push(
        field === "teaching_method"
          ? "(p.teaching_method=? OR p.teaching_method='both')"
          : `p.${field}=?`,
      );
      args.push(value);
    }
  }
  const subject = ctx.url.searchParams.get("subject");
  if (subject) {
    where.push(
      "(EXISTS(SELECT 1 FROM json_each(coalesce(nullif(p.subjects,''),'[]')) WHERE CASE WHEN type='object' THEN json_extract(value,'$.subject') ELSE value END=?) OR EXISTS(SELECT 1 FROM json_each(coalesce(nullif(p.nonacademic_projects,''),'[]')) WHERE value=?))",
    );
    args.push(subject, subject);
  }
  if (ctx.url.searchParams.get("verified") === "1") where.push("p.verified=1");
  const q = ctx.url.searchParams.get("q");
  if (q) {
    where.push(
      "(u.username LIKE ? OR p.teacher_name LIKE ? OR p.school LIKE ?)",
    );
    args.push("%" + q + "%", "%" + q + "%", "%" + q + "%");
  }
  let demand = null;
  if (ctx.url.searchParams.get("demand_id")) {
    const me = await requireUser(ctx.db, ctx.request, "student");
    demand = await one(
      ctx.db,
      "SELECT * FROM student_demands WHERE id=? AND user_id=?",
      [ctx.url.searchParams.get("demand_id"), me.id],
    );
    if (!demand) throw new HttpError(404, "NOT_FOUND", "需求不存在");
    demand.preferred_tags = JSON.parse(demand.preferred_tags);
  }
  const page = Number(ctx.url.searchParams.get("page") || 1);
  const count = await one(
    ctx.db,
    `SELECT count(*) AS total FROM teacher_profiles p JOIN users u ON u.id=p.user_id WHERE ${where.join(" AND ")}`,
    args,
  );
  let teachers = (
    await all(
      ctx.db,
      `SELECT ${columns} FROM teacher_profiles p JOIN users u ON u.id=p.user_id WHERE ${where.join(" AND ")} ORDER BY p.verified DESC,p.updated_at DESC${demand ? "" : " LIMIT 24 OFFSET ?"}`,
      demand ? args : [...args, (page - 1) * 24],
    )
  )
    .map(ctx.url.searchParams.has("stored_fields") ? (row)=>row : profile)
    .map((t) => ({ ...t, match: matchScore(t, demand) }));
  if (demand)
    teachers = teachers
      .sort((a, b) => b.match - a.match)
      .slice((page - 1) * 24, page * 24);
  return { teachers, total: count.total, page };
}
async function getProfile(ctx, own = false) {
  const user = own ? await requireUser(ctx.db, ctx.request, "teacher") : null;
  const row = await one(
    ctx.db,
    `SELECT ${own ? "p.*,u.username,u.avatar" : columns} FROM teacher_profiles p JOIN users u ON u.id=p.user_id WHERE p.user_id=? AND u.deactivated=0 AND u.banned=0`,
    [own ? user.id : ctx.params.id],
  );
  if (!row && !own) throw new HttpError(404, "NOT_FOUND", "教师档案不存在");
  const data = profile(row);
  if (own && data)
    for (const key of ["real_name", "wechat", "email"])
      data[key] = await decodeField(ctx.env, data[key]);
  return { profile: data };
}
async function save(ctx) {
  const me = await requireUser(ctx.db, ctx.request, "teacher");
  const p = ctx.body;
  if (
    !p.school ||
    !p.grade ||
    (!p.subjects.length && !p.nonacademic_projects.length)
  )
    throw new HttpError(400, "PROFILE", "请填写学校、阶段和可教科目");
  if (Number(p.price_min) < 0 || Number(p.price_max) < Number(p.price_min))
    throw new HttpError(400, "PRICE", "报价区间不正确");
  if (
    p.nonacademic_prices.some(
      (x) => x.price_min < 0 || x.price_max < x.price_min,
    )
  )
    throw new HttpError(400, "PRICE", "项目报价区间不正确");
  const fields = [
    "grade",
    "gender",
    "school",
    "real_name",
    "teacher_name",
    "province",
    "address",
    "subjects",
    "gaokao_scores",
    "price_min",
    "price_max",
    "teaching_method",
    "time_slots",
    "personality_tags",
    "nonacademic_projects",
    "nonacademic_prices",
    "graduation_year",
    "experience_years",
    "philosophy",
    "intro",
    "wechat",
    "email",
  ];
  const values = [];
  for (const key of fields) {
    let value = p[key];
    if (jsonFields.includes(key)) value = JSON.stringify(value);
    if (["real_name", "wechat", "email"].includes(key))
      value = await encodeField(ctx.env, value);
    values.push(value ?? null);
  }
  await run(
    ctx.db,
    `INSERT INTO teacher_profiles(user_id,${fields.join(",")}) VALUES (?,${fields.map(() => "?").join(",")}) ON CONFLICT(user_id) DO UPDATE SET ${fields.map((x) => `${x}=excluded.${x}`).join(",")},updated_at=datetime('now')`,
    [me.id, ...values],
  );
  return getProfile(ctx, true);
}
async function verification(ctx, type) {
  const me = await requireUser(ctx.db, ctx.request, "teacher");
  const b = ctx.body;
  if (
    !(await one(
      ctx.db,
      "SELECT user_id FROM teacher_profiles WHERE user_id=?",
      [me.id],
    ))
  )
    throw new HttpError(400, "PROFILE", "请先保存教师档案");
  if (type === "chsi" && !b.verify_code)
    throw new HttpError(400, "VERIFY_CODE", "请填写学信网在线验证码");
  if (type === "admission" && !b.admission_image)
    throw new HttpError(400, "IMAGE", "请上传录取通知书");
  if (b.admission_image && b.admission_image.length > 980000)
    throw new HttpError(400, "IMAGE", "图片需要小于 700 KB");
  await ctx.db.batch([
    ctx.db
      .prepare(
        `INSERT INTO teacher_verifications(user_id,verify_type,verify_code,admission_image) VALUES (?,?,?,?) ON CONFLICT(user_id) DO UPDATE SET verify_type=excluded.verify_type,verify_code=excluded.verify_code,admission_image=excluded.admission_image,status='pending',verified_by=NULL,verified_at=NULL,created_at=datetime('now')`,
      )
      .bind(
        me.id,
        type,
        await encodeField(ctx.env, b.verify_code || ""),
        await encodeField(ctx.env, b.admission_image || ""),
      ),
    ctx.db
      .prepare("UPDATE teacher_profiles SET verified=0 WHERE user_id=?")
      .bind(me.id),
  ]);
  return { message: "资料已提交，等待人工核验" };
}
async function verifyStatus(ctx) {
  const me = await requireUser(ctx.db, ctx.request, "teacher");
  const record = await one(
    ctx.db,
    "SELECT id,verify_type,status,school,level,major,enrollment_status,enroll_year,verified_at,created_at FROM teacher_verifications WHERE user_id=?",
    [me.id],
  );
  const note = await one(
    ctx.db,
    "SELECT params FROM notifications WHERE user_id=? AND type='VERIFY_REJECTED' ORDER BY id DESC LIMIT 1",
    [me.id],
  );
  return {
    verification: record,
    reason:
      record?.status === "rejected" && note
        ? JSON.parse(note.params).reason
        : "",
  };
}
export const routes = [
  ["GET", "/api/teachers", list],
  ["GET", "/api/teachers/:id/profile", (c) => getProfile(c)],
  ["GET", "/api/teacher/profile", (c) => getProfile(c, true)],
  ["POST", "/api/teacher/profile", save],
  ["POST", "/api/teacher/verify-chsi", (c) => verification(c, "chsi")],
  [
    "POST",
    "/api/teacher/verify-admission",
    (c) => verification(c, "admission"),
  ],
  ["GET", "/api/teacher/verify-status", verifyStatus],
];

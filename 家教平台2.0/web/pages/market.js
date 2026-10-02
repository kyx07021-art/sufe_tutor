import {
  state,
  api,
  escape as e,
  header,
  empty,
  date,
  go,
  toast,
  bindForm,
  modal,
  confirmAction,
} from "../app.js";
import {
  SUBJECTS,
  PROJECTS,
  STUDENT_GRADES,
  TEACHER_GRADES,
  GENDERS,
  METHODS,
  TAGS,
  PROVINCES,
  DISTRICTS,
  WEEKDAYS,
  label as rawLabel,
} from "../../src/shared.js";
const label = (list, id) => e(rawLabel(list, id));

export const options = (items, value = "", blank = "请选择") =>
  `<option value="">${blank}</option>` +
  items
    .map(
      ([id, name]) =>
        `<option value="${id}" ${String(id) === String(value) ? "selected" : ""}>${e(name)}</option>`,
    )
    .join("");
const select = (name, text, list, value = "", blank = "请选择") =>
  `<label>${text}<select name="${name}">${options(list, value, blank)}</select></label>`;
const field = (name, text, value = "", type = "text") =>
  `<label>${text}<input name="${name}" type="${type}" value="${e(value)}" ${type === "number" ? 'min="0" step="any"' : ""}></label>`;
const areaFields = (province, address = "") =>
  `${select("province", "省份", PROVINCES, province || "shanghai")}<label>区域（上海请选择区 · 街镇）<input name="address" value="${e(address)}" list="areas" placeholder="杨浦区·五角场街道"></label><datalist id="areas">${DISTRICTS.flatMap((d) => d.units.map((u) => `<option value="${d.name}·${u}"></option>`)).join("")}</datalist>`;
const checks = (name, text, list, selected = []) =>
  `<div class="full"><label>${text}</label><div class="checkboxes">${list.map(([id, label]) => `<label><input type="checkbox" name="${name}" value="${id}" ${selected.includes(id) ? "checked" : ""}>${label}</label>`).join("")}</div><br></div>`;
const subjects = (t) =>
  [...t.subjects.map((x) => x.subject), ...t.nonacademic_projects]
    .map(
      (x) =>
        `<span class="tag">${e(label([...SUBJECTS, ...PROJECTS], x))}</span>`,
    )
    .join("");
const timeText = (slots) =>
  slots
    .map((s) => label(WEEKDAYS, s.dow) + " " + e(s.start) + "–" + e(s.end))
    .join("；");
function timeEditor(slots = []) {
  return (
    '<div class="full"><label>每周可授课时间（最多 8 段）</label>' +
    Array.from({ length: 8 }, (_, i) => {
      const s = slots[i] || {};
      return (
        '<div class="time-row">' +
        select("dow_" + i, "星期", WEEKDAYS, s.dow, "不设置") +
        field("start_" + i, "开始", s.start || "", "time") +
        field("end_" + i, "结束", s.end || "", "time") +
        "</div>"
      );
    }).join("") +
    "</div>"
  );
}
function scoreEditor(data) {
  return (
    '<details class="full"><summary>高考成绩 / 等第（选填）</summary>' +
    SUBJECTS.map(([id, name]) => {
      const s =
        data.gaokao_scores.find((x) => x.subject === id) ||
        data.subjects.find((x) => x.subject === id) ||
        {};
      return (
        '<div class="time-row">' +
        field("score_" + id, name + " · 得分", s.score, "number") +
        field(
          "full_" + id,
          "满分",
          s.full ||
            (["chinese", "math", "english"].includes(id)
              ? 150
              : id.endsWith("_comprehensive")
                ? 300
                : 100),
          "number",
        ) +
        field("grade_" + id, "等第", s.grade || "") +
        "</div>"
      );
    }).join("") +
    "</details>"
  );
}
function projectEditor(prices) {
  return (
    '<details class="full"><summary>非学科项目单独报价（空白使用总体报价）</summary><div class="form-grid">' +
    PROJECTS.map(([id, name]) => {
      const p = prices.find((x) => x.project === id) || {};
      return (
        field("project_min_" + id, name + " · 最低", p.price_min, "number") +
        field("project_max_" + id, name + " · 最高", p.price_max, "number")
      );
    }).join("") +
    "</div></details>"
  );
}
function readTimes(body) {
  const slots = [];
  for (let i = 0; i < 8; i++) {
    if (body["dow_" + i]) {
      if (
        !body["start_" + i] ||
        !body["end_" + i] ||
        body["start_" + i] >= body["end_" + i]
      )
        throw new Error("请填写完整时间，结束需晚于开始");
      slots.push({
        type: "week",
        dow: Number(body["dow_" + i]),
        start: body["start_" + i],
        end: body["end_" + i],
      });
    }
    delete body["dow_" + i];
    delete body["start_" + i];
    delete body["end_" + i];
  }
  return slots;
}
function pagination(root, total, page, params) {
  if (total <= 24) return;
  const n = Math.ceil(total / 24);
  root.insertAdjacentHTML(
    "beforeend",
    `<div class="pagination"><button id="previous" ${page <= 1 ? "disabled" : ""}>上一页</button><span>${page} / ${n}</span><button id="next" ${page >= n ? "disabled" : ""}>下一页</button></div>`,
  );
  root.querySelector("#previous").onclick = () =>
    go(params.page, { ...params, index: page - 1 });
  root.querySelector("#next").onclick = () =>
    go(params.page, { ...params, index: page + 1 });
}
async function filters(root, params, type) {
  const demands =
    state.user?.role === "student" && type === "teachers"
      ? (await api("/api/demands/mine")).demands
      : [];
  root.insertAdjacentHTML(
    "beforeend",
    `<details class="filter"><summary>筛选与匹配 ↓</summary><form><div class="form-grid">${field("q", type === "teachers" ? "教师 / 学校关键词" : "学生 / 需求关键词", params.q || "")}${select("subject", "科目", [...SUBJECTS, ...PROJECTS], params.subject)}${select("teaching_method", "授课方式", METHODS, params.teaching_method)}${select("province", "省份", PROVINCES, params.province)}${type === "teachers" ? `${select("gender", "教师性别", GENDERS, params.gender, "不限")}<label>认证状态<select name="verified"><option value="">全部</option><option value="1" ${params.verified === "1" ? "selected" : ""}>已认证</option></select></label>` : select("grade", "年级", STUDENT_GRADES, params.grade)}${
      demands.length
        ? `<label>选择需求计算匹配度<select name="demand_id">${options(
            demands.map((d) => [
              d.id,
              label([...SUBJECTS, ...PROJECTS], d.subject) +
                " · " +
                label(STUDENT_GRADES, d.grade),
            ]),
            params.demand_id,
            "不计算匹配度",
          )}</select></label>`
        : ""
    }</div><button type="submit" class="primary">应用筛选</button><p class="form-error"></p></form></details>`,
  );
  bindForm(root.querySelector(".filter form"), async (data) => {
    Object.keys(data).forEach((k) => {
      if (!data[k]) delete data[k];
    });
    go(type, data);
  });
}
async function teachers(root, params) {
  root.innerHTML = header("教师广场", "找到适合的老师，直接开始沟通");
  await filters(root, params, "teachers");
  const data = await api(
    "/api/teachers?" +
      new URLSearchParams({ ...params, page: params.index || 1 }),
  );
  root.insertAdjacentHTML(
    "beforeend",
    data.teachers.length
      ? `<div class="grid">${data.teachers.map((t) => `<article class="card"><div class="card-top"><h2>${e(t.teacher_name || t.username)}</h2>${t.verified ? '<span class="tag verified">已认证</span>' : ""}</div><p class="muted">${e(t.school)} · ${label(TEACHER_GRADES, t.grade)}</p><div class="tags">${subjects(t)}</div><p>${e(label(PROVINCES, t.province))} · ${e(t.address)} · ${label(METHODS, t.teaching_method)}</p><div class="card-top"><span class="price">¥${t.price_min}–${t.price_max}<small class="small"> / 小时</small></span>${t.match !== null ? `<span class="text-link">匹配 ${t.match}%</span>` : ""}</div><p class="small">${t.rating_count ? `${Number(t.rating).toFixed(1)} 分 · ${t.rating_count} 条评价` : "暂无公开评价"}</p><div class="actions"><a class="button" href="#teacher?id=${t.user_id}">查看档案 →</a>${state.user?.role === "student" ? `<button class="primary" data-chat="${t.user_id}">联系教师</button>` : ""}</div></article>`).join("")}</div>`
      : empty("暂无符合条件的教师"),
  );
  bindChat(root);
  pagination(root, data.total, data.page, params);
}
export function bindChat(root) {
  root.querySelectorAll("[data-chat]").forEach(
    (button) =>
      (button.onclick = async () => {
        try {
          const c = await api("/api/conversations/temp", {
            method: "POST",
            body: {
              target_id: Number(button.dataset.chat),
              demand_id: Number(button.dataset.demand) || null,
            },
          });
          go("chat", { id: c.id });
        } catch (err) {
          toast(err.message);
        }
      }),
  );
}
async function teacher(root, params) {
  const t = (await api(`/api/teachers/${params.id}/profile`)).profile;
  root.innerHTML =
    header(
      e(t.teacher_name || t.username),
      "公开教师档案",
      state.user?.role === "student"
        ? `<button class="primary" data-chat="${t.user_id}">联系教师</button>`
        : "",
    ) +
    `<article class="paper prose">
      <div class="card-top"><h2>${e(t.school)} · ${label(TEACHER_GRADES, t.grade)}</h2>${t.verified ? '<span class="tag verified">身份已认证</span>' : ""}</div>
      <div class="tags">${subjects(t)}</div><div class="divider"></div>
      <p><strong>报价</strong>　¥${t.price_min}–${t.price_max} / 小时</p>
      <p><strong>授课</strong>　${label(METHODS, t.teaching_method)} · ${label(PROVINCES, t.province)} ${e(t.address)}</p>
      <p><strong>时间</strong>　${t.time_slots.length ? timeText(t.time_slots) : "请在会话中沟通"}</p>
      <p><strong>经验</strong>　${t.experience_years || 0} 年 · ${label(GENDERS, t.gender)}</p>
      <div class="tags">${t.personality_tags.map((x) => `<span class="tag">${label(TAGS, x)}</span>`).join("")}</div>
      <h3>自我介绍</h3><p class="break">${e(t.intro || "尚未填写")}</p>
      <h3>教学理念</h3><p class="break">${e(t.philosophy || "尚未填写")}</p>
      ${t.nonacademic_prices.length ? "<h3>项目报价</h3>" + t.nonacademic_prices.map((p) => "<p>" + label(PROJECTS, p.project) + "：¥" + p.price_min + "–" + p.price_max + " / 小时</p>").join("") : ""}
      ${t.gaokao_scores.length ? "<h3>高考成绩 / 等第</h3>" + t.gaokao_scores.map((s) => "<p>" + label(SUBJECTS, s.subject) + "：" + (s.score !== null && s.score !== undefined ? e(s.score) + (s.full ? " / " + e(s.full) : "") : "") + (s.grade ? " · " + e(s.grade) : "") + "</p>").join("") : ""}
    </article><section id="reviews"></section>${state.user ? `<div class="actions"><button id="report">举报该教师</button>${state.user.role === "student" ? '<button id="review">提交 / 修改评价</button>' : ""}</div>` : ""}`;
  const data = await api("/api/reviews?teacher_id=" + t.user_id);
  root.querySelector("#reviews").innerHTML =
    `<h2>公开评价</h2>${data.reviews.length ? data.reviews.map((r) => `<article class="paper"><div class="card-top"><strong>${e(r.username)} · ${r.rating} / 5</strong><small class="muted">${date(r.created_at)}</small></div><p class="break">${e(r.comment)}</p></article>`).join("") : empty("暂无公开评价")}`;
  bindChat(root);
  root
    .querySelector("#report")
    ?.addEventListener("click", () =>
      go("feedback", { target_type: "teacher", target_id: t.user_id }),
    );
  root.querySelector("#review")?.addEventListener("click", () => {
    const d = modal(
      '<h2>评价教师</h2><p class="muted">双方在正式会话中都发过消息，且教师已认证后可评价。审核通过后公开。</p><form><label>评分<select name="rating"><option value="5">5 · 很满意</option><option value="4">4 · 满意</option><option value="3">3 · 一般</option><option value="2">2 · 不满意</option><option value="1">1 · 很不满意</option></select></label><label>评价<textarea name="comment" required maxlength="2000"></textarea></label><p class="form-error"></p><button type="submit" class="primary">提交审核</button></form>',
    );
    bindForm(d.querySelector("form"), async (b) => {
      await api("/api/reviews", {
        method: "POST",
        body: { ...b, rating: Number(b.rating), teacher_user_id: t.user_id },
      });
      d.close();
      toast("评价已提交，等待审核");
    });
  });
}
async function demands(root, params, mine = false) {
  root.innerHTML = header(
    mine ? "我的需求" : "需求广场",
    mine ? "明确自己的目标，让老师更了解你" : "发现学生的学习目标",
    mine ? '<button class="primary" id="new-demand">发布需求 +</button>' : "",
  );
  if (!mine) await filters(root, params, "demands");
  const data = await api(
    (mine ? "/api/demands/mine" : "/api/demands") +
      "?" +
      new URLSearchParams({ ...params, page: params.index || 1 }),
  );
  root.insertAdjacentHTML(
    "beforeend",
    data.demands.length
      ? `<div class="grid">${data.demands.map((d) => `<article class="card"><div class="card-top"><h2>${label([...SUBJECTS, ...PROJECTS], d.subject)} · ${label(STUDENT_GRADES, d.grade)}</h2><span class="tag">${d.status === "open" ? "寻找老师" : "已关闭"}</span></div><p class="muted">${e(d.username)} · ${date(d.created_at)}</p><p>${label(METHODS, d.teaching_method)} · ${label(PROVINCES, d.province)} ${e(d.address_area)}</p><p><strong>¥${d.budget_min}–${d.budget_max} / 小时</strong></p><p class="small">期望时间：${d.expected_time.length ? timeText(d.expected_time) : "双方商议"}</p><p class="break">${e(d.additional_info || "暂无补充说明")}</p><div class="tags">${d.preferred_tags.map((x) => `<span class="tag">${label(TAGS, x)}</span>`).join("")}</div><div class="actions">${mine ? `<button data-edit="${d.id}">编辑</button><button data-status="${d.id}" data-value="${d.status === "open" ? "close" : "open"}">${d.status === "open" ? "关闭" : "重新打开"}</button><button class="danger" data-delete="${d.id}">删除</button>` : state.user?.role === "teacher" ? `<button class="primary" data-chat="${d.user_id}" data-demand="${d.id}">联系学生</button><button data-report="${d.user_id}">举报</button>` : ""}</div></article>`).join("")}</div>`
      : empty(mine ? "还没有发布需求" : "暂无公开需求"),
  );
  root
    .querySelector("#new-demand")
    ?.addEventListener("click", () => demandForm({}));
  root
    .querySelectorAll("[data-edit]")
    .forEach(
      (b) =>
        (b.onclick = () =>
          demandForm(
            data.demands.find((d) => d.id === Number(b.dataset.edit)),
          )),
    );
  root.querySelectorAll("[data-status]").forEach(
    (b) =>
      (b.onclick = async () => {
        await api(`/api/demands/${b.dataset.status}/${b.dataset.value}`, {
          method: "POST",
          body: {},
        });
        go("mine");
      }),
  );
  root.querySelectorAll("[data-delete]").forEach(
    (b) =>
      (b.onclick = () =>
        confirmAction("删除这条需求？", async () => {
          await api("/api/demands/" + b.dataset.delete, { method: "DELETE" });
          go("mine");
        })),
  );
  root.querySelectorAll("[data-report]").forEach(
    (b) =>
      (b.onclick = () =>
        go("feedback", {
          target_type: "student",
          target_id: b.dataset.report,
        })),
  );
  bindChat(root);
  pagination(root, data.total, data.page, params);
}
function demandForm(d) {
  const dialog = modal(
    `<h2>${d.id ? "编辑" : "发布"}需求</h2><form><div class="form-grid">${select("subject", "单科目需求", [...SUBJECTS, ...PROJECTS], d.subject)}${select("grade", "学生年级", STUDENT_GRADES, d.grade)}${select("teaching_method", "授课方式", METHODS, d.teaching_method || "online")}${field("current_score", "目前成绩 / 等第", d.current_score)}${areaFields(d.province, d.address_area)}${field("budget_min", "预算最低（元 / 小时）", d.budget_min || 0, "number")}${field("budget_max", "预算最高（元 / 小时）", d.budget_max || 0, "number")}${timeEditor(d.expected_time)}${select(
      "preferred_gender",
      "教师性别偏好",
      GENDERS.filter((x) => x[0] !== "undeclared"),
      d.preferred_gender,
      "不限",
    )}${checks("preferred_tags", "性格偏好", TAGS, d.preferred_tags)}<label class="full">补充说明<textarea name="additional_info" maxlength="5000">${e(d.additional_info)}</textarea></label></div><p class="form-error"></p><button type="submit" class="primary">保存需求</button></form>`,
  );
  bindForm(dialog.querySelector("form"), async (b, form) => {
    b.address_area = b.address;
    delete b.address;
    b.preferred_tags = new FormData(form).getAll("preferred_tags");
    b.expected_time = readTimes(b);
    b.budget_min = Number(b.budget_min);
    b.budget_max = Number(b.budget_max);
    await api(d.id ? "/api/demands/" + d.id : "/api/demands", {
      method: d.id ? "PUT" : "POST",
      body: b,
    });
    dialog.close();
    go("mine");
    toast("需求已保存");
  });
}
async function ownProfile(root) {
  const { profile: p } = await api("/api/teacher/profile");
  const data = p || {
    subjects: [],
    gaokao_scores: [],
    personality_tags: [],
    nonacademic_projects: [],
    nonacademic_prices: [],
  };
  const v = await api("/api/teacher/verify-status");
  root.innerHTML =
    header("教师档案", "公开资料帮助学生认识你的教学能力") +
    `<section class="paper"><form id="profile-form"><div class="form-grid">
      ${field("teacher_name", "公开教师称呼", data.teacher_name)}
      ${field("school", "学校", data.school)}
      ${select("grade", "教师阶段", TEACHER_GRADES, data.grade)}
      ${select("gender", "性别", GENDERS, data.gender || "undeclared")}
      ${areaFields(data.province, data.address)}
      ${select("teaching_method", "授课方式", METHODS, data.teaching_method || "both")}
      ${field("price_min", "报价最低（元 / 小时）", data.price_min || 0, "number")}
      ${field("price_max", "报价最高（元 / 小时）", data.price_max || 0, "number")}
      ${checks(
        "subjects",
        "可教科目",
        SUBJECTS,
        data.subjects.map((x) => x.subject),
      )}
      ${checks("nonacademic_projects", "非学科项目", PROJECTS, data.nonacademic_projects)}
      ${projectEditor(data.nonacademic_prices)}
      ${checks("personality_tags", "教学风格", TAGS, data.personality_tags)}
      ${timeEditor(data.time_slots)}
      ${field("graduation_year", "毕业年份", data.graduation_year, "number")}
      ${field("experience_years", "教学经验（年）", data.experience_years, "number")}
      <label class="full">自我介绍<textarea name="intro" maxlength="5000">${e(data.intro)}</textarea></label>
      <label class="full">教学理念<textarea name="philosophy" maxlength="5000">${e(data.philosophy)}</textarea></label>
      ${scoreEditor(data)}
      <div class="full divider"></div><p class="full muted small">以下信息只用于本人管理和身份核验，不在广场公开。</p>
      ${field("real_name", "真实姓名", data.real_name)}${field("wechat", "微信", data.wechat)}${field("email", "联系邮箱", data.email)}
    </div><p class="form-error"></p><button class="primary" type="submit">保存档案</button></form></section>
    <section class="paper"><h2>身份核验</h2><p class="muted">${v.verification ? { pending: "等待人工审核", approved: "核验已通过", rejected: "核验未通过" }[v.verification.status] : "尚未提交认证材料"}${v.reason ? " · " + e(v.reason) : ""}</p>
      <div class="tabs"><button data-verify="chsi">学信网在线验证码</button><button data-verify="admission">录取通知书</button></div>
      <form id="verify-form"><label>学信网在线验证码<input name="verify_code" required></label><p class="small muted">管理员在学信网官方核验页人工核验。</p><p class="form-error"></p><button type="submit" class="primary">提交核验</button></form>
    </section>`;
  bindForm(root.querySelector("#profile-form"), async (b, form) => {
    const fd = new FormData(form);
    for (const k of ["subjects", "nonacademic_projects", "personality_tags"])
      b[k] = fd.getAll(k);
    b.gaokao_scores = SUBJECTS.filter(
      ([id]) => b["score_" + id] !== "" || b["grade_" + id] !== "",
    ).map(([id]) => ({
      ...(data.gaokao_scores.find((x) => x.subject === id) || {}),
      subject: id,
      score: b["score_" + id] === "" ? null : Number(b["score_" + id]),
      full: Number(b["full_" + id]),
      grade: b["grade_" + id],
    }));
    b.subjects = b.subjects.map((id) => ({
      ...data.subjects.find((x) => x.subject === id),
      subject: id,
      score: null,
      ...b.gaokao_scores.find((x) => x.subject === id),
    }));
    for (const [id] of SUBJECTS) {
      delete b["score_" + id];
      delete b["full_" + id];
      delete b["grade_" + id];
    }
    b.time_slots = readTimes(b);
    b.nonacademic_prices = b.nonacademic_projects
      .filter(
        (id) => b["project_min_" + id] !== "" || b["project_max_" + id] !== "",
      )
      .map((id) => {
        if (b["project_min_" + id] === "" || b["project_max_" + id] === "")
          throw new Error("请完整填写项目报价区间");
        return {
          project: id,
          price_min: Number(b["project_min_" + id]),
          price_max: Number(b["project_max_" + id]),
        };
      });
    for (const [id] of PROJECTS) {
      delete b["project_min_" + id];
      delete b["project_max_" + id];
    }
    b.price_min = Number(b.price_min);
    b.price_max = Number(b.price_max);
    b.graduation_year = b.graduation_year ? Number(b.graduation_year) : null;
    b.experience_years = b.experience_years ? Number(b.experience_years) : null;
    await api("/api/teacher/profile", { method: "POST", body: b });
    toast("教师档案已保存");
  });
  let type = "chsi";
  root.querySelectorAll("[data-verify]").forEach(
    (button) =>
      (button.onclick = () => {
        type = button.dataset.verify;
        root.querySelector("#verify-form").innerHTML =
          type === "chsi"
            ? '<label>学信网在线验证码<input name="verify_code" required></label><p class="form-error"></p><button type="submit" class="primary">提交核验</button>'
            : '<label>录取通知书图片（700 KB 以内）<input name="image" type="file" accept="image/*" required></label><p class="form-error"></p><button type="submit" class="primary">提交核验</button>';
      }),
  );
  bindForm(root.querySelector("#verify-form"), async (b, form) => {
    if (type === "admission") {
      const file = form.querySelector("[name=image]").files[0];
      b = { admission_image: await readFile(file) };
    }
    await api("/api/teacher/verify-" + type, { method: "POST", body: b });
    toast("已提交核验");
    go("profile");
  });
}
export function readFile(file, max = 700000) {
  if (file.size > max)
    throw new Error(`文件需要小于 ${Math.round(max / 1000)} KB`);
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(reader.result);
    reader.onerror = () => reject(new Error("文件读取失败"));
    reader.readAsDataURL(file);
  });
}
export async function render(root, params) {
  if (params.page === "teachers") return teachers(root, params);
  if (params.page === "teacher") return teacher(root, params);
  if (params.page === "profile") return ownProfile(root);
  return demands(root, params, params.page === "mine");
}

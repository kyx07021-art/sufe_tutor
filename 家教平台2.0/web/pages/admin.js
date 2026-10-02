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
import { options } from "./market.js";
import { SUBJECTS, PROJECTS, STUDENT_GRADES, label } from "../../src/shared.js";

const tabs = [
  ["dashboard", "概览"],
  ["users", "用户"],
  ["demands", "需求"],
  ["conversations", "会话"],
  ["messages", "消息"],
  ["posts", "资料"],
  ["verifications", "教师核验"],
  ["reviews", "评价审核"],
  ["complaints", "投诉"],
  ["feedbacks", "反馈"],
  ["invites", "邀请码"],
  ["broadcast", "系统通知"],
];
const button = (action, id, text) =>
  `<button data-action="${action}" data-id="${id}">${text}</button>`;
async function perform(type, id, action, refresh) {
  const titles = {
    approve: "通过审核",
    reject: "拒绝审核",
    resolve: "标记已处理",
    delete: "删除内容",
    close: "关闭",
    ban: "封禁账户",
    unban: "恢复账户",
  };
  const d = modal(
    `<h2>${titles[action]}</h2><form><label>处理说明<textarea name="reason" ${action === "reject" ? "required" : ""} maxlength="2000"></textarea></label><p class="form-error"></p><button class="primary" type="submit">确认操作</button></form>`,
  );
  bindForm(d.querySelector("form"), async (body) => {
    await api(`/api/admin/content/${type}/${id}/action`, {
      method: "POST",
      body: { ...body, action },
    });
    d.close();
    toast("已处理");
    refresh();
  });
}
function paginate(root, total, page, params) {
  if (total <= 50) return;
  const n = Math.ceil(total / 50);
  root.insertAdjacentHTML(
    "beforeend",
    `<div class="pagination"><button id="prev" ${page <= 1 ? "disabled" : ""}>上一页</button><span>${page} / ${n}</span><button id="next" ${page >= n ? "disabled" : ""}>下一页</button></div>`,
  );
  root.querySelector("#prev").onclick = () =>
    go("admin", { ...params, index: page - 1 });
  root.querySelector("#next").onclick = () =>
    go("admin", { ...params, index: page + 1 });
}
function summary(type, r) {
  if (type === "demands")
    return `${label([...SUBJECTS, ...PROJECTS], r.subject)} · ${label(STUDENT_GRADES, r.grade)}\n¥${r.budget_min}–${r.budget_max}\n${r.additional_info}`;
  if (type === "posts") return r.title + "\n" + r.body_md;
  if (type === "messages")
    return r.kind === "text" ? r.body : r.kind + " · " + r.name;
  if (type === "reviews")
    return `教师 #${r.teacher_user_id} · ${r.rating}/5\n${r.comment}`;
  if (type === "complaints")
    return `${r.target_type} #${r.target_id}\n${r.reason}\n${r.detail}`;
  if (type === "feedbacks")
    return `${r.title}\n${r.content}\n${r.contact || ""}`;
  return `学生 #${r.student_user_id} · 教师 #${r.teacher_user_id}\n${r.temp_status ? "临时" : "正式"}会话`;
}
async function users(root, params) {
  const page = Number(params.index || 1);
  root.insertAdjacentHTML(
    "beforeend",
    `<form id="search" class="input-row"><input name="q" aria-label="用户名搜索" placeholder="搜索昵称" value="${e(params.q)}"><select name="role" aria-label="用户角色">${options(
      [
        ["student", "学生"],
        ["teacher", "教师"],
        ["admin", "管理员"],
      ],
      params.role,
      "所有角色",
    )}</select><button type="submit">搜索</button></form><br>`,
  );
  root.querySelector("#search").onsubmit = (event) => {
    event.preventDefault();
    go("admin", {
      tab: "users",
      ...Object.fromEntries(new FormData(event.target)),
    });
  };
  const data = await api(
    "/api/admin/users?" + new URLSearchParams({ ...params, page }),
  );
  root.insertAdjacentHTML(
    "beforeend",
    `<section class="paper table-wrap"><table class="table"><thead><tr><th>ID</th><th>昵称</th><th>角色</th><th>状态</th><th>创建时间</th><th>操作</th></tr></thead><tbody>${data.users.map((u) => `<tr><td>${u.id}</td><td>${e(u.username)}</td><td>${{ student: "学生", teacher: "教师", admin: "管理员" }[u.role]}</td><td>${u.deactivated ? "已注销" : u.banned ? "已封禁" : "正常"}</td><td>${date(u.created_at)}</td><td>${u.role !== "admin" && !u.deactivated ? button(u.banned ? "unban" : "ban", u.id, u.banned ? "恢复" : "封禁") : ""}</td></tr>`).join("")}</tbody></table></section>`,
  );
  root
    .querySelectorAll("[data-action]")
    .forEach(
      (b) =>
        (b.onclick = () =>
          perform("users", b.dataset.id, b.dataset.action, () =>
            go("admin", params),
          )),
    );
  paginate(root, data.total, page, params);
}
async function content(root, params) {
  const type = params.tab,
    page = Number(params.index || 1);
  if (
    ["reviews", "complaints", "feedbacks", "demands", "conversations"].includes(
      type,
    )
  )
    root.insertAdjacentHTML(
      "beforeend",
      `<div class="tabs"><a class="button" href="#admin?tab=${type}">全部</a><a class="button" href="#admin?tab=${type}&status=${type === "reviews" ? "pending" : type === "conversations" ? "active" : "open"}">未处理 / 进行中</a></div>`,
    );
  const data = await api(
    "/api/admin/content?" +
      new URLSearchParams({
        type,
        page,
        ...(params.status ? { status: params.status } : {}),
      }),
  );
  const rows = data.items.map((r) => {
    let actions = "";
    if (type === "reviews")
      actions +=
        button("approve", r.id, "通过") + button("reject", r.id, "拒绝");
    if (["complaints", "feedbacks"].includes(type) && r.status !== "resolved")
      actions += button("resolve", r.id, "已处理");
    if (
      ["demands", "conversations"].includes(type) &&
      ["open", "active"].includes(r.status)
    )
      actions += button("close", r.id, "关闭");
    if (type !== "conversations") actions += button("delete", r.id, "删除");
    const attachment =
      type === "messages" && r.kind !== "text"
        ? `<button data-attachment="${r.id}">查看附件</button>`
        : type === "complaints" && r.attachments.length
          ? `<button data-complaint="${r.id}">证据附件</button>`
          : "";
    return `<tr><td>#${r.id}<br>${e(r.username || "匿名")}</td><td class="long break">${e(summary(type, r).slice(0, 2400))}${attachment}</td><td>${e(r.status)}<br>${date(r.created_at)}</td><td><div class="actions">${actions}</div></td></tr>`;
  });
  root.insertAdjacentHTML(
    "beforeend",
    rows.length
      ? `<section class="paper table-wrap"><table class="table"><thead><tr><th>ID / 用户</th><th>内容</th><th>状态 / 时间</th><th>操作</th></tr></thead><tbody>${rows.join("")}</tbody></table></section>`
      : empty("暂无记录"),
  );
  root
    .querySelectorAll("[data-action]")
    .forEach(
      (b) =>
        (b.onclick = () =>
          perform(type, b.dataset.id, b.dataset.action, () =>
            go("admin", params),
          )),
    );
  root.querySelectorAll("[data-attachment]").forEach(
    (b) =>
      (b.onclick = async () => {
        const file = await api(
          "/api/messages/" + b.dataset.attachment + "/attachment",
        );
        modal(
          `<h2>${e(file.name)}</h2>${file.kind === "image" ? `<img class="file-preview" src="${e(file.body)}" alt="附件">` : ""}<p><a class="button" href="${e(file.body)}" download="${e(file.name)}">下载附件</a></p>`,
        );
      }),
  );
  root.querySelectorAll("[data-complaint]").forEach(
    (b) =>
      (b.onclick = () => {
        const row = data.items.find(
          (x) => String(x.id) === b.dataset.complaint,
        );
        modal(
          "<h2>投诉证据</h2>" +
            row.attachments
              .map(
                (a) =>
                  `${a.kind === "image" ? `<img class="file-preview" src="${e(a.body || a.thumb)}" alt="证据">` : ""}<p><a class="button" href="${e(a.body || a.thumb)}" download="${e(a.name)}">${e(a.name || "附件")}</a></p>`,
              )
              .join(""),
        );
      }),
  );
  paginate(root, data.total, page, params);
}
async function verifications(root, params) {
  const data = await api(
    "/api/admin/verifications" +
      (params.status ? "?status=" + params.status : ""),
  );
  root.insertAdjacentHTML(
    "beforeend",
    '<div class="tabs"><a class="button" href="#admin?tab=verifications&status=pending">待审核</a><a class="button" href="#admin?tab=verifications">全部</a></div>' +
      (data.verifications
        .map(
          (v) =>
            `<article class="paper"><div class="card-top"><h2>${e(v.username)} · ${e(v.real_name)}</h2><span class="tag">${e(v.status)}</span></div><p>${e(v.profile_school)} · ${v.verify_type === "chsi" ? "学信网在线验证码" : "录取通知书"}</p>${v.verify_type === "chsi" ? `<p class="break"><strong>${e(v.verify_code)}</strong> <a class="text-link" href="https://www.chsi.com.cn/xlcx/bgcx.jsp" target="_blank" rel="noopener">打开学信网核验页 ↗</a></p>` : `<img class="file-preview" src="${e(v.admission_image)}" alt="录取通知书">`}<div class="actions"><button data-verify="${v.id}">核验与处理</button></div></article>`,
        )
        .join("") || empty("暂无核验记录")),
  );
  root.querySelectorAll("[data-verify]").forEach(
    (b) =>
      (b.onclick = () => {
        const v = data.verifications.find(
          (x) => String(x.id) === b.dataset.verify,
        );
        const fields = [
          "school",
          "level",
          "major",
          "enrollment_status",
          "enroll_year",
        ]
          .map(
            (k, i) =>
              `<label>${["学校", "学历层次", "专业", "学籍状态", "入学年份"][i]}<input name="${k}" value="${e(v[k])}"></label>`,
          )
          .join("");
        const d = modal(
          `<h2>处理 ${e(v.username)} 的核验</h2><form><div class="form-grid">${fields}</div><label>处理结果<select name="action"><option value="approve">通过</option><option value="reject">拒绝 / 撤销认证</option></select></label><label>原因（拒绝时必填）<textarea name="reason"></textarea></label><p class="form-error"></p><button type="submit" class="primary">确认核验</button></form>`,
        );
        bindForm(d.querySelector("form"), async (body) => {
          await api("/api/admin/verifications/" + v.id + "/action", {
            method: "POST",
            body,
          });
          d.close();
          toast("核验已处理");
          go("admin", params);
        });
      }),
  );
}
async function invites(root, params) {
  const data = await api("/api/admin/invites");
  const rows = data.invites
    .map(
      (i) =>
        "<tr><td><strong>" +
        e(i.code) +
        "</strong></td><td>" +
        date(i.created_at) +
        "</td><td>" +
        e(i.used_name || "未使用") +
        "</td><td>" +
        (!i.used_by
          ? '<button data-delete="' + e(i.code) + '">删除</button>'
          : "") +
        "</td></tr>",
    )
    .join("");
  root.insertAdjacentHTML(
    "beforeend",
    '<div class="actions"><button class="primary" id="new-invite">生成邀请码 +</button></div><br><section class="paper table-wrap"><table class="table"><thead><tr><th>邀请码</th><th>创建时间</th><th>使用者</th><th>操作</th></tr></thead><tbody>' +
      rows +
      "</tbody></table></section>",
  );
  root.querySelector("#new-invite").onclick = async () => {
    const data = await api("/api/admin/invites", { method: "POST", body: {} });
    toast("邀请码：" + data.code);
    go("admin", params);
  };
  root.querySelectorAll("[data-delete]").forEach(
    (b) =>
      (b.onclick = () =>
        confirmAction("删除这个未使用的邀请码？", async () => {
          await api("/api/admin/invites/" + b.dataset.delete, {
            method: "DELETE",
          });
          go("admin", params);
        })),
  );
}
export async function render(root, params) {
  if (state.user?.role !== "admin") throw new Error("仅管理员可以访问");
  const tab = params.tab || "dashboard";
  params = { ...params, tab };
  root.innerHTML =
    header("管理后台", "查看平台数据，核验身份并处理用户反馈") +
    '<div class="tabs">' +
    tabs
      .map(
        ([id, text]) =>
          '<a class="button ' +
          (id === tab ? "selected" : "") +
          '" href="#admin?tab=' +
          id +
          '">' +
          text +
          "</a>",
      )
      .join("") +
    "</div>";
  if (tab === "dashboard") {
    const { counts: c } = await api("/api/admin/dashboard");
    const names = {
      users: "用户",
      teachers: "教师",
      demands: "公开需求",
      conversations: "正式会话",
      verifications: "待核验",
      reviews: "待审评价",
      complaints: "待处理投诉",
      feedbacks: "待处理反馈",
    };
    root.insertAdjacentHTML(
      "beforeend",
      '<div class="stats">' +
        Object.entries(c)
          .map(
            ([key, n]) =>
              '<article class="paper"><p class="small">' +
              names[key] +
              "</p><strong>" +
              n +
              "</strong></article>",
          )
          .join("") +
        "</div>",
    );
    return;
  }
  if (tab === "users") return users(root, params);
  if (tab === "verifications") return verifications(root, params);
  if (tab === "invites") return invites(root, params);
  if (tab === "broadcast") {
    root.insertAdjacentHTML(
      "beforeend",
      '<section class="paper"><h2>发送全站通知</h2><form><label>标题<input name="title" required maxlength="120"></label><label>通知正文<textarea name="text" required maxlength="5000"></textarea></label><p class="form-error"></p><button class="primary" type="submit">发送给全体用户</button></form></section>',
    );
    bindForm(root.querySelector("form"), async (body) => {
      await api("/api/admin/broadcast", { method: "POST", body });
      toast("系统通知已发送");
      root.querySelector("form").reset();
    });
    return;
  }
  return content(root, params);
}

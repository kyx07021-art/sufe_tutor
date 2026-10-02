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
} from "../app.js";
import { readFile, options } from "./market.js";

export const notificationText = (n) =>
  ({
    CONVERSATION_CLOSED: () => `${n.params.name}关闭了会话`,
    VERIFY_APPROVED: () =>
      `教师身份核验已通过${n.params.detail ? " · " + n.params.detail : ""}`,
    VERIFY_REJECTED: () => `教师身份核验未通过：${n.params.reason}`,
    VERIFY_REVOKED: () => `教师身份核验已撤销：${n.params.reason}`,
    FEEDBACK_RESOLVED: () =>
      `你的${n.params.title || "反馈"}已处理${n.params.reason ? "：" + n.params.reason : ""}`,
    FEEDBACK_COMPLAINT_RESOLVED: () => `你的投诉已处理`,
    CONTENT_PENALTY: () =>
      `${n.params.label || "内容"}已${n.params.action || "处理"}${n.params.reason ? "：" + n.params.reason : ""}`,
    BROADCAST: () => `${n.params.title}\n${n.params.text}`,
  })[n.type]?.() ||
  n.text ||
  "系统通知";
async function notifications(root) {
  const { notifications: list } = await api("/api/notifications");
  root.innerHTML =
    header(
      "通知信息",
      "会话、认证和反馈的最新处理进展",
      '<button id="read-all">全部已读</button>',
    ) +
    (list.length
      ? list
          .map(
            (n) =>
              `<article class="paper"><div class="card-top"><span class="tag">${n.is_read ? "已读" : "未读"}</span><small class="muted">${date(n.created_at)}</small></div><p class="break">${e(notificationText(n))}</p>${!n.is_read ? `<button data-read="${n.id}">标记已读</button>` : ""}</article>`,
          )
          .join("")
      : empty("暂无通知"));
  root.querySelector("#read-all").onclick = async () => {
    await api("/api/notifications/read-all", { method: "POST", body: {} });
    go("notifications");
  };
  root.querySelectorAll("[data-read]").forEach(
    (b) =>
      (b.onclick = async () => {
        await api("/api/notifications/" + b.dataset.read + "/read", {
          method: "POST",
          body: {},
        });
        go("notifications");
      }),
  );
}
function clientToken() {
  let token = localStorage.getItem("jingtu_feedback_token");
  if (!token) {
    token = crypto.randomUUID();
    localStorage.setItem("jingtu_feedback_token", token);
  }
  return token;
}
async function feedback(root, params) {
  const report = Boolean(params.target_type);
  root.innerHTML =
    header(
      report ? "提交投诉" : "投诉与反馈",
      report ? "请描述事实，附上必要信息" : "你的建议帮助我们改进平台",
    ) +
    `<section class="paper"><form id="feedback-form">${
      report
        ? `<p class="notice">对象：${{ teacher: "教师", student: "学生", post: "资料帖" }[params.target_type]} #${e(params.target_id)}</p><label>投诉原因<input name="reason" required maxlength="120"></label><label>详细说明<textarea name="detail" required maxlength="2000"></textarea></label><label>证据附件（最多 3 个，每个 700 KB）<input name="attachments" type="file" multiple accept="image/*,.pdf,.txt"></label>`
        : `<div class="form-grid"><label>反馈类型<select name="kind">${options(
            [
              ["suggestion", "改进建议"],
              ["bug", "问题反馈"],
              ["report", "内容举报"],
            ],
            "suggestion",
          )}</select></label><label>联系方式（选填）<input name="contact" maxlength="120"></label><label class="full">标题<input name="title" required maxlength="120"></label><label class="full">内容<textarea name="content" required maxlength="5000"></textarea></label></div>`
    }<p class="form-error"></p><button class="primary" type="submit">提交${report ? "投诉" : "反馈"}</button></form></section><section id="history"></section>`;
  bindForm(root.querySelector("#feedback-form"), async (b, form) => {
    if (report) {
      if (form.elements.attachments.files.length > 3)
        throw new Error("最多提交 3 个附件");
      b.target_type = params.target_type;
      b.target_id = Number(params.target_id);
      b.attachments = [];
      for (const file of form.elements.attachments.files)
        b.attachments.push({
          name: file.name,
          kind: file.type.startsWith("image/") ? "image" : "file",
          body: await readFile(file),
        });
      await api("/api/complaints", { method: "POST", body: b });
    } else
      await api("/api/feedbacks", {
        method: "POST",
        body: { ...b, client_token: clientToken() },
      });
    toast("已提交，我们会尽快处理");
    form.reset();
    await history();
  });
  async function history() {
    const f = (await api("/api/feedbacks/mine?client_token=" + clientToken()))
      .feedbacks;
    const c = state.user ? (await api("/api/complaints/mine")).complaints : [];
    root.querySelector("#history").innerHTML =
      "<h2>我的处理记录</h2>" +
      ([
        ...c.map((c) => ({
          title: "投诉 " + c.target_type + " #" + c.target_id,
          content: c.detail || c.reason,
          status: c.status,
          created_at: c.created_at,
        })),
        ...f,
      ]
        .map(
          (f) =>
            `<article class="paper"><div class="card-top"><h3>${e(f.title)}</h3><span class="tag">${f.status === "resolved" ? "已处理" : "待处理"}</span></div><p class="break muted">${e(f.content)}</p><small class="muted">${date(f.created_at)}</small></article>`,
        )
        .join("") || empty("暂无提交记录"));
  }
  await history();
  if (report && !state.user) {
    root.querySelector("#feedback-form").innerHTML =
      '<p>投诉需要登录。</p><a class="button primary" href="#login">前往登录</a>';
  }
}
async function settings(root) {
  const u = (await api("/api/settings")).user;
  root.innerHTML =
    header("账户设置", "管理自己的昵称、登录方式和通知偏好") +
    `<section class="paper"><h2>基本资料</h2><form id="basic"><div class="form-grid"><label>昵称<input name="username" value="${e(u.username)}" required minlength="3" maxlength="30"></label><label>头像（20 KB 以内）<input name="avatar" type="file" accept="image/*"></label></div><p class="form-error"></p><button type="submit" class="primary">保存资料</button></form></section><section class="paper"><h2>登录方式</h2><p class="muted">手机：${e(u.phone || "未绑定")}　邮箱：${e(u.email || "未绑定")}</p><div class="actions"><button data-bind="sms">绑定 / 修改手机号</button><button data-bind="email">绑定 / 修改邮箱</button></div><div class="divider"></div><form id="password"><div class="form-grid"><label>原密码<input name="current_password" type="password" required autocomplete="current-password"></label><label>新密码<input name="password" type="password" required minlength="6" autocomplete="new-password"></label></div><p class="form-error"></p><button type="submit">修改密码</button></form></section><section class="paper"><h2>通知偏好</h2><form id="preferences"><label class="check-row"><input name="blockSystemNotifications" type="checkbox" ${u.blockSystemNotifications ? "checked" : ""}>屏蔽系统内容处置提醒</label><label class="check-row"><input name="notifyBroadcastMuted" type="checkbox" ${u.notifyBroadcastMuted ? "checked" : ""}>屏蔽全站广播</label><p class="form-error"></p><button type="submit">保存偏好</button></form></section><section class="paper"><h2>注销账户</h2><p class="muted">注销会匿名化账户并清除个人业务数据。操作完成后无法恢复登录。</p><button id="deactivate" class="danger">注销我的账户</button></section>`;
  bindForm(root.querySelector("#basic"), async (b, form) => {
    const body = { username: b.username };
    if (form.elements.avatar.files[0])
      body.avatar = await readFile(form.elements.avatar.files[0], 20000);
    state.user = (await api("/api/settings", { method: "PUT", body })).user;
    toast("资料已更新");
    go("settings");
  });
  bindForm(root.querySelector("#password"), async (b) => {
    await api("/api/settings", { method: "PUT", body: b });
    toast("密码已修改，其他会话已退出");
    root.querySelector("#password").reset();
  });
  bindForm(root.querySelector("#preferences"), async (b, form) => {
    state.user = (
      await api("/api/settings", {
        method: "PUT",
        body: {
          blockSystemNotifications:
            form.elements.blockSystemNotifications.checked,
          notifyBroadcastMuted: form.elements.notifyBroadcastMuted.checked,
        },
      })
    ).user;
    toast("通知偏好已保存");
  });
  root.querySelectorAll("[data-bind]").forEach(
    (button) =>
      (button.onclick = () => {
        const channel = button.dataset.bind;
        const d = modal(
          `<h2>绑定${channel === "sms" ? "手机号" : "邮箱"}</h2><form><label>${channel === "sms" ? "中国大陆 +86 手机号" : "邮箱"}<input name="target" required></label><label>验证码<div class="input-row"><input name="code" required maxlength="6" inputmode="numeric" autocomplete="one-time-code"><button type="button" id="send">发送验证码</button></div></label><p class="form-error"></p><button type="submit" class="primary">验证并绑定</button></form>`,
        );
        d.querySelector("#send").onclick = async (event) => {
          event.target.disabled = true;
          try {
            const target = d.querySelector("[name=target]").value;
            toast(
              (
                await api("/api/auth/otp/request", {
                  method: "POST",
                  body: { channel, target, scene: "bind" },
                })
              ).message,
            );
          } catch (err) {
            d.querySelector(".form-error").textContent = err.message;
          } finally {
            event.target.disabled = false;
          }
        };
        bindForm(d.querySelector("form"), async (b) => {
          await api("/api/settings", {
            method: "PUT",
            body: { ...b, channel },
          });
          d.close();
          toast("绑定成功");
          go("settings");
        });
      }),
  );
  root.querySelector("#deactivate").onclick = () => {
    const d = modal(
      '<h2>确认注销账户</h2><p>账户匿名化并清除数据后，无法恢复登录。请输入密码确认。</p><form><label>账户密码<input name="password" type="password" required autocomplete="current-password"></label><p class="form-error"></p><button class="danger" type="submit">确认注销</button></form>',
    );
    bindForm(d.querySelector("form"), async (b) => {
      await api("/api/settings/deactivate", { method: "POST", body: b });
      d.close();
      state.user = null;
      state.token = null;
      localStorage.removeItem("jingtu_token");
      go("landing");
      toast("账户已注销");
    });
  };
}
export async function render(root, params) {
  if (params.page === "notifications") return notifications(root);
  if (params.page === "settings") return settings(root);
  return feedback(root, params);
}

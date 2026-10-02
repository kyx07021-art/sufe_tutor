import { PRODUCT } from "../src/shared.js";

export const state = {
  token: localStorage.getItem("jingtu_token"),
  user: null,
  page: "landing",
  activeConversationId: null,
  cleanup: null,
};
export const escape = (value) =>
  String(value ?? "").replace(
    /[&<>"']/g,
    (c) =>
      ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[
        c
      ],
  );
export async function api(path, { method = "GET", body } = {}) {
  const response = await fetch(path, {
    method,
    headers: {
      "Content-Type": "application/json",
      ...(state.token ? { "X-Auth-Token": state.token } : {}),
    },
    ...(body === undefined ? {} : { body: JSON.stringify(body) }),
  });
  const data = await response.json();
  if (!response.ok) throw new Error(data.error.message);
  return data;
}
export function toast(message) {
  const node = document.querySelector("#toast");
  node.textContent = message;
  node.classList.add("show");
  setTimeout(() => node.classList.remove("show"), 3500);
}
export function authenticated(result) {
  state.token = result.token;
  state.user = result.user;
  localStorage.setItem("jingtu_token", result.token);
  go(
    result.user.role === "teacher"
      ? "demands"
      : result.user.role === "admin"
        ? "admin"
        : "teachers",
  );
}
export async function signout() {
  await api("/api/auth/logout", { method: "POST", body: {} });
  state.token = null;
  state.user = null;
  localStorage.removeItem("jingtu_token");
  go("landing");
}
export const brand = () =>
  '<a class="brand" href="#landing"><span class="brand-mark" aria-hidden="true"><i></i><i></i><i></i><i></i></span><span>经途·伴学<small>信息门户</small></span></a>';
export const header = (title, desc = "", action = "") =>
  `<header class="page-header"><div><p class="eyebrow">JINGTU · BANXUE</p><h1>${title}</h1><p class="muted">${desc}</p></div><div class="actions">${action}</div></header>`;
export const empty = (text) =>
  `<div class="empty"><span>—</span><p>${escape(text)}</p></div>`;
export const date = (value) =>
  value
    ? new Date(
        value.replace(" ", "T") + (value.includes("Z") ? "" : "Z"),
      ).toLocaleString("zh-CN", {
        month: "2-digit",
        day: "2-digit",
        hour: "2-digit",
        minute: "2-digit",
      })
    : "";
export function formData(form) {
  return Object.fromEntries(new FormData(form));
}
export function bindForm(form, handler) {
  form.addEventListener("submit", async (e) => {
    e.preventDefault();
    const button = form.querySelector("[type=submit]");
    const error = form.querySelector(".form-error");
    button.disabled = true;
    error.textContent = "";
    try {
      await handler(formData(form), form);
    } catch (e) {
      error.textContent = e.message;
    } finally {
      button.disabled = false;
    }
  });
}
export function modal(content) {
  const dialog = document.querySelector("#dialog");
  dialog.innerHTML = `<button class="close" aria-label="关闭弹窗">×</button>${content}`;
  dialog.querySelector(".close").onclick = () => dialog.close();
  dialog.showModal();
  return dialog;
}
export function confirmAction(message, action) {
  const d = modal(
    `<h2>确认操作</h2><p>${escape(message)}</p><div class="actions"><button class="cancel">取消</button><button class="primary accept">确认</button></div><p class="form-error"></p>`,
  );
  d.querySelector(".cancel").onclick = () => d.close();
  d.querySelector(".accept").onclick = async (e) => {
    e.target.disabled = true;
    try {
      await action();
      d.close();
    } catch (err) {
      d.querySelector(".form-error").textContent = err.message;
      e.target.disabled = false;
    }
  };
}
export async function go(page, params = {}) {
  const hash =
    page +
    (Object.keys(params).length ? "?" + new URLSearchParams(params) : "");
  if (location.hash.slice(1) === hash) return render();
  location.hash = hash;
}
function navItems() {
  if (!state.user)
    return [
      ["teachers", "教师广场"],
      ["community", "资料广场"],
      ["feedback", "反馈建议"],
      ["about", "关于平台"],
    ];
  const common = [
    ["chat", "我的会话"],
    ["community", "资料广场"],
    ["notifications", "通知信息"],
    ["feedback", "投诉与反馈"],
    ["settings", "账户设置"],
    ["about", "关于平台"],
  ];
  return state.user.role === "admin"
    ? [["admin", "管理后台"], ...common]
    : state.user.role === "teacher"
      ? [["demands", "需求广场"], ["profile", "教师档案"], ...common]
      : [["teachers", "教师广场"], ["mine", "我的需求"], ...common];
}
async function landing(root) {
  root.innerHTML = `<div class="landing"><header>${brand()}<div class="actions"><a class="button" href="#login">登录</a><a class="button" href="#register">注册</a></div></header><img class="hand hand-left" src="/hand-mask.png" alt=""><img class="hand hand-right" src="/hand-mask-rot.png" alt=""><section class="landing-copy"><p class="eyebrow">— 上海财经大学学生创立 · 运营至今</p><h1>找家教<br>零佣金<br><span>更高效</span></h1></section><section class="landing-entry"><p>不抽佣 · 师生直接对接 · 信息透明</p><a class="role-card" href="#teachers"><span class="number">01</span><div><h2>我是学生 / 家长</h2><p>发布需求，寻找合适的老师</p></div><span>↗</span></a><a class="role-card" href="#demands"><span class="number">02</span><div><h2>我是教师</h2><p>发现需求，分享自己的经验</p></div><span>↗</span></a><a class="text-link" href="#community">先逛逛学习资料广场 →</a></section><footer>经途·伴学信息门户 · 零佣金 · <a href="#about">关于平台</a> · <a href="#feedback">反馈建议</a></footer></div>`;
}
async function render() {
  state.cleanup?.();
  state.cleanup = null;
  const [page = "landing", query = ""] = (
    location.hash.slice(1) || "landing"
  ).split("?");
  state.page = page;
  const params = Object.fromEntries(new URLSearchParams(query));
  const root = document.querySelector("#app");
  document.title = PRODUCT.title;
  if (page === "landing") return landing(root);
  if (page === "login" || page === "register")
    return (await import("./pages/auth.js")).render(root, { ...params, page });
  root.innerHTML = `<div class="shell"><aside class="sidebar">${brand()}<button class="nav-toggle" aria-label="展开导航">☰</button><nav>${navItems()
    .map(
      ([id, text], i) =>
        `<a href="#${id}" class="${page === id ? "active" : ""}"><span class="number">${String(i + 1).padStart(2, "0")}</span><span class="nav-text">${text}</span>${["chat", "notifications"].includes(id) ? `<i id="dot-${id}" class="nav-dot" hidden></i>` : ""}</a>`,
    )
    .join(
      "",
    )}</nav><div class="user-card"><span class="avatar">${state.user?.avatar ? `<img src="${escape(state.user.avatar)}" alt="头像">` : "?"}</span><div class="user-copy"><strong>${escape(state.user?.username || "访客")}</strong><small>${{ student: "学生 / 家长", teacher: "教师", admin: "管理员" }[state.user?.role] || '<a href="#login">登录 / 注册</a>'}</small></div>${state.user ? '<button id="logout" title="退出登录" aria-label="退出登录">↗</button>' : ""}</div></aside><main id="page">${empty("正在加载")}</main></div>`;
  root.querySelector(".nav-toggle").onclick = () =>
    root.querySelector(".sidebar").classList.toggle("expanded");
  root
    .querySelector("#logout")
    ?.addEventListener("click", () => signout().catch((e) => toast(e.message)));
  const content = root.querySelector("#page");
  try {
    if (page === "about") {
      content.innerHTML =
        header("关于经途·伴学", "让每一次学习相遇更直接") +
        '<article class="paper prose"><h2>学生团队运营 · 零佣金信息门户</h2><p>经途·伴学由上海财经大学学生创立。学生、家长发布需求，教师维护档案，双方在平台直接沟通。我们不向师生抽取佣金。</p><h3>平台提供</h3><p>家教信息展示、教师身份人工核验、需求匹配、站内沟通、学习资料分享、评价与反馈渠道。</p><h3>平台边界</h3><p>教学时间、报酬和线下安排由双方自行沟通。平台不提供支付、资金托管、履约担保或纠纷裁决。认证标识仅表示已核验身份资料。</p><a class="button" href="#feedback">联系与反馈</a></article>';
    } else {
      const moduleName = [
        "teachers",
        "teacher",
        "demands",
        "mine",
        "profile",
      ].includes(page)
        ? "market"
        : page === "chat"
          ? "chat"
          : ["community", "post"].includes(page)
            ? "community"
            : ["feedback", "notifications", "settings"].includes(page)
              ? "settings"
              : page === "admin"
                ? "admin"
                : null;
      if (!moduleName) {
        content.innerHTML = empty("页面不存在");
        return;
      }
      const modules = {
        market: () => import("./pages/market.js"),
        chat: () => import("./pages/chat.js"),
        community: () => import("./pages/community.js"),
        settings: () => import("./pages/settings.js"),
        admin: () => import("./pages/admin.js"),
      };
      await (await modules[moduleName]()).render(content, { ...params, page });
    }
    if (state.user) refreshDots();
  } catch (e) {
    content.innerHTML =
      empty(e.message) +
      (!state.user
        ? '<div class="center"><a class="button primary" href="#login">前往登录</a></div>'
        : "");
  }
}
async function refreshDots() {
  const [c, n] = await Promise.all([
    api("/api/conversations"),
    api("/api/notifications"),
  ]);
  const chat = document.querySelector("#dot-chat");
  const notify = document.querySelector("#dot-notifications");
  if (chat) chat.hidden = !c.conversations.some((x) => x.unread);
  if (notify) notify.hidden = !n.notifications.some((x) => !x.is_read);
}
window.addEventListener("hashchange", render);
window.addEventListener("unhandledrejection", (e) => {
  toast(e.reason.message);
  e.preventDefault();
});
async function start() {
  if (state.token) {
    try {
      state.user = (await api("/api/auth/me")).user;
    } catch {
      state.token = null;
      localStorage.removeItem("jingtu_token");
    }
  }
  await render();
}
start();

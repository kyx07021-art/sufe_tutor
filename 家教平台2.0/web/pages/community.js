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

// 原生 HTML 不参与资料渲染；Markdown 内容先作为文本，再生成有限的排版元素。
export function markdown(source) {
  let code = false;
  return e(source)
    .split("\n")
    .map((line) => {
      if (line.startsWith("```")) {
        code = !code;
        return code ? "<pre><code>" : "</code></pre>";
      }
      if (code) return line + "\n";
      line = line
        .replace(/\*\*(.+?)\*\*/g, "<strong>$1</strong>")
        .replace(/`([^`]+)`/g, "<code>$1</code>")
        .replace(
          /\[([^\]]+)\]\((https?:\/\/[^\s)]+)\)/g,
          '<a href="$2" target="_blank" rel="noopener">$1</a>',
        );
      const heading = line.match(/^(#{1,3}) (.*)/);
      if (heading)
        return `<h${heading[1].length + 1}>${heading[2]}</h${heading[1].length + 1}>`;
      if (line.startsWith("&gt; "))
        return "<blockquote>" + line.slice(5) + "</blockquote>";
      if (line.startsWith("- ")) return "<p>• " + line.slice(2) + "</p>";
      return line ? "<p>" + line + "</p>" : "<br>";
    })
    .join("");
}
function editor(p = {}) {
  const d = modal(
    `<h2>${p.id ? "编辑" : "发布"}学习资料</h2><form><label>标题<input name="title" required maxlength="60" value="${e(p.title)}"></label><label>正文（支持 Markdown）<textarea name="body_md" required maxlength="20000" rows="12" placeholder="分享方法、笔记或资料链接">${e(p.body_md)}</textarea></label><p class="small muted">支持标题、加粗、引用、代码和 http/https 链接。</p><p class="form-error"></p><button class="primary" type="submit">发布资料</button></form>`,
  );
  bindForm(d.querySelector("form"), async (data) => {
    const result = await api(p.id ? "/api/posts/" + p.id : "/api/posts", {
      method: p.id ? "PUT" : "POST",
      body: data,
    });
    d.close();
    go("post", { id: result.id });
    toast("资料已发布");
  });
}
async function list(root, params) {
  const favorites = params.favorites === "1";
  root.innerHTML =
    header(
      "资料广场",
      "把有用的学习方法分享给更多人",
      state.user?.role === "teacher"
        ? '<button id="new-post" class="primary">发布资料 +</button>'
        : "",
    ) +
    `<div class="tabs"><a class="button ${!favorites ? "selected" : ""}" href="#community">全部资料</a>${state.user ? `<a class="button ${favorites ? "selected" : ""}" href="#community?favorites=1">我的收藏</a>` : ""}</div><form class="input-row" id="search"><input aria-label="搜索资料" name="q" placeholder="搜索标题与内容" value="${e(params.q || "")}"><button type="submit">搜索</button></form><br>`;
  root.querySelector("#new-post")?.addEventListener("click", () => editor());
  root.querySelector("#search").onsubmit = (event) => {
    event.preventDefault();
    go("community", {
      q: event.target.q.value,
      ...(favorites ? { favorites: "1" } : {}),
    });
  };
  const result = await api(
    (favorites ? "/api/posts/favorites/mine" : "/api/posts") +
      "?" +
      new URLSearchParams({ ...params, page: params.index || 1 }),
  );
  root.insertAdjacentHTML(
    "beforeend",
    result.posts.length
      ? `<div class="grid">${result.posts.map((p) => `<article class="card"><h2><a href="#post?id=${p.id}">${e(p.title)}</a></h2><p class="small muted">${e(p.username)} · ${date(p.created_at)}</p><p class="muted break">${e(p.excerpt)}</p><div class="actions"><a class="button" href="#post?id=${p.id}">阅读 →</a><span class="small">${p.like_count} 人点赞${p.favorited ? " · 已收藏" : ""}</span></div></article>`).join("")}</div>`
      : empty(favorites ? "尚未收藏资料" : "还没有资料，欢迎分享"),
  );
  if (result.total > 24) {
    const pages = Math.ceil(result.total / 24);
    root.insertAdjacentHTML(
      "beforeend",
      `<div class="pagination"><button id="prev" ${result.page <= 1 ? "disabled" : ""}>上一页</button><span>${result.page} / ${pages}</span><button id="next" ${result.page >= pages ? "disabled" : ""}>下一页</button></div>`,
    );
    root.querySelector("#prev").onclick = () =>
      go("community", { ...params, index: result.page - 1 });
    root.querySelector("#next").onclick = () =>
      go("community", { ...params, index: result.page + 1 });
  }
}
async function detail(root, params) {
  const p = (await api("/api/posts/" + params.id)).post;
  const own = state.user?.id === p.user_id;
  root.innerHTML =
    header(
      e(p.title),
      e(p.username) + " · " + date(p.created_at),
      '<a class="button" href="#community">返回广场</a>',
    ) +
    `<article class="paper prose">${markdown(p.body_md)}</article><div class="actions"><button id="like">${p.liked ? "取消点赞" : "点赞"} · ${p.like_count}</button><button id="favorite">${p.favorited ? "取消收藏" : "收藏"}</button>${own ? '<button id="edit">编辑</button>' : ""}${own || state.user?.role === "admin" ? '<button id="delete" class="danger">删除</button>' : ""}${state.user ? '<button id="report">举报</button>' : ""}</div>`;
  for (const action of ["like", "favorite"])
    root.querySelector("#" + action).onclick = async () => {
      if (!state.user) {
        go("login");
        return;
      }
      await api(`/api/posts/${p.id}/${action}`, { method: "POST", body: {} });
      go("post", { id: p.id });
    };
  root.querySelector("#edit")?.addEventListener("click", () => editor(p));
  root.querySelector("#delete")?.addEventListener("click", () =>
    confirmAction("删除这篇资料？", async () => {
      await api("/api/posts/" + p.id, { method: "DELETE" });
      go("community");
    }),
  );
  root
    .querySelector("#report")
    ?.addEventListener("click", () =>
      go("feedback", { target_type: "post", target_id: p.id }),
    );
}
export async function render(root, params) {
  return params.page === "post" ? detail(root, params) : list(root, params);
}

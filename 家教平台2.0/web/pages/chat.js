import {
  state,
  api,
  escape as e,
  header,
  empty,
  date,
  toast,
  go,
  confirmAction,
  modal,
} from "../app.js";
import { readFile } from "./market.js";

export async function render(root, params) {
  if (!state.user) {
    root.innerHTML =
      header("我的会话") +
      empty("登录后可查看会话") +
      '<a class="button primary" href="#login">前往登录</a>';
    return;
  }
  const data = await api("/api/conversations");
  root.innerHTML =
    header("我的会话", "先发送一句问候，对方回复后建立正式会话") +
    `<div class="chat-layout"><div class="conversation-list">${data.conversations.length ? data.conversations.map((c) => `<button class="conversation ${String(c.id) === params.id ? "selected" : ""}" data-id="${c.id}"><span class="avatar">${c.other_avatar ? `<img src="${e(c.other_avatar)}" alt="">` : "?"}</span><span><strong>${e(c.other_name)}</strong><small>${c.status === "closed" ? "已关闭" : c.temp_status ? "临时会话" : "正式会话"}</small></span>${c.unread ? `<span class="unread">${c.unread}</span>` : ""}</button>`).join("") : empty("暂无会话")}</div><section class="chat-panel" id="chat-panel">${empty("选择一个会话")}</section></div>`;
  root
    .querySelectorAll("[data-id]")
    .forEach((b) => (b.onclick = () => go("chat", { id: b.dataset.id })));
  if (!params.id) return;
  const c = data.conversations.find((c) => String(c.id) === params.id);
  if (!c) {
    root.querySelector("#chat-panel").innerHTML = empty("会话不存在");
    return;
  }
  state.activeConversationId = c.id;
  const panel = root.querySelector("#chat-panel");
  panel.innerHTML = `<header class="chat-head"><h2>${e(c.other_name)}</h2><div class="actions"><button id="report">举报</button><button id="close-chat">关闭会话</button></div></header><div class="chat-note" id="chat-note"></div><div class="messages"><div class="center"><button id="older">加载更早消息</button></div><div id="message-list"></div></div><form class="composer"><label><span class="small">消息内容</span><textarea name="body" required maxlength="2000" placeholder="输入消息；Enter 发送，Shift + Enter 换行"></textarea></label><progress class="upload-progress" hidden max="100" value="0"></progress><p class="form-error"></p><div class="actions"><input id="attachment" type="file" hidden><button type="button" id="choose-file">图片 / 文件</button><button class="primary" type="submit">发送</button></div></form>`;
  let lastId = 0,
    firstId = 0,
    row = c;
  const list = panel.querySelector("#message-list"),
    scroll = panel.querySelector(".messages"),
    form = panel.querySelector("form"),
    note = panel.querySelector("#chat-note");
  const bubble = (m) =>
    `<article class="message ${m.sender_user_id === state.user.id ? "own" : ""}" data-message="${m.id}"><small>${e(m.username)} · ${date(m.created_at)}</small><div class="bubble">${m.kind === "text" ? e(m.body) : m.kind === "image" ? `<button type="button" class="attachment" data-file="${m.id}">${m.thumb ? `<img src="${e(m.thumb)}" alt="${e(m.name || "图片")}">` : e(m.name || "查看图片")}</button>` : `<button type="button" class="attachment" data-file="${m.id}">↓ ${e(m.name || "附件")}</button>`}</div></article>`;
  const bindAttachments = () =>
    list.querySelectorAll("[data-file]").forEach(
      (b) =>
        (b.onclick = async () => {
          const file = await api(`/api/messages/${b.dataset.file}/attachment`);
          if (file.kind === "image") {
            const d = modal(
              `<h2>${e(file.name || "图片")}</h2><img class="file-preview" src="${e(file.body)}" alt="聊天图片"><p><a class="button" href="${e(file.body)}" download="${e(file.name || "image")}">下载图片</a></p>`,
            );
            d.querySelector("img").focus();
          } else {
            const a = document.createElement("a");
            a.href = file.body;
            a.download = file.name;
            document.body.append(a);
            a.click();
            a.remove();
          }
        }),
    );
  function updateState() {
    const waiting =
      row.temp_status === "sent" &&
      row.temp_initiator_user_id === state.user.id;
    const disabled =
      row.status === "closed" || waiting || state.user.role === "admin";
    note.textContent =
      row.status === "closed"
        ? "会话已关闭，历史消息仍可查看"
        : waiting
          ? "问候已发送，请等待对方回复"
          : row.temp_status
            ? "临时会话：先发一条 300 字以内的问候，对方回复后可发送附件"
            : "正式会话 · 可发送文字、图片与文件";
    form.querySelector("textarea").disabled = disabled;
    form.querySelector("textarea").maxLength = row.temp_status ? 300 : 2000;
    form.querySelector("[type=submit]").disabled = disabled;
    panel.querySelector("#choose-file").disabled =
      disabled || Boolean(row.temp_status);
  }
  async function load(after = false) {
    const result = await api(
      `/api/conversations/${c.id}/messages${after ? "?after=" + lastId : ""}`,
    );
    row = result.conversation;
    if (result.messages.length) {
      if (!firstId) firstId = result.messages[0].id;
      lastId = result.messages.at(-1).id;
      list.insertAdjacentHTML(
        "beforeend",
        result.messages.map(bubble).join(""),
      );
      bindAttachments();
      scroll.scrollTop = scroll.scrollHeight;
    }
    updateState();
    await api(`/api/conversations/${c.id}/read`, { method: "POST", body: {} });
  }
  await load();
  const timer = setInterval(
    () => load(true).catch((err) => toast(err.message)),
    5000,
  );
  state.cleanup = () => {
    clearInterval(timer);
    state.activeConversationId = null;
  };
  panel.querySelector("#older").onclick = async (event) => {
    const oldHeight = scroll.scrollHeight;
    const result = await api(
      `/api/conversations/${c.id}/messages?before=${firstId}`,
    );
    if (!result.messages.length) {
      event.target.disabled = true;
      event.target.textContent = "已到最早消息";
      return;
    }
    firstId = result.messages[0].id;
    list.insertAdjacentHTML("afterbegin", result.messages.map(bubble).join(""));
    scroll.scrollTop = scroll.scrollHeight - oldHeight;
    bindAttachments();
  };
  form.onsubmit = async (event) => {
    event.preventDefault();
    const button = form.querySelector("[type=submit]");
    button.disabled = true;
    try {
      await api(`/api/conversations/${c.id}/messages`, {
        method: "POST",
        body: { kind: "text", body: form.elements.body.value },
      });
      form.elements.body.value = "";
      await load(true);
    } catch (err) {
      form.querySelector(".form-error").textContent = err.message;
    } finally {
      updateState();
    }
  };
  form.elements.body.onkeydown = (event) => {
    if (event.key === "Enter" && !event.shiftKey && !event.isComposing) {
      event.preventDefault();
      form.requestSubmit();
    }
  };
  panel.querySelector("#choose-file").onclick = () =>
    panel.querySelector("#attachment").click();
  panel.querySelector("#attachment").onchange = async (event) => {
    const file = event.target.files[0];
    if (!file) return;
    const progress = panel.querySelector("progress");
    progress.hidden = false;
    progress.value = 20;
    try {
      const body = await readFile(file);
      const kind = file.type.startsWith("image/") ? "image" : "file";
      progress.value = 55;
      let thumb = "";
      if (kind === "image") {
        const image = await createImageBitmap(file);
        const canvas = document.createElement("canvas");
        canvas.width = 160;
        canvas.height = Math.round((image.height * 160) / image.width);
        canvas
          .getContext("2d")
          .drawImage(image, 0, 0, canvas.width, canvas.height);
        thumb = canvas.toDataURL("image/jpeg", 0.6);
      }
      await api(`/api/conversations/${c.id}/messages`, {
        method: "POST",
        body: { kind, body, name: file.name, thumb },
      });
      progress.value = 100;
      await load(true);
    } catch (err) {
      toast(err.message);
    } finally {
      setTimeout(() => (progress.hidden = true), 400);
      event.target.value = "";
    }
  };
  panel.querySelector("#close-chat").onclick = () =>
    confirmAction(
      row.temp_status
        ? "关闭会删除临时会话，是否继续？"
        : "关闭后保留历史消息，是否继续？",
      async () => {
        await api(`/api/conversations/${c.id}/close`, {
          method: "POST",
          body: {},
        });
        go("chat");
      },
    );
  panel.querySelector("#report").onclick = () =>
    go("feedback", {
      target_type: state.user.role === "student" ? "teacher" : "student",
      target_id: c.other_id,
    });
}

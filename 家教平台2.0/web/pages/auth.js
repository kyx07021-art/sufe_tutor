import { api, authenticated, brand, bindForm, toast } from "../app.js";
export async function render(root, { page }) {
  const register = page === "register";
  root.innerHTML = `<div class="auth-page">${brand()}<section class="auth-card"><p class="eyebrow">JINGTU · BANXUE</p><h1>${register ? "创建账户" : "欢迎回来"}</h1><p class="muted">师生直接对接，从这里开始</p><div class="tabs">${register ? "" : '<button class="selected" data-mode="password">密码登录</button><button data-mode="code">验证码登录</button>'}</div><form><div id="fields"><label>昵称<input name="username" required minlength="3" maxlength="30" autocomplete="username"></label><label>密码<input name="password" type="password" required minlength="6" autocomplete="${register ? "new-password" : "current-password"}"></label>${register ? '<label>我的角色<select name="role"><option value="student">学生 / 家长</option><option value="teacher">教师</option></select></label><label id="invite" hidden>教师邀请码<input name="invite_code" autocomplete="off"></label>' : ""}</div><p class="form-error" role="alert"></p><div class="actions"><a class="button" href="#landing">返回首页</a><button class="primary" type="submit">${register ? "注册并进入" : "登录"}</button></div></form><p class="auth-switch">${register ? '已有账户？<a href="#login">立即登录</a>' : '还没有账户？<a href="#register">立即注册</a>'}</p>${register ? '<p class="small muted">注册即表示你了解平台提供信息沟通服务；教学安排由双方自行协商。</p>' : ""}</section></div>`;
  const form = root.querySelector("form");
  let mode = "password";
  root.querySelector("[name=role]")?.addEventListener("change", (e) => {
    root.querySelector("#invite").hidden = e.target.value !== "teacher";
    root.querySelector("[name=invite_code]").required =
      e.target.value === "teacher";
  });
  root.querySelectorAll("[data-mode]").forEach(
    (button) =>
      (button.onclick = () => {
        mode = button.dataset.mode;
        root
          .querySelectorAll("[data-mode]")
          .forEach((b) => b.classList.toggle("selected", b === button));
        root.querySelector("#fields").innerHTML =
          mode === "password"
            ? '<label>昵称<input name="username" required autocomplete="username"></label><label>密码<input name="password" type="password" required autocomplete="current-password"></label>'
            : '<label>验证码通道<select name="channel"><option value="sms">手机 +86</option><option value="email">邮箱</option></select></label><label>手机号 / 邮箱<input name="target" required autocomplete="username"></label><label>验证码<div class="input-row"><input name="code" required inputmode="numeric" maxlength="6" autocomplete="one-time-code"><button type="button" id="send-code">发送验证码</button></div></label>';
        root
          .querySelector("#send-code")
          ?.addEventListener("click", async (e) => {
            e.target.disabled = true;
            try {
              const data = Object.fromEntries(new FormData(form));
              toast(
                (
                  await api("/api/auth/otp/request", {
                    method: "POST",
                    body: { ...data, scene: "login" },
                  })
                ).message,
              );
            } catch (err) {
              toast(err.message);
            } finally {
              e.target.disabled = false;
            }
          });
      }),
  );
  bindForm(form, async (data) =>
    authenticated(
      await api(
        register
          ? "/api/auth/register"
          : mode === "code"
            ? "/api/auth/login/code"
            : "/api/auth/login",
        { method: "POST", body: data },
      ),
    ),
  );
}

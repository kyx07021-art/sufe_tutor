import { one, all, run, HttpError } from "./db.js";
import { LIMIT } from "./shared.js";
import { updateRating } from "./domains/community.js";

const hex = (bytes) =>
  [...new Uint8Array(bytes)]
    .map((x) => x.toString(16).padStart(2, "0"))
    .join("");
export const digest = async (value) =>
  hex(await crypto.subtle.digest("SHA-256", new TextEncoder().encode(value)));
export async function hashPassword(
  password,
  salt = hex(crypto.getRandomValues(new Uint8Array(16))),
) {
  const key = await crypto.subtle.importKey(
    "raw",
    new TextEncoder().encode(password),
    "PBKDF2",
    false,
    ["deriveBits"],
  );
  const hash = hex(
    await crypto.subtle.deriveBits(
      {
        name: "PBKDF2",
        salt: new TextEncoder().encode(salt),
        iterations: 100000,
        hash: "SHA-512",
      },
      key,
      512,
    ),
  );
  return { hash, salt };
}
const from64 = (s) => Uint8Array.from(atob(s), (c) => c.charCodeAt(0));
const to64 = (bytes) => {
  let s = "";
  for (let i = 0; i < bytes.length; i += 8192)
    s += String.fromCharCode(...bytes.subarray(i, i + 8192));
  return btoa(s);
};
const fieldKey = (value) =>
  crypto.subtle.importKey("raw", from64(value), "AES-GCM", false, [
    "encrypt",
    "decrypt",
  ]);
export async function encodeField(env, text) {
  if (!text) return "";
  const key = await fieldKey(env.FIELD_ENC_KEY || env.LOG_ENCRYPT_KEY);
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const bytes = await crypto.subtle.encrypt(
    { name: "AES-GCM", iv },
    key,
    new TextEncoder().encode(text),
  );
  return `enc:v1:${to64(iv)}:${to64(new Uint8Array(bytes))}`;
}
// 生产已有轮换密钥；仅字段解密保留候选钥，业务模块不关心密文格式。
export async function decodeField(env, text) {
  if (!text || !text.startsWith("enc:v1:")) return text || "";
  const [, , iv, bytes] = text.split(":");
  for (const raw of [
    env.FIELD_ENC_KEY || env.LOG_ENCRYPT_KEY,
    env.FIELD_ENC_KEY_OLD,
    env.LOG_ENCRYPT_KEY_OLD,
  ].filter(Boolean)) {
    try {
      return new TextDecoder().decode(
        await crypto.subtle.decrypt(
          { name: "AES-GCM", iv: from64(iv) },
          await fieldKey(raw),
          from64(bytes),
        ),
      );
    } catch {
      /* 已有字段可能由上一把钥加密。 */
    }
  }
  throw new Error("字段密钥无法解密现有数据");
}
const publicUser = (u) => ({
  id: u.id,
  username: u.username,
  role: u.role,
  avatar: u.avatar,
  blockSystemNotifications: u.blockSystemNotifications,
  notifyBroadcastMuted: u.notifyBroadcastMuted,
});
export async function currentUser(db, request) {
  const token = request.headers.get("X-Auth-Token");
  if (!token) return null;
  return one(
    db,
    `SELECT u.id,u.username,u.role,u.avatar,u.blockSystemNotifications,u.notifyBroadcastMuted FROM auth_sessions s JOIN users u ON u.id=s.user_id WHERE s.token_hash=? AND s.expires_at>datetime('now') AND u.banned=0 AND u.deactivated=0`,
    [await digest(token)],
  );
}
export async function requireUser(db, request, role) {
  const user = await currentUser(db, request);
  if (!user) throw new HttpError(401, "LOGIN_REQUIRED", "请先登录");
  if (role && user.role !== role)
    throw new HttpError(403, "NO_PERMISSION", "当前角色没有此权限");
  return user;
}
export async function createSession(db, user) {
  const token = crypto.randomUUID() + crypto.randomUUID();
  await run(
    db,
    `INSERT INTO auth_sessions(token_hash,user_id,expires_at) VALUES (?,?,datetime('now','+7 days'))`,
    [await digest(token), user.id],
  );
  return { token, user: publicUser(user) };
}
export async function seedAdmins(db, env) {
  for (const name of (env.ADMIN_USERNAMES || "")
    .split(/[,，\n]/)
    .map((x) => x.trim())
    .filter(Boolean)) {
    if (await one(db, "SELECT id FROM users WHERE username=?", [name]))
      continue;
    const { hash, salt } = await hashPassword(env.ADMIN_DEFAULT_PASSWORD);
    await run(
      db,
      "INSERT INTO users(username,password_hash,salt,role) VALUES (?,?,?,'admin')",
      [name, hash, salt],
    );
  }
}
async function register({ db, body }) {
  const { username, password, role, invite_code } = body;
  if (
    !username ||
    username.length < LIMIT.usernameMin ||
    username.length > LIMIT.usernameMax
  )
    throw new HttpError(400, "USERNAME", "昵称需要 3–30 个字");
  if (!password || password.length < LIMIT.passwordMin)
    throw new HttpError(400, "PASSWORD", "密码至少 6 位");
  if (!["student", "teacher"].includes(role))
    throw new HttpError(400, "ROLE", "请选择学生或教师");
  if (await one(db, "SELECT id FROM users WHERE username=?", [username]))
    throw new HttpError(409, "TAKEN", "昵称已被使用");
  if (
    role === "teacher" &&
    !(await one(
      db,
      "SELECT code FROM invite_codes WHERE code=? AND used_by IS NULL",
      [invite_code || ""],
    ))
  )
    throw new HttpError(400, "INVITE", "请输入有效教师邀请码");
  const { hash, salt } = await hashPassword(password);
  const result = await run(
    db,
    "INSERT INTO users(username,password_hash,salt,role) VALUES (?,?,?,?)",
    [username, hash, salt, role],
  );
  const user = await one(db, "SELECT * FROM users WHERE id=?", [
    result.meta.last_row_id,
  ]);
  if (role === "teacher")
    await run(
      db,
      "UPDATE invite_codes SET used_by=?,used_at=datetime('now') WHERE code=?",
      [user.id, invite_code],
    );
  return createSession(db, user);
}
async function login({ db, body }) {
  const user = await one(db, "SELECT * FROM users WHERE username=?", [
    body.username,
  ]);
  if (
    !user ||
    (await hashPassword(body.password, user.salt)).hash !== user.password_hash
  )
    throw new HttpError(401, "LOGIN_FAILED", "昵称或密码错误");
  if (user.banned || user.deactivated)
    throw new HttpError(403, "ACCOUNT_UNAVAILABLE", "账户已停用");
  return createSession(db, user);
}
function targetOf(channel, value) {
  if (channel === "sms") {
    const number = value.replace(/[\s-]/g, "").replace(/^\+86/, "");
    if (!/^1[3-9]\d{9}$/.test(number))
      throw new HttpError(400, "PHONE", "仅支持中国大陆 +86 手机号");
    return "+86" + number;
  }
  if (channel !== "email" || !/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(value))
    throw new HttpError(400, "EMAIL", "请输入有效邮箱");
  return value.trim();
}
export async function verifyCode(db, channel, target, code) {
  const row = await one(
    db,
    `SELECT id FROM verification_codes WHERE channel=? AND target_hash=? AND code_hash=? AND used=0 AND expires_at>datetime('now') ORDER BY id DESC LIMIT 1`,
    [channel, await digest(target), await digest(code)],
  );
  if (!row) throw new HttpError(400, "CODE", "验证码错误或已过期");
  await run(db, "UPDATE verification_codes SET used=1 WHERE id=?", [row.id]);
}
async function requestCode({ db, request, body, env }) {
  const { channel, scene } = body;
  const target = targetOf(channel, body.target);
  if (scene === "bind") await requireUser(db, request);
  if (
    scene === "login" &&
    !(await one(
      db,
      `SELECT id FROM users WHERE ${channel === "sms" ? "phone_hash" : "email_hash"}=? AND deactivated=0`,
      [await digest(target)],
    ))
  )
    throw new HttpError(404, "NOT_BOUND", "该手机号或邮箱尚未绑定账户");
  const template =
    channel === "sms" ? env.SMS_OTP_TEMPLATE_CODE : env.EMAIL_OTP_TEMPLATE_CODE;
  if (!template)
    throw new HttpError(503, "CHANNEL_UNAVAILABLE", "该验证码通道尚未开通");
  const code = String(
    crypto.getRandomValues(new Uint32Array(1))[0] % 1000000,
  ).padStart(6, "0");
  const response = await fetch(
    `https://push.spug.cc/${channel === "sms" ? "sms" : "mail"}/${template}`,
    {
      method: "POST",
      body: new URLSearchParams(
        channel === "sms"
          ? { to: target.slice(3), code, number: "5" }
          : {
              to: target,
              scene: scene === "bind" ? "绑定验证" : "登录验证",
              code,
              minute: "5",
            },
      ),
    },
  );
  const data = await response.json();
  if (!response.ok || data.code !== 200)
    throw new HttpError(
      503,
      "DELIVERY_FAILED",
      "验证码发送失败：" + (data.msg || "通道暂不可用"),
    );
  await run(
    db,
    `INSERT INTO verification_codes(channel,target_hash,code_hash,expires_at) VALUES (?,?,?,datetime('now','+5 minutes'))`,
    [channel, await digest(target), await digest(code)],
  );
  return { message: "验证码已发送，5 分钟内有效" };
}
async function loginCode({ db, body }) {
  const target = targetOf(body.channel, body.target);
  await verifyCode(db, body.channel, target, body.code);
  const user = await one(
    db,
    `SELECT * FROM users WHERE ${body.channel === "sms" ? "phone_hash" : "email_hash"}=?`,
    [await digest(target)],
  );
  if (!user || user.banned || user.deactivated)
    throw new HttpError(403, "ACCOUNT_UNAVAILABLE", "账户不存在或已停用");
  return createSession(db, user);
}
async function getSettings(ctx) {
  const user = await requireUser(ctx.db, ctx.request);
  const fields = await one(ctx.db, "SELECT phone,email FROM users WHERE id=?", [
    user.id,
  ]);
  return {
    user: {
      ...user,
      phone: await decodeField(ctx.env, fields.phone),
      email: await decodeField(ctx.env, fields.email),
    },
  };
}
async function settings(ctx) {
  const { db, body, env } = ctx;
  const user = await requireUser(db, ctx.request);
  if (body.username !== undefined) {
    if (!body.username || body.username.length < 3 || body.username.length > 30)
      throw new HttpError(400, "USERNAME", "昵称需要 3–30 个字");
    if (
      await one(db, "SELECT id FROM users WHERE username=? AND id<>?", [
        body.username,
        user.id,
      ])
    )
      throw new HttpError(409, "TAKEN", "昵称已被使用");
    await run(db, "UPDATE users SET username=? WHERE id=?", [
      body.username,
      user.id,
    ]);
  }
  if (body.password) {
    const stored = await one(
      db,
      "SELECT password_hash,salt FROM users WHERE id=?",
      [user.id],
    );
    if (
      (await hashPassword(body.current_password, stored.salt)).hash !==
      stored.password_hash
    )
      throw new HttpError(400, "PASSWORD", "原密码错误");
    if (body.password.length < 6)
      throw new HttpError(400, "PASSWORD", "新密码至少 6 位");
    const { hash, salt } = await hashPassword(body.password);
    await run(db, "UPDATE users SET password_hash=?,salt=? WHERE id=?", [
      hash,
      salt,
      user.id,
    ]);
    await run(
      db,
      "DELETE FROM auth_sessions WHERE user_id=? AND token_hash<>?",
      [user.id, await digest(ctx.request.headers.get("X-Auth-Token"))],
    );
  }
  if (body.channel) {
    const target = targetOf(body.channel, body.target);
    await verifyCode(db, body.channel, target, body.code);
    const col = body.channel === "sms" ? "phone" : "email";
    if (
      await one(
        db,
        `SELECT id FROM users WHERE ${col}_hash=? AND id<>? AND deactivated=0`,
        [await digest(target), user.id],
      )
    )
      throw new HttpError(409, "BOUND", "该凭证已绑定其他账户");
    await run(db, `UPDATE users SET ${col}=?,${col}_hash=? WHERE id=?`, [
      await encodeField(env, target),
      await digest(target),
      user.id,
    ]);
  }
  if (body.avatar !== undefined) {
    if (body.avatar.length > LIMIT.avatarMaxBytes * 1.4)
      throw new HttpError(400, "AVATAR", "头像需要小于 20 KB");
    await run(db, "UPDATE users SET avatar=? WHERE id=?", [
      body.avatar,
      user.id,
    ]);
  }
  if (body.blockSystemNotifications !== undefined)
    await run(
      db,
      "UPDATE users SET blockSystemNotifications=?,notifyBroadcastMuted=? WHERE id=?",
      [
        Number(body.blockSystemNotifications),
        Number(body.notifyBroadcastMuted),
        user.id,
      ],
    );
  return getSettings(ctx);
}
async function deactivate(ctx) {
  const user = await requireUser(ctx.db, ctx.request);
  const record = await one(
    ctx.db,
    "SELECT password_hash,salt FROM users WHERE id=?",
    [user.id],
  );
  if (
    (await hashPassword(ctx.body.password, record.salt)).hash !==
    record.password_hash
  )
    throw new HttpError(400, "PASSWORD", "密码错误");
  const db = ctx.db;
  const affected = await all(
    db,
    "SELECT DISTINCT teacher_user_id FROM reviews WHERE reviewer_user_id=?",
    [user.id],
  );
  const likedPosts = await all(
    db,
    "SELECT post_id FROM post_likes WHERE user_id=?",
    [user.id],
  );
  await db.batch([
    db
      .prepare(
        "UPDATE users SET username=?,password_hash='',salt='',phone='',email='',phone_hash='',email_hash='',avatar='',deactivated=1 WHERE id=?",
      )
      .bind("已注销用户_" + user.id, user.id),
    ...[
      "auth_sessions",
      "uploads",
      "teacher_profiles",
      "teacher_verifications",
      "student_demands",
      "posts",
      "post_likes",
      "post_favorites",
      "complaints",
      "notifications",
    ].map((table) =>
      db.prepare(`DELETE FROM ${table} WHERE user_id=?`).bind(user.id),
    ),
    db
      .prepare(
        "DELETE FROM reviews WHERE reviewer_user_id=? OR teacher_user_id=?",
      )
      .bind(user.id, user.id),
    db.prepare("DELETE FROM messages WHERE sender_user_id=?").bind(user.id),
    db
      .prepare(
        "UPDATE conversations SET status='closed' WHERE student_user_id=? OR teacher_user_id=?",
      )
      .bind(user.id, user.id),
    db.prepare("DELETE FROM feedbacks WHERE user_id=?").bind(user.id),
  ]);
  for (const teacher of affected)
    await updateRating(db, teacher.teacher_user_id);
  for (const post of likedPosts)
    await run(
      db,
      "UPDATE posts SET like_count=(SELECT count(*) FROM post_likes WHERE post_id=?) WHERE id=?",
      [post.post_id, post.post_id],
    );
  return { message: "账户已注销" };
}
export const routes = [
  ["POST", "/api/auth/register", register],
  ["POST", "/api/auth/login", login],
  ["POST", "/api/auth/login/code", loginCode],
  ["POST", "/api/auth/otp/request", requestCode],
  [
    "POST",
    "/api/auth/logout",
    async (c) => {
      await run(c.db, "DELETE FROM auth_sessions WHERE token_hash=?", [
        await digest(c.request.headers.get("X-Auth-Token") || ""),
      ]);
      return { ok: true };
    },
  ],
  [
    "GET",
    "/api/auth/me",
    async (c) => ({ user: await requireUser(c.db, c.request) }),
  ],
  ["GET", "/api/settings", getSettings],
  ["PUT", "/api/settings", settings],
  ["POST", "/api/settings/deactivate", deactivate],
  [
    "GET",
    "/api/users/:id",
    async (c) => {
      await requireUser(c.db, c.request);
      const user = await one(
        c.db,
        "SELECT id,username,role,avatar FROM users WHERE id=? AND deactivated=0",
        [c.params.id],
      );
      if (!user) throw new HttpError(404, "NOT_FOUND", "用户不存在");
      return { user };
    },
  ],
];

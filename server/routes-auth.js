/**
 * 路由模块：认证（注册 / 登录）
 * 注册与登录结果（成功 / 失败 / 被封禁）发语义日志 auth.*
 */
import { json, error, hashPassword, verifyPassword, dbRun, issueAuthToken, authUser, MSG, INVITE_GATE_ENABLED } from './core.js';
import { dbFindUserByUsername, dbFindUserById, dbCreateUser, dbFindValidInviteCode, dbUseInviteCode } from './db.js';
import { logEvent } from './log.js';

export async function handleRegister(db, body, req) {
  const { username, password, role, inviteCode } = body;
  if (!username || username.length < 3 || username.length > 30) return error(MSG.USERNAME_LENGTH);
  if (!password || password.length < 6) return error(MSG.PASSWORD_LENGTH);
  if (!['student', 'teacher'].includes(role)) return error(MSG.INVALID_ROLE);

  // 教师邀请码门控：内测期间休眠（INVITE_GATE_ENABLED=false 时教师免邀请码注册）
  const needsInvite = role === 'teacher' && INVITE_GATE_ENABLED;
  if (needsInvite) {
    if (!inviteCode) return error(MSG.TEACHER_NEEDS_INVITE);
    const code = await dbFindValidInviteCode(db, inviteCode);
    if (!code) return error(MSG.INVITE_INVALID);
  }

  if (await dbFindUserByUsername(db, username)) return error(MSG.USERNAME_TAKEN);

  const { hash, salt } = await hashPassword(password);
  const userId = await dbCreateUser(db, username, hash, salt, role);
  if (needsInvite) await dbUseInviteCode(db, inviteCode, userId);
  const authToken = await issueAuthToken(db, userId);
  logEvent(db, { action: 'auth.register', actorUserId: userId, actorUsername: username,
    actorRole: role, entity: 'user', entityId: userId, detail: { role, via: needsInvite ? 'invite' : 'direct' }, req });
  return json({ user: { id: userId, username, role, avatar: '' }, authToken, message: MSG.REGISTER_SUCCESS });
}

export async function handleLogin(db, body, req) {
  const { username, password } = body;
  if (!username || !password) return error(MSG.LOGIN_REQUIRED);

  const user = await dbFindUserByUsername(db, username);
  if (!user || !(await verifyPassword(password, user.password_hash, user.salt))) {
    logEvent(db, { action: 'auth.login.failed', actorUsername: username,
      entity: 'user', detail: { username }, req });
    return error(MSG.LOGIN_FAILED, 401);
  }
  if (user.banned) {
    logEvent(db, { action: 'auth.login.banned', actorUserId: user.id, actorUsername: user.username,
      actorRole: user.role, entity: 'user', entityId: user.id, req });
    return error(MSG.ACCOUNT_BANNED, 403);
  }
  const authToken = await issueAuthToken(db, user.id);
  logEvent(db, { action: 'auth.login.success', actorUserId: user.id, actorUsername: user.username,
    actorRole: user.role, entity: 'user', entityId: user.id, req });
  return json({ user: { id: user.id, username: user.username, role: user.role, avatar: user.avatar || '' }, authToken });
}

// 登录页用户名实时探测：仅返回存在与否 + 角色（登录提示用，不暴露其他字段）
export async function handleCheckUsername(db, url) {
  const username = (url.searchParams.get('username') || '').trim();
  if (!username) return json({ exists: false });
  const user = await dbFindUserByUsername(db, username);
  return json(user ? { exists: true, role: user.role } : { exists: false });
}

// GET /api/auth/me —— 凭令牌取当前用户（刷新保活：前端持久化 token 后不再重放密码登录）
export async function handleAuthMe(db, req) {
  const me = await authUser(db, req);
  if (!me) return error(MSG.LOGIN_REQUIRED, 401);
  const full = await dbFindUserById(db, me.id);
  return json({ user: { id: me.id, username: me.username, role: me.role, avatar: (full && full.avatar) || '' } });
}

// 账户设置：头像上传。前端已按居中最大内切圆裁成 160px dataURL，此处校验长度后落 users.avatar
export async function handleSaveAvatar(db, body, req) {
  const me = await authUser(db, req);
  if (!me) return error(MSG.LOGIN_REQUIRED, 401);
  const avatar = String(body.avatar || '');
  if (!avatar.startsWith('data:image/') || avatar.length > 20000) return error(MSG.AVATAR_INVALID);
  await dbRun(db, 'UPDATE users SET avatar=? WHERE id=?', [avatar, me.id]);
  logEvent(db, { action: 'user.avatar.update', actorUserId: me.id, entity: 'user', entityId: me.id, req });
  return json({ ok: true });
}

/**
 * 路由模块：认证（注册 / 登录）
 * 注册与登录结果（成功 / 失败 / 被封禁）发语义日志 auth.*
 */
import { json, error, hashPassword, verifyPassword, dbRun, dbGet, issueAuthToken, authUser, confirmDangerOtp, deviceLabelFromUA, listSessions, revokeSession, MSG, INVITE_GATE_ENABLED } from './core.js';
import { dbFindUserByUsername, dbCreateUser, dbFindValidInviteCode, dbUseInviteCode } from './db.js';
import { logEvent } from './log.js';
import '../constants.js'; // 注销墓碑文案走 globalThis.APP_CONSTANTS.UI

export async function handleRegister(db, body, req) {
  const { username, password, role, inviteCode } = body;
  if (!username || username.length < 3 || username.length > 30) return error(MSG.USERNAME_LENGTH);
  // 用户名字符集白名单（中文/字母/数字/_ . -），杜绝 control char / HTML 注入名进入全站 innerHTML
  if (!/^[\p{Script=Han}A-Za-z0-9_.\-]{3,30}$/u.test(username)) return error(MSG.USERNAME_INVALID);
  // 预留注销墓碑前缀：禁止注册与「已注销用户#id」同前缀的用户名（防冒充注销账户）
  const tombPrefix = globalThis.APP_CONSTANTS.UI.DEACTIVATED_USER_PREFIX;
  if (tombPrefix && username.startsWith(tombPrefix)) return error(MSG.USERNAME_INVALID);
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
  const authToken = await issueAuthToken(db, userId, deviceLabelFromUA(req && req.headers.get('user-agent')));
  logEvent(db, { action: 'auth.register', actorUserId: userId, actorUsername: username,
    actorRole: role, entity: 'user', entityId: userId, detail: { role, via: needsInvite ? 'invite' : 'direct' }, req });
  return json({ user: { id: userId, username, role, avatar: '' }, authToken, message: MSG.REGISTER_SUCCESS });
}

export async function handleLogin(db, body, req) {
  const { username, password } = body;
  if (!username || !password) return error(MSG.LOGIN_REQUIRED);
  // 限定用户名长度上限：超长串直接早退，避免无谓的哈希查库 / PBKDF2 消耗（文案不变，仍为「用户名或密码错误」）
  if (String(username).length > 60) return error(MSG.LOGIN_FAILED, 401);

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
  if (user.deactivated) return error(MSG.ACCOUNT_DEACTIVATED, 403);
  const authToken = await issueAuthToken(db, user.id, deviceLabelFromUA(req && req.headers.get('user-agent')));
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

// GET /api/users/:id —— 公开名片（个人信息右栏的兜底数据源）：仅用户名/角色/头像三件，
// 墓碑用户名原样返回（前端灰斜体渲染）；被封禁且未注销的账户视同不存在（不透露封禁态）
export async function handleGetUserPublic(db, userId) {
  const user = await dbGet(db, 'SELECT id, username, role, avatar, banned, deactivated FROM users WHERE id=?', [userId]);
  if (!user || (user.banned && !user.deactivated)) return error(MSG.USER_NOT_FOUND, 404);
  return json({ user: { id: user.id, username: user.username, role: user.role, avatar: user.avatar || '' } });
}

// POST /api/user/deactivate —— 注销账户：用户名墓碑化（「已注销用户#id」，后缀避 UNIQUE 冲突）+
// 凭证清空 + 单方关联数据全删（档案/通知/反馈/帖子/点赞/暂存附件）；需求/会话/合同/评价等
// 双方数据保留，JOIN username 处自然显示墓碑。后期接入短信验证（confirmDangerOtp，现恒通过）
export async function handleDeactivateAccount(db, body, req) {
  const me = await authUser(db, req);
  if (!me) return error(MSG.LOGIN_REQUIRED, 401);
  if (me.role === 'admin') return error(MSG.NO_PERMISSION, 403); // 管理员禁止注销，防管理面板孤岛化
  if (!(await confirmDangerOtp(db, me.id))) return error(MSG.ACCOUNT_DEACTIVATED, 403);
  const tombstone = `${globalThis.APP_CONSTANTS.UI.DEACTIVATED_USER_PREFIX}#${me.id}`;
  await dbRun(db, `UPDATE users SET username=?, password_hash='', salt='', avatar='', banned=1, deactivated=1 WHERE id=?`,
    [tombstone, me.id]);
  await dbRun(db, 'DELETE FROM auth_sessions WHERE user_id=?', [me.id]); // 注销即吊销全部设备的登录态
  await dbRun(db, 'DELETE FROM teacher_profiles WHERE user_id=?', [me.id]);
  await dbRun(db, 'DELETE FROM notifications WHERE user_id=?', [me.id]);
  await dbRun(db, 'DELETE FROM feedbacks WHERE user_id=?', [me.id]);
  await dbRun(db, 'DELETE FROM uploads WHERE user_id=?', [me.id]);
  await dbRun(db, 'DELETE FROM post_likes WHERE user_id=?', [me.id]);
  await dbRun(db, 'DELETE FROM posts WHERE user_id=?', [me.id]);
  logEvent(db, { action: 'user.deactivate', actorUserId: me.id, actorUsername: tombstone,
    actorRole: me.role, entity: 'user', entityId: me.id, req });
  return json({ ok: true });
}

// GET /api/auth/me —— 凭令牌取当前用户（刷新保活：前端持久化 token 后不再重放密码登录）
export async function handleAuthMe(db, req) {
  const me = await authUser(db, req); // authUser 的 SELECT 已含 avatar，无需二次查询
  if (!me) return error(MSG.LOGIN_REQUIRED, 401);
  return json({ user: { id: me.id, username: me.username, role: me.role, avatar: me.avatar || '' } });
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

// 账户设置 · 登录设备管理：列出本人全部会话（新→旧），逐条标注 current 供前端区分「当前设备」。
// token 整枚返回——属账户本人数据，前端凭此比对当前设备并发起逐端退登
export async function handleListSessions(db, req) {
  const me = await authUser(db, req);
  if (!me) return error(MSG.LOGIN_REQUIRED, 401);
  const current = req.headers.get('X-Auth-Token');
  const sessions = await listSessions(db, me.id);
  return json({ sessions: sessions.map(s => ({ token: s.token, label: s.label, created_at: s.created_at, expires_at: s.expires_at, current: s.token === current })) });
}

// 逐端退登：删除本人名下指定会话；命中与否经 changes 判定。吊销的若是当前设备（踢自己），
// 前端据 revokedSelf 随后本地登出
export async function handleRevokeSession(db, body, req) {
  const me = await authUser(db, req);
  if (!me) return error(MSG.LOGIN_REQUIRED, 401);
  const token = String(body.token || '');
  if (!token) return error(MSG.INVALID_PARAMS);
  const ok = await revokeSession(db, me.id, token);
  if (!ok) return error(MSG.SESSION_NOT_FOUND, 404);
  logEvent(db, { action: 'auth.session.revoke', actorUserId: me.id, entity: 'user', entityId: me.id,
    detail: { self: token === req.headers.get('X-Auth-Token') }, req });
  return json({ ok: true, revokedSelf: token === req.headers.get('X-Auth-Token') });
}

// 退出登录：吊销当前会话（此前登出仅清本地、令牌 7 天内仍有效的软登出，改为真登出）。
// fire-and-forget：即便令牌已失效也返回 ok，不阻断前端清理
export async function handleLogout(db, req) {
  const me = await authUser(db, req);
  if (me) {
    await revokeSession(db, me.id, req.headers.get('X-Auth-Token'));
    logEvent(db, { action: 'auth.logout', actorUserId: me.id, entity: 'user', entityId: me.id, req });
  }
  return json({ ok: true });
}

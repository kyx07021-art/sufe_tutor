/**
 * 路由模块：认证（注册 / 登录）
 * 注册与登录结果（成功 / 失败 / 被封禁）发语义日志 auth.*
 */
import { json, error, dbGet, dbRun, hashPassword, verifyPassword, issueAuthToken, authUser, confirmDangerOtp, issueCapToken, tokenDigest, deviceLabelFromUA, listSessions, revokeSession, MSG, INVITE_GATE_ENABLED } from './core.js';
import { dbFindUserByUsername, dbCreateUser, dbFindValidInviteCode, dbUseInviteCode,
  dbGetUserById, dbDeactivateUser, dbPurgeUserOwnedData, dbUpdateUserAvatar } from './db.js';
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
  if (needsInvite) {
    // 原子消费（赢家模式）：并发双注册同码仅一方 changes>0；输家回滚刚建的用户拒绝注册
    const consumed = await dbUseInviteCode(db, inviteCode, userId);
    if (!consumed) {
      await dbRun(db, 'DELETE FROM users WHERE id=?', [userId]);
      return error(MSG.INVITE_INVALID, 409);
    }
  }
  const authToken = await issueAuthToken(db, userId, deviceLabelFromUA(req && req.headers.get('user-agent')));
  await logEvent(db, { action: 'auth.register', actorUserId: userId, actorUsername: username,
    actorRole: role, entity: 'user', entityId: userId, detail: { role, via: needsInvite ? 'invite' : 'direct' }, req });
  return json({ user: { id: userId, username, role, avatar: '' }, authToken, message: MSG.REGISTER_SUCCESS });
}

export async function handleLogin(db, body, req) {
  const { username, password } = body;
  if (!username || !password) return error(MSG.LOGIN_REQUIRED);
  // 限定用户名/密码长度上限：超长串直接早退，避免无谓的哈希查库 / PBKDF2 消耗（文案不变，仍为「用户名或密码错误」）
  if (String(username).length > 60 || String(password).length > 72) return error(MSG.LOGIN_FAILED, 401);

  const user = await dbFindUserByUsername(db, username);
  if (!user || !(await verifyPassword(password, user.password_hash, user.salt))) {
    await logEvent(db, { action: 'auth.login.failed', actorUsername: username,
      entity: 'user', detail: { username }, req });
    return error(MSG.LOGIN_FAILED, 401);
  }
  if (user.banned) {
    await logEvent(db, { action: 'auth.login.banned', actorUserId: user.id, actorUsername: user.username,
      actorRole: user.role, entity: 'user', entityId: user.id, req });
    return error(MSG.ACCOUNT_BANNED, 403);
  }
  if (user.deactivated) return error(MSG.ACCOUNT_DEACTIVATED, 403);
  const authToken = await issueAuthToken(db, user.id, deviceLabelFromUA(req && req.headers.get('user-agent')));
  await logEvent(db, { action: 'auth.login.success', actorUserId: user.id, actorUsername: user.username,
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
  const user = await dbGetUserById(db, userId);
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
  if (!(await confirmDangerOtp(me.id, body))) return error(MSG.REAUTH_FAILED, 403);
  const tombstone = `${globalThis.APP_CONSTANTS.UI.DEACTIVATED_USER_PREFIX}#${me.id}`;
  await dbDeactivateUser(db, me.id, tombstone);
  await dbPurgeUserOwnedData(db, me.id, me.role); // 按角色清理单方数据 + 匿名化本人聊天正文
  await logEvent(db, { action: 'user.deactivate', actorUserId: me.id, actorUsername: tombstone,
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
  await dbUpdateUserAvatar(db, me.id, avatar);
  await logEvent(db, { action: 'user.avatar.update', actorUserId: me.id, entity: 'user', entityId: me.id, req });
  return json({ ok: true });
}

// 账户设置 · 登录设备管理：列出本人全部会话（新→旧），逐条标注 current 供前端区分「当前设备」。
// 安全（网安报告 F-04）：只返回不可认证的 session_id + 设备标签 + 时间，token 永不进响应体；
// current 判定：单独按当前请求 token 反查其 session_id，比对列表项
export async function handleListSessions(db, req) {
  const me = await authUser(db, req);
  if (!me) return error(MSG.LOGIN_REQUIRED, 401);
  const current = req.headers.get('X-Auth-Token');
  const currentRow = current ? await dbGet(db, 'SELECT session_id FROM auth_sessions WHERE user_id=? AND token_hash=?', [me.id, await tokenDigest(current)]) : null;
  const currentId = currentRow?.session_id || '';
  const sessions = await listSessions(db, me.id);
  return json({ sessions: sessions.map(s => ({ session_id: s.session_id, label: s.label, created_at: s.created_at, expires_at: s.expires_at, current: s.session_id === currentId })) });
}

// 逐端退登：按 session_id 吊销本人名下指定会话；命中与否经 changes 判定。吊销的若是当前设备（踢自己），
// 前端据 revokedSelf 随后本地登出。安全：撤销接口收 session_id，服务端映射，token 不参与请求体
export async function handleRevokeSession(db, body, req) {
  const me = await authUser(db, req);
  if (!me) return error(MSG.LOGIN_REQUIRED, 401);
  const sessionId = String(body.sessionId || '');
  if (!sessionId) return error(MSG.INVALID_PARAMS);
  // 先反查当前设备 session_id（撤销前，勿删后再查）
  const curRow = req.headers.get('X-Auth-Token')
    ? await dbGet(db, 'SELECT session_id FROM auth_sessions WHERE user_id=? AND token_hash=?', [me.id, await tokenDigest(req.headers.get('X-Auth-Token'))])
    : null;
  const ok = await revokeSession(db, me.id, sessionId);
  if (!ok) return error(MSG.SESSION_NOT_FOUND, 404);
  const self = !!(curRow && curRow.session_id === sessionId);
  await logEvent(db, { action: 'auth.session.revoke', actorUserId: me.id, entity: 'user', entityId: me.id,
    detail: { self }, req });
  return json({ ok: true, revokedSelf: self });
}

// 退出登录：吊销当前会话（此前登出仅清本地、令牌 7 天内仍有效的软登出，改为真登出）。
// 按 token_hash 删当前令牌行（曾误把明文 token 当 session_id 传 revokeSession，恒删 0 行的真登出失效 bug）
// fire-and-forget：即便令牌已失效也返回 ok，不阻断前端清理
export async function handleLogout(db, req) {
  const me = await authUser(db, req);
  if (me) {
    const cur = req.headers.get('X-Auth-Token');
    if (cur) await dbRun(db, 'DELETE FROM auth_sessions WHERE user_id=? AND token_hash=?', [me.id, await tokenDigest(cur)]);
    await logEvent(db, { action: 'auth.logout', actorUserId: me.id, entity: 'user', entityId: me.id, req });
  }
  return json({ ok: true });
}

// POST /api/auth/re-auth —— 危险操作二次认证（网安报告 F-05）：已登录用户输入当前密码 → 校验通过
// 签发一次性 capToken（core.js issueCapToken，5 分钟 TTL），危险接口凭 capToken 放行。
// 密码错返 403 而非 401（前端 api() 对 401 统一弹登录页，会误踢已登录用户）
export async function handleReAuth(db, body, req) {
  const me = await authUser(db, req);
  if (!me) return error(MSG.LOGIN_REQUIRED, 401);
  const password = String((body && body.password) || '');
  if (!password || password.length > 72) return error(MSG.LOGIN_FAILED, 403); // 长度上限早退，防无谓 PBKDF2
  const u = await dbFindUserByUsername(db, me.username);
  if (!u || !(await verifyPassword(password, u.password_hash, u.salt))) {
    await logEvent(db, { action: 'auth.reauth.failed', actorUserId: me.id, entity: 'user', entityId: me.id, req });
    return error(MSG.LOGIN_FAILED, 403);
  }
  const capToken = issueCapToken(me.id);
  await logEvent(db, { action: 'auth.reauth.success', actorUserId: me.id, entity: 'user', entityId: me.id, req });
  return json({ capToken });
}

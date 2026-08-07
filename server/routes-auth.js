/**
 * 路由模块：认证（注册 / 登录 / 二次认证 / 会话管理 / 账户）
 * 身份一律凭 X-Auth-Token（security.authUser），token 只进请求头，响应体只返 session_id。
 * 依赖：util（响应构造/UA 标签）、crypto（口令哈希/令牌摘要）、session（令牌签发/会话管理）、
 *       security（身份解析）、constants（校验文案/限额）。
 */
import { json, error, deviceLabelFromUA } from './util.js';
import { hashPassword, verifyPassword, tokenDigest } from './crypto.js';
import { authUser, requireUser, authRateBatch, authRateBlock } from './security.js';
import {
  issueAuthToken, listSessions, revokeSession,
  getSessionByToken, revokeToken,
} from './session.js';
import { issueCapToken, confirmDangerOtp, clearDangerCaps, clearDangerCapsForSession } from './danger-ops.js'; // 危险操作二次认证（D1 持久化，跨实例一致，网安审计 N-02）+ capToken 清理
import { MSG, INVITE_GATE_ENABLED, LIMITS } from './constants.js';
import {
  dbFindUserByUsername, dbCreateUser, dbFindValidInviteCode, dbUseInviteCode,
  dbGetUserById, dbDeactivateUser, dbPurgeUserOwnedData, dbUpdateUserAvatar, dbDeleteUser,
  dbUserLookupStmt, dbUsernameExistsStmt,
} from './db.js';
import { logEvent } from './log.js';
import '../constants.js'; // 注销墓碑文案走 globalThis.APP_CONSTANTS.UI

export async function handleRegister(db, body, req) {
  const { username, password, role, inviteCode } = body;
  if (!username || username.length < LIMITS.USERNAME_MIN || username.length > LIMITS.USERNAME_MAX) return error(MSG.USERNAME_LENGTH);
  // 用户名字符集白名单（中文/字母/数字/_ . -），杜绝 control char / HTML 注入名进入全站 innerHTML
  if (!/^[\p{Script=Han}A-Za-z0-9_.\-]{3,30}$/u.test(username)) return error(MSG.USERNAME_INVALID);
  // 预留注销墓碑前缀：禁止注册与「已注销用户#id」同前缀的用户名（防冒充注销账户）
  const tombPrefix = globalThis.APP_CONSTANTS.UI.DEACTIVATED_USER_PREFIX;
  if (tombPrefix && username.startsWith(tombPrefix)) return error(MSG.USERNAME_INVALID);
  if (!password || password.length < LIMITS.PASSWORD_MIN || password.length > LIMITS.LOGIN_PASSWORD_MAX) return error(MSG.PASSWORD_LENGTH); // 上限防 PBKDF2 CPU 放大（与登录同口径）
  if (!['student', 'teacher'].includes(role)) return error(MSG.INVALID_ROLE);

  // B1：限流（封禁查+写限流+注册限流）与用户名占用查同批一次往返（1 次 D1）；D1 异常由 fetch 层兜 500，不 fail-open
  const ip = req.headers.get('CF-Connecting-IP') || 'anon';
  const gate = authRateBatch(db, ip, 'register', [dbUsernameExistsStmt(db, username)]);
  const results = await db.batch(gate.stmts);
  if (gate.verdict(results)) { await authRateBlock(db, ip); return error(MSG.RATE_LIMITED, 429); }
  const takenRow = gate.extra(results)[0];
  if (takenRow && takenRow.results && takenRow.results.length) return error(MSG.USERNAME_TAKEN);

  // 教师邀请码门控：内测期间休眠（INVITE_GATE_ENABLED=false 时教师免邀请码注册）
  const needsInvite = role === 'teacher' && INVITE_GATE_ENABLED;
  if (needsInvite) {
    if (!inviteCode) return error(MSG.TEACHER_NEEDS_INVITE);
    const code = await dbFindValidInviteCode(db, inviteCode);
    if (!code) return error(MSG.INVITE_INVALID);
  }

  const { hash, salt } = await hashPassword(password);
  const userId = await dbCreateUser(db, username, hash, salt, role);
  if (needsInvite) {
    // 原子消费（赢家模式）：并发双注册同码仅一方 changes>0；输家回滚刚建的用户拒绝注册
    const consumed = await dbUseInviteCode(db, inviteCode, userId);
    if (!consumed) {
      await dbDeleteUser(db, userId); // 回滚刚建的用户（数据层单点，路由不直写 SQL）
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
  if (String(username).length > LIMITS.LOGIN_USERNAME_MAX || String(password).length > LIMITS.LOGIN_PASSWORD_MAX) return error(MSG.LOGIN_FAILED, 401);

  // B1：限流（封禁查+写限流+登录限流）与取用户同批一次往返（登录 10 次 D1 → 此步 1 次）；D1 异常由 fetch 层兜 500
  const ip = req.headers.get('CF-Connecting-IP') || 'anon';
  const gate = authRateBatch(db, ip, 'login', [dbUserLookupStmt(db, username)]);
  const results = await db.batch(gate.stmts);
  if (gate.verdict(results)) { await authRateBlock(db, ip); return error(MSG.RATE_LIMITED, 429); }
  const userRow = gate.extra(results)[0];
  const user = userRow && userRow.results ? userRow.results[0] : null;

  if (!user) {
    await hashPassword(password); // 网安 N-18：哑 PBKDF2 抹平「用户名不存在」与「密码错误」的响应时序差
    await logEvent(db, { action: 'auth.login.failed', actorUsername: username,
      entity: 'user', detail: { username }, req });
    return error(MSG.LOGIN_FAILED, 401);
  }
  if (!(await verifyPassword(password, user.password_hash, user.salt))) {
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
// 双方数据保留，JOIN username 处自然显示墓碑。危险操作二次认证 = 密码换 5 分钟一次性 capToken（danger-ops.issueCapToken）
export async function handleDeactivateAccount(db, body, req) {
  const { user: me, err } = await requireUser(db, req);
  if (err) return err;
  if (me.role === 'admin') return error(MSG.NO_PERMISSION, 403); // 管理员禁止注销，防管理面板孤岛化
  if (!(await confirmDangerOtp(db, req, body))) return error(MSG.REAUTH_FAILED, 403);
  const tombstone = `${globalThis.APP_CONSTANTS.UI.DEACTIVATED_USER_PREFIX}#${me.id}`;
  await dbDeactivateUser(db, me.id, tombstone);
  await dbPurgeUserOwnedData(db, me.id, me.role); // 按角色清理单方数据 + 匿名化本人聊天正文
  await clearDangerCaps(db, me.id); // 注销即清全部 capToken（防 danger_caps 孤儿行残留）
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
  // svg 一律拒绝：矢量可内嵌脚本，渲染路径的图片统一只放行位图（长度上限单源 LIMITS.AVATAR_MAX_BYTES）
  if (!avatar.startsWith('data:image/') || avatar.startsWith('data:image/svg') || avatar.length > LIMITS.AVATAR_MAX_BYTES) return error(MSG.AVATAR_INVALID);
  await dbUpdateUserAvatar(db, me.id, avatar);
  await logEvent(db, { action: 'user.avatar.update', actorUserId: me.id, entity: 'user', entityId: me.id, req });
  return json({ ok: true });
}

// 账户设置 · 登录设备管理：列出本人全部会话（新→旧），逐条标注 current 供前端区分「当前设备」。
// 安全（网安报告 F-04）：只返回不可认证的 session_id + 设备标签 + 时间，token 永不进响应体
export async function handleListSessions(db, req) {
  const me = await authUser(db, req);
  if (!me) return error(MSG.LOGIN_REQUIRED, 401);
  const curRow = await getSessionByToken(db, me.id, req.headers.get('X-Auth-Token'));
  const currentId = curRow?.session_id || '';
  const sessions = await listSessions(db, me.id);
  return json({ sessions: sessions.map(s => ({ session_id: s.session_id, label: s.label, created_at: s.created_at, expires_at: s.expires_at, current: s.session_id === currentId })) });
}

// 逐端退登：按 session_id 吊销本人名下指定会话；吊销的若是当前设备（踢自己），
// 前端据 revokedSelf 随后本地登出。安全：撤销接口收 session_id，服务端映射，token 不参与请求体
export async function handleRevokeSession(db, body, req) {
  const me = await authUser(db, req);
  if (!me) return error(MSG.LOGIN_REQUIRED, 401);
  const sessionId = String(body.sessionId || '');
  if (!sessionId) return error(MSG.INVALID_PARAMS);
  // 先反查当前设备 session_id（撤销前，勿删后再查）
  const curRow = await getSessionByToken(db, me.id, req.headers.get('X-Auth-Token'));
  const ok = await revokeSession(db, me.id, sessionId);
  if (!ok) return error(MSG.SESSION_NOT_FOUND, 404);
  await clearDangerCapsForSession(db, me.id, sessionId); // 逐端退登同步清该会话 capToken（孤儿行清理）
  const self = !!(curRow && curRow.session_id === sessionId);
  await logEvent(db, { action: 'auth.session.revoke', actorUserId: me.id, entity: 'user', entityId: me.id,
    detail: { self }, req });
  return json({ ok: true, revokedSelf: self });
}

// 退出登录：吊销当前会话（真登出，按 token_hash 删当前令牌行）。
// fire-and-forget：即便令牌已失效也返回 ok，不阻断前端清理
export async function handleLogout(db, req) {
  const me = await authUser(db, req);
  if (me) {
    const token = req.headers.get('X-Auth-Token');
    const row = await getSessionByToken(db, me.id, token); // 吊销前先反查 session_id（清 capToken 用）
    await revokeToken(db, me.id, token);
    if (row) await clearDangerCapsForSession(db, me.id, row.session_id); // 登出同步清该会话 capToken
    await logEvent(db, { action: 'auth.logout', actorUserId: me.id, entity: 'user', entityId: me.id, req });
  }
  return json({ ok: true });
}

// POST /api/auth/re-auth —— 危险操作二次认证（网安报告 F-05）：已登录用户输入当前密码 → 校验通过
// 签发一次性 capToken（danger-ops.issueCapToken，TTL 见 constants.SECURITY），危险接口凭 capToken 放行。
// 密码错返 403 而非 401（前端 api() 对 401 统一弹登录页，会误踢已登录用户）
export async function handleReAuth(db, body, req) {
  const me = await authUser(db, req);
  if (!me) return error(MSG.LOGIN_REQUIRED, 401);
  const password = String((body && body.password) || '');
  if (!password || password.length > LIMITS.LOGIN_PASSWORD_MAX) return error(MSG.LOGIN_FAILED, 403); // 长度上限早退，防无谓 PBKDF2

  // B1：限流与取用户同批一次往返（原限流 5 次 D1 → 1 次）
  const ip = req.headers.get('CF-Connecting-IP') || 'anon';
  const gate = authRateBatch(db, ip, 'reauth', [dbUserLookupStmt(db, me.username)]);
  const results = await db.batch(gate.stmts);
  if (gate.verdict(results)) { await authRateBlock(db, ip); return error(MSG.RATE_LIMITED, 429); }
  const uRow = gate.extra(results)[0];
  const u = uRow && uRow.results ? uRow.results[0] : null;
  if (!u || !(await verifyPassword(password, u.password_hash, u.salt))) {
    await logEvent(db, { action: 'auth.reauth.failed', actorUserId: me.id, entity: 'user', entityId: me.id, req });
    return error(MSG.LOGIN_FAILED, 403);
  }
  const capToken = await issueCapToken(db, req);
  await logEvent(db, { action: 'auth.reauth.success', actorUserId: me.id, entity: 'user', entityId: me.id, req });
  return json({ capToken });
}

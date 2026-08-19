/**
 * 路由模块：认证（注册 / 登录 / 二次认证 / 会话管理 / 账户）
 * 身份一律凭 X-Auth-Token（security.authUser），token 只进请求头，响应体只返 session_id。
 * 依赖：util（响应构造/UA 标签）、crypto（口令哈希/令牌摘要）、session（令牌签发/会话管理）、
 *       security（身份解析）、constants（校验文案/限额）。
 */
import { json, errorMsg, deviceLabelFromUA, isUniqueConflict, parseIdParam } from '../../core/util.js';
import { hashPassword, verifyPassword, tokenDigest } from '../../core/crypto.js';
import { authUser, requireUser, authRateBatch, authRateBlock } from '../../core/security.js';
import {
  issueAuthToken, listSessions, revokeSession,
  getSessionByToken, revokeToken,
} from '../../core/session.js';
import { issueCapToken, confirmDangerOtp, clearDangerCaps, clearDangerCapsForSession } from '../../core/danger-ops.js'; // 危险操作二次认证（D1 持久化，跨实例一致，网安审计 N-02）+ capToken 清理
import { MSG } from '../../../shared/codes.js';
import { INVITE_GATE_ENABLED, LIMITS } from '../../../shared/config.js';
import { DEACTIVATED_USER_PREFIX } from '../../../shared/enums.js';
import {
  dbFindUserByUsername, dbCreateUser, dbFindValidInviteCode, dbUseInviteCode,
  dbGetUserById, dbDeactivateUser, dbPurgeUserOwnedData, dbUpdateUserAvatar, dbDeleteUser,
  dbUserLookupStmt, dbUsernameExistsStmt, dbUserPhoneHashStmt, dbUserEmailHashStmt,
} from '../../../../server/db.js';
// 凭证域：凭证更新独立环节 + 验证码咽喉 + 登录识别
import {
  updateUsernameCredential, getUsernameChangedAt,
  bindPhoneCredential, bindEmailCredential, dbPhoneTaken, dbEmailTaken,
  dbFindUserByPhoneHash, dbFindUserByEmailHash, dbGetMyCreds,
} from '../../core/credential.js';
import { requestOtp, verifyOtp, normalizeIdentifier, targetMask } from '../../core/otp.js';
import { logEvent } from '../../core/log.js';

export async function handleRegister(db, body, req) {
  const { username, password, role, inviteCode } = body;
  if (!username || username.length < LIMITS.USERNAME_MIN || username.length > LIMITS.USERNAME_MAX) return errorMsg('USERNAME_LENGTH');
  // 用户名字符集白名单（中文/字母/数字/_ . -），杜绝 control char / HTML 注入名进入全站 innerHTML
  if (!/^[\p{Script=Han}A-Za-z0-9_.\-]{3,30}$/u.test(username)) return errorMsg('USERNAME_INVALID');
  // 契约：禁止纯数字用户名（含 11 位手机形）——登录唯一输入框把纯数字识别为 phone，
  // 走 phone_hash 查不到 → 账户永久无法登录。存量由 initDb 的 _sufe 消毒迁移处理；新注册在此拦断。
  if (/^\d+$/.test(username)) return errorMsg('USERNAME_NEW_INVALID');
  // 预留注销墓碑前缀：禁止注册与「已注销用户#id」同前缀的用户名（防冒充注销账户）
  const tombPrefix = DEACTIVATED_USER_PREFIX;
  if (tombPrefix && username.startsWith(tombPrefix)) return errorMsg('USERNAME_INVALID');
  if (!password || password.length < LIMITS.PASSWORD_MIN || password.length > LIMITS.LOGIN_PASSWORD_MAX) return errorMsg('PASSWORD_LENGTH'); // 上限防 PBKDF2 CPU 放大（与登录同口径）
  if (!['student', 'teacher'].includes(role)) return errorMsg('INVALID_ROLE');
  // 注册必须同意用户协议与隐私政策（服务端强校验——前端勾选可被构造请求绕过，
  // 平台合规红线，不同意即拒绝注册，不建任何账户）
  const agreeAgreement = body.agreeAgreement === true || body.agreeAgreement === 1 || body.agreeAgreement === 'true';
  const agreePrivacy = body.agreePrivacy === true || body.agreePrivacy === 1 || body.agreePrivacy === 'true';
  if (!agreeAgreement || !agreePrivacy) return errorMsg('AGREE_REQUIRED', 400);

  // B1：限流（封禁查+写限流+注册限流）与用户名占用查同批一次往返（1 次 D1）；D1 异常由 fetch 层兜 500，不 fail-open
  const ip = req.headers.get('CF-Connecting-IP') || 'anon';
  const gate = authRateBatch(db, ip, 'register', [dbUsernameExistsStmt(db, username)]);
  const results = await db.batch(gate.stmts);
  if (gate.verdict(results)) { await authRateBlock(db, ip); return errorMsg('RATE_LIMITED', 429); }
  const takenRow = gate.extra(results)[0];
  if (takenRow && takenRow.results && takenRow.results.length) return errorMsg('USERNAME_TAKEN');

  // v1.0 R7：核心凭证 = 手机号/邮箱双联系方式，具备任一即可支持账户存在——
  // 注册必须绑定至少一个（验证码验证先行，防无效联系方式绑定）。
  // 验码先行与登录同口径：验证码错误统一文案（不泄露联系方式的绑定/占用状态）。
  const otpChannel = body.otpChannel === 'email' ? 'email' : 'sms';
  const contactRaw = String((otpChannel === 'email' ? body.email : body.phone) || '').trim();
  const otpCode = String(body.code || '').trim();
  if (!contactRaw || !otpCode) return errorMsg('REGISTER_CONTACT_REQUIRED');
  // 归一化与发码同口径（裸大陆号补 +86——验证码是发给归一化目标的，verifyOtp 必须同目标比对）
  const normContact = normalizeIdentifier(contactRaw);
  if (otpChannel === 'email' && (normContact.kind !== 'email' || normContact.target.length > LIMITS.EMAIL_MAX)) return errorMsg('EMAIL_INVALID');
  if (otpChannel === 'sms' && normContact.kind !== 'phone') return errorMsg('PHONE_INVALID');
  const contactTarget = normContact.target;
  // 验码先行（审查修正）：占用查若在验码之前，任意假码即可按 409/400 区分该联系方式是否已注册
  // （零成本枚举面）。验码通过后才查占用——只有持码者能触发 409，与登录验码先行的防枚举口径一致。
  const otpR = await verifyOtp(db, { channel: otpChannel, target: contactTarget, code: otpCode });
  if (otpR === 'exhausted') return errorMsg('OTP_EXHAUSTED', 400);
  if (otpR !== 'ok') return errorMsg('OTP_INVALID_OR_EXPIRED');
  // 占用查（验码已消费——同一目标注册+绑定竞态由 UNIQUE 索引兜底，见下方绑定回滚）
  const contactTaken = otpChannel === 'email' ? await dbEmailTaken(db, contactTarget) : await dbPhoneTaken(db, contactTarget);
  if (contactTaken) {
    if (otpChannel === 'email') return errorMsg('EMAIL_ALREADY_BOUND', 409);
    return errorMsg('PHONE_ALREADY_BOUND', 409);
  }

  // 教师邀请码门控：后端 INVITE_GATE_ENABLED 决定是否需要邀请码（当前 true = 启用）
  const needsInvite = role === 'teacher' && INVITE_GATE_ENABLED;
  if (needsInvite) {
    if (!inviteCode) return errorMsg('TEACHER_NEEDS_INVITE');
    const code = await dbFindValidInviteCode(db, inviteCode);
    if (!code) return errorMsg('INVITE_INVALID');
  }

  const { hash, salt } = await hashPassword(password);
  let userId;
  try {
    userId = await dbCreateUser(db, username, hash, salt, role);
  } catch (e) {
    // Q-2a-F1: check-then-act 窗口内并发双注册同用户名，INSERT 撞 UNIQUE——分流为
    // 业务冲突 400 USERNAME_TAKEN（errorMsg 默认 400），非冲突（D1 故障）上抛 500，不裸返 SERVER_ERROR。
    if (!isUniqueConflict(e)) throw e;
    return errorMsg('USERNAME_TAKEN');
  }
  // 注册即绑定核心凭证（手机号/邮箱至少其一；验证码已先行通过）。
  // 绑定失败（并发占用抢先 UNIQUE 索引拦截）= 账户已建凭证未绑，违反「注册必绑」契约——
  // 回滚刚建用户拒绝注册（同 invite 消费失败的回滚口径）。
  try {
    if (otpChannel === 'email') await bindEmailCredential(db, userId, contactTarget);
    else await bindPhoneCredential(db, userId, contactTarget);
  } catch (e) {
    // Z-1-F7 + Q-2a-F4（回滚重做修订）：绑定失败一律先回滚刚建用户（无论 UNIQUE 冲突还是
    // D1/crypto fail-closed 故障）——否则账户已建凭证未绑 = 孤儿账户。回滚后 UNIQUE（并发占用）
    // 分流 400；非冲突（真实故障）上抛 500 保留故障可见性。
    await dbDeleteUser(db, userId);
    if (!isUniqueConflict(e)) throw e;
    console.warn('注册绑定凭证失败（并发占用），已回滚账户:', e && e.message);
    return errorMsg('CONTACT_CONFLICT_RETRY', 409);
  }
  if (needsInvite) {
    // 原子消费（赢家模式）：并发双注册同码仅一方 changes>0；输家回滚刚建的用户拒绝注册
    const consumed = await dbUseInviteCode(db, inviteCode, userId);
    if (!consumed) {
      await dbDeleteUser(db, userId); // 回滚刚建的用户（数据层单点，路由不直写 SQL）
      return errorMsg('INVITE_INVALID', 409);
    }
  }
  const authToken = await issueAuthToken(db, userId, deviceLabelFromUA(req && req.headers.get('user-agent')), body.deviceId);
  await logEvent(db, { action: 'auth.register', actorUserId: userId, actorUsername: username,
    actorRole: role, entity: 'user', entityId: userId,
    detail: { role, via: needsInvite ? 'invite' : 'direct', contactChannel: otpChannel }, req });
  return json({ user: { id: userId, username, role, avatar: '' }, authToken, message: MSG.REGISTER_SUCCESS });
}

export async function handleLogin(db, body, req) {
  // 五合一登录：identifier = 用户名 / 手机号 / 邮箱（前端唯一输入框「请输入用户名/手机号/邮箱」）。
  // 兼容旧客户端 body.username（老字段仍读）；识别格式 → 按 username 直查 / phone_hash / email_hash 定位。
  const { password } = body;
  const identifier = String(body.identifier || body.username || '').trim();
  if (!identifier || !password) return errorMsg('LOGIN_REQUIRED');
  // 长度早退：超长串直接早退，避免无谓的哈希查库 / PBKDF2 消耗（文案不变，仍为「用户名或密码错误」）
  if (String(identifier).length > LIMITS.LOGIN_USERNAME_MAX || String(password).length > LIMITS.LOGIN_PASSWORD_MAX) return errorMsg('LOGIN_FAILED', 401);
  const { kind, target } = normalizeIdentifier(identifier);
  if (!kind || (kind === 'email' && String(target).length > LIMITS.EMAIL_MAX)) return errorMsg('LOGIN_FAILED', 401);

  // B1：限流（封禁查+写限流+登录限流）与取用户同批一次往返（登录 10 次 D1 → 此步 1 次）；D1 异常由 fetch 层兜 500
  const ip = req.headers.get('CF-Connecting-IP') || 'anon';
  const userStmt = kind === 'username' ? dbUserLookupStmt(db, target)
    : kind === 'phone' ? dbUserPhoneHashStmt(db, await tokenDigest(target))
    : dbUserEmailHashStmt(db, await tokenDigest(target));
  const gate = authRateBatch(db, ip, 'login', [userStmt]);
  const results = await db.batch(gate.stmts);
  if (gate.verdict(results)) { await authRateBlock(db, ip); return errorMsg('RATE_LIMITED', 429); }
  const userRow = gate.extra(results)[0];
  const user = userRow && userRow.results ? userRow.results[0] : null;

  if (!user) {
    await hashPassword(password); // 网安 N-18：哑 PBKDF2 抹平「用户名不存在」与「密码错误」的响应时序差
    await logEvent(db, { action: 'auth.login.failed', actorUsername: targetMask(target),
      entity: 'user', detail: { kind, identifier: targetMask(target) }, req });
    return errorMsg('LOGIN_FAILED', 401);
  }
  if (!(await verifyPassword(password, user.password_hash, user.salt))) {
    await logEvent(db, { action: 'auth.login.failed', actorUsername: targetMask(target),
      entity: 'user', detail: { kind, identifier: targetMask(target) }, req });
    return errorMsg('LOGIN_FAILED', 401);
  }
  // Z-1-F3：deactivated 检查提到 banned 之前——dbDeactivateUser 恒同步写 banned=1+deactivated=1，
  // 原顺序致 deactivated 分支不可达（注销用户误收 ACCOUNT_BANNED 与误记 auth.login.banned；
  // 承重面在验证码登录路径——密码路径因 dbDeactivateUser 清空 password_hash 先于 401 失败）
  if (user.deactivated) {
    await logEvent(db, { action: 'auth.login.deactivated', actorUserId: user.id, actorUsername: user.username,
      actorRole: user.role, entity: 'user', entityId: user.id, req }); // Z-1-F4：补留档（同 banned 口径）
    return errorMsg('ACCOUNT_DEACTIVATED', 403);
  }
  if (user.banned) {
    await logEvent(db, { action: 'auth.login.banned', actorUserId: user.id, actorUsername: user.username,
      actorRole: user.role, entity: 'user', entityId: user.id, req });
    return errorMsg('ACCOUNT_BANNED', 403);
  }
  const authToken = await issueAuthToken(db, user.id, deviceLabelFromUA(req && req.headers.get('user-agent')), body.deviceId);
  await logEvent(db, { action: 'auth.login.success', actorUserId: user.id, actorUsername: user.username,
    actorRole: user.role, entity: 'user', entityId: user.id, req });
  return json({ user: { id: user.id, username: user.username, role: user.role, avatar: user.avatar || '' }, authToken });
}

// 登录页账户实时探测：identifier = 用户名/手机号/邮箱。
// 识别格式 → 定位账户 → 返回 { exists, role, kind }；不存在 → { exists:false, kind }（前端红字「不存在的账户」）。
// 仅返回存在与否 + 角色，不暴露其他字段（手机号/邮箱经哈希列查询，探测不泄露绑定关系之外的任何信息）
export async function handleCheckUsername(db, url) {
  const identifier = (url.searchParams.get('identifier') || url.searchParams.get('username') || '').trim();
  if (!identifier) return json({ exists: false, kind: null });
  // Q-2a-F5: 超长 identifier 早退（对齐 handleLogin 的 LOGIN_USERNAME_MAX 钳制，防超大参数直打 D1）
  if (identifier.length > LIMITS.LOGIN_USERNAME_MAX) return json({ exists: false, kind: null });
  const { kind, target } = normalizeIdentifier(identifier);
  if (!kind) return json({ exists: false, kind: null });
  let user = null;
  if (kind === 'username') user = await dbFindUserByUsername(db, target);
  else if (kind === 'phone') user = await dbFindUserByPhoneHash(db, await tokenDigest(target));
  else user = await dbFindUserByEmailHash(db, await tokenDigest(target));
  return json(user ? { exists: true, role: user.role, kind } : { exists: false, kind });
}

// GET /api/users/:id —— 公开名片（个人信息右栏的兜底数据源）：仅用户名/角色/头像三件，
// 墓碑用户名原样返回（前端灰斜体渲染）；被封禁且未注销的账户视同不存在（不透露封禁态）
export async function handleGetUserPublic(db, userId) {
  const user = await dbGetUserById(db, userId);
  if (!user || (user.banned && !user.deactivated)) return errorMsg('USER_NOT_FOUND', 404);
  return json({ user: { id: user.id, username: user.username, role: user.role, avatar: user.avatar || '' } });
}

// POST /api/user/deactivate —— 注销账户：用户名墓碑化（「已注销用户#id」，后缀避 UNIQUE 冲突）+
// 凭证清空 + 单方关联数据全删（档案/通知/反馈/帖子/点赞/暂存附件）；需求/会话/合同/评价等
// 双方数据保留，JOIN username 处自然显示墓碑。危险操作二次认证 = 密码换 5 分钟一次性 capToken（danger-ops.issueCapToken）
export async function handleDeactivateAccount(db, body, req) {
  const { user: me, err } = await requireUser(db, req);
  if (err) return err;
  if (me.role === 'admin') return errorMsg('NO_PERMISSION', 403); // 管理员禁止注销，防管理面板孤岛化
  if (!(await confirmDangerOtp(db, req, body))) return errorMsg('REAUTH_FAILED', 403);
  const tombstone = `${DEACTIVATED_USER_PREFIX}#${me.id}`;
  await dbDeactivateUser(db, me.id, tombstone);
  await dbPurgeUserOwnedData(db, me.id, me.role); // 按角色清理单方数据 + 匿名化本人聊天正文
  // 合同正文一字不碰（签署后不可修改是合同的立身之本）——注销不改 contract_md，
  // 对端「一方已注销」tag 由前端 JOIN users 墓碑名自然呈现（合同是双方数据，对方本就知道本人用户名）
  await clearDangerCaps(db, me.id); // 注销即清全部 capToken（防 danger_caps 孤儿行残留）
  await logEvent(db, { action: 'user.deactivate', actorUserId: me.id, actorUsername: tombstone,
    actorRole: me.role, entity: 'user', entityId: me.id, req });
  return json({ ok: true });
}

// GET /api/auth/me —— 凭令牌取当前用户（刷新保活：前端持久化 token 后不再重放密码登录）
export async function handleAuthMe(db, req) {
  const me = await authUser(db, req); // authUser 的 SELECT 已含 avatar，无需二次查询
  if (!me) return errorMsg('LOGIN_REQUIRED', 401);
  return json({ user: { id: me.id, username: me.username, role: me.role, avatar: me.avatar || '' } });
}

// 账户设置：头像上传。前端已按居中最大内切圆裁成 160px dataURL，此处校验长度后落 users.avatar
export async function handleSaveAvatar(db, body, req) {
  const me = await authUser(db, req);
  if (!me) return errorMsg('LOGIN_REQUIRED', 401);
  const avatar = String(body.avatar || '');
  // svg 一律拒绝：矢量可内嵌脚本，渲染路径的图片统一只放行位图（长度上限单源 LIMITS.AVATAR_MAX_BYTES）
  // Q-2a-L1：MIME 判定大小写不敏感（Data:Image/SVG 大写变体绕过旧 startsWith 字面量比较）
  if (!/^data:image\//i.test(avatar) || /^data:image\/svg/i.test(avatar) || avatar.length > LIMITS.AVATAR_MAX_BYTES) return errorMsg('AVATAR_INVALID');
  await dbUpdateUserAvatar(db, me.id, avatar);
  await logEvent(db, { action: 'user.avatar.update', actorUserId: me.id, entity: 'user', entityId: me.id, req });
  return json({ ok: true });
}

// 账户设置 · 登录设备管理：列出本人全部会话（新→旧），逐条标注 current 供前端区分「当前设备」。
// 安全（网安报告 F-04）：只返回不可认证的 session_id + 设备标签 + 时间，token 永不进响应体
export async function handleListSessions(db, req) {
  const me = await authUser(db, req);
  if (!me) return errorMsg('LOGIN_REQUIRED', 401);
  const curRow = await getSessionByToken(db, me.id, req.headers.get('X-Auth-Token'));
  const currentId = curRow?.session_id || '';
  const sessions = await listSessions(db, me.id);
  // Q-2a-L4：库内 UTC 'YYYY-MM-DD HH:MM:SS' 不自描述时区，客户端裸 new Date() 会按本地解析（早 8 小时）——
  // 出口统一转 ISO-8601 带 Z（any consumer Date.parse/new Date 均为 UTC 瞬间）。created_at/expires_at 同转。
  const toIso = t => (t ? new Date(String(t).replace(' ', 'T') + 'Z').toISOString() : null);
  return json({ sessions: sessions.map(s => ({ session_id: s.session_id, label: s.label, created_at: toIso(s.created_at), expires_at: toIso(s.expires_at), current: s.session_id === currentId })) });
}

// 逐端退登：按 session_id 吊销本人名下指定会话；吊销的若是当前设备（踢自己），
// 前端据 revokedSelf 随后本地登出。安全：撤销接口收 session_id，服务端映射，token 不参与请求体
export async function handleRevokeSession(db, body, req) {
  const me = await authUser(db, req);
  if (!me) return errorMsg('LOGIN_REQUIRED', 401);
  const sessionId = String(body.sessionId || '');
  if (!sessionId) return errorMsg('INVALID_PARAMS');
  // 先反查当前设备 session_id（撤销前，勿删后再查）
  const curRow = await getSessionByToken(db, me.id, req.headers.get('X-Auth-Token'));
  const ok = await revokeSession(db, me.id, sessionId);
  if (!ok) return errorMsg('SESSION_NOT_FOUND', 404);
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
  if (!me) return errorMsg('LOGIN_REQUIRED', 401);
  const password = String((body && body.password) || '');
  if (!password || password.length > LIMITS.LOGIN_PASSWORD_MAX) return errorMsg('LOGIN_FAILED', 403); // 长度上限早退，防无谓 PBKDF2

  // B1：限流与取用户同批一次往返（原限流 5 次 D1 → 1 次）
  const ip = req.headers.get('CF-Connecting-IP') || 'anon';
  const gate = authRateBatch(db, ip, 'reauth', [dbUserLookupStmt(db, me.username)]);
  const results = await db.batch(gate.stmts);
  if (gate.verdict(results)) { await authRateBlock(db, ip); return errorMsg('RATE_LIMITED', 429); }
  const uRow = gate.extra(results)[0];
  const u = uRow && uRow.results ? uRow.results[0] : null;
  if (!u || !(await verifyPassword(password, u.password_hash, u.salt))) {
    await logEvent(db, { action: 'auth.reauth.failed', actorUserId: me.id, entity: 'user', entityId: me.id, req });
    return errorMsg('LOGIN_FAILED', 403);
  }
  const capToken = await issueCapToken(db, req);
  // capToken 落库失败返回空串（D1 异常）：空串会让下游危险操作恒 403「密码错误」且无观测信号——
  // 直接 500 并告警，不让用户陷入迷惑状态
  if (!capToken) {
    console.warn('handleReAuth: issueCapToken 返回空（D1 异常），拒绝下发');
    return errorMsg('SERVER_ERROR', 500);
  }
  await logEvent(db, { action: 'auth.reauth.success', actorUserId: me.id, entity: 'user', entityId: me.id, req });
  return json({ capToken });
}

// ============================================================
// 验证码 / 凭证扩展
// ============================================================
// 手机号脱敏展示（+8613812345678 → 138****5678）；非手机格式原样截断
function maskPhone(phone) {
  const s = String(phone || '');
  if (!s) return ''; // 未绑定：空串 → 前端回落「未绑定」占位（B5 修复：原空串被 slice 成 '***'）
  const m = s.match(/^(\+\d+)(\d{3})\d{4}(\d{4})$/);
  if (m) return `${m[2]}****${m[3]}`;
  return s.slice(0, 3) + '***';
}

// POST /api/auth/otp/request { channel, target } —— 请求验证码（登录/绑定共用；无需鉴权，限流兜底防骚扰）。
// 真实通道投递（v1.4.12：sms 走 push.spug.cc 短信、email 走邮件；绝不返回验证码明文，失败 500 由前端提示重试）。
export async function handleOtpRequest(db, body, req) {
  const channel = body.channel === 'email' ? 'email' : 'sms';
  const norm = normalizeIdentifier(String(body.target || '').trim());
  if (channel === 'sms' && norm.kind !== 'phone') return errorMsg('PHONE_INVALID');
  if (channel === 'email' && norm.kind !== 'email') return errorMsg('EMAIL_INVALID');
  // scene 白名单（邮件模板场景 ≤12 字、不含链接域名，防模板注入）：仅三种合法值，其余由 otp.js 兜底
  const SCENE_WHITELIST = ['登录验证', '绑定验证', '注册验证'];
  const sceneRaw = String(body.scene || '').trim().slice(0, 12);
  const scene = SCENE_WHITELIST.includes(sceneRaw) ? sceneRaw : '';
  const r = await requestOtp(db, { channel, target: norm.target, scene }, req);
  if (!r.ok) return r.err;
  return json({ ok: true });
}

// POST /api/auth/phone/bind { phone, code } —— 绑定手机号（requireUser + 验证码校验 + 占用查）
export async function handleBindPhone(db, body, req) {
  const { user: me, err } = await requireUser(db, req);
  if (err) return err;
  const norm = normalizeIdentifier(String(body.phone || '').trim());
  if (norm.kind !== 'phone') return errorMsg('PHONE_INVALID');
  if (!String(body.code || '').trim()) return errorMsg('OTP_REQUIRED');
  if (await dbPhoneTaken(db, norm.target)) return errorMsg('PHONE_ALREADY_BOUND', 409);
  const otpR = await verifyOtp(db, { channel: 'sms', target: norm.target, code: String(body.code).trim() });
  if (otpR === 'exhausted') return errorMsg('OTP_EXHAUSTED', 400, 'OTP_EXHAUSTED'); // 三振作废：必须重新发码（稳定 code 供前端分支）
  if (otpR !== 'ok') return errorMsg('OTP_INVALID_OR_EXPIRED');
  await bindPhoneCredential(db, me.id, norm.target); // 凭证更新独立环节（A4）：未来切手机号核心只改 credential.js
  await logEvent(db, { action: 'user.phone.bind', actorUserId: me.id, actorUsername: me.username,
    actorRole: me.role, entity: 'user', entityId: me.id, detail: { phone: maskPhone(norm.target) }, req });
  return json({ ok: true, message: MSG.BIND_SUCCESS, phone: maskPhone(norm.target) });
}

// POST /api/auth/email/bind { email, code } —— 绑定邮箱（同手机号，A6）
export async function handleBindEmail(db, body, req) {
  const { user: me, err } = await requireUser(db, req);
  if (err) return err;
  const norm = normalizeIdentifier(String(body.email || '').trim());
  if (norm.kind !== 'email') return errorMsg('EMAIL_INVALID');
  if (!String(body.code || '').trim()) return errorMsg('OTP_REQUIRED');
  if (await dbEmailTaken(db, norm.target)) return errorMsg('EMAIL_ALREADY_BOUND', 409);
  const otpR = await verifyOtp(db, { channel: 'email', target: norm.target, code: String(body.code).trim() });
  if (otpR === 'exhausted') return errorMsg('OTP_EXHAUSTED', 400, 'OTP_EXHAUSTED'); // 三振作废：必须重新发码（稳定 code 供前端分支）
  if (otpR !== 'ok') return errorMsg('OTP_INVALID_OR_EXPIRED');
  await bindEmailCredential(db, me.id, norm.target);
  await logEvent(db, { action: 'user.email.bind', actorUserId: me.id, actorUsername: me.username,
    actorRole: me.role, entity: 'user', entityId: me.id, detail: { email: targetMask(norm.target) }, req });
  return json({ ok: true, message: MSG.BIND_SUCCESS, email: targetMask(norm.target) });
}

// GET /api/user/username/status —— 用户名修改冷却状态（前端按钮倒计时/灰化依据）
export async function handleUsernameStatus(db, req) {
  const { user: me, err } = await requireUser(db, req);
  if (err) return err;
  const changedAt = await getUsernameChangedAt(db, me.id);
  let cooldownMs = 0;
  if (changedAt) {
    const t = Date.parse(String(changedAt).replace(' ', 'T') + 'Z');
    if (isFinite(t)) cooldownMs = Math.max(0, LIMITS.USERNAME_COOLDOWN_MS - (Date.now() - t));
  }
  return json({ canChange: cooldownMs <= 0, cooldownMs, changedAt: changedAt || '' });
}

// POST /api/user/username { newUsername, capToken } —— 修改用户名（A5）
// 危险操作二次认证（capToken）+ 7 天冷却 + 格式校验 + 占用查 → 凭证更新独立环节（A4）。
// 管理员用户名不动（防管理面板标识漂移）。修改成功后前端本地更新 + /api/auth/me 自然返回新名。
export async function handleChangeUsername(db, body, req) {
  const { user: me, err } = await requireUser(db, req);
  if (err) return err;
  if (me.role === 'admin') return errorMsg('NO_PERMISSION', 403);
  if (!(await confirmDangerOtp(db, req, body))) return errorMsg('REAUTH_FAILED', 403);
  const newName = String(body.newUsername || '').trim();
  if (newName.length < LIMITS.USERNAME_MIN || newName.length > LIMITS.USERNAME_MAX) return errorMsg('USERNAME_LENGTH');
  // 用户名规则：白名单字符 + 不含 @ + 非纯数字（登录唯一输入框按格式初判，纯数字/含@会歧义为手机号/邮箱）
  if (!/^[\p{Script=Han}A-Za-z0-9_.\-]+$/u.test(newName)) return errorMsg('USERNAME_NEW_INVALID');
  if (newName.includes('@') || /^\d+$/.test(newName)) return errorMsg('USERNAME_NEW_INVALID');
  const tombPrefix = DEACTIVATED_USER_PREFIX;
  if (tombPrefix && newName.startsWith(tombPrefix)) return errorMsg('USERNAME_NEW_INVALID');
  if (newName === me.username) return errorMsg('USERNAME_NEW_INVALID');
  const changedAt = await getUsernameChangedAt(db, me.id);
  if (changedAt) {
    const t = Date.parse(String(changedAt).replace(' ', 'T') + 'Z');
    if (isFinite(t) && Date.now() - t < LIMITS.USERNAME_COOLDOWN_MS) return errorMsg('USERNAME_COOLDOWN');
  }
  if (await dbFindUserByUsername(db, newName)) return errorMsg('USERNAME_TAKEN');
  await updateUsernameCredential(db, me.id, newName);
  await logEvent(db, { action: 'user.username.change', actorUserId: me.id, actorUsername: me.username,
    actorRole: me.role, entity: 'user', entityId: me.id, detail: { from: me.username, to: newName }, req });
  return json({ ok: true, message: MSG.USERNAME_CHANGED, username: newName });
}

// POST /api/auth/login/code { identifier, code } —— 验证码登录（A7：手机验证码/邮箱验证码两种通路）。
// identifier 仅接受手机号/邮箱（用户名无验证码通道）；命中账户 + verifyOtp 通过 → 签发登录令牌。
export async function handleLoginWithCode(db, body, req) {
  const identifier = String(body.identifier || body.username || '').trim();
  const code = String(body.code || '').trim();
  if (!identifier || !code) return errorMsg('LOGIN_REQUIRED');
  const { kind, target } = normalizeIdentifier(identifier);
  if (!kind || kind === 'username') return errorMsg('LOGIN_FAILED', 401);
  if (String(target).length > (kind === 'email' ? LIMITS.EMAIL_MAX : LIMITS.PHONE_MAX)) return errorMsg('LOGIN_FAILED', 401);
  const channel = kind === 'email' ? 'email' : 'sms';
  const ip = req.headers.get('CF-Connecting-IP') || 'anon';
  // B1：限流 + 取用户同批（复用 login 桶；hash 定位）
  const gate = authRateBatch(db, ip, 'login',
    [kind === 'phone' ? dbUserPhoneHashStmt(db, await tokenDigest(target)) : dbUserEmailHashStmt(db, await tokenDigest(target))]);
  const results = await db.batch(gate.stmts);
  if (gate.verdict(results)) { await authRateBlock(db, ip); return errorMsg('RATE_LIMITED', 429); }
  const userRow = gate.extra(results)[0];
  const user = userRow && userRow.results ? userRow.results[0] : null;
  // S2-2 防枚举（限流审计 FAIL-1）：验码先行、账户状态后置——requestOtp 不查存在性（任何目标都发码），
  // 不存在账户与验证码错误统一返回 OTP_INVALID_OR_EXPIRED（同 400 同文案），无码者四态不可区分
  // （与密码登录 LOGIN_FAILED 抹平姿态一致；banned/deactivated 仅在验码成功后才分支——只有持码者
  // 能触发，不构成存在性探测面）。
  const otpR = await verifyOtp(db, { channel, target, code });
  if (!user || otpR !== 'ok') {
    await logEvent(db, { action: 'auth.login.failed', actorUsername: targetMask(target),
      entity: 'user', detail: { via: 'code', kind, identifier: targetMask(target), reason: otpR }, req });
    // 三振作废 → 引导重新发码；其余（不存在账户/码错/过期）统一文案防枚举
    if (otpR === 'exhausted') return errorMsg('OTP_EXHAUSTED', 400, 'OTP_EXHAUSTED');
    return errorMsg('OTP_INVALID_OR_EXPIRED', 400);
  }
  // Z-1-F3/F4：与密码登录同口径——deactivated 先于 banned（dbDeactivateUser 恒同步写两者），
  // 两分支均补留档（auth.login.deactivated / auth.login.banned，对照 handleLogin 形状）
  if (user.deactivated) {
    await logEvent(db, { action: 'auth.login.deactivated', actorUserId: user.id, actorUsername: user.username,
      actorRole: user.role, entity: 'user', entityId: user.id, detail: { via: 'code', kind }, req });
    return errorMsg('ACCOUNT_DEACTIVATED', 403);
  }
  if (user.banned) {
    await logEvent(db, { action: 'auth.login.banned', actorUserId: user.id, actorUsername: user.username,
      actorRole: user.role, entity: 'user', entityId: user.id, detail: { via: 'code', kind }, req });
    return errorMsg('ACCOUNT_BANNED', 403);
  }
  const authToken = await issueAuthToken(db, user.id, deviceLabelFromUA(req && req.headers.get('user-agent')), body.deviceId);
  await logEvent(db, { action: 'auth.login.success', actorUserId: user.id, actorUsername: user.username,
    actorRole: user.role, entity: 'user', entityId: user.id, detail: { via: 'code', kind }, req });
  return json({ user: { id: user.id, username: user.username, role: user.role, avatar: user.avatar || '' }, authToken });
}

// GET /api/user/creds —— 本人已绑凭证（脱敏出口：手机号 138****5678、邮箱 a***@x.com）。
// 仅本人可读（requireUser）；设置页展示绑定状态用。明文凭证绝不进响应体
export async function handleGetMyCreds(db, req) {
  const { user: me, err } = await requireUser(db, req);
  if (err) return err;
  const creds = await dbGetMyCreds(db, me.id);
  return json({ phone: maskPhone(creds.phone), email: targetMask(creds.email) });
}

// POST /api/auth/check-invite —— 教师注册第一步「邀请码」服务端预校验（v1.2.0 T5：只验证不消费，
// 消费在注册时 dbUseInviteCode 赢家模式——并发双注册同码仅一方成功）
export async function handleCheckInvite(db, body) {
  const code = String((body && body.code) || '').trim();
  if (!code) return errorMsg('INVITE_INVALID');
  const found = await dbFindValidInviteCode(db, code);
  if (!found) return errorMsg('INVITE_INVALID');
  return json({ ok: true });
}

// ============================================================
// auth 域路由表（V-1-4c：app.js 只拼接各域 routes）
// ============================================================
const S = (method, path, handler) => ({ method, path, handler });
export const routes = [
  S('POST', '/api/auth/register', c => handleRegister(c.db, c.body, c.req)),
  S('POST', '/api/auth/login', c => handleLogin(c.db, c.body, c.req)),
  S('GET', '/api/auth/check', c => handleCheckUsername(c.db, c.url)),
  S('GET', '/api/auth/me', c => handleAuthMe(c.db, c.req)),
  S('POST', '/api/auth/re-auth', c => handleReAuth(c.db, c.body, c.req)),
  S('POST', '/api/auth/otp/request', c => handleOtpRequest(c.db, c.body, c.req)),
  S('POST', '/api/auth/phone/bind', c => handleBindPhone(c.db, c.body, c.req)),
  S('POST', '/api/auth/email/bind', c => handleBindEmail(c.db, c.body, c.req)),
  S('POST', '/api/auth/login/code', c => handleLoginWithCode(c.db, c.body, c.req)),
  S('POST', '/api/user/username', c => handleChangeUsername(c.db, c.body, c.req)),
  S('GET', '/api/user/username/status', c => handleUsernameStatus(c.db, c.req)),
  S('GET', '/api/user/creds', c => handleGetMyCreds(c.db, c.req)),
  S('POST', '/api/auth/check-invite', c => handleCheckInvite(c.db, c.body)),
  S('POST', '/api/auth/logout', c => handleLogout(c.db, c.req)),
  S('GET', '/api/auth/sessions', c => handleListSessions(c.db, c.req)),
  S('POST', '/api/auth/sessions/revoke', c => handleRevokeSession(c.db, c.body, c.req)),
  S('POST', '/api/user/avatar', c => handleSaveAvatar(c.db, c.body, c.req)),
  S('POST', '/api/user/deactivate', c => handleDeactivateAccount(c.db, c.body, c.req)),
  S('GET', '/api/users/:id', c => handleGetUserPublic(c.db, parseIdParam(c.params.id))),
];

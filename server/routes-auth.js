/**
 * 路由模块：认证（注册 / 登录）
 */
import { json, error, hashPassword, verifyPassword, MSG } from './core.js';
import { dbFindUserByUsername, dbCreateUser, dbFindValidInviteCode, dbUseInviteCode } from './db.js';

export async function handleRegister(db, body) {
  const { username, password, role, inviteCode } = body;
  if (!username || username.length < 3 || username.length > 30) return error(MSG.USERNAME_LENGTH);
  if (!password || password.length < 6) return error(MSG.PASSWORD_LENGTH);
  if (!['student', 'teacher'].includes(role)) return error(MSG.INVALID_ROLE);

  if (role === 'teacher') {
    if (!inviteCode) return error(MSG.TEACHER_NEEDS_INVITE);
    const code = await dbFindValidInviteCode(db, inviteCode);
    if (!code) return error(MSG.INVITE_INVALID);

    if (await dbFindUserByUsername(db, username)) return error(MSG.USERNAME_TAKEN);

    const { hash, salt } = await hashPassword(password);
    const userId = await dbCreateUser(db, username, hash, salt, role);
    await dbUseInviteCode(db, inviteCode, userId);
    return json({ user: { id: userId, username, role }, message: MSG.REGISTER_SUCCESS });
  }

  if (await dbFindUserByUsername(db, username)) return error(MSG.USERNAME_TAKEN);

  const { hash, salt } = await hashPassword(password);
  const userId = await dbCreateUser(db, username, hash, salt, role);
  return json({ user: { id: userId, username, role }, message: MSG.REGISTER_SUCCESS });
}

export async function handleLogin(db, body) {
  const { username, password } = body;
  if (!username || !password) return error(MSG.LOGIN_REQUIRED);

  const user = await dbFindUserByUsername(db, username);
  if (!user || !(await verifyPassword(password, user.password_hash, user.salt))) {
    return error(MSG.LOGIN_FAILED, 401);
  }
  if (user.banned) return error(MSG.ACCOUNT_BANNED, 403);
  return json({ user: { id: user.id, username: user.username, role: user.role } });
}

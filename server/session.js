/**
 * 账户凭证管理层（目标分层：账户凭证管理）—— 登录会话 单点
 *
 * 收敛自：server/core.js 的 issueAuthToken / listSessions / revokeSession，
 * 并补 getSessionByToken / revokeToken 两个助手（routes-auth 三处内联反查收敛于此）。
 *
 * 令牌契约（网安报告 F-04）：
 *   - 登录/注册签发 48 位随机 hex 明文令牌回传请求头，库内只存 SHA-256 摘要（tokenDigest）。
 *   - 多端会话：每次登录写一行 auth_sessions（旧设备不被顶下线，账户设置可逐端退登）。
 *   - session_id 独立随机 id，对外设备管理唯一标识；token 永不进响应体。
 *   - 签发前清该用户过期会话（purgeExpiredSessions），会话表天然不膨胀。
 *
 * 危险操作二次认证（capToken）已迁独立模块 server/danger-ops.js（D1 持久化、会话绑定、
 * 命中即删——跨 Cloudflare 多 isolate 全局一致；原 per-isolate 内存 Map 在分布式下会
 * 间歇性失效，网安审计 N-02）。
 */
import { dbAll, dbGet, dbRun } from './util.js';
import { bufToHex, tokenDigest } from './crypto.js';
import { SECURITY } from './constants.js';

// ============================================================
// 会话签发 / 吊销
// ============================================================
/** 签发前清理该用户全部过期会话（幂等；issueAuthToken 隐式调用，调用方无需关心） */
export async function purgeExpiredSessions(db, userId) {
  await dbRun(db, `DELETE FROM auth_sessions WHERE user_id=? AND expires_at < datetime('now')`, [userId]);
}

/**
 * 签发登录令牌（多端会话）：
 * @param userId 用户 id
 * @param label  设备标签（deviceLabelFromUA 产物，账户设置展示）
 * @returns 明文令牌（仅此一处回传；库内只存摘要）
 */
export async function issueAuthToken(db, userId, label) {
  const token = bufToHex(crypto.getRandomValues(new Uint8Array(24)));
  const sessionId = bufToHex(crypto.getRandomValues(new Uint8Array(16)));
  const expires = new Date(Date.now() + SECURITY.TOKEN_TTL_MS).toISOString().slice(0, 19).replace('T', ' ');
  await purgeExpiredSessions(db, userId);
  await dbRun(db, 'INSERT INTO auth_sessions (token_hash, session_id, user_id, label, expires_at) VALUES (?,?,?,?,?)',
    [await tokenDigest(token), sessionId, userId, label || '', expires]);
  return token;
}

/** 按令牌反查本人会话（routes-auth 三处内联反查收敛点）；无则 undefined */
export async function getSessionByToken(db, userId, token) {
  if (!token) return undefined;
  return await dbGet(db, 'SELECT session_id FROM auth_sessions WHERE user_id=? AND token_hash=?', [userId, await tokenDigest(token)]);
}

/** 按令牌吊销本人当前会话（真登出）；返回是否命中 */
export async function revokeToken(db, userId, token) {
  if (!token) return false;
  const r = await dbRun(db, 'DELETE FROM auth_sessions WHERE user_id=? AND token_hash=?', [userId, await tokenDigest(token)]);
  return !!(r && r.meta && r.meta.changes > 0);
}

/** 列出本人全部会话（新→旧）；绝不返回 token，仅 session_id 供设备管理展示 */
export async function listSessions(db, userId) {
  return await dbAll(db, 'SELECT session_id, label, created_at, expires_at FROM auth_sessions WHERE user_id=? ORDER BY created_at DESC', [userId]);
}

/** 按 session_id 吊销指定会话；返回是否命中（归属由调用方已校验） */
export async function revokeSession(db, userId, sessionId) {
  const r = await dbRun(db, 'DELETE FROM auth_sessions WHERE user_id=? AND session_id=?', [userId, sessionId]);
  return !!(r && r.meta && r.meta.changes > 0);
}

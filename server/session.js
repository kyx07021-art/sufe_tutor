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
import { dbAll, dbGet, dbRun, toDbTime } from './util.js';
import { bufToHex, tokenDigest } from './crypto.js';
import { SECURITY } from './constants.js';

// ============================================================
// 会话签发 / 吊销
// ============================================================
/**
 * 签发登录令牌（多端会话）：
 * @param userId   用户 id
 * @param label    设备标签（deviceLabelFromUA 产物，账户设置展示）
 * @param deviceId 浏览器档案持久 id（前端 localStorage 生成；'' = 老客户端/脚本无标识）
 * @returns 明文令牌（仅此一处回传；库内只存摘要）
 * B3：清该用户过期会话 + 写入新会话 一次 db.batch（1 次往返；原子）
 *
 * v0.25.11 设备去重（用户反馈「一堆 Edge 登录记录」根因修复）：
 *   原来「设备」=「登录事件」——每次登录（新窗口/新标签/重登）都插一行，账户设置里堆成山。
 *   现在「设备」=「浏览器档案」：带合法 deviceId 时按 (user_id, device_id) UPSERT 复用同一行——
 *   session_id 稳定、token_hash/label/expires_at 刷新。同一浏览器反复登录只占一行；
 *   无痕/不同浏览器档案/手机各自一行。无 deviceId 回落旧 INSERT（device_id=''，部分唯一索引不约束）。
 *   语义：一个设备一个活跃会话——同设备重登会顶掉旧令牌（另一窗口旧会话收到 401 重登，符合「设备管理」心智）。
 */
export async function issueAuthToken(db, userId, label, deviceId) {
  const token = bufToHex(crypto.getRandomValues(new Uint8Array(24)));
  const sessionId = bufToHex(crypto.getRandomValues(new Uint8Array(16)));
  const expires = toDbTime(new Date(Date.now() + SECURITY.TOKEN_TTL_MS));
  const digest = await tokenDigest(token);
  const dev = typeof deviceId === 'string' && /^[0-9a-f]{32}$/.test(deviceId) ? deviceId : '';
  const stmts = [
    db.prepare(`DELETE FROM auth_sessions WHERE user_id=? AND expires_at < datetime('now')`).bind(userId),
  ];
  if (dev) {
    stmts.push(db.prepare(`INSERT INTO auth_sessions (token_hash, session_id, user_id, label, device_id, expires_at)
      VALUES (?,?,?,?,?,?)
      ON CONFLICT(user_id, device_id) WHERE device_id != '' DO UPDATE SET
        token_hash=excluded.token_hash, label=excluded.label, expires_at=excluded.expires_at`)
      .bind(digest, sessionId, userId, label || '', dev, expires));
  } else {
    stmts.push(db.prepare('INSERT INTO auth_sessions (token_hash, session_id, user_id, label, expires_at) VALUES (?,?,?,?,?)')
      .bind(digest, sessionId, userId, label || '', expires));
  }
  await db.batch(stmts);
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

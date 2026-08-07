/**
 * 危险操作凭证咽喉（独立模块，目标分层：账户凭证管理 / 危险操作二次认证）
 *
 * 背景（网安审计 N-02）：v0.21 前 capToken 存 per-isolate 内存 Map（session.js CAPS），
 * Cloudflare Worker 多 isolate 分发下，re-auth 签发 capToken 与危险操作请求可能落在
 * 不同 isolate——后者查不到内存 Map 中的 capToken → 校验失败 → 合法用户注销/签约/撤销
 * 间歇性 403「密码错误」。这是「per-isolate 内存状态不具全局一致性」的典型。
 *
 * 方案：capToken 迁 D1 持久化（danger_caps 表），跨实例全局一致：
 *   - 签发：INSERT ... ON CONFLICT(user_id, session_id) UPSERT，每用户每会话仅一枚，
 *           落 SHA-256 摘要（tokenDigest），明文 token 仅在签发时回传一次（F-04 同款口径）
 *   - 校验：原子 DELETE WHERE user_id=? AND session_id=? AND token_hash=? AND expires_at > now，
 *           changes>0 即通过——命中即删（一次性），无论成败 capToken 随即失效（与内存版语义一致）
 *   - 会话绑定：capToken 与签发时的 session_id 绑定，杜绝同用户任意设备在 5 分钟内复用
 *   - 惰性清理：签发前清该用户过期行，表以 (user_id, session_id) 为主键天然不膨胀
 *
 * 依赖方向：security（authUser）/ session（getSessionByToken）/ crypto（tokenDigest）/
 *          util（dbRun/dbGet）/ constants（SECURITY.ONE_TIME_TTL_MS）。
 * 不依赖 db.js，无循环。
 */
import { dbRun, dbGet } from './util.js';
import { authUser } from './security.js';
import { getSessionByToken } from './session.js';
import { bufToHex, tokenDigest } from './crypto.js';
import { SECURITY } from './constants.js';

/** 建表（幂等；initDb 调一次） */
export async function initDangerCaps(db) {
  await dbRun(db, `CREATE TABLE IF NOT EXISTS danger_caps (
    user_id INTEGER NOT NULL,
    session_id TEXT NOT NULL,
    token_hash TEXT NOT NULL,
    expires_at DATETIME NOT NULL,
    PRIMARY KEY (user_id, session_id))`);
}

/** 从请求令牌反查当前会话 id（签发与校验共用；无令牌/会话失效返回 null） */
async function currentSessionId(db, req) {
  const token = req && req.headers && req.headers.get('X-Auth-Token');
  if (!token) return null;
  const me = await authUser(db, req);
  if (!me) return null;
  const row = await getSessionByToken(db, me.id, token);
  return row ? row.session_id : null;
}

/**
 * 签发一次性 capToken（危险操作二次认证）：re-auth 校验密码通过后调用。
 * 5 分钟 TTL（constants.SECURITY.ONE_TIME_TTL_MS）、每用户每会话一枚、落 D1 摘要。
 * @param db  D1
 * @param req Request（取 X-Auth-Token 反查会话）
 * @returns 明文 capToken（仅此一处回传）
 */
export async function issueCapToken(db, req) {
  const userId = (await authUser(db, req))?.id;
  const sessionId = await currentSessionId(db, req);
  if (!userId || !sessionId) return '';
  // 惰性清理：清该用户已过期行，表不膨胀
  await dbRun(db, `DELETE FROM danger_caps WHERE user_id=? AND expires_at <= datetime('now','localtime')`, [userId]).catch(() => {});
  const token = bufToHex(crypto.getRandomValues(new Uint8Array(16)));
  const exp = new Date(Date.now() + SECURITY.ONE_TIME_TTL_MS).toISOString().slice(0, 19).replace('T', ' ');
  await dbRun(db, `INSERT INTO danger_caps (user_id, session_id, token_hash, expires_at) VALUES (?,?,?,?)
    ON CONFLICT(user_id, session_id) DO UPDATE SET token_hash=excluded.token_hash, expires_at=excluded.expires_at`,
    [userId, sessionId, await tokenDigest(token), exp]).catch(() => {});
  return token;
}

/**
 * 校验一次性 capToken：原子 DELETE 赢家模式，命中即删（一次性；失败同样失效）。
 * 会话绑定：capToken 与签发时 session_id 绑定，仅签发会话可用（杜绝同用户其他设备复用）。
 * 密码错/凭据缺失绝不返 401（前端对 401 统一踢登录页），统一由调用方返 403。
 * @param db  D1
 * @param req Request（取 X-Auth-Token 反查会话）
 * @param body 请求体（含 capToken）
 * @returns 是否通过
 */
export async function confirmDangerOtp(db, req, body) {
  const sessionId = await currentSessionId(db, req);
  const got = String((body && body.capToken) || '');
  if (!sessionId || !got) return false;
  // session_id 全局唯一（无需再匹配 user_id）；token 只存摘要比对；过期行不命中
  const r = await dbRun(db,
    `DELETE FROM danger_caps WHERE session_id=? AND token_hash=? AND expires_at > datetime('now','localtime')`,
    [sessionId, await tokenDigest(got)]).catch(() => ({ meta: { changes: 0 } }));
  return !!(r && r.meta && r.meta.changes > 0);
}

/** 清理用户全部 capToken（注销账户时调用，防孤儿残留行；最佳努力，失败不阻断注销） */
export async function clearDangerCaps(db, userId) {
  if (!userId) return;
  await dbRun(db, 'DELETE FROM danger_caps WHERE user_id=?', [userId]).catch(() => {});
}

/** 清理指定会话的 capToken（退出登录/逐端退登时调用；会话已吊销则校验恒败，行属孤儿） */
export async function clearDangerCapsForSession(db, userId, sessionId) {
  if (!userId || !sessionId) return;
  await dbRun(db, 'DELETE FROM danger_caps WHERE user_id=? AND session_id=?', [userId, sessionId]).catch(() => {});
}

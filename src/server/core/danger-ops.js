/**
 * 危险操作凭证咽喉（独立模块，目标分层：账户凭证管理 / 危险操作二次认证）
 *
 * 契约：capToken 必须 D1 持久化（danger_caps 表）——per-isolate 内存 Map 在多 isolate 分发下
 * 「此实例签发、彼实例校验」必失败，合法用户危险操作间歇性 403。方案：
 *   - 签发：INSERT ... ON CONFLICT(user_id, session_id) UPSERT，每用户每会话仅一枚，
 *           落 SHA-256 摘要（tokenDigest），明文 token 仅在签发时回传一次（F-04 同款口径）
 *   - 校验：原子 DELETE WHERE session_id=? AND token_hash=? AND expires_at > now，
 *           changes>0 即通过——命中即删（一次性）；session_id 全局唯一（32 位随机 hex），
 *           无需再带 user_id；错 token 的 DELETE 命中 0 行（不删任何有效行，仅自身失效）
 *   - 会话绑定：capToken 与签发时的 session_id 绑定，杜绝同用户任意设备在 5 分钟内复用
 *   - 惰性清理：签发前清该用户过期行，表以 (user_id, session_id) 为主键天然不膨胀
 *
 * 依赖方向：security（authUser）/ session（getSessionByToken）/ crypto（tokenDigest）/
 *          util（dbRun/dbGet）/ constants（SECURITY.ONE_TIME_TTL_MS）。
 * 不依赖 db.js，无循环。
 */
import { dbRun, dbGet, toDbTime } from './util.js';
import { authUser } from './security.js';
import { getSessionByToken } from './session.js';
import { bufToHex, tokenDigest } from './crypto.js';
import { SECURITY } from '../../../server/constants.js';

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
  // 惰性清理：清该用户已过期行，表不膨胀。expires_at 经 toDbTime 落 UTC——SQL 比较必须传 UTC
  // 参数（datetime('now','localtime') 是库内本地时区，非 UTC 时区环境会恒判过期/永不过期）
  const nowUtc = toDbTime(new Date());
  await dbRun(db, `DELETE FROM danger_caps WHERE user_id=? AND expires_at <= ?`, [userId, nowUtc]).catch(() => {});
  const token = bufToHex(crypto.getRandomValues(new Uint8Array(SECURITY.CAP_TOKEN_BYTES)));
  const exp = toDbTime(new Date(Date.now() + SECURITY.ONE_TIME_TTL_MS));
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
  // session_id 全局唯一（无需再匹配 user_id）；token 只存摘要比对；过期行不命中。
  // expires_at 为 UTC 存储域，SQL 比较传 UTC 参数（同上方惰性清理，见注释）
  const nowUtc = toDbTime(new Date());
  const r = await dbRun(db,
    `DELETE FROM danger_caps WHERE session_id=? AND token_hash=? AND expires_at > ?`,
    [sessionId, await tokenDigest(got), nowUtc]).catch(() => ({ meta: { changes: 0 } }));
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

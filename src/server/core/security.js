/**
 * 网安咽喉（目标分层：网安咽喉）—— 身份解析 / 权限守卫 / 限流 / CORS / 安全响应头 单点
 *
 * 收敛自：server/core.js 的身份部分（authUser/requireAdminOrError）+ _worker.js 的
 * 限流（rateGate 及内存/D1 双写）、CORS 预检、安全响应头。
 *
 * 守卫用法（替代散落各路由的 45 处内联样板）：
 *   const { user: me, err } = await requireUser(db, req, 'student'); if (err) return err;
 *   const { admin, err } = await requireAdmin(db, req);             if (err) return err;
 *
 * 限流双路径（同一 RATE_LIMITS 配置）：
 *   - 高频键（全局/写/探测，每请求必查）留内存 per-isolate best-effort——实例重启即清零自愈；
 *   - 低频危险键（登录/注册/重认证/三振/封禁）落 D1 rate_limits 表，跨实例生效、重启不清零。
 *   - 三振窗口语义内存与 D1 一致（strike.windowMs 内满 strike.count 次 → 封 block.windowMs）。
 */
import { dbGet, dbRun, errorMsg } from './util.js';
import { tokenDigest } from './crypto.js';
import { MSG } from '../../shared/codes.js';
import { RATE_LIMITS, SECURITY, SECURITY_HEADERS, CORS_HEADERS } from '../../shared/config.js';

// ============================================================
// 身份解析：全站一律凭 X-Auth-Token（登录签发，TTL 见 constants.SECURITY.TOKEN_TTL_MS，
// 过期按 UTC 比较——同全站 datetime 纪律）。body/query 里的 userId 只当前端回显用，
// 服务端身份认定永远以令牌解出的用户为准（审计整改：自报 userId 可枚举冒名）
// ============================================================
// 请求级 auth 记忆化——同一请求内二次鉴权（logRequest 记 actor、
// /api/batch 批量子请求并发）零额外 D1。WeakMap 键 req，请求结束即 GC，跨请求零泄漏；
// 并发调用共享同一 Promise（batch 子请求并发不重复查）。安全：同请求令牌恒定（headers 不可变），
// 记忆化无陈旧风险。不做跨请求会话缓存（登出/封禁即时失效 + 跨 isolate 无法全局失效，安全账不划算，
// 见 docs/network-layer-redesign.md 有意不做清单）。
const authMemo = new WeakMap();
export async function authUser(db, req) {
  const token = req && req.headers && req.headers.get('X-Auth-Token');
  if (!token) return null;
  if (authMemo.has(req)) return authMemo.get(req);
  const p = (async () => {
    const u = await dbGet(db, `SELECT u.id,u.username,u.role,u.avatar,u.banned,s.expires_at AS token_expires
      FROM auth_sessions s JOIN users u ON u.id=s.user_id WHERE s.token_hash=?`, [await tokenDigest(token)]);
    if (!u || u.banned) return null;
    const exp = Date.parse(String(u.token_expires || '').replace(' ', 'T') + 'Z');
    if (!exp || exp < Date.now()) return null;
    return u;
  })();
  authMemo.set(req, p);
  return p;
}

/** 管理员判定两行式合一：非管理员（含无令牌/令牌失效）→ 403 响应；通过 → null */
export function requireAdminOrError(user) {
  return user && user.role === 'admin' ? null : errorMsg('ADMIN_ONLY', 403);
}

/**
 * 组合式守卫：解析令牌用户 → 可选角色门 → 返回 { user } 或 { err }。
 * @param db   D1 绑定
 * @param req  Request（取 X-Auth-Token 头）
 * @param role 可选 'student' | 'teacher' | 'admin'；指定时角色不符返回对应 403
 */
export async function requireUser(db, req, role) {
  const user = await authUser(db, req);
  if (!user) return { err: errorMsg('LOGIN_REQUIRED', 401) };
  if (role && user.role !== role) {
    const key = role === 'admin' ? 'ADMIN_ONLY' : role === 'student' ? 'STUDENT_ONLY' : 'TEACHER_ONLY';
    return { err: errorMsg(key, 403) };
  }
  return { user };
}

/** 管理员组合式守卫：返回 { admin } 或 { err }（requireUser 的 role='admin' 别名） */
export async function requireAdmin(db, req) {
  const { user: admin, err } = await requireUser(db, req, 'admin');
  return { admin, err };
}

// ============================================================
// 限流（网安报告 F-09：内存 Map 单实例化 → 混合持久化）
// ============================================================
const RL = { hits: new Map(), strikes: new Map(), blocked: new Map() };

const rlSweep = now => {
  if (RL.hits.size < RATE_LIMITS.sweepSize) return;
  for (const [k, v] of RL.hits) if (v.reset < now) RL.hits.delete(k);
  for (const [k, until] of RL.blocked) if (until < now) RL.blocked.delete(k);
};

// 内存命中计数：窗口内 +1，返回是否未超限
const rlBump = (key, limit, windowMs, now) => {
  let e = RL.hits.get(key);
  if (!e || e.reset < now) { e = { n: 0, reset: now + windowMs }; RL.hits.set(key, e); }
  return ++e.n <= limit;
};

// 内存三振（与 D1 rlStrikeD1 同窗口语义：strike.windowMs 内满 strike.count 次 → 封 block.windowMs）
const rlStrike = (ip, now) => {
  let s = RL.strikes.get(ip);
  if (!s || s.reset < now) s = { n: 0, reset: now + RATE_LIMITS.strike.windowMs };
  s.n += 1;
  if (s.n >= RATE_LIMITS.strike.count) {
    RL.blocked.set(ip, now + RATE_LIMITS.block.windowMs);
    RL.strikes.delete(ip);
  } else {
    RL.strikes.set(ip, s);
  }
};

// 双写限流：内存 + D1 各自独立计数，两者都放行才算过。
//  - D1 失败（写/读抛错）→ 只以内存为准（降级不 fail-open，网安 N-06）
//  - 写/用户名探测/登录/注册/重认证全部双写 → 跨实例生效（网安 N-08）
// upsert + 回读合成单次 db.batch（写路径 2 D1 → 1 D1；与 authRateBatch 同款 batch 形状，
// r[1].results[0].n 判读同 verdict 口径）
const rlDual = async (db, memLimit, memWindow, d1Key, d1Limit, d1Window, now) => {
  if (!rlBump(`m:${d1Key}`, memLimit, memWindow, now)) return false;
  try {
    const r = await db.batch([
      db.prepare(RATE_UPSERT_SQL).bind(d1Key, rateWindowArg(d1Window)),
      db.prepare('SELECT n FROM rate_limits WHERE bucket=?').bind(d1Key),
    ]);
    const row = r && r[1] && r[1].results && r[1].results[0];
    if (!row || row.n > d1Limit) return false;
  } catch { /* D1 异常：内存限流兜底（上方 rlBump 已判定），不 fail-open */ }
  return true;
};

// rate_limits 过期行清理节流（每分钟至多一次；N-07 桶已按 IP 上界，清理仅兜底）
let lastRateCleanup = 0;
const maybeCleanRateLimits = async (db, now) => {
  if (now - lastRateCleanup < SECURITY.RATE_CLEANUP_THROTTLE_MS) return;
  lastRateCleanup = now;
  await dbRun(db, "DELETE FROM rate_limits WHERE reset_at < datetime('now','localtime', ?)", [SECURITY.RATE_ROW_RETENTION]).catch(() => {});
};

// D1 三振封禁（跨实例持久）：strike.windowMs 窗口计数，满 strike.count 次写 block 行。
// D1 异常不阻断请求（内存三振已生效），网安 N-06 同口径。
// 本函数只被 authRateBlock 调用（认证路径的 block 行由 authRateBatch 读取 → 跨实例生效）；
// rateGate 的非认证路径三振走纯内存（热路径零 D1 往返，非认证写面已有 rlDual 的 D1 写限流兜底，
// 跨实例硬封禁仅认证路径需要）。
// rate_limits 条件 upsert 单点：rlDual / rlStrikeD1 / authRateBatch.rateUpsert 三处同 SQL + '+N seconds' 换算收敛
const RATE_UPSERT_SQL = `INSERT INTO rate_limits (bucket, n, reset_at) VALUES (?, 1, datetime('now','localtime', ?))
    ON CONFLICT(bucket) DO UPDATE SET
      n = CASE WHEN rate_limits.reset_at > datetime('now','localtime') THEN rate_limits.n + 1 ELSE 1 END,
      reset_at = CASE WHEN rate_limits.reset_at > datetime('now','localtime') THEN rate_limits.reset_at ELSE excluded.reset_at END`;
const rateWindowArg = windowMs => '+' + Math.round(windowMs / 1000) + ' seconds';

const rlStrikeD1 = async (db, ip) => {
  try {
    const b = rateWindowArg(RATE_LIMITS.block.windowMs);
    await dbRun(db, RATE_UPSERT_SQL, [`strike:${ip}`, rateWindowArg(RATE_LIMITS.strike.windowMs)]);
    const st = await dbGet(db, 'SELECT n FROM rate_limits WHERE bucket=?', [`strike:${ip}`]);
    if (st && st.n >= RATE_LIMITS.strike.count) {
      await dbRun(db, "INSERT OR REPLACE INTO rate_limits (bucket, n, reset_at) VALUES (?, 1, datetime('now','localtime', ?))", [`block:${ip}`, b]);
      await dbRun(db, 'DELETE FROM rate_limits WHERE bucket=?', [`strike:${ip}`]);
    }
  } catch { /* 内存三振已生效；D1 失败不阻断 */ }
};

/**
 * 限流闸门（_worker 每请求调用；超限一律 429，细节不回显）。
 * 全局限流走内存（最热路径零额外延迟）；写/用户名探测走内存+D1 双写（跨实例生效、D1 失败降级内存）。
 * 认证路由（login/register/reauth）的写+认证限流已下沉到路由内 authRateBatch（与取数同批 1 次往返），
 * 此处只留全局内存闸（B1：把登录路径的 D1 往返从 5 次砍到路由批内的 1 次）。
 * 登录桶按 IP 计数（网安 N-07：原按 IP+用户名，攻击者随机用户名可无限建桶撑爆 rate_limits）。
 * 用户名探测为软限制，不记三振。
 */
export async function rateGate(ip, p, method, body, now, db) { // body 参数预留（限流策略升级用），当前未消费
  rlSweep(now);
  await maybeCleanRateLimits(db, now);
  if ((RL.blocked.get(ip) || 0) > now) return false;
  if (!rlBump(`g:${ip}`, RATE_LIMITS.global.limit, RATE_LIMITS.global.windowMs, now)) { rlStrike(ip, now); return false; } // 非认证路径内存三振（D1 行无人读，不写）
  if (p === '/api/auth/login' || p === '/api/auth/register' || p === '/api/auth/re-auth') return true; // 认证限流由路由批承担
  if (method !== 'GET' && p.startsWith('/api/')) {
    if (!(await rlDual(db, RATE_LIMITS.write.limit, RATE_LIMITS.write.windowMs, `w:${ip}`, RATE_LIMITS.write.limit, RATE_LIMITS.write.windowMs, now))) { rlStrike(ip, now); return false; } // 同上：内存三振即可
  }
  if (p === '/api/auth/check' && !(await rlDual(db, RATE_LIMITS.check.limit, RATE_LIMITS.check.windowMs, `c:${ip}`, RATE_LIMITS.check.limit, RATE_LIMITS.check.windowMs, now))) return false;
  return true;
}

// ============================================================
// 认证路由组合限流（B1）：封禁查 + 写限流 + 认证限流 + 调用方附加查询 一次 db.batch（1 次往返）。
// 用法：const gate = authRateBatch(db, ip, 'login', [extraStmt]);
//      let r; try { r = await db.batch(gate.stmts); } catch { return 429; }  // D1 异常保守拒绝
//      if (gate.verdict(r)) { await authRateBlock(db, ip); return 429; }
//      const extra = gate.extra(r);  // 附加查询结果（第 0 项对应 extraStmts[0]）
// ============================================================
const AUTH_LIMIT_KEYS = { login: 'l', register: 'r', reauth: 'ra' };
const rateUpsert = (db, key, windowMs) =>
  db.prepare(RATE_UPSERT_SQL).bind(key, rateWindowArg(windowMs));

export function authRateBatch(db, ip, kind, extraStmts = []) {
  const cfg = RATE_LIMITS[kind];
  const authKey = `${AUTH_LIMIT_KEYS[kind]}:${ip}`;
  const base = 5; // [block, wUp, wSel, aUp, aSel] 五个基础语句索引
  return {
    stmts: [
      db.prepare("SELECT 1 AS b FROM rate_limits WHERE bucket=? AND reset_at > datetime('now','localtime')").bind(`block:${ip}`),
      rateUpsert(db, `w:${ip}`, RATE_LIMITS.write.windowMs),
      db.prepare('SELECT n FROM rate_limits WHERE bucket=?').bind(`w:${ip}`),
      rateUpsert(db, authKey, cfg.windowMs),
      db.prepare('SELECT n FROM rate_limits WHERE bucket=?').bind(authKey),
      ...extraStmts,
    ],
    verdict(results) {
      const blk = results[0] && results[0].results && results[0].results.length ? 1 : 0;
      const wN = results[2] && results[2].results && results[2].results[0] ? results[2].results[0].n : 0;
      const aN = results[4] && results[4].results && results[4].results[0] ? results[4].results[0].n : 0;
      return blk || wN > RATE_LIMITS.write.limit || aN > cfg.limit;
    },
    extra(results) { return results.slice(base); },
  };
}

/** 认证限流超限的三振封禁（内存 + D1 跨实例，同 rateGate 的 global/write 路径） */
export async function authRateBlock(db, ip) {
  rlStrike(ip, Date.now());
  await rlStrikeD1(db, ip);
}

// ============================================================
// CORS 预检 + 安全响应头
// ============================================================
/** CORS 预检响应（头单源自 constants.CORS_HEADERS） */
export function corsPreflight() {
  return new Response(null, { headers: CORS_HEADERS });
}

/** API 响应统一加安全头 + no-store（仅 /api/* 生效；静态层由 _headers 承担） */
export function applySecurityHeaders(res, path) {
  if (!path.startsWith('/api/')) return res;
  for (const [k, v] of Object.entries(SECURITY_HEADERS)) res.headers.set(k, v);
  res.headers.set('Cache-Control', 'no-store');
  return res;
}

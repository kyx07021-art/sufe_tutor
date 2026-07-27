/**
 * 模块5：全流程日志留档系统
 *
 * 设计原则（后期加密改造只碰这一个文件 = 咽喉节点）：
 * - 单一入口：一切业务事件经 logEvent() 落库；路由层另由 logRequest() 对所有 API 往来做通用兜底留档
 * - 独立留档库：优先写 env.LOG_DB（仪表板 Settings → Bindings 绑定 LOG_DB 即启用独立库），未绑定回落业务库
 * - 留档失败绝不影响业务（内部 try/catch 吞掉）
 * - schema_v / encrypted 两列为后期批量加密预留：
 *     encrypted=0 明文 JSON；加密后写密文并置 1，schema_v 随加密方案版本递增
 * - 敏感字段（口令/盐/验证码）写库前剔除，永不留明文
 */
import { dbAll, dbGet, dbRun } from './core.js';

// env.LOG_DB 存在时指向独立留档库；workerd 单实例内 env 稳定，模块级绑定安全
let LOG_DB_OVERRIDE = null;

export function bindLogDb(env) {
  LOG_DB_OVERRIDE = env.LOG_DB || null;
}

export function getLogDb(fallbackDb) {
  return LOG_DB_OVERRIDE || fallbackDb;
}

// 建表（业务库回落场景由 initDb 调用；独立库场景由 worker 初始化时调用）
export async function initLogDb(db) {
  await db.batch([
    db.prepare(`CREATE TABLE IF NOT EXISTS activity_log (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      ts DATETIME DEFAULT (datetime('now','localtime')),
      schema_v INTEGER NOT NULL DEFAULT 1,
      encrypted INTEGER NOT NULL DEFAULT 0,
      actor_user_id INTEGER,
      actor_username TEXT,
      actor_role TEXT,
      action TEXT NOT NULL,
      entity TEXT,
      entity_id TEXT,
      detail TEXT,
      req_ip TEXT,
      req_ua TEXT)`),
    db.prepare('CREATE INDEX IF NOT EXISTS idx_log_action_ts ON activity_log(action, ts)'),
    db.prepare('CREATE INDEX IF NOT EXISTS idx_log_actor ON activity_log(actor_user_id, ts)'),
    db.prepare('CREATE INDEX IF NOT EXISTS idx_log_entity ON activity_log(entity, entity_id)'),
  ]);
}

// 敏感键剔除：口令 / 盐 / 验证码类字段绝不落档
const SENSITIVE_KEYS = /pass|salt|secret|token|code$/i;
function sanitize(value, depth = 0) {
  if (value === null || value === undefined) return value;
  if (typeof value !== 'object') return value;
  if (depth > 4) return '[deep]';
  if (Array.isArray(value)) return value.map(v => sanitize(v, depth + 1));
  const out = {};
  for (const [k, v] of Object.entries(value)) {
    if (SENSITIVE_KEYS.test(k)) { out[k] = '[redacted]'; continue; }
    out[k] = sanitize(v, depth + 1);
  }
  return out;
}

function detailToJson(detail) {
  if (detail === null || detail === undefined) return null;
  try {
    let s = JSON.stringify(sanitize(detail));
    if (s && s.length > 4096) s = s.slice(0, 4096) + '"…[truncated]"}';
    return s;
  } catch {
    return null;
  }
}

/**
 * 语义事件留档（业务代码调用点）
 * @param db      当前业务库（仅用于回落；绑定 LOG_DB 后实际写入独立库）
 * @param ev      { action, actorUserId, actorUsername, actorRole, entity, entityId, detail, req }
 *   action 命名约定：'<域>.<动作>'，如 auth.login.success / demand.create / admin.ban
 */
export async function logEvent(db, ev) {
  try {
    const target = getLogDb(db);
    await dbRun(target, `INSERT INTO activity_log
      (actor_user_id, actor_username, actor_role, action, entity, entity_id, detail, req_ip, req_ua)
      VALUES (?,?,?,?,?,?,?,?,?)`, [
      ev.actorUserId ?? null,
      ev.actorUsername ?? null,
      ev.actorRole ?? null,
      ev.action,
      ev.entity ?? null,
      ev.entityId !== undefined && ev.entityId !== null ? String(ev.entityId) : null,
      detailToJson(ev.detail),
      ev.req ? (ev.req.headers.get('CF-Connecting-IP') || '') : '',
      ev.req ? (ev.req.headers.get('User-Agent') || '').slice(0, 200) : '',
    ]);
  } catch (err) {
    console.error('logEvent failed (swallowed):', err?.message || err);
  }
}

/**
 * 通用请求留档（路由层对每一次 API 往来兜底，保证"全量"）
 * status >= 400 的失败请求同样留档（失败尝试也是审计所需）
 */
export async function logRequest(db, { method, path, body, status, req }) {
  if (path === '/api/health') return; // 探活流量不留档，减噪
  try {
    // 从路径抽取实体与实体 id：/api/student/demands/42 → entity=demands, id=42
    const segs = path.split('/').filter(Boolean); // ['api','student','demands','42']
    let entity = null, entityId = null;
    const last = segs[segs.length - 1];
    if (/^\d+$/.test(last)) {
      entityId = last;
      entity = segs[segs.length - 2] || null;
    } else {
      entity = last || null;
    }
    const actorId = body && (body.userId ?? null);
    const actorName = body && (body.username ?? null);
    await logEvent(db, {
      action: `http.${method}.${status < 400 ? 'ok' : 'err'}`,
      actorUserId: typeof actorId === 'number' ? actorId : null,
      actorUsername: typeof actorName === 'string' ? actorName : null,
      entity,
      entityId,
      detail: { method, path, status, body: body && Object.keys(body).length ? body : undefined },
      req,
    });
  } catch { /* 兜底中的兜底：静默 */ }
}

/**
 * 日志检索（管理端接口用）
 * 支持：action 前缀（如 'auth.'）、actorUsername、entity、entityId、since/until（ISO 或 SQLite 时间串）、q（detail 模糊）、分页
 */
export async function queryLog(db, f = {}) {
  const target = getLogDb(db);
  const cond = [], params = [];
  if (f.action) { cond.push('action LIKE ?'); params.push(f.action.includes('%') ? f.action : f.action + '%'); }
  if (f.actorUsername) { cond.push('actor_username = ?'); params.push(f.actorUsername); }
  if (f.actorUserId) { cond.push('actor_user_id = ?'); params.push(parseInt(f.actorUserId)); }
  if (f.entity) { cond.push('entity = ?'); params.push(f.entity); }
  if (f.entityId) { cond.push('entity_id = ?'); params.push(String(f.entityId)); }
  if (f.since) { cond.push('ts >= ?'); params.push(f.since); }
  if (f.until) { cond.push('ts <= ?'); params.push(f.until); }
  if (f.q) { cond.push('detail LIKE ?'); params.push('%' + f.q + '%'); }
  let limit = parseInt(f.limit) || 100;
  if (limit > 500) limit = 500;
  const offset = parseInt(f.offset) || 0;

  const where = cond.length ? ' WHERE ' + cond.join(' AND ') : '';
  const rows = await dbAll(target,
    `SELECT * FROM activity_log${where} ORDER BY id DESC LIMIT ? OFFSET ?`,
    [...params, limit, offset]);
  const total = await dbGet(target, `SELECT COUNT(*) AS cnt FROM activity_log${where}`, params);
  return { rows, total: total?.cnt || 0, limit, offset };
}

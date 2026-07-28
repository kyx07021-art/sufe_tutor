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
import { getSecret } from './secrets.js';

// env.LOG_DB 存在时指向独立留档库；workerd 单实例内 env 稳定，模块级绑定安全
let LOG_DB_OVERRIDE = null;
let LOG_ENV = null;

export function bindLogDb(env) {
  LOG_DB_OVERRIDE = env.LOG_DB || null;
  LOG_ENV = env;
  KEY_PROMISE = null; // env 变更 → 密钥重派生
}

export function getLogDb(fallbackDb) {
  return LOG_DB_OVERRIDE || fallbackDb;
}

// ============================================================
// detail 加密（AES-GCM-256，每行随机 12B IV；密文格式 enc:v1:<iv_b64>:<ct_b64>）
// 密钥经 secrets 网关（Worker Secrets 优先，回落 secrets.js）；取不到密钥时明文落库
// （encrypted=0），内测兼容老库与未配置环境。schema_v：明文=1，加密=2
// ============================================================
const LOG_SCHEMA_V = 2;
let KEY_PROMISE = null;
const b64ToBytes = b64 => Uint8Array.from(atob(b64), c => c.charCodeAt(0));
const bytesToB64 = bytes => btoa(String.fromCharCode(...bytes));

function logKey() {
  if (!KEY_PROMISE) {
    KEY_PROMISE = (async () => {
      try {
        const raw = String(getSecret(LOG_ENV, 'LOG_ENCRYPT_KEY') || '');
        if (!raw) return null;
        return await crypto.subtle.importKey('raw', b64ToBytes(raw), 'AES-GCM', false, ['encrypt', 'decrypt']);
      } catch { return null; }
    })();
  }
  return KEY_PROMISE;
}

async function encryptDetail(json) {
  if (json === null || json === undefined) return { text: null, encrypted: 0 };
  const key = await logKey();
  if (!key) return { text: json, encrypted: 0 };
  try {
    const iv = crypto.getRandomValues(new Uint8Array(12));
    const ct = await crypto.subtle.encrypt({ name: 'AES-GCM', iv }, key, new TextEncoder().encode(json));
    return { text: `enc:v1:${bytesToB64(iv)}:${bytesToB64(new Uint8Array(ct))}`, encrypted: 1 };
  } catch {
    return { text: json, encrypted: 0 }; // 加密失败退明文：留档完整优先于机密性
  }
}

async function decryptDetail(text) {
  if (typeof text !== 'string' || !text.startsWith('enc:v1:')) return text; // 老明文行原样放行
  const key = await logKey();
  if (!key) return '[encrypted]';
  try {
    const parts = text.split(':');
    const pt = await crypto.subtle.decrypt({ name: 'AES-GCM', iv: b64ToBytes(parts[2]) }, key, b64ToBytes(parts[3]));
    return new TextDecoder().decode(pt);
  } catch {
    return '[undecryptable]'; // 密钥轮换后的历史密文：标记不可解，不抛错
  }
}

// 单条显式解密（GET /api/admin/logs/:id/decrypt 用）
export async function decryptLogEntry(db, logId) {
  const r = await dbGet(getLogDb(db), 'SELECT * FROM activity_log WHERE id=?', [logId]);
  if (!r) return null;
  r.detail = await decryptDetail(r.detail);
  return r;
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
  // 幂等补列：CREATE IF NOT EXISTS 不会升级已存在的旧表。线上老留档表的列状态未知，
  // INSERT 显式列出全部 11 列，缺一即全体静默失败——故把 INSERT 用到的列全部探测补齐
  // （db.js↔log.js 循环依赖，不能复用 db.js 的 ensureColumns，就地实现）
  const names = (await dbAll(db, 'PRAGMA table_info(activity_log)')).map(c => c.name);
  const backfill = [
    ['schema_v', 'INTEGER NOT NULL DEFAULT 1'],
    ['encrypted', 'INTEGER NOT NULL DEFAULT 0'],
    ['actor_user_id', 'INTEGER'],
    ['actor_username', 'TEXT'],
    ['actor_role', 'TEXT'],
    ['entity', 'TEXT'],
    ['entity_id', 'TEXT'],
    ['detail', 'TEXT'],
    ['req_ip', 'TEXT'],
    ['req_ua', 'TEXT'],
  ];
  for (const [col, decl] of backfill) {
    if (!names.includes(col)) {
      try { await dbRun(db, `ALTER TABLE activity_log ADD COLUMN ${col} ${decl}`); } catch { /* ignore */ }
    }
  }
}

// 敏感键剔除：口令 / 盐 / 验证码 / 正文大字段（聊天正文、附件 dataURL、头像）/ 联系方式绝不落明文档
// （detail 加密见 logEvent 咽喉；此处是通用兜底留档 request body 的第一道脱敏）
const SENSITIVE_KEYS = /pass|salt|secret|token|code$|fileData|avatar|^body$|contact|wechat|email/i;
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

function detailToJson(detail, maxLen = 4096) {
  if (detail === null || detail === undefined) return null;
  try {
    let s = JSON.stringify(sanitize(detail));
    if (s && s.length > maxLen) s = s.slice(0, maxLen) + '"…[truncated]"}';
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
    const d = await encryptDetail(detailToJson(ev.detail, ev.detailMax)); // 正文加密后落库（无密钥环境退明文）
    await dbRun(target, `INSERT INTO activity_log
      (schema_v, encrypted, actor_user_id, actor_username, actor_role, action, entity, entity_id, detail, req_ip, req_ua)
      VALUES (?,?,?,?,?,?,?,?,?,?,?)`, [
      d.encrypted ? LOG_SCHEMA_V : 1,
      d.encrypted,
      ev.actorUserId ?? null,
      ev.actorUsername ?? null,
      ev.actorRole ?? null,
      ev.action,
      ev.entity ?? null,
      ev.entityId !== undefined && ev.entityId !== null ? String(ev.entityId) : null,
      d.text,
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
 * detail 返回前一律透明解密（老明文行原样放行）；q 检索因 detail 为密文改走
 * 「其他条件过量取 500 条 → 解密 → JS 过滤 → JS 分页」
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
  let limit = parseInt(f.limit) || 100;
  if (limit > 500) limit = 500;
  const offset = parseInt(f.offset) || 0;
  const where = cond.length ? ' WHERE ' + cond.join(' AND ') : '';

  if (f.q) {
    const pool = await dbAll(target, `SELECT * FROM activity_log${where} ORDER BY id DESC LIMIT 500`, params);
    for (const r of pool) r.detail = await decryptDetail(r.detail);
    const hit = pool.filter(r => String(r.detail || '').includes(f.q));
    return { rows: hit.slice(offset, offset + limit), total: hit.length, limit, offset };
  }
  const rows = await dbAll(target,
    `SELECT * FROM activity_log${where} ORDER BY id DESC LIMIT ? OFFSET ?`,
    [...params, limit, offset]);
  for (const r of rows) r.detail = await decryptDetail(r.detail);
  const total = await dbGet(target, `SELECT COUNT(*) AS cnt FROM activity_log${where}`, params);
  return { rows, total: total?.cnt || 0, limit, offset };
}

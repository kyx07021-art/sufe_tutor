/**
 * 留档咽喉（目标分层：日志留档）—— 全流程审计留档 单点
 *
 * 设计原则（后期加密改造只碰咽喉 = 本文件 + server/crypto.js）：
 *   - 单一入口：一切业务事件经 logEvent() 落库；路由层另由 logRequest() 对写操作与失败请求兜底留档
 *     （读/轮询流量不入留档——非用户动作，无审计价值，全量记会撑爆留档库）
 *   - 独立留档库：优先写 env.LOG_DB（仪表板绑定即启用），未绑定回落业务库
 *   - 留档失败绝不影响业务（内部 try/catch 吞掉）
 *   - 加密：detail 经 crypto.js encryptDetail（AES-GCM-256，密钥 LOG_ENCRYPT_KEY 单源自 secrets 网关）；
 *     敏感键（口令/盐/验证码/联系方式）写库前 sanitize 剔除，永不留明文
 *   - schema_v / encrypted 两列为加密方案版本预留（明文=1，加密=2）
 *
 * 依赖方向：util（db 薄封装 + ensureColumns）/ security（authUser）/ crypto（detail 加密）。
 * 不依赖 db.js（避免循环）。
 */
import { dbAll, dbGet, dbRun, ensureColumns } from './util.js';
import { authUser } from './security.js';
import { bindCryptoEnv, encryptDetail, decryptDetail } from './crypto.js';
import { LIMITS } from '../../shared/config.js';

const LOG_SCHEMA_V = 2; // detail 加密方案版本（明文=1，加密=2；schema_v 列随加密版本递增）

// env.LOG_DB 存在时指向独立留档库；workerd 单实例内 env 稳定，模块级绑定安全
let LOG_DB_OVERRIDE = null;

export function bindLogDb(env) {
  LOG_DB_OVERRIDE = env.LOG_DB || null;
  bindCryptoEnv(env); // 加密密钥随 env 刷新（crypto.js 单点派生缓存；测试/初始化同走此路径）
}

function getLogDb(fallbackDb) {
  return LOG_DB_OVERRIDE || fallbackDb;
}

// 建表（业务库回落场景由 initDb 调用；独立库场景由 worker 初始化时调用）
export async function initLogDb(db) {
  await db.batch([
    db.prepare(`CREATE TABLE IF NOT EXISTS activity_log (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      ts DATETIME DEFAULT (datetime('now')),
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
  // 幂等补列：CREATE IF NOT EXISTS 不会升级旧表，INSERT 用到列全部探测补齐（ensureColumns 单源）
  await ensureColumns(db, 'activity_log', [
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
    ['duration_ms', 'INTEGER'], // 请求耗时（D 可观测性：logRequest 写入，可 SQL 直查慢请求）
  ]);
}

// 敏感键剔除：口令 / 盐 / 验证码 / 正文大字段 / 联系方式 / 需求地址信息绝不落明文档
// （第一道脱敏；detail 加密在 crypto.js。网安 N-16：补 address/additional_info——自由文本可能手填电话/门牌）
// identifier/target：登录/OTP 请求 body 的键——手机号/邮箱明文经这两键进留档，若漏配则管理员可解密还原
// （管理员可调 /api/admin/logs/:id/decrypt）。契约：新增任何可承载联系方式的 body 键名，必须复查本清单。
const SENSITIVE_KEYS = /pass|salt|secret|token|code$|fileData|avatar|^body$|contact|wechat|email|real_name|credential_image|phone|mobile|tel|address|info|thumb|identifier|target/i; // thumb：聊天缩略图 dataURL 不进留档
/**
 * 键级脱敏（深度上限 4 层，超出整值标 '[deep]'；命中键标 '[redacted]'；__proto__ 键跳过防原型污染）。
 * 导出供 node --test 回归（test/log-sanitize.test.js），语义变更必须同步该测试。
 */
export function sanitize(value, depth = 0) {
  if (value === null || value === undefined) return value;
  if (typeof value !== 'object') return value;
  if (depth > 4) return '[deep]';
  if (Array.isArray(value)) return value.map(v => sanitize(v, depth + 1));
  const out = {};
  for (const [k, v] of Object.entries(value)) {
    if (k === '__proto__') continue; // 原型污染键不入 out（防 out[k]= 改原型）
    if (SENSITIVE_KEYS.test(k)) { out[k] = '[redacted]'; continue; }
    out[k] = sanitize(v, depth + 1);
  }
  return out;
}

// 截断标记：内联进截断后的合法 JSON（对象插 "_truncated" 键 / 数组插字符串元素）
const TRUNC_MARK = '…[truncated]';

// 超长 detail 截断为合法 JSON（对象/数组保结构、标量退化为字符串摘要）。
function truncateJsonString(s, maxLen) {
  const cut = s.slice(0, maxLen);
  // 切点前最后一个「字符串外的结构边界」（, { [）：保证截断处是一个完整值之后
  let boundary = -1, inStr = false, esc = false;
  for (let i = 0; i < cut.length; i++) {
    const c = cut[i];
    if (esc) { esc = false; continue; }
    if (c === '\\') { esc = true; continue; }
    if (c === '"') { inStr = !inStr; continue; }
    if (!inStr && (c === ',' || c === '{' || c === '[')) boundary = i;
  }
  const head = boundary >= 0 ? cut.slice(0, boundary + 1).replace(/[,\s]+$/, '') : '';
  if (!head) return JSON.stringify(String(s).slice(0, maxLen) + TRUNC_MARK); // 标量：字符串摘要（恒合法）
  // 未闭合开括号栈（跳过字符串字面量）
  const stack = [];
  for (let i = 0; i < head.length; i++) {
    const c = head[i];
    if (c === '"') { i++; while (i < head.length && (head[i] !== '"' || head[i - 1] === '\\')) i++; }
    else if (c === '{' || c === '[') stack.push(c);
    else if (c === '}' || c === ']') stack.pop();
  }
  if (!stack.length) return head + JSON.stringify(TRUNC_MARK);
  const lastOpen = stack[stack.length - 1];
  const member = lastOpen === '{' ? `,"_truncated":${JSON.stringify(TRUNC_MARK)}` : `,${JSON.stringify(TRUNC_MARK)}`;
  const closers = stack.slice().reverse().map(c => c === '{' ? '}' : ']').join('');
  return head + member + closers;
}

function detailToJson(detail, maxLen = LIMITS.LOG_DETAIL_MAX) {
  if (detail === null || detail === undefined) return null;
  try {
    const s = JSON.stringify(sanitize(detail));
    if (!s) return null;
    if (s.length <= maxLen) return s;
    return truncateJsonString(s, maxLen);
  } catch { return null; }
}

// 请求级留档收集（B4：WeakMap 键 req，避免污染 Request 对象；并发请求天然隔离）
const pendingLogs = new WeakMap();
function collectLog(req, row) {
  let rows = pendingLogs.get(req);
  if (!rows) { rows = []; pendingLogs.set(req, rows); }
  rows.push(row);
}

const LOG_INSERT_SQL = `INSERT INTO activity_log
  (schema_v, encrypted, actor_user_id, actor_username, actor_role, action, entity, entity_id, detail, req_ip, req_ua, duration_ms)
  VALUES (?,?,?,?,?,?,?,?,?,?,?,?)`;
async function writeLogRow(target, row) {
  await dbRun(target, LOG_INSERT_SQL, [
    row.schema_v, row.encrypted, row.actor_user_id, row.actor_username, row.actor_role,
    row.action, row.entity, row.entity_id, row.detail, row.req_ip, row.req_ua, row.duration_ms ?? null,
  ]);
}
/** 收尾统一落库：本请求全部业务留档 + 访问留档一次 batch（1 次往返；失败静默不阻断响应） */
async function flushPendingLogs(target, req) {
  const rows = req ? pendingLogs.get(req) : null;
  if (!rows || !rows.length) return;
  pendingLogs.delete(req);
  await target.batch(rows.map(r => target.prepare(LOG_INSERT_SQL).bind(
    r.schema_v, r.encrypted, r.actor_user_id, r.actor_username, r.actor_role, r.action,
    r.entity, r.entity_id, r.detail, r.req_ip, r.req_ua, r.duration_ms ?? null)));
}

/**
 * 语义事件留档（业务代码调用点）
 * @param db  当前业务库（仅用于回落；绑定 LOG_DB 后实际写入独立库）
 * @param ev  { action, actorUserId, actorUsername, actorRole, entity, entityId, detail, detailMax?, durationMs?, req }
 *   action 命名约定：'<域>.<动作>'，如 auth.login.success / demand.create / admin.ban
 *   detail 为可序列化对象；超 detailMax（缺省 LIMITS.LOG_DETAIL_MAX）自动截断为合法 JSON（恒含截断标记）。
 *   detailMax 供正文大字段场景（如 contract.signed 存合同原文）放宽截断
 * 架构（B4：留档 1 次往返）：带 req 的调用不立即落库，行挂到请求级队列（WeakMap 键 req），
 *   由 logRequest 在响应收尾统一 batch 落库（本请求全部业务留档 + 访问留档一次往返）；
 *   无 req（测试/系统事件）直接落，语义不变。
 */
export async function logEvent(db, ev) {
  try {
    const d = await encryptDetail(detailToJson(ev.detail, ev.detailMax)); // 正文加密后落库（v1.4.14 fail-closed：无密钥抛错由本函数 try/catch 吞 → 留档不落、绝不落明文）
    const row = {
      schema_v: d.encrypted ? LOG_SCHEMA_V : 1,
      encrypted: d.encrypted,
      actor_user_id: ev.actorUserId ?? null,
      actor_username: ev.actorUsername ?? null,
      actor_role: ev.actorRole ?? null,
      action: ev.action,
      entity: ev.entity ?? null,
      entity_id: ev.entityId !== undefined && ev.entityId !== null ? String(ev.entityId) : null,
      detail: d.text,
      req_ip: ev.req ? (ev.req.headers.get('CF-Connecting-IP') || '') : '',
      req_ua: ev.req ? (ev.req.headers.get('User-Agent') || '').slice(0, LIMITS.DEVICE_UA_MAX) : '',
      duration_ms: ev.durationMs ?? null,
    };
    if (ev.req && typeof ev.req === 'object') { collectLog(ev.req, row); return; }
    await writeLogRow(getLogDb(db), row);
  } catch (err) {
    console.error('logEvent failed (swallowed):', err?.message || err);
  }
}

// 单条显式解密（GET /api/admin/logs/:id/decrypt 用；backoffice 审计接口）
export async function decryptLogEntry(db, logId) {
  const r = await dbGet(getLogDb(db), 'SELECT * FROM activity_log WHERE id=?', [logId]);
  if (!r) return null;
  r.detail = await decryptDetail(r.detail);
  return r;
}

/**
 * 通用请求留档（路由层对每一次 API 往来兜底，保证「全量」；status>=400 失败请求同样留档）
 * B4：本函数是留档收尾点——业务 logEvent（请求级队列）与本条访问留档在此一次 batch 落库。
 * D：detail 与 duration_ms 列记录请求耗时，可 SQL 直查慢请求（活动日志库）。
 */
export async function logRequest(db, { method, path, body, status, req, durationMs }) {
  if (path === '/api/health') return; // 探活流量不留档，减噪
  // 访问留档只记「有审计意义的请求」：写操作（非 GET）与失败请求（status>=400）。
  // 成功 GET（列表读取、徽标轮询、用户名探测、附件拉取等）不入留档——它们不是用户动作，
  // 全量记会以百倍速度撑爆留档库且无审计价值（流量页口径见 constants UI.TRAFFIC_HINT）。
  // 例外：成功 GET 但耗时 > LIMITS.SLOW_GET_MS 也留档——慢 GET 是用户可感知的性能事故信号，
  // 否则「GET 成功不留档」是观测盲区（慢到底慢在哪无据可查），低频慢请求撑不爆表。
  if (method === 'GET' && status < 400 && (durationMs == null || durationMs <= LIMITS.SLOW_GET_MS)) return;
  try {
    // 从路径抽取实体与实体 id：/api/student/demands/42 → entity=demands, id=42
    const segs = path.split('/').filter(Boolean);
    let entity = null, entityId = null;
    const last = segs[segs.length - 1];
    if (/^\d+$/.test(last)) {
      entityId = last;
      entity = segs[segs.length - 2] || null;
    } else {
      entity = last || null;
    }
    // 操作人身份只从令牌解析（防自报 body.userId/username 审计冒名）；无令牌留空。
    // 语义留档（logEvent 各业务调用点）本就走令牌解出的 id，不受此处影响
    let actorId = null, actorName = null;
    if (req && req.headers && req.headers.get('X-Auth-Token')) {
      const actor = await authUser(db, req);
      if (actor) { actorId = actor.id; actorName = actor.username; }
    }
    await logEvent(db, {
      action: `http.${method}.${status < 400 ? 'ok' : 'err'}`,
      actorUserId: actorId,
      actorUsername: actorName,
      entity,
      entityId,
      durationMs,
      detail: { method, path, status, durationMs, body: body && Object.keys(body).length ? body : undefined },
      req,
    });
    await flushPendingLogs(getLogDb(db), req);
  } catch { /* 兜底中的兜底：静默 */ }
}

// 流量监测：按时间桶聚合 http.* 访问留档的请求数与平均耗时。
// unit: 'hour'（24h 用）| 'day'（7d/30d 用）；duration_ms 历史桶 avg 为 null
const TRAFFIC_BUCKET_FMT = { hour: '%Y-%m-%d %H:00', day: '%Y-%m-%d' };
export async function dbGetTrafficBuckets(db, unit, fromTs) {
  const fmt = TRAFFIC_BUCKET_FMT[unit] || TRAFFIC_BUCKET_FMT.hour; // 白名单内插值，无注入面
  return await dbAll(db,
    `SELECT strftime('${fmt}', ts) AS bucket, COUNT(*) AS requests, ROUND(AVG(duration_ms), 1) AS avg_ms
     FROM activity_log WHERE action LIKE 'http.%' AND ts >= ?
     GROUP BY bucket ORDER BY bucket`, [fromTs]);
}

/**
 * 日志检索（backoffice 审计接口用）
 * 支持：action 前缀、actorUsername、entity、entityId、since/until、q（detail 模糊）、分页
 * detail 返回前一律透明解密（老明文行原样放行）；q 检索因 detail 为密文改走
 * 「其他条件过量取 LOG_QUERY_MAX 条 → 解密 → JS 过滤 → JS 分页」
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
  if (limit > LIMITS.LOG_QUERY_MAX) limit = LIMITS.LOG_QUERY_MAX;
  const offset = parseInt(f.offset) || 0;
  const where = cond.length ? ' WHERE ' + cond.join(' AND ') : '';

  if (f.q) {
    const pool = await dbAll(target, `SELECT * FROM activity_log${where} ORDER BY id DESC LIMIT ${LIMITS.LOG_QUERY_MAX}`, params);
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

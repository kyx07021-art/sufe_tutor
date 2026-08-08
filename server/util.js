/**
 * 服务端工具函数层（目标分层：工具函数）
 *
 * 职责：响应构造（json/error）、D1 查询薄封装（dbAll/dbGet/dbRun）、幂等加列（ensureColumns）、
 * 随机邀请码（genCode）、设备标签（deviceLabelFromUA）。
 * 无业务逻辑、无跨模块状态；是各层公共依赖的「最底层」。
 * 响应构造带 CORS 头（CORS_HEADERS 单源自 constants.js，预检与 json() 同源）。
 */
import { CORS_HEADERS, LIMITS, MSG, STATUS } from './constants.js';

// ============================================================
// 响应构造
// ============================================================
/** JSON 响应：默认 200，自带 CORS 头（单源自 constants.CORS_HEADERS，与预检同源） */
export function json(data, status = 200) {
  return new Response(JSON.stringify(data), {
    status,
    headers: { 'Content-Type': 'application/json', ...CORS_HEADERS },
  });
}

/**
 * 错误响应：{ error: msg, code? }（code 为稳定错误码，前端按 code 分支，不脆耦合中文文案）
 * @param msg   用户可见文案（单源 MSG / UI）
 * @param status HTTP 状态码（缺省 400）
 * @param code   稳定错误码（可选，如 'PROFILE_INCOMPLETE'）
 */
export function error(msg, status = 400, code) { return json({ error: msg, code }, status); }

// ============================================================
// D1 查询薄封装（数据层 / 路由层共用；换数据库时只需改这几处）
// ============================================================
/** 多行查询 → 行数组（空表返 []） */
export async function dbAll(db, sql, params = []) {
  const r = await db.prepare(sql).bind(...params).all();
  return r.results || [];
}

/** 单行查询 → 行对象 | undefined */
export async function dbGet(db, sql, params = []) {
  return await db.prepare(sql).bind(...params).first();
}

/** 写操作 → D1 run 结果（meta.changes 供赢家模式判定） */
export async function dbRun(db, sql, params = []) {
  return await db.prepare(sql).bind(...params).run();
}

/**
 * 需求「活跃」统一谓词（v0.25.10 用户反馈）：业务路由判断需求可否操作（签约/意向/推送）一律走这里，
 * active == status==='open'（contracted 已成交 / revoked 已撤销未重开均非活跃）。
 * SQL 层字面量维持既有惯例（constants.js 头部注释），JS 判断层收敛到本函数。
 */
export function isDemandActive(status) {
  return status === STATUS.OPEN;
}

/**
 * 幂等加列迁移：PRAGMA 探测后再 ALTER（D1 无 ADD COLUMN IF NOT EXISTS）。
 * 唯一实现；db.js / log.js / contract.js 共用（原三份就地重复已收敛至此）。
 * @param db   D1 绑定
 * @param table 表名（调用方白名单，勿拼用户输入）
 * @param cols  [[列名, DDL], ...]
 */
export async function ensureColumns(db, table, cols) {
  const info = await dbAll(db, `PRAGMA table_info(${table})`);
  const have = new Set(info.map(c => c.name));
  for (const [name, ddl] of cols) {
    if (!have.has(name)) await dbRun(db, `ALTER TABLE ${table} ADD COLUMN ${name} ${ddl}`);
  }
}

/**
 * JSON 请求体解析（_worker 每请求调用；POST/PUT/DELETE 才有体）。
 * 体积炸弹防护：Content-Length 廉价短路 + 流式硬上限双保险——仅看 CL 会被 chunked 传输绕过，
 * 改用 reader 累积到上限+1 即抛 {status:413}（调用方转 413 响应）；其余解析失败兜底空对象交路由校验。
 */
export async function parseBody(request) {
  if (!['POST', 'PUT', 'DELETE'].includes(request.method)) return {};
  const cl = parseInt(request.headers.get('Content-Length') || '0', 10);
  if (cl > LIMITS.BODY_LIMIT) throw Object.assign(new Error('PAYLOAD_TOO_LARGE'), { status: 413 });
  try {
    const reader = request.body && request.body.getReader();
    if (!reader) return await request.json();
    const chunks = []; let n = 0;
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      n += value.byteLength;
      if (n > LIMITS.BODY_LIMIT) {
        try { reader.cancel(); } catch { /* ignore */ }
        throw Object.assign(new Error('PAYLOAD_TOO_LARGE'), { status: 413 });
      }
      chunks.push(value);
    }
    const text = new TextDecoder().decode(await new Blob(chunks).arrayBuffer());
    return text ? JSON.parse(text) : {};
  } catch (e) {
    if (e && e.status === 413) throw e;
    return {}; // 其余解析失败（含非法 JSON）兜底空对象，交由路由校验
  }
}

// ============================================================
// 结构化时间段校验（v0.25.0 需求一）：库内 JSON
// [{type:'week',dow:1..7,start:'HH:MM',end:'HH:MM'}] 白名单式校验。
// 设计不拟合当前周制输入：type 判别符为未来扩展（月日 + 时间等）留位，未知 type 一律拒绝。
// 需求档案（expected_time）与教师档案（time_slots）共用；空串合法（时间非必填）。
// 返回 { value } 或 { error: MSG }。导出供路由与 test/time-slots.test.js 单测。
// ============================================================
const TIME_SLOT_RE = /^(?:[01]\d|2[0-3]):[0-5]\d$/;
export function sanitizeTimeSlots(raw) {
  const s = typeof raw === 'string' ? raw.trim() : '';
  if (!s) return { value: '' };
  let arr;
  try { arr = JSON.parse(s); } catch { return { error: MSG.INVALID_TIME_SLOTS }; }
  if (!Array.isArray(arr)) return { error: MSG.INVALID_TIME_SLOTS };
  if (arr.length > LIMITS.TIME_SLOTS_MAX) return { error: MSG.INVALID_TIME_SLOTS };
  for (const it of arr) {
    if (!it || typeof it !== 'object') return { error: MSG.INVALID_TIME_SLOTS };
    if (it.type !== 'week') return { error: MSG.INVALID_TIME_SLOTS };
    if (!Number.isInteger(it.dow) || it.dow < 1 || it.dow > 7) return { error: MSG.INVALID_TIME_SLOTS };
    if (typeof it.start !== 'string' || !TIME_SLOT_RE.test(it.start)) return { error: MSG.INVALID_TIME_SLOTS };
    if (typeof it.end !== 'string' || !TIME_SLOT_RE.test(it.end)) return { error: MSG.INVALID_TIME_SLOTS };
    if (it.start >= it.end) return { error: MSG.INVALID_TIME_SLOTS }; // 同日段结束须晚于开始
  }
  return { value: JSON.stringify(arr).slice(0, LIMITS.DEMAND_TIME_MAX) };
}

// ============================================================
// 随机邀请码（大写去易混字符集）
// ============================================================
export function genCode(len = 8) {
  const chars = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
  const arr = new Uint8Array(len);
  crypto.getRandomValues(arr);
  return Array.from(arr, v => chars[v % chars.length]).join('');
}

// ============================================================
// 登录设备标签（账户设置展示：「Windows · Chrome」/「iPhone · Safari」）
// ============================================================
export function deviceLabelFromUA(ua) {
  const s = String(ua || '');
  let os = '未知设备';
  if (/iPad/i.test(s)) os = 'iPad';
  else if (/iPhone/i.test(s)) os = 'iPhone';
  else if (/Android/i.test(s)) os = 'Android';
  else if (/Windows/i.test(s)) os = 'Windows';
  else if (/Mac OS X|Macintosh/i.test(s)) os = 'macOS';
  else if (/Linux/i.test(s)) os = 'Linux';
  let br = '浏览器';
  if (/Edg\//i.test(s)) br = 'Edge';
  else if (/Firefox\//i.test(s)) br = 'Firefox';
  else if (/Chrome\//i.test(s)) br = 'Chrome';
  else if (/Safari\//i.test(s)) br = 'Safari';
  return `${os} · ${br}`;
}

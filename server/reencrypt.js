/**
 * 密钥轮换重加密（v1.5.0；A-12 分片化，2026-08-19）
 *
 * 使用方式：
 *   1. Worker Secrets 同时配置新 FIELD_ENC_KEY / LOG_ENCRYPT_KEY 与旧
 *      FIELD_ENC_KEY_OLD / LOG_ENCRYPT_KEY_OLD；
 *   2. 管理员经二次认证调用 POST /api/admin/reencrypt（A-12-2 起端点按 cursor 分片续跑）；
 *   3. 成功后删除 *_OLD 密钥并重新发布。
 *
 * 安全语义：只把 enc:v1: 密文用新钥重写；明文/空串不动；无法解密的行计数上报、绝不写成占位符。
 *
 * A-12 分片（生产事故根因修复）：D1 Free 计划单次 Worker 调用 50 次查询上限，逐行
 * SELECT+UPDATE 全量重加密（~1000 次查询）必超限抛 "Too many API requests by single
 * Worker invocation"。改为 Cloudflare 推荐 migration cursor 模式：reencryptChunk 单次调用
 * 只处理 ≤REENCRYPT_ROW_BUDGET 行密文，游标推进「字段表 → 投诉附件 → 日志」三段；
 * reencryptAll 为循环包装（测试/一次性全量场景语义不变，仅 shim 无 D1 上限时可用）。
 *
 * 游标续跑用 id（非 rowid）分页：三张涉及表均 id INTEGER PRIMARY KEY AUTOINCREMENT（id==rowid），
 * 且 node:sqlite shim 对 INTEGER PRIMARY KEY 表不返回 rowid 键（SELECT rowid 只见 id），
 * 用 id 消除 shim/D1 分歧并使「段内恰满 budget 续跑」路径可在 shim 下实测。
 */
import { dbAll, dbRun } from '../src/server/core/util.js';
import { decryptField, encryptField, decryptDetail, encryptDetail } from '../src/server/core/crypto.js';
import { safeJsonArray } from './db.js';

// 字段加密列清单：表 → 列（单点维护，新加密列上线必须在此登记）
const FIELD_TABLES = [
  { table: 'users', cols: ['phone', 'email'] },
  { table: 'teacher_profiles', cols: ['wechat', 'email', 'real_name', 'credential_image'] },
  { table: 'student_demands', cols: ['parent_contact', 'student_contact'] },
  { table: 'teacher_verifications', cols: ['verify_code', 'admission_image'] },
  { table: 'uploads', cols: ['body', 'thumb'] },
  { table: 'messages', cols: ['body', 'thumb'] },
  { table: 'contracts', cols: ['contract_md'] },
];

const ENC_PREFIX = 'enc:v1:';

// 单次 Worker 调用处理的密文行数上限：D1 Free 单调用 50 次查询预算，减 handler 固定开销
// （requireAdmin/confirmDangerOtp/logEvent/logRequest ≈ 10 次）与每段 1 次扫描 SELECT 后留足余量。
// REENCRYPT_ROW_BUDGET ≤ 30 的契约测试将在 A-12-4 补（锁定上限，防调大后单调用回归 D1 50 查询上限）。
export const REENCRYPT_ROW_BUDGET = 20;

const unreadable = pt => pt === '[encrypted]' || pt === '[undecryptable]';

const zero = () => ({ scanned: 0, rewritten: 0, unreadable: 0, skipped: 0 });

/**
 * 分片重加密：单次调用处理 ≤REENCRYPT_ROW_BUDGET 行密文，游标推进字段表 → 投诉附件 → 日志三段。
 * @param db  业务库 D1
 * @param cursor  续跑游标（null/undefined = 从头）；形状 { phase:'fields'|'attachments'|'logs', fieldsT, afterId }
 * @param logDb  独立留档库（可选；缺省日志段回落业务库）
 * @returns { summary:{fields,attachments,logs 各计数}, cursor: 下一游标 | null（全部完成） }
 * 幂等/可续：任意中断后带上次 cursor 续跑，汇总各段总计数与一次性全量等价（A-12-4 契约测试补锁）。
 */
export async function reencryptChunk(db, cursor = null, logDb = null) {
  const c = cursor || { phase: 'fields', fieldsT: 0, afterId: 0 };
  const summary = { fields: zero(), attachments: zero(), logs: zero() };
  let budget = REENCRYPT_ROW_BUDGET;

  // ---- 1) 字段段：逐表按 id 游标分片（WHERE 全括号：OR 与 AND 优先级——续跑期 id>? 必须作用于整个析取）----
  if (c.phase === 'fields') {
    while (budget > 0 && c.fieldsT < FIELD_TABLES.length) {
      const t = FIELD_TABLES[c.fieldsT];
      const where = t.cols.map(col => `${col} LIKE 'enc:v1:%'`).join(' OR ');
      const limit = budget;
      const rows = await dbAll(db,
        `SELECT id, ${t.cols.join(', ')} FROM ${t.table} WHERE (${where}) AND id > ? ORDER BY id LIMIT ?`,
        [c.afterId, limit]);
      if (rows.length < limit) { c.fieldsT++; c.afterId = 0; } // 本表取尽 → 下一表
      else c.afterId = rows[rows.length - 1].id;                // 恰满 limit → 段内续跑位置
      for (const row of rows) {
        summary.fields.scanned++;
        const set = [];
        const vals = [];
        let rowUnreadable = false;
        for (const col of t.cols) {
          const enc = row[col];
          if (typeof enc !== 'string' || !enc.startsWith(ENC_PREFIX)) continue;
          const pt = await decryptField(enc);
          if (unreadable(pt)) { rowUnreadable = true; break; }
          const next = await encryptField(pt);
          if (next !== enc) { set.push(`${col}=?`); vals.push(next); }
        }
        if (rowUnreadable) { summary.fields.unreadable++; continue; }
        if (!set.length) { summary.fields.skipped++; continue; }
        await dbRun(db, `UPDATE ${t.table} SET ${set.join(', ')} WHERE id=?`, [...vals, row.id]);
        summary.fields.rewritten++;
      }
      budget -= rows.length;
    }
    if (budget <= 0) return { summary, cursor: c };
    c.phase = 'attachments'; c.afterId = 0;
  }

  // ---- 2) 投诉附件段：attachments JSON 列内 body/thumb 密文重写 ----
  if (c.phase === 'attachments') {
    const limit = budget;
    const rows = await dbAll(db,
      `SELECT id, attachments FROM complaints WHERE attachments LIKE '%enc:v1:%' AND id > ? ORDER BY id LIMIT ?`,
      [c.afterId, limit]);
    for (const row of rows) {
      const list = safeJsonArray(row.attachments);
      if (!Array.isArray(list)) continue;
      let changed = false;
      let rowUnreadable = false;
      for (const a of list) {
        for (const key of ['body', 'thumb']) {
          const enc = a && a[key];
          if (typeof enc !== 'string' || !enc.startsWith(ENC_PREFIX)) continue;
          summary.attachments.scanned++;
          const pt = await decryptField(enc);
          if (unreadable(pt)) { rowUnreadable = true; break; }
          const next = await encryptField(pt);
          if (next !== enc) { a[key] = next; changed = true; summary.attachments.rewritten++; }
          else summary.attachments.skipped++;
        }
        if (rowUnreadable) break;
      }
      if (rowUnreadable) { summary.attachments.unreadable++; continue; }
      if (changed) await dbRun(db, 'UPDATE complaints SET attachments=? WHERE id=?', [JSON.stringify(list), row.id]);
    }
    budget -= rows.length;
    if (rows.length < limit) { c.phase = 'logs'; c.afterId = 0; } // 附件取尽 → 日志段
    else { c.afterId = rows[rows.length - 1].id; return { summary, cursor: c }; } // 恰满 → 附件段续跑
    // rows.length < limit 时 budget 必仍 > 0（rows.length < 原 budget），继续日志段
  }

  // ---- 3) 日志段：activity_log.detail（LOG_ENCRYPT_KEY 域；独立 LOG_DB 场景密文在留档库）----
  const logSource = logDb || db;
  const limit = budget;
  const rows = await dbAll(logSource,
    `SELECT id, detail FROM activity_log WHERE encrypted=1 AND detail LIKE 'enc:v1:%' AND id > ? ORDER BY id LIMIT ?`,
    [c.afterId, limit]);
  for (const row of rows) {
    summary.logs.scanned++;
    const pt = await decryptDetail(row.detail);
    if (unreadable(pt)) { summary.logs.unreadable++; continue; }
    const next = await encryptDetail(pt);
    if (next.text === row.detail) { summary.logs.skipped++; continue; }
    await dbRun(logSource, 'UPDATE activity_log SET detail=? WHERE id=?', [next.text, row.id]);
    summary.logs.rewritten++;
  }
  if (rows.length < limit) return { summary, cursor: null }; // 日志取尽 → 全部完成
  c.afterId = rows[rows.length - 1].id;
  return { summary, cursor: c };
}

/** 全量重加密（循环分片直至完成；对外语义与 v1.5.0 一致——测试用；生产端点走 reencryptChunk 分片续跑，见 A-12-2） */
export async function reencryptAll(db, logDb = null) {
  const total = { fields: zero(), attachments: zero(), logs: zero() };
  let cursor = null;
  for (;;) {
    const { summary, cursor: next } = await reencryptChunk(db, cursor, logDb);
    for (const k of ['fields', 'attachments', 'logs']) {
      for (const key of ['scanned', 'rewritten', 'unreadable', 'skipped']) {
        total[k][key] += summary[k][key];
      }
    }
    if (!next) break;
    cursor = next;
  }
  const sum = (a, b) => ({
    scanned: a.scanned + b.scanned,
    rewritten: a.rewritten + b.rewritten,
    unreadable: a.unreadable + b.unreadable,
    skipped: a.skipped + b.skipped,
  });
  return { fields: total.fields, attachments: total.attachments, logs: total.logs, total: sum(sum(total.fields, total.attachments), total.logs) };
}

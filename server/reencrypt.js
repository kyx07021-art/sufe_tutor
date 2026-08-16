/**
 * 密钥轮换一次性重加密（v1.5.0）
 *
 * 使用方式：
 *   1. Worker Secrets 同时配置新 FIELD_ENC_KEY / LOG_ENCRYPT_KEY 与旧
 *      FIELD_ENC_KEY_OLD / LOG_ENCRYPT_KEY_OLD；
 *   2. 管理员经二次认证调用 POST /api/admin/reencrypt；
 *   3. 成功后删除 *_OLD 密钥并重新发布。
 *
 * 安全语义：只把 enc:v1: 密文用新钥重写；明文/空串不动；无法解密的行计数上报、绝不写成占位符。
 */
import { dbAll, dbRun } from './util.js';
import { decryptField, encryptField, decryptDetail, encryptDetail } from './crypto.js';
import { safeJsonArray } from './db.js';

// 字段加密列清单：表 → 列 → id 列（单点维护，新加密列上线必须在此登记）
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

const unreadable = pt => pt === '[encrypted]' || pt === '[undecryptable]';

/** 逐表重加密字段列 */
export async function reencryptFieldColumns(db) {
  const summary = { scanned: 0, rewritten: 0, unreadable: 0, skipped: 0 };
  for (const t of FIELD_TABLES) {
    const where = t.cols.map(c => `${c} LIKE 'enc:v1:%'`).join(' OR ');
    const rows = await dbAll(db, `SELECT id, ${t.cols.join(', ')} FROM ${t.table} WHERE ${where}`);
    for (const row of rows) {
      summary.scanned++;
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
      if (rowUnreadable) { summary.unreadable++; continue; }
      if (!set.length) { summary.skipped++; continue; }
      await dbRun(db, `UPDATE ${t.table} SET ${set.join(', ')} WHERE id=?`, [...vals, row.id]);
      summary.rewritten++;
    }
  }
  return summary;
}

/** 投诉附件 JSON 列内 body/thumb 密文重加密 */
export async function reencryptComplaintAttachments(db) {
  const summary = { scanned: 0, rewritten: 0, unreadable: 0, skipped: 0 };
  const rows = await dbAll(db, `SELECT id, attachments FROM complaints WHERE attachments LIKE '%enc:v1:%'`);
  for (const row of rows) {
    const list = safeJsonArray(row.attachments);
    if (!Array.isArray(list)) continue;
    let changed = false;
    let rowUnreadable = false;
    for (const a of list) {
      for (const key of ['body', 'thumb']) {
        const enc = a && a[key];
        if (typeof enc !== 'string' || !enc.startsWith(ENC_PREFIX)) continue;
        summary.scanned++;
        const pt = await decryptField(enc);
        if (unreadable(pt)) { rowUnreadable = true; break; }
        const next = await encryptField(pt);
        if (next !== enc) { a[key] = next; changed = true; summary.rewritten++; }
        else summary.skipped++;
      }
      if (rowUnreadable) break;
    }
    if (rowUnreadable) { summary.unreadable++; continue; }
    if (changed) await dbRun(db, 'UPDATE complaints SET attachments=? WHERE id=?', [JSON.stringify(list), row.id]);
  }
  return summary;
}

/** activity_log.detail（LOG_ENCRYPT_KEY 域）重加密 */
export async function reencryptLogDetails(db) {
  const summary = { scanned: 0, rewritten: 0, unreadable: 0, skipped: 0 };
  const rows = await dbAll(db, `SELECT id, detail FROM activity_log WHERE encrypted=1 AND detail LIKE 'enc:v1:%'`);
  for (const row of rows) {
    summary.scanned++;
    const pt = await decryptDetail(row.detail);
    if (unreadable(pt)) { summary.unreadable++; continue; }
    const next = await encryptDetail(pt);
    if (next.text === row.detail) { summary.skipped++; continue; }
    await dbRun(db, 'UPDATE activity_log SET detail=? WHERE id=?', [next.text, row.id]);
    summary.rewritten++;
  }
  return summary;
}

export async function reencryptAll(db, logDb = null) {
  const fields = await reencryptFieldColumns(db);
  const attachments = await reencryptComplaintAttachments(db);
  const logs = await reencryptLogDetails(logDb || db); // 独立 LOG_DB 场景：留档密文在留档库，不在业务库
  const sum = (a, b) => ({
    scanned: a.scanned + b.scanned,
    rewritten: a.rewritten + b.rewritten,
    unreadable: a.unreadable + b.unreadable,
    skipped: a.skipped + b.skipped,
  });
  return { fields, attachments, logs, total: sum(sum(fields, attachments), logs) };
}

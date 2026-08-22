/**
 * 合同域数据层（V-1-4 从 server/db.js 提取）：独立 contracts 表读取/创建/删除（状态机在 contract/api.js）。
 * S5-03：signing_contracts → 独立 contracts 表——零签约字段、两态 contract_status('signing'|'signed')、
 * 双方元组自持、conversation_id 可空历史关联（独立存证，删会话不删 signed/revoked 合同）。
 */
import { dbAll, dbGet, dbRun } from '../../core/util.js';
import { decryptField } from '../../core/crypto.js';

// 合同（纯数据层取行；状态机关口在 contract/api.js）
// ============================================================
// 网安 N-05：contract_md / prev_business 加密列，出门即解密（写点加密在 contract/api.js；老明文行经 decryptField 原样放行）
export async function dbGetContractById(db, id) {
  // contract_status AS status 别名供 handler 零改动读 ct.status；contractStatus 对齐 I-44 契约
  // （新前端读 contractStatus，status 保留供内部/旧消费）；无 stage 过滤（独立表两态直读）
  const row = await dbGet(db, "SELECT c.*, c.contract_status AS status, c.contract_status AS contractStatus FROM contracts c WHERE id=?", [id]);
  if (row) row.contract_md = await decryptField(row.contract_md);
  if (row && row.prev_business) row.prev_business = await decryptField(row.prev_business);
  return row;
}

// 我参与的合同列表（含双方用户名，「我的合同」页用）
export async function dbGetMyContracts(db, userId) {
  // 行自持双方元组——JOIN users 取名；不绑需求（无 student_demands join / demand_display_id）
  const rows = await dbAll(db, `SELECT c.*, c.contract_status AS status, c.contract_status AS contractStatus,
      us.username AS student_name, ut.username AS teacher_name
    FROM contracts c
    JOIN users us ON us.id = c.student_user_id
    JOIN users ut ON ut.id = c.teacher_user_id
    WHERE c.student_user_id = ? OR c.teacher_user_id = ?
    ORDER BY c.updated_at DESC`, [userId, userId]);
  for (const r of rows) {
    r.contract_md = await decryptField(r.contract_md); // N-05：合同正文加密列出门解密
    if (r.prev_business) r.prev_business = await decryptField(r.prev_business); // 留痕 diff 基线
  }
  return rows;
}

// 管理员全量合同列表（含双方用户名 + 起草者用户名；管理员合同页用）
export async function dbGetAllContractsAdmin(db) {
  // 自持元组 + users 取名；drafter_user_id 恒真实，INNER JOIN 安全
  const rows = await dbAll(db, `SELECT c.*, c.contract_status AS status, c.contract_status AS contractStatus,
      us.username AS student_name, ut.username AS teacher_name, du.username AS drafter_name
    FROM contracts c
    JOIN users us ON us.id = c.student_user_id
    JOIN users ut ON ut.id = c.teacher_user_id
    JOIN users du ON du.id = c.drafter_user_id
    ORDER BY c.updated_at DESC`);
  for (const r of rows) {
    r.contract_md = await decryptField(r.contract_md); // N-05：合同正文加密列出门解密
    if (r.prev_business) r.prev_business = await decryptField(r.prev_business); // 与 dbGetMyContracts 同口径，管理员改动对比可用
  }
  return rows;
}

// 删除合同行。返回原生 result：调用方凭 meta.changes 判定赢家
// （并发双撤销/双取消/管理员删除场景仅 changes>0 的一方执行通知/留档等副作用）
export async function dbDeleteContract(db, contractId) {
  return dbRun(db, "DELETE FROM contracts WHERE id=?", [contractId]);
}

// 创建合同行（S5-06 起草：全字段自填 INSERT，无需求门禁/无 stage 推进/不驱动会话）。
// 返回新行 id；调用方凭 meta.changes 判定写入成功。
export async function dbCreateContract(db, fields) {
  const {
    conversationId, studentUserId, teacherUserId, drafterUserId,
    method, plan, rate, schedule, location,
    payMethod, payMethodOther, firstLessonDate, trialPay, trialPayOther,
    contractMd,
  } = fields;
  const res = await dbRun(db, `INSERT INTO contracts
      (conversation_id, student_user_id, teacher_user_id, drafter_user_id,
       method, plan, rate, schedule, location,
       pay_method, pay_method_other, first_lesson_date, trial_pay, trial_pay_other,
       contract_md)
    VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`,
    [conversationId, studentUserId, teacherUserId, drafterUserId,
     method, plan, rate, schedule, location,
     payMethod, payMethodOther, firstLessonDate, trialPay, trialPayOther,
     contractMd]);
  return Number(res.meta.last_row_id);
}

// 写入含签名块的合同正文（S5-07 签署后用）：覆盖 contract_md + 刷新 updated_at。
// 返回原生 result（调用方凭 meta.changes 判定写入成功）。
export async function dbSetContractMd(db, contractId, contractMdEnc) {
  return dbRun(db, "UPDATE contracts SET contract_md=?, updated_at=datetime('now') WHERE id=?", [contractMdEnc, contractId]);
}

// ============================================================

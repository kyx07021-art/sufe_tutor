/**
 * 合同域数据层（V-1-4 从 server/db.js 提取）：contracts 读取/删除（状态机在 contract/api.js）。
 */
import { dbAll, dbGet, dbRun } from '../../core/util.js';
import { decryptField } from '../../core/crypto.js';

// 合同（纯数据层取行；状态机关口在 contract/api.js）
// ============================================================
// 网安 N-05：contract_md 加密列，出门即解密（写点加密在 contract/api.js；老明文行经 decryptField 原样放行）
export async function dbGetContractById(db, id) {
  const row = await dbGet(db, 'SELECT * FROM contracts WHERE id=?', [id]);
  if (row) row.contract_md = await decryptField(row.contract_md);
  return row;
}

// dbGetContractByConv 已连根拔——会话级查任意状态合同过宽（把已拒绝/已撤销历史合同
// 当「进行中」，阻塞重新起草）；「一条需求一份合同」由需求级门禁（status IN pending/signing/signed）把关。
// 我参与的合同列表（含双方用户名 + 需求编号，「我的合同」页用）
export async function dbGetMyContracts(db, userId) {
  const rows = await dbAll(db, `SELECT ct.*, c.student_user_id, c.teacher_user_id,
      us.username AS student_name, ut.username AS teacher_name, sd.display_id AS demand_display_id
    FROM contracts ct
    JOIN conversations c ON c.id = ct.conversation_id
    JOIN users us ON us.id = c.student_user_id
    JOIN users ut ON ut.id = c.teacher_user_id
    LEFT JOIN student_demands sd ON sd.id = ct.demand_id
    WHERE c.student_user_id = ? OR c.teacher_user_id = ?
    ORDER BY ct.updated_at DESC`, [userId, userId]);
  for (const r of rows) {
    r.contract_md = await decryptField(r.contract_md); // N-05：合同正文加密列出门解密
    if (r.prev_business) r.prev_business = await decryptField(r.prev_business); // 留痕 diff 基线
  }
  return rows;
}

// 管理员全量合同列表（含双方用户名 + 起草者用户名；管理员合同页用）
export async function dbGetAllContractsAdmin(db) {
  const rows = await dbAll(db, `SELECT ct.*, c.student_user_id, c.teacher_user_id,
      us.username AS student_name, ut.username AS teacher_name, du.username AS drafter_name
    FROM contracts ct
    JOIN conversations c ON c.id = ct.conversation_id
    JOIN users us ON us.id = c.student_user_id
    JOIN users ut ON ut.id = c.teacher_user_id
    JOIN users du ON du.id = ct.drafter_user_id
    ORDER BY ct.updated_at DESC`);
  for (const r of rows) {
    r.contract_md = await decryptField(r.contract_md); // N-05：合同正文加密列出门解密
    if (r.prev_business) r.prev_business = await decryptField(r.prev_business); // 与 dbGetMyContracts 同口径，管理员改动对比可用
  }
  return rows;
}

// 删除合同行。statuses 非空时仅删该状态集内的行（取消签约的并发守卫：翻到 signed/revoked 的行拒删）。
// 返回原生 result：调用方凭 meta.changes 判定赢家
// （并发双撤销/双取消/管理员删除场景仅 changes>0 的一方执行通知/留档等副作用）
export async function dbDeleteContract(db, contractId, statuses = null) {
  if (!statuses || !statuses.length) return dbRun(db, 'DELETE FROM contracts WHERE id=?', [contractId]);
  const q = statuses.map(() => '?').join(',');
  return dbRun(db, `DELETE FROM contracts WHERE id=? AND status IN (${q})`, [contractId, ...statuses]);
}

// ============================================================

/**
 * 合同域数据层（V-1-4 从 server/db.js 提取）：contracts 读取/删除（状态机在 contract/api.js）。
 */
import { dbAll, dbGet, dbRun } from '../../core/util.js';
import { decryptField } from '../../core/crypto.js';

// 合同（纯数据层取行；状态机关口在 contract/api.js）
// ============================================================
// 网安 N-05：contract_md 加密列，出门即解密（写点加密在 contract/api.js；老明文行经 decryptField 原样放行）
export async function dbGetContractById(db, id) {
  // AI-4b：合并表统一 id 空间——锁 stage='contract' 保 404 语义（signing 层 id 走合同端点 = 404）；
  // contract_status AS status 别名供 handler 零改动读 ct.status
  const row = await dbGet(db, "SELECT sc.*, sc.contract_status AS status FROM signing_contracts sc WHERE id=? AND stage='contract'", [id]);
  if (row) row.contract_md = await decryptField(row.contract_md);
  return row;
}

// dbGetContractByConv 已连根拔——会话级查任意状态合同过宽（把已拒绝/已撤销历史合同
// 当「进行中」，阻塞重新起草）；「一条需求一份合同」由需求级门禁（status IN pending/signing/signed）把关。
// 我参与的合同列表（含双方用户名 + 需求编号，「我的合同」页用）
export async function dbGetMyContracts(db, userId) {
  // AI-4b：行自持双方元组——去 conversation join，直接 JOIN users 取名；只出 stage='contract' 行（合同页语义）
  const rows = await dbAll(db, `SELECT sc.*, sc.contract_status AS status,
      us.username AS student_name, ut.username AS teacher_name, sd.display_id AS demand_display_id
    FROM signing_contracts sc
    JOIN users us ON us.id = sc.student_user_id
    JOIN users ut ON ut.id = sc.teacher_user_id
    LEFT JOIN student_demands sd ON sd.id = sc.demand_id
    WHERE sc.stage='contract' AND (sc.student_user_id = ? OR sc.teacher_user_id = ?)
    ORDER BY sc.updated_at DESC`, [userId, userId]);
  for (const r of rows) {
    r.contract_md = await decryptField(r.contract_md); // N-05：合同正文加密列出门解密
    if (r.prev_business) r.prev_business = await decryptField(r.prev_business); // 留痕 diff 基线
  }
  return rows;
}

// 管理员全量合同列表（含双方用户名 + 起草者用户名；管理员合同页用）
export async function dbGetAllContractsAdmin(db) {
  // AI-4b：去 conversation join，自持元组 + users 取名；只出 stage='contract' 行（drafter_user_id 恒真实，INNER JOIN 安全）
  const rows = await dbAll(db, `SELECT sc.*, sc.contract_status AS status,
      us.username AS student_name, ut.username AS teacher_name, du.username AS drafter_name
    FROM signing_contracts sc
    JOIN users us ON us.id = sc.student_user_id
    JOIN users ut ON ut.id = sc.teacher_user_id
    JOIN users du ON du.id = sc.drafter_user_id
    WHERE sc.stage='contract'
    ORDER BY sc.updated_at DESC`);
  for (const r of rows) {
    r.contract_md = await decryptField(r.contract_md); // N-05：合同正文加密列出门解密
    if (r.prev_business) r.prev_business = await decryptField(r.prev_business); // 与 dbGetMyContracts 同口径，管理员改动对比可用
  }
  return rows;
}

// 删除合同行。statuses 非空时仅删该状态集内的行（取消签约的并发守卫：翻到 signed/revoked 的行拒删）。
// 返回原生 result：调用方凭 meta.changes 判定赢家
// （并发双撤销/双取消/管理员删除场景仅 changes>0 的一方执行通知/留档等副作用）
// AI-4b：删除合同行仅限 stage='contract'（签约层行经 dbDeleteSigning；statuses 参数全仓零非空调用——W1 删）
export async function dbDeleteContract(db, contractId) {
  return dbRun(db, "DELETE FROM signing_contracts WHERE id=? AND stage='contract'", [contractId]);
}

// ============================================================

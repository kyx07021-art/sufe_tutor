/**
 * 合同模块（测试版签约链路）：
 *   起草草案(聊天窗+) → 对方确认草案 → 「我的合同」预览正式合同 → 双方确认签约 → signed（评价门槛 dbIsContracted 随之放行）
 *   任一阶段可取消签约（删合同 + 通知对方，会话保留）；signing 阶段任意一方可改合同（重置双方确认，实时同步）。
 * 正式合同正文由 buildContractMd 按草案信息生成（Markdown，后期可换更正式的格式）；双方看到的是同一条记录。
 * 短信验证码环节未接入：verifySignOtp 预留接口，测试版以二次确认代替。
 */
import { dbAll, dbGet, dbRun, json, error, authUser, requireAdmin, confirmDangerOtp, MSG } from './core.js';
import { notifyUser } from './notify.js';
import { logEvent } from './log.js';
import '../constants.js'; // 副作用导入：一切发给用户看的文案统一走 globalThis.APP_CONSTANTS.UI（constants.js 收口）
const UIC = globalThis.APP_CONSTANTS.UI;

// 根据草案信息生成正式合同正文。条款要素依《民法典》第四百七十条一般条款拟定
// （当事人/标的/数量质量/价款/履行期限地点方式/违约责任/争议解决），家教场景展开为九条。
// 授课地点按隐私合规采用模糊表述（甲方常住处等），不收集详细门牌号。
export function buildContractMd({ teacherName, studentName, method, schedule, location, plan, rate, createdAt, demandNo }) {
  const methodName = method === 'offline' ? '线下授课' : '线上授课';
  const locationText = location || (method === 'offline' ? '甲方常住处或双方另行约定的地点' : '双方约定的线上课堂');
  return `# 家教服务合同

**甲方（学生方）**：${studentName}
**乙方（教师方）**：${teacherName}
${demandNo ? `**关联需求编号**：#${demandNo}
` : ''}**签署日期**：${createdAt || ''}

甲乙双方本着平等、自愿、诚实信用的原则，依照《中华人民共和国民法典》及相关法律法规，经友好协商，就家教服务事宜达成如下协议：

## 第一条 服务内容与授课安排

1. 授课方式：${methodName}。
2. 授课科目与内容：详见本合同第五条「教学方案」。
3. 授课时间：${schedule || '由双方另行协商确定'}。
4. 授课地点：${locationText}。

## 第二条 课时费与支付

1. 约定时薪为每小时 **${rate}** 元（人民币）。
2. 支付方式与结算周期（按次 / 周 / 月）由双方另行约定，甲方应按约定如期支付课时费用。
3. 平台仅提供信息撮合与合同存证服务，不参与费用结算。

## 第三条 甲方权利与义务

1. 有权要求乙方按照约定的内容与时间安排授课，并对教学质量进行监督；
2. 应按约定支付课时费，并为授课提供必要的学习条件与配合；
3. 如需调整课程安排，应提前与乙方协商并达成一致；
4. 对通过平台获取的教师个人信息，仅用于本次家教服务目的，不得向第三方泄露。

## 第四条 乙方权利与义务

1. 有权按约定获取课时报酬；
2. 应按约定认真备课、授课，保证教学质量；
3. 如需调整课程安排，应提前与甲方协商并达成一致；
4. 对授课过程中知悉的学生个人信息与学习情况予以保密，不得向第三方泄露。

## 第五条 教学方案

${plan || '（未填写）'}

## 第六条 课程调整、补课与违约责任

1. 任一方无法按时上课，应提前通知对方，并协商安排补课或调课；
2. 因一方过错给对方造成损失的，双方应友好协商解决；
3. 任一方严重违反本合同约定的，另一方有权解除本合同，违约方应承担相应责任。

## 第七条 合同的变更与解除

经双方协商一致，可以变更或解除本合同；任一方提前终止合同的，应提前告知对方，并妥善结清已发生而未支付的课时费用。

## 第八条 争议解决

因履行本合同发生争议，双方应首先友好协商解决；协商不成的，可依法向有管辖权的人民法院提起诉讼。

## 第九条 生效与存证

本合同自双方在平台内确认签约后生效，双方账户内各存一份，内容相同。平台对签署时的合同文本及其数字指纹（SHA-256）进行独立留档，供任一方事后校验文本一致性。

---

甲方确认：＿＿＿＿＿＿＿＿    乙方确认：＿＿＿＿＿＿＿＿
`;
}

// ============================================================
// 合同存证台账（独立于活跃库的「保障库」）：签署即存 文本 SHA-256 + 哈希链（prev_hash），
// 任一环节被改动都能校验出来。绑定 env.LEDGER_DB 即启用独立台账库，未绑定回落业务库
// （同 LOG_DB 模式：仪表板 Settings → Bindings 绑定即生效）。
// ============================================================
let LEDGER_OVERRIDE = null;
export function bindLedgerDb(env) { LEDGER_OVERRIDE = (env && env.LEDGER_DB) || null; }
const getLedgerDb = fallback => LEDGER_OVERRIDE || fallback;

export async function initLedgerTable(db) {
  await dbRun(db, `CREATE TABLE IF NOT EXISTS contract_ledger (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    contract_id INTEGER NOT NULL,
    content_hash TEXT NOT NULL,
    prev_hash TEXT NOT NULL DEFAULT '',
    created_at DATETIME DEFAULT (datetime('now','localtime')))`);
}

const hexOf = buf => [...new Uint8Array(buf)].map(b => b.toString(16).padStart(2, '0')).join('');
const sha256Hex = text => crypto.subtle.digest('SHA-256', new TextEncoder().encode(text)).then(hexOf);

// 签署存证：记账 contract_id + 文本哈希 + 上一条哈希（链式，篡改任一历史条目都会断链）
async function ledgerRecord(db, contractId, contractMd) {
  const target = getLedgerDb(db);
  const prev = await dbGet(target, 'SELECT content_hash FROM contract_ledger ORDER BY id DESC LIMIT 1');
  const content_hash = await sha256Hex(contractMd);
  await dbRun(target, 'INSERT INTO contract_ledger (contract_id, content_hash, prev_hash) VALUES (?,?,?)',
    [contractId, content_hash, prev ? prev.content_hash : 'GENESIS']);
  return content_hash;
}

// 校验：重算当前合同文本哈希与台账记录比对（合同行被撤销时台账仍在，返回 archived 状态）
export async function verifyContractLedger(db, contractId) {
  const row = await dbGet(getLedgerDb(db),
    'SELECT * FROM contract_ledger WHERE contract_id=? ORDER BY id DESC LIMIT 1', [contractId]);
  if (!row) return { recorded: false };
  const ct = await dbGet(db, 'SELECT contract_md FROM contracts WHERE id=?', [contractId]);
  if (!ct) return { recorded: true, archived: true, valid: null, contentHash: row.content_hash, prevHash: row.prev_hash, createdAt: row.created_at };
  const now = await sha256Hex(ct.contract_md);
  return { recorded: true, archived: false, valid: now === row.content_hash, contentHash: row.content_hash, prevHash: row.prev_hash, createdAt: row.created_at };
}

// ---- 数据层 ----
async function convOf(db, conversationId) {
  return await dbGet(db, `SELECT c.*, us.username AS student_name, ut.username AS teacher_name
    FROM conversations c
    JOIN users us ON us.id = c.student_user_id
    JOIN users ut ON ut.id = c.teacher_user_id
    WHERE c.id = ?`, [conversationId]);
}
const isParticipant = (conv, userId) => !!conv && (conv.student_user_id === userId || conv.teacher_user_id === userId);
const otherSide = (conv, userId) => userId === conv.student_user_id ? conv.teacher_user_id : conv.student_user_id;
const nameOf = (conv, userId) => userId === conv.student_user_id ? conv.student_name : conv.teacher_name;

export async function dbGetContractByConv(db, conversationId) {
  return await dbGet(db, 'SELECT * FROM contracts WHERE conversation_id=? ORDER BY id DESC LIMIT 1', [conversationId]);
}

export async function dbGetMyContracts(db, userId) {
  return await dbAll(db, `SELECT ct.*, c.student_user_id, c.teacher_user_id,
      us.username AS student_name, ut.username AS teacher_name, sd.display_id AS demand_display_id
    FROM contracts ct
    JOIN conversations c ON c.id = ct.conversation_id
    JOIN users us ON us.id = c.student_user_id
    JOIN users ut ON ut.id = c.teacher_user_id
    LEFT JOIN student_demands sd ON sd.id = ct.demand_id
    WHERE c.student_user_id = ? OR c.teacher_user_id = ?
    ORDER BY ct.updated_at DESC`, [userId, userId]);
}

// ---- 路由 ----

// POST /api/contracts { userId, conversationId, method, plan, hourlyRate } —— 起草并发送给另一方
export async function handleCreateContract(db, body, req) {
  const me = await authUser(db, req);
  if (!me) return error(MSG.LOGIN_REQUIRED, 401);
  const userId = me.id;
  const conversationId = parseInt(body.conversationId);
  const conv = await convOf(db, conversationId);
  if (!isParticipant(conv, userId)) return error(MSG.NO_PERMISSION, 403);
  const existing = await dbGetContractByConv(db, conversationId);
  if (existing) return error(MSG.CONTRACT_EXISTS, 409);

  const method = body.method === 'offline' ? 'offline' : 'online';
  const plan = String(body.plan || '').slice(0, 20000);
  const rate = Math.max(0, parseInt(body.hourlyRate) || 0);
  const schedule = String(body.schedule || '').slice(0, 500);
  const location = String(body.location || '').slice(0, 200);
  // 合同绑定需求：起草时显式选择（缺省回落到会话自带的需求）
  const demandId = parseInt(body.demandId) || conv.demand_id || null;
  let demandNo = '';
  if (demandId) {
    const dm = await dbGet(db, 'SELECT display_id FROM student_demands WHERE id=?', [demandId]);
    if (dm && dm.display_id) demandNo = String(dm.display_id).padStart(4, '0');
  }
  const md = buildContractMd({
    teacherName: conv.teacher_name, studentName: conv.student_name,
    method, schedule, location, plan, rate, createdAt: new Date().toISOString().slice(0, 10), demandNo,
  });
  const res = await dbRun(db,
    `INSERT INTO contracts (conversation_id, drafter_user_id, demand_id, method, schedule, location, plan, hourly_rate, contract_md)
     VALUES (?,?,?,?,?,?,?,?,?)`,
    [conversationId, userId, demandId, method, schedule, location, plan, rate, md]);
  const id = (res && res.meta && res.meta.last_row_id) || 0;
  // 聊天窗合同事件气泡：落一条 kind=contract 的系统消息（文案由前端按查看者渲染），双方会话内均可见
  await dbRun(db, `INSERT INTO messages (conversation_id, sender_user_id, body, kind) VALUES (?,?,?,?)`,
    [conversationId, userId, 'contract_draft', 'contract']);
  await notifyUser(db, otherSide(conv, userId), UIC.CONTRACT_DRAFT_SENT.replace('{name}', nameOf(conv, userId)));
  logEvent(db, { action: 'contract.create', actorUserId: userId, entity: 'contract', entityId: id,
    detail: { conversationId, method, rate }, req });
  return json({ id, message: UIC.CONTRACT_DRAFT_SENT_TOAST }, 201);
}

// GET /api/contracts?conversationId= → { contract }（聊天窗据此渲染合同状态灰字行）
// 合同全文敏感：仅会话参与方凭令牌可读（曾零鉴权可枚举 conversationId 读全站合同）
export async function handleGetContractByConv(db, url, req) {
  const me = await authUser(db, req);
  if (!me) return error(MSG.LOGIN_REQUIRED, 401);
  const conversationId = parseInt(url.searchParams.get('conversationId'));
  const conv = await convOf(db, conversationId);
  if (!isParticipant(conv, me.id)) return error(MSG.NO_PERMISSION, 403);
  return json({ contract: (await dbGetContractByConv(db, conversationId)) || null });
}

// GET /api/contracts/my → { contracts }（身份凭令牌）
export async function handleGetMyContracts(db, url, req) {
  const me = await authUser(db, req);
  if (!me) return error(MSG.LOGIN_REQUIRED, 401);
  return json({ contracts: await dbGetMyContracts(db, me.id) });
}

// POST /api/contracts/:id/confirm-draft —— 对方确认草案 → 进入 signing（正式合同待双方确认签约）
export async function handleConfirmDraft(db, contractId, body, req) {
  const me = await authUser(db, req);
  if (!me) return error(MSG.LOGIN_REQUIRED, 401);
  const userId = me.id;
  const ct = await dbGet(db, 'SELECT * FROM contracts WHERE id=?', [contractId]);
  if (!ct) return error(MSG.CONTRACT_NOT_FOUND, 404);
  if (ct.status !== 'pending') return error(MSG.CONTRACT_STATE_INVALID, 409);
  if (userId === ct.drafter_user_id) return error(MSG.CONTRACT_SELF_DRAFT, 409);
  const conv = await convOf(db, ct.conversation_id);
  if (!isParticipant(conv, userId)) return error(MSG.NO_PERMISSION, 403);

  await dbRun(db, `UPDATE contracts SET status='signing', updated_at=datetime('now','localtime') WHERE id=?`, [contractId]);
  await notifyUser(db, ct.drafter_user_id, UIC.CONTRACT_DRAFT_ACCEPTED.replace('{name}', nameOf(conv, userId)));
  logEvent(db, { action: 'contract.confirm_draft', actorUserId: userId, entity: 'contract', entityId: contractId, req });
  return json({ ok: true });
}

// 短信验证码预留：测试版恒通过，接入 SMS 后在此校验 code（docs/sms-plan.md）
async function verifySignOtp(/* db, userId, code */) { return true; }

// POST /api/contracts/:id/sign —— 确认签约；双方都确认后 status→signed
export async function handleSignContract(db, contractId, body, req) {
  const me = await authUser(db, req);
  if (!me) return error(MSG.LOGIN_REQUIRED, 401);
  const userId = me.id;
  const ct = await dbGet(db, 'SELECT * FROM contracts WHERE id=?', [contractId]);
  if (!ct) return error(MSG.CONTRACT_NOT_FOUND, 404);
  // pending（收草案方直接确认签约，免去独立「确认草案」步骤）与 signing 均可签
  if (ct.status !== 'pending' && ct.status !== 'signing') return error(MSG.CONTRACT_STATE_INVALID, 409);
  const conv = await convOf(db, ct.conversation_id);
  if (!isParticipant(conv, userId)) return error(MSG.NO_PERMISSION, 403);
  if (!(await verifySignOtp())) return error(MSG.CONTRACT_STATE_INVALID, 403);

  const col = userId === ct.drafter_user_id ? 'drafter_confirmed' : 'other_confirmed';
  await dbRun(db, `UPDATE contracts SET ${col}=1, status='signing', updated_at=datetime('now','localtime') WHERE id=?`, [contractId]);
  const updated = await dbGet(db, 'SELECT * FROM contracts WHERE id=?', [contractId]);
  const both = !!(updated.drafter_confirmed && updated.other_confirmed);
  if (both) {
    await dbRun(db, `UPDATE contracts SET status='signed' WHERE id=?`, [contractId]);
    // 存证入台账（独立保障库优先）：文本哈希 + 哈希链，撤销合同删活跃行时留档仍不可篡改地保留
    const contentHash = await ledgerRecord(db, contractId, updated.contract_md);
    // 需求转「已签约」并自动下架广场；该需求上其余教师待处理意向由系统统一拒绝
    // （action=intent.auto_reject 与用户手动拒绝 intent.reject 在加密留档中区分）
    if (updated.demand_id) {
      await dbRun(db, `UPDATE student_demands SET status='contracted' WHERE id=?`, [updated.demand_id]);
      const pending = await dbAll(db,
        `SELECT id, teacher_user_id FROM demand_intents WHERE demand_id=? AND status='pending'`, [updated.demand_id]);
      for (const it of pending) {
        await dbRun(db, `UPDATE demand_intents SET status='rejected', resolved_at=datetime('now','localtime') WHERE id=?`, [it.id]);
        logEvent(db, { action: 'intent.auto_reject', actorRole: 'system', entity: 'intent', entityId: it.id,
          detail: { demandId: updated.demand_id, teacherUserId: it.teacher_user_id, reason: 'demand_contracted' }, req });
      }
    }
    await notifyUser(db, otherSide(conv, userId), UIC.CONTRACT_SIGNED);
    // 留档保存合同原文（detailMax 放宽，加密后落库；撤销合同后仍可凭留档还原缔约内容）
    logEvent(db, { action: 'contract.signed', actorUserId: userId, entity: 'contract', entityId: contractId,
      detail: { conversationId: updated.conversation_id, demandId: updated.demand_id, contentHash, contractMd: updated.contract_md },
      detailMax: 60000, req });
  } else {
    await notifyUser(db, otherSide(conv, userId), UIC.CONTRACT_SIGN_WAITING.replace('{name}', nameOf(conv, userId)));
    logEvent(db, { action: 'contract.sign_partial', actorUserId: userId, entity: 'contract', entityId: contractId, req });
  }
  return json({ ok: true, signed: both });
}

// PUT /api/contracts/:id { contractMd } —— 修改正式合同：重置双方确认，实时同步给另一边
export async function handleModifyContract(db, contractId, body, req) {
  const me = await authUser(db, req);
  if (!me) return error(MSG.LOGIN_REQUIRED, 401);
  const userId = me.id;
  const ct = await dbGet(db, 'SELECT * FROM contracts WHERE id=?', [contractId]);
  if (!ct) return error(MSG.CONTRACT_NOT_FOUND, 404);
  if (ct.status !== 'pending' && ct.status !== 'signing') return error(MSG.CONTRACT_STATE_INVALID, 409);
  const conv = await convOf(db, ct.conversation_id);
  if (!isParticipant(conv, userId)) return error(MSG.NO_PERMISSION, 403);
  const md = String(body.contractMd || '').slice(0, 30000);
  if (!md.trim()) return error(MSG.CONTRACT_EMPTY);
  if (md === ct.contract_md) return json({ ok: true, unchanged: true }); // 内容未变：幂等短路，不重置确认/不重发通知（防双触发重复通知）

  // 修改即回退到签约选择态：双方确认清零 + pending→signing，两边都回到 确认/修改/查看 三按钮
  await dbRun(db,
    `UPDATE contracts SET contract_md=?, drafter_confirmed=0, other_confirmed=0, status='signing', updated_at=datetime('now','localtime') WHERE id=?`,
    [md, contractId]);
  await notifyUser(db, otherSide(conv, userId), UIC.CONTRACT_MODIFIED.replace('{name}', nameOf(conv, userId)));
  logEvent(db, { action: 'contract.modify', actorUserId: userId, entity: 'contract', entityId: contractId, req });
  return json({ ok: true });
}

// POST /api/contracts/:id/revoke —— 撤销已签约合同（仅限双方已约定终止的场景，前端 2 次确认 + 法律后果提示）：
// 活跃库抹掉合同行与合同气泡；签署台账与加密留档保留（不可篡改的历史凭证）；通知对方。
// 后期接入短信验证（confirmDangerOtp，现恒通过）
export async function handleRevokeContract(db, contractId, body, req) {
  const me = await authUser(db, req);
  if (!me) return error(MSG.LOGIN_REQUIRED, 401);
  const ct = await dbGet(db, 'SELECT * FROM contracts WHERE id=?', [contractId]);
  if (!ct) return error(MSG.CONTRACT_NOT_FOUND, 404);
  if (ct.status !== 'signed') return error(MSG.CONTRACT_STATE_INVALID, 409); // 未签约的走取消流程
  const conv = await convOf(db, ct.conversation_id);
  if (!isParticipant(conv, me.id)) return error(MSG.NO_PERMISSION, 403);
  if (!(await confirmDangerOtp(db, me.id))) return error(MSG.CONTRACT_STATE_INVALID, 403);
  await dbRun(db, 'DELETE FROM contracts WHERE id=?', [contractId]);
  await dbRun(db, `DELETE FROM messages WHERE conversation_id=? AND kind='contract'`, [ct.conversation_id]);
  await notifyUser(db, otherSide(conv, me.id), UIC.CONTRACT_REVOKED_NOTIFY.replace('{name}', nameOf(conv, me.id)));
  logEvent(db, { action: 'contract.revoke', actorUserId: me.id, entity: 'contract', entityId: contractId,
    detail: { conversationId: ct.conversation_id, demandId: ct.demand_id, note: 'ledger_retained' }, req });
  return json({ ok: true });
}

// GET /api/contracts/:id/verify —— 存证校验：重算文本哈希对比台账（仅会话参与方与管理员可用）
export async function handleVerifyContract(db, contractId, req) {
  const me = await authUser(db, req);
  if (!me) return error(MSG.LOGIN_REQUIRED, 401);
  const ct = await dbGet(db, 'SELECT * FROM contracts WHERE id=?', [contractId]);
  if (!ct) return error(MSG.CONTRACT_NOT_FOUND, 404);
  const conv = await convOf(db, ct.conversation_id);
  const admin = me.role === 'admin';
  if (!admin && !isParticipant(conv, me.id)) return error(MSG.NO_PERMISSION, 403);
  return json(await verifyContractLedger(db, contractId));
}

// GET /api/admin/contracts?username= —— 管理员查看全部合同（网页测试用途，真实场景仅管理员可见此页）
export async function handleAdminListContracts(db, url, req) {
  if (!(await requireAdmin(db, req))) return error(MSG.ADMIN_ONLY, 403);
  const contracts = await dbAll(db, `SELECT ct.*, c.student_user_id, c.teacher_user_id,
      us.username AS student_name, ut.username AS teacher_name, du.username AS drafter_name
    FROM contracts ct
    JOIN conversations c ON c.id = ct.conversation_id
    JOIN users us ON us.id = c.student_user_id
    JOIN users ut ON ut.id = c.teacher_user_id
    JOIN users du ON du.id = ct.drafter_user_id
    ORDER BY ct.updated_at DESC`);
  return json({ contracts });
}

// DELETE /api/admin/contracts/:id { username } —— 管理员移除合同（测试用；合同全链路留档，删除记 admin.contract.remove）
export async function handleAdminRemoveContract(db, contractId, body, req) {
  const admin = await requireAdmin(db, req);
  if (!admin) return error(MSG.ADMIN_ONLY, 403);
  const ct = await dbGet(db, 'SELECT * FROM contracts WHERE id=?', [contractId]);
  if (!ct) return error(MSG.CONTRACT_NOT_FOUND, 404);
  await dbRun(db, 'DELETE FROM contracts WHERE id=?', [contractId]);
  logEvent(db, { action: 'admin.contract.remove', actorUserId: admin.id, actorUsername: admin.username,
    actorRole: 'admin', entity: 'contract', entityId: contractId,
    detail: { conversationId: ct.conversation_id, status: ct.status, drafterUserId: ct.drafter_user_id }, req });
  return json({ ok: true });
}

// DELETE /api/contracts/:id —— 取消签约：删合同 + 通知对方；会话保留
export async function handleCancelContract(db, contractId, body, req) {
  const me = await authUser(db, req);
  if (!me) return error(MSG.LOGIN_REQUIRED, 401);
  const userId = me.id;
  const ct = await dbGet(db, 'SELECT * FROM contracts WHERE id=?', [contractId]);
  if (!ct) return error(MSG.CONTRACT_NOT_FOUND, 404);
  if (ct.status === 'signed') return error(MSG.CONTRACT_STATE_INVALID, 409);
  const conv = await convOf(db, ct.conversation_id);
  if (!isParticipant(conv, userId)) return error(MSG.NO_PERMISSION, 403);

  await dbRun(db, 'DELETE FROM contracts WHERE id=?', [contractId]);
  await notifyUser(db, otherSide(conv, userId), UIC.CONTRACT_CANCELLED.replace('{name}', nameOf(conv, userId)));
  logEvent(db, { action: 'contract.cancel', actorUserId: userId, entity: 'contract', entityId: contractId, req });
  return json({ ok: true });
}

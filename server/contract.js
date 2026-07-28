/**
 * 合同模块（测试版签约链路）：
 *   起草草案(聊天窗+) → 对方确认草案 → 「我的合同」预览正式合同 → 双方确认签约 → signed（评价门槛 dbIsContracted 随之放行）
 *   任一阶段可取消签约（删合同 + 通知对方，会话保留）；signing 阶段任意一方可改合同（重置双方确认，实时同步）。
 * 正式合同正文由 buildContractMd 按草案信息生成（Markdown，后期可换更正式的格式）；双方看到的是同一条记录。
 * 短信验证码环节未接入：verifySignOtp 预留接口，测试版以二次确认代替。
 */
import { dbAll, dbGet, dbRun, json, error, MSG } from './core.js';
import { notifyUser } from './notify.js';
import { logEvent } from './log.js';

// 根据草案信息生成正式合同正文（合同条款为占位文案，能 test 即可，后期替换）
export function buildContractMd({ teacherName, studentName, method, plan, rate, createdAt }) {
  const methodName = method === 'offline' ? '线下授课' : '线上授课';
  return `# 家教服务合同

**甲方（学生方）**：${studentName}
**乙方（教师方）**：${teacherName}
**签署日期**：${createdAt || ''}

经甲乙双方友好协商，就家教服务事宜达成如下约定：

## 一、教学方式

${methodName}

## 二、约定时薪

每小时 **${rate}** 元（人民币），结算方式与周期由双方自行约定。

## 三、教学方案

${plan || '（未填写）'}

## 四、双方权利与义务

1. 乙方应按约定认真备课、授课，保证教学质量；
2. 甲方应按约定及时支付课时费用；
3. 任何一方如需调整课程安排，应提前与对方协商；
4. 平台仅提供信息撮合与合同存证，不参与费用结算。

## 五、其他

本合同自双方在平台内确认签约后生效，双方账户内各存一份，内容相同。

---

甲方确认：＿＿＿＿＿＿＿＿    乙方确认：＿＿＿＿＿＿＿＿
`;
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

export async function dbGetContractByConv(db, conversationId) {
  return await dbGet(db, 'SELECT * FROM contracts WHERE conversation_id=? ORDER BY id DESC LIMIT 1', [conversationId]);
}

export async function dbGetMyContracts(db, userId) {
  return await dbAll(db, `SELECT ct.*, c.student_user_id, c.teacher_user_id,
      us.username AS student_name, ut.username AS teacher_name
    FROM contracts ct
    JOIN conversations c ON c.id = ct.conversation_id
    JOIN users us ON us.id = c.student_user_id
    JOIN users ut ON ut.id = c.teacher_user_id
    WHERE c.student_user_id = ? OR c.teacher_user_id = ?
    ORDER BY ct.updated_at DESC`, [userId, userId]);
}

// ---- 路由 ----

// POST /api/contracts { userId, conversationId, method, plan, hourlyRate } —— 起草并发送给另一方
export async function handleCreateContract(db, body, req) {
  const userId = parseInt(body.userId);
  const conversationId = parseInt(body.conversationId);
  const conv = await convOf(db, conversationId);
  if (!isParticipant(conv, userId)) return error(MSG.NO_PERMISSION, 403);
  const existing = await dbGetContractByConv(db, conversationId);
  if (existing) return error(MSG.CONTRACT_EXISTS, 409);

  const method = body.method === 'offline' ? 'offline' : 'online';
  const plan = String(body.plan || '').slice(0, 20000);
  const rate = Math.max(0, parseInt(body.hourlyRate) || 0);
  const md = buildContractMd({
    teacherName: conv.teacher_name, studentName: conv.student_name,
    method, plan, rate, createdAt: new Date().toISOString().slice(0, 10),
  });
  const res = await dbRun(db,
    `INSERT INTO contracts (conversation_id, drafter_user_id, method, plan, hourly_rate, contract_md)
     VALUES (?,?,?,?,?,?)`,
    [conversationId, userId, method, plan, rate, md]);
  const id = (res && res.meta && res.meta.last_row_id) || 0;
  await notifyUser(db, otherSide(conv, userId), MSG.CONTRACT_DRAFT_SENT);
  logEvent(db, { action: 'contract.create', actorUserId: userId, entity: 'contract', entityId: id,
    detail: { conversationId, method, rate }, req });
  return json({ id, message: MSG.CONTRACT_DRAFT_SENT_TOAST }, 201);
}

// GET /api/contracts?conversationId= → { contract }（聊天窗据此渲染合同状态灰字行）
export async function handleGetContractByConv(db, url) {
  const conversationId = parseInt(url.searchParams.get('conversationId'));
  if (!conversationId) return error(MSG.LOGIN_REQUIRED);
  return json({ contract: (await dbGetContractByConv(db, conversationId)) || null });
}

// GET /api/contracts/my?userId= → { contracts }
export async function handleGetMyContracts(db, url) {
  const userId = parseInt(url.searchParams.get('userId'));
  if (!userId) return error(MSG.LOGIN_REQUIRED);
  return json({ contracts: await dbGetMyContracts(db, userId) });
}

// POST /api/contracts/:id/confirm-draft { userId } —— 对方确认草案 → 进入 signing（正式合同待双方确认签约）
export async function handleConfirmDraft(db, contractId, body, req) {
  const userId = parseInt(body.userId);
  const ct = await dbGet(db, 'SELECT * FROM contracts WHERE id=?', [contractId]);
  if (!ct) return error(MSG.CONTRACT_NOT_FOUND, 404);
  if (ct.status !== 'pending') return error(MSG.CONTRACT_STATE_INVALID, 409);
  if (userId === ct.drafter_user_id) return error(MSG.CONTRACT_SELF_DRAFT, 409);
  const conv = await convOf(db, ct.conversation_id);
  if (!isParticipant(conv, userId)) return error(MSG.NO_PERMISSION, 403);

  await dbRun(db, `UPDATE contracts SET status='signing', updated_at=datetime('now','localtime') WHERE id=?`, [contractId]);
  await notifyUser(db, ct.drafter_user_id, MSG.CONTRACT_DRAFT_ACCEPTED);
  logEvent(db, { action: 'contract.confirm_draft', actorUserId: userId, entity: 'contract', entityId: contractId, req });
  return json({ ok: true });
}

// 短信验证码预留：测试版恒通过，接入 SMS 后在此校验 code（docs/sms-plan.md）
async function verifySignOtp(/* db, userId, code */) { return true; }

// POST /api/contracts/:id/sign { userId } —— 确认签约；双方都确认后 status→signed
export async function handleSignContract(db, contractId, body, req) {
  const userId = parseInt(body.userId);
  const ct = await dbGet(db, 'SELECT * FROM contracts WHERE id=?', [contractId]);
  if (!ct) return error(MSG.CONTRACT_NOT_FOUND, 404);
  if (ct.status !== 'signing') return error(MSG.CONTRACT_STATE_INVALID, 409);
  const conv = await convOf(db, ct.conversation_id);
  if (!isParticipant(conv, userId)) return error(MSG.NO_PERMISSION, 403);
  if (!(await verifySignOtp())) return error(MSG.CONTRACT_STATE_INVALID, 403);

  const col = userId === ct.drafter_user_id ? 'drafter_confirmed' : 'other_confirmed';
  await dbRun(db, `UPDATE contracts SET ${col}=1, updated_at=datetime('now','localtime') WHERE id=?`, [contractId]);
  const updated = await dbGet(db, 'SELECT * FROM contracts WHERE id=?', [contractId]);
  const both = !!(updated.drafter_confirmed && updated.other_confirmed);
  if (both) {
    await dbRun(db, `UPDATE contracts SET status='signed' WHERE id=?`, [contractId]);
    await notifyUser(db, otherSide(conv, userId), MSG.CONTRACT_SIGNED);
  } else {
    await notifyUser(db, otherSide(conv, userId), MSG.CONTRACT_SIGN_WAITING);
  }
  logEvent(db, { action: both ? 'contract.signed' : 'contract.sign_partial', actorUserId: userId,
    entity: 'contract', entityId: contractId, req });
  return json({ ok: true, signed: both });
}

// PUT /api/contracts/:id { userId, contractMd } —— 修改正式合同：重置双方确认，实时同步给另一边
export async function handleModifyContract(db, contractId, body, req) {
  const userId = parseInt(body.userId);
  const ct = await dbGet(db, 'SELECT * FROM contracts WHERE id=?', [contractId]);
  if (!ct) return error(MSG.CONTRACT_NOT_FOUND, 404);
  if (ct.status !== 'signing') return error(MSG.CONTRACT_STATE_INVALID, 409);
  const conv = await convOf(db, ct.conversation_id);
  if (!isParticipant(conv, userId)) return error(MSG.NO_PERMISSION, 403);
  const md = String(body.contractMd || '').slice(0, 30000);
  if (!md.trim()) return error(MSG.CONTRACT_EMPTY);

  await dbRun(db,
    `UPDATE contracts SET contract_md=?, drafter_confirmed=0, other_confirmed=0, updated_at=datetime('now','localtime') WHERE id=?`,
    [md, contractId]);
  await notifyUser(db, otherSide(conv, userId), MSG.CONTRACT_MODIFIED);
  logEvent(db, { action: 'contract.modify', actorUserId: userId, entity: 'contract', entityId: contractId, req });
  return json({ ok: true });
}

// DELETE /api/contracts/:id { userId } —— 取消签约：删合同 + 通知对方；会话保留
export async function handleCancelContract(db, contractId, body, req) {
  const userId = parseInt(body.userId);
  const ct = await dbGet(db, 'SELECT * FROM contracts WHERE id=?', [contractId]);
  if (!ct) return error(MSG.CONTRACT_NOT_FOUND, 404);
  if (ct.status === 'signed') return error(MSG.CONTRACT_STATE_INVALID, 409);
  const conv = await convOf(db, ct.conversation_id);
  if (!isParticipant(conv, userId)) return error(MSG.NO_PERMISSION, 403);

  await dbRun(db, 'DELETE FROM contracts WHERE id=?', [contractId]);
  await notifyUser(db, otherSide(conv, userId), MSG.CONTRACT_CANCELLED);
  logEvent(db, { action: 'contract.cancel', actorUserId: userId, entity: 'contract', entityId: contractId, req });
  return json({ ok: true });
}

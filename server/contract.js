/**
 * 合同模块（测试版签约链路）：
 *   起草草案(聊天窗+) → 对方确认草案 → 「我的合同」预览正式合同 → 双方确认签约 → signed（评价门槛 dbIsContracted 随之放行）
 *   任一阶段可取消签约（删合同 + 通知对方，会话保留）；signing 阶段任意一方可改合同（重置双方确认，实时同步）。
 * 正式合同正文由 buildContractMd 按草案信息生成（Markdown，后期可换更正式的格式）；双方看到的是同一条记录。
 * 短信验证码环节未接入：verifySignOtp 预留接口，测试版以二次确认代替。
 */
import { dbGet, dbAll, dbRun, json, error, authUser, requireAdminOrError, confirmDangerOtp, bufToHex, MSG, STATUS } from './core.js';
import {
  dbGetContractById, dbGetContractByConv, dbGetMyContracts, dbGetAllContractsAdmin,
  dbDeleteContract, dbDeleteContractMessages,
  dbGetConversationWithNames, dbGetDemandById, dbCreateMessage,
  dbGetPendingIntentsForDemand, dbGetPendingPushesForDemand,
} from './db.js';
import { notifyUser } from './notify.js';
import { logEvent } from './log.js';
import '../constants.js'; // 副作用导入：一切发给用户看的文案统一走 globalThis.APP_CONSTANTS.UI（constants.js 收口）
const UIC = globalThis.APP_CONSTANTS.UI;

// 根据草案信息生成正式合同正文。条款要素依《民法典》第四百七十条一般条款拟定
// （当事人/标的/数量质量/价款/履行期限地点方式/违约责任/争议解决），家教场景展开为九条。
// 授课地点按隐私合规采用模糊表述（甲方常住处等），不收集详细门牌号。
// 薪资三要素（结算方式/首课日期/试课方案）由起草表单采集；选「其他」时带入用户自拟文字。
function buildContractMd({ teacherName, studentName, method, schedule, location, plan, rate, createdAt, demandNo, payMethod, payMethodOther, firstLessonDate, trialPay, trialPayOther }) {
  const methodName = method === 'offline' ? '线下授课' : '线上授课';
  const locationText = location || (method === 'offline' ? '甲方常住处或双方另行约定的地点' : '双方约定的线上课堂');
  const PAY_METHOD_TEXT = { per_session: '次付（按次结算，每次课程结束后支付）', weekly: '周付（每周结算一次）', monthly: '月付（每月结算一次）' };
  const TRIAL_PAY_TEXT = { first_free: '第一次试课免费', first_hour_free: '第一小时免费，第二小时起按约定时薪收费', normal: '试课全程正常收费' };
  const payText = payMethod === 'other' ? (payMethodOther || '由双方另行约定') : (PAY_METHOD_TEXT[payMethod] || '由双方另行约定');
  const trialText = trialPay === 'other' ? (trialPayOther || '由双方另行约定') : (TRIAL_PAY_TEXT[trialPay] || '由双方另行约定');
  return `# 家教服务合同

**甲方（学生方）**：${studentName}
**乙方（教师方）**：${teacherName}
${demandNo ? `**关联需求编号**：#${demandNo}
` : ''}**签署日期**：${createdAt || ''}

甲乙双方本着平等、自愿、诚实信用的原则，依照《中华人民共和国民法典》及相关法律法规，经友好协商，就家教服务事宜达成如下协议：

## 第一条 服务内容与授课安排

1. 授课方式：${methodName}。
2. 授课科目与内容：详见本合同第五条「教学方案」。
3. 首次上课日期：${firstLessonDate || '由双方另行协商确定'}。
4. 授课时间：${schedule || '由双方另行协商确定'}。
5. 授课地点：${locationText}。

## 第二条 课时费与支付

1. 约定时薪为每小时 **${rate}** 元（人民币）。
2. 薪资结算方式：${payText}。甲方应按约定如期支付课时费用。
3. 试课薪资方案：${trialText}。
4. 平台仅提供信息撮合与合同存证服务，不参与费用结算。

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
  // 网安报告 F-07 幂等补列（PRAGMA 探测，仿 log.js 就地迁移；contract.js 不可 import db.js 的
  // ensureColumns——db.js→contract.js 已存在 import 方向，反向即循环）：seq 全链序号 + body_hash
  // 正文哈希分解值（content_hash 输入之一，独立落列供审计交叉验证）
  const info = await dbAll(db, 'PRAGMA table_info(contract_ledger)');
  const have = new Set(info.map(c => c.name));
  if (!have.has('seq')) await dbRun(db, 'ALTER TABLE contract_ledger ADD COLUMN seq INTEGER');
  if (!have.has('body_hash')) await dbRun(db, "ALTER TABLE contract_ledger ADD COLUMN body_hash TEXT NOT NULL DEFAULT ''");
  // 存量行 seq 按 id 序（即入链序）回填；历史条目正文已不在库内（合同可被修改），body_hash 保持空串，
  // 校验时仅做链结构（GENESIS + prev 连续性）——中间条目被篡改即断链，正文重放限最新条目
  await dbRun(db, `UPDATE contract_ledger SET seq=(SELECT COUNT(*) FROM contract_ledger c2 WHERE c2.id<=contract_ledger.id) WHERE seq IS NULL`);
}

const sha256Hex = text => crypto.subtle.digest('SHA-256', new TextEncoder().encode(text)).then(bufToHex);

// 台账链哈希原文（网安报告 F-07）：content_hash 必须覆盖「正文 + contract_id + created_at + prev_hash」，
// 否则拥有 DB 写权限者可重建整条台账而不被检出。正文哈希先取（防原文过长重复计算），再与元数据串成链。
async function ledgerContentHash(contractId, contractMd, createdAt, prevHash) {
  const bodyHash = await sha256Hex(contractMd);
  return sha256Hex(`${bodyHash}|${contractId}|${createdAt}|${prevHash}`);
}

// 签署存证：记账 contract_id + 链式哈希（prev_hash 参与本条目哈希，篡改任一历史条目都会断链）。
// 网安报告 F-07 原子化：prev 取数、seq 取号与插入同一条 INSERT 内完成，并把 JS 侧已见的 prev 回带
// 作 WHERE 条件——并发记账时分叉方（库内 prev 已变）changes=0，重读重算重试，杜绝同 prev 双挂
async function ledgerRecord(db, contractId, contractMd) {
  const target = getLedgerDb(db);
  const bodyHash = await sha256Hex(contractMd);
  const createdAt = new Date().toISOString().slice(0, 19).replace('T', ' ');
  for (let i = 0; i < 3; i++) {
    const prev = await dbGet(target, 'SELECT content_hash FROM contract_ledger ORDER BY id DESC LIMIT 1');
    const prevHash = prev ? prev.content_hash : 'GENESIS';
    const contentHash = await ledgerContentHash(contractId, contractMd, createdAt, prevHash);
    const r = await dbRun(target, `INSERT INTO contract_ledger (contract_id, content_hash, prev_hash, seq, body_hash, created_at)
      SELECT ?, ?, COALESCE((SELECT content_hash FROM contract_ledger ORDER BY id DESC LIMIT 1),'GENESIS'),
             COALESCE((SELECT MAX(seq) FROM contract_ledger),0)+1, ?, ?
      WHERE COALESCE((SELECT content_hash FROM contract_ledger ORDER BY id DESC LIMIT 1),'GENESIS') = ?`,
      [contractId, contentHash, bodyHash, createdAt, prevHash]);
    if (r.meta.changes > 0) return contentHash;
  }
  throw new Error('ledger insert retry exhausted'); // 3 次仍未抢到链尾：台账写入失败让请求 500，绝不静默断链
}

// 全链遍历校验（网安报告 F-07，纯函数可注入测试）：链头 GENESIS + 相邻 prev_hash 连续性 + seq 单调。
// 历史条目正文不在库内（合同可被修改多版），篡改任一历史条目 content_hash 即与后续 prev_hash 断链被检出；
// 最新条目正文可重放（opts 带当前正文时），合同已撤销（archived，无正文）只做链结构校验
export async function verifyChain(rows, opts = {}) {
  const headValid = rows.length ? rows[0].prev_hash === 'GENESIS' : false;
  let linksValid = true, seqValid = true;
  for (let i = 1; i < rows.length; i++) {
    if (rows[i].prev_hash !== rows[i - 1].content_hash) linksValid = false;
    if (rows[i].seq != null && rows[i - 1].seq != null && rows[i].seq !== rows[i - 1].seq + 1) seqValid = false;
  }
  let lastRehashValid = null;
  if (rows.length && !opts.archived && opts.contractId != null && opts.contractMd != null) {
    const last = rows[rows.length - 1];
    lastRehashValid = (await ledgerContentHash(opts.contractId, opts.contractMd, last.created_at, last.prev_hash)) === last.content_hash;
  }
  return { headValid, linksValid, seqValid, lastRehashValid, ok: headValid && linksValid && seqValid };
}

// 校验：全链遍历（链头 + 连续性 + 最新条目正文重放）。合同行被撤销时台账仍在，返回 archived 状态。
// 与 ledgerRecord 用同一条 hash 拼装规则，保证「存进去什么就校验什么」
async function verifyContractLedger(db, contractId) {
  const rows = await dbAll(getLedgerDb(db),
    'SELECT id, contract_id, content_hash, prev_hash, seq, body_hash, created_at FROM contract_ledger WHERE contract_id=? ORDER BY id ASC', [contractId]);
  if (!rows.length) return { recorded: false };
  const ct = await dbGetContractById(db, contractId);
  const archived = !ct;
  const chain = await verifyChain(rows, archived ? {} : { contractId, contractMd: ct.contract_md });
  const last = rows[rows.length - 1];
  return {
    recorded: true, archived,
    valid: chain.ok && chain.lastRehashValid !== false, // archived 无正文可重放（lastRehashValid=null），以链结构为准
    entries: rows.length, headValid: chain.headValid, linksValid: chain.linksValid, seqValid: chain.seqValid,
    contentHash: last.content_hash, prevHash: last.prev_hash, createdAt: last.created_at,
  };
}

// ---- 会话参与方判定 helper（会话行经 dbGetConversationWithNames 取，带双方用户名）----
const isParticipant = (conv, userId) => !!conv && (conv.student_user_id === userId || conv.teacher_user_id === userId);
const otherSide = (conv, userId) => userId === conv.student_user_id ? conv.teacher_user_id : conv.student_user_id;
const nameOf = (conv, userId) => userId === conv.student_user_id ? conv.student_name : conv.teacher_name;

// 合同操作公共关口：取合同行（404）→ 状态白名单（409）→ 会话带双方名 → 参与方校验（403）。
// 六个状态机 handler 的前置检查收敛于此；失败返 { err: Response }，调用方一行 `if (g.err) return g.err;`
async function loadContractFor(db, contractId, userId, statuses) {
  const ct = await dbGetContractById(db, contractId);
  if (!ct) return { err: error(MSG.CONTRACT_NOT_FOUND, 404) };
  if (!statuses.includes(ct.status)) return { err: error(MSG.CONTRACT_STATE_INVALID, 409) };
  const conv = await dbGetConversationWithNames(db, ct.conversation_id);
  if (!isParticipant(conv, userId)) return { err: error(MSG.NO_PERMISSION, 403) };
  return { ct, conv };
}

// ---- 路由 ----

// POST /api/contracts { userId, conversationId, method, plan, hourlyRate } —— 起草并发送给另一方
export async function handleCreateContract(db, body, req) {
  const me = await authUser(db, req);
  if (!me) return error(MSG.LOGIN_REQUIRED, 401);
  const userId = me.id;
  const conversationId = parseInt(body.conversationId);
  const conv = await dbGetConversationWithNames(db, conversationId);
  if (!isParticipant(conv, userId)) return error(MSG.NO_PERMISSION, 403);
  const existing = await dbGetContractByConv(db, conversationId);
  if (existing) return error(MSG.CONTRACT_EXISTS, 409);

  const method = body.method === 'offline' ? 'offline' : 'online';
  const plan = String(body.plan || '').slice(0, 20000);
  const rate = Math.max(0, parseInt(body.hourlyRate) || 0);
  const schedule = String(body.schedule || '').slice(0, 500);
  const location = String(body.location || '').slice(0, 200);
  // 薪资三要素：白名单枚举 + 「其他」自拟文字；首课日期取 yyyy-mm-dd（date input 原值）
  const payMethod = ['per_session', 'weekly', 'monthly', 'other'].includes(body.payMethod) ? body.payMethod : '';
  const payMethodOther = payMethod === 'other' ? String(body.payMethodOther || '').trim().slice(0, 100) : '';
  if (payMethod === 'other' && !payMethodOther) return error(MSG.INVALID_PARAMS, 400);
  const firstLessonDate = /^\d{4}-\d{2}-\d{2}$/.test(String(body.firstLessonDate || '')) ? body.firstLessonDate : '';
  const trialPay = ['first_free', 'first_hour_free', 'normal', 'other'].includes(body.trialPay) ? body.trialPay : '';
  const trialPayOther = trialPay === 'other' ? String(body.trialPayOther || '').trim().slice(0, 100) : '';
  if (trialPay === 'other' && !trialPayOther) return error(MSG.INVALID_PARAMS, 400);
  // 合同绑定需求：起草时显式选择（缺省回落到会话自带的需求）；
  // 后端硬校验：绑定的需求必须属于会话学生方（防越权绑他人需求），统一入口把关
  let demandId = parseInt(body.demandId) || conv.demand_id || null;
  let demandNo = '';
  if (demandId) {
    const dm = await dbGetDemandById(db, demandId);
    if (!dm) return error(MSG.DEMAND_NOT_FOUND, 404); // F-03b：需求已删（删除端有原子守卫，此处是创建端复核；INSERT 守卫再堵 SELECT→INSERT 竞态窗口）
    if (dm.user_id !== conv.student_user_id) return error(MSG.NO_PERMISSION, 403);
    if (dm.status === STATUS.CONTRACTED) return error(MSG.DEMAND_CONTRACTED_CLOSED, 410); // 已签约需求不可再绑新合同
    if (dm.display_id) demandNo = String(dm.display_id).padStart(4, '0');
  }
  const md = buildContractMd({
    teacherName: conv.teacher_name, studentName: conv.student_name,
    method, schedule, location, plan, rate, createdAt: new Date().toISOString().slice(0, 10), demandNo,
    payMethod, payMethodOther, firstLessonDate, trialPay, trialPayOther,
  });
  const res = await dbRun(db,
    `INSERT INTO contracts (conversation_id, drafter_user_id, demand_id, method, schedule, location, plan, hourly_rate, contract_md,
        pay_method, pay_method_other, first_lesson_date, trial_pay, trial_pay_other)
     SELECT ?,?,?,?,?,?,?,?,?,?,?,?,?,?
     WHERE NOT EXISTS (SELECT 1 FROM contracts WHERE conversation_id=? AND status IN ('pending','signing'))
       AND (? IS NULL OR EXISTS (SELECT 1 FROM student_demands WHERE id=?))`,
    [conversationId, userId, demandId, method, schedule, location, plan, rate, md,
     payMethod, payMethodOther, firstLessonDate, trialPay, trialPayOther, conversationId, demandId, demandId]);
  // 并发双起草防护：NOT EXISTS 命中既有进行中合同则 changes=0，仅赢家继续（前置 existing 检查是快路径，此处是竞态闸门）；
  // 附加需求存在守卫：SELECT→INSERT 窗口内需求被并发删除则同样 changes=0，判别后报 404（不误报 409）
  if (!(res && res.meta && res.meta.changes > 0)) {
    if (demandId && !(await dbGetDemandById(db, demandId))) return error(MSG.DEMAND_NOT_FOUND, 404);
    return error(MSG.CONTRACT_EXISTS, 409);
  }
  const id = (res && res.meta && res.meta.last_row_id) || 0;
  // 聊天窗合同事件气泡：落一条 kind=contract 的系统消息（文案由前端按查看者渲染），双方会话内均可见
  await dbCreateMessage(db, conversationId, userId, 'contract', 'contract_draft');
  await notifyUser(db, otherSide(conv, userId), UIC.CONTRACT_DRAFT_SENT.replace('{name}', nameOf(conv, userId)));
  await logEvent(db, { action: 'contract.create', actorUserId: userId, entity: 'contract', entityId: id,
    detail: { conversationId, method, rate }, req });
  return json({ id, message: UIC.CONTRACT_DRAFT_SENT_TOAST }, 201);
}

// GET /api/contracts/my → { contracts }（身份凭令牌）
export async function handleGetMyContracts(db, url, req) {
  const me = await authUser(db, req);
  if (!me) return error(MSG.LOGIN_REQUIRED, 401);
  return json({ contracts: await dbGetMyContracts(db, me.id) });
}

// POST /api/contracts/:id/sign —— 确认签约；双方都确认后 status→signed
export async function handleSignContract(db, contractId, body, req) {
  const me = await authUser(db, req);
  if (!me) return error(MSG.LOGIN_REQUIRED, 401);
  const userId = me.id;
  // pending（收草案方直接确认签约，免去独立「确认草案」步骤）与 signing 均可签
  const g = await loadContractFor(db, contractId, userId, [STATUS.PENDING, STATUS.SIGNING]);
  if (g.err) return g.err;
  const { ct, conv } = g;
  // 危险操作二次认证（网安报告 F-05）：签约须凭 re-auth 换发的一次性 capToken（原恒通过）
  if (!(await confirmDangerOtp(userId, body))) return error(MSG.REAUTH_FAILED, 403);

  const col = userId === ct.drafter_user_id ? 'drafter_confirmed' : 'other_confirmed';
  // 条件 UPDATE + changes 赢家模式：AND status 守卫确保对已离开 pending/signing 的合同（被取消/已签约）
  // 不产生任何改动；changes=0 方重读当前态幂等返回，不触发任何副作用
  const flag = await dbRun(db, `UPDATE contracts SET ${col}=1, status='signing', updated_at=datetime('now','localtime') WHERE id=? AND status IN ('pending','signing')`, [contractId]);
  if (!(flag && flag.meta && flag.meta.changes > 0)) {
    const cur = await loadContractFor(db, contractId, userId, [STATUS.PENDING, STATUS.SIGNING, STATUS.SIGNED]);
    if (cur.err) return cur.err;
    return json({ ok: true, signed: cur.ct.status === STATUS.SIGNED });
  }
  const updated = await dbGetContractById(db, contractId);
  if (!updated) return error(MSG.CONTRACT_NOT_FOUND, 404); // 置位后对方并发撤销致行消失：干净 404，不抛 500
  const both = !!(updated.drafter_confirmed && updated.other_confirmed);
  if (both) {
    let claimed = false;
    if (updated.demand_id) {
      // 原子签约（网安报告 F-03）：合同 signed 与需求 contracted 在同一 batch 事务内完成。
      // 合同 UPDATE 带 NOT EXISTS 条件——需求已被任何合同签约（status='contracted'）时本合同不进入 signed，
      // 抢占失败合同保持 signing（无回滚、无死锁），返回 410。杜绝「第二方签约 410 但合同已 signed」的线上事故。
      const r = await db.batch([
        db.prepare(`UPDATE contracts SET status='signed' WHERE id=? AND status='signing'
          AND NOT EXISTS(SELECT 1 FROM student_demands WHERE id=? AND status='contracted')`).bind(contractId, updated.demand_id),
        db.prepare(`UPDATE student_demands SET status='contracted' WHERE id=? AND status<>'contracted'`).bind(updated.demand_id),
      ]);
      claimed = !!(r && r[0] && r[0].meta && r[0].meta.changes > 0);
      if (!claimed) return error(MSG.DEMAND_CONTRACTED_CLOSED, 410);
    } else {
      // 未绑定需求：纯合同签约，条件 UPDATE 赢家模式（双方同时签约仅一方 changes>0）
      const claim = await dbRun(db, `UPDATE contracts SET status='signed' WHERE id=? AND status='signing'`, [contractId]);
      claimed = !!(claim && claim.meta && claim.meta.changes > 0);
    }
    if (claimed) {
    // 存证入台账（独立保障库优先）：文本哈希 + 哈希链，撤销合同删活跃行时留档仍不可篡改地保留
    const contentHash = await ledgerRecord(db, contractId, updated.contract_md);
    // 需求自动下架广场；该需求上其余教师待处理意向与待处理推送由系统统一拒绝
    // （action=intent.auto_reject / demand_push.auto_reject，与用户手动拒绝在加密留档中区分）
    if (updated.demand_id) {
      const pending = await dbGetPendingIntentsForDemand(db, updated.demand_id);
      for (const it of pending) {
        const r = await dbRun(db, `UPDATE demand_intents SET status='rejected', resolved_at=datetime('now','localtime') WHERE id=? AND status='pending'`, [it.id]);
        if (!(r && r.meta && r.meta.changes > 0)) continue; // 赢家模式：已被并发处理的行不重复留档
        await logEvent(db, { action: 'intent.auto_reject', actorRole: 'system', entity: 'intent', entityId: it.id,
          detail: { demandId: updated.demand_id, teacherUserId: it.teacher_user_id, reason: 'demand_contracted' }, req });
      }
      const pendingPushes = await dbGetPendingPushesForDemand(db, updated.demand_id);
      for (const pp of pendingPushes) {
        const r = await dbRun(db, `UPDATE demand_pushes SET status='rejected' WHERE id=? AND status='pending'`, [pp.id]);
        if (!(r && r.meta && r.meta.changes > 0)) continue; // 赢家模式：已被并发处理的行不重复留档
        await logEvent(db, { action: 'demand_push.auto_reject', actorRole: 'system', entity: 'demand_push', entityId: pp.id,
          detail: { demandId: updated.demand_id, teacherUserId: pp.teacher_user_id, reason: 'demand_contracted' }, req });
      }
    }
    await notifyUser(db, otherSide(conv, userId), UIC.CONTRACT_SIGNED);
    // 留档保存合同原文（detailMax 放宽，加密后落库；撤销合同后仍可凭留档还原缔约内容）
    await logEvent(db, { action: 'contract.signed', actorUserId: userId, entity: 'contract', entityId: contractId,
      detail: { conversationId: updated.conversation_id, demandId: updated.demand_id, contentHash, contractMd: updated.contract_md },
      detailMax: 60000, req });
    }
  } else {
    await notifyUser(db, otherSide(conv, userId), UIC.CONTRACT_SIGN_WAITING.replace('{name}', nameOf(conv, userId)));
    await logEvent(db, { action: 'contract.sign_partial', actorUserId: userId, entity: 'contract', entityId: contractId, req });
  }
  return json({ ok: true, signed: both });
}

// PUT /api/contracts/:id { contractMd } —— 修改正式合同：重置双方确认，实时同步给另一边
export async function handleModifyContract(db, contractId, body, req) {
  const me = await authUser(db, req);
  if (!me) return error(MSG.LOGIN_REQUIRED, 401);
  const userId = me.id;
  const g = await loadContractFor(db, contractId, userId, [STATUS.PENDING, STATUS.SIGNING]);
  if (g.err) return g.err;
  const { ct, conv } = g;
  // 乐观锁版本号为必填：客户端打开编辑器时的 updated_at 须随请求带来，缺失即参数错误
  if (!body.updatedAt) return error(MSG.INVALID_PARAMS, 400);
  const md = String(body.contractMd || '').slice(0, 30000);
  if (!md.trim()) return error(MSG.CONTRACT_EMPTY);
  if (md === ct.contract_md) return json({ ok: true, unchanged: true }); // 内容未变：幂等短路，不重置确认/不重发通知（防双触发重复通知）

  // 修改即回退到签约选择态：双方确认清零 + pending→signing，两边都回到 确认/修改/查看 三按钮。
  // 乐观锁落 SQL WHERE：版本不符（对方刚改完）或状态已离开 pending/signing（已签约/被取消）→ changes=0 → 409 强制重载（也杜绝修改复活已签约合同）
  const upd = await dbRun(db,
    `UPDATE contracts SET contract_md=?, drafter_confirmed=0, other_confirmed=0, status='signing', updated_at=datetime('now','localtime')
     WHERE id=? AND updated_at=? AND status IN ('pending','signing')`,
    [md, contractId, String(body.updatedAt)]);
  if (!(upd && upd.meta && upd.meta.changes > 0)) return error(MSG.CONTRACT_MODIFIED_CONFLICT, 409);
  await notifyUser(db, otherSide(conv, userId), UIC.CONTRACT_MODIFIED.replace('{name}', nameOf(conv, userId)));
  await logEvent(db, { action: 'contract.modify', actorUserId: userId, entity: 'contract', entityId: contractId, req });
  return json({ ok: true });
}

// POST /api/contracts/:id/revoke —— 撤销已签约合同（仅限双方已约定终止的场景，前端 2 次确认 + 法律后果提示）：
// 活跃库抹掉合同行与合同气泡；签署台账与加密留档保留（不可篡改的历史凭证）；通知对方。
// 后期接入短信验证（confirmDangerOtp，现恒通过）
export async function handleRevokeContract(db, contractId, body, req) {
  const me = await authUser(db, req);
  if (!me) return error(MSG.LOGIN_REQUIRED, 401);
  const g = await loadContractFor(db, contractId, me.id, [STATUS.SIGNED]); // 未签约的走取消流程
  if (g.err) return g.err;
  const { ct, conv } = g;
  if (!(await confirmDangerOtp(me.id, body))) return error(MSG.REAUTH_FAILED, 403); // 二次认证（F-05）
  const del = await dbDeleteContract(db, contractId);
  if (!(del && del.meta && del.meta.changes > 0)) return error(MSG.CONTRACT_NOT_FOUND, 404); // 并发双撤销仅赢家执行清理与通知
  await dbDeleteContractMessages(db, ct.conversation_id);
  // 需求标记为「合同已撤销」：不自动重开（防随意锁定/重开扰动），由需求所有者在「我的需求」手动重开
  if (ct.demand_id) await dbRun(db, `UPDATE student_demands SET status='revoked' WHERE id=? AND status='contracted'`, [ct.demand_id]);
  await notifyUser(db, otherSide(conv, me.id), UIC.CONTRACT_REVOKED_NOTIFY.replace('{name}', nameOf(conv, me.id)));
  await logEvent(db, { action: 'contract.revoke', actorUserId: me.id, entity: 'contract', entityId: contractId,
    detail: { conversationId: ct.conversation_id, demandId: ct.demand_id, note: 'ledger_retained' }, req });
  return json({ ok: true });
}

// GET /api/contracts/:id/verify —— 存证校验：重算文本哈希对比台账（仅会话参与方与管理员可用）
export async function handleVerifyContract(db, contractId, req) {
  const me = await authUser(db, req);
  if (!me) return error(MSG.LOGIN_REQUIRED, 401);
  const ct = await dbGetContractById(db, contractId);
  if (!ct) return error(MSG.CONTRACT_NOT_FOUND, 404);
  const conv = await dbGetConversationWithNames(db, ct.conversation_id);
  const admin = me.role === 'admin';
  if (!admin && !isParticipant(conv, me.id)) return error(MSG.NO_PERMISSION, 403);
  return json(await verifyContractLedger(db, contractId));
}

// GET /api/admin/contracts?username= —— 管理员查看全部合同（网页测试用途，真实场景仅管理员可见此页）
export async function handleAdminListContracts(db, url, req) {
  const e = requireAdminOrError(await authUser(db, req));
  if (e) return e;
  const contracts = await dbGetAllContractsAdmin(db);
  return json({ contracts });
}

// DELETE /api/admin/contracts/:id { username } —— 管理员移除合同（测试用；合同全链路留档，删除记 admin.contract.remove）
export async function handleAdminRemoveContract(db, contractId, body, req) {
  const admin = await authUser(db, req);
  const e = requireAdminOrError(admin);
  if (e) return e;
  const ct = await dbGetContractById(db, contractId);
  if (!ct) return error(MSG.CONTRACT_NOT_FOUND, 404);
  await dbDeleteContract(db, contractId);
  await logEvent(db, { action: 'admin.contract.remove', actorUserId: admin.id, actorUsername: admin.username,
    actorRole: 'admin', entity: 'contract', entityId: contractId,
    detail: { conversationId: ct.conversation_id, status: ct.status, drafterUserId: ct.drafter_user_id }, req });
  return json({ ok: true });
}

// DELETE /api/contracts/:id —— 取消签约：删合同 + 通知对方；会话保留
export async function handleCancelContract(db, contractId, body, req) {
  const me = await authUser(db, req);
  if (!me) return error(MSG.LOGIN_REQUIRED, 401);
  const userId = me.id;
  const g = await loadContractFor(db, contractId, userId, [STATUS.PENDING, STATUS.SIGNING]);
  if (g.err) return g.err;
  const { conv } = g;

  const del = await dbDeleteContract(db, contractId);
  if (!(del && del.meta && del.meta.changes > 0)) return json({ ok: true }); // 并发对方已先取消：赢家已通知，此处不重复副作用
  await notifyUser(db, otherSide(conv, userId), UIC.CONTRACT_CANCELLED.replace('{name}', nameOf(conv, userId)));
  await logEvent(db, { action: 'contract.cancel', actorUserId: userId, entity: 'contract', entityId: contractId, req });
  return json({ ok: true });
}

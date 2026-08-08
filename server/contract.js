/**
 * 合同模块（测试版签约链路）—— 合同状态机 + 存证台账（覆写域，CLAUDE.md 有意决定：台账 SQL 自持本模块）
 *   起草草案(聊天窗+) → 对方确认草案 → 「我的合同」预览正式合同 → 双方确认签约 → signed（评价门槛随之放行）
 *   任一阶段可取消签约（删合同 + 通知对方，会话保留）；signing 阶段任意一方可改合同（重置双方确认，实时同步）。
 * 正式合同正文由 buildContractMd 按草案信息生成（Markdown）；双方看到的是同一条记录。
 * 短信验证码环节未接入：verifySignOtp 预留，测试版以二次确认代替（二次认证走 danger-ops.confirmDangerOtp）。
 *
 * 安全补丁已并入主线：
 *   F-03  签约与需求下架同 batch 原子；NOT EXISTS 防第二方签约；删需求原子守卫
 *   F-05  签约/撤销危险操作须 capToken 二次认证
 *   F-07  存证台账哈希链（GENESIS + prev 连续性 + seq），篡改任何历史条目即断链
 *   本版修复：台账幂等（签约后 500 重试可补记）；revoked 需求不可绕过「手动重开」再签约；
 *   合同修改乐观锁改 version 整数（秒级 updated_at 同秒双改互相覆盖的缺陷）。
 */
import { dbGet, dbAll, dbRun, json, error, ensureColumns } from './util.js';
import { requireUser, requireAdmin, requireAdminOrError } from './security.js';
import { bufToHex, encryptField, decryptField } from './crypto.js';
import { confirmDangerOtp } from './danger-ops.js'; // 危险操作二次认证（D1 持久化，跨实例一致，网安审计 N-02）
import { MSG, STATUS } from './constants.js';
import {
  dbGetContractById, dbGetContractByConv, dbGetMyContracts, dbGetAllContractsAdmin,
  dbDeleteContract, dbDeleteContractMessages,
  dbGetConversationWithNames, dbGetDemandById, dbCreateMessage,
} from './db.js';
import { notifyUser } from './notify.js';
import { logEvent } from './log.js';
import '../constants.js'; // 副作用导入：一切发给用户看的文案统一走 globalThis.APP_CONSTANTS.UI（constants.js 收口）
const UIC = globalThis.APP_CONSTANTS.UI;

// 根据草案信息生成正式合同正文。条款要素依《民法典》第四百七十条一般条款拟定。
// v0.24.0 拆分：业务条款（服务内容/课时费/教学方案，可由双方协商修改）与法律条款
// （权利义务/违约责任/变更解除/争议解决/生效存证，平台固定不可修改）用唯一注释标记分隔——
// 修改弹窗只放出业务部分，服务端保存时重新拼接固定法律部分（前后端同一常量收口）。
// 授课地点按隐私合规采用模糊表述（甲方常住处等），不收集详细门牌号。
// 薪资三要素（结算方式/首课日期/试课方案）由起草表单采集；选「其他」时带入用户自拟文字。
export const CONTRACT_BUSINESS_END = '<!-- 业务条款结束，以下法律条款由平台固定，不可修改 -->';

// 法律条款部分（不可修改；服务端保存合同时重新拼接此块）
const LEGAL_CLAUSES = `## 第四条 甲方权利与义务

1. 有权要求乙方按照约定的内容与时间安排授课，并对教学质量进行监督；
2. 应按约定支付课时费，并为授课提供必要的学习条件与配合；
3. 如需调整课程安排，应提前与乙方协商并达成一致；
4. 对通过平台获取的教师个人信息，仅用于本次家教服务目的，不得向第三方泄露。

## 第五条 乙方权利与义务

1. 有权按约定获取课时报酬；
2. 应按约定认真备课、授课，保证教学质量；
3. 如需调整课程安排，应提前与甲方协商并达成一致；
4. 对授课过程中知悉的学生个人信息与学习情况予以保密，不得向第三方泄露。

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

双方约定：以平台账号登录、签署时密码二次确认、服务端签署时间戳以及全文内容哈希存证，共同构成本合同电子签署的可靠条件（《中华人民共和国电子签名法》第十三条第二款），与手写签名或盖章具有同等法律效力。

---

`;

// 第十条 签署记录由 buildSignatureBlock 动态生成并内嵌合同正文末尾（随每次签署重拼，
// 修改/重拼时位于法律条款之后自动丢弃重建，见 rebuildFullMd）——不含占位符，避免显式空占位

/** 业务部分 + 标记 + 固定法律部分 → 完整合同正文（v0.24.0） */
export function contractWithLegal(businessMd) {
  const biz = String(businessMd || '').trim();
  return `${biz}\n\n${CONTRACT_BUSINESS_END}\n\n${LEGAL_CLAUSES}`;
}

// 第十条 签署记录（v0.25.37 签署合规）：把「谁签/何时签」落进合同正文本身。
// mdRender 仅支持 # 标题 + **加粗**，模板只允许这两种语法；不自引用原始哈希——
// 区块内只放合同流水号 #CD{id}，原始 SHA-256 经 /api/contracts/:id/verify 在存证校验面板展示
// （避免「先有哈希才生成正文」的自引用循环）。platform 账号 = 平台用户名（无独立昵称字段）。
// 留痕四要素闭环：身份（账号登录 + 密码二次确认）+ 意愿（阅读确认流）+ 时间（signed_at）+ 内容（哈希链）
export function buildSignatureBlock({ studentName, teacherName, studentSignedAt = '', teacherSignedAt = '', contractId }) {
  const partyLine = (name, signedAt) => signedAt
    ? `**${name}**（平台账号：${name}）\n签署状态：已签署　签署时间：${signedAt}`
    : `**${name}**（平台账号：${name}）\n签署状态：待签署`;
  const flowNo = contractId ? `#CD${String(contractId).padStart(6, '0')}` : '';
  return `

## 第十条 签署记录

双方确认：以下签署人已通过本人平台账号完成实名登录，并凭本人密码二次确认表达签署意愿；平台服务端记录签署时间并留存全文指纹，作为本合同的电子签署凭证。

**甲方（学生方）**：
${partyLine(studentName, studentSignedAt)}

**乙方（教师方）**：
${partyLine(teacherName, teacherSignedAt)}

平台存证：本合同全文 SHA-256 指纹已纳入防篡改存证链${flowNo ? `（存证流水号 ${flowNo}）` : ''}，任一方可随时通过平台「存证校验」核对文本一致性。`;
}

// 重拼完整正文（业务 + 法律 + 第十条 签署记录）：
// 旧签名区块位于法律条款之后，以「当前业务部分」重拼时被自动丢弃、按当前签署态重建——
// 修改（PUT 清 signed_at）与每次签署共用此函数，保证 contract_md 始终反映最新签署状态。
// 旧格式合同（v0.24.0 前无标记）不重拼（同 handleModifyContract 的旧格式保护，防法律条款双份）
function rebuildFullMd(ct, conv) {
  const md = String(ct.contract_md || '');
  if (!md.includes(CONTRACT_BUSINESS_END)) return md;
  const biz = md.split(CONTRACT_BUSINESS_END)[0].trim();
  return contractWithLegal(biz) + buildSignatureBlock({
    studentName: conv.student_name, teacherName: conv.teacher_name,
    studentSignedAt: ct.drafter_signed_at || '', teacherSignedAt: ct.other_signed_at || '',
    contractId: ct.id,
  });
}

// v0.25.41（注销幽灵数据）：注销时把涉事合同正文中的本人用户名匿名化为墓碑。
// 合同是双方数据保留，但正文嵌入的是起草时/签署时的原始用户名（业务头「**甲方（学生方）**：原名」+
// 第十条签署记录「**原名**（平台账号：原名）」）——不匿名化则对方可经合同正文读到已注销用户真实用户名，
// 墓碑机制被绕过。台账 append-only：重写后的正文追加一条哈希入链（verify 重放当前正文仍通过），原链完整保留。
// origName：注销前的原始用户名（dbDeactivateUser 墓碑化前捕获）；isStudent：本人在会话中的角色（甲方/乙方）。
export async function anonymizeContractPartyNames(db, userId, origName, isStudent) {
  const tomb = `${globalThis.APP_CONSTANTS.UI.DEACTIVATED_USER_PREFIX}#${userId}`;
  const label = isStudent ? '甲方（学生方）' : '乙方（教师方）';
  const escRe = s => String(s).replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const re1 = new RegExp(`(\\*\\*${label}\\*\\*：)[^\\n\\r]+`, 'g');   // 业务头内联名
  const re2 = new RegExp(`(\\*\\*${escRe(origName)}\\*\\*（平台账号：)${escRe(origName)}(）)`, 'g'); // 签署记录
  const rows = await dbAll(db, `SELECT ct.id, ct.contract_md, ct.prev_business
    FROM contracts ct JOIN conversations c ON c.id=ct.conversation_id
    WHERE ${isStudent ? 'c.student_user_id' : 'c.teacher_user_id'}=?`, [userId]);
  for (const row of rows) {
    const md = await decryptField(row.contract_md || '');
    if (!md || !md.includes(origName)) continue;
    const next = md.replace(re1, `$1${tomb}`).replace(re2, `**${tomb}**（平台账号：${tomb}$2`);
    if (next === md) continue;
    const pb = row.prev_business ? String(await decryptField(row.prev_business)).replace(re1, `$1${tomb}`) : null;
    await dbRun(db, `UPDATE contracts SET contract_md=?, prev_business=?, updated_at=datetime('now','localtime') WHERE id=?`,
      [await encryptField(next), pb ? await encryptField(pb) : null, row.id]); // prev_business NULL 保持「无留痕基线」语义
    try { await ledgerRecord(db, row.id, next); } catch (e) { console.error('contract anonymize ledger failed:', e && e.message); }
  }
}

function buildContractMd({ teacherName, studentName, method, schedule, location, plan, rate, createdAt, demandNo, payMethod, payMethodOther, firstLessonDate, trialPay, trialPayOther }) {
  const methodName = method === 'offline' ? '线下授课' : '线上授课';
  const locationText = location || (method === 'offline' ? '甲方常住处或双方另行约定的地点' : '双方约定的线上课堂');
  const PAY_METHOD_TEXT = { per_session: '次付（按次结算，每次课程结束后支付）', weekly: '周付（每周结算一次）', monthly: '月付（每月结算一次）' };
  const TRIAL_PAY_TEXT = { first_free: '第一次试课免费', first_hour_free: '第一小时免费，第二小时起按约定时薪收费', normal: '试课全程正常收费' };
  const payText = payMethod === 'other' ? (payMethodOther || '由双方另行约定') : (PAY_METHOD_TEXT[payMethod] || '由双方另行约定');
  const trialText = trialPay === 'other' ? (trialPayOther || '由双方另行约定') : (TRIAL_PAY_TEXT[trialPay] || '由双方另行约定');
  const biz = `# 家教服务合同

**甲方（学生方）**：${studentName}
**乙方（教师方）**：${teacherName}
${demandNo ? `**关联需求编号**：#${demandNo}
` : ''}**签署日期**：${createdAt || ''}

甲乙双方本着平等、自愿、诚实信用的原则，依照《中华人民共和国民法典》及相关法律法规，经友好协商，就家教服务事宜达成如下协议：

## 第一条 服务内容与授课安排

1. 授课方式：${methodName}。
2. 授课科目与内容：详见本合同第三条「教学方案」。
3. 首次上课日期：${firstLessonDate || '由双方另行协商确定'}。
4. 授课时间：${schedule || '由双方另行协商确定'}。
5. 授课地点：${locationText}。

## 第二条 课时费与支付

1. 约定时薪为每小时 **${rate}** 元（人民币）。
2. 薪资结算方式：${payText}。甲方应按约定如期支付课时费用。
3. 试课薪资方案：${trialText}。
4. 平台仅提供信息撮合与合同存证服务，不参与任何费用结算，不代收、不代付课时费用。课时费由双方在站外自行协商并直接结算（如微信、支付宝转账等），平台不对站外资金往来承担任何责任。

## 第三条 教学方案

${plan || '（未填写）'}`;
  return contractWithLegal(biz);
}

// ============================================================
// 合同存证台账（独立于活跃库的「保障库」）：签署即存 文本 SHA-256 + 哈希链（prev_hash），
// 任一环节被改动都能校验出来。绑定 env.LEDGER_DB 即启用独立台账库，未绑定回落业务库
// （同 LOG_DB 模式：仪表板 Settings → Bindings 绑定即生效）。
// 覆写域：台账建表/插入/校验 SQL 自持本模块（CLAUDE.md 有意决定），不重复于 db.js
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
  // 网安报告 F-07 幂等补列（ensureColumns 单源自 util.js——不再受 db.js→contract.js 循环依赖约束）：
  // seq 全链序号 + body_hash 正文哈希分解值（content_hash 输入之一，独立落列供审计交叉验证）
  await ensureColumns(db, 'contract_ledger', [
    ['seq', 'INTEGER'],
    ['body_hash', "TEXT NOT NULL DEFAULT ''"],
  ]);
  // 存量行 seq 按「同合同内 id 序」回填（单合同独立链的序号）；历史条目正文已不在库内（合同可被修改），
  // body_hash 保持空串，校验时仅做链结构（GENESIS + prev 连续性）——中间条目被篡改即断链，正文重放限最新条目
  await dbRun(db, `UPDATE contract_ledger SET seq=(SELECT COUNT(*) FROM contract_ledger c2 WHERE c2.contract_id=contract_ledger.contract_id AND c2.id<=contract_ledger.id) WHERE seq IS NULL`);
}

const sha256Hex = text => crypto.subtle.digest('SHA-256', new TextEncoder().encode(text)).then(bufToHex);

// 台账链哈希原文（网安报告 F-07）：content_hash 必须覆盖「正文 + contract_id + created_at + prev_hash」，
// 否则拥有 DB 写权限者可重建整条台账而不被检出。正文哈希先取（防原文过长重复计算），再与元数据串成链。
async function ledgerContentHash(contractId, contractMd, createdAt, prevHash) {
  const bodyHash = await sha256Hex(contractMd);
  return sha256Hex(`${bodyHash}|${contractId}|${createdAt}|${prevHash}`);
}

// 签署存证：记账 contract_id + 链式哈希（prev_hash 参与本条目哈希，篡改任一历史条目都会断链）。
// 单合同独立链：prev/seq 均按 contract_id 过滤，每份合同的台账是一条以 GENESIS 为根的独立链——
// 与 verifyContractLedger（按合同取行）和 verifyChain（链头须 GENESIS）的语义一致。
// （原实现误接「全局末条」为 prev：第二份合同起的条目 prev_hash 非 GENESIS，verify 恒 invalid，已修）
// 网安报告 F-07 原子化：prev 取数、seq 取号与插入同一条 INSERT 内完成，并把 JS 侧已见的 prev 回带
// 作 WHERE 条件——并发记账时分叉方（库内 prev 已变）changes=0，重读重算重试，杜绝同 prev 双挂。
// 幂等：同合同同正文已记账则直接返回既有 hash（签约后 500 的重试可安全补记，绝不重复挂链）
async function ledgerRecord(db, contractId, contractMd) {
  const target = getLedgerDb(db);
  const bodyHash = await sha256Hex(contractMd);
  const createdAt = new Date().toISOString().slice(0, 19).replace('T', ' ');
  for (let i = 0; i < 3; i++) {
    const prev = await dbGet(target, 'SELECT content_hash FROM contract_ledger WHERE contract_id=? ORDER BY id DESC LIMIT 1', [contractId]);
    const prevHash = prev ? prev.content_hash : 'GENESIS';
    const contentHash = await ledgerContentHash(contractId, contractMd, createdAt, prevHash);
    const r = await dbRun(target, `INSERT INTO contract_ledger (contract_id, content_hash, prev_hash, seq, body_hash, created_at)
      SELECT ?, ?, COALESCE((SELECT content_hash FROM contract_ledger WHERE contract_id=? ORDER BY id DESC LIMIT 1),'GENESIS'),
             COALESCE((SELECT MAX(seq) FROM contract_ledger WHERE contract_id=?),0)+1, ?, ?
      WHERE COALESCE((SELECT content_hash FROM contract_ledger WHERE contract_id=? ORDER BY id DESC LIMIT 1),'GENESIS') = ?
        AND NOT EXISTS (SELECT 1 FROM contract_ledger WHERE contract_id=? AND content_hash=?)`,
      [contractId, contentHash, contractId, contractId, bodyHash, createdAt, contractId, prevHash, contractId, contentHash]);
    if (r.meta.changes > 0) return contentHash;
    // changes=0 可能是「抢链尾失败」或「已存在」——区分：已存在则直接返回既有 hash
    const dup = await dbGet(target, 'SELECT content_hash FROM contract_ledger WHERE contract_id=? AND content_hash=?', [contractId, contentHash]);
    if (dup) return dup.content_hash;
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
    // v0.25.37 签署合规：逐条台账明细（序号 + 记档时间）供前端存证校验面板展示签署历史
    entryList: rows.map(r => ({ seq: r.seq, createdAt: r.created_at })),
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

// POST /api/contracts { conversationId, method, plan, hourlyRate, ... } —— 起草并发送给另一方
export async function handleCreateContract(db, body, req) {
  const { user: me, err: authErr } = await requireUser(db, req);
  if (authErr) return authErr;
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
  // 需求四·第3条：起草合同必须绑定「已签约」需求（发起签约确认 → demand contracted 后才可起草合同）。
  // v0.25.6 审计收紧：服务端强制 demandId，无 conv.demand_id 回落（会话与需求已解耦，同 signing 路径门禁）。
  // 归属硬校验：需求必须属于会话学生方（防越权绑他人需求）；状态须 contracted；一条需求只允许一份合同
  // （进行中/已签均不可再绑，前端下拉亦已过滤，服务端统一入口把关防并发窗口）。
  // 签约成交方校验（教师方口径）：contracted 需求若由「别教师」的 signed 签约驱动，本会话不得绑它起草合同
  // （同对师生换会话可放行；另一教师签成的需求不可抢绑——签约成交方与合同缔结方必须同一教师）
  const demandId = Number(body.demandId);
  if (!Number.isInteger(demandId) || demandId <= 0) return error(MSG.DEMAND_NOT_SIGNED, 410); // 起草合同必须选已签约需求
  const dm = await dbGetDemandById(db, demandId);
  if (!dm) return error(MSG.DEMAND_NOT_FOUND, 404); // F-03b：需求已删（创建端复核；INSERT 守卫再堵 SELECT→INSERT 竞态窗口）
  if (dm.user_id !== conv.student_user_id) return error(MSG.NO_PERMISSION, 403);
  if (dm.status !== STATUS.CONTRACTED) return error(MSG.DEMAND_NOT_SIGNED, 410);
  const dc = await dbGet(db, `SELECT id FROM contracts WHERE demand_id=? AND status IN ('pending','signing','signed') LIMIT 1`, [demandId]);
  if (dc) return error(MSG.DEMAND_CONTRACT_EXISTS, 409);
  const crossSigned = await dbGet(db, `SELECT sr.id FROM signing_requests sr
    JOIN conversations c ON c.id=sr.conversation_id
    WHERE sr.demand_id=? AND sr.status='signed' AND c.teacher_user_id != ? LIMIT 1`, [demandId, conv.teacher_user_id]);
  if (crossSigned) return error(MSG.DEMAND_NOT_SIGNED, 410);
  let demandNo = dm.display_id ? String(dm.display_id).padStart(4, '0') : '';
  const md = buildContractMd({
    teacherName: conv.teacher_name, studentName: conv.student_name,
    method, schedule, location, plan, rate, createdAt: new Date().toISOString().slice(0, 10), demandNo,
    payMethod, payMethodOther, firstLessonDate, trialPay, trialPayOther,
  });
  const mdEnc = await encryptField(md); // 网安 N-05：合同正文加密落库（读点经 db.js 解密，台账哈希走明文）
  // v0.25.37 签署合规：插入时正文不含签署记录（流水号须先有 id），拿到 id 后回写完整正文——
  // 第十条 签署记录显示双方「待签署」；自愈：回写失败不影响签署（每次签署都会重拼正文）
  const res = await dbRun(db,
    // v0.25.32 加固：发起方不再自动确认（原 drafter_confirmed=1 自动「已签约」）——起草后双方
    // 各自走「读合同→滚到底+待够时长→二次确认→密码最终确认」显式签署，双方确认才 signed
    `INSERT INTO contracts (conversation_id, drafter_user_id, demand_id, method, schedule, location, plan, hourly_rate, contract_md,
        pay_method, pay_method_other, first_lesson_date, trial_pay, trial_pay_other, drafter_confirmed, status)
     SELECT ?,?,?,?,?,?,?,?,?,?,?,?,?,?, 0, 'signing'
     WHERE NOT EXISTS (SELECT 1 FROM contracts WHERE conversation_id=? AND status IN ('pending','signing'))
       AND NOT EXISTS (SELECT 1 FROM contracts ct2 WHERE ct2.demand_id=? AND ct2.status IN ('pending','signing','signed'))
       AND EXISTS (SELECT 1 FROM student_demands WHERE id=? AND status='contracted')
       AND NOT EXISTS (SELECT 1 FROM signing_requests sr JOIN conversations c2 ON c2.id=sr.conversation_id
            WHERE sr.demand_id=? AND sr.status='signed' AND c2.teacher_user_id != ?)`,
    [conversationId, userId, demandId, method, schedule, location, plan, rate, mdEnc,
     payMethod, payMethodOther, firstLessonDate, trialPay, trialPayOther,
     conversationId, demandId, demandId, demandId, conv.teacher_user_id]);
  // 并发双起草防护：NOT EXISTS 命中既有进行中合同则 changes=0，仅赢家继续（前置 existing 检查是快路径，此处是竞态闸门）；
  // 附加守卫：需求已被并发绑合同（另一会话）或需求被并发删除则同样 changes=0，判别后报对应用户可读错误
  if (!(res && res.meta && res.meta.changes > 0)) {
    if (!(await dbGetDemandById(db, demandId))) return error(MSG.DEMAND_NOT_FOUND, 404);
    const dc = await dbGet(db, `SELECT id FROM contracts WHERE demand_id=? AND status IN ('pending','signing','signed') LIMIT 1`, [demandId]);
    if (dc) return error(MSG.DEMAND_CONTRACT_EXISTS, 409);
    return error(MSG.CONTRACT_EXISTS, 409);
  }
  const id = (res && res.meta && res.meta.last_row_id) || 0;
  if (id > 0) {
    const fullMd = md + buildSignatureBlock({
      studentName: conv.student_name, teacherName: conv.teacher_name,
      studentSignedAt: '', teacherSignedAt: '', contractId: id,
    });
    await dbRun(db, `UPDATE contracts SET contract_md=? WHERE id=? AND status='signing'`,
      [await encryptField(fullMd), id]);
  }
  // 聊天窗合同事件气泡：落一条 kind=contract 的系统消息（文案由前端按查看者渲染），双方会话内均可见
  await dbCreateMessage(db, conversationId, userId, 'contract', 'contract_draft');
  await notifyUser(db, otherSide(conv, userId), UIC.CONTRACT_DRAFT_SENT.replace('{name}', nameOf(conv, userId)));
  await logEvent(db, { action: 'contract.create', actorUserId: userId, entity: 'contract', entityId: id,
    detail: { conversationId, method, rate }, req });
  return json({ id, message: UIC.CONTRACT_DRAFT_SENT_TOAST }, 201);
}

// GET /api/contracts/my → { contracts }（身份凭令牌）
export async function handleGetMyContracts(db, url, req) {
  const { user: me, err } = await requireUser(db, req);
  if (err) return err;
  return json({ contracts: await dbGetMyContracts(db, me.id) });
}

// POST /api/contracts/:id/sign —— 确认签约；双方都确认后 status→signed
export async function handleSignContract(db, contractId, body, req) {
  const { user: me, err: authErr } = await requireUser(db, req);
  if (authErr) return authErr;
  const userId = me.id;
  // pending（收草案方直接确认签约，免去独立「确认草案」步骤）与 signing 均可签
  const g = await loadContractFor(db, contractId, userId, [STATUS.PENDING, STATUS.SIGNING]);
  if (g.err) return g.err;
  const { ct, conv } = g;
  // 危险操作二次认证（网安报告 F-05）：签约须凭 re-auth 换发的一次性 capToken
  if (!(await confirmDangerOtp(db, req, body))) return error(MSG.REAUTH_FAILED, 403);

  const col = userId === ct.drafter_user_id ? 'drafter_confirmed' : 'other_confirmed';
  const signedCol = userId === ct.drafter_user_id ? 'drafter_signed_at' : 'other_signed_at';
  // 条件 UPDATE + changes 赢家模式：AND status 守卫确保对已离开 pending/signing 的合同（被取消/已签约）
  // 不产生任何改动；changes=0 方重读当前态幂等返回，不触发任何副作用。version 同步递增（乐观锁）
  // v0.25.37 签署合规：同句置位 signed_at（服务端时间戳，UTC SQLite 格式），签名区块据此渲染
  const flag = await dbRun(db, `UPDATE contracts SET ${col}=1, ${signedCol}=datetime('now','localtime'), status='signing', version=version+1, updated_at=datetime('now','localtime') WHERE id=? AND status IN ('pending','signing')`, [contractId]);
  if (!(flag && flag.meta && flag.meta.changes > 0)) {
    const cur = await loadContractFor(db, contractId, userId, [STATUS.PENDING, STATUS.SIGNING, STATUS.SIGNED]);
    if (cur.err) return cur.err;
    if (cur.ct.status === STATUS.SIGNED) {
      // 上一轮已签约但台账写入失败（500）后的重试：幂等补记存证（网安报告 F-07：绝不静默断链）
      try { await ledgerRecord(db, contractId, cur.ct.contract_md); }
      catch (e) { console.error('contract ledger backfill failed:', e && e.message); }
    }
    return json({ ok: true, signed: cur.ct.status === STATUS.SIGNED });
  }
  const updated = await dbGetContractById(db, contractId);
  if (!updated) return error(MSG.CONTRACT_NOT_FOUND, 404); // 置位后对方并发撤销致行消失：干净 404，不抛 500
  const both = !!(updated.drafter_confirmed && updated.other_confirmed);
  // 重拼正文（第十条 签署记录内嵌签署人/时间）回写：version 乐观锁——
  // 并发双签时仅最后落定者的正文生效（版本已被抢跑的旧正文 changes=0 丢弃），杜绝旧签名块覆盖新状态
  const signedMd = rebuildFullMd(updated, conv);
  await dbRun(db, `UPDATE contracts SET contract_md=?, version=version+1 WHERE id=? AND version=?`,
    [await encryptField(signedMd), contractId, updated.version]);
  // 每次签署都落台账（v0.25.37）：正文已内嵌签署人/时间，content_hash 自然覆盖「谁签/何时签」；
  // 幂等（同正文 NOT EXISTS 去重）——并发双签双方同正文只挂一条，签约后 500 重试可安全补记
  let contentHash = '';
  try { contentHash = await ledgerRecord(db, contractId, signedMd); }
  catch (e) { console.error('contract ledger failed:', e && e.message); }
  if (both) {
    // v0.24.0 合同文档与需求签约状态彻底解耦：文档 signed 不再触碰 student_demands
    // （需求签约关系由「发起签约」signing.js 的签约请求确认驱动）。条件 UPDATE 赢家模式——
    // 双方同时签约仅一方 changes>0，防并发双副作用
    const claim = await dbRun(db, `UPDATE contracts SET status='signed', prev_business=NULL, version=version+1 WHERE id=? AND status='signing'`, [contractId]); // v0.24.3：签署确认后清空留痕（对齐 db.js:414 注释意图，diff 仅存于重新确认窗口期）
    if (claim && claim.meta && claim.meta.changes > 0) {
      await notifyUser(db, otherSide(conv, userId), UIC.CONTRACT_SIGNED);
      // 留档保存合同原文（detailMax 放宽，加密后落库；撤销合同后仍可凭留档还原缔约内容）
      await logEvent(db, { action: 'contract.signed', actorUserId: userId, entity: 'contract', entityId: contractId,
        detail: { conversationId: updated.conversation_id, demandId: updated.demand_id, contentHash, contractMd: signedMd },
        detailMax: 60000, req });
    }
  } else {
    await notifyUser(db, otherSide(conv, userId), UIC.CONTRACT_SIGN_WAITING.replace('{name}', nameOf(conv, userId)));
    await logEvent(db, { action: 'contract.sign_partial', actorUserId: userId, entity: 'contract', entityId: contractId,
      detail: { signedBy: userId, contentHash, contractMd: signedMd }, detailMax: 60000, req });
  }
  return json({ ok: true, signed: both });
}

// PUT /api/contracts/:id { contractMd, version } —— 修改正式合同：重置双方确认，实时同步给另一边
// 乐观锁用自增 version 整数（原秒级 updated_at 同秒双改互相覆盖，已修）：客户端打开编辑器时的
// version 须随请求带来，缺失即参数错误；版本不符或状态已离开 pending/signing → 409 强制重载
export async function handleModifyContract(db, contractId, body, req) {
  const { user: me, err: authErr } = await requireUser(db, req);
  if (authErr) return authErr;
  const userId = me.id;
  const g = await loadContractFor(db, contractId, userId, [STATUS.PENDING, STATUS.SIGNING]);
  if (g.err) return g.err;
  const { ct, conv } = g;
  const ver = parseInt(body.version);
  if (!Number.isInteger(ver)) return error(MSG.INVALID_PARAMS, 400);
  // v0.24.0：修改弹窗只放出业务条款——提交的 md 即新业务部分，法律条款由服务端固定重拼（不可修改）
  // v0.24.2：剥离提交内容中可能残留的标记及之后内容（前端 textarea 只放业务段，防御非前端客户端塞整段/重复提交）
  const md = String(body.contractMd || '').slice(0, 30000).split(CONTRACT_BUSINESS_END)[0].trim();
  if (!md) return error(UIC.CONTRACT_EMPTY); // 用户可见文案单源 constants.js
  // 旧格式合同（v0.24.0 前起草、正文无标记）：整段即业务，不再追加法律块——否则旧法律条款被当业务
  // 重拼，出现两份法律条款且旧条款从此落入可编辑区，破坏「法律条款不可修改」承诺
  const oldHasMarker = (ct.contract_md || '').includes(CONTRACT_BUSINESS_END);
  const oldBiz = (oldHasMarker ? (ct.contract_md || '').split(CONTRACT_BUSINESS_END)[0] : (ct.contract_md || '')).trim(); // 旧业务部分（留痕 diff 基线）
  if (md === oldBiz) return json({ ok: true, unchanged: true }); // 业务未变：幂等短路，不重置确认/不重发通知
  // 新格式：业务+固定法律条款+第十条 签署记录（v0.25.37 全部待签署——修改即回退签约选择态）；
  // 旧格式：保持原文本不重拼（无标记则无签署记录，历史合同语义不变）
  const fullMd = oldHasMarker
    ? contractWithLegal(md) + buildSignatureBlock({
        studentName: conv.student_name, teacherName: conv.teacher_name,
        studentSignedAt: '', teacherSignedAt: '', contractId,
      })
    : md;

  // 修改即回退到签约选择态：双方确认清零 + 签署时间清零 + signing（双方重新确认）；
  // prev_business 留痕供前端 diff 高亮；乐观锁落 SQL WHERE（version 精确匹配）
  const upd = await dbRun(db,
    `UPDATE contracts SET contract_md=?, prev_business=?, drafter_confirmed=0, other_confirmed=0,
       drafter_signed_at='', other_signed_at='', status='signing', version=version+1, updated_at=datetime('now','localtime')
     WHERE id=? AND version=? AND status IN ('pending','signing')`,
    [await encryptField(fullMd), oldBiz, contractId, ver]); // N-05：合同正文加密落库
  if (!(upd && upd.meta && upd.meta.changes > 0)) return error(MSG.CONTRACT_MODIFIED_CONFLICT, 409, 'CONTRACT_MODIFIED_CONFLICT'); // v0.24.2：带稳定 code 供前端刷新版本号
  await notifyUser(db, otherSide(conv, userId), UIC.CONTRACT_MODIFIED.replace('{name}', nameOf(conv, userId)));
  await logEvent(db, { action: 'contract.modify', actorUserId: userId, entity: 'contract', entityId: contractId, req });
  return json({ ok: true });
}

// POST /api/contracts/:id/revoke —— 撤销已签约合同（仅限双方已约定终止的场景，前端 2 次确认 + 法律后果提示）：
// 活跃库抹掉合同行与合同气泡；签署台账与加密留档保留（不可篡改的历史凭证）；通知对方。
// 危险操作二次认证 = 密码换 5 分钟一次性 capToken（confirmDangerOtp 真实现）
export async function handleRevokeContract(db, contractId, body, req) {
  const { user: me, err: authErr } = await requireUser(db, req);
  if (authErr) return authErr;
  const g = await loadContractFor(db, contractId, me.id, [STATUS.SIGNED]); // 未签约的走取消流程
  if (g.err) return g.err;
  const { ct, conv } = g;
  if (!(await confirmDangerOtp(db, req, body))) return error(MSG.REAUTH_FAILED, 403); // 二次认证（F-05）
  const del = await dbDeleteContract(db, contractId);
  if (!(del && del.meta && del.meta.changes > 0)) return error(MSG.CONTRACT_NOT_FOUND, 404); // 并发双撤销仅赢家执行清理与通知
  await dbDeleteContractMessages(db, ct.conversation_id);
  // v0.24.0 合同文档与需求解耦：撤销文档不再把需求置回 revoked（需求签约状态由签约请求驱动）
  await notifyUser(db, otherSide(conv, me.id), UIC.CONTRACT_REVOKED_NOTIFY.replace('{name}', nameOf(conv, me.id)));
  await logEvent(db, { action: 'contract.revoke', actorUserId: me.id, entity: 'contract', entityId: contractId,
    detail: { conversationId: ct.conversation_id, demandId: ct.demand_id, note: 'ledger_retained' }, req });
  return json({ ok: true });
}

// GET /api/contracts/:id/verify —— 存证校验：重算文本哈希对比台账（仅会话参与方与管理员可用）
export async function handleVerifyContract(db, contractId, req) {
  const { user: me, err: authErr } = await requireUser(db, req);
  if (authErr) return authErr;
  const ct = await dbGetContractById(db, contractId);
  if (!ct) return error(MSG.CONTRACT_NOT_FOUND, 404);
  const conv = await dbGetConversationWithNames(db, ct.conversation_id);
  const isAdmin = requireAdminOrError(me) === null; // 管理员判定单点
  if (!isAdmin && !isParticipant(conv, me.id)) return error(MSG.NO_PERMISSION, 403);
  return json(await verifyContractLedger(db, contractId));
}

// GET /api/admin/contracts —— 管理员查看全部合同
export async function handleAdminListContracts(db, url, req) {
  const { err } = await requireAdmin(db, req);
  if (err) return err;
  const contracts = await dbGetAllContractsAdmin(db);
  return json({ contracts });
}

// DELETE /api/admin/contracts/:id —— 管理员移除合同（测试用；合同全链路留档，删除记 admin.contract.remove）
export async function handleAdminRemoveContract(db, contractId, body, req) {
  const { admin, err } = await requireAdmin(db, req);
  if (err) return err;
  const ct = await dbGetContractById(db, contractId);
  if (!ct) return error(MSG.CONTRACT_NOT_FOUND, 404);
  await dbDeleteContract(db, contractId);
  // 网安审计 N-11：删除的是 signed 合同时，其绑定的需求已被置 contracted（签约时原子完成），
  // 合同删除后无「撤销」可走，需求会永久滞留 contracted（不可见、不可 reopen）——此处同撤销合同
  // v0.24.0 合同文档与需求解耦：删除文档不再把需求置回 revoked（需求签约状态由签约请求驱动）
  await logEvent(db, { action: 'admin.contract.remove', actorUserId: admin.id, actorUsername: admin.username,
    actorRole: 'admin', entity: 'contract', entityId: contractId,
    detail: { conversationId: ct.conversation_id, status: ct.status, drafterUserId: ct.drafter_user_id, demandId: ct.demand_id }, req });
  return json({ ok: true });
}

// DELETE /api/contracts/:id —— 取消签约：删合同 + 通知对方；会话保留
export async function handleCancelContract(db, contractId, body, req) {
  const { user: me, err: authErr } = await requireUser(db, req);
  if (authErr) return authErr;
  const userId = me.id;
  const g = await loadContractFor(db, contractId, userId, [STATUS.PENDING, STATUS.SIGNING]);
  if (g.err) return g.err;
  const { ct, conv } = g;

  // 状态条件删除做并发守卫：load 之后翻到 signed/revoked 的行拒删（签约后不可再取消，须走撤销合同）
  const del = await dbDeleteContract(db, contractId, [STATUS.PENDING, STATUS.SIGNING]);
  if (!(del && del.meta && del.meta.changes > 0)) {
    if (await dbGetContractById(db, contractId)) return error(MSG.CONTRACT_CANCEL_SIGNED_BLOCKED, 409); // 行仍在：状态已翻，非「并发已删」
    return json({ ok: true }); // 行已不在：并发对方已先取消，赢家已通知，此处不重复副作用
  }
  // v0.24.0 合同文档与需求解耦：取消文档不再复位需求意向锁（intent_locked 机制已随
  // 「会话不锁需求」删除——routes-demands.js 移除 dbLockDemandIntent）；需求状态保持 open
  await notifyUser(db, otherSide(conv, userId), UIC.CONTRACT_CANCELLED.replace('{name}', nameOf(conv, userId)));
  await logEvent(db, { action: 'contract.cancel', actorUserId: userId, entity: 'contract', entityId: contractId,
    detail: { conversationId: ct.conversation_id, demandId: ct.demand_id }, req });
  return json({ ok: true });
}

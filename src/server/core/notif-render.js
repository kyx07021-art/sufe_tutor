/**
 * 通知渲染注册表（服务端渲染单源）
 *
 * docs/interfaces.md 要求 GET /api/notifications 每行携带
 * title/content/avatar_src 渲染字段——前端不再自行渲染，数据即文案。
 * 本模块是服务端渲染的唯一实现，中文文案单源于此：
 * - NOTIF_RENDER: type -> { title, content }（value 为 {key} 模板串或函数）
 * - AVATAR_SRC: type -> 'user' | 'system'（avatar_src 分类，也是
 * blockSystemNotifications 过滤判定的唯一来源）
 * - renderNotification(type, params) -> { title, content, avatar_src }
 * - renderCompletenessGap() -> 已注册 NOTIFY_TYPES 键中缺渲染条目/分类的清单
 *
 * 类型注册表校验（D4：type ∈ NOTIFY_TYPES + params 键 ⊆ shape）仍由
 * shared/codes.js NOTIFY_TYPES 承担（notifyUser 写入侧），本模块只负责读出渲染。
 * v2 旧前端 client/constants/text.js 的 NOTIF_* 键为历史参考；新站点服务端渲染
 * 以本注册表为准。
 */
import { NOTIFY_TYPES } from '../../shared/codes.js';

const BROADCAST_FALLBACK_TITLE = '系统通知';
const PENALTY_ACTION_BAN = '封禁账户';
const PENALTY_ACTION_REMOVE = '移除内容';
const PENALTY_RULE_FALLBACK = '平台规则';
const NOTIF_VERIFY_DETAIL_PREFIX = '核验信息：';

/** avatar_src 分类：'user' = 用户间事件；'system' = 平台/系统生成 */
const AVATAR_SRC = Object.freeze({
  CONTRACT_DRAFT_SENT: 'user',
  CONTRACT_SIGN_WAITING: 'user',
  CONTRACT_MODIFIED: 'user',
  CONTRACT_SIGNED: 'user',
  CONTRACT_REVOKED: 'user',
  CONTRACT_CANCELLED: 'user',
  CONVERSATION_CLOSED: 'user',
  FEEDBACK_RESOLVED: 'system',
  FEEDBACK_COMPLAINT_RESOLVED: 'system',
  VERIFY_APPROVED: 'system',
  VERIFY_REJECTED: 'system',
  VERIFY_REVOKED: 'system',
  CONTENT_PENALTY: 'system',
  BROADCAST: 'system',
});

/** 内容处罚正文：{label}因违反规则「{rule}」被管理员{action}。原因：{reason}[。触发内容：{summary}] */
function penaltyContent(p) {
  const action = p.action === 'ban' ? PENALTY_ACTION_BAN : PENALTY_ACTION_REMOVE;
  const rule = p.rule || PENALTY_RULE_FALLBACK;
  const base = `你的${p.label || ''}因违反规则「${rule}」被管理员${action}。原因：${p.reason || ''}`;
  return p.summary ? `${base}。触发内容：${p.summary}` : base;
}

/** type -> 渲染条目；title/content 各可为 {key} 模板串或 (params)=>string 函数 */
const NOTIF_RENDER = Object.freeze({
  CONTRACT_DRAFT_SENT: { title: '合同确认', content: '「{name}」发来一份合同草案，请前往「我的合同」查看并确认' },
  CONTRACT_SIGN_WAITING: { title: '合同确认', content: '「{name}」已确认签约，请在「我的合同」内完成你的确认' },
  CONTRACT_MODIFIED: { title: '合同确认', content: '「{name}」修改了合同内容，双方签约确认已重置，请重新查看' },
  CONTRACT_SIGNED: { title: '合同签署', content: '双方已完成签约，合同生效。请按约定时间开始上课。' },
  CONTRACT_REVOKED: { title: '合同撤销', content: '「{name}」已撤销双方签署的合同，活跃数据已抹除，存证留档保留。' },
  CONTRACT_CANCELLED: { title: '签约取消', content: '「{name}」已取消签约，可于会话中继续商议细节' },
  CONVERSATION_CLOSED: {
    title: '关系结束',
    content: '「{name}」已结束与你的合作关系，本会话已关闭。进行中的签约已自动取消，未完成的合同已自动撤销。',
  },
  FEEDBACK_RESOLVED: { title: '反馈处理', content: '你反馈的问题已经处理好了。具体结果可以到「我的投诉与反馈」查看。' },
  FEEDBACK_COMPLAINT_RESOLVED: {
    title: '投诉处理',
    content: '你的投诉已处理完毕，结果可以在「我的投诉与反馈」里查看。',
  },
  VERIFY_APPROVED: {
    title: '核验通过',
    content: (p) => {
      const head = p.verifyType === 'admission' ? '录取通知书核验已通过，你的接单资格已开放' : '学信网学籍核验已通过';
      return p.detail ? `${head}\n${NOTIF_VERIFY_DETAIL_PREFIX}${p.detail}` : head;
    },
  },
  VERIFY_REJECTED: {
    title: '核验未通过',
    content: (p) => {
      const base = '学信网学籍核验未通过，请重新提交验证码';
      return p.reason ? `${base}\n${p.reason}` : base;
    },
  },
  VERIFY_REVOKED: {
    title: '核验撤销',
    content: (p) => {
      const base = '你的接单资格已被管理员撤销，可重新提交学信网核验';
      return p.reason ? `${base}\n${p.reason}` : base;
    },
  },
  CONTENT_PENALTY: { title: '内容处理', content: (p) => penaltyContent(p) },
  BROADCAST: {
    title: (p) => (p && p.title) || BROADCAST_FALLBACK_TITLE,
    content: (p) => (p && p.text) || '',
  },
});

/** 解析一个渲染值：函数则调用，字符串则按 {key} 从 params 插值（缺键置空串） */
function resolve(v, p) {
  if (typeof v === 'function') return v(p);
  return String(v || '').replace(/\{(\w+)\}/g, (m, k) => {
    const val = p[k];
    return val === undefined || val === null ? '' : String(val);
  });
}

/**
 * 渲染一条结构化通知。未知/未注册 type（不应出现，D4 已拦截写入）与 type=null
 * 的旧行回落空 title/content（调用方用存储 text 兜底），avatar_src 恒有分类。
 */
export function renderNotification(type, params) {
  const p = params || {};
  const entry = NOTIF_RENDER[type];
  const avatar_src = AVATAR_SRC[type] || 'system';
  if (!entry) return { title: '', content: '', avatar_src };
  return {
    title: resolve(entry.title, p),
    content: resolve(entry.content, p),
    avatar_src,
  };
}

/**
 * 一致性缺口：NOTIFY_TYPES 已注册键中缺渲染条目或 avatar_src 分类的清单。
 * 测试锁「新增通知类型必须同时补渲染」，防新类型渲染空（D4 同变更集纪律）。
 */
export function renderCompletenessGap() {
  return Object.keys(NOTIFY_TYPES).filter((k) => !NOTIF_RENDER[k] || !AVATAR_SRC[k]);
}

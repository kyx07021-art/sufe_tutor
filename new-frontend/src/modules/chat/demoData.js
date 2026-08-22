/**
 * demoData.js — C2 会话模块骨架夹具（仅开发用，非用户文案）
 * -----------------------------------------------------------------
 * - 布局骨架（M4-01/02/06a/b/c）的会话列表种子数据。**不是**真实 I-17 响应：
 *   M4-03（列表加载 I-17）/M4-07（消息加载 I-18）接入真实数据后替换本种子。
 * - 字段名对齐 I-17 会话列表行形状（interfaces.md §19），后续基元可直接用
 *   API 响应替换种子而不改字段键。
 * - 这里的用户名/消息为演示值，非用户可见文案（文案一律走 m-chat.js）。
 */
export const DEMO_CONVERSATIONS = [
  {
    conversationId: 1,
    otherName: '李老师',
    avatar: '',
    lastMessage: '好的，明天下午三点见。',
    lastAt: '2026-08-22T10:31:00',
    status: 'active',
    unread: 1,
    tempStatus: null,
    tempInitiatorId: null,
    quotaRemaining: 1,
    iAmInitiator: false,
  },
  {
    conversationId: 2,
    otherName: '王老师',
    avatar: '',
    lastMessage: '课件我发你邮箱了。',
    lastAt: '2026-08-21T09:00:00',
    status: 'active',
    unread: 0,
    tempStatus: null,
    tempInitiatorId: null,
    quotaRemaining: 1,
    iAmInitiator: false,
  },
  {
    conversationId: 3,
    otherName: '赵老师',
    avatar: '',
    lastMessage: '感谢本次课程，下次再约。',
    lastAt: '2026-08-19T18:30:00',
    status: 'closed',
    unread: 0,
    tempStatus: null,
    tempInitiatorId: null,
    quotaRemaining: 0,
    iAmInitiator: false,
  },
  {
    conversationId: 4,
    otherName: '刘老师',
    avatar: '',
    lastMessage: '',
    lastAt: '2026-08-22T11:00:00',
    status: 'active',
    unread: 0,
    tempStatus: 'init',
    tempInitiatorId: 1,
    quotaRemaining: 1,
    iAmInitiator: true,
  },
]

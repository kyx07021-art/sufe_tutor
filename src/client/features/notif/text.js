/**
 * notif feature user-facing text. NOTIFY_BROADCAST_PREFIX is a behavioral constant
 * (broadcast classification in core/notif-pref.js + list filter + badge filter must
 * share one source) -- derived from constants/text.js rather than re-declared here
 * (audit F4: no second copy to drift apart).
 */
import { TEXT as SHARED } from '../../constants/text.js';

export const TEXT = {
  PAGE_NOTIFICATIONS: '通知信息',
  PAGE_NOTIFICATIONS_DESC: '意向与推送的处理进展',
  NOTIFY_BROADCAST_PREFIX: SHARED.NOTIFY_BROADCAST_PREFIX,
  NOTIF_BLOCK_OFF: '屏蔽系统通知',
  NOTIF_BLOCK_ON: '已屏蔽系统通知',
  NOTIF_FILTER_EMPTY: '没有符合条件的通知',
  EMPTY_NO_NOTIFICATIONS: '还没有通知。试课意向、需求推送和合同进展都会汇总到这里。',
  NOTIF_READ_ARIA: '标记该条通知已读',
};

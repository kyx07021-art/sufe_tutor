/**
 * m-notifications.js - M5 module copy single source (C3 notifications + C4 more)
 * -------------------------------------------------------
 * - All user-visible Chinese strings of the M5 module live here (contract 6);
 *   components import NOTIF_COPY and never hold raw Chinese.
 * - Time-display templates mirror the plan C2.3 format:
 *   today -> "x时x分前" / yesterday -> "昨天" / same-year -> "x月x日" / older -> "x年x月x日".
 * - Shared with modules M2 (envelope/unread badge) and M4 (conversation card time);
 *   promote to core/display when the second consumer lands.
 */

export const NOTIF_COPY = {
  /* ---- auth gate ---- */
  LOGIN_REQUIRED: '请先登录',

  /* ---- generic cap placeholder (feature not yet implemented) ---- */
  CAP_TOAST: '该功能开发中，敬请期待',

  /* ---- C3 notification modal ---- */
  NOTIF_TITLE: '通知',
  NOTIF_EMPTY: '暂无通知',
  NOTIF_LOADING: '加载中…',
  NOTIF_LOAD_ERROR: '通知加载失败，请稍后重试',
  NOTIF_BACK: '回到通知页',
  NOTIF_BLOCK_SYSTEM: '屏蔽系统通知',
  NOTIF_BLOCK_SYSTEM_ON: '已屏蔽系统通知',
  NOTIF_AVATAR_SYSTEM: '系统通知',
  NOTIF_AVATAR_USER: '用户通知',

  /* ---- time display templates (C2.3 format) ---- */
  TIME_JUST_NOW: '刚刚',
  TIME_MINUTES_AGO: (m) => `${m}分钟前`,
  TIME_HOURS_AGO: (h, m) => `${h}时${m}分前`,
  TIME_YESTERDAY: '昨天',
  TIME_MONTH_DAY: (mo, d) => `${mo}月${d}日`,
  TIME_YEAR_MONTH_DAY: (y, mo, d) => `${y}年${mo}月${d}日`,

  /* ---- C4 more dropdown ---- */
  MORE_LABEL: '更多',
  MORE_SETTINGS: '设置',
  MORE_ABOUT: '关于平台',
  MORE_FEEDBACK: '用户反馈',

  /* ---- settings window (M5-07 skeleton + M5-08..12 rows) ---- */
  SETTINGS_TITLE: '设置',
  SETTINGS_ACCOUNT: '账号资料',
  SETTINGS_APPEARANCE: '外观',
  SETTINGS_DEVICES: '设备管理',
  SETTINGS_DEACTIVATE: '注销账户',
  SETTINGS_USERNAME: '用户名',
  SETTINGS_EDIT: '修改',
  SETTINGS_AVATAR: '头像',
  SETTINGS_AVATAR_CHANGE: '更换',
  SETTINGS_AVATAR_TYPE_ERR: '仅支持 JPG/PNG/WebP 格式的图片',
  SETTINGS_SAVE: '保存',
  SETTINGS_BIND: '绑定',
  SETTINGS_CONTACT: '联系方式',
  SETTINGS_THEME: '主题',
  SETTINGS_UI_SCALE: '界面缩放',
  SETTINGS_DEVICES_DESC: '管理已登录的设备',
  SETTINGS_DEACTIVATE_DESC: '注销当前账户',
  SETTINGS_SAVED: '已保存',
  SETTINGS_THEME_LIGHT: '浅色',
  SETTINGS_THEME_DARK: '深色',
  SETTINGS_THEME_SYSTEM: '跟随系统',
  SETTINGS_SCALE_SMALL: '小',
  SETTINGS_SCALE_MEDIUM: '中',
  SETTINGS_SCALE_LARGE: '大',
  SETTINGS_DEVICE_CURRENT: '当前设备',
  SETTINGS_DEVICE_REVOKE: '退出登录',
  SETTINGS_DEVICE_EMPTY: '暂无其他设备',
  SETTINGS_DEACTIVATE_CONFIRM: '确认注销',
  SETTINGS_DEACTIVATE_CANCEL: '取消',
  SETTINGS_DEACTIVATE_WARN: '注销后当前账户不可登录，已绑定的手机/邮箱将被释放，可重新注册。此操作不可恢复。',

  /* ---- about (M5-13) ---- */
  ABOUT_TITLE: '关于平台',
  ABOUT_VERSION: '版本',
  ABOUT_COPYRIGHT: '© 经世知途·信息门户平台',
  PLATFORM_NAME: '经世知途·信息门户平台',

  /* ---- feedback (M5-14..16) ---- */
  FEEDBACK_TITLE: '用户反馈',
  FEEDBACK_TAB_REPORT: '反馈',
  FEEDBACK_TAB_TICKETS: '我的工单',
  FEEDBACK_KIND_BUG: '反馈 bug',
  FEEDBACK_KIND_SUGGESTION: '提出建议',
  FEEDBACK_KIND_REPORT: '举报内容',
  FEEDBACK_TITLE_LABEL: '标题',
  FEEDBACK_CONTENT_LABEL: '内容',
  FEEDBACK_CONTACT_LABEL: '联系方式（选填）',
  FEEDBACK_SUBMIT: '提交',
  FEEDBACK_SUBMITTED: '提交成功',
  FEEDBACK_EMPTY: '暂无工单',
  FEEDBACK_ANON_NOTE: '提交无需身份验证，工单凭本设备标识查询。',
  FEEDBACK_ANONYMOUS: '匿名',
}

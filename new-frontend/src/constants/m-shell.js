/**
 * m-shell.js - M2 shell module copy single source
 * -------------------------------------------------------
 * - User-visible copy for the top bar + routing/auth shell. Modules import SHELL_COPY
 *   from here; raw Chinese strings are forbidden in components (contract 6).
 * - Business copy for other modules lives in their own constants; the coordinator
 *   merges everything into ui.js at integration close.
 */

export const SHELL_COPY = {
  /** 401 fallback toast */
  LOGIN_EXPIRED: '登录已过期，请重新登录',
  /** landing placeholder (M1 pending) */
  LANDING_PENDING: '经世知途·信息门户平台',
  /** client shell home placeholder */
  HOME_PLACEHOLDER: '客户端页面建设中，请从顶部选项卡进入模块',
  /** dev preview page title */
  PREVIEW_TITLE: '组件预览（开发）',
  /** top bar LOGO aria-label */
  LOGO_LABEL: '返回首页',
  /** notify envelope button aria-label */
  NOTIFY_LABEL: '通知',
  /** chat bubble button aria-label */
  CHAT_LABEL: '会话',
  /** user area button aria-label */
  USER_MENU_LABEL: '用户菜单',
  /** C4 "more" dropdown entries (content owned by M5; placeholders this batch) */
  C4_SETTINGS: '设置',
  C4_ABOUT: '关于平台',
  C4_FEEDBACK: '用户反馈',
  /** tab bar accessibility label */
  TABBAR_LABEL: '模块导航',
}

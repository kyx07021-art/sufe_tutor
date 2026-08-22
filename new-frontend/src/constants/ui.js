/**
 * ui.js - M0 base layer UI constants single source
 * -------------------------------------------------------
 * - User-visible copy and timing params used by base components live here;
 *   component templates contain zero raw Chinese strings.
 * - Business copy belongs to modules (M2+); this file only holds base-layer
 *   component constants.
 */

export const UI_COPY = {
  /** Dropdown list accessibility label */
  DROPDOWN_LIST: '下拉选项',
  /** Modal close button accessibility label */
  CLOSE: '关闭',
  /** Captcha input send button resting text */
  SEND_CODE: '发送验证码',
  /** Variable input set: remove/add accessibility labels */
  VARSET_REMOVE: '移除该项',
  VARSET_ADD: '新增一项',
  /** Captcha sent success toast (plan C2.5 captcha input A verbatim) */
  OTP_SENT:
    '验证码已发送，请注意查收。若未收到，可能位于垃圾邮件或骚扰拦截中。',
  /** Captcha resend countdown text template */
  OTP_RESEND: (sec) => `${sec}秒后可重发`,
  /** Confirm modal A1: countdown confirm button text */
  CONFIRM_WAIT: (sec) => `${sec}秒后可确认`,
  /** Confirm modal A1: hint before reaching the bottom */
  READ_TO_BOTTOM: '请阅读并滚动到底部',
  /** Confirm modal A1 bottom buttons */
  CONFIRM_OK: '确认',
  CONFIRM_CANCEL: '退出',
  /** Confirm modal A (danger/generic) bottom buttons */
  ALERT_CANCEL: '取消',
  ALERT_CONFIRM: '确认',
  /** Step modal A bottom buttons */
  STEP_PREV: '上一步',
  STEP_NEXT: '下一步',
  STEP_SUBMIT: '提交',
}

export const UI_CONSTANTS = {
  /** Captcha cooldown (site-wide, seconds) */
  OTP_COOLDOWN_SEC: 60,
  /** Captcha input right send button width percentage */
  OTP_BUTTON_WIDTH_PCT: 30,
  /** Confirm modal A1 default countdown start (seconds; overridable per modal via prop) */
  CONFIRM_COUNTDOWN_DEFAULT_SEC: 5,
  /** Input A: remaining-char counter show threshold (show below this value) */
  INPUT_COUNTER_SHOW_THRESHOLD: 60,
  /** Input A: remaining-char warn (red) threshold */
  INPUT_COUNTER_WARN_THRESHOLD: 10,
  /** Variable input set: rightmost 10% empty zone (remove/add column) */
  VARSET_REMOVE_ZONE_PCT: 10,
}

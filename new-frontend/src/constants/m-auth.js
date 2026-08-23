/**
 * m-auth.js — C5 identity-auth module copy single-source (collected into ui.js)
 * -----------------------------------------------------------------
 * - Single source of every user-visible string in the C5 identity-auth module.
 *   Component templates / scoped CSS hold zero Chinese; all copy is imported
 *   from here (contract 6).
 * - Re-exported through `src/constants/ui.js` (`import { AUTH_COPY } from '@/constants/ui.js'`),
 *   same entry point as LANDING_COPY / UI_COPY / CHAT_COPY.
 * - Copy only; no numbers or business literals (those belong to tokens/config).
 */
export const AUTH_COPY = {
  /** Modal header, large black title (plan doc C5) */
  TITLE: '请验证身份',
  /** Info input area title, mapped by current auth method (keys = AUTH_METHODS string values) */
  METHOD_TITLE: {
    otp_phone: '手机验证码',
    otp_email: '邮箱验证码',
    password: '输入密码',
  },
  /** Pick-2-of-3 switch button S1 labels (keys as above) */
  METHOD_SWITCH_LABEL: {
    otp_phone: '手机验证码验证',
    otp_email: '邮箱验证码验证',
    password: '密码验证',
  },
  /** Login scene: manual identifier placeholder when no bound target (per method) */
  IDENTIFIER_PLACEHOLDER_PHONE: '手机号',
  IDENTIFIER_PLACEHOLDER_EMAIL: '邮箱',
  IDENTIFIER_PLACEHOLDER_USERNAME: '用户名或联系方式',
  /** OTP code input placeholder (inside the captcha input) */
  OTP_CODE_PLACEHOLDER: '请输入验证码',
  /** OTP send failure toast (fallback when no server message) */
  OTP_SEND_FAIL: '验证码发送失败，请稍后重试',
  /** I-06 verify failure toast (fallback when no server message) */
  VERIFY_FAIL: '验证未通过，请重试',
  /** Login failure toast (interim until M2-10 authStore owns login) */
  LOGIN_FAIL: '登录失败，请重试',
  /** Register failure toast */
  REGISTER_FAIL: '注册失败，请重试',
  /** Password input placeholder */
  PASSWORD_PLACEHOLDER: '输入密码',
  /** Slider-captcha copy (verbatim from v2) */
  CAPTCHA_TIP: '拖动滑块，将拼图块对齐到缺口位置',
  CAPTCHA_PASS: '验证通过',
  CAPTCHA_FAIL: '没对准缺口，再试一次',
  CAPTCHA_ARIA: '拖动滑块完成拼图验证',
  /** Register scene: role picker */
  ROLE_LABEL: '选择身份',
  ROLE_STUDENT: '我是学生',
  ROLE_TEACHER: '我是教师',
  /** Register scene: OTP channel switch */
  CHANNEL_PHONE: '手机',
  CHANNEL_EMAIL: '邮箱',
  /** Register scene: account field placeholders */
  USERNAME_PLACEHOLDER: '设置用户名',
  SET_PASSWORD_PLACEHOLDER: '设置密码',
  /** Register scene: invite-code gate */
  INVITE_LABEL: '邀请码',
  INVITE_PLACEHOLDER: '教师注册需填写邀请码',
  /** Register scene: agreement checkboxes */
  AGREE_AGREEMENT: '我已阅读并同意平台服务协议',
  AGREE_PRIVACY: '我已阅读并同意隐私政策',
  /** Register scene: flip-to-login link (PA-2-F1: landing has no other login entry) */
  HAVE_ACCOUNT: '已有账号？去登录',
}

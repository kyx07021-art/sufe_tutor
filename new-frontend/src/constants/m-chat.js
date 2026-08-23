/**
 * m-chat.js — C2 会话模块文案单源（收口汇 ui.js）
 * -----------------------------------------------------------------
 * - C2 会话模块全部用户可见文案唯一来源。组件模板/scoped CSS 内零中文，
 *   一律从这里 import（契约 6）。
 * - 通过 `src/constants/ui.js` 统一 re-export（`import { CHAT_COPY } from '@/constants/ui.js'`），
 *   与 LANDING_COPY/UI_COPY 同一入口。
 * - 本文件只放文案，不放数值/业务字面量（数值走 tokens/config 单源）。
 */
export const CHAT_COPY = {
  /** C2 会话页：TabBar 标签标题 */
  PAGE_TITLE: '会话',
  /** C2.3 选择栏：已结束会话卡片右侧时间位的固定字样（计划书 L406） */
  CLOSED_LABEL: '会话已结束',
  /** C2.3 选择栏：空列表占位 */
  LIST_EMPTY: '暂无会话',
  /** C2 会话区：消息区占位（M4-07 消息加载后移除） */
  NO_MESSAGES: '暂无消息',
  /** C2.6 输入框胶囊占位文案（真实输入组件 = M4-17） */
  INPUT_PLACEHOLDER: '发送消息',
  /** C2 移动端：返回会话列表图标按钮无障碍标签 */
  BACK_TO_LIST: '返回会话列表',
  /* ---- 时间格式化（M4-04/09，计划书 L404/L428）---- */
  /** 昨天 */
  TIME_YESTERDAY: '昨天',
  /** 今天内：n 分钟前 */
  TIME_MINUTES_AGO: (n) => `${n}分钟前`,
  /** 今天内：h 小时 m 分前 */
  TIME_HOURS_MIN_AGO: (h, m) => `${h}小时${m}分前`,
  /** 前天及以前：x月x日 */
  TIME_MONTH_DAY: (m, d) => `${m}月${d}日`,
  /** 去年及以前：x年x月x日 */
  TIME_YEAR_MONTH_DAY: (y, m, d) => `${y}年${m}月${d}日`,
  /* ---- 文件气泡（M4-11/12）---- */
  /** 文件 LOGO 无障碍标签 */
  FILE_ICON_ALT: '文件',
  /** 未知文件类型 LOGO 无障碍标签 */
  FILE_UNKNOWN_ALT: '未知文件',
  /** 文件大小格式化（M4-11） */
  FILE_SIZE: (n, unit) => `${n}${unit}`,
  /* ---- 消息列表（M4-07）---- */
  /** 加载中占位 */
  MESSAGES_LOADING: '加载中…',
  /** 加载更早消息按钮 */
  LOAD_MORE: '加载更早消息',
  /* ---- 普通气泡（M4-08/09/31）---- */
  /** 自己发送的气泡 aria 标签 */
  BUBBLE_MINE_ALT: '我的消息',
  /** 对方气泡 aria 标签 */
  BUBBLE_PEER_ALT: '对方消息',
  /* ---- 图片消息（M4-10）---- */
  /** 图片缩略图 alt */
  IMAGE_BUBBLE_ALT: '图片消息',
  /** 大图查看弹窗标题 */
  IMAGE_VIEWER_TITLE: '查看大图',
  /* ---- 文件气泡（M4-11）---- */
  /** 文件气泡点击下载 aria */
  FILE_BUBBLE_ALT: '下载文件',
  /* ---- 输入框（M4-17/18/19/20/21）---- */
  /** 发送按钮 aria */
  SEND_BTN_ARIA: '发送',
  /** 加号/减号切换按钮 aria */
  ATTACH_TOGGLE_ARIA: '展开附件面板',
  /** 附件面板：图片 */
  ATTACH_IMAGE: '图片',
  /** 附件面板：文件 */
  ATTACH_FILE: '文件',
  /** 附件面板标题 */
  ATTACH_SHEET_TITLE: '发送内容',
  /** 附件发送待接入（data-cap：S2 上传端点未落地） */
  ATTACH_CAP: '附件发送功能待接入',
  /** 附件上传失败 toast（E1：失败不静默） */
  UPLOAD_FAILED: '附件上传失败，请重试',
  /* ---- 区内上边栏 + 更多下拉（M4-22/23）---- */
  /** 更多操作按钮 aria */
  TOP_MORE_ARIA: '更多操作',
  /** 下拉：结束会话 */
  DROP_END_SESSION: '结束会话',
  /* ---- 结束会话（M4-24/25）---- */
  /** 确认浮窗标题 */
  END_TITLE: '结束会话',
  /** 确认浮窗正文 */
  END_BODY: '结束会话后无法再发送消息，进行中的签约将自动取消。此操作不可撤销。',
  /** 确认按钮文案 */
  END_OK: '结束会话',
  /** 成功后 toast */
  END_DONE: '会话已结束',
  /** 已结束幂等 toast */
  END_ALREADY: '该会话已结束',
  /** 在途提示 */
  END_BUSY: '正在结束会话…',
  /** 有进行中合同 → 结束按钮灰掉提示 */
  END_HAS_CONTRACT: '存在进行中的合同，无法结束会话',
  /** 结束会话失败 toast */
  END_FAILED: '结束会话失败',
  /* ---- 临时会话（M4-26/28/29）---- */
  /** 发起方 init：仅可发一条 */
  TEMP_HINT_INIT: '临时会话：你仅可发送一条消息，对方回复后转为正式会话',
  /** 发起方已发首条 */
  TEMP_HINT_SENT: '消息已发送，等待对方回复后将转为正式会话',
  /** 转正式 */
  TEMP_HINT_FORMAL: '已转为正式会话，可正常交流',
  /** 接收方侧提示 */
  TEMP_HINT_RECEIVED: '对方发来临时会话，回复后转为正式会话',
  /** 超配 toast */
  TEMP_QUOTA_EXCEEDED: '临时会话仅可发送一条消息',
  /* ---- 发送管线（M4-30）---- */
  /** 发送失败 toast */
  SEND_FAILED: '消息发送失败',
  /* ---- 特殊气泡（M4-15，I-44..46 cap 占位）---- */
  /** 特殊气泡内容占位（合同/签约内容 cap） */
  SPECIAL_CAP_PLACEHOLDER: '签约/合同内容',
  /* ---- 选择栏（M4-03）---- */
  /** 会话列表 aria 标签 */
  LIST_ARIA_LABEL: '会话列表',
  /* ---- 轮询预览 bump（M4-32）---- */
  /** 非文本消息的列表预览占位：图片 */
  PREVIEW_IMAGE: '[图片]',
  /** 非文本消息的列表预览占位：文件 */
  PREVIEW_FILE: '[文件]',
  /** 非文本消息的列表预览占位：签约/合同 */
  PREVIEW_CONTRACT: '[签约/合同]',
  /* ---- 结束会话确认浮窗（M4-24）---- */
  /** 二次认证提示 */
  END_REAUTH_HINT: '该操作需要重新验证身份，确认后请按提示完成验证。',
}

/**
 * LIST_POLL_MS - I-17 conversation-list refresh interval (PA-2-F12).
 * The list is polled at a slower cadence than the active-conversation message
 * poll (3s) so a conversation newly opened by the other party appears in the
 * receiver's list without a page re-entry, while the list fetch stays cheap.
 * Mirrors the notifications module's NOTIF_POLL_MS placement precedent
 * (module constants file as single source).
 */
export const LIST_POLL_MS = 10000

/**
 * CHAT_POLL_MS - active-conversation message-poll interval (PA-3-F4).
 * The active chat polls its I-18 sinceId cursor at this cadence; the
 * conversation list polls slower (LIST_POLL_MS). Module constants file is
 * the single source (mirrors LIST_POLL_MS / NOTIF_POLL_MS precedent).
 */
export const CHAT_POLL_MS = 3000

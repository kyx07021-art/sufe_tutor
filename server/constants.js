/**
 * 服务端常量配置层（目标分层：常量配置文件）
 *
 * 收纳：业务状态枚举、服务端校验文案、地址/额度限额、令牌/密码学参数、限流策略。
 * 规则：
 *   - 用户可见文案单源在根 constants.js（UI 块）；本文件的 MSG 是「服务端校验/语义事件」文案，
 *     两者不得重复定义同一条（发现重复即删一方，改读 globalThis.APP_CONSTANTS）。
 *   - STATUS 值与数据库状态字面量逐字相同，改动即破坏兼容（前端 constants.js STATUS 同步同值）。
 *   - 跨栈共享的数值配置（如令牌 TTL，前端本地过期判定也要用）放在根 constants.js 的 CONFIG 块，
 *     服务端经 globalThis.APP_CONSTANTS.CONFIG 读取，勿在本文件重复定义。
 *   - 限流/安全策略是唯一入口（server/security.js 消费），调整只改这里。
 */

// ============================================================
// 业务常量
// ============================================================
export const INITIAL_RATING = 4.0;   // 新教师初始评分（评价通过时做加权平均）
export const INITIAL_WEIGHT = 10;    // 初始评分权重
export const INVITE_GATE_ENABLED = false; // 教师注册邀请码门控。内测期有意沉默（false=教师免邀请码直接注册）：当前为内测阶段，
// 开放注册便于产品验证与教师侧体验，非遗漏（网安报告 F-05 曾要求邀请码门控，内测后有意关闭）。
// 公测上线前必须置回 true，并同步把前端 constants.js 的 INVITE_GATE_DORMANT 改为 false，届时此处注释同步删除。

// 合规红线「不收集详细门牌号」的服务端兜底：区块/地标级表述放行，门牌级拒绝。
// 刻意排除「号线」避免误伤地铁站描述（如 12号线附近）；「xx号」仅两位以上数字视为门牌
export const ADDRESS_GUARD = /(?:[0-9０-９]{2,}号(?!线)|[0-9０-９]+(?:号楼|室|栋|单元|门牌))/;

// ============================================================
// 业务状态常量：JS 比较/赋值处一律引这里；SQL 内字面量保持原样（插值易错不值）
// ============================================================
export const STATUS = {
  OPEN: 'open',          // 需求开放 / 反馈未处理
  CONTRACTED: 'contracted', // 需求已签约下架
  REVOKED: 'revoked',    // 需求合同已撤销（待所有者手动重开）
  PENDING: 'pending',    // 意向/推送待处理 / 合同草案 / 评价待审核
  ACCEPTED: 'accepted',  // 意向/推送已接受
  REJECTED: 'rejected',  // 意向/推送已拒绝 / 评价已拒绝
  SIGNING: 'signing',    // 合同待签约（双方确认中）
  SIGNED: 'signed',      // 合同已签约（评价门槛放行）
  APPROVED: 'approved',  // 评价已通过
  ACTIVE: 'active',      // 会话进行中
  RESOLVED: 'resolved',  // 反馈已处理
};

// ============================================================
// 服务端校验/语义事件文案（用户直接可见，但属服务端校验域；业务通知类文案在根 constants.js UI）
// ============================================================
export const MSG = {
  // 验证错误
  USERNAME_LENGTH: '用户名长度需在 3-30 个字符之间',
  USERNAME_INVALID: '用户名只能包含中文、字母、数字及 _ . - （3-30 个字符）',
  PASSWORD_LENGTH: '密码长度至少 6 个字符',
  INVALID_ROLE: '无效的用户角色',
  INVALID_ACTION: '无效的操作',
  INVALID_PARAMS: '参数不合法',
  LOGIN_REQUIRED: '请输入用户名和密码',
  LOGIN_FAILED: '用户名或密码错误',
  USERNAME_TAKEN: '用户名已被注册',

  // 邀请码
  TEACHER_NEEDS_INVITE: '教师注册需要邀请码',
  INVITE_INVALID: '邀请码无效或已过期',
  NO_PERMISSION: '无权限',

  // 教师
  PROFILE_SAVED: '教师信息已保存',

  // 学生需求
  STUDENT_ONLY: '仅学生可提交需求',
  DEMAND_SUBMITTED: '需求已提交',
  DEMAND_NOT_FOUND: '需求不存在',
  DEMAND_UPDATED: '需求已更新',
  DEMAND_DELETED: '需求已删除',
  DEMAND_REOPENED: '需求已重新开放',
  DEMAND_STATE_INVALID: '当前需求状态不允许此操作',
  PROVINCE_REQUIRED: '请选择省份',
  ADDRESS_TOO_DETAILED: '地址请用「区/路」级别的模糊表述，请勿填写详细门牌号（如 xx号楼 / xx室 / xx号门）',
  TEACHER_ONLY: '仅教师可操作',
  ADMIN_ONLY: '仅管理员可操作',
  USER_NOT_FOUND: '用户不存在',
  ACCOUNT_BANNED: '该账户已被封禁，禁止登录',
  ACCOUNT_DEACTIVATED: '该账户已注销',
  BANNED: '已封禁',
  UNBANNED: '已解封',

  // 意向
  INTENT_DUPLICATE: '你已对该需求提交过意向',
  INTENT_NOT_FOUND: '意向不存在',
  INTENT_RESOLVED: '意向已处理',
  INTENT_ALREADY_RESOLVED: '该意向已被处理',
  INTENT_SUBMITTED: '意向已提交',
  PROFILE_INCOMPLETE: '教师档案不完整：省份、年级、性别、擅长科目、报价均为必填，完善后才能提交试课意向',

  // 需求推送
  TEACHER_NOT_FOUND: '目标教师不存在',
  PUSH_SUBMITTED: '需求已发送给老师，等待对方查看',
  PUSH_DUPLICATE: '该需求已发送给这位老师',

  // 通知广播（管理员）
  BROADCAST_EMPTY: '通知内容不能为空',

  // 头像
  AVATAR_INVALID: '头像数据无效（请上传 160px 内的图片）',

  // 用户反馈
  FEEDBACK_NOT_FOUND: '反馈不存在',
  FEEDBACK_EMPTY: '反馈内容不能为空',

  // 资料共享
  POST_NOT_FOUND: '帖子不存在',

  // 合同（通知模板含 {name} 占位；用户可见合同文案在 constants.js UI.CONTRACT_*，本块只留校验/状态语义）
  CONTRACT_EXISTS: '该会话已存在进行中的合同',
  CONTRACT_CANCEL_SIGNED_BLOCKED: '对方已确认签约，无法再取消签约；如要结束合作请双方协商后走「撤销合同」',
  CONTRACT_NOT_FOUND: '合同不存在',
  CONTRACT_STATE_INVALID: '合同当前状态不允许该操作',
  CONTRACT_MODIFIED_CONFLICT: '合同已被对方修改，请关闭后重新打开查看最新版本',
  DEMAND_CONTRACTED_CLOSED: '该需求已签约成交，已停止接收新意向',
  DEMAND_CONTRACTED_LOCKED: '已签约的需求不可修改或删除',

  // 沟通
  CONVERSATION_NOT_FOUND: '会话不存在',
  MESSAGE_NOT_FOUND: '消息不存在',
  MESSAGE_TOO_LONG: '消息太长（上限 2000 字）',
  FILE_TOO_LARGE: '附件过大（上限约 500KB，图片会自动压缩）',
  FILE_TYPE_BLOCKED: '不支持的文件类型',
  UPLOAD_STAGING_LIMIT: '暂存的待发送附件过多，请先发送或删除部分附件',

  // 评价
  RATING_RANGE: '评分需在1-5之间',
  COMMENT_TOO_SHORT: '评价内容太短',
  REVIEW_SUBMITTED: '评价已提交，等待管理员审核',
  REVIEW_CONTRACT_ONLY: '评价仅限与该教师签约的学生',
  REVIEW_EXISTS: '你已评价过该教师，只能修改原评价',
  REVIEW_UPDATED: '评价已更新，重新进入审核',
  REVIEW_NOT_FOUND: '评价不存在',
  REVIEW_APPROVED: '评价已通过',
  REVIEW_REJECTED: '评价已拒绝',
  REVIEW_DELETED: '评价已删除',

  // 登录设备（会话）
  SESSION_NOT_FOUND: '该设备的登录状态不存在或已失效',

  // 通用
  REGISTER_SUCCESS: '注册成功',
  REAUTH_FAILED: '密码错误，请重新输入后再试',
  SERVER_ERROR: '服务器内部错误',
  PAYLOAD_TOO_LARGE: '请求体过大',
  RATE_LIMITED: '请求过于频繁，请稍后再试',
  LOG_NOT_FOUND: '留档记录不存在',
};

// ============================================================
// 业务/安全限额（数值单源：跨模块同语义限定额引用同一常量，禁止散落字面量）
// ============================================================
export const LIMITS = {
  // 请求体
  BODY_LIMIT: 1100000,   // JSON 请求体积硬上限（体积炸弹防护，_worker parseBody 消费）
  // 用户输入
  USERNAME_MIN: 3, USERNAME_MAX: 30,
  PASSWORD_MIN: 6,
  LOGIN_USERNAME_MAX: 60, LOGIN_PASSWORD_MAX: 72, // 登录早退上限（防无谓 PBKDF2/查库）
  INVITE_CODE_LEN: 8,
  COMMENT_MIN_LEN: 2,
  RATING_MIN: 1, RATING_MAX: 5,
  TITLE_MAX: 60,           // 帖子/反馈标题
  SCHOOL_MAX: 30, INTRO_MAX: 50, REAL_NAME_MAX: 20,
  ADDRESS_FIELD_MAX: 100,  // 授课区域
  DEMAND_TIME_MAX: 50,     // 期望开课时间
  BUDGET_MAX: 99999,       // 预算/报价钳制上限
  AVATAR_MAX_BYTES: 20000, // 头像 dataURL
  CREDENTIAL_MAX_BYTES: 500000, // 学信网截图 dataURL
  // 沟通
  MESSAGE_MAX_LEN: 2000,   // 单条消息
  FILE_MAX_BYTES: 700000,  // 附件 dataURL（约 500KB 图片压缩后）
  FILE_NAME_MAX: 100,      // 附件文件名
  UPLOAD_STAGING_MAX: 12,  // 暂存附件件数
  // 内容
  POST_BODY_MAX: 20000,    // 帖子/广播正文
  FEEDBACK_BODY_MAX: 5000, // 反馈正文
  NOTIF_TEXT_MAX: 200,     // 单条通知截断
  BROADCAST_TEXT_MAX: 2000,// 系统广播截断
  DEVICE_UA_MAX: 200,      // 留档 UA 截断
  LOG_DETAIL_MAX: 4096,    // 留档 detail 截断
  LOG_QUERY_MAX: 500,      // 管理端日志检索过量上限
  // 数据层
  PAGE_SIZE: 50, PAGE_HAS_MORE: 51, // keyset 游标分页（LIMIT 51 判 hasMore）
  MSG_LIMIT: 100,          // 消息拉取上限
  RECENT_LIMIT: 8,         // 统计近 N 条
  NOTIF_LIST_MAX: 200,     // 通知列表上限
  STALE_UPLOAD_WINDOW: '-30 minutes', // 暂存附件清理窗口
};

// ============================================================
// 凭证/密码学参数（加密咽喉 server/crypto.js 消费）
// ============================================================
export const SECURITY = {
  TOKEN_TTL_MS: 7 * 24 * 3600 * 1000, // 登录令牌 7 天（前端本地过期判定经 constants.js CONFIG 读同值）
  ONE_TIME_TTL_MS: 5 * 60 * 1000,     // capToken / 邀请码 5 分钟一次性
  PBKDF2_ITERATIONS: 100000,
  PBKDF2_HASH: 'SHA-512',
};

// ============================================================
// 响应头（工具层 json() 与网安咽喉预检共用同一份，防漂移）
// 安全头只对 /api/* 生效（static 层由仓库根 _headers 承担，二者互不纠缠）
// ============================================================
export const CORS_HEADERS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'GET,POST,PUT,DELETE,OPTIONS',
  'Access-Control-Allow-Headers': 'Content-Type',
};

// HTTP 级安全头（frame-ancestors 仅 HTTP 头生效，meta CSP 无法表达）；
// CSP 与页面 meta / 静态 _headers 同源同策略（内联脚本/样式为本站架构所需）
export const SECURITY_HEADERS = {
  'Content-Security-Policy': "default-src 'self'; script-src 'self' 'unsafe-inline'; style-src 'self' 'unsafe-inline' https://fonts.googleapis.com; font-src https://fonts.gstatic.com; img-src 'self' data: blob:; connect-src 'self'; base-uri 'self'; form-action 'self'; frame-ancestors 'none'",
  'Strict-Transport-Security': 'max-age=31536000; includeSubDomains',
  'X-Content-Type-Options': 'nosniff',
  'X-Frame-Options': 'DENY',
  'Referrer-Policy': 'strict-origin-when-cross-origin',
  'Permissions-Policy': 'camera=(), microphone=(), geolocation=()',
};

// ============================================================
// 限流策略（网安咽喉 server/security.js 消费；内存与 D1 双路径读同一配置）
// 窗口单位统一 ms；D1 的 '+N seconds' 由换算生成，避免书写单位分叉
// ============================================================
export const RATE_LIMITS = {
  sweepSize: 4096,                      // 内存命中表惰性清扫阈值
  global: { limit: 300, windowMs: 60000 },    // 全局（含静态）每 IP
  write:  { limit: 60,  windowMs: 60000 },    // 写操作（非 GET）
  login:  { limit: 8,   windowMs: 600000 },   // 按 IP+用户名（防撞库）
  register: { limit: 5, windowMs: 3600000 },  // 按 IP（防批量建号 + PBKDF2 消耗）
  reauth: { limit: 8,   windowMs: 600000 },   // 密码重认证（危险操作二次认证防爆破）
  check:  { limit: 30,  windowMs: 60000 },    // 用户名探测（软限制，不记三振）
  strike: { count: 3,   windowMs: 600000 },   // 三振：窗口内 3 次超限
  block:  { windowMs: 900000 },               // 封禁 15 分钟
};

/** 跨栈数值/服务端非文案常量唯一源（V-1-1）。零依赖，纯数据。 */
export const APP_VERSION = '2.0.1';   // 前端发版基线（dhCheckAppVersion 版本切换清缓存）
export const CONFIG = {
TOKEN_TTL_MS: 7 * 24 * 3600 * 1000,   // 登录令牌有效期（前端本地过期判定；服务端签发同值共享 config SECURITY.TOKEN_TTL_MS）
    BREAKPOINT_MOBILE: 860,               // 移动端断点（与 style.css 主断点同口径）
    CHAT_POLL_MS: 4000,                   // 聊天轮询间隔
    CHAT_SLIDE_DELAY_MS: 120,             // 会话滑动懒加载/自动增高延迟
    CHAT_ATTACH_CONCURRENCY: 4,           // 附件懒加载并发波数（F11：串行 → ~N/4 波，每波一个 RTT）
    CHAT_BUBBLE_DELAY_MS: 12,             // 气泡错峰
    CHAT_FILE_MAX_BYTES: 500 * 1024,      // 前端图片压缩上限（后端 FILE_MAX_BYTES 700000 兜底）
    CHAT_IMG_MAX_SIDE: 900, CHAT_IMG_QUALITY: 0.82, // 聊天图片最长边/JPEG 质量（控制 D1 单元格体积）
    CHAT_IMG_THUMB_SIDE: 128, CHAT_IMG_THUMB_QUALITY: 0.72, // 聊天图缩略图（预载立即展示，点开加载原图）
    COMPLAINT_ATTACH_MAX: 4,                // 投诉附件件数上限（U11；与后端 LIMITS.COMPLAINT_ATTACH_MAX 同值）
    BADGE_POLL_MS: 30000,                 // 红点慢轮询
    PUSH_COOLDOWN_SEC: 60,                // 需求推送限流
    LOGIN_CHECK_DEBOUNCE_MS: 300,         // 登录用户名探测防抖
    API_TIMEOUT_MS: 20000,                // api() fetch 超时（停滞 SW/异常网络下避免「永远加载中」，超时归网络错误）
    GET_RETRY: 1,                         // F1：幂等 GET 网络抖动自动重试次数（fetch 瞬断/DNS/被拒 → 短退避重试自愈；超时/业务错误不重试）
    GET_RETRY_BACKOFF_MS: 300,            // F1：GET 重试退避（短，连不稳时快速自愈，不拖长感知延迟）
    BATCH_GET_MAX: 16,                    // B2：/api/batch 单次批量读上限（服务端 _worker.js 直接导入共享常量校验；前端 dhBatchGet 按此分块——单域缓存键可超限，整批超限会被服务端 400 整批拒绝 → 域刷新静默失效）
    // 验证码/凭证（数据单源：前端 app-otp.js 与后端 server/otp.js 经 globalThis 同读）
    PHONE_REGIONS: [                      // 手机号地区前缀表（固定 +86 前缀显示 + 服务端格式校验共用）
      // 收敛大陆单区（用户批评：多地区前缀"装模作样"）——①只对大陆号有裸号补 +86 适配
      // （CN_MOBILE），其他地区无裸号支持；②验证码生产恒 mock，真实短信服务商基本只支持大陆号；
      // 多地区选择器在产品场景是摆设。支持范围与实际逻辑自洽 = 仅 +86。接入国际短信时再加回。
      { prefix: '+86', name: '中国大陆', pattern: /^1[3-9]\d{9}$/ },
    ],
    OTP_RESEND_SEC: 60,                   // 验证码 60s 重发冷却（前端倒计时/灰化；服务端 LIMITS.OTP_RESEND_WINDOW_MS 同口径强制）
    DEMAND_SCORE_MAX: 12,                 // 需求「科目具体情况」成绩条目数上限（服务端 sanitizeDemand 同读钳制——v0.31.3 审计：原为幽灵引用 + 裸 12 兜底）
    DOMAIN_SCRIPT_RETRY: 4,               // v0.25.100：领域脚本 404 重试次数（发布后边缘同步窗口 ~1-2 分钟，3s×4=12s 覆盖大部分窗口）
    DOMAIN_SCRIPT_RETRY_MS: 3000,         // v0.25.100：领域脚本 404 重试间隔（延迟重试等边缘同步，保留页面状态）
    DOMAIN_SCRIPT_TIMEOUT_MS: 6000,       // 审计：单脚本挂起下载（无 load/error，边缘节点吞请求）超时兜底——按失败走重试/自愈，绝不让 enterClient 永久等待
    VERSION_PROBE_MS: 30000,              // 数据版本探测间隔（每个在线客户端每秒一条探测会放大冷启动/留档成本；30s 内静默拉取变化域仍足够灵敏）
    DH_TTL_MS: 60000,                     // 会话数据层保底 TTL
    POSTS_SEARCH_DEBOUNCE_MS: 350,        // 帖子搜索防抖
    INVITE_CODE_LEN: 8,                   // 邀请码长度（与后端 LIMITS 同值）
    ADMISSION_IMG_MAX: 500000,            // 录取通知书图片 data URL 上限（对齐后端 LIMITS.CREDENTIAL_MAX_BYTES；前端预检防 413）
    AVATAR_SIDE: 160, AVATAR_QUALITY: 0.85,
    CREDENTIAL_SIDE: 1000, CREDENTIAL_QUALITY: 0.8,
    REVIEW_COMMENT_MIN: 2,                // 评价最少字数
    DISPLAY_ID_PAD: 4,                    // 需求编号补零位数
    USERNAME_MIN: 3, USERNAME_MAX: 30,    // 用户名长度下限/上限（前端校验与 server LIMITS.USERNAME_MIN/MAX 对齐，改值两处核对）
    CONTRACT_LOCATION_MAX: 200,           // 合同地点输入上限（对齐 server LIMITS.CONTRACT_LOCATION_MAX）
    PAY_OTHER_MAX: 100,                   // 合同「其他」付款方式/试课薪资自定义文本上限（对齐 server LIMITS.PAY_OTHER_MAX）
    AWARD_TITLE_MAX: 60, AWARD_ISSUER_MAX: 60, // 奖项名称/颁发机构上限（对齐 server/awards.js 本地常量）
    TIME_SLOTS_MAX: 8,                    // 结构化时间组件条数上限（与 server LIMITS.TIME_SLOTS_MAX 对齐）
    PERSONALITY_TAGS_MAX: 3,              // 性格关键词上限（R2-3，前端 toggleTagPick 与服务端兜底同用）
    TEACHING_GOALS_MAX: 2,                // 教学目标上限（≤2，前后端同用）
    SKILL_NOTE_MAX: 300,                  // 技能现状单项目描述上限（描述/证书/考级/获奖）
    GRAD_YEAR_MIN: 1980, GRAD_YEAR_MAX: 2030, // 教师毕业年份可填范围（R2-12，服务端钳制同值）
    SIDEBAR_INDEX_PAD: 2,                 // 侧边栏序号补零位数
    POST_TITLE_MAX: 60, POST_TITLE_WARN: 55, POST_SNIPPET: 80, // 帖子标题/摘要
    GREETING_MSG_MAX: 300,                // 打招呼消息上限（学生推送需求/教师试课意向附带；与服务端 LIMITS.GREETING_MSG_MAX 同值）
    MATCH_WEIGHT: { subject: 45, region: 15, budget: 15, personality: 15, gender: 10 },     // 教师匹配度权重（合计 100；需求五并入性格/性别，科目仍为主权重）
    MATCH_DISTANCE_MAX_KM: 20,            // 需求五：上海线下单镇间距离评分上限 km——20km 内随距离线性下降至 0，更远恒 0（用户定策）
    MATCH_MAX: 100,
    MATCH_COLOR_HIGH: 80,                 // 匹配度按钮三色阈值：≥80 绿（hi）
    MATCH_COLOR_MID: 60,                  // 60-79 黄（mid），<60 红（lo）
    GENDER_MATCH_UNDISCLOSED: 50,         // 教师性别未透露（undeclared/历史 nonbinary/未填）对明确偏好需求的得分（需求五·性别匹配）
    MAX_MATCH_DETAIL_OFFSET: 6,           // 匹配明细卡下偏 px（B4：max-height 注入已删，卡片随内容拉长）
    MATCH_DETAIL_EDGE_MARGIN: 8,          // 匹配明细卡距屏幕左右缘最小边距 px
    PANEL_CLOSE_TIMEOUT_MS: 600,          // 个人信息栏关闭兜底
    TOAST_MS: 2500, TOAST_FADE_MS: 300,   // Toast 时长
    REVEAL_DELAY_BASE: 80, REVEAL_DELAY_STEP: 45, REVEAL_DELAY_MAX: 360, // 卡片浮入错峰
    REAUTH_FOCUS_MS: 50,                  // 二次认证弹窗聚焦延迟
    REOPEN_DELAY_MS: 800,                 // 邀请码确认→注册跳转 / 注销→登出延迟
    MODAL_W_CONFIRM: '380px',             // 确认类弹窗宽度（散落 380/400/420/430/480 收敛）
    MODAL_W_SEND: '480px', MODAL_W_DEACTIVATE: '430px', MODAL_W_PROFILE_HINT: '420px',
    MODAL_W_INTENT_CONFIRM: '400px',        // 试课意向确认弹窗（散落硬编码宽度收进 CONFIG）
    MODAL_W_ONBOARD: '580px',               // 首访 onboarding 弹窗宽度（= base.css .modal 默认 max-width，零布局变化；宽度单源化，h5a-g2）
    TOUR_TARGET_TIMEOUT_MS: 3000,         // 新手引导：目标未挂载 rAF 轮询超时，超时自动跳过该步
    TOUR_RETRY_MS: 350,                     // v1.4.5：函数式步骤停留重试间隔（学信网门控/异步渲染未就绪时）
    TOUR_GAP_PX: 16,                      // 新手引导：文字气泡与亮区间距（JS 定位用）
    TOUR_SCROLL_BAND_LO: 0.3, TOUR_SCROLL_BAND_HI: 0.7, // 需求五十四：新手引导滚动后目标中心须落容器可视区竖带（比例）
    TOUR_ANIM_DEADLINE_MS: 2000,          // 新手引导：等祖先动画结束定位亮区的硬上限（防永动动画卡死亮区）
    TOUR_DEMO_POLL_MS: 200,               // 新手引导：demo 会话/合同注入轮询间隔（等列表渲染完成）
    TOUR_BUBBLE_W: 300, TOUR_BUBBLE_H: 90, // 新手引导：气泡回退尺寸（offsetWidth/Height 探测失败时）
    TOUR_BUBBLE_MARGIN: 8,                // 新手引导：气泡视口最小边距 px
    TOUR_VIEWPORT_W: 1024, TOUR_VIEWPORT_H: 768, // 新手引导：视口尺寸几何兜底（innerWidth/clientHeight 为 0 时，jsdom 无布局）
    PROFILE_ROW_GAP: 11,                  // 需求六·item1：教师资料卡条目纵向间距 px；#156行距压半 22→11
    FILTER_ROW_GAP: 16,                   // 需求五：筛选面板多排下拉栏之间的纵向空隙 px（上下两排不能零空隙紧贴）
    UI_SCALE_MIN: 80, UI_SCALE_MAX: 120, UI_SCALE_DEFAULT: 100, UI_SCALE_STEP: 1, // 需求六·item5：UI 大小滑块范围/步进（百分比；100=现状；v0.25.12 上限扩到 120）
    UI_SCALE_WHEEL_STEP: 4, // ctrl+滚轮每格步长（=4×滑块 step）
    UI_SCALE_REFLOW_SAMPLE_STEP: 20, // 元素级模拟重排：真实重排目标位采样档位步长（5%→20%——9 档→3 档 [80/100/120]，每档一次整树 reflow 是采样成本大头（生产 1300+ 单元 ~100ms/档），3 档 ~300ms 且档间线性插值足够——--ui-scale 乘性变换目标位近线性；UI_SCALE_REFLOW_SAMPLE_STEP 单源）
    UI_SCALE_REFLOW_WARM_DELAY_MS: 600, // 预热采样延迟：必须大于侧边栏 active 过渡时长（style.css --t-slow 420ms）——点击设置瞬间采样改 --ui-scale 会把进行中的过渡重定向（侧边栏抽搐根因），延迟等动画完成再采样
    UI_SCALE_KEY: 'sufe_ui_scale',        // 需求六·item5：UI 大小偏好 localStorage 键（参照 setThemePref 的 sufe_theme 模式）
    STYLE_KEY: 'sufe_style',              // 需求八·item4：页面风格偏好 localStorage 键（liquid/flat）
    THEME_KEY: 'sufe_theme',
    ORB_KEY: 'sufe_orb',                  // 需求八·item3：背景光球偏好 localStorage 键（vivid/elegant/hidden）
    NOTIF_BLOCK_KEY: 'sufe_block_broadcast', // 屏蔽系统通知偏好 localStorage 键
    DEVICE_ID_KEY: 'sufe_device_id',      // 设备标识 localStorage 键
    CONTRACT_SIGN_READ_SECONDS: 30,       // 签约加固：合同确认前须滚动到底 + 待够此时长（秒）
    CONTRACT_SIGN_SCROLL_EPS: 2,          // 签约加固：判定「滚到底」的底部容差 px（无溢出短合同视同已到底）
};
export const LIMITS = {
  BODY_LIMIT: 1100000,
  USERNAME_MIN: CONFIG.USERNAME_MIN,
  USERNAME_MAX: CONFIG.USERNAME_MAX,
  PASSWORD_MIN: 6,
  LOGIN_USERNAME_MAX: 60,
  LOGIN_PASSWORD_MAX: 72,
  INVITE_CODE_LEN: CONFIG.INVITE_CODE_LEN,
  COMMENT_MIN_LEN: CONFIG.REVIEW_COMMENT_MIN,
  RATING_MIN: 1,
  RATING_MAX: 5,
  TITLE_MAX: CONFIG.POST_TITLE_MAX,
  SCHOOL_MAX: 30,
  INTRO_MAX: 50,
  REAL_NAME_MAX: 20,
  CONTACT_MAX: 50,
  ADDITIONAL_INFO_MAX: 500,
  GREETING_MSG_MAX: CONFIG.GREETING_MSG_MAX,
  ADDRESS_FIELD_MAX: 100,
  SCHEDULE_MAX: 200,
  CONTRACT_LOCATION_MAX: CONFIG.CONTRACT_LOCATION_MAX,
  PAY_OTHER_MAX: CONFIG.PAY_OTHER_MAX,
  CONTRACT_PLAN_MAX: 20000,
  CONTRACT_SCHEDULE_MAX: 500,
  CONTRACT_MD_MAX: 30000,
  GAOKAO_SCORE_MAX: 300,
  DEMAND_TIME_MAX: 2000,
  TIME_SLOTS_MAX: CONFIG.TIME_SLOTS_MAX,
  GRAD_YEAR_MIN: CONFIG.GRAD_YEAR_MIN,
  GRAD_YEAR_MAX: CONFIG.GRAD_YEAR_MAX,
  BUDGET_MAX: 99999,
  AVATAR_MAX_BYTES: 20000,
  CREDENTIAL_MAX_BYTES: CONFIG.ADMISSION_IMG_MAX,
  MESSAGE_MAX_LEN: 2000,
  FILE_MAX_BYTES: 700000,
  THUMB_MAX_BYTES: 20000,
  FILE_NAME_MAX: 100,
  UPLOAD_STAGING_MAX: 12,
  MSG_BATCH_MAX: 13,
  POST_BODY_MAX: 20000,
  FEEDBACK_BODY_MAX: 5000,
  COMPLAINT_DETAIL_MAX: 2000,
  COMPLAINT_DAILY_LIMIT: 5,
  ADMIN_SEARCH_MAX: 50,
  COMPLAINT_MINE_MAX: 100,
  COMPLAINT_ADMIN_MAX: 200,
  COMPLAINT_CANDIDATE_MAX: 8,
  COMPLAINT_ATTACH_MAX: CONFIG.COMPLAINT_ATTACH_MAX,
  BROADCAST_TEXT_MAX: 2000, BROADCAST_TITLE_MAX: 60,
  // 处罚通知三段截断预算（reason/rule/summary 分预算，客户端渲染总长 <200）
  PENALTY_REASON_MAX: 80, PENALTY_RULE_MAX: 30, PENALTY_SUMMARY_MAX: 40,
  DEVICE_UA_MAX: 200,
  LOG_DETAIL_MAX: 4096,
  LOG_QUERY_MAX: 500,
  SLOW_GET_MS: 2000,
  METRICS_FLUSH_MS: 60000,
  METRICS_BUCKET_MIN: 5,
  METRICS_RETENTION_DAYS: 30,
  PAGE_SIZE: 50,
  PAGE_HAS_MORE: 51,
  MSG_LIMIT: 100,
  RECENT_LIMIT: 8,
  NOTIF_LIST_MAX: 200,
  PUBLIC_LIST_MAX: 200,
  REVIEW_LIST_MAX: 200,
  FEEDBACK_MINE_MAX: 100,
  FEEDBACK_ADMIN_MAX: 200,
  STALE_UPLOAD_WINDOW: "-30 minutes",
  OTP_CODE_TTL_MS: 300000,
  OTP_RESEND_WINDOW_MS: CONFIG.OTP_RESEND_SEC * 1000,
  OTP_DAILY_MAX: 10,
  OTP_MAX_ATTEMPTS: 3,
  OTP_CODE_MIN: 100000,
  OTP_CODE_MAX: 999999,
  PHONE_MAX: 20,
  EMAIL_MAX: 100,
  USERNAME_COOLDOWN_MS: 604800000,
};
export const SECURITY = {
  TOKEN_TTL_MS: CONFIG.TOKEN_TTL_MS,
  ONE_TIME_TTL_MS: 300000,
  TOKEN_BYTES: 24,
  CAP_TOKEN_BYTES: 16,
  RATE_CLEANUP_THROTTLE_MS: 60000,
  RATE_ROW_RETENTION: "-1 day",
  PBKDF2_ITERATIONS: 100000,
  PBKDF2_HASH: "SHA-512",
  TOKEN_HASH_HEX_LEN: 64, // tokenDigest = SHA-256 → 64 位 hex（validate-prod-data 等工具据此校验库存摘要长度）
};
export const TEXT_AUDIT = {
  BASE_URL: "https://api.deepseek.com/chat/completions",
  MODEL: "deepseek-chat",
  TIMEOUT_MS: 4000,
};
export const RATE_LIMITS = {
  sweepSize: 4096,
  global: {
  "limit": 300,
  "windowMs": 60000
},
  write: {
  "limit": 60,
  "windowMs": 60000
},
  login: {
  "limit": 8,
  "windowMs": 600000
},
  register: {
  "limit": 5,
  "windowMs": 3600000
},
  reauth: {
  "limit": 8,
  "windowMs": 600000
},
  check: {
  "limit": 30,
  "windowMs": 60000
},
  strike: {
  "count": 3,
  "windowMs": 600000
},
  block: {
  "windowMs": 900000
},
};
export const CORS_ALLOWED_ORIGINS = [
  "https://sufe-tutor.pages.dev"
];
export const CORS_HEADERS = {
  'Access-Control-Allow-Origin': "https://sufe-tutor.pages.dev",
  'Access-Control-Allow-Methods': "GET,POST,PUT,DELETE,OPTIONS",
  'Access-Control-Allow-Headers': "Content-Type",
};
export const SECURITY_HEADERS = {
  'Content-Security-Policy': "default-src 'self'; script-src 'self'; style-src-elem 'self'; style-src-attr 'none'; img-src 'self' data: blob:; connect-src 'self'; base-uri 'self'; form-action 'self'; frame-ancestors 'none'",
  'Strict-Transport-Security': "max-age=31536000; includeSubDomains",
  'X-Content-Type-Options': "nosniff",
  'X-Frame-Options': "DENY",
  'Referrer-Policy': "strict-origin-when-cross-origin",
  'Permissions-Policy': "camera=(), microphone=(), geolocation=()",
};
// 前端教师注册门控休眠开关（根 constants.js 顶层同值；false=门控启用，true=开放注册休眠）
export const INVITE_GATE_DORMANT = false;
export const INVITE_GATE_ENABLED = true;
export const LEGACY_ADMIN_PASSWORD = "admin_sufe";
export const INITIAL_RATING = 4.5;
export const INITIAL_WEIGHT = 10;
export const NUM_T = "[0-9０-９一二三四五六七八九十百千万亿两〇零壹贰叁肆伍陆柒捌玖拾佰仟萬億]";
export const NUM_SEP = "[-·、．.，, ]";
export const ADDRESS_GUARD = /(?:(?:[0-9０-９一二三四五六七八九十百千万亿两〇零壹贰叁肆伍陆柒捌玖拾佰仟萬億][-·、．.，, ]?)+[0-9０-９一二三四五六七八九十百千万亿两〇零壹贰叁肆伍陆柒捌玖拾佰仟萬億][-·、．.，, ]?号(?!线)|(?:[0-9０-９一二三四五六七八九十百千万亿两〇零壹贰叁肆伍陆柒捌玖拾佰仟萬億][-·、．.，, ]?)*[0-9０-９一二三四五六七八九十百千万亿两〇零壹贰叁肆伍陆柒捌玖拾佰仟萬億][-·、．.，, ]?(?:号楼|室|栋|单元|门牌))/;
export const PHONE_HASH_COND = "phone_hash=? AND phone_hash != ''";
export const EMAIL_HASH_COND = "email_hash=? AND email_hash != ''";

/**
 * 前端常量 — 业务数据 + UI 文字 + 系统通知模板
 * 挂 globalThis：浏览器经典脚本（window）与 worker ESM import 两用（同 region-data.js），
 * 服务端文案（婉拒通知等）亦统一在此维护，改文案只动这一个文件。
 * API 错误消息常量另见 server/constants.js MSG 块。
 */
globalThis.APP_CONSTANTS = {

  // 教师注册邀请码门控：休眠中（true = 门控沉睡，教师注册免邀请码直接提交；与后端 server/constants.js INVITE_GATE_ENABLED 同步）
  // 内测期间沉默：简易注册、无需邀请码；公测前如需恢复，置回 false 并同步后端开关
  // 网安报告 F-05：教师开放注册属高危，恢复门控时注册必须经管理员签发邀请码
  INVITE_GATE_DORMANT: true,

  // 版本号 x.y.z：x=0 内测 / 1 正式；y 每上线新模块/启用新功能 +1；z 每小修小补/审查去屎山推送 +1
  APP_VERSION: '1.0.3',

  // ============================================================
  // 跨栈/前端共享数值配置（改交互参数只动这里；服务端同值键经 globalThis.APP_CONSTANTS.CONFIG 读取，
  // 与 server/constants.js 中对应键注释对齐——改值两处核对。前端模块禁止散落裸数字，一律引本块）
  // ============================================================
  CONFIG: {
    TOKEN_TTL_MS: 7 * 24 * 3600 * 1000,   // 登录令牌有效期（前端本地过期判定；服务端签发同值 server/constants.js SECURITY.TOKEN_TTL_MS）
    BREAKPOINT_MOBILE: 860,               // 移动端断点（与 style.css 主断点同口径）
    CHAT_POLL_MS: 4000,                   // 聊天轮询间隔
    CHAT_SLIDE_DELAY_MS: 120,             // 会话滑动懒加载/自动增高延迟
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
    BATCH_GET_MAX: 16,                    // B2：/api/batch 单次批量读上限（服务端 _worker.js 经 APP_CONSTANTS 同读校验；前端 dhBatchGet 按此分块——单域缓存键可超限，整批超限会被服务端 400 整批拒绝 → 域刷新静默失效）
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
    AVATAR_SIDE: 160, AVATAR_QUALITY: 0.85,
    CREDENTIAL_SIDE: 1000, CREDENTIAL_QUALITY: 0.8,
    REVIEW_COMMENT_MIN: 2,                // 评价最少字数
    DISPLAY_ID_PAD: 4,                    // 需求编号补零位数
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
    TOUR_TARGET_TIMEOUT_MS: 3000,         // 新手引导：目标未挂载 rAF 轮询超时，超时自动跳过该步
    TOUR_GAP_PX: 16,                      // 新手引导：文字气泡与亮区间距（JS 定位用）
    TOUR_SCROLL_BAND_LO: 0.3, TOUR_SCROLL_BAND_HI: 0.7, // 需求五十四：新手引导滚动后目标中心须落容器可视区竖带（比例）
    PROFILE_ROW_GAP: 11,                  // 需求六·item1：教师资料卡条目纵向间距 px；#156行距压半 22→11
    FILTER_ROW_GAP: 16,                   // 需求五：筛选面板多排下拉栏之间的纵向空隙 px（上下两排不能零空隙紧贴）
    UI_SCALE_MIN: 80, UI_SCALE_MAX: 120, UI_SCALE_DEFAULT: 100, UI_SCALE_STEP: 1, // 需求六·item5：UI 大小滑块范围/步进（百分比；100=现状；v0.25.12 上限扩到 120）
    UI_SCALE_WHEEL_STEP: 4, // ctrl+滚轮每格步长（=4×滑块 step）
    UI_SCALE_REFLOW_SAMPLE_STEP: 20, // 元素级模拟重排：真实重排目标位采样档位步长（5%→20%——9 档→3 档 [80/100/120]，每档一次整树 reflow 是采样成本大头（生产 1300+ 单元 ~100ms/档），3 档 ~300ms 且档间线性插值足够——--ui-scale 乘性变换目标位近线性；UI_SCALE_REFLOW_SAMPLE_STEP 单源）
    UI_SCALE_KEY: 'sufe_ui_scale',        // 需求六·item5：UI 大小偏好 localStorage 键（参照 setThemePref 的 sufe_theme 模式）
    STYLE_KEY: 'sufe_style',              // 需求八·item4：页面风格偏好 localStorage 键（liquid/flat）
    THEME_KEY: 'sufe_theme',
    ORB_KEY: 'sufe_orb',                  // 需求八·item3：背景光球偏好 localStorage 键（vivid/elegant/hidden）
    NOTIF_BLOCK_KEY: 'sufe_block_broadcast', // 屏蔽系统通知偏好 localStorage 键
    DEVICE_ID_KEY: 'sufe_device_id',      // 设备标识 localStorage 键
    CONTRACT_SIGN_READ_SECONDS: 30,       // 签约加固：合同确认前须滚动到底 + 待够此时长（秒）
    CONTRACT_SIGN_SCROLL_EPS: 2,          // 签约加固：判定「滚到底」的底部容差 px（无溢出短合同视同已到底）
  },

  // ============================================================
  // 业务数据
  // ============================================================
  // 状态枚举：与后端 server/constants.js STATUS 逐字对齐（前端比较/赋值统一引这里，禁止散落硬编码字面量）。
  // 改动值会破坏 SQL 兼容，两端必须同步
  STATUS: {
    OPEN: 'open', CONTRACTED: 'contracted', REVOKED: 'revoked', PENDING: 'pending',
    ACCEPTED: 'accepted', REJECTED: 'rejected', SIGNING: 'signing', SIGNED: 'signed',
    APPROVED: 'approved', ACTIVE: 'active', CLOSED: 'closed', RESOLVED: 'resolved',
  },

  SUBJECTS: [
    { id: 'chinese', name: '语文', maxScore: 150 },
    { id: 'math', name: '数学', maxScore: 150 },
    { id: 'english', name: '英语', maxScore: 150 },
    { id: 'physics', name: '物理', maxScore: 100 },
    { id: 'chemistry', name: '化学', maxScore: 100 },
    { id: 'biology', name: '生物', maxScore: 100 },
    { id: 'history', name: '历史', maxScore: 100 },
    { id: 'geography', name: '地理', maxScore: 100 },
    { id: 'politics', name: '政治', maxScore: 100 },
  ],

  STUDENT_GRADES: [
    // M3：补小学六年级（外地六三学制）+ 预备班（上海五四学制：六年级=初中预备）。
    // 全列表 = 六三学制（默认）；五四学制省份按 SCHEDULE 学制映射过滤（app-demands 渲染层）。
    {id:'p1',name:'小学一年级'},{id:'p2',name:'小学二年级'},{id:'p3',name:'小学三年级'},
    {id:'p4',name:'小学四年级'},{id:'p5',name:'小学五年级'},
    {id:'p6',name:'小学六年级'},{id:'prep',name:'预备班'},
    {id:'junior1',name:'初一'},{id:'junior2',name:'初二'},{id:'junior3',name:'初三'},
    {id:'senior1',name:'高一'},{id:'senior2',name:'高二'},{id:'senior3',name:'高三'},
  ],
  // M3：学制地区差异单源——五四学制省份（小学五年+初中四年，六年级=初中预备班）。
  // 默认六三学制（小学六年）；上海为五四学制（2004 年市教委全面实行）。其余省市主流六三。
  FIVE_FOUR_PROVINCES: ['shanghai'],

  TEACHER_GRADES: [
    {id:'freshman',name:'大一'},{id:'sophomore',name:'大二'},{id:'junior',name:'大三'},
    {id:'senior',name:'大四'},{id:'master',name:'硕士'},{id:'phd',name:'博士'},
    {id:'graduated_bachelor',name:'本科学历 已毕业'},{id:'graduated_master',name:'硕士学历 已毕业'},{id:'graduated_phd',name:'博士学历 已毕业'},
  ],

  // 教师侧性别（资料/筛选沿用）；学生需求侧性别由表单在 app-demands.js 构造。
  // undeclared = 不愿透露（默认选项，视同未填，展示层统一不显文字；吸收历史 ''/nonbinary 语义）。
  // 顺序即默认：不愿透露排首位，教师资料下拉默认选中它。学生侧以 '' 表示不愿透露，剔除 undeclared。
  GENDERS: [{id:'undeclared',name:'不愿透露'},{id:'male',name:'男'},{id:'female',name:'女'}],
  TEACHING_METHODS: [{id:'online',name:'线上'},{id:'offline',name:'线下'},{id:'both',name:'线上线下均可'}],
  // 结构化时间组件：期望开课/可授课时间段的下拉枚举（1=周一 … 7=周日）
  WEEKDAYS: [
    {id:1,name:'周一'},{id:2,name:'周二'},{id:3,name:'周三'},{id:4,name:'周四'},
    {id:5,name:'周五'},{id:6,name:'周六'},{id:7,name:'周日'},
  ],
  // 性格关键词（R2-3）：教师档案 tag 白名单（id 英文小写、name 中文），服务端经本数组校验
  PERSONALITY_TAGS: [
    {id:'patience',name:'耐心'},{id:'strict',name:'严格'},{id:'humorous',name:'幽默'},
    {id:'gentle',name:'温柔'},{id:'logical',name:'逻辑清晰'},{id:'friendly',name:'亲和力强'},
    {id:'responsible',name:'认真负责'},{id:'methodical',name:'有方法'},{id:'spoken',name:'口语标准'},
    {id:'motivating',name:'善于鼓励'},
  ],
  // 擅长非学科类项目（R2-4）：非学科类项目白名单（id 英文小写、name 中文）
  NONACADEMIC_PROJECTS: [
    {id:'music',name:'乐器/音乐'},{id:'vocal',name:'声乐'},{id:'painting',name:'绘画'},
    {id:'dance',name:'舞蹈'},{id:'calligraphy',name:'书法'},{id:'chess',name:'棋类'},
    {id:'code',name:'编程/机器人'},{id:'sports',name:'体育/运动'},{id:'speech',name:'演讲主持'},
    {id:'language',name:'语言口语'},
  ],
  // 教学目标：「详细偏好」拆分后的教学目标白名单（id 英文小写、name 中文），
  // 学科/非学科通用；服务端经本数组校验（同 PERSONALITY_TAGS 口径，静默截断不拒绝整表）
  TEACHING_GOALS: [
    {id:'score',name:'提分'},{id:'advanced',name:'培优'},{id:'contest',name:'竞赛'},
    {id:'interest',name:'兴趣培养'},{id:'habit',name:'习惯养成'},{id:'cram',name:'考前冲刺'},
  ],

  // 需求类型（R2-b）：student_demands.target_type 取值单源（状态字面量铁律同 STATUS）。
  // 学科 / 非学科 双表单的分流判断与服务端白名单都从这读，禁止散落 'academic'/'nonacademic' 字面量
  DEMAND_TYPES: { ACADEMIC: 'academic', NONACADEMIC: 'nonacademic' },

  // ============================================================
  // LIQUID GLASS 统一观感配置（改玻璃观感只动这里）
  //   材质注入器已连根拔除（0.19.1）：玻璃填充一律住 glass.css 的 --g-fill，
  //   单源单一——不再有 JS 并行系统覆盖组件填充（用户纪律：竞争/覆盖→删一方）。
  //   毛度（frost）0.19.6 收进本配置：改观感只动 constants，注入器换算 --g-f-* 变量。
  //   层级纪律（用户）：容器（浮窗/卡）毛 = 可读纸面；控件（表头/按钮/选项卡）透 = 玻璃上的玻璃。
  // ============================================================
  LG: {
    radius: { sm: 9, md: 12, lg: 15 },   // 小圆角
    bg: { blur: 6 },           // 背景底板：轻磨砂（让多而小的光球现形为柔形；可读性改由组件自带轻磨砂承担）
    orbCrossSec: 60,                      // 光球横穿全屏约 60s
    // 需求八·item3 背景光球三档（外观设置「背景光球外观」：鲜艳=当前效果 / 淡雅=柔化 / 隐藏=零光球）。
    //   count 桌面光球数；countCoarse 低端移动端数（指针粗→减量保帧）；opMin/opMax 透明度区间；
    //   sizeMin/sizeMax 尺寸区间（vmax）。index.html 首绘 IIFE 读取本配置生成，几何参数单源（禁散落裸数字）。
    orbModes: {
      vivid:   { count: 36, countCoarse: 12, opMin: .52, opMax: .73, sizeMin: 10, sizeMax: 28 },  // 当前效果
      elegant: { count: 24, countCoarse: 8,  opMin: .13, opMax: .26, sizeMin: 8,  sizeMax: 18 },  // 若有若无
      hidden:  { count: 0, countCoarse: 0 },                                                       // 纯净底
    },
    glow: { size: 230, opacity: .85 },    // 鼠标跟随发光圆（无阻尼紧咬）
    // 组件毛度统一配置（改观感只动这里）：容器毛 / 控件透
    frosts: {
      card:   'blur(6px) saturate(180%) brightness(1.05)',   // 卡片=可读纸面（毛）
      cardM:  'blur(4px) saturate(180%) brightness(1.05)',   // 移动端降档
      modal:  'blur(24px) saturate(180%) brightness(1.04)',  // 浮窗=重毛纸面（内容可读；v0.19.23 blur 16→24，透底下文字）
      // 注：无 modalM——v0.23.1 起移动端浮窗与桌面共用 modal（同屏 1-2 件，不构成帧率风险；用户指示统一）
      header: 'blur(12px)',                                  // 浮窗表头=透（玻璃上的玻璃；v0.19.35 白值降 .08 后毛度补强，滚动可读）
      btn:    'blur(4px) saturate(180%) brightness(1.04)',   // 按钮=透色透镜
      entry:  'blur(4px) saturate(180%) brightness(1.04)',   // 主页大按钮=透
      pill:   'blur(4px) saturate(180%) brightness(1.04)',   // 侧栏选中块=透
      nav:    'blur(8px)',                                   // 顶栏
      side:   'blur(8px)',                                   // 侧边栏
    },
  },

  // ============================================================
  // 外观包（需求八·item4 页面风格）：每份外观包 = 语义 token 增量 + 特殊效果协调。
  // 架构（上网调研：语义 token 分层 + [data-style][data-theme] 正交维度，lombokcss 实证）：
  //   玻璃引擎组件一律只消费语义 token（--g-fill/--g-frost/--g-lift…），外观包只 remap 语义层——
  //   liquid 零覆盖（等价现状）；flat 把半透明玻璃面→不透明纸面、磨砂/投影/液体边缘→none/透明、
  //   光球档位→hidden（orbMode 读 data-style 协调）。切换 = JS setProperty 换 token 组，零组件改动。
  //   值引用主题语义色（var(--paper) 等）→ 深浅主题自适应；键全量清空再应用，防残留。
  //   index.html 内联 IIFE 首绘应用（无 FOUC）；app-style.js 提供设置接口。
  // ============================================================
  STYLE_PACKS: {
    liquid: {
      // 液态玻璃：默认外观包，零 token 覆盖（等价现状）
      tokens: {},
    },
    flat: {
      orb: 'hidden', // 特殊效果协调：平面简约强制光球隐藏（orbMode 读 <html data-style>）
      tokens: {
        // #164：平面简约改白色系——覆盖基底 底/纸/线 token（theme 块提供 --flat-* 深浅自适应），
        // 下游全部 var(--paper)/var(--g-bg) 引用随变纯白系，无需逐条改
        '--g-bg': 'var(--flat-bg)', '--paper': 'var(--flat-paper)', '--paper-2': 'var(--flat-paper-2)',
        '--paper-3': 'var(--flat-paper-3)', '--line': 'var(--flat-line)',
        // ---- 磨砂/底板虚化 → 全关（backdrop-filter 归零 = 平面关键） ----
        '--g-f-card': 'none', '--g-f-cardM': 'none', '--g-f-modal': 'none', '--g-f-header': 'none',
        '--g-f-btn': 'none', '--g-f-entry': 'none', '--g-f-pill': 'none', '--g-f-nav': 'none', '--g-f-side': 'none',
        '--lg-bg-blur': '0px',
        // ---- 表面填充 → 不透明（引用主题语义色，深浅自适应） ----
        '--g-plate': 'var(--g-bg)',           // 底板渐变 → 纯底色（无光球无磨砂即纯净底）
        '--g-paper': 'var(--paper)',          // 浮窗/面板 → 不透明纸面
        '--g-paper-bright': 'var(--paper)',
        '--g-fill-strong': 'var(--paper-2)',  // 标签/选中态/侧栏选中块
        '--g-seg-fill': 'var(--paper-2)',     // 分段选中（flat：纸面，与 --g-fill-strong 同源，平面现状不变）
        '--g-fill-weak': 'var(--paper-2)',    // 输入控件/勾选/分段容器
        '--g-fill-faint': 'var(--paper-3)',   // 微透面 → 最浅纸面
        '--g-fill-mid': 'var(--paper-2)',
        '--g-card-fill': 'var(--paper)',      // 卡族弯月径向 → 纯纸面
        // ：flat light 三卡深度修正。三卡坐在纯白面板（profile-panel = --paper）上，
        // 卡片须比纯白深一档微灰（用户：「教师卡本身就是纯白，所以三卡应该是10度灰」）——原映射
        // --paper-3（#E5E7EB，24 度）比页面底 #F4F5F7（10 度）还深，成页面最深组件。
        // 改 --g-bg（flat light = #F4F5F7 = 10 度灰）：三卡与页面同灰、在纯白面板上恰好 10 度层次。
        // 深浅主题随 --flat-bg 自适应（dark 下三卡同暗底，面板 --paper 稍亮，层次保留）。
        '--g-card-strong': 'var(--paper-2)', '--g-card-id': 'var(--g-bg)',
        '--g-card-strong-m': 'var(--paper-2)', '--g-card-id-m': 'var(--g-bg)',
        '--g-header-fill': 'var(--paper-2)',
        '--g-sideuser-fill': 'var(--paper-2)',
        '--g-pane-fill': 'var(--paper-3)',    // 会话 pane 比选中 pill 深一档（pill paper-2 浮起，选中态可辨）
        '--g-sidebar-bg': 'var(--paper)', '--g-sidebar-bg-m': 'var(--paper)', '--g-navbar-bg': 'var(--paper)',
        '--g-avatar-fill': 'var(--paper-3)', '--g-avatar-fill-ghost': 'var(--paper-3)',
        '--g-avatar-border': 'var(--line)', '--g-avatar-border-ghost': 'var(--line)',
        '--g-btn-fill': 'var(--g-fill-weak)',   // 按钮透明透镜 → 不透明纸面（防平面模式按钮隐形）
        '--g-btn-line': 'var(--line)',          // R11 轻量描边按钮细边框对齐平面全局发丝边
        // 气泡不设 flat 特例：theme 近实值（#E9E5FB/#FFFFFF）液态平面同源，材质差异已由零投影/零液体边承担
        '--g-flow-dot': 'var(--paper-3)', // 圆点填纸面（与 ink 数字反色），修平面下数字/圆圈同色不可见
        '--g-ok-solid': 'var(--ok-deep)',
        // ---- 表面发丝描边（审计 H1/H2：平面无阴影无磨砂，靠描边定义表面边界；
        //      引擎 base border: var(--g-border, none)；.btn 同源；实心小件 .seg-tab/.tag 等 opt-out 不带边） ----
        '--g-border': '1px solid var(--line)',
        // ---- 线条族 → 墨线（半透明白线在不透明纸面上不可见） ----
        '--g-line-soft': 'var(--line)', '--g-line-pane': 'var(--line)', '--g-line-dark': 'var(--line)',
        '--g-seg-line': 'var(--line)', '--g-option-line': 'var(--line)', '--g-foot-text': 'var(--muted)',
        // ---- 下拉高亮 → 中性浅墨 ----
        '--g-option-hover': 'rgba(17,17,20,.06)', '--g-option-sel': 'rgba(17,17,20,.10)',
        '--g-option-ring': 'rgba(17,17,20,.16)',
        // ---- 投影/液体边缘 → 透明占位（box-shadow 列表禁 none 混入，v0.19.17 教训） ----
        '--glass-lift': '0 0 0 0 transparent', '--glass-lift-sm': '0 0 0 0 transparent',
        '--g-liquid': '0 0 0 0 transparent', '--g-liquid-sm': '0 0 0 0 transparent',
        '--g-pane-shadow': '0 0 0 0 transparent',
        '--g-panel-lift': 'transparent', '--g-panel-lift-m': 'transparent',
        '--g-seg-lift': '0 0 0 0 transparent',       // 分段选中浮影别名（glass.css 漏网点改造）
        '--g-panel-backdrop-blur': 'none',           // 右栏遮罩虚化别名（style.css 漏网点改造）
        // ---- hover 白洗 → 中性灰洗（深浅底通用；白洗在不透明纸面上不可见） ----
        '--g-hover-wash': 'rgba(120,120,132,.12)',
        // ---- 匹配条空轨/填充段 ----
        '--g-bar-soft': 'var(--paper-3)', '--g-bar-strong': 'var(--accent-tint)',
        // ---- 内生滚动条：平面 = 墨色发丝细条（color-mix 引主题 ink，深浅自适应；
        //       无磨砂无投影，材质与液态包的半透明紫玻璃区分；宽度收窄到 6px 更纤） ----
        '--g-scroll-size': '6px',
        '--g-scroll-thumb': 'color-mix(in srgb, var(--ink) 20%, transparent)',
        '--g-scroll-thumb-strong': 'color-mix(in srgb, var(--ink) 34%, transparent)',
        '--g-scroll-thumb-active': 'color-mix(in srgb, var(--ink) 46%, transparent)',
      },
    },
  },

  // ============================================================
  // 主题（外观设置，v0.19.49）：全站颜色单源——改配色只动这里
  //   结构：key = CSS 变量名（含 --），value = 颜色值。
  //   light 为亮色全量（= 原 CSS :root 值，向后兼容兜底）；dark 只列与亮色的差异键。
  //   注入：index.html 底部脚本读偏好（localStorage 'sufe_theme'：light/dark/system 缺省 system）
  //   把 THEME[主题] 全部 setProperty 到 <html> 内联样式（首帧前同步执行，无 FOUC）；
  //   system 时监听 prefers-color-scheme 实时跟随系统。CSS :root 里的同名变量仅为
  //   无 JS 时的亮色兜底，日常渲染永远被本注入覆盖。
  //   光球九色（--lg-orb-*）为 RGB 三元组（供 rgba(var(--lg-orb-*),op) 组合），暗色沿用亮色值。
  //   移动端覆盖值（--g-card-strong-m 等）由 glass.css @media 引用本 token。
  // ============================================================
  THEME: {
    light: {
      // ---- 语义色（style.css :root 原值） ----
      '--paper': '#FAF8F5', '--paper-2': '#F1EEE9', '--paper-3': '#E3DFD8',
      '--lilac': '#D8D4DD', '--lilac-2': '#CFCBD6',
      '--ink': '#111114', '--ink-2': '#232329', '--ink-3': '#34343B',
      '--text': '#16161A', '--muted': '#6E6E76', '--faint': '#9A9AA2',
      '--white': '#FFFFFF', '--field': '#F3F0EB', '--field-2': '#EBE7E1',
      '--paper-ghost': 'rgba(250,248,245,.62)',
      '--accent': '#6B5BD2', '--accent-deep': '#4B3DB0', '--accent-bright': '#8E80E8', '--accent-tint': '#E7E3F7',
      '--warn-deep': '#C8920F', '--warn-tint': '#F7E8C6', // M4：黄从土棕 #9A6A2A 提为金黄 #C8920F
      '--danger': '#C0392B', '--danger-deep': '#9B2C2C', '--danger-tint': '#F7E7E7',
      '--ok-deep': '#2E6B3A', '--ok-tint': '#E7EFE7',
      '--chart-traffic': '#6B5BD2', '--chart-latency': '#2E6B3A', // 流量监测图表系列色（亮色主题，经 dataviz 校验）
      '--star': '#B5841F', '--star-empty': '#C9C4BD',
      '--line': 'rgba(17,17,20,.12)', '--border-light': 'rgba(17,17,20,.10)',
      // ---- 背景舞台 ----
      '--g-bg': '#ECEAF0',                       // html 页面底
      // #164：平面简约白色系——flat 包专用底/纸/线（浅色主题纯白底，白纸面靠灰线分界）
      // 2026-08-09 反馈：白色系分层（非纯白）——页面底微灰 #F4F5F7，卡片纯白浮起，嵌套面逐级加深，发丝边略加重
      '--flat-bg': '#F4F5F7', '--flat-paper': '#FFFFFF', '--flat-paper-2': '#EEF0F3', '--flat-paper-3': '#E5E7EB',
      '--flat-line': 'rgba(17,17,20,.12)',
      '--g-plate': 'linear-gradient(105deg, rgba(250,248,245,.20), rgba(250,248,245,.10) 50%, rgba(244,242,247,.20)), linear-gradient(105deg, rgba(216,212,221,.12), rgba(250,248,245,.05) 50%, rgba(231,227,247,.12)), rgba(244,242,247,.08)',
      '--g-glow': 'radial-gradient(circle, rgba(255,255,255,.5), rgba(231,227,247,.16) 42%, rgba(255,255,255,0) 70%)', // 鼠标发光圆
      '--g-grid': 'rgba(17,17,20,.07)',          // 网格装饰线
      '--g-autofill': '#FFFFFF',                 // 浏览器自动填充抹蓝底用底色（dark 换暗玻璃色，v0.20.0）
      // ---- 玻璃白档（组件填充：faint→strong 递进） ----
      '--g-fill-faint': 'rgba(255,255,255,.07)',   // 微透：极弱面/内层玻璃/分隔行 hover
      '--g-fill-weak': 'rgba(255,255,255,.10)',    // 透：输入控件/分段容器/未选小件
      '--g-fill-mid': 'rgba(255,255,255,.14)',     // 中：入口块/工具栏/普通玻璃件
      '--g-fill-strong': 'rgba(255,255,255,.20)',  // 强：标签/选中态/侧栏选中块
      '--g-seg-fill': 'rgba(255,255,255,.55)',     // 分段选中药丸（U4 v0.25.105：liquid 原 .20 与容器 .07 白差太小、选中/未选中都白不分明，提实白）
      // ---- 轻量描边按钮（R11 统一卡片动作外观：白调面 + 发丝边，白卡/灰底都可见） ----
      '--g-btn-bg': 'rgba(255,255,255,.72)',       // 按钮面：较白调（灰底上浮起成片）
      '--g-btn-line': 'rgba(17,17,20,.14)',        // 统一细边框（比 --line 略深一档，白卡上可辨）
      '--g-card-fill': 'radial-gradient(ellipse 120% 55% at 50% 4%, rgba(255,255,255,.90) 0%, rgba(255,255,255,.45) 18%, rgba(255,255,255,.14) 36%, rgba(255,255,255,.06) 60%, rgba(255,255,255,.04) 100%)', // 卡族弯月径向
      '--g-card-strong': 'rgba(255,255,255,.32)',  // 信息卡强面（坐侧栏 L2）
      '--g-card-id': 'rgba(255,255,255,.64)',      // 信息卡身份卡
      '--g-card-strong-m': 'rgba(255,255,255,.62)',// 移动端信息卡
      '--g-card-id-m': 'rgba(255,255,255,.75)',    // 移动端身份卡
      '--g-sideuser-fill': 'rgba(219,216,233,0.94)',// 侧栏用户块（62% 半透明灰紫叠浅侧栏 rgba(250,248,245,.56) 合成 rgb(244,243,246) vs 侧栏 rgb(242,240,241)，RGB 总差仅 10 肉眼无区分——用户二连反馈「还是过于一致」）。v0.27.5 返工：偏冷灰紫 + 高不透明度 0.94，合成后 rgb(220,217,234) vs 侧栏总差约 52 清晰可辨；dark(128)/flat(纸面+描边) 不涉及
      '--g-pane-fill': 'rgba(255,255,255,.12)',    // 会话列表 pane/暂存区
      '--g-header-fill': 'rgba(255,255,255,.08)',  // 浮窗头栏（玻璃上的玻璃）
      '--g-hover-wash': 'rgba(255,255,255,.18)',   // hover 白洗叠层
      '--g-avatar-fill': 'linear-gradient(160deg, rgba(255,255,255,.5), rgba(231,227,247,.32))', // 头像玻璃面
      '--g-avatar-border': 'rgba(255,255,255,.7)',
      '--g-avatar-fill-ghost': 'rgba(255,255,255,.12)', // 访客头像
      '--g-avatar-border-ghost': 'rgba(110,110,118,.5)',
      '--g-flow-dot': 'rgba(255,255,255,.85)',     // 关于页流程编号圆点
      // ---- 液体边缘（弯月：上缘亮带 + 发丝白边 + 柔光下泄 + 折射细影 + 内发光） ----
      '--g-liquid': 'inset 0 0 8px rgba(255,255,255,.10), inset 0 4px 8px -4px rgba(30,26,64,.08), inset 0 3px 3px -1px rgba(255,255,255,.85), inset 0 5px 16px -6px rgba(255,255,255,.18), inset 0 0 0 1px rgba(255,255,255,.40)',
      '--g-liquid-sm': 'inset 0 0 5px rgba(255,255,255,.10), inset 0 4px 6px -4px rgba(30,26,64,.08), inset 0 2px 2px -1px rgba(255,255,255,.75), inset 0 3px 10px -4px rgba(255,255,255,.15), inset 0 0 0 1px rgba(255,255,255,.34)',
      // ---- 浮影 ----
      '--glass-lift': '0 12px 30px -12px rgba(30,26,64,.22)',
      '--glass-lift-sm': '0 6px 16px -8px rgba(30,26,64,.18)',
      '--g-pane-shadow': '8px 0 30px rgba(30,26,64,.1)',  // 侧栏右侧投影
      '--g-panel-lift': 'rgba(17,17,20,.13)',      // 右栏面板外浮影（桌面）
      '--g-panel-lift-m': 'rgba(17,17,20,.22)',    // 右栏面板外浮影（移动端）
      '--g-modal-dim': 'rgba(17,17,20,.42)',       // v0.25.39（反馈 U4）：表单浮窗灰化背景（弹窗矩形切透明，走 .modal 大扩散阴影）
      // ---- 线条 ----
      '--g-line-soft': 'rgba(255,255,255,.22)',    // 浮窗头栏底/面板分隔
      '--g-line-pane': 'rgba(255,255,255,.5)',     // 侧栏/顶栏边缘高光
      '--g-line-dark': 'rgba(30,26,64,.16)',       // 表单组分隔（暗色线）
      '--g-option-line': 'rgba(30,26,64,.07)',     // 下拉选项分隔
      '--g-seg-line': 'rgba(255,255,255,.3)',      // 分段控件内部分隔
      '--g-foot-text': 'rgba(17,17,20,.72)',       // 侧栏脚注弱字
      // ---- 焦点 / 涟漪 ----
      '--g-ring': 'rgba(122,104,224,.55)',         // 焦点外环
      '--g-focus-soft': 'rgba(122,104,224,.35)',   // 焦点内环（输入/会话项）
      '--g-ring-halo': 'rgba(255,255,255,.95)',    // 焦点白色外晕
      '--g-ripple': 'rgba(255,255,255,.6)',        // 按钮涟漪
      // ---- 输入控件 ----
      // 需求六·item4：--g-inset-* 输入淡化 token 连根删（表单控件改用标准 --g-liquid-sm 边缘）
      // ---- 语义填充（标签/警示/实心件） ----
      '--g-ok-fill': 'rgba(24,122,75,.22)', '--g-ok-fg': '#187a4b',
      '--g-ok-solid': 'linear-gradient(160deg, rgba(24,122,75,.9), rgba(24,122,75,.72))', // 已签约实心 tag
      '--g-danger-fill': 'rgba(198,72,58,.20)',
      '--g-danger-fill-soft': 'rgba(198,72,58,.14)', // 警示条/bug 卡
      '--g-warn-fill': 'rgba(200,146,15,.22)', // M4：金黄填充（原 rgba(154,106,42,.20) 土棕）
      '--g-accent-fill': 'rgba(122,104,224,.20)',
      '--g-accent-fill-soft': 'rgba(142,128,232,.08)', // 聊天拖入虚线罩
      '--g-like-fill': 'rgba(211,47,47,.16)',      // 帖子点赞态
      '--g-fav-fill': 'rgba(122,104,224,.16)',     // 帖子收藏态（R23：主题色淡底）
      // ---- 内生滚动条 ----
      '--g-scroll-size': '8px',                    // 滚动条 hit 区宽（液态）
      '--g-scroll-thumb': 'rgba(122,104,224,.38)', // 静置滑块：半透明紫玻璃
      '--g-scroll-thumb-strong': 'rgba(122,104,224,.58)', // hover 增亮（webkit 伪元素无 transition，跳色）
      '--g-scroll-thumb-active': 'rgba(122,104,224,.72)', // 按压
      // ---- 气泡 ----
      // 气泡近实化（调研：主流「发送彩色/接收中性」通例 + WCAG 对比度）：发送方=品牌紫提亮面、
      // 接收方=中性近实白（发丝描边在 style-chat.css 补，白泡在浅底上立得住）、系统=中性低对比胶囊（去第三色相）
      '--g-bubble-mine': '#E9E5FB',
      '--g-bubble-theirs': '#FFFFFF',
      '--g-bubble-system': 'rgba(17,17,20,.10)', // 需求四十八：合同草案通知改明显灰色气泡（原 .055 在浅纸上几乎不可见）
      // ---- 大块 pane ----
      '--g-sidebar-bg': 'rgba(250,248,245,.56)',
      '--g-sidebar-bg-m': 'rgba(244,242,247,.97)', // 移动端侧栏近不透明
      '--g-navbar-bg': 'rgba(250,248,245,.52)',
      '--g-paper': 'rgba(255,255,255,.22)',        // 浮层纸面
      '--g-paper-bright': 'rgba(255,255,255,.82)', // 压暗灰底上的玻璃提亮（新手引导气泡/跳过按钮：透灰需额外提亮，规则见 CLAUDE.md）
      '--g-sidebar-backdrop': 'rgba(20,18,40,.25)', // 移动端侧栏遮罩
      // ---- 下拉选项 / 匹配条 ----
      '--g-option-hover': 'rgba(17,17,20,.05)',   // v0.25.94：下拉 hover/聚焦/选中改中性浅墨（弃品牌紫）
      '--g-option-sel': 'rgba(17,17,20,.09)',
      '--g-option-ring': 'rgba(17,17,20,.16)',    // 下拉触发器聚焦环（中性墨色，主题自适应）
      '--g-bar-soft': 'rgba(255,255,255,.35)',     // 匹配条底轨
      '--g-bar-strong': 'rgba(142,128,232,.45)',   // 匹配条空值段
      '--g-slider-thumb': 'linear-gradient(145deg,#8E80E8,#6B5BD2)', // UI 大小滑块拖动球
      // ---- 光球（淡雅化 RGB 三元组；暗色沿用） ----
      '--lg-orb-a': '176,156,240', '--lg-orb-b': '240,200,150', '--lg-orb-c': '172,202,235',
      '--lg-orb-d': '202,148,240', '--lg-orb-e': '152,212,190', '--lg-orb-f': '240,176,222',
      '--lg-orb-g': '244,208,150', '--lg-orb-h': '164,174,240', '--lg-orb-i': '234,186,132',
    },
    // 暗色：深蓝紫灰底（避纯黑）+ 低白玻璃 + 提亮语义色 + 深影（调研配方：暗玻璃用低 alpha 白 + 白边缘光）
    dark: {
      // ---- 语义色（深底浅字，4.5:1 对比达标） ----
      '--paper': '#0E0C14', '--paper-2': '#14121C', '--paper-3': '#1A1825',
      '--lilac': '#17151F', '--lilac-2': '#1D1A28',
      '--ink': '#ECEAF4', '--ink-2': '#CFCDD9', '--ink-3': '#A9A6B6',
      '--text': '#ECEAF4', '--muted': '#8F8C9D', '--faint': '#6B6878',
      '--white': '#FFFFFF', '--field': '#15131D', '--field-2': '#1D1A27',
      '--paper-ghost': 'rgba(14,12,20,.62)',
      '--accent': '#8E80E8', '--accent-deep': '#A99BF5', '--accent-bright': '#A99BF5', '--accent-tint': 'rgba(142,128,232,.18)',
      '--warn-deep': '#E0B03A', '--warn-tint': 'rgba(224,176,58,.18)', // M4：暗色黄提亮（原 #D4A64F）
      '--danger': '#E05A4A', '--danger-deep': '#FF7A6A', '--danger-tint': 'rgba(224,90,74,.16)',
      '--ok-deep': '#55B26B', '--ok-tint': 'rgba(85,178,107,.16)',
      '--chart-traffic': '#8E80E8', '--chart-latency': '#46A05E', // 流量监测图表系列色（暗色主题，经 dataviz 校验）
      '--star': '#E2B84C', '--star-empty': '#4A4856',
      '--line': 'rgba(255,255,255,.10)', '--border-light': 'rgba(255,255,255,.08)',
      // ---- 背景舞台 ----
      '--g-bg': '#0E0C14',
      // #164：平面简约白色系——flat 专用 token（深色主题保持暗色系）
      '--flat-bg': '#0B0A11', '--flat-paper': '#0E0C14', '--flat-paper-2': '#171520', '--flat-paper-3': '#1F1C2B',
      '--flat-line': 'rgba(255,255,255,.12)',
      '--g-plate': 'linear-gradient(105deg, rgba(28,24,44,.50), rgba(16,14,26,.40) 50%, rgba(30,26,48,.50)), linear-gradient(105deg, rgba(40,34,62,.35), rgba(12,10,20,.25) 50%, rgba(48,40,72,.35)), rgba(20,18,30,.55)',
      '--g-glow': 'radial-gradient(circle, rgba(142,128,232,.45), rgba(99,86,196,.16) 42%, rgba(255,255,255,0) 70%)',
      '--g-grid': 'rgba(255,255,255,.06)',
      '--g-autofill': '#211F2B',
      // ---- 玻璃白档（低白玻璃：透出深底 + 白边缘光） ----
      '--g-fill-faint': 'rgba(255,255,255,.05)',
      '--g-fill-weak': 'rgba(255,255,255,.07)',
      '--g-fill-mid': 'rgba(255,255,255,.10)',
      '--g-fill-strong': 'rgba(255,255,255,.14)',
      '--g-seg-fill': 'rgba(255,255,255,.30)', // U4：dark 下分段选中更实白（原 .14 与容器 .05 太接近）
      // ---- 轻量描边按钮（R11）：低白玻璃面 + 浅发丝边 ----
      '--g-btn-bg': 'rgba(255,255,255,.09)',
      '--g-btn-line': 'rgba(255,255,255,.18)',
      '--g-card-fill': 'radial-gradient(ellipse 120% 55% at 50% 4%, rgba(255,255,255,.32) 0%, rgba(255,255,255,.14) 18%, rgba(255,255,255,.07) 36%, rgba(255,255,255,.04) 60%, rgba(255,255,255,.03) 100%)',
      '--g-card-strong': 'rgba(255,255,255,.22)',
      '--g-card-id': 'rgba(255,255,255,.30)',
      '--g-card-strong-m': 'rgba(255,255,255,.30)',
      '--g-card-id-m': 'rgba(255,255,255,.40)',
      '--g-sideuser-fill': 'rgba(255,255,255,.18)',
      '--g-pane-fill': 'rgba(255,255,255,.08)',
      '--g-header-fill': 'rgba(255,255,255,.06)',
      '--g-hover-wash': 'rgba(255,255,255,.10)',
      '--g-avatar-fill': 'linear-gradient(160deg, rgba(255,255,255,.28), rgba(231,227,247,.16))',
      '--g-avatar-border': 'rgba(255,255,255,.35)',
      '--g-avatar-fill-ghost': 'rgba(255,255,255,.08)',
      '--g-avatar-border-ghost': 'rgba(255,255,255,.22)',
      '--g-flow-dot': 'rgba(255,255,255,.85)', // 关于页流程编号圆点（暗色首载缺键曾致圆点失显，补显式定义）
      // ---- 液体边缘（亮带降档，发丝边保留——暗玻璃的灵魂） ----
      '--g-liquid': 'inset 0 0 8px rgba(255,255,255,.05), inset 0 4px 8px -4px rgba(0,0,0,.25), inset 0 3px 3px -1px rgba(255,255,255,.45), inset 0 5px 16px -6px rgba(255,255,255,.10), inset 0 0 0 1px rgba(255,255,255,.22)',
      '--g-liquid-sm': 'inset 0 0 5px rgba(255,255,255,.05), inset 0 4px 6px -4px rgba(0,0,0,.25), inset 0 2px 2px -1px rgba(255,255,255,.38), inset 0 3px 10px -4px rgba(255,255,255,.08), inset 0 0 0 1px rgba(255,255,255,.18)',
      // ---- 浮影（深影） ----
      '--glass-lift': '0 12px 30px -12px rgba(0,0,0,.55)',
      '--glass-lift-sm': '0 6px 16px -8px rgba(0,0,0,.5)',
      '--g-pane-shadow': '8px 0 30px rgba(0,0,0,.4)',
      '--g-panel-lift': 'rgba(0,0,0,.45)',
      '--g-panel-lift-m': 'rgba(0,0,0,.5)',
      '--g-modal-dim': 'rgba(0,0,0,.55)',          // 暗色页上压暗加深（浅色值在暗底上不可感）
      // ---- 线条（反转为浅线） ----
      '--g-line-soft': 'rgba(255,255,255,.12)',
      '--g-line-pane': 'rgba(255,255,255,.12)',
      '--g-line-dark': 'rgba(255,255,255,.10)',
      '--g-option-line': 'rgba(255,255,255,.08)',
      '--g-seg-line': 'rgba(255,255,255,.14)',
      '--g-foot-text': 'rgba(255,255,255,.72)',
      // ---- 焦点 / 涟漪 ----
      '--g-ring': 'rgba(139,124,232,.8)',
      '--g-focus-soft': 'rgba(139,124,232,.45)',
      '--g-ring-halo': 'rgba(255,255,255,.3)',
      '--g-ripple': 'rgba(255,255,255,.35)',
      // ---- 输入控件 ----
      // 需求六·item4：--g-inset-* 输入淡化 token 连根删（表单控件改用标准 --g-liquid-sm 边缘）
      // ---- 语义填充（提亮一档，深底上保持可读） ----
      '--g-ok-fill': 'rgba(66,160,102,.28)', '--g-ok-fg': '#58C48A',
      '--g-ok-solid': 'linear-gradient(160deg, rgba(56,152,94,.95), rgba(56,152,94,.75))',
      '--g-danger-fill': 'rgba(224,90,74,.24)',
      '--g-danger-fill-soft': 'rgba(224,90,74,.16)',
      '--g-warn-fill': 'rgba(224,176,58,.24)', // M4：暗色金黄填充（原 rgba(212,166,79,.22)）
      '--g-accent-fill': 'rgba(139,124,232,.26)',
      '--g-accent-fill-soft': 'rgba(139,124,232,.12)',
      '--g-like-fill': 'rgba(224,90,74,.20)',
      '--g-fav-fill': 'rgba(139,124,232,.20)',     // 帖子收藏态（R23：主题色淡底）
      // ---- 内生滚动条----
      '--g-scroll-size': '8px',
      '--g-scroll-thumb': 'rgba(255,255,255,.26)', // 暗面低白玻璃滑块
      '--g-scroll-thumb-strong': 'rgba(255,255,255,.4)',
      '--g-scroll-thumb-active': 'rgba(255,255,255,.52)',
      // ---- 气泡 ----
      // 深色同口径：发送方=品牌紫降饱和近实（WhatsApp #005C4B 同思路）、接收方=中性深灰（Telegram #262626）、系统=中性低对比
      '--g-bubble-mine': '#3A3468',
      '--g-bubble-theirs': '#262431',
      '--g-bubble-system': 'rgba(255,255,255,.14)', // 需求四十八：暗色同步提可见度
      // ---- 大块 pane ----
      '--g-sidebar-bg': 'rgba(18,16,26,.72)',
      '--g-sidebar-bg-m': 'rgba(26,23,37,.97)',
      '--g-navbar-bg': 'rgba(18,16,26,.68)',
      '--g-paper': 'rgba(24,22,34,.62)',
      '--g-paper-bright': 'rgba(40,37,54,.9)',
      '--g-sidebar-backdrop': 'rgba(0,0,0,.5)',
      // ---- 下拉选项 / 匹配条 ----
      '--g-option-hover': 'rgba(255,255,255,.10)', // v0.25.94：下拉 hover/聚焦/选中改中性（深色下白染，弃品牌紫）
      '--g-option-sel': 'rgba(255,255,255,.16)',
      '--g-option-ring': 'rgba(255,255,255,.30)',  // 下拉触发器聚焦环（深色下白环）
      '--g-bar-soft': 'rgba(255,255,255,.26)',
      '--g-bar-strong': 'rgba(139,124,232,.55)',
      '--g-slider-thumb': 'linear-gradient(145deg,#A99BF5,#8E80E8)', // 暗色提亮一档（--g-slider-thumb 同键）
      // --lg-orb-* 暗色沿用亮色（淡雅化三元组在深底上即柔光）
    },
  },

  // ============================================================
  // UI 文字
  // ============================================================
  UI: {
    // 导航
    NAV_LOGIN: '登录',
    NAV_REGISTER: '注册',
    ROLE_STUDENT: '学生',
    ROLE_TEACHER: '教师',
    ADMIN_BADGE: '管理员',

    // 按钮
    BTN_LOGIN: '登录',
    BTN_REGISTER: '注册',
    BTN_SAVE: '保存',
    BTN_SUBMIT_DEMAND: '提交需求',
    BTN_EDIT: '编辑',
    BTN_SAVE_DEMAND: '保存修改',
    BTN_DELETE_DEMAND: '删除需求',
    BTN_DELETE_REVIEW: '删除评价',
    BTN_REMOVE: '移除',
    BTN_CONFIRM: '确定',
    BAN: '封禁',
    UNBAN: '解封',
    VERIFY_TEACHER: '认证',       // 学籍认证审核（管理端教师行按钮）
    UNVERIFY: '撤认证',
    VERIFY_DONE: '已通过学籍认证',
    UNVERIFY_DONE: '已撤销学籍认证',
    BTN_GENERATE_INVITE: '生成邀请码',
    BTN_CANCEL: '取消',
    // ：试课意向由「二次确认」改为「打招呼消息」（Airbnb 租客对房东式——自我介绍+为什么想接这单，提示语友善）
    INTENT_GREET_TITLE: '提交试课意向',
    INTENT_GREET_DEMAND: '你将向这条需求提交试课意向：{demand}',
    INTENT_GREET_LABEL: '和对方打个招呼（可选）',
    INTENT_GREET_PLACEHOLDER: '简单介绍一下自己，说说为什么想接下这单～（例：老师您好，我教初中数学五年，带过三届中考班，对您孩子的分数情况很有把握）',
    INTENT_GREET_OPTIONAL: '可留空直接提交；填写后学生会在「试课意向」里看到这段话。',
    // 审计：BTN_SUBMIT_INTENT 曾在此重复定义（'提交意向'）与下方 :1036（'提交试课意向'）——
    // 对象字面量后键覆盖先键，运行恒取后者（wrangler 部署 duplicate-object-key 警告）。删此旧键，单源
    // 收敛到 :1036 的新文案（两个引用点 app-demands.js:829/1146 均读 UI.BTN_SUBMIT_INTENT，不受影响）。
    // 打招呼消息在卡片上的引用块头标（谁说的：学生留言 / 教师留言）
    GREET_HEAD_STUDENT: '学生留言',
    GREET_HEAD_TEACHER: '教师留言',
    BTN_LOAD_MORE: '加载更多',      // 管理员需求分页（网安报告 F-09：keyset 游标翻页）

    // 加载状态
    LOADING_LOGIN: '登录中...',
    LOADING_REGISTER: '注册中...',

    // 验证提示
    VALIDATE_PASSWORD_MISMATCH: '两次密码不一致',
    // 需求三十：注册须勾选同意用户协议/隐私政策（两行轻量勾选 + md 浮窗展示全文）
    AGREE_LINK_AGREEMENT: '用户协议',
    AGREE_LINK_PRIVACY: '隐私政策',
    REGISTER_CONTACT_REQUIRED: '请填写手机号或邮箱并输入验证码',
    AGREE_REQUIRED: '请先勾选同意用户协议与隐私政策',
    POLICY_KEY_AGREEMENT: 'user_agreement',
    POLICY_KEY_PRIVACY: 'privacy_policy',
    // v0.25.51（需求三十修正）：政策全文硬编码进 constants——单源原则「用户可见文案只在 constants.js」。
    // 曾用独立 .md 静态文件 + fetch：_worker.js 静态回退拦截一切 .md（防 docs/ 源码泄露）导致生产 404
    // 「协议内容加载失败」；改常量直渲：无网络依赖、离线可用，mdRender 渲染同一套 md 语法。
    POLICY_AGREEMENT: `# 经世知途家教信息平台用户协议

**版本更新日期：** 2026年8月8日

**生效日期：** 2026年8月8日

## 一、总则

### 1.1 协议效力与缔约主体

本协议由经世知途家教信息平台运营主体（以下简称“平台方/我们”）与完成注册、登录、使用平台服务的用户（家长、学员、大学生教员，以下简称“用户/您”）自愿缔结，具备合法民事合同法律效力，对双方均具有约束力。

**平台公示信息（上线必填）：**

**平台名称：** 经世知途家教信息平台

**运营主体：** ___________（公司/个体工商户全称）

**统一社会信用代码：** ___________

**住所地：** ___________

**官方联系邮箱：** ___________

**客服投诉入口：** ___________

### 1.2 平台定位

本平台为大学生创业运营的纯信息撮合服务平台，不提供教学授课服务，仅为家长/学员、大学生教员提供家教需求发布、师资展示、信息检索、双向对接的中立信息服务。

### 1.3 核心权责界定（重点）

平台仅为信息展示与对接渠道，不开展资金托管、代收代付、在线结算、担保交易业务。平台不属于家长与教员之间家教服务合同的缔约方，不参与、不组织、不监督、不担保任何线上/线下授课行为与服务履约。

### 1.4 风险告知与同意规则

您确认已主动、完整阅读、理解本协议全部条款，尤其是加粗标注的责任限制、风险提示、免责条款。您完成注册、登录、使用平台服务，即代表自愿接受本协议全部约束；若您不认可本协议任意条款，无权使用本平台任何服务。

### 1.5 格式条款解释规则

本协议为格式合同。若条款存在两种以上合理解释的，依法作出不利于条款提供方（即平台方）的解释；但条款含义清晰明确的，应按通常含义理解。

## 二、平台服务内容与服务边界

### 2.1 仅限信息中介服务

平台提供的全部服务仅限于：

**教员端：** 个人资质、教学经历、授课科目、空闲时段信息发布与展示；

**家长端：** 家教年级、科目、授课地址、期望薪资、授课频率等需求发布；

**双向沟通：** 展示信息、开放沟通渠道，由用户双方自主对接、自主缔约、自主履约。

### 2.2 身份核验规则与风险告知

**1.** 平台对教员在校生身份、学籍证明、校园证件等材料进行形式合规审查，核验通过后展示认证标识，仅证明材料外观合规。

**2.** 平台无公安核查权限、无资质开展背景调查，无法核验教员品行、心理健康、犯罪记录、真实授课水平、过往业绩真实性，亦无法担保家长发布信息的真实性。

**3.** 安全强制提示：涉及未成年人授课场景，家长应当自行核验教员背景（含无犯罪记录证明等），自行承担线下核验义务。

**4.** 用户对交易对象、服务风险承担自主核实义务；因用户自行核实疏忽产生的风险由用户自行承担；平台因故意或重大过失（明知虚假仍认证、收到举报拒不处置）造成用户损失的，依法承担对应过错责任。

### 2.3 无资金交易与无担保规则

平台全程不介入任何资金往来，不收取课时费、不托管资金、不代收代付、不担保履约。课时费标准、支付方式、退款规则、押金约定均由家长与教员自主协商、自行承担。双方资金纠纷、履约纠纷由双方自行解决，平台仅可在合法范围内协助提供备案信息用于维权取证。

## 三、用户注册、账号管理与资质规则

### 3.1 注册资格

**教员用户：** 仅限国内正规高校在读本专科生、研究生、毕业两年内应届生，注册必须提交真实姓名、院校、专业、有效学籍材料与联系方式。

**家长/学员用户：** 需提交真实有效联系方式、真实家教需求信息，禁止虚假占位、恶意发布无效需求。

### 3.2 教员资质到期处置

教员毕业满两年自动丧失教员入驻资质，平台将提前站内信提醒；到期后自动关闭接单、发布师资权限，保留基础浏览权限，用户可自主注销账号。对于协议终止时正在进行的授课订单，用户可与家长协商完成已约定课程或妥善交接，平台给予不少于30日的合理过渡期。

### 3.3 信息真实性义务

所有用户承诺发布信息真实、准确、完整，不得虚构资质、虚构需求、隐瞒关键信息。因虚假信息造成第三方或平台损失的，由发布用户承担全部法律责任。

### 3.4 账号安全责任

**1.** 用户对自有账号全部操作承担全部责任，负有妥善保管密码、设备、验证码的义务，因个人疏忽泄露、转借账号导致的风险自行承担。

**2.** 非因平台安全漏洞导致的黑客攻击、账号异常，平台仅提供协助排查，若平台能够证明已履行法定网络安全保护义务且不存在过错的，依法不承担赔偿责任。

### 3.5 账号唯一性

一人一号，禁止冒用他人身份、批量恶意注册、养号营销，违规账号可予以限制或封禁。

## 四、用户行为规范与禁止行为

### 4.1 禁止虚假与恶意信息

禁止发布虚假师资、虚假需求、虚假薪资，禁止利用平台信息开展营销、骚扰、诈骗、引流、私域推销等无关行为。

### 4.2 线下交易风险郑重提示

所有线下见面、授课履约、资金往来均为用户个人自主民事行为，平台不参与、不控制、不担保。用户自主选择线下交易产生的人身、财产、隐私、履约纠纷，由双方自行承担；平台仅在存在故意/重大过失时承担对应过错责任。

### 4.3 禁止违法违规内容发布

用户不得发布违反《网络安全法》《广告法》《个人信息保护法》等法律法规的内容，禁止发布政治敏感、色情、暴力、赌博、辱骂诽谤、侵权、违法引流等信息，违者平台可立即处置账号并报备监管部门。

### 4.4 隐私保护义务

用户获取的对方联系方式、个人信息，仅限本次家教对接使用，禁止倒卖、公开、批量传播、商用，违者承担侵权及法律责任。

## 五、双方权利与义务（权责平衡）

### 5.1 教员权利义务

教员享有自主接单、自主排课、拒绝不合理需求的权利；负有如实介绍资质、按时沟通、恪守师德、文明授课、不歧视侮辱学员、无故停课提前告知的义务。

### 5.2 家长/学员权利义务

家长享有查看认证信息、合理反馈教学问题的权利；负有如实发布需求、尊重教员、禁止骚扰与不合理附加要求的义务。未成年人授课期间，监护人负有全程安全监护义务，首次授课建议选择公共场所或陪同到场。

### 5.3 平台权利与合规义务

**1.** 平台有权对虚假信息、违规用户进行警告、功能限制、账号封禁、违规公示（全程脱敏，不泄露任何个人敏感信息）。

**2.** 用户申诉权利（新规必填）：用户若对平台处罚结果有异议，可在收到通知7日内通过官方邮箱/客服入口提交申诉，平台将在3个工作日内核查并答复。

**3.** 平台负有信息巡查、风险提示、违法信息处置、配合监管调查、协助用户合法维权的基础合规义务。

## 六、免责条款（合规无绝对免责版）

### 6.1 不可抗力免责

因自然灾害、政策调整、政府监管、网络大面积故障、运营商中断等不可抗力导致服务暂停、数据延迟的，平台无责，不承担违约责任。

### 6.2 线下人身财产风险免责（合规兜底）

线下授课、见面沟通属于用户自主民事行为，平台已充分履行安全提示、风险告知、资质形式核验义务的，对用户之间的人身伤害、财产损失、侵权纠纷不承担赔偿责任；仅在平台存在故意或重大过失情形下依法承担过错责任。

### 6.3 用户自主发布信息免责

用户自行发布的信息错误、虚假、过期、遗漏，由发布方自行负责；平台发现或收到反馈后可及时更正、下架，不承担赔偿责任。

### 6.4 第三方链接免责

平台第三方外链仅为便利展示，不担保其安全性与真实性，用户跳转访问风险自行承担。

### 6.5 用户纠纷处理规则

用户双方履约、薪资、教学质量纠纷由双方自行协商、诉讼解决。平台调解为协商性质，不替代司法途径。若双方达成一致，建议以书面形式确认。平台因调解行为本身存在过错导致用户新损失的除外。

## 七、知识产权

### 7.1 平台LOGO、UI、代码、页面编排、文案体系知识产权均归平台所有，受著作权法保护。

### 7.2 未经书面授权，禁止复刻、镜像、反编译、商用搬运。

### 7.3 用户发布内容授予平台非排他、免费展示使用权，仅用于平台正常服务；账号注销后，内容处理遵从隐私政策。

## 八、隐私保护与数据合规

### 8.1 平台隐私政策为本协议同等效力文件，严格遵循个人信息保护相关法律法规。

### 8.2 用户禁止提前泄露身份证、银行卡、详细住址等敏感信息，自行把控线上沟通隐私边界。

### 8.3 账号注销后，除法律法规要求留存的备案信息（留存不少于三年）外，平台将对用户普通信息、认证材料进行删除或匿名化处理；用户可依法申请个人信息查询、更正、删除。

### 8.4 未成年人专项保护

针对未成年学员，平台严格保护其个人信息，禁止任何用户收集、泄露、滥用未成年人隐私；家长需全程履行监护与安全管理责任。家长为未成年学员注册或发布需求时，视为该家长已获得法定监护人的明示同意，并承诺对其提供的信息的真实性、合法性承担全部责任。

## 九、协议修订、变更与终止

### 9.1 平台可根据法律、监管、运营需要修订协议，修订后以弹窗、站内公示方式告知，用户继续使用即视为同意更新版本。

### 9.2 涉及用户重大权利义务调整的变更，平台提前15日显著公示；用户不接受的，可自主注销账号、终止服务。

### 9.3 协议终止后，平台停止提供服务，但终止前的纠纷处理、责任认定、隐私保护、合规留存条款持续有效。

## 十、法律适用与争议解决

### 10.1 本协议适用中华人民共和国现行有效法律。

### 10.2 争议优先协商解决；协商不成，统一向平台运营主体住所地有管辖权的人民法院提起诉讼。

## 十一、附则

### 11.1 本协议未尽事宜，依照国家法律法规执行。

### 11.2 协议任一条款被认定无效的，不影响其余条款的合法效力。

### 11.3 投诉、咨询、申诉渠道（上线必填）：

**官方邮箱：** ___________

**在线客服/申诉入口：** ___________

**运营主体全称：** ___________`,
    POLICY_PRIVACY: `# 经世知途家教信息平台隐私政策

**更新日期：** 2026年8月8日

**生效日期：** 2026年8月8日

经世知途家教信息平台（以下简称“我们/平台方”）严格依据《中华人民共和国个人信息保护法》《中华人民共和国网络安全法》《中华人民共和国未成年人保护法》《未成年人网络保护条例》等法律法规制定本隐私政策。

本政策旨在清晰告知用户个人信息的收集、使用、存储、共享、保护及用户法定隐私权利。本政策与《经世知途家教信息平台用户协议》具有同等法律效力，二者条款保持完全一致，互为补充。

您注册、登录、继续使用平台服务，即代表您已自愿、明确、知情同意本隐私政策全部内容。

## 一、适用范围与运营主体公示

**1.** 本政策适用于平台全部用户：教员用户、家长/学员用户、网站访客。

**2.** 本平台为纯信息撮合类大学生创业平台，无资金托管、无支付结算、无线下教学履约行为，仅提供家教信息发布、展示、检索、用户对接服务。

**3.** 本政策仅约束平台系统数据处理行为，不适用用户线下自行沟通、私下交易产生的信息流转。

**官方公示信息：**

**平台名称：** ___________

**运营责任主体：** ___________

**官方邮箱：** ___________

**用户申诉/投诉入口：** ___________

## 二、数据处理合法依据（法定必填）

我们处理您的个人信息，严格基于以下合法基础：

**1. 用户明示同意：** 您主动注册、提交信息、使用服务即视为同意；

**2. 履行服务合同必要：** 为完成您要求的家教信息匹配、展示、对接服务；

**3. 合法公共利益：** 防范风险、处置违规、配合司法与监管调查；

**4. 法定义务合规留存：** 依法留存合规备案数据。

## 三、我们收集的信息类型（最小必要原则）

我们严格遵循合法、正当、必要、最小化原则，不收集无关隐私、不强制收集敏感信息、不滥用用户数据。

### （一）用户主动提交信息

**1. 账号注册信息：** 手机号、昵称、加密登录密码（无明文存储）。

**2. 教员敏感认证信息（单独授权）：** 真实姓名、院校、专业、学籍证明、学生证、学信网截图。此类为敏感个人信息，仅用于后台身份核验，绝不对外公开、绝不商用、绝不私自导出。在上传学籍证明材料时，我们将通过独立的弹窗向您取得处理该类敏感个人信息的单独同意，您可以自主选择是否授权，不影响您使用平台的其他基础功能。

**3. 服务公开信息：** 教员授课科目、时段、个人简介；家长发布的年级、科目、区域、期望薪资等需求信息。

**4. 售后沟通信息：** 咨询、申诉、反馈记录。

### （二）系统自动采集信息（Cookie/日志）

为保障网站稳定、安全风控、防刷运维，平台自动采集基础访问数据：设备类型、浏览器、访问时间、页面轨迹、IP属地、会话Cookie。

以上数据仅用于平台安全运维，不做用户画像、不做广告推送、不对外共享。

### （三）未成年人信息专项规则

**1.** 平台不主动收集未成年人敏感信息（身份证、详细住址、班级、出生日期）。

**2.** 涉及十四周岁以下未成年人信息处理，严格遵守《个人信息保护法》第三十一条，仅在监护人明示同意后方可处理。

**3.** 家长发布未成年人家教需求，视为已取得法定监护人完整、明示同意，对信息合法性承担全部责任。

**4.** 严禁任何用户倒卖、泄露、传播未成年人信息，违规账号永久封禁并保留追责权利。

**5. 未成年人个人信息处理专门规则（依据《个人信息保护法》第三十一条制定）：**

**（1）收集前提：** 处理不满十四周岁未成年人个人信息前，必须取得其父母或其他监护人的明示、单独同意，不捆绑默认授权。

**（2）收集范围：** 仅收集完成家教匹配所必需的基础信息（年级、科目需求、授课区域），严格遵循最小必要原则，不收集身份证号、详细住址、学校班级、出生日期等非必要敏感信息。

**（3）使用与存储限制：** 未成年人个人信息仅用于家教信息匹配、对接服务，不作商业推送、用户画像、对外共享；未成年人个人信息在账号注销或监护人主动要求删除时，平台将依法及时删除或匿名化处理，不留冗余隐私数据。

**（4）监护人专属权利：** 监护人有权随时查询、更正、补充、删除其监护的未成年学员个人信息，平台在核验监护人身份后，3个工作日内完成响应处理。

**（5）专项投诉渠道：** 监护人如有未成年人隐私咨询、异议、投诉需求，可通过本政策公示的官方邮箱、平台客服申诉入口提交，平台优先核查处理。

## 四、信息使用范围（无超范围使用）

我们仅将信息用于以下目的，无任何变相滥用：

**1.** 账号注册、登录、身份核验、权限管理；

**2.** 实现师资展示、需求发布、信息匹配、用户对接等核心服务；

**3.** 识别虚假信息、诈骗、骚扰、违规接单，维护平台秩序；

**4.** 处理用户咨询、投诉、申诉；

**5.** 推送必要的站内通知与安全提示；

**6.** 依法配合司法、监管合规调查。

## 五、信息共享与披露规则（严格限制）

我们绝不售卖、出租、商用用户个人信息。

**1. 用户自主公开：** 用户发布的家教需求、师资简介仅对平台注册用户可见，用户自行对公开内容负责。平台首页或列表页仅展示脱敏后的摘要信息（如“张同学，数学，大三”），不展示联系方式及可识别具体个人的详细信息，完整资料仅在用户双方互相匹配或主动查看时向对方开放。

**2. 服务必要共享：** 仅为家教对接，双向开放联系方式，仅限本次对接使用，禁止二次传播、倒卖、商用。

**3. 法定披露：** 司法、监管机关依法出具文书时，依规提供备案信息。

**4. 无第三方商业共享：** 不向广告、营销、自媒体机构流转任何用户隐私数据。

## 六、数据存储与留存期限（与用户协议完全对齐）

**1. 账号存续期：** 正常保留服务必需数据。

**2. 账号注销后：** 除法定合规备案、风控日志留存不少于三年外，所有个人资料、证件、联系方式、发布内容全部删除或匿名化，无法识别个人身份。

**3. 普通访问日志：** 留存6–12个月自动清理。

**4. 未成年人数据：** 注销或监护人申请删除后，立即清理或匿名化。

## 七、用户法定隐私权利（含操作入口）

用户依法享有完整隐私权利，平台提供便捷行使渠道：

**1. 查阅、更正权：** 个人中心可自行查看、修改资料；

**2. 删除、清空权：** 可自主清空发布内容，或联系客服删除非必要数据；

**3. 注销权：** 用户可随时自主注销账号；

**4. 撤回同意权：** 可随时撤回非必要授权，但手机号、登录密码等账号存续所必需的基础信息，在您注销账号前需继续保留，以保障您正常登录使用；

**5. 申诉权：** 对数据处理、账号处罚有异议，可通过客服/邮箱申诉，平台5个工作日内答复（与用户协议统一）。

## 八、信息安全保护措施

**1.** 密码加密存储，无明文留存；

**2.** 教员证件仅后台人工核验，不对外公开、不允许导出传播；

**3.** 内部数据权限分级管控，严防内部泄露；

**4.** 定期漏洞修复、防爬虫、防批量采集；

**5.** 发生数据风险时，第一时间告知用户并启动应急处置。

## 九、用户自主安全义务

**1.** 用户严禁向对方泄露身份证、银行卡、精确住址、密码等敏感信息；

**2.** 平台获取的对方信息仅限家教对接使用；

**3.** 私下交易、私自泄露隐私造成的损失，由用户自行承担。

## 十、第三方链接免责

平台若含第三方链接，仅为用户便利。第三方独立承担隐私合规责任，平台不共享任何用户隐私数据给第三方，用户跳转访问风险自行承担。

## 十一、政策更新规则

**1.** 政策更新后在平台首页公示，重大权益变更弹窗/站内信告知；

**2.** 用户继续使用服务即视为同意新版政策；

**3.** 不认可新版条款可注销账号终止服务。

## 十二、投诉与维权渠道

**官方邮箱：** ___________

**在线申诉入口：** ___________

## 十三、附则

**1.** 本政策未尽事宜依照国家法律法规执行。

**2.** 任一条款无效不影响整体效力。

**3.** 本政策无霸王解释权，条款存在争议时，依法作出有利于用户的解释（与用户协议统一）。`,
    VALIDATE_INVITE_FIRST: '请先验证邀请码',
    VALIDATE_INVITE_REQUIRED: '请输入邀请码',
    VALIDATE_INVITE_LENGTH: '邀请码应为 8 位字符',
    VALIDATE_SELECT_SUBJECT: '请至少选择一个科目',
    VALIDATE_SELECT_RATING: '请选择评分',
    VALIDATE_COMMENT_TOO_SHORT: '评价内容太短',
    CONFIRM_DELETE_DEMAND: '删除后不可恢复，相关教师意向也会一并清除。确定要删除这条需求吗？',
    CONFIRM_DELETE_REVIEW: '删除后不可恢复。确定要删除这条评价吗？',
    CONFIRM_BAN: '封禁后该账户将无法登录。确定要封禁吗？',
    CONFIRM_UNBAN: '确定要解除该账户的封禁吗？',

    // 成功提示
    SUCCESS_INVITE_CONFIRMED: '邀请码已确认，请填写注册信息',
    SUCCESS_DEMAND_SUBMITTED: '需求已提交！',
    SUCCESS_DEMAND_UPDATED: '需求已更新！',
    SUCCESS_DEMAND_DELETED: '需求已删除',
    SUCCESS_BANNED: '已封禁该账户',
    SUCCESS_UNBANNED: '已解封该账户',
    REVIEW_DELETED: '评价已删除',
    STATUS_PENDING: '待审核',
    STATUS_APPROVED: '已通过',
    STATUS_REJECTED: '已拒绝',
    SUCCESS_PROFILE_SAVED: '信息已保存！',
    SUCCESS_REVIEW_SUBMITTED: '评价已提交，等待管理员审核',
    SUCCESS_COPIED: '已复制',
    SUCCESS_APPROVED: '已通过',
    SUCCESS_REJECTED: '已拒绝',

    // 错误提示
    ERROR_LOAD_PREFIX: '加载失败: ',
    ERROR_GENERATE_INVITE: '生成失败: ',
    // 网络连接失败统一文案（api()/XHR/自动登录共用；fetch 抛 TypeError/连接被拒/超时等一律归此，
    // 前端据此弹明确提示，杜绝「Failed to fetch」这类英文裸错误）
    NETWORK_ERROR: '网络连接失败，请检查网络后重试',

    // 空状态
    EMPTY_NO_TEACHERS: '暂无教师信息',
    EMPTY_NO_DEMANDS: '暂无学生需求',
    EMPTY_NO_MY_DEMANDS: '还没有需求，点击右上角「新建需求」发布第一条',
    EMPTY_NO_REVIEWS: '暂无评价',
    EMPTY_NO_USERS: '暂无用户',

    // 浏览教师排序
    TEACHER_SORT_MATCH: '匹配度最高',
    TEACHER_SORT_RATING: '评分最高',
    TEACHER_SORT_PRICE: '报价最低',

    // 邀请码
    INVITE_EXPIRED: '已过期',
    INVITE_EXPIRES_SUFFIX: ' 后过期',

    // 教师卡片 / 列表
    PRICE_UNIT: '元/h',
    BTN_VIEW_DETAIL: '查看详情 / 评价',
    SCORE_SCALE_SUFFIX: '分制',

    // 需求列表
    SUBMITTER_PARENT: '家长',
    SUBMITTER_STUDENT: '学生',
    SUBMITTER_PREFIX: '提交者: ',
    BUDGET_NEGOTIABLE: '面议',
    BUDGET_NO_LIMIT: '不限',
    BUDGET_UNIT_SUFFIX: '元/h',

    // 页面栏目
    PAGE_NOTIFICATIONS: '通知信息',
    PAGE_ACCOUNT_SETTINGS: '设置',

    // 登录页用户名实时角色提示
    HINT_ROLE_STUDENT: '学生账户',
    HINT_ROLE_TEACHER: '教师账户',
    HINT_ROLE_ADMIN: '管理员账户',

    // 试课意向按钮四态
    INTENT_ACCEPTED: '已建立联系',
    INTENT_ACCEPTED_GO: '已建立联系 →', // R26：点击跳对应会话
    INTENT_PENDING: '意向已提交',
    INTENT_REJECTED: '未获选',
    BTN_SUBMIT_INTENT: '提交试课意向',
    INTENT_SUBMITTED_TOAST: '试课意向已提交，等待学生处理',
    PROFILE_INCOMPLETE_TITLE: '档案不完整',
    PROFILE_INCOMPLETE_HINT: '提交试课意向前，请先完善教师档案：省份、年级、性别、擅长科目、报价均为必填。学生要看到完整的教师信息，才能判断是否接受你的意向。',
    BTN_LATER: '稍后再说',
    BTN_GO_COMPLETE_PROFILE: '去完善档案',

    // 学生主动推送需求
    BTN_PUSH_DEMAND: '发送需求',
    PUSH_TEACHER_FALLBACK: '该老师',
    PUSH_MODAL_TITLE_PREFIX: '把需求发给 ',
    PUSH_MODAL_HINT: '选一条需求发送给这位老师，对方会在需求大厅优先看到它。',
    // ：推送需求附带打招呼消息（自我介绍+为什么选这位老师，Airbnb 式友善提示）
    PUSH_GREET_LABEL: '和老师打个招呼（可选）',
    PUSH_GREET_PLACEHOLDER: '简单介绍一下自己，说说为什么想请这位老师～（例：老师您好，孩子初二数学偏弱，看到您带过三届中考班，想请您试试）',
    PUSH_GREET_OPTIONAL: '可留空直接发送；填写后老师会在需求卡上看到这段话。',
    EMPTY_NO_MY_DEMANDS_SHORT: '你还没有需求，先去「我的需求」发布一条吧。',
    PUSH_NO_AVAILABLE_DEMANDS: '暂无可发送的需求（已签约的需求会自动成交下架）。',
    BTN_SEND: '发送',
    VALIDATE_SELECT_DEMAND: '请先选择一条需求',
    PUSH_SENT_FALLBACK: '需求已发送',
    PUSH_NOTE_TEXT: '学生主动向你提交了需求',
    BTN_PUSH_REJECT: '暂时没空',
    BTN_PUSH_ACCEPT: '确认试课意向',
    PUSH_SECTION_TITLE: '学生主动发给你的需求',
    PUSH_ACCEPTED_TOAST: '已确认，可在「我的会话」开始对话',
    PUSH_REJECTED_TOAST: '已谢绝',
    PUSH_ACCEPTED_TAG: '已确认',  // F12②：推送卡乐观处理后占位 tag
    PUSH_REJECTED_TAG: '已谢绝',
    // 系统通知模板（拒绝等节点发给对方的通知；{subjects} 由服务端替换为科目名）
    NOTIFY_PUSH_REJECT: '关于「{subjects}」的家教需求，对方老师暂时无法承接。非常感谢你的信任，平台会继续为你留意更合适的老师。',
    NOTIFY_INTENT_REJECT: '关于「{subjects}」的家教需求，学生已选择了当前阶段更匹配的老师。感谢你付出的热情，期待下一次的双向奔赴。',
    NOTIFY_SUBJECTS_FALLBACK: '相关科目',
    // 以下通知/提示文案同样统一收口于此（服务端经 globalThis.APP_CONSTANTS.UI 读取）
    FEEDBACK_RESOLVED: '你提交的反馈已被关注并处理。感谢你帮助我们做得更好，如有其他问题欢迎随时反馈！',
    CONTRACT_DRAFT_SENT: '「{name}」发来一份合同草案，请前往「我的合同」查看并确认',
    CONTRACT_DRAFT_SENT_TOAST: '合同草案已发送，等待对方确认',
    CONTRACT_SIGN_WAITING: '「{name}」已确认签约，请在「我的合同」内完成你的确认',
    CONTRACT_MODIFIED: '「{name}」修改了合同内容，双方签约确认已重置，请重新查看',
    CONTRACT_SIGNED: '双方已完成签约，合作愉快！',
    CONTRACT_CANCELLED: '「{name}」已取消签约，可于会话中继续商议细节',

    // 管理员：系统通知广播（编辑器复用发帖组件：标题+正文）
    BTN_SEND_NOTIFICATION: '发通知',
    NOTIFY_BROADCAST_PREFIX: '【系统通知】',
    BROADCAST_MODAL_TITLE: '发送系统通知',
    BROADCAST_TITLE_PLACEHOLDER: '通知标题（推送时自动加【系统通知】前缀）',
    BROADCAST_BODY_PLACEHOLDER: '输入通知正文，全部用户都会收到（支持轻量 Markdown）',
    VALIDATE_BROADCAST_EMPTY: '通知内容不能为空',
    BROADCAST_CONFIRM_TEXT: '广播将通知全站所有用户，请输入密码确认发送。',
    BROADCAST_SENT_TOAST: '通知已发送给全部用户',

    // 教师端浏览同行
    PAGE_BROWSE_TEACHERS_PEER_DESC: '查看同行的信息与评价',

    // 合同事件气泡（灰字行死特性已删，气泡文案保留）
    CHAT_BTN_DRAFT_CONTRACT: '起草合同',
    CHAT_PLUS_ARIA: '附件与合同',
    CHAT_PREVIEW_CONTRACT: '[合同草案]',
    CHAT_PREVIEW_SIGNING_REQ: '[签约请求]',   // 审计：签约消息曾落入「非 text → [文件]」误导分支
    CHAT_PREVIEW_SIGNING_RESP: '[签约回应]',
    CHAT_CONTRACT_BUBBLE_MINE: '你向对方发送了一份合同草案，可前往「我的合同」查看进度',
    CHAT_CONTRACT_BUBBLE_OTHER: '对方向你发送了一份合同草案，请前往「我的合同」查看并确认',

    // 我的合同
    PAGE_MY_CONTRACTS: '我的合同',
    PAGE_MY_CONTRACTS_DESC: '合同草案确认与正式签约',
    DRAFT_MODAL_TITLE: '起草合同',
    // 发起签约（极简签约流：加号栏「发起签约」→ 会话内签约请求气泡 → 对方确认/拒绝）
    SIGNING_REQUEST_SENT: '「{name}」向你发送了签约请求', // #152：通知带发送者用户名（原「对方」无身份标识）
    SIGNING_REQUEST_SENT_TOAST: '签约请求已发送',
    SIGNING_CONFIRMED: '对方已确认签约请求', // ：回退 v0.25.95 的 username 注入——会话/通知统一「对方」（用户质询：会话里不该显示具体用户 id）
    SIGNING_REJECTED: '对方已拒绝此次签约请求',
    SIGNING_MY_CONFIRMED: '你已确认签约请求',      // 审计：回应方视角（原气泡/toast 恒显「对方已…」颠倒）
    SIGNING_MY_REJECTED: '你已拒绝此次签约请求',
    SIGNING_MODAL_TITLE: '发起签约',
    SIGNING_MODAL_HINT: '选择需求、确认报价、时间与授课方式后发送，由对方确认', // 需求四·第2条：发起签约绑定需求
    SIGNING_DEMAND_LABEL: '选择需求',
    SIGNING_DEMAND_PLACEHOLDER: '请选择要签约的需求',
    VALIDATE_SIGNING_DEMAND: '请选择要签约的需求',
    SIGNING_NO_DEMAND_HINT: '暂无开放的需求可签约，请先发布需求',
    SIGNING_DEMANDS_LOAD_FAIL: '需求列表加载失败，请刷新页面后重试。',
    LABEL_SIGNING_PRICE: '报价（元/小时）',
    LABEL_SIGNING_SCHEDULE: '授课时间（每周固定时间段）', // 复用结构化时间组件（非自然语言文本框）
    LABEL_SIGNING_METHOD: '授课方式',
    SIGNING_PRICE_PLACEHOLDER: '例如 150',
    SIGNING_METHOD_ONLINE: '线上授课',
    SIGNING_METHOD_OFFLINE: '线下授课',
    BTN_SIGNING_SEND: '发送签约请求',
    CHAT_SIGNING_REQUEST_TITLE: '对方向你发送了签约请求',   // 气泡标题（对方视角）
    CHAT_SIGNING_MINE_TITLE: '你向对方发送了签约请求',       // 气泡标题（发起者视角）
    CHAT_SIGNING_PRICE: '报价',
    CHAT_SIGNING_SCHEDULE: '时间',
    CHAT_SIGNING_METHOD: '方式',
    BTN_SIGNING_CONFIRM: '确认签约',
    BTN_SIGNING_REJECT: '拒绝',
    SIGNING_CONFIRMED_TEXT: '已确认签约',
    SIGNING_REJECTED_TEXT: '已拒绝此次签约请求',
    VALIDATE_SIGNING_PRICE: '请填写有效报价',
    VALIDATE_SIGNING_SCHEDULE: '请填写授课时间',
    // 需求四平台不走资金声明：平台仅信息撮合与契约留档，课费由双方站外直接结算——
    // 全文（资金触点浮窗：签约/起草合同）+ 短文（聊天气泡）+ 平台介绍 / 新手导引各取所需，文案单源
    FUNDS_NOTE: '平台仅提供信息撮合与合同存证服务，不参与任何费用结算。课时费请由双方自行协商并在站外直接结算（如微信、支付宝转账等），平台不代收、不代付。',
    FUNDS_NOTE_SHORT: '平台不参与费用结算，课费请与对方站外直接结算。',
    LABEL_CONTRACT_METHOD: '教学方式',
    LABEL_CONTRACT_PLAN: '教学方案',
    LABEL_CONTRACT_RATE: '约定时薪（元/小时）',
    CONTRACT_PLAN_PLACEHOLDER: '描述教学目标、内容安排与上课节奏，发送后将按此信息生成正式合同',
    VALIDATE_CONTRACT_PLAN: '请填写教学方案',
    VALIDATE_CONTRACT_RATE: '请填写约定时薪',
    CONTRACT_EMPTY: '合同内容不能为空',
    CONTRACT_PRICE_PLACEHOLDER: '如：150',
    ADMIN_CONTRACT_DRAFTER_PREFIX: '起草 ',
    LABEL_CONTRACT_SCHEDULE: '授课时间（每周固定时间段）', // 复用结构化时间组件
    LABEL_CONTRACT_LOCATION: '授课地点',
    CONTRACT_LOCATION_PLACEHOLDER: '甲方常住处或双方另行约定的地点',
    CONTRACT_LOCATION_NOTE: '出于隐私保护，授课地点请使用「甲方常住处」等模糊表述，勿将详细地址上传至平台。',
    // 合同草案三要素：薪资结算方式 / 首次上课日期 / 试课薪资方案（选「其他」时展开文字输入）
    LABEL_CONTRACT_PAY_METHOD: '薪资结算方式',
    PAY_METHOD_PER_SESSION: '次付',
    PAY_METHOD_WEEKLY: '周付',
    PAY_METHOD_MONTHLY: '月付',
    PAY_METHOD_OTHER: '其他',
    CONTRACT_PAY_METHOD_OTHER_PLACEHOLDER: '请输入结算方式，如：每 10 次课结算一次',
    VALIDATE_CONTRACT_PAY_METHOD_OTHER: '请输入具体的薪资结算方式',
    LABEL_CONTRACT_FIRST_LESSON: '首次上课日期',
    // 需求四十五：分段日期输入（年-月-日，复用底层段输入原语）——每段 aria
    SEG_YEAR_ARIA: '年',
    SEG_MONTH_ARIA: '月',
    SEG_DAY_ARIA: '日',
    SEG_HOUR_ARIA: '时',
    SEG_MINUTE_ARIA: '分',
    VALIDATE_CONTRACT_FIRST_LESSON_INCOMPLETE: '请完整填写首次上课日期（年/月/日）',
    LABEL_CONTRACT_TRIAL_PAY: '试课薪资方案',
    TRIAL_PAY_FIRST_FREE: '第一次试课免费',
    TRIAL_PAY_FIRST_HOUR_FREE: '第一小时免费，第二小时收费',
    TRIAL_PAY_NORMAL: '全程正常收费',
    TRIAL_PAY_OTHER: '其他',
    CONTRACT_TRIAL_PAY_OTHER_PLACEHOLDER: '请输入试课薪资方案',
    VALIDATE_CONTRACT_TRIAL_PAY_OTHER: '请输入具体的试课薪资方案',
    LABEL_CONTRACT_DEMAND: '对应需求',
    CONTRACT_DEMANDS_SIGNED_HINT: '仅已签约需求可继续签合同', // 需求四·第3条（U7 v0.25.105：长提示缩短并入下拉占位，删外置提示行）
    CONTRACT_REQUIRE_SIGNED: '请选择已签约需求',
    CONTRACT_DEMANDS_EMPTY: '暂无已签约需求可起草合同',
    CONTRACT_DEMANDS_LOAD_FAIL: '需求列表加载失败，请刷新页面后重试。',
    DEMAND_TAG_CONTRACTED: '已签约',
    DEMAND_TAG_REVOKED: '合同已撤销',
    TAG_MATCH: '匹配度 ',
    TAG_MATCH_HINT: ' · 点击展开明细',
    TAG_MATCH_TITLE: '点击查看匹配度明细',
    TAG_MATCH_NO_DEMAND: '发布需求后展示匹配度', // #155：学生无开放需求时匹配度位置小灰字提示
    MATCH_DETAIL_TITLE: '匹配度明细',
    MATCH_DETAIL_SUB: '根据你的教师档案与这条需求自动计算',
    MATCH_ITEM_SUBJECT: '科目匹配',
    MATCH_ITEM_PERSONALITY: '性格匹配',
    MATCH_ITEM_REGION: '区域匹配',
    MATCH_ITEM_BUDGET: '预算匹配',
    MATCH_ITEM_GENDER: '性别匹配',
    MATCH_SUBJECT_HIT: '命中 {hit}/{total} 门需求科目',
    MATCH_REGION_HIT: '同省（{name}），区域吻合',
    MATCH_REGION_MISS: '省份不符，区域不匹配',
    MATCH_DISTANCE_SAME: '同镇/同街道，零距离',            // 需求五：上海线下镇间距离 ≤0.5km
    MATCH_DISTANCE_HIT: '距授课点约 {km} 公里',            // 需求五：上海线下镇间距离（20km 内线性计分）
    MATCH_DISTANCE_ONLINE: '线上授课，距离不计分',          // 需求五：线上单距离分不参与加权
    MATCH_DISTANCE_NO_LOCALE: '教师未填上海常住地，未计入',  // 需求五：教师无常住地坐标时该维跳过
    MATCH_BUDGET_HIT: '报价在需求预算区间内',
    MATCH_BUDGET_MISS: '报价超出需求预算区间',
    MATCH_PERSONALITY_HIT: '命中 {hit}/{total} 个偏好性格',
    MATCH_PERSONALITY_MISS: '教师性格与偏好无重合',
    MATCH_GENDER_ANY: '需求不限性别',
    MATCH_GENDER_HIT: '性别符合需求偏好',
    MATCH_GENDER_MISS: '性别不符需求偏好',
    MATCH_GENDER_UNDISCLOSED: '教师未透露性别，明确偏好折半计分',
    MATCH_DIM_SKIP: '该项缺数据，未计入',
    MATCH_NOTE: '计分口径：科目 {subject} 分（命中需求科目的比例）+ 区域 {region} 分（上海线下按教师常住地距授课点公里数计分、线上单不计）+ 预算 {budget} 分（报价在区间内）+ 性格 {personality} 分（偏好性格重合比例）+ 性别 {gender} 分（偏好性别吻合）。缺数据的维度不计分，总分按有效维度归一化到 100。',
    // 学生端教师匹配度明细（需求五）：多需求逐条比对，条目区限高滚动
    MATCH_T_TITLE: '教师匹配度明细',
    MATCH_TEACHER_DETAIL_SUB: '根据你的活跃需求与该教师档案自动计算，按匹配度从高到低展示',
    MATCH_T_PCT: '匹配度：',
    MATCH_T_DEMAND_PREFIX: '需求',       // 明细头「需求#xxxx」前缀（需求五·item5 格式）
    MATCH_T_BRACKET_L: '【',
    MATCH_T_BRACKET_R: '】',
    BTN_REOPEN_DEMAND: '重开需求',
    DEMAND_REOPENED_TOAST: '需求已重新开放',
    CONFIRM_REOPEN_DEMAND: '重开后该需求将重新出现在需求大厅，再次接受教师意向。确定重开吗？',
    DEMAND_PREFIX: '需求 ',
    BTN_VERIFY_LEDGER: '存证校验',
    CONTRACT_LEDGER_VALID: '存证校验通过：合同文本与签署指纹一致',
    CONTRACT_LEDGER_INVALID: '存证校验异常：文本与签署指纹不一致',
    CONTRACT_LEDGER_ARCHIVED: '该合同已撤销，签署时的存证留档仍保留',
    CONTRACT_LEDGER_NONE: '该合同暂无存证记录',

    // 撤销合同（仅签约后可用；入口刻意低调；两级确认；活跃库抹除、台账与留档保留）
    BTN_REVOKE_CONTRACT: '撤销合同',
    REVOKE_MODAL_TITLE: '撤销合同',
    REVOKE_CONTRACT_WARN: '此功能仅限在双方已经约定好结束合同时使用。撤销后合同不再生效，双方列表保留「已撤销」状态、正文与存证台账留档（合同不删除）。由此产生的一切法律后果由双方自行承担。',
    BTN_THINK_AGAIN: '再想想',
    BTN_CONTINUE_DANGER: '我已知晓后果，继续',
    REVOKE_CONTRACT_FINAL: '最终确认：撤销后不可恢复，确定继续吗？',
    CONTRACT_REVOKED_TOAST: '合同已撤销',
    CONTRACT_REVOKED_NOTIFY: '「{name}」已撤销双方签署的合同，活跃数据已抹除，存证留档保留。',

    // 注销账户（账户设置底部；两级确认；单方数据删除、双方数据保留并墓碑化展示）
    BTN_DEACTIVATE_ACCOUNT: '注销账户',
    DEACTIVATE_WARN: '注销后：你的教师档案、发布的帖子与点赞、反馈、通知等仅与你一人相关的数据将被永久删除；需求、会话、合同、评价等涉及双方的数据会保留，但你的用户名将显示为「已注销用户」。此操作不可恢复。',
    DEACTIVATE_FINAL: '最终确认：注销后账户与个人数据不可恢复，确定继续吗？',
    DEACTIVATE_DONE_TOAST: '账户已注销',
    REAUTH_PASSWORD_LABEL: '当前密码',
    REAUTH_PASSWORD_HINT: '输入当前密码以确认此操作',
    DEACTIVATED_USER_PREFIX: '已注销用户',
    // v0.25.42：涉事双方数据（会话/需求/合同/评价等）对端展示的注销提示 tag
    PEER_DEACTIVATED_TAG: '一方已注销',

    // 访客模式：主页按钮直达客户端（未登录态）；需要身份的操作统一经 ensureAuth 导向特制登录页，登录后自动返回原页面
    GUEST_NOT_LOGGED_IN: '未登录',
    GUEST_TAP_TO_LOGIN: '点击登录以使用全部功能',
    AUTH_LOGIN_TITLE: '欢迎回来',
    AUTH_LOGIN_SUB: '登录你的账户以继续使用',
    AUTH_LOGIN_TITLE_GUEST: '登录以使用全部功能',
    AUTH_LOGIN_SUB_GUEST: '登录后将自动返回你刚才所在的页面',
    // v0.23.1：主页双按钮按角色分流，预览端触发登录时按客户端类型提示
    AUTH_LOGIN_TITLE_TEACHER: '请登录教师账户',
    AUTH_LOGIN_SUB_TEACHER: '登录后将进入教师端',
    AUTH_LOGIN_TITLE_STUDENT: '请登录学生账户',
    AUTH_LOGIN_SUB_STUDENT: '登录后将进入学生端',

    // 个人信息右栏（取代旧教师详情弹窗：卡片①身份②教师资料③评价；已签约绿色标记；账簿式对齐布局）
    PROFILE_PANEL_TITLE: '个人信息',
    PROFILE_SIGNED_TAG: '已签约',
    PROFILE_EMPTY_TEACHER: '这位老师还没有填写资料',
    REVIEW_LOCKED_HINT: '与这位老师签约后，即可写下你的评价',
    LABEL_GRADE: '年级',
    LABEL_GENDER: '性别',
    LABEL_PRICE: '报价',
    LABEL_INTRO: '简介',
    LABEL_GAOKAO_SCORES: '高考成绩',
    LABEL_SUBJECT: '科目', // #158：需求大厅筛选标签
    // #158：需求大厅排序 + 筛选
    DEMAND_SORT_MATCH: '匹配度最高',
    DEMAND_SORT_NEWEST: '最新发布',
    DEMAND_SORT_BUDGET: '预算从低到高',
    DEMAND_FILTER_ALL: '全部',
    DEMAND_FILTER_EMPTY: '没有符合筛选条件的需求',

    // 教师档案扩展字段（学校公开；真实姓名/学信网截图仅双向匹配后可见）
    LABEL_SCHOOL: '学校',
    LABEL_REAL_NAME: '真实姓名',
    LABEL_CREDENTIAL: '学信网截图',
    LABEL_CONTACT: '联系方式',
    LABEL_WECHAT: '微信', LABEL_EMAIL: '邮箱', // M2：联系方式多行子标题（科目式）
    // 教师档案扩展（R2-5/R2-1/R2-2/R2-3/R2-4）：报价区间 / 可授课时间段 / 授课方式 / 性格关键词 / 非学科项目
    LABEL_PRICE_RANGE: '报价区间（元/小时）',
    LABEL_TEACHING_METHOD_PROFILE: '授课方式',
    LABEL_TIME_SLOTS: '可授课时间段',
    // R2-12 教师毕业年份：决定其当年高考按哪套政策（改革批次）填写赋分；留空 = 按最新政策
    LABEL_GRADUATION_YEAR: '毕业年份',
    GRAD_YEAR_PLACEHOLDER: '如 2020（留空按最新政策）',
    GRAD_YEAR_SUFFIX: '年',
    LABEL_PERSONALITY_TAGS: '性格关键词',
    PERSONALITY_TAGS_HINT: '（最多 {max} 个）', // {max} 由调用方以 CONFIG.PERSONALITY_TAGS_MAX 替换（防双处维护）
    TAG_PICK_LIMIT: '最多选 {max} 个',
    LABEL_NONACADEMIC_PROJECTS: '擅长非学科类项目',
    // 需求侧非学科选择（用户反馈 2026-08-08）：学生端是「需要的项目」不是「擅长」——独立常量，
    // 与教师端 LABEL_NONACADEMIC_PROJECTS（擅长非学科类项目）分流，禁止复用错位
    LABEL_TARGET_PROJECTS: '需求项目',
    LABEL_NONACADEMIC_PRICES: '非学科类项目报价',
    // 信息卡「硬展示」占位：字段不藏，学生据此判断教师资料完善度
    PROFILE_FIELD_EMPTY: '未填写',
    PROFILE_FIELD_AFTER_MATCH: '建立会话后展示',
    // 需求六·item2：资料卡分组大 title（去分隔线后占满横向空位分隔不同类型资料；单源，改文案只动这里）
    PROFILE_SECTION_BASIC: '基本资料',
    PROFILE_SECTION_ACADEMIC: '学科类资料',
    PROFILE_SECTION_NONACADEMIC: '非学科类资料',
    PROFILE_SECTION_PRIVATE: '私密资料',
    CREDENTIAL_UPLOAD: '上传',
    CREDENTIAL_UPLOADED_VIEW: '已上传，点击查看',
    CREDENTIAL_VIEW: '点击查看',
    CREDENTIAL_REUPLOAD: '重新上传',
    CREDENTIAL_PICK_HINT: '请选择图片文件',
    // v0.25.94：合同待签约态只留「待签约」——pending（草案待确认）遗留态连根删
    CONTRACT_STATUS_SIGNING: '待签约',
    CONTRACT_STATUS_SIGNED: '已签约',
    CONTRACT_STATUS_REVOKED: '已撤销', // ：撤销标记 tag（红）
    BTN_SIGN: '开始签约',                 // v0.25.32：确认签约 → 开始签约（先读合同+待够时长）
    BTN_SIGN_WAITING: '等待对方确认签约',
    BTN_MODIFY_CONTRACT: '修改内容',
    BTN_VIEW_CONTRACT: '查看合同',
    BTN_CANCEL_CONTRACT: '取消签约',
    MODIFY_CONTRACT_TITLE: '修改合同内容',
    CONTRACT_VIEW_DIFF_TITLE: '查看合同 · 本次改动',   // v0.24.3：修改过的合同查看时标题带改动提示
    CONTRACT_MODIFY_BIZ_HINT: '仅可修改业务条款，法律条款不可修改',   // 审计：单源收口（曾硬编码中文 + 内联样式）
    CONTRACT_DIFF_HINT: '本次修改的改动处已高亮：绿色=新增，红色删除线=移除；法律条款未改动。', // diff 视图
    SIGN_MODAL_TITLE: '开始签约',
    SIGN_READ_HINT: '请阅读合同全文并滚动到底部，方可确认', // v0.25.94：倒计时已上「确认签约」按钮，灰字提示只留静态阅读指引（不再轮番闪）
    SIGN_COUNTDOWN_HINT: '{secs}秒后可确认签约', // ：倒计时动态提示（从开窗起算）
    SIGN_READY_HINT: '已阅读完毕，可确认签约',
    SIGN_READ_DONE_BTN: '我已阅读并确认签约',
    CONFIRM_SIGN_TWICE: '确认签约后合同即生效、不可单方撤销。你确定已仔细阅读并确认这份合同吗？',
    CONFIRM_SIGN_FINAL: '请输入账户密码，完成最终确认（后期接入短信验证码）',
    CONFIRM_SIGNING_ACCEPT: '接受签约？需求将锁定为已成交，其他教师的试课意向会被自动拒绝。请输入账户密码完成最终确认。', // S2-2：确认签约=危险操作（同合同签署/撤销口径，capToken 二次认证）
    CONFIRM_CANCEL_CONTRACT: '取消后回到待签约状态、合同保留（会话保留）。确定取消签约吗？', // ：取消不再删除合同
    CONTRACT_EMPTY_LIST: '暂无合同——可在「我的会话」的聊天窗内起草',
    CONTRACT_MODIFIED_TOAST: '修改已同步给对方，双方需重新确认签约',
    CONTRACT_CANCELLED_TOAST: '已取消签约，合同保留待重新签约',
    CONTRACT_REVOKED_BY_ME: '你已撤销合同', // ：撤销后本人视角
    CONTRACT_REVOKED_BY_PEER: '对方已撤销合同', // ：撤销后对方视角
    CONTRACT_SIGNED_TOAST: '签约完成',

    // 签署合规：签名区块内嵌正文 + 每次签署落台账 + signed_at 列
    CONTRACT_SIGN_DONE_BOTH: '双方已签署',                    // 已签约合同卡副标
    CONTRACT_PARTY_SIGNED_A: '甲方已签',                     // 签署进度（甲方=学生方）
    CONTRACT_PARTY_PENDING_A: '甲方待签',
    CONTRACT_PARTY_SIGNED_B: '乙方已签',                     // 签署进度（乙方=教师方）
    CONTRACT_PARTY_PENDING_B: '乙方待签',
    SIGN_MODAL_DISCLOSE: '你将以平台账号「{username}」电子签署本合同：实名登录 + 密码二次确认即构成可靠电子签名，签署后合同即生效。', // 签署弹窗前置告知
    CONTRACT_VERIFY_PANEL_TITLE: '存证校验',                  // toast 升级小面板
    CONTRACT_VERIFY_HASH: '当前指纹',
    CONTRACT_VERIFY_ENTRIES: '台账条目',
    CONTRACT_VERIFY_FLOW: '存证流水号',
    CONTRACT_VERIFY_LABEL_HEAD: '链头',                    // A7 收口：存证链校验标签
    CONTRACT_VERIFY_LABEL_LINK: '连续性',
    CONTRACT_VERIFY_LABEL_SEQ: '序号',
    CONTRACT_VERIFY_CD_PREFIX: '#CD',                     // 存证流水号前缀
    CONTRACT_VERIFY_ENTRY_UNIT: '条',                     // 「{n} 条」单位

    // 管理员：资料管理
    ADMIN_POSTS_EMPTY: '暂无帖子',

    // 管理员：合同管理（网页测试用途，真实场景仅管理员可见）
    PAGE_ADMIN_CONTRACTS: '合同管理',
    PAGE_ADMIN_CONTRACTS_DESC: '查看全部合同，测试用移除',
    ADMIN_CONTRACTS_EMPTY: '暂无合同',
    BTN_REMOVE_CONTRACT: '移除合同',
    CONFIRM_ADMIN_REMOVE_CONTRACT: '移除后合同彻底删除（操作留档保留）。确定移除该合同吗？',
    ADMIN_CONTRACT_REMOVED_TOAST: '合同已移除',

    // 关于平台（全角色，侧边栏末尾；原名「关于我们」，改称更切合模块实际功能）
    PAGE_ABOUT: '关于平台',
    PAGE_ABOUT_DESC: '平台介绍与用户支持',
    ABOUT_FOOTNOTE: '网站初创，欢迎在「关于平台」-「{feedback}」中向我们提出优化建议。您说任何需求/设想，我们都尽力实现。',
    ABOUT_WHO_TITLE: '我们是谁',
    ABOUT_WHO_TEXT: '经途·伴学信息门户是由上海财经大学在校学生的家教团体运营的公益信息平台。我们的初衷很简单：为想做家教的同学（尤其是持有教师资格证的在校大学生与研究生）提供勤工俭学、社会实践的机会，也帮家长和同学直接对接合适的老师，中间不赚一分钱差价。平台不开展任何有偿培训业务，不向老师收取佣金，也不向家长学员收取任何中介费用。为响应国家「双减」政策，我们谢绝在职老师及校外培训机构注册与合作。',
    // 需求四：平台不走资金声明（关于页「我们是谁」卡内的醒目分块）——撇清平台资金责任
    ABOUT_FUNDS_TITLE: '关于费用',
    ABOUT_FUNDS_TEXT: '平台是公益信息平台，仅提供信息撮合与合同存证服务，不参与任何费用结算，也不从任何交易中抽成。课时费的金额与支付方式由你与老师/学员自行协商，并在站外直接结算（如微信、支付宝转账）。请勿向平台支付任何费用。',
    ABOUT_USAGE_TITLE: '平台基本用法',
    // 平台基本用法：学生签约完整流程（流程图五步，编号圆圈 + 连线展示）
    ABOUT_FLOW_STEP_1: '发布需求：填写年级、科目与预算，发布你的家教需求',
    ABOUT_FLOW_STEP_2: '对接教师：把需求直接发给心仪的教师，或等待教师发来试课意向',
    ABOUT_FLOW_STEP_3: '确认开聊：对方确认后自动开启会话，在站内沟通课程细节',
    ABOUT_FLOW_STEP_4: '起草合同：在会话中起草家教服务合同，约定时间、地点与课时费',
    ABOUT_FLOW_STEP_5: '双方签约：到「我的合同」确认签署，按约开始上课',
    // 安全与隐私保护卡片（面向学生与家长，建立信任；措辞刻意避开技术黑话）
    ABOUT_SECURITY_TITLE: '安全与隐私保护',
    ABOUT_SECURITY_INTRO: '我们把大家的信息安全看得很重。下面这些保护，是为了让你和家长都能安心使用：',
    ABOUT_SECURITY_ITEMS: [
      { t: '密码加密保管', d: '注册密码经过高强度加密后才存进数据库，任何人（包括我们自己）都看不到你的原始密码。' },
      { t: '登录不反复传密码', d: '登录后用一次性加密凭证通行，密码不会一次次在网络上传输；还能在「账户设置」里随时让别的设备下线。' },
      { t: '联系方式先藏起来', d: '微信、电话等联系方式要等双方签约后才向对方展示，在此之前谁也看不到，不怕被陌生人骚扰。' },
      { t: '个人信息按需可见', d: '真实姓名、学籍认证材料只在双方建立联系之后才互相展示，平时对所有人隐藏。' },
      { t: '地址只到街道一级', d: '平台只收集、保存、展示到区/镇/街道一级，从不收集详细门牌地址，上课地点由双方自行商量约定。' },
      { t: '合同防篡改存证', d: '签好的合同会生成加密存证并环环相扣，一旦签署就没法被悄悄改动，对双方都是保障。' },
      { t: '全程加密传输', d: '你和网站之间往来的所有数据都走加密通道，防止半路被人偷看。' },
      { t: '自动抵御恶意试探', d: '对频繁尝试登录、批量注册等异常行为，系统会自动限流并临时封禁，守护账户安全。' },
    ],
    ABOUT_SUPPORT_TITLE: '用户支持',
    ABOUT_SUPPORT_OWNER: '平台负责人：康同学',
    ABOUT_SUPPORT_WECHAT: '微信：13524121020',
    ABOUT_SUPPORT_EMAIL: '邮箱：support_sufe_tutor@163.com',
    BTN_FEEDBACK: '用户反馈',
    BTN_COMPLAINT_FEEDBACK: '投诉与反馈', // M11：用户反馈+投诉合并入口按钮
    FEEDBACK_CHOOSE_BUG: '我要反馈 Bug',
    FEEDBACK_CHOOSE_SUGGESTION: '我要提出建议',
    FEEDBACK_CHOOSE_COMPLAINT: '我要投诉',
    FEEDBACK_MODAL_TITLE_BUG: '反馈 Bug',
    FEEDBACK_MODAL_TITLE_SUGGEST: '提出建议',
    FEEDBACK_TITLE_PLACEHOLDER: '一句话概括你的问题或建议',
    FEEDBACK_PLACEHOLDER: '详细描述你遇到的问题或建议（支持轻量 Markdown）',
    FEEDBACK_EMPTY: '反馈内容不能为空',
    FEEDBACK_SENT_TOAST: '反馈已提交，感谢你的声音',
    BTN_MY_COMPLAINTS_FEEDBACK: '我的投诉与反馈', // M12：两按钮合并为一个（投诉+反馈同一浮窗）
    FEEDBACK_COMPLAINT_SUBJECT_TEACHER: '教师',
    FEEDBACK_COMPLAINT_SUBJECT_STUDENT: '学生',
    FEEDBACK_COMPLAINT_SUBJECT_PLATFORM: '平台服务',
    FEEDBACK_COMPLAINT_RESOLVED: '你的投诉已被受理并处理。感谢你的信任，如有其他问题欢迎随时反馈。',
    MY_FEEDBACK_TITLE: '我的投诉与反馈', // M12：与合并按钮同名（原「我的反馈与投诉」）
    MY_FEEDBACK_EMPTY: '还没有提交过反馈或投诉',

    // 管理员：用户反馈
    PAGE_ADMIN_FEEDBACK: '用户反馈',
    PAGE_ADMIN_FEEDBACK_DESC: '查看并处理用户提交的 Bug、建议与投诉',
    ADMIN_FEEDBACK_EMPTY: '暂无用户反馈',
    FEEDBACK_TAG_BUG: 'Bug',
    FEEDBACK_TAG_SUGGEST: '建议',
    FEEDBACK_TAG_COMPLAINT: '投诉',
    FEEDBACK_STATUS_OPEN: '未处理',
    FEEDBACK_STATUS_RESOLVED: '已处理',
    BTN_MARK_RESOLVED: '标记已处理',
    FEEDBACK_RESOLVED_TOAST: '已标记处理并通知提出者',

    // R22：投诉通道独立（接口/浮窗/数据通道均独立于用户反馈；仅外层接口接管理员临时通路）
    COMPLAINT_MODAL_TITLE: '提交投诉',
    COMPLAINT_TAB_TEACHER: '投诉教师',
    COMPLAINT_TAB_STUDENT: '投诉学生',
    COMPLAINT_TAB_POST: '投诉帖子',
    COMPLAINT_RECENT_LABEL: '最近联系的人',
    COMPLAINT_SEARCH_PLACEHOLDER: '输入 id 或昵称搜索',
    COMPLAINT_SEARCH_POST_PLACEHOLDER: '输入帖子 id 或标题搜索',
    COMPLAINT_SEARCH_EMPTY: '未找到匹配对象，可输入 id 精确搜索',
    COMPLAINT_TARGET_REQUIRED: '请选择要投诉的对象',
    COMPLAINT_REASON_REQUIRED: '请选择投诉理由',
    COMPLAINT_REASON_LABEL: '投诉理由',
    SELECT_PROVINCE_FIRST: '请先选择地区', // M3：年级选择前先选地区（年级随地区学制变化）
    COMPLAINT_SELECTED_PREFIX: '已选择：', // M9：投诉对象从可叉 tag 改「已选择 + 更换」单选行
    COMPLAINT_CHANGE_TARGET: '更换',
    COMPLAINT_REASON_PLACEHOLDER: '请选择理由', // M8：投诉理由从切换式改下拉栏占位项（A1 审计：1414 重复键已删，本行生效）
    COMPLAINT_DETAIL_LABEL: '补充描述',
    COMPLAINT_DETAIL_PLACEHOLDER: '补充具体问题、发生时间等（选填，支持轻量 Markdown）',
    COMPLAINT_REASONS: ['虚假信息或欺诈', '侮辱谩骂或骚扰', '侵犯隐私', '违法违规内容', '恶意营销或广告', '其他'],
    COMPLAINT_SENT_TOAST: '投诉已提交，我们会尽快核实处理',
    COMPLAINT_STATUS_OPEN: '处理中',
    COMPLAINT_STATUS_RESOLVED: '已处理',
    COMPLAINT_ATTACH_LABEL: '上传附件（选填，最多 4 个，图片可上传 4 张以下）', // U11：投诉附件区（预览复用聊天暂存区样式）
    COMPLAINT_ATTACH_ADD: '添加附件',
    COMPLAINT_ATTACH_TOO_MANY: '附件最多 4 个',
    COMPLAINT_ATTACH_UPLOADING: '请等待附件上传完成', // 与聊天 CHAT_STAGE_WAIT 同语义
    COMPLAINT_ATTACH_FAIL: '附件加载失败',

    // 管理员：投诉处理（R22 独立于用户反馈）
    PAGE_ADMIN_COMPLAINT: '投诉处理',
    PAGE_ADMIN_COMPLAINT_DESC: '查看并处理用户提交的投诉（对象 / 理由 / 详情）',
    ADMIN_COMPLAINT_EMPTY: '暂无投诉',
    BTN_COMPLAINT_RESOLVE: '标记已处理',
    // ：统一内容审核页
    PAGE_ADMIN_CONTENT: '内容审核',
    PAGE_ADMIN_CONTENT_DESC: '统一查看全站用户内容并执行删除/封禁处罚',
    ADMIN_CONTENT_EMPTY: '暂无内容',
    ADMIN_CONTENT_PENALTY_DELETE: '删除',
    ADMIN_CONTENT_PENALTY_BAN: '封禁作者',
    ADMIN_CONTENT_PENALTY_REASON: '处罚原因（必填）',
    ADMIN_CONTENT_PENALTY_RULE: '触犯规则',
    ADMIN_CONTENT_TYPE_POST: '帖子', ADMIN_CONTENT_TYPE_DEMAND: '需求', ADMIN_CONTENT_TYPE_TEACHER: '教师档案',
    ADMIN_CONTENT_TYPE_REVIEW: '评价', ADMIN_CONTENT_TYPE_MESSAGE: '聊天', ADMIN_CONTENT_TYPE_FEEDBACK: '反馈',
    ADMIN_CONTENT_TYPE_COMPLAINT: '投诉', ADMIN_CONTENT_TYPE_UPLOAD: '附件',
    ADMIN_CONTENT_TYPE_CONTRACT: '合同', ADMIN_CONTENT_TYPE_SIGNING: '签约请求',
    COMPLAINT_RESOLVED_TOAST: '已标记处理并通知投诉人',

    // 账户头像
    SETTINGS_AVATAR: '账户头像',
    BTN_UPLOAD_AVATAR: '上传头像',
    AVATAR_SAVED_TOAST: '头像已更新',

    // 需求推送限流（每分钟一条）
    PUSH_BTN_COOLDOWN: '已发送',

    // 成绩标签
    SCORE_UNIT: '分',

    // 通用页面文案
    LOADING: '加载中...',
    OPTION_PLACEHOLDER: '请选择',
    CONTACT_PLACEHOLDER: '手机邮箱',
    VALIDATE_SELECT_PROVINCE: '请选择省份',
    // 任务三需求表单 wizard：分步导航 + 每页校验
    BTN_PREV_STEP: '上一步',
    BTN_NEXT_STEP: '下一步',
    VALIDATE_SELECT_GRADE: '请选择学生年级',
    VALIDATE_ADDRESS_REQUIRED: '请选择所在区与镇/街道',
    VALIDATE_BUDGET_RANGE: '预算区间有误：最低价不能高于最高价',
    VALIDATE_CONTACT_REQUIRED: '请填写家长与学生联系方式',
    DW_STEP_PROVINCE: '省份',
    DW_STEP_METHOD: '教学方式',
    DW_STEP_STUDENT: '学生概况',
    DW_STEP_SUBJECTS: '科目',
    DW_STEP_SCORES: '成绩情况', // 非学科类型即时改「技能现状」（LABEL_SKILL_STATUS）
    DW_STEP_TEACHER_PREF: '教师偏好', // ：「详细偏好」拆分，教师偏好独立页（原 P4 内容移此）
    DW_STEP_BUDGET: '预算与时间',
    DW_STEP_SUBMIT: '补充信息',

    // 侧边栏页签标题
    PAGE_MY_DEMANDS: '我的需求',
    PAGE_BROWSE_TEACHERS: '浏览教师',
    PAGE_MY_CHATS: '我的会话',
    PAGE_BROWSE_DEMANDS: '需求大厅',
    PAGE_RESOURCE_SHARE: '资料共享',
    PAGE_EDIT_PROFILE: '个人资料',
    PAGE_TITLE_EDIT_PROFILE: '编辑个人资料',
    PAGE_ADMIN_STATS: '统计',
    PAGE_ADMIN_TRAFFIC: '流量监测',
    PAGE_ADMIN_STUDENTS: '学生管理',
    PAGE_ADMIN_TEACHERS: '教师管理',
    PAGE_ADMIN_DEMANDS: '需求管理',
    PAGE_ADMIN_REVIEWS: '评价管理',
    PAGE_ADMIN_AWARDS: '奖项审核', PAGE_ADMIN_AWARDS_DESC: '审核教师荣誉奖项与奖状证明',
    PAGE_ADMIN_POSTS: '资料管理',

    // 侧边栏页签简介（选中时展开的灰字说明）
    PAGE_MY_DEMANDS_DESC: '发布与管理家教需求',
    PAGE_BROWSE_TEACHERS_DESC: '筛选教师，查看详情与评价',
    PAGE_MY_CHATS_DESC: '与匹配的师生在线沟通',
    PAGE_BROWSE_DEMANDS_DESC: '浏览学生需求并提交意向',
    PAGE_RESOURCE_SHARE_DESC: '与同行共享教学资源',
    PAGE_EDIT_PROFILE_DESC: '完善个人档案与高考成绩',
    PAGE_ADMIN_STATS_DESC: '平台运行数据总览',
    PAGE_ADMIN_TRAFFIC_DESC: '站点流量与平均延迟',
    PAGE_ADMIN_STUDENTS_DESC: '学生账户与封禁管理',
    PAGE_ADMIN_TEACHERS_DESC: '教师账户与封禁管理',
    PAGE_ADMIN_DEMANDS_DESC: '全平台需求管理',
    PAGE_ADMIN_REVIEWS_DESC: '评价审核与删除',
    PAGE_ADMIN_POSTS_DESC: '管理教师共享的资料帖子',
    PAGE_NOTIFICATIONS_DESC: '意向与推送的处理进展',
    PAGE_ACCOUNT_SETTINGS_DESC: '外观主题与账户设置',

    // 侧边栏模块「i」信息浮窗（需求四·4b）：每模块白话介绍，按 ROLE_PAGES 角色可见性各自加载
    MODULE_INFO_TIP: '模块介绍',
    MODULE_INFO: {
      // v0.25.12（反馈：介绍要占大半个页面 + 结构化）——全部为 Markdown：## 小标题 + 段落 + **加粗**
      // 渲染走 openModuleInfo → mdRender（app-posts 自研 markdown-lite，escHtml 先转义，安全）
      'my-demands': '## 这是什么\n你的家教需求管理中心：发布、查看、修改需求，并处理老师发来的试课意向。\n\n## 怎么用\n**新建需求：** 点右上角「新建需求」，按引导填写学科或非学科项目、年级、预算、期望时间等，提交后需求即发布到需求广场，老师能看到并投递意向。\n\n**处理意向：** 发布后，老师对这条需求的试课意向会逐条出现在需求下方。点开可看到老师姓名、擅长科目与报价，逐个同意或拒绝。\n\n**管理需求：** 已签约或想下架的需求可编辑或删除；撤销的需求可以重新开放。\n\n## 小贴士\n资料填得越完整，匹配到的老师越精准，越容易被选中。',
      'browse-teachers': '## 这是什么\n全平台教师列表，学生端默认按与你需求的匹配度从高到低排列。\n\n## 怎么用\n**筛选：** 用上方筛选按地区、科目、性别、报价等缩小范围。\n\n**看卡片：** 每张卡片展示老师的学校年级、擅长科目、高考成绩、授课方式与报价；右侧匹配度按钮会列出你每个需求的具体得分。\n\n**看详情：** 点卡片任意处打开完整资料卡，含性格关键词、可授课时间段与历史评价。\n\n## 小贴士\n满意的老师可直接把需求发给他，或先进会话聊一聊再决定。',
      'my-chats': '## 这是什么\n与老师/学生一对一沟通的聊天窗口，所有交流都会留档。\n\n## 怎么用\n**会话列表：** 左侧是全部会话，点开即可收发文字、图片和文件，消息约每 4 秒自动刷新。\n\n**对方资料：** 右上角人头图标可打开对方资料卡。\n\n**签约入口：** 聊天里的「+」号可呼出发起签约或起草合同，谈妥后在这里确认签约关系。',
      'my-contracts': '## 这是什么\n合同管理区：起草、确认、签署与撤销都在这里完成。\n\n## 怎么用\n**起草签约：** 在会话里谈妥条件后，起草合同并选择对应的已签约需求，双方确认后正式签约。\n\n**查看修改：** 每张合同卡显示签约对象、授课方式、时薪与状态；可查看正式合同全文、修改条款。\n\n**存证与撤销：** 已签合同可查存证；确需结束时按流程撤销。\n\n## 小贴士\n合同签好即具有法律效力，是双方权益的保障，签署前请仔细核对条款。',
      'notifications': '## 这是什么\n平台各类提醒的汇总页：试课意向、学生推送的需求、签约与合同进展都会通知到这里。\n\n## 怎么用\n**查看：** 每条通知可直接看到内容，处理过的意向与需求去「我的需求」查看状态。\n\n**屏蔽公告：** 右上角「屏蔽系统通知」可一键过滤平台公告类消息，再点一次恢复。',
      'account-settings': '## 这是什么\n账户与外观设置页。\n\n## 怎么用\n**账户信息：** 查看用户名与身份，上传头像，管理已登录设备——发现陌生设备可随时踢下线。\n\n**外观设置：** 切换亮色/暗色/跟随系统主题；用「UI大小」滑块整体调整字号、按钮与侧边栏尺寸。\n\n**退出与注销：** 页面底部是退出登录（二次确认）与注销账户（需密码二次认证，注销后数据会被清理）。',
      'about': '## 这是什么\n平台介绍与帮助中心，也是了解平台理念与规则的地方。\n\n## 怎么用\n**阅读：** 平台理念、基本签约流程、安全与隐私说明、版本更新记录都在这里。\n\n**反馈：** 页面下方有反馈入口，遇到 Bug 或有建议可留给我们。\n\n**重温引导：** 「重温新手引导」按钮随时可以再看一遍各模块的用法。',
      'browse-demands': '## 这是什么\n学生发布的全部家教需求，教师端默认按与你档案的匹配度从高到低排列。\n\n## 怎么用\n**筛选：** 用上方筛选按年级、科目、地区、预算等缩小范围。\n\n**看需求：** 每张需求卡展示学生年级、目标科目、当前成绩、期望时间与预算区间。\n\n**投递意向：** 看中的需求点「提交试课意向」，系统先弹二次确认避免误发海投；确认后学生收到并决定是否同意。\n\n## 小贴士\n档案越完整匹配度越高，越容易被学生选中；「学生主动发给你的需求」会置顶展示，记得及时处理。',
      'resource-share': '## 这是什么\n教师之间共享教学资源的交流区。\n\n## 怎么用\n**发布：** 顶部可发布图文帖子，分享课件、讲义或教学心得。\n\n**浏览：** 列表可按搜索与排序浏览同行分享的资料，看到有用的可以点赞。\n\n## 小贴士\n发布时注意不要包含他人隐私信息。',
      'edit-profile': '## 这是什么\n完善你的教师档案——资料越完整，匹配度越高、越容易被学生选中。\n\n## 怎么用\n按四个大区填写：\n\n**基本资料：** 地区、年级、学校、性别。\n\n**学科资料：** 擅长科目、按毕业省份政策填写的高考成绩、报价区间。\n\n**非学科资料：** 可教的项目与各自报价。\n\n**私密资料：** 微信等联系方式，仅在你与对方建立会话/签约后展示。\n\n## 小贴士\n填完点保存即时生效；毕业年份决定高考成绩按哪年政策计算，请如实填写。',
      'admin-stats': '## 这是什么\n平台运行数据总览。\n\n## 怎么用\n展示注册用户数、需求数、合同数等核心指标，快速把握平台整体活跃情况。数据为实时统计，定期刷新即可掌握最新状态。',
      'admin-traffic': '## 这是什么\n站点流量与延迟监测。\n\n## 怎么用\n查看访问量与 API 响应时间，及时发现异常波动。延迟异常时优先排查网络与服务端健康状态。',
      'admin-students': '## 这是什么\n学生账户管理。\n\n## 怎么用\n查看全部学生列表，可封禁或解封违规账户，维护平台秩序。封禁前请先确认违规证据。',
      'admin-teachers': '## 这是什么\n教师账户管理。\n\n## 怎么用\n查看全部教师列表，处理学籍认证审核，封禁/解封违规账户。',
      'admin-demands': '## 这是什么\n全平台需求管理。\n\n## 怎么用\n查看所有用户发布的需求，可删除违规内容，维护广场秩序。',
      'admin-reviews': '## 这是什么\n评价审核与删除。\n\n## 怎么用\n用户提交的评价先在这里审核，通过的才会公开；违规内容可删除或拒绝。',
      'admin-awards': '## 这是什么\n教师荣誉奖项审核。\n\n## 怎么用\n教师上传奖状证明提交奖项，管理员在此人工核对后通过或驳回；通过的奖项才展示在教师主页。',
      'admin-posts': '## 这是什么\n资料帖子管理。\n\n## 怎么用\n查看教师共享的资料帖子，删除含隐私或违规信息的帖子。',
      'admin-contracts': '## 这是什么\n合同管理。\n\n## 怎么用\n查看平台全部合同与状态，必要时移除测试或异常数据。',
      'admin-feedback': '## 这是什么\n用户反馈处理。\n\n## 怎么用\n查看用户提交的 Bug 与建议，逐条查看详情并标记处理状态。',
      'admin-complaint': '## 这是什么\n投诉处理。\n\n## 怎么用\n查看用户提交的投诉——投诉对象（教师/学生/帖子）、理由与详情都会快照存档，即使对象已注销或删除也不影响追溯。\n\n**处理：** 逐条核实后点「标记已处理」，系统会通知投诉人处理结果。\n\n## 小贴士\n投诉是独立的合规通道，与用户反馈分开管理；处理时先核实快照信息与聊天记录，再决定如何处置。',
      'admin-content': '## 这是什么\n全站统一内容审核界面：一声令下看到平台所有用户可操作的内容，一声令下完成处罚。\n\n## 怎么用\n**看内容：** 上方按类型切换（帖子/需求/教师档案/评价/聊天/反馈/投诉/附件），每张卡片展示作者、内容摘要与状态。\n\n**处罚：** 点卡片右侧按钮，填写处罚原因（必填）与触犯规则，可「删除」该内容或「封禁作者」——处罚后系统会自动把原因、规则与触发内容摘要通知给作者本人。\n\n## 小贴士\n处罚前先核实触发内容与聊天上下文；封禁会同时阻止该账户继续登录。',
    },

    // 需求表单
    MODAL_TITLE_DEMAND_CREATE: '提交学生需求',
    MODAL_TITLE_DEMAND_EDIT: '编辑学生需求',
    HINT_SELECT_TARGET_SUBJECTS: '请先选择目标科目',
    HINT_SELECT_PROVINCE_GRADE: '请先选择省份和年级',
    HINT_SELECT_PROVINCE_GAOKAO: '请先选择省份（高考所在地），按该省政策填写高考成绩',

    // 学生处理教师意向
    INTENT_STATUS_PENDING: '待处理',
    INTENT_STATUS_ACCEPTED: '已同意',
    INTENT_STATUS_REJECTED: '已拒绝',
    EMPTY_NO_INTENTS: '暂无教师意向',
    INTENT_ACCEPTED_TOAST: '已同意，可在「我的会话」中开始对话',
    INTENT_ACCEPTED_NOTIFY: '学生已同意你的试课意向，会话已建立，请前往「我的会话」查看详情',
    PUSH_ACCEPTED_NOTIFY: '教师已确认你发送的需求，会话已建立，请前往「我的会话」查看详情',
    INTENT_REJECTED_TOAST: '已拒绝该意向',

    // 评价补充
    REVIEW_MODAL_TITLE_PREFIX: '评价 ',
    REVIEW_STATUS_AUDITING: '审核中',
    REVIEW_REJECTED_HINT: '未通过，可修改后重新提交',
    BTN_EDIT_REVIEW: '修改评价',
    BTN_SUBMIT_REVIEW: '提交评价',

    // 教师弹窗 / 联系方式
    SECTION_REGION: '地区',
    CONTACT_AFTER_SIGN_NOTE: '签约后展示联系方式',
    CONTACT_PANEL_WECHAT_PREFIX: '微信：',
    CONTACT_PANEL_EMAIL_PREFIX: '邮箱：',
    CONTRACT_SUBJECT_LINE_PREFIX: '授课科目：',

    // 用户状态标签
    TAG_BANNED: '已封禁',

    // 沟通（聊天）
    CHAT_TITLE: '会话',
    CHAT_EMPTY_NO_CONVS: '暂无沟通——同意教师试课意向后自动建立',
    CHAT_CONV_NOT_FOUND: '未找到与该学生的会话', // R26：需求卡「已建立联系→」兜底
    CHAT_EMPTY_NO_MESSAGES: '还没有消息，先打个招呼吧',
    CHAT_PREVIEW_ME_PREFIX: '我：',
    CHAT_PREVIEW_IMAGE: '[图片]',
    CHAT_PREVIEW_FILE: '[文件]',
    CHAT_UNKNOWN_USER: '未知用户',
    CHAT_BACK_TO_LIST: '会话列表',
    CHAT_CLOSED_TIP: '该会话已关闭，不能再发送消息',
    CHAT_SIGN_TIP: '已与对方确认签约，建议起草并签订正式合同以加强契约有效性；平台不参与费用结算，课费请与对方站外直接结算。', // 需求四·第4条：签约确认后气泡内合并提示
    CHAT_ATTACH_IMAGE: '图片',
    CHAT_ATTACH_FILE: '文件',
    CHAT_INPUT_PLACEHOLDER: '输入消息',
    CHAT_BTN_SEND: '发送',
    CHAT_FILE_TOO_LARGE: '文件太大（上限 500KB，图片会自动压缩）',
    CHAT_DOWNLOAD: '下载',
    CHAT_FILE_FALLBACK: '文件',
    CHAT_STAGE_WAIT: '请等待文件处理完成再发送',
    CHAT_DROP_HINT: '松开加入发送',
    CHAT_ATTACH_FAIL: '附件加载失败',
    CHAT_ATTACH_REMOVED: '附件已被发送方移除',
    CHAT_PLACEHOLDER_TITLE: '选择左侧会话，开始沟通',
    CHAT_PLACEHOLDER_SUB: '同意试课意向后自动建立会话，消息每 4 秒自动刷新',

    // 资料共享广场
    POSTS_SEARCH_PLACEHOLDER: '搜索标题或正文',
    POSTS_SORT_NEW: '最新优先',
    POSTS_SORT_HOT: '最热优先',
    BTN_CREATE_POST: '发布帖子',
    POSTS_EMPTY: '还没有帖子，分享一份教学资料，帮到更多同行。',
    POST_BTN_DELETE: '删除',
    BTN_CONFIRM_DELETE: '确认删除',
    POST_ANONYMOUS: '匿名',
    POST_LIKE_ARIA: '点赞',
    POST_VIEW_ARIA: '查看帖子全文', // #161：帖子标题按钮（点击卡片查看全文）
    POST_LIKED_TOAST: '已点赞',
    POST_UNLIKED_TOAST: '已取消点赞',
    // R23：帖子收藏（资料共享——收藏即保存，仅本人可见）
    POSTS_VIEW_ALL: '全部',
    POSTS_VIEW_FAV: '我的收藏',
    POSTS_FAV_ACTIVE: '已进入我的收藏', // M7/B7：收藏 toggle 按钮进入态文案（B7 返工：勾不写进文案，改前置 SVG 勾）
    BTN_FAVORITE: '收藏',
    BTN_FAVORITED: '已收藏',
    POST_FAV_ARIA: '收藏', // 未收藏
    POST_FAV_ACTIVE_ARIA: '取消收藏', // 已收藏
    POST_FAVORITED_TOAST: '已收藏，可在「我的收藏」查看',
    POST_UNFAVORITED_TOAST: '已取消收藏',
    POSTS_FAV_EMPTY: '还没有收藏，看到有用的教学资料点一下书签图标，收藏后在这里随时查看。',
    POST_MODAL_TITLE_CREATE: '发布帖子',
    POST_LABEL_TITLE: '标题',
    POST_TITLE_PLACEHOLDER: '一句话概括分享内容',
    POST_LABEL_BODY: '正文',
    POST_MD_BOLD: '加粗',
    POST_MD_IMAGE: '插入图片',
    POST_BODY_PLACEHOLDER: '支持轻量 Markdown：## 大标题、### 小标题、**加粗**、插入图片（图片以本地文件嵌入）',
    POST_PREVIEW_TITLE: '预览效果',           // v0.24.0：实时预览连根删，改按钮+独立浮窗
    POST_PREVIEW_BTN: '预览效果',
    POST_PREVIEW_EMPTY: '暂无内容，点击「预览效果」查看渲染结果',
    POST_MD_BOLD_DEFAULT: '加粗文本',
    POST_IMAGE_ONLY: '请选择图片文件',
    POST_IMAGE_ALT: '图片',
    POST_IMG_BLOCKED: '[图片：链接未放行，不予渲染]',
    POST_TITLE_REQUIRED: '标题不能为空',
    POST_TITLE_TOO_LONG: '标题不能超过 60 个字符',       // A3 收口：服务端发帖错误文案单源
    POST_BODY_TOO_LONG: '正文不能超过 20000 个字符',
    POST_DELETE_FORBIDDEN: '仅作者本人可删除该帖子',
    POST_PUBLISHING: '发布中',
    POST_PUBLISHED: '发布成功',
    BTN_PUBLISH: '发布',
    BTN_CLOSE: '关闭',                 // 弹窗 ✕ 关闭按钮 aria-label
    A11Y_VIEW_PROFILE: '查看该用户资料',  // 可点用户名/头像 span 的 aria-label
    VERIFIED_BADGE: '✓ 已认证',
    VERIFY_CONFIRM: '确认通过该教师的学籍认证吗？认证徽章将展示在教师主页。',
    UNVERIFY_CONFIRM: '确认撤销该教师的学籍认证吗？',        // 学籍认证徽章（管理员审核学信网截图通过）
    VERIFIED_TITLE: '已通过学籍认证',   // 徽章悬停提示
    POST_DELETE_TITLE: '删除帖子',
    POST_DELETE_CONFIRM: '删除后不可恢复，点赞数据一并清空。确认删除这篇帖子？',

    // 通知信息
    EMPTY_NO_NOTIFICATIONS: '暂无通知',
    NOTIF_FILTER_EMPTY: '没有符合条件的通知', /* v0.19.46 通知页屏蔽系统通知后空态 */
    NOTIF_READ_ARIA: '标记该条通知已读',     // #151：未读通知呼吸遮罩 + 点击消除（键盘可达）
    NOTIF_BLOCK_OFF: '屏蔽系统通知',        // 需求四·4b：通知页右上角屏蔽按钮两态（localStorage 持久化，纯客户端）
    NOTIF_BLOCK_ON: '已屏蔽系统通知',

    // 账户设置（设置页：账户信息区 + 外观设置区）
    SETTINGS_APPEARANCE_TITLE: '外观设置',
    SETTINGS_THEME_LABEL: '外观主题',
    SETTINGS_THEME_HINT: '选择界面外观风格，「跟随系统」会自动适配系统的黑夜模式',
    SETTINGS_UI_SCALE_LABEL: 'UI大小',
    SETTINGS_UI_SCALE_HINT: '调整界面文字、按钮与输入组件的整体大小（{min}%~{max}%，默认 {def}%）', // {min}/{max}/{def} 渲染时填 CONFIG.UI_SCALE_MIN/MAX/DEFAULT（数字单源，禁散落硬编码）
    SETTINGS_STYLE_LABEL: '页面风格',
    SETTINGS_STYLE_HINT: '整站视觉风格：液态玻璃（毛玻璃+光影）／平面简约（纯色无磨砂，更轻快）',
    STYLE_LIQUID: '液态玻璃', STYLE_FLAT: '平面简约',
    SETTINGS_ORB_LABEL: '背景光球',
    SETTINGS_ORB_HINT: '背景漂移光球的显示效果：鲜艳=彩色柔光，淡雅=若有若无，隐藏=纯净底色',
    SETTINGS_ORB_FLAT_HIDDEN: '（平面简约下强制隐藏）',    // A7 收口：flat 档提示
    ORB_MODE_VIVID: '鲜艳', ORB_MODE_ELEGANT: '淡雅', ORB_MODE_HIDDEN: '隐藏',
    THEME_LIGHT: '亮色',
    THEME_DARK: '暗色',
    THEME_SYSTEM: '跟随系统',
    SETTINGS_ACCOUNT_TITLE: '账户设置', // R20：「账户信息」title 改「账户设置」
    SETTINGS_USERNAME: '账户用户名',
    SETTINGS_ROLE: '账户角色',
    SETTINGS_PHONE: '电话',
    SETTINGS_EMAIL: '邮箱',
    SETTINGS_UNBOUND: '未绑定',
    // 教师荣誉奖项（提交/展示/审核）
    AWARD_SECTION_TITLE: '荣誉奖项',
    AWARD_ADD_BTN: '添加奖项',
    AWARD_TITLE_LABEL: '奖项名称', AWARD_TITLE_PLACEHOLDER: '如：全国高中数学联赛一等奖',
    AWARD_ISSUER_LABEL: '颁发机构', AWARD_ISSUER_PLACEHOLDER: '如：中国数学会',
    AWARD_DATE_LABEL: '获奖时间', AWARD_DATE_PLACEHOLDER: '如 2025-06（可选）',
    AWARD_PROOF_LABEL: '奖状证明',
    AWARD_PROOF_HINT: '上传奖状/获奖证书图片，管理员审核通过后公开展示',
    AWARD_STATUS_PENDING: '待审核', AWARD_STATUS_APPROVED: '已通过', AWARD_STATUS_REJECTED: '已驳回',
    AWARD_COUNT_BADGE: '🏆 荣誉 ×{n}',
    AWARD_EMPTY: '暂无荣誉奖项',
    AWARD_DELETE_CONFIRM: '确定删除该奖项吗？删除后需重新提交审核。',
    AWARD_REJECTED_NOTE_PREFIX: '驳回理由：',
    AWARD_APPROVED_NOTIFY: '你的荣誉奖项「{title}」已通过审核，将展示在你的教师主页。',
    AWARD_REJECTED_NOTIFY: '你的荣誉奖项「{title}」未通过审核，请登录查看驳回理由。',
    BTN_SUBMIT: '提交', BTN_SUBMITTING: '提交中...', SUCCESS_DELETED: '已删除',
    BTN_DELETE: '删除',
    // 管理员：奖项审核
    ADMIN_AWARDS_DESC: '审核教师提交的荣誉奖项与奖状证明',
    ADMIN_AWARD_APPROVE: '通过', ADMIN_AWARD_REJECT: '驳回',
    ADMIN_AWARD_REJECT_HINT: '驳回理由（必填，将通知教师）',
    ADMIN_AWARD_PROOF_VIEW: '查看奖状',
    ADMIN_AWARD_NONE: '暂无待审核的奖项',
    ADMIN_AWARD_APPROVE_CONFIRM: '确定通过该奖项审核吗？通过后将展示在教师主页。',
    ADMIN_AWARD_REJECT_CONFIRM: '确定驳回该奖项吗？理由将通知教师。',
    BTN_MODIFY: '修改',
    // 验证码/凭证（B2-B6；手机号/邮箱绑定、用户名修改、验证码登录）
    PHONE_LABEL: '手机号', PHONE_PLACEHOLDER: '请输入中国大陆手机号', // 只支持大陆（用户拍板）
    EMAIL_LABEL: '邮箱', EMAIL_PLACEHOLDER: '请输入邮箱',
    CODE_LABEL: '验证码', CODE_PLACEHOLDER: '输入验证码',
    CODE_SEND: '发送验证码',
    CODE_SEND_AGAIN: '{time}后重发',   // B1 倒计时复用（60s）。v0.26.17 用户反馈：原「{time}后可再次发送验证码」10 字 > 发送按钮 max-width（92-104px）溢出——左边戳到输入框底部、右边 ellipsis 截断；改短「xx秒后重发」装得下
    OTP_MOCK_TOAST: '模拟验证码（内测期使用）：{code}', // B6 内测短路：请求后 toast 模拟验证码
    BTN_BIND: '绑定',
    BIND_PHONE_TITLE: '绑定手机号',
    BIND_EMAIL_TITLE: '绑定邮箱',
    USERNAME_CHANGE_TITLE: '修改用户名',
    USERNAME_NEW_PLACEHOLDER: '输入新用户名（3-30 字符，不含 @ 与纯数字）',
    USERNAME_COOLDOWN_BTN: '{time}后可再次修改用户名', // B1 倒计时复用（7 天冷却）
    // 审计（U2/U3）：以下文案收口自硬编码——服务端同文案在 server/constants.js MSG（跨层重复属既定，
    // 改文案必须两处同步；此处为前端校验的即时 toast）
    USERNAME_LENGTH_ERR: '用户名长度需在 3-30 个字符之间', // 同 MSG.USERNAME_LENGTH
    USERNAME_CHARS_ERR: '用户名只能包含中文、字母、数字及 _ . - （3-30 个字符），且不能为纯数字、不能含 @', // 同 MSG.USERNAME_NEW_INVALID（对齐服务端全文案，修复此前少「（3-30 个字符）」段的漂移）
    USERNAME_USE_PASSWORD: '用户名账户请使用密码登录',
    CRED_IDENT_INVALID: '请输入有效的手机号或邮箱',
    CRED_FORMAT_PHONE: '手机号格式不正确', // 同 MSG.PHONE_INVALID
    CRED_FORMAT_EMAIL: '邮箱格式不正确', // 同 MSG.EMAIL_INVALID
    BTN_USERNAME_SAVE: '确认修改',
    BTN_USERNAME_SAVING: '保存中...',
    LOGIN_SWITCH_CODE: '验证码登录',
    LOGIN_SWITCH_PASSWORD: '密码登录',
    LOGIN_IDENTIFIER_PLACEHOLDER: '请输入用户名/手机号/邮箱',
    LOGIN_ACCOUNT_MISSING: '不存在的账户',
    LOGIN_CODE_TIP: '向该账户绑定的手机/邮箱发送验证码',
    // 滑块拼图真人验证（C1/C2）
    CAPTCHA_TITLE: '拖动滑块完成拼图',
    CAPTCHA_TIP: '拖动滑块，将拼图块对齐到缺口位置',
    CAPTCHA_PASS: '验证通过',
    CAPTCHA_FAIL: '验证未通过，请重试',
    CAPTCHA_ARIA: '拖动滑块完成拼图验证',
    BTN_LOGOUT: '退出登录',
    CONFIRM_LOGOUT: '确定要退出当前账户吗？',
    // 登录设备管理（账户设置）
    SETTINGS_DEVICES: '登录设备',
    // #163：隐私设置——访客可见性控制
    SETTINGS_PRIVACY_TITLE: '隐私设置',
    SETTINGS_PRIVACY_ON: '允许',
    SETTINGS_PRIVACY_OFF: '关闭',
    SETTINGS_PRIVACY_PROFILE_LABEL: '允许访客浏览我的教师档案',
    SETTINGS_PRIVACY_PROFILE_HINT: '关闭后，未登录的游客看不到你的资料卡，仅登录用户可见',
    SETTINGS_PRIVACY_DEMAND_LABEL: '允许访客浏览我的需求',
    SETTINGS_PRIVACY_DEMAND_HINT: '关闭后，未登录的游客看不到你发布的需求，仅登录用户可见',
    SETTINGS_PRIVACY_SAVED: '隐私设置已保存',
    SETTINGS_DEVICES_HINT: '以下是登录过此账户的设备，可让其他设备下线。',
    DEVICE_CURRENT: '当前设备',
    DEVICE_UNKNOWN: '未知设备',
    DEVICE_LOGIN_AT: '登录于 ',
    BTN_DEVICE_LOGOUT: '下线',
    DEVICE_REVOKE_CONFIRM: '确定要让该设备退出登录吗？该设备上的会话将立即失效。',
    DEVICE_REVOKE_DONE: '该设备已下线',

    // 新手引导（无登录记录时自动弹出；入口在「关于平台」页可重温）
    ONBOARD_TITLE: '欢迎来到经途·伴学信息门户',
    // v0.25 需求三：主页首访浮窗简化——聚焦核心特点 + 最基本流程（避免理解疲劳）；
    // 详细用法浮窗 USAGE_GUIDE_SECTIONS 不变，想深入了解随时可开
    ONBOARD_INTRO: '欢迎来到经途·伴学信息门户——学生与家教老师直接对接，零佣金、不收费。',
    ONBOARD_POLICY: [
      '学生：发布需求 → 浏览教师 → 匹配后站内沟通',
      '教师：浏览需求 → 提交试课意向 → 匹配后站内沟通',
      '匹配成功后在「我的会话」沟通上课细节，到「我的合同」正式签约',
      '当前为内测阶段，公测后账号与数据将被清空；更多细节见「详细用法介绍」',
    ],
    ONBOARD_CONFIRM: '知道了',
    ONBOARD_CONFIRM_LOGIN: '知道了，去登录',
    ONBOARD_REVISIT_BTN: '重温新手引导',
    // 新手引导多步走（需求三）：独立可交互层，亮区点击进入下一步；文案单源。
    // 右上角全局「跳过引导」按钮（需求三·6：引导全程常亮，固定定位 z 高于一切）。
    TOUR_SKIP_GLOBAL: '跳过引导',
    TOUR_ARIA_LABEL: '新手引导', // 引导层 role=dialog aria-label（网安 M2/a11y）
    // —— 需求大厅（教师）——
    TOUR_STEP_BROWSE_DEMANDS: '需求大厅：学生发布的家教需求都在这，按匹配度排好序。点击进入。',
    TOUR_STEP_DEMAND_LIST: '这里就是需求列表。每条卡片写着发起人、科目、年级、预算、上课方式，一目了然。',
    TOUR_STEP_DEMAND_CARD: '一条需求卡：期望时间、预算区间、授课方式都在上面，先看看合不合适。',
    TOUR_STEP_DEMAND_INTENT_BTN: '「提交试课意向」按钮：觉得合适就点它，等学生确认后自动开启会话。',
    TOUR_STEP_DEMAND_ID_TAG: '需求编号 #0001：沟通时用它指代这条需求，对方一看就知道是哪条。',
    // —— 浏览教师（教师广场 / 教师同行）——
    TOUR_STEP_BROWSE_TEACHERS: '教师广场：平台上的全部教师都在这，按匹配度从高到低排。点击进入。',
    TOUR_STEP_BROWSE_TEACHERS_PEER: '教师同行：看看其他老师怎么介绍自己、怎么定价，参考参考。点击进入。',
    TOUR_STEP_TEACHERS_LIST: '教师列表：每张卡片显示地区、学校、年级、报价区间、可授课时间。',
    TOUR_STEP_FILTER_TOGGLE: '「筛选」按钮：按科目、报价上限、最低评分过滤教师。',
    TOUR_STEP_FILTER_SUBJECT: '选科目、报价等条件，列表会即时筛选；清空条件就看全部。',
    TOUR_STEP_TEACHER_USERNAME: '点老师的名片卡片（整卡可点），打开右侧资料栏看成绩、评价和联系方式规则。',
    TOUR_STEP_PROFILE_CLOSE: '点右上角 ✕ 关闭资料栏，回到列表。',
    TOUR_STEP_TEACHER_PUSH_BTN: '「发送需求」按钮：把你的需求直接发给这位老师。',
    TOUR_STEP_PUSH_MODAL: '选一条你的需求发送过去，老师确认后自动开启会话。点击关闭。',
    // —— 资料共享（教师）——
    TOUR_STEP_RESOURCE_SHARE: '资料共享：同行分享教学资料的地方。点击进入。',
    TOUR_STEP_POSTS_LIST: '资料列表：按最新 / 最热排序，浏览同行分享的帖子。',
    TOUR_STEP_POSTS_SEARCH: '搜索框：输入关键词，快速找你想看的资料。',
    TOUR_STEP_POSTS_SORT: '排序：最新优先 / 最热优先，随你切换。',
    TOUR_STEP_POSTS_CREATE: '「发布帖子」按钮：分享一份教学资料，帮到更多同行。',
    TOUR_STEP_POSTS_MODAL: '发布窗口：填标题和正文，支持 Markdown 和插入图片。点击关闭。',
    // —— 我的会话 ——
    TOUR_STEP_MY_CHATS: '我的会话：匹配成功后的沟通窗口，双方的联系方式此时互相不可见。点击进入。',
    TOUR_STEP_CONV_ITEM: '左侧是会话列表，每个会话对应一位师生。点一个打开聊天窗。',
    TOUR_STEP_CHAT_MESSAGES: '这里是聊天记录，消息约每 4 秒自动刷新，交流都会留档。',
    TOUR_STEP_CHAT_SEND: '底部输入框打字，点「发送」；也支持图片和文件。',
    TOUR_STEP_CHAT_PLUS: '点这个 + 号，唤出功能栏；下面的每一项都介绍一下。',
    // —— v0.25.38（反馈 #130）：+ 号功能栏项目逐个聚焦介绍 ——
    TOUR_STEP_CHAT_PLUS_IMAGE: '「图片」：把截图、错题照片直接发进会话，点开可看大图。',
    TOUR_STEP_CHAT_PLUS_FILE: '「文件」：教案、资料 PDF 也能发——选文件后随消息发送。',
    TOUR_STEP_CHAT_PLUS_SIGNING: '「发起签约」：谈妥了就在这里发起签约意向，对方确认后进入合同流程。',
    TOUR_STEP_CHAT_PLUS_DRAFT: '「起草合同」：签约确认后，在这里起草正式合同条款发给对方。',
    // —— 我的合同 ——
    TOUR_STEP_MY_CONTRACTS: '我的合同：谈妥上课细节后，在这走正式签约，保障双方权益。点击进入。',
    TOUR_STEP_CONTRACTS_LIST: '合同列表：每张卡片对应一份合同，带状态标签（待确认 / 签署中 / 已签）。',
    TOUR_STEP_CONTRACT_CARD: '一张合同卡：看对方、科目、报价、关联需求编号。',
    TOUR_STEP_CONTRACT_ACTIONS: '底部操作：确认签约、修改合同、查看合同。签好后联系方式才互相可见。',
    // —— 个人资料（教师）——
    TOUR_STEP_EDIT_PROFILE: '个人资料：完善你的档案，学生据此了解你、信任你。点击进入。',
    TOUR_STEP_PROFILE_FORM: '资料表单：省份、年级、学校、毕业年份等基本信息都在这填。',
    TOUR_STEP_PROFILE_SUBJECTS: '擅长科目：勾选你教的科目，可多选。',
    TOUR_STEP_PROFILE_PRICE: '报价区间：填最低和最高课时费，学生按这个区间判断。',
    TOUR_STEP_PROFILE_SUBMIT: '填完点「保存」，资料就更新了。越完整越容易被选中。',
    TOUR_STEP_PROFILE_AWARDS: '荣誉奖项：上传奖状证明，管理员审核通过后会展示在你的教师主页。',
    // —— 通知 ——
    TOUR_STEP_NOTIFICATIONS: '通知信息：试课意向、需求推送、合同进展都汇总在这。点击进入。',
    TOUR_STEP_NOTIF_LIST: '通知列表：每条通知写着处理进展，点击未读通知即可标为已读。', // #151：进页不再自动全读
    TOUR_STEP_NOTIF_ITEM: '一条通知：展示内容与时间；红点代表未读。',
    TOUR_STEP_NOTIF_BLOCK: '右上角「屏蔽系统通知」：不想看系统广播点一下，再点恢复。',
    // —— 设置 ——
    TOUR_STEP_ACCOUNT_SETTINGS: '设置：账户设置与外观设置都在这里。点击进入。',
    TOUR_STEP_SETTINGS_ACCOUNT: '账户设置区：头像、用户名、角色；可以上传头像。',
    TOUR_STEP_SETTINGS_THEME: '外观主题：亮色 / 暗色 / 跟随系统，点一下即时切换。',
    TOUR_STEP_SETTINGS_UI_SCALE: 'UI 大小：拖动滑块整体调大调小界面文字和按钮。',
    TOUR_STEP_SETTINGS_LOGOUT: '页底「退出登录」，注销账户也在这里。',
    TOUR_STEP_SETTINGS_LOGOUT_MODAL: '确认退出：点一下这个弹窗的空白处或按钮就能关闭它。',
    // —— 关于平台 ——
    TOUR_STEP_ABOUT: '关于平台：平台理念、基本用法、安全隐私与反馈通道。点击进入。',
    TOUR_STEP_ABOUT_WHO: '我们是谁：一句话介绍平台定位。',
    TOUR_STEP_ABOUT_FLOW: '学生签约完整流程：发布需求 → 匹配 → 沟通 → 签约，五步走。',
    TOUR_STEP_ABOUT_SECURITY: '安全与隐私：联系方式保护、资料脱敏等，放心使用。',
    TOUR_STEP_ABOUT_FEEDBACK: '反馈通道：遇到问题或建议，点这里告诉我们。',
    // —— 我的需求（学生）——
    TOUR_STEP_MY_DEMANDS: '我的需求：你发布的家教需求都在这管理。点击进入。',
    TOUR_STEP_MY_DEMANDS_LIST: '需求列表：每条显示科目、预算、状态；待处理的教师意向有红点提醒。',
    TOUR_STEP_INTENT_TOGGLE: '展开「教师意向」：谁想来教，同意或拒绝都在这处理。',
    TOUR_STEP_DEMAND_WIZARD: '这是 7 页分步表单，跟着顶部进度条一步步填；每一步都会校验，填完自动进入下一页。',
    TOUR_STEP_NEW_DEMAND_BTN: '点「新建需求」打开发布表单。',
    TOUR_STEP_NEW_DEMAND_MODAL: '发布表单共 7 页：省份 → 授课方式 → 学生信息 → 科目 → 科目情况 → 预算时间 → 联系方式。顶部进度条随页推进，随时可回上一步修改。',
    // —— 末步 ——
    TOUR_STEP_GUEST_LOGIN: '到这里就逛完啦：点下方个人信息栏登录或注册，登录后就能使用全部功能。',
    TOUR_STEP_ADMIN_STATS: '统计页：平台运营数据总览。',
    TOUR_STEP_ADMIN_TODO: '待办事项：待审核的评价、奖项与未处理反馈、投诉都汇总在这，点一下直达处理页。',
    TOUR_STEP_ADMIN_AWARDS: '奖项审核：核对教师上传的奖状证明，通过后展示在教师主页；驳回时填理由通知教师。',
    TOUR_STEP_ADMIN_CONTENT: '内容审核：全站内容统一提取与一键处罚（删除/封禁），处罚会自动通知作者。',
    TOUR_STEP_ADMIN_END: '以上是管理端核心工作台。封禁、处罚、广播等危险操作都需要密码二次确认。',
    TOUR_STEP_USER_BAR: '个人信息栏：点头像查看自己的信息；退出登录在「设置」页，想重温新手引导去「关于平台」页。',
    // 详细用法介绍（关于页「平台基本用法」底部按钮呼出的完整使用说明浮窗；文案单源）
    USAGE_GUIDE_BTN: '详细用法介绍',
    USAGE_GUIDE_TITLE: '详细用法介绍',
    USAGE_GUIDE_SECTIONS: [
      { t: '一、用户注册', p: ['账户分为学生、教师两种，可访问的客户端不同。内测期采用简易注册，自己设定用户名和密码即可，没有多余验证；欢迎大家学生、教师各注册一个试试看。公开上线后将改为手机号 + 验证码注册，教师账号还需要邀请码才能注册。'] },
      { t: '二、家教签约（主要功能）', p: [
        '发布需求：学生在「我的需求」里填写年级、科目、预算等信息，发布一条家教需求。',
        '双向匹配：学生可在「浏览教师」页面把需求直接发给心仪的教师，等教师确认；教师也可以在「需求广场」里给感兴趣的需求发送试课意向，等学生确认。无论哪条路，只要对方点头，双方就自动开启会话。',
        '站内沟通：匹配成功后，双方在「我的会话」里沟通上课细节，支持发送图片和文件。这个阶段双方的联系方式互相不可见，所有交流都在站内、有留档。',
        '签约：会话里任一方点「+」发送一份合同草案，约定授课地点、方式、费用与双方权利义务；随后双方各自到「我的合同」里确认签署。合同具有法律效力，签好后双方的联系方式才会互相展示，之后转入站外沟通，撮合完成。',
      ]},
      { t: '三、（教师端）资料共享', p: ['这一栏用于站内教师共享教学资料，目前功能还比较原始：只支持简单的图文发帖，也还没有激励机制。平台会持续完善这一块。'] },
      { t: '四、（教师端）个人资料', p: ['教师的基本信息：科目成绩、报价、联系方式、学信网截图等，目的是提升教师可信度。这些信息会展示在点击头像打开的个人资料卡里，供学生和家长参考。'] },
      { t: '五、设置', p: ['可设置系统主题（暗色 / 亮色）、更换头像、绑定手机或邮箱、管理登录设备等。'] },
      { t: '六、关于平台', p: ['平台的基本介绍；拉到最底部有 Bug / 建议的反馈通道。'] },
      { t: '七、其他小巧思', p: [
        '从教师端看学生需求会有「匹配度」标签，点开能看到教师与这单需求的匹配度明细；后续计划把匹配度扩展成智能排序引擎。',
        '根据你设置的省份和年级，可选科目和赋分制也会不同。',
        '平台在数据安全和合规上下了很多功夫：用户数据加密存储，签署合同有验证流程，能保证合同在法律上有效。',
      ]},
    ],

    // 表单标签与占位符
    LABEL_PROVINCE: '省份',
    LABEL_STUDENT_GRADE: '学生年级',
    LABEL_STUDENT_GENDER: '学生性别',
    LABEL_TARGET_SUBJECTS: '目标科目',
    LABEL_MULTI_SUFFIX: '（可多选）',
    // 需求类型分段切换（R2-b）：学科 / 非学科 标签与需求卡类型徽章
    LABEL_TYPE_ACADEMIC: '学科辅导',
    LABEL_TYPE_NONACADEMIC: '非学科培养',
    BADGE_TYPE_ACADEMIC: '学科',
    BADGE_TYPE_NONACADEMIC: '非学科',
    // 需求偏好（R2-b）：偏好老师性格 / 偏好老师性别
    LABEL_PREFERRED_PERSONALITY: '偏好老师性格',
    LABEL_PREFERRED_GENDER: '偏好老师性别',
    // 教学目标：「详细偏好」拆分——P4 教学目标 tag-pick
    LABEL_TEACHING_GOAL: '教学目标',
    TEACHING_GOALS_HINT: '（最多 {max} 个）', // {max} 由调用方以 CONFIG.TEACHING_GOALS_MAX 替换
    // 技能现状：非学科类型下 P5 标题即时切换 + 每项目描述文本框
    LABEL_SKILL_STATUS: '技能现状',
    LABEL_SKILL_NOTE: '技能详情',
    SKILL_NOTE_PLACEHOLDER: '描述当前水平/证书/考级/获奖（选填）',
    // 学生性别（R2-11）：'' = 不愿透露（默认，资料卡视同未填不展示）；男/女沿用 GENDERS 文案
    OPTION_GENDER_NOT_SAY: '不愿透露',
    OPTION_PREF_GENDER_ANY: '不限',
    LABEL_CURRENT_SCORES: '各科当前大概成绩',
    LABEL_TEACHING_METHOD: '期望教学方式',
    LABEL_ADDRESS: '地址（授课区域）',
    // 需求五：地址改结构化选择（区·镇/街道），非上海强制线上不收集地址；placeholder 语义更新
    ADDRESS_PLACEHOLDER: '选择所在区与镇/街道',
    SH_ADDR_SELECT_DISTRICT_FIRST: '请先选择区',
    LABEL_SHANGHAI_RESIDENCE: '上海常住地', // 教师档案第二地址（区别于高考省份；线下距离匹配用）
    SHANGHAI_RESIDENCE_NOTE: '仅上海线下订单参与距离匹配（选至镇/街道即可，精确位置后续自行沟通）',
    LABEL_BUDGET: '预算区间（元/小时）',
    PLACEHOLDER_MIN: '最低',
    PLACEHOLDER_MAX: '最高',
    LABEL_EXPECTED_TIME: '期望开课时间',   // 结构化：文本输入 → 多条时间组件（周次+时段 JSON 落库）
    SLOT_ADD_LABEL: '新建时间段',
    SLOT_DOW_PLACEHOLDER: '选择星期',
    SLOT_TIME_START_GHOST: '开始时间',
    SLOT_TIME_END_GHOST: '结束时间',
    TIME_PICKER_ARIA: '选择整点时间',
    TIME_DEL_ARIA: '删除该时间段',
    VALIDATE_TIME_SLOT_INCOMPLETE: '请补全时间段（星期与起止时间），或删除不完整的时间段',
    VALIDATE_TIME_SLOT_RANGE: '时间段的结束时间需晚于开始时间',
    LABEL_SUBMITTER: '提交者身份',
    LABEL_PARENT_CONTACT: '家长联系方式',
    LABEL_STUDENT_CONTACT: '学生联系方式',
    LABEL_ADDITIONAL_INFO: '其他补充信息',
    DEMAND_DETAIL_GOAL: '学习目标', DEMAND_DETAIL_ARRANGE: '上课安排', DEMAND_DETAIL_STUDENT: '学生信息', DEMAND_DETAIL_EMPTY: '未填写',
    DEMAND_INFO_PLACEHOLDER: '上课时间偏好、特殊要求等',
    LABEL_RATING: '评分',
    LABEL_REVIEW_CONTENT: '评价内容',
    REVIEW_COMMENT_PLACEHOLDER: '请分享你的体验...',

    // 教师弹窗 / 意向 / 需求卡区块
    SECTION_SUBJECTS: '擅长科目',
    SECTION_REVIEWS: '评价',
    BTN_WRITE_REVIEW: '写评价',
    BTN_VIEW: '查看',
    BTN_AGREE: '同意',
    INTENTS_TITLE: '试课意向',
    MY_REVIEW_PREFIX: '你的评价：',
    ADDRESS_PREFIX: '地址：',
    ADDITIONAL_PREFIX: '补充：',

    // 管理员面板补充
    REGISTERED_AT_PREFIX: '注册于 ',
    DEMAND_COUNT_SUFFIX: ' 条需求',
    RATING_SCORE_SUFFIX: ' 分',

    // 通用错误 / 结果
    ERROR_REQUEST_FAILED: '请求失败',
    POST_DELETED: '帖子已删除',

    // 管理员面板
    ADMIN_TODO_TITLE: '待办事项',
    ADMIN_TODO_REVIEWS: '待审核评价',
    ADMIN_TODO_AWARDS: '待审核奖项',
    ADMIN_TODO_FEEDBACKS: '未处理反馈',
    ADMIN_TODO_COMPLAINTS: '未处理投诉',
    ADMIN_TOTAL_USERS: '总用户',
    ADMIN_STUDENTS: '学生',
    ADMIN_TEACHERS: '教师',
    ADMIN_DEMANDS: '需求数',
    ADMIN_PROFILES: '教师档案',
    ADMIN_REVIEWS_APPROVED: '已通过评价',
    ADMIN_REVIEWS_PENDING: '待审评价',
    ADMIN_INVITES_USED: '已用邀请码',
    ADMIN_RECENT_USERS: '最近注册用户',
    TRAFFIC_TITLE: '站点总流量',
    TRAFFIC_LATENCY_TITLE: '平均延迟',
    TRAFFIC_RANGE_24H: '24小时',
    TRAFFIC_RANGE_7D: '近7天',
    TRAFFIC_TOTAL_FMT: '合计 {n} 次',                       // A7 收口：流量统计格式
    TRAFFIC_SAMPLE_FMT: '样本 {n} 桶',
    TRAFFIC_MS_UNIT: ' ms',
    CHART_EMPTY: '暂无数据',                               // A7 收口：图表组件缺省文案
    CHART_DEFAULT_TITLE: '折线图',
    CHART_TABLE_LABEL: '数据明细',
    CHART_TIME_LABEL: '时间',
    TRAFFIC_RANGE_30D: '近30天',
    TRAFFIC_HINT: '口径：仅统计写操作与失败请求（读/轮询流量不入留档）；平均延迟 = 服务端处理耗时',
    ADMIN_RECENT_DEMANDS: '最近需求',
    BTN_APPROVE: '通过',
    BTN_REJECT: '拒绝',

    // 地区/赋分组件（app-region.js）
    REGION_HINT_FILL_MAIN: '在上方勾选擅长的主科后，在此填写成绩',
    REGION_HINT_FILL_ELECTIVE: '在上方勾选擅长的选考科目后，在此填写成绩',
    REGION_HINT_OFFLINE_ONLY: '目前只支持上海的线下教学',
    REGION_HINT_PICK_PROVINCE: '请先选择高考所在省份',
    REGION_HINT_PICK_GRADE: '请先选择年级，再选目标科目',
    REGION_HINT_NO_SUBJECTS: '该地区暂无可选科目',
    REGION_HINT_PICK_SUBJECTS: '请先选择目标科目',
    REGION_SCORE_PLACEHOLDER: '分数',
    REGION_GRADE_PLACEHOLDER: '请选择等第',
    REGION_FIRST_SUBJECT_LABEL: '首选科目',
    REGION_FIRST_TWO_HINT: '（二选一）',
    REGION_STANDARD_SCORE_NOTE: '标准分',
    // R2-12/H1 存量旧档成绩在当前政策下无匹配的警告（{n} 条数；{year} 毕业年份，空 = 未填）：
    // 防静默丢失——编辑器顶部横幅 + 保存拦截共用
    GAOKAO_POLICY_MISMATCH_WARN: '检测到 {n} 条成绩按往年政策填写，当前政策无法匹配。请填写「毕业年份」切换到当年政策，否则保存后这些成绩将被移除。',
    REGION_TRACK_SCIENCE: '理科',
    REGION_TRACK_ARTS: '文科',
    REGION_SH_ELECTIVE_MAX_NOTE: '上海选考满分 70',
    REGION_TAB_GRADE: '等第制',
    REGION_TAB_SCORE: '分数制',
  },
};


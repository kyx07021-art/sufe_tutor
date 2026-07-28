/**
 * 前端常量 — 业务数据 + UI 文字 + 系统通知模板
 * 挂 globalThis：浏览器经典脚本（window）与 worker ESM import 两用（同 region-data.js），
 * 服务端文案（婉拒通知等）亦统一在此维护，改文案只动这一个文件。
 * API 错误消息常量另见 server/core.js MSG 块。
 */
globalThis.APP_CONSTANTS = {

  // 教师注册邀请码门控：内测期间休眠（true = 免邀请码注册），与后端 core.js 的
  // INVITE_GATE_ENABLED 同步切换
  INVITE_GATE_DORMANT: true,

  // 版本号 x.y.z：x=0 内测 / 1 正式；y 每上线新模块/启用新功能 +1；z 每小修小补/审查去屎山推送 +1
  APP_VERSION: '0.10.0',

  // ============================================================
  // 业务数据
  // ============================================================
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

  ELECTIVE: ['physics','chemistry','biology','history','geography','politics'],

  GRADE_LEVELS: ['A+','A','B+','B','B-','C+','C','C-','D','E'],

  STUDENT_GRADES: [
    {id:'p1',name:'小学一年级'},{id:'p2',name:'小学二年级'},{id:'p3',name:'小学三年级'},
    {id:'p4',name:'小学四年级'},{id:'p5',name:'小学五年级'},
    {id:'junior1',name:'初一'},{id:'junior2',name:'初二'},{id:'junior3',name:'初三'},
    {id:'senior1',name:'高一'},{id:'senior2',name:'高二'},{id:'senior3',name:'高三'},
  ],

  TEACHER_GRADES: [
    {id:'freshman',name:'大一'},{id:'sophomore',name:'大二'},{id:'junior',name:'大三'},
    {id:'senior',name:'大四'},{id:'master',name:'硕士'},{id:'phd',name:'博士'},{id:'graduated',name:'已毕业'},
  ],

  GENDERS: [{id:'male',name:'男'},{id:'female',name:'女'},{id:'nonbinary',name:'非二元'}],
  SCORE_SCALES: [70, 100, 150],
  TEACHING_METHODS: [{id:'online',name:'线上'},{id:'offline',name:'线下'},{id:'both',name:'线上线下均可'}],
  BUDGET_OPTIONS: [50,80,100,120,150,180,200,250,300,400,500],

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
    BTN_GENERATE_INVITE: '生成邀请码',
    BTN_CANCEL: '取消',

    // 加载状态
    LOADING_LOGIN: '登录中...',
    LOADING_REGISTER: '注册中...',

    // 验证提示
    VALIDATE_PASSWORD_MISMATCH: '两次密码不一致',
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
    ERROR_LOAD_REVIEWS: '加载评价失败',
    ERROR_GENERATE_INVITE: '生成失败: ',

    // 空状态
    EMPTY_NO_TEACHERS: '暂无教师信息',
    EMPTY_NO_DEMANDS: '暂无学生需求',
    EMPTY_NO_MY_DEMANDS: '还没有需求，点击右上角「新建需求」发布第一条',
    EMPTY_NO_REVIEWS: '暂无评价',
    EMPTY_NO_USERS: '暂无用户',

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
    PAGE_ACCOUNT_SETTINGS: '账户设置',

    // 登录页用户名实时角色提示
    HINT_ROLE_STUDENT: '学生账户',
    HINT_ROLE_TEACHER: '教师账户',
    HINT_ROLE_ADMIN: '管理员账户',

    // 试课意向按钮四态
    INTENT_ACCEPTED: '已建立联系',
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
    EMPTY_NO_MY_DEMANDS_SHORT: '你还没有需求，先去「我的需求」发布一条吧。',
    BTN_SEND: '发送',
    VALIDATE_SELECT_DEMAND: '请先选择一条需求',
    PUSH_SENT_FALLBACK: '需求已发送',
    PUSH_TAG_ACTIVE: '主动发送',
    PUSH_NOTE_TEXT: '学生主动向你提交了需求',
    BTN_PUSH_REJECT: '暂时没空',
    BTN_PUSH_ACCEPT: '确认试课意向',
    PUSH_SECTION_TITLE: '学生主动发给你的需求',
    PUSH_ACCEPTED_TOAST: '已确认，可在「我的沟通」开始对话',
    PUSH_REJECTED_TOAST: '已谢绝',
    // 系统通知模板（拒绝等节点发给对方的通知；{subjects} 由服务端替换为科目名）
    NOTIFY_PUSH_REJECT: '关于「{subjects}」的家教需求，对方老师暂时无法承接。非常感谢你的信任，平台会继续为你留意更合适的老师。',
    NOTIFY_INTENT_REJECT: '关于「{subjects}」的家教需求，学生已选择了当前阶段更匹配的老师。感谢你付出的热情，期待下一次的双向奔赴。',
    NOTIFY_SUBJECTS_FALLBACK: '相关科目',
    // 以下通知/提示文案同样统一收口于此（服务端经 globalThis.APP_CONSTANTS.UI 读取，勿回 core.js）
    FEEDBACK_RESOLVED: '你提交的反馈已被关注并处理。感谢你帮助我们做得更好，如有其他问题欢迎随时反馈！',
    CONTRACT_DRAFT_SENT: '「{name}」发来一份合同草案，请前往「我的合同」查看并确认',
    CONTRACT_DRAFT_SENT_TOAST: '合同草案已发送，等待对方确认',
    CONTRACT_DRAFT_ACCEPTED: '「{name}」已确认合同草案，请前往「我的合同」完成你的签约确认',
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
    BROADCAST_SENT_TOAST: '通知已发送给全部用户',

    // 教师端浏览同行
    PAGE_BROWSE_TEACHERS_PEER_DESC: '查看同行的信息与评价',

    // 聊天窗合同状态灰字行 / 合同事件气泡
    CHAT_CONTRACT_PENDING_SENT: '合同草案已发送，等待对方确认',
    CHAT_CONTRACT_PENDING_RECEIVED: '对方发来一份合同草案，请前往「我的合同」查看并确认',
    CHAT_CONTRACT_SIGNING_TODO: '草案已通过，请前往「我的合同」确认签约',
    CHAT_CONTRACT_SIGNING_WAIT: '等待对方确认签约',
    CHAT_CONTRACT_SIGNED: '双方已完成签约',
    CHAT_BTN_DRAFT_CONTRACT: '起草合同',
    CHAT_PLUS_ARIA: '附件与合同',
    CHAT_PREVIEW_CONTRACT: '[合同草案]',
    CHAT_CONTRACT_BUBBLE_MINE: '你向对方发送了一份合同草案，可前往「我的合同」查看进度',
    CHAT_CONTRACT_BUBBLE_OTHER: '对方向你发送了一份合同草案，请前往「我的合同」查看并确认',

    // 我的合同
    PAGE_MY_CONTRACTS: '我的合同',
    PAGE_MY_CONTRACTS_DESC: '合同草案确认与正式签约',
    DRAFT_MODAL_TITLE: '起草合同',
    LABEL_CONTRACT_METHOD: '教学方式',
    LABEL_CONTRACT_PLAN: '教学方案',
    LABEL_CONTRACT_RATE: '约定时薪（元/小时）',
    CONTRACT_PLAN_PLACEHOLDER: '描述教学目标、内容安排与上课节奏，发送后将按此信息生成正式合同',
    VALIDATE_CONTRACT_PLAN: '请填写教学方案',
    VALIDATE_CONTRACT_RATE: '请填写约定时薪',
    CONTRACT_EMPTY: '合同内容不能为空',
    CONTRACT_PRICE_PLACEHOLDER: '如：150',
    ADMIN_CONTRACT_DRAFTER_PREFIX: '起草 ',
    LABEL_CONTRACT_SCHEDULE: '授课时间',
    CONTRACT_SCHEDULE_PLACEHOLDER: '自行描述，如：每周六 14:00-16:00，每次 2 小时',
    LABEL_CONTRACT_LOCATION: '授课地点',
    CONTRACT_LOCATION_PLACEHOLDER: '甲方常住处或双方另行约定的地点',
    CONTRACT_LOCATION_NOTE: '出于隐私保护，授课地点请使用「甲方常住处」等模糊表述，勿将详细地址上传至平台。',
    LABEL_CONTRACT_DEMAND: '对应需求',
    CONTRACT_NO_DEMAND_OPTION: '不关联需求',
    DEMAND_TAG_CONTRACTED: '已签约',
    DEMAND_PREFIX: '需求 ',
    BTN_VERIFY_LEDGER: '存证校验',
    CONTRACT_LEDGER_VALID: '存证校验通过：合同文本与签署指纹一致',
    CONTRACT_LEDGER_INVALID: '存证校验异常：文本与签署指纹不一致',
    CONTRACT_LEDGER_ARCHIVED: '该合同已撤销，签署时的存证留档仍保留',
    CONTRACT_LEDGER_NONE: '该合同暂无存证记录',

    // 撤销合同（仅签约后可用；入口刻意低调；两级确认；活跃库抹除、台账与留档保留）
    BTN_REVOKE_CONTRACT: '撤销合同',
    REVOKE_MODAL_TITLE: '撤销合同',
    REVOKE_CONTRACT_WARN: '此功能仅限在双方已经约定好结束合同时使用。撤销后，平台活跃数据库中的本合同全部信息将被抹除（签署时的存证台账与加密留档将作为不可篡改记录保留）。由此产生的一切法律后果由双方自行承担。',
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
    DEACTIVATED_USER_PREFIX: '已注销用户',
    CONTRACT_STATUS_PENDING: '草案待确认',
    CONTRACT_STATUS_SIGNING: '待签约',
    CONTRACT_STATUS_SIGNED: '已签约',
    CONTRACT_WAIT_DRAFT: '等待对方确认草案',
    BTN_SIGN: '确认签约',
    BTN_SIGN_WAITING: '等待对方确认签约',
    BTN_MODIFY_CONTRACT: '修改内容',
    BTN_VIEW_CONTRACT: '查看合同',
    BTN_CANCEL_CONTRACT: '取消签约',
    MODIFY_CONTRACT_TITLE: '修改合同内容',
    CONFIRM_SIGN: '确认签约后不可单方撤销（测试版以二次确认代替短信验证）。确定确认签约吗？',
    CONFIRM_CANCEL_CONTRACT: '取消后合同删除并通知对方（会话保留）。确定取消签约吗？',
    CONTRACT_EMPTY_LIST: '暂无合同——可在「我的沟通」的聊天窗内起草',
    CONTRACT_MODIFIED_TOAST: '修改已同步给对方，双方需重新确认签约',
    CONTRACT_CANCELLED_TOAST: '已取消签约',
    CONTRACT_SIGNED_TOAST: '签约完成',

    // 管理员：资料管理
    ADMIN_POSTS_EMPTY: '暂无帖子',

    // 管理员：合同管理（网页测试用途，真实场景仅管理员可见）
    PAGE_ADMIN_CONTRACTS: '合同管理',
    PAGE_ADMIN_CONTRACTS_DESC: '查看全部合同，测试用移除',
    ADMIN_CONTRACTS_EMPTY: '暂无合同',
    BTN_REMOVE_CONTRACT: '移除合同',
    CONFIRM_ADMIN_REMOVE_CONTRACT: '移除后合同彻底删除（操作留档保留）。确定移除该合同吗？',
    ADMIN_CONTRACT_REMOVED_TOAST: '合同已移除',

    // 关于我们（全角色，侧边栏末尾）
    PAGE_ABOUT: '关于我们',
    PAGE_ABOUT_DESC: '平台介绍与用户支持',
    ABOUT_FOOTNOTE: '网站初创，欢迎在「关于我们」-「{feedback}」中向我们提出优化建议。您说任何需求/设想，我们都尽力实现。',
    ABOUT_WHO_TITLE: '我们是谁',
    ABOUT_WHO_TEXT: '我们是一群来自上海财经大学的学生，创立了这个零佣金家教信息共享平台。教师零佣金入驻，学生免费发布需求，没有中间商赚差价，师生直接对接，让每一次教学匹配都透明、高效。',
    ABOUT_USAGE_TITLE: '平台基本用法',
    ABOUT_USAGE_1_TITLE: '学生：发布需求',
    ABOUT_USAGE_1_TEXT: '在「我的需求」填写省份、年级、科目与预算，需求会展示在教师的需求大厅，等候合适的教师接单。',
    ABOUT_USAGE_2_TITLE: '学生：挑选教师',
    ABOUT_USAGE_2_TEXT: '在「浏览教师」按性别、科目、报价筛选教师，查看详情与评价；看中的教师可以直接把需求发送给 TA。',
    ABOUT_USAGE_3_TITLE: '教师：浏览需求与接单',
    ABOUT_USAGE_3_TEXT: '教师在「需求大厅」查看学生需求，提交试课意向，或回应学生主动推送的需求；完善个人档案能获得更多曝光。',
    ABOUT_USAGE_4_TITLE: '沟通 · 签约 · 评价',
    ABOUT_USAGE_4_TEXT: '意向通过后双方在「我的沟通」聊天，可在聊天窗起草电子合同，双方确认后完成签约；签约完成后学生可对教师作出评价。',
    ABOUT_SUPPORT_TITLE: '用户支持',
    ABOUT_SUPPORT_OWNER: '平台负责人：康同学',
    ABOUT_SUPPORT_WECHAT: '微信：13524121020',
    ABOUT_SUPPORT_EMAIL: '邮箱：support_sufe_tutor@163.com',
    BTN_FEEDBACK: '用户反馈',
    BTN_FEEDBACK_BUG: '反馈 Bug',
    BTN_FEEDBACK_SUGGEST: '提出建议',
    FEEDBACK_MODAL_TITLE_BUG: '反馈 Bug',
    FEEDBACK_MODAL_TITLE_SUGGEST: '提出建议',
    FEEDBACK_TITLE_PLACEHOLDER: '一句话概括你的问题或建议',
    FEEDBACK_PLACEHOLDER: '详细描述你遇到的问题或建议（支持轻量 Markdown）',
    FEEDBACK_EMPTY: '反馈内容不能为空',
    FEEDBACK_SENT_TOAST: '反馈已提交，感谢你的声音',

    // 管理员：用户反馈
    PAGE_ADMIN_FEEDBACK: '用户反馈',
    PAGE_ADMIN_FEEDBACK_DESC: '查看并处理用户提交的 Bug 与建议',
    ADMIN_FEEDBACK_EMPTY: '暂无用户反馈',
    FEEDBACK_TAG_BUG: 'Bug',
    FEEDBACK_TAG_SUGGEST: '建议',
    FEEDBACK_STATUS_OPEN: '未处理',
    FEEDBACK_STATUS_RESOLVED: '已处理',
    BTN_MARK_RESOLVED: '标记已处理',
    FEEDBACK_RESOLVED_TOAST: '已标记处理并通知提出者',

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
    CONTACT_PLACEHOLDER: '手机号或邮箱',
    VALIDATE_SELECT_PROVINCE: '请选择省份',

    // 侧边栏页签标题
    PAGE_MY_DEMANDS: '我的需求',
    PAGE_BROWSE_TEACHERS: '浏览教师',
    PAGE_MY_CHATS: '我的沟通',
    PAGE_BROWSE_DEMANDS: '需求大厅',
    PAGE_RESOURCE_SHARE: '资料共享',
    PAGE_EDIT_PROFILE: '编辑自身信息',
    PAGE_ADMIN_STATS: '统计',
    PAGE_ADMIN_STUDENTS: '学生管理',
    PAGE_ADMIN_TEACHERS: '教师管理',
    PAGE_ADMIN_DEMANDS: '需求管理',
    PAGE_ADMIN_REVIEWS: '评价管理',
    PAGE_ADMIN_POSTS: '资料管理',

    // 侧边栏页签简介（选中时展开的灰字说明）
    PAGE_MY_DEMANDS_DESC: '发布与管理家教需求',
    PAGE_BROWSE_TEACHERS_DESC: '筛选教师，查看详情与评价',
    PAGE_MY_CHATS_DESC: '与匹配的师生在线沟通',
    PAGE_BROWSE_DEMANDS_DESC: '浏览学生需求并提交意向',
    PAGE_RESOURCE_SHARE_DESC: '与同行共享教学资源',
    PAGE_EDIT_PROFILE_DESC: '完善个人档案与高考成绩',
    PAGE_ADMIN_STATS_DESC: '平台运行数据总览',
    PAGE_ADMIN_STUDENTS_DESC: '学生账户与封禁管理',
    PAGE_ADMIN_TEACHERS_DESC: '教师账户与封禁管理',
    PAGE_ADMIN_DEMANDS_DESC: '全平台需求管理',
    PAGE_ADMIN_REVIEWS_DESC: '评价审核与删除',
    PAGE_ADMIN_POSTS_DESC: '管理教师共享的资料帖子',
    PAGE_NOTIFICATIONS_DESC: '意向与推送的处理进展',
    PAGE_ACCOUNT_SETTINGS_DESC: '账户信息与退出登录',

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
    INTENT_ACCEPTED_TOAST: '已同意，可在「我的沟通」中开始对话',
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

    // 用户状态标签
    TAG_BANNED: '已封禁',

    // 沟通（聊天）
    CHAT_TITLE: '会话',
    CHAT_EMPTY_NO_CONVS: '暂无沟通——同意教师试课意向后自动建立',
    CHAT_EMPTY_NO_MESSAGES: '还没有消息，先打个招呼吧',
    CHAT_PREVIEW_ME_PREFIX: '我：',
    CHAT_PREVIEW_IMAGE: '[图片]',
    CHAT_PREVIEW_FILE: '[文件]',
    CHAT_UNKNOWN_USER: '未知用户',
    CHAT_BACK_TO_LIST: '会话列表',
    CHAT_DEMAND_PREFIX: '需求 #',
    CHAT_CLOSED_TIP: '该会话已关闭，不能再发送消息',
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
    POST_LIKED_TOAST: '已点赞',
    POST_UNLIKED_TOAST: '已取消点赞',
    POST_MODAL_TITLE_CREATE: '发布帖子',
    POST_LABEL_TITLE: '标题',
    POST_TITLE_PLACEHOLDER: '一句话概括分享内容',
    POST_LABEL_BODY: '正文',
    POST_MD_BOLD: '加粗',
    POST_MD_IMAGE: '插入图片',
    POST_BODY_PLACEHOLDER: '支持轻量 Markdown：## 大标题、### 小标题、**加粗**、插入图片（图片以本地文件嵌入）',
    POST_PREVIEW_LABEL: '实时预览',
    POST_PREVIEW_EMPTY: '暂无内容，预览将随输入实时更新',
    POST_MD_BOLD_DEFAULT: '加粗文本',
    POST_IMAGE_ONLY: '请选择图片文件',
    POST_IMAGE_ALT: '图片',
    POST_IMG_BLOCKED: '[图片：链接未放行，不予渲染]',
    POST_TITLE_REQUIRED: '标题不能为空',
    POST_PUBLISHING: '发布中',
    POST_PUBLISHED: '发布成功',
    BTN_PUBLISH: '发布',
    POST_DELETE_TITLE: '删除帖子',
    POST_DELETE_CONFIRM: '删除后不可恢复，点赞数据一并清空。确认删除这篇帖子？',

    // 通知信息
    EMPTY_NO_NOTIFICATIONS: '暂无通知',

    // 账户设置
    SETTINGS_USERNAME: '账户用户名',
    SETTINGS_ROLE: '账户角色',
    SETTINGS_PHONE: '电话',
    SETTINGS_EMAIL: '邮箱',
    SETTINGS_UNBOUND: '未绑定',
    BTN_MODIFY: '修改',
    TOAST_COMING_SOON: '该功能暂未开放，敬请期待',
    BTN_LOGOUT: '退出登录',
    CONFIRM_LOGOUT: '确定要退出当前账户吗？',

    // 表单标签与占位符
    LABEL_PROVINCE: '省份',
    LABEL_STUDENT_GRADE: '学生年级',
    LABEL_STUDENT_GENDER: '学生性别',
    LABEL_TARGET_SUBJECTS: '目标科目',
    LABEL_MULTI_SUFFIX: '（可多选）',
    LABEL_CURRENT_SCORES: '各科当前大概成绩',
    LABEL_TEACHING_METHOD: '期望教学方式',
    LABEL_ADDRESS: '地址',
    ADDRESS_PLACEHOLDER: '如上海市xx区xx路（精确门牌号请后续自行与教师沟通）',
    LABEL_BUDGET: '预算区间（元/小时）',
    PLACEHOLDER_MIN: '最低',
    PLACEHOLDER_MAX: '最高',
    LABEL_SUBMITTER: '提交者身份',
    LABEL_PARENT_CONTACT: '家长联系方式',
    LABEL_STUDENT_CONTACT: '学生联系方式',
    LABEL_ADDITIONAL_INFO: '其他补充信息',
    DEMAND_INFO_PLACEHOLDER: '上课时间偏好、特殊要求等',
    LABEL_RATING: '评分',
    LABEL_REVIEW_CONTENT: '评价内容',
    REVIEW_COMMENT_PLACEHOLDER: '请分享你的体验...',

    // 教师弹窗 / 意向 / 需求卡区块
    SECTION_SUBJECTS: '擅长科目',
    SECTION_CONTACT: '联系方式',
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
    ADMIN_TOTAL_USERS: '总用户',
    ADMIN_STUDENTS: '学生',
    ADMIN_TEACHERS: '教师',
    ADMIN_DEMANDS: '需求数',
    ADMIN_PROFILES: '教师档案',
    ADMIN_REVIEWS_APPROVED: '已通过评价',
    ADMIN_REVIEWS_PENDING: '待审评价',
    ADMIN_INVITES_USED: '已用邀请码',
    ADMIN_RECENT_USERS: '最近注册用户',
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
    REGION_TRACK_SCIENCE: '理科',
    REGION_TRACK_ARTS: '文科',
    REGION_SH_ELECTIVE_MAX_NOTE: '上海选考满分 70',
    REGION_TAB_GRADE: '等第制',
    REGION_TAB_SCORE: '分数制',
  },
};

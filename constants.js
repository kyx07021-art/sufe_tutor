/**
 * 前端常量 — 业务数据 + UI 文字 + 系统通知模板
 * 挂 globalThis：浏览器经典脚本（window）与 worker ESM import 两用（同 region-data.js），
 * 服务端文案（婉拒通知等）亦统一在此维护，改文案只动这一个文件。
 * API 错误消息常量另见 server/core.js MSG 块。
 */
globalThis.APP_CONSTANTS = {

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
    BTN_BACK: '← 返回',

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
    EMPTY_NO_PENDING_REVIEWS: '暂无待审核评价',

    // 邀请码
    INVITE_EXPIRED: '已过期',
    INVITE_EXPIRES_SUFFIX: ' 后过期',

    // 教师卡片 / 列表
    PRICE_UNIT: '元/h',
    BTN_VIEW_DETAIL: '查看详情 / 评价',
    LABEL_SELECT_HINT: '请先选择擅长科目',
    SCORE_LABEL: '满分：',
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
    // 系统通知模板（拒绝等节点发给对方的委婉通知；{subjects} 由服务端替换为科目名）
    NOTIFY_PUSH_REJECT: '关于「{subjects}」的家教需求，对方老师近期时间较难排开，暂时无法承接。非常感谢你的信任，平台会继续为你留意更合适的老师。',
    NOTIFY_INTENT_REJECT: '关于「{subjects}」的家教需求，学生已选择了当前阶段更匹配的老师。感谢你付出的热情，期待下一次的双向奔赴。',
    NOTIFY_SUBJECTS_FALLBACK: '相关科目',

    // 管理员：系统通知广播（编辑器复用发帖组件）
    BTN_SEND_NOTIFICATION: '发通知',
    BROADCAST_MODAL_TITLE: '发送系统通知',
    BROADCAST_BODY_PLACEHOLDER: '输入通知内容，全部用户都会收到（支持轻量 Markdown）',
    VALIDATE_BROADCAST_EMPTY: '通知内容不能为空',
    BROADCAST_SENT_TOAST: '通知已发送给全部用户',

    // 管理员：资料管理
    ADMIN_POSTS_EMPTY: '暂无帖子',

    // 教师地址（选填，合规红线：不收详细门牌号）
    TEACHER_ADDRESS_PLACEHOLDER: '上海市xx区xx路（无需详细门牌号）',

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
    CONTACT_PARENT_PREFIX: '家长: ',
    CONTACT_STUDENT_PREFIX: '学生: ',

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
    CHAT_INPUT_PLACEHOLDER: '输入消息，Enter 发送，Shift+Enter 换行',
    CHAT_BTN_SEND: '发送',
    CHAT_PLACEHOLDER_TITLE: '选择左侧会话，开始沟通',
    CHAT_PLACEHOLDER_SUB: '同意试课意向后自动建立会话，消息每 4 秒自动刷新',
    CHAT_TODO_TOAST: '该功能即将开放，敬请期待',

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
    POST_TITLE_PLACEHOLDER: '一句话概括分享内容（不超过 60 字）',
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
    ADMIN_PENDING_REVIEWS_TITLE: '待审核评价',
    ADMIN_RECENT_USERS: '最近注册用户',
    ADMIN_RECENT_DEMANDS: '最近需求',
    BTN_APPROVE: '通过',
    BTN_REJECT: '拒绝',
  },
};

/**
 * 前端常量 — 业务数据 + UI 文字
 * 与 _worker.js 顶部常量块保持同步
 */
window.APP_CONSTANTS = {

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

  GENDERS: [{id:'male',name:'男'},{id:'female',name:'女'}],
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
    NAV_LOGOUT: '退出',
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

    // 成功提示
    SUCCESS_INVITE_CONFIRMED: '邀请码已确认，请填写注册信息',
    SUCCESS_DEMAND_SUBMITTED: '需求已提交！',
    SUCCESS_DEMAND_UPDATED: '需求已更新！',
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
    EMPTY_NO_PENDING_REVIEWS: '暂无待审核评价',

    // 邀请码
    INVITE_EXPIRED: '已过期',
    INVITE_EXPIRES_SUFFIX: ' 后过期',

    // 教师卡片 / 列表
    PRICE_UNIT: '元/h',
    CONTACT_WECHAT_PREFIX: '微信: ',
    CONTACT_EMAIL_PREFIX: '邮箱: ',
    BTN_VIEW_DETAIL: '查看详情 / 评价',
    LABEL_SELECT_HINT: '请先选择擅长科目',
    GAOKAO_MAIN: '主科成绩',
    GAOKAO_ELECTIVE: '选考科目等第',
    GAOKAO_NO_MAIN: '未选择主科',
    SCORE_LABEL: '满分：',
    SCORE_SCALE_SUFFIX: '分制',

    // 需求列表
    SUBMITTER_PARENT: '家长',
    SUBMITTER_STUDENT: '学生',
    SUBMITTER_PREFIX: '提交者: ',
    BUDGET_NEGOTIABLE: '面议',
    BUDGET_NO_LIMIT: '不限',
    BUDGET_UNIT_SUFFIX: '元/h',

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

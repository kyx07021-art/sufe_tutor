/**
 * m-teacher-square.js - M7 A1 teacher-square module copy single source
 * -------------------------------------------------------
 * - All user-visible copy for the teacher-square module lives here; component
 *   templates reference TEXT.KEY and contain zero raw Chinese strings (contract 6).
 * - Collected into constants/ui.js (see ui.js re-export).
 * - Sub-agents: import from '@/constants/m-teacher-square.js'; if a needed key is
 *   missing, leave a `// NEED-COPY: <key>` comment in your file and the module lead
 *   adds it here at assembly time.
 */

export const TEACHER_SQUARE_TEXT = {
  // ---- page (pages.js / M2 tab) ----
  PAGE_TITLE: '教师广场',

  // ---- second top bar (M7-04/05) ----
  SORT_MATCH: '匹配度',
  SORT_RATING: '评分',
  SORT_EXP: '经验',
  SORT_PRICE: '报价',
  SORT_ASC: '升序',
  SORT_DESC: '降序',
  SORT_ARIA: '排序方式',
  FILTER: '筛选',
  FILTER_ARIA: '展开筛选',

  // ---- status (M7-01) ----
  LOADING: '加载中…',
  EMPTY: '暂无教师',
  LOAD_FAIL: '加载失败，请稍后重试',
  RETRY: '重试',

  // ---- list / card meta (M7-01/17) ----
  PRICE_SUFFIX: '元/h',
  PRICE_RANGE: (min, max) => `${min}~${max}元/h`,
  PRICE_FROM: (n) => `${n}元/h起`,
  PRICE_TO: (n) => `${n}元/h以下`,
  PRICE_NA: '报价未提供',
  MATCH_SCORE_LABEL: '匹配度',
  MATCH_COUNT: (n) => `命中 ${n} 项`,
  EXPERIENCE: (n) => `经验 ${n} 年`,
  RATING_COUNT: (n) => `(${n})`,
  REVIEW_COUNT: (n) => `${n} 人评分`,

  // ---- third top bar filters (M7-07..11) ----
  // Subject / personality option pools (data single source for the filter cards;
  // kept here so component templates stay CJK-free, contract 6).
  SUBJECT_OPTIONS: [
    '数学', '物理', '化学', '生物', '语文', '英语', '历史', '地理', '政治',
    '钢琴', '绘画', '编程', '围棋', '书法', '舞蹈', '声乐',
  ],
  PERSONALITY_OPTIONS: ['耐心', '幽默', '负责', '严格', '热情', '温柔'],
  FILTER_TITLE_SUBJECT: '擅长科目',
  FILTER_TITLE_GENDER: '教师性别',
  FILTER_TITLE_PERSONALITY: '教师性格',
  FILTER_TITLE_PRICE: '报价区间',
  FILTER_ALL_SUBJECT: '不限科目',
  FILTER_ALL_GENDER: '不限性别',
  FILTER_ALL_PERSONALITY: '不限性格',
  GENDER_MALE: '男',
  GENDER_FEMALE: '女',
  GENDER_ANY: '不限',
  FILTER_JOIN: '、',
  PRICE_MIN_PLACEHOLDER: '最低价（元/时）',
  PRICE_MAX_PLACEHOLDER: '最高价（元/时）',
  PRICE_TILDE: '~',

  // ---- detail modal (M7-18..22) ----
  FIRST_MESSAGE: '你好，我想了解一下你的授课安排。',
  PROFILE_TITLE: '简介',
  ID_PREFIX: 'ID',
  NO_TOP_REVIEW: '暂无精选评价',
  REVIEW_SIGN: '—— ',
  SEND_MESSAGE: '发消息',
  DETAIL_PRICE: '报价',
  DETAIL_ADDRESS: '地址',
  DETAIL_TIME: '可用时间',
  DETAIL_ADDRESS_NA: '未填写',
  DETAIL_TIME_NA: '未填写',
  DETAIL_TIME_DAYS: ['周一', '周二', '周三', '周四', '周五', '周六', '周日'],
  DETAIL_TIME_JOIN: '、',
}

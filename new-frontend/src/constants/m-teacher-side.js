/**
 * m-teacher-side.js - M9 teacher-side module copy single source
 * --------------------------------------------------------------
 * - All user-visible Chinese copy for B1 (demand plaza) / B2 (my info) / B3 (resource plaza).
 * - Re-exported through constants/ui.js (the base-layer aggregate); module components
 *   import from '@/constants/ui.js' (single entry).
 * - Zero raw Chinese inside Vue templates / scripts / comments (contract 6).
 */

export const TEACHER_COPY = {
  /** B1 需求广场 */
  B1_TITLE: '需求广场',
  B1_SORT_MATCH: '匹配度',
  B1_SORT_PRICE: '报价',
  B1_FILTER_BTN: '筛选',
  B1_FILTER_RESET: '重置筛选',
  B1_FILTER_SUBJECT: '需求科目',
  B1_FILTER_GENDER: '偏好性别',
  B1_GENDER_MALE: '男生',
  B1_GENDER_FEMALE: '女生',
  B1_GENDER_ANY: '不限',
  B1_PRICE_MIN: '最低价',
  B1_PRICE_MAX: '最高价',
  B1_EMPTY: '暂无匹配的需求',
  B1_ERROR: '需求加载失败，请重试',
  B1_LOADING: '正在加载需求…',
  B1_MATCH_SCORE: (s) => `匹配度 ${s}`,
  B1_MATCH_COUNT: (n) => `命中 ${n}`,
  B1_SESSION_CAP: '会话功能建设中',
  /** B2 我的信息 */
  B2_TITLE: '我的信息',
  B2_VERIFY_NONE: '请先完成学信网核验以开启接单资格。',
  B2_VERIFY_NONE_ALT: '也可使用录取通知书进行核验。',
  B2_VERIFY_PENDING: '核验审核中，请耐心等待。',
  B2_VERIFY_APPROVED: '已通过学信网核验。',
  B2_VERIFY_REJECTED: '核验未通过，可修改后重新提交。',
  B2_CHSI_LABEL: '学信网在线验证码',
  B2_CHSI_PLACEHOLDER: '请输入学信网在线验证码',
  B2_CHSI_SUBMIT: '提交核验',
  B2_CHSI_FORMAT_ERR: '验证码需为 12-16 位字母或数字',
  B2_ADMISSION_LABEL: '录取通知书',
  B2_ADMISSION_ALT: '下划线小灰字修改验证录取通知书',
  B2_ADMISSION_TYPE_ERR: '仅支持 JPEG / PNG / WebP 图片',
  B2_SAVE: '保存',
  B2_SAVED: '保存成功',
  B2_AVATAR_CONFIRM: '是否上传新头像？',
  B2_AVATAR_UPLOAD: '上传头像',
  B2_AVATAR_TYPE_ERR: '仅支持 JPEG / PNG / WebP 图片',
  B2_FIELD_TEACHER_NAME: '教师名',
  B2_FIELD_BIO: '简介',
  B2_FIELD_PRICE: '报价区间',
  B2_FIELD_AREA: '地址',
  B2_FIELD_TIME: '可用时间',
  B2_FIELD_EXP: '经验',
  B2_FIELD_PERSONALITY: '性格',
  B2_FIELD_GENDER: '性别',
  B2_FIELD_GRADUATION: '毕业院校',
  B2_FIELD_SUBJECTS: '科目与成绩',
  B2_FIELD_AWARDS: '奖项',
  B2_FIELD_PHILOSOPHY: '教学理念',
  B2_ADD_SUBJECT: '新增科目',
  B2_REMOVE_ROW: '移除该科目',
  B2_REQUIRED_ERR: '请完整填写必填项',
  B2_PLACEHOLDER_SUBJECT: '科目',
  B2_PLACEHOLDER_SCORE: '分数',
  B2_PLACEHOLDER_FULL: '满分',
  B2_FIELD_EXP_UNIT: '年',
  /** B3 资料广场 */
  B3_TITLE: '资料广场',
  B3_PLACEHOLDER: '资料广场建设中',
}

/** Demand subject options (mirrors backend SUBJECTS enum; pending shared enums when S3/S4 lands). */
export const SUBJECT_OPTIONS = [
  '语文',
  '数学',
  '英语',
  '物理',
  '化学',
  '生物',
  '政治',
  '历史',
  '地理',
  '科学',
]

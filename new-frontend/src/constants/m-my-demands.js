/**
 * m-my-demands.js - A2 my-demands module copy + display mapping single source
 * -------------------------------------------------------
 * - All user-visible copy and the data->text mappings used by this module live here;
 *   component templates contain zero raw Chinese strings (contract 6). Comments are English.
 * - Consolidated into ui.js: the site-wide constants entry will re-export this file at integration.
 * - DemandCard is the M9 B1 domain renderer; this file is also consumed by M9
 *   (CTA copy / teaching-method label).
 */

export const MY_DEMANDS_COPY = {
  /** Module/tab label (A2) */
  PAGE_TITLE: '我的需求',
  /** Loading placeholder */
  LOADING: '正在加载需求…',
  /** List load failure fallback */
  LOAD_FAILED: '需求加载失败，请稍后重试',
  /** Card CTA - student mode (own list) */
  CTA_EDIT: '编辑需求',
  /** Card CTA - teacher mode (demand plaza, M9 consumes) */
  CTA_CONTACT: '去联系试课',
  /** Upper-right info area labels */
  INFO_PROVINCE: '省份',
  INFO_ADDRESS: '地址',
  INFO_TIME: '时间',
  INFO_PERSONALITY: '偏好',
  INFO_GENDER: '性别',
  /** Create / edit modal titles (M8-06) */
  CREATE_TITLE: '创建需求',
  EDIT_TITLE: '编辑需求',
  /** Step modal page titles (M8-06..11) */
  STEP_GRADE_PROVINCE: '一、年级与省份',
  STEP_SUBJECT_METHOD: '二、科目与方式',
  STEP_SCORE: '三、当前成绩',
  STEP_ADDRESS_TIME: '四、地址与时间',
  STEP_PREFERENCES: '五、偏好与简介',
  /** Step modal submit labels */
  SUBMIT_CREATE: '提交',
  SUBMIT_EDIT: '保存',
  /** Field titles (M8-07..11) */
  FIELD_GRADE: '年级',
  FIELD_PROVINCE: '省份',
  FIELD_SUBJECT: '科目',
  FIELD_METHOD: '授课方式',
  FIELD_SCORE: '当前成绩',
  FIELD_SCORE_FULL: '满分',
  FIELD_ADDRESS: '地址区域',
  FIELD_TIME: '上课时间',
  FIELD_PERSONALITY: '偏好性格',
  FIELD_GENDER: '偏好性别',
  FIELD_BUDGET_MIN: '最低预算（元/时）',
  FIELD_BUDGET_MAX: '最高预算（元/时）',
  FIELD_INTRO: '需求简介',
  /** Placeholders */
  PH_GRADE: '请选择年级',
  PH_PROVINCE: '请选择省份',
  PH_SUBJECT: '请选择科目',
  PH_METHOD: '请选择授课方式',
  PH_SCORE: '输入分数',
  PH_FULL: '满分',
  PH_ADDRESS: '填写区/镇/街道',
  PH_BUDGET: '输入预算',
  PH_INTRO: '简要描述你的需求（≤200字）',
  /** Method option labels (teachingMethod) */
  METHOD_ONLINE: '线上',
  METHOD_OFFLINE: '线下',
  METHOD_BOTH: '线上线下均可',
  /** Gender option labels */
  GENDER_MALE: '男',
  GENDER_FEMALE: '女',
  /** Score entry mode tabs (M8-09) */
  SCORE_RAW: '原始分',
  SCORE_BAND: '等第',
  /** Band labels (M8-09) */
  BAND_A: 'A（优秀）',
  BAND_B: 'B（良好）',
  BAND_C: 'C（合格）',
  BAND_D: 'D（待提高）',
  BAND_E: 'E（未合格）',
  /** Time slot editor (M8-10b) */
  TS_DAY: '星期',
  TS_START: '开始',
  TS_END: '结束',
  TS_ADD: '新增时间段',
  TS_REMOVE: '移除该时间段',
  /** Prefix of a displayed time-slot line, e.g. "每周三 18:00-20:00" */
  TIME_SLOT_PREFIX: '每周',
  /** Separator between multiple displayed time slots */
  TIME_JOIN: '；',
  /** Delete entry label + confirm message (M8-14) */
  DELETE_ACTION: '删除需求',
  DELETE_CONFIRM: '确认删除这条需求吗？',
  DELETE_DONE: '已删除',
  /** Write-path failure fallbacks (surfaced when the server returns no message) */
  DELETE_FAILED: '删除失败，请稍后重试',
  SUBMIT_FAILED: '提交失败，请稍后重试',
  LOAD_DETAIL_FAILED: '需求加载失败，请稍后重试',
  /** Weekday labels for the time-slot editor (M8-10b) */
  DAY_LABELS: ['周一', '周二', '周三', '周四', '周五', '周六', '周日'],
  /** Dev preview harness headings (MyDemandsPreview.vue, dev-only, not production copy) */
  PREVIEW_TITLE: 'M8 · A2 我的需求',
  PREVIEW_SUBTITLE: '学生模式（真实 I-33 链路）+ 教师模式卡片（M9 B1 复用 shape）',
  PREVIEW_STUDENT_SECTION: '学生模式 · 我的需求网格',
  PREVIEW_TEACHER_SECTION: '教师模式 · DemandCard（M9 B1 消费）',
}

/** Score-line display templates (A2.1 card, upper-left score line) */
export const DEMAND_SCORE_TEMPLATE = {
  /** "130分/150满分" */
  full: (score, full) => `${score}分/${full}满分`,
  /** "92分" (when full is missing) */
  only: (score) => `${score}分`,
}

/** teaching_method -> display label (single source; also consumed by M9 teacher plaza) */
export const DEMAND_METHOD_LABEL = {
  online: '线上',
  offline: '线下',
  both: '线上线下均可',
}

/** preferredGender -> display label (fallback = raw value) */
export const DEMAND_GENDER_LABEL = {
  male: '男',
  female: '女',
}

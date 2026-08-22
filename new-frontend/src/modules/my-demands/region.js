/**
 * region.js - demand-domain region/enum policy (M8 module-local, provisional single source)
 * -------------------------------------------------------
 * - Values mirror the backend contract (src/shared/enums.js STUDENT_GRADES / SUBJECTS /
 *   NONACADEMIC_PROJECTS / PERSONALITY_TAGS / WEEKDAYS + src/shared/config.js
 *   PERSONALITY_TAGS_MAX) so submissions pass the S3 backend whitelists.
 * - Note: v2 SUFE_REGIONS lives in the legacy repo shared layer; this new frontend is
 *   self-contained. When the S3 region contract lands, this file should become a re-export
 *   of the new shared layer - do not maintain two copies.
 * - Key: offline teaching is permitted only for Shanghai (offlineAllowed); all other
 *   provinces default to online-only (M8-08 forces online).
 */

/** 31 province options (value = pinyin id, label = display name; submitted/stored by value) */
export const PROVINCES = [
  { value: 'beijing', label: '北京' }, { value: 'tianjin', label: '天津' }, { value: 'hebei', label: '河北' },
  { value: 'shanxi', label: '山西' }, { value: 'neimenggu', label: '内蒙古' }, { value: 'liaoning', label: '辽宁' },
  { value: 'jilin', label: '吉林' }, { value: 'heilongjiang', label: '黑龙江' }, { value: 'shanghai', label: '上海' },
  { value: 'jiangsu', label: '江苏' }, { value: 'zhejiang', label: '浙江' }, { value: 'anhui', label: '安徽' },
  { value: 'fujian', label: '福建' }, { value: 'jiangxi', label: '江西' }, { value: 'shandong', label: '山东' },
  { value: 'henan', label: '河南' }, { value: 'hubei', label: '湖北' }, { value: 'hunan', label: '湖南' },
  { value: 'guangdong', label: '广东' }, { value: 'guangxi', label: '广西' }, { value: 'hainan', label: '海南' },
  { value: 'chongqing', label: '重庆' }, { value: 'sichuan', label: '四川' }, { value: 'guizhou', label: '贵州' },
  { value: 'yunnan', label: '云南' }, { value: 'xizang', label: '西藏' }, { value: 'shaanxi', label: '陕西' },
  { value: 'gansu', label: '甘肃' }, { value: 'qinghai', label: '青海' }, { value: 'ningxia', label: '宁夏' },
  { value: 'xinjiang', label: '新疆' },
]

/** Province -> policy (missing = 3+1+2 default; offlineAllowed defaults to false = online-only). */
export const PROVINCE_POLICY = {
  shanghai: { policy: '3+3', gradeSystem: 'shanghai', offlineAllowed: true },
  zhejiang: { policy: '3+3', gradeSystem: 'zhejiang20', extraElective: 'technology' },
  beijing: { policy: '3+3', gradeSystem: 'beijing' },
  tianjin: { policy: '3+3', gradeSystem: 'beijing' },
  shandong: { policy: '3+3', gradeSystem: 'shandong' },
  hainan: { policy: '3+3', gradeSystem: 'hainan' },
  xinjiang: { policy: 'old', gradeSystem: null },
  xizang: { policy: 'old', gradeSystem: null },
}

export const DEFAULT_POLICY = { policy: '3+1+2', gradeSystem: 'standard5' }

export function provinceLabel(value) {
  const p = PROVINCES.find((x) => x.value === value)
  return p ? p.label : (value || '')
}

/** Backend grade id -> display label (prep replaces p6 for Shanghai; unknown id falls back raw). */
export function gradeLabel(id) {
  if (PREP_GRADE && PREP_GRADE.value === id) return PREP_GRADE.label
  const g = GRADES.find((x) => x.value === id)
  return g ? g.label : (id || '')
}

/** Backend personality-tag id -> display label (unknown id falls back raw). */
export function tagLabel(id) {
  const t = PERSONALITY_TAGS.find((x) => x.value === id)
  return t ? t.label : (id || '')
}

/** Whether offline teaching is permitted (default online-only; data-driven, M8-08 forces online). */
export function allowsOffline(province) {
  const c = PROVINCE_POLICY[province]
  return !!(c && c.offlineAllowed)
}

/** Province -> merged policy (defaults to DEFAULT_POLICY). */
export function regionPolicy(province) {
  return { ...DEFAULT_POLICY, ...(PROVINCE_POLICY[province] || {}) }
}

/** Prep grade - Shanghai 5-4 system only (prep replaces primary-6 in Shanghai). */
export const PREP_GRADE = { value: 'prep', label: '预备班' }

/** Grade options aligned to backend STUDENT_GRADES ids (p1..p6 / junior1..3 / senior1..3). */
export const GRADES = [
  ...[['一', 1], ['二', 2], ['三', 3], ['四', 4], ['五', 5], ['六', 6]].map(([n, i]) => ({ value: `p${i}`, label: `小学${n}年级` })),
  ...[['一', 1], ['二', 2], ['三', 3]].map(([n, i]) => ({ value: `junior${i}`, label: `初${n}` })),
  ...[['一', 1], ['二', 2], ['三', 3]].map(([n, i]) => ({ value: `senior${i}`, label: `高${n}` })),
]

/** Subject options aligned to backend SUBJECTS + NONACADEMIC_PROJECTS ids (single-subject model, M8-08). */
export const SUBJECTS = [
  { value: 'chinese', label: '语文' },
  { value: 'math', label: '数学' },
  { value: 'english', label: '英语' },
  { value: 'physics', label: '物理' },
  { value: 'chemistry', label: '化学' },
  { value: 'biology', label: '生物' },
  { value: 'history', label: '历史' },
  { value: 'geography', label: '地理' },
  { value: 'politics', label: '政治' },
  { value: 'music', label: '乐器/音乐' },
  { value: 'vocal', label: '声乐' },
  { value: 'painting', label: '绘画' },
  { value: 'dance', label: '舞蹈' },
  { value: 'calligraphy', label: '书法' },
  { value: 'chess', label: '棋类' },
  { value: 'code', label: '编程/机器人' },
  { value: 'sports', label: '体育/运动' },
  { value: 'speech', label: '演讲主持' },
  { value: 'language', label: '语言口语' },
]

/** Main-subject default full scores (M8-09 raw mode; unlisted subjects default to 100). */
export const SUBJECT_FULL_SCORE = {
  chinese: 150,
  math: 150,
  english: 150,
}

/** Personality tag options aligned to backend PERSONALITY_TAGS ids (M8-10c). */
export const PERSONALITY_TAGS = [
  { value: 'patience', label: '耐心' },
  { value: 'strict', label: '严格' },
  { value: 'humorous', label: '幽默' },
  { value: 'gentle', label: '温柔' },
  { value: 'logical', label: '逻辑清晰' },
  { value: 'friendly', label: '亲和力强' },
  { value: 'responsible', label: '认真负责' },
  { value: 'methodical', label: '有方法' },
  { value: 'spoken', label: '口语标准' },
  { value: 'motivating', label: '善于鼓励' },
]

/** Personality-tag clamp upper bound (aligned to backend config PERSONALITY_TAGS_MAX=3). */
export const PERSONALITY_TAGS_MAX = 3

/** Band -> assigned score (M8-09 band mode; standard5 national five-level approximation). */
export const BAND_SCORES = {
  A: 97,
  B: 88,
  C: 79,
  D: 70,
  E: 60,
}

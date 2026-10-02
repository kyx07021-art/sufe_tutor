export { PROVINCES, DISTRICTS, TOWN_COORDS } from "./region-data.js";
export const PRODUCT = {
  name: "经途·伴学",
  title: "经途·伴学信息门户",
  origin: "https://sufe-tutor.pages.dev",
  version: "2.0.0",
};
export const ROLE = { STUDENT: "student", TEACHER: "teacher", ADMIN: "admin" };
export const INITIAL_RATING = 4.5;
export const INITIAL_WEIGHT = 10;
export const LIMIT = {
  usernameMin: 3,
  usernameMax: 30,
  passwordMin: 6,
  messageMax: 2000,
  postTitleMax: 60,
  postBodyMax: 20000,
  feedbackMax: 5000,
  complaintMax: 2000,
  fileMaxBytes: 700000,
  avatarMaxBytes: 20000,
  timeSlotsMax: 8,
  greetingMax: 300,
};
export const MATCH_WEIGHT = {
  subject: 35,
  region: 25,
  budget: 20,
  method: 10,
  personality: 5,
  gender: 5,
};
export const SUBJECTS = [
  ["technology", "技术"],
  ["science_comprehensive", "理科综合"],
  ["arts_comprehensive", "文科综合"],
  ["chinese", "语文"],
  ["math", "数学"],
  ["english", "英语"],
  ["physics", "物理"],
  ["chemistry", "化学"],
  ["biology", "生物"],
  ["history", "历史"],
  ["geography", "地理"],
  ["politics", "政治"],
];
export const PROJECTS = [
  ["music", "乐器/音乐"],
  ["vocal", "声乐"],
  ["painting", "绘画"],
  ["dance", "舞蹈"],
  ["calligraphy", "书法"],
  ["chess", "棋类"],
  ["code", "编程/机器人"],
  ["sports", "体育/运动"],
  ["speech", "演讲主持"],
  ["language", "语言口语"],
];
export const STUDENT_GRADES = [
  ["p1", "小一"],
  ["p2", "小二"],
  ["p3", "小三"],
  ["p4", "小四"],
  ["p5", "小五"],
  ["p6", "小六"],
  ["prep", "预备班"],
  ["junior1", "初一"],
  ["junior2", "初二"],
  ["junior3", "初三"],
  ["senior1", "高一"],
  ["senior2", "高二"],
  ["senior3", "高三"],
];
export const TEACHER_GRADES = [
  ["freshman", "大一"],
  ["sophomore", "大二"],
  ["junior", "大三"],
  ["senior", "大四"],
  ["master", "硕士"],
  ["phd", "博士"],
  ["graduated_bachelor", "本科毕业"],
  ["graduated_master", "硕士毕业"],
  ["graduated_phd", "博士毕业"],
];
export const GENDERS = [
  ["undeclared", "不愿透露"],
  ["male", "男"],
  ["female", "女"],
];
export const METHODS = [
  ["online", "线上"],
  ["offline", "线下"],
  ["both", "均可"],
];
export const TAGS = [
  ["patience", "耐心"],
  ["strict", "严格"],
  ["humorous", "幽默"],
  ["gentle", "温柔"],
  ["logical", "逻辑清晰"],
  ["friendly", "亲和力强"],
  ["responsible", "认真负责"],
  ["methodical", "有方法"],
  ["spoken", "口语标准"],
  ["motivating", "善于鼓励"],
];
export const WEEKDAYS = [
  [1, "星期一"],
  [2, "星期二"],
  [3, "星期三"],
  [4, "星期四"],
  [5, "星期五"],
  [6, "星期六"],
  [7, "星期日"],
];
export const label = (list, id) =>
  list.find((x) => String(x[0]) === String(id))?.[1] || id || "未填写";

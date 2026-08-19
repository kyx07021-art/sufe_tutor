/** 业务枚举唯一源（V-1-1）。零依赖，纯数据。 */
export const STATUS = {
  "OPEN": "open",
  "CONTRACTED": "contracted",
  "REVOKED": "revoked",
  "PENDING": "pending",
  "ACCEPTED": "accepted",
  "REJECTED": "rejected",
  "SIGNING": "signing",
  "SIGNED": "signed",
  "APPROVED": "approved",
  "ACTIVE": "active",
  "CLOSED": "closed",
  "RESOLVED": "resolved"
};
export const SUBJECTS = [
  {
    "id": "chinese",
    "name": "语文",
    "maxScore": 150
  },
  {
    "id": "math",
    "name": "数学",
    "maxScore": 150
  },
  {
    "id": "english",
    "name": "英语",
    "maxScore": 150
  },
  {
    "id": "physics",
    "name": "物理",
    "maxScore": 100
  },
  {
    "id": "chemistry",
    "name": "化学",
    "maxScore": 100
  },
  {
    "id": "biology",
    "name": "生物",
    "maxScore": 100
  },
  {
    "id": "history",
    "name": "历史",
    "maxScore": 100
  },
  {
    "id": "geography",
    "name": "地理",
    "maxScore": 100
  },
  {
    "id": "politics",
    "name": "政治",
    "maxScore": 100
  }
];
export const STUDENT_GRADES = [
  {
    "id": "p1",
    "name": "小学一年级"
  },
  {
    "id": "p2",
    "name": "小学二年级"
  },
  {
    "id": "p3",
    "name": "小学三年级"
  },
  {
    "id": "p4",
    "name": "小学四年级"
  },
  {
    "id": "p5",
    "name": "小学五年级"
  },
  {
    "id": "p6",
    "name": "小学六年级"
  },
  {
    "id": "prep",
    "name": "预备班"
  },
  {
    "id": "junior1",
    "name": "初一"
  },
  {
    "id": "junior2",
    "name": "初二"
  },
  {
    "id": "junior3",
    "name": "初三"
  },
  {
    "id": "senior1",
    "name": "高一"
  },
  {
    "id": "senior2",
    "name": "高二"
  },
  {
    "id": "senior3",
    "name": "高三"
  }
];
export const FIVE_FOUR_PROVINCES = [
  "shanghai"
];
export const TEACHER_GRADES = [
  {
    "id": "freshman",
    "name": "大一"
  },
  {
    "id": "sophomore",
    "name": "大二"
  },
  {
    "id": "junior",
    "name": "大三"
  },
  {
    "id": "senior",
    "name": "大四"
  },
  {
    "id": "master",
    "name": "硕士"
  },
  {
    "id": "phd",
    "name": "博士"
  },
  {
    "id": "graduated_bachelor",
    "name": "本科学历 已毕业"
  },
  {
    "id": "graduated_master",
    "name": "硕士学历 已毕业"
  },
  {
    "id": "graduated_phd",
    "name": "博士学历 已毕业"
  }
];
export const GENDERS = [
  {
    "id": "undeclared",
    "name": "不愿透露"
  },
  {
    "id": "male",
    "name": "男"
  },
  {
    "id": "female",
    "name": "女"
  }
];
export const TEACHING_METHODS = [
  {
    "id": "online",
    "name": "线上"
  },
  {
    "id": "offline",
    "name": "线下"
  },
  {
    "id": "both",
    "name": "线上线下均可"
  }
];
export const WEEKDAYS = [
  {
    "id": 1,
    "name": "周一"
  },
  {
    "id": 2,
    "name": "周二"
  },
  {
    "id": 3,
    "name": "周三"
  },
  {
    "id": 4,
    "name": "周四"
  },
  {
    "id": 5,
    "name": "周五"
  },
  {
    "id": 6,
    "name": "周六"
  },
  {
    "id": 7,
    "name": "周日"
  }
];
export const PERSONALITY_TAGS = [
  {
    "id": "patience",
    "name": "耐心"
  },
  {
    "id": "strict",
    "name": "严格"
  },
  {
    "id": "humorous",
    "name": "幽默"
  },
  {
    "id": "gentle",
    "name": "温柔"
  },
  {
    "id": "logical",
    "name": "逻辑清晰"
  },
  {
    "id": "friendly",
    "name": "亲和力强"
  },
  {
    "id": "responsible",
    "name": "认真负责"
  },
  {
    "id": "methodical",
    "name": "有方法"
  },
  {
    "id": "spoken",
    "name": "口语标准"
  },
  {
    "id": "motivating",
    "name": "善于鼓励"
  }
];
export const NONACADEMIC_PROJECTS = [
  {
    "id": "music",
    "name": "乐器/音乐"
  },
  {
    "id": "vocal",
    "name": "声乐"
  },
  {
    "id": "painting",
    "name": "绘画"
  },
  {
    "id": "dance",
    "name": "舞蹈"
  },
  {
    "id": "calligraphy",
    "name": "书法"
  },
  {
    "id": "chess",
    "name": "棋类"
  },
  {
    "id": "code",
    "name": "编程/机器人"
  },
  {
    "id": "sports",
    "name": "体育/运动"
  },
  {
    "id": "speech",
    "name": "演讲主持"
  },
  {
    "id": "language",
    "name": "语言口语"
  }
];
export const TEACHING_GOALS = [
  {
    "id": "score",
    "name": "提分"
  },
  {
    "id": "advanced",
    "name": "培优"
  },
  {
    "id": "contest",
    "name": "竞赛"
  },
  {
    "id": "interest",
    "name": "兴趣培养"
  },
  {
    "id": "habit",
    "name": "习惯养成"
  },
  {
    "id": "cram",
    "name": "考前冲刺"
  }
];
export const DEMAND_TYPES = {
  "ACADEMIC": "academic",
  "NONACADEMIC": "nonacademic"
};
export const ROLES = { STUDENT: 'student', TEACHER: 'teacher', ADMIN: 'admin' };
export const VERIFY_TYPES = { CHSI: 'chsi', ADMISSION: 'admission' };
// Z-15-F2：CONTENT_TYPES 硬编码数组删除——真源在 admin/repo.js CONTENT_SQL 键派生（增类型只改 CONTENT_SQL 单点），
// 此处原为双源之一且全仓零消费（server/constants.js re-export 亦无人引 CONTENT_TYPES）
export const COMPLAINT_TARGET_TYPES = ['teacher','student','post'];
export const AWARD_STATUS = { PENDING: 'pending', APPROVED: 'approved', REJECTED: 'rejected' };
export const DEACTIVATED_USER_PREFIX = '已注销用户';

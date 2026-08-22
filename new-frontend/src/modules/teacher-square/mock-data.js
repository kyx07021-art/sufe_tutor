/**
 * mock-data.js - raw I-29 response items for preview / tests (M7-01)
 * -------------------------------------------------------
 * Shape = interfaces.md §19 I-29 item shape. Kept as raw JSON so the real
 * mapTeacherResponse mapper runs over it (single mapping path everywhere).
 */

export const MOCK_TEACHER_ITEMS = [
  {
    teacherId: 1, name: '李老师', avatar: '', rating: 4.2, reviewCount: 21,
    priceMin: 150, priceMax: 260,
    subjects: [{ subject: '数学', score: 140, full: 150 }],
    bio: '重点中学退休教师，擅长高中数学提分与解题思维训练。',
    region: '上海', experienceYears: 18, matchScore: 98, matchCount: 4,
    teachingMethod: 'both', timeSlots: [], personalityTags: ['耐心', '负责'],
    gender: 'male', verified: true, chsiVerified: true,
  },
  {
    teacherId: 2, name: '王老师', avatar: '', rating: 4.0, reviewCount: 14,
    priceMin: 120, priceMax: 180,
    subjects: [{ subject: '英语', score: 138, full: 150 }],
    bio: '英语专业硕士，擅长口语与阅读。',
    region: '上海', experienceYears: 6, matchScore: 85, matchCount: 3,
    teachingMethod: 'online', timeSlots: [], personalityTags: ['幽默'],
    gender: 'female', verified: true, chsiVerified: false,
  },
  {
    teacherId: 3, name: '张老师', avatar: '', rating: 4.8, reviewCount: 32,
    priceMin: 200, priceMax: 300,
    subjects: [{ subject: '物理', score: 96, full: 100 }],
    bio: '竞赛教练，物理思维方法独到。',
    region: '上海', experienceYears: 3, matchScore: 72, matchCount: 2,
    teachingMethod: 'both', timeSlots: [], personalityTags: ['严格', '幽默'],
    gender: 'male', verified: true, chsiVerified: true,
  },
  {
    teacherId: 4, name: '赵老师', avatar: '', rating: 3.9, reviewCount: 9,
    priceMin: 100, priceMax: 200,
    subjects: [{ subject: '数学', score: 128, full: 150 }],
    bio: '耐心细致，适合基础薄弱的学生。',
    region: '上海', experienceYears: 10, matchScore: 60, matchCount: 2,
    teachingMethod: 'offline', timeSlots: [], personalityTags: ['耐心'],
    gender: 'male', verified: false, chsiVerified: false,
  },
  {
    teacherId: 5, name: '钱老师', avatar: '', rating: 4.9, reviewCount: 41,
    priceMin: 180, priceMax: 220,
    subjects: [{ subject: '化学', score: 92, full: 100 }],
    bio: '化学名师，善于把抽象概念讲得形象易懂。',
    region: '浙江', experienceYears: 2, matchScore: 45, matchCount: 1,
    teachingMethod: 'online', timeSlots: [], personalityTags: ['负责'],
    gender: 'female', verified: true, chsiVerified: true,
  },
  {
    teacherId: 6, name: '孙老师', avatar: '', rating: 5.0, reviewCount: 55,
    priceMin: 250, priceMax: 350,
    subjects: [{ subject: '语文', score: 132, full: 150 }],
    bio: '语文高级教师，擅长写作与古诗文。',
    region: '上海', experienceYears: 1, matchScore: 30, matchCount: 1,
    teachingMethod: 'both', timeSlots: [], personalityTags: ['幽默', '负责'],
    gender: 'female', verified: true, chsiVerified: true,
  },
]

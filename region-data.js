/**
 * 地区数据单源（模块1：地区档案 + 赋分组件）
 *
 * 双端共用：
 *   浏览器：<script src="/region-data.js"> 后取 globalThis.SUFE_REGIONS
 *   Worker：import '../region-data.js'（副作用导入）后取 globalThis.SUFE_REGIONS
 *
 * 数据基准：2026 年全国新高考改革（五批推进完毕）。区间档位为框架性编码，
 * 各省细则微调只需改本文件一个位置。
 */
(function () {
  // 浙江 2022 年 1 月选考起新制的 20 个赋分区间（赋分后区间，非固定卷面分区间）：
  // 卷面分按人数比例动态划分后等比例换算到区间内，1 分一档。
  // 边界来源（web 核实 2026-08-08）：浙江省教育考试院《关于进一步做好学考选考工作的通知》
  //   https://www.zjzs.net/art/2021/2/26/art_46_4843.html 及公开报道——第1区间 100-97、第2区间
  //   96-94 … 第20区间 42-40；第 2~20 区间各宽 3 分，第 1 区间宽 4 分（原第 1、2 等级合并）。
  const ZJ20_RANGES = [
    [100, 97], [96, 94], [93, 91], [90, 88], [87, 85], [84, 82], [81, 79], [78, 76], [75, 73], [72, 70],
    [69, 67], [66, 64], [63, 61], [60, 58], [57, 55], [54, 52], [51, 49], [48, 46], [45, 43], [42, 40],
  ];
  const R = {
    // 31 个省级地区（id 为拼音，入库用它；name 用于展示）
    provinces: [
      { id: 'beijing', name: '北京' }, { id: 'tianjin', name: '天津' }, { id: 'hebei', name: '河北' },
      { id: 'shanxi', name: '山西' }, { id: 'neimenggu', name: '内蒙古' }, { id: 'liaoning', name: '辽宁' },
      { id: 'jilin', name: '吉林' }, { id: 'heilongjiang', name: '黑龙江' }, { id: 'shanghai', name: '上海' },
      { id: 'jiangsu', name: '江苏' }, { id: 'zhejiang', name: '浙江' }, { id: 'anhui', name: '安徽' },
      { id: 'fujian', name: '福建' }, { id: 'jiangxi', name: '江西' }, { id: 'shandong', name: '山东' },
      { id: 'henan', name: '河南' }, { id: 'hubei', name: '湖北' }, { id: 'hunan', name: '湖南' },
      { id: 'guangdong', name: '广东' }, { id: 'guangxi', name: '广西' }, { id: 'hainan', name: '海南' },
      { id: 'chongqing', name: '重庆' }, { id: 'sichuan', name: '四川' }, { id: 'guizhou', name: '贵州' },
      { id: 'yunnan', name: '云南' }, { id: 'xizang', name: '西藏' }, { id: 'shaanxi', name: '陕西' },
      { id: 'gansu', name: '甘肃' }, { id: 'qinghai', name: '青海' }, { id: 'ningxia', name: '宁夏' },
      { id: 'xinjiang', name: '新疆' },
    ],

    // 三种高考政策类型
    policies: {
      '3+1+2': {
        label: '3+1+2 新高考',
        desc: '语数外原始分（各 150）；物理/历史首选 1 门（原始分 100）；政地化生再选 2 门（等级赋分 100）',
        main: ['chinese', 'math', 'english'],
        first: ['physics', 'history'],
        reassigned: ['politics', 'geography', 'chemistry', 'biology'],
      },
      '3+3': {
        label: '3+3 新高考',
        desc: '语数外原始分（各 150）；选考 3 门全部等级赋分，赋分细则按省份',
        main: ['chinese', 'math', 'english'],
        electives: ['physics', 'chemistry', 'biology', 'history', 'geography', 'politics'],
      },
      'old': {
        label: '传统文理分科',
        desc: '文：语数外+文综（政史地）；理：语数外+理综（理化生）；全部原始分',
        main: ['chinese', 'math', 'english'],
        tracks: { science: ['physics', 'chemistry', 'biology'], arts: ['history', 'geography', 'politics'] },
      },
    },

    // 省份 → 政策 + 赋分制（未显式列出的字段缺省 = 3+1+2 全国通用五等级）
    provincePolicy: {
      // 3+3（第一、二批）；offlineAllowed 数据驱动「线下授课允许省」（默认仅线上，
      // v0.25.86 审计收敛：原'非上海锁线上'特判散落 app-region/app-demands/routes-demands 三处）
      shanghai: { policy: '3+3', gradeSystem: 'shanghai', offlineAllowed: true },
      zhejiang: { policy: '3+3', gradeSystem: 'zhejiang20', extraElective: 'technology' }, // 浙江 7 选 3 含技术；2022 选考起 20 区间新制
      beijing:  { policy: '3+3', gradeSystem: 'beijing' },
      tianjin:  { policy: '3+3', gradeSystem: 'beijing' },   // 与北京同框架：21 档 3 分一段
      shandong: { policy: '3+3', gradeSystem: 'shandong' },
      hainan:   { policy: '3+3', gradeSystem: 'hainan' },
      // 传统文理（2026 年仅余两区）
      xinjiang: { policy: 'old', gradeSystem: null },
      xizang:   { policy: 'old', gradeSystem: null },
      // 其余均为 3+1+2（第三至五批；再选科目用全国统一五等级赋分框架）
      hebei: {}, shanxi: {}, neimenggu: {}, liaoning: {}, jilin: {}, heilongjiang: {},
      jiangsu: {}, anhui: {}, fujian: {}, jiangxi: {}, henan: {}, hubei: {}, hunan: {},
      guangdong: {}, guangxi: {}, chongqing: {}, sichuan: {}, guizhou: {}, yunnan: {},
      shaanxi: {}, gansu: {}, qinghai: {}, ningxia: {},
    },
    DEFAULT_POLICY: { policy: '3+1+2', gradeSystem: 'standard5' },

    // 各省新高考改革首考年（教师按毕业年份倒推其当年实际政策；未登记省份恒为传统文理）。
    // 3+3：上海/浙江 2017，京津鲁琼 2020。3+1+2：第三批 2021 八省、第四批 2024 七省、第五批 2025 八省。
    reformFirstYear: {
      shanghai: 2017, zhejiang: 2017,
      beijing: 2020, tianjin: 2020, shandong: 2020, hainan: 2020,
      hebei: 2021, liaoning: 2021, jiangsu: 2021, fujian: 2021, hubei: 2021, hunan: 2021, guangdong: 2021, chongqing: 2021,
      heilongjiang: 2024, jilin: 2024, anhui: 2024, jiangxi: 2024, guizhou: 2024, guangxi: 2024, gansu: 2024,
      shanxi: 2025, neimenggu: 2025, henan: 2025, sichuan: 2025, yunnan: 2025, shaanxi: 2025, qinghai: 2025, ningxia: 2025,
    },
    // 浙江 20 赋分区间起用年：官方通知「2022 年 1 月选考科目考试起」改 20 区间（web 核实，来源见文件头
    // ZJ20_RANGES 注释）。2022 年 1 月选考由 2022 届（2019 级）高三参加 → 2022 届毕业即新制，
    // 故毕业年 ≥ 2022 用 20 区间、≤ 2021 用 21 档旧制（架构审计 M2 修正：原记 2023 错位一年）
    zhejiang20Year: 2022,

    // 赋分制档位（type=grade 提供等级选项；type=standard 按分数录入并标注标准分）
    gradeSystems: {
      // 3+1+2 再选科目统一框架：A-E 五等级等比例转换
      standard5: {
        type: 'grade', label: '等级赋分（五等级）',
        levels: [
          { id: 'A', name: 'A（100-86）' }, { id: 'B', name: 'B（85-71）' }, { id: 'C', name: 'C（70-56）' },
          { id: 'D', name: 'D（55-41）' }, { id: 'E', name: 'E（40-30）' },
        ],
      },
      // 上海：11 等第 × 3 分，70-40（选考满分 70，总分 660）
      shanghai: {
        type: 'grade', label: '上海等第制（满分 70）', max: 70,
        levels: ['A+', 'A', 'B+', 'B', 'B-', 'C+', 'C', 'C-', 'D+', 'D', 'E'].map((g, i) => ({ id: g, name: g + '（' + (70 - i * 3) + '分）' })),
      },
      // 浙江 21 档（历史档，2022.1 选考前的旧制，3 分一段 100→40）：仅 2017-2022 高考毕业的教师使用
      zhejiang21: {
        type: 'grade', label: '浙江 21 档（100-40）· 2022 前旧制',
        levels: Array.from({ length: 21 }, (_, i) => ({ id: 'L' + (i + 1), name: '第' + (i + 1) + '档（' + (100 - i * 3) + '分）' })),
      },
      // 浙江 20 赋分区间（2022.1 选考起新制，2023 高考即此制）：区间内 1 分一档等比例转换。
      // 边界见文件头 ZJ20_RANGES（web 核实来源浙江教育考试院通知，注释在常量旁）。
      zhejiang20: {
        type: 'grade', label: '浙江 20 区间（100-40）· 2022 起',
        levels: ZJ20_RANGES.map(([hi, lo], i) => ({ id: 'I' + (i + 1), name: '第' + (i + 1) + '区间（' + hi + '-' + lo + '）' })),
      },
      // 北京 / 天津：21 档，3 分一段（100→40）
      beijing: {
        type: 'grade', label: '京津 21 档（100-40）',
        levels: Array.from({ length: 21 }, (_, i) => ({ id: 'T' + (i + 1), name: (100 - i * 3) + '分档' })),
      },
      // 山东：8 等级等比例转换（区间为框架近似值，以山东省教育厅转换说明为准）
      shandong: {
        type: 'grade', label: '山东 8 等级',
        levels: [
          { id: 'A+', name: 'A+（100-91）' }, { id: 'A', name: 'A（90-81）' }, { id: 'B+', name: 'B+（80-71）' },
          { id: 'B', name: 'B（70-61）' }, { id: 'C+', name: 'C+（60-51）' }, { id: 'C', name: 'C（50-41）' },
          { id: 'D+', name: 'D+（40-31）' }, { id: 'E', name: 'E（30-21）' },
        ],
      },
      // 海南：标准分转换（总分 900），选考单科标准分满分 300，按分数录入
      hainan: { type: 'standard', label: '海南标准分（满分 300）', max: 300 },
    },

    // 学段科目（小学/初中全国一致；高中为 9 门池子，浙江加技术，学生按省政策从中选）
    subjectsByStage: {
      primary: ['chinese', 'math', 'english'],
      middle: ['chinese', 'math', 'english', 'physics', 'chemistry', 'biology', 'politics', 'history', 'geography'],
      senior: ['chinese', 'math', 'english', 'physics', 'chemistry', 'biology', 'history', 'geography', 'politics'],
    },

    subjectNames: {
      chinese: '语文', math: '数学', english: '英语', physics: '物理', chemistry: '化学',
      biology: '生物', history: '历史', geography: '地理', politics: '政治', technology: '技术',
    },
    subjectMaxScore: { chinese: 150, math: 150, english: 150 }, // 其余默认 100

    // 义务教育阶段通用等第（小学/初中平时成绩的"等第制"选项）
    COMPULSORY_LEVELS: [
      { id: 'A', name: 'A（优秀）' }, { id: 'B', name: 'B（良好）' },
      { id: 'C', name: 'C（合格）' }, { id: 'D', name: 'D（待提高）' },
    ],

    // ---- 查询函数 ----
    provinceName(id) { const p = this.provinces.find(x => x.id === id); return p ? p.name : (id || ''); },
    isValidProvince(id) { return this.provinces.some(p => p.id === id); },
    allowsOffline(id) { const c = this.provincePolicy[id]; return !!(c && c.offlineAllowed); }, // 线下授课许可（默认仅线上）

    // 年份感知政策解析：无 year（学生端/最新）→ 最新政策；有 year（教师毕业年份）→ 按改革批次回退
    // 到该教师当年高考实际执行的政策（改革前 → 传统文理原始分；浙江 2017-2022 → 21 档旧制）。
    policyOf(provinceId, year) {
      const cfg = this.provincePolicy[provinceId];
      if (year != null && cfg) {
        const firstYear = this.reformFirstYear[provinceId];
        if (firstYear && year < firstYear) {
          // 改革首考年之前毕业 → 传统文理（原始分，gradeSystem null）
          return this._buildPolicy('old', null, null);
        }
        // 浙江：改革后但 2022 选考新制前（2017~2022 高考）→ 21 档旧制
        if (cfg.policy === '3+3' && provinceId === 'zhejiang' && year < this.zhejiang20Year) {
          return this._buildPolicy('3+3', 'zhejiang21', cfg.extraElective || null);
        }
      }
      // 空 {} 登记 = 缺省配置（3+1+2 + standard5）：空对象 truthy，必须显式判定 policy 字段
      const eff = (cfg && cfg.policy) ? cfg : this.DEFAULT_POLICY;
      return this._buildPolicy(eff.policy, eff.gradeSystem || null, eff.extraElective || null);
    },

    // 组装政策返回形状（gradeSystem 反查 + type/gradeSystemId/extraElective 归一）
    _buildPolicy(policyId, gradeSystemId, extraElective) {
      const p = this.policies[policyId];
      return {
        ...p, type: policyId,
        gradeSystem: gradeSystemId ? this.gradeSystems[gradeSystemId] : null,
        gradeSystemId: gradeSystemId || null,
        extraElective: extraElective || null,
      };
    },

    stageOfGrade(gradeId) {
      if (!gradeId) return null;
      if (gradeId.startsWith('prep')) return 'middle'; // M3：预备班=初中阶段（上海五四学制六年级属初中；须先于 'p' 前缀判断）
      if (gradeId.startsWith('p')) return 'primary';
      if (gradeId.startsWith('junior')) return 'middle';
      if (gradeId.startsWith('senior')) return 'senior';
      return null;
    },

    // M3：学制地区差异——五四学制省份（小学五年+初中四年；六年级=初中预备班，无小学六年级）。
    // 单源 FIVE_FOUR_PROVINCES（constants），此处读 globalThis.APP_CONSTANTS；默认六三学制。
    isFiveFour(provinceId) {
      const cfg = globalThis.APP_CONSTANTS || {};
      const list = cfg.FIVE_FOUR_PROVINCES || [];
      return list.includes(provinceId);
    },

    // 学生科目池：地区 + 年级共同决定（需求 1.3）
    subjectsFor(provinceId, gradeId) {
      const stage = this.stageOfGrade(gradeId);
      if (stage === 'senior') {
        const pol = this.policyOf(provinceId);
        const pool = [...this.subjectsByStage.senior];
        if (pol.extraElective) pool.push(pol.extraElective);
        return pool;
      }
      return this.subjectsByStage[stage] || this.subjectsByStage.primary;
    },

    // 是否提供等第制（决定学生平时成绩的等第/分数页签）
    gradeLevelsFor(provinceId, gradeId) {
      const stage = this.stageOfGrade(gradeId);
      if (stage === 'senior') {
        const pol = this.policyOf(provinceId);
        return (pol.gradeSystem && pol.gradeSystem.type === 'grade') ? pol.gradeSystem.levels : null;
      }
      return this.COMPULSORY_LEVELS; // 小学/初中：通用等第
    },
  };

  globalThis.SUFE_REGIONS = R;
})();

/**
 * 地区数据单源（V-2-4c：从 client/constants 提升到 shared，服务端与客户端共用；
 * 客户端经 client/constants/region-data.js re-export 保持分层入口）。
 */
import { FIVE_FOUR_PROVINCES } from './enums.js';


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

    // 上海市镇/街道级行政区划（需求五：地址格式化精确到街道；前后端同读单源）。
    // 数据基准：上海市民政局行政区划表（截至 2024-07-31：108 街道 + 106 镇 + 2 乡 = 216）
    //   + 嘉定区 2026-05 街镇行政区划变更（上海市人民政府批准：设立菊园街道、从徐行镇析出设立娄塘镇）
    //   = 截至 2026-08 共 109 街道 + 107 镇 + 2 乡 = 218。单位名为规范全称（含 街道/镇/乡 后缀）。
    // 用途：①上海线下需求的区+镇/街道结构化选择；②教师档案「上海常住地」；③匹配度镇间距离（坐标表另存）。
    shanghaiDistricts: [
      { id: 'huangpu', name: '黄浦区', units: ['南京东路街道', '外滩街道', '半淞园路街道', '小东门街道', '豫园街道', '老西门街道', '五里桥街道', '打浦桥街道', '淮海中路街道', '瑞金二路街道'] },
      { id: 'xuhui', name: '徐汇区', units: ['天平路街道', '湖南路街道', '斜土路街道', '枫林路街道', '长桥街道', '田林街道', '虹梅路街道', '康健新村街道', '徐家汇街道', '凌云路街道', '龙华街道', '漕河泾街道', '华泾镇'] },
      { id: 'changning', name: '长宁区', units: ['华阳路街道', '江苏路街道', '新华路街道', '周家桥街道', '天山路街道', '仙霞新村街道', '虹桥街道', '程家桥街道', '北新泾街道', '新泾镇'] },
      { id: 'jingan', name: '静安区', units: ['江宁路街道', '石门二路街道', '南京西路街道', '静安寺街道', '曹家渡街道', '天目西路街道', '北站街道', '宝山路街道', '共和新路街道', '大宁路街道', '彭浦新村街道', '临汾路街道', '芷江西路街道', '彭浦镇'] },
      { id: 'putuo', name: '普陀区', units: ['曹杨新村街道', '长风新村街道', '长寿路街道', '甘泉路街道', '石泉路街道', '宜川路街道', '真如镇街道', '万里街道', '长征镇', '桃浦镇'] },
      { id: 'hongkou', name: '虹口区', units: ['欧阳路街道', '曲阳路街道', '广中路街道', '嘉兴路街道', '凉城新村街道', '四川北路街道', '北外滩街道', '江湾镇街道'] },
      { id: 'yangpu', name: '杨浦区', units: ['定海路街道', '平凉路街道', '江浦路街道', '四平路街道', '控江路街道', '长白新村街道', '延吉新村街道', '殷行街道', '大桥街道', '五角场街道', '新江湾城街道', '长海路街道'] },
      { id: 'minhang', name: '闵行区', units: ['江川路街道', '古美路街道', '新虹街道', '浦锦街道', '莘庄镇', '七宝镇', '颛桥镇', '华漕镇', '虹桥镇', '梅陇镇', '吴泾镇', '马桥镇', '浦江镇'] },
      { id: 'baoshan', name: '宝山区', units: ['友谊路街道', '吴淞街道', '张庙街道', '罗店镇', '大场镇', '杨行镇', '月浦镇', '罗泾镇', '顾村镇', '高境镇', '庙行镇', '淞南镇'] },
      { id: 'jiading', name: '嘉定区', units: ['新成路街道', '真新街道', '嘉定镇街道', '菊园街道', '南翔镇', '安亭镇', '马陆镇', '徐行镇', '华亭镇', '外冈镇', '江桥镇', '娄塘镇'] },
      { id: 'pudong', name: '浦东新区', units: ['潍坊新村街道', '陆家嘴街道', '周家渡街道', '塘桥街道', '上钢新村街道', '南码头路街道', '沪东新村街道', '金杨新村街道', '洋泾街道', '浦兴路街道', '东明路街道', '花木街道', '川沙新镇', '高桥镇', '北蔡镇', '合庆镇', '唐镇', '曹路镇', '金桥镇', '高行镇', '高东镇', '张江镇', '三林镇', '惠南镇', '周浦镇', '新场镇', '大团镇', '康桥镇', '航头镇', '祝桥镇', '泥城镇', '宣桥镇', '书院镇', '万祥镇', '老港镇', '南汇新城镇'] },
      { id: 'jinshan', name: '金山区', units: ['石化街道', '朱泾镇', '枫泾镇', '张堰镇', '亭林镇', '吕巷镇', '廊下镇', '金山卫镇', '漕泾镇', '山阳镇'] },
      { id: 'songjiang', name: '松江区', units: ['岳阳街道', '永丰街道', '方松街道', '中山街道', '广富林街道', '九里亭街道', '泗泾镇', '佘山镇', '车墩镇', '新桥镇', '洞泾镇', '九亭镇', '泖港镇', '石湖荡镇', '小昆山镇', '新浜镇', '叶榭镇'] },
      { id: 'qingpu', name: '青浦区', units: ['夏阳街道', '盈浦街道', '香花桥街道', '朱家角镇', '练塘镇', '金泽镇', '赵巷镇', '徐泾镇', '华新镇', '重固镇', '白鹤镇'] },
      { id: 'fengxian', name: '奉贤区', units: ['西渡街道', '奉浦街道', '金海街道', '头桥街道', '南桥镇', '奉城镇', '四团镇', '柘林镇', '庄行镇', '金汇镇', '青村镇', '海湾镇'] },
      { id: 'chongming', name: '崇明区', units: ['城桥镇', '堡镇', '新河镇', '庙镇', '竖新镇', '向化镇', '三星镇', '港沿镇', '中兴镇', '陈家镇', '绿华镇', '港西镇', '建设镇', '新海镇', '东平镇', '长兴镇', '新村乡', '横沙乡'] },
    ],

    // 上海 218 个镇/街道坐标表（[lat, lng] 纬经序；需求五：匹配度镇间距离评分）。
    // 数据源：GeoNames cities500（WGS-84，同单位多 POI 点取人口最高主点）211 个；7 个 GeoNames 无条目单位
    //   经 web 检索补全（Wikipedia/BIGEMAP，个别来源为 GCJ-02 火星坐标）或 GeoNames 同名 POI 集群质心
    //   （嘉定·菊园街道=旧菊园新区街道 2026 更名）。WGS-84 与 GCJ-02 沪内互差数百米，20km 级评分下可忽略。
    shanghaiTownCoords: {
      '黄浦区': { '南京东路街道': [31.24050, 121.46450], '外滩街道': [31.23780, 121.47810], '半淞园路街道': [31.20389, 121.49278], '小东门街道': [31.21120, 121.49812], '豫园街道': [31.22400, 121.47923], '老西门街道': [31.22191, 121.48914], '五里桥街道': [31.19625, 121.48390], '打浦桥街道': [31.20908, 121.46335], '淮海中路街道': [31.22183, 121.47423], '瑞金二路街道': [31.22222, 121.45806] },
      '徐汇区': { '天平路街道': [31.20351, 121.43911], '湖南路街道': [31.21340, 121.44230], '斜土路街道': [31.19460, 121.46400], '枫林路街道': [31.19594, 121.44709], '长桥街道': [31.14194, 121.43400], '田林街道': [31.18226, 121.41815], '虹梅路街道': [31.16667, 121.40000], '康健新村街道': [31.16667, 121.41667], '徐家汇街道': [31.19000, 121.43194], '凌云路街道': [31.15000, 121.42100], '龙华街道': [31.16306, 121.45361], '漕河泾街道': [31.16370, 121.42799], '华泾镇': [31.12200, 121.44925] },
      '长宁区': { '华阳路街道': [31.22000, 121.41583], '江苏路街道': [31.21739, 121.42105], '新华路街道': [31.21330, 121.42567], '周家桥街道': [31.21694, 121.40778], '天山路街道': [31.21060, 121.40430], '仙霞新村街道': [31.20927, 121.38999], '虹桥街道': [31.20429, 121.40609], '程家桥街道': [31.19787, 121.33632], '北新泾街道': [31.22250, 121.36528], '新泾镇': [31.21468, 121.36818] },
      '静安区': { '江宁路街道': [31.23290, 121.44780], '石门二路街道': [31.23430, 121.45160], '南京西路街道': [31.22860, 121.45870], '静安寺街道': [31.22760, 121.43960], '曹家渡街道': [31.23338, 121.42935], '天目西路街道': [31.25159, 121.45079], '北站街道': [31.24414, 121.46592], '宝山路街道': [31.25234, 121.46617], '共和新路街道': [31.26985, 121.44245], '大宁路街道': [31.29837, 121.44631], '彭浦新村街道': [31.31480, 121.44795], '临汾路街道': [31.31060, 121.46026], '芷江西路街道': [31.25861, 121.45972], '彭浦镇': [31.28550, 121.43670] },
      '普陀区': { '曹杨新村街道': [31.23914, 121.40287], '长风新村街道': [31.23333, 121.41667], '长寿路街道': [31.24990, 121.43500], '甘泉路街道': [31.27190, 121.42808], '石泉路街道': [31.25538, 121.42105], '宜川路街道': [31.25590, 121.44300], '真如镇街道': [31.25100, 121.38970], '万里街道': [31.26667, 121.40000], '长征镇': [31.23913, 121.36779], '桃浦镇': [31.28360, 121.39522] },
      '虹口区': { '欧阳路街道': [31.27649, 121.48055], '曲阳路街道': [31.28864, 121.49051], '广中路街道': [31.28450, 121.47641], '嘉兴路街道': [31.27000, 121.49500], '凉城新村街道': [31.29097, 121.45991], '四川北路街道': [31.26230, 121.48350], '北外滩街道': [31.25000, 121.48333], '江湾镇街道': [31.30106, 121.47647] },
      '杨浦区': { '定海路街道': [31.28333, 121.55000], '平凉路街道': [31.26193, 121.51904], '江浦路街道': [31.26375, 121.51157], '四平路街道': [31.28112, 121.50901], '控江路街道': [31.28333, 121.51209], '长白新村街道': [31.30000, 121.55000], '延吉新村街道': [31.29262, 121.53328], '殷行街道': [31.32519, 121.52314], '大桥街道': [31.26389, 121.53708], '五角场街道': [31.29248, 121.50580], '新江湾城街道': [31.33333, 121.51667], '长海路街道': [31.31142, 121.51451] },
      '闵行区': { '江川路街道': [31.01392, 121.40742], '古美路街道': [31.13791, 121.38191], '新虹街道': [31.18737, 121.31525], '浦锦街道': [31.09357, 121.49581], '莘庄镇': [31.10881, 121.37471], '七宝镇': [31.15267, 121.35688], '颛桥镇': [31.07444, 121.38861], '华漕镇': [31.20690, 121.28672], '虹桥镇': [31.18250, 121.38472], '梅陇镇': [31.09250, 121.43000], '吴泾镇': [31.04138, 121.45966], '马桥镇': [31.03389, 121.36139], '浦江镇': [31.02139, 121.49167] },
      '宝山区': { '友谊路街道': [31.40845, 121.48956], '吴淞街道': [31.36083, 121.49861], '张庙街道': [31.33649, 121.45117], '罗店镇': [31.41556, 121.33444], '大场镇': [31.30873, 121.41526], '杨行镇': [31.37022, 121.43742], '月浦镇': [31.42694, 121.42139], '罗泾镇': [31.47820, 121.33907], '顾村镇': [31.34933, 121.39341], '高境镇': [31.32225, 121.47510], '庙行镇': [31.32466, 121.43953], '淞南镇': [31.35043, 121.48218] },
      '嘉定区': { '新成路街道': [31.38864, 121.26305], '真新街道': [31.24610, 121.35409], '嘉定镇街道': [31.38575, 121.24465], '菊园街道': [31.37070, 121.22803], '南翔镇': [31.29979, 121.31180], '安亭镇': [31.27672, 121.20777], '马陆镇': [31.37650, 121.29390], '徐行镇': [31.41293, 121.27065], '华亭镇': [31.46244, 121.23707], '外冈镇': [31.36306, 121.17056], '江桥镇': [31.23896, 121.32484], '娄塘镇': [31.43167, 121.21824] },
      '浦东新区': { '潍坊新村街道': [31.22440, 121.51050], '陆家嘴街道': [31.23995, 121.50094], '周家渡街道': [31.18583, 121.49556], '塘桥街道': [31.21705, 121.52532], '上钢新村街道': [31.18889, 121.47056], '南码头路街道': [31.19667, 121.50222], '沪东新村街道': [31.28333, 121.56667], '金杨新村街道': [31.25000, 121.57130], '洋泾街道': [31.24278, 121.54556], '浦兴路街道': [31.27092, 121.59331], '东明路街道': [31.14333, 121.49528], '花木街道': [31.21090, 121.54393], '川沙新镇': [31.11806, 121.69556], '高桥镇': [31.35000, 121.53333], '北蔡镇': [31.18972, 121.54806], '合庆镇': [31.24333, 121.71083], '唐镇': [31.21028, 121.65222], '曹路镇': [31.29581, 121.65901], '金桥镇': [31.25167, 121.63028], '高行镇': [31.33153, 121.58592], '高东镇': [31.31185, 121.62575], '张江镇': [31.20861, 121.60889], '三林镇': [31.16000, 121.49278], '惠南镇': [31.05886, 121.75625], '周浦镇': [31.10000, 121.58333], '新场镇': [31.02639, 121.63917], '大团镇': [30.97381, 121.73356], '康桥镇': [31.12931, 121.56856], '航头镇': [31.05443, 121.58800], '祝桥镇': [31.11722, 121.75056], '泥城镇': [30.90443, 121.79205], '宣桥镇': [31.03842, 121.68784], '书院镇': [30.93127, 121.86010], '万祥镇': [30.96955, 121.81503], '老港镇': [31.02917, 121.84306], '南汇新城镇': [30.88042, 121.84427] },
      '金山区': { '石化街道': [30.72333, 121.31500], '朱泾镇': [30.90100, 121.15966], '枫泾镇': [30.89019, 121.01195], '张堰镇': [30.80663, 121.28008], '亭林镇': [30.83556, 121.29373], '吕巷镇': [30.82985, 121.17010], '廊下镇': [30.78897, 121.18548], '金山卫镇': [30.77672, 121.24194], '漕泾镇': [30.83670, 121.37235], '山阳镇': [30.76657, 121.36807] },
      '松江区': { '岳阳街道': [31.02098, 121.21132], '永丰街道': [31.00627, 121.20164], '方松街道': [31.03443, 121.22326], '中山街道': [31.03601, 121.24414], '广富林街道': [31.06250, 121.18694], '九里亭街道': [31.14149, 121.30588], '泗泾镇': [31.11444, 121.26833], '佘山镇': [31.10111, 121.17938], '车墩镇': [31.01866, 121.30775], '新桥镇': [31.06500, 121.30750], '洞泾镇': [31.08670, 121.26300], '九亭镇': [31.13055, 121.31628], '泖港镇': [30.93487, 121.20901], '石湖荡镇': [30.98516, 121.11446], '小昆山镇': [31.04361, 121.12389], '新浜镇': [30.93467, 121.06147], '叶榭镇': [30.94543, 121.31643] },
      '青浦区': { '夏阳街道': [31.15394, 121.11408], '盈浦街道': [31.15527, 121.10575], '香花桥街道': [31.17451, 121.11692], '朱家角镇': [31.10757, 121.05696], '练塘镇': [31.01167, 121.04606], '金泽镇': [31.03714, 120.91470], '赵巷镇': [31.15194, 121.19203], '徐泾镇': [31.17612, 121.27122], '华新镇': [31.24695, 121.21824], '重固镇': [31.20361, 121.17056], '白鹤镇': [31.25616, 121.13653] },
      '奉贤区': { '西渡街道': [30.99559, 121.42471], '奉浦街道': [30.92821, 121.46962], '金海街道': [30.97040, 121.48669], '头桥街道': [30.97278, 121.66472], '南桥镇': [30.91611, 121.44944], '奉城镇': [30.91578, 121.64040], '四团镇': [30.90830, 121.75345], '柘林镇': [30.85841, 121.46779], '庄行镇': [30.90770, 121.39124], '金汇镇': [30.98973, 121.49251], '青村镇': [30.92835, 121.58221], '海湾镇': [30.86889, 121.60222] },
      '崇明区': { '城桥镇': [31.63082, 121.39252], '堡镇': [31.53333, 121.60000], '新河镇': [31.61833, 121.55333], '庙镇': [31.68611, 121.34639], '竖新镇': [31.55056, 121.57194], '向化镇': [31.52028, 121.71583], '三星镇': [31.74897, 121.27337], '港沿镇': [31.58611, 121.70917], '中兴镇': [31.52528, 121.76222], '陈家镇': [31.47778, 121.77694], '绿华镇': [31.76683, 121.21462], '港西镇': [31.69852, 121.43833], '建设镇': [31.65882, 121.44887], '新海镇': [31.81778, 121.23750], '东平镇': [31.53083, 121.86333], '长兴镇': [31.39145, 121.68949], '新村乡': [31.83143, 121.32774], '横沙乡': [31.34028, 121.83889] },
    },

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
      // v0.25.86 审计收敛：原'非上海锁线上'特判散落前端两处）
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
    subjectMaxScore: { chinese: 150, math: 150, english: 150 }, // 其余默认 100（仅高中主科走此键；初中按省 middleScore）

    // 每省「初中平时卷满分」惯例（v0.27.3 #22 用户需求，web 核实 2026-08-11，五路只读调研：
    // 华北东北/华东/中南华南/西南/西北，来源省教育厅/招考文件与实证卷面）。
    // 通用缺省：小学主科 100（全国统一）／ 初中主科 100 ／ 高中主科 150（高考口径）／ 副科 100。
    // 实测主流模式：多数省全程用中考分制命题（120 分制省初一即 120 分卷）；
    //   150 分制省中 新疆/福建全程 150，上海/重庆/安徽「初一初二 100、初三才切 150」；青海「初一初二 100、初三切 120」。
    // 结构：省份值可简写数字（语数外同分）或对象 { main, switch }——
    //   main:   主科（语数外）平时卷满分，数字（三科同分）或 {subject:满分}（缺省科目 100；如 湖南英100）；
    //   switch: 'junior3' 主科从该年级起才用 main、此前年级用 100（缺省全程用 main）。
    // subjectMax 子表：副科满分特例（缺省 100；如 上海历史笔试 30）。卷面 100 折算计分者（湖南/福建/云南）
    //   按卷面 100 记（学校卷面即 100）；北京/山东史政等级制不计分 → 缺省 100。
    middleScore: {
      // —— 120 分制省（全程同中考分命题）——
      tianjin: 120, hebei: 120, shanxi: 120, liaoning: 120, jilin: 120, heilongjiang: 120,
      jiangsu: 120, zhejiang: 120, jiangxi: 120, shandong: 120,
      henan: 120, hubei: 120, guangdong: 120, guangxi: 120, hainan: 120,
      xizang: 120, shaanxi: 120, gansu: 120, qinghai: { main: 120, switch: 'junior3' }, ningxia: 120,
      // —— 150 分制省 ——
      fujian: 150, xinjiang: 150, sichuan: 150, guizhou: 150,
      anhui: { main: { chinese: 150, math: 150, english: 120 }, switch: 'junior3' },
      shanghai: { main: 150, switch: 'junior3' },
      chongqing: { main: 150, switch: 'junior3' },
      // —— 特殊：湖南英语 100 ——
      hunan: { main: { chinese: 120, math: 120, english: 100 } },
      // —— 100 分制省（beijing/neimenggu/yunnan = 缺省 100，不写）——
      subjectMax: {
        tianjin: { history: 100, politics: 100 }, hebei: { history: 60, politics: 60 },
        shanxi: { history: 75, politics: 75 }, neimenggu: { history: 50, politics: 50 },
        liaoning: { history: 70, politics: 70 }, jilin: { history: 60, politics: 60 },
        heilongjiang: { history: 70, politics: 70 }, shanghai: { history: 30, politics: 60 },
        jiangsu: { history: 60, politics: 60 }, zhejiang: { history: 100, politics: 100 },
        anhui: { history: 70, politics: 80 }, fujian: { history: 100, politics: 100 },
        jiangxi: { history: 80, politics: 80 },
        henan: { history: 50, politics: 70 }, hubei: { history: 60, politics: 60 },
        hunan: { history: 100, politics: 100 }, guangdong: { history: 90, politics: 90 },
        guangxi: { history: 75, politics: 75 }, hainan: { history: 100, politics: 100 },
        chongqing: { history: 50, politics: 50 }, sichuan: { history: 100, politics: 100 },
        guizhou: { history: 60, politics: 70 }, yunnan: { history: 100, politics: 100 },
        xizang: { history: 80, politics: 80 }, shaanxi: { history: 60, politics: 80 },
        gansu: { history: 50, politics: 50 }, qinghai: { history: 60, politics: 60 },
        ningxia: { history: 30, politics: 70 }, xinjiang: { history: 75, politics: 75 },
      },
    },

    // 年级在学段内排序（prep<junior1..3<senior1..3；小学恒 100 用不到，兜底 0 防误用）
    gradeIndex(gradeId) {
      const s = String(gradeId || '');
      if (s === 'prep') return 0;
      const m = /^(junior|senior)(\d)/.exec(s);
      if (m) return Number(m[2]) || 0;
      return 0;
    },

    // 主科满分按省+年级（v0.27.3 #22 每省每年级科目/分数政策，用户需求「按惯例主流(>50%)设定每个年级的科目/分数政策」）。
    // 小学恒 100（全国统一）；高中主科 150（高考口径）、副科 100；初中按省 middleScore（主科中考口径 + 切换年级 + 副科特例）。
    // 年级为空/非法 → 保守 100（v0.27.3 走查 #18：150 只适配 middle/senior，空年级钳制不再被绕过）。
    // 前后端同读本函数（单源）。非主科无省特例恒 100。
    subjectMaxFor(provinceId, subjectId, gradeId) {
      const stage = this.stageOfGrade(gradeId);
      if (stage === 'primary' || !stage) return 100;
      if (stage === 'senior') return this.subjectMaxScore[subjectId] || 100;
      // 初中（middle）：副科特例优先（如 上海历史笔试 30）
      const sm = this.middleScore.subjectMax;
      if (sm && sm[provinceId] && sm[provinceId][subjectId] != null) return sm[provinceId][subjectId];
      const isMain = subjectId === 'chinese' || subjectId === 'math' || subjectId === 'english';
      if (!isMain) return 100;
      const raw = this.middleScore[provinceId];
      const cfg = raw == null ? { main: 100 } : (typeof raw === 'number' ? { main: raw } : raw);
      const mainMax = typeof cfg.main === 'number' ? cfg.main : (cfg.main && cfg.main[subjectId]) || 100;
      if (cfg.switch && this.gradeIndex(gradeId) < this.gradeIndex(cfg.switch)) return 100;
      return mainMax;
    },

    // 义务教育阶段通用等第（小学/初中平时成绩的"等第制"选项）
    COMPULSORY_LEVELS: [
      { id: 'A', name: 'A（优秀）' }, { id: 'B', name: 'B（良好）' },
      { id: 'C', name: 'C（合格）' }, { id: 'D', name: 'D（待提高）' },
    ],

    // ---- 查询函数 ----
    provinceName(id) { const p = this.provinces.find(x => x.id === id); return p ? p.name : (id || ''); },
    isValidProvince(id) { return this.provinces.some(p => p.id === id); },
    allowsOffline(id) { const c = this.provincePolicy[id]; return !!(c && c.offlineAllowed); }, // 线下授课许可（默认仅线上）

    // ---- 上海镇/街道查询（需求五） ----
    shanghaiDistrictById(id) { return this.shanghaiDistricts.find(x => x.id === id) || null; },
    shanghaiDistrictByName(name) { return this.shanghaiDistricts.find(x => x.name === name) || null; },
    // 校验「区·镇/街道」组合是否合法（address 存储格式："黄浦区·南京东路街道"）
    isValidShanghaiAddr(address) {
      const p = this.parseShanghaiAddr(address);
      return !!p && !!p.unit;
    },
    // 解析结构化上海地址 → { district: 区名, districtId, unit: 镇/街道全名 } | null（不合法返回 null）
    parseShanghaiAddr(address) {
      if (typeof address !== 'string') return null;
      const [district, unit] = address.split('·');
      if (!district || !unit) return null;
      const d = this.shanghaiDistrictByName(district.trim());
      if (!d || !d.units.includes(unit)) return null;
      return { district: d.name, districtId: d.id, unit };
    },
    // 组装结构化上海地址（区名 + 镇/街道全名）
    buildShanghaiAddr(districtId, unit) {
      const d = this.shanghaiDistrictById(districtId);
      if (!d || !d.units.includes(unit)) return '';
      return d.name + '·' + unit;
    },
    // 上海镇/街道坐标查询（需求五：匹配度镇间距离）；不合法/无坐标返回 null
    townCoord(districtName, unit) {
      const d = this.shanghaiTownCoords[districtName];
      if (!d || !d[unit]) return null;
      const [lat, lng] = d[unit];
      return { lat, lng };
    },
    // 由结构化地址取坐标（"黄浦区·南京东路街道" → {lat,lng} | null）
    townCoordByAddr(address) {
      const p = this.parseShanghaiAddr(address);
      return p ? this.townCoord(p.district, p.unit) : null;
    },

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
    // 单源 FIVE_FOUR_PROVINCES（shared/enums）；默认六三学制。
    isFiveFour(provinceId) {
      return FIVE_FOUR_PROVINCES.includes(provinceId);
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
export const SUFE_REGIONS = R;

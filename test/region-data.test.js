/**
 * 地区数据纯函数回归（R2-12 赋分组件修补：上海 11 等第 / 浙江 20 区间 / 政策年份分流）
 *
 * 直测 region-data.js 单源：
 *   - 上海 gradeSystems 修正为 11 等第 × 3 分（70-40，含 B-/C-，等级序列 A+..E）；
 *   - 浙江 2022 高考起新制 = 20 赋分区间（zhejiang20，I1..I20，2022.1 选考即新制，架构审计 M2 修正），
 *     zhejiang21 保留为历史档（2017-2021 高考）；
 *   - policyOf(provinceId, year?) 年份感知：改革首考年前 → 传统文理；浙江 ≤2021 → 21 档旧制；
 *     ≥2022 → 20 区间；学生端无 year → 恒最新。
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import '../region-data.js'; // 副作用导入：globalThis.SUFE_REGIONS（与服务端路由同路径）

const R = globalThis.SUFE_REGIONS;

test('上海等第制：11 等第 × 3 分 70-40（含 B-/C-）', () => {
  const sh = R.gradeSystems.shanghai;
  assert.equal(sh.levels.length, 11, '应为 11 等第（原 9 档错误）');
  assert.deepEqual(sh.levels.map(l => l.id), ['A+', 'A', 'B+', 'B', 'B-', 'C+', 'C', 'C-', 'D+', 'D', 'E']);
  assert.equal(sh.levels[0].name, 'A+（70分）');
  assert.equal(sh.levels[1].name, 'A（67分）');
  assert.equal(sh.levels[4].name, 'B-（58分）');
  assert.equal(sh.levels[10].name, 'E（40分）');
  for (let i = 1; i < sh.levels.length; i++) {
    const score = name => parseInt(name.match(/（(\d+)分/)[1], 10); // 全角括号
    assert.equal(score(sh.levels[i - 1].name) - score(sh.levels[i].name), 3, '相邻等第差 3 分');
  }
});

test('浙江 zhejiang20：20 赋分区间（第1区间 100-97 … 第20区间 42-40）', () => {
  const zj20 = R.gradeSystems.zhejiang20;
  assert.equal(zj20.levels.length, 20, '应为 20 区间（2022 起新制）');
  assert.equal(zj20.levels[0].id, 'I1');
  assert.equal(zj20.levels[0].name, '第1区间（100-97）');
  assert.equal(zj20.levels[1].name, '第2区间（96-94）');
  assert.equal(zj20.levels[18].name, '第19区间（45-43）');
  assert.equal(zj20.levels[19].id, 'I20');
  assert.equal(zj20.levels[19].name, '第20区间（42-40）');
});

test('浙江 zhejiang21：保留为历史档（21 档 100-40），非默认', () => {
  const zj21 = R.gradeSystems.zhejiang21;
  assert.equal(zj21.levels.length, 21);
  assert.equal(zj21.levels[0].id, 'L1');
  assert.equal(zj21.levels[20].name, '第21档（40分）');
  assert.equal(R.provincePolicy.zhejiang.gradeSystem, 'zhejiang20', '省份默认指向 20 区间新制');
});

test('policyOf 年份分流：浙江 2021→21档 / 2022→20区间（M2 修正）/ 2016→old / 无year→最新', () => {
  assert.equal(R.policyOf('zhejiang', 2016).type, 'old', '改革前 → 传统文理');
  assert.equal(R.policyOf('zhejiang', 2016).gradeSystem, null, 'old 无赋分制');
  assert.equal(R.policyOf('zhejiang', 2017).gradeSystemId, 'zhejiang21', '改革当年（2017）→ 21 档旧制');
  assert.equal(R.policyOf('zhejiang', 2021).gradeSystemId, 'zhejiang21', '2021 高考（2022.1 选考改革前最后一次）→ 21 档旧制');
  assert.equal(R.policyOf('zhejiang', 2022).gradeSystemId, 'zhejiang20', '2022 高考起（2022.1 选考即新制）→ 20 区间');
  assert.equal(R.policyOf('zhejiang', 2022).type, '3+3');
  assert.equal(R.policyOf('zhejiang', 2026).gradeSystemId, 'zhejiang20');
  assert.equal(R.policyOf('zhejiang').gradeSystemId, 'zhejiang20', '无 year（学生端/最新）→ 20 区间');
});

test('policyOf 年份分流：3+1+2 省份改革前回退 old（河北 2020 vs 2021）', () => {
  assert.equal(R.policyOf('hebei', 2020).type, 'old', '第四/五批省份改革前 → 传统文理');
  assert.equal(R.policyOf('hebei', 2020).gradeSystem, null);
  assert.equal(R.policyOf('hebei', 2021).type, '3+1+2', '改革首考年起 → 最新 3+1+2');
  assert.equal(R.policyOf('hebei', 2021).gradeSystemId, 'standard5', '空壳省份缺省 standard5');
  assert.equal(R.policyOf('hebei').type, '3+1+2', '无 year 恒最新');
});

test('policyOf 年份分流：上海 2016→old / 2017→11 等第；京津鲁琼 2020 起 3+3', () => {
  assert.equal(R.policyOf('shanghai', 2016).type, 'old');
  const sh = R.policyOf('shanghai', 2017);
  assert.equal(sh.gradeSystemId, 'shanghai');
  assert.equal(sh.gradeSystem.levels.length, 11, '2017 起用 11 等第');
  // 京津鲁琼 2020 起 3+3
  assert.equal(R.policyOf('beijing', 2019).type, 'old');
  assert.equal(R.policyOf('beijing', 2020).type, '3+3');
  assert.equal(R.policyOf('shandong', 2019).type, 'old');
  assert.equal(R.policyOf('shandong', 2020).gradeSystemId, 'shandong');
  assert.equal(R.policyOf('hainan', 2020).gradeSystemId, 'hainan');
});

test('policyOf：新疆/西藏恒传统文理（不受年份影响）', () => {
  assert.equal(R.policyOf('xinjiang', 2010).type, 'old');
  assert.equal(R.policyOf('xinjiang', 2026).type, 'old');
  assert.equal(R.policyOf('xizang', 2026).type, 'old');
  assert.equal(R.policyOf('xinjiang').type, 'old');
});

test('policyOf：无 year 学生端恒最新（standard5 省份 / 3+3 省份）', () => {
  assert.equal(R.policyOf('guangdong').type, '3+1+2');
  assert.equal(R.policyOf('guangdong').gradeSystemId, 'standard5');
  assert.equal(R.policyOf('shanghai').gradeSystemId, 'shanghai');
  assert.equal(R.policyOf('shanghai').gradeSystem.levels.length, 11);
});

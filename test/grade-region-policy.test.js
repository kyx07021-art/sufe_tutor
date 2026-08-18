/**
 * M3 需求发布年级-地区政策适配（B4：直接 import ESM）。
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { SUFE_REGIONS } from '../src/client/constants/region-data.js';
import { STUDENT_GRADES } from '../src/shared/enums.js';
import { gradeOptionsForProvince } from '../src/client/features/student/actions.js';
import { studentGradeName } from '../src/client/features/student/display.js';

test('M3 年级常量：STUDENT_GRADES 含 p6 与 prep', () => {
  const ids = STUDENT_GRADES.map(g => g.id);
  assert.ok(ids.includes('p6') && ids.includes('prep'), '含小学六年级与预备班');
  assert.ok(ids.includes('p5') && ids.includes('junior1'), '上下文顺序完整');
});

test('M3 学制单源：上海为五四学制，其余默认六三', () => {
  assert.equal(SUFE_REGIONS.isFiveFour('shanghai'), true, '上海五四学制');
  assert.equal(SUFE_REGIONS.isFiveFour('beijing'), false, '北京六三学制');
  assert.equal(SUFE_REGIONS.isFiveFour('zhejiang'), false, '浙江六三学制');
});

test('M3 年级选项按地区', () => {
  const shIds = gradeOptionsForProvince('shanghai').map(g => g.id);
  assert.ok(!shIds.includes('p6'), '上海无小学六年级');
  assert.ok(shIds.includes('prep'), '上海六年级=预备班');
  const bjIds = gradeOptionsForProvince('beijing').map(g => g.id);
  assert.ok(bjIds.includes('p6'), '北京有小学六年级');
  assert.ok(!bjIds.includes('prep'), '北京无预备班');
  assert.ok(gradeOptionsForProvince('').length > 0, '空地区兜底');
});

test('M3 预备班=初中阶段', () => {
  assert.equal(SUFE_REGIONS.stageOfGrade('prep'), 'middle', '预备班归初中阶段');
  assert.deepEqual(SUFE_REGIONS.subjectsFor('shanghai', 'prep'), SUFE_REGIONS.subjectsFor('shanghai', 'junior1'), '预备班与初一科目池一致');
  assert.deepEqual(SUFE_REGIONS.subjectsFor('beijing', 'p6'), SUFE_REGIONS.subjectsFor('beijing', 'p5'), '小学六年级科目池同小学阶段');
});

test('M3 年级显示映射', () => {
  assert.equal(studentGradeName('prep'), '预备班');
  assert.equal(studentGradeName('p6'), '小学六年级');
});

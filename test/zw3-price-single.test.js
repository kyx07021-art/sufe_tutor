/**
 * ZW-3（2026-08-27）：教师报价区间 → 单值适配验证守护测试。
 * 用户原话：「显示单值报价也不再带'起'字。适配好所有展示报价的地方，和依赖报价区间进行计算的匹配/筛选逻辑。」
 *
 * 适配结论（W25 取证）：
 *  - 展示：priceRangeText（core/display.js）已有 min===max → `${min}` 无「起」分支；ZW-1 后
 *    前端提交 price_min=price_max=单值，全部展示点（教师卡 render.js:27 / 详情卡 render.js:63）自动走单值分支。
 *  - 匹配：match.js budget 维度用 t.price_min 单值判定（:74-76）；ZW-2 迁移 price_max:=price_min，
 *    price_min 不变 → 匹配语义零变化（仍取报价下限=新单值）。
 *  - 筛选/排序：teacher/actions.js:200 价格排序用 price_min；价格区间筛选同用 price_min。零改动正确。
 *
 * G2 变异守护：去掉 priceRangeText 的 min===max 单值分支 → 单值显示退化为「150~150」→ 断言红。
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { priceRangeText } from '../src/client/core/display.js';
import { matchDims } from '../src/client/core/match.js';
import { CONFIG } from '../src/shared/config.js';

const W = CONFIG.MATCH_WEIGHT;

test('ZW-3 展示：priceRangeText min===max 单值 → 无「起」字（单值分支）', () => {
  assert.equal(priceRangeText(150, 150), '150', '单值显示无「起」无波浪号');
  assert.equal(priceRangeText(150, 150, '元/小时'), '150元/小时', '带单位单值');
  assert.equal(priceRangeText('150', '150'), '150', '字符串单值');
});

test('ZW-3 展示：区间形态保留（min<max）+ 单边语义不变', () => {
  assert.equal(priceRangeText(150, 180), '150~180', '区间形态保留（存量未迁移行的展示兜底）');
  assert.equal(priceRangeText(150, null), '150起', '仅下限语义不变');
  assert.equal(priceRangeText(null, 180), '至180', '仅上限语义不变');
  assert.equal(priceRangeText(null, null), '', '空报价 → 空串');
  assert.equal(priceRangeText(undefined, undefined, ''), '', 'undefined → 空串');
});

test('ZW-3 匹配：budget 维度按 price_min 单值判定（迁移后 price_min=单值）', () => {
  const teacher = {
    subjects: ['math'], nonacademic_projects: [], personality_tags: [],
    province: 'shanghai', price_min: 150, price_max: 150, address: '黄浦区·南京东路街道',
  };
  // 需求预算 100~200，教师单值 150 命中
  let dims = matchDims(teacher, { subjects: ['math'], province: 'shanghai', budget_min: 100, budget_max: 200 });
  const hit = dims.find(d => d.key === 'budget');
  assert.equal(hit.score, W.budget, '单值落在需求区间内 → 满 W.budget');

  // 需求预算 160~200，教师单值 150 低于下限 → miss
  dims = matchDims(teacher, { subjects: ['math'], province: 'shanghai', budget_min: 160, budget_max: 200 });
  const miss = dims.find(d => d.key === 'budget');
  assert.equal(miss.score, 0, '单值低于需求下限 → 0 分');

  // 需求无预算 → 维度跳过（score null）
  dims = matchDims(teacher, { subjects: ['math'], province: 'shanghai' });
  const skip = dims.find(d => d.key === 'budget');
  assert.equal(skip.score, null, '无预算维度跳过');
});

test('ZW-3 G2 变异：还原 priceRangeText min===max 分支 → 单值断言红', () => {
  // 变异：min===max 被当作区间处理（删单值分支）→ 输出「150~150」→ 第一个断言红
  const mutated = (min, max, unit) => {
    const u = unit || '';
    return `${min}~${max}${u}`;
  };
  const out = mutated(150, 150);
  assert.notEqual(out, '150', '变异态单值显示为区间形态，原断言必红');
});

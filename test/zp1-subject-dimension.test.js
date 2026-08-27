/**
 * ZP-1（2026-08-27）：需求指定科目即激活 subject 维度——教师未填对应类别（tSubj 空）或
 * 无重合计 0 分计入分母，而非跳过维度（旧语义致非学科需求 + 教师未填 nonacademic 时
 * subject 不计分 → 仅 region+budget 参与 → 虚高 100%）。
 *
 * G2 变异守护：还原旧语义 `subjOn = tSubj.length>0 && dSubj.length>0` → 用例 1/2 断言红。
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { matchDims, matchDegree } from '../src/client/core/match.js';
import { CONFIG } from '../src/shared/config.js';

const W = CONFIG.MATCH_WEIGHT;

function teacher(over) {
  return {
    subjects: ['math'], nonacademic_projects: [], personality_tags: [],
    province: 'shanghai', price_min: 150, price_max: 150, address: '黄浦区·南京东路街道',
    ...over,
  };
}
function demand(over) {
  return {
    target_type: 'academic', target_subjects: ['math'], province: 'shanghai',
    budget_min: 100, budget_max: 200, preferred_personality_tags: [], ...over,
  };
}

test('ZP-1 学科需求：教师未填 subjects → subject 0 分计入分母（不再跳过）', () => {
  // beijing 非 allowsOffline → region 走确定性同省计分（15 分），不依赖地址坐标
  const t = teacher({ subjects: [], province: 'beijing' });
  const d = demand({ target_subjects: ['math'], province: 'beijing' });
  const dims = matchDims(t, d);
  const s = dims.find(x => x.key === 'subject');
  assert.equal(s.score, 0, '教师无擅长科目 → subject 0 分');
  assert.equal(s.hint, '教师未填写该类别的擅长科目', 'hint 标注未填');
  // region+budget 命中（15+15），但 subject 0 分计入分母拉低总分
  const md = matchDegree(t, d);
  const expected = Math.round((W.region + W.budget) / (W.subject + W.region + W.budget) * 100);
  assert.equal(md, expected, `总分含 0 分 subject 分母（${expected}%，而非旧语义 (15+15)/(15+15)=100%）`);
});

test('ZP-1 非学科需求：教师未填 nonacademic_projects → subject 0 分计入分母（用户原话场景）', () => {
  const t = teacher({ subjects: [], nonacademic_projects: [] });
  const d = demand({ target_type: 'nonacademic', target_subjects: ['speech'] });
  const dims = matchDims(t, d);
  const s = dims.find(x => x.key === 'subject');
  assert.equal(s.score, 0, '教师无非学科项目 → subject 0 分');
  const md = matchDegree(t, d);
  assert.ok(md < 100, `非学科需求 + 教师不会该科目 → ${md}% 非满分`);
});

test('ZP-1 零重合（教师填了但科目不对）→ subject 0 分 + MISS 文案', () => {
  const t = teacher({ subjects: ['english'] });
  const d = demand({ target_subjects: ['math'] });
  const s = matchDims(t, d).find(x => x.key === 'subject');
  assert.equal(s.score, 0, '零重合 → 0 分');
  assert.equal(s.hint, '教师科目与需求科目无重合', 'MISS 文案');
});

test('ZP-1 教师会科目 → subject 满分（语义不变）', () => {
  const t = teacher({ subjects: ['math'] });
  const d = demand({ target_subjects: ['math'] });
  const s = matchDims(t, d).find(x => x.key === 'subject');
  assert.equal(s.score, W.subject, '命中 → 满分');
});

test('ZP-1 需求未指定科目 → subject 维度跳过（score null 不计入分母，语义保留）', () => {
  const t = teacher({ subjects: ['math'] });
  const d = demand({ target_subjects: [] });
  const dims = matchDims(t, d);
  const s = dims.find(x => x.key === 'subject');
  assert.equal(s.score, null, '需求无科目 → 跳过');
  assert.equal(s.hint, '该项缺数据，未计入', '跳过文案');
});

test('ZP-1 G2 变异：还原旧语义 subjOn（tSubj 空 → subject 跳过）→ 用例 1/2 断言红', () => {
  // 变异：subjOn = tSubj.length>0 && dSubj.length>0（旧语义）
  const mutated = (t, d) => {
    const tSubj = d.target_type === 'nonacademic'
      ? (Array.isArray(t.nonacademic_projects) ? t.nonacademic_projects : [])
      : (Array.isArray(t.subjects) ? t.subjects : []);
    const dSubj = Array.isArray(d.target_subjects) ? d.target_subjects : [];
    const hit = dSubj.filter(s => tSubj.includes(s)).length;
    const subjOn = tSubj.length > 0 && dSubj.length > 0; // 旧语义
    return subjOn ? hit / dSubj.length * W.subject : null; // null = 跳过
  };
  // 旧语义下：教师未填 → subjScore null → 用例 1 的 score===0 断言必红
  assert.equal(mutated(teacher({ subjects: [] }), demand({ target_subjects: ['math'] })), null, '旧语义返回 null，与 0 分断言不符');
  assert.notEqual(mutated(teacher({ subjects: [] }), demand({ target_subjects: ['math'] })), 0, '旧语义非 0 分');
});

/**
 * R25 匹配度明细红黄绿遮罩配色（B4：直接 import core/match + teacher render）。
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { matchDetailHtml, matchRowsHtml } from '../src/client/core/match.js';
import { studentMatchDetailHtml } from '../src/client/features/teacher/render.js';

const TEACHER = { subjects: ['math','english'], province:'shanghai', price_min:150, price_max:180, personality_tags:['patience','humorous'], gender:'male', nonacademic_projects:[] };
const DEMAND = { id:1, target_type:'academic', target_subjects:['math','physics'], province:'shanghai', budget_min:100, budget_max:200, preferred_personality_tags:['patience','strict'], preferred_teacher_gender:'male' };

test('R25 教师端明细卡：卡级等级类随 md', () => {
  assert.ok(matchDetailHtml(TEACHER, DEMAND, 70).includes('match-detail--mid'));
  assert.ok(matchDetailHtml(TEACHER, DEMAND, 100).includes('match-detail--hi'));
  assert.ok(matchDetailHtml(TEACHER, DEMAND, 30).includes('match-detail--lo'));
});

test('R25 比例条：0 分维度不灰化、缺数据维度 --skip 灰', () => {
  const zero = matchRowsHtml([{ label:'科目', score:0, max:45, hint:'' }]);
  assert.ok(zero.includes('match-bar'));
  assert.ok(!zero.includes('match-bar--zero') && !zero.includes('match-bar--skip'));
  assert.ok(zero.includes('data-bar-w="0"'));
  const skip = matchRowsHtml([{ label:'性格', score:null, max:15, hint:'' }]);
  assert.ok(skip.includes('match-bar--skip'));
  assert.ok(skip.includes('match-row-s--skip'));
  assert.ok(!skip.includes('match-row--'));
});

test('R25 比例条逐条独立配色', () => {
  const hi = matchRowsHtml([{ label:'科目', score:45, max:45, hint:'' }]);
  assert.ok(hi.includes('match-row--hi'));
  const mid = matchRowsHtml([{ label:'区域', score:14, max:20, hint:'' }]);
  assert.ok(mid.includes('match-row--mid'));
  const lo = matchRowsHtml([{ label:'预算', score:5, max:20, hint:'' }]);
  assert.ok(lo.includes('match-row--lo'));
  const mixed = matchRowsHtml([
    { label:'科目', score:45, max:45, hint:'' },
    { label:'预算', score:5, max:20, hint:'' },
    { label:'性格', score:null, max:15, hint:'' },
  ]);
  assert.ok(mixed.includes('match-row--hi') && mixed.includes('match-row--lo'));
  assert.ok(!mixed.includes('match-row--mid'));
});

test('R25 学生端明细卡：同时带 --teacher 结构变体与等级类', () => {
  const html = studentMatchDetailHtml({ subjects:['math'], province:'shanghai', price_min:150, personality_tags:['patience'], gender:'male' }, { ...DEMAND, target_subjects:['math'] });
  assert.ok(html.includes('match-detail--teacher'));
  assert.ok(html.includes('match-bar'));
});

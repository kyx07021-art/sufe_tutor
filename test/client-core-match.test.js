/**
 * B1 match core：五维匹配纯函数。无 DOM/网络依赖，直接导入验证。
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { CONFIG } from '../src/shared/config.js';
import { DEMAND_TYPES } from '../src/shared/enums.js';
import {
  genderMatchScore, haversineKm, distanceScore,
  matchDims, matchDegree, matchLevel, matchRowsHtml, applyBarWidths,
} from '../src/client/core/match.js';

const W = CONFIG.MATCH_WEIGHT;
const SH = { lat: 31.2304, lng: 121.4737 };

function teacher(overrides = {}) {
  return {
    subjects: ['math', 'physics'],
    nonacademic_projects: [],
    personality_tags: ['patient', 'strict'],
    gender: 'male',
    province: 'shanghai',
    price_min: 100,
    address: '黄浦区·南京东路街道',
    ...overrides,
  };
}

function demand(overrides = {}) {
  return {
    target_type: DEMAND_TYPES.ACADEMIC,
    target_subjects: ['math', 'physics'],
    preferred_personality_tags: ['patient'],
    teaching_method: 'offline',
    province: 'shanghai',
    address: '黄浦区·南京东路街道',
    budget_min: 80,
    budget_max: 200,
    preferred_teacher_gender: 'male',
    ...overrides,
  };
}

test('genderMatchScore：无偏好满分；未披露中性分；不一致零分', () => {
  assert.equal(genderMatchScore('', 'male'), 100);
  assert.equal(genderMatchScore('female', 'undeclared'), CONFIG.GENDER_MATCH_UNDISCLOSED);
  assert.equal(genderMatchScore('female', 'nonbinary'), CONFIG.GENDER_MATCH_UNDISCLOSED);
  assert.equal(genderMatchScore('female', 'male'), 0);
});

test('haversineKm/distanceScore：同点 0；超上限 0；范围内线性衰减', () => {
  const same = { lat: 31.23, lng: 121.47 };
  assert.ok(haversineKm(same, { ...same }) < 1e-6);
  assert.equal(haversineKm(null, same), Infinity);
  assert.equal(distanceScore(Infinity), 0);
  assert.equal(distanceScore(0), 1);
  assert.equal(distanceScore(CONFIG.MATCH_DISTANCE_MAX_KM), 0);
  assert.equal(distanceScore(CONFIG.MATCH_DISTANCE_MAX_KM / 2), 0.5);
});

test('matchDims：五维全开全中的完美维度与空维度语义', () => {
  const dims = matchDims(teacher(), demand());
  const by = Object.fromEntries(dims.map(d => [d.key, d]));
  assert.equal(by.subject.score, W.subject);
  assert.equal(by.personality.score, W.personality);
  assert.equal(by.region.score, W.region);
  assert.equal(by.budget.score, W.budget);
  assert.equal(by.gender.score, W.gender);
  assert.equal(by.region.max, W.region);

  const partial = matchDims(teacher({ price_min: null }), demand({ preferred_teacher_gender: 'female' }));
  const pb = Object.fromEntries(partial.map(d => [d.key, d]));
  assert.equal(pb.budget.score, null, '教师未报价维度不参与计分');
  assert.equal(pb.gender.score, 0, '性别不一致计 0 而非 null');
});

test('matchDims：非学科需求按项目/兴趣映射；线上无区域分', () => {
  const dims = matchDims(
    teacher({ nonacademic_projects: ['speech', 'career'], subjects: [] }),
    demand({
      target_type: DEMAND_TYPES.NONACADEMIC,
      target_subjects: ['speech'],
      preferred_personality_tags: [],
      teaching_method: 'online',
      budget_min: null, budget_max: null,
      preferred_teacher_gender: '',
    }),
  );
  const by = Object.fromEntries(dims.map(d => [d.key, d]));
  assert.equal(by.subject.score, W.subject, '非学科命中非学科项目');
  assert.equal(by.region.score, null, '线上单无区域维度');
  assert.equal(by.budget.score, null);
  assert.equal(by.personality.score, null);
});

test('matchDegree：完美 100；维度缺失按参与维度归一；无匹配 0；无维度 null', () => {
  assert.equal(matchDegree(teacher(), demand()), 100);
  assert.equal(matchDegree(teacher({ price_min: null, subjects: [] }), demand({ target_subjects: ['math'], budget_min: null, budget_max: null, teaching_method: 'online', preferred_personality_tags: [], preferred_teacher_gender: 'female' })), 0);
  assert.equal(matchDegree(null, demand()), null);
  assert.equal(matchDegree(teacher(), null), null);
});

test('matchLevel 阈值与 matchRowsHtml 输出', () => {
  assert.equal(matchLevel(85), 'hi');
  assert.equal(matchLevel(70), 'mid');
  assert.equal(matchLevel(59), 'lo');
  const html = matchRowsHtml([
    { label: 'subject', score: 45, max: 45 },
    { label: 'region', score: null, max: 15 },
    { label: 'gender', score: 5, max: 10 },
  ]);
  assert.ok(html.includes('match-row--hi'));
  assert.ok(html.includes('match-row--lo'));
  assert.ok(html.includes('>45/45<'));
  assert.ok(html.includes('该项缺数据，未计入'), '缺失维度显示占位');
});

test('applyBarWidths writes data-bar-w to --bar-w', () => {
  const host = { innerHTML: matchRowsHtml([{ label: 'subject', score: 30, max: 45 }]) };
  host.querySelectorAll = sel => Array.from(host.innerHTML.matchAll(/<i data-bar-w="([^"]+)"/g)).map(m => ({ dataset: { barW: m[1] }, style: { setProperty: (k, v) => { host.css = v; } } }));
  applyBarWidths(host);
  assert.equal(host.css, '67%');
});

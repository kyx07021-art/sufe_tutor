/**
 * S4-13..20 match-degree server module unit tests (pure functions).
 *
 * Covers: weights single-source (S4-13), C3 input normalization (S4-14), the five
 * dimensions subject/method/region/price/preference (S4-15..19) and the aggregator
 * matchDegree + I-32 matchCount (S4-20).
 *
 * Every assertion pins a concrete numeric value, so a mutation in the implementation
 * (a deleted weight, a loosened normalization, a removed clamp, a flipped method-matrix
 * cell, a removed distance clamp) turns the test red — G2 mutation guarding. The
 * fixtures below are chosen so that EACH dimension contributes a distinct partial score.
 *
 * Weights (shared/config MATCH_WEIGHTS): subject 35, region 25, budget 20, method 10,
 * personality 5, gender 5 (sum 100).
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  matchDegree, matchCount, matchDimensions,
  normalizeTeacher, normalizeDemand, haversineKm, distanceScore,
} from '../src/server/domains/teacher/match/index.js';
import { WEIGHTS } from '../src/server/domains/teacher/match/weights.js';

// Full-hit teacher: every dimension scores max (except personality hits 1/2).
const FULL_TEACHER = {
  subjects: ['math', 'physics'],
  province: 'shanghai',
  address: '嘉定区·嘉定镇街道',
  price_min: 150, price_max: 180,
  teaching_method: 'offline',
  personality_tags: ['patience', 'humorous'],
  gender: 'male',
};
const FULL_DEMAND = {
  subject: 'math',
  province: 'shanghai',
  address: '嘉定区·嘉定镇街道',
  teaching_method: 'offline',
  budget_min: 100, budget_max: 200,
  preferred_personality_tags: ['patience', 'strict'],
  preferred_teacher_gender: 'male',
};

// All-miss teacher: subject/method/region/price/personality/gender all mismatch.
const MISS_TEACHER = {
  subjects: ['english'],
  province: 'beijing',
  price_min: 200, price_max: 250,
  teaching_method: 'online',
  personality_tags: [],
  gender: 'female',
};

// ---- S4-13: weights single source -----------------------------------------
test('weights are the new-model values (sum 100, method dimension present)', () => {
  assert.deepEqual(WEIGHTS, { subject: 35, region: 25, budget: 20, method: 10, personality: 5, gender: 5 });
  assert.equal(Object.values(WEIGHTS).reduce((a, b) => a + b, 0), 100, 'weights sum to 100');
  // mutation: if the subject weight regressed to the v2 value (45) the 98 fixture below changes -> red
});

// ---- S4-14: C3 normalization ----------------------------------------------
test('normalizeTeacher collapses every missing shape to typed defaults', () => {
  assert.deepEqual(normalizeTeacher({}), {
    subjects: [], nonacademic: [], province: '', address: '', priceMin: null, priceMax: null,
    method: '', personalityTags: [], gender: '',
  });
  assert.deepEqual(normalizeTeacher({ price_min: 0, subjects: ['a'], nonacademic_projects: ['music'] }),
    { subjects: ['a'], nonacademic: ['music'], province: '', address: '', priceMin: 0, priceMax: null,
      method: '', personalityTags: [], gender: '' });
  // camelCase new-API shape and garbage numerics
  assert.equal(normalizeTeacher({ priceMin: 150, priceMax: 180, teachingMethod: 'both', personalityTags: ['x'] }).priceMin, 150);
  assert.equal(normalizeTeacher({ priceMin: 'bad', priceMax: Infinity, gender: null }).priceMin, null);
});

test('normalizeDemand accepts new single-subject and legacy target_subjects shapes', () => {
  assert.deepEqual(normalizeDemand({}), {
    subject: '', province: '', address: '', method: '', budgetMin: null, budgetMax: null,
    preferredTags: [], preferredGender: '',
  });
  assert.equal(normalizeDemand({ subject: 'math', addressArea: '嘉定区·嘉定镇街道', budgetMin: 100 }).subject, 'math');
  assert.equal(normalizeDemand({ subject: '', target_subjects: ['physics'] }).subject, 'physics');
  assert.equal(normalizeDemand({ budgetMin: 'x', preferredTags: 'oops' }).budgetMin, null);
});

// ---- S4-15: subject dimension ---------------------------------------------
test('subject: hit full / no subject excludes the dim / no teacher subjects excludes', () => {
  assert.equal(matchDegree(FULL_TEACHER, { ...FULL_DEMAND, subject: 'physics' }), 98, 'either teacher subject hits');
  // no demand subject -> dim excluded; remaining weight 65, score 62.5 -> 96
  assert.equal(matchDegree(FULL_TEACHER, { ...FULL_DEMAND, subject: '' }), 96);
  // teacher has no subjects at all -> dim excluded (not penalized to 0)
  assert.equal(matchDegree({ ...FULL_TEACHER, subjects: [] }, FULL_DEMAND), 96);
});

// ---- S4-16: method dimension ----------------------------------------------
test('method matrix: online-only teacher vs offline demand lowers score', () => {
  // method 0 -> (35+25+20+2.5+5)/100 = 87.5 -> 88
  assert.equal(matchDegree({ ...FULL_TEACHER, teaching_method: 'online' }, FULL_DEMAND), 88);
  // demand accepts both -> any declared teacher method hits
  assert.equal(matchDegree(FULL_TEACHER, { ...FULL_DEMAND, teaching_method: 'both' }), 98);
  // teacher with no declared method -> dim excluded (not penalized); 87.5/90 -> 97
  assert.equal(matchDegree({ ...FULL_TEACHER, teaching_method: '' }, FULL_DEMAND), 97);
});

// ---- S4-17: region dimension ----------------------------------------------
test('region: same town full / near town partial / >20km zero / online excludes / other province miss', () => {
  assert.equal(matchDegree(FULL_TEACHER, { ...FULL_DEMAND, address: '嘉定区·南翔镇' }), 83, '~11.5km linear decay');
  assert.equal(matchDegree(FULL_TEACHER, { ...FULL_DEMAND, address: '崇明区·城桥镇' }), 73, 'far town region 0');
  // demand online -> region excluded, but method online-vs-offline misses -> 83
  assert.equal(matchDegree(FULL_TEACHER, { ...FULL_DEMAND, teaching_method: 'online', address: '嘉定区·南翔镇' }), 83);
  // different province -> region 0
  assert.equal(matchDegree(FULL_TEACHER, { ...FULL_DEMAND, province: 'jiangsu' }), 73);
});

test('haversineKm / distanceScore pure functions', () => {
  assert.equal(distanceScore(0), 1);
  assert.equal(distanceScore(10), 0.5);
  assert.equal(distanceScore(20), 0);
  assert.equal(distanceScore(30), 0);
  const km = haversineKm({ lat: 31.24050, lng: 121.46450 }, { lat: 31.31060, lng: 121.46026 });
  assert.ok(Math.abs(km - 7.81) < 0.2, `known distance ${km.toFixed(2)}`);
});

// ---- S4-18: price dimension -----------------------------------------------
test('price: full overlap / partial overlap / no overlap / absent sides exclude', () => {
  // full overlap [100,200] x [150,180]
  assert.equal(matchDegree(FULL_TEACHER, FULL_DEMAND), 98);
  // partial overlap: budget [160,190] overlaps teacher [150,180] by 20/30 -> 0.667 -> score lower
  assert.equal(matchDegree(FULL_TEACHER, { ...FULL_DEMAND, budget_min: 160, budget_max: 190 }), 91);
  // no overlap: budget [1,50] vs [150,180]
  assert.equal(matchDegree(FULL_TEACHER, { ...FULL_DEMAND, budget_min: 1, budget_max: 50 }), 78);
  // demand no budget -> dim excluded
  assert.equal(matchDegree(FULL_TEACHER, { ...FULL_DEMAND, budget_min: null, budget_max: null }), 97);
  // teacher no price -> dim excluded
  assert.equal(matchDegree({ ...FULL_TEACHER, price_min: null, price_max: null }, FULL_DEMAND), 97);
});

// ---- S4-19: preference dimension ------------------------------------------
test('preference: personality hit-ratio / no tags / undisclosed gender / mismatch', () => {
  // personality 1/2 of 5 = 2.5 -> 98 (full-hit fixture)
  assert.equal(matchDegree(FULL_TEACHER, FULL_DEMAND), 98);
  // teacher no personality tags -> personality 0
  assert.equal(matchDegree({ ...FULL_TEACHER, personality_tags: [] }, FULL_DEMAND), 95);
  // demand no preferred tags -> personality dim excluded
  assert.equal(matchDegree(FULL_TEACHER, { ...FULL_DEMAND, preferred_personality_tags: [] }), 100);
  // teacher undisclosed gender -> 0.5 of 5 = 2.5
  assert.equal(matchDegree({ ...FULL_TEACHER, gender: 'undeclared' }, FULL_DEMAND), 95);
  // gender mismatch -> 0
  assert.equal(matchDegree({ ...FULL_TEACHER, gender: 'female' }, FULL_DEMAND), 93);
  // demand no gender preference -> dim excluded
  assert.equal(matchDegree(FULL_TEACHER, { ...FULL_DEMAND, preferred_teacher_gender: '' }), 97);
});

// ---- S4-20: aggregator clamp / null semantics -----------------------------
test('matchDegree: never exceeds 100, never below 0, null when no input', () => {
  assert.equal(matchDegree(FULL_TEACHER, FULL_DEMAND), 98, 'max possible is 100');
  assert.equal(matchDegree(MISS_TEACHER, FULL_DEMAND), 0, 'full miss is 0 (clamp floor)');
  assert.equal(matchDegree(FULL_TEACHER, null), null, 'missing demand -> null');
  assert.equal(matchDegree(null, FULL_DEMAND), null, 'missing teacher -> null');
  assert.equal(matchDegree({}, {}), null, 'no applicable dimension -> null');
});

test('matchCount (I-32): subject/gender/personality/price screening hits', () => {
  assert.equal(matchCount(FULL_TEACHER, FULL_DEMAND), 4, 'all four screening dims hit');
  assert.equal(matchCount(MISS_TEACHER, FULL_DEMAND), 1, 'price boundary-only counts as a hit');
  assert.equal(matchCount(FULL_TEACHER, { ...FULL_DEMAND, preferred_teacher_gender: '' }), 3, 'no gender pref -> 3');
  assert.equal(matchCount(FULL_TEACHER, { ...FULL_DEMAND, preferred_personality_tags: [] }), 3, 'no personality pref -> 3');
  assert.equal(matchCount(FULL_TEACHER, { ...FULL_DEMAND, budget_min: null, budget_max: null }), 3, 'no budget -> 3');
  assert.equal(matchCount(FULL_TEACHER, null), 0, 'no demand -> 0');
});

test('matchDimensions exposes every dimension with normalized inputs', () => {
  const dims = matchDimensions(FULL_TEACHER, FULL_DEMAND);
  const keys = dims.map(d => d.key);
  assert.deepEqual(keys, ['subject', 'method', 'region', 'price', 'personality', 'gender']);
  const w = Object.fromEntries(dims.map(d => [d.key, d.weight]));
  assert.deepEqual(w, { subject: 35, method: 10, region: 25, price: 20, personality: 5, gender: 5 });
});

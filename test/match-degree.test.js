/**
 * 需求五·匹配度优化单测（B4：直接 import core/teacher ESM）。
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { JSDOM } from 'jsdom';
import { matchDegree, genderMatchScore, matchLevel, matchDims, haversineKm, distanceScore, matchDetailHtml, matchRowsHtml } from '../src/client/core/match.js';
import { genderName } from '../src/client/core/display.js';
import { attachStudentMatch, sortTeachers, showTeacherMatchDetail, closeMatchDetail } from '../src/client/features/teacher/actions.js';
import { renderTeacherCard, setStudentOpenDemand } from '../src/client/features/teacher/render.js';
import { state } from '../src/client/core/state.js';
import { _dhResetForTests, dhInvalidateAll } from '../src/client/core/datahub.js';
import { CONFIG } from '../src/shared/config.js';

const TEACHER = { subjects: ['math', 'english'], province: 'shanghai', price_min: 150, price_max: 180,
  personality_tags: ['patience', 'humorous'], gender: 'male', nonacademic_projects: [],
  address: '嘉定区·嘉定镇街道' };
const DEMAND = { id: 1, target_type: 'academic', target_subjects: ['math', 'physics'], province: 'shanghai',
  budget_min: 100, budget_max: 200, preferred_personality_tags: ['patience', 'strict'], preferred_teacher_gender: 'male',
  teaching_method: 'offline', address: '嘉定区·嘉定镇街道' };

test('matchDegree 五维综合（全命中口径）', () => {
  assert.equal(matchDegree(TEACHER, DEMAND), 70);
});

test('matchDegree 性别：教师 nonbinary（不愿透露）对明确偏好折半 50', () => {
  assert.equal(matchDegree({ ...TEACHER, gender: 'nonbinary' }, DEMAND), 65);
  assert.equal(matchDegree({ ...TEACHER, gender: '' }, DEMAND), 65);
  assert.equal(matchDegree({ ...TEACHER, gender: 'female' }, DEMAND), 60);
  assert.equal(matchDegree(TEACHER, { ...DEMAND, preferred_teacher_gender: '' }), 70);
});

test('matchDegree 性格：需求无偏好 → 维度不适用；教师无 tag → 0；全中更高', () => {
  assert.equal(matchDegree(TEACHER, { ...DEMAND, preferred_personality_tags: [] }), 74);
  assert.equal(matchDegree({ ...TEACHER, personality_tags: [] }, DEMAND), 63);
  assert.equal(matchDegree({ ...TEACHER, personality_tags: ['patience', 'strict'] }, DEMAND), 78);
});

test('genderMatchScore 单点口径（undeclared 同 nonbinary 未披露）', () => {
  assert.equal(genderMatchScore('', 'male'), 100);
  assert.equal(genderMatchScore('', 'nonbinary'), 100);
  assert.equal(genderMatchScore('', 'undeclared'), 100);
  assert.equal(genderMatchScore('male', 'male'), 100);
  assert.equal(genderMatchScore('male', 'female'), 0);
  assert.equal(genderMatchScore('male', 'nonbinary'), 50);
  assert.equal(genderMatchScore('male', 'undeclared'), 50);
  assert.equal(genderMatchScore('female', ''), 50);
});

test('genderName：undeclared/非binary/空 一律不显字，仅男/女出字', () => {
  assert.equal(genderName('undeclared'), '');
  assert.equal(genderName('nonbinary'), '');
  assert.equal(genderName(''), '');
  assert.equal(genderName('male'), '男');
  assert.equal(genderName('female'), '女');
});

test('matchLevel 三色阈值', () => {
  assert.equal(matchLevel(100), 'hi');
  assert.equal(matchLevel(80), 'hi');
  assert.equal(matchLevel(79), 'mid');
  assert.equal(matchLevel(60), 'mid');
  assert.equal(matchLevel(59), 'lo');
  assert.equal(matchLevel(0), 'lo');
});

test('matchDetailHtml：五维行齐全 + 计分口径内嵌当前权重', () => {
  const html = matchDetailHtml(TEACHER, DEMAND, 70);
  for (const k of ['科目匹配', '性格匹配', '区域匹配', '预算匹配', '性别匹配']) assert.ok(html.includes(k), `明细应含 ${k}`);
  assert.ok(html.includes(`科目 ${CONFIG.MATCH_WEIGHT.subject} 分`), '计分口径应含科目权重');
  assert.ok(html.includes(`性格 ${CONFIG.MATCH_WEIGHT.personality} 分`), '计分口径应含性格权重');
  assert.ok(html.includes(`性别 ${CONFIG.MATCH_WEIGHT.gender} 分`), '计分口径应含性别权重');
  assert.ok(html.includes('命中 1/2 个偏好性格'), '性格命中提示');
  assert.ok(html.includes('match-row'), '明细行结构');
});

test('matchDims 上海线下：同镇 → 满分；镇间距离线性；>20km 0；线上跳过；未填跳过；非上海同省/异省', () => {
  const region = matchDims(TEACHER, DEMAND).find(d => d.key === 'region');
  assert.equal(region.score, 15);
  assert.ok(region.hint.includes('零距离'));
  const near = matchDims(TEACHER, { ...DEMAND, address: '嘉定区·南翔镇' }).find(d => d.key === 'region');
  assert.ok(Math.abs(near.score - 6.38) < 0.05, `11.49km 线性计分 → ${near.score}`);
  assert.ok(near.hint.includes('距授课点约 11 公里'));
  const far = matchDims(TEACHER, { ...DEMAND, address: '崇明区·城桥镇' }).find(d => d.key === 'region');
  assert.equal(far.score, 0);
  assert.ok(far.hint.includes('公里'));
  const online = matchDims(TEACHER, { ...DEMAND, teaching_method: 'online' }).find(d => d.key === 'region');
  assert.equal(online.score, null);
  assert.ok(online.hint.includes('线上授课'));
  const noAddr = matchDims({ ...TEACHER, address: '' }, DEMAND).find(d => d.key === 'region');
  assert.equal(noAddr.score, null);
  assert.ok(noAddr.hint.includes('未填上海常住地'));
  const same = matchDims({ ...TEACHER, province: 'beijing' }, { ...DEMAND, province: 'beijing' }).find(d => d.key === 'region');
  assert.equal(same.score, 15);
  const diff = matchDims({ ...TEACHER, province: 'beijing' }, { ...DEMAND, province: 'jiangsu' }).find(d => d.key === 'region');
  assert.equal(diff.score, 0);
});

test('haversineKm/distanceScore 纯函数：0 / 边界 / 超限 / 已知距离', () => {
  assert.equal(distanceScore(0), 1);
  assert.equal(distanceScore(20), 0);
  assert.equal(distanceScore(30), 0);
  assert.equal(distanceScore(10), 0.5);
  const km = haversineKm({lat:31.24050,lng:121.46450},{lat:31.31060,lng:121.46026});
  assert.ok(Math.abs(km - 7.81) < 0.2, `南京东路→临汾路 ${km.toFixed(2)}km ≈ 7.81`);
});

function setupDom() {
  _dhResetForTests();
  const dom = new JSDOM('<!DOCTYPE html><html><body><div id="teachers-list"></div></body></html>', { url: 'http://localhost/', pretendToBeVisual: true });
  globalThis.document = dom.window.document;
  globalThis.window = dom.window;
  globalThis.MutationObserver = class { observe() {} disconnect() {} takeRecords() { return []; } };
  state.user = null;
  return dom;
}
function teardownDom() { delete globalThis.document; delete globalThis.window; delete globalThis.MutationObserver; }

test('学生端教师列表：逐需求取最高匹配值、明细降序、排序与卡徽章', async () => {
  const dom = setupDom();
  state.user = { id: 50, username: '学生S', role: 'student' };
  const T_HIGH = { user_id: 1, username: 'T高', subjects: ['math'], province: 'shanghai', price_min: 150, personality_tags: ['patience'], gender: 'male', avatar: '', rating: 5, address: '嘉定区·嘉定镇街道' };
  const T_LOW = { user_id: 2, username: 'T低', subjects: ['english'], province: 'beijing', price_min: 150, personality_tags: [], gender: 'female', avatar: '', rating: 4 };
  globalThis.fetch = async url => {
    if (String(url).includes('scope=mine')) return { ok: true, status: 200, json: async () => ({ demands: [
      { id: 11, display_id: 7, target_type: 'academic', target_subjects: ['math'], student_grade: 'senior1', province: 'shanghai', teaching_method: 'offline', address: '嘉定区·嘉定镇街道', budget_min: 100, budget_max: 200, preferred_personality_tags: ['patience'], preferred_teacher_gender: 'male', status: 'open' },
      { id: 12, display_id: 8, target_type: 'academic', target_subjects: ['english'], student_grade: 'junior2', province: 'beijing', budget_min: 100, budget_max: 200, preferred_personality_tags: ['patience'], preferred_teacher_gender: 'male', status: 'open' },
      { id: 13, display_id: 9, target_type: 'academic', target_subjects: ['math'], status: 'contracted' },
    ] }) };
    return { ok: true, status: 200, json: async () => ({}) };
  };
  const teachers = [T_HIGH, T_LOW];
  await attachStudentMatch(teachers);
  assert.equal(T_HIGH._matchForStudent.md, 100);
  assert.equal(T_HIGH._matchForStudent.items.length, 2);
  assert.equal(T_HIGH._matchForStudent.items[0].d.id, 11);
  assert.equal(T_HIGH._matchForStudent.items[1].d.id, 12);
  assert.equal(T_LOW._matchForStudent.md, 75);
  sortTeachers([T_HIGH, T_LOW], 'match');
  assert.deepEqual([T_HIGH.user_id, T_LOW.user_id], [1, 2]);
  const cardHtml = renderTeacherCard(T_HIGH);
  assert.ok(cardHtml.includes('match-btn--hi'), '100 → hi 绿');
  assert.ok(cardHtml.includes('匹配度 100%'), '卡上最高匹配度文案');
  assert.ok(cardHtml.includes('tc-match'), '徽章独立行不挤 username');
  assert.ok(renderTeacherCard(T_LOW).includes('match-btn--mid'), '75 → mid 黄');
  // 明细卡
  dom.window.document.getElementById('teachers-list').innerHTML = renderTeacherCard(T_HIGH);
  const btn = dom.window.document.querySelector('[data-action="teacher.matchDetail"]');
  showTeacherMatchDetail(Number(btn.dataset.id));
  const detail = dom.window.document.querySelector('.match-detail--teacher');
  assert.ok(detail, '明细卡已挂载');
  const heads = [...detail.querySelectorAll('.match-t-head')];
  assert.equal(heads.length, 2);
  assert.ok(heads[0].textContent.includes('需求#0007') && heads[0].textContent.includes('匹配度：100%'));
  assert.ok(heads[1].textContent.includes('需求#0008'));
  assert.equal(detail.querySelector('.match-t-list').style.maxHeight, '', '不注入 max-height');
  closeMatchDetail();
  assert.ok(!dom.window.document.querySelector('.match-detail--teacher'), '明细卡已移除');
  delete globalThis.fetch; teardownDom();
});

test('学生端教师匹配：开放需求归零后旧徽章清除', async () => {
  const dom = setupDom();
  state.user = { id: 50, username: 'S', role: 'student' };
  const T1 = { user_id: 1, username: 'T1', subjects: ['math'], province: 'shanghai', price_min: 150, personality_tags: ['patience'], gender: 'male', avatar: '', rating: 5 };
  globalThis.fetch = async () => ({ ok: true, status: 200, json: async () => ({ demands: [{ id: 11, display_id: 7, target_type: 'academic', target_subjects: ['math'], status: 'open' }] }) });
  await attachStudentMatch([T1]);
  assert.ok(T1._matchForStudent, '有开放需求时挂匹配');
  dhInvalidateAll();
  globalThis.fetch = async () => ({ ok: true, status: 200, json: async () => ({ demands: [{ id: 11, display_id: 7, target_type: 'academic', target_subjects: ['math'], status: 'contracted' }] }) });
  await attachStudentMatch([T1]);
  assert.equal(T1._matchForStudent, undefined, '开放需求归零后旧匹配清除');
  delete globalThis.fetch; teardownDom();
});

test('教师看教师：不参与匹配度（无 _matchForStudent 不排序）', () => {
  const dom = setupDom();
  const A = { user_id: 1, username: '甲', avatar: '', rating: 5, grade: 'senior', province: 'shanghai' };
  const B = { user_id: 2, username: '乙', avatar: '', rating: 4, grade: 'junior', province: 'beijing' };
  state.user = { id: 99, role: 'teacher' };
  sortTeachers([A, B], 'match');
  assert.deepEqual([A.user_id, B.user_id], [1, 2], '无学生匹配语境保持原序');
  assert.ok(!renderTeacherCard(A).includes('match-btn'), '教师看教师卡无匹配度按钮');
  teardownDom();
});

test('学生端教师匹配：无开放需求 → 匹配度位置小灰字提示；有需求/教师视角不显', async () => {
  const dom = setupDom();
  const T1 = { user_id: 1, username: 'T1', subjects: ['math'], province: 'shanghai', price_min: 150, personality_tags: [], gender: 'male', avatar: '', rating: 5 };
  state.user = { id: 50, username: '学生S', role: 'student' };
  globalThis.fetch = async () => ({ ok: true, status: 200, json: async () => ({ demands: [{ id: 11, display_id: 7, status: 'contracted' }] }) });
  await attachStudentMatch([T1]);
  assert.ok(renderTeacherCard(T1).includes('tc-match--hint'), '无开放需求 → 小灰字');
  assert.ok(renderTeacherCard(T1).includes('发布需求后展示匹配度'), '提示文案');
  dhInvalidateAll();
  globalThis.fetch = async () => ({ ok: true, status: 200, json: async () => ({ demands: [{ id: 12, display_id: 8, status: 'open' }] }) });
  await attachStudentMatch([T1]);
  assert.ok(!renderTeacherCard(T1).includes('tc-match--hint'), '有开放需求不显示小灰字');
  state.user = { id: 60, username: 'T2', role: 'teacher' };
  await attachStudentMatch([T1]);
  assert.ok(!renderTeacherCard(T1).includes('tc-match--hint'), '教师视角不显示');
  delete globalThis.fetch; teardownDom();
});

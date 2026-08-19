/**
 * 需求大厅/教师浏览渲染回归（B4：直接 import student feature ESM）
 * 教训来源（v0.22.4）：loadBrowseDemands 乱序守卫首用 ++loadSeqs[...] = NaN，
 * NaN !== NaN 恒真 → 首次渲染必被误判过期丢弃 → 需求大厅恒停在加载占位。
 * v2 用 dhGet（datahub 单飞 + 缓存）承接取数，首用渲染回归由本测试兜底。
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { JSDOM } from 'jsdom';
import { state } from '../src/client/core/state.js';
import { _dhResetForTests, stopVersionProbe } from '../src/client/core/datahub.js';
import { loadBrowseDemands, applyDemandControls } from '../src/client/features/student/actions.js';
import { TEXT } from '../src/client/constants/text.js';

const SHELL_HTML = `<!doctype html><html><body>
  <div id="demands-list"></div>
  <select id="demand-sort"></select>
  <select id="demand-filter-subject"></select><select id="demand-filter-grade"></select>
  <select id="demand-filter-method"></select><select id="demand-filter-province"></select>
  <label id="demand-filter-subject-label"></label><label id="demand-filter-grade-label"></label>
  <label id="demand-filter-method-label"></label><label id="demand-filter-province-label"></label>
</body></html>`;

function setup() {
  const dom = new JSDOM(SHELL_HTML, { url: 'http://localhost/', pretendToBeVisual: true });
  globalThis.document = dom.window.document;
  globalThis.window = dom.window;
  globalThis.localStorage = dom.window.localStorage;
  globalThis.sessionStorage = dom.window.sessionStorage;
  state.user = { id: 38, username: 'kkkk', role: 'teacher' };
  state.page = 'browse-demands';
  state.allTeachers = [];
  _dhResetForTests();
  return dom;
}
function teardown() {
  stopVersionProbe();
  delete globalThis.fetch;
  delete globalThis.document; delete globalThis.window;
  delete globalThis.localStorage; delete globalThis.sessionStorage;
  state.user = null; state.page = null; state.allTeachers = [];
}

// 教师视角（teacher 档案 english；需求1 english → 匹配，需求2 math → 不匹配）
function stubFetch(demands) {
  globalThis.fetch = async (url) => {
    const u = String(url);
    if (u.includes('/api/demand-pushes')) return { ok: true, status: 200, json: async () => ({ pushes: [] }) };
    if (u.includes('/api/teachers')) return { ok: true, status: 200, json: async () => ({ teachers: [
      { user_id: 38, username: 'kkkk', subjects: ['english'], province: 'guangdong', price_min: 150, price_max: 150, rating: 4, avatar: '' } ] }) };
    if (u.includes('demands')) return { ok: true, status: 200, json: async () => ({ demands }) };
    return { ok: true, status: 200, json: async () => ({}) };
  };
}

test('loadBrowseDemands 首次调用即渲染需求卡（首用回归；教师视角含匹配度徽章）', async () => {
  setup();
  stubFetch([{
    id: 1, user_id: 39, username: '学生A', student_grade: 'senior1', student_gender: 'female',
    target_subjects: ['math'], current_scores: [], teaching_method: 'offline', address: '杨浦区',
    province: 'shanghai', budget_min: 0, budget_max: 0, status: 'open', display_id: 7,
    intent_locked: 0, my_intent_status: 'pending', avatar: '', created_at: '2026-08-07 04:27:09',
    pending_intents: 0, intent_count: 0,
  }]);
  await loadBrowseDemands();
  const html = document.getElementById('demands-list').innerHTML;
  assert.ok(html.includes('list-card'), '应渲染需求卡（而非停留在加载占位）');
  assert.ok(!html.includes('loader'), '不应残留加载占位');
  assert.ok(html.includes('匹配度') || html.includes('tag-match'), '教师视角应渲染匹配度徽章');
  teardown();
});

// #158（v0.25.66）：需求大厅排序筛选控件——默认匹配度排序、科目筛选、预算/最新排序、筛选空态
test('需求大厅排序筛选：默认匹配度；科目筛选；预算/最新排序；空态（#158）', async () => {
  setup();
  stubFetch([
    { id: 1, user_id: 39, username: '学生A', student_grade: 'senior1', student_gender: 'female',
      target_type: 'academic', target_subjects: ['english'], teaching_method: 'offline',
      province: 'guangdong', budget_min: 100, budget_max: 200, status: 'open', display_id: 7,
      created_at: '2026-08-07 04:27:09' },
    { id: 2, user_id: 40, username: '学生B', student_grade: 'senior2', student_gender: 'female',
      target_type: 'academic', target_subjects: ['math'], teaching_method: 'online',
      province: 'beijing', budget_min: 300, budget_max: 400, status: 'open', display_id: 8,
      created_at: '2026-08-07 04:27:10' },
  ]);
  await loadBrowseDemands();
  const list = () => document.getElementById('demands-list').innerHTML;
  // 控件已填充 + 默认匹配度最高（教师看需求匹配度是核心价值）
  assert.equal(document.getElementById('demand-sort').options.length, 3, '排序三选项（匹配度/最新/预算）');
  assert.equal(document.getElementById('demand-sort').value, 'match', '默认匹配度最高');
  assert.ok(document.getElementById('demand-filter-subject').options.length > 1, '科目筛选已填充');
  assert.equal(document.getElementById('demand-filter-subject-label').textContent, TEXT.LABEL_SUBJECT, '筛选标签单源');
  assert.equal(document.getElementById('demand-filter-grade-label').textContent, TEXT.LABEL_GRADE, '年级标签单源');
  // 默认匹配度：english（有匹配）排 math 前
  assert.ok(list().indexOf('学生A') < list().indexOf('学生B'), '默认匹配度最高：english 卡在 math 卡前');
  // 科目筛选 = math → 只剩需求2
  document.getElementById('demand-filter-subject').value = 'math';
  applyDemandControls();
  assert.ok(list().includes('学生B') && !list().includes('学生A'), '按科目 math 筛选只剩需求2');
  // 清筛选 + 预算从低到高 → 100 排前
  document.getElementById('demand-filter-subject').value = '';
  document.getElementById('demand-sort').value = 'budget';
  applyDemandControls();
  assert.ok(list().indexOf('学生A') < list().indexOf('学生B'), '预算从低到高：100 排前');
  // 最新发布 → created_at 更晚的 2 排前
  document.getElementById('demand-sort').value = 'newest';
  applyDemandControls();
  assert.ok(list().indexOf('学生B') < list().indexOf('学生A'), '最新发布：04:27:10 排前');
  // 无命中 → 筛选空态
  document.getElementById('demand-sort').value = 'newest';
  document.getElementById('demand-filter-subject').value = 'physics';
  applyDemandControls();
  assert.ok(list().includes(TEXT.DEMAND_FILTER_EMPTY), '筛选无命中显示空态');
  teardown();
});

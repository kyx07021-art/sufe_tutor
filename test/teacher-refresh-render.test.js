/**
 * 需求八（2026-08-08）·注销后资料未及时更新（B4：直接 import teacher/datahub ESM）。
 *
 * 残留点在「另一已打开的教师列表视图」：dhRefreshDomain 只刷缓存不碰 DOM，teachers 域重挂
 * 只换 state.allTeachers、不重渲染旧卡——注销后旧卡一直挂着直到切 tab。
 *
 * 修复（v1 parity）：teachers 域重挂时若 state.page === 'browse-teachers'，重挂后按现有筛选
 * 控件重渲染（attachStudentMatch 异步先算匹配徽章，applyFilters 读当前控件值）。
 *
 * 本测试覆盖：
 *   - 探针版本 bump（teachers 4→5）后，已打开的教师列表 DOM 移除已注销教师卡；
 *   - 列表未打开（state.page 非 browse-teachers）时探针刷新不触碰教师列表 DOM（防过度重渲染）；
 *   - 刷新重渲染保留用户当前筛选状态（控件值驱动，非全量直出）。
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { JSDOM } from 'jsdom';
import { state } from '../src/client/core/state.js';
import { dhProbeTick, _dhResetForTests, _dhSeedForTests, stopVersionProbe } from '../src/client/core/datahub.js';
import { registerTeacherDomainRefresh } from '../src/client/features/teacher/actions.js';

// 新鲜教师列表（探针刷新后服务端返回）：已注销教师 99 被排除
const FRESH_TEACHERS = [
  { user_id: 1, username: '甲', avatar: '', rating: 5, grade: 'senior', province: 'shanghai', gender: 'male',
    price_min: 200, price_max: 260, subjects: ['math'], teaching_method: 'online', verified: 1 },
  { user_id: 2, username: '乙', avatar: '', rating: 3, grade: 'junior', province: 'beijing', gender: 'female',
    price_min: 100, price_max: 150, subjects: ['english'], teaching_method: 'offline', verified: 0 },
];
// 旧缓存（注销前）：含已注销用户 99
const STALE_TEACHERS = [...FRESH_TEACHERS,
  { user_id: 99, username: '已注销用户#99', avatar: '', rating: 4, grade: 'senior', province: 'shenzhen', gender: 'male',
    price_min: 150, price_max: 200, subjects: ['math'], teaching_method: '', verified: 1 },
];

const SHELL_HTML = `<!doctype html><html><body>
  <div id="teachers-list"></div>
  <select id="filter-method"><option value="">全部</option><option value="online">线上</option><option value="offline">线下</option></select>
  <select id="filter-day"></select>
  <select id="filter-verified"></select>
</body></html>`;

function setup() {
  const dom = new JSDOM(SHELL_HTML, { url: 'http://localhost/', pretendToBeVisual: true });
  globalThis.document = dom.window.document;
  globalThis.window = dom.window;
  globalThis.localStorage = dom.window.localStorage;
  globalThis.sessionStorage = dom.window.sessionStorage;
  state.user = { role: 'teacher', id: 1, username: '甲' };
  state.page = null;
  _dhResetForTests(); // 清缓存/基线；_dhResetForTests 也清 rebinders，故 reset 后重新注册
  registerTeacherDomainRefresh();
  globalThis.fetch = async (url, opts) => {
    const u = String(url);
    if (u === '/api/batch') {
      let gets = [];
      try { gets = JSON.parse((opts && opts.body) || '{}').gets || []; } catch { gets = []; }
      const results = gets.map(p => ({ path: p, status: 200, data: p === '/api/teachers' ? { teachers: FRESH_TEACHERS } : {} }));
      return { ok: true, status: 200, json: async () => ({ results }) };
    }
    if (u.includes('/api/teachers')) return { ok: true, status: 200, json: async () => ({ teachers: FRESH_TEACHERS }) };
    if (u.includes('/api/data-version')) return { ok: true, status: 200, json: async () => ({ versions: { teachers: 5, demands: 5, posts: 5 } }) };
    return { ok: true, status: 200, json: async () => ({}) };
  };
  return dom;
}
function teardown() {
  stopVersionProbe();
  delete globalThis.fetch;
  delete globalThis.document; delete globalThis.window;
  delete globalThis.localStorage; delete globalThis.sessionStorage;
}

function seedOpenList(stale, page) {
  state.page = page;
  state.allTeachers = stale;
  _dhSeedForTests({
    cache: [{ endpoint: '/api/teachers', domain: 'teachers', data: { teachers: stale } }],
    versions: { teachers: 4, demands: 4, posts: 4 },
  });
  document.getElementById('teachers-list').innerHTML = '旧卡已渲染（含已注销用户#99）';
}

test('探针版本 bump 后，已打开的教师列表重渲染、移除已注销教师卡', async () => {
  setup();
  seedOpenList(STALE_TEACHERS, 'browse-teachers');
  await dhProbeTick();
  const html = document.querySelector('#teachers-list').innerHTML;
  assert.ok(!html.includes('已注销用户#99'), '已注销教师卡应从已打开的列表移除（残留根因）');
  assert.ok(html.includes('tc-username') && html.includes('甲'), '列表已按新缓存重渲染出新卡');
  const cached = state.allTeachers.map(t => t.user_id);
  assert.deepEqual(cached, [1, 2], 'state.allTeachers 已重挂为新缓存（99 排除）');
  teardown();
});

test('列表未打开（state.page 非 browse-teachers）时探针刷新不触碰教师列表 DOM', async () => {
  setup();
  seedOpenList(STALE_TEACHERS, 'my-chats');
  await dhProbeTick();
  assert.equal(document.querySelector('#teachers-list').innerHTML, '旧卡已渲染（含已注销用户#99）',
    '非浏览页：只刷缓存不重渲染（不打断其他视图）');
  teardown();
});

test('刷新重渲染保留用户当前筛选状态（控件值驱动）', async () => {
  setup();
  seedOpenList(STALE_TEACHERS, 'browse-teachers');
  document.getElementById('filter-method').value = 'online'; // 用户选了「线上」
  await dhProbeTick();
  const html = document.querySelector('#teachers-list').innerHTML;
  assert.ok(html.includes('甲') && !html.includes('乙'), '刷新后仍按筛选只渲染线上教师（甲），线下教师（乙）被滤除');
  teardown();
});

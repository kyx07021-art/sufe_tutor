/**
 * 需求八（2026-08-08）·注销后资料未及时更新（v0.25.30）
 *
 * 实证结论（repro 脚本 + 代码走查）：注销链路本身正确——本人端登出 runLogoutResets→dhInvalidateAll
 * 清缓存、服务端 dbDeactivateUser 排除封禁/注销、versionDomainOf('/api/user/deactivate') 归
 * TEACHERS+DEMANDS+POSTS 多域 bump、探针 8s 重拉缓存。残留点在「另一已打开的教师列表视图」：
 * dhRefreshDomain 只刷缓存不碰 DOM（v0.23.0 设计取舍），teachers 域重挂只换 state.allTeachers
 * 数组、不重渲染已渲染的旧卡——注销后旧卡一直挂着直到切 tab。
 *
 * 修复：teachers 域重挂时若 state.page === 'browse-teachers'，重挂后按现有筛选/排序控件
 * 重渲染（attachStudentMatch 异步先算匹配徽章）。
 *
 * 本测试覆盖：
 *   - 探针版本 bump（teachers 4→5）后，已打开的教师列表 DOM 移除已注销教师卡；
 *   - 列表未打开（state.page 非 browse-teachers）时探针刷新不触碰教师列表 DOM（防过度重渲染）；
 *   - 刷新重渲染保留用户当前筛选状态（控件值驱动，非全量直出）。
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { JSDOM } from 'jsdom';
import { readFileSync } from 'node:fs';
import vm from 'node:vm';

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

function makeCtx() {
  const html = readFileSync('./index.html', 'utf8')
    .replace(/<script src="\/app-[a-z-]+\.js"><\/script>/g, '');
  const dom = new JSDOM(html, { url: 'http://localhost/', pretendToBeVisual: true, runScripts: 'dangerously' });
  const w = dom.window;
  const ctx = vm.createContext({
    window: w, document: w.document,
    getComputedStyle: w.getComputedStyle.bind(w),
    localStorage: w.localStorage, sessionStorage: w.sessionStorage,
    console,
    fetch: async (url, opts) => {
      const s = String(url);
      // B2/F3（v0.27.0）：dhRefreshDomain 批量重拉走 /api/batch，mock 合成批量结果
      if (s === '/api/batch') {
        let gets = [];
        try { gets = JSON.parse((opts && opts.body) || '{}').gets || []; } catch { gets = []; }
        const results = gets.map(p => ({
          path: p, status: 200,
          data: p === '/api/teachers' ? { teachers: FRESH_TEACHERS } : {},
        }));
        return { ok: true, status: 200, json: async () => ({ results }) };
      }
      if (s.includes('/api/teachers')) return { ok: true, status: 200, json: async () => ({ teachers: FRESH_TEACHERS }) };
      if (s.includes('/api/data-version')) return { ok: true, status: 200, json: async () => ({ versions: { teachers: 5, demands: 5, posts: 5 } }) };
      return { ok: true, status: 200, json: async () => ({}) };
    },
    setTimeout: globalThis.setTimeout, clearTimeout: globalThis.clearTimeout,
    setInterval: globalThis.setInterval, clearInterval: globalThis.clearInterval,
    Request: globalThis.Request, AbortController: globalThis.AbortController,
    performance: globalThis.performance,
    MutationObserver: class { observe() {} disconnect() {} takeRecords() { return []; } },
    Image: class { set src(v) { this._s = v; } },
    requestAnimationFrame: (cb) => setTimeout(cb, 16), cancelAnimationFrame: () => {},
    matchMedia: () => ({ matches: false, addEventListener: () => {} }),
  });
  const FILES = ['constants.js', 'region-data.js', 'app-display.js', 'app-state.js', 'app-api.js',
    'app-datahub.js', 'app-anim.js', 'app-ui.js', 'app-demands.js', 'app-teachers.js'];
  for (const f of FILES) vm.runInContext(readFileSync('./' + f, 'utf8'), ctx, { filename: f });
  vm.runInContext('window.APP_CONSTANTS = globalThis.APP_CONSTANTS;', ctx);
  return { dom, ctx };
}

function seedOpenList(ctx, stale, page) {
  vm.runInContext(`
    state.user = { role: 'teacher', id: 1, username: '甲' };
    state.page = ${JSON.stringify(page)};
    dhCache.set('/api/teachers', { domain: 'teachers', data: { teachers: ${JSON.stringify(stale)} }, fetchedAt: Date.now() });
    document.getElementById('teachers-list').innerHTML = '旧卡已渲染（含已注销用户#99）';
    dhLastVersions = { teachers: 4, demands: 4, posts: 4 };
  `, ctx);
}

test('探针版本 bump 后，已打开的教师列表重渲染、移除已注销教师卡', async () => {
  const { ctx, dom } = makeCtx();
  const doc = dom.window.document;
  seedOpenList(ctx, STALE_TEACHERS, 'browse-teachers');
  await vm.runInContext('dhProbeTick()', ctx);
  const html = doc.querySelector('#teachers-list').innerHTML;
  assert.ok(!html.includes('已注销用户#99'), '已注销教师卡应从已打开的列表移除（残留根因）');
  assert.ok(html.includes('tc-username') && html.includes('甲'), '列表已按新缓存重渲染出新卡');
  const cached = vm.runInContext("dhCache.get('/api/teachers').data.teachers.map(t => t.user_id)", ctx);
  assert.deepEqual(cached, [1, 2], '缓存已被探针刷新（99 排除）');
});

test('列表未打开（state.page 非 browse-teachers）时探针刷新不触碰教师列表 DOM', async () => {
  const { ctx, dom } = makeCtx();
  const doc = dom.window.document;
  seedOpenList(ctx, STALE_TEACHERS, 'my-chats');
  await vm.runInContext('dhProbeTick()', ctx);
  assert.equal(doc.querySelector('#teachers-list').innerHTML, '旧卡已渲染（含已注销用户#99）',
    '非浏览页：只刷缓存不重渲染（不打断其他视图）');
});

test('刷新重渲染保留用户当前筛选状态（控件值驱动）', async () => {
  const { ctx, dom } = makeCtx();
  const doc = dom.window.document;
  seedOpenList(ctx, STALE_TEACHERS, 'browse-teachers');
  vm.runInContext(`document.getElementById('filter-gender').value = 'male';`, ctx); // 用户选了「男」
  await vm.runInContext('dhProbeTick()', ctx);
  const html = doc.querySelector('#teachers-list').innerHTML;
  assert.ok(html.includes('甲') && !html.includes('乙'), '刷新后仍按筛选只渲染男教师（甲），女教师（乙）被滤除');
});

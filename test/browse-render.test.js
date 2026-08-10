/**
 * 需求大厅/教师浏览渲染回归（node:vm 模拟浏览器经典脚本全局）
 * 教训来源（v0.22.4）：loadBrowseDemands 乱序守卫首用 ++loadSeqs[...] = NaN，
 * NaN !== NaN 恒真 → 首次渲染必被误判过期丢弃 → 需求大厅恒停在加载占位。
 * 此测试真实加载 app 文件跑 loadBrowseDemands，守卫再犯即炸。
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { JSDOM } from 'jsdom';
import { readFileSync } from 'node:fs';
import vm from 'node:vm';

function makeCtx(html) {
  const dom = new JSDOM(html || '<!DOCTYPE html><html><body><div id="demands-list"></div></body></html>', {
    url: 'http://localhost/', pretendToBeVisual: true,
  });
  const w = dom.window;
  // 普通沙箱对象：globalThis = 沙箱，globalThis.APP_CONSTANTS 等赋值可作裸标识符读取
  return {
    ctx: vm.createContext({
      window: w, document: w.document,
      getComputedStyle: w.getComputedStyle.bind(w),
      localStorage: w.localStorage,
      console, fetch: globalThis.fetch, setTimeout: globalThis.setTimeout,
      clearTimeout: globalThis.clearTimeout, Request: globalThis.Request,
      MutationObserver: class { observe() {} disconnect() {} takeRecords() { return []; } },
    }),
    dom,
  };
}

test('loadBrowseDemands 首次调用即渲染需求卡（乱序守卫首用初始化回归）', async () => {
  const { ctx, dom } = makeCtx();
  for (const f of ['constants.js', 'region-data.js', 'app-display.js', 'app-state.js', 'app-api.js',
    'app-datahub.js', 'app-anim.js', 'app-ui.js', 'app-demands.js']) {
    vm.runInContext(readFileSync('./' + f, 'utf8'), ctx, { filename: f });
  }
  // stub app-shell 依赖 + mock api（教师视角）
  vm.runInContext(`
    setBadge = () => {};
    initReveals = () => {};
    ensureAuth = () => true;
    showToast = () => {};
    api = async (url) => {
      if (url.includes('demands')) return { demands: [{
        id: 1, user_id: 39, username: '学生A', student_grade: 'senior1', student_gender: 'female',
        target_subjects: ['math'], current_scores: [], teaching_method: 'offline', address: '杨浦区',
        province: 'shanghai', budget_min: 0, budget_max: 0, status: 'open', display_id: 7,
        intent_locked: 0, my_intent_status: 'pending', avatar: '', created_at: '2026-08-07 04:27:09',
        pending_intents: 0, intent_count: 0 }] };
      if (url.includes('demand-pushes')) return { pushes: [] };
      if (url.includes('/api/teachers')) return { teachers: [
        { user_id: 38, username: 'kkkk', subjects: ['english'], province: 'guangdong', price_min: 150, price_max: 150, rating: 4, avatar: '' } ] };
      return {};
    };
    state.user = { id: 38, username: 'kkkk', role: 'teacher' };
    state.page = 'browse-demands';
  `, ctx);

  await vm.runInContext('loadBrowseDemands()', ctx);
  const html = dom.window.document.getElementById('demands-list').innerHTML;
  assert.ok(html.includes('list-card'), '应渲染需求卡（而非停留在加载占位）');
  assert.ok(!html.includes('loader'), '不应残留加载占位');
  assert.ok(html.includes('匹配度') || html.includes('tag-match'), '教师视角应渲染匹配度徽章');
});

// #158（v0.25.66）：需求大厅排序筛选控件——v0.25.110 起默认最新（删匹配度排序）、科目筛选、预算/最新排序、筛选空态
test('需求大厅排序筛选：默认最新；科目筛选；预算/最新排序；空态（#158）', async () => {
  const controls = '<div id="demands-list"></div>' +
    '<select id="demand-sort"></select>' +
    '<select id="demand-filter-subject"></select><select id="demand-filter-grade"></select>' +
    '<select id="demand-filter-method"></select><select id="demand-filter-province"></select>' +
    '<label id="demand-filter-subject-label"></label><label id="demand-filter-grade-label"></label>' +
    '<label id="demand-filter-method-label"></label><label id="demand-filter-province-label"></label>';
  const { ctx, dom } = makeCtx(`<!DOCTYPE html><html><body>${controls}</body></html>`);
  for (const f of ['constants.js', 'region-data.js', 'app-display.js', 'app-state.js', 'app-api.js',
    'app-datahub.js', 'app-anim.js', 'app-ui.js', 'app-demands.js']) {
    vm.runInContext(readFileSync('./' + f, 'utf8'), ctx, { filename: f });
  }
  vm.runInContext(`
    setBadge = () => {};
    initReveals = () => {};
    ensureAuth = () => true;
    showToast = () => {};
    api = async (url) => {
      if (url.includes('demand-pushes')) return { pushes: [] };
      if (url.includes('/api/teachers')) return { teachers: [
        { user_id: 38, username: 'kkkk', subjects: ['english'], province: 'guangdong', price_min: 150, price_max: 150 } ] };
      return { demands: [
        { id: 1, user_id: 39, username: '学生A', student_grade: 'senior1', student_gender: 'female',
          target_type: 'academic', target_subjects: ['english'], teaching_method: 'offline',
          province: 'guangdong', budget_min: 100, budget_max: 200, status: 'open', display_id: 7,
          created_at: '2026-08-07 04:27:09' },
        { id: 2, user_id: 40, username: '学生B', student_grade: 'senior2', student_gender: 'female',
          target_type: 'academic', target_subjects: ['math'], teaching_method: 'online',
          province: 'beijing', budget_min: 300, budget_max: 400, status: 'open', display_id: 8,
          created_at: '2026-08-07 04:27:10' } ] };
    };
    state.user = { id: 38, username: 'kkkk', role: 'teacher' };
    state.page = 'browse-demands';
  `, ctx);

  await vm.runInContext('loadBrowseDemands()', ctx);
  const list = () => dom.window.document.getElementById('demands-list').innerHTML;
  // 控件已填充 + 默认最新（v0.25.110：删匹配度最高默认项，公开浏览默认按上架时间）
  assert.equal(vm.runInContext(`document.getElementById('demand-sort').options.length`, ctx), 2, '排序两选项（最新/预算，匹配度已删）');
  assert.equal(vm.runInContext(`document.getElementById('demand-sort').value`, ctx), 'newest', '默认最新');
  assert.ok(vm.runInContext(`document.getElementById('demand-filter-subject').options.length > 1`, ctx), '科目筛选已填充');
  assert.equal(vm.runInContext(`document.getElementById('demand-filter-subject-label').textContent`, ctx), '科目', '筛选标签单源');
  assert.equal(vm.runInContext(`document.getElementById('demand-filter-grade-label').textContent`, ctx), '年级', '年级标签单源');
  // 默认最新：created_at 更晚的 2 排前
  assert.ok(list().indexOf('学生B') < list().indexOf('学生A'), '默认最新：04:27:10 排前');
  // 科目筛选 = math → 只剩需求2
  vm.runInContext(`document.getElementById('demand-filter-subject').value = 'math'; applyDemandControls()`, ctx);
  assert.ok(list().includes('学生B') && !list().includes('学生A'), '按科目 math 筛选只剩需求2');
  // 清筛选 + 预算从低到高 → 100 排前
  vm.runInContext(`document.getElementById('demand-filter-subject').value = ''; document.getElementById('demand-sort').value = 'budget'; applyDemandControls()`, ctx);
  assert.ok(list().indexOf('学生A') < list().indexOf('学生B'), '预算从低到高：100 排前');
  // 最新发布 → created_at 更晚的 2 排前
  vm.runInContext(`document.getElementById('demand-sort').value = 'newest'; applyDemandControls()`, ctx);
  assert.ok(list().indexOf('学生B') < list().indexOf('学生A'), '最新发布：04:27:10 排前');
  // 无命中 → 筛选空态
  vm.runInContext(`document.getElementById('demand-sort').value = 'newest'; document.getElementById('demand-filter-subject').value = 'physics'; applyDemandControls()`, ctx);
  assert.ok(list().includes('没有符合筛选条件的需求'), '筛选无命中显示空态');
});

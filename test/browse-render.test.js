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

function makeCtx() {
  const dom = new JSDOM('<!DOCTYPE html><html><body><div id="demands-list"></div></body></html>', {
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

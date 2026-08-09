/**
 * 需求十一·按钮统一外观组件（R11：需求列表「编辑」/「试课意向」等卡片动作按钮）
 *
 * 缺陷：编辑 = btn-outline（液态下透明无边框），试课意向 disabled 态 = 裸 .btn（无 outline），
 * 有的有边框有的没有、颜色不一致。
 *
 * 改造：新增 .btn-soft 轻量描边按钮变体（--g-btn-bg 白调面 + --g-btn-line 发丝边，纯 token 换肤，
 * 与下拉/勾选/成绩 pill 同族），需求卡片 footer 全部动作按钮（编辑/重开/下架/推送拒收接收/
 * 试课意向四态）统一挂载。
 *
 * 本测试覆盖：
 *   - 教师视角意向四态：未提交（cta）/待处理/未获选（wait）/已建立联系（ok）均渲染 btn-soft、
 *     不再用 btn-outline 或裸 btn；
 *   - 学生可编辑视角：编辑/重开按钮渲染 btn-soft；
 *   - 推送动作：拒收/接收渲染 btn-soft；
 *   - 语义类保留：btn-intent-cta 仍在（新手引导目标选择器依赖）。
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { JSDOM } from 'jsdom';
import { readFileSync } from 'node:fs';
import vm from 'node:vm';

function makeCtx() {
  const dom = new JSDOM('<!DOCTYPE html><html><body></body></html>', { url: 'http://localhost/', pretendToBeVisual: true });
  const w = dom.window;
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

const FILES = ['constants.js', 'region-data.js', 'app-display.js', 'app-state.js', 'app-api.js',
  'app-datahub.js', 'app-anim.js', 'app-ui.js', 'app-demands.js', 'app-teachers.js'];
function loadCommon(ctx) {
  for (const f of FILES) vm.runInContext(readFileSync('./' + f, 'utf8'), ctx, { filename: f });
}

// 基础需求卡夹具（各态按钮走同一 renderDemandCard 分支）
function renderCard(ctx, extra, opts) {
  return vm.runInContext(`renderDemandCard({
    id: 2, display_id: 7, target_type: 'academic', target_subjects: ['math'], student_grade: 'senior1',
    student_gender: 'female', province: 'shanghai', budget_min: 100, budget_max: 200,
    current_scores: [], teaching_method: 'offline', expected_time: '', status: 'open',
    username: '学生A', avatar: '', created_at: '2026-08-07 04:27:09',
    ...${JSON.stringify(extra)}
  }, ${JSON.stringify(opts)})`, ctx);
}

test('R11 教师视角意向按钮四态统一 .btn-soft（无 btn-outline/裸 btn 散装）', () => {
  const { ctx } = makeCtx();
  loadCommon(ctx);
  // 未提交 → cta（可点）
  const cta = renderCard(ctx, { my_intent_status: '' }, { teacher: true });
  assert.ok(cta.includes('btn-soft'), '未提交意向 = btn-soft');
  assert.ok(cta.includes('btn-intent-cta'), 'cta 语义类保留（新手引导目标依赖）');
  assert.ok(!cta.includes('btn-outline'), '不再用 btn-outline');
  // 待处理 / 未获选 → wait（disabled）
  for (const st of ['pending', 'rejected']) {
    const html = renderCard(ctx, { my_intent_status: st }, { teacher: true });
    assert.ok(html.includes('btn-soft') && html.includes('btn-intent-wait'), `${st} = btn-soft + wait`);
    assert.ok(!html.includes('btn-outline'), `${st} 不用 btn-outline`);
  }
  // 已建立联系 → ok（disabled）
  const ok = renderCard(ctx, { my_intent_status: 'accepted' }, { teacher: true });
  assert.ok(ok.includes('btn-soft') && ok.includes('btn-intent-ok'), 'accepted = btn-soft + ok');
  assert.ok(!ok.includes('btn-outline'), 'accepted 不用 btn-outline');
});

test('R11 学生可编辑视角：编辑/重开按钮统一 .btn-soft', () => {
  const { ctx } = makeCtx();
  loadCommon(ctx);
  const edit = renderCard(ctx, {}, { editable: true });
  assert.ok(edit.includes('btn-soft') && edit.includes('onclick="openDemandModal(2)"'), '编辑 = btn-soft');
  assert.ok(!edit.includes('btn-outline'), '编辑不再 btn-outline');
  const reopen = renderCard(ctx, { status: 'revoked' }, { editable: true });
  assert.ok(reopen.includes('btn-soft') && reopen.includes('onclick="reopenDemand(2)"'), '重开 = btn-soft');
});

test('R11 推送动作：拒收/接收统一 .btn-soft', () => {
  const { ctx } = makeCtx();
  loadCommon(ctx);
  const html = renderCard(ctx, {}, { teacher: true, push: { push_id: 9, push_created_at: '2026-08-08 10:00:00' } });
  assert.ok(html.includes('resolvePush(9,\'reject\')') && html.includes('btn-soft'), '推送拒收 = btn-soft');
  assert.ok(html.includes('resolvePush(9,\'accept\')') && html.includes('btn-soft'), '推送接收 = btn-soft');
  assert.ok(!html.includes('btn-outline'), '推送动作不再 btn-outline');
});

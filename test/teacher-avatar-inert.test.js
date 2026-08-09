/**
 * 需求十三（R13）·教师卡片头像改为不可聚焦、无交互的惰性装饰组件
 *
 * 缺陷：教师卡整体 role=button tabindex=0（v0.25.12 整卡可点），头像 span 随卡可点
 * （pointer-events:auto）、有图时无 aria-hidden——半交互观感与「装饰组件」定位不符。
 *
 * 修复：
 *   - renderAvatarHtml：无 profileUserId 的头像恒 aria-hidden="true"（纯装饰、惰性、
 *     不可聚焦）；有 profileUserId 才成独立交互入口（avatar-btn role=button tabindex=0）；
 *   - .tc-avatar：pointer-events:none + user-select:none——点击穿透到宿主卡片，无独立交互；
 *   - 教师卡渲染的 avatar 走非交互分支（无 tabindex、无 role=button）。
 *
 * 本测试覆盖：renderAvatarHtml 两分支 + 教师卡整卡渲染 + .tc-avatar CSS 惰性声明。
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

test('R13 renderAvatarHtml 非交互分支：恒 aria-hidden、无 avatar-btn/role/tabindex', () => {
  const { ctx } = makeCtx();
  loadCommon(ctx);
  // 有图（教师卡头像有头像图时）
  const img = vm.runInContext(`renderAvatarHtml('/a.png', '张老师', 'tc-avatar')`, ctx);
  assert.ok(img.includes('aria-hidden="true"'), '有图也要 aria-hidden（装饰组件）');
  assert.ok(!img.includes('avatar-btn'), '无交互包装');
  assert.ok(!img.includes('tabindex'), '不可聚焦');
  assert.ok(!img.includes('role='), '无 role');
  // 无图（字母头像）
  const letter = vm.runInContext(`renderAvatarHtml('', '张老师', 'tc-avatar')`, ctx);
  assert.ok(letter.includes('aria-hidden="true"'), '字母头像 aria-hidden');
  assert.ok(letter.includes('>张<'), '字母头像渲染首字符');
});

test('R13 renderAvatarHtml 交互分支（profileUserId）：avatar-btn + role/tabindex，内层不 aria-hidden', () => {
  const { ctx } = makeCtx();
  loadCommon(ctx);
  const html = vm.runInContext(`renderAvatarHtml('/a.png', '张老师', 'demand-avatar', 7)`, ctx);
  assert.ok(html.includes('avatar-btn'), '交互包装');
  assert.ok(html.includes('role="button"') && html.includes('tabindex="0"'), '可聚焦可交互');
  assert.ok(html.includes('openProfilePanel(7)'), '点击呼出资料栏');
  assert.ok(!html.includes('aria-hidden="true"'), '交互头像内层不 aria-hidden');
});

test('R13 教师卡渲染：头像为非交互惰性组件（aria-hidden、无 avatar-btn）', () => {
  const { ctx } = makeCtx();
  loadCommon(ctx);
  vm.runInContext(`state.user = { id: 1, role: 'student', username: '学生' }`, ctx);
  const html = vm.runInContext(`renderTeacherCard({ user_id: 3, username: '张老师', avatar: '/a.png', verified: 0 })`, ctx);
  // 卡片本身是可点交互单位（role=button tabindex=0）——头像不重复交互
  assert.ok(html.includes('role="button"') && html.includes('tabindex="0"'), '整卡可点（宿主交互）');
  assert.ok(html.includes('class="avatar glass tc-avatar"') && html.includes('aria-hidden="true"'),
    '头像 = 惰性装饰（aria-hidden、无独立交互类）');
  assert.ok(!html.includes('avatar-btn'), '头像无独立按钮包装');
});

test('R13 .tc-avatar CSS：pointer-events:none + user-select:none（惰性声明）', () => {
  const css = readFileSync('./style.css', 'utf8');
  const block = css.match(/\.tc-avatar \{[\s\S]*?\}/);
  assert.ok(block, '.tc-avatar 规则存在');
  assert.ok(/pointer-events:\s*none/.test(block[0]), 'pointer-events none（不独立可点）');
  assert.ok(/user-select:\s*none/.test(block[0]), 'user-select none（纯展示）');
});

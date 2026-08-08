/**
 * v0.25.39 四件 UI 修复回归（反馈 U1-U4）：
 *   U1 反馈浮窗 Bug/建议 分段按钮撑满横向空间（flex 交还组件契约 .seg-tab{flex:1}）；
 *   U2 平面简约「关于平台」步骤圆圈数字可见（flat --g-flow-dot 改纸面，与 ink 数字反色）；
 *   U3 教师资料性别下拉默认「不愿透露」（GENDERS 白名单消毒，历史值不再塌成细条）；
 *   U4 全表单浮窗灰化背景 + 弹窗矩形切透明（.modal 200vmax 压暗，主题 token 双主题）。
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { JSDOM } from 'jsdom';
import vm from 'node:vm';

const tick = (ms = 20) => new Promise(r => setTimeout(r, ms));

// ============ U1：反馈浮窗分段按钮撑满 ============

test('U1：反馈分段按钮 flex 交还组件契约（.seg-tab{flex:1} 等宽撑满），无 flex:0 0 auto 覆写', () => {
  const css = readFileSync('./style.css', 'utf8');
  const block = css.split('.feedback-kind-row .seg-tab')[1] || '';
  const rule = '{' + block.split('}')[0] + '}';
  assert.ok(!rule.includes('flex: 0 0 auto'), '反馈分段不再覆写 flex（原覆写是挤左不撑满的根因）');
  const glass = readFileSync('./glass.css', 'utf8');
  const segTabRule = glass.split('.seg-tab {')[1] || '';
  assert.ok(segTabRule.split('}')[0].includes('flex: 1'), '组件基类 .seg-tab 保持 flex:1（等宽撑满）');
});

// ============ U2：平面风格 关于平台 步骤圆圈数字可见 ============

test('U2：flat 包 --g-flow-dot 为纸面（与 ink 数字反色，深浅主题皆可见）；液态保持白面', () => {
  const { ctx } = makeCtx();
  const flat = vm.runInContext('JSON.stringify(APP_CONSTANTS.STYLE_PACKS.flat.tokens)', ctx);
  const flatObj = JSON.parse(flat);
  assert.equal(flatObj['--g-flow-dot'], 'var(--paper-3)', 'flat 圆点填纸面（反色，非 ink-2 同色不可见）');
  const light = vm.runInContext('APP_CONSTANTS.THEME.light["--g-flow-dot"]', ctx);
  const dark = vm.runInContext('APP_CONSTANTS.THEME.dark["--g-flow-dot"]', ctx);
  assert.ok(String(light).includes('255,255,255'), '液态浅色圆点为白面');
  assert.ok(String(dark).includes('255,255,255'), '液态深色圆点为白面');
});

// ============ U3：教师资料性别下拉默认「不愿透露」 ============

test('U3：历史/非法 gender（nonbinary）白名单消毒回落「不愿透露」，不塌成细条', async () => {
  const { ctx } = makeCtx();
  await setupProfile(ctx, { gender: 'nonbinary' }); // 旧枚举不在 GENDERS
  const { value, selIdx, trigger } = readGenderState(ctx);
  assert.equal(value, 'undeclared', '非法 gender 消毒为 undeclared');
  assert.equal(selIdx, 0, 'selectedIndex 落到首位（非 -1，下拉不塌）');
  assert.equal(trigger, '不愿透露', '触发器文字为「不愿透露」');
});

test('U3：已存 gender=male 正确回填；空/缺失 gender 默认「不愿透露」', async () => {
  for (const [profile, expectTrigger, expectValue] of [
    [{ gender: 'male' }, '男', 'male'],
    [{ gender: '' }, '不愿透露', 'undeclared'],
    [{}, '不愿透露', 'undeclared'],
  ]) {
    const { ctx } = makeCtx();
    await setupProfile(ctx, profile);
    const { value, trigger } = readGenderState(ctx);
    assert.equal(value, expectValue, `${JSON.stringify(profile)} value=${expectValue}`);
    assert.equal(trigger, expectTrigger, `${JSON.stringify(profile)} 触发器=${expectTrigger}`);
  }
});

// ============ U4：表单浮窗灰化背景 + 弹窗切透明 ============

test('U4：.modal 大扩散阴影压暗（弹窗矩形为透明孔），主题双端定义 --g-modal-dim', () => {
  const css = readFileSync('./style.css', 'utf8');
  const modalRule = css.split('#modal-container .modal {')[1] || '';
  assert.ok(modalRule.split('}')[0].includes('200vmax var(--g-modal-dim'), '弹窗挂 200vmax 压暗（四周灰化、弹窗自身透明孔）');
  // id 前缀提特异性：玻璃引擎 hover 规则（0,2,0，后载）不得盖掉压暗——悬停弹窗不得闪去灰化（审计发现）
  assert.ok(modalRule.split('}')[0].includes('var(--g-lift)'), '引擎浮影保留（三件套 + 压暗同列表）');
  const { ctx } = makeCtx();
  assert.ok(vm.runInContext('APP_CONSTANTS.THEME.light["--g-modal-dim"]', ctx), '浅色主题定义压暗色');
  assert.ok(vm.runInContext('APP_CONSTANTS.THEME.dark["--g-modal-dim"]', ctx), '深色主题定义压暗色');
});

// ============ 工具 ============

const FILES = [
  'constants.js', 'region-data.js', 'app-display.js', 'app-state.js', 'app-api.js',
  'app-datahub.js', 'app-anim.js', 'app-ui.js', 'app-onboard.js', 'app-region.js',
  'app-posts.js', 'app-chat.js', 'app-contracts.js', 'app-chart.js', 'app-admin.js',
  'app-demands.js', 'app-teachers.js', 'app-style.js', 'app-pages.js', 'app-shell.js', 'app-auth.js',
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
    console: { log() {}, warn() {}, error() {} },
    fetch: async (url) => ({ ok: true, status: 200, json: async () => ({}) }),
    setTimeout: globalThis.setTimeout, clearTimeout: globalThis.clearTimeout,
    setInterval: globalThis.setInterval, clearInterval: globalThis.clearInterval,
    Request: globalThis.Request, AbortController: globalThis.AbortController,
    performance: globalThis.performance,
    MutationObserver: class { observe() {} disconnect() {} takeRecords() { return []; } },
    Image: class { set src(v) { this._s = v; } },
    requestAnimationFrame: (cb) => setTimeout(cb, 16), cancelAnimationFrame: () => {},
    matchMedia: () => ({ matches: false, addEventListener: () => {} }),
  });
  for (const f of FILES) vm.runInContext(readFileSync('./' + f, 'utf8'), ctx, { filename: f });
  vm.runInContext('window.APP_CONSTANTS = globalThis.APP_CONSTANTS;', ctx);
  return { dom, ctx };
}

async function setupProfile(ctx, profile) {
  // 教师登录 → 进编辑页；先覆写 fetch 返回给定 profile（loadProfile 据此回填）
  vm.runInContext(`
    fetch = async (url) => ({ ok: true, status: 200, json: async () => ({ profile: ${JSON.stringify(profile)} }) });
    state.user = { id: 1, role: 'teacher', username: 't' };
    renderSidebar(); showView('client'); selectPage('edit-profile');
  `, ctx);
  await tick(80); // loadProfile fetch + 回填
}

function readGenderState(ctx) {
  return vm.runInContext(`(() => {
    const g = document.getElementById('profile-gender');
    const trig = g && g.closest('.custom-select') ? g.closest('.custom-select').querySelector('.custom-select-text') : null;
    return { value: g.value, selIdx: g.selectedIndex, trigger: trig ? trig.textContent : '' };
  })()`, ctx);
}

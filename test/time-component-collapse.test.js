/**
 * 需求七·第143条（2026-08-08）·起草合同时间组件全乱（v0.25.50）
 *
 * 缺陷实证（playwright 真页复现）：起草/签约浮窗的 schedule form-group 是 flex-wrap 容器，
 * 时间组件后紧跟的灰字提示行（flex:0 1 auto、basis=内容宽 ~309px）与 label+时间控件同排，
 * 抢掉控件宽度 → 时间控件只剩 ~63px → .time-range 塌成 0、.time-field 14px、
 * .time-hms 0px → 时/分输入框与 ghost 叠字（用户：两个时间输入气泡宽度几乎为0，字全叠）。
 *
 * 根因两处：
 * 1）form-group 尾部灰字提示未走"独占整行"接口（.form-group > [id$="-note"] { flex-basis:100% }），
 *    以内容宽与控件抢空间 → 标准接口 .form-group-note 并入既有独占整行规则。
 * 2）.time-hms 显式 min-width:0 允许时/分输入组塌到 0（默认 min-width:auto 有内容下限）→ 删掉。
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { JSDOM } from 'jsdom';
import vm from 'node:vm';

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

test('.time-hms 不再 min-width:0（时/分输入组有内容下限，永不塌零叠字）', () => {
  const css = readFileSync('./style.css', 'utf8');
  const ruleBody = (css.split('.time-hms {')[1] || '').split('}')[0];
  assert.ok(!ruleBody.includes('min-width: 0'), 'hms 不显式 min-width:0（默认 min-width:auto 内容下限）');
});

test('.form-group-note 并入独占整行接口（flex-basis:100%），尾部提示不再与控件同排抢宽', () => {
  const css = readFileSync('./style.css', 'utf8');
  const fullRowRule = css.split('.form-group > .login-username-hint, .form-group > [id$="-note"]')[1] || '';
  // 规则以逗号延续到 .form-group > .form-group-note
  const whole = css.split('.form-group > .login-username-hint')[1] || '';
  const head = whole.split('{')[0] || '';
  assert.ok(head.includes('.form-group > .form-group-note'), 'form-group-note 在独占整行规则内');
  assert.ok(whole.includes('flex-basis: 100%'), '独占整行仍生效');
});

test('起草 + 签约浮窗的 schedule 提示行带 form-group-note（时间控件不再被抢宽）', () => {
  const js = readFileSync('./app-contracts.js', 'utf8');
  assert.ok(js.includes('contract-modify-hint form-group-note'), '起草浮窗时间提示带 form-group-note');
  assert.ok(js.includes('signing-modal-hint form-group-note'), '签约浮窗时间提示带 form-group-note');
});

test('渲染验证：起草浮窗 schedule form-group 里时间提示独占整行、时间控件占满剩余宽', async () => {
  const { ctx } = makeCtx();
  vm.runInContext(`
    localStorage.setItem('sufe_returning', '1');
    state.user = { id: 1, role: 'teacher', username: 'qa_teacher' };
    state.authToken = 'x';
    window.api = async () => ({ demands: [{ id: 1, expected_time: '', subject: '数学', method: 'online', price_min: 100, price_max: 120 }] });
    window._contractDraftDemands = [{ id: 1, expected_time: '', subject: '数学', method: 'online', price_min: 100, price_max: 120 }];
  `, ctx);
  await vm.runInContext('openContractDraftModal(7);', ctx);
  const out = vm.runInContext(`
    const ts = document.getElementById('contract-time-slots');
    const fg = ts.closest('.form-group');
    const hint = fg.querySelector('.form-group-note');
    ({
      hintClass: hint ? hint.className : null,
      hintIsSibling: hint && fg.contains(hint) && ts !== hint && hint.parentElement === fg,
      timeSlotsIsDiv: ts.tagName === 'DIV',
      order: [ts, hint].map(el => [...fg.children].indexOf(el)),
    })
  `, ctx);
  assert.ok(out.hintClass.includes('form-group-note'), '时间提示行带独占整行类');
  assert.equal(out.hintIsSibling, true, '时间提示与时间控件同在 form-group（独占整行规则作用于它）');
  assert.equal(out.timeSlotsIsDiv, true, '时间控件为 form-group 内 div（flex:1 1 0 占满剩余宽）');
  assert.equal(out.order[0], 1, '时间控件在 label 之后');
  assert.equal(out.order[1], 2, '提示行在时间控件之后（独占整行排其下方）');
});

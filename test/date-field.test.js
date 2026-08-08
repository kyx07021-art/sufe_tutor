/**
 * 需求四十五（2026-08-09）·首次上课日期分段输入 + 底层段输入器抽象（v0.25.53）
 *
 * 把 guardTimeKey/onTimeInput/clampTime/refreshTimeField 泛化为底层数字段输入原语
 * （guardSegmentKey/guardSegmentBeforeInput/onSegmentInput/clampSegment/refreshSegmentField，
 * 段配置走 data-* 属性），时间(时:分) 与 日期(年-月-日) 同族复用。
 * 首次上课日期从原生 <input type="date"> 换成分段日期输入（dateFieldHtml）：
 *   - 复用 .time-field 玻璃面（.seg-field 修饰），三段 + 连字符 + 居中灰字占位；
 *   - 三层防线：input 拦截 + blur 钳制（clampSegment/clampYear/clampDateDay）+ 读取时钳制；
 *   - 真实日历校验（daysInMonth 含闰年）：2/31→2月末、4/31→4/30，防服务端 regex
 *     ^\d{4}-\d{2}-\d{2}$ 放行非法日期入库；序列化契约 YYYY-MM-DD，服务端零改动。
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { JSDOM } from 'jsdom';
import { readFileSync } from 'node:fs';
import vm from 'node:vm';

const FILES = [
  'constants.js', 'region-data.js', 'app-display.js', 'app-state.js', 'app-api.js',
  'app-datahub.js', 'app-anim.js', 'app-ui.js', 'app-onboard.js', 'app-region.js',
  'app-posts.js', 'app-chat.js', 'app-contracts.js', 'app-chart.js', 'app-admin.js',
  'app-demands.js', 'app-teachers.js', 'app-style.js', 'app-pages.js', 'app-shell.js', 'app-auth.js',
];

function makeCtx(record) {
  const html = readFileSync('./index.html', 'utf8')
    .replace(/<script src="\/app-[a-z-]+\.js"><\/script>/g, '');
  const dom = new JSDOM(html, { url: 'http://localhost/', pretendToBeVisual: true, runScripts: 'dangerously' });
  const w = dom.window;
  const ctx = vm.createContext({
    window: w, document: w.document,
    getComputedStyle: w.getComputedStyle.bind(w),
    localStorage: w.localStorage, sessionStorage: w.sessionStorage,
    console,
    fetch: async (url, opts = {}) => {
      const s = String(url);
      if (record && s === '/api/contracts') {
        let parsed = null;
        try { parsed = typeof opts.body === 'string' ? JSON.parse(opts.body) : (opts.body || null); } catch { parsed = null; }
        record.push({ url: s, method: opts.method || 'GET', body: parsed });
      }
      if (s.includes('bindable-demands')) return { ok: true, status: 200, json: async () => ({ demands: [{ id: 7, expected_time: '' }] }) };
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
  for (const f of FILES) vm.runInContext(readFileSync('./' + f, 'utf8'), ctx, { filename: f });
  vm.runInContext('window.APP_CONSTANTS = globalThis.APP_CONSTANTS;', ctx);
  return { dom, ctx };
}

test('dateFieldHtml：三段（年/月/日）+ 分隔连字符 + 居中灰字占位 + 每段 aria 与 data-* 段配置', () => {
  const { ctx } = makeCtx();
  const html = vm.runInContext('dateFieldHtml()', ctx);
  assert.ok(html.includes('id="contract-first-lesson-field"'), '容器 id 稳定（提交读取点）');
  assert.ok(html.includes('seg-year') && html.includes('seg-month') && html.includes('seg-day'), '年/月/日三段');
  assert.equal((html.match(/class="seg-sep"/g) || []).length, 2, '两处分隔连字符');
  assert.ok(html.includes('seg-ghost'), '居中灰字占位');
  assert.ok(html.includes('aria-label="年"') && html.includes('aria-label="月"') && html.includes('aria-label="日"'), '每段 aria-label');
  assert.ok(html.includes('data-maxlen="4"') && html.includes('data-maxlen="2"'), '年份 4 位、月/日 2 位');
  assert.ok(html.includes('data-max="12"') && html.includes('data-max="31"'), '月≤12、日≤31 段上限');
  assert.ok(html.includes('clampYear(this)'), '年份 blur 走 clampYear（不补零）');
  assert.ok(html.includes('clampDateDay(this)'), '日段 blur 走 clampDateDay（真实月末钳制）');
  // 复用底层原语守卫
  assert.ok(html.includes('guardSegmentKey') && html.includes('guardSegmentBeforeInput'), '通用守卫挂载');
});

test('readDateField：空→""（另行协商）、半填→null、年份不足四位→null、完整→YYYY-MM-DD 补零', () => {
  const { ctx } = makeCtx();
  const fns = vm.runInContext(`({ dateFieldHtml, readDateField })`, ctx);
  // 空：所有段为空
  assert.equal(fns.readDateField(vm.runInContext(`(() => { const d = document.createElement('div'); d.innerHTML = dateFieldHtml(); return d.querySelector('#contract-first-lesson-field'); })()`, ctx)), '');
  // 半填：只填年
  let v = vm.runInContext(`(() => { const d = document.createElement('div'); d.innerHTML = dateFieldHtml(); const f = d.querySelector('#contract-first-lesson-field'); f.querySelector('.seg-year').value = '2026'; return f; })()`, ctx);
  assert.equal(fns.readDateField(v), null, '半填返回 null（调用方拦截）');
  // 年份不足四位（25 → 歧义 0025）拒绝
  v = vm.runInContext(`(() => { const d = document.createElement('div'); d.innerHTML = dateFieldHtml(); const f = d.querySelector('#contract-first-lesson-field'); f.querySelector('.seg-year').value = '25'; f.querySelector('.seg-month').value = '8'; f.querySelector('.seg-day').value = '15'; return f; })()`, ctx);
  assert.equal(fns.readDateField(v), null, '年份不足四位拒绝（防 25→0025）');
  // 完整：补零
  v = vm.runInContext(`(() => { const d = document.createElement('div'); d.innerHTML = dateFieldHtml(); const f = d.querySelector('#contract-first-lesson-field'); f.querySelector('.seg-year').value = '2026'; f.querySelector('.seg-month').value = '8'; f.querySelector('.seg-day').value = '15'; return f; })()`, ctx);
  assert.equal(fns.readDateField(v), '2026-08-15', '补零到 YYYY-MM-DD');
});

test('真实日历校验：2/31→2/28、4/31→4/30、闰年 2028-02-29 合法', () => {
  const { ctx } = makeCtx();
  const fns = vm.runInContext(`({ dateFieldHtml, readDateField })`, ctx);
  const build = (y, m, d) => vm.runInContext(`(() => { const el = document.createElement('div'); el.innerHTML = dateFieldHtml(); const f = el.querySelector('#contract-first-lesson-field'); f.querySelector('.seg-year').value = '${y}'; f.querySelector('.seg-month').value = '${m}'; f.querySelector('.seg-day').value = '${d}'; return f; })()`, ctx);
  assert.equal(fns.readDateField(build('2026', '2', '31')), '2026-02-28', '非闰年 2 月钳到 28');
  assert.equal(fns.readDateField(build('2028', '2', '29')), '2028-02-29', '闰年 2 月 29 合法保留');
  assert.equal(fns.readDateField(build('2028', '2', '30')), '2028-02-29', '闰年 2 月 30 钳到 29');
  assert.equal(fns.readDateField(build('2026', '4', '31')), '2026-04-30', '4 月 31 钳到 30');
  assert.equal(fns.readDateField(build('2026', '13', '15')), '2026-12-15', '月 13 钳到 12');
});

test('clampSegment/clampYear/clampDateDay blur 钳制（复用底层原语，data-* 段配置）', () => {
  const { ctx } = makeCtx();
  vm.runInContext(`
    const el = document.createElement('div');
    el.innerHTML = dateFieldHtml();
    const field = el.querySelector('#contract-first-lesson-field');
    document.body.appendChild(field);
  `, ctx);
  // 年份：范围 1-9999，不补零（25 保持 25，不做 0025）
  assert.equal(vm.runInContext(`(() => { const i = document.querySelector('.seg-year'); i.value = '25'; clampYear(i); return i.value; })()`, ctx), '25', '年份 blur 不补零');
  assert.equal(vm.runInContext(`(() => { const i = document.querySelector('.seg-year'); i.value = '12000'; clampYear(i); return i.value; })()`, ctx), '9999', '年份钳制 9999');
  // 月份：补零 + 钳 12
  assert.equal(vm.runInContext(`(() => { const i = document.querySelector('.seg-month'); i.value = '8'; clampSegment(i); return i.value; })()`, ctx), '08', '月份补零');
  assert.equal(vm.runInContext(`(() => { const i = document.querySelector('.seg-month'); i.value = '13'; clampSegment(i); return i.value; })()`, ctx), '12', '月份钳 12');
  // 日段：填齐年月后按真实月末钳制（2026-02-31 → 2026-02-28）
  vm.runInContext(`
    document.querySelector('.seg-year').value = '2026';
    document.querySelector('.seg-month').value = '02';
    const d = document.querySelector('.seg-day'); d.value = '31'; clampDateDay(d);
  `, ctx);
  assert.equal(vm.runInContext('document.querySelector(".seg-day").value', ctx), '28', '日段按真实月末钳制');
  assert.equal(vm.runInContext('document.querySelector("#contract-first-lesson-field").classList.contains("has-value")', ctx), true, '有值后 has-value（灰字渐隐）');
});

test('submitContractDraft 集成：日期空→另行协商空串；半填→校验拦截；完整→携带 YYYY-MM-DD', async () => {
  const setup = (ctx) => vm.runInContext(`
    state.user = { id: 1, role: 'teacher', username: 'qa_teacher' };
    state.authToken = 'x';
    openContractDraftModal(1);
  `, ctx);
  // 1) 日期留空 → 合法（另行协商），提交 firstLessonDate=''
  {
    const record = [];
    const { ctx } = makeCtx(record);
    await setup(ctx);
    vm.runInContext(`
      document.getElementById('contract-demand').value = '7';
      document.getElementById('contract-rate').value = '200';
      document.getElementById('contract-location').value = '线上';
      document.getElementById('post-body').value = '补基础';
    `, ctx);
    await vm.runInContext('submitContractDraft(1)', ctx);
    assert.equal(record.length, 1, 'POST 发出');
    assert.equal(record[0].body.firstLessonDate, '', '日期留空 = 由双方另行协商（空串）');
  }
  // 2) 日期半填 → 前端拦截
  {
    const record = [];
    const { ctx } = makeCtx(record);
    await setup(ctx);
    vm.runInContext(`
      document.getElementById('contract-demand').value = '7';
      document.getElementById('contract-rate').value = '200';
      document.getElementById('contract-location').value = '线上';
      document.getElementById('post-body').value = '补基础';
      document.querySelector('#contract-first-lesson-field .seg-year').value = '2026';
    `, ctx);
    await vm.runInContext('submitContractDraft(1)', ctx);
    assert.equal(record.length, 0, '半填不发起请求');
    const alertText = vm.runInContext('document.getElementById("contract-alert").innerHTML', ctx);
    assert.ok(alertText.includes('请完整填写首次上课日期'), '半填给出提示');
  }
  // 3) 日期完整 → 提交 YYYY-MM-DD
  {
    const record = [];
    const { ctx } = makeCtx(record);
    await setup(ctx);
    vm.runInContext(`
      document.getElementById('contract-demand').value = '7';
      document.getElementById('contract-rate').value = '200';
      document.getElementById('contract-location').value = '线上';
      document.getElementById('post-body').value = '补基础';
      document.querySelector('#contract-first-lesson-field .seg-year').value = '2026';
      document.querySelector('#contract-first-lesson-field .seg-month').value = '8';
      document.querySelector('#contract-first-lesson-field .seg-day').value = '15';
    `, ctx);
    await vm.runInContext('submitContractDraft(1)', ctx);
    assert.equal(record.length, 1, 'POST 发出');
    assert.equal(record[0].body.firstLessonDate, '2026-08-15', '序列化 YYYY-MM-DD');
  }
});

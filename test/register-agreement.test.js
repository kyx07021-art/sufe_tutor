/**
 * 需求三十（2026-08-08）·注册须同意用户协议与隐私政策（v0.25.47）
 *
 * 用户要求：协议/隐私政策文件（下划线文件名）进仓库；注册表单两行轻量勾选
 * （「我已阅读并同意用户协议/隐私政策」）；点击文档名浮窗展示 md 全文（复用 mdRender）；
 * 服务端同款强校验（前端勾选可被构造请求绕过，平台合规红线）。
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { JSDOM } from 'jsdom';
import vm from 'node:vm';
import { DatabaseSync } from 'node:sqlite';
import { initDb } from '../server/db.js';
import { requestOtp } from '../server/otp.js';
import { handleRegister } from '../server/routes-auth.js';
import { tokenDigest } from '../server/crypto.js';
import { lastOtpCode } from './_otp-stub.js'; // stub fetch 防真实发信（真实代码路径 + 捕获验证码）

const ENV = { ADMIN_USERNAMES: ['admin_sufe'], ADMIN_DEFAULT_PASSWORD: 'test-pw-123' };

function d1Shim(raw) {
  return {
    prepare(sql) {
      const st = { _sql: sql, _params: [], bind(...p) { st._params = p; return st; },
        all(...p) { return { results: raw.prepare(st._sql).all(...(p.length ? p : st._params)) }; },
        first(...p) { return raw.prepare(st._sql).get(...(p.length ? p : st._params)) ?? undefined; },
        run(...p) { const info = raw.prepare(st._sql).run(...(p.length ? p : st._params)); return { meta: { changes: Number(info.changes), last_row_id: Number(info.lastInsertRowid) } }; } };
      return st;
    },
    batch(stmts) {
      if (!stmts.length) throw new Error('D1 batch requires at least one statement'); // 真实 D1 空 batch 抛错（同 content-admin shim 口径）
      raw.exec('BEGIN');
      try {
        const out = [];
        for (const s of stmts) {
          if (/^\s*(SELECT|PRAGMA|WITH|EXPLAIN)/i.test(s._sql)) out.push({ results: raw.prepare(s._sql).all(...s._params) });
          else { const info = raw.prepare(s._sql).run(...s._params); out.push({ meta: { changes: Number(info.changes), last_row_id: Number(info.lastInsertRowid) } }); }
        }
        raw.exec('COMMIT');
        return out;
      } catch (e) { try { raw.exec('ROLLBACK'); } catch { /* ignore */ } throw e; }
    },
  };
}
const reqOf = () => ({ headers: new Headers({ 'X-Auth-Token': 'none' }) });

const FILES = [
  'constants.js', 'region-data.js', 'app-display.js', 'app-state.js', 'app-api.js',
  'app-datahub.js', 'app-anim.js', 'app-ui.js', 'app-otp.js', 'app-captcha.js', 'app-onboard.js', 'app-region.js',
  'app-posts.js', 'app-chat.js', 'app-contracts.js', 'app-chart.js', 'app-admin.js',
  'app-demands.js', 'app-teachers.js', 'app-style.js', 'app-pages.js', 'app-shell.js', 'app-auth.js',
];

function makeCtx() {
  const html = readFileSync('./index.html', 'utf8')
    .replace(/<script src="\/app-[a-z-]+\.js"><\/script>/g, '');
  const dom = new JSDOM(html, { url: 'http://localhost/', pretendToBeVisual: true, runScripts: 'dangerously' });
  const w = dom.window;
  w.HTMLCanvasElement.prototype.getContext = function () { // jsdom 无 canvas：patch 链式 2d 替身（app-captcha 进 boot FILES 后 vm 测试走到 canvas 路径）
    const mk = () => new Proxy(() => {}, { get: (t, k) => (k === 'canvas' ? {} : mk()), apply: () => mk() });
    return mk();
  };
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
  vm.runInContext(`if (typeof openCaptchaModal === 'function') { const _ocm = openCaptchaModal; openCaptchaModal = (o) => { if (o && o.onPass) o.onPass(); }; }`, ctx); // vm 测试直通拼图（生产走真验证）
  vm.runInContext('window.APP_CONSTANTS = globalThis.APP_CONSTANTS;', ctx);
  return { dom, ctx };
}

// ============ 服务端：注册强校验（合规红线，不同意即拒绝，不建账户） ============

test('服务端：未同意协议/隐私政策 → 拒绝注册且不建账户', async () => {
  const raw = new DatabaseSync(':memory:'); raw.exec('PRAGMA foreign_keys = ON');
  const db = d1Shim(raw);
  await initDb(db, ENV);
  // 前端勾选可被构造请求绕过——只发账号信息、不带同意标志必须被拒
  const r1 = await handleRegister(db, { username: 'u_deny', password: 'pass123456', role: 'student', deviceId: 'd1' }, reqOf());
  assert.equal(r1.status, 400);
  assert.equal((await r1.json()).error, '请先勾选同意用户协议与隐私政策');
  assert.equal(raw.prepare("SELECT COUNT(*) AS c FROM users WHERE username='u_deny'").get().c, 0, '不同意不建账户');
  // 只同意一半也不行
  const r2 = await handleRegister(db, { username: 'u_half', password: 'pass123456', role: 'student', deviceId: 'd1', agreeAgreement: true, agreePrivacy: false }, reqOf());
  assert.equal(r2.status, 400, '只勾选协议、不勾选隐私同样拒绝');
  assert.equal(raw.prepare("SELECT COUNT(*) AS c FROM users WHERE username='u_half'").get().c, 0);
});

test('服务端：双同意 → 注册成功', async () => {
  const raw = new DatabaseSync(':memory:'); raw.exec('PRAGMA foreign_keys = ON');
  const db = d1Shim(raw);
  await initDb(db, ENV);
  const target = '+8613912345678';
  const otp = await requestOtp(db, { channel: 'sms', target }, reqOf());
  const r = await handleRegister(db, { username: 'u_ok', password: 'pass123456', role: 'student', deviceId: 'd1', agreeAgreement: true, agreePrivacy: true, phone: target, otpChannel: 'sms', code: lastOtpCode(target) }, reqOf());
  assert.equal(r.status, 200);
  assert.equal(raw.prepare("SELECT COUNT(*) AS c FROM users WHERE username='u_ok'").get().c, 1, '双同意才建账户');
});

// ============ 协议/隐私政策内容（v0.25.51：硬编码进 constants，替代独立 .md 静态文件） ============
// 曾以独立 .md fetch：_worker.js 静态回退拦截一切 .md（防 docs/ 泄露）→ 生产 404「协议内容加载失败」。
// 改 constants 直渲（单源原则：用户可见文案只在 constants.js）。.md 文件已删，不再依赖静态服务。

test('用户协议/隐私政策全文硬编码进 constants 且为 mdRender 可渲染语法', async () => {
  const { ctx } = makeCtx();
  const UI = vm.runInContext('window.APP_CONSTANTS.UI', ctx);
  assert.ok(UI.POLICY_AGREEMENT.startsWith('# 经世知途家教信息平台用户协议'), '用户协议有 H1 标题');
  assert.ok(UI.POLICY_AGREEMENT.includes('## 一、总则'), '用户协议有 H2 分节');
  assert.ok(UI.POLICY_AGREEMENT.includes('**'), '用户协议含加粗强调');
  assert.ok(UI.POLICY_AGREEMENT.includes('纯信息撮合服务平台'), '协议含平台定位条款');
  assert.ok(UI.POLICY_PRIVACY.startsWith('# 经世知途家教信息平台隐私政策'), '隐私政策有 H1 标题');
  assert.ok(UI.POLICY_PRIVACY.includes('个人信息保护法'), '隐私政策援引法律');
  // 无 fetch 依赖的接口：key 常量 + 内容常量齐备（POLICY_FILE_* 旧接口已删）
  assert.equal(UI.POLICY_KEY_AGREEMENT, 'user_agreement', 'key 接口与 index.html 一致');
  assert.equal(UI.POLICY_KEY_PRIVACY, 'privacy_policy', 'key 接口与 index.html 一致');
  assert.equal(UI.POLICY_LOAD_FAIL, undefined, '旧加载失败兜底文案已删（不再有 fetch 失败路径）');
});

// ============ 前端：注册表单两行轻量勾选 ============

test('前端：注册表单含两行勾选（我已阅读并同意用户协议/隐私政策），未勾选注册被拦', async () => {
  const { ctx } = makeCtx();
  const html = vm.runInContext('document.getElementById("view-register").innerHTML', ctx);
  assert.ok(html.includes('agree-agreement'), '用户协议勾选框存在');
  assert.ok(html.includes('agree-privacy'), '隐私政策勾选框存在');
  assert.ok(html.includes('我已阅读并同意'), '勾选文案前缀');
  assert.ok(html.includes('openPolicyModal'), '文档名可点浮窗');
  // 未勾选 → 提交被前端拦截（alert 显示 AGREE_REQUIRED，不发起请求）
  vm.runInContext(`
    let sent = false;
    const _origApi = api;
    api = async () => { sent = true; throw new Error('不应发请求'); };
    document.getElementById('register-username').value = 'u_front';
    document.getElementById('register-password').value = 'pass123456';
    document.getElementById('register-password2').value = 'pass123456';
    window.__sent = () => sent;
  `, ctx);
  await vm.runInContext('handleRegister({ preventDefault() {} })', ctx);
  assert.equal(vm.runInContext('[...document.querySelectorAll("#toast-container .toast")].some(t => t.textContent.includes("请先勾选同意用户协议与隐私政策"))', ctx), true, '未勾选 Toast 提示');
  assert.equal(vm.runInContext('window.__sent()', ctx), false, '未勾选不发注册请求');
});

test('前端：勾选后 handleRegister 携带同意标志发起注册', async () => {
  const { ctx } = makeCtx();
  vm.runInContext(`
    let sentBody = null;
    const _origApi = api;
    api = async (url, opts) => { sentBody = opts && opts.body; return { user: { id: 1, username: 'u_ok', role: 'student' }, authToken: 't' }; };
    afterAuthSuccess = () => {};   // 注册后导航等环境依赖重活：测试只验请求体
    saveSession = () => {};
    window.__body = () => sentBody;
    document.getElementById('register-username').value = 'u_ok';
    document.getElementById('register-password').value = 'pass123456';
    document.getElementById('register-password2').value = 'pass123456';
    document.getElementById('agree-agreement').checked = true;
    document.getElementById('agree-privacy').checked = true;
    document.getElementById('register-identifier').value = '13811112222';
    document.getElementById('register-code').value = '123456';
  `, ctx);
  await vm.runInContext('handleRegister({ preventDefault() {} })', ctx);
  const body = vm.runInContext('window.__body()', ctx);
  assert.ok(body && body.agreeAgreement === true, '请求带 agreeAgreement=true');
  assert.ok(body && body.agreePrivacy === true, '请求带 agreePrivacy=true');
  assert.equal(body && body.phone, '+8613811112222', 'v1.0 R7：裸手机号补 +86 随注册上送');
  assert.equal(body && body.otpChannel, 'sms', '验证码通道 sms');
});

// ============ 前端：openPolicyModal 浮窗渲染 md（v0.25.51：常量直渲，无 fetch） ============

test('openPolicyModal 直接渲染 constants 政策全文（无 fetch、无加载失败路径）', () => {
  const { ctx } = makeCtx();
  vm.runInContext(`
    // 抑制首访新手引导自动弹窗（jsdom DOMContentLoaded 异步触发会覆盖被测浮窗）：置 returning + 清现有弹窗
    localStorage.setItem('sufe_returning', '1');
    closeModal();
    window.__fetchCalls = 0;
    const _origFetch = fetch;
    fetch = async () => { window.__fetchCalls++; return { ok: true, json: async () => ({}) }; };
    openPolicyModal('user_agreement');
  `, ctx);
  const html = vm.runInContext('document.getElementById("modal-container").innerHTML', ctx);
  assert.ok(html.includes('modal'), '浮窗已打开');
  assert.ok(html.includes('用户协议'), '浮窗标题为用户协议');
  const bodyHtml = vm.runInContext('document.querySelector("#modal-container .policy-body").innerHTML', ctx);
  assert.ok(bodyHtml.includes('<h1>经世知途家教信息平台用户协议</h1>'), '协议 H1 渲染（常量全文）');
  assert.ok(bodyHtml.includes('<h2>一、总则</h2>'), '协议 H2 渲染');
  assert.ok(bodyHtml.includes('<p>'), '协议段落渲染');
  assert.equal(vm.runInContext('window.__fetchCalls', ctx), 0, '不再发起任何 fetch（政策离线可用）');
  // 隐私政策同款
  vm.runInContext('closeModal(); openPolicyModal(\'privacy_policy\');', ctx);
  const privHtml = vm.runInContext('document.querySelector("#modal-container .policy-body").innerHTML', ctx);
  assert.ok(privHtml.includes('<h1>经世知途家教信息平台隐私政策</h1>'), '隐私政策 H1 渲染');
  assert.ok(privHtml.includes('个人信息保护法'), '隐私政策正文在');
});

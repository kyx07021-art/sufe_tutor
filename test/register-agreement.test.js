/**
 * 需求三十（2026-08-08）·注册须同意用户协议与隐私政策（v0.25.47）
 *
 * 用户要求：协议/隐私政策文件（下划线文件名）进仓库；注册表单两行轻量勾选
 * （「我已阅读并同意用户协议/隐私政策」）；点击文档名浮窗展示 md 全文（复用 mdRender）；
 * 服务端同款强校验（前端勾选可被构造请求绕过，平台合规红线）。
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, existsSync } from 'node:fs';
import { JSDOM } from 'jsdom';
import vm from 'node:vm';
import { DatabaseSync } from 'node:sqlite';
import { initDb } from '../server/db.js';
import { handleRegister } from '../server/routes-auth.js';
import { tokenDigest } from '../server/crypto.js';

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

// ============ 服务端：注册强校验（合规红线，不同意即拒绝，不建账户） ============

test('服务端：未同意协议/隐私政策 → 拒绝注册且不建账户', async () => {
  const raw = new DatabaseSync(':memory:'); raw.exec('PRAGMA foreign_keys = ON');
  const db = d1Shim(raw);
  await initDb(db, ENV);
  // 前端勾选可被构造请求绕过——只发账号信息、不带同意标志必须被拒
  const r1 = await handleRegister(db, { username: 'u_deny', password: 'pass123456', role: 'student', deviceId: 'd1' }, reqOf());
  assert.equal(r1.status, 400);
  assert.equal((await r1.json()).error, '注册须同意用户协议与隐私政策');
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
  const r = await handleRegister(db, { username: 'u_ok', password: 'pass123456', role: 'student', deviceId: 'd1', agreeAgreement: true, agreePrivacy: true }, reqOf());
  assert.equal(r.status, 200);
  assert.equal(raw.prepare("SELECT COUNT(*) AS c FROM users WHERE username='u_ok'").get().c, 1, '双同意才建账户');
});

// ============ 协议/隐私政策文件 ============

test('用户协议/隐私政策 md 文件就位（下划线文件名）且为有效 markdown', () => {
  assert.ok(existsSync('./user_agreement.md'), 'user_agreement.md 存在');
  assert.ok(existsSync('./privacy_policy.md'), 'privacy_policy.md 存在');
  const agr = readFileSync('./user_agreement.md', 'utf8');
  const priv = readFileSync('./privacy_policy.md', 'utf8');
  assert.ok(agr.startsWith('# '), '用户协议有 H1 标题');
  assert.ok(agr.includes('## '), '用户协议有 H2 分节');
  assert.ok(agr.includes('**'), '用户协议含加粗强调');
  assert.ok(agr.includes('纯信息撮合服务平台'), '协议含平台定位条款');
  assert.ok(priv.startsWith('# '), '隐私政策有 H1 标题');
  assert.ok(priv.includes('个人信息保护法'), '隐私政策援引法律');
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
  assert.equal(vm.runInContext('document.getElementById("register-alert").innerHTML.includes("请先勾选同意用户协议与隐私政策")', ctx), true, '未勾选给出提示');
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
  `, ctx);
  await vm.runInContext('handleRegister({ preventDefault() {} })', ctx);
  const body = vm.runInContext('window.__body()', ctx);
  assert.ok(body && body.agreeAgreement === true, '请求带 agreeAgreement=true');
  assert.ok(body && body.agreePrivacy === true, '请求带 agreePrivacy=true');
});

// ============ 前端：openPolicyModal 浮窗渲染 md ============

test('openPolicyModal 拉取 md 并渲染进浮窗（复用 mdRender）', async () => {
  const { ctx } = makeCtx();
  vm.runInContext(`
    // 抑制首访新手引导自动弹窗（jsdom DOMContentLoaded 异步触发会覆盖被测浮窗）：置 returning + 清现有弹窗
    localStorage.setItem('sufe_returning', '1');
    closeModal();
    const _origFetch = fetch;
    fetch = async (url) => {
      if (String(url).includes('user_agreement.md')) return { ok: true, text: async () => '# 测试协议\\n## 第一条\\n条款内容' };
      return { ok: true, json: async () => ({}) };
    };
    openPolicyModal('user_agreement');
  `, ctx);
  await new Promise(r => setTimeout(r, 30));
  const html = vm.runInContext('document.getElementById("modal-container").innerHTML', ctx);
  assert.ok(html.includes('modal'), '浮窗已打开');
  assert.ok(html.includes('用户协议'), '浮窗标题为用户协议');
  // mdRender 输出：H1 标题 + H2 + 段落
  const bodyHtml = vm.runInContext('document.querySelector("#modal-container .policy-body").innerHTML', ctx);
  assert.ok(bodyHtml.includes('<h1>测试协议</h1>'), 'md H1 渲染');
  assert.ok(bodyHtml.includes('<h2>第一条</h2>'), 'md H2 渲染');
  assert.ok(bodyHtml.includes('<p>条款内容</p>'), 'md 段落渲染');
});

/**
 * 需求三十 · 注册须同意用户协议与隐私政策（B4：直接 import auth ESM）。
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { JSDOM } from 'jsdom';
import { DatabaseSync } from 'node:sqlite';
import { initDb } from '../src/server/core/db.js';
import { requestOtp } from '../src/server/core/otp.js';
import { handleRegister as serverHandleRegister } from '../src/server/domains/auth/api.js';
import { lastOtpCode } from './_otp-stub.js';
import { TEXT } from '../src/client/constants/text.js';
import { studentRegisterFormHtml } from '../src/client/features/auth/render.js';
import { handleRegister, doRegister } from '../src/client/features/auth/actions-register.js';
import { openPolicyModal } from '../src/client/core/ui.js';
import { state } from '../src/client/core/state.js';
import { stopBadgePoll } from '../src/client/core/router.js';
import { stopVersionProbe } from '../src/client/core/datahub.js';

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
      if (!stmts.length) throw new Error('D1 batch requires at least one statement');
      raw.exec('BEGIN');
      try {
        const out = [];
        for (const s of stmts) {
          if (/^\s*(SELECT|PRAGMA|WITH|EXPLAIN)/i.test(s._sql)) out.push({ results: raw.prepare(s._sql).all(...s._params) });
          else { const info = raw.prepare(s._sql).run(...s._params); out.push({ meta: { changes: Number(info.changes), last_row_id: Number(info.lastInsertRowid) } }); }
        }
        raw.exec('COMMIT'); return out;
      } catch (e) { try { raw.exec('ROLLBACK'); } catch { /* ignore */ } throw e; }
    },
  };
}
const reqOf = () => ({ headers: new Headers({ 'X-Auth-Token': 'none' }) });

test('服务端：未同意协议/隐私政策 → 拒绝注册且不建账户', async () => {
  const raw = new DatabaseSync(':memory:'); raw.exec('PRAGMA foreign_keys = ON');
  const db = d1Shim(raw); await initDb(db, ENV);
  const r1 = await serverHandleRegister(db, { username: 'u_deny', password: 'pass123456', role: 'student', deviceId: 'd1' }, reqOf());
  assert.equal(r1.status, 400);
  assert.equal((await r1.json()).error, '请先勾选同意用户协议与隐私政策');
  assert.equal(raw.prepare("SELECT COUNT(*) AS c FROM users WHERE username='u_deny'").get().c, 0);
  const r2 = await serverHandleRegister(db, { username: 'u_half', password: 'pass123456', role: 'student', deviceId: 'd1', agreeAgreement: true, agreePrivacy: false }, reqOf());
  assert.equal(r2.status, 400);
  assert.equal(raw.prepare("SELECT COUNT(*) AS c FROM users WHERE username='u_half'").get().c, 0);
});

test('服务端：双同意 → 注册成功', async () => {
  const raw = new DatabaseSync(':memory:'); raw.exec('PRAGMA foreign_keys = ON');
  const db = d1Shim(raw); await initDb(db, ENV);
  const target = '+8613912345678';
  await requestOtp(db, { channel: 'sms', target }, reqOf());
  const r = await serverHandleRegister(db, { username: 'u_ok', password: 'pass123456', role: 'student', deviceId: 'd1', agreeAgreement: true, agreePrivacy: true, phone: target, otpChannel: 'sms', code: lastOtpCode(target) }, reqOf());
  assert.equal(r.status, 200);
  assert.equal(raw.prepare("SELECT COUNT(*) AS c FROM users WHERE username='u_ok'").get().c, 1);
});

test('用户协议/隐私政策全文硬编码进 constants 且为 mdRender 可渲染语法', () => {
  assert.ok(TEXT.POLICY_AGREEMENT.startsWith('# 经世知途家教信息平台用户协议'));
  assert.ok(TEXT.POLICY_AGREEMENT.includes('## 一、总则'));
  assert.ok(TEXT.POLICY_AGREEMENT.includes('**'));
  assert.ok(TEXT.POLICY_AGREEMENT.includes('纯信息撮合服务平台'));
  assert.ok(TEXT.POLICY_PRIVACY.startsWith('# 经世知途家教信息平台隐私政策'));
  assert.ok(TEXT.POLICY_PRIVACY.includes('个人信息保护法'));
  assert.equal(TEXT.POLICY_KEY_AGREEMENT, 'user_agreement');
  assert.equal(TEXT.POLICY_KEY_PRIVACY, 'privacy_policy');
  assert.equal(TEXT.POLICY_LOAD_FAIL, undefined, '旧加载失败兜底文案已删');
});

function setupDom() {
  const dom = new JSDOM('<!DOCTYPE html><html><body><div id="toast-container"></div><div id="modal-container"></div></body></html>', { url: 'http://localhost/', pretendToBeVisual: true });
  globalThis.document = dom.window.document;
  globalThis.window = dom.window;
  globalThis.localStorage = dom.window.localStorage;
  globalThis.sessionStorage = dom.window.sessionStorage;
  globalThis.MutationObserver = class { observe() {} disconnect() {} takeRecords() { return []; } };
  return dom;
}
function teardown() {
  // afterAuthSuccess 会启动红点/版本探测轮询；测试结束必须清 interval，否则 node --test 进程挂起不退出
  if (typeof document !== 'undefined') stopBadgePoll();
  stopVersionProbe();
  delete globalThis.document; delete globalThis.window; delete globalThis.localStorage; delete globalThis.sessionStorage; delete globalThis.MutationObserver;
}

test('前端：注册表单含两行勾选；未勾选注册被拦', async (t) => {
  t.after(() => { delete globalThis.fetch; teardown(); });
  const dom = setupDom();
  const html = studentRegisterFormHtml();
  assert.ok(html.includes('agree-agreement'));
  assert.ok(html.includes('agree-privacy'));
  assert.ok(html.includes('我已阅读并同意'));
  assert.ok(html.includes('data-action="auth.openAgreement"') || html.includes('openPolicyModal'));
  dom.window.document.body.insertAdjacentHTML('beforeend', `
    <input id="register-role" value="student">
    <input id="register-username"><input id="register-password"><input id="register-password2">
    <input id="agree-agreement"><input id="agree-privacy">
    <input id="register-identifier"><input id="register-code">
    <button id="register-submit"></button>
  `);
  let sent = false;
  globalThis.fetch = async () => { sent = true; throw new Error('不应发请求'); };
  document.getElementById('register-username').value = 'u_front';
  document.getElementById('register-password').value = 'pass123456';
  document.getElementById('register-password2').value = 'pass123456';
  await handleRegister({ preventDefault() {} });
  assert.ok(document.querySelector('#toast-container').textContent.includes('请先勾选同意用户协议与隐私政策'), '未勾选 Toast 提示');
  assert.equal(sent, false, '未勾选不发注册请求');

});

test('前端：勾选后 doRegister 携带同意标志发起注册', async (t) => {
  t.after(() => { delete globalThis.fetch; teardown(); });
  const dom = setupDom();
  state.user = null; state.authToken = null;
  let sentBody = null;
  globalThis.fetch = async (url, opts) => {
    // afterAuthSuccess 会触发 /api/batch 预取等后续请求，只记录注册端点本身
    if (String(url) === '/api/auth/register') sentBody = JSON.parse(opts.body);
    return { ok: true, status: 200, json: async () => url === '/api/auth/register'
      ? { user: { id: 1, username: 'u_ok', role: 'student' }, authToken: 't' }
      : { results: [] } };
  };
  document.body.insertAdjacentHTML('beforeend', `<button id="register-submit"></button>`);
  await doRegister('u_ok', 'pass123456', 'student', true, true, { ident: '13811112222', code: '123456', kind: 'phone' });
  assert.ok(sentBody.agreeAgreement === true, '请求带 agreeAgreement=true');
  assert.ok(sentBody.agreePrivacy === true, '请求带 agreePrivacy=true');
  assert.equal(sentBody.phone, '+8613811112222', '裸手机号补 +86');
  assert.equal(sentBody.otpChannel, 'sms', '验证码通道 sms');

});

test('openPolicyModal 直接渲染 constants 政策全文（无 fetch、无加载失败路径）', (t) => {
  t.after(() => { delete globalThis.fetch; teardown(); });
  const dom = setupDom();
  let fetchCalls = 0;
  globalThis.fetch = async () => { fetchCalls++; return { ok: true, status: 200, json: async () => ({}) }; };
  openPolicyModal('user_agreement');
  const html = dom.window.document.getElementById('modal-container').innerHTML;
  assert.ok(html.includes('modal'), '浮窗已打开');
  assert.ok(html.includes('用户协议'), '浮窗标题为用户协议');
  const bodyHtml = dom.window.document.querySelector('#modal-container .policy-body').innerHTML;
  assert.ok(bodyHtml.includes('<h1>经世知途家教信息平台用户协议</h1>'), '协议 H1 渲染');
  assert.ok(bodyHtml.includes('<h2>一、总则</h2>'), '协议 H2 渲染');
  assert.ok(bodyHtml.includes('<p>'), '协议段落渲染');
  assert.equal(fetchCalls, 0, '不再发起任何 fetch');
  openPolicyModal('privacy_policy');
  const privHtml = dom.window.document.querySelector('#modal-container .policy-body').innerHTML;
  assert.ok(privHtml.includes('<h1>经世知途家教信息平台隐私政策</h1>'), '隐私政策 H1 渲染');
  assert.ok(privHtml.includes('个人信息保护法'), '隐私政策正文在');

});

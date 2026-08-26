/**
 * ZH-6（2026-08-26）：教师提交试课意向点击拦截——未认证教师点意向按钮 toast 拦截（零 modal），
 * 已认证照常弹 greet modal；服务端 handleCreateIntent 403 为第二道闸门（A4 双入口）。
 * G2 变异：删 ZH-6 拦截块 → 未认证弹 modal → 红。
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { JSDOM } from 'jsdom';
import { submitIntent } from '../src/client/features/student/actions.js';
import { state } from '../src/client/core/state.js';
import { setEnsureAuth } from '../src/client/core/api.js';
import { _dhResetForTests } from '../src/client/core/datahub.js';
import { closeAllModals } from '../src/client/core/ui.js';
import { TEXT } from '../src/client/constants/text.js';
import { ROLES } from '../src/shared/enums.js';

class MOStub { observe() {} disconnect() {} takeRecords() { return []; } }

function setup() {
  const dom = new JSDOM('<!doctype html><html><body><div id="modal-container"></div><div id="toast-container"></div></body></html>', { url: 'http://localhost/', pretendToBeVisual: true });
  globalThis.document = dom.window.document;
  globalThis.window = dom.window;
  globalThis.localStorage = dom.window.localStorage;
  globalThis.sessionStorage = dom.window.sessionStorage;
  globalThis.MutationObserver = MOStub;
  setEnsureAuth(() => true);
  _dhResetForTests();
  closeAllModals();
  state.user = null; state.allTeachers = []; state.browseDemands = [];
  return dom;
}
function teardown() {
  closeAllModals();
  setEnsureAuth(null);
  delete globalThis.MutationObserver;
  delete globalThis.fetch;
  delete globalThis.document; delete globalThis.window;
  delete globalThis.localStorage; delete globalThis.sessionStorage;
  state.user = null; state.browseDemands = [];
}

function mockVerifyStatus(status) {
  globalThis.fetch = async (url) => {
    const u = String(url);
    if (u.includes('/api/teacher/verify-status')) return { ok: true, status: 200, json: async () => ({ status }) };
    return { ok: true, status: 200, json: async () => ({ ok: true }) };
  };
}

const DEMAND = { id: 5, user_id: 39, username: '学生A', display_id: 8, target_subjects: ['math'], target_type: 'academic' };

test('ZH-6 未认证教师点意向：toast 拦截 + 零 greet modal', async () => {
  const dom = setup();
  state.user = { id: 38, username: 't', role: ROLES.TEACHER };
  state.browseDemands = [DEMAND];
  mockVerifyStatus('none');
  await submitIntent(5);
  const modalHtml = dom.window.document.getElementById('modal-container').innerHTML;
  const toastHtml = dom.window.document.getElementById('toast-container').textContent;
  assert.ok(!modalHtml.includes(TEXT.INTENT_GREET_TITLE), '未认证零 greet modal（ZH-6 拦截）');
  assert.ok(toastHtml.includes('学信网认证'), 'toast 提示先去认证（VERIFY_INTENT_REQUIRED）: ' + toastHtml);
  teardown();
});

test('ZH-6 已认证教师点意向：照常弹 greet modal', async () => {
  const dom = setup();
  state.user = { id: 38, username: 't', role: ROLES.TEACHER };
  state.browseDemands = [DEMAND];
  mockVerifyStatus('approved');
  await submitIntent(5);
  const modalHtml = dom.window.document.getElementById('modal-container').innerHTML;
  assert.ok(modalHtml.includes(TEXT.INTENT_GREET_TITLE), '已认证弹 greet modal');
  teardown();
});

test('ZH-6 学生角色不受影响：直接弹 greet modal（不查 verify-status）', async () => {
  const dom = setup();
  state.user = { id: 1, username: 's', role: ROLES.STUDENT };
  state.browseDemands = [DEMAND];
  globalThis.fetch = async () => { throw new Error('student 不应触发 verify-status fetch'); };
  await submitIntent(5);
  const modalHtml = dom.window.document.getElementById('modal-container').innerHTML;
  assert.ok(modalHtml.includes(TEXT.INTENT_GREET_TITLE), '学生弹 greet modal');
  teardown();
});

/**
 * 需求十 签约加固（B4：直接 import contract actions-sign）。
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { JSDOM } from 'jsdom';
import { signContract, updateSignBtnState } from '../src/client/features/contract/actions-sign.js';
import { state } from '../src/client/core/state.js';
import { CONFIG } from '../src/shared/config.js';
import { TEXT } from '../src/client/constants/text.js';

const CONTRACT_MD = `# 家教服务合同\n\n第一条 服务内容\n...`;

function setup() {
  const dom = new JSDOM('<!DOCTYPE html><html><body><div id="modal-container"></div></body></html>', { url: 'http://localhost/' });
  globalThis.document = dom.window.document;
  globalThis.window = dom.window;
  globalThis.setInterval = () => 1; globalThis.clearInterval = () => {};
  globalThis.MutationObserver = class { observe() {} disconnect() {} takeRecords() { return []; } };
  state.user = { id: 1, role: 'teacher', username: '甲' };
  state.myContracts = [{ id: 7, drafter_user_id: 2, student_user_id: 1, teacher_name: '甲', student_name: '乙',
    method: 'online', hourly_rate: 200, contract_md: CONTRACT_MD, status: 'signing',
    drafter_confirmed: 0, other_confirmed: 0 }];
  return dom;
}
function teardown() {
  delete globalThis.document;
  delete globalThis.window;
  delete globalThis.MutationObserver;
  globalThis.setInterval = setInterval; globalThis.clearInterval = clearInterval;
}

test('UI.BTN_SIGN 为「开始签约」，时长 30s', () => {
  assert.equal(TEXT.BTN_SIGN, '开始签约');
  assert.equal(CONFIG.CONTRACT_SIGN_READ_SECONDS, 30);
});

test('signContract 打开阅读弹窗：确认按钮初始 disabled、点遮罩不关', async () => {
  const dom = setup();
  signContract(7);
  assert.ok(dom.window.document.querySelector('#contract-sign-scroll'));
  assert.ok(dom.window.document.querySelector('#contract-sign-scroll').textContent.includes('家教服务合同'));
  assert.ok(dom.window.document.querySelector('#contract-sign-btn').disabled);
  assert.equal(dom.window.document.querySelector('.modal-overlay').getAttribute('onclick') || '', '');
  await new Promise(r => setTimeout(r, 20));
  teardown();
});

test('updateSignBtnState：计时中按钮显示倒计时且 disabled，就绪后解锁', async () => {
  const dom = setup();
  signContract(7);
  const btn = dom.window.document.querySelector('#contract-sign-btn');
  updateSignBtnState(12);
  assert.ok(btn.textContent.includes('12秒后可确认签约'));
  assert.ok(btn.disabled);
  globalThis.window._signingElapsed = true;
  globalThis.window._signingScrolled = true;
  updateSignBtnState();
  assert.equal(btn.disabled, false);
  await new Promise(r => setTimeout(r, 20));
  teardown();
});

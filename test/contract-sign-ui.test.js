/**
 * 需求十五 合同签署合规 UI（B4：直接 import contract render/actions）。
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { JSDOM } from 'jsdom';
import { renderContractCard } from '../src/client/features/contract/render.js';
import { signContract, verifyContractLedgerUi, clearSigningTimer, closeModalAction, updateSignBtnState } from '../src/client/features/contract/actions-sign.js';
import { state } from '../src/client/core/state.js';
import { TEXT } from '../src/client/constants/text.js';

function setup() {
  const dom = new JSDOM('<!DOCTYPE html><html><body><div id="modal-container"></div></body></html>', { url: 'http://localhost/' });
  globalThis.document = dom.window.document;
  globalThis.window = dom.window;
  globalThis.setInterval = () => 1; globalThis.clearInterval = () => {};
  globalThis.MutationObserver = class { observe() {} disconnect() {} takeRecords() { return []; } };
  return dom;
}

test('合同卡签署进度：signing 态甲方/乙方各自已签/待签；signed 态双方已签署', () => {
  const dom = setup();
  state.user = { id: 1, role: 'student', username: '乙' };
  state.myContracts = [{ id: 9, drafter_user_id: 2, student_user_id: 1, teacher_user_id: 2,
    teacher_name: '甲', student_name: '乙', method: 'online', hourly_rate: 150,
    contract_md: '', status: 'signing', drafter_confirmed: 1, other_confirmed: 0 }];
  const html = renderContractCard(state.myContracts[0]);
  assert.ok(html.includes('甲方待签'));
  assert.ok(html.includes('乙方已签'));
  state.myContracts[0].status = 'signed';
  state.myContracts[0].drafter_confirmed = 1;
  state.myContracts[0].other_confirmed = 1;
  assert.ok(renderContractCard(state.myContracts[0]).includes('双方已签署'));
  delete globalThis.document;
});

test('签署弹窗：底部前置告知', async () => {
  const dom = setup();
  state.user = { id: 1, role: 'student', username: '学生乙' };
  state.myContracts = [{ id: 7, drafter_user_id: 2, student_user_id: 1, teacher_user_id: 2,
    teacher_name: '甲', student_name: '乙', method: 'online', hourly_rate: 200,
    contract_md: '# 家教服务合同\n\n**甲方**：乙\n**乙方**：甲', status: 'signing',
    drafter_confirmed: 0, other_confirmed: 0 }];
  signContract(7);
  const disclose = dom.window.document.querySelector('.contract-sign-disclose');
  assert.ok(disclose);
  assert.ok(disclose.textContent.includes('学生乙'));
  assert.ok(disclose.textContent.includes('可靠'));
  await new Promise(r => setTimeout(r, 20));
  delete globalThis.document;
});

// Z-10-F4 回归：signing countdown timer 生命周期——clearSigningTimer 单点释放，
// closeModalAction（contract.closeModal 取消按钮）清 timer，登出 reset 也清
test('Z-10-F4: clearSigningTimer releases the interval and closeModalAction calls it', () => {
  const dom = setup();
  let cleared = 0;
  const origClear = globalThis.clearInterval;
  globalThis.clearInterval = () => { cleared++; };
  globalThis.window._signingTimer = 42; // 模拟 openSigningModal 启动的 countdown
  clearSigningTimer();
  assert.equal(cleared, 1, 'clearInterval 被调用');
  assert.equal(globalThis.window._signingTimer, null, '模块态清空（防重复清/泄漏）');
  cleared = 0;
  globalThis.window._signingTimer = 99;
  closeModalAction(); // contract.closeModal 取消按钮路径
  assert.equal(cleared, 1, '关闭弹窗即释放 countdown timer');
  assert.equal(globalThis.window._signingTimer, null);
  closeModalAction(); // 无 timer 时幂等
  assert.equal(cleared, 1, '空 timer 幂等不清第二遍');
  globalThis.clearInterval = origClear;
  delete globalThis.document;
});

test('存证校验小面板：展示指纹 + 台账明细', async () => {
  const dom = setup();
  const saved = globalThis.fetch;
  globalThis.fetch = async () => ({ ok:true, status:200, json: async () => ({
    recorded:true, valid:true, entries:2, headValid:true, linksValid:true, seqValid:true,
    contentHash:'abc123def456', entryList:[{ seq:1, createdAt:'2026-08-08 10:00:00' },{ seq:2, createdAt:'2026-08-08 10:05:00' }],
  }) });
  await verifyContractLedgerUi(1);
  globalThis.fetch = saved;
  const doc = dom.window.document;
  assert.ok(doc.querySelector('.contract-verify-verdict'));
  assert.ok(doc.querySelector('.contract-verify-verdict').textContent.includes('一致'));
  assert.ok(doc.querySelector('.contract-verify-hash').textContent.includes('abc123def456'));
  assert.equal(doc.querySelectorAll('.contract-verify-entry').length, 2);
  assert.ok(doc.querySelector('.contract-verify-entry').textContent.includes('#1'));
  delete globalThis.document;
});

test('Q-4a-L1：倒计时结束未滚动时按钮显示滚动提示（非误导性确认文案）', () => {
  const dom = setup();
  const holder = dom.window.document.createElement('div');
  holder.innerHTML = '<button type="button" id="contract-sign-btn" disabled></button><span id="contract-sign-hint"></span>';
  dom.window.document.body.appendChild(holder);
  dom.window._signingElapsed = true; dom.window._signingScrolled = false;
  updateSignBtnState();
  const btn = dom.window.document.getElementById('contract-sign-btn');
  assert.equal(btn.disabled, true, '未滚动禁用');
  assert.equal(btn.textContent, TEXT.SIGN_READ_HINT, '未滚动显示滚动提示（原误显确认文案）');
  dom.window._signingScrolled = true;
  updateSignBtnState();
  assert.equal(btn.textContent, TEXT.SIGN_READ_DONE_BTN, '已滚动显示确认文案');
  delete globalThis.document;
});

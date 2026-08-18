/**
 * 需求十三 · 时间组件复用签约链路 + 需求预填时间段（B4：直接 import contract ESM）。
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { JSDOM } from 'jsdom';
import { openSigningModal, prefillSigningTimeSlots, doSubmitSigning, openContractDraftModal, prefillContractFromDemand, submitContractDraft } from '../src/client/features/contract/actions-draft.js';
import { state } from '../src/client/core/state.js';

const DEMAND_SLOTS = JSON.stringify([{ type: 'week', dow: 1, start: '18:00', end: '20:00' }]);

function setup(record) {
  const dom = new JSDOM('<!DOCTYPE html><html><body><div id="modal-container"></div><div id="toast-container"></div></body></html>', { url: 'http://localhost/' });
  globalThis.document = dom.window.document;
  globalThis.window = dom.window;
  globalThis.MutationObserver = class { observe() {} disconnect() {} takeRecords() { return []; } };
  state.user = { id: 1, role: 'teacher', username: '甲' };
  globalThis.fetch = async (url, opts = {}) => {
    const s = String(url);
    if (record && (s.includes('/signing') || s === '/api/contracts')) {
      let parsed = null;
      try { parsed = typeof opts.body === 'string' ? JSON.parse(opts.body) : (opts.body || null); } catch { parsed = null; }
      record.push({ url: s, method: opts.method || 'GET', body: parsed });
    }
    if (s.includes('bindable-demands')) return { ok: true, status: 200, json: async () => ({ demands: [{ id: 5, expected_time: DEMAND_SLOTS }, { id: 7, expected_time: DEMAND_SLOTS }] }) };
    return { ok: true, status: 200, json: async () => ({}) };
  };
  return dom;
}
function teardown() { delete globalThis.document; delete globalThis.window; delete globalThis.MutationObserver; delete globalThis.fetch; }

test('发起签约弹窗：含结构化时间组件、无旧自由文本 schedule 输入', async () => {
  const dom = setup();
  await openSigningModal(1);
  assert.ok(dom.window.document.querySelector('#signing-time-slots'), '签约弹窗含时间组件容器');
  assert.ok(dom.window.document.querySelector('#signing-time-slots .time-add-btn'), '含「+ 新建时间段」');
  assert.equal(dom.window.document.querySelector('#signing-schedule'), null, '旧自由文本 schedule 输入已移除');
  teardown();
});

test('prefillSigningTimeSlots：切换需求按 expected_time 预填时间段', async () => {
  const dom = setup();
  await openSigningModal(1);
  window._signingDemands = [{ id: 5, expected_time: DEMAND_SLOTS }];
  dom.window.document.getElementById('signing-demand').value = '5';
  prefillSigningTimeSlots();
  assert.equal(dom.window.document.querySelectorAll('#signing-time-slots .time-slot').length, 1);
  assert.equal(dom.window.document.querySelector('#signing-time-slots .slot-dow').value, '1');
  assert.equal(dom.window.document.querySelector('#signing-time-slots [data-time-role="start"] .slot-time-hh').value, '18');
  prefillSigningTimeSlots();
  assert.equal(dom.window.document.querySelectorAll('#signing-time-slots .time-slot').length, 1, '已填时不重复预填');
  teardown();
});

test('doSubmitSigning：提交 body.schedule 为格式化人类串', async () => {
  const record = [];
  const dom = setup(record);
  await doSubmitSigning(1, { demandId: 5, price: 150, schedule: '周一 18:00-20:00', method: 'online' });
  assert.equal(record.length, 1);
  assert.equal(record[0].body.schedule, '周一 18:00-20:00');
  teardown();
});

test('合同草拟弹窗：含结构化时间组件、无旧自由文本 schedule 输入', async () => {
  const dom = setup();
  await openContractDraftModal(1);
  assert.ok(dom.window.document.querySelector('#contract-time-slots'), '草拟弹窗含时间组件容器');
  assert.equal(dom.window.document.querySelector('#contract-schedule'), null, '旧自由文本 schedule 输入已移除');
  teardown();
});

test('prefillContractFromDemand：按需求 expected_time 预填（仅未填时）', async () => {
  const dom = setup();
  await openContractDraftModal(1);
  window._contractDraftDemands = [{ id: 7, expected_time: DEMAND_SLOTS }];
  dom.window.document.getElementById('contract-demand').value = '7';
  prefillContractFromDemand();
  assert.equal(dom.window.document.querySelectorAll('#contract-time-slots .time-slot').length, 1);
  assert.equal(dom.window.document.querySelector('#contract-time-slots .slot-dow').value, '1');
  teardown();
});

test('submitContractDraft：提交 body.schedule 为格式化人类串', async () => {
  const record = [];
  const dom = setup(record);
  await openContractDraftModal(1);
  window._contractDraftDemands = [{ id: 7, expected_time: DEMAND_SLOTS }];
  dom.window.document.getElementById('contract-demand').value = '7';
  dom.window.document.getElementById('contract-rate').value = '200';
  dom.window.document.getElementById('contract-location').value = '线上';
  dom.window.document.getElementById('post-body').value = '补基础';
  prefillContractFromDemand();
  await submitContractDraft(1);
  assert.equal(record.length, 1);
  assert.equal(record[0].body.schedule, '周一 18:00-20:00');
  teardown();
});

/**
 * 需求十三 · 时间组件（B4：直接 import contract ESM）。S5 后仅剩起草合同弹窗使用时间组件。
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { JSDOM } from 'jsdom';
import { openContractDraftModal, submitContractDraft } from '../src/client/features/contract/actions-draft.js';
import { state } from '../src/client/core/state.js';

function setup(record) {
  const dom = new JSDOM('<!DOCTYPE html><html><body><div id="modal-container"></div><div id="toast-container"></div></body></html>', { url: 'http://localhost/' });
  globalThis.document = dom.window.document;
  globalThis.window = dom.window;
  globalThis.MutationObserver = class { observe() {} disconnect() {} takeRecords() { return []; } };
  state.user = { id: 1, role: 'teacher', username: '甲' };
  globalThis.fetch = async (url, opts = {}) => {
    const s = String(url);
    if (record && s === '/api/contracts') {
      let parsed = null;
      try { parsed = typeof opts.body === 'string' ? JSON.parse(opts.body) : (opts.body || null); } catch { parsed = null; }
      record.push({ url: s, method: opts.method || 'GET', body: parsed });
    }
    return { ok: true, status: 200, json: async () => ({}) };
  };
  return dom;
}
function teardown() { delete globalThis.document; delete globalThis.window; delete globalThis.MutationObserver; delete globalThis.fetch; }

test('合同草拟弹窗：含结构化时间组件、无旧自由文本 schedule 输入', async () => {
  const dom = setup();
  await openContractDraftModal(1);
  assert.ok(dom.window.document.querySelector('#contract-time-slots'), '草拟弹窗含时间组件容器');
  assert.equal(dom.window.document.querySelector('#contract-schedule'), null, '旧自由文本 schedule 输入已移除');
  teardown();
});

test('submitContractDraft：S5 无绑定模型——无需求预填，全字段自填；提交 body.schedule 为格式化人类串且不带 demandId', async () => {
  const record = [];
  const dom = setup(record);
  await openContractDraftModal(1);
  // S5 起草不绑需求：无需求下拉，也无需求预填。时间槽由用户自填（全字段自填语义）。
  const ts = dom.window.document.getElementById('contract-time-slots');
  const row = dom.window.document.createElement('div');
  row.className = 'time-slot';
  row.innerHTML = `
    <select class="slot-dow"><option value="1" selected>周一</option></select>
    <div class="time-range">
      <div class="time-field" data-time-role="start"><div class="time-hms"><input class="slot-time-hh" value="18"><span>:</span><input class="slot-time-mm" value="00"></div></div>
      <span class="time-slot-tilde">~</span>
      <div class="time-field" data-time-role="end"><div class="time-hms"><input class="slot-time-hh" value="20"><span>:</span><input class="slot-time-mm" value="00"></div></div>
    </div>`;
  ts.insertBefore(row, ts.querySelector('.time-slots-add'));
  dom.window.document.getElementById('contract-rate').value = '200';
  dom.window.document.getElementById('contract-location').value = '线上';
  dom.window.document.getElementById('post-body').value = '补基础';
  await submitContractDraft(1);
  assert.equal(record.length, 1);
  assert.equal(record[0].body.schedule, '周一 18:00-20:00');
  assert.equal('demandId' in record[0].body, false, 'S5 请求体不含 demandId');
  teardown();
});

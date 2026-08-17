import { test } from 'node:test';
import assert from 'node:assert/strict';
import { JSDOM } from 'jsdom';
import { complaintCardHtml, complaintModalBody, chatFileExt } from '../src/client/features/complaints/render.js';
import * as actions from '../src/client/features/complaints/actions.js';
import { TEXT } from '../src/client/features/complaints/text.js';

test('complaints render: modal body has data-action/delegation and no inline', () => {
  const html = complaintModalBody('teacher');
  assert.ok(html.includes('id="cmp-pane-teacher"'));
  assert.ok(html.includes('data-cmp-search="teacher"'));
  assert.ok(html.includes('data-change="complaints.reason"'));
  assert.ok(html.includes('data-action="complaints.stageFiles"'));
  assert.ok(!/onclick=/.test(html));
  assert.ok(!/style=/.test(html));
});

test('complaints render: card shows tags/attachments and no inline', () => {
  const c = {
    id: 1, status: 'open', target_type: 'teacher', target_snapshot: { name: '王老师' },
    reason: '态度差', detail: '详细', reporter: 'student1', created_at: '2026-08-17 12:00:00',
    attachments: [{ kind: 'image', thumb: 'data:image/png;base64,x' }, { kind: 'file', name: 'a.PDF' }],
  };
  const html = complaintCardHtml(c);
  assert.ok(html.includes('complaint-card'));
  assert.ok(html.includes('data-action="complaints.openAttachment"'));
  assert.ok(html.includes('data-action="complaints.resolve"'));
  assert.ok(!/onclick=/.test(html));
});

test('complaints render: file ext helper', () => {
  assert.equal(chatFileExt('报告.PDF'), 'PDF');
  assert.equal(chatFileExt('noext'), 'FILE');
});

test('complaints text: reasons array exists', () => {
  assert.ok(Array.isArray(TEXT.COMPLAINT_REASONS));
  assert.ok(TEXT.COMPLAINT_REASONS.length > 0);
});

test('complaints action: switch tab toggles panes and recent loader', async () => {
  const dom = new JSDOM('<html><body><div id="modal-container"></div></body></html>', { url: 'http://localhost/' });
  globalThis.document = dom.window.document;
  dom.window.HTMLCanvasElement.prototype.getContext = () => ({});
  // We only test pure switch with a minimal fake pane DOM.
  dom.window.document.body.innerHTML = '<div class="complaint-tabs"><button data-tab="teacher"></button><button data-tab="student"></button></div>'
    + '<div id="cmp-pane-teacher"></div><div id="cmp-pane-student"></div>';
  actions.switchComplaintTab('student');
  assert.ok(dom.window.document.getElementById('cmp-pane-teacher').classList.contains('hidden'));
  assert.ok(!dom.window.document.getElementById('cmp-pane-student').classList.contains('hidden'));
  delete globalThis.document;
});

test('complaints action: pick target renders selected line', () => {
  const dom = new JSDOM('<html><body><div id="cmp-selected-teacher"></div><div id="cmp-search-teacher"></div><div id="cmp-results-teacher"></div></body></html>', { url: 'http://localhost/' });
  globalThis.document = dom.window.document;
  actions.pickComplaintTarget('teacher', 5, '王老师');
  assert.ok(dom.window.document.getElementById('cmp-selected-teacher').innerHTML.includes('王老师'));
  assert.equal(dom.window.document.getElementById('cmp-search-teacher').value, '');
  delete globalThis.document;
});


test('complaints action: renderComplaintStage export exists and is callable', () => {
  assert.equal(typeof actions.renderComplaintStage, 'function');
});


test('complaints delegation: file input click is not prevented', async () => {
  const dom = new JSDOM('<html><body><input type="file" data-action="complaints.stageFiles"></body></html>', { url: 'http://localhost/' });
  globalThis.document = dom.window.document;
  const mod = await import('../src/client/features/complaints/index.js');
  const off = mod.default.onLoad();
  const input = dom.window.document.querySelector('input');
  const ev = new dom.window.MouseEvent('click', { bubbles: true, cancelable: true });
  input.dispatchEvent(ev);
  await new Promise(r => setTimeout(r, 0));
  assert.equal(ev.defaultPrevented, false, 'file click should not be prevented');
  off();
  delete globalThis.document;
});

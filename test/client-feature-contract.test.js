import { test } from 'node:test';
import assert from 'node:assert/strict';
import { JSDOM } from 'jsdom';
import { renderContractCard, splitContractBiz, stripContractMarker, renderContractDiff, contractSignProgress } from '../src/client/features/contract/render.js';
import * as actions from '../src/client/features/contract/actions.js';
import { TEXT } from '../src/client/constants/text.js';
import { state } from '../src/client/core/state.js';

test('contract render: card uses data-action and no inline', () => {
  state.user = { id: 1 };
  const c = { id: 1, drafter_user_id: 1, student_user_id: 2, teacher_user_id: 1, student_name: '学生', teacher_name: '老师', method: 'online', hourly_rate: 200, status: 'signing', drafter_confirmed: false, other_confirmed: false, demand_display_id: 1, updated_at: '2026-08-17 12:00:00' };
  const html = renderContractCard(c);
  assert.ok(html.includes('data-action="contract.sign"'));
  assert.ok(!/onclick=/.test(html));
  assert.ok(!/style=/.test(html));
  state.user = null;
});

test('contract render: business split and marker strip', () => {
  const md = '业务条款<!-- 业务条款结束\n法律条款';
  assert.equal(splitContractBiz(md), '业务条款');
  assert.ok(!stripContractMarker(md).includes('业务条款结束'));
});

test('contract render: diff uses old t shape', () => {
  const html = renderContractDiff('old', 'new');
  assert.ok(html.includes('diff-line'));
});

test('contract action: signing helpers exist', () => {
  assert.equal(typeof actions.signContract, 'function');
  assert.equal(typeof actions.signReadHint, 'function');
  assert.equal(typeof actions.openSigningModal, 'function');
  assert.equal(typeof actions.openContractDraftModal, 'function');
});

test('contract text: page keys exist', () => {
  assert.ok(TEXT.PAGE_MY_CONTRACTS);
  assert.ok(TEXT.PAGE_MY_CONTRACTS_DESC);
});

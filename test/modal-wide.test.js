/**
 * 需求三十一（2026-08-08）·纯文本浮窗拓宽（v0.25.48）
 *
 * 用户要求：所有单纯呈现文本的浮窗 PC 端拓宽便于阅读；移动端不要过宽。
 * 方案：.modal--wide（max-width 760px，opt-in 类）——base .modal 宽度仍 width:100%，
 * 移动端天然受视口约束（max-width 只提上限，窄屏不触发），不会过宽。
 * 覆盖面：协议/政策浮窗、使用指南、合同查看/签署通读、存证明细、md 预览、模块介绍、管理端全文。
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { JSDOM } from 'jsdom';
import { openModal } from '../src/client/core/ui-modal.js';
import { STYLE_CSS } from './_css.js';

test('modal--wide 规则就位：仅提升 max-width（不设 width），移动端受 width:100% 兜底不过宽', () => {
  const css = STYLE_CSS;
  const ruleBody = (css.split('#modal-container .modal.modal--wide {')[1] || '').split('}')[0];
  assert.ok(ruleBody.includes('max-width: 760px'), '宽版弹窗 max-width 760px（PC 阅读舒适）');
  assert.ok(!ruleBody.includes('width: 100%'), '只提上限不设显式宽度——窄屏由 base width:100% 兜住（移动不过宽）');
  // base .modal 确认 width:100% 仍在（移动端约束的根基）
  const base = css.split('#modal-container .modal {')[1] || '';
  assert.ok(base.split('}')[0].includes('width: 100%'), 'base 弹窗保持 width:100%');
});

test('文本浮窗全覆盖 modal--wide（政策/使用指南/合同查看/签署通读/存证明细/预览/模块介绍/管理端全文）', () => {
  const ui = readFileSync('./app-ui.js', 'utf8');
  const onboard = readFileSync('./app-onboard.js', 'utf8');
  const contracts = readFileSync('./app-contracts.js', 'utf8');
  const posts = readFileSync('./app-posts.js', 'utf8');
  const shell = readFileSync('./app-shell.js', 'utf8');
  const admin = readFileSync('./app-admin.js', 'utf8');
  // 每处文本浮窗 opt-in 宽版
  assert.ok(ui.includes("cls: 'modal--wide'"), '协议/政策浮窗拓宽');
  assert.ok(onboard.includes("cls: 'modal--wide'"), '使用指南浮窗拓宽');
  assert.ok((contracts.match(/cls: 'modal--wide'/g) || []).length >= 3, '合同查看 + 签署通读 + 存证明细（≥3 处）');
  assert.ok(posts.includes("cls: 'modal--wide'"), 'md 预览浮窗拓宽');
  assert.ok(shell.includes("cls: 'modal--wide'"), '模块介绍浮窗拓宽');
  assert.ok((admin.match(/cls: 'modal--wide'/g) || []).length >= 2, '管理端帖子/合同全文拓宽');
  // 旧专用加宽类已删（统一走标准接口，不留特例）
  assert.ok(!STYLE_CSS.includes('.module-info-modal'), 'module-info-modal 死规则已删');
});

test('渲染验证：openModal 带 cls 时宽版类落到 .modal 元素', () => {
  const dom = new JSDOM('<!DOCTYPE html><html><body><div id="modal-container"></div></body></html>', { url: 'http://localhost/' });
  globalThis.document = dom.window.document;
  openModal({ title: '宽版测试', cls: 'modal--wide', body: '<p>正文</p>' });
  const modalCls = dom.window.document.querySelector('#modal-container .modal').className;
  delete globalThis.document;
  assert.ok(modalCls.includes('modal--wide'), '宽版类落到 .modal 元素');
  assert.ok(modalCls.includes('glass'), '玻璃基类不受影响');
});

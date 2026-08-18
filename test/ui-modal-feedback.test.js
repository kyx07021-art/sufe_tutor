/**
 * v0.25.39 四件 UI 修复回归（U1/U2/U3/U4；B4：直接 import theme/display ESM）。
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { THEME, STYLE_PACKS } from '../src/client/constants/theme.js';
import { genderName } from '../src/client/core/display.js';
import { STYLE_CSS } from './_css.js';

test('U1：反馈浮窗已无内层分段（M11 三选后专线固定，.feedback-kind-row 连根删）', () => {
  const css = STYLE_CSS;
  assert.ok(!css.includes('.feedback-kind-row {'), '反馈分段规则已删（A1 审计：chooser 三选即定 kind，内层切换是冗余入口）');
  const glass = readFileSync('./glass.css', 'utf8');
  const segTabRule = glass.split('.seg-tab {')[1] || '';
  assert.ok(segTabRule.split('}')[0].includes('flex: 1'), '组件基类 .seg-tab 保持 flex:1（等宽撑满，其余分段调用方仍依赖）');
});

test('U2：flat 包 --g-flow-dot 为纸面（与 ink 数字反色，深浅主题皆可见）；液态保持白面', () => {
  const flat = STYLE_PACKS.flat.tokens;
  assert.equal(flat['--g-flow-dot'], 'var(--paper-3)', 'flat 圆点填纸面（反色，非 ink-2 同色不可见）');
  assert.ok(String(THEME.light['--g-flow-dot']).includes('255,255,255'), '液态浅色圆点为白面');
  assert.ok(String(THEME.dark['--g-flow-dot']).includes('255,255,255'), '液态深色圆点为白面');
});

test('U3：历史/非法 gender（nonbinary）白名单消毒回落「不愿透露」，不塌成细条', () => {
  assert.equal(genderName('nonbinary'), '', '非法 gender 消毒为不展示（同 undeclared 口径）');
  assert.equal(genderName('undeclared'), '', 'undeclared 不展示');
  assert.equal(genderName(''), '', '空不展示');
  assert.equal(genderName('male'), '男');
  assert.equal(genderName('female'), '女');
});

test('U4：.modal 大扩散阴影压暗（弹窗矩形为透明孔），主题双端定义 --g-modal-dim', () => {
  const css = STYLE_CSS;
  const modalRule = css.split('#modal-container .modal {')[1] || '';
  assert.ok(modalRule.split('}')[0].includes('200vmax var(--g-modal-dim'), '弹窗挂 200vmax 压暗（四周灰化、弹窗自身透明孔）');
  assert.ok(modalRule.split('}')[0].includes('var(--g-lift)'), '引擎浮影保留（三件套 + 压暗同列表）');
  assert.ok(THEME.light['--g-modal-dim'], '浅色主题定义压暗色');
  assert.ok(THEME.dark['--g-modal-dim'], '深色主题定义压暗色');
});

/**
 * R5-2 设计令牌与关键视觉收口回归（v1.5.0）：
 *   - 小灰字对比度 AA（--muted 加深）
 *   - 间距韵律尺 token 单源
 *   - 设置页行内距/头像行/退出按钮修复
 *   - 玻璃卡层次统一（chsi 卡回归无边框）
 *   - 按钮主/次/危险层级
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const css = readFileSync('./style.css', 'utf8');
const glass = readFileSync('./glass.css', 'utf8');
const constants = readFileSync('./constants.js', 'utf8');

test('小灰字对比度：light muted 加深到 AA 档', () => {
  assert.ok(constants.includes("'--text': '#16161A', '--muted': '#5A5A64'"), 'light --muted 已加深');
});

test('间距韵律尺 token 单源：4/8/12/16/20/24', () => {
  assert.ok(css.includes('--sp-1: 4px; --sp-2: 8px; --sp-3: 12px; --sp-4: 16px; --sp-5: 20px; --sp-6: 24px;'));
  assert.ok(css.includes('.list-card {\n  padding: var(--card-pad); margin-bottom: var(--sp-3);'));
});

test('设置页：行内距不再贴边、头像行去负边距、退出按钮无叠距、移动端行距可读', () => {
  assert.ok(css.includes('padding: 15px var(--sp-2); border-top: 1px solid var(--g-line-soft);'));
  assert.ok(css.includes('.settings-row--avatar { border-top: none; padding: 22px var(--sp-2) 20px;'));
  assert.ok(!css.includes('margin-top: -14px; padding: 26px 2px 24px'), '头像行负边距已删');
  assert.ok(css.includes('.settings-logout { margin-top: 0; }'), '退出按钮叠距已删');
  assert.ok(css.includes('.settings-row:not(.settings-row--avatar) { flex-direction: column; align-items: flex-start; gap: var(--sp-3); }'));
});

test('卡片层次：chsi 门卡回归全站无边框玻璃语；教师/需求卡节奏收敛', () => {
  assert.ok(css.includes('--g-frost: var(--g-f-card, blur(6px)'));
  assert.ok(css.includes('.list-card--teacher {\n') && css.includes('display: flex; flex-direction: column; gap: var(--sp-3);'));
  assert.ok(css.includes('.list-card--demand { display: flex; gap: var(--sp-4);'));
  assert.ok(css.includes('.demand-avatar { width: 72px; height: 72px; font-size: 2rem; }'));
});

test('按钮层级：主按钮白调面+发丝边，次按钮弱一档，危险按钮红色染面', () => {
  assert.ok(glass.includes('.btn:not(.btn-soft):not(.btn-outline):not(.btn-ghost):not(.btn-text-danger), .tc-push-btn, .chat-send {'));
  assert.ok(glass.includes("--g-fill: var(--g-btn-bg);"));
  assert.ok(glass.includes('--g-border: 1px solid var(--g-btn-line);'));
  assert.ok(glass.includes('.btn-text-danger { --g-fg: var(--danger-deep'));
  assert.ok(glass.includes('--g-fill: var(--g-danger-fill)'));
  assert.ok(glass.includes('--g-border: 1px solid var(--g-danger-line)'));
  assert.ok(constants.includes("'--g-danger-line'"), '危险边框 token 在 light/dark 有定义');
  assert.ok(glass.includes('.tc-push-btn, .chat-send'), '教师推送与聊天发送主按钮同层级');
});

test('空态：有停顿符号引导 + 深一档文字，不再只有一行灰字', () => {
  assert.ok(css.includes(".empty-state { text-align: center; padding: 40px 24px; color: var(--ink-3); }"));
  assert.ok(css.includes(".empty-state:not(:has(.loader, .spinner))::before { content: '—';"));
});

test('管理端观测面板：KPI/明细两级布局 token 化', () => {
  assert.ok(css.includes('.ops-kpi { display: grid; grid-template-columns: repeat(5, 1fr);'));
  assert.ok(css.includes('.ops-detail { display: grid; grid-template-columns: 1fr 1fr;'));
});

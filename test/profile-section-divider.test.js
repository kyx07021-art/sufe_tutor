/**
 * 需求十七/十八（R17/R18）·资料大区段间行距拉长 + 横向分割线
 *
 * R17：编辑页每个大区域（基本资料/学科类资料…）区段最底下与下一区段行距拉长、
 *       中间插一条横向分割线；最后大区与保存按钮同理。
 * R18：同一优化应用到教师资料页和右边栏卡片（.profile-card 分组 title 同口径）。
 *
 * 实现（style.css .profile-group-title 单点）：
 *   - .profile-form/.profile-card 的 .profile-group-title:not(:first-child)：
 *     border-top 1px + margin-top 拉长 + padding-top——首段（基本资料，无前段）不设线；
 *   - .profile-form .form-actions：border-top + 加大空隙（最后大区 ↔ 保存按钮）。
 *
 * 本测试为 CSS 内容回归护栏（Chrome 实证：首 title 0px / 其余 1px / form-actions 1px）。
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const css = readFileSync('./style.css', 'utf8');

test('R17 编辑页区段间分割线：非首段 title border-top + 行距拉长', () => {
  const block = css.match(/\.profile-form \.profile-group-title:not\(:first-child\),[\s\S]*?\n\}\n?/);
  assert.ok(block, '编辑页非首段 title 规则存在');
  assert.ok(/border-top:\s*1px solid var\(--line\)/.test(block[0]), '分割线 1px');
  assert.ok(/margin-top:\s*24px/.test(block[0]), '线前行距拉长');
  assert.ok(/padding-top:\s*16px/.test(block[0]), '线后留白');
  assert.ok(/\.profile-form \.profile-group-title:not\(:first-child\)/.test(block[0]), '首段（first-child）排除');
});

test('R18 右侧栏卡片同口径：.profile-card 分组 title 非首段也有分割线', () => {
  const block = css.match(/\.profile-card \.profile-group-title:not\(:first-child\)[\s\S]*?\n\}/);
  assert.ok(block, '卡片分组 title 规则存在');
  assert.ok(/border-top:\s*1px solid var\(--line\)/.test(block[0]), '卡片区段间分割线');
});

test('R17 最后大区与保存按钮：.profile-form .form-actions 上分割线', () => {
  const block = css.match(/\.profile-form \.form-actions \{[\s\S]*?\}/);
  assert.ok(block, 'form-actions 规则存在');
  assert.ok(/border-top:\s*1px solid var\(--line\)/.test(block[0]), '保存按钮前分割线');
  assert.ok(/margin-top:\s*26px/.test(block[0]), '线前留白拉长');
});

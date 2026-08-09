/**
 * 需求十五（R15）·个人资料右侧栏三张小卡片底色统一
 *
 * 缺陷：资料右栏三卡 fill 分档——身份卡 .profile-card--id 用 --g-card-id（白 .44）、
 * 信息卡/评价卡用 --g-card-strong（灰 .32）→ 三卡底色略不一致。
 *
 * 修复（连根统一）：
 *   - .profile-card 基底 fill 并入更白档 --g-card-id（.32 灰 → .44 白，移动端 → id-m）；
 *   - .profile-card--id 变体类连根删（CSS 规则 + 渲染模板类名）——三卡同一底层组件，
 *     一致性由内容承担，不靠底色分层。
 *
 * 本测试覆盖：CSS 基底统一 + 变体类删除 + 渲染模板不再输出 --id 类。
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

test('R15 .profile-card 基底 fill = --g-card-id（更白档，非 .32 灰档）', () => {
  const glass = readFileSync('./glass.css', 'utf8');
  const block = glass.match(/\.profile-card \{[\s\S]*?\}/);
  assert.ok(block, '.profile-card 规则存在');
  assert.ok(/--g-fill:\s*var\(--g-card-id\)/.test(block[0]), '基底并入更白 id 档');
});

test('R15 .profile-card--id 变体类连根删（CSS 无规则）', () => {
  const glass = readFileSync('./glass.css', 'utf8');
  assert.ok(!/\.profile-card--id/.test(glass), 'glass.css 无 profile-card--id 规则');
});

test('R15 渲染模板不再输出 profile-card--id 类', () => {
  const js = readFileSync('./app-teachers.js', 'utf8');
  assert.ok(!/profile-card--id/.test(js), 'app-teachers.js 渲染无 --id 变体类');
  assert.ok(js.includes('class="profile-card glass"'), '身份卡用统一 profile-card 基底');
});

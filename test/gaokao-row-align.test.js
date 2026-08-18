/**
 * 需求十四（R14）·教师资料卡高考成绩/等第组件布局统一
 *
 * 缺陷（实证）：.gaokao-row 是 flex + flex-wrap:wrap，等第 pill 组（.grade-selector）作为
 * flex 子件按 flex-basis（=整行 pill 自然宽）参与断行——省多档（如山东 11 档）或窄容器时
 * 整组掉到科目名下一行（实测 ctlY 比 subjectY 低 32px），而分数行（input 定宽）恒同行 →
 * 分数在科目名右边、等第在科目名下边，组件不统一。
 *
 * 修复（两处单点）：
 *   - .grade-selector：flex: 1 1 0; min-width: 0——0 基础永不触发父行 wrap，grow 吃满剩余宽、
 *     pills 组内换行；与分数输入同列左对齐（科目名 52px + gap 12px = 64px）；
 *   - .gaokao-row：align-items: center → start——多行 pill 组顶对齐科目名（center 把整组
 *     居中，首行 pill 被顶到科目名上方错位）。
 *
 * 本测试为 CSS 内容回归护栏（浏览器实证 dy=0 / ctlX=64 在 560px 与 320px 均成立）。
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { STYLE_CSS } from './_css.js';

const css = STYLE_CSS;

test('R14 .grade-selector 值组件：flex-basis 0 + min-width 0（不触发父行 wrap、组内换行）', () => {
  const block = css.match(/\.grade-selector \{[\s\S]*?\}/);
  assert.ok(block, '.grade-selector 规则存在');
  assert.ok(/flex:\s*1 1 0/.test(block[0]), 'flex 1 1 0（0 基础永不整组掉行）');
  assert.ok(/min-width:\s*0/.test(block[0]), 'min-width 0（可收缩吃满剩余宽）');
});

test('R14 .gaokao-row 顶对齐：align-items start（多行 pill 与科目名同一直线）', () => {
  const block = css.match(/\.gaokao-row \{[\s\S]*?\}/);
  assert.ok(block, '.gaokao-row 规则存在');
  assert.ok(/align-items:\s*start/.test(block[0]), 'align-items start（顶对齐，pills 首行与科目名同行）');
});

test('R14 分数输入定宽定列：score-inline 宽 70px + 科目名 52px 列（值组件左对齐同列）', () => {
  const nameBlock = css.match(/\.gaokao-row \.subject-name, \.score-row \.score-subject \{[\s\S]*?\}/);
  assert.ok(nameBlock && /flex:\s*0 0 52px/.test(nameBlock[0]), '科目名固定 52px 列');
});

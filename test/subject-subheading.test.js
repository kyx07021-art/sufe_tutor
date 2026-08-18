/**
 * 需求（2026-08-08）·学科类子标题左对齐（反馈：科目名「往右往里挪」）
 *
 * 资料页高考成绩/等第编辑器（.gaokao-row .subject-name）与需求浮窗当前成绩
 * （.score-row .score-subject）中的科目名（语文等）须为左对齐子标题：从选项区
 * 摘出、往左挪到标题区、与选项区保持体面空隙——原 v0.25.12 定宽右贴输入控件
 * （右缘对齐假想线）的设计被否。
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { STYLE_CSS } from './_css.js';

test('科目名 = 左对齐子标题：不右贴输入控件、定宽列 + 左对齐 + 子标题字重', () => {
  const css = STYLE_CSS;
  const rule = css.split('.gaokao-row .subject-name, .score-row .score-subject {')[1] || '';
  const body = rule.split('}')[0];
  assert.ok(body, '科目名规则存在（资料页 + 需求浮窗共用）');
  assert.ok(body.includes('text-align: left'), '科目名左对齐（不再右贴输入控件）');
  assert.ok(!body.includes('text-align: right'), '无右对齐残留');
  assert.ok(/flex: 0 0 52px/.test(body), '定宽列（各科目名左缘对齐成列）');
  assert.ok(body.includes('font-weight: 700'), '子标题字重 700');
  assert.ok(body.includes('var(--ink-2)'), '子标题色阶 ink-2（可读性优先）');
});

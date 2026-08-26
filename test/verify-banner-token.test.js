/**
 * ZH-5 复审修复（2026-08-26）：红字硬要求（用户原话「红色字体提醒」）的源级契约锁。
 * G2 变异守护：还原 #dc2626 裸红 → 断言红；清空 .verify-banner 规则 → 断言红。
 * jsdom 不解析外部 CSS，computedStyle 锁不可行——改锁 CSS 源 token 消费（D3 契约断言先例）。
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const css = fs.readFileSync(path.join(__dirname, '..', 'features', 'teacher.css'), 'utf-8');

function bannerBlock() {
  const m = css.match(/\.verify-banner\s*\{([^}]*)\}/);
  return m ? m[1] : '';
}

test('ZH-5 红字消费 --danger token（非裸 hex）', () => {
  const block = bannerBlock();
  assert.ok(block.includes('color: var(--danger'), '.verify-banner color 必须走 --danger token: ' + block.trim());
  assert.ok(block.includes('background: var(--danger-tint'), '.verify-banner 底走 --danger-tint: ' + block.trim());
  assert.ok(!/#[0-9a-fA-F]{3,6}/.test(block), '.verify-banner 零裸 hex 色值（P4 单源）');
});

test('ZH-5 全仓零 #dc2626 裸红残留', () => {
  assert.ok(!css.includes('#dc2626'), 'features/teacher.css 零 #dc2626（还原裸红即变异）');
});

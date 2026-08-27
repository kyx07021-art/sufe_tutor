/**
 * ZT-1/ZT-2 源码契约（2026-08-27 用户反馈：首访 onboarding 弹窗遮罩吞掉 landing 登录/hero 点击，
 * 已注册用户感知「无直接登录入口」）。
 * 锁两件事：
 *   1) base.css stage-nav / entry-list z-index ≥ 300 —— 浮于 modal-overlay z-200 之上，
 *      首访引导弹窗打开时右上角「登录/注册」与 hero 两入口仍可点（G2 变异：还原 z-index → 红）；
 *   2) auth/index.js ACTION_MAP 的 auth.viewLogin / auth.viewRegister / auth.enterGuest
 *      先 closeModal() 再切视图 —— 点击入口自动关首访引导弹窗，登录/注册/访客预览直达
 *      （G2 变异：删 closeModal() → 红）。
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.join(path.dirname(fileURLToPath(import.meta.url)), '..');
const baseCss = fs.readFileSync(path.join(root, 'base.css'), 'utf8');
const authIndex = fs.readFileSync(path.join(root, 'src/client/features/auth/index.js'), 'utf8');

function zOf(ruleText) {
  const m = ruleText.match(/z-index:\s*(\d+)/);
  return m ? Number(m[1]) : null;
}

test('ZT-1 stage-nav 与 entry-list z-index ≥ 300（浮于 modal-overlay z-200 之上）', () => {
  const stageNav = baseCss.match(/\.stage-nav \{[^}]*\}/);
  const entryList = baseCss.match(/\.entry-list \{[^}]*\}/);
  assert.ok(stageNav, '.stage-nav 规则存在');
  assert.ok(entryList, '.entry-list 规则存在');
  assert.ok(zOf(stageNav[0]) >= 300, `stage-nav z-index ${zOf(stageNav[0])} ≥ 300（变异：还原 3 → 红）`);
  assert.ok(zOf(entryList[0]) >= 300, `entry-list z-index ${zOf(entryList[0])} ≥ 300（变异：还原 → 红）`);
});

test('ZT-2 auth.viewLogin / viewRegister / enterGuest 先 closeModal 再切视图', () => {
  assert.match(authIndex,
    /'auth\.viewLogin':\s*\(\s*\)\s*=>\s*\{\s*closeModal\(\);[^}]*showView\('login'\)/,
    'viewLogin 先 closeModal 再 showView(login)（变异：删 closeModal → 红）');
  assert.match(authIndex,
    /'auth\.viewRegister':\s*\(\s*\)\s*=>\s*\{\s*closeModal\(\);[^}]*showView\('register'\)/,
    'viewRegister 先 closeModal 再 showView(register)（变异：删 closeModal → 红）');
  assert.match(authIndex,
    /'auth\.enterGuest':\s*\(el\)\s*=>\s*\{\s*closeModal\(\);[^}]*handleFeatureClick/,
    'enterGuest 先 closeModal 再 handleFeatureClick（变异：删 closeModal → 红）');
});

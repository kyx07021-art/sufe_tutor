/**
 * ZT-1/ZT-2 源码契约（2026-08-27 用户反馈：首访 onboarding 弹窗遮罩吞掉 landing 登录/hero 点击，
 * 已注册用户感知「无直接登录入口」）。W29 重做版（ZT 审计 FAIL 三闭合）：
 *   1) base.css .stage-nav z-index ≥ 300 + pointer-events:none（容器不拦截——短视口弹窗 header ✕
 *      落在导航带内，全宽点击陷阱会杀死 ✕；ZT 审计 FAIL1）+ .stage-nav-actions/.navbar-brand
 *      pointer-events:auto（登录/注册/logo 可点）——G2 变异：还原 z / 删 pointer-events → 红；
 *   2) auth/index.js 的 viewLogin/viewRegister/enterGuest 先 closeModal 再切视图 —— G2 变异：删 → 红。
 * 运行时几何断言（W43 被拦路径）在 test/verify-zt-landing.mjs（Playwright 实机：短视口 ✕ 可点、
 * 登录按钮可点、点登录关弹窗进登录）。
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.join(path.dirname(fileURLToPath(import.meta.url)), '..');
const baseCss = fs.readFileSync(path.join(root, 'base.css'), 'utf8');
const authIndex = fs.readFileSync(path.join(root, 'src/client/features/auth/index.js'), 'utf8');

function ruleOf(css, name) {
  const start = css.indexOf(`.${name} {`);
  if (start < 0) return null;
  const end = css.indexOf('}', start);
  return css.slice(start, end + 1);
}
function zOf(ruleText) {
  const m = ruleText.match(/z-index:\s*(\d+)/);
  return m ? Number(m[1]) : null;
}

test('ZT-1 stage-nav z-index ≥ 300 + 容器 pointer-events:none（子按钮 auto 恢复）', () => {
  const stageNav = ruleOf(baseCss, 'stage-nav');
  assert.ok(stageNav, '.stage-nav 规则存在');
  assert.ok(zOf(stageNav) >= 300, `stage-nav z-index ${zOf(stageNav)} ≥ 300（变异：还原 3 → 红）`);
  assert.match(stageNav, /pointer-events:\s*none/, 'stage-nav 容器 pointer-events:none（变异：删 → 短视口 ✕ 死按钮红）');
  assert.match(baseCss, /\.stage-nav-actions, \.navbar-brand \{[^}]*pointer-events:\s*auto/,
    'stage-nav-actions + navbar-brand pointer-events:auto（变异：删 → 登录按钮不可点红）');
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

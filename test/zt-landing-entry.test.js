/**
 * ZT-1/ZT-2 源码契约（2026-08-27 用户反馈：首访 onboarding 弹窗遮罩吞掉 landing 登录/hero 点击，
 * 已注册用户感知「无直接登录入口」）。W29 重做版（ZT 审计 FAIL 三闭合）+ 复审 FAIL 定向修复
 * （ZT-F1..F4，2026-08-27）：
 *   1) base.css .stage-nav z-index ≥ 300 + pointer-events:none（容器不拦截——短视口弹窗 header ✕
 *      落在导航带内，全宽点击陷阱会杀死 ✕；ZT 审计 FAIL1）+ .stage-nav-actions 独立规则
 *      flex gap 12px + pointer-events:auto（ZT-F2 FAIL3：原 flex 规则被替换成仅 pointer-events，
 *      登录/注册纵向堆叠）+ .navbar-brand 独立规则 pointer-events:auto —— G2 变异：还原 z /
 *      删 flex / 删 pointer-events → 红；
 *   2) auth/index.js 的 viewLogin/viewRegister/enterGuest 先 closeAllModals 再切视图（ZT-F1
 *      FAIL2：usage-guide 等子弹窗叠在 onboarding 下层，closeModal 只关一层会重新浮出 onboarding
 *      盖住登录视图；清空整栈保证「点登录 → 看到登录」）+ closeModal 保留导入（auth.closeModal
 *      取消按钮是单层关闭，两导入并存）—— G2 变异：删 closeAllModals → 红；
 *   3) openModal 支持 noClose + onboarding 首访弹窗传 noClose:true（窄屏 ✕ 与 stage-nav
 *      物理重叠，可见不可点的 ✕ 是死控件）+ openUsageGuide 同样 noClose:true（ZT-F3 FAIL1
 *      复活闭合：usage-guide 子弹窗同类重叠陷阱）。
 * 运行时几何断言（W43 被拦路径）在 test/verify-zt-landing.mjs（Playwright 实机：onboarding 无 ✕、
 * 登录按钮可点、点登录关弹窗进登录、usage-guide 无 ✕ + 底部关闭、遮罩关闭、登录/注册并排）。
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.join(path.dirname(fileURLToPath(import.meta.url)), '..');
const baseCss = fs.readFileSync(path.join(root, 'base.css'), 'utf8');
const authIndex = fs.readFileSync(path.join(root, 'src/client/features/auth/index.js'), 'utf8');
const uiModal = fs.readFileSync(path.join(root, 'src/client/core/ui-modal.js'), 'utf8');
const onboardActions = fs.readFileSync(path.join(root, 'src/client/features/onboard/actions.js'), 'utf8');

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

test('ZT-1 stage-nav z-index ≥ 300 + 容器 pointer-events:none + actions flex 并排 + brand 可点', () => {
  const stageNav = ruleOf(baseCss, 'stage-nav');
  assert.ok(stageNav, '.stage-nav 规则存在');
  assert.ok(zOf(stageNav) >= 300, `stage-nav z-index ${zOf(stageNav)} ≥ 300（变异：还原 3 → 红）`);
  assert.match(stageNav, /pointer-events:\s*none/, 'stage-nav 容器 pointer-events:none（变异：删 → 短视口 ✕ 死按钮红）');
  const actions = ruleOf(baseCss, 'stage-nav-actions');
  assert.ok(actions, '.stage-nav-actions 独立规则存在（ZT-F2 FAIL3：原规则被替换成仅 pointer-events）');
  assert.match(actions, /display:\s*flex/, '.stage-nav-actions display:flex（变异：删 → 登录/注册纵向堆叠红）');
  assert.match(actions, /gap:\s*12px/, '.stage-nav-actions gap:12px 并排间距（变异：删 → 按钮粘连红）');
  assert.match(actions, /pointer-events:\s*auto/, '.stage-nav-actions pointer-events:auto（变异：删 → 登录按钮不可点红）');
  const brand = ruleOf(baseCss, 'navbar-brand');
  assert.ok(brand, '.navbar-brand 规则存在');
  assert.match(brand, /pointer-events:\s*auto/, '.navbar-brand pointer-events:auto（变异：删 → logo 不可点红）');
});

test('ZT-2 auth 三入口先 closeAllModals 再切视图 + closeModal 双导入保留', () => {
  assert.match(authIndex,
    /'auth\.viewLogin':\s*\(\s*\)\s*=>\s*\{\s*closeAllModals\(\);[^}]*showView\('login'\)/,
    'viewLogin 先 closeAllModals 再 showView(login)（ZT-F1：closeModal 只关一层会让 usage-guide 下层 onboarding 重新浮出盖住登录；变异：删 → 红）');
  assert.match(authIndex,
    /'auth\.viewRegister':\s*\(\s*\)\s*=>\s*\{\s*closeAllModals\(\);[^}]*showView\('register'\)/,
    'viewRegister 先 closeAllModals 再 showView(register)（变异：删 → 红）');
  assert.match(authIndex,
    /'auth\.enterGuest':\s*\(el\)\s*=>\s*\{\s*closeAllModals\(\);[^}]*handleFeatureClick/,
    'enterGuest 先 closeAllModals 再 handleFeatureClick（变异：删 → 红）');
  assert.match(authIndex,
    /import \{[^}]*closeModal[^}]*closeAllModals[^}]*openPolicyModal[^}]*\} from '\.\.\/\.\.\/core\/ui\.js';/,
    'import 同时保留 closeModal + closeAllModals（auth.closeModal 取消按钮是单层关闭，不能删；ZT-F1b ReferenceError 预防）');
});

test('ZT-3 openModal 支持 noClose + onboarding 首访弹窗无 header ✕ + usage-guide 同款', () => {
  assert.match(uiModal,
    /export function openModal\(\{[^}]*noClose = false[^}]*\}\s*=\s*\{\}\)\s*\{/,
    'openModal 签名含 noClose = false（变异：删参数 → 红）');
  assert.match(uiModal,
    /noClose\n        \? `<div class="modal-header"><h2[^<]*<\/h2><\/div>`/,
    'noClose 分支渲染无 ✕ 的 header（变异：删分支/改全 ✕ → 红）');
  assert.match(uiModal,
    /: `<div class="modal-header"><h2[^<]*<\/h2><button type="button" class="btn btn-ghost btn-icon glass glass--pressable"[^>]*>✕<\/button><\/div>`/,
    '默认分支（noClose=false）仍渲染 ✕ 按钮（变异：noClose 恒生效 → 普通弹窗丢 ✕ 红）');
  assert.match(onboardActions,
    /noClose: true,/,
    'onboarding openOnboarding 传 noClose:true（变异：删 → 窄屏 ✕ 死控件红）');
  // ZT-F3：usage-guide 子弹窗同类重叠陷阱闭合
  const usageGuide = onboardActions.indexOf('export function openUsageGuide');
  const usageClose = onboardActions.slice(usageGuide, onboardActions.indexOf('export async function browseAsGuest'));
  assert.match(usageClose,
    /noClose: true,/,
    'openUsageGuide 传 noClose:true（ZT-F3：短视口 usage-guide 弹窗 header ✕ 与 stage-nav 重叠 → 死按钮；变异：删 → 红）');
  assert.match(usageClose,
    /data-action="onboard\.close"/,
    'usage-guide footer 兜底关闭按钮存在（无 ✕ 必须有底部出口）');
});

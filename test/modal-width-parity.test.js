/**
 * h5a-g2 MODAL_W_ONBOARD 跨层镜像奇偶守卫。
 * CONFIG.MODAL_W_ONBOARD ('580px', src/shared/config.js) 与 base.css
 * `#modal-container .modal` 默认 max-width 构成 CSS/JS 跨层双源镜像：
 * onboarding 弹窗经 ui-modal cssText 注入 CONFIG 宽度（onboard/actions.js），
 * 其余默认 modal 走 base.css 默认值。若 base.css 默认日后改宽，onboarding
 * 会与其他默认 modal 静默分叉（内联 max-width 自限宽不溢出，视觉不一致）。
 * 本测试锁定两源一致，防分叉。
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { CONFIG } from '../src/shared/config.js';

function extractModalDefaultMaxWidth() {
  const css = readFileSync('base.css', 'utf8');
  // 仅匹配 #modal-container .modal 默认规则块（.modal--wide 单独 max-width:760px 不属默认）
  const block = css.match(/#modal-container \.modal\s*\{([^}]*)\}/);
  assert.ok(block, 'base.css 存在 #modal-container .modal 默认规则');
  const mw = block[1].match(/max-width\s*:\s*([^;}]+)/);
  assert.ok(mw, '#modal-container .modal 默认规则内含 max-width 声明');
  return mw[1].trim();
}

test('MODAL_W_ONBOARD 与 base.css .modal 默认 max-width 一致（改宽需两处同步）', () => {
  const configValue = CONFIG.MODAL_W_ONBOARD;
  const cssValue = extractModalDefaultMaxWidth();
  assert.equal(cssValue, configValue,
    `base.css .modal 默认 max-width (${cssValue}) 与 CONFIG.MODAL_W_ONBOARD (${configValue}) 分叉——改宽需两处同步`);
});

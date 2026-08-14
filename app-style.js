/**
 * 外观包模块（需求八·item4 页面风格）：液态玻璃 / 平面简约 的独立模块。
 *
 * 架构（上网调研：语义 token 分层 core→semantic→component + [data-style][data-theme] 正交维度，
 * flat/glass 切换 = remap 语义 token）：
 *   - 玻璃引擎组件一律只消费语义 token（--g-fill/--g-frost/--g-lift…），外观包只 remap 语义层；
 *   - 每份外观包（constants.STYLE_PACKS）= 语义 token 增量 + 特殊效果协调（orb 档位）；
 *   - liquid 零覆盖（等价现状）；flat 把半透明玻璃面→不透明纸面、磨砂/投影/液体边缘→none/透明。
 *
 * 职责分工：
 *   - 首绘应用：index.html 内联 IIFE（无 FOUC，暴露 window.__applyPageStyle 单点）；
 *   - 本模块：设置读/写接口（getStylePref/setStylePref），供外观设置页 chooser 使用；
 *   - 光球协调：applyOrbs 的 orbMode 读 <html data-style>（flat → hidden），单一协调点。
 */
function getStylePref() {
  let p = 'liquid';
  try { const v = localStorage.getItem(CONFIG.STYLE_KEY || 'sufe_style'); if (v === 'flat') p = v; } catch (e) {}
  return p;
}

// 页面风格点按：写 localStorage → 调首绘单点应用（data-style + token 覆盖 + 光球定档）→ 切设置页按钮选中态
function setStylePref(pref) {
  const p = pref === 'flat' ? 'flat' : 'liquid';
  try { localStorage.setItem(CONFIG.STYLE_KEY || 'sufe_style', p); } catch (e) { /* 存储被禁：本次会话内仍可切换 */ }
  if (window.__applyPageStyle) window.__applyPageStyle();
  document.querySelectorAll('.style-opt').forEach(b => b.classList.toggle('style-opt--on', b.dataset.pref === p));
}

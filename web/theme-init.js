/**
 * Synchronous first-frame theme/UI-scale/style injection for web/index.html.
 * No Chinese, no fetch, no inline scripts.
 * NOTE (ZL): this is a classic IIFE (loaded via <script src> without type=module,
 * CSP script-src 'self'), so it cannot import src/shared/config.js. The 'liquid' and
 * 'system' fallbacks below mirror STYLE_DEFAULT / THEME_DEFAULT in src/shared/config.js;
 * changing either default requires updating both places (parity locked by
 * test/zl-defaults.test.js).
 */
(function () {
  function read(key, fallback) { try { return localStorage.getItem(key) || fallback; } catch { return fallback; } }
  var root = document.documentElement;
  var scale = parseInt(read('sufe_ui_scale', '100'), 10);
  if (!(scale >= 80 && scale <= 120)) scale = 100;
  root.style.setProperty('--ui-scale', (scale / 100).toFixed(3));
  var style = read('sufe_style', 'liquid');
  if (style === 'flat') root.setAttribute('data-style', 'flat');
  var theme = read('sufe_theme', 'system');
  if (theme !== 'dark' && theme !== 'light') theme = (window.matchMedia && window.matchMedia('(prefers-color-scheme: dark)').matches) ? 'dark' : 'light';
  root.setAttribute('data-theme', theme);
})();

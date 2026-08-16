/**
 * 外观偏好解析单点（v1.4.14 合并首绘双份）：
 * index.html 首绘 IIFE 与 app-style.js getStylePref 原为同款解析逻辑双份（键/白名单曾各自维护），
 * 现统一收口到本文件的 window.__stylePref——键经 CONFIG.STYLE_KEY 单源、白名单 flat/liquid 校验。
 *
 * 加载纪律：本文件是经典脚本（非模块），必须在 index.html 页面风格首绘 IIFE 之前同步加载
 * （首绘脚本跑在 app-*.js 加载前、且要赶在 CSS 生效前设置 data-style 防 FOUC）。
 * app-style.js（懒加载域脚本）加载时 window.__stylePref 早已就绪，getStylePref 直接调它。
 * 改动偏好键/白名单只改本文件，两处消费方零改动。
 */
(function () {
  function stylePref() {
    var KEY = ((window.APP_CONSTANTS || {}).CONFIG || {}).STYLE_KEY || 'sufe_style';
    var p = 'liquid';
    try { var v = localStorage.getItem(KEY); if (v === 'flat') p = v; } catch (e) {}
    return p;
  }
  window.__stylePref = stylePref;
})();

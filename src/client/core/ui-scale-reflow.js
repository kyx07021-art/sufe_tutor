import { CONFIG } from "../../shared/config.js";
var SAMPLE_STEP = 5, SAMPLES = [], LAYOUT_RE = /(^|[-_\s])(card|row|grid|list|form|seg|tab|pill|tag|slot|pane|panel|notice|notif|msg|filter|toolbar|item|block|header|foot|page|search|chip|badge|profile|filter|tool|user|text|invite|version|footnote|label|value|hint|desc|name|role|btn|select|sort|toggle|devices|section)([-_\s]|$)/i, FIXED_RE = /(^|[-_\s])(dot|point|pulse|thumb)([-_\s]|$)/i, FIXED_SELECTORS = [".ui-scale-slider"], SHELL_SELECTORS = [".navbar", ".client-sidebar", ".client-main"], EXCLUDE_SELECTORS = [".ui-scale-row", ".ui-scale-control", ".ui-scale-slider", ".toast", "#toast-container", ".modal", ".modal-overlay", "#modal-container"], DIVIDER_RE = /(^|[-_\s])(divider|separator|hr)([-_\s]|$)/i, units = [], unitByEl = /* @__PURE__ */ new WeakMap(), styleEl = null, sampledPage = null, active = !1, baseScale = 1;
function cssVars(cfg) {
  cfg && cfg.UI_SCALE_REFLOW_SAMPLE_STEP && (SAMPLE_STEP = cfg.UI_SCALE_REFLOW_SAMPLE_STEP);
  var min = cfg && cfg.UI_SCALE_MIN || 80, max = cfg && cfg.UI_SCALE_MAX || 120;
  SAMPLES = [];
  for (var s = min; s <= max + 0.5; s += SAMPLE_STEP) SAMPLES.push(Math.round(s));
}
var _cfg = CONFIG;
cssVars(_cfg);
function visiblePage() {
  for (var i = 0; i < document.querySelectorAll(".client-page").length; i++) {
    var p = document.querySelectorAll(".client-page")[i];
    if (p && !p.classList.contains("hidden")) return p;
  }
  return null;
}
function isExcluded(el) {
  for (var i = 0; i < EXCLUDE_SELECTORS.length; i++)
    if (el.matches && el.matches(EXCLUDE_SELECTORS[i])) return !0;
  return !1;
}
function isDivider(el) {
  if (el.nodeType !== 1 || isExcluded(el)) return !1;
  var cs = getComputedStyle(el);
  if (cs.display === "none" || cs.visibility === "hidden" || cs.position === "fixed") return !1;
  var disp = cs.display;
  if (disp === "inline" || disp === "contents") return !1;
  var r = el.getBoundingClientRect();
  if (r.width < 60) return !1;
  var cls = String(el.className && el.className.toString ? el.className : "");
  return cls && DIVIDER_RE.test(cls) ? !0 : r.height < 6;
}
function isFixedDeco(el) {
  if (el.nodeType !== 1) return !1;
  if (el.matches && el.matches(FIXED_SELECTORS.join(","))) return !0;
  if (isExcluded(el)) return !1;
  var cs = getComputedStyle(el);
  if (cs.display === "none" || cs.visibility === "hidden" || cs.position === "fixed" || cs.display === "inline" || cs.display === "contents") return !1;
  var r = el.getBoundingClientRect();
  if (r.width < 3 || r.height < 3) return !1;
  var cls = String(el.className && el.className.toString ? el.className : "");
  return !!(cls && FIXED_RE.test(cls));
}
function isLayoutBlock(el) {
  if (el.nodeType !== 1 || isExcluded(el)) return !1;
  var cs = getComputedStyle(el);
  if (cs.display === "none" || cs.visibility === "hidden" || cs.position === "fixed") return !1;
  var disp = cs.display;
  if (disp === "inline" || disp === "contents") return !1;
  var r = el.getBoundingClientRect();
  if (r.width < 8 || r.height < 8) return !1;
  var cls = String(el.className && el.className.toString ? el.className : "");
  return !!(cls && LAYOUT_RE.test(cls) || el.childNodes && Array.prototype.some.call(el.childNodes, function(n) {
    return n.nodeType === 3 && /\S/.test(n.nodeValue || "");
  }));
}
var CONTROL_RE = /(^|[-_\s])(btn|select|toggle|switch|thumb)([-_\s]|$)/i;
function isTextUnit(el) {
  if (el.matches && el.matches("button, input, select, textarea")) return !1;
  var cls = String(el.className && el.className.toString ? el.className : "");
  if (cls && CONTROL_RE.test(cls)) return !1;
  var cs = getComputedStyle(el);
  function hasLine(w, s) {
    return cs[s] && cs[s] !== "none" && parseFloat(cs[w] || "0") > 0;
  }
  return hasLine("borderTopWidth", "borderTopStyle") || hasLine("borderBottomWidth", "borderBottomStyle") ? !1 : !!(el.childNodes && Array.prototype.some.call(el.childNodes, function(n) {
    return n.nodeType === 3 && /\S/.test(n.nodeValue || "");
  }));
}
function restoreTextSpans() {
  for (var all = document.querySelectorAll(".ui-reflow-text"), i = all.length - 1; i >= 0; i--) {
    var span = all[i], el = span.parentElement;
    if (el) {
      for (; span.firstChild; ) el.insertBefore(span.firstChild, span);
      el.removeChild(span);
    }
  }
}
function wrapTextSpan(el) {
  if (el.nodeType !== 1 || isExcluded(el) || isTextUnit(el)) return null;
  for (var ch = el.children, k = 0; k < ch.length; k++)
    if (ch[k].classList && ch[k].classList.contains("ui-reflow-text")) return null;
  for (var wrapped = null, kids = Array.prototype.slice.call(el.childNodes), i = 0; i < kids.length; i++) {
    var n = kids[i];
    if (!(n.nodeType !== 3 || !/\S/.test(n.nodeValue || ""))) {
      var span = document.createElement("span");
      span.className = "ui-reflow-text", el.insertBefore(span, n), span.appendChild(n), wrapped || (wrapped = span);
    }
  }
  return wrapped;
}
function collectUnits() {
  units = [], unitByEl = /* @__PURE__ */ new WeakMap(), restoreTextSpans();
  var page = visiblePage();
  sampledPage = page, baseScale = parseFloat(document.documentElement.style.getPropertyValue("--ui-scale")) || 1;
  for (var roots = [], i = 0; i < SHELL_SELECTORS.length; i++)
    for (var list = document.querySelectorAll(SHELL_SELECTORS[i]), j = 0; j < list.length; j++) roots.push(list[j]);
  page && roots.push(page);
  var nav = document.querySelector(".sidebar-nav");
  nav && roots.push(nav);
  for (var seen = /* @__PURE__ */ new Set(), stack = [], r = 0; r < roots.length; r++)
    !roots[r] || seen.has(roots[r]) || (seen.add(roots[r]), stack.push(roots[r]));
  for (var order = []; stack.length; ) {
    for (var el = stack.pop(), isShell = !1, s = 0; s < SHELL_SELECTORS.length; s++)
      if (el.matches && el.matches(SHELL_SELECTORS[s])) {
        isShell = !0;
        break;
      }
    for (var hiddenAncestor = !1, p = el.parentElement; p; ) {
      if (p.classList && p.classList.contains("client-page") && p.classList.contains("hidden")) {
        hiddenAncestor = !0;
        break;
      }
      p = p.parentElement;
    }
    if (!hiddenAncestor && !(isShell && getComputedStyle(el).display === "none")) {
      (isShell || isLayoutBlock(el) || isDivider(el) || isFixedDeco(el)) && (order.push(el), unitByEl.set(el, !0));
      for (var kids = Array.prototype.slice.call(el.children).reverse(), k = 0; k < kids.length; k++) stack.push(kids[k]);
    }
  }
  for (var extra = [], w0 = 0; w0 < order.length; w0++) {
    var sp = wrapTextSpan(order[w0]);
    sp && extra.push(sp);
  }
  for (var w1 = 0; w1 < extra.length; w1++)
    order.push(extra[w1]), unitByEl.set(extra[w1], !0);
  for (var u = 0; u < order.length; u++) {
    var r2 = order[u].getBoundingClientRect();
    units.push({ el: order[u], base: { x: r2.x, y: r2.y, w: r2.width, h: r2.height }, targets: {}, parentIdx: -1, tx: 0, ty: 0, sx: 1, sy: 1, _ancX: 0, _ancY: 0, _ancSx: 1, _ancSy: 1, isDivider: isDivider(order[u]), isText: isTextUnit(order[u]), isFixed: isFixedDeco(order[u]) });
  }
  for (var a = 0; a < units.length; a++)
    for (var anc = units[a].el.parentElement; anc; ) {
      var ai = unitByEl.has(anc) ? units.findIndex(function(x) {
        return x.el === anc;
      }) : -1;
      if (ai >= 0) {
        units[a].parentIdx = ai;
        break;
      }
      anc = anc.parentElement;
    }
  var N = units.length, done = new Array(N).fill(!1), sorted = [];
  function visit(i2) {
    if (!done[i2]) {
      var p2 = units[i2].parentIdx;
      p2 >= 0 && visit(p2), done[i2] = !0, sorted.push(i2);
    }
  }
  for (var i = 0; i < N; i++) visit(i);
  for (var newPos = new Array(N), remapped = [], i = 0; i < N; i++) newPos[sorted[i]] = i;
  for (var i = 0; i < N; i++) {
    var o = units[sorted[i]];
    remapped.push({
      el: o.el,
      base: o.base,
      targets: o.targets,
      parentIdx: o.parentIdx >= 0 ? newPos[o.parentIdx] : -1,
      tx: 0,
      ty: 0,
      sx: 1,
      sy: 1,
      _ancX: 0,
      _ancY: 0,
      _ancSx: 1,
      _ancSy: 1,
      isDivider: o.isDivider,
      isText: o.isText,
      isFixed: o.isFixed
    });
  }
  return units = remapped, units;
}
function sampleTargets() {
  var docEl = document.documentElement, prev = docEl.style.getPropertyValue("--ui-scale"), prevX = window.scrollX, prevY = window.scrollY, i, s;
  docEl.dataset.uiSampling = "1";
  try {
    for (i = 0; i < SAMPLES.length; i++) {
      s = SAMPLES[i];
      var sc = (s / 100).toFixed(3);
      docEl.style.setProperty("--ui-scale", sc);
      for (var u = 0; u < units.length; u++) {
        var r = units[u].el.getBoundingClientRect();
        units[u].targets[s] = { x: r.x, y: r.y, w: r.width, h: r.height };
      }
      docEl.style.setProperty("--ui-scale", prev), window.scrollTo(prevX, prevY);
    }
  } finally {
    document.body.offsetHeight, delete docEl.dataset.uiSampling;
  }
}
function lerp(a, b, t) {
  return a + (b - a) * t;
}
function rectAt(u, scalePct) {
  var ts = SAMPLES;
  if (scalePct <= ts[0]) return u.targets[ts[0]] || u.base;
  var last = ts[ts.length - 1];
  if (scalePct >= last) return u.targets[last] || u.base;
  for (var lo = ts[0], hi = ts[1], i = 0; i < ts.length - 1; i++)
    if (scalePct >= ts[i] && scalePct <= ts[i + 1]) {
      lo = ts[i], hi = ts[i + 1];
      break;
    }
  var t = (scalePct - lo) / (hi - lo), a = u.targets[lo], b = u.targets[hi];
  return !a || !b ? u.targets[Math.round(scalePct)] || u.base : { x: lerp(a.x, b.x, t), y: lerp(a.y, b.y, t), w: lerp(a.w, b.w, t), h: lerp(a.h, b.h, t) };
}
function renderAt(scalePct) {
  if (units.length) {
    for (var i = 0; i < units.length; i++) {
      var u = units[i], target = rectAt(u, scalePct), par = u.parentIdx >= 0 ? units[u.parentIdx] : null;
      if (par ? (u._ancX = par._ancX + par._ancSx * (par.tx + (u.base.x - par.base.x) * par.sx), u._ancY = par._ancY + par._ancSy * (par.ty + (u.base.y - par.base.y) * par.sy), u._ancSx = par._ancSx * par.sx, u._ancSy = par._ancSy * par.sy) : (u._ancX = u.base.x, u._ancY = u.base.y, u._ancSx = 1, u._ancSy = 1), u.tx = u._ancSx ? (target.x - u._ancX) / u._ancSx : 0, u.ty = u._ancSy ? (target.y - u._ancY) / u._ancSy : 0, u.isFixed)
        u.sx = u._ancSx ? 1 / u._ancSx : 1, u.sy = u._ancSy ? 1 / u._ancSy : 1;
      else if (u.isText) {
        var fs = scalePct / 100 / baseScale;
        u.sx = u._ancSx ? fs / u._ancSx : fs, u.sy = u._ancSy ? fs / u._ancSy : fs;
      } else
        u.sx = u.base.w > 0 && u._ancSx ? target.w / (u.base.w * u._ancSx) : 1, u.sy = u.base.h > 0 && u._ancSy ? target.h / (u.base.h * u._ancSy) : 1;
    }
    for (var lines = [], k = 0; k < units.length; k++) {
      var un = units[k];
      Math.abs(un.tx) < 0.5 && Math.abs(un.ty) < 0.5 && Math.abs(un.sx - 1) < 2e-3 && Math.abs(un.sy - 1) < 2e-3 || lines.push('[data-ui-reflow-unit="' + k + '"]{transform:translate(' + un.tx.toFixed(2) + "px," + un.ty.toFixed(2) + "px) scale(" + un.sx.toFixed(4) + "," + un.sy.toFixed(4) + ")}");
    }
    styleEl || (styleEl = document.createElement("style"), styleEl.id = "__ui-reflow-transforms", document.head.appendChild(styleEl)), styleEl.textContent = `html[data-ui-reflowing] [data-ui-reflow-unit]{transition:none !important}
[data-ui-reflow-unit]{transform-origin:0 0}
` + lines.join(`
`);
    for (var m = 0; m < units.length; m++)
      units[m].el.hasAttribute("data-ui-reflow-unit") || units[m].el.setAttribute("data-ui-reflow-unit", String(m));
  }
}
function teardown() {
  styleEl && (styleEl.textContent = ""), restoreTextSpans();
  for (var i = 0; i < units.length; i++) units[i].el.removeAttribute("data-ui-reflow-unit");
  for (var stale = document.querySelectorAll("[data-ui-reflow-unit]"), s = 0; s < stale.length; s++) stale[s].removeAttribute("data-ui-reflow-unit");
  units = [], unitByEl = /* @__PURE__ */ new WeakMap(), active = !1;
}
function prepare() {
  var page = visiblePage();
  if (page && page === sampledPage && units.length) {
    for (var i = 0; i < units.length; i++)
      if (!units[i].el.isConnected) {
        units = [], unitByEl = /* @__PURE__ */ new WeakMap();
        break;
      }
    if (units.length) return !0;
  }
  try {
    collectUnits(), units.length && sampleTargets();
  } catch {
    return teardown(), !1;
  }
  return units.length > 0;
}
function begin() {
  active = !0;
}
function isActive() {
  return active;
}
const uiScaleReflow = {
  prepare,
  renderAt,
  teardown,
  begin,
  isActive,
  collectUnits,
  sampleTargets,
  _units: function() {
    return units;
  },
  _samples: function() {
    return SAMPLES;
  }
};
export {
  uiScaleReflow
};

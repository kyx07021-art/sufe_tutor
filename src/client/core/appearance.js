/**
 * v2 appearance core: theme/style-pack/orb application.
 * Ported from index.html inline first-paint IIFEs; no FOUC responsibility is
 * handled by web/theme-init.js for the first frame, this module handles runtime
 * switching and settings-page calls.
 */
import { CONFIG } from '../../shared/config.js';
import { THEME, STYLE_PACKS, LG } from '../constants/theme.js';
import { getOrbPref } from './state.js';

function readLS(key) { try { return localStorage.getItem(key); } catch { return null; } }
function writeLS(key, v) { try { localStorage.setItem(key, v); } catch { /* storage disabled */ } }

export function themeIsDark(pref) {
  return pref === 'dark' || (pref !== 'light' && typeof window !== 'undefined' && window.matchMedia && window.matchMedia('(prefers-color-scheme: dark)').matches);
}

export function applyTheme() {
  if (typeof document === 'undefined') return;
  const pref = readLS(CONFIG.THEME_KEY) || 'system';
  const dark = themeIsDark(pref);
  const root = document.documentElement;
  root.dataset.theme = dark ? 'dark' : 'light';
  root.style.colorScheme = dark ? 'dark' : 'light';
  const vars = dark ? THEME.dark : THEME.light;
  for (const k of Object.keys(vars)) root.style.setProperty(k, vars[k]);
  return pref;
}

export function applyLg() {
  if (typeof document === 'undefined') return;
  const st = document.documentElement.style;
  st.setProperty('--profile-row-gap', String(CONFIG.PROFILE_ROW_GAP) + 'px');
  st.setProperty('--filter-row-gap', String(CONFIG.FILTER_ROW_GAP) + 'px');
  st.setProperty('--lg-r-sm', String((LG.radius && LG.radius.sm) || 9) + 'px');
  st.setProperty('--lg-r', String((LG.radius && LG.radius.md) || 12) + 'px');
  st.setProperty('--lg-r-lg', String((LG.radius && LG.radius.lg) || 15) + 'px');
  st.setProperty('--lg-bg-blur', String((LG.bg && LG.bg.blur != null ? LG.bg.blur : 6)) + 'px');
  st.setProperty('--lg-glow-size', String((LG.glow && LG.glow.size) || 230) + 'px');
  st.setProperty('--lg-glow-op', String((LG.glow && LG.glow.opacity != null ? LG.glow.opacity : 0.85)));
  const F = LG.frosts || {};
  for (const fk of Object.keys(F)) st.setProperty('--g-f-' + fk, F[fk]);
}

function ensureBackground() {
  if (typeof document === 'undefined') return null;
  let bg = document.querySelector('.lg-bg');
  if (!bg) {
    bg = document.createElement('div');
    bg.className = 'lg-bg';
    bg.setAttribute('aria-hidden', 'true');
    bg.innerHTML = '<div class="lg-plate"></div>';
    document.body.insertBefore(bg, document.body.firstChild);
  }
  let glow = document.querySelector('.lg-mouseglow');
  if (!glow) {
    glow = document.createElement('div');
    glow.className = 'lg-mouseglow';
    glow.setAttribute('aria-hidden', 'true');
    document.body.appendChild(glow);
  }
  return { bg, glow };
}

export function orbMode() {
  const pkg = STYLE_PACKS[document.documentElement ? document.documentElement.dataset.style : ''];
  if (pkg && pkg.orb) return pkg.orb;
  const p = getOrbPref();
  return p === 'elegant' || p === 'hidden' ? p : 'vivid';
}

export function applyOrbs() {
  const ctx = ensureBackground();
  if (!ctx) return;
  const { bg, glow } = ctx;
  const mode = orbMode();
  const cfg = (LG.orbModes && LG.orbModes[mode]) || (LG.orbModes && LG.orbModes.vivid) || { count: 0, countCoarse: 0 };
  const coarse = typeof window !== 'undefined' && window.matchMedia && window.matchMedia('(pointer:coarse)').matches;
  const ORB_N = coarse ? (cfg.countCoarse != null ? cfg.countCoarse : cfg.count) : (cfg.count || 0);
  const DUR = LG.orbCrossSec || 60;
  const sizeSpan = (cfg.sizeMax || 0) - (cfg.sizeMin || 0);
  const opSpan = (cfg.opMax || 0) - (cfg.opMin || 0);
  const ORB_COLORS = ['--lg-orb-a','--lg-orb-b','--lg-orb-c','--lg-orb-d','--lg-orb-e','--lg-orb-f','--lg-orb-g','--lg-orb-h','--lg-orb-i'];
  // V-3-1c1: zero <style> injection (CSP style-src-elem 'self'). Dynamic geometry/
  // color/duration flow via CSS custom-property data channel (el.style.setProperty —
  // h5a-g6 note: CSSOM is not governed by style-src-attr, F1 verified); visual rules
  // all live in glass.css .lg-orb with fallback defaults — rule 44 (rendering in CSS,
  // JS carries data only) preserved.
  const frag = document.createDocumentFragment();
  for (let oi = 0; oi < ORB_N; oi++) {
    const dir = oi % 6;
    const size = (cfg.sizeMin + (oi * 37) % (sizeSpan + 1)).toFixed(0);
    const left = (dir === 2 || dir === 3 || dir === 5)
      ? (100 + (2 + (oi * 53) % 22)).toFixed(0)
      : (-(2 + (oi * 53) % 22)).toFixed(0);
    const top = ((oi * 71) % 100).toFixed(0);
    const op = (cfg.opMin + ((oi * 29) % 22) / 21 * opSpan).toFixed(2);
    const delay = (-((oi * 31) % 1000) / 100 * DUR).toFixed(1);
    const dur = (DUR * (0.8 + ((oi * 17) % 60) / 100)).toFixed(1);
    const color = ORB_COLORS[(oi * 5) % ORB_COLORS.length];
    const el = document.createElement('div');
    el.className = `lg-orb lg-orb--dir${dir}`; // --i{n} class removed in V-3-1c1 (rule carrier folded into .lg-orb var channel, zero consumers)
    el.style.setProperty('--lg-w', size + 'vmax');
    el.style.setProperty('--lg-h', size + 'vmax');
    el.style.setProperty('--lg-x', left + 'vmax');
    el.style.setProperty('--lg-y', top + 'vmax');
    el.style.setProperty('--lg-op', op);
    el.style.setProperty('--lg-col', 'var(' + color + ')');
    el.style.setProperty('--lg-dur', dur + 's');
    el.style.setProperty('--lg-delay', delay + 's');
    frag.appendChild(el);
  }
  bg.querySelectorAll('.lg-orb').forEach(n => n.remove());
  bg.insertBefore(frag, bg.firstChild);
  const finePointer = typeof window !== 'undefined' && window.matchMedia && window.matchMedia('(pointer:fine)').matches;
  glow.style.display = (mode === 'hidden' || !finePointer) ? 'none' : '';
  installMouseGlowFollow(glow);
}

// v1→v2 migration regression (2026-08-20): v1 index.html inline script had a mousemove
// follower for .lg-mouseglow (rAF-throttled transform writes); v2 appearance.js built the
// element without the follower → the glow orb sat frozen off-viewport. Restored with v1
// semantics: mousemove stores coords, rAF writes at most once per frame; mouseout to window
// hides, mouseover restores. transform/opacity writes go through el.style (CSSOM, h5a-g6
// verified — not governed by style-src-attr).
let _glowFollowInstalled = false;
function installMouseGlowFollow(glow) {
  if (_glowFollowInstalled || typeof window === 'undefined' || typeof requestAnimationFrame === 'undefined') return;
  _glowFollowInstalled = true;
  let gx = -200, gy = -200, glowRafPending = false;
  const glowWrite = () => {
    glowRafPending = false;
    glow.style.transform = `translate3d(${gx}px,${gy}px,0) translate(-50%,-50%)`;
  };
  window.addEventListener('mousemove', (e) => {
    gx = e.clientX; gy = e.clientY;
    if (!glowRafPending) { glowRafPending = true; requestAnimationFrame(glowWrite); }
  }, { passive: true });
  window.addEventListener('mouseout', (e) => { if (!e.relatedTarget) glow.style.opacity = '0'; });
  window.addEventListener('mouseover', () => { glow.style.opacity = String(getComputedStyle(document.documentElement).getPropertyValue('--lg-glow-op') || '.85'); });
}

export function getStylePref() {
  const v = readLS(CONFIG.STYLE_KEY);
  return v === 'flat' ? 'flat' : 'liquid';
}

export function setStylePref(pref) {
  const p = pref === 'flat' ? 'flat' : 'liquid';
  writeLS(CONFIG.STYLE_KEY, p);
  applyPageStyle();
  document.querySelectorAll('.style-opt').forEach(b => b.classList.toggle('style-opt--on', b.dataset.pref === p));
  return p;
}

export function setThemePref(pref) {
  const p = pref === 'dark' || pref === 'light' || pref === 'system' ? pref : 'system';
  writeLS(CONFIG.THEME_KEY, p);
  applyPageStyle();
  document.querySelectorAll('.theme-opt').forEach(b => b.classList.toggle('theme-opt--on', b.dataset.pref === p));
  return p;
}

export function setOrbPref(pref) {
  const p = pref === 'elegant' || pref === 'hidden' || pref === 'vivid' ? pref : 'vivid';
  writeLS(CONFIG.ORB_KEY, p);
  applyOrbs();
  document.querySelectorAll('.orb-opt').forEach(b => b.classList.toggle('orb-opt--on', b.dataset.pref === p));
  return p;
}

export function applyPageStyle() {
  if (typeof document === 'undefined') return;
  const root = document.documentElement;
  const p = getStylePref();
  root.dataset.style = p;
  const pack = STYLE_PACKS[p] || {};
  const toks = pack.tokens || {};
  const all = {};
  for (const pk of Object.keys(STYLE_PACKS)) {
    const pt = (STYLE_PACKS[pk] || {}).tokens || {};
    for (const k of Object.keys(pt)) all[k] = 1;
  }
  for (const k of Object.keys(all)) root.style.removeProperty(k);
  applyTheme();
  applyLg();
  for (const k of Object.keys(toks)) root.style.setProperty(k, toks[k]);
  applyOrbs();
  return p;
}

export function initAppearance() {
  if (typeof document === 'undefined') return;
  applyLg();
  applyPageStyle();
  if (typeof window !== 'undefined' && window.matchMedia) {
    window.matchMedia('(prefers-color-scheme: dark)').addEventListener('change', () => {
      const pref = readLS(CONFIG.THEME_KEY) || 'system';
      if (pref === 'system') applyPageStyle();
    });
  }
}

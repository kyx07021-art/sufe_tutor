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
  st.setProperty('--profile-row-gap', String(CONFIG.PROFILE_ROW_GAP || 22) + 'px');
  st.setProperty('--filter-row-gap', String(CONFIG.FILTER_ROW_GAP || 16) + 'px');
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
  // Zero inline style (rule 44): each orb gets a class (.lg-orb--i{n}); dynamic
  // geometry/color/duration live in a <style> sheet, DOM elements only carry classes.
  let styleEl = document.getElementById('lg-orb-style');
  if (!styleEl) {
    styleEl = document.createElement('style');
    styleEl.id = 'lg-orb-style';
    document.head.appendChild(styleEl);
  }
  let html = '';
  let css = '';
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
    html += `<div class="lg-orb lg-orb--dir${dir} lg-orb--i${oi}"></div>`;
    css += `.lg-orb--i${oi}{width:${size}vmax;height:${size}vmax;left:${left}vmax;top:${top}vmax;background:radial-gradient(circle,rgba(var(${color}),${op}),rgba(var(${color}),0) 66%);animation-duration:${dur}s;animation-delay:${delay}s}`;
  }
  styleEl.textContent = css;
  bg.querySelectorAll('.lg-orb').forEach(n => n.remove());
  bg.insertAdjacentHTML('afterbegin', html);
  const finePointer = typeof window !== 'undefined' && window.matchMedia && window.matchMedia('(pointer:fine)').matches;
  glow.style.display = (mode === 'hidden' || !finePointer) ? 'none' : '';
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

/**
 * v2 animation core: parity migration of app-anim.js.
 * Reveal observer, toast, custom-select open/close, overlay host cascade,
 * float-card anchoring and global interaction listeners.
 */
import { CONFIG } from '../../shared/config.js';

let installed = false;
let revealObserver = null;
const revealWatched = new Set();

export function initReveals(root) {
  if (!root || typeof document === 'undefined') return;
  if (revealObserver) {
    for (const old of revealWatched) {
      if (!old.isConnected) { revealObserver.unobserve(old); revealWatched.delete(old); }
    }
  }
  const items = [...root.querySelectorAll('.list-card, .notif-item, .post-card')];
  items.forEach((el, i) => {
    el.classList.add('reveal');
    el.style.setProperty('--reveal-delay', `${CONFIG.REVEAL_DELAY_BASE + Math.min(i * CONFIG.REVEAL_DELAY_STEP, CONFIG.REVEAL_DELAY_MAX)}ms`);
  });
  void root.offsetHeight;
  if (revealObserver) items.forEach(el => { revealObserver.observe(el); revealWatched.add(el); });
  else items.forEach(el => el.classList.add('revealed'));
}

let toastTimer = null;
export function showToast(msg, kind) {
  if (typeof document === 'undefined') return;
  const box = document.getElementById('toast-container') || document.body;
  const toast = document.createElement('div');
  toast.className = `toast glass glass--float toast--${kind || 'info'}`;
  toast.textContent = msg;
  box.appendChild(toast);
  setTimeout(() => {
    toast.classList.add('toast--out');
    setTimeout(() => toast.remove(), CONFIG.TOAST_FADE_MS);
  }, CONFIG.TOAST_MS);
}

export function toggleCustomSelect(wrap) {
  if (!wrap) return;
  const wasOpen = wrap.classList.contains('open');
  closeAllCustomSelects();
  if (!wasOpen) {
    positionCustomSelectPanel(wrap);
    wrap.classList.add('open');
    if (wrap._customPanel) wrap._customPanel.classList.add('open');
    const host = wrap.closest('#modal-container');
    if (host) registerOverlay(host, () => {
      wrap.classList.remove('open');
      if (wrap._customPanel) wrap._customPanel.classList.remove('open');
    }, wrap);
  }
}

export function closeAllCustomSelects() {
  if (typeof document === 'undefined') return;
  document.querySelectorAll('.custom-select.open').forEach(w => {
    w.classList.remove('open');
    if (w._customPanel) w._customPanel.classList.remove('open');
  });
}

const _overlayHosts = new WeakMap();
export function registerOverlay(host, closeFn, keyEl) {
  if (!host || typeof closeFn !== 'function') return;
  if (keyEl && keyEl._overlayHost === host) return;
  if (!_overlayHosts.has(host)) _overlayHosts.set(host, new Set());
  _overlayHosts.get(host).add(closeFn);
  if (keyEl) keyEl._overlayHost = host;
}
export function closeHostOverlays(host) {
  if (!host) return;
  const set = _overlayHosts.get(host);
  if (set) set.forEach(fn => { try { fn(); } catch (e) { console.warn('overlay close failed:', e && e.message); } });
  _overlayHosts.delete(host);
}

export function positionCustomSelectPanel(wrap) {
  const panel = wrap._customPanel, trig = wrap.querySelector('.custom-select-trigger');
  if (!panel || !trig) return;
  const r = trig.getBoundingClientRect();
  panel.style.left = `${r.left}px`;
  panel.style.top = `${r.bottom + 6}px`;
  panel.style.width = `${r.width}px`;
}

export function positionFloatCard(btn, card) {
  if (!btn || !card) return;
  const r = btn.getBoundingClientRect();
  const vw = document.documentElement.clientWidth;
  const w = card.offsetWidth;
  const m = CONFIG.MATCH_DETAIL_EDGE_MARGIN;
  let left = r.left;
  if (w > 0 && vw > 0 && left + w > vw - m) left = Math.max(vw - w - m, m);
  card.style.left = `${left}px`;
  card.style.top = `${r.bottom + CONFIG.MAX_MATCH_DETAIL_OFFSET}px`;
}

// Regression fix (2026-08-20): the v1 entry-animation gate lived in the v1 shell's inline
// script and was dropped with the v1 shell (V-4-1h). Without .site-ready, landing hero spans
// and entry buttons stay at their initial opacity 0 (their entrance animations are gated on
// it) — the homepage rendered blank/transparent. Re-implemented here: add .site-ready once the
// two hand-mask images are ready, with a 2.5s fallback so a slow asset never wedges the page.
let siteReadyFired = false;
export function installSiteReadyGate() {
  if (typeof document === 'undefined' || typeof Image === 'undefined' || siteReadyFired) return;
  const root = document.documentElement;
  const fire = () => { if (!siteReadyFired) { siteReadyFired = true; root.classList.add('site-ready'); } };
  let done = 0; const need = 3;
  const tick = () => { if (++done >= need) fire(); };
  ['/hand-mask.png', '/hand-mask-rot.png'].forEach(src => {
    const im = new Image();
    im.onload = im.onerror = tick;
    im.src = src;
  });
  tick();
  setTimeout(fire, 2500);
}

export function installGlobalInteractions() {
  if (installed || typeof document === 'undefined') return;
  installed = true;
  if ('IntersectionObserver' in window) {
    revealObserver = new IntersectionObserver(es => {
      es.forEach(e => {
        if (e.isIntersecting) {
          const el = e.target;
          el.style.transition = 'none';
          el.style.opacity = '0.01';
          requestAnimationFrame(() => requestAnimationFrame(() => {
            el.style.transition = '';
            el.style.opacity = '';
            el.classList.add('revealed');
          }));
        } else {
          e.target.classList.remove('revealed');
        }
      });
    }, { threshold: 0.06 });
  }
  document.addEventListener('scroll', e => {
    if (e.target.closest && e.target.closest('.custom-select-panel')) return;
    closeAllCustomSelects();
  }, { capture: true, passive: true });
  // data-action profile delegation runs in the capture phase so stopPropagation
  // happens before parent bubble listeners (equivalent to old renderAvatarHtml onclick).
  document.addEventListener('click', e => {
    const action = e.target.closest && e.target.closest('[data-action="open-profile"]');
    if (!action) return;
    e.stopPropagation();
    action.dispatchEvent(new CustomEvent('profile-panel-open', { bubbles: true, detail: { userId: action.dataset.profileUserId } }));
  }, true);
  document.addEventListener('click', e => {
    if (!e.target.closest('.custom-select') && !e.target.closest('.custom-select-panel')) closeAllCustomSelects();
  });
  document.addEventListener('keydown', e => {
    if (e.key !== 'Enter' && e.key !== ' ' && e.key !== 'Spacebar') return;
    const t = e.target;
    if (t && t.getAttribute && t.getAttribute('role') === 'button' && t.tagName !== 'BUTTON' && (t.hasAttribute('data-action') || t.hasAttribute('onclick'))) {
      e.preventDefault();
      t.click();
    }
  });
  // v1→v2 migration regression (2026-08-20): v1 app-ui.js had a global error capture that
  // added img-broken to broken images (base.css .img-broken survived but v2 had no listener
  // → broken-image placeholders stopped hiding). Restored with the v1 semantics.
  document.addEventListener('error', e => {
    const t = e.target;
    if (t && t.tagName === 'IMG' && t.closest &&
        t.closest('.avatar, .image-viewer-modal, .chat-bubble, .md-preview, .post-card, .conv-item')) {
      t.classList.add('img-broken');
    }
  }, true);
}

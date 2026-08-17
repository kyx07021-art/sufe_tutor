/**
 * v2 client entry. This batch wires core modules and exposes boot;
 * feature registry starts empty (registerPage) and is filled in B2.
 */
import { state, loadSession, bindUiScaleWheel } from './core/state.js';
import { api, apiBatch, apiUpload, setEnsureAuth } from './core/api.js';
import { escHtml, escJsStr, mdRender, delegate } from './core/dom.js';
import { openModal, closeModal, closeAllModals, confirm, showToast, withCaptcha, installUiBindings } from './core/ui.js';
import { installFormBindings } from './core/ui-bindings.js';
import { initReveals, installGlobalInteractions } from './core/anim.js';
import { dhGet, dhBatchGet, dhInvalidateDomain, startVersionProbe } from './core/datahub.js';
import { openCaptchaModal } from './core/captcha.js';
import { matchDegree, matchDims, matchLevel, installBarWidthBindings } from './core/match.js';
import { renderGlassLineChart } from './core/chart.js';
import { subjectName, starsHtml, diffLines } from './core/display.js';
import { registerPage, enterClient, selectPage, showView, goHome, renderSidebar, updateNavbar, loadInto, setBadge } from './core/router.js';
import { enterAbout } from './core/about.js';

let booted = false;
export function boot() {
  if (booted) return { state, api, apiBatch, apiUpload }; // singleton: duplicate boot never rebinds globals
  booted = true;
  if (typeof document !== 'undefined') {
    installGlobalInteractions(); // global delegation incl avatar data-action + stopPropagation
    installUiBindings();         // seg-tabs dynamic bindings
    installFormBindings();       // seg-input / time-slots dynamic bindings
    installBarWidthBindings();   // matchRowsHtml data-bar-w auto -> --bar-w
    bindUiScaleWheel();
    const saved = loadSession();
    if (saved) { state.user = saved.user; state.authToken = saved.authToken; }
  }
  return { state, api, apiBatch, apiUpload };
}

export {
  state, api, apiBatch, apiUpload, setEnsureAuth,
  escHtml, escJsStr, mdRender, delegate,
  openModal, closeModal, closeAllModals, confirm, showToast, withCaptcha,
  initReveals, dhGet, dhBatchGet, dhInvalidateDomain, startVersionProbe,
  openCaptchaModal, matchDegree, matchDims, matchLevel, renderGlassLineChart,
  subjectName, starsHtml, diffLines,
  registerPage, enterClient, selectPage, showView, goHome, renderSidebar, updateNavbar, loadInto, setBadge,
  enterAbout,
};

if (typeof document !== 'undefined' && !globalThis.SUFE_BOOTED) {
  globalThis.SUFE_BOOTED = true;
  boot();
}

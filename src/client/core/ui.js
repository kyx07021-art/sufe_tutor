/**
 * v2 ui core: parity migration of app-ui.js shared visual components.
 * DOM events are bound imperatively (zero inline handlers in core source).
 */
import { CONFIG } from '../../shared/config.js';
import { TEXT } from '../constants/text.js';
import { escHtml } from './dom.js';
import { showToast, toggleCustomSelect } from './anim.js';
import { withCaptcha, openCaptchaModal } from './captcha.js';
import {
  openModal, closeModal, closeAllModals, confirm, openPolicyModal,
  openImageViewer, runPendingConfirm, runReAuth,
} from './ui-modal.js';

export { openModal, closeModal, closeAllModals, confirm, openPolicyModal, openImageViewer, runPendingConfirm, runReAuth, withCaptcha, openCaptchaModal, showToast };

export const CARET_SVG = '<svg width="10" height="6" viewBox="0 0 10 6" fill="none" aria-hidden="true"><path d="M1 1l4 4 4-4" stroke="currentColor" stroke-width="1.6"/></svg>';

export function initCustomSelects(root) {
  (root || document).querySelectorAll('select.form-select, select.filter-select, select.time-pick-select').forEach(sel => {
    if (sel.dataset.customized) { buildCustomSelectPanel(sel); return; }
    sel.dataset.customized = '1';
    const wrap = document.createElement('div');
    wrap.className = 'custom-select';
    sel.insertAdjacentElement('afterend', wrap);
    wrap.appendChild(sel);
    sel.classList.add('hidden');
    const trigger = document.createElement('button');
    trigger.type = 'button';
    trigger.className = (sel.closest('.filter-group') || sel.closest('.page-header-actions'))
      ? 'custom-select-trigger btn btn-soft glass glass--pressable'
      : 'custom-select-trigger';
    trigger.innerHTML = `<span class="custom-select-text"></span><span class="drop-caret">${CARET_SVG}</span>`;
    trigger.addEventListener('click', () => toggleCustomSelect(wrap));
    const panel = document.createElement('div');
    panel.className = 'custom-select-panel glass glass--float';
    if (sel.classList.contains('time-pick-select')) panel.classList.add('time-pick-panel');
    panel._wrap = wrap;
    wrap._customPanel = panel;
    document.body.appendChild(panel);
    wrap.append(trigger);
    buildCustomSelectPanel(sel);
    new MutationObserver(() => buildCustomSelectPanel(sel)).observe(sel, { childList: true });
  });
}

export function buildCustomSelectPanel(sel) {
  const wrap = sel.closest('.custom-select');
  if (!wrap) return;
  const panel = wrap._customPanel;
  if (!panel) return;
  const options = [...sel.options];
  panel.innerHTML = `<div class="custom-select-list">${options.map(o =>
    `<button type="button" class="custom-option${o.value === sel.value ? ' selected' : ''}" data-value="${escHtml(o.value)}">${escHtml(o.textContent)}</button>`).join('')}</div>`;
  panel.querySelectorAll('.custom-option').forEach(btn => {
    btn.addEventListener('click', () => {
      if (sel.value !== btn.dataset.value) {
        sel.value = btn.dataset.value;
        sel.dispatchEvent(new Event('change', { bubbles: true }));
      }
      wrap.classList.remove('open');
      if (wrap._customPanel) wrap._customPanel.classList.remove('open');
      syncCustomSelectText(sel);
    });
  });
  syncCustomSelectText(sel);
}

export function syncCustomSelectText(sel) {
  const wrap = sel.closest('.custom-select');
  if (!wrap) return;
  const text = wrap.querySelector('.custom-select-text');
  const o = sel.options[sel.selectedIndex] || sel.options[0] || null;
  if (text) text.textContent = o ? o.textContent : '';
  if (text) text.classList.toggle('custom-select-empty', !sel.value);
  const panel = wrap._customPanel;
  if (panel) panel.querySelectorAll('.custom-option').forEach(b => b.classList.toggle('selected', b.dataset.value === sel.value));
}

if (typeof document !== 'undefined') {
  const sweep = () => {
    document.querySelectorAll('select.form-select:not([data-customized]), select.filter-select:not([data-customized]), select.time-pick-select:not([data-customized])')
      .forEach(sel => initCustomSelects(sel.closest('.modal') || sel.parentElement));
  };
  new MutationObserver(sweep).observe(document.documentElement, { childList: true, subtree: true });
}

export function btnLoading(btn, label) {
  if (!btn) return;
  btn.disabled = true;
  btn.innerHTML = `<span class="spinner"><i></i><i></i><i></i></span>${label ? ' ' + escHtml(label) : ''}`;
}
export function btnDone(btn, label) {
  if (!btn) return;
  btn.disabled = false;
  if (label) btn.textContent = label;
}

export function formatCountdown(ms) {
  const t = Math.max(0, Math.floor(ms / 1000));
  if (t <= 0) return '';
  const D = 24 * 3600, H = 3600, M = 60;
  if (t >= D) return `${Math.floor(t / D)}${TEXT.UNIT_DAY}`;
  if (t >= M) {
    const h = Math.floor(t / H), m = Math.floor((t % H) / M);
    return h > 0 ? `${h}${TEXT.UNIT_HOUR}${m}${TEXT.UNIT_MIN}` : `${m}${TEXT.UNIT_MIN}`;
  }
  return `${t}${TEXT.UNIT_SEC}`;
}

export function bindCountdown(el, { endAt, runningText = '{time}', onDone = null } = {}) {
  if (!el) return () => {};
  if (!isFinite(endAt)) return () => {};
  const orig = el.textContent;
  const tick = () => {
    const rem = endAt - Date.now();
    if (rem <= 0) {
      clearInterval(iv);
      el.disabled = false;
      el.textContent = orig;
      if (onDone) onDone();
      return;
    }
    el.textContent = runningText.replace('{time}', formatCountdown(rem));
  };
  el.disabled = true;
  tick();
  const iv = setInterval(tick, 1000);
  return () => { clearInterval(iv); el.disabled = false; el.textContent = orig; };
}

export function checkboxItemsHtml(items, checkedIds) {
  const checked = new Set((checkedIds || []).map(String));
  return items.map(it =>
    `<label class="checkbox-item glass glass--solid"><input type="checkbox" value="${escHtml(String(it.id))}"${checked.has(String(it.id)) ? ' checked' : ''}>${escHtml(it.name)}</label>`).join('');
}

export function segTabsHtml(items, activeKey, opts = {}) {
  const attr = opts.attr || 'key';
  const cls = opts.containerClass ? ' ' + opts.containerClass : '';
  const id = opts.containerId ? ` id="${escHtml(opts.containerId)}"` : '';
  return `<div class="seg-tabs glass glass--solid${cls}"${id}>${items.map(it =>
    `<button type="button" class="seg-tab glass${String(it.key) === String(activeKey) ? ' active' : ''}" data-${attr}="${escHtml(String(it.key))}" data-tab-action="${escHtml(String(it.key))}">${escHtml(it.label)}</button>`).join('')}</div>`;
}

// segTabsHtml no longer accepts old items[].onclick strings: equivalent binding goes
// through data-tab-action. Default behavior = toggle active and dispatch seg-tab-change;
// callers/global delegation listen to detail.key.
export function applyTabBindings(root) {
  const target = root || document;
  target.querySelectorAll('.seg-tabs:not([data-tab-bound])').forEach(tabs => {
    tabs.dataset.tabBound = '1';
    tabs.addEventListener('click', e => {
      const btn = e.target.closest('.seg-tab');
      if (!btn || !tabs.contains(btn)) return;
      tabs.querySelectorAll('.seg-tab').forEach(b => b.classList.toggle('active', b === btn));
      tabs.dispatchEvent(new CustomEvent('seg-tab-change', {
        bubbles: true,
        detail: { key: btn.dataset.tabAction || btn.dataset.key || '', container: tabs },
      }));
    });
  });
}

let uiBindingsInstalled = false;
export function installUiBindings() {
  if (uiBindingsInstalled || typeof document === 'undefined') return;
  uiBindingsInstalled = true;
  applyTabBindings(document);
  new MutationObserver(muts => {
    for (const m of muts) {
      for (const n of m.addedNodes) {
        if (!(n instanceof Element)) continue;
        if (n.closest) {
          applyTabBindings(n.closest('.seg-tabs') || (n.matches && n.matches('.seg-tabs') ? n : null));
          if (n.matches('.seg-tabs')) applyTabBindings(n);
        }
      }
    }
  }).observe(document.documentElement, { childList: true, subtree: true });
}

export function pickGrade(el) {
  const group = el.closest('.grade-selector');
  if (!group) return;
  group.querySelectorAll('.grade-option').forEach(o => o.classList.remove('selected'));
  el.classList.add('selected');
}

export function toggleTagPick(el, containerId, max) {
  const container = document.getElementById(containerId);
  if (!container) return;
  const nowSelected = !el.classList.contains('selected');
  if (nowSelected && max && max > 0) {
    const count = container.querySelectorAll('.tag-pick.selected').length;
    if (count >= max) {
      showToast(TEXT.TAG_PICK_LIMIT.replace('{max}', max));
      return;
    }
  }
  el.classList.toggle('selected', nowSelected);
}

export function mdEditorHtml({ rows = 7, placeholder = '', label = TEXT.POST_LABEL_BODY, labelFor = '' } = {}) {
  const forAttr = labelFor ? ` for="${labelFor}"` : '';
  return `<div class="form-group">
      <label class="form-label"${forAttr}>${label}</label>
      <div class="md-toolbar">
        <button type="button" class="md-btn glass" data-action="md-wrap" data-md="h2">H2</button>
        <button type="button" class="md-btn glass" data-action="md-wrap" data-md="h3">H3</button>
        <button type="button" class="md-btn glass" data-action="md-wrap" data-md="bold">${TEXT.POST_MD_BOLD}</button>
        <label class="md-btn glass" for="post-image-file">${TEXT.POST_MD_IMAGE}</label>
        <input type="file" id="post-image-file" accept="image/*" class="sr-file-input" data-action="post-image">
        <button type="button" class="md-btn glass" data-action="post-preview">${TEXT.POST_PREVIEW_BTN}</button>
      </div>
      <textarea id="post-body" class="form-input post-body-input" rows="${rows}" placeholder="${escHtml(placeholder)}"></textarea>
    </div>`;
}

export * from './ui-form.js';
export * from './ui-bindings.js';

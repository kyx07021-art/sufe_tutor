/**
 * v2 about core: enterAbout migrated from app-pages.js.
 * Feature buttons dispatch CustomEvents for B2 feature handlers; no inline handlers.
 */
import { TEXT } from '../constants/text.js';
import { escHtml } from './dom.js';
import { initReveals } from './anim.js';

export function enterAbout() {
  const aboutTitle = document.getElementById('about-page-title');
  if (aboutTitle) aboutTitle.textContent = TEXT.PAGE_ABOUT;
  const steps = [
    TEXT.ABOUT_FLOW_STEP_1, TEXT.ABOUT_FLOW_STEP_2, TEXT.ABOUT_FLOW_STEP_3, TEXT.ABOUT_FLOW_STEP_4, TEXT.ABOUT_FLOW_STEP_5,
  ].map((s, i, arr) => `<div class="about-flow-step">
      <div class="about-flow-rail">
        <span class="about-flow-dot glass">${i + 1}</span>
        ${i < arr.length - 1 ? '<span class="about-flow-line"></span>' : ''}
      </div>
      <p class="about-flow-text">${escHtml(s)}</p>
    </div>`).join('');
  const secItems = (TEXT.ABOUT_SECURITY_ITEMS || []).map(it => `<div class="about-sec-item">
      <span class="about-sec-mark glass" aria-hidden="true"></span>
      <div class="about-sec-body"><strong class="about-sec-title">${escHtml(it.t)}</strong><p class="about-sec-desc">${escHtml(it.d)}</p></div>
    </div>`).join('');
  const target = document.getElementById('about-content');
  if (!target) return;
  target.innerHTML = `
    <div class="list-card about-card glass">
      <div class="navbar-logo about-logo" aria-hidden="true"><span></span><span></span><span></span><span></span></div>
      <div class="about-card-body">
        <h3 class="about-title">${TEXT.ABOUT_WHO_TITLE}</h3>
        <p class="about-text">${escHtml(TEXT.ABOUT_WHO_TEXT)}</p>
        <div class="about-funds">
          <h4 class="about-funds-title">${TEXT.ABOUT_FUNDS_TITLE}</h4>
          <p class="about-funds-text">${escHtml(TEXT.ABOUT_FUNDS_TEXT)}</p>
        </div>
      </div>
    </div>
    <div class="list-card about-card-block glass">
      <h3 class="about-title">${TEXT.ABOUT_USAGE_TITLE}</h3>
      <div class="about-flow">${steps}</div>
      <div class="about-flow-revisit">
        <button type="button" class="btn btn-outline btn-sm glass glass--pressable" data-action="about-usage-guide">${TEXT.USAGE_GUIDE_BTN}</button>
        <button type="button" class="btn btn-outline btn-sm glass glass--pressable" data-action="about-revisit-tour">${TEXT.ONBOARD_REVISIT_BTN}</button>
      </div>
    </div>
    <div class="list-card about-card-block glass">
      <h3 class="about-title">${TEXT.ABOUT_SECURITY_TITLE}</h3>
      <p class="about-text">${escHtml(TEXT.ABOUT_SECURITY_INTRO)}</p>
      <div class="about-security-list">${secItems}</div>
    </div>
    <div class="list-card about-card-block glass">
      <h3 class="about-title">${TEXT.ABOUT_SUPPORT_TITLE}</h3>
      <div class="about-support-lines">
        <div>${escHtml(TEXT.ABOUT_SUPPORT_OWNER)}</div>
        <div>${escHtml(TEXT.ABOUT_SUPPORT_WECHAT)}</div>
        <div>${escHtml(TEXT.ABOUT_SUPPORT_EMAIL)}</div>
      </div>
      <div class="about-feedback-btns">
        <button type="button" class="btn btn-outline btn-sm glass glass--pressable" data-action="about-feedback">${TEXT.BTN_COMPLAINT_FEEDBACK}</button>
        <button type="button" class="btn btn-outline btn-sm glass glass--pressable" data-action="about-my-feedback">${TEXT.BTN_MY_COMPLAINTS_FEEDBACK}</button>
      </div>
    </div>`;
  target.querySelectorAll('[data-action^="about-"]').forEach(btn => {
    btn.addEventListener('click', () => btn.dispatchEvent(new CustomEvent('about-action', { bubbles: true, detail: { action: btn.dataset.action } })));
  });
  initReveals(target);
}

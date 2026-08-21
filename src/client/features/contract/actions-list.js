/**
 * contract feature actions: list load and refresh wiring.
 */
import { TEXT } from '../../constants/text.js';
import { state } from '../../core/state.js';
import { dhGet, dhPeek, dhOnDomainRefresh } from '../../core/datahub.js';
import { setBadge } from '../../core/router.js';
import { loaderHtml, escHtml } from '../../core/dom.js';
import { initReveals } from '../../core/anim.js';
import { renderContractCard } from './render.js';

export async function loadMyContracts() {
  const el = document.getElementById('my-contracts-list');
  setBadge('my-contracts', 0);
  const cached = dhPeek('/api/contracts/my');
  if (cached !== null) { state.myContracts = cached.contracts || []; renderMyContractsList(); return; }
  if (!el) return;
  el.innerHTML = `<div class="empty-state">${loaderHtml()}</div>`;
  try {
    const data = await dhGet('/api/contracts/my', { domain: 'contracts' });
    state.myContracts = data.contracts || [];
    renderMyContractsList();
  } catch (err) {
    el.innerHTML = `<div class="empty-state"><p>${TEXT.ERROR_LOAD_PREFIX}${escHtml(err.message)}</p></div>`;
  }
}

export function renderMyContractsList() {
  const el = document.getElementById('my-contracts-list');
  if (!el) return;
  if (!state.myContracts.length) { el.innerHTML = `<div class="empty-state"><p>${TEXT.CONTRACT_EMPTY_LIST}</p></div>`; return; }
  el.innerHTML = state.myContracts.map(renderContractCard).join('');
  initReveals(el);
}

dhOnDomainRefresh('contracts', () => {
  const c = dhPeek('/api/contracts/my');
  if (c && c.contracts) state.myContracts = c.contracts;
});

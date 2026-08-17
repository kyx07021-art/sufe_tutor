/**
 * contract feature registry: my-contracts page + data-action delegation.
 */
import { TEXT } from './text.js';
import { registerPage } from '../../core/router.js';
import * as actions from './actions.js';
import { setContractEnsureAuth } from './actions-sign.js';
import { setDraftEnsureAuth } from './actions-draft.js';
import { setChatConvById } from './actions-chat-bridge.js';

const ACTION_MAP = {
  'contract.view': el => actions.viewContract(Number(el.dataset.id)),
  'contract.verify': el => actions.verifyContractLedgerUi(Number(el.dataset.id)),
  'contract.revoke': el => actions.openRevokeContractModal(Number(el.dataset.id)),
  'contract.sign': el => actions.signContract(Number(el.dataset.id)),
  'contract.modify': el => actions.openContractModifyModal(Number(el.dataset.id)),
  'contract.cancel': el => actions.cancelContract(Number(el.dataset.id)),
  'contract.confirmSign': actions.confirmSignContract,
  'contract.submitModify': el => actions.submitContractModify(Number(el.dataset.id)),
  'contract.confirmRevoke': el => actions.confirmRevokeContract(Number(el.dataset.id)),
  'contract.closeModal': actions.closeModalAction,
  'contract.mdWrap': el => actions.mdWrap(el.dataset.md),
  'contract.preview': actions.preview,
  'contract.submitSigning': el => actions.submitSigning(Number(el.dataset.id)),
  'contract.submitDraft': el => actions.submitContractDraft(Number(el.dataset.id)),
  'contract.signScroll': actions.onContractSignScroll,
};

let installed = false;

function onActionClick(e) {
  const el = e.target && e.target.closest ? e.target.closest('[data-action]') : null;
  if (!el) return;
  const fn = ACTION_MAP[el.dataset.action];
  if (!fn) return;
  if (e.target && e.target.matches('input[type="checkbox"], input[type="file"]')) return;
  e.preventDefault();
  fn(el, e);
}

function onChange(e) {
  const el = e.target;
  if (!el || !el.dataset || !el.dataset.change) return;
  if (el.dataset.change === 'contract.prefillSigningTimeSlots') actions.prefillSigningTimeSlots();
  else if (el.dataset.change === 'contract.prefillDraft') actions.prefillContractFromDemand();
  else if (el.dataset.change === 'contract.toggleOther') actions.contractToggleOther(el.id, el.dataset.other);
}

function onScroll(e) {
  if (e.target && e.target.id === 'contract-sign-scroll') actions.onContractSignScroll();
}

function onLoad() {
  if (installed || typeof document === 'undefined') return () => {};
  installed = true;
  registerPage({
    id: 'my-contracts',
    roles: ['student', 'teacher'],
    label: TEXT.PAGE_MY_CONTRACTS,
    desc: TEXT.PAGE_MY_CONTRACTS_DESC,
    auth: true,
    enter: () => actions.loadMyContracts(),
  });
  document.addEventListener('click', onActionClick);
  document.addEventListener('change', onChange);
  document.addEventListener('scroll', onScroll, true);
  return () => {
    document.removeEventListener('click', onActionClick);
    document.removeEventListener('change', onChange);
    document.removeEventListener('scroll', onScroll, true);
    installed = false;
  };
}

export default {
  id: 'contract',
  text: TEXT,
  pages: [],
  actions: ACTION_MAP,
  onLoad,
  setEnsureAuth: fn => { setContractEnsureAuth(fn); setDraftEnsureAuth(fn); },
  setChatConvById,
};

export { actions, TEXT };

/**
 * v2 dynamic bindings installer for form segments and time-slot trees.
 * Kept out of ui-form.js so each core file stays under the <=300 line contract.
 */
import { bindSegmentInputs, bindTimeSlotTree } from './ui-form.js';

let formBindingsInstalled = false;

export function installFormBindings() {
  if (formBindingsInstalled || typeof document === 'undefined') return;
  formBindingsInstalled = true;
  bindSegmentInputs(document);
  document.querySelectorAll('.time-slots').forEach(c => bindTimeSlotTree(c));
  new MutationObserver(muts => {
    for (const m of muts) {
      for (const n of m.addedNodes) {
        if (n.nodeType !== 1) continue;
        if (n.querySelectorAll) {
          bindSegmentInputs(n);
          const pools = [];
          if (n.matches && n.matches('.time-slots')) pools.push(n);
          pools.push(...n.querySelectorAll('.time-slots'));
          pools.forEach(c => bindTimeSlotTree(c));
        }
      }
    }
  }).observe(document.documentElement, { childList: true, subtree: true });
}

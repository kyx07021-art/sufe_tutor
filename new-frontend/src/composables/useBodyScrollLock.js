/**
 * useBodyScrollLock - global body scroll lock (multi-modal count)
 * -------------------------------------------------------
 * - Locks page scroll while a modal is open; restores after all modals close.
 * - Writes body.style.overflow via CSSOM (CSP compatible).
 */
let count = 0

export function lockBody() {
  count += 1
  if (typeof document !== 'undefined') {
    document.body.style.overflow = 'hidden'
  }
}

export function unlockBody() {
  count = Math.max(0, count - 1)
  if (count === 0 && typeof document !== 'undefined') {
    document.body.style.overflow = ''
  }
}

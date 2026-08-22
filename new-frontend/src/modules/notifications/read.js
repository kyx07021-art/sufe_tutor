/**
 * read.js - M5-04 read semantics (single read + batch silent exit read + rollback)
 * ------------------------------------------------------------------------------
 * - I-27: POST /api/notifications/:id/read and POST /api/notifications/read-all.
 * - Single read is optimistic: mark the cached item read, then persist. On failure
 *   the cache is rolled back and the error is handed to the caller via onError
 *   (mutation anchor: deleting the rollback leaves a failed read permanently read).
 * - Batch exit read only targets ids the assembly REVEALED during this opening,
 *   and among those only the still-unread ones; unseen notifications keep their
 *   red dot (review note 3). It is silent on success - no toast here.
 * - No user-visible text lives in this file; every error is delegated through
 *   onError so the assembly decides how to surface it.
 */
import { api } from '@/core/api.js'
import { notifyState } from './data.js'

/** Set the is_read flag on a cached notification item (no-op when the id is absent). */
export function setItemRead(id, v) {
  const item = notifyState.items.find((x) => String(x.id) === String(id))
  if (item) item.is_read = !!v
}

/** Read the cached is_read flag for a notification id (false when absent). */
export function getItemRead(id) {
  const item = notifyState.items.find((x) => String(x.id) === String(id))
  return item ? !!item.is_read : false
}

/**
 * Composable for M5-04 read semantics. A plain factory returning a plain object;
 * the assembly calls it once per modal opening in setup and wires the returned
 * methods to UI events. No component lifecycle is bound here.
 *
 * @param {{ onError?: (err: Error) => void }} [opts]
 * @returns {{ markRead: Function, markSeenRead: Function, reveal: Function, reset: Function }}
 */
export function useReadSemantics({ onError } = {}) {
  /** Notification ids revealed to the user during the current modal opening. */
  let revealed = new Set()

  function notifyError(e) {
    if (typeof onError === 'function') onError(e)
  }

  /**
   * Single read: the user clicked a card to open its detail. Optimistic update
   * with rollback + onError on failure.
   * @param {string|number} id
   */
  async function markRead(id) {
    setItemRead(id, true)
    try {
      return await api('/notifications/' + encodeURIComponent(String(id)) + '/read', { method: 'POST' })
    } catch (e) {
      setItemRead(id, false)
      notifyError(e)
    }
  }

  /**
   * Batch silent read on modal exit: mark read exactly the ids that were revealed
   * and are still unread. Rollback every target to its previous value + onError
   * on failure (mutation anchor: deleting the rollback leaves failed batch reads
   * showing as permanently read). Silent on success.
   * @param {Array<string|number>} [seenIds] ids revealed this opening; when omitted,
   *   the internally tracked `revealed` set is used.
   */
  async function markSeenRead(seenIds) {
    const candidates = Array.isArray(seenIds) ? seenIds : [...revealed]
    const targets = [...new Set(candidates.map((id) => String(id)))].filter((id) => !getItemRead(id))
    if (!targets.length) return

    const prev = new Map()
    targets.forEach((id) => {
      prev.set(id, getItemRead(id))
      setItemRead(id, true)
    })

    try {
      return await api('/notifications/read-all', { method: 'POST' })
    } catch (e) {
      targets.forEach((id) => setItemRead(id, prev.get(id) ?? false))
      notifyError(e)
    }
  }

  /**
   * Record a notification id as seen. The assembly calls this as cards become
   * visible in the scroll viewport; the tracked set backs markSeenRead when no
   * explicit list is passed.
   * @param {string|number} id
   */
  function reveal(id) {
    if (id === undefined || id === null || id === '') return
    revealed.add(String(id))
  }

  /** Clear the revealed tracking (called when the modal opens fresh). */
  function reset() {
    revealed = new Set()
  }

  return { markRead, markSeenRead, reveal, reset }
}

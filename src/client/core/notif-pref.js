/**
 * Shared notification preference (client-only localStorage) + broadcast classifier.
 * Single source for both the notif feature and router badge filtering:
 *   - notifBlockOn / setNotifBlock  -> CONFIG.NOTIF_BLOCK_KEY (sufe_block_broadcast)
 *   - isBroadcastNotif             -> TEXT.NOTIFY_BROADCAST_PREFIX prefix check
 * Pure functions; no DOM access at module scope (call-time only).
 */
import { CONFIG } from '../../shared/config.js';
import { TEXT } from '../constants/text.js';

export function notifBlockOn() {
  try { return localStorage.getItem(CONFIG.NOTIF_BLOCK_KEY) === '1'; } catch { return false; }
}

export function setNotifBlock(v) {
  try { localStorage.setItem(CONFIG.NOTIF_BLOCK_KEY, v ? '1' : '0'); } catch { /* storage disabled: skip persist */ }
}

export function isBroadcastNotif(n) {
  return String(n.text || '').startsWith(TEXT.NOTIFY_BROADCAST_PREFIX);
}

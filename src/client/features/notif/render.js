/**
 * notif render: item row + broadcast content split (title/body).
 * No inline handlers (archtest): unread items carry data-action="notif.markRead"
 * and are keyboard-reachable via role=button + tabindex=0; delegation lives in index.js.
 */
import { escHtml, fmtDateTime } from '../../core/dom.js';
import { TEXT } from './text.js';

// Broadcast notifications are stored as "PREFIX title\nbody"; others are single-segment.
export function renderNotifContent(text) {
  const t = String(text || '');
  const prefix = TEXT.NOTIFY_BROADCAST_PREFIX;
  if (t.startsWith(prefix)) {
    const nl = t.indexOf('\n');
    const title = (nl === -1 ? t : t.slice(0, nl)).slice(prefix.length);
    const body = nl === -1 ? '' : t.slice(nl + 1);
    return `<span class="notif-broadcast-title">${prefix}${escHtml(title)}</span>
      ${body ? `<span class="notif-broadcast-body">${escHtml(body)}</span>` : ''}`;
  }
  return escHtml(t);
}

export function renderNotifItem(n) {
  const id = /^\d+$/.test(String(n.id)) ? String(n.id) : '';
  // Unread items are click/keyboard-dismissible; read items are static.
  const interact = n.is_read ? '' :
    ` role="button" tabindex="0" aria-label="${escHtml(TEXT.NOTIF_READ_ARIA)}" data-action="notif.markRead"`;
  return `<div class="notif-item glass${n.is_read ? '' : ' unread'}" data-id="${id}"${interact}>
      <span class="notif-dot${n.is_read ? ' read' : ''}"></span>
      <div class="notif-body">
        <div class="notif-text">${renderNotifContent(n.text)}</div>
        <div class="notif-time">${fmtDateTime(n.created_at)}</div>
      </div>
    </div>`;
}

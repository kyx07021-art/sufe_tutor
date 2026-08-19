/**
 * notif render: item row + broadcast content split (title/body) +
 * V-2-4 structured notification rendering (type + params -> text).
 * No inline handlers (archtest): unread items carry data-action="notif.markRead"
 * and are keyboard-reachable via role=button + tabindex=0; delegation lives in index.js.
 *
 * Display mapping single source: notification type templates live in constants/text.js
 * (NOTIF_* keys), subject id -> name mapping reuses SUFE_REGIONS + NONACADEMIC_PROJECTS.
 * Legacy rows (type NULL) fall back to their stored rendered text.
 */
import { escHtml, fmtDateTime } from '../../core/dom.js';
import { TEXT } from '../../constants/text.js';
import { SUFE_REGIONS } from '../../constants/region-data.js';
import { DEMAND_TYPES, NONACADEMIC_PROJECTS } from '../../../shared/enums.js';

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

/** Subject id -> names (R2-b: non-academic uses NONACADEMIC_PROJECTS, else region
 *  subject names); empty result falls back to the generic subjects text. */
export function notifSubjectsText(subjects, targetType) {
  const ids = Array.isArray(subjects) ? subjects : [];
  const names = ids.map(id => {
    if (targetType === DEMAND_TYPES.NONACADEMIC) {
      const p = (NONACADEMIC_PROJECTS || []).find(x => x.id === id);
      return p ? p.name : '';
    }
    return (SUFE_REGIONS.subjectNames || {})[id] || '';
  }).filter(Boolean).join('、');
  return names || TEXT.NOTIF_SUBJECTS_FALLBACK;
}

/** Structured type -> text. Generic types interpolate their NOTIF_<TYPE> template;
 *  CONTENT_PENALTY / VERIFY_* compose conditionally (summary presence, verify
 *  sub-kind). Unknown type degrades to an empty string (registry-constrained). */
export function notifTypeText(type, params) {
  const p = params || {};
  if (type === 'CONTENT_PENALTY') {
    const action = p.action === 'ban' ? TEXT.NOTIF_PENALTY_ACTION_BAN : TEXT.NOTIF_PENALTY_ACTION_REMOVE;
    const rule = p.rule || TEXT.NOTIF_RULE_FALLBACK;
    const base = TEXT.NOTIF_CONTENT_PENALTY
      .replace(/\{label\}/g, p.label || '').replace(/\{rule\}/g, rule)
      .replace(/\{action\}/g, action).replace(/\{reason\}/g, p.reason || '');
    return p.summary ? base + TEXT.NOTIF_CONTENT_PENALTY_SUMMARY.replace('{summary}', p.summary) : base;
  }
  if (type === 'VERIFY_APPROVED') {
    const head = p.verifyType === 'admission' ? TEXT.NOTIF_VERIFY_APPROVED_ADMISSION : TEXT.NOTIF_VERIFY_APPROVED_CHSI;
    return `${head}\n${TEXT.NOTIF_VERIFY_DETAIL_PREFIX}${p.detail || ''}`;
  }
  if (type === 'VERIFY_REJECTED') {
    return p.reason ? `${TEXT.NOTIF_VERIFY_REJECTED}\n${p.reason}` : TEXT.NOTIF_VERIFY_REJECTED;
  }
  if (type === 'VERIFY_REVOKED') {
    return p.reason ? `${TEXT.NOTIF_VERIFY_REVOKED}\n${p.reason}` : TEXT.NOTIF_VERIFY_REVOKED;
  }
  const tpl = TEXT['NOTIF_' + type];
  if (!tpl) return '';
  return tpl.replace(/\{(\w+)\}/g, (m, k) => {
    if (k === 'subjects') return notifSubjectsText(p.subjects, p.target_type);
    const v = p[k];
    return v === undefined || v === null ? '' : String(v);
  });
}

/** Resolve a notification row to its display text: structured (type+params) wins,
 *  legacy rows (type NULL) keep their stored rendered text. */
export function notifBodyText(n) {
  if (n.type === 'BROADCAST') {
    const p = n.params || {};
    return p.title ? `${TEXT.NOTIFY_BROADCAST_PREFIX}${p.title}\n${p.text || ''}` : (p.text || '');
  }
  if (n.type) return notifTypeText(n.type, n.params);
  return n.text || '';
}

export function renderNotifItem(n) {
  const id = /^\d+$/.test(String(n.id)) ? String(n.id) : '';
  // Unread items are click/keyboard-dismissible; read items are static.
  const interact = n.is_read ? '' :
    ` role="button" tabindex="0" aria-label="${escHtml(TEXT.NOTIF_READ_ARIA)}" data-action="notif.markRead"`;
  return `<div class="notif-item glass${n.is_read ? '' : ' unread'}" data-id="${id}"${interact}>
      <span class="notif-dot${n.is_read ? ' read' : ''}"></span>
      <div class="notif-body">
        <div class="notif-text">${renderNotifContent(notifBodyText(n))}</div>
        <div class="notif-time">${fmtDateTime(n.created_at)}</div>
      </div>
    </div>`;
}

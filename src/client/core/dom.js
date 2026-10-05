/**
 * v2 dom core: parity migration of app-ui.js display utilities.
 */
import { TEXT } from '../constants/text.js';

export function escHtml(s) {
  return String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
}

export function fmtDateTime(s) {
  if (!s) return '';
  const str = String(s);
  const d = new Date(/^\d{4}-\d{2}-\d{2} \d{2}:\d{2}/.test(str) ? str.replace(' ', 'T') + 'Z' : str);
  if (Number.isNaN(d.getTime())) return escHtml(str.slice(0, 16));
  const p = n => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())} ${p(d.getHours())}:${p(d.getMinutes())}`;
}

export function fmtDate(s) {
  if (!s) return '';
  const str = String(s);
  const d = new Date(/^\d{4}-\d{2}-\d{2}/.test(str) ? str.replace(' ', 'T') + 'Z' : str);
  if (Number.isNaN(d.getTime())) return escHtml(str.slice(0, 10));
  const p = n => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`;
}

const IMG_OK = /^(https?:\/\/|data:image\/(?!svg))/i;
function inlineMd(escaped) {
  const codes = [];
  let t = escaped.replace(/`([^`]+)`/g, (m, c) => { codes.push(c); return `\u0000${codes.length - 1}\u0000`; });
  t = t
    .replace(/!\[([^\]]*)\]\(([^)]*)\)/g, (m, alt, url) => (IMG_OK.test(url) && !/\s/.test(url))
      ? `<img src="${url}" alt="${alt}">`
      : `<span class="md-img-blocked">${TEXT.POST_IMG_BLOCKED}</span>`)
    .replace(/\[([^\]]+)\]\((https?:\/\/[^)\s]+)\)/g, '<a href="$2" target="_blank" rel="noopener noreferrer">$1</a>')
    .replace(/\*\*([^*]+)\*\*/g, '<strong>$1</strong>');
  return t.replace(/\u0000(\d+)\u0000/g, (m, n) => `<code>${codes[+n]}</code>`);
}

export function mdRender(src) {
  const escaped = escHtml(String(src ?? ''));
  const lines = escaped.split('\n');
  const out = [];
  const isUl = l => /^[-*] +/.test(l);
  const isOl = l => /^\d+\. +/.test(l);
  const isQt = l => /^&gt; ?/.test(l);
  let i = 0;
  while (i < lines.length) {
    const line = lines[i];
    if (!line.trim()) { i++; continue; }
    if (isUl(line)) {
      const items = [];
      while (i < lines.length && isUl(lines[i])) { items.push(lines[i].replace(/^[-*] +/, '')); i++; }
      out.push(`<ul>${items.map(x => `<li>${inlineMd(x)}</li>`).join('')}</ul>`);
      continue;
    }
    if (isOl(line)) {
      const items = [];
      while (i < lines.length && isOl(lines[i])) { items.push(lines[i].replace(/^\d+\. +/, '')); i++; }
      out.push(`<ol>${items.map(x => `<li>${inlineMd(x)}</li>`).join('')}</ol>`);
      continue;
    }
    if (isQt(line)) {
      const parts = [];
      while (i < lines.length && isQt(lines[i])) {
        const c = lines[i].replace(/^&gt; ?/, '');
        if (c.trim()) parts.push(`<p>${inlineMd(c)}</p>`);
        i++;
      }
      out.push(`<blockquote>${parts.join('')}</blockquote>`);
      continue;
    }
    const head = line.match(/^(#{1,6})\s+(.*)$/);
    if (head) { out.push(`<h${head[1].length}>${inlineMd(head[2])}</h${head[1].length}>`); i++; }
    else { out.push(`<p>${inlineMd(line)}</p>`); i++; }
  }
  return out.join('');
}

export function loaderHtml(size) {
  const cls = size === 'sm' ? 'spinner' : 'loader';
  return `<span class="${cls}" role="status" aria-label="${TEXT.LOADING}"><i></i><i></i><i></i></span>`;
}

export function renderAvatarHtml(avatar, name, cls = '', profileUserId = null) {
  const inner = avatar
    ? `<img src="${escHtml(avatar)}" alt="" loading="lazy">`
    : escHtml((name || '?').charAt(0).toUpperCase());
  const decorative = !profileUserId;
  const span = `<span class="avatar glass ${cls}${profileUserId ? ' avatar--link' : ''}"${decorative ? ' aria-hidden="true"' : ''}>${inner}</span>`;
  if (decorative) return span;
  return `<span class="avatar-btn" role="button" tabindex="0" title="${TEXT.PROFILE_PANEL_TITLE}" data-action="open-profile" data-profile-user-id="${profileUserId}">${span}</span>`;
}

export function componentShell(tag, cls, html) {
  return `<${tag} class="${escHtml(cls || '')}">${html || ''}</${tag}>`;
}

export function delegate(root, handler) {
  if (!root || typeof handler !== 'function') return () => {};
  const click = e => handler(e);
  root.addEventListener('click', click);
  return () => root.removeEventListener('click', click);
}

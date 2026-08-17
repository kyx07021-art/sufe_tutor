/**
 * v2 form core: parity migration of app-ui.js structured time/date primitives.
 * Interactive segments are bound via bindSegmentInputs/bindTimeSlotTree instead of
 * inline handlers (core layer has zero inline onclick/style).
 */
import { CONFIG } from '../../shared/config.js';
import { WEEKDAYS } from '../../shared/enums.js';
import { TEXT } from '../constants/text.js';
import { escHtml } from './dom.js';

export function segInputAttrs(spec) {
  return `type="text" class="seg-input ${spec.cls || ''}" inputmode="numeric" maxlength="${spec.maxLen}" value="${escHtml(spec.value || '')}" aria-label="${spec.label}" data-maxlen="${spec.maxLen}" data-max="${spec.max}" data-min="${spec.min || 0}" data-pad="${spec.pad || 2}" autocomplete="off" spellcheck="false" data-onblur="${spec.extra || 'clampSegment'}"`;
}

export function guardSegmentKey(e) {
  if (e.key === 'Backspace' || e.key === 'Delete') return;
  if (e.ctrlKey || e.metaKey || e.altKey) {
    const k = (e.key || '').toLowerCase();
    if (k === 'a' || k === 'c') return;
    e.preventDefault(); return;
  }
  const t = e.target;
  if (t && t.selectionStart != null) {
    if (e.key === 'ArrowLeft' && t.selectionStart === 0 && t.selectionEnd === 0) {
      const prev = segmentSibling(t, -1);
      if (prev) { e.preventDefault(); prev.focus(); placeCaret(prev, prev.value.length); }
      return;
    }
    if (e.key === 'ArrowRight' && t.selectionStart === t.value.length) {
      const next = segmentSibling(t, 1);
      if (next) { e.preventDefault(); next.focus(); placeCaret(next, 0); }
      return;
    }
  }
  if (['Tab', 'Enter', 'Escape', 'ArrowLeft', 'ArrowRight', 'ArrowUp', 'ArrowDown', 'Home', 'End'].includes(e.key)) return;
  if (e.key.length === 1 && !/[0-9]/.test(e.key)) e.preventDefault();
}

export function segmentSibling(inp, dir) {
  const hms = inp.closest('.time-hms, .seg-date');
  if (!hms) return null;
  const segs = [...hms.querySelectorAll('.seg-input')];
  const idx = segs.indexOf(inp);
  return segs[idx + dir] || null;
}
export function placeCaret(inp, pos) {
  try { inp.setSelectionRange(pos, pos); } catch { /* environment without setSelectionRange */ }
}

export function guardSegmentBeforeInput(e) {
  const t = e.inputType || '';
  if (t === 'insertFromPaste' || t === 'insertFromDrop') { e.preventDefault(); return; }
  if (t === 'insertText' && e.data != null && !/^[0-9]+$/.test(e.data)) e.preventDefault();
}

export function onSegmentInput(inp) {
  const len = +(inp.dataset.maxlen) || 2;
  const v = inp.value.replace(/[^0-9]/g, '').slice(0, len);
  if (inp.value !== v) inp.value = v;
  refreshSegmentField(inp.closest('.seg-date, .time-field'));
}

export function clampSegment(inp) {
  const max = +(inp.dataset.max) || 9999;
  const min = +(inp.dataset.min) || 0;
  const pad = +(inp.dataset.pad) || 2;
  let v = inp.value.replace(/[^0-9]/g, '');
  if (v !== '') {
    let n = Math.min(max, Math.max(min, +v));
    inp.value = String(n).padStart(pad, '0');
  }
  refreshSegmentField(inp.closest('.seg-date, .time-field'));
}

export function refreshSegmentField(field) {
  if (!field) return;
  const filled = [...field.querySelectorAll('.seg-input')].some(i => i.value);
  field.classList.toggle('has-value', filled);
}

export function clampYear(inp) {
  let v = inp.value.replace(/[^0-9]/g, '');
  if (v !== '') {
    const n = Math.min(9999, Math.max(1, +v));
    inp.value = String(n);
  }
  refreshSegmentField(inp.closest('.seg-date, .time-field'));
}

export function daysInMonth(y, m) { return new Date(y, m, 0).getDate(); }

export function clampDateDay(inp) {
  clampSegment(inp);
  const field = inp.closest('.seg-date, .time-field');
  if (!field || !inp.value) return;
  const year = +(field.querySelector('.seg-year').value || '0');
  const month = +(field.querySelector('.seg-month').value || '0');
  if (!year || !month) return;
  const dim = daysInMonth(year, month);
  const d = +inp.value;
  if (d > dim) { inp.value = String(dim).padStart(2, '0'); refreshSegmentField(field); }
}

function bindSeg(inp) {
  inp.addEventListener('keydown', guardSegmentKey);
  inp.addEventListener('beforeinput', guardSegmentBeforeInput);
  inp.addEventListener('input', () => onSegmentInput(inp));
  inp.addEventListener('blur', () => {
    if (inp.dataset.onblur === 'clampYear') clampYear(inp);
    else if (inp.dataset.onblur === 'clampDateDay') clampDateDay(inp);
    else clampSegment(inp);
  });
}

export function bindSegmentInputs(root) {
  (root || document).querySelectorAll('.seg-input:not([data-seg-bound])').forEach(inp => {
    inp.dataset.segBound = '1';
    bindSeg(inp);
  });
}

export function timeFieldHtml(role, hh, mm) {
  const ghost = role === 'start' ? TEXT.SLOT_TIME_START_GHOST : TEXT.SLOT_TIME_END_GHOST;
  const filled = (hh || mm) ? ' has-value' : '';
  const half = Math.ceil(ghost.length / 2);
  const ghostHtml = `<span class="time-field-ghost"><span>${escHtml(ghost.slice(0, half))}</span><span>${escHtml(ghost.slice(half))}</span></span>`;
  const hourOptions = Array.from({ length: 24 }, (_, i) => `${String(i).padStart(2, '0')}:00`)
    .map(t => `<option value="${t}"${t === (hh ? `${hh}:00` : '') ? ' selected' : ''}>${t}</option>`).join('');
  const hhAttrs = segInputAttrs({ maxLen: 2, max: 23, min: 0, pad: 2, label: TEXT.SEG_HOUR_ARIA, cls: 'slot-time-hh', value: hh });
  const mmAttrs = segInputAttrs({ maxLen: 2, max: 59, min: 0, pad: 2, label: TEXT.SEG_MINUTE_ARIA, cls: 'slot-time-mm', value: mm });
  return `<div class="time-field${filled}" data-time-role="${role}">
    <div class="time-hms">${ghostHtml}<input ${hhAttrs}><span class="time-colon">:</span><input ${mmAttrs}></div>
    <div class="custom-select time-picker"><select class="time-pick-select" data-action="ui.applyTimePick" aria-label="${TEXT.TIME_PICKER_ARIA}">${hourOptions}</select></div>
  </div>`;
}

export function renderTimeSlotRowHtml(slot) {
  slot = slot || {};
  const dow = slot.dow || '';
  const dowOpts = WEEKDAYS.map(w => `<option value="${w.id}"${w.id === dow ? ' selected' : ''}>${w.name}</option>`).join('');
  const sh = typeof slot.start === 'string' && slot.start.includes(':') ? slot.start.split(':')[0] : '';
  const sm = typeof slot.start === 'string' && slot.start.includes(':') ? slot.start.split(':')[1] : '';
  const eh = typeof slot.end === 'string' && slot.end.includes(':') ? slot.end.split(':')[0] : '';
  const em = typeof slot.end === 'string' && slot.end.includes(':') ? slot.end.split(':')[1] : '';
  return `<select class="form-select slot-dow"><option value="">${TEXT.SLOT_DOW_PLACEHOLDER}</option>${dowOpts}</select>
    <div class="time-range">
      ${timeFieldHtml('start', sh, sm)}
      <span class="time-slot-tilde">~</span>
      ${timeFieldHtml('end', eh, em)}
    </div>
    <button type="button" class="time-slot-del" aria-label="${TEXT.TIME_DEL_ARIA}" title="${TEXT.TIME_DEL_ARIA}" data-action="ui.removeTimeSlot">✕</button>`;
}

export function renderTimeSlotContainerHtml() {
  return `<div class="time-slots-add">
    <button type="button" class="time-add-btn" aria-label="${TEXT.SLOT_ADD_LABEL}" data-action="ui.addTimeSlot">+</button>
    <span class="time-add-label">${TEXT.SLOT_ADD_LABEL}</span>
  </div>`;
}

export function setAddDisabled(container, disabled) {
  const b = container.querySelector('.time-add-btn');
  if (b) b.disabled = disabled;
}

function bindTimeSlotRow(row) {
  bindSegmentInputs(row);
  row.querySelectorAll('.time-pick-select').forEach(sel => sel.addEventListener('change', () => applyTimePick(sel)));
  const del = row.querySelector('.time-slot-del');
  if (del) del.addEventListener('click', () => removeTimeSlot(del));
  row.querySelectorAll('.slot-dow').forEach(sel => sel.classList.add('form-select'));
}

export function bindTimeSlotTree(root) {
  const target = root.querySelector ? root : document;
  const add = target.querySelector('.time-add-btn:not([data-bound])');
  if (add) { add.dataset.bound = '1'; add.addEventListener('click', () => addTimeSlot(add)); }
  target.querySelectorAll('.time-slot:not([data-bound])').forEach(row => {
    row.dataset.bound = '1';
    bindTimeSlotRow(row);
  });
  bindSegmentInputs(target);
}

export function addTimeSlot(btn) {
  const container = btn.closest('.time-slots');
  if (!container) return;
  const count = container.querySelectorAll('.time-slot').length;
  if (count >= CONFIG.TIME_SLOTS_MAX) return;
  const row = document.createElement('div');
  row.className = 'time-slot';
  row.innerHTML = renderTimeSlotRowHtml(null);
  container.insertBefore(row, container.querySelector('.time-slots-add'));
  bindTimeSlotRow(row);
  if (count + 1 >= CONFIG.TIME_SLOTS_MAX) setAddDisabled(container, true);
}

export function removeTimeSlot(btn) {
  const row = btn.closest('.time-slot');
  if (!row) return;
  const container = row.closest('.time-slots');
  row.remove();
  if (container) setAddDisabled(container, false);
}

export function applyTimePick(sel) {
  const field = sel.closest('.time-field');
  if (!field || !sel.value) return;
  const parts = sel.value.split(':');
  const hhInp = field.querySelector('.slot-time-hh');
  const mmInp = field.querySelector('.slot-time-mm');
  if (hhInp) hhInp.value = parts[0] || '';
  if (mmInp) mmInp.value = parts[1] || '00';
  refreshSegmentField(field);
}

export function dateFieldHtml(value) {
  const [y, m, d] = (value || '').split('-');
  return `<div class="seg-date" id="contract-first-lesson-field">
    <span class="seg-part"><input ${segInputAttrs({ maxLen: 4, max: 9999, min: 1, pad: 4, label: TEXT.SEG_YEAR_ARIA, cls: 'seg-year', value: y, extra: 'clampYear' })}><span class="seg-unit">${TEXT.SEG_YEAR_ARIA}</span></span>
    <span class="seg-part"><input ${segInputAttrs({ maxLen: 2, max: 12, min: 1, pad: 2, label: TEXT.SEG_MONTH_ARIA, cls: 'seg-month', value: m })}><span class="seg-unit">${TEXT.SEG_MONTH_ARIA}</span></span>
    <span class="seg-part"><input ${segInputAttrs({ maxLen: 2, max: 31, min: 1, pad: 2, label: TEXT.SEG_DAY_ARIA, cls: 'seg-day', value: d, extra: 'clampDateDay' })}><span class="seg-unit">${TEXT.SEG_DAY_ARIA}</span></span>
  </div>`;
}

export function readDateField(field) {
  if (!field) return '';
  const segs = [...field.querySelectorAll('.seg-input')];
  const vals = segs.map(i => i.value);
  if (vals.every(v => !v)) return '';
  if (vals.some(v => !v)) return null;
  const yRaw = vals[0], mRaw = vals[1], dRaw = vals[2];
  if (yRaw.length < 4) return null;
  const y = Math.min(9999, Math.max(1, +yRaw));
  const m = Math.min(12, Math.max(1, +mRaw));
  const dim = daysInMonth(y, m);
  const d = Math.min(dim, Math.max(1, +dRaw));
  return `${String(y).padStart(4, '0')}-${String(m).padStart(2, '0')}-${String(d).padStart(2, '0')}`;
}

export function readTimeField(field) {
  if (!field) return '';
  const hhRaw = (field.querySelector('.slot-time-hh') || {}).value || '';
  const mmRaw = (field.querySelector('.slot-time-mm') || {}).value || '';
  if (!hhRaw && !mmRaw) return '';
  if (!hhRaw || !mmRaw) return null;
  const hh = Math.min(23, Math.max(0, parseInt(hhRaw, 10) || 0)).toString().padStart(2, '0');
  const mm = Math.min(59, Math.max(0, parseInt(mmRaw, 10) || 0)).toString().padStart(2, '0');
  return `${hh}:${mm}`;
}

export function validateTimeSlots(container) {
  if (!container) return '';
  for (const row of container.querySelectorAll('.time-slot')) {
    const dow = row.querySelector('.slot-dow').value;
    const start = readTimeField(row.querySelector('.time-field[data-time-role="start"]'));
    const end = readTimeField(row.querySelector('.time-field[data-time-role="end"]'));
    if (!dow && !start && !end) continue;
    if (!dow || !start || !end) return TEXT.VALIDATE_TIME_SLOT_INCOMPLETE;
    if (start >= end) return TEXT.VALIDATE_TIME_SLOT_RANGE;
  }
  return '';
}

export function collectTimeSlots(container) {
  const out = [];
  if (!container) return out;
  container.querySelectorAll('.time-slot').forEach(row => {
    const dow = row.querySelector('.slot-dow').value;
    const start = readTimeField(row.querySelector('.time-field[data-time-role="start"]'));
    const end = readTimeField(row.querySelector('.time-field[data-time-role="end"]'));
    if (!dow || !start || !end) return;
    out.push({ type: 'week', dow: +dow, start, end });
  });
  return out;
}

export function prefillTimeSlots(container, raw) {
  if (!container) return;
  let slots = [];
  if (raw) {
    try { const p = JSON.parse(raw); if (Array.isArray(p)) slots = p.filter(s => s && typeof s === 'object' && s.type === 'week'); } catch { slots = []; }
  }
  slots.forEach(s => {
    const row = document.createElement('div');
    row.className = 'time-slot';
    row.innerHTML = renderTimeSlotRowHtml({ dow: s.dow, start: s.start, end: s.end });
    container.insertBefore(row, container.querySelector('.time-slots-add'));
    bindTimeSlotRow(row);
  });
  setAddDisabled(container, slots.length >= CONFIG.TIME_SLOTS_MAX);
}

/**
 * v2 chart core: parity migration of app-chart.js glass SVG area chart.
 * No Chinese literals and no inline style attribute strings; SVG presentation
 * attributes + runtime style setters are used instead.
 */
import { TEXT } from '../constants/text.js';

const esc = s => String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const fmtDefault = v => (v == null ? '—' : Number(v).toLocaleString('zh-CN'));

export function niceTicks(min, max, count) {
  const span = max - min || 1;
  const rawStep = span / (count - 1);
  const mag = Math.pow(10, Math.floor(Math.log10(rawStep)));
  const norm = rawStep / mag;
  const step = (norm <= 1 ? 1 : norm <= 2 ? 2 : norm <= 5 ? 5 : 10) * mag;
  const ticks = [];
  for (let v = Math.ceil(min / step) * step; v <= max + step * 0.001; v += step) {
    ticks.push(Math.round(v * 100) / 100);
  }
  return ticks.length ? ticks : [min];
}

export function renderGlassLineChart(container, opts = {}) {
  if (!container) return { refresh: () => {} };
  const colorVar = opts.colorVar || '--chart-traffic';
  const height = opts.height || 220;
  const fmt = opts.valueFmt || fmtDefault;
  const data = (opts.data || []).filter(d => d && d.label != null);
  const hasVal = data.some(d => d.value != null);
  const css = () => {
    const s = getComputedStyle(document.documentElement);
    const color = s.getPropertyValue(colorVar).trim() || '#6B5BD2';
    const ink = s.getPropertyValue('--ink').trim() || '#111114';
    const muted = s.getPropertyValue('--muted').trim() || '#6E6E76';
    const line = s.getPropertyValue('--line').trim() || 'rgba(0,0,0,.12)';
    return { color, ink, muted, line };
  };
  let svg = null;
  const draw = () => {
    const W = Math.max(container.clientWidth - 16, 240);
    const pad = { l: 44, r: 12, t: 14, b: 26 };
    const iw = W - pad.l - pad.r, ih = height - pad.t - pad.b;
    const C = css();
    const values = data.map(d => d.value);
    const nonNull = values.filter(v => v != null);
    const xAt = i => pad.l + (data.length <= 1 ? iw / 2 : (iw * i) / (data.length - 1));
    let yAt = () => pad.t;
    if (!hasVal || !nonNull.length) {
      container.innerHTML = `<div class="chart-glass glass"><div class="chart-head"><span class="chart-title">${esc(opts.title || '')}</span></div><div class="chart-empty">${esc(opts.emptyText || TEXT.CHART_EMPTY)}</div></div>`;
      return;
    }
    let yMin, yMax;
    if (opts.baselineAtZero) {
      yMin = 0; yMax = Math.max(...nonNull) || 1;
    } else {
      yMin = Math.min(...nonNull); yMax = Math.max(...nonNull);
      const padRange = (yMax - yMin) * 0.15 || Math.max(Math.abs(yMax) * 0.15, 1);
      yMin -= padRange; yMax += padRange;
    }
    yAt = v => pad.t + ih - ((v - yMin) / (yMax - yMin || 1)) * ih;
    const ticks = niceTicks(yMin, yMax, 4);
    const segments = [];
    let cur = [];
    data.forEach((d, i) => {
      if (d.value != null) cur.push({ i, d });
      else if (cur.length) { segments.push(cur); cur = []; }
    });
    if (cur.length) segments.push(cur);
    const segPaths = segments.map(seg => {
      const pts = seg.map(({ i, d }) => `${xAt(i)},${yAt(d.value)}`);
      const lineD = seg.length > 1 ? `M${pts.join(' L')}` : `M${pts[0]} L${pts[0]}`;
      const areaD = seg.length > 1
        ? `${lineD} L${xAt(seg[seg.length - 1].i)},${pad.t + ih} L${xAt(seg[0].i)},${pad.t + ih} Z`
        : '';
      return { lineD, areaD };
    });
    const lastIdx = data.length - 1;
    const lastVal = data[lastIdx].value;
    const tip = document.createElement('div');
    tip.className = 'chart-tooltip glass glass--float';
    tip.hidden = true;
    const cross = document.createElementNS('http://www.w3.org/2000/svg', 'g');
    cross.setAttribute('class', 'chart-crosshair');
    cross.setAttribute('hidden', '');
    cross.innerHTML = `<line class="chart-crosshair-line" y1="${pad.t}" y2="${pad.t + ih}"></line><circle class="chart-crosshair-dot" r="4"></circle>`;
    const tipValue = document.createElement('strong');
    const tipLabel = document.createElement('span');
    tip.appendChild(tipValue); tip.appendChild(tipLabel);
    svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
    svg.setAttribute('width', W); svg.setAttribute('height', height);
    svg.setAttribute('role', 'img');
    svg.setAttribute('aria-label', opts.title || TEXT.CHART_DEFAULT_TITLE);
    svg.classList.add('chart-svg');
    const gradId = 'chartgrad' + Math.random().toString(36).slice(2, 8);
    svg.innerHTML = `
      <defs><linearGradient id="${gradId}" x1="0" y1="0" x2="0" y2="1">
        <stop offset="0" stop-color="${C.color}" stop-opacity=".28"></stop>
        <stop offset="1" stop-color="${C.color}" stop-opacity="0"></stop>
      </linearGradient></defs>
      <g class="chart-grid">${ticks.map(t => `<line x1="${pad.l}" x2="${pad.l + iw}" y1="${yAt(t)}" y2="${yAt(t)}"></line>`).join('')}</g>
      <g class="chart-axis-y">${ticks.map(t => `<text x="${pad.l - 8}" y="${yAt(t) + 4}" text-anchor="end">${fmt(t)}</text>`).join('')}</g>
      <g class="chart-axis-x">${xLabels(data, opts.unit || 'day', W, pad)}</g>
      ${segPaths.map(p => p.areaD ? `<path class="chart-area" d="${p.areaD}" fill="url(#${gradId})"></path>` : '').join('')}
      ${segPaths.map(p => `<path class="chart-line" d="${p.lineD}"></path>`).join('')}
      ${lastVal != null ? `<circle class="chart-end-dot" cx="${xAt(lastIdx)}" cy="${yAt(lastVal)}" r="4"></circle>` : ''}
    `;
    svg.appendChild(cross);
    const onMove = e => {
      const rect = svg.getBoundingClientRect();
      const ratio = (e.clientX - rect.left) / rect.width;
      const idx = Math.round(ratio * (data.length - 1));
      const d = data[idx];
      if (!d || d.value == null) { tip.hidden = true; cross.setAttribute('hidden', ''); return; }
      const x = xAt(idx), y = yAt(d.value);
      cross.querySelector('line').setAttribute('x1', x); cross.querySelector('line').setAttribute('x2', x);
      cross.querySelector('circle').setAttribute('cx', x); cross.querySelector('circle').setAttribute('cy', y);
      cross.removeAttribute('hidden');
      tipValue.textContent = fmt(d.value);
      tipLabel.textContent = d.label;
      tip.hidden = false;
      const tipW = tip.offsetWidth || 90;
      tip.style.left = Math.min(Math.max(x + 10, 6), rect.width - tipW - 6) + 'px';
      tip.style.top = Math.max(y - 42, 4) + 'px';
    };
    const onLeave = () => { tip.hidden = true; cross.setAttribute('hidden', ''); };
    svg.addEventListener('mousemove', onMove);
    svg.addEventListener('mouseleave', onLeave);
    const total = nonNull.reduce((s, v) => s + v, 0);
    const headStat = opts.statFmt ? opts.statFmt(total, nonNull.length) : fmt(total);
    const plot = document.createElement('div');
    plot.className = 'chart-plot';
    plot.appendChild(svg);
    plot.appendChild(tip);
    const table = document.createElement('details');
    table.className = 'chart-table';
    table.innerHTML = `<summary>${esc(opts.tableLabel || TEXT.CHART_TABLE_LABEL)}</summary>
      <table><thead><tr><th>${esc(opts.timeLabel || TEXT.CHART_TIME_LABEL)}</th><th>${esc(opts.title || '')}</th></tr></thead>
      <tbody>${data.map(() => '<tr><td></td><td></td></tr>').join('')}</tbody></table>`;
    const tds = table.querySelectorAll('td');
    data.forEach((d, i) => { tds[i * 2].textContent = d.label; tds[i * 2 + 1].textContent = fmt(d.value); });
    container.innerHTML = '';
    const box = document.createElement('div');
    box.className = 'chart-glass glass';
    box.innerHTML = `<div class="chart-head"><span class="chart-title">${esc(opts.title || '')}</span>${headStat ? `<span class="chart-stat">${esc(String(headStat))}</span>` : ''}</div>`;
    box.appendChild(plot);
    box.appendChild(table);
    container.appendChild(box);
    box.style.setProperty('--chart-color', C.color);
  };
  function xLabels(data, u, W, pad) {
    const step = data.length <= 8 ? 1 : Math.ceil(data.length / 6);
    const fmtL = d => {
      const L = String((d && d.label) || '');
      if (u === 'hour') return L.slice(11, 16);
      return L.slice(5);
    };
    const out = [];
    for (let i = 0; i < data.length; i += step) {
      const x = pad.l + (data.length <= 1 ? (W - pad.l - pad.r) / 2 : ((W - pad.l - pad.r) * i) / (data.length - 1));
      out.push(`<text x="${x}" y="${height - 8}" text-anchor="middle">${esc(fmtL(data[i]))}</text>`);
    }
    return out.join('');
  }
  draw();
  let t = null;
  const onResize = () => { clearTimeout(t); t = setTimeout(() => { if (container.isConnected) draw(); }, 120); };
  window.addEventListener('resize', onResize);
  return { refresh: () => draw() };
}

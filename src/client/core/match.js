/**
 * v2 match core: parity migration of app-demands.js five-dimension matching.
 * Pure functions; labels/hints come from constants/text.js, region policy data
 * from constants/region-data.js.
 */
import { CONFIG } from '../../shared/config.js';
import { DEMAND_TYPES } from '../../shared/enums.js';
import { SUFE_REGIONS } from '../constants/region-data.js';
import { TEXT } from '../constants/text.js';
import { provinceName } from './display.js';
import { escHtml } from './dom.js';

export function genderMatchScore(pref, teacherGender) {
  if (!pref) return 100;
  if (!teacherGender || teacherGender === 'undeclared' || teacherGender === 'nonbinary') return CONFIG.GENDER_MATCH_UNDISCLOSED;
  return teacherGender === pref ? 100 : 0;
}

export function haversineKm(a, b) {
  if (!a || !b) return Infinity;
  const R = 6371, toRad = d => d * Math.PI / 180;
  const dLat = toRad(b.lat - a.lat), dLng = toRad(b.lng - a.lng);
  const s = Math.sin(dLat / 2) ** 2 + Math.cos(toRad(a.lat)) * Math.cos(toRad(b.lat)) * Math.sin(dLng / 2) ** 2;
  return 2 * R * Math.asin(Math.sqrt(s));
}

export function distanceScore(km) {
  const maxKm = CONFIG.MATCH_DISTANCE_MAX_KM;
  return Number.isFinite(km) && km <= maxKm ? Math.max(0, 1 - km / maxKm) : 0;
}

export function matchDims(t, d) {
  if (!t || !d) return [];
  const W = CONFIG.MATCH_WEIGHT;
  const type = d.target_type === DEMAND_TYPES.NONACADEMIC ? DEMAND_TYPES.NONACADEMIC : DEMAND_TYPES.ACADEMIC;
  const tSubj = type === DEMAND_TYPES.NONACADEMIC
    ? (Array.isArray(t.nonacademic_projects) ? t.nonacademic_projects : [])
    : (Array.isArray(t.subjects) ? t.subjects : []);
  const dSubj = Array.isArray(d.target_subjects) ? d.target_subjects : [];
  const hit = dSubj.filter(s => tSubj.includes(s)).length;
  const subjOn = tSubj.length > 0 && dSubj.length > 0;
  const subjScore = subjOn ? hit / dSubj.length * W.subject : null;

  const prefTags = Array.isArray(d.preferred_personality_tags) ? d.preferred_personality_tags : [];
  const tPersonality = Array.isArray(t.personality_tags) ? t.personality_tags : [];
  const pHit = prefTags.filter(tag => tPersonality.includes(tag)).length;
  const personalityOn = prefTags.length > 0;
  const personalityScore = personalityOn ? pHit / prefTags.length * W.personality : null;

  const online = d.teaching_method === 'online';
  let regionScore = null;
  let regionHint = TEXT.MATCH_DIM_SKIP;
  // T-6-F4: offline-distance scoring gated by the data-driven province policy (allowsOffline), not a hardcoded id
  if (!online && SUFE_REGIONS.allowsOffline(d.province)) {
    const tC = SUFE_REGIONS && SUFE_REGIONS.townCoordByAddr ? SUFE_REGIONS.townCoordByAddr(t.address) : null;
    const dC = SUFE_REGIONS && SUFE_REGIONS.townCoordByAddr ? SUFE_REGIONS.townCoordByAddr(d.address) : null;
    if (tC && dC) {
      const km = haversineKm(tC, dC);
      regionScore = distanceScore(km) * W.region;
      regionHint = km <= 0.5 ? TEXT.MATCH_DISTANCE_SAME
        : TEXT.MATCH_DISTANCE_HIT.replace('{km}', km < 10 ? km.toFixed(1) : String(Math.round(km)));
    } else if (!tC) {
      regionHint = TEXT.MATCH_DISTANCE_NO_LOCALE;
    }
  } else if (!online && t.province && d.province) {
    regionScore = t.province === d.province ? W.region : 0;
    regionHint = regionScore === W.region
      ? TEXT.MATCH_REGION_HIT.replace('{name}', escHtml(provinceName(d.province))) : TEXT.MATCH_REGION_MISS;
  } else if (online) {
    regionHint = TEXT.MATCH_DISTANCE_ONLINE;
  }

  const budgetOn = t.price_min != null && (d.budget_min || d.budget_max);
  const budgetScore = budgetOn
    ? ((!d.budget_min || t.price_min >= d.budget_min) && (!d.budget_max || t.price_min <= d.budget_max) ? W.budget : 0) : null;

  const prefGender = d.preferred_teacher_gender || '';
  const gScore = genderMatchScore(prefGender, t.gender);
  const genderScore = gScore / 100 * W.gender;
  const genderHint = !prefGender ? TEXT.MATCH_GENDER_ANY
    : gScore === CONFIG.GENDER_MATCH_UNDISCLOSED ? TEXT.MATCH_GENDER_UNDISCLOSED
    : gScore === 100 ? TEXT.MATCH_GENDER_HIT : TEXT.MATCH_GENDER_MISS;

  return [
    { key: 'subject', label: TEXT.MATCH_ITEM_SUBJECT, score: subjScore, max: W.subject,
      hint: subjOn ? TEXT.MATCH_SUBJECT_HIT.replace('{hit}', hit).replace('{total}', dSubj.length) : TEXT.MATCH_DIM_SKIP },
    { key: 'personality', label: TEXT.MATCH_ITEM_PERSONALITY, score: personalityScore, max: W.personality,
      hint: !personalityOn ? TEXT.MATCH_DIM_SKIP : (pHit > 0 ? TEXT.MATCH_PERSONALITY_HIT.replace('{hit}', pHit).replace('{total}', prefTags.length) : TEXT.MATCH_PERSONALITY_MISS) },
    { key: 'region', label: TEXT.MATCH_ITEM_REGION, score: regionScore, max: W.region, hint: regionHint },
    { key: 'budget', label: TEXT.MATCH_ITEM_BUDGET, score: budgetScore, max: W.budget,
      hint: !budgetOn ? TEXT.MATCH_DIM_SKIP : (budgetScore === W.budget ? TEXT.MATCH_BUDGET_HIT : TEXT.MATCH_BUDGET_MISS) },
    { key: 'gender', label: TEXT.MATCH_ITEM_GENDER, score: genderScore, max: W.gender, hint: genderHint },
  ];
}

export function matchDegree(teacher, demand) {
  if (!teacher || !demand) return null;
  const dims = matchDims(teacher, demand);
  let score = 0, total = 0;
  for (const dim of dims) {
    if (dim.score == null) continue;
    total += dim.max;
    score += Math.min(dim.max, dim.score);
  }
  if (!total) return null;
  return Math.min(CONFIG.MATCH_MAX, Math.round(score / total * 100));
}

export function matchLevel(md) {
  if (md >= CONFIG.MATCH_COLOR_HIGH) return 'hi';
  if (md >= CONFIG.MATCH_COLOR_MID) return 'mid';
  return 'lo';
}

export function matchRowsHtml(dims) {
  const row = (k, s, max, hint) => {
    const skip = s == null;
    const pct = skip ? 0 : Math.round(s / max * 100);
    const lvl = skip ? '' : (pct >= CONFIG.MATCH_COLOR_HIGH ? 'hi' : pct >= CONFIG.MATCH_COLOR_MID ? 'mid' : 'lo');
    return `<div class="match-row${lvl ? ` match-row--${lvl}` : ''}">
      <span class="match-row-top"><span class="match-row-k">${k}</span><span class="match-row-s${skip ? ' match-row-s--skip' : ''}">${skip ? TEXT.MATCH_DIM_SKIP : Math.round(s) + '/' + max}</span></span>
      <div class="match-bar${skip ? ' match-bar--skip' : ''}"><i data-bar-w="${pct}"></i></div>
      <span class="match-row-hint">${hint}</span>
    </div>`;
  };
  return dims.map(dim => row(dim.label, dim.score, dim.max, dim.hint)).join('');
}

// matchRowsHtml emits data-bar-w (core forbids inline style attrs).
// Render hooks must call applyBarWidths to write the equivalent --bar-w CSS var.
export function applyBarWidths(root) {
  const target = root || document;
  target.querySelectorAll('.match-bar i[data-bar-w]').forEach(i => {
    const pct = Math.max(0, Math.min(100, Number(i.dataset.barW) || 0));
    i.style.setProperty('--bar-w', `${pct}%`);
  });
}

// Callers that render matchRowsHtml outside router.loadInto MUST call applyBarWidths
// explicitly, or rely on installBarWidthBindings() which boot enables globally.
let barWidthBindingsInstalled = false;
export function installBarWidthBindings() {
  if (barWidthBindingsInstalled || typeof document === 'undefined') return;
  barWidthBindingsInstalled = true;
  applyBarWidths(document);
  new MutationObserver(muts => {
    for (const m of muts) {
      for (const n of m.addedNodes) {
        if (n.nodeType !== 1) continue;
        if (n.matches && n.matches('.match-bar i[data-bar-w]')) applyBarWidths(n.parentElement);
        if (n.querySelectorAll) applyBarWidths(n);
      }
    }
  }).observe(document.documentElement, { childList: true, subtree: true });
}

export function matchNoteHtml() {
  const W = CONFIG.MATCH_WEIGHT;
  return TEXT.MATCH_NOTE
    .replace('{subject}', W.subject).replace('{region}', W.region).replace('{budget}', W.budget)
    .replace('{personality}', W.personality).replace('{gender}', W.gender);
}

export function matchDetailHtml(t, d, md) {
  const note = matchNoteHtml();
  return `<div class="match-detail glass glass--float match-detail--${matchLevel(md)}" role="dialog" aria-label="${TEXT.MATCH_DETAIL_TITLE}">
    <div class="match-detail-head"><span class="match-detail-pct">${md}%</span><span class="match-detail-title">${TEXT.MATCH_DETAIL_TITLE}</span></div>
    <p class="match-detail-sub">${TEXT.MATCH_DETAIL_SUB}</p>
    ${matchRowsHtml(matchDims(t, d))}
    <p class="match-note">${note}</p>
  </div>`;
}

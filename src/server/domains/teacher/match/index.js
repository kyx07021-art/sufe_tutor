/**
 * S4-20 match-degree aggregator (pure) + I-32 matchCount.
 *
 * matchScore = round(Σ(score_i × weight_i) / Σ(weight_i of applicable dims) × 100),
 * clamped to [0,100]; null when no dimension is applicable (or input missing) — the
 * teacher-list handler then omits match sorting for that row.
 *
 * matchCount = number of screening dimensions (subject / gender / personality / price)
 * that the teacher HITS against the student's demand (I-32). Each counts 0 or 1.
 *
 * matchDimensions is exposed for unit tests / debugging (one item per dimension key).
 */
import { normalizeTeacher, normalizeDemand } from './normalize.js';
import { subject } from './subject.js';
import { method } from './method.js';
import { region } from './region.js';
import { price } from './price.js';
import { preference } from './preference.js';

export { haversineKm, distanceScore } from './region.js';
export { normalizeTeacher, normalizeDemand } from './normalize.js';

function allDimensions(t, d) {
  return [
    ...subject(t, d),
    ...method(t, d),
    ...region(t, d),
    ...price(t, d),
    ...preference(t, d),
  ];
}

/** Raw dimension items (normalized inputs). @returns {{key:string, score:number|null, weight:number}[]} */
export function matchDimensions(teacher, demand) {
  if (!teacher || !demand) return [];
  return allDimensions(normalizeTeacher(teacher), normalizeDemand(demand));
}

/** 0-100 match score or null when no dimension applies / input missing. */
export function matchDegree(teacher, demand) {
  if (!teacher || !demand) return null;
  const t = normalizeTeacher(teacher), d = normalizeDemand(demand);
  const items = allDimensions(t, d);
  let total = 0, score = 0;
  for (const it of items) {
    if (it.score == null) continue;
    total += it.weight;
    score += it.score * it.weight;
  }
  if (!total) return null;
  return Math.max(0, Math.min(100, Math.round((score / total) * 100)));
}

/** I-32 screening hit count: subject / gender / personality / price (each 0|1). */
export function matchCount(teacher, demand) {
  if (!teacher || !demand) return 0;
  const t = normalizeTeacher(teacher), d = normalizeDemand(demand);
  let count = 0;
  if (d.subject && subject(t, d)[0].score === 1) count += 1;
  if (d.preferredGender && t.gender === d.preferredGender) count += 1;
  if (d.preferredTags.length && d.preferredTags.some(tag => t.personalityTags.includes(tag))) count += 1;
  if (priceHit(t, d)) count += 1;
  return count;
}

function priceHit(t, d) {
  if (t.priceMin == null && t.priceMax == null) return false;
  if (d.budgetMin == null && d.budgetMax == null) return false;
  const lo = t.priceMin ?? 0, hi = t.priceMax ?? Number.POSITIVE_INFINITY;
  const dlo = d.budgetMin ?? 0, dhi = d.budgetMax ?? Number.POSITIVE_INFINITY;
  return Math.max(lo, dlo) <= Math.min(hi, dhi);
}

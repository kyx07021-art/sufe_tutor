/**
 * S4-19 preference dimension (pure). Weight 10 split as personality 5 + gender 5.
 * - personality: demand preferred-tag list empty -> NOT applicable (null); else hit-ratio
 *   (hits / preferred-count; teacher without matching tags scores 0).
 * - gender: demand preferred-gender empty -> NOT applicable (null); teacher undisclosed
 *   ('' / 'undeclared' / legacy 'nonbinary') -> GENDER_UNDISCLOSED_SCORE (0.5); else
 *   exact match 1 / mismatch 0.
 */
import { WEIGHTS, GENDER_UNDISCLOSED_SCORE } from './weights.js';

/**
 * @param {import('./normalize.js').NormalizedTeacher} t
 * @param {import('./normalize.js').NormalizedDemand} d
 * @returns {{key:'personality'|'gender', score:number|null, weight:number}[]}
 */
export function preference(t, d) {
  const out = [];

  const pref = d.preferredTags;
  if (!pref.length) {
    out.push({ key: 'personality', score: null, weight: WEIGHTS.personality });
  } else {
    const hit = pref.filter(tag => t.personalityTags.includes(tag)).length;
    out.push({ key: 'personality', score: hit / pref.length, weight: WEIGHTS.personality });
  }

  if (!d.preferredGender) {
    out.push({ key: 'gender', score: null, weight: WEIGHTS.gender });
  } else if (!t.gender || t.gender === 'undeclared' || t.gender === 'nonbinary') {
    out.push({ key: 'gender', score: GENDER_UNDISCLOSED_SCORE, weight: WEIGHTS.gender });
  } else {
    out.push({ key: 'gender', score: t.gender === d.preferredGender ? 1 : 0, weight: WEIGHTS.gender });
  }

  return out;
}

/**
 * subject dimension (pure). Weight 35.
 * Academic demands match against teacher `subjects`; non-academic demands (music/painting/...)
 * match against teacher `nonacademic_projects`. A demand without a subject or a teacher with no
 * subjects in the relevant domain is NOT applicable (null) — it contributes no weight.
 */
import { SUBJECTS, NONACADEMIC_PROJECTS } from '../../../../shared/enums.js';
import { WEIGHTS } from './weights.js';

const ACADEMIC = new Set(SUBJECTS.map(s => s.id));
const NONACADEMIC = new Set(NONACADEMIC_PROJECTS.map(p => p.id));

/**
 * @param {import('./normalize.js').NormalizedTeacher} t
 * @param {import('./normalize.js').NormalizedDemand} d
 * @returns {{key:'subject', score:number|null, weight:number}[]}
 */
export function subject(t, d) {
  if (!d.subject) return [{ key: 'subject', score: null, weight: WEIGHTS.subject }];
  const pool = ACADEMIC.has(d.subject)
    ? t.subjects
    : NONACADEMIC.has(d.subject)
      ? t.nonacademic
      : t.subjects;
  if (!pool.length) return [{ key: 'subject', score: null, weight: WEIGHTS.subject }];
  return [{ key: 'subject', score: pool.includes(d.subject) ? 1 : 0, weight: WEIGHTS.subject }];
}

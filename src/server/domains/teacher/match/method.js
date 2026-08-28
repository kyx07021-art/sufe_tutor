/**
 * teaching-method dimension (pure). Weight 10.
 * Compatibility matrix over the 9 combos of demand.method x teacher.method
 * (each side is online | offline | both, plus '' = not declared):
 *
 * demand \ teacher online offline both ''
 * online 1 0 1 null
 * offline 0 1 1 null
 * both 1 1 1 null
 * '' null null null null
 *
 * A student who accepts both modes matches any declared teacher method; a missing method
 * on either side is NOT applicable (null).
 */
import { WEIGHTS } from './weights.js';

const M = { ONLINE: 'online', OFFLINE: 'offline', BOTH: 'both' };

/**
 * @param {import('./normalize.js').NormalizedTeacher} t
 * @param {import('./normalize.js').NormalizedDemand} d
 * @returns {{key:'method', score:number|null, weight:number}[]}
 */
export function method(t, d) {
  if (!d.method || !t.method) return [{ key: 'method', score: null, weight: WEIGHTS.method }];
  let score;
  if (d.method === M.BOTH) score = 1;
  else if (d.method === M.ONLINE) score = (t.method === M.ONLINE || t.method === M.BOTH) ? 1 : 0;
  else score = (t.method === M.OFFLINE || t.method === M.BOTH) ? 1 : 0; // offline
  return [{ key: 'method', score, weight: WEIGHTS.method }];
}

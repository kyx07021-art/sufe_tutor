/**
 * region dimension (pure). Weight 25.
 * - Demand has no province -> NOT applicable (null).
 * - Demand is online-only -> distance is irrelevant -> NOT applicable (null).
 * - Teacher province differs from demand province -> 0 (cannot reach offline).
 * - Same province:
 * - Offline-licensed province (Shanghai) with both structured addresses resolvable ->
 * haversine distance, linear decay to 0 at DISTANCE_MAX_KM (20km).
 * - Shanghai but an address is missing on either side -> NOT applicable (null, unknown).
 * - Non-offline-licensed province -> 1 (same province counts as reachable).
 *
 * haversineKm / distanceScore are pure and exported for unit tests (ported from v2 client
 * src/client/core/match.js).
 */
import { SUFE_REGIONS } from '../../../../shared/region-data.js';
import { WEIGHTS, DISTANCE_MAX_KM } from './weights.js';

export function haversineKm(a, b) {
  if (!a || !b) return Infinity;
  const R = 6371, toRad = d => d * Math.PI / 180;
  const dLat = toRad(b.lat - a.lat), dLng = toRad(b.lng - a.lng);
  const s = Math.sin(dLat / 2) ** 2 + Math.cos(toRad(a.lat)) * Math.cos(toRad(b.lat)) * Math.sin(dLng / 2) ** 2;
  return 2 * R * Math.asin(Math.sqrt(s));
}

export function distanceScore(km) {
  return Number.isFinite(km) && km <= DISTANCE_MAX_KM ? Math.max(0, 1 - km / DISTANCE_MAX_KM) : 0;
}

/**
 * @param {import('./normalize.js').NormalizedTeacher} t
 * @param {import('./normalize.js').NormalizedDemand} d
 * @returns {{key:'region', score:number|null, weight:number}[]}
 */
export function region(t, d) {
  if (!d.province || d.method === 'online') return [{ key: 'region', score: null, weight: WEIGHTS.region }];
  if (t.province !== d.province) return [{ key: 'region', score: 0, weight: WEIGHTS.region }];
  if (SUFE_REGIONS.allowsOffline(d.province)) {
    const tC = SUFE_REGIONS.townCoordByAddr(t.address);
    const dC = SUFE_REGIONS.townCoordByAddr(d.address);
    if (tC && dC) return [{ key: 'region', score: distanceScore(haversineKm(tC, dC)), weight: WEIGHTS.region }];
    return [{ key: 'region', score: null, weight: WEIGHTS.region }];
  }
  return [{ key: 'region', score: 1, weight: WEIGHTS.region }];
}

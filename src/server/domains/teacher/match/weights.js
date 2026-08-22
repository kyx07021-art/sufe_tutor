/**
 * S4-13 match-degree weights (single source).
 * The weights live in shared/config.js (MATCH_WEIGHTS, sum=100); this module is the
 * server-side read point so every dimension and the aggregator import one symbol.
 * The v2 client-side CONFIG.MATCH_WEIGHT is intentionally left untouched (legacy).
 */
import { CONFIG, MATCH_WEIGHTS } from '../../../../shared/config.js';

export const WEIGHTS = MATCH_WEIGHTS;

/** Region distance scoring ceiling (km): linear decay to 0 at this distance (config single source). */
export const DISTANCE_MAX_KM = CONFIG.MATCH_DISTANCE_MAX_KM;

/** Gender score when the teacher does not disclose gender (undeclared/''/legacy nonbinary) against an explicit preference. */
export const GENDER_UNDISCLOSED_SCORE = CONFIG.GENDER_MATCH_UNDISCLOSED / 100;

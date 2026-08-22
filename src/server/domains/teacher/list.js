/**
 * S4-09..12 Teacher plaza list: in-handler sort / filter / match integration.
 *
 * I-29 shape: GET /api/teachers?sort=match|rating|exp|price&order=asc|desc
 *   &filters={subjects[],gender,personalities[],priceMin,priceMax}
 * 200: { items:[...], total, teachers:[...] }
 *
 * - sort whitelist {match,rating,exp,price}; invalid/absent -> no sort (dbGetTeachers order kept)
 * - order {asc,desc}, default desc; null/undefined sort keys go LAST regardless of order
 * - filters accept BOTH the `filters` JSON query param and flat params
 *   (subjects/personalities comma lists, gender, priceMin, priceMax), merged into one object
 * - match (S4-12 / I-32): computed only for a logged-in student with an open demand
 *   (the most recent one, fetched server-side). matchScore 0-100 weighted; matchCount =
 *   screening dims hit (subject/gender/personality/price). Everyone else / no demand -> both null.
 * - response dual-key: legacy v2 consumers read `teachers`, the new frontend reads `items`;
 *   both reference the same array; `total` is the post-filter count.
 *
 * Row fields are read defensively (snake_case vs the new-model camelCase) so this handler
 * works whichever shape mapTeacherProfileRow outputs when the parallel mapper lands.
 */
import { json } from '../../core/util.js';
import { requireUser } from '../../core/security.js';
import { dbGetTeachers, dbGetStudentOpenDemand } from './repo.js';
import { matchDegree, matchCount } from './match/index.js';

const SORTS = new Set(['match', 'rating', 'exp', 'price']);

/** Finite number or null ('' / null / undefined / NaN all -> null). */
function finiteOrNull(v) {
  if (v === null || v === undefined || v === '') return null;
  const n = Number(v);
  return Number.isFinite(n) ? n : null;
}

/** String ids from an array that may hold strings or {subject|id|key} objects (C3). */
function stringIds(arr) {
  if (!Array.isArray(arr)) return [];
  const out = [];
  for (const x of arr) {
    if (typeof x === 'string') { if (x) out.push(x); }
    else if (x && typeof x === 'object') {
      const k = x.subject ?? x.id ?? x.key;
      if (typeof k === 'string' && k) out.push(k);
    }
  }
  return out;
}

const subjectIdsOf = t => stringIds(t.subjects);
const personalityIdsOf = t => stringIds(Array.isArray(t.personality_tags) ? t.personality_tags : t.personalityTags);

/** Price midpoint sort key: single side uses the single side; double-null -> null (last). */
export function priceMidpoint(t) {
  const lo = finiteOrNull(t.price_min ?? t.priceMin);
  const hi = finiteOrNull(t.price_max ?? t.priceMax);
  if (lo == null && hi == null) return null;
  if (lo == null) return hi;
  if (hi == null) return lo;
  return (lo + hi) / 2;
}

/** Sort-key getters keyed by the sort whitelist value (I-29 / S4-09/10/12). */
const ratingKey = t => finiteOrNull(t.rating);
const expKey = t => finiteOrNull(t.experience_years ?? t.experienceYears);
const matchKey = t => t.matchScore ?? null;

const SORT_GETTERS = { match: matchKey, rating: ratingKey, exp: expKey, price: priceMidpoint };

/**
 * Generic nulls-last comparator: null/undefined keys sort to the end no matter the order
 * direction; non-null comparisons respect asc (dir=1) / desc (dir=-1).
 */
export function makeComparator(getKey, order) {
  const dir = order === 'asc' ? 1 : -1;
  return (a, b) => {
    const ka = getKey(a);
    const kb = getKey(b);
    const aNull = ka == null;
    const bNull = kb == null;
    if (aNull && bNull) return 0;
    if (aNull) return 1;
    if (bNull) return -1;
    if (ka < kb) return -dir;
    if (ka > kb) return dir;
    return 0;
  };
}

/**
 * Coerce a merged filter object to its typed shape (arrays of strings, finite price
 * numbers). Filter keys that are absent stay absent.
 */
export function normalizeFilters(raw = {}) {
  const out = {};
  if (Array.isArray(raw.subjects)) out.subjects = raw.subjects.filter(x => typeof x === 'string' && x);
  if (typeof raw.gender === 'string' && raw.gender) out.gender = raw.gender;
  if (Array.isArray(raw.personalities)) out.personalities = raw.personalities.filter(x => typeof x === 'string' && x);
  const pmin = finiteOrNull(raw.priceMin);
  if (pmin != null) out.priceMin = pmin;
  const pmax = finiteOrNull(raw.priceMax);
  if (pmax != null) out.priceMax = pmax;
  return out;
}

/**
 * Parse query params into { sort, order, filters }. Invalid/absent sort -> null (no sort);
 * default order 'desc'. Filters accept the `filters` JSON query param AND flat params
 * (flat params win on conflict). Malformed `filters` JSON is ignored, not a 4xx — it is an
 * optional refinement and must not take down the public list.
 */
export function parseListParams(url) {
  const p = url.searchParams;
  const sort = SORTS.has(p.get('sort')) ? p.get('sort') : null;
  const order = p.get('order') === 'asc' ? 'asc' : 'desc';
  const raw = p.get('filters');
  let filters = {};
  if (raw) {
    try {
      const parsed = JSON.parse(raw);
      if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) filters = { ...parsed };
    } catch { /* ignore malformed filters JSON */ }
  }
  const subjects = p.get('subjects');
  if (subjects != null) filters.subjects = subjects.split(',').map(s => s.trim()).filter(Boolean);
  const personalities = p.get('personalities');
  if (personalities != null) filters.personalities = personalities.split(',').map(s => s.trim()).filter(Boolean);
  const gender = p.get('gender');
  if (gender != null) filters.gender = gender;
  const priceMin = p.get('priceMin');
  if (priceMin != null) filters.priceMin = priceMin;
  const priceMax = p.get('priceMax');
  if (priceMax != null) filters.priceMax = priceMax;
  return { sort, order, filters: normalizeFilters(filters) };
}

/**
 * Apply the typed filters to a teacher array (returns a new array; the input is untouched).
 * - subjects: keep teachers whose subject-id array intersects the filter list
 * - gender: exact match
 * - personalities: keep teachers whose personalityTags intersects the list
 * - price range-cross hit: teacher [lo,hi] (null = unbounded) must overlap the filter
 *   range; a teacher with no price at all is excluded when a price filter is active.
 */
export function applyFilters(teachers, filters = {}) {
  let out = teachers.slice();
  if (Array.isArray(filters.subjects) && filters.subjects.length) {
    const want = new Set(filters.subjects);
    out = out.filter(t => subjectIdsOf(t).some(id => want.has(id)));
  }
  if (filters.gender) {
    out = out.filter(t => t.gender === filters.gender);
  }
  if (Array.isArray(filters.personalities) && filters.personalities.length) {
    const want = new Set(filters.personalities);
    out = out.filter(t => personalityIdsOf(t).some(id => want.has(id)));
  }
  const pmin = filters.priceMin;
  const pmax = filters.priceMax;
  if (pmin != null || pmax != null) {
    out = out.filter(t => {
      const lo = finiteOrNull(t.price_min ?? t.priceMin);
      const hi = finiteOrNull(t.price_max ?? t.priceMax);
      if (lo == null && hi == null) return false; // no price at all -> excluded under a price filter
      const loOk = pmax == null || lo == null || lo <= pmax;
      const hiOk = pmin == null || hi == null || hi >= pmin;
      return loOk && hiOk;
    });
  }
  return out;
}

/** GET /api/teachers —— plaza list (I-29). Login-gated: interfaces.md I-29 requires an
 *  authenticated user (no guest browsing, S6 §17), consistent with the demand plaza (I-34)
 *  which is requireUser. Anonymous requests get a 401. */
export async function handleGetTeachers(db, req) {
  const { user: me, err } = await requireUser(db, req);
  if (err) return err;
  const teachers = await dbGetTeachers(db, { viewerId: me.id });

  // S4-12: match fields only for a logged-in student with an open demand; otherwise both null.
  if (me.role === 'student') {
    const demand = await dbGetStudentOpenDemand(db, me.id);
    for (const t of teachers) {
      if (demand) {
        t.matchScore = matchDegree(t, demand);
        t.matchCount = matchCount(t, demand);
      } else {
        t.matchScore = null;
        t.matchCount = null;
      }
    }
  } else {
    for (const t of teachers) {
      t.matchScore = null;
      t.matchCount = null;
    }
  }

  const { sort, order, filters } = parseListParams(new URL(req.url));
  const filtered = applyFilters(teachers, filters);
  if (sort) filtered.sort(makeComparator(SORT_GETTERS[sort], order));

  // Never leak private contact/credential field names on the list (v2 list contract; the
  // mapper already empties them with { private:false } — strip the keys too).
  const items = filtered.map(({ wechat, email, real_name, credential_image, ...rest }) => rest);

  return json({ teachers: items, items, total: items.length });
}

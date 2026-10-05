/**
 * ..12 + Teacher plaza list: SQL sort/filter pushdown + match integration.
 *
 * shape: GET /api/teachers?sort=match|rating|exp|price&order=asc|desc
 * &filters={subjects[],gender,personalities[],priceMin,priceMax}
 * 200: { items:[...], total, teachers:[...] }
 *
 * - sort whitelist {match,rating,exp,price}; invalid/absent -> no sort (dbGetTeachers order kept)
 * - order {asc,desc}, default desc; null/undefined sort keys go LAST regardless of order
 * - filters accept BOTH the `filters` JSON query param and flat params
 * (subjects/personalities comma lists, gender, priceMin, priceMax), merged into one object
 * - subjects/gender/personalities/price filters and the price/rating/exp sorts
 * are pushed into dbGetTeachers (buildTeacherPublicQuery) and applied in SQL BEFORE the
 * PUBLIC_LIST_MAX LIMIT — so global sort/filter semantics survive a table > the cap.
 * - sort='match' stays in JS (needs the student's open demand + per-row match data); it
 * ranks the capped set — the most recent PUBLIC_LIST_MAX teachers that pass the filters.
 * - match (/ ): computed only for a logged-in student with an open demand
 * (the most recent one, fetched server-side). matchScore 0-100 weighted; matchCount =
 * screening dims hit (subject/gender/personality/price). Everyone else / no demand -> both null.
 * - response dual-key: legacy v2 consumers read `teachers`, the new frontend reads `items`;
 * both reference the same array; `total` is the post-cap (and post-filter) count.
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

/** only sort='match' remains in JS — price/rating/exp are pushed into the
 * dbGetTeachers SQL (buildTeacherPublicQuery). match needs the student's open demand +
 * per-row profile data, so it cannot be a SQL ORDER BY; it ranks the capped set here. */
const matchKey = t => t.matchScore ?? null;
const SORT_GETTERS = { match: matchKey };

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

/** GET /api/teachers —— plaza list (). Login-gated: interfaces.md requires an
 * authenticated user (no guest browsing, S6 ), consistent with the demand plaza ()
 * which is requireUser. Anonymous requests get a 401.
 *
 * filters (subjects/gender/personalities/price) and the SQL-expressible sorts
 * (price/rating/exp) are pushed into dbGetTeachers and applied BEFORE the PUBLIC_LIST_MAX
 * LIMIT — global sort/filter semantics survive a table larger than the cap. sort='match'
 * cannot be expressed in SQL (it needs the student's open demand + per-row match/profile
 * data); it is computed below over the capped set (the most recent PUBLIC_LIST_MAX
 * teachers that pass the filters) and ranked in JS (documented boundary: "最近 200 内按
 * 匹配度排名"). */
export async function handleGetTeachers(db, req) {
  const { user: me, err } = await requireUser(db, req);
  if (err) return err;
  const { sort, order, filters } = parseListParams(new URL(req.url));
  const sqlSort = sort === 'match' ? null : sort; // match 需需求+档案数据，非 SQL 可表达 → 留在 JS
  const teachers = await dbGetTeachers(db, { viewerId: me.id, filters, sort: sqlSort, order });

  // match fields only for a logged-in student with an open demand; otherwise both null.
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

  if (sort === 'match') teachers.sort(makeComparator(SORT_GETTERS.match, order));

  // Never leak private contact/credential field names on the list (v2 list contract; the
  // mapper already empties them with { private:false } — strip the keys too).
  const items = teachers.map(({ wechat, email, real_name, credential_image, ...rest }) => rest);

  return json({ teachers: items, items, total: items.length });
}

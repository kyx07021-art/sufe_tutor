/**
 * page-registry.js - module page registry
 * -------------------------------------------------------
 * - Collects every module's `pages.js` via Vite import.meta.glob (eager).
 * - Module export names are NOT uniform (shell `pages`, teacher-side
 *   `teacherSidePages`, notifications `M5_CAPABILITIES` object), so the
 *   collector is robust: any exported value that is an array whose every
 *   element is a page definition ({ path, name, component }) is treated as
 *   a page array and merged. `M5_CAPABILITIES` is an object (overlay entry
 *   points, not routes) and is ignored, as are single-object exports that
 *   are not router pages.
 * - Each page: { path, name, roles?, component, meta? }; `roles` present
 *   means the route is role-gated, absent means public.
 * - `pages` ordering follows module file order; TabBar relies on it.
 * - shell/pages.js is intentionally not imported here — the glob already
 *   collects this module's own pages.js (the module is its own registry).
 */
const mods = import.meta.glob('../*/pages.js', { eager: true })

function isPageDef(p) {
  return p && typeof p === 'object' && typeof p.path === 'string' && p.component && typeof p.name === 'string'
}

const collected = []
for (const m of Object.values(mods)) {
  for (const key of Object.keys(m)) {
    const val = m[key]
    if (Array.isArray(val) && val.every(isPageDef)) collected.push(...val)
  }
}

export const pages = collected

export function getPageByPath(path) {
  return pages.find((p) => p.path === path)
}

export function defaultPageForRole(role) {
  // AK-N-B1: the role's plaza page (meta.home) is the default — the logical
  // entry point (plaza -> own items -> chat -> relations), not the alphabetically
  // first tab. Falls back to the first tab page, then any gated page.
  const home = pages.find((p) => p.roles && p.roles.includes(role) && p.meta && p.meta.home === true)
  if (home) return home.path
  const a = pages.find((p) => p.roles && p.roles.includes(role) && p.meta && p.meta.tab !== false)
  if (a) return a.path
  const b = pages.find((p) => p.roles && p.roles.includes(role))
  return b ? b.path : null
}

export function pagesByRole(role) {
  return pages.filter((p) => p.roles && p.roles.includes(role))
}

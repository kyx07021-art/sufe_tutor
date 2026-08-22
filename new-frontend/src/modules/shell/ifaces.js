/**
 * ifaces.js - cross-module interface cap registry
 * -------------------------------------------------------
 * - The shell and the modules it hosts exchange UI entry points through a
 *   name -> function registry instead of direct imports, keeping modules
 *   decoupled and independently mountable/unmountable.
 * - M6 registers `openIdentityAuth` (identity/auth modal) and M5 registers
 *   `openC3` / `openC4` (C3 notification modal / C4 more dropdown) here when
 *   they land; M2 main.js wires them at boot.
 * - `registerIface(name, fn)` overwrites on re-register; `getIface(name)`
 *   returns undefined when the name is unknown (callers must guard).
 */
const ifaces = new Map()

export function registerIface(name, fn) {
  ifaces.set(name, fn)
}

export function getIface(name) {
  return ifaces.get(name)
}

/**
 * pages.js - M5 module capability/page registry
 * -------------------------------------------------------
 * - Consumed by M2 router registry (M2-08) and the shell. C3/C4 are overlay entry
 *   points (not routed tabs); settings is the C4.1 window. Listed here so the shell
 *   knows what M5 offers.
 */
export const M5_CAPABILITIES = {
  /** C3 notification modal - M2-05 envelope click -> openC3() */
  notifications: { entry: 'openC3', roles: ['student', 'teacher', 'admin'] },
  /** C4 more dropdown - M2-04 user-area hover -> openC4(triggerEl) */
  more: { entry: 'openC4', roles: ['student', 'teacher', 'admin'] },
  /** C4.1 settings window - C4 option -> openSettings() */
  settings: { entry: 'openSettings', roles: ['student', 'teacher', 'admin'] },
  /** C4.2 about window (M5-13 fills content) */
  about: { entry: 'openAbout', roles: ['student', 'teacher', 'admin'] },
  /** C4.3 feedback window (M5-14..16 fill content) */
  feedback: { entry: 'openFeedback', roles: ['student', 'teacher', 'admin'] },
}

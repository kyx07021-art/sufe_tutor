/**
 * test/harness-zoom-anchored.js - AK-N-H2 zoom anchoring harness (Vite dev entry)
 * -------------------------------------------------------
 * - Mounts two anchored panels that reproduce the reported UI-scale bug:
 *   1. A right-aligned dropdown pinned to the top-right corner (the "top-right
 *      focus dropdown runs off-screen" report). alignX=right + trigger near the
 *      right edge is the worst case: without the zoom normalization the fixed
 *      panel is double-scaled and overflows the viewport.
 *   2. A matchWidth dropdown (filter-style trigger) to lock the width
 *      normalization path.
 * - Also mounts the real SettingsAppearance (M5-10) so the verify script can
 *   click the actual scale control and prove the post-change re-place wiring
 *   (resize dispatch) is exercised end to end.
 * - Auth token is not required (no API calls in this harness).
 */
import { createApp } from 'vue'
import ZoomHarnessRoot from './ZoomHarnessRoot.vue'
import SettingsAppearance from '../src/modules/notifications/SettingsAppearance.vue'
import '../src/styles/tokens.css'
import '../src/styles/base.css'
import './harness-zoom-anchored.css'

createApp(ZoomHarnessRoot).mount('#app')

// real M5-10 settings section (scale buttons) mounted separately
createApp(SettingsAppearance).mount('#app-sa')

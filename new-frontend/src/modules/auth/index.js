/**
 * M6 C5 identity-auth module entry (M6-11)
 * -------------------------------------------------------
 * - Public API: openIdentityAuth({ scene, mode, contactMasks, onVerified }) /
 *   closeIdentityAuth() / isAuthOpen().
 * - Registers `openIdentityAuth` in the shell iface registry (M2-09 router guard
 *   and handle-dead-token consume it: `open({ mode: 'login' })`). Side effect at
 *   module load — the module is always loaded because App.vue mounts AuthHost.
 * - AuthHost (mounted at the app root) renders the modal from the reactive
 *   authOverlay; AuthPreview is the dev-only test surface served from
 *   /preview/auth.html.
 */
import { registerIface } from '@/modules/shell/ifaces.js'
import { openIdentityAuth, closeIdentityAuth, isAuthOpen, authOverlay } from './authState.js'

registerIface('openIdentityAuth', openIdentityAuth)

export { openIdentityAuth, closeIdentityAuth, isAuthOpen, authOverlay }
export { default as AuthHost } from './AuthHost.vue'
export { default as AuthPreview } from './AuthPreview.vue'

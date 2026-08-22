import { computed, ref, watch } from 'vue'
import { defaultMethod, availableMethods, otherMethods } from './authMethod.js'

/**
 * M6-3 useAuthMethod - reactive authentication method state machine (Vue).
 *
 * Wraps the pure authMethod helpers (CONTRACT.md §4) into a composable that
 * tracks the currently selected auth method, the credential input buffer, and a
 * monotonic reset tick. The tick is consumed by dependent rows (OtpRow /
 * PasswordRow) to clear stale error / countdown state whenever the selected
 * method or the underlying scene / contactMasks change.
 *
 * @param {import('vue').Ref<string>} scene current auth scene (login/register/verify)
 * @param {import('vue').Ref<object>} contactMasks boolean contact availability
 * @returns {{current: import('vue').Ref<string>, credential: import('vue').Ref<string>,
 *   resetTick: import('vue').Ref<number>, available: import('vue').ComputedRef<string[]>,
 *   others: import('vue').ComputedRef<string[]>, switchMethod: (to: string) => void}}
 */
export function useAuthMethod(scene, contactMasks) {
  const current = ref(defaultMethod(scene.value, contactMasks.value))
  const credential = ref('')
  const resetTick = ref(0)

  const available = computed(() => availableMethods(scene.value, contactMasks.value))
  const others = computed(() => otherMethods(scene.value, contactMasks.value, current.value))

  // Scene or contactMasks change -> recompute the default method, clear the
  // credential buffer, and bump the reset tick so dependent rows reset.
  watch(
    [scene, contactMasks],
    () => {
      current.value = defaultMethod(scene.value, contactMasks.value)
      credential.value = ''
      resetTick.value++
    },
    { deep: true },
  )

  /**
   * Switch the active method. No-op when the target is invalid for the current
   * scene or is already active; otherwise reset the credential buffer and tick.
   * @param {string} to target method
   */
  function switchMethod(to) {
    if (to === current.value || !available.value.includes(to)) return
    current.value = to
    credential.value = ''
    resetTick.value++
  }

  return { current, credential, resetTick, available, others, switchMethod }
}

/**
 * entry-reveal.js - B1-2b demand grid entry animation (thin wiring)
 * -------------------------------------------------------
 * - useEntryReveal() gives the plaza a key that can be bumped to replay the
 *   grid's entry animation: the page binds :key="animateKey" on the grid
 *   container, so Vue remounts it (restarting the CSS entry keyframes) whenever
 *   replay() is called (e.g. after a filter/sort change).
 * - Pure state holder: no DOM access, the CSS entry animation lives in the grid
 *   component's stylesheet.
 */
import { ref } from 'vue'

/**
 * @returns {{ animateKey: import('vue').Ref<number>, replay: () => void }}
 */
export function useEntryReveal() {
  const animateKey = ref(0)
  function replay() {
    animateKey.value += 1
  }
  return { animateKey, replay }
}

/**
 * test/harness-ime-guard.js - UiInput IME composition guard harness (PA-2-F5)
 * -----------------------------------------------------------------------------
 * Mounts a single sendOnEnter UiInput + a send counter so a Playwright test can
 * dispatch compositionstart -> Enter -> compositionend and assert no 'send' fires
 * mid-composition (Enter confirms the pinyin candidate, never "send").
 * Uses a render function (runtime-only Vue has no template compiler).
 * Exposes window.__sendCount() and window.__imeTa().
 */
import { createApp, ref, h } from 'vue'
import UiInput from '../src/components/ui/UiInput.vue'
import '../src/styles/tokens.css'
import '../src/styles/base.css'

const sends = ref(0)
window.__sendCount = () => sends.value

createApp({
  setup() {
    const draft = ref('')
    return () =>
      h('div', { style: 'padding:24px' }, [
        h(UiInput, {
          modelValue: draft.value,
          'onUpdate:modelValue': (v) => { draft.value = v },
          sendOnEnter: true,
          placeholder: 'ime input',
          onSend: () => { sends.value += 1 },
        }),
        h('div', { id: 'send-count' }, String(sends.value)),
      ])
  },
}).mount('#app')

window.__imeTa = () => document.querySelector('.ui-input__ta')

/**
 * M0 component base layer unified export
 * -------------------------------------------------------
 * - Modules (M1-M9) import base components from here only; deep path imports are forbidden (W6 reuse).
 * - Adding a base component: write the file -> add one export line here -> modules can use it.
 */
export { default as UiButton } from './UiButton.vue'
export { default as UiCard } from './UiCard.vue'
export { default as UiIcon } from './UiIcon.vue'
export { iconRegistry } from './icons.js'
export { default as UiDropdown } from './UiDropdown.vue'
export { default as UiDropdownPanel } from './UiDropdownPanel.vue'
export { default as UiCheckButton } from './UiCheckButton.vue'
export { default as UiInput } from './UiInput.vue'
export { default as UiCaptchaInput } from './UiCaptchaInput.vue'
export { default as UiComboInput } from './UiComboInput.vue'
export { default as UiVariableInputSet } from './UiVariableInputSet.vue'
export { default as UiFieldInput } from './UiFieldInput.vue'
export { default as UiFieldDisplay } from './UiFieldDisplay.vue'
export { default as UiModal } from './UiModal.vue'
export { default as UiModalA1 } from './UiModalA1.vue'
export { default as UiConfirmModalA1 } from './UiConfirmModalA1.vue'
export { default as UiStepModal } from './UiStepModal.vue'
export { default as UiAlertModal } from './UiAlertModal.vue'
export { default as UiText } from './UiText.vue'
export { default as UiToast } from './UiToast.vue'

export { vRipple } from '@/directives/ripple.js'

import { inject } from 'vue'

/**
 * useFieldContext - info input area context (optional injection)
 * -------------------------------------------------------
 * - UiFieldInput provides this module's two keys:
 *   1) FIELD_CTX_KEY: markTouched() - input components call it on focus/interaction; the optional yellow star disappears.
 *   2) FIELD_FILL_KEY: default fill 'gray-10' - input components resolve fill='auto' to this value.
 * - When the component is outside an info input area, inject returns null/empty with zero side effects.
 */
export const FIELD_CTX_KEY = Symbol('ui-field-input-context')
export const FIELD_FILL_KEY = Symbol('ui-field-default-fill')

export function injectFieldContext() {
  return inject(FIELD_CTX_KEY, null)
}

/** info input area default fill ('gray-10' or null) */
export function injectFieldFill() {
  return inject(FIELD_FILL_KEY, null)
}

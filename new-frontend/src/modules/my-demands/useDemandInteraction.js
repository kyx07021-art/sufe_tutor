/**
 * useDemandInteraction - Card interaction wiring (M8-05, role dispatch)
 * -------------------------------------------------------
 * - Student "My Demands" card click -> onOpenEdit(demand) (open edit modal, M8-06/13).
 * - Teacher demand square (M9 B1) card click -> no-op here; M9 wires the
 *   conversation itself via mode="teacher" + @select (M9-B1-7).
 * - Plus slot click -> onOpenCreate() (open create modal).
 * - Pure logic composable: no DOM, no template. Contract 6 zero Chinese.
 */

export function useDemandInteraction({ mode = 'student', onOpenEdit, onOpenCreate } = {}) {
  const isStudent = mode === 'student'

  function handleCardSelect(demand) {
    if (isStudent) {
      if (typeof onOpenEdit === 'function') onOpenEdit(demand)
      return
    }
    // teacher mode: no-op here; M9 wires the conversation via mode="teacher" + @select.
  }

  function handlePlusCreate() {
    if (typeof onOpenCreate === 'function') onOpenCreate()
  }

  return { handleCardSelect, handlePlusCreate }
}

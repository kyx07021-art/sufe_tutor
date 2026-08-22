<script setup>
import { onMounted, ref } from 'vue'
import DemandGrid from './DemandGrid.vue'
import DemandCard from './DemandCard.vue'
import DemandPlusSlot from './DemandPlusSlot.vue'
import DemandEditorModal from './DemandEditorModal.vue'
import { useDemands } from './useDemands.js'
import { useDemandInteraction } from './useDemandInteraction.js'
import { MY_DEMANDS_COPY } from '@/constants/m-my-demands.js'

/**
 * MyDemandsPage - A2 my-demands page (M8 assembly)
 * -------------------------------------------------------
 * - Grid (M8-01) + I-33 data (M8-02) + DemandCard domain renderer (M8-04, student mode).
 * - Plus slot (M8-03) occupies the next empty grid cell; click opens the create wizard.
 * - Card click (M8-05 student split) opens the edit wizard; the wizard owns prefill (M8-13),
 *   submit (M8-12) and delete (M8-14). Success -> invalidate + reload (F7).
 */
const { demands, loading, error, load, invalidate } = useDemands()
const editorRef = ref(null)

const { handleCardSelect, handlePlusCreate } = useDemandInteraction({
  mode: 'student',
  onOpenEdit: (demand) => editorRef.value && editorRef.value.openEdit(demand),
  onOpenCreate: () => editorRef.value && editorRef.value.openCreate(),
})

function onDemandDone() {
  invalidate() // F7: next read refetches
  load()
}

onMounted(() => {
  load()
})

defineExpose({ load, demands, invalidate })
</script>

<template>
  <main class="my-demands">
    <div v-if="loading" class="my-demands__status">{{ MY_DEMANDS_COPY.LOADING }}</div>
    <div v-else-if="error" class="my-demands__status my-demands__status--error" role="alert">{{ error }}</div>
    <DemandGrid v-else>
      <DemandCard
        v-for="d in demands"
        :key="d.id"
        :demand="d"
        mode="student"
        @select="handleCardSelect(d)"
      />
      <DemandPlusSlot @create="handlePlusCreate" />
    </DemandGrid>

    <DemandEditorModal ref="editorRef" @done="onDemandDone" />
  </main>
</template>

<style scoped>
.my-demands {
  background: var(--paper);
  color: var(--ink);
  min-height: 100vh;
  padding-top: var(--space-6);
  padding-bottom: var(--space-8);
}

.my-demands__status {
  padding: var(--space-6) 5%;
  color: var(--gray-60);
}
.my-demands__status--error {
  color: var(--danger);
}
</style>

<script setup>
import { nextTick, ref, watch } from 'vue'
import { NavTab, UiModalA1 } from '@/components/ui/index.js'
import { NOTIF_COPY } from '@/constants/m-notifications'
import { loadSettings } from './settings-data.js'
import SettingsUsername from './SettingsUsername.vue'
import SettingsAvatar from './SettingsAvatar.vue'
import SettingsContact from './SettingsContact.vue'
import SettingsAppearance from './SettingsAppearance.vue'
import SettingsDevices from './SettingsDevices.vue'
import SettingsDeactivate from './SettingsDeactivate.vue'

/**
 * SettingsPanel - M5-07 settings window assembly (M5-08..12 rows wired)
 * -------------------------------------------------------
 * - Modal A1 titled "settings". Two white columns with a center divider line between them
 *   (plan :559); the left column is the section switcher (small rounded button B,
 *   selected = gray-10), the right column is a continuous scrolling body.
 * - Two-way sync: left click scrolls the right column to the section; scrolling the
 *   right column highlights the matching left item (scroll-spy).
 * - No dividers between setting items (plan :559 - flat continuous design language).
 * - Section bodies are the M5-09a..12 row components (sub-agent outputs) assembled
 *   here; settings data loads on open (M5-08).
 */
const props = defineProps({
  open: { type: Boolean, default: false },
})
const emit = defineEmits(['close'])

const sections = [
  { id: 'account', label: NOTIF_COPY.SETTINGS_ACCOUNT },
  { id: 'appearance', label: NOTIF_COPY.SETTINGS_APPEARANCE },
  { id: 'devices', label: NOTIF_COPY.SETTINGS_DEVICES },
  { id: 'deactivate', label: NOTIF_COPY.SETTINGS_DEACTIVATE },
]

const active = ref(0)
const scrollRef = ref(null)
const sectionRefs = ref([])

function onScroll() {
  const sc = scrollRef.value
  if (!sc) return
  const top = sc.scrollTop
  let idx = 0
  for (let i = 0; i < sectionRefs.value.length; i++) {
    const el = sectionRefs.value[i]
    if (el && top + 2 >= el.offsetTop) idx = i
  }
  // clamp to the last section when scrolled to the bottom
  if (sc.scrollTop + sc.clientHeight >= sc.scrollHeight - 2) {
    idx = sectionRefs.value.length - 1
  }
  if (idx !== active.value) active.value = idx
}

function goTo(index) {
  const sc = scrollRef.value
  const el = sectionRefs.value[index]
  if (!sc || !el) return
  const reduced = typeof window.matchMedia === 'function' && window.matchMedia('(prefers-reduced-motion: reduce)').matches
  sc.scrollTo({ top: el.offsetTop, behavior: reduced ? 'auto' : 'smooth' })
  active.value = index
}

watch(
  () => props.open,
  async (val) => {
    if (val) {
      active.value = 0
      loadSettings() // M5-08: populate the settings state on open
      await nextTick()
      const sc = scrollRef.value
      if (sc) sc.scrollTop = 0
    }
  },
)
</script>

<template>
  <UiModalA1
    :open="open"
    :title="NOTIF_COPY.SETTINGS_TITLE"
    width="720px"
    :close-on-outside="true"
    :close-on-esc="true"
    @close="emit('close')"
  >
    <div class="st-settings">
      <NavTab
        :items="sections"
        :model-value="active"
        aria-label="settings"
        @select="goTo"
      />
      <div class="st-divider" aria-hidden="true"></div>
      <div ref="scrollRef" class="st-scroll" @scroll.passive="onScroll">
        <section
          v-for="(s, i) in sections"
          :key="s.id"
          :ref="(el) => { sectionRefs[i] = el }"
          class="st-section"
          :aria-labelledby="'st-sec-' + s.id"
        >
          <h3 :id="'st-sec-' + s.id" class="st-section__title">{{ s.label }}</h3>
          <div class="st-section__body">
            <!-- account section: username / avatar / contact rows (no dividers) -->
            <template v-if="s.id === 'account'">
              <SettingsUsername />
              <SettingsAvatar />
              <SettingsContact />
            </template>
            <!-- appearance section: theme + ui scale rows -->
            <SettingsAppearance v-else-if="s.id === 'appearance'" />
            <!-- devices section -->
            <SettingsDevices v-else-if="s.id === 'devices'" />
            <!-- deactivate section -->
            <SettingsDeactivate v-else-if="s.id === 'deactivate'" />
          </div>
        </section>
      </div>
    </div>
  </UiModalA1>
</template>

<style scoped>
.st-settings {
  display: flex;
  height: min(520px, 62vh);
  box-sizing: border-box;
}
/* center divider line between the two columns */
.st-divider {
  flex: none;
  width: 1px;
  background: var(--divider);
}
.st-scroll {
  position: relative;
  flex: 1;
  min-width: 0;
  overflow-y: auto;
  overscroll-behavior: contain;
  padding: var(--space-5) var(--space-5) var(--space-7);
}
.st-section {
  min-height: 320px;
}
/* AK-N-G1: three-tier gap rhythm - sections (large blocks) separated by
   --space-5 (24px), NOT --space-6 (40px). Field groups inside a section stay
   at --space-4 (group tier); the whole right column reads as one continuous
   panel instead of separate pasted blocks. */
.st-section + .st-section {
  margin-top: var(--space-5);
}
.st-section__title {
  font-size: var(--fs-lg);
  font-weight: 600;
  color: var(--ink);
  margin-bottom: var(--space-4);
}
/* setting items stack with spacing only - no dividers between them */
.st-section__body {
  display: flex;
  flex-direction: column;
  gap: var(--space-4);
}
</style>

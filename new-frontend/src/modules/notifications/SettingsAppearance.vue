<script setup>
import { ref } from 'vue'
import { UiButton, UiDropdown } from '@/components/ui/index.js'
import { showToast } from '@/composables/useToast'
import { NOTIF_COPY } from '@/constants/m-notifications'

/**
 * SettingsAppearance - M5-10 settings appearance section (theme + UI scale)
 * -------------------------------------------------------
 * - Row 1 "theme": UiDropdown (variant B) offering the three NOTIF_COPY
 *   SETTINGS_THEME_LIGHT / SETTINGS_THEME_DARK / SETTINGS_THEME_SYSTEM options.
 *   Selecting applies the palette locally by toggling
 *   `document.documentElement.dataset.theme` (JS only touches the attribute;
 *   tokens.css `html[data-theme="dark"]` flips the dark palette, zero component
 *   CSS needed for the switch).
 * - Row 2 "ui scale": three UiButton (variant B, size sm) options
 *   SETTINGS_SCALE_SMALL / SETTINGS_SCALE_MEDIUM / SETTINGS_SCALE_LARGE.
 *   Selecting applies a local `--ui-scale` factor on the document root via CSSOM
 *   setProperty (the style-src-attr 'none' data channel; `--ui-scale` only).
 * - Theme is still CAP (m5-10-theme): the settings schema does not define
 *   `theme` yet, so server persist is intentionally NOT wired (settings-data
 *   updateSettings is the agreed I-09 path and will replace the CAP toast once
 *   the schema lands). The dropdown works locally (data-theme flips the dark
 *   palette); each selection shows CAP_TOAST to keep the cap honest.
 * - UI scale is genuinely live (user⑯): `--ui-scale` is consumed by base.css
 *   `html { zoom: var(--ui-scale, 1) }`, so the whole UI reflows immediately on
 *   selection. Server persist of the scale is deferred to the same I-09 path,
 *   but the control is honest - no "development" placeholder toast, the zoom
 *   simply applies (cap marker removed).
 * - PROPS: none. EMITS: none. Self-contained: reads the live document state on
 *   setup so the controls reflect the current palette / scale.
 * - Contract 6: zero raw CJK (copy via NOTIF_COPY), zero inline style attributes
 *   in the template, zero v-html; comments are English.
 */

const SCALE_FACTORS = { small: 0.9, medium: 1, large: 1.1 }

const THEME_OPTIONS = [
  { label: NOTIF_COPY.SETTINGS_THEME_LIGHT, value: 'light' },
  { label: NOTIF_COPY.SETTINGS_THEME_DARK, value: 'dark' },
  { label: NOTIF_COPY.SETTINGS_THEME_SYSTEM, value: 'system' },
]

const SCALE_OPTIONS = [
  { label: NOTIF_COPY.SETTINGS_SCALE_SMALL, value: 'small' },
  { label: NOTIF_COPY.SETTINGS_SCALE_MEDIUM, value: 'medium' },
  { label: NOTIF_COPY.SETTINGS_SCALE_LARGE, value: 'large' },
]

function currentTheme() {
  const v = document.documentElement.dataset.theme
  return v === 'dark' || v === 'light' ? v : 'system'
}

function currentScale() {
  const v = getComputedStyle(document.documentElement).getPropertyValue('--ui-scale').trim()
  return Object.keys(SCALE_FACTORS).find((k) => SCALE_FACTORS[k] === Number(v)) || 'medium'
}

const theme = ref(currentTheme())
const scale = ref(currentScale())

function selectTheme(value) {
  theme.value = value
  const attr = value === 'dark' ? 'dark' : value === 'light' ? 'light' : ''
  document.documentElement.dataset.theme = attr
  // CAP m5-10-theme: settings schema has no `theme` field yet. The dropdown
  // applies the palette locally; persist is intentionally not wired. Swap this
  // toast for settings-data.updateSettings({ theme: value }) when the schema lands.
  showToast(NOTIF_COPY.CAP_TOAST)
}

function selectScale(value) {
  scale.value = value
  document.documentElement.style.setProperty('--ui-scale', String(SCALE_FACTORS[value]))
  // Re-place any anchored panel that is currently open: useAnchoredPanel binds a window
  // resize listener for the whole time a panel is open, so a synthetic resize re-runs its
  // place() against the new zoom (AK-N-H2). No new global listener is added (F3).
  window.dispatchEvent(new Event('resize'))
  // Genuinely live (user⑯): base.css `html { zoom: var(--ui-scale, 1) }` reflows the
  // whole UI immediately, so the selected factor is real. Server persist of the scale
  // is deferred to the I-09 settings path; the control is honest about applying the
  // zoom now, no "development" placeholder toast.
}
</script>

<template>
  <div class="sa-appearance">
    <div class="sa-row">
      <span class="sa-label" id="sa-theme-label">{{ NOTIF_COPY.SETTINGS_THEME }}</span>
      <div class="sa-control" data-cap="m5-10-theme">
        <UiDropdown
          variant="B"
          :model-value="theme"
          :options="THEME_OPTIONS"
          width="160px"
          aria-labelledby="sa-theme-label"
          @select="selectTheme"
        />
      </div>
    </div>

    <div class="sa-row">
      <span class="sa-label" id="sa-scale-label">{{ NOTIF_COPY.SETTINGS_UI_SCALE }}</span>
      <div
        class="sa-control sa-scale-group"
        role="group"
        aria-labelledby="sa-scale-label"
      >
        <UiButton
          v-for="opt in SCALE_OPTIONS"
          :key="opt.value"
          variant="B"
          size="sm"
          class="sa-scale-btn"
          :class="{ 'is-active': scale === opt.value }"
          :aria-pressed="scale === opt.value"
          @click="selectScale(opt.value)"
        >
          {{ opt.label }}
        </UiButton>
      </div>
    </div>
  </div>
</template>

<style scoped>
.sa-appearance {
  display: flex;
  flex-direction: column;
  gap: var(--space-4);
}
.sa-row {
  display: flex;
  align-items: center;
  gap: var(--space-4);
}
.sa-label {
  flex: 0 0 var(--space-8);
  font-size: var(--fs-base);
  line-height: 1.3;
  color: var(--ink);
}
.sa-control {
  display: flex;
  align-items: center;
}
.sa-scale-group {
  gap: var(--space-2);
}
/* Narrow the B scale buttons (3 across) below the UiButton default width.
   The .sa-appearance ancestor raises specificity over UiButton's scoped .ui-btn. */
.sa-appearance .sa-scale-btn {
  --btn-w: 72px;
}
/* selected scale option: gray-10 fill (matches the settings-nav selected state) */
.sa-appearance .sa-scale-btn.is-active {
  background: var(--gray-10);
}
</style>

<script setup>
import { computed, ref } from 'vue'
import { UiButton, UiIcon } from '@/components/ui/index.js'
import { showToast } from '@/composables/useToast'
import { NOTIF_COPY } from '@/constants/m-notifications'
import { cropAvatar } from '@/components/shared/useAvatarCrop.js'
import { settingsState, updateSettings } from './settings-data.js'

/**
 * SettingsAvatar - M5-09b avatar row (settings account section)
 * -------------------------------------------------------
 * - Row: label on the left; right side = a 48px circular avatar (centered
 *   maximum-circle crop of the committed or staged image, otherwise the M0 user
 *   icon) + a "change" trigger + a "save" confirm button that appears only while
 *   a new image is staged.
 * - The change trigger is a <label for> over the hidden file input (label-for
 *   mechanism; no programmatic .click()).
 * - A1 FIELD TRANSFORM CONSISTENCY: the avatar write path MUST use the SAME crop
 *   pipeline as M9's AvatarEditor — magic-bytes jpeg/png/webp type check + the
 *   shared cropAvatar(file, { size: 512 }) (useAvatarCrop, M0 thaw). The payload
 *   sent to I-09/I-11 { avatar } is always the 512x512 center-cropped square
 *   dataURL, never the raw uploaded image. Two write paths on the same `avatar`
 *   field with different transforms would violate A1 (layered data corruption).
 * - Save -> updateSettings({ avatar: 512sqDataUrl }) (I-09 accepts { avatar: dataURL }).
 *   On success show SETTINGS_SAVED; on failure revert the preview to the previous avatar.
 * - F6: saving lock guards the submit against double-trigger. F7: the circle reads
 *   module state, so a committed avatar reflects immediately.
 * - Copy single source = NOTIF_COPY (contract 6).
 */
const FILE_INPUT_ID = 'avatar-file'
const AVATAR_SIZE = 512 // shared crop output size (matches M9)

/** dataURL of a newly picked + cropped file (staged, not yet saved). '' = nothing staged. */
const preview = ref('')
/** dataURL of the last successfully saved avatar (local F7 safety net). */
const committed = ref('')
const saving = ref(false)
const typeError = ref('')

/** A staged image exists -> show the confirm button. */
const dirty = computed(() => !!preview.value)

/** Image shown in the circle: staged preview > last saved > module committed avatar. */
const displaySrc = computed(
  () => preview.value || committed.value || (settingsState.user && settingsState.user.avatar) || '',
)

function readHead(file, n) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader()
    reader.onload = () => resolve(new Uint8Array(reader.result))
    reader.onerror = () => reject(reader.error)
    reader.readAsArrayBuffer(file.slice(0, n))
  })
}

/** Bitmap whitelist (jpeg / png / webp) — same magic-byte check as M9 AvatarEditor. */
function isAllowedImage(head) {
  if (head[0] === 0xff && head[1] === 0xd8 && head[2] === 0xff) return true
  if (head[0] === 0x89 && head[1] === 0x50 && head[2] === 0x4e && head[3] === 0x47) return true
  if (
    head[0] === 0x52 &&
    head[1] === 0x49 &&
    head[2] === 0x46 &&
    head[3] === 0x46 &&
    head[8] === 0x57 &&
    head[9] === 0x45 &&
    head[10] === 0x42 &&
    head[11] === 0x50
  ) {
    return true
  }
  return false
}

async function onFileChange(e) {
  const input = e.target
  if (saving.value) {
    input.value = ''
    return
  }
  typeError.value = ''
  // input.files is a live reference: spread-copy before any async read.
  const files = input.files ? Array.from(input.files) : []
  const file = files[0]
  if (!file) return
  try {
    const head = await readHead(file, 12)
    if (!isAllowedImage(head)) {
      typeError.value = NOTIF_COPY.SETTINGS_AVATAR_TYPE_ERR
      return
    }
    // A1: the shared crop pipeline (same as M9) — the staged + saved payload is the
    // 512x512 center-cropped square, never the raw file.
    const { dataUrl } = await cropAvatar(file, { size: AVATAR_SIZE })
    preview.value = dataUrl
  } catch (err) {
    // Reading/cropping failed (rare): keep the committed avatar and expose the gap (E1).
    preview.value = ''
    console.warn('[SettingsAvatar] failed to process the selected image', err)
  } finally {
    // allow selecting the same file again next time
    input.value = ''
  }
}

async function onSave() {
  if (saving.value || !preview.value) return
  saving.value = true
  try {
    await updateSettings({ avatar: preview.value })
    committed.value = preview.value
    preview.value = ''
    showToast(NOTIF_COPY.SETTINGS_SAVED)
  } catch (err) {
    // Revert the staged preview so the committed avatar is restored (F7).
    preview.value = ''
    if (err && err.message) showToast(err.message)
  } finally {
    saving.value = false
  }
}
</script>

<template>
  <div class="sv-avatar">
    <span class="sv-avatar__label">{{ NOTIF_COPY.SETTINGS_AVATAR }}</span>
    <div class="sv-avatar__control">
      <span
        class="sv-avatar__circle"
        role="img"
        :aria-label="NOTIF_COPY.SETTINGS_AVATAR"
      >
        <img v-if="displaySrc" class="sv-avatar__img" :src="displaySrc" alt="" />
        <UiIcon v-else name="user" :size="24" aria-hidden="true" />
      </span>
      <label :for="FILE_INPUT_ID" class="sv-avatar__change">
        <span>{{ NOTIF_COPY.SETTINGS_AVATAR_CHANGE }}</span>
      </label>
      <UiButton
        v-if="dirty"
        variant="A"
        size="sm"
        class="sv-avatar__save"
        :disabled="saving"
        @click="onSave"
      >
        {{ NOTIF_COPY.SETTINGS_SAVE }}
      </UiButton>
    </div>
    <p v-if="typeError" class="sv-avatar__error" role="alert">{{ typeError }}</p>
    <input
      :id="FILE_INPUT_ID"
      class="sv-avatar__file"
      type="file"
      accept="image/jpeg,image/png,image/webp"
      @change="onFileChange"
    />
  </div>
</template>

<style scoped>
/* Row: label left, control group right; spacing only, no dividers (plan :559). */
.sv-avatar {
  display: flex;
  align-items: center;
  flex-wrap: wrap;
  gap: var(--space-4);
  box-sizing: border-box;
  min-width: 0;
}
.sv-avatar__label {
  flex: none;
  color: var(--ink);
  font-size: var(--fs-base);
  line-height: 1.3;
}
.sv-avatar__control {
  display: flex;
  align-items: center;
  gap: var(--space-3);
  min-width: 0;
}
/* 48px centered maximum-circle crop: the img covers the circle and centers. */
.sv-avatar__circle {
  position: relative;
  flex: none;
  width: 48px;
  height: 48px;
  border-radius: 50%;
  overflow: hidden;
  display: inline-flex;
  align-items: center;
  justify-content: center;
  background: var(--gray-10);
  color: var(--gray-60);
}
.sv-avatar__img {
  width: 100%;
  height: 100%;
  object-fit: cover;
  object-position: center;
}
/* change trigger: label styled as button B (no fill, no border, black text). */
.sv-avatar__change {
  color: var(--ink);
  font-size: var(--fs-base);
  line-height: 1;
  cursor: pointer;
  user-select: none;
  -webkit-tap-highlight-color: transparent;
  transition: color var(--dur-sm) var(--ease-out);
}
.sv-avatar__change:hover {
  color: var(--gray-60);
}
.sv-avatar__error {
  flex-basis: 100%;
  margin: 0;
  font-size: var(--fs-sm);
  color: var(--danger);
}
/* visually-hidden file input (label-for opens the picker; no programmatic .click()). */
.sv-avatar__file {
  position: absolute;
  width: 1px;
  height: 1px;
  padding: 0;
  margin: -1px;
  overflow: hidden;
  clip: rect(0 0 0 0);
  border: 0;
  opacity: 0;
}
</style>

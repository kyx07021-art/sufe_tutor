<script setup>
/**
 * AvatarEditor - B2-6 default avatar + upload center-crop max circle
 * -------------------------------------------------------------------
 * - Default avatar: gray-20 filled circle + gray-10 SVG plus. Focus/hover brightening.
 * - Click -> confirm modal (copy key B2_AVATAR_CONFIRM); the confirm action is a
 *   <label for> that opens the file picker (label-for mechanism, no programmatic
 *   .click()).
 * - Selected file -> magic-bytes type check (jpeg/png/webp) -> cropAvatar (shared
 *   useAvatarCrop, center-crop max circle) -> saveAvatar (I-11) -> emit avatar-updated.
 * - Busy lock (F6); input value reset after handling so the same file can be re-picked.
 */
import { ref, watch } from 'vue'
import { TEACHER_COPY } from '@/constants/ui.js'
import { UiButton, UiModalA1 } from '@/components/ui/index.js'
import Plus from '@/assets/svg/plus.svg'
import { cropAvatar } from '@/components/shared/useAvatarCrop.js'
import { saveAvatar } from './profile-service.js'

const props = defineProps({
  src: { type: String, default: '' },
})
const emit = defineEmits(['avatar-updated'])

const FILE_INPUT_ID = 'avatar-file-input'

const modalOpen = ref(false)
const busy = ref(false)
const error = ref('')
const preview = ref(props.src || '')

// follow external src changes (e.g. read-back refresh after save)
watch(
  () => props.src,
  (v) => {
    if (v) preview.value = v
  },
)

function onAvatarClick() {
  if (busy.value) return
  error.value = ''
  modalOpen.value = true
}

function closeModal() {
  modalOpen.value = false
  error.value = ''
}

function readHead(file, n) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader()
    reader.onload = () => resolve(new Uint8Array(reader.result))
    reader.onerror = () => reject(reader.error)
    reader.readAsArrayBuffer(file.slice(0, n))
  })
}

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
  if (busy.value) {
    input.value = ''
    return
  }
  error.value = ''
  const files = input.files ? Array.from(input.files) : []
  const file = files[0]
  if (!file) return
  try {
    const head = await readHead(file, 12)
    if (!isAllowedImage(head)) {
      error.value = TEACHER_COPY.B2_AVATAR_TYPE_ERR
      return
    }
    busy.value = true
    const { dataUrl } = await cropAvatar(file, { size: 512 })
    preview.value = dataUrl
    await saveAvatar(dataUrl)
    emit('avatar-updated', dataUrl)
    modalOpen.value = false
  } catch (err) {
    error.value = (err && err.message) || TEACHER_COPY.B1_ERROR
  } finally {
    busy.value = false
    input.value = ''
  }
}
</script>

<template>
  <div class="avatar-editor">
    <button
      type="button"
      class="avatar-editor__circle"
      :class="{ 'has-image': !!preview }"
      :aria-label="TEACHER_COPY.B2_AVATAR_UPLOAD"
      @click="onAvatarClick"
    >
      <img v-if="preview" class="avatar-editor__img" :src="preview" alt="" />
      <Plus v-else class="avatar-editor__plus" aria-hidden="true" />
    </button>

    <UiModalA1
      :open="modalOpen"
      :title="TEACHER_COPY.B2_AVATAR_UPLOAD"
      @close="closeModal"
      @update:open="(v) => !v && closeModal()"
    >
      <p class="avatar-editor__confirm">{{ TEACHER_COPY.B2_AVATAR_CONFIRM }}</p>
      <p v-if="error" class="avatar-editor__error">{{ error }}</p>
      <div class="avatar-editor__actions">
        <UiButton variant="A" @click="closeModal">{{ TEACHER_COPY.ALERT_CANCEL }}</UiButton>
        <label class="avatar-editor__choose" :for="FILE_INPUT_ID">
          <span>{{ TEACHER_COPY.B2_AVATAR_UPLOAD }}</span>
        </label>
      </div>
    </UiModalA1>

    <input
      :id="FILE_INPUT_ID"
      class="avatar-editor__file"
      type="file"
      accept="image/jpeg,image/png,image/webp"
      @change="onFileChange"
    />
  </div>
</template>

<style scoped>
.avatar-editor {
  display: inline-block;
}
.avatar-editor__circle {
  position: relative;
  box-sizing: border-box;
  width: 96px;
  height: 96px;
  border: var(--border-w) solid transparent;
  border-radius: 50%;
  background: var(--gray-20);
  color: var(--gray-10);
  display: inline-flex;
  align-items: center;
  justify-content: center;
  overflow: hidden;
  cursor: pointer;
  transition:
    border-color var(--dur-sm) var(--ease-out),
    box-shadow var(--dur-sm) var(--ease-out),
    background var(--dur-sm) var(--ease-out);
}
.avatar-editor__circle:hover,
.avatar-editor__circle:focus-visible {
  border-color: var(--gray-50);
  box-shadow: 0 0 0 2px var(--brand);
}
.avatar-editor__plus {
  width: 40%;
  height: 40%;
  color: var(--gray-10);
}
.avatar-editor__img {
  width: 100%;
  height: 100%;
  object-fit: cover;
  border-radius: 50%;
}
.avatar-editor__confirm {
  color: var(--ink);
  line-height: var(--lh-body);
}
.avatar-editor__error {
  font-size: var(--fs-sm);
  color: var(--danger);
  line-height: var(--lh-body);
}
/* Actions stack vertically so the 220px buttons never overflow a narrow modal (375 G5). */
.avatar-editor__actions {
  display: flex;
  flex-direction: column;
  gap: var(--space-3);
  margin-top: var(--space-4);
}
.avatar-editor__actions :deep(.ui-btn) {
  width: 100%;
}
/* label styled as button A (opens the file picker; no programmatic .click()) */
.avatar-editor__choose {
  box-sizing: border-box;
  display: inline-flex;
  align-items: center;
  justify-content: center;
  width: 100%;
  height: 52px;
  padding: 0 26px;
  border: var(--border-w) solid var(--ink);
  border-radius: 26px;
  background: var(--paper);
  color: var(--ink);
  font-size: var(--fs-base);
  cursor: pointer;
  user-select: none;
}
.avatar-editor__choose:hover {
  background: var(--gray-10);
}
/* visually-hidden file input (label opens the picker) */
.avatar-editor__file {
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
@media (prefers-reduced-motion: reduce) {
  .avatar-editor__circle {
    transition: none;
  }
}
</style>

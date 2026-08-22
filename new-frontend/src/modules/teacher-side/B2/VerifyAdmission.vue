<script setup>
/**
 * VerifyAdmission - B2-2b admission notice image upload channel (I-42)
 * --------------------------------------------------------------------
 * - Entry is an underlined small gray text (B2_ADMISSION_ALT) realized as a
 *   <label> wrapping a hidden <input type="file"> (label-for mechanism; no
 *   programmatic .click()).
 * - Accept image/jpeg,image/png,image/webp. After selection the first 12 bytes are
 *   read to validate magic bytes (JPEG FF D8 FF / PNG 89 50 4E 47 / WebP "RIFF".."WEBP");
 *   a mismatch shows B2_ADMISSION_TYPE_ERR and sends no request.
 * - Valid image -> readAsDataURL -> submitAdmission -> emit `submitted`.
 * - Busy lock (F6 in-flight guard); input value is reset after handling so the same
 *   file can be re-selected.
 * - Zero inline style/event attributes; copy from TEACHER_COPY single source.
 */
import { ref } from 'vue'
import { TEACHER_COPY } from '@/constants/ui.js'
import { submitAdmission } from './verify-service.js'

const emit = defineEmits(['submitted'])

const busy = ref(false)
const error = ref('')
const fileName = ref('')

/** Promise wrapper for FileReader.readAsArrayBuffer on a blob slice (head bytes only). */
function readHead(file, n) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader()
    reader.onload = () => resolve(new Uint8Array(reader.result))
    reader.onerror = () => reject(reader.error)
    reader.readAsArrayBuffer(file.slice(0, n))
  })
}

/** Promise wrapper for FileReader.readAsDataURL (full file). */
function readDataUrl(file) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader()
    reader.onload = () => resolve(reader.result)
    reader.onerror = () => reject(reader.error)
    reader.readAsDataURL(file)
  })
}

/** JPEG FF D8 FF / PNG 89 50 4E 47 / WebP "RIFF" bytes 0-3 + "WEBP" bytes 8-11. */
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
  fileName.value = ''
  // input.files is a live reference: spread-copy before any async read.
  const files = input.files ? Array.from(input.files) : []
  const file = files[0]
  if (!file) return
  try {
    const head = await readHead(file, 12)
    if (!isAllowedImage(head)) {
      error.value = TEACHER_COPY.B2_ADMISSION_TYPE_ERR
      return
    }
    busy.value = true
    fileName.value = file.name
    const dataUrl = await readDataUrl(file)
    await submitAdmission(dataUrl)
    emit('submitted')
  } catch (err) {
    error.value = (err && err.message) || TEACHER_COPY.B1_ERROR
  } finally {
    busy.value = false
    // allow selecting the same file again next time
    input.value = ''
  }
}
</script>

<template>
  <div class="verify-admission">
    <p class="verify-admission__label">{{ TEACHER_COPY.B2_ADMISSION_LABEL }}</p>
    <label class="verify-admission__entry">
      <span class="verify-admission__alt">{{ TEACHER_COPY.B2_ADMISSION_ALT }}</span>
      <input
        class="verify-admission__file"
        type="file"
        accept="image/jpeg,image/png,image/webp"
        :disabled="busy"
        @change="onFileChange"
      />
    </label>
    <p v-if="fileName" class="verify-admission__name">{{ fileName }}</p>
    <p v-if="error" class="verify-admission__error">{{ error }}</p>
  </div>
</template>

<style scoped>
.verify-admission {
  display: flex;
  flex-direction: column;
  align-items: flex-start;
  gap: var(--space-3);
  box-sizing: border-box;
  width: 100%;
  min-width: 0;
}
.verify-admission__label {
  font-weight: 700;
  color: var(--ink);
  line-height: var(--lh-tight);
}
.verify-admission__entry {
  display: inline-flex;
  cursor: pointer;
  -webkit-tap-highlight-color: transparent;
}
/* underlined small gray text (entry affordance, mirrors UiButton S1) */
.verify-admission__alt {
  font-size: var(--fs-sm);
  color: var(--gray-60);
  text-decoration: underline;
  text-underline-offset: 3px;
  transition: color var(--dur-sm) var(--ease-out);
}
.verify-admission__entry:hover .verify-admission__alt,
.verify-admission__entry:focus-within .verify-admission__alt {
  color: var(--ink);
}
/* visually-hidden file input (kept focusable; label opens the picker) */
.verify-admission__file {
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
.verify-admission__name {
  font-size: var(--fs-sm);
  color: var(--gray-60);
  line-height: var(--lh-body);
  word-break: break-all;
}
.verify-admission__error {
  font-size: var(--fs-sm);
  color: var(--danger);
  line-height: var(--lh-body);
}
@media (prefers-reduced-motion: reduce) {
  .verify-admission__alt {
    transition: none;
  }
}
</style>

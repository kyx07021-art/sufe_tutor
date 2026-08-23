<script setup>
/**
 * ProfileEditCard - B2-3 teacher detail card in edit mode
 * --------------------------------------------------------
 * - Renders the teacher's own detail card as a plain card (no close button, no
 *   message button); every editable field becomes a text input at detail-card size.
 * - Prefill from the `profile` prop (I-39 shape via profile-service) when it arrives;
 *   while absent shows a loading state.
 * - Fields: teacherName / bio / priceMin+priceMax / region / timeSlots / experienceYears /
 *   personalityTags / gender / graduationYear (+ SubjectEditor for B2-4 + AvatarEditor B2-6).
 * - Save (B2-5 collect/validate): local validation -> emit `save` with the edit payload;
 *   the write path (POST I-40 -> read-back -> invalidate) lives at MyInfo.
 */
import { ref, watch } from 'vue'
import { TEACHER_COPY } from '@/constants/ui.js'
import { UiButton, UiInput } from '@/components/ui/index.js'
import SubjectEditor from './SubjectEditor.vue'
import AvatarEditor from './AvatarEditor.vue'
import { formatTimeSlots } from './profile-model.js'

const props = defineProps({
  profile: { type: Object, default: null },
})
const emit = defineEmits(['save'])

/* ---- editable fields ---- */
const teacherName = ref('')
const bio = ref('')
const region = ref('')
/* addressArea / teachingMethod have no inputs in this minimal card (B2-3);
   they pass through the prefilled I-39 value so the I-40 complete field set
   never blanks them on save. */
const addressArea = ref('')
const teachingMethod = ref('')
const priceMin = ref('')
const priceMax = ref('')
const experienceYears = ref('')
const gender = ref('')
const graduationYear = ref('')
const timeSlots = ref('')
// Structured time-slot rows ({type:'week',dow,start,end}) preserved as-is for the I-40
// save path; `timeSlots` (above) is only the read-only Chinese display of these rows.
const timeSlotsData = ref([])
const personalityTags = ref('')
const subjects = ref({ subjects: [], philosophy: '' })
const avatar = ref('')

const loading = ref(!props.profile)
const error = ref('')

function splitList(text) {
  return text
    .split(/[、,，\s]+/)
    .map((s) => s.trim())
    .filter(Boolean)
}

function fill(p) {
  teacherName.value = p.teacherName || ''
  bio.value = p.bio || ''
  region.value = p.region || ''
  addressArea.value = p.addressArea || ''
  teachingMethod.value = p.teachingMethod || ''
  priceMin.value = p.priceMin != null ? String(p.priceMin) : ''
  priceMax.value = p.priceMax != null ? String(p.priceMax) : ''
  experienceYears.value = p.experienceYears != null ? String(p.experienceYears) : ''
  gender.value = p.gender || ''
  graduationYear.value = p.graduationYear != null ? String(p.graduationYear) : ''
  timeSlotsData.value = Array.isArray(p.timeSlots) ? p.timeSlots.slice() : []
  timeSlots.value = formatTimeSlots(timeSlotsData.value)
  personalityTags.value = (p.personalityTags || []).join('、')
  subjects.value = { subjects: p.subjects || [], philosophy: p.philosophy || '' }
  avatar.value = p.avatar || ''
  loading.value = false
}

watch(
  () => props.profile,
  (p) => {
    if (p) fill(p)
  },
  { immediate: true },
)

/* ---- validation (B2-5 local pre-check; mutation guard: deleting this lets bad input through) ---- */
function validate() {
  if (!teacherName.value.trim()) return TEACHER_COPY.B2_REQUIRED_ERR
  // region holds the province pinyin id; I-40 requires province (mutation guard locked in smoke)
  if (!region.value.trim()) return TEACHER_COPY.B2_REQUIRED_ERR
  const lo = priceMin.value === '' ? null : Number(priceMin.value)
  const hi = priceMax.value === '' ? null : Number(priceMax.value)
  if (lo != null && (!Number.isFinite(lo) || lo < 0)) return TEACHER_COPY.B2_REQUIRED_ERR
  if (hi != null && (!Number.isFinite(hi) || hi < 0)) return TEACHER_COPY.B2_REQUIRED_ERR
  if (lo != null && hi != null && lo > hi) return TEACHER_COPY.B2_REQUIRED_ERR
  if (experienceYears.value !== '' && !/^\d+$/.test(experienceYears.value)) {
    return TEACHER_COPY.B2_REQUIRED_ERR
  }
  return ''
}

function onSave() {
  const err = validate()
  if (err) {
    error.value = err
    return
  }
  error.value = ''
  emit('save', {
    teacherName: teacherName.value.trim(),
    bio: bio.value,
    region: region.value,
    addressArea: addressArea.value,
    teachingMethod: teachingMethod.value,
    priceMin: priceMin.value === '' ? null : Number(priceMin.value),
    priceMax: priceMax.value === '' ? null : Number(priceMax.value),
    experienceYears: experienceYears.value === '' ? 0 : Number(experienceYears.value),
    gender: gender.value,
    graduationYear: graduationYear.value,
    timeSlots: timeSlotsData.value,
    personalityTags: splitList(personalityTags.value),
    subjects: subjects.value.subjects,
    philosophy: subjects.value.philosophy,
    /* avatar is a separate write path (I-11 via AvatarEditor), not part of I-40 */
  })
}
</script>

<template>
  <div class="profile-edit">
    <div v-if="loading" class="profile-edit__state">{{ TEACHER_COPY.B1_LOADING }}</div>

    <div v-else class="profile-edit__card">
      <div class="profile-edit__head">
        <AvatarEditor :src="avatar" @avatar-updated="avatar = $event" />
        <div class="profile-edit__name">
          <label class="profile-edit__label" for="profile-edit-name">
            {{ TEACHER_COPY.B2_FIELD_TEACHER_NAME }}
          </label>
          <UiInput
            id="profile-edit-name"
            v-model="teacherName"
            :aria-label="TEACHER_COPY.B2_FIELD_TEACHER_NAME"
            width="100%"
          />
        </div>
      </div>

      <div class="profile-edit__field">
        <span class="profile-edit__label">{{ TEACHER_COPY.B2_FIELD_BIO }}</span>
        <UiInput
          v-model="bio"
          :aria-label="TEACHER_COPY.B2_FIELD_BIO"
          :placeholder="TEACHER_COPY.B2_FIELD_BIO"
          width="100%"
        />
      </div>

      <div class="profile-edit__field">
        <span class="profile-edit__label">{{ TEACHER_COPY.B2_FIELD_PRICE }}</span>
        <div class="profile-edit__price">
          <UiInput v-model="priceMin" filter="digits" :aria-label="TEACHER_COPY.B1_PRICE_MIN" :placeholder="TEACHER_COPY.B1_PRICE_MIN" width="110px" />
          <UiInput v-model="priceMax" filter="digits" :aria-label="TEACHER_COPY.B1_PRICE_MAX" :placeholder="TEACHER_COPY.B1_PRICE_MAX" width="110px" />
        </div>
      </div>

      <div class="profile-edit__field">
        <span class="profile-edit__label">{{ TEACHER_COPY.B2_FIELD_AREA }}</span>
        <UiInput v-model="region" :aria-label="TEACHER_COPY.B2_FIELD_AREA" width="100%" />
      </div>

      <div class="profile-edit__field">
        <span class="profile-edit__label">{{ TEACHER_COPY.B2_FIELD_TIME }}</span>
        <UiInput
          :model-value="timeSlots"
          readonly
          :aria-label="TEACHER_COPY.B2_FIELD_TIME"
          :placeholder="TEACHER_COPY.B2_FIELD_TIME"
          width="100%"
        />
      </div>

      <div class="profile-edit__field">
        <span class="profile-edit__label">{{ TEACHER_COPY.B2_FIELD_EXP }}</span>
        <UiInput
          v-model="experienceYears"
          filter="digits"
          :aria-label="TEACHER_COPY.B2_FIELD_EXP"
          :placeholder="TEACHER_COPY.B2_FIELD_EXP_UNIT"
          width="120px"
        />
      </div>

      <div class="profile-edit__field">
        <span class="profile-edit__label">{{ TEACHER_COPY.B2_FIELD_PERSONALITY }}</span>
        <UiInput
          v-model="personalityTags"
          :aria-label="TEACHER_COPY.B2_FIELD_PERSONALITY"
          :placeholder="TEACHER_COPY.B2_FIELD_PERSONALITY"
          width="100%"
        />
      </div>

      <div class="profile-edit__field">
        <span class="profile-edit__label">{{ TEACHER_COPY.B2_FIELD_GENDER }}</span>
        <UiInput v-model="gender" :aria-label="TEACHER_COPY.B2_FIELD_GENDER" width="120px" />
      </div>

      <div class="profile-edit__field">
        <span class="profile-edit__label">{{ TEACHER_COPY.B2_FIELD_GRADUATION }}</span>
        <UiInput
          v-model="graduationYear"
          :aria-label="TEACHER_COPY.B2_FIELD_GRADUATION"
          width="100%"
        />
      </div>

      <SubjectEditor v-model="subjects" />

      <p v-if="error" class="profile-edit__error">{{ error }}</p>

      <div class="profile-edit__actions">
        <UiButton variant="A" @click="onSave">{{ TEACHER_COPY.B2_SAVE }}</UiButton>
      </div>
    </div>
  </div>
</template>

<style scoped>
.profile-edit {
  box-sizing: border-box;
  width: 100%;
  min-width: 0;
}
.profile-edit__state {
  padding: var(--space-7) 0;
  text-align: center;
  color: var(--gray-50);
}
.profile-edit__card {
  box-sizing: border-box;
  max-width: 520px;
  width: 100%;
  display: flex;
  flex-direction: column;
  gap: var(--space-5);
  padding: var(--space-5);
  border: var(--border-w) solid var(--line);
  border-radius: var(--radius-lg);
  background: var(--paper);
}
.profile-edit__head {
  display: flex;
  align-items: center;
  gap: var(--space-4);
}
.profile-edit__name {
  flex: 1;
  min-width: 0;
  display: flex;
  flex-direction: column;
  gap: var(--space-1);
}
.profile-edit__label {
  font-weight: 700;
  color: var(--ink);
  line-height: var(--lh-tight);
}
.profile-edit__field {
  display: flex;
  flex-direction: column;
  gap: var(--space-1);
  min-width: 0;
}
.profile-edit__price {
  display: flex;
  gap: var(--space-3);
}
.profile-edit__error {
  font-size: var(--fs-sm);
  color: var(--danger);
  line-height: var(--lh-body);
}
.profile-edit__actions {
  display: flex;
  justify-content: flex-end;
}
</style>

<script setup>
/**
 * MyInfo - B2 my-info page (B2-1a container)
 * ------------------------------------------
 * - Gate flow: I-43 verify-status four states -> VerifyGate shows the verification
 *   channel; once approved the edit card (B2-3/4) renders with I-39 prefill.
 * - Save write path (B2-5): collect -> validate (in ProfileEditCard) -> POST I-40
 *   -> read-back refresh -> invalidate the public teacher profile cache (F7).
 * - Avatar (B2-6) writes I-11 through AvatarEditor -> profile-service.saveAvatar.
 */
import { onMounted, ref } from 'vue'
import { TEACHER_COPY } from '@/constants/ui.js'
import { showToast } from '@/composables/useToast.js'
import { fetchVerifyStatus } from './verify-service.js'
import { fetchMyProfile, saveProfile } from './profile-service.js'
import VerifyGate from './VerifyGate.vue'
import ProfileEditCard from './ProfileEditCard.vue'

const status = ref('none')
const profile = ref(null)
const profileLoading = ref(false)
const ready = ref(false)
const saving = ref(false)

onMounted(async () => {
  try {
    const v = await fetchVerifyStatus()
    status.value = v.status
  } catch (e) {
    status.value = 'none'
  }
  ready.value = true
  if (status.value === 'approved') await loadProfile()
})

async function loadProfile() {
  profileLoading.value = true
  try {
    profile.value = await fetchMyProfile()
  } catch (e) {
    profile.value = null
  } finally {
    profileLoading.value = false
  }
}

function onStatusChanged(newStatus) {
  status.value = newStatus
  if (newStatus === 'approved') loadProfile()
}

async function onSave(payload) {
  if (saving.value) return
  saving.value = true
  try {
    await saveProfile(payload)
    showToast(TEACHER_COPY.B2_SAVED)
    // read-back refresh (F7): keep the edit card in sync with server truth
    profile.value = await fetchMyProfile()
    // invalidate the public teacher profile cache.
    // TEMPORARY: core datahub (M2) is the eventual cache owner; this is the seam.
    //   invalidate('teachers')
  } catch (e) {
    showToast(e && e.message ? e.message : TEACHER_COPY.B1_ERROR)
  } finally {
    saving.value = false
  }
}
</script>

<template>
  <section class="b2">
    <h2 class="b2__title">{{ TEACHER_COPY.B2_TITLE }}</h2>

    <div v-if="!ready" class="b2__state">{{ TEACHER_COPY.B1_LOADING }}</div>
    <template v-else>
      <VerifyGate v-if="status !== 'approved'" @status-changed="onStatusChanged" />
      <template v-else>
        <div v-if="profileLoading" class="b2__state">{{ TEACHER_COPY.B1_LOADING }}</div>
        <ProfileEditCard v-else-if="profile" :profile="profile" @save="onSave" />
        <div v-else class="b2__state b2__state--error">{{ TEACHER_COPY.B1_ERROR }}</div>
      </template>
    </template>
  </section>
</template>

<style scoped>
.b2 {
  padding: var(--space-6) var(--space-6);
  background: var(--paper);
  color: var(--ink);
  min-height: 100vh;
}
.b2__title {
  font-size: var(--fs-xl);
  line-height: var(--lh-tight);
  margin-bottom: var(--space-5);
}
.b2__state {
  padding: var(--space-7) 0;
  text-align: center;
  color: var(--gray-50);
}
.b2__state--error {
  color: var(--danger);
}
</style>

<script setup>
/**
 * RegisterPane - M6-13 register mode (plan §18: role picker + invite-code gate + I-03)
 * -------------------------------------------------------
 * - Self-contained register form: role (student/teacher) + invite code (teacher
 *   only) + OTP channel (phone/email) + code input (OtpRow) + username + password
 *   + agreement checkboxes + slider puzzle.
 * - Confirm gating (role selected + invite filled for teacher + OTP complete +
 *   username/password + puzzle passed + both agreements) is reported to the
 *   parent via `update:valid` so the shared footer's confirm button (M6-9) can
 *   gray out accordingly.
 * - On submit emits the I-03 payload (interfaces.md §19) and the parent runs the
 *   register call + token storage + onVerified.
 * - State resets every time the modal opens.
 */
import { computed, ref, watch } from 'vue'
import { UiButton, UiInput, UiCheckbox } from '@/components/ui/index.js'
import OtpRow from './OtpRow.vue'
import CaptchaPuzzle from './CaptchaPuzzle.vue'
import { useOtpSend } from './useOtpSend.js'
import { AUTH_SCENES, AUTH_METHODS } from './authMethod.js'
import { AUTH_COPY } from '@/constants/m-auth.js'
import { UI_CONSTANTS } from '@/constants/ui.js'

const props = defineProps({
  open: { type: Boolean, default: false },
  /** register form validity (reported by update:valid so the shared footer can gate confirm) */
  valid: { type: Boolean, default: false },
})

const emit = defineEmits(['submit', 'close', 'update:valid'])

// AK-I1: default-select the student role — the role picker opens with a choice
// already made (student, gray-10 filled), so the first-time user sees the
// selected state immediately. The AK-A10 requirement covered the default
// selection too; the original implementation dropped it by leaving role empty.
const role = ref('student')
const inviteCode = ref('')
const channel = ref('phone')
const identifier = ref('')
const code = ref('')
const username = ref('')
const password = ref('')
const agreeAgreement = ref(false)
const agreePrivacy = ref(false)
const puzzlePassed = ref(false)

const puzzleRef = ref(null)
const otpRowRef = ref(null)
const { sending, send } = useOtpSend()

const channelSwitchLabel = computed(() =>
  channel.value === 'phone' ? AUTH_COPY.CHANNEL_SWITCH_TO_EMAIL : AUTH_COPY.CHANNEL_SWITCH_TO_PHONE,
)

/** AK-A9: the single underlined link right of the OTP title flips the register
    channel; clears the channel-specific identifier + code so a stale phone/email
    value (and its OTP) never leaks into the other channel. */
function switchChannel() {
  channel.value = channel.value === 'phone' ? 'email' : 'phone'
  identifier.value = ''
  code.value = ''
}

const isTeacher = computed(() => role.value === 'teacher')
const otpMethod = computed(() => (channel.value === 'phone' ? AUTH_METHODS.OTP_PHONE : AUTH_METHODS.OTP_EMAIL))
const identifierPlaceholder = computed(() =>
  channel.value === 'phone' ? AUTH_COPY.IDENTIFIER_PLACEHOLDER_PHONE : AUTH_COPY.IDENTIFIER_PLACEHOLDER_EMAIL,
)
const identifierFilter = computed(() => (channel.value === 'phone' ? 'phone' : 'none'))

const canSubmit = computed(
  () =>
    role.value !== '' &&
    (!isTeacher.value || inviteCode.value.trim() !== '') &&
    identifier.value.trim() !== '' &&
    /^\d{6}$/.test(code.value) &&
    username.value.trim() !== '' &&
    password.value.trim() !== '' &&
    puzzlePassed.value &&
    agreeAgreement.value &&
    agreePrivacy.value,
)

watch(canSubmit, (v) => emit('update:valid', v))

async function onSendOtp() {
  const ok = await send({
    channel: channel.value === 'phone' ? 'sms' : 'email',
    target: identifier.value,
    scene: AUTH_SCENES.REGISTER,
  })
  if (ok) otpRowRef.value?.startCountdown(UI_CONSTANTS.OTP_COOLDOWN_SEC)
}

function onSubmit() {
  if (!canSubmit.value || sending.value) return
  emit('submit', {
    username: username.value.trim(),
    password: password.value,
    role: role.value,
    inviteCode: isTeacher.value ? inviteCode.value.trim() : undefined,
    otpChannel: channel.value === 'phone' ? 'sms' : 'email',
    phone: channel.value === 'phone' ? identifier.value.trim() : undefined,
    email: channel.value === 'email' ? identifier.value.trim() : undefined,
    code: code.value,
    agreeAgreement: agreeAgreement.value,
    agreePrivacy: agreePrivacy.value,
  })
}

watch(
  () => props.open,
  (v) => {
    if (!v) return
    role.value = 'student' // AK-I1: reopening the modal re-selects the default role
    inviteCode.value = ''
    channel.value = 'phone'
    identifier.value = ''
    code.value = ''
    username.value = ''
    password.value = ''
    agreeAgreement.value = false
    agreePrivacy.value = false
    puzzlePassed.value = false
    puzzleRef.value?.reset()
    emit('update:valid', false)
  },
)

function submit() {
  onSubmit()
}

defineExpose({ canSubmit, submit })
</script>

<template>
  <div class="register-pane">
    <p class="register-pane__title ui-title-sm">{{ AUTH_COPY.ROLE_LABEL }}</p>
    <div class="register-pane__roles">
      <UiButton
        variant="B"
        :class="{ 'is-active': role === 'student' }"
        @click="role = 'student'"
      >{{ AUTH_COPY.ROLE_STUDENT }}</UiButton>
      <UiButton
        variant="B"
        :class="{ 'is-active': role === 'teacher' }"
        @click="role = 'teacher'"
      >{{ AUTH_COPY.ROLE_TEACHER }}</UiButton>
    </div>

    <UiInput
      v-if="isTeacher"
      :model-value="inviteCode"
      :placeholder="AUTH_COPY.INVITE_PLACEHOLDER"
      :aria-label="AUTH_COPY.INVITE_LABEL"
      class="register-pane__field"
      @update:model-value="(v) => (inviteCode = v)"
    />

    <OtpRow
      ref="otpRowRef"
      :key="'otp-reg-' + channel"
      :method="otpMethod"
      :value="code"
      :identifier="identifier"
      :identifier-placeholder="identifierPlaceholder"
      :identifier-filter="identifierFilter"
      :send-disabled="sending"
      @update:value="(v) => (code = v)"
      @update:identifier="(v) => (identifier = v)"
      @send="onSendOtp"
    >
      <template #title-suffix>
        <UiButton variant="S1" class="register-pane__channel-switch" @click="switchChannel">
          {{ channelSwitchLabel }}
        </UiButton>
      </template>
    </OtpRow>

    <UiInput
      :model-value="username"
      :placeholder="AUTH_COPY.USERNAME_PLACEHOLDER"
      class="register-pane__field"
      @update:model-value="(v) => (username = v)"
    />
    <UiInput
      :model-value="password"
      :placeholder="AUTH_COPY.SET_PASSWORD_PLACEHOLDER"
      type="password"
      class="register-pane__field register-pane__password"
      @update:model-value="(v) => (password = v)"
    />

    <div class="register-pane__agreements">
      <UiCheckbox v-model="agreeAgreement" :label="AUTH_COPY.AGREE_AGREEMENT" />
      <UiCheckbox v-model="agreePrivacy" :label="AUTH_COPY.AGREE_PRIVACY" />
    </div>

    <CaptchaPuzzle ref="puzzleRef" @verified="puzzlePassed = true" />
  </div>
</template>

<style scoped>
/* ==========================================================================
   Register pane vertical rhythm (AK-N-A1, user feedback #1)
   -------------------------------------------------------
   Three-tier gap system (U1: "related groups tight, big groups loose" — a
   breathing rhythm, NOT uniform enlargement):
     inline tier (within a field, e.g. checkbox rows / OTP id<->code) -> --space-2 (8px)
     group tier (between fields, e.g. OTP<->username<->password)      -> --space-3 (12px)
     block tier (module boundaries: password<->privacy, privacy<->puzzle,
           and the breathing zone around the two small field titles)
       -> --space-4 (16px) PLUS the small title's own 8px margin
          (.ui-title-sm, AK-A8 single source) = ~24px perceived blank line.

   Scope / impact boundary (why this is scoped here, not global):
   - This block ONLY shapes the register form. Verify/login keep AuthShell's
     compact override (they are short flows and never had the cramped rhythm).
   - Every value is a spacing token (--space-*) — no raw px — so tomorrow's
     token retune propagates without touching component CSS.
   - The AuthShell `:deep(.register-pane){ gap }` flatten was REMOVED (this
     component now owns the register rhythm; the shell only compresses heights).
   ========================================================================== */
.register-pane {
  display: flex;
  flex-direction: column;
  /* group-tier baseline. Block-tier boundaries below add margin-top on top of this. */
  gap: var(--space-3);
  width: 100%;
  min-width: 0;
}

.register-pane__roles {
  display: flex;
  align-items: center;
  gap: var(--space-3);
  min-width: 0;
}
/* AK-A10: selected role = gray-10 fill + ink text (selected state expressed by
   fill, not gray text — black text stays black, AK-B3). B variant has no resting
   background, so the fill follows the capsule contour on the button root. */
.register-pane__roles .is-active { background: var(--gray-10); color: var(--ink); }

.register-pane__channel-switch {
  flex: none;
}

.register-pane__field {
  width: 100%;
}

/* block-tier boundary #1: password -> privacy. The agreements block is a legal module,
   so it is separated from the credential fields by a full module-tier gap
   (12px base + 8px margin = 20px). */
.register-pane__agreements {
  margin-top: var(--space-2);
  display: flex;
  flex-direction: column;
  align-items: flex-start;
  /* inline tier: the two agreement checkboxes are sub-items of one field (AK-A7). */
  gap: var(--space-2);
  min-width: 0;
}

/* block-tier boundary #2: privacy -> puzzle. The slider is a secondary graphic module
   (AK-N-A4: "the register text is the master"), given its own module-tier air.
   :deep reaches the CaptchaPuzzle root class (parent-scoped). */
.register-pane :deep(.captcha-puzzle) {
  margin-top: var(--space-2);
}

/* OTP group internals, register-only (verify/login keep AuthShell's compact
   override): the identifier <-> code inputs are sub-fields of one OTP entry
   (inline tier). The small "phone verification code" title's own .ui-title-sm bottom margin
   (8px) adds on top -> title<->identifier reads ~16px, a visible blank line
   under the title. */
.register-pane :deep(.otp-row) {
  gap: var(--space-2);
}

/* The puzzle's stage -> track gap inside the module (was flattened to 4px by
   AuthShell; restore the inline-tier gap so the track reads as part of the puzzle). */
.register-pane :deep(.captcha-puzzle__track) {
  margin-top: var(--space-2);
}
</style>

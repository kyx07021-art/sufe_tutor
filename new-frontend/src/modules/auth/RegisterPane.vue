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

const emit = defineEmits(['submit', 'close', 'update:valid', 'switch-login'])

const role = ref('')
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
    role.value = ''
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

    <button
      type="button"
      class="register-pane__switch-login"
      @click="emit('switch-login')"
    >{{ AUTH_COPY.HAVE_ACCOUNT }}</button>
  </div>
</template>

<style scoped>
.register-pane {
  display: flex;
  flex-direction: column;
  gap: var(--space-4);
  width: 100%;
  min-width: 0;
}

.register-pane__roles {
  display: flex;
  align-items: center;
  gap: var(--space-3);
  min-width: 0;
}
.register-pane__roles .is-active { color: var(--gray-60); }

.register-pane__channel-switch {
  flex: none;
}

.register-pane__field {
  width: 100%;
}

.register-pane__agreements {
  display: flex;
  flex-direction: column;
  align-items: flex-start;
  gap: var(--space-1); /* AK-A7: tight row gap between the two agreement checkboxes */
  min-width: 0;
}

/* PA-2-F1: flip-to-login link (quiet gray link, no border, no capsule) */
.register-pane__switch-login {
  align-self: center;
  border: none;
  background: transparent;
  padding: var(--space-2) 0;
  color: var(--gray-60);
  font-size: var(--fs-sm);
  line-height: 1;
  cursor: pointer;
  transition: color var(--dur-sm) var(--ease-out);
}
.register-pane__switch-login:hover { color: var(--ink); }
</style>

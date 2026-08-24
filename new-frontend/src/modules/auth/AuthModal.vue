<script setup>
/**
 * AuthModal - M6 composition root (lead-owned assembly)
 * -------------------------------------------------------
 * - Composes AuthShell (M6-2) + scene body: OtpRow (M6-4) / PasswordRow (M6-6) /
 *   MethodSwitch (M6-7) / CaptchaPuzzle (M6-8b) / AuthFooter (M6-9), driven by the
 *   auth-method state machine (M6-3) and the I-01/I-06/I-02/I-03 chains (M6-5/M6-10).
 * - Scene dispatch (§18): login (I-02) / register (RegisterPane -> I-03) / verify
 *   (I-06). openIdentityAuth (M6-11) mounts this modal.
 * - Confirm gate (M6-9): credential complete + puzzle passed; register additionally
 *   requires role/invite/agreements via RegisterPane's `valid`.
 */
import { computed, ref, toRefs, watch } from 'vue'
import AuthShell from './AuthShell.vue'
import OtpRow from './OtpRow.vue'
import PasswordRow from './PasswordRow.vue'
import MethodSwitch from './MethodSwitch.vue'
import CaptchaPuzzle from './CaptchaPuzzle.vue'
import AuthFooter from './AuthFooter.vue'
import RegisterPane from './RegisterPane.vue'
import { useAuthMethod } from './useAuthMethod.js'
import { useOtpSend } from './useOtpSend.js'
import { useConfirmSubmit } from './useConfirmSubmit.js'
import { AUTH_SCENES, AUTH_METHODS, isOtp } from './authMethod.js'
import { api } from '@/core/api.js'
import { setAuth, persistAuth } from '@/modules/shell/auth-store.js'
import { openIdentityAuth } from './authState.js'
import { showToast } from '@/composables/useToast'
import { AUTH_COPY } from '@/constants/m-auth.js'

const props = defineProps({
  open: { type: Boolean, default: false },
  scene: { type: String, default: AUTH_SCENES.VERIFY },
  contactMasks: { type: Object, default: () => ({}) },
  /** called on a successful verify / login / register */
  onVerified: { type: Function, default: null },
})

const emit = defineEmits(['close', 'update:open'])

const { scene, contactMasks } = toRefs(props)
const auth = useAuthMethod(scene, contactMasks)
const { current, credential, resetTick, others, switchMethod } = auth
const { sending: otpSending, send: otpSend } = useOtpSend()
const { submitting: confirmSubmitting, submit: verifySubmit } = useConfirmSubmit()

const identifier = ref('')
const puzzleRef = ref(null)
const puzzlePassed = ref(false)
/** The locally generated captchaId from the passed puzzle, echoed on the I-06 verify body (anti-abuse UX gate; the server no longer confirms it, AK-A1b). */
const puzzleCaptchaId = ref('')
const otpRowRef = ref(null)
const registerPaneRef = ref(null)
const registerValid = ref(false)
const registerSubmitting = ref(false)

const isRegister = computed(() => scene.value === AUTH_SCENES.REGISTER)

/** Login scene shows an identifier field (bound-contact verify needs none). */
const loginIdentifierPlaceholder = computed(() => {
  if (scene.value !== AUTH_SCENES.LOGIN) return ''
  if (current.value === AUTH_METHODS.OTP_PHONE) return AUTH_COPY.IDENTIFIER_PLACEHOLDER_PHONE
  if (current.value === AUTH_METHODS.OTP_EMAIL) return AUTH_COPY.IDENTIFIER_PLACEHOLDER_EMAIL
  return AUTH_COPY.IDENTIFIER_PLACEHOLDER_USERNAME
})
const loginIdentifierFilter = computed(() =>
  current.value === AUTH_METHODS.OTP_PHONE ? 'phone' : 'none',
)

const credentialReady = computed(() => {
  if (scene.value === AUTH_SCENES.LOGIN && identifier.value.trim() === '') return false
  return isOtp(current.value)
    ? /^\d{6}$/.test(credential.value)
    : credential.value.trim().length > 0
})

const canConfirm = computed(() =>
  isRegister.value ? registerValid.value : credentialReady.value && puzzlePassed.value,
)

function onPuzzleVerified(captchaId) {
  puzzlePassed.value = true
  puzzleCaptchaId.value = captchaId || ''
}

watch(
  () => props.open,
  (v) => {
    if (v) {
      identifier.value = ''
      puzzlePassed.value = false
      puzzleCaptchaId.value = ''
      puzzleRef.value?.reset()
    }
  },
)

async function onSendOtp() {
  const ok = await otpSend({
    channel: current.value === AUTH_METHODS.OTP_PHONE ? 'sms' : 'email',
    target: identifier.value || '',
    scene: scene.value,
  })
  if (ok) otpRowRef.value?.startCountdown(60)
}

function finishSuccess() {
  props.onVerified?.()
  emit('close')
  emit('update:open', false)
}

function close() {
  emit('close')
  emit('update:open', false)
}

/** PA-2-F1: register visitor flips to the login scene (same exit contract preserved). */
function onSwitchToLogin() {
  openIdentityAuth({
    mode: 'login',
    contactMasks: props.contactMasks,
    onVerified: props.onVerified,
  })
}

async function onConfirm() {
  if (!canConfirm.value) return
  if (isRegister.value) {
    registerPaneRef.value?.submit()
    return
  }
  if (scene.value === AUTH_SCENES.VERIFY) {
    const ok = await verifySubmit({
      type: isOtp(current.value) ? 'otp' : 'password',
      value: credential.value,
      captchaId: puzzleCaptchaId.value,
    })
    if (ok) finishSuccess()
    return
  }
  // login scene (interim; M2-10 authStore owns login)
  await onLogin()
}

async function onLogin() {
  const isCode = isOtp(current.value)
  try {
    // I-02/I-03 split: code login -> POST /api/auth/login/code, password login ->
    // POST /api/auth/login (handleLogin, body { identifier, password }). No
    // /api/auth/login/password route exists — calling it 404s the login.
    const r = await api(isCode ? '/auth/login/code' : '/auth/login', {
      method: 'POST',
      auth: false,
      body: isCode
        ? { identifier: identifier.value.trim(), code: credential.value }
        : { identifier: identifier.value.trim(), password: credential.value },
    })
    if (r && r.authToken) {
      applyAuthSession(r)
      finishSuccess()
      return
    }
    showToast((r && r.message) || AUTH_COPY.LOGIN_FAIL)
  } catch (err) {
    showToast(err.message || AUTH_COPY.LOGIN_FAIL)
  }
}

async function onRegister(payload) {
  registerSubmitting.value = true
  try {
    const r = await api('/auth/register', {
      method: 'POST',
      auth: false,
      body: payload,
    })
    if (r && r.authToken) {
      applyAuthSession(r)
      finishSuccess()
      return
    }
    showToast((r && r.message) || AUTH_COPY.REGISTER_FAIL)
  } catch (err) {
    showToast(err.message || AUTH_COPY.REGISTER_FAIL)
  } finally {
    registerSubmitting.value = false
  }
}

/**
 * Persist the login/register response into the shell authStore (F7 state sync)
 * using the same token key core/api.js reads, so the whole app sees the session.
 * Interim until M2-10 authStore owns the login flow.
 */
function applyAuthSession(r) {
  const user = (r && r.user) || null
  const token = (r && r.authToken) || ''
  setAuth({ token, user })
  persistAuth({ token, user, remember: false })
}
</script>

<template>
  <AuthShell
    :open="open"
    :scene="scene"
    :contact-masks="contactMasks"
    @close="close"
  >
    <RegisterPane
      v-if="isRegister"
      ref="registerPaneRef"
      :open="open"
      v-model:valid="registerValid"
      @submit="onRegister"
      @switch-login="onSwitchToLogin"
    />
    <template v-else>
      <OtpRow
        v-if="isOtp(current)"
        :key="'otp-' + current + '-' + resetTick"
        ref="otpRowRef"
        :method="current"
        :value="credential"
        :identifier="identifier"
        :identifier-placeholder="loginIdentifierPlaceholder"
        :identifier-filter="loginIdentifierFilter"
        :send-disabled="otpSending"
        @update:value="(v) => (credential = v)"
        @update:identifier="(v) => (identifier = v)"
        @send="onSendOtp"
      />
      <PasswordRow
        v-else
        :key="'pwd-' + current + '-' + resetTick"
        :value="credential"
        :identifier="identifier"
        :identifier-placeholder="loginIdentifierPlaceholder"
        :identifier-filter="loginIdentifierFilter"
        @update:value="(v) => (credential = v)"
        @update:identifier="(v) => (identifier = v)"
      />
      <MethodSwitch :methods="others" :current="current" @select="switchMethod" />
      <CaptchaPuzzle ref="puzzleRef" @verified="onPuzzleVerified" />
    </template>

    <template #footer-right>
      <AuthFooter
        :can-confirm="canConfirm"
        :busy="confirmSubmitting || registerSubmitting"
        @confirm="onConfirm"
      />
    </template>
  </AuthShell>
</template>

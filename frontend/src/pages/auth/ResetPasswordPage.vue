<script setup lang="ts">
import { computed, onMounted, ref } from 'vue'
import { VaAlert, VaButton, VaInput } from 'vuestic-ui'

import { ApiError, api } from '../../api/client'

const accessToken = ref('')
const refreshToken = ref('')
const password = ref('')
const confirmPassword = ref('')
const errorMessage = ref('')
const isSubmitting = ref(false)
const isComplete = ref(false)
const isLinkValid = computed(() => Boolean(accessToken.value && refreshToken.value))

onMounted(() => {
  const params = new URLSearchParams(window.location.hash.slice(1))
  if (params.get('type') === 'recovery') {
    accessToken.value = params.get('access_token') ?? ''
    refreshToken.value = params.get('refresh_token') ?? ''
  }
  // The one-time recovery tokens are held in memory and never retained in browser history.
  if (window.location.hash) history.replaceState(null, '', `${window.location.pathname}${window.location.search}`)
})

async function handleSubmit() {
  errorMessage.value = ''
  if (password.value.length < 8) {
    errorMessage.value = 'Mật khẩu phải có ít nhất 8 ký tự'
    return
  }
  if (password.value !== confirmPassword.value) {
    errorMessage.value = 'Mật khẩu xác nhận không khớp'
    return
  }
  if (!isLinkValid.value) {
    errorMessage.value = 'Liên kết không hợp lệ hoặc đã hết hạn. Vui lòng yêu cầu liên kết mới.'
    return
  }

  isSubmitting.value = true
  try {
    await api.post('/auth/reset-password', {
      accessToken: accessToken.value,
      refreshToken: refreshToken.value,
      password: password.value,
    }, false)
    isComplete.value = true
  } catch (error) {
    errorMessage.value = error instanceof ApiError
      ? error.message
      : 'Không thể cập nhật mật khẩu. Liên kết có thể đã hết hạn.'
  } finally {
    isSubmitting.value = false
  }
}
</script>

<template>
  <main class="auth-layout">
    <div class="auth-hero">
      <div class="hero-content">
        <p class="auth-brand">Thủy sản Xanh</p>
        <p class="hero-title">Từ vùng nuôi đến niềm tin.</p>
        <p class="hero-tagline">Kết nối từng công đoạn. Theo dõi từng lô hàng. Minh bạch nguồn gốc thủy sản.</p>
      </div>
    </div>
    <div class="auth-panel">
      <div class="auth-form-container">
        <router-link to="/login" class="auth-back">← Quay lại đăng nhập</router-link>
        <div class="auth-header">
          <h1>Đặt mật khẩu mới</h1>
          <p>Chọn mật khẩu mới có ít nhất 8 ký tự cho tài khoản của bạn.</p>
        </div>
        <va-alert v-if="errorMessage" color="danger" class="mb-4" role="alert">
          {{ errorMessage }}
        </va-alert>
        <va-alert v-if="isComplete" color="success" class="mb-4" role="status">
          Mật khẩu đã được cập nhật. Bạn có thể đăng nhập bằng mật khẩu mới.
        </va-alert>
        <va-alert v-else-if="!isLinkValid" color="warning" class="mb-4" role="status">
          Liên kết không hợp lệ hoặc đã hết hạn. Hãy yêu cầu gửi lại liên kết đặt lại mật khẩu.
        </va-alert>
        <form v-if="isLinkValid && !isComplete" novalidate @submit.prevent="handleSubmit">
          <div class="input-group mb-4">
            <span class="form-label" id="new-password-label">Mật khẩu mới</span>
            <va-input v-model="password" input-aria-labelledby="new-password-label" type="password" autocomplete="new-password" placeholder="Ít nhất 8 ký tự" size="large" class="w-full" />
          </div>
          <div class="input-group mb-5">
            <span class="form-label" id="confirm-password-label">Xác nhận mật khẩu</span>
            <va-input v-model="confirmPassword" input-aria-labelledby="confirm-password-label" type="password" autocomplete="new-password" placeholder="Nhập lại mật khẩu mới" size="large" class="w-full" />
          </div>
          <va-button type="submit" class="auth-submit w-full" size="large" :loading="isSubmitting" :disabled="isSubmitting">
            Cập nhật mật khẩu
          </va-button>
        </form>
        <div v-if="isComplete || !isLinkValid" class="auth-footer">
          <router-link :to="isComplete ? '/login' : '/forgot-password'" class="auth-link">
            {{ isComplete ? 'Đăng nhập' : 'Gửi liên kết mới' }}
          </router-link>
        </div>
      </div>
    </div>
  </main>
</template>

<script setup lang="ts">
import { ref } from 'vue'
import { VaAlert, VaButton, VaInput } from 'vuestic-ui'

import { ApiError, api } from '../../api/client'

const email = ref('')
const errorMessage = ref('')
const successMessage = ref('')
const isRegistered = ref<boolean | null>(null)
const isSubmitting = ref(false)
const EMAIL_PATTERN = /^[^\s@]+@[^\s@]+\.[^\s@]+$/

async function handleSubmit() {
  errorMessage.value = ''
  successMessage.value = ''
  isRegistered.value = null
  const normalizedEmail = email.value.trim()
  if (!EMAIL_PATTERN.test(normalizedEmail)) {
    errorMessage.value = 'Vui lòng nhập địa chỉ email hợp lệ'
    return
  }

  isSubmitting.value = true
  try {
    const result = await api.post<{ message: string; registered: boolean }>(
      '/auth/forgot-password',
      { email: normalizedEmail },
      false,
    )
    successMessage.value = result.message
    isRegistered.value = result.registered
  } catch (error) {
    errorMessage.value = error instanceof ApiError ? error.message : 'Không thể gửi yêu cầu. Vui lòng thử lại'
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
          <h1>Quên mật khẩu</h1>
          <p>Nhập email tài khoản để nhận liên kết đặt lại mật khẩu.</p>
        </div>
        <form novalidate @submit.prevent="handleSubmit">
          <va-alert v-if="errorMessage" color="danger" class="mb-4" role="alert">
            {{ errorMessage }}
          </va-alert>
          <va-alert v-if="successMessage" :color="isRegistered ? 'success' : 'warning'" class="mb-4" role="status">
            {{ successMessage }}
          </va-alert>
          <div class="input-group mb-5">
            <span class="form-label" id="forgot-email-label">Địa chỉ Email</span>
            <va-input
              v-model="email"
              input-aria-labelledby="forgot-email-label"
              type="email"
              autocomplete="email"
              placeholder="ví dụ: admin@thuysan.vn"
              size="large"
              class="w-full"
            />
          </div>
          <va-button type="submit" class="auth-submit w-full" size="large" :loading="isSubmitting" :disabled="isSubmitting">
            Gửi liên kết đặt lại mật khẩu
          </va-button>
        </form>
      </div>
    </div>
  </main>
</template>

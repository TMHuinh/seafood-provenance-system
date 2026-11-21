<script setup lang="ts">
import { computed, nextTick, ref } from 'vue'
import { useRoute, useRouter } from 'vue-router'
import { VaAlert, VaButton, VaInput } from 'vuestic-ui'

import { ApiError } from '../../api/client'
import { useAuthStore } from '../../stores/auth.store'

const authStore = useAuthStore()
const router = useRouter()
const route = useRoute()

const email = ref('')
const password = ref('')
const errorMessage = ref('')
const isPasswordVisible = ref(false)

const fieldErrors = ref<{ email?: string; password?: string }>({})

const isSubmitting = computed(() => authStore.loading)

const EMAIL_PATTERN = /^[^\s@]+@[^\s@]+\.[^\s@]+$/

function validate(): boolean {
  const errors: { email?: string; password?: string } = {}

  if (!email.value.trim()) {
    errors.email = 'Vui lòng nhập email'
  } else if (!EMAIL_PATTERN.test(email.value.trim())) {
    errors.email = 'Email không hợp lệ'
  }

  if (!password.value) {
    errors.password = 'Vui lòng nhập mật khẩu'
  }

  fieldErrors.value = errors
  return Object.keys(errors).length === 0
}

async function handleSubmit(event: SubmitEvent) {
  errorMessage.value = ''
  if (!validate()) {
    const form = event.currentTarget as HTMLFormElement
    await nextTick()
    form.querySelector<HTMLElement>('[aria-invalid="true"]')?.focus()
    return
  }

  try {
    await authStore.login(email.value.trim(), password.value)
    const redirect = typeof route.query.redirect === 'string' ? route.query.redirect : '/'
    await router.push(redirect)
  } catch (error) {
    errorMessage.value =
      error instanceof ApiError ? error.message : 'Đăng nhập thất bại. Vui lòng thử lại'
  }
}
</script>

<template>
  <main class="auth-layout">
    <!-- Cột thương hiệu (Bên trái) -->
    <div class="auth-hero">
      <div class="hero-content">
        <p class="auth-brand">Thủy sản Xanh</p>
        <p class="hero-title">Từ vùng nuôi đến niềm tin.</p>
        <p class="hero-tagline">
          Kết nối từng công đoạn. Theo dõi từng lô hàng. Minh bạch nguồn gốc thủy sản.
        </p>
      </div>

      <!-- Lớp phủ trang trí (Overlay) -->
    </div>

    <!-- Cột đăng nhập (Bên phải) -->
    <div class="auth-panel">
      <div class="auth-form-container">
        <router-link to="/" class="auth-back">← Thủy sản Xanh</router-link>
        <div class="auth-header">
          <h1>Đăng nhập</h1>
          <p>Chào mừng bạn trở lại, vui lòng nhập thông tin tài khoản</p>
        </div>

        <form novalidate @submit.prevent="handleSubmit">
          <va-alert v-if="errorMessage" color="danger" class="mb-4 alert-smooth" role="alert">
            {{ errorMessage }}
          </va-alert>

          <div class="input-group mb-4">
            <span class="form-label" id="login-email-label">Địa chỉ Email</span>
            <va-input
              input-aria-labelledby="login-email-label"
              v-model="email"
              type="email"
              autocomplete="email"
              placeholder="ví dụ: admin@thuysan.vn"
              :error="Boolean(fieldErrors.email)"
              :error-messages="fieldErrors.email"
              size="large"
              class="w-full"
              @update:model-value="fieldErrors.email = ''"
            >
              <template #prependInner>
                <svg
                  viewBox="0 0 24 24"
                  width="20"
                  height="20"
                  fill="none"
                  stroke="#94a3b8"
                  stroke-width="2"
                  stroke-linecap="round"
                  stroke-linejoin="round"
                >
                  <path
                    d="M4 4h16c1.1 0 2 .9 2 2v12c0 1.1-.9 2-2 2H4c-1.1 0-2-.9-2-2V6c0-1.1.9-2 2-2z"
                  ></path>
                  <polyline points="22,6 12,13 2,6"></polyline>
                </svg>
              </template>
            </va-input>
          </div>

          <div class="input-group mb-5">
            <div class="password-header">
              <span class="form-label" id="login-password-label">Mật khẩu</span>
            </div>
            <va-input
              input-aria-labelledby="login-password-label"
              v-model="password"
              :type="isPasswordVisible ? 'text' : 'password'"
              placeholder="••••••••"
              autocomplete="current-password"
              :error="Boolean(fieldErrors.password)"
              :error-messages="fieldErrors.password"
              size="large"
              class="w-full"
            >
              <template #prependInner>
                <svg
                  viewBox="0 0 24 24"
                  width="20"
                  height="20"
                  fill="none"
                  stroke="#94a3b8"
                  stroke-width="2"
                  stroke-linecap="round"
                  stroke-linejoin="round"
                >
                  <rect x="3" y="11" width="18" height="11" rx="2" ry="2"></rect>
                  <path d="M7 11V7a5 5 0 0 1 10 0v4"></path>
                </svg>
              </template>
              <template #appendInner>
                <button
                  type="button"
                  class="eye-toggle"
                  :aria-label="isPasswordVisible ? 'Ẩn mật khẩu' : 'Hiện mật khẩu'"
                  @click="isPasswordVisible = !isPasswordVisible"
                >
                  <svg
                    v-if="isPasswordVisible"
                    viewBox="0 0 24 24"
                    width="20"
                    height="20"
                    fill="none"
                    stroke="currentColor"
                    stroke-width="2"
                    stroke-linecap="round"
                    stroke-linejoin="round"
                  >
                    <path
                      d="M17.94 17.94A10.07 10.07 0 0 1 12 20c-7 0-11-8-11-8a18.45 18.45 0 0 1 5.06-5.94M9.9 4.24A9.12 9.12 0 0 1 12 4c7 0 11 8 11 8a18.5 18.5 0 0 1-2.16 3.19m-6.72-1.07a3 3 0 1 1-4.24-4.24"
                    ></path>
                    <line x1="1" y1="1" x2="23" y2="23"></line>
                  </svg>
                  <svg
                    v-else
                    viewBox="0 0 24 24"
                    width="20"
                    height="20"
                    fill="none"
                    stroke="currentColor"
                    stroke-width="2"
                    stroke-linecap="round"
                    stroke-linejoin="round"
                  >
                    <path d="M1 12s4-8 11-8 11 8 11 8-4 8-11 8-11-8-11-8z"></path>
                    <circle cx="12" cy="12" r="3"></circle>
                  </svg>
                </button>
              </template>
            </va-input>
          </div>

          <va-button
            type="submit"
            class="auth-submit w-full"
            size="large"
            :loading="isSubmitting"
            :disabled="isSubmitting"
          >
            Đăng nhập ngay
          </va-button>
        </form>

        <div class="auth-footer">
          Chưa có tài khoản?
          <router-link to="/register" class="auth-link">Tạo tài khoản mới</router-link>
        </div>
      </div>
    </div>
  </main>
</template>

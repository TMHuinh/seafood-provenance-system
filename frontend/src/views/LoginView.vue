<script setup lang="ts">
import { computed, ref } from 'vue'
import { useRoute, useRouter } from 'vue-router'
import { VaButton, VaInput } from 'vuestic-ui'

import { ApiError } from '../lib/api'
import { useAuthStore } from '../stores/auth'

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

async function handleSubmit() {
  errorMessage.value = ''
  if (!validate()) return

  try {
    await authStore.login(email.value.trim(), password.value)
    const redirect = typeof route.query.redirect === 'string' ? route.query.redirect : '/'
    await router.push(redirect)
  } catch (error) {
    errorMessage.value = error instanceof ApiError ? error.message : 'Đăng nhập thất bại. Vui lòng thử lại'
  }
}
</script>

<template>
  <div class="auth-page">
    <div class="auth-brand">
      <div class="brand-badge">
        <svg viewBox="0 0 24 24" width="28" height="28" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round">
          <path d="M3 17c3-6 7-9 10-10-3 2-4 5-4 7 2-2 5-3 8-2" />
          <path d="M15 12c-2-4-1-8 2-9-1 4 0 7 4 8" />
        </svg>
      </div>
      <h1 class="auth-title">Hệ thống truy xuất<br />nguồn gốc thủy sản</h1>
      <p class="auth-tagline">
        Minh bạch từ ao nuôi đến bàn ăn. Dữ liệu được lưu tại nơi ghi chép,
        tính bất biến được bảo đảm trên chuỗi khối.
      </p>
    </div>

    <div class="auth-panel">
      <va-card class="auth-card">
        <div class="auth-card-header">
          <h2 class="auth-title">Đăng nhập</h2>
          <p class="auth-subtitle">Chào mừng trở lại, vui lòng nhập thông tin tài khoản</p>
        </div>

        <form novalidate @submit.prevent="handleSubmit">
          <va-alert v-if="errorMessage" color="danger" class="mb-4">
            {{ errorMessage }}
          </va-alert>

          <div class="mb-3">
            <label class="form-label" for="login-email">Email</label>
            <va-input
              id="login-email"
              v-model="email"
              type="email"
              placeholder="email@vidu.com"
              :error="Boolean(fieldErrors.email)"
              :error-messages="fieldErrors.email"
              :autofocus="true"
              @update:model-value="fieldErrors.email = ''"
            />
          </div>

          <div class="mb-4">
            <label class="form-label" for="login-password">Mật khẩu</label>
            <va-input
              id="login-password"
              v-model="password"
              :type="isPasswordVisible ? 'text' : 'password'"
              placeholder="••••••••"
              autocomplete="current-password"
              :error="Boolean(fieldErrors.password)"
              :error-messages="fieldErrors.password"
            >
              <template #append>
                <button
                  type="button"
                  class="eye-toggle"
                  :aria-label="isPasswordVisible ? 'Ẩn mật khẩu' : 'Hiện mật khẩu'"
                  @click="isPasswordVisible = !isPasswordVisible"
                >
                  <svg v-if="isPasswordVisible" viewBox="0 0 24 24" width="20" height="20" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round">
                    <path d="M3 3l18 18" />
                    <path d="M10.5 5.2A10.9 10.9 0 0 1 12 5c7 0 10 7 10 7a17.6 17.6 0 0 1-2.2 3.1" />
                    <path d="M6.6 6.6C3.3 8.6 2 12 2 12s3 7 10 7a10.9 10.9 0 0 0 4.4-.9" />
                    <path d="M9.9 9.9a3 3 0 0 0 4.2 4.2" />
                  </svg>
                  <svg v-else viewBox="0 0 24 24" width="20" height="20" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round">
                    <path d="M2 12s3-7 10-7 10 7 10 7-3 7-10 7-10-7-10-7z" />
                    <circle cx="12" cy="12" r="3" />
                  </svg>
                </button>
              </template>
            </va-input>
          </div>

          <va-button
            type="submit"
            class="auth-submit"
            size="large"
            :loading="isSubmitting"
            :disabled="isSubmitting"
          >
            Đăng nhập
          </va-button>
        </form>

        <div class="auth-redirect">
          Chưa có tài khoản?
          <router-link to="/register" class="auth-link">Đăng ký ngay</router-link>
        </div>
      </va-card>
    </div>
  </div>
</template>

<style scoped>
.auth-page {
  min-height: calc(100vh - 72px);
  display: flex;
  align-items: stretch;
  gap: 3rem;
  padding: 3rem 2rem;
  max-width: 1080px;
  margin: 0 auto;
}

.auth-brand {
  flex: 1 1 45%;
  display: flex;
  flex-direction: column;
  justify-content: center;
  gap: 1.25rem;
  padding: 2rem 1rem;
}

.brand-badge {
  width: 56px;
  height: 56px;
  border-radius: 16px;
  background: linear-gradient(135deg, #0e7490, #14b8a6);
  color: #fff;
  display: flex;
  align-items: center;
  justify-content: center;
  box-shadow: 0 12px 32px rgba(14, 116, 144, 0.35);
}

.auth-brand h1 {
  font-size: 2.1rem;
  line-height: 1.25;
  color: #0f172a;
  font-weight: 700;
  margin: 0;
}

.auth-tagline {
  color: #475569;
  font-size: 1.02rem;
  line-height: 1.7;
  max-width: 42ch;
  margin: 0;
}

.auth-panel {
  flex: 1 1 40%;
  display: flex;
  align-items: center;
  justify-content: center;
}

.auth-card {
  width: 100%;
  max-width: 420px;
  border-radius: 16px;
  box-shadow: 0 18px 48px rgba(15, 23, 42, 0.08);
}

.auth-card-header {
  margin-bottom: 1.4rem;
}

.auth-title {
  margin: 0 0 0.25rem;
  font-size: 1.5rem;
  color: #0f172a;
}

.auth-subtitle {
  margin: 0;
  color: #64748b;
  font-size: 0.9rem;
}

.form-label {
  display: block;
  font-size: 0.86rem;
  font-weight: 600;
  color: #334155;
  margin-bottom: 0.4rem;
}

.auth-submit {
  width: 100%;
}

.auth-redirect {
  margin-top: 1.4rem;
  text-align: center;
  color: #64748b;
  font-size: 0.92rem;
}

.auth-link {
  color: #0e7490;
  font-weight: 600;
  text-decoration: none;
}

.eye-toggle {
  background: none;
  border: none;
  padding: 4px;
  color: #94a3b8;
  cursor: pointer;
  display: flex;
  align-items: center;
}

.mb-3 {
  margin-bottom: 1rem;
}

.mb-4 {
  margin-bottom: 1.5rem;
}

@media (max-width: 900px) {
  .auth-page {
    flex-direction: column;
    padding: 2rem 1.25rem;
    gap: 2rem;
  }
  .auth-brand {
    padding: 0.5rem 0;
  }
  .auth-brand h1 {
    font-size: 1.7rem;
  }
}
</style>
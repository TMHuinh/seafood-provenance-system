<script setup lang="ts">
import { computed, ref } from 'vue'
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
  <div class="auth-layout">
    <!-- Cột thương hiệu (Bên trái) -->
    <div class="auth-hero">
      <div class="hero-content">
        <div class="brand-badge">
          <svg viewBox="0 0 24 24" width="36" height="36" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round">
            <path d="M3 17c3-6 7-9 10-10-3 2-4 5-4 7 2-2 5-3 8-2" />
            <path d="M15 12c-2-4-1-8 2-9-1 4 0 7 4 8" />
          </svg>
        </div>
        <h1 class="hero-title">Hệ thống truy xuất<br />nguồn gốc thủy sản</h1>
        <p class="hero-tagline">
          Theo dõi vùng nuôi, nhật ký chăm sóc và hành trình bàn giao. Đối chiếu các bản ghi với dữ liệu Blockchain khi có kết quả xác thực.
        </p>
        
        <div class="hero-features">
          <div class="feature-item">
            <span class="feature-icon">✓</span> Theo dõi hồ sơ theo lô
          </div>
          <div class="feature-item">
            <span class="feature-icon">✓</span> Phân quyền theo vai trò
          </div>
        </div>
      </div>
      
      <!-- Lớp phủ trang trí (Overlay) -->
      <div class="hero-overlay"></div>
    </div>

    <!-- Cột đăng nhập (Bên phải) -->
    <div class="auth-panel">
      <div class="auth-form-container">
        <router-link to="/" class="auth-back">← Thủy sản Xanh</router-link>
        <div class="auth-header">
          <h2>Đăng nhập hệ thống</h2>
          <p>Chào mừng bạn trở lại, vui lòng nhập thông tin tài khoản</p>
        </div>

        <form novalidate @submit.prevent="handleSubmit">
          <va-alert v-if="errorMessage" color="danger" class="mb-4 alert-smooth" role="alert">
            {{ errorMessage }}
          </va-alert>

          <div class="input-group mb-4">
            <label class="form-label" for="login-email">Địa chỉ Email</label>
            <va-input
              id="login-email"
              v-model="email"
              type="email"
              autocomplete="email"
              placeholder="ví dụ: admin@thuysan.vn"
              :error="Boolean(fieldErrors.email)"
              :error-messages="fieldErrors.email"
              :autofocus="true"
              size="large"
              class="w-full"
              @update:model-value="fieldErrors.email = ''"
            >
              <template #prependInner>
                <svg viewBox="0 0 24 24" width="20" height="20" fill="none" stroke="#94a3b8" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
                  <path d="M4 4h16c1.1 0 2 .9 2 2v12c0 1.1-.9 2-2 2H4c-1.1 0-2-.9-2-2V6c0-1.1.9-2 2-2z"></path>
                  <polyline points="22,6 12,13 2,6"></polyline>
                </svg>
              </template>
            </va-input>
          </div>

          <div class="input-group mb-5">
            <div class="password-header">
              <label class="form-label" for="login-password">Mật khẩu</label>
            </div>
            <va-input
              id="login-password"
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
                <svg viewBox="0 0 24 24" width="20" height="20" fill="none" stroke="#94a3b8" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
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
                  <svg v-if="isPasswordVisible" viewBox="0 0 24 24" width="20" height="20" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
                    <path d="M17.94 17.94A10.07 10.07 0 0 1 12 20c-7 0-11-8-11-8a18.45 18.45 0 0 1 5.06-5.94M9.9 4.24A9.12 9.12 0 0 1 12 4c7 0 11 8 11 8a18.5 18.5 0 0 1-2.16 3.19m-6.72-1.07a3 3 0 1 1-4.24-4.24"></path>
                    <line x1="1" y1="1" x2="23" y2="23"></line>
                  </svg>
                  <svg v-else viewBox="0 0 24 24" width="20" height="20" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
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
  </div>
</template>

<style scoped>
/* Reset & Utility */
.w-full {
  width: 100%;
}
.mb-4 {
  margin-bottom: 1.25rem;
}
.mb-5 {
  margin-bottom: 2rem;
}

/* Layout chính */
.auth-layout {
  display: flex;
  min-height: 100vh;
  width: 100%;
  background-color: var(--app-canvas);
  font-family: 'Inter', system-ui, -apple-system, sans-serif;
}

/* --- Cột Bên Trái (Thương hiệu) --- */
.auth-hero {
  position: relative;
  flex: 1;
  display: none; /* Ẩn trên mobile */
  background: linear-gradient(135deg, #17383d 0%, var(--app-primary) 100%);
  color: white;
  padding: 4rem;
  overflow: hidden;
}

@media (min-width: 1024px) {
  .auth-hero {
    display: flex;
    flex-direction: column;
    justify-content: center;
  }
}

.hero-content {
  position: relative;
  z-index: 10;
  max-width: 480px;
}

.brand-badge {
  width: 72px;
  height: 72px;
  border-radius: 20px;
  background: rgba(255, 255, 255, 0.1);
  backdrop-filter: blur(10px);
  border: 1px solid rgba(255, 255, 255, 0.2);
  display: flex;
  align-items: center;
  justify-content: center;
  margin-bottom: 2.5rem;
  box-shadow: 0 8px 32px rgba(0, 0, 0, 0.1);
}

.hero-title {
  font-size: 3rem;
  font-weight: 800;
  line-height: 1.2;
  margin-bottom: 1.5rem;
  letter-spacing: -0.02em;
}

.hero-tagline {
  font-size: 1.125rem;
  line-height: 1.7;
  color: #cbd5e1;
  margin-bottom: 3rem;
}

.hero-features {
  display: flex;
  flex-direction: column;
  gap: 1rem;
}

.feature-item {
  display: flex;
  align-items: center;
  gap: 0.75rem;
  font-size: 1rem;
  color: #f1f5f9;
}

.feature-icon {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  width: 24px;
  height: 24px;
  border-radius: 50%;
  background: #31a98f;
  color: white;
  font-size: 0.8rem;
  font-weight: bold;
}

/* Đồ họa trang trí nền */
.hero-overlay {
  position: absolute;
  top: 0;
  left: 0;
  right: 0;
  bottom: 0;
  background-image: radial-gradient(circle at 100% 100%, rgba(20, 184, 166, 0.15) 0%, transparent 50%), 
                    radial-gradient(circle at 0% 0%, rgba(255, 255, 255, 0.05) 0%, transparent 50%);
  pointer-events: none;
}

/* --- Cột Bên Phải (Form đăng nhập) --- */
.auth-panel {
  flex: 1;
  display: flex;
  align-items: center;
  justify-content: center;
  padding: 2rem;
}

.auth-form-container {
  width: 100%;
  max-width: 440px;
  background: white;
  padding: 3rem 2.5rem;
  border-radius: 24px;
  box-shadow: 0 20px 40px -15px rgba(15, 23, 42, 0.05), 0 0 10px rgba(15, 23, 42, 0.02);
}

.auth-header {
  text-align: center;
  margin-bottom: 2.5rem;
}

.auth-header h2 {
  font-size: 1.75rem;
  font-weight: 700;
  color: var(--app-ink);
  margin-bottom: 0.5rem;
}

.auth-header p {
  color: var(--app-muted);
  font-size: 0.95rem;
}

/* Căn chỉnh Input */
.form-label {
  display: block;
  font-size: 0.875rem;
  font-weight: 600;
  color: #334155;
  margin-bottom: 0.5rem;
}

.password-header {
  display: flex;
  justify-content: space-between;
  align-items: center;
}

.forgot-link {
  font-size: 0.875rem;
  color: var(--app-primary);
  text-decoration: none;
  font-weight: 500;
  transition: color 0.2s ease;
}

.forgot-link:hover {
  color: #0e8a7d;
  text-decoration: underline;
}

.eye-toggle {
  background: none;
  border: none;
  color: var(--app-muted);
  cursor: pointer;
  display: flex;
  align-items: center;
  padding: 4px;
  transition: color 0.2s ease;
}

.eye-toggle:hover {
  color: var(--app-ink);
}

/* Nút Submit */
.auth-submit {
  border-radius: 12px;
  font-weight: 600;
  letter-spacing: 0.5px;
  box-shadow: 0 4px 14px 0 rgba(14, 116, 144, 0.25);
  transition: all 0.3s ease;
}

.auth-submit:hover:not(:disabled) {
  transform: translateY(-1px);
  box-shadow: 0 6px 20px 0 rgba(14, 116, 144, 0.3);
}

/* Footer (Đăng ký) */
.auth-footer {
  margin-top: 2rem;
  text-align: center;
  color: var(--app-muted);
  font-size: 0.95rem;
}

.auth-link {
  color: var(--app-primary);
  font-weight: 600;
  text-decoration: none;
  margin-left: 0.25rem;
  transition: color 0.2s;
}

.auth-link:hover {
  color: #0e8a7d;
  text-decoration: underline;
}

/* --- Hoạt ảnh (Animations) --- */
.animate-fade-in {
  animation: fadeIn 0.6s cubic-bezier(0.16, 1, 0.3, 1) forwards;
}

.animate-float {
  animation: float 6s ease-in-out infinite;
}

.alert-smooth {
  animation: slideDown 0.3s ease-out;
}

@keyframes fadeIn {
  from {
    opacity: 0;
    transform: translateY(20px);
  }
  to {
    opacity: 1;
    transform: translateY(0);
  }
}

@keyframes float {
  0% { transform: translateY(0px); }
  50% { transform: translateY(-10px); }
  100% { transform: translateY(0px); }
}

@keyframes slideDown {
  from { opacity: 0; transform: translateY(-10px); }
  to { opacity: 1; transform: translateY(0); }
}

/* Responsive cho Mobile */
@media (max-width: 1023px) {
  .auth-panel {
    padding: 1rem;
  }
  
  .auth-form-container {
    padding: 2rem 1.5rem;
    box-shadow: 0 10px 25px rgba(0, 0, 0, 0.05);
  }
  
  .auth-header h2 {
    font-size: 1.5rem;
  }
}
.auth-back { display: inline-flex; align-items: center; min-height: 44px; margin-bottom: 24px; font-size: 14px; font-weight: 650; color: var(--app-primary-dark); }
.auth-layout { background: var(--app-canvas); }
.auth-panel { padding: 40px 32px; }
.auth-form-container { max-width: 520px; width: 100%; padding: 32px; border: 1px solid var(--app-line); border-radius: 20px; background: white; box-shadow: var(--app-shadow); }
.auth-header h2 { font-size: 28px; font-weight: 650; }
.auth-header p { font-size: 14px; color: var(--app-muted); line-height: 1.6; }
.auth-hero { background: linear-gradient(145deg, #0c3f52, #087f83); padding: 48px; }
.hero-title { font-size: clamp(32px, 3.5vw, 48px); font-weight: 650; }
.auth-form-scroll { max-height: none; overflow: visible; padding-right: 0; }
.eye-toggle { min-width: 44px; min-height: 44px; }
.auth-submit { border-radius: 10px; min-height: 48px; box-shadow: none; }
@media (max-width: 600px) {
  .auth-panel { padding: 24px 16px; align-items: flex-start; }
  .auth-form-container { padding: 24px 20px; }
  .row-inputs { flex-direction: column; gap: 20px; }
  .auth-header h2 { font-size: 24px; }
}
</style>

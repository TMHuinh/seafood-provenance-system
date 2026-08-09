<script setup lang="ts">
import { computed, ref } from 'vue'
import { useRouter } from 'vue-router'
import { VaButton, VaInput, VaSelect } from 'vuestic-ui'

import { ApiError } from '../lib/api'
import { useAuthStore } from '../stores/auth'
import { ORG_TYPE_OPTIONS, ROLE_OPTIONS } from '../types'

const authStore = useAuthStore()
const router = useRouter()

const fullName = ref('')
const email = ref('')
const phone = ref('')
const password = ref('')
const confirmPassword = ref('')
const role = ref<'FARMER' | 'TRANSPORTER' | 'DISTRIBUTOR'>('FARMER')
const joinOrganization = ref(false)
const organizationName = ref('')
const organizationType = ref('')

const errorMessage = ref('')
const successMessage = ref('')
const isPasswordVisible = ref(false)

const fieldErrors = ref<Record<string, string>>({})

const isSubmitting = computed(() => authStore.loading)

const roleOptions = computed(() => ROLE_OPTIONS.map((o) => ({ text: o.label, value: o.value })))
const orgTypeOptions = computed(() =>
  ORG_TYPE_OPTIONS.map((o) => ({ text: o.label, value: o.value })),
)

const EMAIL_PATTERN = /^[^\s@]+@[^\s@]+\.[^\s@]+$/
const PHONE_PATTERN = /^0\d{9,10}$/

function normalizeOption(value: unknown): string | undefined {
  if (typeof value === 'string') return value
  if (value && typeof value === 'object' && 'value' in value) {
    const inner = (value as { value: unknown }).value
    if (typeof inner === 'string') return inner
  }
  return undefined
}

function validate(): boolean {
  const errors: Record<string, string> = {}

  if (!fullName.value.trim()) {
    errors.fullName = 'Vui lòng nhập họ và tên'
  }
  if (!email.value.trim()) {
    errors.email = 'Vui lòng nhập email'
  } else if (!EMAIL_PATTERN.test(email.value.trim())) {
    errors.email = 'Email không hợp lệ'
  }
  if (phone.value.trim() && !PHONE_PATTERN.test(phone.value.trim())) {
    errors.phone = 'Số điện thoại không hợp lệ (VD: 0912345678)'
  }
  if (!password.value) {
    errors.password = 'Vui lòng nhập mật khẩu'
  } else if (password.value.length < 8) {
    errors.password = 'Mật khẩu phải có ít nhất 8 ký tự'
  }
  if (confirmPassword.value !== password.value) {
    errors.confirmPassword = 'Nhập lại mật khẩu không khớp'
  }
  if (joinOrganization.value && !organizationName.value.trim()) {
    errors.organizationName = 'Vui lòng nhập tên tổ chức'
  }

  fieldErrors.value = errors
  return Object.keys(errors).length === 0
}

async function handleSubmit() {
  errorMessage.value = ''
  successMessage.value = ''
  if (!validate()) return

  try {
    const result = await authStore.register({
      fullName: fullName.value.trim(),
      email: email.value.trim(),
      phone: phone.value.trim() || undefined,
      password: password.value,
      role: normalizeOption(role.value) as 'FARMER' | 'TRANSPORTER' | 'DISTRIBUTOR' | undefined,
      organizationName: joinOrganization.value ? organizationName.value.trim() : undefined,
      organizationType: joinOrganization.value ? normalizeOption(organizationType.value) : undefined,
    })

    if (result.requiresConfirmation) {
      successMessage.value =
        'Đăng ký thành công! Vui lòng kiểm tra email để xác nhận tài khoản, sau đó đăng nhập.'
      setTimeout(() => router.push({ name: 'login' }), 2500)
    } else {
      successMessage.value = 'Đăng ký thành công! Đang chuyển hướng...'
      setTimeout(() => router.push({ name: 'home' }), 800)
    }
  } catch (error) {
    errorMessage.value = error instanceof ApiError ? error.message : 'Đăng ký thất bại. Vui lòng thử lại'
  }
}
</script>

<template>
  <div class="auth-page">
    <div class="auth-panel register-panel">
      <va-card class="auth-card">
        <div class="auth-card-header">
          <h2 class="auth-title">Tạo tài khoản</h2>
          <p class="auth-subtitle">Đăng ký để tham gia chuỗi cung ứng minh bạch</p>
        </div>

        <form novalidate @submit.prevent="handleSubmit">
          <va-alert v-if="successMessage" color="success" class="mb-3">
            {{ successMessage }}
          </va-alert>
          <va-alert v-if="errorMessage" color="danger" class="mb-3">
            {{ errorMessage }}
          </va-alert>

          <div class="mb-3">
            <label class="form-label" for="reg-name">Họ và tên</label>
            <va-input
              id="reg-name"
              v-model="fullName"
              placeholder="Nguyễn Văn A"
              :error="Boolean(fieldErrors.fullName)"
              :error-messages="fieldErrors.fullName"
              :autofocus="true"
              @update:model-value="fieldErrors.fullName = ''"
            />
          </div>

          <div class="mb-3">
            <label class="form-label" for="reg-email">Email</label>
            <va-input
              id="reg-email"
              v-model="email"
              type="email"
              placeholder="email@vidu.com"
              :error="Boolean(fieldErrors.email)"
              :error-messages="fieldErrors.email"
              @update:model-value="fieldErrors.email = ''"
            />
          </div>

          <div class="mb-3">
            <label class="form-label" for="reg-phone">Số điện thoại (không bắt buộc)</label>
            <va-input
              id="reg-phone"
              v-model="phone"
              type="tel"
              placeholder="0912345678"
              :error="Boolean(fieldErrors.phone)"
              :error-messages="fieldErrors.phone"
            />
          </div>

          <div class="mb-3">
            <label class="form-label">Vai trò</label>
            <va-select v-model="role" :options="roleOptions" />
          </div>

          <div class="row mb-3">
            <div class="col">
              <label class="form-label" for="reg-password">Mật khẩu</label>
              <va-input
                id="reg-password"
                v-model="password"
                :type="isPasswordVisible ? 'text' : 'password'"
                placeholder="Ít nhất 8 ký tự"
                autocomplete="new-password"
                :error="Boolean(fieldErrors.password)"
                :error-messages="fieldErrors.password"
              />
            </div>
            <div class="col">
              <label class="form-label" for="reg-confirm">Nhập lại mật khẩu</label>
              <va-input
                id="reg-confirm"
                v-model="confirmPassword"
                :type="isPasswordVisible ? 'text' : 'password'"
                placeholder="••••••••"
                autocomplete="new-password"
                :error="Boolean(fieldErrors.confirmPassword)"
                :error-messages="fieldErrors.confirmPassword"
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
          </div>

          <div class="org-toggle">
            <label class="checkbox-label">
              <input v-model="joinOrganization" type="checkbox" class="checkbox" />
              <span>Tôi đại diện cho một tổ chức / doanh nghiệp</span>
            </label>
          </div>

          <template v-if="joinOrganization">
            <div class="mb-3">
              <label class="form-label" for="reg-org-name">Tên tổ chức</label>
              <va-input
                id="reg-org-name"
                v-model="organizationName"
                placeholder="VD: Hợi tác xã nuôi tôm Xanh"
                :error="Boolean(fieldErrors.organizationName)"
                :error-messages="fieldErrors.organizationName"
              />
            </div>
            <div class="mb-4">
              <label class="form-label">Loại tổ chức</label>
              <va-select v-model="organizationType" :options="orgTypeOptions" placeholder="Chọn loại tổ chức" />
            </div>
          </template>

          <va-button
            type="submit"
            class="auth-submit"
            size="large"
            :loading="isSubmitting"
            :disabled="isSubmitting"
          >
            Đăng ký
          </va-button>
        </form>

        <div class="auth-redirect">
          Đã có tài khoản?
          <router-link to="/login" class="auth-link">Đăng nhập</router-link>
        </div>
      </va-card>
    </div>

    <div class="auth-brand">
      <div class="brand-badge">
        <svg viewBox="0 0 24 24" width="28" height="28" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round">
          <path d="M3 17c3-6 7-9 10-10-3 2-4 5-4 7 2-2 5-3 8-2" />
          <path d="M15 12c-2-4-1-8 2-9-1 4 0 7 4 8" />
        </svg>
      </div>
      <h1 class="auth-title">Tham gia chuỗi<br />thủy sản minh bạch</h1>
      <ul class="register-benefits">
        <li>Quản lý lô nuôi, ao trại, thu hoạch đúng chuẩn</li>
        <li>Mỗi sự kiện đều được bảo đảm tính toàn vẹn trên chuỗi khối</li>
        <li>Người tiêu dùng tra cứu nguồn gốc bằng mã QR</li>
      </ul>
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
  max-width: 1180px;
  margin: 0 auto;
}

.auth-panel {
  flex: 1 1 50%;
  display: flex;
  align-items: center;
  justify-content: center;
}

.auth-card {
  width: 100%;
  max-width: 460px;
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

.row {
  display: flex;
  gap: 1rem;
}

.col {
  flex: 1;
}

.org-toggle {
  margin-bottom: 1rem;
}

.checkbox-label {
  display: flex;
  align-items: center;
  gap: 0.5rem;
  font-size: 0.9rem;
  color: #334155;
  cursor: pointer;
}

.checkbox {
  width: 18px;
  height: 18px;
  accent-color: #0e7490;
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

.register-benefits {
  list-style: none;
  padding: 0;
  margin: 0;
  display: flex;
  flex-direction: column;
  gap: 0.8rem;
  color: #475569;
  font-size: 1rem;
}

.register-benefits li {
  display: flex;
  gap: 0.6rem;
  align-items: flex-start;
}

.register-benefits li::before {
  content: '';
  flex-shrink: 0;
  width: 8px;
  height: 8px;
  border-radius: 9999px;
  background: linear-gradient(135deg, #0e7490, #14b8a6);
  margin-top: 0.6rem;
}

.auth-brand {
  flex: 1 1 40%;
  display: flex;
  flex-direction: column;
  justify-content: center;
  gap: 1.4rem;
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
  font-size: 2rem;
  line-height: 1.25;
  color: #0f172a;
  font-weight: 700;
  margin: 0;
}

.mb-3 {
  margin-bottom: 1rem;
}

.mb-4 {
  margin-bottom: 1.5rem;
}

@media (max-width: 960px) {
  .auth-page {
    flex-direction: column-reverse;
    padding: 2rem 1.25rem;
    gap: 1.5rem;
  }
  .brand-badge {
    display: none;
  }
  .register-benefits {
    display: none;
  }
  .row {
    flex-direction: column;
  }
}
</style>
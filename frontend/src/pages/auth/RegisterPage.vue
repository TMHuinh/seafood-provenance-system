<script setup lang="ts">
import { computed, nextTick, ref } from 'vue'
import { useRouter } from 'vue-router'
import { VaAlert, VaButton, VaInput, VaSelect } from 'vuestic-ui'

import { ApiError } from '../../api/client'
import { useAuthStore } from '../../stores/auth.store'
import { ORG_TYPE_OPTIONS, ROLE_OPTIONS } from '../../types'

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

async function handleSubmit(event: SubmitEvent) {
  errorMessage.value = ''
  successMessage.value = ''
  if (!validate()) {
    const form = event.currentTarget as HTMLFormElement
    await nextTick()
    form.querySelector<HTMLElement>('[aria-invalid="true"]')?.focus()
    return
  }

  try {
    const result = await authStore.register({
      fullName: fullName.value.trim(),
      email: email.value.trim(),
      phone: phone.value.trim() || undefined,
      password: password.value,
      role: normalizeOption(role.value) as 'FARMER' | 'TRANSPORTER' | 'DISTRIBUTOR' | undefined,
      organizationName: joinOrganization.value ? organizationName.value.trim() : undefined,
      organizationType: joinOrganization.value
        ? normalizeOption(organizationType.value)
        : undefined,
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
    errorMessage.value =
      error instanceof ApiError ? error.message : 'Đăng ký thất bại. Vui lòng thử lại'
  }
}
</script>

<template>
  <main class="auth-layout">
    <div class="auth-hero">
      <div class="hero-content">
        <p class="auth-brand">Thủy sản Xanh</p>
        <p class="hero-title">Từ vùng nuôi đến niềm tin.</p>
        <p class="hero-tagline">
          Kết nối từng công đoạn. Theo dõi từng lô hàng. Minh bạch nguồn gốc thủy sản.
        </p>
      </div>
    </div>

    <div class="auth-panel">
      <div class="auth-form-container">
        <router-link to="/" class="auth-back">← Thủy sản Xanh</router-link>
        <div class="auth-header">
          <h1>Tạo tài khoản</h1>
          <p>Điền thông tin bên dưới để đăng ký thành viên</p>
        </div>

        <form novalidate @submit.prevent="handleSubmit" class="auth-form-scroll">
          <va-alert v-if="successMessage" color="success" class="mb-4 alert-smooth" role="status">
            {{ successMessage }}
          </va-alert>
          <va-alert v-if="errorMessage" color="danger" class="mb-4 alert-smooth" role="alert">
            {{ errorMessage }}
          </va-alert>

          <div class="input-group mb-4">
            <span class="form-label" id="reg-name-label">Họ và tên</span>
            <va-input
              input-aria-labelledby="reg-name-label"
              v-model="fullName"
              autocomplete="name"
              placeholder="Ví dụ: Nguyễn Văn A"
              :error="Boolean(fieldErrors.fullName)"
              :error-messages="fieldErrors.fullName"
              size="large"
              class="w-full"
              @update:model-value="fieldErrors.fullName = ''"
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
                  <path d="M20 21v-2a4 4 0 0 0-4-4H8a4 4 0 0 0-4 4v2"></path>
                  <circle cx="12" cy="7" r="4"></circle>
                </svg>
              </template>
            </va-input>
          </div>

          <div class="row-inputs mb-4">
            <div class="input-group col">
              <span class="form-label" id="reg-email-label">Email</span>
              <va-input
                input-aria-labelledby="reg-email-label"
                v-model="email"
                type="email"
                autocomplete="email"
                placeholder="email@vidu.com"
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

            <div class="input-group col">
              <span class="form-label" id="reg-phone-label"
                >Số điện thoại <span class="text-optional">(Tùy chọn)</span></span
              >
              <va-input
                input-aria-labelledby="reg-phone-label"
                v-model="phone"
                type="tel"
                autocomplete="tel"
                placeholder="0912345678"
                :error="Boolean(fieldErrors.phone)"
                :error-messages="fieldErrors.phone"
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
                    <path
                      d="M22 16.92v3a2 2 0 0 1-2.18 2 19.79 19.79 0 0 1-8.63-3.07 19.5 19.5 0 0 1-6-6 19.79 19.79 0 0 1-3.07-8.67A2 2 0 0 1 4.11 2h3a2 2 0 0 1 2 1.72 12.84 12.84 0 0 0 .7 2.81 2 2 0 0 1-.45 2.11L8.09 9.91a16 16 0 0 0 6 6l1.27-1.27a2 2 0 0 1 2.11-.45 12.84 12.84 0 0 0 2.81.7A2 2 0 0 1 22 16.92z"
                    ></path>
                  </svg>
                </template>
              </va-input>
            </div>
          </div>

          <h2 class="auth-section-title">Vai trò của bạn</h2>
          <div class="input-group mb-4">
            <label class="form-label" id="register-role-label">Vai trò trong chuỗi cung ứng</label>
            <va-select
              v-model="role"
              :options="roleOptions"
              text-by="text"
              value-by="value"
              aria-labelledby="register-role-label"
              size="large"
              class="w-full select-modern"
            />
          </div>

          <h2 class="auth-section-title">Bảo mật tài khoản</h2>
          <div class="row-inputs mb-4">
            <div class="input-group col">
              <span class="form-label" id="reg-password-label">Mật khẩu</span>
              <va-input
                input-aria-labelledby="reg-password-label"
                v-model="password"
                :type="isPasswordVisible ? 'text' : 'password'"
                placeholder="Tối thiểu 8 ký tự"
                autocomplete="new-password"
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
              </va-input>
            </div>

            <div class="input-group col">
              <span class="form-label" id="reg-confirm-label">Xác nhận mật khẩu</span>
              <va-input
                input-aria-labelledby="reg-confirm-label"
                v-model="confirmPassword"
                :type="isPasswordVisible ? 'text' : 'password'"
                placeholder="••••••••"
                autocomplete="new-password"
                :error="Boolean(fieldErrors.confirmPassword)"
                :error-messages="fieldErrors.confirmPassword"
                size="large"
                class="w-full"
              >
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
          </div>

          <h2 class="auth-section-title">Thông tin tổ chức</h2>
          <div class="org-section mb-4">
            <label class="checkbox-container">
              <input v-model="joinOrganization" type="checkbox" class="modern-checkbox" />
              <span class="checkbox-text">Tôi đại diện cho một tổ chức / doanh nghiệp</span>
            </label>

            <div v-if="joinOrganization" class="org-fields animate-fade-in">
              <div class="input-group mb-3 mt-3">
                <span class="form-label" id="reg-org-name-label">Tên tổ chức</span>
                <va-input
                  input-aria-labelledby="reg-org-name-label"
                  v-model="organizationName"
                  placeholder="VD: Hợp tác xã nuôi tôm Xanh"
                  :error="Boolean(fieldErrors.organizationName)"
                  :error-messages="fieldErrors.organizationName"
                  size="large"
                  class="w-full"
                />
              </div>
              <div class="input-group mb-2">
                <label class="form-label" id="register-organization-type-label"
                  >Loại hình hoạt động</label
                >
                <va-select
                  v-model="organizationType"
                  :options="orgTypeOptions"
                  text-by="text"
                  value-by="value"
                  aria-labelledby="register-organization-type-label"
                  placeholder="Chọn loại tổ chức..."
                  size="large"
                  class="w-full select-modern"
                />
              </div>
            </div>
          </div>

          <va-button
            type="submit"
            class="auth-submit w-full"
            size="large"
            :loading="isSubmitting"
            :disabled="isSubmitting"
          >
            Đăng ký tài khoản
          </va-button>
        </form>

        <div class="auth-footer">
          Đã có tài khoản?
          <router-link to="/login" class="auth-link">Đăng nhập ngay</router-link>
        </div>
      </div>
    </div>
  </main>
</template>

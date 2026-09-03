<script setup lang="ts">
import { computed, ref } from 'vue'
import { useRouter } from 'vue-router'
import { VaButton, VaInput, VaSelect } from 'vuestic-ui'

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
  <div class="auth-layout">
    <div class="auth-hero">
      <div class="hero-content">
        <div class="brand-badge animate-float">
          <svg viewBox="0 0 24 24" width="36" height="36" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round">
            <path d="M3 17c3-6 7-9 10-10-3 2-4 5-4 7 2-2 5-3 8-2" />
            <path d="M15 12c-2-4-1-8 2-9-1 4 0 7 4 8" />
          </svg>
        </div>
        <h1 class="hero-title">Tham gia chuỗi<br />thủy sản minh bạch</h1>
        <p class="hero-tagline">
          Khởi tạo tài khoản để kết nối vào hệ sinh thái truy xuất nguồn gốc chuẩn quốc tế.
        </p>
        
        <div class="hero-features">
          <div class="feature-item">
            <span class="feature-icon">✓</span> Quản lý lô nuôi, ao trại, thu hoạch đúng chuẩn
          </div>
          <div class="feature-item">
            <span class="feature-icon">✓</span> Mỗi sự kiện được bảo đảm toàn vẹn trên Blockchain
          </div>
          <div class="feature-item">
            <span class="feature-icon">✓</span> Người tiêu dùng dễ dàng tra cứu bằng mã QR
          </div>
        </div>
      </div>
      
      <div class="hero-overlay"></div>
    </div>

    <div class="auth-panel">
      <div class="auth-form-container animate-fade-in">
        <div class="auth-header">
          <h2>Tạo tài khoản mới</h2>
          <p>Điền thông tin bên dưới để đăng ký thành viên</p>
        </div>

        <form novalidate @submit.prevent="handleSubmit" class="auth-form-scroll">
          <va-alert v-if="successMessage" color="success" class="mb-4 alert-smooth">
            {{ successMessage }}
          </va-alert>
          <va-alert v-if="errorMessage" color="danger" class="mb-4 alert-smooth">
            {{ errorMessage }}
          </va-alert>

          <div class="input-group mb-4">
            <label class="form-label" for="reg-name">Họ và tên</label>
            <va-input
              id="reg-name"
              v-model="fullName"
              placeholder="Ví dụ: Nguyễn Văn A"
              :error="Boolean(fieldErrors.fullName)"
              :error-messages="fieldErrors.fullName"
              :autofocus="true"
              size="large"
              class="w-full"
              @update:model-value="fieldErrors.fullName = ''"
            >
              <template #prependInner>
                <svg viewBox="0 0 24 24" width="20" height="20" fill="none" stroke="#94a3b8" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
                  <path d="M20 21v-2a4 4 0 0 0-4-4H8a4 4 0 0 0-4 4v2"></path>
                  <circle cx="12" cy="7" r="4"></circle>
                </svg>
              </template>
            </va-input>
          </div>

          <div class="row-inputs mb-4">
            <div class="input-group col">
              <label class="form-label" for="reg-email">Email</label>
              <va-input
                id="reg-email"
                v-model="email"
                type="email"
                placeholder="email@vidu.com"
                :error="Boolean(fieldErrors.email)"
                :error-messages="fieldErrors.email"
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
            
            <div class="input-group col">
              <label class="form-label" for="reg-phone">Số điện thoại <span class="text-optional">(Tùy chọn)</span></label>
              <va-input
                id="reg-phone"
                v-model="phone"
                type="tel"
                placeholder="0912345678"
                :error="Boolean(fieldErrors.phone)"
                :error-messages="fieldErrors.phone"
                size="large"
                class="w-full"
              >
                <template #prependInner>
                  <svg viewBox="0 0 24 24" width="20" height="20" fill="none" stroke="#94a3b8" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
                    <path d="M22 16.92v3a2 2 0 0 1-2.18 2 19.79 19.79 0 0 1-8.63-3.07 19.5 19.5 0 0 1-6-6 19.79 19.79 0 0 1-3.07-8.67A2 2 0 0 1 4.11 2h3a2 2 0 0 1 2 1.72 12.84 12.84 0 0 0 .7 2.81 2 2 0 0 1-.45 2.11L8.09 9.91a16 16 0 0 0 6 6l1.27-1.27a2 2 0 0 1 2.11-.45 12.84 12.84 0 0 0 2.81.7A2 2 0 0 1 22 16.92z"></path>
                  </svg>
                </template>
              </va-input>
            </div>
          </div>

          <div class="input-group mb-4">
            <label class="form-label">Vai trò trong chuỗi cung ứng</label>
            <va-select 
              v-model="role" 
              :options="roleOptions" 
              size="large" 
              class="w-full select-modern"
            />
          </div>

          <div class="row-inputs mb-4">
            <div class="input-group col">
              <label class="form-label" for="reg-password">Mật khẩu</label>
              <va-input
                id="reg-password"
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
                  <svg viewBox="0 0 24 24" width="20" height="20" fill="none" stroke="#94a3b8" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
                    <rect x="3" y="11" width="18" height="11" rx="2" ry="2"></rect>
                    <path d="M7 11V7a5 5 0 0 1 10 0v4"></path>
                  </svg>
                </template>
              </va-input>
            </div>
            
            <div class="input-group col">
              <label class="form-label" for="reg-confirm">Xác nhận mật khẩu</label>
              <va-input
                id="reg-confirm"
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
                    :aria-label="isPasswordVisible ? 'Ẩn' : 'Hiện'"
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
          </div>

          <div class="org-section mb-4">
            <label class="checkbox-container">
              <input v-model="joinOrganization" type="checkbox" class="modern-checkbox" />
              <span class="checkmark"></span>
              <span class="checkbox-text">Tôi đại diện cho một tổ chức / doanh nghiệp</span>
            </label>

            <div v-if="joinOrganization" class="org-fields animate-fade-in">
              <div class="input-group mb-3 mt-3">
                <label class="form-label" for="reg-org-name">Tên tổ chức</label>
                <va-input
                  id="reg-org-name"
                  v-model="organizationName"
                  placeholder="VD: Hợp tác xã nuôi tôm Xanh"
                  :error="Boolean(fieldErrors.organizationName)"
                  :error-messages="fieldErrors.organizationName"
                  size="large"
                  class="w-full"
                />
              </div>
              <div class="input-group mb-2">
                <label class="form-label">Loại hình hoạt động</label>
                <va-select 
                  v-model="organizationType" 
                  :options="orgTypeOptions" 
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
  </div>
</template>

<style scoped>
/* Reset & Utility */
.w-full {
  width: 100%;
}
.mb-2 { margin-bottom: 0.5rem; }
.mb-3 { margin-bottom: 1rem; }
.mb-4 { margin-bottom: 1.25rem; }
.mt-3 { margin-top: 1rem; }
.text-optional { color: #94a3b8; font-weight: 400; font-size: 0.8rem; }

/* Layout chính */
.auth-layout {
  display: flex;
  min-height: 100vh;
  width: 100%;
  background-color: #f8fafc;
  font-family: 'Inter', system-ui, -apple-system, sans-serif;
}

/* --- Cột Bên Trái (Thương hiệu) --- */
.auth-hero {
  position: relative;
  flex: 1;
  display: none; /* Ẩn trên mobile */
  background: linear-gradient(135deg, #0f172a 0%, #0e7490 100%);
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
  max-width: 520px;
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
  gap: 1.25rem;
}

.feature-item {
  display: flex;
  align-items: flex-start;
  gap: 1rem;
  font-size: 1.05rem;
  color: #f1f5f9;
  line-height: 1.5;
}

.feature-icon {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  flex-shrink: 0;
  width: 24px;
  height: 24px;
  border-radius: 50%;
  background: #14b8a6;
  color: white;
  font-size: 0.8rem;
  font-weight: bold;
  margin-top: 0.15rem;
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

/* --- Cột Bên Phải (Form đăng ký) --- */
.auth-panel {
  flex: 1;
  display: flex;
  align-items: center;
  justify-content: center;
  padding: 2rem;
  max-height: 100vh;
  overflow-y: auto;
}

.auth-form-container {
  width: 100%;
  max-width: 520px;
  background: white;
  padding: 3rem 2.5rem;
  border-radius: 24px;
  box-shadow: 0 20px 40px -15px rgba(15, 23, 42, 0.05), 0 0 10px rgba(15, 23, 42, 0.02);
}

.auth-header {
  text-align: center;
  margin-bottom: 2rem;
}

.auth-header h2 {
  font-size: 1.75rem;
  font-weight: 700;
  color: #0f172a;
  margin-bottom: 0.5rem;
}

.auth-header p {
  color: #64748b;
  font-size: 0.95rem;
}

/* Lưới Form (Rows) */
.row-inputs {
  display: flex;
  gap: 1rem;
}

.col {
  flex: 1;
  min-width: 0; /* Ngăn chặn overflow trong flexbox */
}

/* Căn chỉnh Input */
.form-label {
  display: block;
  font-size: 0.875rem;
  font-weight: 600;
  color: #334155;
  margin-bottom: 0.5rem;
}

.eye-toggle {
  background: none;
  border: none;
  color: #94a3b8;
  cursor: pointer;
  display: flex;
  align-items: center;
  padding: 4px;
  transition: color 0.2s ease;
}

.eye-toggle:hover {
  color: #0f172a;
}

/* Checkbox Doanh nghiệp Custom */
.org-section {
  background: #f8fafc;
  padding: 1.25rem;
  border-radius: 12px;
  border: 1px solid #e2e8f0;
}

.checkbox-container {
  display: flex;
  align-items: center;
  position: relative;
  cursor: pointer;
  font-size: 0.95rem;
  user-select: none;
  color: #334155;
  font-weight: 500;
}

.modern-checkbox {
  position: absolute;
  opacity: 0;
  cursor: pointer;
  height: 0;
  width: 0;
}

.checkmark {
  display: flex;
  align-items: center;
  justify-content: center;
  height: 20px;
  width: 20px;
  background-color: #fff;
  border: 2px solid #cbd5e1;
  border-radius: 6px;
  margin-right: 12px;
  transition: all 0.2s ease;
  flex-shrink: 0;
}

.checkbox-container:hover .modern-checkbox ~ .checkmark {
  border-color: #0e7490;
}

.modern-checkbox:checked ~ .checkmark {
  background-color: #0e7490;
  border-color: #0e7490;
}

.checkmark:after {
  content: "";
  display: none;
}

.modern-checkbox:checked ~ .checkmark:after {
  display: block;
}

.checkmark:after {
  width: 5px;
  height: 10px;
  border: solid white;
  border-width: 0 2px 2px 0;
  transform: rotate(45deg);
  margin-bottom: 2px;
}

.org-fields {
  margin-top: 0.5rem;
  border-top: 1px dashed #cbd5e1;
  padding-top: 0.5rem;
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

/* Footer (Đăng nhập) */
.auth-footer {
  margin-top: 2rem;
  text-align: center;
  color: #64748b;
  font-size: 0.95rem;
}

.auth-link {
  color: #0e7490;
  font-weight: 600;
  text-decoration: none;
  margin-left: 0.25rem;
  transition: color 0.2s;
}

.auth-link:hover {
  color: #14b8a6;
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
  from { opacity: 0; transform: translateY(15px); }
  to { opacity: 1; transform: translateY(0); }
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
    align-items: flex-start; /* Cho phép scroll dễ dàng hơn trên màn hình nhỏ */
  }
  
  .auth-form-container {
    padding: 2rem 1.5rem;
    box-shadow: 0 10px 25px rgba(0, 0, 0, 0.05);
    margin-top: 1rem;
  }
  
  .auth-header h2 {
    font-size: 1.5rem;
  }

  .row-inputs {
    flex-direction: column;
    gap: 0;
  }

  .row-inputs .col {
    margin-bottom: 1.25rem;
  }
  
  .row-inputs .col:last-child {
    margin-bottom: 0;
  }
}
</style>
<script setup lang="ts">
import { computed, onMounted, ref } from 'vue'
import { VaAlert, VaButton, VaIcon, VaInput, VaSelect } from 'vuestic-ui'

import PageHeader from '../../components/PageHeader.vue'
import { ApiError, api } from '../../api/client'
import { useAuthStore } from '../../stores/auth.store'
import type { Role, UserProfile } from '../../types'
import { ROLE_LABELS } from '../../types'

type EditableUser = UserProfile & { saveError?: string; saved?: boolean }

const users = ref<EditableUser[]>([])
const authStore = useAuthStore()
const search = ref('')
const loading = ref(false)
const loadError = ref('')
const savingIds = ref<string[]>([])

const roleOptions: { value: Role; text: string }[] = [
  { value: 'ADMIN', text: ROLE_LABELS.ADMIN },
  { value: 'FARMER', text: ROLE_LABELS.FARMER },
  { value: 'TRANSPORTER', text: ROLE_LABELS.TRANSPORTER },
  { value: 'DISTRIBUTOR', text: ROLE_LABELS.DISTRIBUTOR },
]

const rolePermissions: { role: Role; description: string }[] = [
  { role: 'ADMIN', description: 'Quản lý tài khoản và theo dõi dữ liệu toàn hệ thống.' },
  { role: 'FARMER', description: 'Quản lý cơ sở, ao nuôi, vụ nuôi, nhật ký và thu hoạch.' },
  { role: 'TRANSPORTER', description: 'Nhận yêu cầu, cập nhật và theo dõi chuyến vận chuyển.' },
  { role: 'DISTRIBUTOR', description: 'Theo dõi hàng gửi đến và xác nhận nhận hàng.' },
]

const filteredUsers = computed(() => {
  const term = search.value.trim().toLocaleLowerCase('vi')
  if (!term) return users.value
  return users.value.filter((user) =>
    [user.full_name, user.email, user.phone, user.organization?.name]
      .some((value) => value?.toLocaleLowerCase('vi').includes(term)),
  )
})
const activeCount = computed(() => users.value.filter((user) => user.status).length)
const disabledCount = computed(() => users.value.length - activeCount.value)

async function loadUsers() {
  loading.value = true
  loadError.value = ''
  try {
    const result = await api.get<{ users: UserProfile[] }>('/auth/users')
    users.value = result.users.map((user) => ({ ...user, saved: false, saveError: '' }))
  } catch (error) {
    loadError.value = error instanceof ApiError ? error.message : 'Không tải được danh sách người dùng'
  } finally {
    loading.value = false
  }
}

async function saveUser(user: EditableUser) {
  user.saveError = ''
  user.saved = false
  savingIds.value = [...savingIds.value, user.id]
  try {
    const result = await api.patch<{ user: UserProfile }>(`/auth/users/${user.id}`, {
      fullName: user.full_name,
      phone: user.phone,
      role: user.role,
      status: user.status,
    })
    Object.assign(user, result.user, { saved: true })
  } catch (error) {
    user.saveError = error instanceof ApiError ? error.message : 'Không lưu được thay đổi'
  } finally {
    savingIds.value = savingIds.value.filter((id) => id !== user.id)
  }
}

function isSaving(userId: string) {
  return savingIds.value.includes(userId)
}

onMounted(loadUsers)
</script>

<template>
  <main class="page-container admin-users-page">
    <PageHeader
      title="Quản lý người dùng"
      context="Quản trị hệ thống"
      description="Quản lý hồ sơ, trạng thái tài khoản và quyền truy cập theo vai trò."
    >
      <template #actions>
        <va-button preset="secondary" :disabled="loading" @click="loadUsers">
          {{ loading ? 'Đang tải…' : 'Tải lại danh sách' }}
        </va-button>
      </template>
    </PageHeader>

    <section class="user-stats" aria-label="Thống kê tài khoản">
      <article class="user-stat">
        <span class="user-stat-icon"><va-icon name="groups" /></span>
        <div><span>Tổng tài khoản</span><strong>{{ users.length }}</strong></div>
      </article>
      <article class="user-stat">
        <span class="user-stat-icon is-active"><va-icon name="check_circle" /></span>
        <div><span>Đang hoạt động</span><strong>{{ activeCount }}</strong></div>
      </article>
      <article class="user-stat">
        <span class="user-stat-icon is-disabled"><va-icon name="person_off" /></span>
        <div><span>Đã khóa</span><strong>{{ disabledCount }}</strong></div>
      </article>
    </section>

    <section class="role-permissions" aria-labelledby="role-permissions-title">
      <div class="section-heading">
        <div>
          <h2 id="role-permissions-title">Quyền theo role</h2>
          <p>Gán role trong bảng để cập nhật quyền truy cập cho tài khoản.</p>
        </div>
      </div>
      <div class="role-permissions-grid">
        <article v-for="item in rolePermissions" :key="item.role" class="role-permission-card">
          <div class="role-card-heading">
            <span class="role-dot" :class="`role-dot--${item.role.toLowerCase()}`"></span>
            <strong>{{ ROLE_LABELS[item.role] }}</strong>
          </div>
          <p>{{ item.description }}</p>
        </article>
      </div>
    </section>

    <section class="users-section" aria-labelledby="users-list-title">
      <div class="users-toolbar">
        <div>
          <h2 id="users-list-title">Danh sách tài khoản</h2>
          <p>{{ filteredUsers.length }} kết quả <span v-if="search">trong {{ users.length }} tài khoản</span></p>
        </div>
        <va-input
          v-model="search"
          aria-label="Tìm người dùng"
          placeholder="Tìm tên, email hoặc số điện thoại"
          clearable
          class="users-search"
        ><template #prependInner><va-icon name="search" /></template></va-input>
      </div>

      <va-alert v-if="loadError" color="danger" class="mb-4" role="alert">
        {{ loadError }}
      </va-alert>
      <div v-else-if="loading && !users.length" class="users-state" role="status">
        Đang tải danh sách người dùng…
      </div>
      <div v-else-if="!filteredUsers.length" class="users-state">
        {{ users.length ? 'Không tìm thấy người dùng phù hợp.' : 'Chưa có tài khoản nào.' }}
      </div>

      <div v-else class="users-table-wrap">
        <table class="users-table">
          <colgroup>
            <col class="col-account" />
            <col class="col-name" />
            <col class="col-phone" />
            <col class="col-role" />
            <col class="col-status" />
            <col class="col-action" />
          </colgroup>
          <thead>
            <tr>
              <th scope="col">Tài khoản</th>
              <th scope="col">Họ và tên</th>
              <th scope="col">Số điện thoại</th>
              <th scope="col">Vai trò</th>
              <th scope="col">Trạng thái</th>
              <th scope="col" aria-label="Thao tác"></th>
            </tr>
          </thead>
          <tbody>
            <template v-for="user in filteredUsers" :key="user.id">
              <tr>
                <td class="user-account-cell">
                  <div class="user-account-layout">
                    <span class="user-avatar" :class="`user-avatar--${user.role.toLowerCase()}`">{{ user.full_name.trim().charAt(0).toUpperCase() || '?' }}</span>
                    <div class="user-account-copy">
                      <strong>{{ user.email || 'Chưa có email' }}</strong>
                      <span v-if="user.organization">{{ user.organization.name }}</span>
                      <span v-if="user.id === authStore.user?.id" class="current-user-label">Tài khoản của bạn</span>
                    </div>
                  </div>
                </td>
                <td>
                  <va-input v-model="user.full_name" :aria-label="`Họ và tên của ${user.email}`" maxlength="255" />
                </td>
                <td>
                  <va-input v-model="user.phone" :aria-label="`Số điện thoại của ${user.email}`" maxlength="20" />
                </td>
                <td>
                  <va-select
                    v-model="user.role"
                    :disabled="user.id === authStore.user?.id"
                    :options="roleOptions"
                    value-by="value"
                    text-by="text"
                    :aria-label="`Vai trò của ${user.full_name}`"
                  />
                </td>
                <td class="status-cell">
                  <label class="status-control" :class="{ 'is-disabled': user.id === authStore.user?.id }">
                    <input
                      v-model="user.status"
                      type="checkbox"
                      :disabled="user.id === authStore.user?.id"
                      :aria-label="`${user.status ? 'Khóa' : 'Mở khóa'} tài khoản ${user.email}`"
                    />
                    <span class="status-track" aria-hidden="true"></span>
                    <span class="status-label" :class="user.status ? 'is-active' : 'is-locked'">
                      {{ user.status ? 'Hoạt động' : 'Đã khóa' }}
                    </span>
                  </label>
                </td>
                <td class="user-action-cell">
                  <va-button size="small" :loading="isSaving(user.id)" :disabled="isSaving(user.id)" @click="saveUser(user)">
                    <va-icon v-if="!isSaving(user.id)" :name="user.saved ? 'check' : 'save'" size="16px" />
                    {{ user.saved ? 'Đã lưu' : 'Lưu' }}
                  </va-button>
                </td>
              </tr>
              <tr v-if="user.saveError" class="user-error-row">
                <td colspan="6">
                  <va-alert color="danger" role="alert">{{ user.saveError }}</va-alert>
                </td>
              </tr>
            </template>
          </tbody>
        </table>
      </div>
    </section>
  </main>
</template>

<style scoped>
.admin-users-page {
  display: grid;
  gap: 28px;
}
.role-permissions,
.users-section {
  min-width: 0;
}
.section-heading,
.users-toolbar {
  display: flex;
  align-items: end;
  justify-content: space-between;
  gap: 16px;
  margin-bottom: 14px;
}
.section-heading h2,
.users-toolbar h2 {
  margin: 0;
  color: var(--app-ink);
  font-size: 20px;
  font-weight: 650;
}
.section-heading p,
.users-toolbar p {
  margin: 5px 0 0;
  color: var(--app-muted);
  font-size: 14px;
}
.role-permissions-grid {
  display: grid;
  grid-template-columns: repeat(4, minmax(0, 1fr));
  gap: 14px;
}
.role-permission-card {
  min-height: 98px;
  padding: 16px 18px;
  border: 1px solid var(--app-line);
  border-radius: 14px;
  background: var(--app-surface);
  box-shadow: 0 3px 12px rgb(21 57 67 / 4%);
}
.role-card-heading {
  display: flex;
  align-items: center;
  gap: 9px;
  color: var(--app-ink);
  font-size: 14px;
}
.role-dot {
  width: 9px;
  height: 9px;
  border-radius: 50%;
  background: var(--app-primary);
}
.role-dot--admin { background: #9865d8; }
.role-dot--farmer { background: #168878; }
.role-dot--transporter { background: #3974c6; }
.role-dot--distributor { background: #d28b2d; }
.role-permission-card p {
  margin: 10px 0 0;
  color: var(--app-muted);
  font-size: 12px;
  line-height: 1.55;
}
.user-stats {
  display: grid;
  grid-template-columns: repeat(3, minmax(0, 1fr));
  gap: 14px;
  margin-top: -8px;
}
.user-stat {
  display: flex;
  align-items: center;
  gap: 13px;
  min-height: 88px;
  padding: 16px 18px;
  border: 1px solid var(--app-line);
  border-radius: 14px;
  background: var(--app-surface);
}
.user-stat-icon {
  display: grid;
  width: 42px;
  height: 42px;
  flex: 0 0 auto;
  place-items: center;
  border-radius: 12px;
  background: #eef3f5;
  color: #47606a;
}
.user-stat-icon.is-active {
  background: #e6f5f0;
  color: #087d6b;
}
.user-stat-icon.is-disabled {
  background: #fff2e7;
  color: #bd6c25;
}
.user-stat div span,
.user-stat div strong {
  display: block;
}
.user-stat div span {
  color: var(--app-muted);
  font-size: 12px;
}
.user-stat div strong {
  margin-top: 3px;
  color: var(--app-ink);
  font-size: 23px;
  line-height: 1.15;
}
.users-search {
  width: min(100%, 370px);
}
.users-section {
  min-width: 0;
  margin-top: -2px;
  padding: 20px;
  border: 1px solid var(--app-line);
  border-radius: 16px;
  background: var(--app-surface);
  box-shadow: 0 5px 20px rgb(21 57 67 / 4%);
}
.users-table-wrap {
  overflow-x: auto;
  border: 1px solid #e6edef;
  border-radius: 12px;
}
.users-table {
  width: 100%;
  min-width: 980px;
  table-layout: fixed;
  border-collapse: collapse;
  text-align: left;
}
.col-account { width: 23%; }
.col-name { width: 19%; }
.col-phone { width: 16%; }
.col-role { width: 17%; }
.col-status { width: 16%; }
.col-action { width: 9%; }
.users-table th {
  padding: 13px 11px;
  background: #f6f9f9;
  color: var(--app-muted);
  font-size: 11px;
  font-weight: 700;
  letter-spacing: .04em;
  text-transform: uppercase;
  white-space: nowrap;
}
.users-table td {
  padding: 12px 11px;
  border-top: 1px solid var(--app-line);
  vertical-align: middle;
}
.users-table tbody tr:not(.user-error-row) {
  transition: background-color .16s ease;
}
.users-table tbody tr:not(.user-error-row):hover {
  background: #fbfdfd;
}
.users-table th:first-child,
.users-table td:first-child {
  padding-left: 14px;
}
.user-account-cell {
  overflow: hidden;
  text-overflow: ellipsis;
}
.user-account-layout {
  display: flex;
  align-items: center;
  gap: 10px;
  min-width: 0;
}
.user-avatar {
  display: grid;
  width: 36px;
  height: 36px;
  flex: 0 0 auto;
  place-items: center;
  border-radius: 11px;
  background: #e8f4f1;
  color: #087d6b;
  font-size: 14px;
  font-weight: 700;
}
.user-avatar--admin { background: #f2eafa; color: #8050bc; }
.user-avatar--transporter { background: #e9f0fc; color: #3974c6; }
.user-avatar--distributor { background: #fff3e4; color: #b5761f; }
.user-account-copy {
  min-width: 0;
}
.user-account-copy strong,
.user-account-copy span {
  display: block;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}
.user-account-copy strong {
  color: var(--app-ink);
  font-size: 12px;
  font-weight: 650;
}
.user-account-copy span {
  margin-top: 3px;
  color: var(--app-muted);
  font-size: 12px;
}
.user-account-copy .current-user-label {
  color: var(--app-primary-dark);
  font-weight: 600;
}
.users-table :deep(.va-input-wrapper),
.users-table :deep(.va-select) {
  width: 100%;
  min-width: 0;
}
.users-table :deep(.va-input-wrapper__field),
.users-table :deep(.va-select-content) {
  min-height: 40px;
}
.users-table :deep(.va-select-content) {
  align-items: center;
}
.users-table :deep(.va-select .va-input-wrapper__text) {
  align-items: center;
  padding-top: 0;
}
.status-control {
  display: inline-flex;
  align-items: center;
  gap: 8px;
  cursor: pointer;
}
.status-control input {
  position: absolute;
  width: 1px;
  height: 1px;
  opacity: 0;
}
.status-track {
  position: relative;
  width: 34px;
  height: 19px;
  flex: 0 0 auto;
  border-radius: 99px;
  background: #cbd5d8;
  transition: background-color .16s ease;
}
.status-track::after {
  position: absolute;
  top: 3px;
  left: 3px;
  width: 13px;
  height: 13px;
  border-radius: 50%;
  background: white;
  box-shadow: 0 1px 3px rgb(0 0 0 / 20%);
  content: '';
  transition: transform .16s ease;
}
.status-control input:checked + .status-track {
  background: #0b8876;
}
.status-control input:checked + .status-track::after {
  transform: translateX(15px);
}
.status-control input:focus-visible + .status-track {
  outline: 3px solid rgb(13 136 118 / 24%);
  outline-offset: 2px;
}
.status-control.is-disabled {
  cursor: not-allowed;
  opacity: .55;
}
.status-label {
  color: var(--app-muted);
  font-size: 11px;
  white-space: nowrap;
}
.status-label.is-active {
  color: #087d6b;
}
.status-label.is-locked {
  color: #a75c23;
}
.user-action-cell {
  text-align: right;
  white-space: nowrap;
}
.user-error-row td {
  padding-top: 0;
}
.users-state {
  padding: 32px 16px;
  border: 1px dashed var(--app-line);
  border-radius: 12px;
  color: var(--app-muted);
  text-align: center;
}
@media (max-width: 900px) {
  .user-stats {
    grid-template-columns: repeat(3, minmax(0, 1fr));
  }
  .role-permissions-grid {
    grid-template-columns: repeat(2, minmax(0, 1fr));
  }
}
@media (max-width: 600px) {
  .user-stats {
    grid-template-columns: minmax(0, 1fr);
  }
  .section-heading,
  .users-toolbar,
  .users-search {
    width: 100%;
  }
  .users-toolbar {
    align-items: stretch;
    flex-direction: column;
  }
  .users-section {
    padding: 14px;
  }
  .role-permissions-grid {
    grid-template-columns: minmax(0, 1fr);
  }
}
</style>

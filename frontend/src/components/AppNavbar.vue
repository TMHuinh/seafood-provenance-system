<script setup lang="ts">
import { computed } from 'vue'
import { VaButton, VaIcon } from 'vuestic-ui'
import { useRoute, useRouter } from 'vue-router'

import { useAuthStore } from '../stores/auth.store'
import { ROLE_LABELS } from '../types'

defineProps<{ collapsed?: boolean }>()
const emit = defineEmits<{ 'toggle-sidebar': [] }>()

const router = useRouter()
const route = useRoute()
const authStore = useAuthStore()

const isAuthenticated = computed(() => authStore.isAuthenticated)
const showNavbar = computed(() => !['login', 'register'].includes(String(route.name)))
const initials = computed(() => {
  const name = authStore.fullName !== 'Khách' ? authStore.fullName : ''
  return name
    .split(/\s+/)
    .map((word) => word[0])
    .slice(-2)
    .join('')
    .toUpperCase()
})
const navigation = computed(() => [
  { name: 'home', label: 'Tổng quan', icon: 'dashboard', active: route.name === 'home' },
  ...(authStore.user?.role === 'FARMER' ? [{ name: 'farms', label: 'Vùng nuôi', icon: 'water', active: ['farms', 'ponds', 'pond-batches', 'farming-logs'].includes(String(route.name)) }] : []),
  ...(authStore.user?.role === 'TRANSPORTER' ? [{ name: 'transports', label: 'Vận chuyển', icon: 'local_shipping', active: route.name === 'transports' }] : []),
  ...(authStore.user?.role === 'DISTRIBUTOR' ? [{ name: 'receipts', label: 'Hàng nhận', icon: 'inventory_2', active: route.name === 'receipts' }] : []),
])
const pageTitles: Record<string, string> = { home: 'Tổng quan', farms: 'Cơ sở nuôi', ponds: 'Ao nuôi', 'pond-batches': 'Vụ nuôi', 'farming-logs': 'Nhật ký nuôi', transports: 'Vận chuyển', receipts: 'Hàng nhận' }
const pageLabel = computed(() => pageTitles[String(route.name)] ?? 'Không gian làm việc')
const roleName = computed(() => authStore.user?.role ? ROLE_LABELS[authStore.user.role] : '')

async function handleLogout() {
  try { await authStore.logout() }
  catch { /* Local session cleanup is guaranteed even if the server is unreachable. */ }
  finally { await router.push({ name: 'home' }) }
}

async function handleHome() {
  if (authStore.isAuthenticated) {
    await authStore.fetchMe()
  }
  router.push({ name: 'home' })
}
</script>

<template>
  <header v-if="showNavbar" class="app-navbar" :class="{ 'workspace-sidebar': isAuthenticated, 'is-collapsed': collapsed }">
    <div class="navbar-inner">
      <button type="button" class="brand" aria-label="Thủy sản Xanh — Trang chủ" title="Thủy sản Xanh — Trang chủ" @click="handleHome">
        <span class="brand-badge" aria-hidden="true">
          <svg viewBox="0 0 24 24" width="22" height="22" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round">
            <path d="M3 17c3-6 7-9 10-10-3 2-4 5-4 7 2-2 5-3 8-2" />
            <path d="M15 12c-2-4-1-8 2-9-1 4 0 7 4 8" />
          </svg>
        </span>
        <span class="brand-text">
          <strong>Thủy sản Xanh</strong>
          <small>Truy xuất nguồn gốc</small>
        </span>
      </button>

      <nav id="workspace-navigation" class="navbar-links" aria-label="Điều hướng chính">
        <button v-for="item in navigation" :key="item.name" type="button" class="nav-link" :class="{ active: item.active }" :aria-current="item.active ? 'page' : undefined" :aria-label="isAuthenticated ? item.label : 'Trang chủ'" :title="isAuthenticated ? item.label : 'Trang chủ'" @click="router.push({ name: item.name })">
          <va-icon :name="item.icon" size="20px" aria-hidden="true" />
          <span class="nav-label">{{ isAuthenticated ? item.label : 'Trang chủ' }}</span>
        </button>
      </nav>

      <div class="navbar-actions">
        <template v-if="!isAuthenticated">
          <va-button preset="secondary" size="small" @click="router.push({ name: 'login' })">
            Đăng nhập
          </va-button>
          <va-button size="small" gradient @click="router.push({ name: 'register' })">
            Đăng ký
          </va-button>
        </template>
        <template v-else>
          <div class="user-chip" :title="`${authStore.fullName} · ${roleName}`">
            <span class="user-avatar">{{ initials }}</span>
            <span class="user-meta"><span class="user-name">{{ authStore.fullName }}</span><small>{{ roleName }}</small></span>
          </div>
          <va-button class="logout-button" preset="ghost" size="small" aria-label="Đăng xuất" title="Đăng xuất" @click="handleLogout">
            <va-icon name="logout" size="20px" aria-hidden="true" /><span class="nav-label">Đăng xuất</span>
          </va-button>
        </template>
      </div>
    </div>
  </header>
  <header v-if="showNavbar && isAuthenticated" class="workspace-topbar">
    <div class="topbar-leading">
      <button type="button" class="sidebar-toggle" :aria-label="collapsed ? 'Mở rộng thanh menu' : 'Thu gọn thanh menu'" :title="collapsed ? 'Mở rộng thanh menu' : 'Thu gọn thanh menu'" :aria-expanded="!collapsed" aria-controls="workspace-navigation" @click="emit('toggle-sidebar')">
        <va-icon :name="collapsed ? 'menu_open' : 'menu'" size="22px" aria-hidden="true" />
      </button>
      <div class="topbar-title"><span class="topbar-caption">KHÔNG GIAN LÀM VIỆC</span><strong>{{ pageLabel }}</strong></div>
    </div>
    <span class="topbar-org">{{ authStore.organizationName || roleName }}</span>
  </header>
</template>

<style scoped>
.app-navbar {
  position: sticky;
  top: 0;
  z-index: 100;
  background: rgb(255 255 255 / 93%);
  backdrop-filter: blur(16px);
  border-bottom: 1px solid var(--app-line);
  box-shadow: 0 2px 12px rgb(23 52 58 / 3%);
}

.navbar-inner {
  max-width: 1360px;
  margin: 0 auto;
  padding: 0.65rem 2rem;
  display: flex;
  align-items: center;
  gap: 1.35rem;
}

.brand {
  display: flex;
  align-items: center;
  gap: 0.65rem;
  background: none;
  border: none;
  cursor: pointer;
  padding: 0;
}

.brand-badge {
  width: 42px;
  height: 42px;
  border-radius: 14px;
  background: linear-gradient(145deg, var(--app-primary), #24a38d);
  color: #fff;
  display: flex;
  align-items: center;
  justify-content: center;
  box-shadow: 0 7px 16px rgb(15 118 110 / 22%);
}

.brand-text {
  display: flex;
  flex-direction: column;
  line-height: 1.2;
  text-align: left;
}

.brand-text strong {
  color: var(--app-ink);
  font-size: 1rem;
  font-weight: 800;
}

.brand-text small {
  color: var(--app-muted);
  font-size: 0.74rem;
}

.navbar-links {
  display: flex;
  gap: 0.3rem;
  margin-left: 0.5rem;
}

.nav-link {
  background: none;
  border: none;
  cursor: pointer;
  font-size: 0.83rem;
  font-weight: 600;
  color: var(--app-muted);
  padding: 0.55rem 0.9rem;
  border-radius: 9px;
  transition: background 0.15s ease, color 0.15s ease;
}

.nav-link:hover {
  color: var(--app-primary-dark);
  background: var(--app-primary-soft);
}

.nav-link.active {
  color: var(--app-primary);
  background: var(--app-primary-soft);
}

.navbar-actions {
  margin-left: auto;
  display: flex;
  align-items: center;
  gap: 0.75rem;
}

.user-chip {
  display: flex;
  align-items: center;
  gap: 0.55rem;
  padding: .25rem .65rem .25rem .3rem;
  border: 1px solid #e8efed;
  border-radius: 99px;
  background: #fbfdfc;
}

.user-avatar {
  width: 32px;
  height: 32px;
  border-radius: 9999px;
  background: linear-gradient(145deg, var(--app-primary), #24a38d);
  color: #fff;
  font-size: 0.78rem;
  font-weight: 700;
  display: flex;
  align-items: center;
  justify-content: center;
}

.user-name {
  font-size: 0.9rem;
  font-weight: 600;
  color: var(--app-ink);
}

.user-meta {
  display: grid;
  line-height: 1.2;
  gap: .12rem;
}

.user-meta small {
  color: var(--app-muted);
  font-size: .65rem;
}

@media (max-width: 700px) {
  .navbar-inner {
    gap: .65rem;
    padding: 0.55rem .85rem;
    flex-wrap: wrap;
  }
  .navbar-links {
    display: flex;
    flex-wrap: wrap;
    width: 100%;
    margin-left: 0;
    order: 3;
  }
  .nav-link { padding: .4rem .6rem; font-size: .78rem; }
  .user-name {
    display: none;
  }
}
.nav-link { display: flex; align-items: center; gap: 10px; min-height: 44px; }
.workspace-topbar { display: flex; align-items: center; justify-content: space-between; gap: 24px; min-height: 76px; padding: 16px 32px; margin-left: var(--sidebar-width, 240px); border-bottom: 1px solid var(--app-line); background: var(--app-surface); }
.workspace-topbar > div { display: grid; gap: 4px; }
.topbar-caption { font-size: 10px; letter-spacing: .12em; color: var(--app-muted); }
.workspace-topbar strong { font-size: 15px; font-weight: 650; }
.topbar-org { color: var(--app-muted); font-size: 13px; overflow-wrap: anywhere; }
.workspace-topbar .topbar-leading { display: flex; align-items: center; gap: 16px; min-width: 0; }
.topbar-title { display: grid; gap: 4px; }
.sidebar-toggle { display: none; align-items: center; justify-content: center; width: 44px; height: 44px; flex-shrink: 0; border: 1px solid var(--app-line); border-radius: 10px; background: var(--app-surface); color: var(--app-primary-dark); cursor: pointer; }
.sidebar-toggle:hover { background: var(--app-primary-soft); }
.logout-button :deep(.va-button__content) { gap: 8px; }
@media (min-width: 1024px) {
  .sidebar-toggle { display: inline-flex; }
  .workspace-sidebar.is-collapsed .navbar-inner { padding-inline: 12px; }
  .workspace-sidebar.is-collapsed .brand-text,
  .workspace-sidebar.is-collapsed .nav-label,
  .workspace-sidebar.is-collapsed .user-meta { display: none; }
  .workspace-sidebar.is-collapsed .brand,
  .workspace-sidebar.is-collapsed .nav-link,
  .workspace-sidebar.is-collapsed .user-chip { justify-content: center; padding-inline: 0; }
  .workspace-sidebar.is-collapsed .navbar-actions { padding-inline: 0; align-items: center; }
  .workspace-sidebar.is-collapsed .logout-button { width: 44px; min-height: 44px; padding: 0; }

  .workspace-sidebar { position: fixed; inset: 0 auto 0 0; width: var(--sidebar-width, 240px); border-right: 1px solid var(--app-line); border-bottom: 0; box-shadow: none; background: #fff; backdrop-filter: none; }
  .workspace-sidebar .navbar-inner { flex-direction: column; align-items: stretch; padding: 28px 16px 20px; height: 100%; gap: 36px; }
  .workspace-sidebar .brand { padding: 0 8px; }
  .workspace-sidebar .brand-badge { width: 38px; height: 38px; border-radius: 12px; box-shadow: none; background: var(--app-primary); }
  .workspace-sidebar .navbar-links { flex-direction: column; margin: 0; gap: 6px; }
  .workspace-sidebar .nav-link { padding: 12px 16px; font-size: 14px; text-align: left; border-radius: 10px; }
  .workspace-sidebar .nav-link.active { color: var(--app-primary-dark); background: var(--app-primary-soft); }
  .workspace-sidebar .navbar-actions { margin: auto 0 0; align-items: stretch; flex-direction: column; gap: 16px; padding: 20px 8px 0; border-top: 1px solid var(--app-line); }
  .workspace-sidebar .user-chip { border: 0; background: none; padding: 0; border-radius: 0; }
  .workspace-sidebar .user-name { font-size: 13px; overflow-wrap: anywhere; }
  .workspace-sidebar .user-meta { min-width: 0; }
  .workspace-sidebar .user-meta small { font-size: 12px; color: var(--app-muted); }
}
@media (max-width: 1023px) {
  .workspace-topbar { margin-left: 0; padding: 16px 24px; min-height: 64px; }
  .navbar-inner { flex-wrap: wrap; padding: 12px 20px; gap: 12px; }
  .navbar-links { order: 3; width: 100%; margin: 0; flex-wrap: wrap; }
}
@media (max-width: 600px) {
  .workspace-topbar { padding: 14px 20px; }
  .topbar-org { max-width: 48%; font-size: 12px; text-align: right; }
  .brand-text strong { font-size: 14px; }
  .brand-text small { font-size: 11px; }
  .navbar-actions { gap: 6px; }
  .user-chip { border: 0; padding: 0; }
  .user-meta { display: none; }
}
</style>

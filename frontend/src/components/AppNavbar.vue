<script setup lang="ts">
import { computed, ref, watch } from 'vue'
import { VaButton, VaIcon } from 'vuestic-ui'
import { useRoute, useRouter } from 'vue-router'

import { useAuthStore } from '../stores/auth.store'
import { ROLE_LABELS } from '../types'

defineProps<{ collapsed?: boolean }>()
const emit = defineEmits<{ 'toggle-sidebar': [] }>()

const router = useRouter()
const route = useRoute()
const authStore = useAuthStore()

const mobileMenuOpen = ref(false)
const mobileToggle = ref<HTMLButtonElement | null>(null)
const accountMenu = ref<HTMLDetailsElement | null>(null)
const accountToggle = ref<HTMLElement | null>(null)
watch(
  () => route.fullPath,
  () => {
    if (mobileMenuOpen.value) {
      mobileMenuOpen.value = false
      document.getElementById('main-content')?.focus()
    }
    if (accountMenu.value) accountMenu.value.open = false
  },
)

function closeMobileMenu() {
  if (!mobileMenuOpen.value) return
  mobileMenuOpen.value = false
  mobileToggle.value?.focus()
}

function closeAccountMenu(event: FocusEvent) {
  if (event.relatedTarget instanceof Node && accountMenu.value?.contains(event.relatedTarget))
    return
  if (accountMenu.value) accountMenu.value.open = false
}

function dismissAccountMenu(event: KeyboardEvent) {
  if (!accountMenu.value?.open) return
  event.preventDefault()
  accountMenu.value.open = false
  accountToggle.value?.focus()
}

const isTransporter = computed(() => authStore.user?.role === 'TRANSPORTER')
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
  { name: 'home', label: 'Tổng quan', icon: 'dashboard', group: 'Không gian làm việc', active: route.name === 'home' },
  ...(authStore.user?.role === 'FARMER'
    ? [
        { name: 'farms', label: 'Cơ sở nuôi', icon: 'domain', group: 'Quản lý vùng nuôi', active: route.name === 'farms' },
        { name: 'farm-ponds', label: 'Ao nuôi', icon: 'water', active: ['farm-ponds', 'ponds'].includes(String(route.name)) },
        { name: 'farm-batches', label: 'Vụ nuôi', icon: 'calendar_month', active: route.name === 'farm-batches' || (route.name === 'pond-batches' && !route.query.harvest) },
        { name: 'farm-logs', label: 'Nhật ký nuôi', icon: 'edit_document', active: ['farm-logs', 'farming-logs'].includes(String(route.name)) },
        { name: 'farm-harvest', label: 'Thu hoạch & Lô hàng', icon: 'agriculture', group: 'Thu hoạch và phân phối', active: route.name === 'farm-harvest' || (route.name === 'pond-batches' && Boolean(route.query.harvest)) },
      ]
    : []),
  ...(authStore.user?.role === 'TRANSPORTER'
    ? [
        {
          name: 'transports',
          label: 'Vận chuyển',
          group: 'Quản lý nghiệp vụ',
          icon: 'local_shipping',
          active: route.name === 'transports',
        },
      ]
    : []),
  ...(authStore.user?.role === 'DISTRIBUTOR'
    ? [
        {
          name: 'receipts',
          label: 'Hàng nhận',
          group: 'Quản lý nghiệp vụ',
          icon: 'inventory_2',
          active: route.name === 'receipts',
        },
      ]
    : []),
  ...(authStore.user?.role === 'ADMIN'
    ? [
        {
          name: 'admin-users',
          label: 'Quản lý người dùng',
          icon: 'manage_accounts',
          group: 'Quản trị hệ thống',
          active: route.name === 'admin-users',
        },
      ]
    : []),
  ...(['FARMER', 'ADMIN'].includes(authStore.user?.role ?? '')
    ? [
        { name: 'lots', label: 'Tìm kiếm lô hàng', icon: 'inventory_2', group: 'Tra cứu và báo cáo', active: ['lots', 'lot-report'].includes(String(route.name)) },
        { name: 'production', label: 'Thống kê sản lượng', icon: 'bar_chart', active: route.name === 'production' },
      ]
    : []),
])
const pageTitles: Record<string, string> = {
  home: 'Tổng quan',
  'farm-ponds': 'Ao nuôi',
  'farm-batches': 'Vụ nuôi',
  'farm-logs': 'Nhật ký nuôi',
  'farm-harvest': 'Thu hoạch & Lô hàng',
  farms: 'Cơ sở nuôi',
  ponds: 'Ao nuôi',
  'pond-batches': 'Vụ nuôi',
  'farming-logs': 'Nhật ký nuôi',
  transports: 'Vận chuyển',
  receipts: 'Hàng nhận',
  lots: 'Tìm kiếm lô hàng',
  production: 'Thống kê sản lượng',
  'lot-report': 'Báo cáo truy xuất',
  'admin-users': 'Quản lý người dùng',
}
const farmRoutes = ['farms', 'ponds', 'pond-batches', 'farming-logs']
const breadcrumbs = computed(() => {
  const current = String(route.name)
  const index = farmRoutes.indexOf(current)
  const names = index < 0 ? [current] : farmRoutes.slice(0, index + 1)
  const { farmId, pondId } = route.params
  return names.map((name) => ({
    name,
    label: isTransporter.value && name === 'home' ? 'Tổng quan vận chuyển' : pageTitles[name],
    params: name === 'ponds' ? { farmId } : name === 'pond-batches' ? { farmId, pondId } : {},
  }))
})
const roleName = computed(() => (authStore.user?.role ? ROLE_LABELS[authStore.user.role] : ''))

async function handleLogout() {
  if (accountMenu.value) accountMenu.value.open = false
  try {
    await authStore.logout()
  } catch {
    /* Local session cleanup is guaranteed even if the server is unreachable. */
  } finally {
    await router.push({ name: 'home' })
  }
}

async function handleHome() {
  if (authStore.isAuthenticated) {
    await authStore.fetchMe()
  }
  router.push({ name: 'home' })
}
</script>

<template>
  <header
    v-if="showNavbar"
    class="app-navbar"
    @keydown.esc="closeMobileMenu"
    :class="{
      'workspace-sidebar': isAuthenticated,
      'is-collapsed': collapsed,
      'menu-open': mobileMenuOpen,
    }"
  >
    <div class="navbar-inner">
      <button
        type="button"
        class="brand"
        aria-label="Thủy sản Xanh — Trang chủ"
        title="Thủy sản Xanh — Trang chủ"
        @click="handleHome"
      >
        <span class="brand-badge" aria-hidden="true">
          <svg
            viewBox="0 0 24 24"
            width="22"
            height="22"
            fill="none"
            stroke="currentColor"
            stroke-width="1.8"
            stroke-linecap="round"
            stroke-linejoin="round"
          >
            <path d="M3 17c3-6 7-9 10-10-3 2-4 5-4 7 2-2 5-3 8-2" />
            <path d="M15 12c-2-4-1-8 2-9-1 4 0 7 4 8" />
          </svg>
        </span>
        <span class="brand-text">
          <strong>Thủy sản Xanh</strong>
          <small>Truy xuất nguồn gốc</small>
        </span>
      </button>

      <button
        v-if="isAuthenticated"
        ref="mobileToggle"
        type="button"
        class="mobile-menu-toggle"
        aria-controls="workspace-navigation"
        :aria-expanded="mobileMenuOpen"
        @click="mobileMenuOpen = !mobileMenuOpen"
      >
        <va-icon :name="mobileMenuOpen ? 'close' : 'menu'" aria-hidden="true" />
        <span>Điều hướng</span>
      </button>
      <button v-if="isAuthenticated && mobileMenuOpen" class="mobile-nav-backdrop" type="button"
        aria-label="Đóng điều hướng" tabindex="-1" @click="closeMobileMenu" />
      <nav
        v-if="isAuthenticated"
        id="workspace-navigation"
        class="navbar-links"
        aria-label="Điều hướng chính"
      >
        <template v-for="item in navigation" :key="item.name">
          <span v-if="item.group" class="nav-group-label">{{ item.group }}</span>
          <router-link
            class="nav-link"
            :class="{ active: item.active }"
            :aria-current="route.name === item.name ? 'page' : item.active ? 'location' : undefined"
            :aria-label="item.label"
            :title="item.label"
            :to="{ name: item.name }"
            @click="route.name === item.name && closeMobileMenu()"
          >
            <va-icon :name="item.icon" size="20px" aria-hidden="true" />
            <span class="nav-label">{{ item.label }}</span>
          </router-link>
        </template>
      </nav>

      <div v-if="isAuthenticated" class="workspace-identity">
        <va-icon :name="isTransporter ? 'local_shipping' : 'domain'" aria-hidden="true" />
        <div>
          <span>{{ roleName }}</span
          ><strong>{{ isTransporter ? authStore.fullName : authStore.organizationName || authStore.fullName }}</strong>
        </div>
      </div>

      <div v-if="!isAuthenticated" class="navbar-actions">
        <va-button preset="secondary" size="small" @click="router.push({ name: 'login' })"
          >Đăng nhập</va-button
        >
        <va-button size="small" @click="router.push({ name: 'register' })">Đăng ký</va-button>
      </div>
    </div>
  </header>
  <header v-if="showNavbar && isAuthenticated" class="workspace-topbar">
    <div class="topbar-leading">
      <button
        type="button"
        class="sidebar-toggle"
        :aria-label="collapsed ? 'Mở rộng thanh menu' : 'Thu gọn thanh menu'"
        :title="collapsed ? 'Mở rộng thanh menu' : 'Thu gọn thanh menu'"
        :aria-expanded="!collapsed"
        aria-controls="workspace-navigation"
        @click="emit('toggle-sidebar')"
      >
        <va-icon :name="collapsed ? 'menu_open' : 'menu'" size="22px" aria-hidden="true" />
      </button>
      <nav class="breadcrumbs" aria-label="Vị trí hiện tại">
        <ol>
          <li v-for="(item, index) in breadcrumbs" :key="item.name">
            <strong v-if="index === breadcrumbs.length - 1" aria-current="page">{{
              item.label
            }}</strong>
            <router-link v-else :to="{ name: item.name, params: item.params }">{{
              item.label
            }}</router-link>
          </li>
        </ol>
      </nav>
    </div>
    <details
      ref="accountMenu"
      class="account-menu"
      @focusout="closeAccountMenu"
      @keydown.esc="dismissAccountMenu"
    >
      <summary ref="accountToggle" :aria-label="`Tài khoản · ${authStore.fullName}`">
        <span class="user-avatar" aria-hidden="true">{{ initials || '·' }}</span>
        <span class="account-label">{{ authStore.fullName }}</span>
        <va-icon name="expand_more" size="18px" aria-hidden="true" />
      </summary>
      <div class="account-popover">
        <strong>{{ authStore.fullName }}</strong>
        <span v-if="roleName">{{ roleName }}</span>
        <span v-if="authStore.organizationName">{{ authStore.organizationName }}</span>
        <button type="button" class="account-logout" @click="handleLogout">
          <va-icon name="logout" size="18px" aria-hidden="true" /> Đăng xuất
        </button>
      </div>
    </details>
  </header>
</template>

<style scoped>
.app-navbar {
  position: sticky;
  top: 0;
  z-index: 100;
  border-bottom: 1px solid var(--app-line);
  background: var(--app-surface);
}
.navbar-inner {
  display: flex;
  align-items: center;
  gap: var(--app-space-3);
  width: min(100%, 1280px);
  margin: 0 auto;
  padding: var(--app-space-3) clamp(12px, 3vw, 32px);
}
.brand {
  display: flex;
  align-items: center;
  gap: var(--app-space-2);
  padding: 0;
  border: 0;
  background: none;
  text-align: left;
  cursor: pointer;
}
.brand-badge,
.user-avatar {
  flex-shrink: 0;
  display: grid;
  place-items: center;
  width: var(--app-control-height);
  height: var(--app-control-height);
  border-radius: var(--app-control-radius);
  background: var(--app-primary);
  color: white;
}
.brand-text {
  display: grid;
  line-height: 1.3;
}
.brand-text strong {
  font-size: 15px;
  font-weight: 750;
}
.brand-text small {
  color: var(--app-muted);
  font-size: 12px;
}
.navbar-actions {
  display: flex;
  align-items: center;
  gap: var(--app-space-2);
  margin-left: auto;
}
.navbar-links {
  display: flex;
  gap: var(--app-space-2);
}
.nav-group-label {
  padding: 0 14px;
  margin: 24px 0 4px;
  color: var(--app-sidebar-text);
  font-size: 11px;
  font-weight: 500;
  letter-spacing: 0.02em;
}
.nav-group-label:first-child {
  margin-top: 0;
}
.workspace-identity {
  display: none;
}
.nav-link {
  display: flex;
  align-items: center;
  gap: var(--app-space-3);
  min-height: var(--app-control-height);
  padding: 8px 14px;
  border-radius: var(--app-control-radius);
  color: var(--app-primary-dark);
  font-weight: 650;
}
.nav-link:hover,
.nav-link.active {
  background: var(--app-primary-soft);
}
.workspace-topbar {
  position: sticky;
  top: 0;
  z-index: 10;
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: var(--app-space-3);
  min-height: var(--app-header-height);
  margin-left: var(--sidebar-width, var(--app-sidebar-width));
  padding: 10px clamp(16px, 3vw, 32px);
  border-bottom: 1px solid var(--app-line);
  background: var(--app-surface);
}
.topbar-leading {
  display: flex;
  align-items: center;
  gap: var(--app-space-4);
  min-width: 0;
}
.breadcrumbs ol {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  gap: 2px 8px;
  padding: 0;
  margin: 0;
  list-style: none;
}
.breadcrumbs li {
  overflow-wrap: anywhere;
}
.breadcrumbs li + li::before {
  content: '/';
  margin-right: 8px;
  color: var(--app-muted);
}
.breadcrumbs a {
  color: var(--app-primary-dark);
  text-decoration: underline;
  text-underline-offset: 3px;
}
.sidebar-toggle,
.mobile-menu-toggle {
  display: none;
  align-items: center;
  justify-content: center;
  gap: 6px;
  flex-shrink: 0;
  min-width: 44px;
  min-height: var(--app-control-height);
  padding: 0 10px;
  border: 1px solid var(--app-line);
  border-radius: var(--app-control-radius);
  background: var(--app-surface);
  color: var(--app-primary-dark);
  cursor: pointer;
}
.sidebar-toggle:hover,
.mobile-menu-toggle:hover {
  background: var(--app-primary-soft);
}
.account-menu {
  position: relative;
  min-width: 0;
  flex-shrink: 0;
}
.account-menu > summary {
  display: flex;
  align-items: center;
  gap: var(--app-space-2);
  min-height: var(--app-control-height);
  max-width: 220px;
  padding: 4px 8px 4px 4px;
  border-radius: var(--app-control-radius);
  cursor: pointer;
  list-style: none;
}
.account-menu > summary::-webkit-details-marker {
  display: none;
}
.account-menu > summary:hover,
.account-menu[open] > summary {
  background: var(--app-primary-soft);
}
.user-avatar {
  width: 34px;
  height: 34px;
  border-radius: 50%;
  font-size: 12px;
  font-weight: 750;
}
.account-label {
  font-weight: 650;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}
.account-popover {
  position: absolute;
  top: calc(100% + 8px);
  right: 0;
  display: grid;
  gap: 4px;
  width: min(260px, calc(100vw - 32px));
  padding: var(--app-space-3);
  border: 1px solid var(--app-line);
  border-radius: var(--app-radius);
  background: var(--app-surface);
  box-shadow: var(--app-shadow);
  overflow-wrap: anywhere;
}
.account-popover > span {
  color: var(--app-muted);
  font-size: 13px;
}
.account-logout {
  display: flex;
  align-items: center;
  gap: var(--app-space-2);
  min-height: var(--app-control-height);
  padding: 8px 0 0;
  margin-top: 4px;
  border: 0;
  border-top: 1px solid var(--app-line);
  background: none;
  color: var(--app-primary-dark);
  cursor: pointer;
}
.account-logout:hover {
  text-decoration: underline;
}

@media (min-width: 1024px) {
  .sidebar-toggle {
    display: inline-flex;
  }
  .workspace-sidebar {
    position: fixed;
    inset: 0 auto 0 0;
    width: var(--sidebar-width, var(--app-sidebar-width));
    overflow-y: auto;
    border: 0;
    background: linear-gradient(165deg, var(--app-sidebar), #07515e 110%);
    color: white;
  }
  .workspace-sidebar .navbar-inner {
    flex-direction: column;
    align-items: stretch;
    min-height: 100dvh;
    gap: 36px;
    padding: 24px 16px;
  }
  .workspace-identity {
    display: flex;
    align-items: flex-start;
    gap: 12px;
    margin-top: auto;
    padding: 20px 8px 0;
    border-top: 1px solid var(--app-divider);
    color: var(--app-sidebar-text);
  }
  .workspace-identity div {
    min-width: 0;
    display: grid;
    gap: 6px;
    overflow-wrap: anywhere;
  }
  .workspace-identity span {
    font-size: 12px;
  }
  .workspace-identity strong {
    color: white;
    font-size: 13px;
    font-weight: 500;
  }
  .workspace-sidebar .brand {
    padding: 4px 8px;
  }
  .workspace-sidebar .brand-text small,
  .workspace-sidebar .nav-link {
    color: var(--app-sidebar-text);
  }
  .workspace-sidebar .navbar-links {
    flex-direction: column;
  }
  .workspace-sidebar .nav-link:hover {
    background: var(--app-divider);
    color: white;
  }
  .workspace-sidebar .nav-link.active {
    background: var(--app-accent);
    color: var(--app-sidebar);
  }
  .workspace-sidebar :is(a, button):focus-visible {
    outline-color: var(--app-accent);
  }
  .workspace-sidebar.is-collapsed .navbar-inner {
    padding-inline: 12px;
  }
  .workspace-sidebar.is-collapsed
    :is(.brand-text, .nav-label, .nav-group-label, .workspace-identity) {
    display: none;
  }
  .workspace-sidebar.is-collapsed :is(.brand, .nav-link) {
    justify-content: center;
    padding-inline: 0;
  }
}
.mobile-nav-backdrop { display: none; }
@media (max-width: 1023px) {
  .workspace-sidebar { z-index: 110; }
  .workspace-sidebar.menu-open .mobile-nav-backdrop {
    display: block;
    position: fixed;
    inset: 0;
    border: 0;
    background: rgb(7 28 36 / 38%);
  }
  .workspace-sidebar.menu-open .mobile-menu-toggle {
    position: relative;
    z-index: 1;
    background: var(--app-primary-soft);
  }
  .workspace-sidebar.menu-open .navbar-links {
    display: flex;
    position: fixed;
    inset: var(--app-header-height) auto 0 0;
    width: min(300px, 85vw);
    flex-flow: column nowrap;
    align-items: stretch;
    overflow-y: auto;
    padding: var(--app-space-4);
    border: 0;
    background: var(--app-sidebar);
  }
  .workspace-sidebar.menu-open .nav-group-label { display: block; }
  .workspace-sidebar .nav-link { color: var(--app-sidebar-text); }
  .workspace-sidebar .nav-link:hover { background: var(--app-divider); color: white; }
  .workspace-sidebar .nav-link.active {
    color: var(--app-sidebar);
    background: var(--app-accent);
  }
  .workspace-sidebar .nav-link:focus-visible { outline-color: var(--app-accent); }

  .workspace-sidebar {
    position: relative;
  }
  .nav-group-label {
    display: none;
  }
  .workspace-topbar {
    margin-left: 0;
    transition: none;
  }
  .navbar-inner {
    flex-wrap: wrap;
  }
  .workspace-sidebar:not(.menu-open) .navbar-links {
    display: none;
  }
  .navbar-links {
    width: 100%;
    flex-wrap: wrap;
    padding-top: 8px;
    border-top: 1px solid var(--app-line);
  }
  .mobile-menu-toggle {
    display: inline-flex;
    margin-left: auto;
  }
}
@media (max-width: 600px) {
  .workspace-topbar {
    min-height: 58px;
    font-size: 12px;
  }
  .account-label {
    display: none;
  }
  .navbar-actions {
    gap: 4px;
  }
  .brand-text strong {
    font-size: 14px;
  }
  .brand-text small {
    font-size: 11px;
  }
}
</style>

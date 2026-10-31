<script setup lang="ts">
import { computed } from 'vue'
import { useRoute, useRouter } from 'vue-router'

import { useAuthStore } from '../stores/auth.store'
import { ROLE_LABELS } from '../types'

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
const roleName = computed(() => authStore.user?.role ? ROLE_LABELS[authStore.user.role] : '')

async function handleLogout() {
  await authStore.logout()
  router.push({ name: 'home' })
}

async function handleHome() {
  if (authStore.isAuthenticated) {
    await authStore.fetchMe()
  }
  router.push({ name: 'home' })
}
</script>

<template>
  <header v-if="showNavbar" class="app-navbar">
    <div class="navbar-inner">
      <button type="button" class="brand" @click="handleHome">
        <span class="brand-badge">
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

      <nav class="navbar-links">
        <button
          type="button"
          class="nav-link"
          :class="{ active: route.name === 'home' }"
          @click="router.push({ name: 'home' })"
        >
          Trang chủ
        </button>
        <button
          v-if="isAuthenticated && authStore.user?.role === 'DISTRIBUTOR'"
          type="button"
          class="nav-link"
          :class="{ active: route.name === 'home' }"
          @click="router.push({ name: 'home' })"
        >
          Hồ sơ truy xuất
        </button>
        <button
          v-if="isAuthenticated && authStore.user?.role === 'FARMER'"
          type="button"
          class="nav-link"
          :class="{ active: route.name === 'farms' }"
          @click="router.push({ name: 'farms' })"
        >
          Cơ sở nuôi
        </button>
        <button
          v-if="isAuthenticated && authStore.user?.role === 'DISTRIBUTOR'"
          type="button"
          class="nav-link"
          :class="{ active: route.name === 'receipts' }"
          @click="router.push({ name: 'receipts' })"
        >
          Hàng nhận
        </button>
        <button
          v-if="isAuthenticated && authStore.user?.role === 'TRANSPORTER'"
          type="button"
          class="nav-link"
          :class="{ active: route.name === 'transports' }"
          @click="router.push({ name: 'transports' })"
        >
          Vận chuyển
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
          <div class="user-chip">
            <span class="user-avatar">{{ initials }}</span>
            <span class="user-meta"><span class="user-name">{{ authStore.fullName }}</span><small>{{ roleName }}</small></span>
          </div>
          <va-button preset="ghost" size="small" @click="handleLogout">
            Đăng xuất
          </va-button>
        </template>
      </div>
    </div>
  </header>
</template>

<style scoped>
.app-navbar {
  position: sticky;
  top: 0;
  z-index: 100;
  background: rgb(255 255 255 / 93%);
  backdrop-filter: blur(16px);
  border-bottom: 1px solid #e5eeec;
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
  background: linear-gradient(145deg, #11786f, #24a38d);
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
  color: #17343a;
  font-size: 1rem;
  font-weight: 800;
}

.brand-text small {
  color: #789093;
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
  color: #60777b;
  padding: 0.55rem 0.9rem;
  border-radius: 9px;
  transition: background 0.15s ease, color 0.15s ease;
}

.nav-link:hover {
  color: #155e57;
  background: #f1f7f5;
}

.nav-link.active {
  color: #0d6d64;
  background: #eaf5f1;
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
  background: linear-gradient(145deg, #11786f, #24a38d);
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
  color: #24464b;
}

.user-meta {
  display: grid;
  line-height: 1.2;
  gap: .12rem;
}

.user-meta small {
  color: #789093;
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
</style>

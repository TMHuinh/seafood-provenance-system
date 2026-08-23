<script setup lang="ts">
import { computed } from 'vue'
import { useRoute, useRouter } from 'vue-router'

import { useAuthStore } from '../stores/auth.store'

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
            <span class="user-name">{{ authStore.fullName }}</span>
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
  z-index: 50;
  background: rgba(255, 255, 255, 0.85);
  backdrop-filter: blur(10px);
  border-bottom: 1px solid #e2e8f0;
}

.navbar-inner {
  max-width: 1180px;
  margin: 0 auto;
  padding: 0.7rem 2rem;
  display: flex;
  align-items: center;
  gap: 1.5rem;
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
  width: 40px;
  height: 40px;
  border-radius: 12px;
  background: linear-gradient(135deg, #0e7490, #14b8a6);
  color: #fff;
  display: flex;
  align-items: center;
  justify-content: center;
  box-shadow: 0 8px 20px rgba(14, 116, 144, 0.3);
}

.brand-text {
  display: flex;
  flex-direction: column;
  line-height: 1.2;
  text-align: left;
}

.brand-text strong {
  color: #0f172a;
  font-size: 1rem;
  font-weight: 800;
}

.brand-text small {
  color: #64748b;
  font-size: 0.74rem;
}

.navbar-links {
  display: flex;
  gap: 0.25rem;
  margin-left: 0.5rem;
}

.nav-link {
  background: none;
  border: none;
  cursor: pointer;
  font-size: 0.92rem;
  font-weight: 600;
  color: #475569;
  padding: 0.45rem 0.85rem;
  border-radius: 8px;
  transition: background 0.15s ease, color 0.15s ease;
}

.nav-link:hover {
  background: #f1f5f9;
}

.nav-link.active {
  color: #0e7490;
  background: rgba(14, 116, 144, 0.08);
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
}

.user-avatar {
  width: 32px;
  height: 32px;
  border-radius: 9999px;
  background: linear-gradient(135deg, #0e7490, #14b8a6);
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
  color: #0f172a;
}

@media (max-width: 700px) {
  .navbar-inner {
    padding: 0.7rem 1.25rem;
    flex-wrap: wrap;
  }
  .navbar-links {
    display: none;
  }
  .user-name {
    display: none;
  }
}
</style>

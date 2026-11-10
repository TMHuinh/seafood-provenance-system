<script setup lang="ts">
import { computed, onBeforeUnmount, onMounted, ref, watch } from 'vue'
import { RouterView, useRoute, useRouter } from 'vue-router'

import { AUTH_UNAUTHORIZED_EVENT, TOKEN_KEY } from './api/client'
import AppNavbar from './components/AppNavbar.vue'
import { useAuthStore } from './stores/auth.store'

const router = useRouter()
const route = useRoute()
const authStore = useAuthStore()
const sidebarCollapsed = ref(false)
try { sidebarCollapsed.value = localStorage.getItem('seafood_sidebar_collapsed') === 'true' } catch { /* Storage may be unavailable in private browsing. */ }
watch(sidebarCollapsed, (collapsed) => {
  try { localStorage.setItem('seafood_sidebar_collapsed', String(collapsed)) } catch { /* Keep the toggle usable without persistent storage. */ }
})
const workspace = computed(() => authStore.isAuthenticated && !['trace', 'login', 'register'].includes(String(route.name)))

function handleUnauthorized() {
  const redirect = route.fullPath
  authStore.clearSession()
  if (route.name === 'trace') return
  router.push({ name: 'login', query: { redirect } })
}

function handleStorage(event: StorageEvent) {
  if (event.storageArea !== localStorage || (event.key !== TOKEN_KEY && event.key !== null)) return
  authStore.syncSession()
  if (route.name === 'trace') return
  void router.replace({ name: authStore.isAuthenticated ? 'home' : 'login' })
}

onMounted(async () => {
  window.addEventListener(AUTH_UNAUTHORIZED_EVENT, handleUnauthorized)
  window.addEventListener('storage', handleStorage)
  await router.isReady()
  if (route.name !== 'trace' && authStore.token && !authStore.user) {
    void authStore.fetchMe()
  }
})

onBeforeUnmount(() => {
  window.removeEventListener(AUTH_UNAUTHORIZED_EVENT, handleUnauthorized)
  window.removeEventListener('storage', handleStorage)
})
</script>

<template>
  <div class="app-shell" :class="{ 'is-workspace': workspace }" :style="{ '--sidebar-width': sidebarCollapsed ? '80px' : '240px' }">
    <a class="skip-link" href="#main-content">Đến nội dung chính</a>
    <AppNavbar v-if="route.name !== 'trace'" :collapsed="sidebarCollapsed" @toggle-sidebar="sidebarCollapsed = !sidebarCollapsed" />
    <div id="main-content" class="workspace-content" tabindex="-1">
      <RouterView :key="authStore.token ?? 'guest'" />
    </div>
  </div>
</template>

<style scoped>
.app-shell {
  min-height: 100vh;
  display: flex;
  flex-direction: column;
}
</style>

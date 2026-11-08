<script setup lang="ts">
import { onBeforeUnmount, onMounted } from 'vue'
import { RouterView, useRoute, useRouter } from 'vue-router'

import { AUTH_UNAUTHORIZED_EVENT, TOKEN_KEY } from './api/client'
import AppNavbar from './components/AppNavbar.vue'
import { useAuthStore } from './stores/auth.store'

const router = useRouter()
const route = useRoute()
const authStore = useAuthStore()

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
  <div class="app-shell">
    <AppNavbar v-if="route.name !== 'trace'" />
    <RouterView :key="authStore.token ?? 'guest'" />
  </div>
</template>

<style scoped>
.app-shell {
  min-height: 100vh;
  display: flex;
  flex-direction: column;
}
</style>

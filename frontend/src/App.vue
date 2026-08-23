<script setup lang="ts">
import { onBeforeUnmount, onMounted } from 'vue'
import { RouterView, useRouter } from 'vue-router'

import { AUTH_UNAUTHORIZED_EVENT } from './api/client'
import AppNavbar from './components/AppNavbar.vue'
import { useAuthStore } from './stores/auth.store'

const router = useRouter()
const authStore = useAuthStore()

function handleUnauthorized() {
  authStore.clearSession()
  router.push({ name: 'login' })
}

onMounted(() => {
  window.addEventListener(AUTH_UNAUTHORIZED_EVENT, handleUnauthorized)
  if (authStore.token && !authStore.user) {
    void authStore.fetchMe()
  }
})

onBeforeUnmount(() => {
  window.removeEventListener(AUTH_UNAUTHORIZED_EVENT, handleUnauthorized)
})
</script>

<template>
  <div class="app-shell">
    <AppNavbar />
    <RouterView />
  </div>
</template>

<style scoped>
.app-shell {
  min-height: 100vh;
  display: flex;
  flex-direction: column;
}
</style>

import { createRouter, createWebHistory } from 'vue-router'

import HomePage from '../pages/home/HomePage.vue'
import { useAuthStore } from '../stores/auth.store'

const router = createRouter({
  history: createWebHistory(import.meta.env.BASE_URL),
  routes: [
    {
      path: '/',
      name: 'home',
      component: HomePage,
    },
    {
      path: '/login',
      name: 'login',
      component: () => import('../pages/auth/LoginPage.vue'),
      meta: { guestOnly: true },
    },
    {
      path: '/register',
      name: 'register',
      component: () => import('../pages/auth/RegisterPage.vue'),
      meta: { guestOnly: true },
    },
    {
      path: '/farms',
      name: 'farms',
      component: () => import('../pages/farms/FarmsPage.vue'),
      meta: { requiresAuth: true },
    },
    {
      path: '/farms/:farmId/ponds',
      name: 'ponds',
      component: () => import('../pages/ponds/PondsPage.vue'),
      meta: { requiresAuth: true },
    },
    {
      path: '/farms/:farmId/ponds/:pondId/batches',
      name: 'pond-batches',
      component: () => import('../pages/batches/PondBatchesPage.vue'),
      meta: { requiresAuth: true },
    },
    {
      path: '/:pathMatch(.*)*',
      redirect: '/',
    },
  ],
})

router.beforeEach((to) => {
  const authStore = useAuthStore()

  if (to.meta.guestOnly && authStore.isAuthenticated) {
    return { name: 'home' }
  }

  if (to.meta.requiresAuth && !authStore.isAuthenticated) {
    return { name: 'login', query: { redirect: to.fullPath } }
  }

  return true
})

export default router

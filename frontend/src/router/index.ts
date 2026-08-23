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

  return true
})

export default router

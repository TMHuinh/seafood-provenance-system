import { createRouter, createWebHistory } from 'vue-router'

import HomePage from '../pages/home/HomePage.vue'
import { useAuthStore } from '../stores/auth.store'

const router = createRouter({
  history: createWebHistory(import.meta.env.BASE_URL),
  routes: [
    {
      path: '/trace/:traceCode/report',
      name: 'trace-report',
      component: () => import('../pages/lots/LotReportPage.vue'),
    },
    {
      path: '/lo-hang',
      name: 'lots',
      component: () => import('../pages/lots/LotsPage.vue'),
      meta: { requiresAuth: true, roles: ['FARMER', 'ADMIN'] },
    },
    {
      path: '/thong-ke/san-luong',
      name: 'production',
      component: () => import('../pages/lots/ProductionPage.vue'),
      meta: { requiresAuth: true, roles: ['FARMER', 'ADMIN'] },
    },
    {
      path: '/lo-hang/:lotId/bao-cao',
      name: 'lot-report',
      component: () => import('../pages/lots/LotReportPage.vue'),
      meta: { requiresAuth: true, roles: ['FARMER', 'ADMIN'] },
    },
    {
      path: '/trace/:traceCode',
      name: 'trace',
      component: () => import('../pages/trace/TracePage.vue'),
    },
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
      path: '/forgot-password',
      name: 'forgot-password',
      component: () => import('../pages/auth/ForgotPasswordPage.vue'),
    },
    {
      path: '/reset-password',
      name: 'reset-password',
      component: () => import('../pages/auth/ResetPasswordPage.vue'),
    },
    {
      path: '/admin/users',
      name: 'admin-users',
      component: () => import('../pages/admin/UsersPage.vue'),
      meta: { requiresAuth: true, role: 'ADMIN' },
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
    ...([
      ['farm-ponds', 'ao-nuoi', 'ponds'],
      ['farm-batches', 'vu-nuoi', 'batches'],
      ['farm-logs', 'nhat-ky', 'logs'],
      ['farm-harvest', 'thu-hoach', 'harvest'],
    ] as const).map(([name, path, section]) => ({
      path: `/quan-ly/${path}`,
      name,
      component: () => import('../pages/farms/FarmWorkspace.vue'),
      props: { section },
      meta: { requiresAuth: true, role: 'FARMER' },
    })),
    {
      path: '/transports',
      name: 'transports',
      component: () => import('../pages/transports/TransporterDashboard.vue'),
      meta: { requiresAuth: true, role: 'TRANSPORTER' },
    },
    {
      path: '/receipts',
      name: 'receipts',
      component: () => import('../pages/transports/DistributorReceipts.vue'),
      meta: { requiresAuth: true, role: 'DISTRIBUTOR' },
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
      path: '/farms/:farmId/ponds/:pondId/batches/:batchId/logs',
      name: 'farming-logs',
      component: () => import('../pages/batches/FarmingLogsPage.vue'),
      meta: { requiresAuth: true },
    },
    {
      path: '/:pathMatch(.*)*',
      redirect: '/',
    },
  ],
})

router.beforeEach(async (to) => {
  const authStore = useAuthStore()

  if (to.meta.guestOnly && authStore.isAuthenticated) {
    return { name: 'home' }
  }

  if (to.meta.requiresAuth && !authStore.isAuthenticated) {
    return { name: 'login', query: { redirect: to.fullPath } }
  }

  if ((to.meta.role || to.meta.roles) && !authStore.user) await authStore.fetchMe()
  if (to.meta.requiresAuth && !authStore.isAuthenticated) {
    return { name: 'login', query: { redirect: to.fullPath } }
  }
  if (to.meta.role && authStore.user?.role !== to.meta.role) return { name: 'home' }
  if (Array.isArray(to.meta.roles) && !to.meta.roles.includes(authStore.user?.role)) return { name: 'home' }

  return true
})

export default router

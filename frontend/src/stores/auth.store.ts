import { defineStore } from 'pinia'

import { api, setToken, getToken, captureSession, StaleRequestError, ApiError } from '../api/client'
import { useBatchesStore } from './batches.store'
import { useFarmsStore } from './farms.store'
import { usePondsStore } from './ponds.store'
import { usePondBatchesStore } from './pond-batches.store'
import { useFarmingLogsStore } from './farming-logs.store'
import type { AuthResponse, UserProfile } from '../types'

let authAttempt = 0

export interface RegisterPayload {
  fullName: string
  email: string
  password: string
  phone?: string
  role?: 'FARMER' | 'TRANSPORTER' | 'DISTRIBUTOR'
  organizationName?: string
  organizationType?: string
  organizationAddress?: string
  walletAddress?: string
}

interface AuthState {
  token: string | null
  user: UserProfile | null
  loading: boolean
}

export const useAuthStore = defineStore('auth', {
  state: (): AuthState => ({
    token: getToken(),
    user: null,
    loading: false,
  }),

  getters: {
    isAuthenticated: (state) => Boolean(state.token),
    fullName: (state) => state.user?.full_name ?? 'Khách',
    roleLabel: (state) => state.user?.role ?? null,
    organizationName: (state) => state.user?.organization?.name ?? null,
  },

  actions: {
    async login(email: string, password: string): Promise<AuthResponse> {
      this.clearSession()
      const current = captureSession()
      const attempt = ++authAttempt
      this.loading = true
      try {
        const result = await api.post<AuthResponse>('/auth/login', { email, password }, false)
        if (!current()) throw new StaleRequestError()
        this.token = result.accessToken
        setToken(result.accessToken)
        this.user = result.user
        return result
      } finally {
        if (attempt === authAttempt) this.loading = false
      }
    },

    async register(payload: RegisterPayload): Promise<AuthResponse> {
      this.clearSession()
      const current = captureSession()
      const attempt = ++authAttempt
      this.loading = true
      try {
        const result = await api.post<AuthResponse>('/auth/register', payload, false)
        if (!current()) throw new StaleRequestError()
        if (!result.requiresConfirmation && result.accessToken) {
          this.token = result.accessToken
          setToken(result.accessToken)
          this.user = result.user
        }
        return result
      } finally {
        if (attempt === authAttempt) this.loading = false
      }
    },

    async fetchMe(): Promise<void> {
      if (!this.token) return
      const current = captureSession()
      const token = this.token
      try {
        const result = await api.get<{ success: boolean; user: UserProfile }>('/auth/me')
        if (current()) this.user = result.user
      } catch (error) {
        if (error instanceof ApiError && (error.status === 401 || error.code === 'ACCOUNT_DISABLED') && !getToken() && this.token === token) this.clearSession()
      }
    },

    async logout(): Promise<void> {
      const current = captureSession()
      try {
        if (this.token) {
          await api.post<void>('/auth/logout', undefined, true)
        }
      } finally {
        if (current()) this.clearSession()
      }
    },

    clearSession(): void {
      authAttempt++
      this.token = null
      this.user = null
      setToken(null)
      this.loading = false
      this.resetDomainState()
    },

    syncSession(): void {
      authAttempt++
      this.token = getToken()
      this.user = null
      this.loading = false
      setToken(this.token)
      this.resetDomainState()
    },

    resetDomainState(): void {
      useBatchesStore().$reset()
      useFarmsStore().$reset()
      usePondsStore().$reset()
      usePondBatchesStore().$reset()
      useFarmingLogsStore().$reset()
    },
  },
})

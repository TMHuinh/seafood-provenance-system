import { defineStore } from 'pinia'

import { api, setToken, getToken, ApiError } from '../lib/api'
import type { AuthResponse, UserProfile } from '../types'

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
      this.loading = true
      try {
        const result = await api.post<AuthResponse>('/auth/login', { email, password }, false)
        this.token = result.accessToken
        setToken(result.accessToken)
        this.user = result.user
        return result
      } finally {
        this.loading = false
      }
    },

    async register(payload: RegisterPayload): Promise<AuthResponse> {
      this.loading = true
      try {
        const result = await api.post<AuthResponse>('/auth/register', payload, false)
        if (!result.requiresConfirmation && result.accessToken) {
          this.token = result.accessToken
          setToken(result.accessToken)
          this.user = result.user
        }
        return result
      } finally {
        this.loading = false
      }
    },

    async fetchMe(): Promise<void> {
      if (!this.token) return
      try {
        const result = await api.get<{ success: boolean; user: UserProfile }>('/auth/me')
        this.user = result.user
      } catch (error) {
        if (error instanceof ApiError && error.status === 401) {
          this.clearSession()
        }
      }
    },

    async logout(): Promise<void> {
      try {
        if (this.token) {
          await api.post<void>('/auth/logout', undefined, true)
        }
      } finally {
        this.clearSession()
      }
    },

    clearSession(): void {
      this.token = null
      this.user = null
      setToken(null)
    },
  },
})
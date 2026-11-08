import { defineStore } from 'pinia'
import { api, ApiError } from '../api/client'
import { captureStoreRequest, requireCurrent } from './request-guard'
import type { Pond, PondInput, PondListResponse, PondResponse } from '../types'

const message = (error: unknown, fallback: string) => error instanceof ApiError ? error.message : fallback

export const usePondsStore = defineStore('ponds', {
  state: () => ({ items: [] as Pond[], loading: false, saving: false, error: '', scope: '', requestVersion: 0 }),
  actions: {
    async load(farmId: string) {
      this.requestVersion++; this.scope = farmId
      const current = captureStoreRequest(this)
      this.items = []; this.loading = true; this.saving = false; this.error = ''
      try {
        const result = await api.get<PondListResponse>(`/farms/${farmId}/ponds`)
        if (current()) this.items = result.items ?? []
      } catch (e) { if (current()) this.error = message(e, 'Không thể tải danh sách ao nuôi') }
      finally { if (current()) this.loading = false }
    },
    async create(farmId: string, input: PondInput) {
      const current = captureStoreRequest(this)
      const scoped = () => current() && this.scope === farmId
      requireCurrent(scoped)
      this.saving = true; this.error = ''
      try {
        const pond = (await api.post<PondResponse>(`/farms/${farmId}/ponds`, input)).pond
        requireCurrent(scoped); this.items.unshift(pond); return pond
      } catch (e) { if (scoped()) this.error = message(e, 'Không thể tạo ao nuôi'); throw e }
      finally { if (scoped()) this.saving = false }
    },
    async update(farmId: string, id: string, input: Partial<PondInput>) {
      const current = captureStoreRequest(this)
      const scoped = () => current() && this.scope === farmId
      requireCurrent(scoped)
      this.saving = true; this.error = ''
      try {
        const pond = (await api.patch<PondResponse>(`/farms/${farmId}/ponds/${id}`, input)).pond
        requireCurrent(scoped)
        const index = this.items.findIndex((item) => item.id === id)
        if (index >= 0) this.items[index] = pond
        return pond
      } catch (e) { if (scoped()) this.error = message(e, 'Không thể cập nhật ao nuôi'); throw e }
      finally { if (scoped()) this.saving = false }
    },
    async remove(farmId: string, id: string) {
      const current = captureStoreRequest(this)
      const scoped = () => current() && this.scope === farmId
      requireCurrent(scoped); this.error = ''
      try {
        await api.delete<void>(`/farms/${farmId}/ponds/${id}`)
        requireCurrent(scoped); this.items = this.items.filter((item) => item.id !== id)
      } catch (e) { if (scoped()) this.error = message(e, 'Không thể xóa ao nuôi'); throw e }
    },
  },
})

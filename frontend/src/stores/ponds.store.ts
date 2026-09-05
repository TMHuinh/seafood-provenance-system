import { defineStore } from 'pinia'
import { api, ApiError } from '../api/client'
import type { Pond, PondInput, PondListResponse, PondResponse } from '../types'

const message = (error: unknown, fallback: string) => error instanceof ApiError ? error.message : fallback

export const usePondsStore = defineStore('ponds', {
  state: () => ({ items: [] as Pond[], loading: false, saving: false, error: '' }),
  actions: {
    async load(farmId: string) {
      this.loading = true; this.error = ''
      try { this.items = (await api.get<PondListResponse>(`/farms/${farmId}/ponds`)).items ?? [] }
      catch (e) { this.error = message(e, 'Không thể tải danh sách ao nuôi') }
      finally { this.loading = false }
    },
    async create(farmId: string, input: PondInput) {
      this.saving = true; this.error = ''
      try { const pond = (await api.post<PondResponse>(`/farms/${farmId}/ponds`, input)).pond; this.items.unshift(pond); return pond }
      catch (e) { this.error = message(e, 'Không thể tạo ao nuôi'); throw e }
      finally { this.saving = false }
    },
    async update(farmId: string, id: string, input: Partial<PondInput>) {
      this.saving = true; this.error = ''
      try { const pond = (await api.patch<PondResponse>(`/farms/${farmId}/ponds/${id}`, input)).pond; const index = this.items.findIndex((item) => item.id === id); if (index >= 0) this.items[index] = pond; return pond }
      catch (e) { this.error = message(e, 'Không thể cập nhật ao nuôi'); throw e }
      finally { this.saving = false }
    },
    async remove(farmId: string, id: string) {
      this.error = ''
      try { await api.delete<void>(`/farms/${farmId}/ponds/${id}`); this.items = this.items.filter((item) => item.id !== id) }
      catch (e) { this.error = message(e, 'Không thể xóa ao nuôi'); throw e }
    },
  },
})

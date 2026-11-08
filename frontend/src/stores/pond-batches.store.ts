import { defineStore } from 'pinia'
import { api, ApiError } from '../api/client'
import { captureStoreRequest, requireCurrent } from './request-guard'
import type { BatchInput, BatchItem, PondBatchListResponse, BatchCorrectionInput, BatchHistoryResponse, PondBatchCreateResponse } from '../types'

const msg = (e: unknown, fallback: string) => e instanceof ApiError ? e.message : fallback
const base = (farmId: string, pondId: string) => `/farms/${farmId}/ponds/${pondId}/batches`

export const usePondBatchesStore = defineStore('pond-batches', {
  state: () => ({ items: [] as BatchItem[], loading: false, saving: false, error: '', scope: '', requestVersion: 0 }),
  actions: {
    async load(farmId: string, pondId: string) {
      this.requestVersion++; this.scope = base(farmId, pondId)
      const current = captureStoreRequest(this)
      this.items = []; this.loading = true; this.saving = false; this.error = ''
      try {
        const result = await api.get<PondBatchListResponse>(base(farmId, pondId))
        if (current()) this.items = result.items ?? []
      } catch (e) { if (current()) this.error = msg(e, 'Không thể tải danh sách vụ nuôi') }
      finally { if (current()) this.loading = false }
    },
    async create(farmId: string, pondId: string, input: BatchInput) {
      const current = captureStoreRequest(this)
      const scoped = () => current() && this.scope === base(farmId, pondId)
      requireCurrent(scoped); this.saving = true; this.error = ''
      try {
        const result = await api.post<PondBatchCreateResponse>(base(farmId, pondId), input)
        requireCurrent(scoped); this.items.unshift(result.batch); return result
      } catch (e) { if (scoped()) this.error = msg(e, 'Không thể tạo vụ nuôi'); throw e }
      finally { if (scoped()) this.saving = false }
    },
    async update(farmId: string, pondId: string, id: string, input: BatchCorrectionInput) {
      const current = captureStoreRequest(this)
      const scoped = () => current() && this.scope === base(farmId, pondId)
      requireCurrent(scoped); this.saving = true; this.error = ''
      try {
        const result = await api.patch<PondBatchCreateResponse>(`${base(farmId, pondId)}/${id}`, input)
        requireCurrent(scoped)
        const index = this.items.findIndex((item) => item.id === id)
        if (index >= 0) this.items[index] = result.batch
        return result
      } catch (e) { if (scoped()) this.error = msg(e, 'Không thể cập nhật vụ nuôi'); throw e }
      finally { if (scoped()) this.saving = false }
    },
    async history(farmId: string, pondId: string, id: string) {
      const current = captureStoreRequest(this)
      const result = await api.get<BatchHistoryResponse>(`${base(farmId, pondId)}/${id}/history`)
      requireCurrent(() => current() && this.scope === base(farmId, pondId))
      return result.items
    },
    async remove(farmId: string, pondId: string, id: string) {
      const current = captureStoreRequest(this)
      const scoped = () => current() && this.scope === base(farmId, pondId)
      requireCurrent(scoped); this.error = ''
      try {
        await api.delete<void>(`${base(farmId, pondId)}/${id}`)
        requireCurrent(scoped); this.items = this.items.filter((item) => item.id !== id)
      } catch (e) { if (scoped()) this.error = msg(e, 'Không thể xóa vụ nuôi'); throw e }
    },
  },
})

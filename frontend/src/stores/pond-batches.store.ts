import { defineStore } from 'pinia'
import { api, ApiError } from '../api/client'
import type { BatchInput, BatchItem, PondBatchListResponse, BatchCorrectionInput, BatchHistoryResponse, PondBatchCreateResponse } from '../types'

const msg = (e: unknown, fallback: string) => e instanceof ApiError ? e.message : fallback
const base = (farmId: string, pondId: string) => `/farms/${farmId}/ponds/${pondId}/batches`

export const usePondBatchesStore = defineStore('pond-batches', {
  state: () => ({ items: [] as BatchItem[], loading: false, saving: false, error: '' }),
  actions: {
    async load(farmId: string, pondId: string) { this.loading = true; this.error = ''; try { this.items = (await api.get<PondBatchListResponse>(base(farmId, pondId))).items ?? [] } catch (e) { this.error = msg(e, 'Không thể tải danh sách vụ nuôi') } finally { this.loading = false } },
    async create(farmId: string, pondId: string, input: BatchInput) { this.saving = true; this.error = ''; try { const result = await api.post<PondBatchCreateResponse>(base(farmId, pondId), input); this.items.unshift(result.batch); return result } catch (e) { this.error = msg(e, 'Không thể tạo vụ nuôi'); throw e } finally { this.saving = false } },
    async update(farmId: string, pondId: string, id: string, input: BatchCorrectionInput) { this.saving = true; this.error = ''; try { const result = await api.patch<PondBatchCreateResponse>(`${base(farmId, pondId)}/${id}`, input); const item = result.batch; const index = this.items.findIndex((x) => x.id === id); if (index >= 0) this.items[index] = item; return result } catch (e) { this.error = msg(e, 'Không thể cập nhật vụ nuôi'); throw e } finally { this.saving = false } },
    async history(farmId: string, pondId: string, id: string) {
      return (await api.get<BatchHistoryResponse>(`${base(farmId, pondId)}/${id}/history`)).items
    },
    async remove(farmId: string, pondId: string, id: string) { this.error = ''; try { await api.delete<void>(`${base(farmId, pondId)}/${id}`); this.items = this.items.filter((x) => x.id !== id) } catch (e) { this.error = msg(e, 'Không thể xóa vụ nuôi'); throw e } },
  },
})

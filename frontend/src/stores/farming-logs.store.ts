import { defineStore } from 'pinia'
import { api, ApiError } from '../api/client'
import type { FarmingLog, FarmingLogHistoryResponse, FarmingLogInput, FarmingLogListResponse, FarmingLogResponse, FarmingLogVerifyResponse } from '../types'

const msg = (e: unknown, fallback: string) => (e instanceof ApiError ? e.message : fallback)

export const useFarmingLogsStore = defineStore('farming-logs', {
  state: () => ({ items: [] as FarmingLog[], loading: false, saving: false, verifying: false, error: '' }),
  actions: {
    async load(batchId: string) {
      this.loading = true
      this.error = ''
      try {
        this.items = (await api.get<FarmingLogListResponse>(`/farming-logs/batch/${batchId}`)).items ?? []
      } catch (e) {
        this.error = msg(e, 'Không thể tải danh sách nhật ký nuôi')
      } finally {
        this.loading = false
      }
    },
    async create(input: FarmingLogInput) {
      this.saving = true
      this.error = ''
      try {
        const item = (await api.post<FarmingLogResponse>('/farming-logs', input)).log
        this.items.unshift(item)
        return item
      } catch (e) {
        this.error = msg(e, 'Không thể tạo nhật ký nuôi')
        throw e
      } finally {
        this.saving = false
      }
    },
    async update(id: string, input: FarmingLogInput) {
      this.saving = true
      this.error = ''
      try {
        const item = (await api.patch<FarmingLogResponse>(`/farming-logs/${id}`, input)).log
        const index = this.items.findIndex((log) => log.id === id)
        if (index >= 0) this.items[index] = item
        return item
      } catch (e) {
        this.error = msg(e, 'Không thể cập nhật nhật ký nuôi')
        throw e
      } finally {
        this.saving = false
      }
    },
    async confirm(id: string) { return await this.mutate(id, `/farming-logs/${id}/confirm`, {}) },
    async correct(id: string, input: FarmingLogInput & { expectedVersion: number }) { return await this.mutate(id, `/farming-logs/${id}/corrections`, input) },
    async revoke(id: string, reason: string) { return await this.mutate(id, `/farming-logs/${id}/revoke`, { reason }) },
    async history(id: string) { return await api.get<FarmingLogHistoryResponse>(`/farming-logs/${id}/history`) },
    async mutate(id: string, path: string, body: unknown) {
      this.saving = true; this.error = ''
      try { const item = (await api.post<FarmingLogResponse>(path, body)).log; const index = this.items.findIndex((log) => log.id === id); if (index >= 0) this.items[index] = item; return item }
      catch (e) { this.error = msg(e, 'Không thể cập nhật trạng thái nhật ký'); throw e }
      finally { this.saving = false }
    },
    async verify(batchId: string) {
      this.verifying = true
      this.error = ''
      try {
        return await api.get<FarmingLogVerifyResponse>(`/farming-logs/batch/${batchId}/verify`)
      } catch (e) {
        this.error = msg(e, 'Không thể kiểm tra đồng bộ blockchain')
        throw e
      } finally {
        this.verifying = false
      }
    },
  },
})

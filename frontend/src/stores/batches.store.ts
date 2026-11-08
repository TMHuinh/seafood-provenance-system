import { defineStore } from 'pinia'
import { api, ApiError } from '../api/client'
import { captureStoreRequest } from './request-guard'
import type { BatchDetailResponse, BatchItem, BatchListResponse, BatchSummary } from '../types'

export const useBatchesStore = defineStore('batches', {
  state: () => ({
    batches: [] as BatchItem[], summary: null as BatchSummary | null,
    loadingBatches: false, batchesError: '',
    page: 1, pageSize: 12, search: '', status: '', totalPages: 0, count: 0,
    requestVersion: 0, detailVersion: 0,
    detailVisible: false, detailLoading: false, detailError: '',
    detail: null as BatchDetailResponse | null, selectedBatch: null as BatchItem | null,
  }),
  actions: {
    async loadBatches(): Promise<void> {
      this.closeDetail()
      this.requestVersion++
      const current = captureStoreRequest(this)
      this.loadingBatches = true; this.batchesError = ''
      this.batches = []; this.summary = null; this.count = 0; this.totalPages = 0
      const query = new URLSearchParams({ page: String(this.page), pageSize: String(this.pageSize) })
      if (this.search.trim()) query.set('search', this.search.trim())
      if (this.status) query.set('status', this.status)
      try {
        const result = await api.get<BatchListResponse>(`/batches?${query}`)
        if (!current()) return
        this.batches = result.items ?? []; this.summary = result.summary ?? null
        this.page = result.page; this.pageSize = result.pageSize
        this.count = result.count; this.totalPages = result.totalPages
      } catch (error) {
        if (current()) this.batchesError = error instanceof ApiError ? error.message : 'Không thể tải danh sách vụ nuôi'
      } finally { if (current()) this.loadingBatches = false }
    },
    async setPage(page: number): Promise<void> {
      this.page = Number.isFinite(page) ? Math.max(1, Math.trunc(page)) : 1
      await this.loadBatches()
    },
    async applyFilters(search: string, status: string): Promise<void> {
      this.search = search.trim(); this.status = status; this.page = 1
      await this.loadBatches()
    },
    async openDetail(batch: BatchItem): Promise<void> {
      const version = ++this.detailVersion
      const current = captureStoreRequest(this)
      this.selectedBatch = batch; this.detailVisible = true; this.detailLoading = true
      this.detail = null; this.detailError = ''
      const detailCurrent = () => current() && version === this.detailVersion && this.detailVisible
      try {
        const result = await api.get<BatchDetailResponse>(`/batches/${batch.id}`)
        if (detailCurrent()) this.detail = result
      } catch (error) {
        if (detailCurrent()) this.detailError = error instanceof ApiError ? error.message : 'Không thể tải chi tiết vụ nuôi'
      } finally { if (detailCurrent()) this.detailLoading = false }
    },
    closeDetail(): void {
      this.detailVersion++; this.detailVisible = false; this.detailLoading = false
      this.detail = null; this.selectedBatch = null; this.detailError = ''
    },
    clear(): void {
      const version = this.requestVersion + 1
      const detailVersion = this.detailVersion + 1
      this.$reset(); this.requestVersion = version; this.detailVersion = detailVersion
    },
  },
})

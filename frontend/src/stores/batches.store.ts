import { defineStore } from 'pinia'

import { api, ApiError } from '../api/client'
import type {
  BatchDetailResponse,
  BatchItem,
  BatchListResponse,
  BatchSummary,
} from '../types'

interface BatchesState {
  batches: BatchItem[]
  summary: BatchSummary | null
  loadingBatches: boolean
  batchesError: string
  detailVisible: boolean
  detailLoading: boolean
  detail: BatchDetailResponse | null
  selectedBatch: BatchItem | null
}

export const useBatchesStore = defineStore('batches', {
  state: (): BatchesState => ({
    batches: [],
    summary: null,
    loadingBatches: false,
    batchesError: '',
    detailVisible: false,
    detailLoading: false,
    detail: null,
    selectedBatch: null,
  }),

  actions: {
    async loadBatches(): Promise<void> {
      this.loadingBatches = true
      this.batchesError = ''
      try {
        const result = await api.get<BatchListResponse>('/batches')
        this.batches = result.items ?? []
        this.summary = result.summary ?? null
      } catch (error) {
        this.batchesError =
          error instanceof ApiError ? error.message : 'Không thể tải danh sách lô hàng'
      } finally {
        this.loadingBatches = false
      }
    },

    async openDetail(batch: BatchItem): Promise<void> {
      this.selectedBatch = batch
      this.detailVisible = true
      this.detailLoading = true
      this.detail = null
      try {
        this.detail = await api.get<BatchDetailResponse>(`/batches/${batch.id}`)
      } catch (error) {
        this.batchesError =
          error instanceof ApiError ? error.message : 'Không thể tải chi tiết lô hàng'
      } finally {
        this.detailLoading = false
      }
    },

    clear(): void {
      this.$reset()
    },
  },
})

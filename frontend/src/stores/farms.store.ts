import { defineStore } from 'pinia'

import { api, ApiError } from '../api/client'
import { captureStoreRequest, requireCurrent } from './request-guard'
import type { Farm, FarmInput, FarmListResponse, FarmResponse } from '../types'

interface FarmsState {
  requestVersion: number
  items: Farm[]
  loading: boolean
  saving: boolean
  error: string
}

function errorMessage(error: unknown, fallback: string): string {
  return error instanceof ApiError ? error.message : fallback
}

export const useFarmsStore = defineStore('farms', {
  state: (): FarmsState => ({ requestVersion: 0, items: [], loading: false, saving: false, error: '' }),

  actions: {
    async load(): Promise<void> {
      this.requestVersion++
      const current = captureStoreRequest(this)
      this.items = []; this.saving = false
      this.loading = true
      this.error = ''
      try {
        const result = await api.get<FarmListResponse>('/farms')
        if (current()) this.items = result.items ?? []
      } catch (error) {
        if (current()) this.error = errorMessage(error, 'Không thể tải danh sách cơ sở nuôi')
      } finally {
        if (current()) this.loading = false
      }
    },

    async create(input: FarmInput): Promise<Farm> {
      const current = captureStoreRequest(this)
      this.saving = true
      this.error = ''
      try {
        const result = await api.post<FarmResponse>('/farms', input)
        requireCurrent(current)
        this.items.unshift(result.farm)
        return result.farm
      } catch (error) {
        if (current()) this.error = errorMessage(error, 'Không thể tạo cơ sở nuôi')
        throw error
      } finally {
        if (current()) this.saving = false
      }
    },

    async update(id: string, input: Partial<FarmInput>): Promise<Farm> {
      const current = captureStoreRequest(this)
      this.saving = true
      this.error = ''
      try {
        const result = await api.patch<FarmResponse>(`/farms/${id}`, input)
        requireCurrent(current)
        const index = this.items.findIndex((farm) => farm.id === id)
        if (index >= 0) this.items[index] = result.farm
        return result.farm
      } catch (error) {
        if (current()) this.error = errorMessage(error, 'Không thể cập nhật cơ sở nuôi')
        throw error
      } finally {
        if (current()) this.saving = false
      }
    },

    async remove(id: string): Promise<void> {
      const current = captureStoreRequest(this)
      this.error = ''
      try {
        await api.delete<void>(`/farms/${id}`)
        requireCurrent(current)
        this.items = this.items.filter((farm) => farm.id !== id)
      } catch (error) {
        if (current()) this.error = errorMessage(error, 'Không thể xóa cơ sở nuôi')
        throw error
      }
    },
  },
})

import { defineStore } from 'pinia'

import { api, ApiError } from '../api/client'
import type { Farm, FarmInput, FarmListResponse, FarmResponse } from '../types'

interface FarmsState {
  items: Farm[]
  loading: boolean
  saving: boolean
  error: string
}

function errorMessage(error: unknown, fallback: string): string {
  return error instanceof ApiError ? error.message : fallback
}

export const useFarmsStore = defineStore('farms', {
  state: (): FarmsState => ({ items: [], loading: false, saving: false, error: '' }),

  actions: {
    async load(): Promise<void> {
      this.loading = true
      this.error = ''
      try {
        const result = await api.get<FarmListResponse>('/farms')
        this.items = result.items ?? []
      } catch (error) {
        this.error = errorMessage(error, 'Không thể tải danh sách cơ sở nuôi')
      } finally {
        this.loading = false
      }
    },

    async create(input: FarmInput): Promise<Farm> {
      this.saving = true
      this.error = ''
      try {
        const result = await api.post<FarmResponse>('/farms', input)
        this.items.unshift(result.farm)
        return result.farm
      } catch (error) {
        this.error = errorMessage(error, 'Không thể tạo cơ sở nuôi')
        throw error
      } finally {
        this.saving = false
      }
    },

    async update(id: string, input: Partial<FarmInput>): Promise<Farm> {
      this.saving = true
      this.error = ''
      try {
        const result = await api.patch<FarmResponse>(`/farms/${id}`, input)
        const index = this.items.findIndex((farm) => farm.id === id)
        if (index >= 0) this.items[index] = result.farm
        return result.farm
      } catch (error) {
        this.error = errorMessage(error, 'Không thể cập nhật cơ sở nuôi')
        throw error
      } finally {
        this.saving = false
      }
    },

    async remove(id: string): Promise<void> {
      this.error = ''
      try {
        await api.delete<void>(`/farms/${id}`)
        this.items = this.items.filter((farm) => farm.id !== id)
      } catch (error) {
        this.error = errorMessage(error, 'Không thể xóa cơ sở nuôi')
        throw error
      }
    },
  },
})

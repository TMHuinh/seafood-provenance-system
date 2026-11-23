import type { PublicTrace } from './trace'

export interface ProductionFilters { farmId: string; pondId: string; species: string; from: string; to: string }
export interface LotOptions {
  farms: { id: string; farm_name: string }[]
  ponds: { id: string; farm_id: string; pond_name: string; pond_code: string }[]
}
export interface LotItem {
  id: string; lotCode: string; quantity: number; status: string; harvestDate: string; species: string
  farm: { id: string; name: string }; pond: { id: string; name: string; code: string }; batch: { id: string; code: string }
  qr: { traceCode: string; status: string } | null
}
export interface LotListResponse { items: LotItem[]; count: number; page: number; pageSize: number; totalPages: number }
export interface ProductionResponse {
  generatedAt: string
  summary: { quantity: number; harvestCount: number; batchCount: number; farmCount: number }
  byMonth: { month: string; quantity: number; harvestCount: number }[]
  bySpecies: { species: string; quantity: number; harvestCount: number }[]
  byFarm: { farmId: string; farmName: string; quantity: number; harvestCount: number }[]
  byPond: { pondId: string; pondName: string; farmName: string; quantity: number; harvestCount: number }[]
  filters: ProductionFilters
}
export interface LotReportResponse {
  trace: PublicTrace; generatedAt: string; qrStatus: string | null
  history: { version_number: number; correction_reason: string | null; created_at: string }[]
}

// Shared domain and API types used by stores, pages and reusable components.
export type Role = 'ADMIN' | 'FARMER' | 'TRANSPORTER' | 'DISTRIBUTOR'
export type OrgType = 'FARMER_HOUSEHOLD' | 'COOPERATIVE' | 'COMPANY' | 'PROCESSOR' | 'DISTRIBUTOR' | 'RETAILER' | 'EXPORTER'
export type Species = 'SHRIMP' | 'CRAB'
export type BatchStatusCode = 'PREPARING' | 'GROWING' | 'READY_FOR_HARVEST' | 'HARVESTED' | 'COMPLETED' | 'CANCELLED'
export type BlockchainStatus = 'PENDING' | 'SUCCESS' | 'FAILED'

export interface Organization {
  id: string
  name: string
  type: OrgType
  address: string | null
  status: boolean
  created_at: string
}

export interface UserProfile {
  id: string
  organization_id: string | null
  full_name: string
  email: string | null
  phone: string | null
  role: Role
  wallet_address: string | null
  status: boolean
  created_at: string
  organization: Organization | null
}

export interface Farm {
  id: string
  owner_id: string
  organization_id: string | null
  farm_name: string
  address: string | null
  area: number | null
  certification: string | null
  status: boolean
  created_at: string
  updated_at: string
}

export interface FarmInput {
  farmName: string
  address?: string | null
  area?: number | null
  certification?: string | null
  status?: boolean
}

export interface FarmListResponse {
  success: boolean
  count: number
  items: Farm[]
}

export interface FarmResponse {
  success: boolean
  farm: Farm
}

export type PondStatus = 'ACTIVE' | 'INACTIVE' | 'MAINTENANCE'

export interface Pond {
  id: string
  farm_id: string
  pond_code: string
  pond_name: string
  area: number | null
  depth: number | null
  water_type: string | null
  status: PondStatus
  created_at: string
  updated_at: string
}

export interface PondInput {
  pondCode: string
  pondName: string
  area?: number | null
  depth?: number | null
  waterType?: string | null
  status?: PondStatus
}

export interface PondListResponse { success: boolean; count: number; items: Pond[] }
export interface PondResponse { success: boolean; pond: Pond }

export interface BatchInput {
  batchCode: string
  species: Species
  seedSource?: string | null
  seedQuantity: number
  stockingDate: string
  expectedHarvestDate?: string | null
  actualHarvestDate?: string | null
  yieldQuantity?: number | null
  status?: BatchStatusCode
  note?: string | null
}

export interface PondBatchListResponse { success: boolean; count: number; items: BatchItem[] }
export interface PondBatchResponse { success: boolean; batch: BatchItem }

export interface BatchItem {
  id: string
  batch_code: string
  species: Species
  seed_source: string | null
  seed_quantity: number
  stocking_date: string
  expected_harvest_date: string | null
  actual_harvest_date: string | null
  yield_quantity: number | null
  status: BatchStatusCode
  note: string | null
  created_at: string
  updated_at?: string
  pond?: {
    id: string
    pond_code: string
    pond_name: string
    status: string
    farm_name: string | null
  } | null
}

export interface BlockchainRecord {
  id: string
  batch_id: string
  entity_type: string
  entity_id: string
  event_type: string
  data_hash: string
  transaction_hash: string | null
  block_number: number | null
  contract_address: string | null
  status: BlockchainStatus
  recorded_at: string | null
  created_at: string
}

export interface BatchSummary {
  total: number
  byStatus: Record<string, number>
}

export interface BatchListResponse {
  success: boolean
  count: number
  items: BatchItem[]
  summary: BatchSummary
}

export interface HarvestRecord {
  id: string
  harvest_date: string
  quantity: number
  average_weight: number | null
  quality_grade: string | null
  note: string | null
  created_at: string
}

export interface TransportRecord {
  id: string
  transport_code: string
  transport_date: string
  from_location: string
  to_location: string
  temperature: number | null
  status: string
}

export interface DistributionRecord {
  id: string
  distribution_date: string
  quantity: number
  location: string | null
  status: string
}

export interface BatchDetailPayload {
  id: string
  batch_code: string
  species: Species
  seed_source: string | null
  seed_quantity: number
  stocking_date: string
  expected_harvest_date: string | null
  actual_harvest_date: string | null
  yield_quantity: number | null
  status: BatchStatusCode
  note: string | null
  created_at: string
  pond?: {
    pond_code: string
    pond_name: string
    farm?: {
      farm_name: string
      organization?: Organization | null
    } | null
  } | null
}

export interface BatchDetailResponse {
  success: boolean
  batch: BatchDetailPayload
  summary: { farmingLogs: number }
  blockchain: BlockchainRecord[]
  harvests: HarvestRecord[]
  transports: TransportRecord[]
  distributions: DistributionRecord[]
}

export interface AuthResponse {
  success: boolean
  requiresConfirmation?: boolean
  accessToken: string | null
  user: UserProfile
}

export interface RoleOption {
  value: Role | 'FARMER'
  label: string
}

export const ROLE_OPTIONS: RoleOption[] = [
  { value: 'FARMER', label: 'Nông hộ / người nuôi' },
  { value: 'TRANSPORTER', label: 'Vận chuyển' },
  { value: 'DISTRIBUTOR', label: 'Phân phối' },
]

export const ORG_TYPE_OPTIONS: { value: OrgType; label: string }[] = [
  { value: 'FARMER_HOUSEHOLD', label: 'Hộ nông dân' },
  { value: 'COOPERATIVE', label: 'Hợp tác xã' },
  { value: 'COMPANY', label: 'Công ty' },
  { value: 'PROCESSOR', label: 'Chế biến' },
  { value: 'DISTRIBUTOR', label: 'Phân phối' },
  { value: 'RETAILER', label: 'Bán lẻ' },
  { value: 'EXPORTER', label: 'Xuất khẩu' },
]

export const STATUS_LABELS: Record<BatchStatusCode, string> = {
  PREPARING: 'Chuẩn bị',
  GROWING: 'Đang nuôi',
  READY_FOR_HARVEST: 'Sẵn sàng thu hoạch',
  HARVESTED: 'Đã thu hoạch',
  COMPLETED: 'Hoàn thành',
  CANCELLED: 'Đã hủy',
}

export const SPECIES_LABELS: Record<Species, string> = {
  SHRIMP: 'Tôm',
  CRAB: 'Cua',
}

export const ROLE_LABELS: Record<Role, string> = {
  ADMIN: 'Quản trị',
  FARMER: 'Nông hộ',
  TRANSPORTER: 'Vận chuyển',
  DISTRIBUTOR: 'Phân phối',
}

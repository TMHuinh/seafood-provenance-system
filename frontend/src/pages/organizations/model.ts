import type { OrgType } from '../../types'

export interface Membership {
  membership_id?: string
  organization_id: string
  organization_name: string
  organization_type: OrgType
  organization_address?: string | null
  role: 'MANAGER' | 'REPRESENTATIVE' | 'STAFF'
  assigned_ponds?: AssignedPond[]
}

export const roleLabels = {
  MANAGER: 'Quản lý hợp tác xã',
  REPRESENTATIVE: 'Đại diện hộ nuôi',
  STAFF: 'Nhân sự',
} as const

export const errorText = (cause: unknown) =>
  cause instanceof Error ? cause.message : 'Không thể tải dữ liệu. Vui lòng thử lại.'

export const isOrganizationLead = (member?: Membership) =>
  (member?.organization_type === 'COOPERATIVE' && member.role === 'MANAGER') ||
  (member?.organization_type === 'FARMER_HOUSEHOLD' && member.role === 'REPRESENTATIVE')

export interface DirectoryOrganization {
  id: string
  name: string
  address: string | null
}

export type InvitationStatus = 'PENDING' | 'ACCEPTED' | 'REJECTED' | 'CANCELLED' | 'EXPIRED'

export interface OrganizationInvitation {
  id: string
  kind: 'HOUSEHOLD' | 'STAFF'
  status: InvitationStatus
  created_at: string
  expires_at: string
  sender_name: string
  organization_id: string
  organization_name: string
  target_organization_id: string | null
  target_organization_name: string | null
  target_user_id: string | null
  target_user_name?: string | null
  canRespond: boolean
  canCancel: boolean
}

export const permissionLabels = {
  READ: 'Xem ao và hồ sơ vụ nuôi',
  BATCH_CREATE: 'Tạo vụ nuôi',
  BATCH_EDIT: 'Chỉnh sửa vụ nuôi',
  LOG_CREATE: 'Ghi nhật ký',
  LOG_EDIT: 'Chỉnh sửa nhật ký',
  LOG_CONFIRM: 'Xác nhận nhật ký',
  HARVEST_CREATE: 'Tạo thu hoạch',
  HARVEST_EDIT: 'Chỉnh sửa thu hoạch',
  HARVEST_CONFIRM: 'Xác nhận thu hoạch',
} as const

export type PondPermission = keyof typeof permissionLabels
export const assignmentPermissions = Object.keys(permissionLabels).filter(key => key !== 'READ') as Exclude<PondPermission, 'READ'>[]
export const approvalPermissions = ['LOG_CONFIRM', 'HARVEST_CONFIRM'] as const

export interface OrganizationStaff {
  id: string
  organization_id: string
  user_id: string
  full_name: string
  role: Membership['role']
  permissions: PondPermission[]
  starts_at: string
  ends_at: string | null
}

export interface OperationPond {
  id: string
  farm_id: string
  pond_name: string
  pond_code: string
  owner_organization_id: string | null
  operator_organization_id: string | null
  current_assignment_id: string | null
  scheduled_assignment_id: string | null
}

export type AssignedPond = Pick<OperationPond, 'id' | 'farm_id' | 'pond_name' | 'pond_code'> & { permissions: PondPermission[] }

export interface PondAssignment {
  id: string
  pond_id: string
  organization_id: string
  user_id: string
  full_name: string
  permissions: PondPermission[]
  note: string | null
  starts_at: string
  ends_at: string | null
}

export const handoverStatuses = {
  PENDING: 'Chờ tiếp nhận',
  ACCEPTED: 'Đang vận hành',
  REJECTED: 'Đã từ chối',
  RETURNED: 'Đã trả lại',
  CANCELLED: 'Đã hủy',
} as const

export interface PondHandover {
  id: string
  pond_id: string
  pond_name: string
  pond_code: string
  household_id: string
  household_name: string
  cooperative_id: string
  cooperative_name: string
  status: keyof typeof handoverStatuses
  requested_at: string
  responded_at: string | null
  returned_at: string | null
}

export function handoverActions(handover: PondHandover, orgId: string) {
  const household = handover.household_id === orgId
  const cooperative = handover.cooperative_id === orgId
  return {
    respond: cooperative && handover.status === 'PENDING',
    end: (household && handover.status === 'PENDING') || ((household || cooperative) && handover.status === 'ACCEPTED'),
  }
}

export const invitationStatusLabels: Record<InvitationStatus, string> = {
  PENDING: 'Chờ phản hồi',
  ACCEPTED: 'Đã chấp nhận',
  REJECTED: 'Đã từ chối',
  CANCELLED: 'Đã hủy',
  EXPIRED: 'Hết hạn',
}

export interface HouseholdRelationship {
  id: string
  household_id: string
  household_name: string
  cooperative_id: string
  cooperative_name: string
  joined_at: string
  ended_at: string | null
  share_logs: boolean
  shared_batch_ids: string[]
}

export interface SharingCandidate {
  id: string
  batch_code: string
  pond_name: string
  stocking_date: string | null
  status: string
}

export const organizationsPath = (orgId: string) => `/organizations/${encodeURIComponent(orgId)}`
export const invitationPath = (id: string) => `/organizations/invitations/${encodeURIComponent(id)}`

export { date } from '../lots/lot-utils'

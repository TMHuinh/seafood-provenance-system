import type { FarmingLog } from '../../types'

export function canEditFarmingLog(status: FarmingLog['lifecycle_status'], permissions: readonly string[]) {
  return status !== 'REVOKED' && permissions.includes('LOG_EDIT')
    && (status === 'DRAFT' || permissions.includes('LOG_CONFIRM'))
}

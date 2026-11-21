import type { FarmingLog } from '../../types'

const DETAIL_LABELS: Record<string, string> = { feedType: 'Loại thức ăn', feedAmount: 'Số lượng (kg)', temperature: 'Nhiệt độ (°C)', salinity: 'Độ mặn (‰)', ph: 'pH', dissolvedOxygen: 'Oxy hòa tan (mg/L)', medicineName: 'Tên thuốc / hoá chất', dose: 'Liều lượng', mortalityCount: 'Số con chết', cause: 'Nguyên nhân', description: 'Mô tả', note: 'Ghi chú' }

export function detailsRows(log: FarmingLog) { return Object.entries(log.details ?? {}).filter(([, v]) => v !== null && v !== undefined && v !== '').map(([k, v]) => ({ label: DETAIL_LABELS[k] ?? k, value: String(v) })) }

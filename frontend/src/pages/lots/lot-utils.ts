export const lotStatusLabels: Record<string, string> = { CREATED: 'Đã tạo lô', PACKAGED: 'Đã đóng gói', SHIPPED: 'Đã xuất vận chuyển', COMPLETED: 'Hoàn tất' }
export const speciesLabel = (value: string) => ({ SHRIMP: 'Tôm', CRAB: 'Cua' }[value] ?? value)
export const quantity = (value: number) => new Intl.NumberFormat('vi-VN', { maximumFractionDigits: 2 }).format(value)
export function date(value: string | null | undefined, time = false) {
  if (!value) return '—'
  const parsed = new Date(value)
  if (Number.isNaN(parsed.getTime())) return '—'
  return new Intl.DateTimeFormat('vi-VN', { timeZone: 'Asia/Ho_Chi_Minh', day: '2-digit', month: '2-digit', year: 'numeric', ...(time ? { hour: '2-digit', minute: '2-digit' } : {}) }).format(parsed)
}
export function queryString(values: object) {
  return new URLSearchParams(Object.entries(values).filter(([, value]) => value !== '' && value != null).map(([key, value]) => [key, String(value)])).toString()
}
export function downloadCsv(filename: string, rows: (string | number | null)[][]) {
  // Quote delimiters and prevent spreadsheet formula execution in user-entered names.
  const csv = rows.map(row => row.map(value => {
    let cell = String(value ?? '')
    if (/^[\s]*[=+@-]/.test(cell)) cell = `'${cell}`
    return `"${cell.replace(/"/g, '""')}"`
  }).join(',')).join('\r\n')
  const url = URL.createObjectURL(new Blob(['\uFEFF', csv], { type: 'text/csv;charset=utf-8' }))
  const link = document.createElement('a')
  link.href = url; link.download = filename; link.click()
  setTimeout(() => URL.revokeObjectURL(url), 1000)
}

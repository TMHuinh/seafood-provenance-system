import type { PublicTrace } from '../../types/trace'

type Logs = PublicTrace['logs']

export function summarizeLogs(logs: Logs) {
  function group(type: string, field: string) {
    const products = new Map<
      string,
      { name: string; count: number; firstUsed: string; lastUsed: string }
    >()
    let recordCount = 0
    let unnamedCount = 0
    for (const log of logs) {
      if (log.type !== type) continue
      recordCount++
      const value = log.details[field]
      const name =
        typeof value === 'string' ? value.normalize('NFC').trim().replace(/\s+/g, ' ') : ''
      if (!name) {
        unnamedCount++
        continue
      }
      const key = name.toLocaleLowerCase('vi-VN')
      const product = products.get(key)
      if (product) {
        product.count++
        if (new Date(log.date) < new Date(product.firstUsed)) product.firstUsed = log.date
        if (new Date(log.date) > new Date(product.lastUsed)) product.lastUsed = log.date
      } else products.set(key, { name, count: 1, firstUsed: log.date, lastUsed: log.date })
    }
    return {
      recordCount,
      unnamedCount,
      products: [...products.values()].sort((a, b) => a.name.localeCompare(b.name, 'vi')),
    }
  }
  return { feeding: group('FEEDING', 'feedType'), medicine: group('MEDICINE', 'medicineName') }
}

export function filterLogs(
  logs: Logs,
  filters: { type: string; query: string; from: string; to: string },
) {
  const query = filters.query.trim().toLocaleLowerCase('vi-VN')
  const from = filters.from ? new Date(`${filters.from}T00:00:00+07:00`).getTime() : -Infinity
  const before = filters.to
    ? new Date(`${filters.to}T00:00:00+07:00`).getTime() + 86400000
    : Infinity
  return logs
    .filter((log) => {
      const timestamp = new Date(log.date).getTime()
      return (
        (!filters.type || log.type === filters.type) &&
        timestamp >= from &&
        timestamp < before &&
        (!query ||
          Object.values(log.details).some((value) =>
            String(value ?? '')
              .toLocaleLowerCase('vi-VN')
              .includes(query),
          ))
      )
    })
    .sort((a, b) => new Date(b.date).getTime() - new Date(a.date).getTime())
}

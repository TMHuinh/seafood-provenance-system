import { test } from 'node:test'
import assert from 'node:assert/strict'
import { summarizeLogs } from '../src/pages/trace/trace-logs.ts'

test('product summary includes mismatched logs and counts them separately', () => {
  const summary = summarizeLogs([
    { type: 'MEDICINE', date: '2026-11-01T00:00:00Z', details: { medicineName: 'Vitamin C' }, verificationStatus: 'MATCH' },
    { type: 'MEDICINE', date: '2026-11-02T00:00:00Z', details: { medicineName: ' vitamin c ', dose: '2000l' }, verificationStatus: 'MISMATCH' },
    { type: 'FEEDING', date: '2026-11-02T00:00:00Z', details: { feedType: 'Thức ăn A' }, verificationStatus: 'MATCH' },
  ])
  assert.equal(summary.medicine.recordCount, 2)
  assert.deepEqual(summary.medicine.products.map(({ name, count, mismatchCount }) => ({ name, count, mismatchCount })),
    [{ name: 'Vitamin C', count: 2, mismatchCount: 1 }])
  assert.equal(summary.feeding.products[0].mismatchCount, 0)
})

import assert from 'node:assert/strict'
import { test } from 'node:test'
import { canEditFarmingLog } from '../src/pages/batches/farming-log-permissions.ts'

test('recording or confirming a draft does not grant editing', () => {
  assert.equal(canEditFarmingLog('DRAFT', ['LOG_CREATE', 'LOG_CONFIRM']), false)
  assert.equal(canEditFarmingLog('DRAFT', ['LOG_EDIT']), true)
})

test('correcting a confirmed log requires editing and confirmation', () => {
  assert.equal(canEditFarmingLog('CONFIRMED', ['LOG_EDIT']), false)
  assert.equal(canEditFarmingLog('CONFIRMED', ['LOG_CONFIRM']), false)
  assert.equal(canEditFarmingLog('CONFIRMED', ['LOG_EDIT', 'LOG_CONFIRM']), true)
  assert.equal(canEditFarmingLog('REVOKED', ['LOG_EDIT', 'LOG_CONFIRM']), false)
})

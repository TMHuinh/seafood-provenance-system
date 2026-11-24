const { test } = require('node:test')
const assert = require('node:assert/strict')
const { farmingLogIssue, validateFarmingLog } = require('../src/modules/farming-logs/farming-logs.validation')

const batch = { stocking_date: '2025-01-01T12:00:00+07:00', actual_harvest_date: '2025-02-01T00:00:00+07:00' }
const log = { log_date: '2025-01-01T08:00:00+07:00', log_type: 'FEEDING', details: { feedType: 'Thức ăn', feedAmount: 2 } }

test('log validation accepts the stocking day in Vietnam and rejects dates outside the crop', () => {
  assert.equal(farmingLogIssue(log, batch), null)
  assert.match(farmingLogIssue({ ...log, log_date: '2024-12-31T16:59:59Z' }, batch), /ngày thả/)
  assert.match(farmingLogIssue({ ...log, log_date: '2025-02-01T17:00:00Z' }, batch), /thu hoạch/)
})

test('log confirmation rejects incomplete or invalid details with a field-specific error', () => {
  assert.throws(() => validateFarmingLog({ ...log, details: {} }, batch), { status: 400, message: /tên thức ăn/ })
  assert.match(farmingLogIssue({ ...log, log_type: 'WATER_QUALITY', details: { ph: 15 } }, batch), /pH/)
  assert.equal(farmingLogIssue({ ...log, log_type: 'WATER_QUALITY', details: { ph: 7 } }, batch), null)
})

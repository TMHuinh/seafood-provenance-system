function blockchainPayload(log) {
  return {
    batchId: log.batch_id,
    logType: log.log_type,
    logDate: new Date(log.log_date).toISOString(),
    details: log.details,
  }
}

function legacyInputOrderDetails(logType, details = {}) {
  switch (logType) {
    case 'FEEDING': return { feedType: details.feedType, feedAmount: details.feedAmount, note: details.note }
    case 'WATER_QUALITY': return { temperature: details.temperature, salinity: details.salinity, ph: details.ph, dissolvedOxygen: details.dissolvedOxygen, note: details.note }
    case 'MEDICINE': return { medicineName: details.medicineName, dose: details.dose, note: details.note }
    case 'MORTALITY': return { mortalityCount: details.mortalityCount, cause: details.cause, note: details.note }
    default: return { description: details.description }
  }
}

function payloadHashes(log, hash, hashLegacy, { strictDetails = false } = {}) {
  const payload = blockchainPayload(log)
  const legacyPayload = { batchId: log.batch_id, logType: log.log_type, logDate: log.log_date, details: log.details }
  const recomputedHash = hash(payload)
  const legacyHash = hashLegacy(legacyPayload)
  const hashes = new Set([recomputedHash, legacyHash])
  const orderedDetails = legacyInputOrderDetails(log.log_type, log.details ?? {})
  if (!strictDetails || hash(orderedDetails) === hash(payload.details)) {
    hashes.add(hashLegacy({ ...payload, details: orderedDetails }))
  }
  return hashes
}

module.exports = { blockchainPayload, payloadHashes }

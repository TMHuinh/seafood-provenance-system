function createTraceHandlers(service) {
  const handler = action => async (req, res, next) => {
    try {
      const result = await service[action](req.auth.profile, req.params, req.body)
      res.set('Cache-Control', 'no-store').json({ success: true, ...result })
    } catch (error) { next(error) }
  }
  return Object.fromEntries(['get', 'issue', 'revoke', 'getReceiving', 'issueReceiving', 'revokeReceiving']
    .map(action => [action, handler(action)]))
}
module.exports = { createTraceHandlers }

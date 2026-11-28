const { Router } = require('express')
const joinRequests = require('./join-requests.service')
const { call, workspace } = require('./organizations.service')
const { id, text, bool, sharing, farmIds, email, permissions, startsAt,
  confirmationPermissions, assignmentPermissions } = require('./organizations.validation')

function createOrganizationRouter(db, authenticate, transaction = run => require('../../config/postgres').transaction(run)) {
  const router = Router()
  router.use(authenticate)
  router.use((_req, res, next) => {
    res.set('Cache-Control', 'no-store')
    next()
  })
  router.get('/workspace', async (req, res) => {
    res.json(await workspace(db, req.auth.profile.id))
  })

  function handle(method, route, procedure, args = () => ({})) {
    router[method](route, async (req, res) => {
      const scope = {}
      if (req.params.orgId) scope.p_org = id(req.params.orgId, 'Mã tổ chức')
      if (req.params.id) scope.p_id = id(req.params.id)
      res.json(await call(db, procedure, { ...scope, ...args(req), p_actor: req.auth.profile.id }))
    })
  }

  handle('get', '/household-setup', 'org_household_setup_options')
  handle('post', '/household-setup', 'org_create_household_profile', req => ({
    p_request: id(req.body?.requestId, 'Mã yêu cầu'),
    p_name: text(req.body?.name, 'Tên hộ nuôi', 255),
    p_address: text(req.body?.address, 'Địa chỉ', 1000, { optional: true }),
    p_farm_ids: farmIds(req.body?.farmIds),
  }))
  handle('post', '/:orgId/household-farms', 'org_attach_household_farms', req => ({
    p_farm_ids: farmIds(req.body?.farmIds),
    p_cooperative: req.body?.cooperativeId == null ? null : id(req.body.cooperativeId, 'Mã hợp tác xã'),
  }))
  router.get('/:orgId/cooperative-search', async (req, res) => {
    const org = id(req.params.orgId, 'Mã hộ nuôi')
    const term = text(req.query.q, 'Từ khóa tìm kiếm', 100, { min: 2 })
    res.json(await transaction(client => joinRequests.search(client, req.auth.profile.id, org, term)))
  })
  router.post('/:orgId/join-requests', async (req, res) => {
    const org = id(req.params.orgId, 'Mã hộ nuôi')
    const cooperative = id(req.body?.cooperativeId, 'Mã hợp tác xã')
    const scope = sharing(req.body)
    res.json(await transaction(client => joinRequests.send(client, req.auth.profile.id, org, cooperative,
      scope.p_share_logs, scope.p_batch_ids)))
  })
  router.get('/join-requests/:id', async (req, res) => {
    const request = id(req.params.id, 'Mã yêu cầu')
    res.json(await transaction(client => joinRequests.detail(client, req.auth.profile.id, request)))
  })
  router.post('/join-requests/:id/respond', async (req, res) => {
    const request = id(req.params.id, 'Mã yêu cầu')
    const accept = bool(req.body?.accept, 'Lựa chọn phản hồi')
    res.json(await transaction(client => joinRequests.respond(client, req.auth.profile.id, request, accept)))
  })

  router.post('/join-requests/:id/cancel', async (req, res) => {
    const request = id(req.params.id, 'Mã yêu cầu')
    res.json(await transaction(client => joinRequests.cancel(client, req.auth.profile.id, request)))
  })

  handle('get', '/invitations', 'org_invitations')
  handle('post', '/invitations/:id/respond', 'org_respond_invite', req => {
    const accept = bool(req.body?.accept, 'Lựa chọn phản hồi')
    return { p_accept: accept, ...sharing(accept ? req.body : undefined) }
  })
  handle('post', '/invitations/:id/cancel', 'org_cancel_invite')
  handle('patch', '/:orgId', 'org_update_profile', req => ({
    p_name: text(req.body?.name, 'Tên đơn vị', 255),
    p_address: text(req.body?.address, 'Địa chỉ', 1000, { optional: true }),
  }))
  handle('get', '/:orgId/household-search', 'org_household_search', req => ({
    p_query: text(req.query.q, 'Từ khóa tìm kiếm', 100, { min: 2 }),
  }))
  handle('post', '/:orgId/invitations', 'org_invite_household', req => ({
    p_household: id(req.body?.householdId, 'Mã hộ nuôi'),
  }))
  handle('get', '/:orgId/households', 'org_households')
  handle('get', '/:orgId/households/:id', 'org_household_data')
  handle('get', '/:orgId/share-candidates', 'org_share_candidates')
  handle('patch', '/:orgId/households/:id/sharing', 'org_change_sharing', req => sharing(req.body))
  handle('post', '/:orgId/households/:id/leave', 'org_leave_cooperative')

  handle('get', '/:orgId/staff', 'org_staff')
  handle('post', '/:orgId/staff/invitations', 'org_invite_staff', req => ({ p_email: email(req.body?.email) }))
  handle('post', '/:orgId/staff/:id/leave', 'org_leave_staff')
  handle('post', '/:orgId/staff/:id/remove', 'org_remove_staff')
  handle('patch', '/:orgId/staff/:id/permissions', 'org_member_permissions', req => ({
    p_permissions: permissions(req.body?.permissions, confirmationPermissions),
  }))
  handle('get', '/:orgId/pond-operations', 'org_pond_operations')
  handle('post', '/:orgId/assignments', 'org_set_assignment', req => ({
    p_pond: id(req.body?.pondId, 'Mã ao'),
    p_user: id(req.body?.userId, 'Mã nhân sự'),
    p_permissions: permissions(req.body?.permissions, assignmentPermissions),
    p_note: text(req.body?.note, 'Ghi chú phân công', 2000, { optional: true }),
    p_starts_at: startsAt(req.body?.startsAt),
    p_expected_assignment: req.body?.expectedAssignmentId === null
      ? null : id(req.body?.expectedAssignmentId, 'Mã phân công hiện tại'),
  }))
  handle('post', '/:orgId/assignments/:id/end', 'org_end_assignment')
  handle('post', '/:orgId/handovers', 'org_request_pond_handover', req => ({
    p_pond: id(req.body?.pondId, 'Mã ao'),
    p_cooperative: id(req.body?.cooperativeId, 'Mã hợp tác xã'),
  }))
  handle('post', '/:orgId/handovers/:id/respond', 'org_respond_pond_handover', req => ({
    p_accept: bool(req.body?.accept, 'Lựa chọn bàn giao'),
  }))
  handle('post', '/:orgId/handovers/:id/end', 'org_end_pond_handover')
  return router
}

module.exports = { createOrganizationRouter }

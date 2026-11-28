function fail(status, message) {
  throw Object.assign(new Error(message), { status })
}

async function one(db, sql, params) {
  return (await db.query(sql, params)).rows[0]
}

async function requireRepresentative(db, actor, household) {
  const row = await one(db, `SELECT id FROM public.organizations
    WHERE id=$2 AND type='FARMER_HOUSEHOLD' AND public.org_is_manager($1,id)`, [actor, household])
  if (!row) fail(403, 'Chỉ đại diện hộ mới được gửi yêu cầu gia nhập')
}

async function search(db, actor, household, term) {
  await requireRepresentative(db, actor, household)
  const { rows } = await db.query(`SELECT id,name,address FROM public.organizations
    WHERE type='COOPERATIVE' AND status AND strpos(lower(name),lower($1))>0
    ORDER BY name,id LIMIT 30`, [term])
  return { cooperatives: rows }
}

function recordAudit(db, actor, entity, id, action, before, after) {
  return db.query(`INSERT INTO public.audit_logs(user_id,entity_type,entity_id,action,old_data,new_data)
    VALUES ($1,$2,$3,$4,$5,$6)`, [actor, entity, id, action, before, after])
}

async function ensureIndependent(db, household) {
  if (await one(db, `SELECT id FROM public.cooperative_households
    WHERE household_id=$1 AND ended_at IS NULL`, [household])) {
    fail(409, 'Hộ đang tham gia một hợp tác xã')
  }
}

async function validateBatches(db, household, ids, onlyActive) {
  const { count } = await one(db, `SELECT count(*)::integer AS count
    FROM public.batches b JOIN public.ponds p ON p.id=b.pond_id JOIN public.farms f ON f.id=p.farm_id
    WHERE f.organization_id=$1 AND b.id=ANY($2::uuid[])
      AND (NOT $3::boolean OR b.status IN ('PREPARING','GROWING','READY_FOR_HARVEST'))`, [household, ids, onlyActive])
  if (count !== ids.length) fail(400, 'Danh sách vụ nuôi được chia sẻ không hợp lệ')
}

async function send(db, actor, household, cooperative, logs, batches) {
  await requireRepresentative(db, actor, household)
  await db.query('SELECT id FROM public.organizations WHERE id=$1 FOR UPDATE', [household])
  await requireRepresentative(db, actor, household)
  if (!await one(db, "SELECT id FROM public.organizations WHERE id=$1 AND status AND type='COOPERATIVE'", [cooperative])) {
    fail(404, 'Không tìm thấy hợp tác xã đang hoạt động')
  }
  await ensureIndependent(db, household)
  const pending = await one(db, `SELECT *,expires_at>clock_timestamp() AS live
    FROM public.organization_invitations WHERE organization_id=$1 AND target_organization_id=$2
    AND kind='HOUSEHOLD_REQUEST' AND status='PENDING' FOR UPDATE`, [household, cooperative])
  if (pending?.live) {
    if (pending.requested_share_logs === logs && [...pending.requested_shared_batch_ids].sort().join() === batches.join()) return pending
    fail(409, 'Hộ đã gửi yêu cầu tới HTX này. Hãy hủy yêu cầu cũ để thay đổi phạm vi chia sẻ.')
  }
  if (pending) {
    const expired = await one(db, "UPDATE public.organization_invitations SET status='EXPIRED' WHERE id=$1 RETURNING *", [pending.id])
    await recordAudit(db, actor, 'organization_invitations', pending.id, 'UPDATE', pending, expired)
  }
  await validateBatches(db, household, batches, true)
  const item = await one(db, `INSERT INTO public.organization_invitations
    (organization_id,target_organization_id,sender_id,kind,requested_share_logs,requested_shared_batch_ids)
    VALUES ($1,$2,$3,'HOUSEHOLD_REQUEST',$4,$5) RETURNING *`, [household, cooperative, actor, logs, batches])
  await recordAudit(db, actor, 'organization_invitations', item.id, 'CREATE', null, item)
  return item
}

async function detail(db, actor, requestId) {
  const item = await one(db, `SELECT i.requested_share_logs, i.requested_shared_batch_ids,
    ARRAY(SELECT b.batch_code FROM public.batches b JOIN public.ponds p ON p.id=b.pond_id
      JOIN public.farms f ON f.id=p.farm_id
      WHERE b.id=ANY(i.requested_shared_batch_ids) AND f.organization_id=i.organization_id
      ORDER BY b.batch_code) AS requested_batch_codes
    FROM public.organization_invitations i WHERE i.id=$2 AND i.kind='HOUSEHOLD_REQUEST'
    AND (public.org_is_manager($1,i.organization_id) OR public.org_is_manager($1,i.target_organization_id))`, [actor, requestId])
  if (!item) fail(404, 'Không tìm thấy yêu cầu gia nhập')
  return item
}

async function respond(db, actor, requestId, accept) {
  const scope = await one(db, `SELECT organization_id FROM public.organization_invitations
    WHERE id=$2 AND kind='HOUSEHOLD_REQUEST' AND public.org_is_manager($1,target_organization_id)`, [actor, requestId])
  if (!scope) fail(404, 'Không tìm thấy yêu cầu gia nhập')
  // Match the legacy invitation flow's household → invitation lock order.
  await db.query('SELECT id FROM public.organizations WHERE id=$1 FOR UPDATE', [scope.organization_id])
  const item = await one(db, `SELECT i.* FROM public.organization_invitations i
    WHERE i.id=$2 AND public.org_is_manager($1,i.target_organization_id) FOR UPDATE`, [actor, requestId])
  if (!item) fail(404, 'Không tìm thấy yêu cầu gia nhập')
  const status = accept ? 'ACCEPTED' : 'REJECTED'
  if (item.status === status) return item
  const { live } = await one(db, 'SELECT $1::timestamptz>clock_timestamp() AS live', [item.expires_at])
  if (item.status !== 'PENDING' || !live) fail(409, 'Yêu cầu đã được xử lý hoặc hết hạn')
  if (accept) {
    await requireRepresentative(db, item.sender_id, item.organization_id)
    await ensureIndependent(db, item.organization_id)
    await validateBatches(db, item.organization_id, item.requested_shared_batch_ids, false)
    const relation = await one(db, `INSERT INTO public.cooperative_households
      (household_id,cooperative_id,invitation_id,joined_at,joined_by,share_logs,shared_batch_ids)
      VALUES ($1,$2,$3,clock_timestamp(),$4,$5,$6) RETURNING *`,
    [item.organization_id,item.target_organization_id,item.id,actor,item.requested_share_logs,item.requested_shared_batch_ids])
    await recordAudit(db, actor, 'cooperative_household_sharing', relation.id, 'CREATE', null, relation)
  }
  const result = await one(db, `UPDATE public.organization_invitations
    SET status=$2,responded_by=$3,responded_at=clock_timestamp() WHERE id=$1 RETURNING *`, [item.id,status,actor])
  await recordAudit(db, actor, 'organization_invitations', item.id, 'UPDATE', item, result)
  return result
}

async function cancel(db, actor, requestId) {
  const item = await one(db, `SELECT *,expires_at>clock_timestamp() AS live
    FROM public.organization_invitations WHERE id=$2 AND kind='HOUSEHOLD_REQUEST'
    AND public.org_is_manager($1,organization_id) FOR UPDATE`, [actor, requestId])
  if (!item) fail(404, 'Không tìm thấy yêu cầu gia nhập')
  if (item.status === 'CANCELLED') return item
  if (item.status !== 'PENDING' || !item.live) fail(409, 'Yêu cầu đã được xử lý hoặc hết hạn')
  const result = await one(db, `UPDATE public.organization_invitations
    SET status='CANCELLED',responded_by=$2,responded_at=clock_timestamp() WHERE id=$1 RETURNING *`, [item.id, actor])
  await recordAudit(db, actor, 'organization_invitations', item.id, 'UPDATE', item, result)
  return result
}

module.exports = { search, send, detail, respond, cancel }

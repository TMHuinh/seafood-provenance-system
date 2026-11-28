async function call(db, name, args) {
  const { data, error } = await db.rpc(name, args)
  if (error) {
    const status = { '42501': 403, '22023': 400, PT404: 404, PT409: 409, '23P01': 409 }[error.code]
    if (status) throw Object.assign(new Error(error.message), { status })
    throw error
  }
  return data
}

function workspace(db, actor) {
  return call(db, 'org_workspace', { p_actor: actor })
}

module.exports = { call, workspace }

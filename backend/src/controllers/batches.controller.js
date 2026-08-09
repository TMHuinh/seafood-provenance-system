const supabase = require('../config/supabase')
const blockchainService = require('../services/blockchain.service')

function createNotFound(message = 'Không tìm thấy lô hàng') {
  const error = new Error(message)
  error.status = 404
  return error
}

/**
 * Phạm vi lô hàng người dùng được xem:
 * - ADMIN xem toàn bộ
 * - Các vai trò khác chỉ xem lô của tổ chức mình
 * - Chưa thuộc tổ chức: danh sách trống
 */
function resolveVisibility(profile) {
  if (profile.role === 'ADMIN') {
    return { kind: 'all' }
  }
  if (profile.organization_id) {
    return { kind: 'organization', organizationId: profile.organization_id }
  }
  return { kind: 'none' }
}

async function fetchPondsByIds(pondIds) {
  if (pondIds.length === 0) {
    return new Map()
  }

  const { data, error } = await supabase
    .from('ponds')
    .select('id, pond_code, pond_name, status, farm_id, farm:farms(farm_name, organization_id)')
    .in('id', pondIds)

  if (error) {
    throw error
  }
  return new Map(data.map((pond) => [pond.id, pond]))
}

/**
 * GET /api/batches
 * Danh sách lô + tổng quan dữ liệu cho trang chủ.
 * Chi tiết nằm ở supabase, tính minh bạch là blockchain_records.
 */
async function list(request, response, next) {
  try {
    const visibility = resolveVisibility(request.auth.profile)

    let items = []
    let count = 0

    if (visibility.kind !== 'none') {
      const { data: batches, count: exactCount, error } = await supabase
        .from('batches')
        .select('*', { count: 'exact' })
        .order('created_at', { ascending: false })
        .limit(50)

      if (error) {
        throw error
      }

      let visible = batches ?? []

      if (visibility.kind === 'organization') {
        const pondIds = [...new Set(visible.map((batch) => batch.pond_id))]
        const pondsMap = await fetchPondsByIds(pondIds)
        visible = visible.filter(
          (batch) => pondsMap.get(batch.pond_id)?.farm?.organization_id === visibility.organizationId,
        )
      }

      const pondIds = [...new Set(visible.map((batch) => batch.pond_id))]
      const pondsMap = await fetchPondsByIds(pondIds)

      items = visible.map((batch) => {
        const pond = pondsMap.get(batch.pond_id)
        return {
          ...batch,
          pond: pond
            ? {
                id: pond.id,
                pond_code: pond.pond_code,
                pond_name: pond.pond_name,
                status: pond.status,
                farm_name: pond.farm?.farm_name ?? null,
              }
            : null,
        }
      })

      count = visibility.kind === 'all' ? (exactCount ?? visible.length) : visible.length
    }

    const byStatus = {}
    for (const batch of items) {
      byStatus[batch.status] = (byStatus[batch.status] ?? 0) + 1
    }

    response.json({
      success: true,
      count,
      items,
      summary: { total: count, byStatus },
    })
  } catch (error) {
    next(error)
  }
}

/**
 * GET /api/batches/:id
 * Chi tiết một lô: ao/trại/tổ chức, thống kê nhật ký và chuỗi khối minh bạch.
 * Backend ghép dữ liệu chi tiết (supabase) + chuỗi ghi nhận (blockchain).
 */
async function detail(request, response, next) {
  try {
    const { id } = request.params

    const { data: batch, error: batchError } = await supabase
      .from('batches')
      .select('*, pond:ponds(*, farm:farms(*, organization:organizations(*)))')
      .eq('id', id)
      .single()

    if (batchError || !batch) {
      throw createNotFound()
    }

    const [blocks, logsResult, harvests, transports, distributions] = await Promise.all([
      blockchainService.getRecordsByBatch(id, '*'),
      supabase
        .from('farming_logs')
        .select('id', { count: 'exact', head: true })
        .eq('batch_id', id),
      supabase
        .from('harvests')
        .select('id, harvest_date, quantity, average_weight, quality_grade, note, created_at')
        .eq('batch_id', id)
        .order('harvest_date', { ascending: true }),
      supabase
        .from('transport_logs')
        .select('id, transport_code, transport_date, from_location, to_location, temperature, status')
        .eq('batch_id', id)
        .order('transport_date', { ascending: true })
        .limit(20),
      supabase
        .from('distribution_logs')
        .select('id, distribution_date, quantity, location, status')
        .eq('batch_id', id)
        .order('distribution_date', { ascending: true })
        .limit(20),
    ])

    if (logsResult.error) {
      throw logsResult.error
    }

    response.json({
      success: true,
      batch,
      summary: {
        farmingLogs: logsResult.count ?? 0,
      },
      blockchain: blocks,
      harvests: harvests.error ? [] : harvests.data,
      transports: transports.error ? [] : transports.data,
      distributions: distributions.error ? [] : distributions.data,
    })
  } catch (error) {
    next(error)
  }
}

module.exports = { list, detail }
const express = require('express')
function createPublicRouter(service) {
  const router = express.Router()
  // Bounded process-wide budget; gateway limits are needed for multiple replicas.
  let started=Date.now(), requests=0, active=0
  router.get('/:traceCode',async(req,res)=>{
    res.set('Cache-Control','no-store')
    if(Date.now()-started>=60000) { started=Date.now(); requests=0 }
    if(++requests>120 || active>=4) return res.status(429).set('Retry-After','60').json({success:false,message:'Vui lòng thử lại sau ít phút'})
    active++
    try { res.json({success:true,...await service.publicTrace(req.params.traceCode)}) }
    catch(error) {
      const status=[404,503].includes(error.status)?error.status:503
      res.status(status).json({success:false,message:status===404?'Không tìm thấy mã truy xuất':'Tạm thời không tải được hồ sơ. Vui lòng thử lại.'})
    } finally { active-- }
  })
  return router
}
module.exports = { createPublicRouter }

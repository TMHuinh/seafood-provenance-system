const { ethers } = require('ethers')
const env = require('../../config/env')
const { createPublicRouter } = require('./trace.public-routes')
const { createTraceService } = require('./trace.service')
const { createTraceRepository } = require('./trace.repository')
const { createTraceHandlers } = require('./trace.handlers')
const blockchain = require('../blockchain/blockchain.service')
const db = require('../../config/supabase')
const service = createTraceService(createTraceRepository(db), {
  hash: blockchain.hashData,
  async read(eventId, address, chainId) {
    if (!env.blockchainRpcUrl) throw new Error('Blockchain unavailable')
    const connection = new ethers.FetchRequest(env.blockchainRpcUrl)
    connection.timeout = 2000
    const provider = new ethers.JsonRpcProvider(connection)
    try {
      if (chainId && String((await provider.getNetwork()).chainId) !== String(chainId)) throw new Error('Wrong blockchain network')
      const contract = new ethers.Contract(address, ['function getDataHash(string) view returns (string)'], provider)
      return await contract.getDataHash(eventId)
    } finally { provider.destroy() }
  },
})
module.exports = { ...createTraceHandlers(service), dossier: service.dossier, publicRouter:createPublicRouter(service) }

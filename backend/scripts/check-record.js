const fs = require('node:fs')
const path = require('node:path')

require('dotenv').config({ path: path.resolve(__dirname, '../.env'), quiet: true })
const { ethers } = require('ethers')

const artifactPath = path.resolve(
  __dirname,
  '../artifacts/contracts/SeafoodProvenance.sol/SeafoodProvenance.json',
)

async function main() {
  const eventId = process.argv[2]
  if (!eventId) {
    console.error('Cách dùng: node scripts/check-record.js <eventId>')
    process.exitCode = 1
    return
  }

  const rpcUrl = process.env.BLOCKCHAIN_RPC_URL
  const contractAddress = process.env.BLOCKCHAIN_CONTRACT_ADDRESS
  if (!rpcUrl || !contractAddress) {
    console.error('Thiếu BLOCKCHAIN_RPC_URL hoặc BLOCKCHAIN_CONTRACT_ADDRESS trong backend/.env')
    process.exitCode = 1
    return
  }

  if (!fs.existsSync(artifactPath)) {
    console.error('Chưa có artifact. Hãy chạy: docker compose exec backend npx hardhat compile')
    process.exitCode = 1
    return
  }

  const artifact = JSON.parse(fs.readFileSync(artifactPath, 'utf8'))
  const provider = new ethers.JsonRpcProvider(rpcUrl)
  const iface = new ethers.Interface(artifact.abi)

  const calldata = iface.encodeFunctionData('getRecord', [eventId])
  const raw = await provider.call({ to: contractAddress, data: calldata })
  const record = iface.decodeFunctionResult('getRecord', raw)[0]

  if (record[4].toString() === '0') {
    console.log('eventId    :', eventId)
    console.log('Trạng thái : Chưa có bản ghi trên chain (writeCount = 0)')
    return
  }

  console.log('eventId    :', eventId)
  console.log('dataHash   :', record[0])
  console.log('recordedBy :', record[1])
  console.log('timestamp  :', new Date(Number(record[2]) * 1000).toISOString())
  console.log('blockNumber:', record[3].toString())
  console.log('writeCount :', record[4].toString())
}

main().catch((error) => {
  console.error(error)
  process.exitCode = 1
})

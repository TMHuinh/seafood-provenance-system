const fs = require('node:fs')
const path = require('node:path')

require('dotenv').config({ path: path.resolve(__dirname, '../.env'), quiet: true })
const { ethers } = require('ethers')

const artifactPath = path.resolve(
  __dirname,
  '../artifacts/contracts/SeafoodProvenance.sol/SeafoodProvenance.json',
)

function writeContractAddressToEnv(address) {
  const envPath = path.resolve(__dirname, '../.env')
  if (!fs.existsSync(envPath)) return

  let content = fs.readFileSync(envPath, 'utf8')
  const pattern = /^BLOCKCHAIN_CONTRACT_ADDRESS=.*$/m
  if (pattern.test(content)) {
    content = content.replace(pattern, `BLOCKCHAIN_CONTRACT_ADDRESS=${address}`)
  } else {
    content += `\nBLOCKCHAIN_CONTRACT_ADDRESS=${address}\n`
  }
  fs.writeFileSync(envPath, content)
}

async function main() {
  if (!fs.existsSync(artifactPath)) {
    console.error('Chưa có artifact. Hãy chạy: docker compose exec backend npx hardhat compile')
    process.exitCode = 1
    return
  }

  const artifact = JSON.parse(fs.readFileSync(artifactPath, 'utf8'))

  const rpcUrl = process.env.BLOCKCHAIN_RPC_URL
  const privateKey = process.env.BLOCKCHAIN_PRIVATE_KEY
  if (!rpcUrl || !privateKey) {
    console.error('Thiếu BLOCKCHAIN_RPC_URL hoặc BLOCKCHAIN_PRIVATE_KEY trong backend/.env')
    process.exitCode = 1
    return
  }

  const provider = new ethers.JsonRpcProvider(rpcUrl)
  const wallet = new ethers.Wallet(privateKey, provider)

  console.log('Deploying SeafoodProvenance...')
  console.log('Network  :', rpcUrl)
  console.log('Deployer :', wallet.address)

  const factory = new ethers.ContractFactory(artifact.abi, artifact.bytecode, wallet)
  const contract = await factory.deploy()
  await contract.waitForDeployment()
  const address = await contract.getAddress()

  console.log('Contract :', address)

  writeContractAddressToEnv(address)

  console.log('\nĐã ghi BLOCKCHAIN_CONTRACT_ADDRESS vào backend/.env')
  console.log('Khởi động lại backend để áp dụng: docker compose restart backend')
}

main().catch((error) => {
  console.error(error)
  process.exitCode = 1
})
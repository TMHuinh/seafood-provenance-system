// Run with the contract owner's key. This script never changes the backend's .env.
require('dotenv').config({ quiet: true })
const { ethers } = require('ethers')
async function main() {
  const [address, action] = process.argv.slice(2)
  if (!ethers.isAddress(address) || !['grant', 'revoke'].includes(action))
    throw new Error('Usage: node scripts/manage-writer.js <wallet-address> grant|revoke')
  const { BLOCKCHAIN_RPC_URL, BLOCKCHAIN_CONTRACT_ADDRESS, BLOCKCHAIN_PRIVATE_KEY } = process.env
  if (
    !BLOCKCHAIN_RPC_URL ||
    !BLOCKCHAIN_CONTRACT_ADDRESS ||
    !(process.env.BLOCKCHAIN_OWNER_PRIVATE_KEY || BLOCKCHAIN_PRIVATE_KEY)
  )
    throw new Error('Missing blockchain configuration')
  const provider = new ethers.JsonRpcProvider(BLOCKCHAIN_RPC_URL)
  try {
    const wallet = new ethers.Wallet(process.env.BLOCKCHAIN_OWNER_PRIVATE_KEY || BLOCKCHAIN_PRIVATE_KEY, provider)
    const contract = new ethers.Contract(
      BLOCKCHAIN_CONTRACT_ADDRESS,
      [
        'function owner() view returns(address)',
        'function writers(address) view returns(bool)',
        'function setWriter(address,bool)',
      ],
      wallet,
    )
    if ((await contract.owner()).toLowerCase() !== wallet.address.toLowerCase())
      throw new Error('Configured wallet is not the contract owner')
    const allowed = action === 'grant'
    if ((await contract.writers(address)) !== allowed) await (await contract.setWriter(address, allowed)).wait()
    console.log(`Writer ${address}: ${allowed ? 'granted' : 'revoked'}`)
  } finally {
    provider.destroy()
  }
}
main().catch((error) => {
  console.error(error.message)
  process.exitCode = 1
})

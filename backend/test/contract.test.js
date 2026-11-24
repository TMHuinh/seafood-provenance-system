const { test } = require('node:test')
const assert = require('node:assert/strict')
const { ethers } = require('ethers')
const hre = require('hardhat')

test('real EVM contract enforces writer permissions, immutable events and two-step ownership', async (t) => {
  const provider = new ethers.BrowserProvider(hre.network.provider)
  const owner = await provider.getSigner(0),
    writer = await provider.getSigner(1),
    outsider = await provider.getSigner(2)
  const artifact = await hre.artifacts.readArtifact('SeafoodProvenance')
  const contract = await new ethers.ContractFactory(artifact.abi, artifact.bytecode, owner).deploy()
  await contract.waitForDeployment()
  const hash = 'a'.repeat(64)
  try {
    await t.test('outsider cannot preempt an event or grant itself access', async () => {
      await assert.rejects(contract.connect(outsider).recordData('EVENT-1', hash), /Writer not authorized/)
      await assert.rejects(contract.connect(outsider).setWriter(await outsider.getAddress(), true), /Only owner/)
      assert.equal(await contract.getDataHash('EVENT-1'), '')
    })
    await t.test('owner grants a writer; published hashes cannot be overwritten', async () => {
      await (await contract.setWriter(await writer.getAddress(), true)).wait()
      await (await contract.connect(writer).recordData('EVENT-1', hash)).wait()
      assert.equal(await contract.getDataHash('EVENT-1'), hash)
      await assert.rejects(contract.connect(writer).recordData('EVENT-1', 'b'.repeat(64)), /Event already exists/)
      assert.equal((await contract.getRecord('EVENT-1')).writeCount, 1n)
    })
    await t.test('revoking write access preserves public reads', async () => {
      await (await contract.setWriter(await writer.getAddress(), false)).wait()
      await assert.rejects(contract.connect(writer).recordData('EVENT-2', hash), /Writer not authorized/)
      assert.equal(await contract.connect(outsider).getDataHash('EVENT-1'), hash)
    })
    await t.test('invalid IDs, non-SHA256 hashes and zero-address grants are rejected', async () => {
      await assert.rejects(contract.recordData('', hash), /Invalid event ID/)
      await assert.rejects(contract.recordData('EVENT-2', 'z'.repeat(64)), /Invalid SHA-256 hash/)
      await assert.rejects(contract.recordData('EVENT-2', 'abc'), /Invalid SHA-256 hash/)
      await assert.rejects(contract.setWriter(ethers.ZeroAddress, true), /Zero address/)
    })
    await t.test('ownership transfer requires acceptance and does not silently grant write access', async () => {
      await (await contract.transferOwnership(await outsider.getAddress())).wait()
      assert.equal(await contract.owner(), await owner.getAddress())
      await assert.rejects(contract.connect(writer).acceptOwnership(), /Only pending owner/)
      await (await contract.connect(outsider).acceptOwnership()).wait()
      assert.equal(await contract.owner(), await outsider.getAddress())
      assert.equal(await contract.writers(await outsider.getAddress()), false)
      await assert.rejects(contract.setWriter(await writer.getAddress(), true), /Only owner/)
    })
  } finally {
    provider.destroy()
  }
})

const assert = require('node:assert/strict')
const { resolve } = require('node:path')

async function browserScenario({ host, organization, household, managerToken, representativeToken, readInvitations }) {
  const { chromium } = require(resolve(process.env.SEAFOOD_PLAYWRIGHT_PACKAGE))
  const browser = await chromium.launch({ executablePath: process.env.SEAFOOD_CHROMIUM_PATH })
  const pageErrors = []
  try {
    async function open(token, viewport) {
      const page = await browser.newPage({ viewport })
      page.setDefaultTimeout(7000)
      page.on('pageerror', error => pageErrors.push(error.message))
      await page.route('**/*', route => route.request().url().startsWith(host + '/') ? route.continue() : route.abort())
      await page.addInitScript(value => localStorage.setItem('seafood_provenance_token', value), token)
      return page
    }
    const manager = await open(managerToken, { width: 1280, height: 900 })
    const mobile = await open(representativeToken, { width: 390, height: 844 })
    const managerPath = `${host}/to-chuc/${organization}/thanh-vien`
    await manager.goto(managerPath)
    await manager.getByRole('heading', { name: 'Mời hộ nuôi' }).waitFor()
    await manager.locator('form input').fill('Hộ A')
    await manager.getByRole('button', { name: 'Tìm kiếm', exact: true }).click()
    const result = manager.getByRole('list', { name: 'Kết quả tìm kiếm hộ nuôi' })
    await result.getByRole('button', { name: 'Gửi lời mời' }).click()
    await manager.getByText('Đã gửi lời mời đến Hộ A.').waitFor()

    const invitation = (await readInvitations()).find(item => item.status === 'PENDING' && item.target_organization_id === household)
    assert.ok(invitation)
    await mobile.goto(`${host}/to-chuc/loi-moi/${invitation.id}`)
    await mobile.getByRole('heading', { name: 'Phạm vi chia sẻ khi gia nhập' }).waitFor()
    const optional = mobile.getByRole('checkbox', { name: /Nhật ký chi tiết/ })
    assert.equal(await optional.isChecked(), false)
    const history = mobile.getByRole('checkbox', { name: /V-A/ })
    assert.equal(await history.isChecked(), false)
    await mobile.getByRole('button', { name: 'Chấp nhận và chia sẻ' }).click()
    await mobile.getByText('Đã chấp nhận lời mời.').waitFor()
    assert.ok(await mobile.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1))

    await manager.reload()
    await manager.getByRole('link', { name: 'Xem dữ liệu được chia sẻ' }).click()
    await manager.getByRole('heading', { name: 'Dữ liệu hộ thành viên' }).waitFor()
    await manager.getByText('Chưa có vụ nuôi được chia sẻ.').waitFor()
    assert.equal(await manager.getByText('V-A', { exact: true }).count(), 0)
    assert.equal(await manager.getByRole('button', { name: /sửa|cập nhật/i }).count(), 0)
    assert.deepEqual(pageErrors, [])
  } finally {
    await browser.close()
  }
}

async function householdSetupScenario({ host, token }) {
  const { chromium } = require(resolve(process.env.SEAFOOD_PLAYWRIGHT_PACKAGE))
  const browser = await chromium.launch({ executablePath: process.env.SEAFOOD_CHROMIUM_PATH })
  const pageErrors = []
  try {
    const page = await browser.newPage({ viewport: { width: 390, height: 844 } })
    page.setDefaultTimeout(7000)
    page.on('pageerror', error => pageErrors.push(error.message))
    await page.route('**/*', route => route.request().url().startsWith(host + '/') ? route.continue() : route.abort())
    await page.addInitScript(value => localStorage.setItem('seafood_provenance_token', value), token)
    await page.goto(host + '/to-chuc')
    const setupLink = page.getByRole('link', { name: 'Tạo hồ sơ hộ nuôi' })
    await setupLink.click()
    await page.getByRole('heading', { name: 'Tạo hồ sơ hộ nuôi' }).waitFor()
    await page.getByLabel('Tên hộ nuôi').fill('Hộ Minh')
    const first = page.getByRole('checkbox', { name: /Cơ sở Minh A/ })
    const second = page.getByRole('checkbox', { name: /Cơ sở Minh B/ })
    assert.equal(await first.isChecked(), false)
    assert.equal(await second.isChecked(), false)
    await first.check()
    await page.getByText('1 cơ sở · 1 ao').waitFor()
    assert.ok(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1))
    if (process.env.SEAFOOD_SETUP_SCREENSHOT) await page.screenshot({ path: process.env.SEAFOOD_SETUP_SCREENSHOT, fullPage: true })
    await page.getByRole('button', { name: 'Tạo hồ sơ hộ nuôi' }).click()
    await page.getByRole('heading', { name: 'Đã tạo hồ sơ hộ nuôi' }).waitFor()
    await page.getByRole('link', { name: 'Mở hồ sơ hộ nuôi' }).click()
    await page.getByRole('heading', { name: 'Hộ Minh' }).waitFor()
    await page.getByRole('link', { name: 'Gắn cơ sở riêng' }).click()
    await second.waitFor()
    assert.equal(await first.count(), 0)
    assert.equal(await second.isChecked(), false)
    await second.check()
    await page.getByRole('button', { name: 'Gắn cơ sở đã chọn' }).click()
    await page.getByRole('heading', { name: 'Đã lưu cơ sở của hộ' }).waitFor()
    assert.deepEqual(pageErrors, [])
  } finally {
    await browser.close()
  }
}

module.exports = { browserScenario, householdSetupScenario }

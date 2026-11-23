import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import ts from 'typescript'
const source = await readFile(new URL('../src/pages/lots/lot-utils.ts', import.meta.url), 'utf8')
const js = ts.transpileModule(source, { compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.ESNext } }).outputText
const utils = await import(`data:text/javascript;base64,${Buffer.from(js).toString('base64')}`)
test('dates follow Vietnam even across a UTC month boundary', () => {
  assert.equal(utils.date('2026-10-31T17:00:00Z'), '01/11/2026')
  assert.equal(utils.date('invalid'), '—')
})
test('CSV preserves Vietnamese, quotes and newlines while neutralizing spreadsheet formulas', async () => {
  const previous = globalThis.document
  let href, filename, clicked = false
  globalThis.document = { createElement: () => ({ set href(value) { href = value }, set download(value) { filename = value }, click() { clicked = true } }) }
  try {
    utils.downloadCsv('san-luong.csv', [['Ao "Tôm", A\nB', ' =HYPERLINK("bad")', 12.25]])
    const response = await fetch(href)
    const bytes = new Uint8Array(await response.arrayBuffer())
    assert.deepEqual(bytes.slice(0, 3), new Uint8Array([239, 187, 191]))
    const text = new TextDecoder().decode(bytes)
    assert.ok(text.includes('"Ao ""Tôm"", A\nB"'))
    assert.ok(text.includes('"\' =HYPERLINK(""bad"")"'))
    assert.equal(filename, 'san-luong.csv'); assert.equal(clicked, true)
  } finally { globalThis.document = previous; if (href) URL.revokeObjectURL(href) }
})

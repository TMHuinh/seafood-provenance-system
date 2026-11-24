import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import { parse, compileScript } from '@vue/compiler-sfc'
import ts from 'typescript'
import { createRenderer, h, nextTick, reactive } from 'vue'

const moduleUrl = value => `data:text/javascript;base64,${Buffer.from(value).toString('base64')}`
const transpile = source => ts.transpileModule(source, { compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.ESNext } }).outputText
const vueUrl = import.meta.resolve('vue')
const utilSource = await readFile(new URL('../src/pages/lots/lot-utils.ts', import.meta.url), 'utf8')
const imports = {
  'vue': vueUrl,
  'vue-router': moduleUrl('export const useRoute = () => globalThis.reportRoute; export const useRouter = () => ({ resolve: ({path}) => ({href:path}) });'),
  '../../api/client': moduleUrl('export const api = { get: (...args) => globalThis.reportApi(...args) };'),
  './lot-utils': moduleUrl(transpile(utilSource)),
  '../../components/LoadingState.vue': moduleUrl(`import {h} from ${JSON.stringify(vueUrl)}; export default () => h('p', 'Đang tải…');`),
  '../../components/LotPackagingDetails.vue': moduleUrl(`import {h} from ${JSON.stringify(vueUrl)}; export default { props: ['items'], render() { return h('p', this.items.map(item => item.inspectionResult).join(', ')); } };`),
  'vuestic-ui': moduleUrl(`import {h,defineComponent} from ${JSON.stringify(vueUrl)}; const wrap = tag => defineComponent({setup(_, {attrs,slots}) { return () => h(tag,attrs,slots.default?.()); }}); export const VaButton=wrap('button'), VaAlert=wrap('aside');`),
}
const source = await readFile(new URL('../src/pages/lots/LotReportPage.vue', import.meta.url), 'utf8')
const compiled = compileScript(parse(source).descriptor, { id: 'report-test', inlineTemplate: true })
const js = transpile(compiled.content).replace(/import ['"]\.\/report-print\.css['"];?/, '')
  .replace(/(from\s+)(['"])([^'"]+)\2/g, (_, prefix, quote, name) => `${prefix}${quote}${imports[name] ?? import.meta.resolve(name)}${quote}`)
const Report = (await import(moduleUrl(js))).default
const node = (type, text = '') => ({ type, text, props: {}, children: [], parent: null })
const renderer = createRenderer({
  createElement: type => node(type), createText: text => node('text', text), createComment: text => node('comment', text),
  setText: (el, text) => { el.text = text }, setElementText: (el, text) => { el.text = text; el.children = [] },
  patchProp: (el, key, _, value) => { el.props[key] = value },
  insert(el, parent, anchor = null) {
    if (el.parent) el.parent.children.splice(el.parent.children.indexOf(el), 1)
    const at = anchor ? parent.children.indexOf(anchor) : -1
    parent.children.splice(at < 0 ? parent.children.length : at, 0, el); el.parent = parent
  },
  remove(el) { if (el.parent) el.parent.children.splice(el.parent.children.indexOf(el), 1); el.parent = null },
  parentNode: el => el.parent, nextSibling: el => el.parent?.children[el.parent.children.indexOf(el) + 1] ?? null,
})
const nodes = el => [el, ...el.children.flatMap(nodes)]
const text = el => el.type === 'comment' ? '' : el.text + el.children.map(text).join('')
const settle = async () => { await new Promise(resolve => setImmediate(resolve)); await nextTick() }
function fixture() {
  return { generatedAt: '2026-11-22T01:00:00Z', qrStatus: null,
    history: [{ version_number: 2, correction_reason: 'Đính chính nguồn giống', created_at: '2026-10-01' }],
    trace: { lotCode: 'LO-A', species: 'SHRIMP', quantity: 12.5, harvestDate: '2026-11-21',
      farm: { name: 'Cơ sở A', address: 'Cà Mau' }, pond: { name: 'Ao A', code: 'AO-1' },
      batch: { code: 'VU-A', seedSource: 'Giống A', stockingDate: '2026-01-01' },
      proof: { status: 'UNAVAILABLE', recordedStatus: 'SUCCESS', transactionHash: '0xabc', checkedAt: null },
      packaging: [{ inspectionResult: 'Cảm quan đạt' }],
      logs: [{ date: '2026-11-01', type: 'FEEDING', details: { feedType: 'Thức ăn A', feedAmount: 2 }, blockchainStatus: 'SUCCESS' }],
      transports: [{ code: 'VC-A', date: '2026-11-21', status: 'DELIVERED', quantity: 12.5, recipientName: 'Phân phối A', events: [] }],
    },
  }
}
function mount(api, publicReport = false) {
  let prints = 0
  const previousDocument = globalThis.document, previousWindow = globalThis.window
  globalThis.document = { title: 'Trang ban đầu', body: { dataset: {} } }
  globalThis.window = { location: { origin: 'https://example.test' }, print: () => prints++ }
  globalThis.reportApi = api
  const path = publicReport ? '/trace/code/report' : '/lo-hang/lot-a/bao-cao'
  const route = reactive({ name: publicReport ? 'trace-report' : 'lot-report', path, fullPath: path, params: publicReport ? { traceCode: 'code' } : { lotId: 'lot-a' } })
  globalThis.reportRoute = route
  const root = node('root'), app = renderer.createApp(Report)
  app.component('RouterLink', { setup(_, {slots}) { return () => h('a', slots.default?.()) } })
  app.mount(root)
  return { root, route, prints: () => prints, close() { app.unmount(); assert.equal(document.title, 'Trang ban đầu'); assert.equal(document.body.dataset.reportPrint, undefined); globalThis.document = previousDocument; globalThis.window = previousWindow } }
}
const printButton = root => nodes(root).find(item => item.type === 'button' && text(item).includes('In / Lưu PDF'))
test('private report renders origin, histories and honest unavailable proof; print uses browser and restores document on exit', async () => {
  const calls = [], view = mount(async (...args) => { calls.push(args); return fixture() })
  try {
    assert.equal(printButton(view.root).props.disabled, true)
    await settle()
    assert.deepEqual(calls, [['/lots/lot-a/report']])
    assert.match(text(view.root), /Cơ sở A/); assert.match(text(view.root), /Đính chính nguồn giống/)
    assert.match(text(view.root), /Không thể đối soát Blockchain/)
    assert.match(text(view.root), /Phân phối A/); assert.match(text(view.root), /Thức ăn A/)
    assert.match(text(view.root), /Cảm quan đạt/)
    assert.equal(document.title, 'Bao-cao-truy-xuat-LO-A')
    assert.equal(printButton(view.root).props.disabled, false)
    printButton(view.root).props.onClick()
    assert.equal(view.prints(), 1)
  } finally { view.close() }
})
test('public report requests without login and never includes private history', async () => {
  const calls = [], view = mount(async (...args) => { calls.push(args); return { ...fixture(), status: 'ACTIVE' } }, true)
  try {
    await settle()
    assert.deepEqual(calls, [['/public/trace/code/report', false]])
    assert.match(text(view.root), /Bản công khai/)
    assert.doesNotMatch(text(view.root), /Đính chính nguồn giống|Lịch sử cập nhật vụ nuôi/)
  } finally { view.close() }
})
test('revoked public QR and failed requests cannot print or display a dossier', async () => {
  for (const api of [async () => ({ status: 'REVOKED' }), async () => { throw new Error('Không tải được hồ sơ') }]) {
    const view = mount(api, true)
    try {
      await settle()
      assert.equal(printButton(view.root).props.disabled, true)
      assert.equal(nodes(view.root).some(item => item.props.class === 'report-document'), false)
      printButton(view.root).props.onClick()
      assert.equal(view.prints(), 0)
    } finally { view.close() }
  }
})
test('a late response for a previous lot cannot replace the current report', async () => {
  let resolveOld
  const view = mount(path => path.includes('lot-a') ? new Promise(resolve => { resolveOld = resolve }) : Promise.resolve({ ...fixture(), trace: { ...fixture().trace, lotCode: 'LO-B' } }))
  try {
    view.route.params.lotId = 'lot-b'; view.route.path = '/lo-hang/lot-b/bao-cao'; view.route.fullPath = view.route.path
    await settle()
    resolveOld(fixture()); await settle()
    assert.match(text(view.root), /LO-B/); assert.doesNotMatch(text(view.root), /Lô LO-A/)
    assert.equal(document.title, 'Bao-cao-truy-xuat-LO-B')
  } finally { view.close() }
})

import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import { parse, compileScript } from '@vue/compiler-sfc'
import ts from 'typescript'
import { createRenderer, h, nextTick, ref } from 'vue'

// Execute the real SFC; replace only browser routing, API I/O and UI wrappers.
const dataModule = source => `data:text/javascript;base64,${Buffer.from(source).toString('base64')}`
const vueUrl = import.meta.resolve('vue')
const typesSource = await readFile(new URL('../src/types/index.ts', import.meta.url), 'utf8')
const typesModule = dataModule(ts.transpileModule(typesSource, { compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.ESNext } }).outputText)
const overlaySource = await readFile(new URL('../src/components/overlay-dismiss.ts', import.meta.url), 'utf8')
const overlay = dataModule(ts.transpileModule(overlaySource, { compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.ESNext } }).outputText.replace("from 'vue'", `from ${JSON.stringify(vueUrl)}`))
const stubs = {
  '../../types': typesModule,
  '../../components/overlay-dismiss': overlay,
  'vue-router': dataModule('export const useRouter = () => ({resolve: ({params}) => ({href: `/trace/${params.traceCode}`})})'),
  '../api/client': dataModule('export class ApiError extends Error {}; export const api = {get: (...a) => globalThis.qrTestApi.get(...a), post: (...a) => globalThis.qrTestApi.post(...a)}'),
  'vuestic-ui': dataModule(`import {h,defineComponent} from ${JSON.stringify(vueUrl)};
    const component = tag => defineComponent({inheritAttrs:false,emits:['update:modelValue'],setup(_, {attrs,slots,emit}) {
      return () => h(tag, {...attrs,onInput:e=>emit('update:modelValue',e.target.value)}, slots.default?.());
    }});
    export const VaButton=component('button'), VaAlert=component('aside'), VaTextarea=component('textarea'),
      VaBadge=component('span'), VaIcon=component('i'), VaCard=component('article'), VaCardContent=component('div'), VaInnerLoading=component('section');`),
}
async function loadSfc(path, extraStubs = {}) {
  const source = await readFile(new URL(path, import.meta.url), 'utf8')
  const compiled = compileScript(parse(source).descriptor, { id: path, inlineTemplate: true })
  const js = ts.transpileModule(compiled.content, { compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.ESNext } }).outputText
  const imports = { ...stubs, ...extraStubs }
  const resolved = js.replace(/(from\s+)(['"])([^'"]+)\2/g, (_, prefix, quote, specifier) => `${prefix}${quote}${imports[specifier] ?? import.meta.resolve(specifier)}${quote}`)
  return (await import(dataModule(resolved))).default
}
const Panel = await loadSfc('../src/components/LotQrPanel.vue')
const node = (type, text = '') => ({ type, text, props: {}, children: [], parent: null, get options() { return this.children }, addEventListener() {}, getRootNode() { return this.parent?.getRootNode() ?? this }, open: false, showModal() { this.open = true }, close() { this.open = false } })
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
  parentNode: el => el.parent,
  nextSibling: el => el.parent?.children[el.parent.children.indexOf(el) + 1] ?? null,
})
const nodes = el => [el, ...el.children.flatMap(nodes)]
const text = el => el.type === 'comment' ? '' : el.text + el.children.map(text).join('')
const settle = async () => { await new Promise(resolve => setImmediate(resolve)); await nextTick() }
const code = { trace_code: 'code-a', status: 'ACTIVE', created_at: '2026-11-08', revoked_at: null, revocation_reason: null, issuer_organization_id: 'org-a', issuer: { name: 'Phân phối A' } }
const result = (qr = null, canIssue = false, canRevoke = false) => ({ success: true, qr, canIssue, canRevoke })
function mount(api, path = '/transports/trip-a/qr') {
  globalThis.window = { location: { hostname: 'example.test', origin: 'https://example.test' }, confirm: () => true, setInterval: () => 1, clearInterval() {} }
  globalThis.qrTestApi = api
  const apiPath = ref(path), root = node('root')
  const app = renderer.createApp({ render: () => h(Panel, { apiPath: apiPath.value, lotCode: 'LOT-A' }) })
  app.mount(root)
  return { root, apiPath, close: () => app.unmount() }
}
const button = (root, label) => nodes(root).find(n => n.type === 'button' && text(n).includes(label))

test('farm view cannot issue and uses its provided API path', async () => {
  const paths = []
  const view = mount({ get: async path => { paths.push(path); return result() } }, '/farms/f/ponds/p/batches/b/lots/l/qr')
  try {
    await settle()
    assert.deepEqual(paths, ['/farms/f/ponds/p/batches/b/lots/l/qr'])
    assert.equal(button(view.root, 'Phát hành'), undefined)
    assert.match(text(view.root), /nhà phân phối/i)
  } finally { view.close() }
})
test('confirmed distributor issues and downloads real SVG, then revokes with reason', async () => {
  const writes = []
  const view = mount({ get: async () => result(null, true), post: async (path, body) => {
    writes.push({ path, body })
    return path.endsWith('/revoke') ? result({ ...code, status: 'REVOKED', revocation_reason: body.reason }) : result(code, false, true)
  } })
  try {
    await settle()
    await button(view.root, 'Phát hành').props.onClick()
    await settle()
    const download = nodes(view.root).find(n => n.type === 'a' && n.props.download)
    assert.equal(download.props.download, 'lot-code-a.svg')
    assert.match(await (await fetch(download.props.href)).text(), /<svg/)
    assert.match(text(view.root), /Phân phối A/)
    const textarea = nodes(view.root).find(n => n.type === 'textarea')
    textarea.props.onInput({ target: { value: '  Sai thông tin  ' } })
    await nextTick()
    await nodes(view.root).find(n => n.type === 'form').props.onSubmit({ preventDefault() {} })
    await settle()
    assert.deepEqual(writes, [{ path: '/transports/trip-a/qr', body: undefined }, { path: '/transports/trip-a/qr/revoke', body: { reason: 'Sai thông tin' } }])
    assert.match(text(view.root), /QR đã thu hồi/)
    assert.equal(nodes(view.root).find(n => n.props.download), undefined)
  } finally { view.close() }
})
test('a packaged shipment without its own QR can publish but has no QR to download yet', async () => {
  const view = mount({ get: async () => result(null, true) })
  try {
    await settle()
    assert.equal(nodes(view.root).find(n => n.type === 'form'), undefined)
    assert.equal(nodes(view.root).find(n => n.props.download), undefined)
    assert.ok(button(view.root, 'Phát hành'))
  } finally { view.close() }
})
test('legacy farm QR alone permits owner revocation', async () => {
  const view = mount({ get: async () => result({ ...code, issuer_organization_id: null, issuer: null }, false, true) })
  try { await settle(); assert.ok(button(view.root, 'Thu hồi QR')); assert.equal(button(view.root, 'Phát hành'), undefined) }
  finally { view.close() }
})
test('failed load offers retry and a failed issue keeps current QR state', async () => {
  let attempts = 0
  const view = mount({ get: async () => { if (!attempts++) throw new Error('Mất kết nối'); return result(null, true) }, post: async () => { throw new Error('Chưa xác nhận') } })
  try {
    await settle(); assert.match(text(view.root), /Mất kết nối/)
    await button(view.root, 'Thử lại').props.onClick(); await settle()
    await button(view.root, 'Phát hành').props.onClick(); await settle()
    assert.match(text(view.root), /Chưa xác nhận/)
    assert.ok(button(view.root, 'Phát hành'))
  } finally { view.close() }
})
test('late issue response cannot replace QR or permissions after switching lot', async () => {
  let finishIssue
  const view = mount({ get: async path => path.includes('trip-b') ? result({ ...code, trace_code: 'code-b' }) : result(null, true),
    post: () => new Promise(resolve => { finishIssue = resolve }) })
  try {
    await settle(); const pending = button(view.root, 'Phát hành').props.onClick()
    view.apiPath.value = '/transports/trip-b/qr'; await settle()
    finishIssue(result(code, false, true)); await pending; await settle()
    assert.equal(nodes(view.root).find(n => n.props.download).props.download, 'lot-code-b.svg')
    assert.equal(button(view.root, 'Thu hồi QR'), undefined)
  } finally { view.close() }
})
test('receipt page enables QR issuance only after receipt and packaging confirmation', async () => {
  const previousDocument = globalThis.Document
  const previousShadowRoot = globalThis.ShadowRoot
  globalThis.qrTestPanel = Panel
  globalThis.qrTestHeader = await loadSfc('../src/components/PageHeader.vue')
  globalThis.qrTestEmpty = await loadSfc('../src/components/EmptyState.vue')
  globalThis.qrTestLoading = await loadSfc('../src/components/LoadingState.vue')
  globalThis.qrTestReceiptForm = await loadSfc('../src/pages/transports/ReceiptForm.vue')
  globalThis.qrTestReceiptSummary = await loadSfc('../src/pages/transports/ReceiptSummary.vue')
  globalThis.qrTestPackagingDetails = await loadSfc('../src/components/LotPackagingDetails.vue')
  globalThis.qrTestPackaging = await loadSfc('../src/pages/transports/PackagingForm.vue', {
    '../../api/client': stubs['../api/client'],
    '../../components/LotPackagingDetails.vue': dataModule('export default globalThis.qrTestPackagingDetails'),
  })
  globalThis.qrTestReceiptQuery = ref({ trip: 'trip-a' })
  const Receipts = await loadSfc('../src/pages/transports/DistributorReceipts.vue', {
    '../../stores/auth.store': dataModule('export const useAuthStore = () => ({ organizationName: "Phân phối A" })'),
    'vue-router': dataModule('export const useRoute = () => ({ get query() { return globalThis.qrTestReceiptQuery.value } }); export const useRouter = () => ({ replace: async ({query}) => { globalThis.qrTestReceiptQuery.value = query } })'),
    '../../types': typesModule,
    './ReceiptForm.vue': dataModule('export default globalThis.qrTestReceiptForm'),
    './ReceiptSummary.vue': dataModule('export default globalThis.qrTestReceiptSummary'),
    './PackagingForm.vue': dataModule('export default globalThis.qrTestPackaging'),
    '../../components/PageHeader.vue': dataModule('export default globalThis.qrTestHeader'),
    '../../components/EmptyState.vue': dataModule('export default globalThis.qrTestEmpty'),
    '../../components/LoadingState.vue': dataModule('export default globalThis.qrTestLoading'),
    '../../api/client': stubs['../api/client'],
    '../../components/LotQrPanel.vue': dataModule('export default globalThis.qrTestPanel'),
    '../../components/CollectionToolbar.vue': dataModule(`import {h} from ${JSON.stringify(vueUrl)};export default {render:()=>h('nav')}`),
  })
  let confirmed = false, packaged = null
  const paths = []
  // Initialize browser boundary without introducing a DOM or network dependency.
  const initial = mount({ get: async () => result() }); initial.close()
  globalThis.qrTestApi = {
    get: async path => {
      paths.push(path)
      return path === '/transports/receiving' ? { items: [{
        id: 'trip-a', transport_code: 'TRIP-A', status: confirmed ? 'DELIVERED' : 'IN_TRANSIT',
        receipt_outcome: confirmed ? 'FULL' : null, received_quantity: confirmed ? 10 : null,
        delivery_reported_at: '2026-11-08', transport_date: '2026-11-08', quantity: 10, from_location: 'Farm', to_location: 'Shop', events: [],
        lot: { id: 'lot-a', lot_code: 'LOT-A', provenance: { farm: { name: 'Farm' }, batch: { species: 'SHRIMP' }, pond: { name: 'Ao' } } },
      }] } : path.endsWith('/packaging') ? { packaging: packaged } : result(null, Boolean(packaged))
    },
    post: async (path, body) => {
      if (path.endsWith('/packaging')) {
        assert.equal(body.quantity, 10)
        assert.equal(body.inspectionResult, 'Cảm quan đạt')
        packaged = { ...body, transportCode: 'TRIP-A', distributorName: 'Phân phối A' }
        return { packaging: packaged }
      }
      assert.equal(path, '/transports/trip-a/confirm-delivery')
      assert.deepEqual(body, { receiptOutcome: 'FULL', receivedQuantity: 10, note: '' })
      confirmed = true
      return { transport: { status: 'DELIVERED', receipt_outcome: 'FULL', received_quantity: 10 } }
    },
  }
  globalThis.Document = class {}
  globalThis.ShadowRoot = class {}
  const root = node('root'), app = renderer.createApp(Receipts); app.mount(root)
  try {
    await settle(); assert.equal(button(root, 'Phát hành'), undefined)
    const fullReceipt = nodes(root).find(n => n.type === 'input' && n.props.type === 'radio' && n.props.value === 'FULL')
    assert.ok(fullReceipt)
    fullReceipt.props['onUpdate:modelValue']('FULL'); await nextTick()
    await nodes(root).find(n => n.type === 'form' && n.props.class === 'receipt-form').props.onSubmit({ preventDefault() {} }); await settle()
    assert.equal(button(root, 'Phát hành'), undefined)
    const packagingForm = nodes(root).find(n => n.type === 'form')
    const fields = nodes(packagingForm).filter(n => (n.type === 'input' && n.props.type == null) || n.type === 'textarea')
    for (const [index, value] of ['Túi 500 g', 'Đơn vị A', 'Cảm quan đạt'].entries()) {
      fields[index].props['onUpdate:modelValue'](value)
    }
    await packagingForm.props.onSubmit({ preventDefault() {} }); await settle()
    assert.ok(button(root, 'Phát hành'))
    assert.ok(paths.includes('/transports/trip-a/qr'))
  } finally {
    app.unmount()
    globalThis.Document = previousDocument
    globalThis.ShadowRoot = previousShadowRoot
  }
})

test('collection toolbar resets search and status, and bounds pagination controls', async () => {
  const Toolbar = await loadSfc('../src/components/CollectionToolbar.vue')
  const query = ref('Ao 1'), status = ref('ACTIVE'), page = ref(2)
  const root = node('root')
  const app = renderer.createApp({ render: () => h(Toolbar, {
    query: query.value, status: status.value, page: page.value, total: 13, pageSize: 9,
    'onUpdate:query': value => { query.value = value },
    'onUpdate:status': value => { status.value = value },
    'onUpdate:page': value => { page.value = value },
  }) })
  app.mount(root)
  try {
    assert.match(text(root), /10–13 \/ 13/)
    assert.equal(button(root, 'Sau').props.disabled, true)
    button(root, 'Trước').props.onClick(); await nextTick()
    assert.equal(page.value, 1)
    assert.equal(button(root, 'Trước').props.disabled, true)
    button(root, 'Xóa bộ lọc').props.onClick(); await nextTick()
    assert.equal(query.value, '')
    assert.equal(status.value, '')
    assert.equal(button(root, 'Xóa bộ lọc'), undefined)
  } finally { app.unmount() }
})

test('transport UI distinguishes reported delivery from confirmed receipt', async () => {
  globalThis.qrTestHeader = await loadSfc('../src/components/PageHeader.vue')
  globalThis.qrTestEmpty = await loadSfc('../src/components/EmptyState.vue')
  globalThis.qrTestProgress = await loadSfc('../src/pages/transports/TransportProgress.vue')
  globalThis.qrTestReceiptSummary = await loadSfc('../src/pages/transports/ReceiptSummary.vue')
  const Transport = await loadSfc('../src/pages/transports/TransporterDashboard.vue', {
    '../../api/client': stubs['../api/client'],
    '../../components/PageHeader.vue': dataModule('export default globalThis.qrTestHeader'),
    '../../components/EmptyState.vue': dataModule('export default globalThis.qrTestEmpty'),
    './TransportProgress.vue': dataModule('export default globalThis.qrTestProgress'),
    './ReceiptSummary.vue': dataModule('export default globalThis.qrTestReceiptSummary'),
    '../../stores/auth.store': dataModule("export const useAuthStore = () => ({ fullName: 'Huynh' })"),
  })
  const initial = mount({ get: async () => result() }); initial.close()
  let finishLoad
  globalThis.qrTestApi = { get: () => new Promise(resolve => { finishLoad = resolve }) }
  const response = { available: [], assigned: ['IN_TRANSIT', 'DELIVERED'].map((status, index) => ({
    id: `trip-${index}`, transport_code: `TRIP-${index}`, status, quantity: 10,
    from_location: 'Farm', to_location: 'Shop', transport_date: '2026-11-08',
    delivery_reported_at: '2026-11-08', events: [],
    lot: { lot_code: 'LOT-A', provenance: { farm: { name: 'Farm' }, pond: { name: 'Pond' }, batch: { batch_code: 'BATCH-A' } } },
  })) }
  const root = node('root'), app = renderer.createApp(Transport)
  app.mount(root)
  try {
    await nextTick()
    assert.ok(nodes(root).some(n => n.props['aria-label'] === 'Đang tải chuyến vận chuyển'))
    finishLoad(response)
    await settle()
    button(root, 'Đang thực hiện').props.onClick(); await nextTick()
    assert.match(text(root), /Chờ xác nhận bàn giao/)
    button(root, 'Lịch sử').props.onClick(); await nextTick()
    assert.match(text(root), /Đã bàn giao/)
    assert.doesNotMatch(text(root), /Chờ xác nhận bàn giao/)
  } finally { app.unmount() }
})

test('overlay dismissal compares the current draft with the opening snapshot and blocks while busy', async () => {
  const { draftDismiss } = await import(overlay)
  const opened = ref(false), draft = ref({ name: '', enabled: true })
  let busy = false, prompts = 0, closes = 0, discard = false
  const confirm = globalThis.window.confirm
  globalThis.window.confirm = () => { prompts++; return discard }
  try {
    const { dismiss, markClean } = draftDismiss(() => draft.value, () => busy, opened)
    opened.value = true
    const close = () => { closes++ }
    dismiss(close)
    draft.value.enabled = false
    dismiss(close)
    assert.deepEqual([prompts, closes], [1, 1])
    discard = true
    busy = true
    dismiss(close)
    assert.deepEqual([prompts, closes], [1, 1])
    busy = false
    dismiss(close)
    assert.deepEqual([prompts, closes], [2, 2])
    markClean()
    dismiss(close)
    assert.deepEqual([prompts, closes], [2, 3])
  } finally { globalThis.window.confirm = confirm }
})

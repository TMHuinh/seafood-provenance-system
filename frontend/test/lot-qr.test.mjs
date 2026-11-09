import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import { parse, compileScript } from '@vue/compiler-sfc'
import ts from 'typescript'
import { createRenderer, h, nextTick, ref } from 'vue'

// Execute the real SFC; replace only browser routing, API I/O and UI wrappers.
const dataModule = source => `data:text/javascript;base64,${Buffer.from(source).toString('base64')}`
const vueUrl = import.meta.resolve('vue')
const stubs = {
  'vue-router': dataModule('export const useRouter = () => ({resolve: ({params}) => ({href: `/trace/${params.traceCode}`})})'),
  '../api/client': dataModule('export const api = {get: (...a) => globalThis.qrTestApi.get(...a), post: (...a) => globalThis.qrTestApi.post(...a)}'),
  'vuestic-ui': dataModule(`import {h,defineComponent} from ${JSON.stringify(vueUrl)};
    const component = tag => defineComponent({inheritAttrs:false,emits:['update:modelValue'],setup(_, {attrs,slots,emit}) {
      return () => h(tag, {...attrs,onInput:e=>emit('update:modelValue',e.target.value)}, slots.default?.());
    }});
    export const VaButton=component('button'), VaAlert=component('aside'), VaTextarea=component('textarea'),
      VaBadge=component('span'), VaCard=component('article'), VaCardContent=component('div'), VaInnerLoading=component('section');`),
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
test('other receiving distributor downloads but cannot revoke another publisher QR', async () => {
  const view = mount({ get: async () => result(code) })
  try {
    await settle()
    assert.equal(nodes(view.root).find(n => n.type === 'form'), undefined)
    assert.ok(nodes(view.root).find(n => n.props.download))
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
test('receipt page enables QR issuance only after successful receipt confirmation', async () => {
  globalThis.qrTestPanel = Panel
  const Receipts = await loadSfc('../src/pages/transports/DistributorReceipts.vue', {
    '../../api/client': stubs['../api/client'],
    '../../components/LotQrPanel.vue': dataModule('export default globalThis.qrTestPanel'),
    '../../components/CollectionToolbar.vue': dataModule(`import {h} from ${JSON.stringify(vueUrl)};export default {render:()=>h('nav')}`),
  })
  let confirmed = false
  const paths = []
  // Initialize browser boundary without introducing a DOM or network dependency.
  const initial = mount({ get: async () => result() }); initial.close()
  globalThis.qrTestApi = {
    get: async path => {
      paths.push(path)
      return path === '/transports/receiving' ? { items: [{
        id: 'trip-a', transport_code: 'TRIP-A', status: confirmed ? 'DELIVERED' : 'IN_TRANSIT',
        delivery_reported_at: '2026-11-08', quantity: 10, from_location: 'Farm', to_location: 'Shop', events: [],
        lot: { id: 'lot-a', lot_code: 'LOT-A', provenance: { farm: { name: 'Farm' } } },
      }] } : result(null, true)
    },
    post: async path => { assert.equal(path, '/transports/trip-a/confirm-delivery'); confirmed = true; return {} },
  }
  const root = node('root'), app = renderer.createApp(Receipts); app.mount(root)
  try {
    await settle(); assert.equal(button(root, 'Phát hành'), undefined)
    await button(root, 'Xác nhận đã nhận hàng').props.onClick(); await settle()
    assert.ok(button(root, 'Phát hành'))
    assert.ok(paths.includes('/transports/trip-a/qr'))
  } finally { app.unmount() }
})

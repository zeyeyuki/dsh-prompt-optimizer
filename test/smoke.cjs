// Registration + render smoke test for the prompt-optimizer client bundle.
// Uses a tiny React-hook stand-in so the panel and chip can be rendered once
// without a browser; it proves the registrations and render paths do not throw.
const fs = require('node:fs')
const path = require('node:path')

let captured = null
globalThis.window = {
  __ModuleLoader__: { load: (def) => { captured = def } },
  localStorage: { getItem: () => null, setItem: () => {} },
  setTimeout: () => 0,
  clearTimeout: () => {},
}
globalThis.document = { getElementById: () => null, head: { appendChild: () => {} }, createElement: () => ({ setAttribute() {}, textContent: '', focus() {} }) }
globalThis.navigator = { clipboard: null }

const src = fs.readFileSync(path.join(__dirname, '..', 'client.js'), 'utf8')
new Function(src)()

// --- minimal hooks implementation -------------------------------------------
let cells = []
let cursor = 0
let effects = []
const ReactStub = {
  createElement: (type, props, ...children) => ({ type, props: props || {}, children: children.flat() }),
  useState(init) {
    const i = cursor++
    if (!(i in cells)) cells[i] = typeof init === 'function' ? init() : init
    return [cells[i], (v) => { cells[i] = typeof v === 'function' ? v(cells[i]) : v }]
  },
  useRef(init) {
    const i = cursor++
    if (!(i in cells)) cells[i] = { current: init }
    return cells[i]
  },
  useEffect(fn) { const i = cursor++; effects[i] = fn },
  useMemo(fn) { cursor++; return fn() },
}
function render(Component, props) {
  cells = []
  cursor = 0
  effects = []
  const tree = Component(props)
  return tree
}

const mod = captured.factory((name) => {
  if (name === 'react') return ReactStub
  throw new Error('unexpected require ' + name)
})

let failed = 0
function check(label, fn) {
  try { fn(); console.log('ok   ' + label) } catch (e) { failed++; console.log('FAIL ' + label + ' :: ' + (e && e.stack ? e.stack.split('\n')[0] : e)) }
}

// --- registration -----------------------------------------------------------
check('apply registers styles, locale, tab type, panel, title, chip', () => {
  const log = []
  const ctx = {
    effect(fn, label) { log.push('effect:' + label); const d = fn(); return typeof d === 'function' ? d : () => {} },
    locale: {
      bind: () => (key) => key,
      register(ns, dicts) { log.push('locale:' + ns + ':' + Object.keys(dicts).join('/')); return () => {} },
    },
    slots: {
      inject(name, cb) { log.push('inject:' + name); return cb() },
      register(opts, comp) { log.push('register:' + opts.name + ':' + (opts.key || opts.id || '') + ':' + (typeof comp)); return () => {} },
    },
    sidebarRightTabs: { register(def) { log.push('tab:' + def.kind + ':' + def.id); return () => {} } },
    sidebarRight: { openTab(kind) { log.push('open:' + kind) } },
  }
  mod.apply(ctx)
  const wanted = [
    'tab:prompt-optimizer:dsh-prompt-optimizer',
    'register:sidebar.right.pane.tab:dsh-prompt-optimizer:function',
    'register:sidebar.right.pane.tab.title:dsh-prompt-optimizer:function',
    'register:conversation.input.left:prompt-optimizer:function',
    'locale:prompt-optimizer:zh/en',
  ]
  for (const w of wanted) if (!log.includes(w)) throw new Error('missing ' + w + ' in ' + JSON.stringify(log, null, 0))
})

check('apply survives a missing sidebar controller (no chip registered)', () => {
  const log = []
  const ctx = {
    effect(fn) { fn(); return () => {} },
    locale: { bind: () => () => 'x', register: () => () => {} },
    slots: { inject: (n, cb) => cb(), register: (o) => { log.push(o.name); return () => {} } },
    sidebarRightTabs: { register: () => () => {} },
  }
  mod.apply(ctx)
  if (log.includes('conversation.input.left')) throw new Error('chip registered without a controller')
})

// --- chip -------------------------------------------------------------------
check('chip renders and hands an empty draft over', () => {
  const calls = []
  const chip = render(mod.__test.ComposerChip, {
    useInput: (sel) => sel({ draft: '   ' }),
    openOptimizer: () => calls.push('open'),
  })
  if (chip.type !== 'button') throw new Error('root is not a button')
  if (!String(chip.props['aria-label']).startsWith('优化提示词')) throw new Error('aria-label must start with the visible label')
  chip.props.onClick()
  if (calls.length !== 1) throw new Error('openOptimizer not called')
  if (mod.__test.handoffSnapshot().pending !== true) throw new Error('hand-off not marked pending')
  if (mod.__test.handoffSnapshot().text !== '') throw new Error('empty draft must hand over an empty string')
})

check('chip works without useInput', () => {
  render(mod.__test.ComposerChip, { openOptimizer: () => {} })
})

// --- panel ------------------------------------------------------------------
check('panel renders with full props', () => {
  const tree = render(mod.__test.Panel, {
    t: (key) => undefined,
    useInput: (sel) => sel({ draft: 'hi', phase: 'plain' }),
    inputActions: { setDraft: () => {} },
    sessionId: 's1',
  })
  if (tree.props['data-prompt-optimizer-panel'] === undefined) throw new Error('panel marker missing')
})

check('panel renders with no props at all', () => {
  const tree = render(mod.__test.Panel, {})
  if (tree.props['data-prompt-optimizer-panel'] === undefined) throw new Error('panel marker missing')
})

check('panel switches domain and strength without throwing', () => {
  const tree = render(mod.__test.Panel, { t: (k) => undefined })
  const body = tree.children.find((c) => c && c.props && c.props.className === 'dspo-body')
  if (!body) throw new Error('body missing')
  const chips = []
  const walk = (node) => {
    if (!node || typeof node !== 'object') return
    if (node.props && node.props.className === 'dspo-tag') chips.push(node)
    if (node.children) node.children.forEach(walk)
  }
  walk(tree)
  if (chips.length !== 11) throw new Error('expected 11 option chips (8 domain + 3 strength), got ' + chips.length)
  chips.forEach((chip) => chip.props.onClick())
})

// --- hand-off end to end ----------------------------------------------------
check('a draft handed over by the chip reaches the panel input exactly once', () => {
  cells = []
  cursor = 0
  effects = []
  const chip = mod.__test.ComposerChip({
    useInput: (sel) => sel({ draft: '写个脚本把图片转 webp' }),
    openOptimizer: () => {},
  })
  chip.props.onClick()
  if (mod.__test.handoffSnapshot().text !== '写个脚本把图片转 webp') throw new Error('hand-off text wrong')

  // Mount the panel with the still-pending hand-off, then run its effects.
  mod.__test.Panel({ t: () => undefined, useInput: (sel) => sel({ draft: '写个脚本把图片转 webp', phase: 'plain' }) })
  effects.forEach((fn) => { if (typeof fn === 'function') fn() })
  if (mod.__test.handoffSnapshot().pending !== false) throw new Error('hand-off not consumed')

  // A second render pass reflects the state the effect committed.
  cursor = 0
  const panel = mod.__test.Panel({ t: () => undefined })
  const values = []
  const walk = (node) => {
    if (!node || typeof node !== 'object') return
    if (node.type === 'textarea' && node.props.id === 'dspo-input') values.push(node.props.value)
    ;(node.children || []).forEach(walk)
  }
  walk(panel)
  if (values[0] !== '写个脚本把图片转 webp') throw new Error('panel input = ' + JSON.stringify(values[0]))

  // A remount must not re-apply the consumed draft.
  cursor = 0
  const remount = mod.__test.Panel({ t: () => undefined })
  const values2 = []
  const walk2 = (node) => {
    if (!node || typeof node !== 'object') return
    if (node.type === 'textarea' && node.props.id === 'dspo-input') values2.push(node.props.value)
    ;(node.children || []).forEach(walk2)
  }
  walk2(remount)
  if (values2[0] !== '写个脚本把图片转 webp') throw new Error('remount lost the draft: ' + JSON.stringify(values2[0]))
})

// --- styles & manifest ------------------------------------------------------
check('style text only uses theme tokens and the dspo- prefix', () => {
  const root = path.join(__dirname, '..')
  const raw = fs.readFileSync(path.join(root, 'client.js'), 'utf8')
  const start = raw.indexOf('    var CSS = [')
  const end = raw.indexOf("].join('\\n')", start)
  if (start < 0 || end < 0) throw new Error('CSS block not found')
  const css = raw.slice(start, end)
  const badColors = /#[0-9a-fA-F]{3,8}\b|\brgba?\(/.exec(css)
  if (badColors) throw new Error('literal color in CSS: ' + badColors[0])
  if (/--dsw-alias-(?![\w-])/.test(css)) throw new Error('malformed alias token')
})

check('package.json and locales parse and agree', () => {
  const root = path.join(__dirname, '..')
  const pkg = JSON.parse(fs.readFileSync(path.join(root, 'package.json'), 'utf8'))
  if (pkg.dsh.client.platform !== 'web') throw new Error('platform must be web')
  if (pkg.exports['./client'] !== './client.js') throw new Error('exports["./client"] missing')
  if (!fs.existsSync(path.join(root, 'client.js'))) throw new Error('client.js missing')
  if (!fs.existsSync(path.join(root, pkg.icon || pkg.exports['./icon']))) throw new Error('icon missing')
  for (const loc of ['zh', 'en']) {
    const dict = JSON.parse(fs.readFileSync(path.join(root, 'locale', loc + '.json'), 'utf8'))
    if (!dict.meta || !dict.meta.title || !dict.meta.description) throw new Error('locale ' + loc + ' lacks meta')
    if (dict.meta.detail) {
      const detailPath = path.join(root, dict.meta.detail)
      if (!fs.existsSync(detailPath)) throw new Error('missing detail doc ' + dict.meta.detail)
      const lines = fs.readFileSync(detailPath, 'utf8').trim().split('\n').filter(Boolean)
      if (lines.length !== 1 || !lines[0].startsWith('![')) throw new Error('detail doc must be exactly one image line')
      const image = /\]\(([^)]+)\)/.exec(lines[0])
      if (!image || !fs.existsSync(path.join(root, 'docs', image[1]))) throw new Error('detail image missing: ' + (image && image[1]))
    }
  }
})

console.log('\nFAILED=' + failed)
process.exit(failed === 0 ? 0 : 1)
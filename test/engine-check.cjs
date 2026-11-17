// Offline check of the prompt-optimizer rule engine (no DOM, no browser).
const fs = require('node:fs')
const path = require('node:path')

let captured = null
globalThis.window = {
  __ModuleLoader__: { load: (def) => { captured = def } },
  localStorage: { getItem: () => null, setItem: () => {} },
}
globalThis.document = { getElementById: () => null, head: { appendChild: () => {} }, createElement: () => ({ setAttribute() {}, textContent: '' }) }
globalThis.navigator = { clipboard: null }

const src = fs.readFileSync(path.join(__dirname, '..', 'client.js'), 'utf8')
// eslint-disable-next-line no-new-func
new Function(src)()

const ReactStub = { createElement() {}, useEffect() {}, useMemo() {}, useRef() {}, useState() {} }
const mod = captured.factory((name) => {
  if (name === 'react') return ReactStub
  throw new Error('unexpected require ' + name)
})

const { buildPrompt, detectDomain } = mod.__test
const cases = [
  { label: 'zh code / standard', input: '写个Python脚本把文件夹里的图片批量转成webp，要有进度显示', opts: {} },
  { label: 'zh image / deep', input: '画一张赛博朋克风格的猫，做竖版壁纸', opts: { strength: 'deep' } },
  { label: 'zh plan / light', input: '帮我规划三个月学会日语口语', opts: { strength: 'light' } },
  { label: 'zh writing', input: '写一篇小红书文案，介绍我的咖啡店，预算有限不要夸张', opts: {} },
  { label: 'en analysis', input: 'Compare React and Vue for a small team building an internal dashboard', opts: {} },
  { label: 'empty', input: '   ', opts: {} },
]

let failed = 0
for (const c of cases) {
  const built = buildPrompt(c.input, c.opts)
  console.log('\n=== ' + c.label + ' ===')
  if (!built) {
    console.log('(null result — expected only for blank input)')
    if (c.input.trim()) failed++
    continue
  }
  console.log('domain=' + built.domainId + ' lang=' + built.lang + ' ratio=' + built.ratio + ' chars=' + built.chars)
  console.log(built.text.split('\n').slice(0, 14).join('\n'))
}

// Variants must produce visibly different prompts.
const a = buildPrompt('写一个爬虫抓取商品价格', { variant: 0 })
const b = buildPrompt('写一个爬虫抓取商品价格', { variant: 1 })
const c2 = buildPrompt('写一个爬虫抓取商品价格', { variant: 2 })
const variantsDiffer = a.text !== b.text && b.text !== c2.text
console.log('\nvariants differ: ' + variantsDiffer)
if (!variantsDiffer) failed++

// Detection sanity.
const map = [
  ['写个正则匹配手机号', 'code'],
  ['画一张海报', 'image'],
  ['帮我对比这两个方案的优劣', 'analysis'],
  ['扮演面试官面试我', 'roleplay'],
  ['随便聊两句', 'general'],
  ['写个方案', 'plan'],
  ['写个Python脚本', 'code'],
  ['写一篇小红书文案', 'writing'],
  ['帮我规划三个月学会日语口语', 'plan'],
  ['Compare React and Vue', 'analysis'],
]
for (const [input, expected] of map) {
  const got = detectDomain(input).id
  if (got !== expected) {
    console.log('DETECT MISMATCH: "' + input + '" -> ' + got + ' (expected ' + expected + ')')
    failed++
  }
}

// Explicit constraints in the user's own words must survive into the result.
const sig = buildPrompt('用表格输出，控制在300字以内，语气专业，不要用感叹号', {})
for (const needle of ['表格', '300', '专业', '感叹号']) {
  if (sig.text.indexOf(needle) === -1) {
    console.log('MISSING SIGNAL: ' + needle)
    failed++
  }
}

// Every strength must produce a self-contained prompt with a role and a task.
for (const strength of ['light', 'standard', 'deep']) {
  const built = buildPrompt('帮我把这个月的报销整理一下', { strength })
  if (!built || built.text.indexOf('## 角色') !== 0 || built.text.indexOf('## 任务') === -1) {
    console.log('STRUCTURE FAILED for strength=' + strength)
    failed++
  }
}

console.log('\nFAILED=' + failed)
process.exit(failed === 0 ? 0 : 1)
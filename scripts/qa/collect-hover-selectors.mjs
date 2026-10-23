import { readdir, readFile, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import postcss from 'postcss'

const assets = process.argv[2] ?? 'dist/assets'
function branches(selector) {
  let depth = 0, quote = '', start = 0
  const result = []
  for (let i = 0; i < selector.length; i++) {
    const c = selector[i]
    if (quote) { if (c === quote && selector[i - 1] !== '\\') quote = ''; continue }
    if (c === '"' || c === "'") quote = c
    else if (c === '(' || c === '[') depth++
    else if (c === ')' || c === ']') depth--
    else if (c === ',' && !depth) { result.push(selector.slice(start, i)); start = i + 1 }
  }
  result.push(selector.slice(start))
  return result.map(value => value.trim())
}
const hosts = new Map(), unsupported = []
for (const file of await readdir(assets)) {
  if (!file.endsWith('.css') || file.startsWith('Admin')) continue
  postcss.parse(await readFile(join(assets, file), 'utf8')).walkRules(rule => {
    if (!rule.selector.includes(':hover')) return
    for (const selector of branches(rule.selector)) {
      const index = selector.indexOf(':hover')
      if (index < 0) continue
      const host = selector.slice(0, index)
      if ((host.match(/\(/g)?.length ?? 0) !== (host.match(/\)/g)?.length ?? 0)) { unsupported.push(selector); continue }
      const paints = rule.nodes.filter(node => node.type === 'decl' && /^(color|background.*|border.*color|box-shadow|fill|stroke)$/.test(node.prop)).map(node => ({ property: node.prop, value: node.value }))
      const entry = hosts.get(host) ?? { host, rules: [] }
      entry.rules.push({ selector, file, paints }); hosts.set(host, entry)
    }
  })
}
const result = { hosts: [...hosts.values()], unsupported }
await writeFile('qa/release-theme-acceptance-2026-10-21/hover-selectors.json', JSON.stringify(result, null, 2))
console.log(JSON.stringify({ hosts: hosts.size, unsupported }))

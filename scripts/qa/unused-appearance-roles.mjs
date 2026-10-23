import { readdir, readFile, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import postcss from 'postcss'

async function files(directory) {
  const result = []
  for (const entry of await readdir(directory, { withFileTypes: true })) {
    const path = join(directory, entry.name)
    if (entry.isDirectory()) result.push(...await files(path))
    else if (/\.(?:css|ts|tsx|svg|html)$/.test(path)) result.push(path)
  }
  return result
}
const references = new Set(), dependencies = new Map(), declarations = []
const owners = ['reference-tokens.css', 'radix-dark.css', 'shoditsa-study-tokens.css']
for (const path of await files('apps/web/src')) {
  const source = await readFile(path, 'utf8')
  if (!path.endsWith('.css')) {
    for (const match of source.matchAll(/['"`](--[\w-]+)/g)) references.add(match[1])
    for (const match of source.matchAll(/var\((--[\w-]+)/g)) references.add(match[1])
    continue
  }
  postcss.parse(source).walkDecls(declaration => {
    const uses = [...declaration.value.matchAll(/var\((--[\w-]+)/g)].map(match => match[1])
    if (declaration.prop.startsWith('--')) {
      const deps = dependencies.get(declaration.prop) ?? new Set()
      uses.forEach(role => deps.add(role)); dependencies.set(declaration.prop, deps)
      if (owners.some(owner => path.endsWith(owner))) declarations.push({ path, role: declaration.prop, value: declaration.value, line: declaration.source.start.line })
    } else uses.forEach(role => references.add(role))
  })
}
for (const role of references) for (const dependency of dependencies.get(role) ?? []) references.add(dependency)
const unused = declarations.filter(declaration => !references.has(declaration.role) && /#[\da-f]{3}|var\(--(?:color|quest|mauve|mint|violet|reference-game|shg)|color-mix/.test(declaration.value))
const result = { scope: 'Foundation appearance roles, with references and alias dependencies across every web source file (including platform and admin consumers).', declarations: declarations.length, unused }
await writeFile('qa/release-theme-acceptance-2026-10-21/unused-appearance-roles.json', JSON.stringify(result, null, 2))
console.log(JSON.stringify(result, null, 2))

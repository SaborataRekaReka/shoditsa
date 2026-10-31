import { readdir, readFile, stat } from 'node:fs/promises'
import { resolve, relative, sep } from 'node:path'

const root = resolve(process.argv[2] ?? 'dist')
async function htmlFiles(directory) {
  const entries = await readdir(directory, { withFileTypes: true })
  const files = await Promise.all(entries.map(entry => {
    const path = resolve(directory, entry.name)
    return entry.isDirectory() ? htmlFiles(path) : entry.name.endsWith('.html') ? [path] : []
  }))
  return files.flat()
}
const failures = []
const checked = new Set()
const pages = await htmlFiles(root)
for (const page of pages) {
  const html = await readFile(page, 'utf8')
  const urls = [...html.matchAll(/<(?:img|script|source)\b[^>]*?\bsrc=["']([^"']+)["']/gi)].map(match => match[1])
  for (const match of html.matchAll(/<(?:img|source)\b[^>]*?\bsrcset=["']([^"']+)["']/gi)) {
    urls.push(...match[1].split(',').map(candidate => candidate.trim().split(/\s+/)[0]))
  }
  for (const match of html.matchAll(/<link\b[^>]*>/gi)) {
    if (/\brel=["'](?:stylesheet|icon|modulepreload|preload)["']/i.test(match[0])) {
      const href = match[0].match(/\bhref=["']([^"']+)["']/i)?.[1]
      if (href) urls.push(href)
    }
  }
  for (const url of urls) {
    if (!url.startsWith('/') || url.startsWith('//')) continue
    const path = resolve(root, decodeURIComponent(url.split(/[?#]/)[0]).slice(1))
    const withinRoot = path.startsWith(root + sep)
    const exists = withinRoot && await stat(path).then(info => info.isFile()).catch(() => false)
    if (!exists) failures.push(`${relative(root, page)}: ${url}`)
    checked.add(url)
  }
}
if (failures.length) throw new Error(`Missing static resources:\n${failures.join('\n')}`)
console.log(`[static-assets] ${pages.length} HTML pages, ${checked.size} resources present`)

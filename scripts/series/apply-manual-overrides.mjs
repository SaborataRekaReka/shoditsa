import { mkdir, readFile, writeFile } from 'node:fs/promises'
import { resolve } from 'node:path'
import { applySeriesOverride, loadSeriesOverrides } from './manual-overrides.mjs'

const root = resolve(import.meta.dirname, '../..')
const args = process.argv.slice(2)
const valueAfter = (flag, fallback) => {
  const index = args.indexOf(flag)
  return index >= 0 && args[index + 1] ? args[index + 1] : fallback
}
const inputPath = resolve(root, valueAfter('--in', 'public/data/libraries/series/items.json'))
const outputPath = resolve(root, valueAfter('--out', 'public/data/libraries/series/items.json'))
const items = JSON.parse(await readFile(inputPath, 'utf8'))
if (!Array.isArray(items)) throw new Error(`Expected array JSON: ${inputPath}`)

const overrides = await loadSeriesOverrides(root)
let changed = 0
const output = items.map((item) => {
  const next = applySeriesOverride(item, overrides)
  if (JSON.stringify(next) !== JSON.stringify(item)) changed += 1
  return next
})

await mkdir(resolve(outputPath, '..'), { recursive: true })
await writeFile(outputPath, `${JSON.stringify(output, null, 2)}\n`, 'utf8')
console.log(`series=${output.length} changed=${changed} out=${outputPath}`)

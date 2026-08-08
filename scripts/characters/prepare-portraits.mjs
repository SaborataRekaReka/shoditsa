import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import sharp from 'sharp'

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..')
const OUTPUT = path.join(ROOT, 'public', 'images', 'characters', 'portraits')
const args = process.argv.slice(2)
const batchSourceArg = args.find((entry) => entry.startsWith('--batch-source='))
const sourceDirArg = args.find((entry) => entry.startsWith('--source-dir='))
const explicitEntries = args.filter((entry) => !entry.startsWith('--batch-source=') && !entry.startsWith('--source-dir='))
const entries = explicitEntries.map((entry) => {
  const separator = entry.indexOf('=')
  if (separator < 1) throw new Error(`Expected slug=source-path, received: ${entry}`)
  return [entry.slice(0, separator), entry.slice(separator + 1)]
})

if (batchSourceArg || sourceDirArg) {
  if (!batchSourceArg || !sourceDirArg || explicitEntries.length) {
    throw new Error('Batch mode requires --batch-source=<json> and --source-dir=<directory> without slug=path entries')
  }
  const batchSource = JSON.parse(fs.readFileSync(path.resolve(batchSourceArg.slice('--batch-source='.length)), 'utf8'))
  const sourceDir = path.resolve(sourceDirArg.slice('--source-dir='.length))
  if (!Array.isArray(batchSource?.items) || !batchSource.items.length) throw new Error('Batch source must contain items')
  for (const item of batchSource.items) {
    const slug = String(item.slug ?? '')
    entries.push([slug, path.join(sourceDir, `${slug}.webp`)])
  }
}

if (!entries.length) throw new Error('Pass at least one slug=source-path pair')
if (new Set(entries.map(([slug]) => slug)).size !== entries.length) throw new Error('Portrait slugs must be unique')
fs.mkdirSync(OUTPUT, { recursive: true })

for (const [slug, source] of entries) {
  if (!/^[a-z0-9-]+$/.test(slug)) throw new Error(`Invalid slug: ${slug}`)
  if (!fs.existsSync(source)) throw new Error(`Source image is missing: ${source}`)
  const output = path.join(OUTPUT, `${slug}.webp`)
  await sharp(source)
    .resize(1024, 1536, { fit: 'cover', position: 'attention' })
    .webp({ quality: 84, effort: 5 })
    .toFile(output)
  const meta = await sharp(output).metadata()
  if (meta.width !== 1024 || meta.height !== 1536 || meta.format !== 'webp') throw new Error(`Invalid output: ${output}`)
  console.log(`${slug}: ${fs.statSync(output).size} bytes`)
}

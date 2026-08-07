import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import sharp from 'sharp'

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..')
const OUTPUT = path.join(ROOT, 'public', 'images', 'characters', 'portraits')
const entries = process.argv.slice(2).map((entry) => {
  const separator = entry.indexOf('=')
  if (separator < 1) throw new Error(`Expected slug=source-path, received: ${entry}`)
  return [entry.slice(0, separator), entry.slice(separator + 1)]
})

if (!entries.length) throw new Error('Pass at least one slug=source-path pair')
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


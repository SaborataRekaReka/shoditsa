import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import sharp from 'sharp'

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..')
const source = process.argv[2]

if (!source) throw new Error('Pass the generated cover source path')
if (!fs.existsSync(source)) throw new Error(`Source image is missing: ${source}`)

const outputs = [
  path.join(ROOT, 'public', 'images', 'category-stubs', 'character-stub.webp'),
  path.join(ROOT, 'public', 'images', 'title-posters', 'character-ticket-poster.webp'),
]

for (const output of outputs) {
  fs.mkdirSync(path.dirname(output), { recursive: true })
  await sharp(source)
    .resize(1024, 1536, { fit: 'cover', position: 'attention' })
    .webp({ quality: 86, effort: 5 })
    .toFile(output)

  const meta = await sharp(output).metadata()
  if (meta.width !== 1024 || meta.height !== 1536 || meta.format !== 'webp') {
    throw new Error(`Invalid output: ${output}`)
  }
  console.log(`${path.relative(ROOT, output)}: ${fs.statSync(output).size} bytes`)
}

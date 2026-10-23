import { readFile, writeFile, mkdir } from 'node:fs/promises'
import { createHash } from 'node:crypto'
import { resolve, basename } from 'node:path'
import sharp from 'sharp'

const source = resolve(process.argv[2] ?? '')
if (!process.argv[2]) throw new Error('Pass the approved mascot pack directory')
const manifest = JSON.parse(await readFile(resolve(source, 'manifest.json'), 'utf8'))
if (manifest.entries.length !== 120 || manifest.entries.some(entry => !entry.ready)) throw new Error('Expected the complete approved 120-image pack')
const output = resolve('public/images/diagnoses/mascot-v1')
const qa = resolve('.tmp/diagnosis-mascot-release')
await mkdir(output, { recursive: true })
await mkdir(qa, { recursive: true })
const hash = data => createHash('sha256').update(data).digest('hex')
const mapping = {}
const audit = []
for (const entry of [...manifest.entries].sort((a, b) => a.id.localeCompare(b.id))) {
  if (!/^dx_[a-z0-9_]+$/.test(entry.id) || mapping[entry.id]) throw new Error('Invalid or duplicate ID: ' + entry.id)
  const selected = basename(entry.image)
  const original = await readFile(resolve(source, 'assets', selected))
  // Web delivery export only: preserve the selected artwork and its alpha.
  const data = await sharp(original).resize(512, 512, { fit: 'inside', withoutEnlargement: true }).webp({ quality: 90, alphaQuality: 100, effort: 6 }).toBuffer()
  const metadata = await sharp(data).metadata()
  if (metadata.width !== 512 || metadata.height !== 512 || !metadata.hasAlpha) throw new Error('Invalid web export: ' + entry.id)
  const sha256 = hash(data)
  const file = entry.id + '.' + sha256.slice(0, 12) + '.webp'
  await writeFile(resolve(output, file), data)
  mapping[entry.id] = file
  audit.push({ id: entry.id, selected, sourceSha256: hash(original), file, sha256, bytes: data.length, width: metadata.width, height: metadata.height, hasAlpha: metadata.hasAlpha })
}
await writeFile('apps/web/src/components/title-poster/diagnosis-artwork.json', JSON.stringify(mapping, null, 2) + '\n')
await writeFile(resolve(qa, 'asset-export.json'), JSON.stringify({ count: audit.length, totalBytes: audit.reduce((sum, item) => sum + item.bytes, 0), entries: audit }, null, 2) + '\n')
console.log(JSON.stringify({ count: audit.length, totalBytes: audit.reduce((sum, item) => sum + item.bytes, 0), ptsd: audit.find(item => item.id === 'dx_post_traumatic_stress_disorder') }))

import { readFile, writeFile, mkdir } from 'node:fs/promises'
import { createHash } from 'node:crypto'
import { resolve, basename } from 'node:path'
import sharp from 'sharp'

const source = resolve(process.argv[2] ?? '')
if (!process.argv[2]) throw new Error('Pass the approved mascot pack directory')
const manifest = JSON.parse(await readFile(resolve(source, 'manifest.json'), 'utf8'))
const expected = Number(process.argv[3] ?? 120)
if (!Number.isInteger(expected) || expected < 1 || manifest.entries.length !== expected || manifest.entries.some(entry => !entry.ready)) throw new Error('Expected a complete ' + expected + '-image pack')
const output = resolve('public/images/diagnoses/mascot-v1')
const qa = resolve(process.argv[4] ?? '.tmp/diagnosis-mascot-release')
await mkdir(output, { recursive: true })
await mkdir(qa, { recursive: true })
const hash = data => createHash('sha256').update(data).digest('hex')
const mappingPath = 'apps/web/src/components/title-poster/diagnosis-artwork.json'
const mapping = JSON.parse(await readFile(mappingPath, 'utf8'))
const seen = new Set()
const audit = []
for (const entry of [...manifest.entries].sort((a, b) => a.id.localeCompare(b.id))) {
  if (!/^dx_[a-z0-9_]+$/.test(entry.id) || seen.has(entry.id)) throw new Error('Invalid or duplicate ID: ' + entry.id)
  seen.add(entry.id)
  const selected = basename(entry.image)
  const original = await readFile(resolve(source, 'assets', selected))
  // Web delivery export only: preserve the selected artwork and its alpha.
  const data = await sharp(original).resize(512, 512, { fit: 'inside', withoutEnlargement: true }).webp({ quality: 90, alphaQuality: 100, effort: 6 }).toBuffer()
  const metadata = await sharp(data).metadata()
  if (metadata.width !== 512 || metadata.height !== 512 || !metadata.hasAlpha) throw new Error('Invalid web export: ' + entry.id)
  const sha256 = hash(data)
  const file = entry.id + '.' + sha256.slice(0, 12) + '.webp'
  if (mapping[entry.id] && mapping[entry.id] !== file) throw new Error('Refusing to replace published artwork: ' + entry.id)
  try {
    await writeFile(resolve(output, file), data, { flag: 'wx' })
  } catch (error) {
    if (error.code !== 'EEXIST' || hash(await readFile(resolve(output, file))) !== sha256) throw error
  }
  mapping[entry.id] = file
  audit.push({ id: entry.id, selected, sourceSha256: hash(original), file, sha256, bytes: data.length, width: metadata.width, height: metadata.height, hasAlpha: metadata.hasAlpha })
}
await writeFile(mappingPath, JSON.stringify(Object.fromEntries(Object.entries(mapping).sort(([a], [b]) => a.localeCompare(b))), null, 2) + '\n')
await writeFile(resolve(qa, 'asset-export.json'), JSON.stringify({ count: audit.length, totalBytes: audit.reduce((sum, item) => sum + item.bytes, 0), entries: audit }, null, 2) + '\n')
console.log(JSON.stringify({ exported: audit.length, published: Object.keys(mapping).length, totalBytes: audit.reduce((sum, item) => sum + item.bytes, 0) }))

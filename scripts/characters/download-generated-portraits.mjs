import fs from 'node:fs/promises'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import sharp from 'sharp'

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..')
const outputDir = path.resolve(process.argv[2] ?? path.join(ROOT, '.tmp', 'character-expansion-330-originals'))
const sourceFile = path.join(ROOT, 'data', 'characters', 'seeds', 'characters.expansion330.json')
const EXPECTED = 330

const source = JSON.parse(await fs.readFile(sourceFile, 'utf8'))
if (source?.batchId !== 'character-expansion-330' || !Array.isArray(source.items) || source.items.length !== EXPECTED) {
  throw new Error('Expansion source must contain the 330-character batch')
}

const portraitIds = source.items.map((item) => String(item.id).replace(/^character:/, ''))
if (new Set(portraitIds).size !== EXPECTED || portraitIds.some((id) => !/^[a-z0-9-]+$/.test(id))) throw new Error('Expansion portrait ids are invalid or duplicated')

const resolvedRoot = `${path.resolve(ROOT)}${path.sep}`
if (!outputDir.startsWith(resolvedRoot)) throw new Error(`Output directory must stay inside the workspace: ${outputDir}`)
await fs.mkdir(outputDir, { recursive: true })

let nextIndex = 0
await Promise.all(Array.from({ length: 10 }, async () => {
  while (nextIndex < portraitIds.length) {
    const index = nextIndex
    nextIndex += 1
    const portraitId = portraitIds[index]
    const manifestUrl = new URL(`/media/admin/portrait-batches/character-expansion-330/${portraitId}.json`, 'https://shoditsa.ru')
    const manifestResponse = await fetch(manifestUrl)
    if (!manifestResponse.ok) throw new Error(`${portraitId}: manifest download failed with HTTP ${manifestResponse.status}`)
    const manifest = await manifestResponse.json()
    if (manifest?.batchId !== 'character-expansion-330' || manifest?.portraitId !== portraitId || manifest?.model !== 'gpt-image-2' || typeof manifest?.url !== 'string' || !manifest.url.startsWith('/media/admin/')) {
      throw new Error(`${portraitId}: generated portrait manifest is invalid`)
    }
    const response = await fetch(new URL(manifest.url, 'https://shoditsa.ru'))
    if (!response.ok) throw new Error(`${portraitId}: download failed with HTTP ${response.status}`)
    const bytes = Buffer.from(await response.arrayBuffer())
    const metadata = await sharp(bytes).metadata()
    if (metadata.format !== 'webp' || metadata.width !== 1024 || metadata.height !== 1536) {
      throw new Error(`${portraitId}: expected 1024x1536 WebP, received ${metadata.width}x${metadata.height} ${metadata.format}`)
    }
    const target = path.join(outputDir, `${portraitId}.webp`)
    await fs.writeFile(target, bytes)
  }
}))

const downloaded = (await fs.readdir(outputDir)).filter((file) => file.endsWith('.webp'))
if (downloaded.length !== EXPECTED) throw new Error(`Expected ${EXPECTED} downloaded WebPs, found ${downloaded.length}`)
console.log(`Downloaded and technically validated ${downloaded.length} portraits to ${path.relative(ROOT, outputDir)}`)

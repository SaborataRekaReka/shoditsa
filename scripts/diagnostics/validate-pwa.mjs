import { readFile } from 'node:fs/promises'
import { resolve } from 'node:path'
import sharp from 'sharp'

const root = resolve(process.argv[2] || 'dist')
const manifest = JSON.parse(await readFile(resolve(root, 'manifest.webmanifest'), 'utf8'))
const html = await readFile(resolve(root, 'index.html'), 'utf8')
if (!html.includes('rel="manifest" href="/manifest.webmanifest"')) throw new Error('Production HTML must link to the PWA manifest')
if (manifest.id !== '/' || manifest.scope !== '/' || manifest.start_url !== '/' || manifest.display !== 'standalone') throw new Error('PWA identity, scope and standalone launch must remain stable')
for (const size of [192, 512]) {
  if (!manifest.icons.some(icon => icon.sizes === `${size}x${size}` && icon.purpose === 'any')) throw new Error(`Missing ${size}px installation icon`)
}
if (!manifest.icons.some(icon => icon.purpose === 'maskable')) throw new Error('Missing maskable icon')
for (const icon of manifest.icons) {
  const metadata = await sharp(resolve(root, icon.src.replace(/^\//, ''))).metadata()
  if (`${metadata.width}x${metadata.height}` !== icon.sizes || metadata.format !== 'png') throw new Error(`Invalid icon: ${icon.src}`)
}
const offline = await readFile(resolve(root, 'offline.html'), 'utf8')
if (!offline.includes('noindex') || /<script[^>]+src=|<link[^>]+stylesheet/.test(offline)) throw new Error('Offline fallback must be self-contained and excluded from indexing')
await readFile(resolve(root, 'sw.js'), 'utf8')
console.log('PWA: standalone manifest, regular and maskable icons, service worker and offline fallback verified.')

import assert from 'node:assert/strict'
import { createHash } from 'node:crypto'
import { execFileSync } from 'node:child_process'
import { readFile, readdir, writeFile, stat, access } from 'node:fs/promises'
import { resolve, join, relative } from 'node:path'

const root = resolve('.')
const release = resolve(process.argv[2] ?? 'var/releases/radix-themes-2026-10-21-rc5')
const web = join(release, 'web')
const digest = data => createHash('sha256').update(data).digest('hex')
const exists = async path => { try { await access(path); return true } catch { return false } }
async function files(directory) {
  const result = []
  for (const entry of await readdir(directory, { withFileTypes: true })) {
    const path = join(directory, entry.name)
    if (entry.isDirectory()) result.push(...await files(path))
    else if (entry.isFile()) result.push(path)
  }
  return result.sort()
}

assert.ok(!(await exists(join(web, 'data'))), 'Do not ship raw answer catalogues')
assert.ok(!(await exists(join(web, 'city-content'))), 'Do not ship city answer data')
const index = await readFile(join(web, 'index.html'), 'utf8')
assert.ok(index.includes('data-quest-skin="shoditsa"'))
assert.ok(index.includes('class="public-static-page"'))
assert.ok(!index.includes('<script src="/sdk.js"></script>'))
assert.ok(!index.includes('name="theme-color" content="#2b060a"'))
const build = JSON.parse(await readFile(join(web, 'build-manifest.json'), 'utf8'))
for (const mode of build.playableModes) {
  const html = await readFile(join(web, 'seo', 'games', `${mode}.html`), 'utf8')
  assert.ok(html.includes('public-static-art--light') && html.includes('public-static-art--dark'), `${mode} static artwork`)
  assert.ok(!/class="(?:admit-ticket|concert-ticket|med-chart)/.test(html), `${mode} old static composition`)
}
const nightCategories = ['movie', 'series', 'anime', 'game', 'city', 'music', 'diagnosis', 'animal', 'book', 'character', 'associations', 'yes-no', 'anime-hero', 'sleeping-cat']
const nightAssets = [...nightCategories.map(name => `images/home-doodle/dark/${name}-v1.webp`), ...['corporate-hero', 'format-team', 'format-comms', 'format-event'].map(name => `images/corporate/dark/${name}-v1.webp`), 'images/home-doodle/dark/together-v1.svg']
for (const path of [...nightAssets, 'fonts/quest-study/nunito-variable.ttf', 'fonts/reference/manrope-variable.ttf', 'fonts/reference/caveat-bold.ttf']) assert.ok((await stat(join(web, path))).size > 100, `Missing asset ${path}`)
const webFiles = await files(web)
const webManifest = []
for (const path of webFiles) webManifest.push(`${digest(await readFile(path))}  ${relative(web, path).replaceAll('\\', '/')}`)
await writeFile(join(release, 'web-files.sha256'), `${webManifest.join('\n')}\n`)
const jsFiles = webFiles.filter(path => path.endsWith('.js'))
for (const path of jsFiles) assert.ok(!/QA_FIXTURE_NOT_IMPLEMENTED|reference_qa_scenario|visual@example\.test/.test(await readFile(path, 'utf8')), `QA harness leaked into ${path}`)
const sourceNames = execFileSync('git', ['ls-files', '-z', '--cached', '--others', '--exclude-standard', '--', 'apps/web', 'apps/api/src', 'packages', 'scripts', 'infra', '.github/workflows', 'package.json', 'package-lock.json', 'compose.production.yml'], { encoding: 'utf8' }).split('\0').filter(Boolean)
const sourceManifest = []
for (const name of [...new Set(sourceNames)].sort()) {
  const path = resolve(root, name)
  if (!(await exists(path)) || !(await stat(path)).isFile()) continue
  sourceManifest.push(`${digest(await readFile(path))}  ${name}`)
}
await writeFile(join(release, 'source-files.sha256'), `${sourceManifest.join('\n')}\n`)
const manifest = {
  candidate: relative(root, release).replaceAll('\\', '/'), build,
  sourceIsWorkingTree: true, sourceFingerprint: digest(sourceManifest.join('\n')),
  webFiles: webFiles.length, webBytes: (await Promise.all(webFiles.map(path => stat(path)))).reduce((sum, item) => sum + item.size, 0),
  webFileManifestSha256: digest(webManifest.join('\n')), nightArtworkFiles: nightAssets.length,
  checks: { rawAnswerDataAbsent: true, yandexSdkAbsent: true, qaHarnessAbsent: true, currentStaticFallback: true, allModeStaticArtworkThemes: true },
  runtime: 'Node.js 24.14.1', activation: 'not performed',
  releaseRequirement: 'Deploy API and worker with web through the full release workflow; production /api/v1/leaderboard was 404 during the read-only preflight.',
}
await writeFile(join(release, 'release-manifest.json'), JSON.stringify(manifest, null, 2))
console.log(JSON.stringify({ candidate: manifest.candidate, files: manifest.webFiles, bytes: manifest.webBytes, nightArtworkFiles: manifest.nightArtworkFiles, sourceFingerprint: manifest.sourceFingerprint, checks: manifest.checks }))

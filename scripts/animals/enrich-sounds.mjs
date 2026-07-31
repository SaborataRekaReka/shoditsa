import { access, mkdir, readFile, readdir, rename, stat, unlink, writeFile } from 'node:fs/promises'
import { spawn } from 'node:child_process'
import { createHash } from 'node:crypto'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..')
const args = Object.fromEntries(process.argv.slice(2).map((argument) => {
  const [key, ...rest] = argument.replace(/^--/, '').split('=')
  return [key, rest.length ? rest.join('=') : true]
}))
const itemsPath = path.resolve(root, String(args.items || 'public/data/libraries/animals/items.json'))
const manifestPath = path.resolve(root, String(args.manifest || 'data/animals/media/sounds-manifest.json'))
const outputDirectory = path.resolve(root, String(args.output || 'public/audio/animals'))
const temporaryDirectory = path.resolve(root, '.tmp/animal-media/sound-sources')
const offset = Math.max(0, Number(args.offset || 0))
const limit = Math.max(0, Number(args.limit || Number.MAX_SAFE_INTEGER))
const force = ['1', 'true', 'yes'].includes(String(args.force || '').toLowerCase())
const userAgent = 'ShoditsaAnimalMedia/1.0 (+https://shoditsa.ru)'
const allowedLicenseCodes = new Set(['cc0', 'cc-by', 'cc-by-sa'])

const readJson = async (file) => JSON.parse(await readFile(file, 'utf8'))
const fileExists = async (file) => {
  try {
    await access(file)
    return true
  } catch {
    return false
  }
}
const writeJson = async (file, value) => {
  await mkdir(path.dirname(file), { recursive: true })
  const temporary = `${file}.tmp`
  await writeFile(temporary, `${JSON.stringify(value, null, 2)}\n`, 'utf8')
  await unlink(file).catch(() => {})
  await import('node:fs/promises').then(({ rename }) => rename(temporary, file))
}
const sleep = (milliseconds) => new Promise((resolve) => setTimeout(resolve, milliseconds))
const slug = (id) => String(id).replace(/^animal:/, '').toLowerCase().replace(/[^a-z0-9-]+/g, '-').replace(/^-|-$/g, '')
const clean = (value) => String(value ?? '').replace(/<[^>]*>/g, ' ').replace(/\s+/g, ' ').trim()
const acceptedLicenseName = (value) => {
  const normalized = clean(value)
  return /public domain|cc0|cc by/i.test(normalized) && !/\bnc\b|\bnd\b|noncommercial|no derivatives|all rights reserved/i.test(normalized)
}
const licenseName = (code) => ({
  cc0: 'CC0',
  'cc-by': 'CC BY',
  'cc-by-sa': 'CC BY-SA',
})[String(code).toLowerCase()] ?? String(code).toUpperCase()
const licenseUrl = (code) => ({
  cc0: 'https://creativecommons.org/publicdomain/zero/1.0/',
  'cc-by': 'https://creativecommons.org/licenses/by/4.0/',
  'cc-by-sa': 'https://creativecommons.org/licenses/by-sa/4.0/',
})[String(code).toLowerCase()] ?? null

const fetchJson = async (url, label) => {
  const response = await fetch(url, { headers: { 'User-Agent': userAgent, Accept: 'application/json' }, signal: AbortSignal.timeout(45_000) })
  if (!response.ok) throw new Error(`${label}: HTTP ${response.status}`)
  return response.json()
}

const existingCandidate = (item) => {
  if (!item.soundUrl || !acceptedLicenseName(item.soundAttribution?.license)) return []
  return [{
    source: 'Wikimedia Commons',
    fileUrl: item.soundUrl,
    mimeType: null,
    sourcePageUrl: item.soundAttribution?.sourcePageUrl ?? item.soundUrl,
    author: item.soundAttribution?.author ?? '',
    credit: item.soundAttribution?.credit ?? '',
    license: item.soundAttribution?.license,
    licenseUrl: item.soundAttribution?.licenseUrl ?? null,
    attributionRequired: Boolean(item.soundAttribution?.attributionRequired),
    soundType: item.soundType || 'animal-vocalization',
    confidence: 1,
  }]
}

const iNaturalistCandidates = async (item) => {
  const query = new URLSearchParams({
    taxon_name: item.scientificName || item.titleOriginal,
    quality_grade: 'research',
    sounds: 'true',
    sound_license: 'cc0,cc-by,cc-by-sa',
    captive: 'false',
    per_page: '20',
    order_by: 'votes',
    order: 'desc',
  })
  const payload = await fetchJson(`https://api.inaturalist.org/v1/observations?${query}`, `iNaturalist ${item.id}`)
  const expectedName = clean(item.scientificName || item.titleOriginal).toLowerCase()
  const candidates = []
  for (const observation of payload.results ?? []) {
    const observedName = clean(observation.taxon?.name).toLowerCase()
    for (const sound of observation.sounds ?? []) {
      const code = String(sound.license_code || '').toLowerCase()
      if (!sound.file_url || sound.hidden || !allowedLicenseCodes.has(code)) continue
      candidates.push({
        source: 'iNaturalist',
        fileUrl: sound.file_url,
        mimeType: sound.file_content_type ?? null,
        sourcePageUrl: observation.uri || `https://www.inaturalist.org/observations/${observation.id}`,
        author: clean(observation.user?.name || observation.user?.login),
        credit: clean(sound.attribution),
        license: licenseName(code),
        licenseUrl: licenseUrl(code),
        attributionRequired: code !== 'cc0',
        soundType: 'animal-vocalization',
        confidence: observedName === expectedName ? 0.95 : 0.8,
        observationId: observation.id,
        observedScientificName: observation.taxon?.name ?? null,
        votes: Number(observation.num_identification_agreements ?? 0),
      })
    }
  }
  return candidates.sort((left, right) => (
    Number(right.observedScientificName?.toLowerCase() === expectedName) - Number(left.observedScientificName?.toLowerCase() === expectedName)
    || right.votes - left.votes
  ))
}

const commonsCandidates = async (item) => {
  const scientificName = clean(item.scientificName || item.titleOriginal)
  const query = new URLSearchParams({
    action: 'query',
    format: 'json',
    generator: 'search',
    gsrsearch: `"${scientificName}" filetype:audio`,
    gsrnamespace: '6',
    gsrlimit: '10',
    prop: 'imageinfo',
    iiprop: 'url|mime|mediatype|extmetadata',
    iiextmetadatafilter: 'LicenseShortName|LicenseUrl|Artist|Credit|ObjectName|ImageDescription|AttributionRequired',
    iiextmetadatalanguage: 'en',
    origin: '*',
  })
  const payload = await fetchJson(`https://commons.wikimedia.org/w/api.php?${query}`, `Commons search ${item.id}`)
  const candidates = []
  for (const page of Object.values(payload.query?.pages ?? {})) {
    const info = page.imageinfo?.[0]
    if (!info || String(info.mediatype).toUpperCase() !== 'AUDIO') continue
    const metadata = Object.fromEntries(Object.entries(info.extmetadata ?? {}).map(([key, value]) => [key, value?.value ?? null]))
    const license = clean(metadata.LicenseShortName)
    const searchable = `${page.title} ${clean(metadata.ObjectName)} ${clean(metadata.ImageDescription)}`.toLowerCase()
    if (!acceptedLicenseName(license) || !searchable.includes(scientificName.toLowerCase())) continue
    candidates.push({
      source: 'Wikimedia Commons search',
      fileUrl: info.url,
      mimeType: info.mime ?? null,
      sourcePageUrl: info.descriptionurl,
      author: clean(metadata.Artist),
      credit: clean(metadata.Credit),
      license,
      licenseUrl: clean(metadata.LicenseUrl) || null,
      attributionRequired: clean(metadata.AttributionRequired).toLowerCase() === 'true',
      soundType: 'animal-vocalization',
      confidence: 0.85,
      commonsTitle: page.title,
    })
  }
  return candidates
}

const extensionFor = (candidate) => {
  const pathname = new URL(candidate.fileUrl).pathname
  const extension = path.extname(pathname).toLowerCase()
  if (extension && extension.length <= 6) return extension
  if (/wav/i.test(candidate.mimeType)) return '.wav'
  if (/mpeg|mp3/i.test(candidate.mimeType)) return '.mp3'
  if (/mp4|m4a/i.test(candidate.mimeType)) return '.m4a'
  if (/ogg/i.test(candidate.mimeType)) return '.ogg'
  return '.audio'
}

const download = async (candidate, destination) => {
  const response = await fetch(candidate.fileUrl, { headers: { 'User-Agent': userAgent, Accept: 'audio/*' }, redirect: 'follow', signal: AbortSignal.timeout(120_000) })
  if (!response.ok) throw new Error(`audio download HTTP ${response.status}`)
  const declared = Number(response.headers.get('content-length') || 0)
  if (declared > 80_000_000) throw new Error(`audio source is too large: ${declared} bytes`)
  const bytes = Buffer.from(await response.arrayBuffer())
  if (bytes.length > 80_000_000) throw new Error('audio source exceeded 80 MB')
  await mkdir(path.dirname(destination), { recursive: true })
  await writeFile(destination, bytes)
}

const run = (command, commandArgs) => new Promise((resolve, reject) => {
  const child = spawn(command, commandArgs, { cwd: root, windowsHide: true, stdio: ['ignore', 'pipe', 'pipe'] })
  let stdout = ''
  let stderr = ''
  child.stdout.on('data', (chunk) => { stdout += chunk })
  child.stderr.on('data', (chunk) => { stderr += chunk })
  child.on('error', reject)
  child.on('close', (code) => code === 0 ? resolve({ stdout, stderr }) : reject(new Error(`${command} exited ${code}: ${stderr.trim()}`)))
})

const transcode = async (source, destination) => {
  await mkdir(path.dirname(destination), { recursive: true })
  await run('ffmpeg', [
    '-y', '-hide_banner', '-loglevel', 'error',
    '-i', source,
    '-vn',
    '-map_metadata', '-1',
    '-af', 'silenceremove=start_periods=1:start_duration=0.08:start_threshold=-48dB:start_silence=0.15,loudnorm=I=-18:TP=-2:LRA=11',
    '-t', '20',
    '-ac', '1',
    '-ar', '48000',
    '-c:a', 'libopus',
    '-b:a', '48k',
    '-vbr', 'on',
    destination,
  ])
  const probe = await run('ffprobe', ['-v', 'error', '-show_entries', 'format=duration,size', '-of', 'json', destination])
  const format = JSON.parse(probe.stdout).format ?? {}
  const durationSeconds = Number(format.duration || 0)
  const outputBytes = Number(format.size || (await stat(destination)).size)
  if (!Number.isFinite(durationSeconds) || durationSeconds < 0.4) throw new Error(`transcoded sound is too short: ${durationSeconds}s`)
  return { durationSeconds: Number(durationSeconds.toFixed(3)), outputBytes }
}

const stripAudioMetadata = async (source, destination) => {
  await run('ffmpeg', [
    '-y', '-hide_banner', '-loglevel', 'error',
    '-i', source,
    '-vn',
    '-map_metadata', '-1',
    '-c:a', 'copy',
    destination,
  ])
  await unlink(source)
}

const opaqueAudioAsset = async (source) => {
  const digest = createHash('sha256').update(await readFile(source)).digest('hex').slice(0, 24)
  const destination = path.join(outputDirectory, `${digest}.ogg`)
  if (source !== destination) {
    if (await fileExists(destination)) await unlink(source)
    else await rename(source, destination)
  }
  return destination
}

const removeStaleAudioAssets = async (records) => {
  const referenced = new Set(Object.values(records)
    .filter((record) => record.status === 'ready')
    .map((record) => path.basename(record.assetUrl)))
  for (const name of await readdir(outputDirectory)) {
    if (name.endsWith('.ogg') && !referenced.has(name)) await unlink(path.join(outputDirectory, name))
  }
}

const manifestSummary = (records) => ({
  total: Object.keys(records).length,
  ready: Object.values(records).filter((record) => record.status === 'ready').length,
  notFound: Object.values(records).filter((record) => record.status === 'not-found').length,
  errors: Object.values(records).filter((record) => record.status === 'error').length,
  sources: Object.values(records).filter((record) => record.status === 'ready').reduce((counts, record) => {
    counts[record.source] = (counts[record.source] ?? 0) + 1
    return counts
  }, {}),
})

const saveManifest = async (records) => writeJson(manifestPath, {
  version: 1,
  generatedAt: new Date().toISOString(),
  policy: {
    licenses: ['Public domain', 'CC0', 'CC BY', 'CC BY-SA'],
    rejected: ['NC', 'ND', 'all-rights-reserved', 'unknown'],
    maximumDurationSeconds: 20,
    format: 'Ogg Opus, mono, 48 kHz, 48 kbps',
  },
  summary: manifestSummary(records),
  items: records,
})

await mkdir(outputDirectory, { recursive: true })
await mkdir(temporaryDirectory, { recursive: true })
const items = await readJson(itemsPath)
const previous = await fileExists(manifestPath) ? await readJson(manifestPath) : {}
const records = { ...(previous.items ?? {}) }
const selected = items.slice(offset, offset + limit)

for (let index = 0; index < selected.length; index += 1) {
  const item = selected[index]
  const existing = records[item.id]
  const existingTarget = existing?.assetUrl ? path.join(outputDirectory, path.basename(existing.assetUrl)) : ''
  if (!force && existing?.status === 'ready' && existingTarget && await fileExists(existingTarget)) {
    let sanitizedTarget = existingTarget
    if (!existing.metadataStripped) {
      const temporaryTarget = path.join(outputDirectory, `.metadata-${slug(item.id)}.ogg`)
      await stripAudioMetadata(existingTarget, temporaryTarget)
      sanitizedTarget = temporaryTarget
      existing.metadataStripped = true
    }
    const opaqueTarget = await opaqueAudioAsset(sanitizedTarget)
    existing.assetUrl = `/audio/animals/${path.basename(opaqueTarget)}`
    records[item.id] = existing
    console.log(`[${index + 1}/${selected.length}] skip ${item.id}`)
    continue
  }
  if (!force && existing?.status === 'not-found') {
    console.log(`[${index + 1}/${selected.length}] skip not-found ${item.id}`)
    continue
  }

  let candidates = existingCandidate(item)
  const failures = []
  try {
    if (!candidates.length) {
      candidates = await iNaturalistCandidates(item)
      await sleep(1_050)
    }
    if (!candidates.length) {
      candidates = await commonsCandidates(item)
      await sleep(300)
    }
  } catch (error) {
    failures.push(`search: ${error.message}`)
  }

  let ready = null
  for (const candidate of candidates.slice(0, 6)) {
    const source = path.join(temporaryDirectory, `${slug(item.id)}-${candidate.source.replace(/\W+/g, '-').toLowerCase()}${extensionFor(candidate)}`)
    const temporaryTarget = path.join(outputDirectory, `.building-${slug(item.id)}.ogg`)
    try {
      if (!await fileExists(source)) await download(candidate, source)
      const metrics = await transcode(source, temporaryTarget)
      const target = await opaqueAudioAsset(temporaryTarget)
      ready = {
        itemId: item.id,
        scientificName: item.scientificName || item.titleOriginal,
        status: 'ready',
        assetUrl: `/audio/animals/${path.basename(target)}`,
        soundType: candidate.soundType,
        source: candidate.source,
        sourceFileUrl: candidate.fileUrl,
        sourcePageUrl: candidate.sourcePageUrl,
        author: candidate.author,
        credit: candidate.credit,
        license: candidate.license,
        licenseUrl: candidate.licenseUrl,
        attributionRequired: candidate.attributionRequired,
        confidence: candidate.confidence,
        observationId: candidate.observationId ?? null,
        observedScientificName: candidate.observedScientificName ?? null,
        metadataStripped: true,
        metrics,
      }
      break
    } catch (error) {
      failures.push(`${candidate.source}: ${error.message}`)
    }
  }

  if (ready) {
    records[item.id] = ready
    console.log(`[${index + 1}/${selected.length}] ready ${item.id} · ${ready.source} · ${ready.metrics.durationSeconds}s`)
  } else {
    records[item.id] = {
      itemId: item.id,
      scientificName: item.scientificName || item.titleOriginal,
      status: 'not-found',
      searchedSources: ['Wikimedia Commons/Wikidata', 'iNaturalist', 'Wikimedia Commons search'],
      candidateCount: candidates.length,
      failures,
    }
    console.log(`[${index + 1}/${selected.length}] ${records[item.id].status} ${item.id}`)
  }
  await saveManifest(records)
}

await saveManifest(records)
await removeStaleAudioAssets(records)
await saveManifest(records)
console.log(JSON.stringify({ manifest: path.relative(root, manifestPath), ...manifestSummary(records) }, null, 2))

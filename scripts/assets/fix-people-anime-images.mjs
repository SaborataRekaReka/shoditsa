import fs from 'node:fs/promises'
import path from 'node:path'
import crypto from 'node:crypto'
import sharp from 'sharp'

const ROOT = process.cwd()
const LIBRARIES_ROOT = path.join(ROOT, 'public', 'data', 'libraries')
const PEOPLE_ROOT = path.join(ROOT, 'public', 'data', 'libraries', 'people', 'img')
const LEGACY_PEOPLE_ROOT = path.join(ROOT, 'data', 'libraries', 'people', 'img')
const PLACEHOLDER_SOURCE = path.join(ROOT, 'public', 'images', 'logo.svg')
const PLACEHOLDER_REL = './data/libraries/people/img/placeholder.svg'
const PLACEHOLDER_ABS = path.join(PEOPLE_ROOT, 'placeholder.svg')

const KINOPOISK_LIBRARIES = ['movies', 'series']

const CONCURRENCY = Math.max(1, Number(process.env.PEOPLE_IMG_CONCURRENCY || 10))
const TIMEOUT_MS = Math.max(3000, Number(process.env.PEOPLE_IMG_TIMEOUT_MS || 25000))
const RETRIES = Math.max(0, Number(process.env.PEOPLE_IMG_RETRIES || 2))
const MAX_HEIGHT = Math.max(120, Number(process.env.PEOPLE_IMG_MAX_HEIGHT || 300))
const WEBP_QUALITY = Math.max(1, Math.min(100, Number(process.env.PEOPLE_IMG_WEBP_QUALITY || 74)))

const REPORT_PATH = path.join(ROOT, 'tmp', 'fix-people-and-anime-images-report.json')

const cleanText = (value) => String(value ?? '').trim()

const readJson = async (filePath) => {
  const raw = await fs.readFile(filePath, 'utf8')
  return JSON.parse(raw)
}

const writeJson = async (filePath, data) => {
  await fs.mkdir(path.dirname(filePath), { recursive: true })
  await fs.writeFile(filePath, `${JSON.stringify(data, null, 2)}\n`, 'utf8')
}

const fileExists = async (filePath) => {
  try {
    await fs.access(filePath)
    return true
  } catch {
    return false
  }
}

const toPosix = (value) => value.replace(/\\/g, '/')

const hashBuffer = (buf) => crypto.createHash('sha256').update(buf).digest('hex')

const hashFile = async (filePath) => {
  const data = await fs.readFile(filePath)
  return hashBuffer(data)
}

const ensureDir = async (dirPath) => {
  await fs.mkdir(dirPath, { recursive: true })
}

const migrateLegacyPeopleDirIfNeeded = async () => {
  if (!(await fileExists(LEGACY_PEOPLE_ROOT))) return
  await ensureDir(path.dirname(PEOPLE_ROOT))
  await fs.cp(LEGACY_PEOPLE_ROOT, PEOPLE_ROOT, { recursive: true, force: true })
  await fs.rm(path.join(ROOT, 'data', 'libraries', 'people'), { recursive: true, force: true })
}

const safeRemove = async (filePath) => {
  try {
    await fs.rm(filePath)
    return true
  } catch (error) {
    if (error?.code === 'ENOENT') return true
    if (error?.code === 'EPERM' || error?.code === 'EACCES' || error?.code === 'EBUSY') return false
    throw error
  }
}

const fetchBuffer = async (url) => {
  const controller = new AbortController()
  const timer = setTimeout(() => controller.abort(), TIMEOUT_MS)
  try {
    const response = await fetch(url, {
      redirect: 'follow',
      signal: controller.signal,
      headers: {
        'user-agent': 'seans-media-fixer/1.0',
        accept: 'image/*,*/*;q=0.8',
      },
    })

    if (!response.ok) {
      throw new Error(`HTTP ${response.status}`)
    }

    const arr = await response.arrayBuffer()
    const buf = Buffer.from(arr)
    if (!buf.length) {
      throw new Error('empty response body')
    }
    return buf
  } finally {
    clearTimeout(timer)
  }
}

const downloadWithRetry = async (url) => {
  let lastError = null
  for (let attempt = 0; attempt <= RETRIES; attempt += 1) {
    try {
      return await fetchBuffer(url)
    } catch (error) {
      lastError = error
      if (attempt < RETRIES) {
        await new Promise((resolve) => setTimeout(resolve, (attempt + 1) * 250))
      }
    }
  }
  throw lastError || new Error('download failed')
}

const toOptimizedWebp = async (buffer) => {
  return sharp(buffer, { failOn: 'none' })
    .rotate()
    .resize({
      height: MAX_HEIGHT,
      fit: 'inside',
      withoutEnlargement: true,
    })
    .webp({ quality: WEBP_QUALITY, effort: 4 })
    .toBuffer()
}

const pickFileByBase = (fileNames, baseName) => {
  const matches = fileNames.filter((name) => name === `${baseName}.webp` || name === `${baseName}.svg` || name.startsWith(`${baseName}.`))
  if (!matches.length) return ''
  return [...matches].sort((a, b) => {
    const extA = path.extname(a).toLowerCase()
    const extB = path.extname(b).toLowerCase()
    const rankA = extA === '.webp' ? 1 : extA === '.svg' ? 2 : 3
    const rankB = extB === '.webp' ? 1 : extB === '.svg' ? 2 : 3
    if (rankA !== rankB) return rankA - rankB
    return a.localeCompare(b)
  })[0]
}

const processPeopleImages = async () => {
  const report = {
    libraries: {},
    uniqueSourceUrls: 0,
    downloaded: 0,
    reusedByUrl: 0,
    reusedByHash: 0,
    fallbackUsed: 0,
    failed: 0,
    relinkedPhotoUrls: 0,
  }

  if (!(await fileExists(PLACEHOLDER_ABS))) {
    await ensureDir(path.dirname(PLACEHOLDER_ABS))
    if (await fileExists(PLACEHOLDER_SOURCE)) {
      await fs.copyFile(PLACEHOLDER_SOURCE, PLACEHOLDER_ABS)
    } else {
      await fs.writeFile(PLACEHOLDER_ABS, '<svg xmlns="http://www.w3.org/2000/svg" width="300" height="300"><rect width="300" height="300" fill="#ddd"/></svg>', 'utf8')
    }
  }

  const librariesData = []
  const urlRefs = new Map()

  for (const libraryKey of KINOPOISK_LIBRARIES) {
    const itemsPath = path.join(LIBRARIES_ROOT, libraryKey, 'items.json')
    const items = await readJson(itemsPath)

    if (!Array.isArray(items)) {
      throw new Error(`Expected array in ${toPosix(path.relative(ROOT, itemsPath))}`)
    }

    let refsCount = 0
    for (let itemIndex = 0; itemIndex < items.length; itemIndex += 1) {
      const item = items[itemIndex]
      if (!String(item?.id || '').startsWith('kp_')) continue

      for (const [field, value] of Object.entries(item || {})) {
        const list = Array.isArray(value) ? value : []
        for (let personIndex = 0; personIndex < list.length; personIndex += 1) {
          const person = list[personIndex]
          if (!person || typeof person !== 'object' || Array.isArray(person)) continue
          if (!Object.prototype.hasOwnProperty.call(person, 'photoUrl')) continue
          const photoUrl = cleanText(person.photoUrl)
          if (!photoUrl || !/^https?:\/\//i.test(photoUrl)) continue

          refsCount += 1
          const refs = urlRefs.get(photoUrl) || []
          refs.push({ libraryKey, itemIndex, field, personIndex })
          urlRefs.set(photoUrl, refs)
        }
      }
    }

    report.libraries[libraryKey] = {
      totalItems: items.length,
      refsFound: refsCount,
      relinked: 0,
    }

    librariesData.push({ libraryKey, itemsPath, items })
  }

  const sourceUrls = [...urlRefs.keys()]
  report.uniqueSourceUrls = sourceUrls.length

  const localByUrl = new Map()
  const canonicalByHash = new Map()

  let cursor = 0
  const worker = async () => {
    while (true) {
      const index = cursor
      cursor += 1
      if (index >= sourceUrls.length) return

      const sourceUrl = sourceUrls[index]
      if (localByUrl.has(sourceUrl)) {
        report.reusedByUrl += 1
        continue
      }

      try {
        const downloaded = await downloadWithRetry(sourceUrl)
        const optimized = await toOptimizedWebp(downloaded)
        const hash = hashBuffer(optimized)

        let localRelPath = canonicalByHash.get(hash)
        if (!localRelPath) {
          const relPath = `./data/libraries/people/img/${hash.slice(0, 2)}/${hash}.webp`
          const absPath = path.join(PEOPLE_ROOT, hash.slice(0, 2), `${hash}.webp`)
          await ensureDir(path.dirname(absPath))
          if (!(await fileExists(absPath))) {
            await fs.writeFile(absPath, optimized)
          }
          localRelPath = relPath
          canonicalByHash.set(hash, localRelPath)
          report.downloaded += 1
        } else {
          report.reusedByHash += 1
        }

        localByUrl.set(sourceUrl, localRelPath)
      } catch (error) {
        report.failed += 1
        report.fallbackUsed += 1
        localByUrl.set(sourceUrl, PLACEHOLDER_REL)
        console.warn(`[warn] people ${sourceUrl}: ${error?.message || String(error)}`)
      }
    }
  }

  const workers = Array.from({ length: CONCURRENCY }, () => worker())
  await Promise.all(workers)

  for (const [sourceUrl, refs] of urlRefs.entries()) {
    const local = localByUrl.get(sourceUrl)
    if (!local) continue

    for (const ref of refs) {
      const lib = librariesData.find((entry) => entry.libraryKey === ref.libraryKey)
      if (!lib) continue
      const person = lib.items?.[ref.itemIndex]?.[ref.field]?.[ref.personIndex]
      if (!person) continue
      if (cleanText(person.photoUrl) === local) continue
      person.photoUrl = local
      report.relinkedPhotoUrls += 1
      report.libraries[ref.libraryKey].relinked += 1
    }
  }

  for (const lib of librariesData) {
    await writeJson(lib.itemsPath, lib.items)
  }

  return report
}

const processAnimeBackdropCleanup = async () => {
  const libraryKey = 'animes'
  const itemsPath = path.join(LIBRARIES_ROOT, libraryKey, 'items.json')
  const items = await readJson(itemsPath)

  if (!Array.isArray(items)) {
    throw new Error(`Expected array in ${toPosix(path.relative(ROOT, itemsPath))}`)
  }

  const report = {
    totalItems: items.length,
    duplicateBackdropFilesRemoved: 0,
    backdropRelinkedToPoster: 0,
    removeFailed: 0,
  }

  for (const item of items) {
    const itemId = cleanText(item?.id)
    if (!itemId.startsWith('shiki_')) continue

    const itemDir = path.join(LIBRARIES_ROOT, libraryKey, 'img', itemId)
    const fileNames = await fs.readdir(itemDir).catch((error) => {
      if (error?.code === 'ENOENT') return []
      throw error
    })

    const posterFile = pickFileByBase(fileNames, 'poster')
    const backdropFile = pickFileByBase(fileNames, 'backdrop')
    if (!posterFile || !backdropFile) continue

    const posterAbs = path.join(itemDir, posterFile)
    const backdropAbs = path.join(itemDir, backdropFile)

    const [posterHash, backdropHash] = await Promise.all([hashFile(posterAbs), hashFile(backdropAbs)])
    if (posterHash !== backdropHash) continue

    const removed = await safeRemove(backdropAbs)
    if (removed) {
      report.duplicateBackdropFilesRemoved += 1
    } else {
      report.removeFailed += 1
    }

    const posterUrl = cleanText(item.posterUrl)
    const localPoster = posterUrl || `./data/libraries/animes/img/${itemId}/${posterFile}`
    if (cleanText(item.backdropUrl) !== localPoster) {
      item.backdropUrl = localPoster
      report.backdropRelinkedToPoster += 1
    }
  }

  await writeJson(itemsPath, items)
  return report
}

const main = async () => {
  await migrateLegacyPeopleDirIfNeeded()
  const peopleReport = await processPeopleImages()
  const animeReport = await processAnimeBackdropCleanup()

  const result = {
    generatedAt: new Date().toISOString(),
    people: peopleReport,
    animeBackdropCleanup: animeReport,
  }

  await ensureDir(path.dirname(REPORT_PATH))
  await writeJson(REPORT_PATH, result)

  console.log(`[done] report: ${toPosix(path.relative(ROOT, REPORT_PATH))}`)
  console.log(JSON.stringify({
    peopleRelinked: peopleReport.relinkedPhotoUrls,
    peopleFailed: peopleReport.failed,
    animeRemovedBackdropFiles: animeReport.duplicateBackdropFilesRemoved,
    animeRemoveFailed: animeReport.removeFailed,
  }, null, 2))
}

main().catch((error) => {
  console.error(`[fatal] ${error?.stack || error?.message || String(error)}`)
  process.exitCode = 1
})

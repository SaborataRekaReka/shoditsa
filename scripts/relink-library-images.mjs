import fs from 'node:fs/promises'
import path from 'node:path'
import crypto from 'node:crypto'

const ROOT = process.cwd()
const LIBRARIES_ROOT = path.join(ROOT, 'public', 'data', 'libraries')
const LIBRARIES = ['movies', 'series', 'animes', 'games']

const cleanText = (value) => String(value ?? '').trim()

const sanitizeSegment = (value) => cleanText(value)
  .replace(/[<>:"/\\|?*\u0000-\u001F]/g, '_')
  .replace(/\s+/g, '_')
  .replace(/^\.+/, '')
  .slice(0, 120) || 'item'

const hashFile = async (filePath) => {
  const buf = await fs.readFile(filePath)
  return crypto.createHash('sha256').update(buf).digest('hex')
}

const fileExists = async (filePath) => {
  try {
    await fs.access(filePath)
    return true
  } catch {
    return false
  }
}

const listFilesSafe = async (dirPath) => {
  try {
    return await fs.readdir(dirPath)
  } catch (error) {
    if (error?.code === 'ENOENT') return []
    throw error
  }
}

const toPosix = (value) => value.replace(/\\/g, '/')

const localUrlFor = (libraryKey, itemId, fileName) => `./data/libraries/${libraryKey}/img/${itemId}/${fileName}`

const pickPreferredFile = (fileNames, baseName) => {
  const variants = fileNames.filter((name) => name === `${baseName}.webp` || name === `${baseName}.svg` || name.startsWith(`${baseName}.`))
  if (!variants.length) return ''

  const byRank = (name) => {
    const ext = path.extname(name).toLowerCase()
    if (ext === '.webp') return 1
    if (ext === '.svg') return 2
    return 3
  }

  return [...variants].sort((a, b) => {
    const rank = byRank(a) - byRank(b)
    if (rank !== 0) return rank
    return a.localeCompare(b)
  })[0]
}

const screenshotOrder = (name) => {
  const match = /^screenshot-(\d+)/i.exec(name)
  if (!match) return Number.MAX_SAFE_INTEGER
  return Number(match[1])
}

const dedupeByHashKeepingOrder = async (paths) => {
  const seen = new Set()
  const out = []

  for (const item of paths) {
    const key = `${item.libraryKey}|${item.itemId}|${item.fileName}`
    let hash = ''
    if (item.absolutePath) {
      hash = await hashFile(item.absolutePath)
    }
    const uniq = hash || key
    if (seen.has(uniq)) continue
    seen.add(uniq)
    out.push(item)
  }

  return out
}

const updateLibrary = async (libraryKey) => {
  const itemsPath = path.join(LIBRARIES_ROOT, libraryKey, 'items.json')
  const raw = await fs.readFile(itemsPath, 'utf8')
  const items = JSON.parse(raw)

  if (!Array.isArray(items)) {
    throw new Error(`Expected array in ${toPosix(path.relative(ROOT, itemsPath))}`)
  }

  const report = {
    library: libraryKey,
    totalItems: items.length,
    updatedPoster: 0,
    updatedHeader: 0,
    updatedBackdrop: 0,
    updatedScreenshots: 0,
    collapsedPosterBackdropDuplicates: 0,
  }

  for (const item of items) {
    const itemId = sanitizeSegment(item?.id)
    const itemDir = path.join(LIBRARIES_ROOT, libraryKey, 'img', itemId)
    const fileNames = await listFilesSafe(itemDir)

    if (!fileNames.length) continue

    const posterFile = pickPreferredFile(fileNames, 'poster')
    const headerFile = pickPreferredFile(fileNames, 'header')
    const backdropFile = pickPreferredFile(fileNames, 'backdrop')

    const posterPath = posterFile ? path.join(itemDir, posterFile) : ''
    const headerPath = headerFile ? path.join(itemDir, headerFile) : ''
    const backdropPath = backdropFile ? path.join(itemDir, backdropFile) : ''

    let posterUrl = posterFile ? localUrlFor(libraryKey, itemId, posterFile) : cleanText(item.posterUrl)
    let headerUrl = headerFile ? localUrlFor(libraryKey, itemId, headerFile) : cleanText(item.headerUrl)
    let backdropUrl = backdropFile ? localUrlFor(libraryKey, itemId, backdropFile) : cleanText(item.backdropUrl)

    if (posterPath && backdropPath) {
      const [posterHash, backdropHash] = await Promise.all([hashFile(posterPath), hashFile(backdropPath)])
      if (posterHash === backdropHash) {
        backdropUrl = posterUrl
        report.collapsedPosterBackdropDuplicates += 1
      }
    }

    if (posterPath && headerPath) {
      const [posterHash, headerHash] = await Promise.all([hashFile(posterPath), hashFile(headerPath)])
      if (posterHash === headerHash) {
        headerUrl = posterUrl
      }
    }

    if (backdropPath && headerPath) {
      const [backdropHash, headerHash] = await Promise.all([hashFile(backdropPath), hashFile(headerPath)])
      if (backdropHash === headerHash) {
        headerUrl = backdropUrl
      }
    }

    if (cleanText(item.posterUrl) !== posterUrl) {
      item.posterUrl = posterUrl || null
      report.updatedPoster += 1
    }

    if (cleanText(item.headerUrl) !== headerUrl) {
      item.headerUrl = headerUrl || null
      report.updatedHeader += 1
    }

    if (cleanText(item.backdropUrl) !== backdropUrl) {
      item.backdropUrl = backdropUrl || null
      report.updatedBackdrop += 1
    }

    const screenshotFiles = fileNames
      .filter((name) => /^screenshot-\d+\./i.test(name))
      .sort((a, b) => {
        const orderDiff = screenshotOrder(a) - screenshotOrder(b)
        if (orderDiff !== 0) return orderDiff
        return a.localeCompare(b)
      })

    const screenshotEntries = screenshotFiles.map((fileName) => ({
      libraryKey,
      itemId,
      fileName,
      absolutePath: path.join(itemDir, fileName),
      url: localUrlFor(libraryKey, itemId, fileName),
    }))

    if (screenshotEntries.length > 0) {
      const uniqueScreenshots = await dedupeByHashKeepingOrder(screenshotEntries)
      const nextScreenshots = uniqueScreenshots.map((entry) => entry.url)
      const prevScreenshots = Array.isArray(item.screenshots) ? item.screenshots : []
      const changed = prevScreenshots.length !== nextScreenshots.length || prevScreenshots.some((value, index) => value !== nextScreenshots[index])

      if (changed) {
        item.screenshots = nextScreenshots
        report.updatedScreenshots += 1
      }
    }
  }

  await fs.writeFile(itemsPath, `${JSON.stringify(items, null, 2)}\n`, 'utf8')
  return report
}

const main = async () => {
  const reports = []
  for (const libraryKey of LIBRARIES) {
    const report = await updateLibrary(libraryKey)
    reports.push(report)
    console.log(`[library] ${libraryKey}: poster=${report.updatedPoster} header=${report.updatedHeader} backdrop=${report.updatedBackdrop} screenshots=${report.updatedScreenshots} dedupPB=${report.collapsedPosterBackdropDuplicates}`)
  }

  const summary = {
    generatedAt: new Date().toISOString(),
    libraries: reports,
  }

  const outPath = path.join(ROOT, 'tmp', 'library-image-links-report.json')
  await fs.mkdir(path.dirname(outPath), { recursive: true })
  await fs.writeFile(outPath, `${JSON.stringify(summary, null, 2)}\n`, 'utf8')
  console.log(`[done] ${toPosix(path.relative(ROOT, outPath))}`)
}

main().catch((error) => {
  console.error(`[fatal] ${error?.stack || error?.message || String(error)}`)
  process.exitCode = 1
})

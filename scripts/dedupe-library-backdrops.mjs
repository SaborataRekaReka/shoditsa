import fs from 'node:fs/promises'
import path from 'node:path'
import crypto from 'node:crypto'

const ROOT = process.cwd()
const LIBRARIES_ROOT = path.join(ROOT, 'public', 'data', 'libraries')
const LIBRARIES = ['movies', 'series', 'animes', 'games']

const cleanText = (value) => String(value ?? '').trim()

const fileExists = async (filePath) => {
  try {
    await fs.access(filePath)
    return true
  } catch {
    return false
  }
}

const readJson = async (filePath) => {
  const raw = await fs.readFile(filePath, 'utf8')
  return JSON.parse(raw)
}

const writeJson = async (filePath, value) => {
  await fs.writeFile(filePath, `${JSON.stringify(value, null, 2)}\n`, 'utf8')
}

const pickByBase = (fileNames, baseName) => {
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

const hashFile = async (filePath) => {
  const data = await fs.readFile(filePath)
  return crypto.createHash('sha256').update(data).digest('hex')
}

const removeIfExists = async (filePath) => {
  try {
    await fs.rm(filePath)
    return true
  } catch (error) {
    if (error?.code === 'ENOENT') return true
    if (error?.code === 'EPERM' || error?.code === 'EACCES' || error?.code === 'EBUSY') return false
    throw error
  }
}

const run = async () => {
  const summary = {
    generatedAt: new Date().toISOString(),
    libraries: [],
  }

  for (const libraryKey of LIBRARIES) {
    const itemsPath = path.join(LIBRARIES_ROOT, libraryKey, 'items.json')
    const items = await readJson(itemsPath)

    if (!Array.isArray(items)) {
      throw new Error(`Expected array in ${itemsPath}`)
    }

    const report = {
      library: libraryKey,
      totalItems: items.length,
      duplicateBackdropFilesRemoved: 0,
      removeFailed: 0,
      relinkedBackdropUrlToPoster: 0,
    }

    for (const item of items) {
      const itemId = cleanText(item?.id)
      if (!itemId) continue

      const itemDir = path.join(LIBRARIES_ROOT, libraryKey, 'img', itemId)
      if (!(await fileExists(itemDir))) continue

      const fileNames = await fs.readdir(itemDir).catch((error) => {
        if (error?.code === 'ENOENT') return []
        throw error
      })

      const posterFile = pickByBase(fileNames, 'poster')
      const backdropFile = pickByBase(fileNames, 'backdrop')
      if (!posterFile || !backdropFile) continue

      const posterAbs = path.join(itemDir, posterFile)
      const backdropAbs = path.join(itemDir, backdropFile)
      const [posterHash, backdropHash] = await Promise.all([hashFile(posterAbs), hashFile(backdropAbs)])
      if (posterHash !== backdropHash) continue

      const removed = await removeIfExists(backdropAbs)
      if (removed) {
        report.duplicateBackdropFilesRemoved += 1
      } else {
        report.removeFailed += 1
      }

      const posterUrl = cleanText(item.posterUrl)
      if (posterUrl && cleanText(item.backdropUrl) !== posterUrl) {
        item.backdropUrl = posterUrl
        report.relinkedBackdropUrlToPoster += 1
      }
    }

    await writeJson(itemsPath, items)
    summary.libraries.push(report)
    console.log(`[library] ${libraryKey}: removed=${report.duplicateBackdropFilesRemoved} relinked=${report.relinkedBackdropUrlToPoster} failed=${report.removeFailed}`)
  }

  const reportPath = path.join(ROOT, 'tmp', 'dedupe-library-backdrops-report.json')
  await fs.mkdir(path.dirname(reportPath), { recursive: true })
  await fs.writeFile(reportPath, `${JSON.stringify(summary, null, 2)}\n`, 'utf8')
  console.log(`[done] tmp/dedupe-library-backdrops-report.json`)
}

run().catch((error) => {
  console.error(`[fatal] ${error?.stack || error?.message || String(error)}`)
  process.exitCode = 1
})

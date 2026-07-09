import fs from 'node:fs/promises'
import path from 'node:path'
import crypto from 'node:crypto'
import sharp from 'sharp'

const ROOT = process.cwd()
const LIBRARIES_ROOT = path.join(ROOT, 'public', 'data', 'libraries')
const LIBRARIES = ['movies', 'series', 'animes', 'games']

const MAX_HEIGHT = Number(process.env.IMG_OPT_MAX_HEIGHT || 300)
const WEBP_QUALITY = Number(process.env.IMG_OPT_WEBP_QUALITY || 74)
const WEBP_EFFORT = Number(process.env.IMG_OPT_WEBP_EFFORT || 4)
const CONCURRENCY = Math.max(1, Number(process.env.IMG_OPT_CONCURRENCY || 6))

const RASTER_EXTENSIONS = new Set(['.jpg', '.jpeg', '.png', '.webp', '.avif', '.gif', '.bmp', '.tif', '.tiff'])
const REPORT_PATH = path.join(ROOT, 'tmp', 'library-images-optimization-report.json')

const fileExists = async (filePath) => {
  try {
    await fs.access(filePath)
    return true
  } catch {
    return false
  }
}

const listFilesRecursive = async (dirPath) => {
  const out = []

  const walk = async (current) => {
    const entries = await fs.readdir(current, { withFileTypes: true })
    for (const entry of entries) {
      const entryPath = path.join(current, entry.name)
      if (entry.isDirectory()) {
        await walk(entryPath)
      } else if (entry.isFile()) {
        out.push(entryPath)
      }
    }
  }

  await walk(dirPath)
  return out
}

const sha256 = (buffer) => crypto.createHash('sha256').update(buffer).digest('hex')

const isImageFile = (filePath) => {
  const ext = path.extname(filePath).toLowerCase()
  return ext === '.svg' || RASTER_EXTENSIONS.has(ext)
}

const shouldSkipFile = (filePath) => {
  const normalized = filePath.replace(/\\/g, '/').toLowerCase()
  if (normalized.endsWith('/manifest.json')) return true
  if (normalized.endsWith('.json')) return true
  return false
}

const toWebpBuffer = async (sourcePath) => {
  const image = sharp(sourcePath, { failOn: 'none' })
  return image
    .rotate()
    .resize({
      height: MAX_HEIGHT,
      fit: 'inside',
      withoutEnlargement: true,
    })
    .webp({ quality: WEBP_QUALITY, effort: WEBP_EFFORT })
    .toBuffer()
}

const ensureParentDir = async (filePath) => {
  await fs.mkdir(path.dirname(filePath), { recursive: true })
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

const humanBytes = (bytes) => {
  if (!Number.isFinite(bytes) || bytes < 0) return '0 B'
  const units = ['B', 'KB', 'MB', 'GB']
  let value = bytes
  let index = 0
  while (value >= 1024 && index < units.length - 1) {
    value /= 1024
    index += 1
  }
  return `${value.toFixed(index === 0 ? 0 : 2)} ${units[index]}`
}

const getTotalSize = async (files) => {
  let total = 0
  for (const filePath of files) {
    try {
      const st = await fs.stat(filePath)
      total += st.size
    } catch {
      // ignore deleted files during processing
    }
  }
  return total
}

const main = async () => {
  const inputFiles = []
  for (const lib of LIBRARIES) {
    const imgRoot = path.join(LIBRARIES_ROOT, lib, 'img')
    if (!(await fileExists(imgRoot))) continue
    const files = await listFilesRecursive(imgRoot)
    for (const filePath of files) {
      if (shouldSkipFile(filePath)) continue
      if (!isImageFile(filePath)) continue
      inputFiles.push(filePath)
    }
  }

  const beforeBytes = await getTotalSize(inputFiles)

  const stats = {
    filesDiscovered: inputFiles.length,
    processed: 0,
    convertedToWebp: 0,
    deduped: 0,
    hardlinked: 0,
    copiedFromCanonical: 0,
    removedOriginals: 0,
    cleanedLegacyFiles: 0,
    skippedSvg: 0,
    failed: 0,
  }

  const canonicalByHash = new Map()
  let cursor = 0

  const processOne = async (sourcePath) => {
    const sourceExt = path.extname(sourcePath).toLowerCase()
    const isSvg = sourceExt === '.svg'
    const targetPath = isSvg
      ? sourcePath
      : path.join(path.dirname(sourcePath), `${path.basename(sourcePath, sourceExt)}.webp`)

    if (!isSvg && sourcePath !== targetPath && await fileExists(targetPath)) {
      const removed = await removeIfExists(sourcePath)
      if (removed) stats.removedOriginals += 1
      return
    }

    let buffer
    if (isSvg) {
      buffer = await fs.readFile(sourcePath)
      stats.skippedSvg += 1
    } else {
      buffer = await toWebpBuffer(sourcePath)
      stats.convertedToWebp += 1
    }

    const hash = sha256(buffer)
    const canonical = canonicalByHash.get(hash)

    if (!canonical) {
      await ensureParentDir(targetPath)
      await fs.writeFile(targetPath, buffer)
      canonicalByHash.set(hash, targetPath)

      if (!isSvg && sourcePath !== targetPath) {
        const removed = await removeIfExists(sourcePath)
        if (removed) stats.removedOriginals += 1
      }
      return
    }

    if (targetPath !== canonical) {
      const removedTarget = await removeIfExists(targetPath)
      if (!removedTarget && await fileExists(targetPath)) {
        // File is currently locked by OS/indexer; keep it as-is and skip hardlink replacement.
        return
      }
      try {
        await fs.link(canonical, targetPath)
        stats.hardlinked += 1
      } catch {
        await fs.copyFile(canonical, targetPath)
        stats.copiedFromCanonical += 1
      }
      stats.deduped += 1
    }

    if (!isSvg && sourcePath !== targetPath) {
      const removed = await removeIfExists(sourcePath)
      if (removed) stats.removedOriginals += 1
    }
  }

  const worker = async () => {
    while (true) {
      const index = cursor
      cursor += 1
      if (index >= inputFiles.length) return

      const sourcePath = inputFiles[index]
      try {
        await processOne(sourcePath)
      } catch (error) {
        stats.failed += 1
        const rel = path.relative(ROOT, sourcePath).replace(/\\/g, '/')
        console.warn(`[warn] ${rel}: ${error?.message || String(error)}`)
      } finally {
        stats.processed += 1
        if (stats.processed % 200 === 0 || stats.processed === inputFiles.length) {
          console.log(`[progress] ${stats.processed}/${inputFiles.length}`)
        }
      }
    }
  }

  const workers = Array.from({ length: CONCURRENCY }, () => worker())
  await Promise.all(workers)

  // Final cleanup: remove legacy raster source if sibling .webp already exists.
  for (const sourcePath of inputFiles) {
    const sourceExt = path.extname(sourcePath).toLowerCase()
    if (sourceExt === '.svg' || sourceExt === '.webp') continue
    const targetPath = path.join(path.dirname(sourcePath), `${path.basename(sourcePath, sourceExt)}.webp`)
    if (!(await fileExists(targetPath))) continue
    const removed = await removeIfExists(sourcePath)
    if (removed) stats.cleanedLegacyFiles += 1
  }

  const afterFiles = []
  for (const lib of LIBRARIES) {
    const imgRoot = path.join(LIBRARIES_ROOT, lib, 'img')
    if (!(await fileExists(imgRoot))) continue
    const files = await listFilesRecursive(imgRoot)
    for (const filePath of files) {
      if (shouldSkipFile(filePath)) continue
      if (!isImageFile(filePath)) continue
      afterFiles.push(filePath)
    }
  }

  const afterBytes = await getTotalSize(afterFiles)
  const savedBytes = Math.max(0, beforeBytes - afterBytes)

  const report = {
    generatedAt: new Date().toISOString(),
    settings: {
      maxHeight: MAX_HEIGHT,
      webpQuality: WEBP_QUALITY,
      webpEffort: WEBP_EFFORT,
      concurrency: CONCURRENCY,
    },
    stats,
    size: {
      beforeBytes,
      afterBytes,
      savedBytes,
      beforeHuman: humanBytes(beforeBytes),
      afterHuman: humanBytes(afterBytes),
      savedHuman: humanBytes(savedBytes),
    },
  }

  await fs.mkdir(path.dirname(REPORT_PATH), { recursive: true })
  await fs.writeFile(REPORT_PATH, `${JSON.stringify(report, null, 2)}\n`, 'utf8')

  console.log('[done]')
  console.log(JSON.stringify(report.size, null, 2))
  console.log(`Report: ${path.relative(ROOT, REPORT_PATH).replace(/\\/g, '/')}`)
}

main().catch((error) => {
  console.error(`[fatal] ${error?.stack || error?.message || String(error)}`)
  process.exitCode = 1
})

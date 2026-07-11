import fs from 'node:fs/promises'
import path from 'node:path'

const ROOT = process.cwd()
const LIBRARIES_ROOT = path.join(ROOT, 'public', 'data', 'libraries')
const PUBLIC_ROOT = path.join(ROOT, 'public')
const FALLBACK_IMAGE_PATH = path.join(PUBLIC_ROOT, 'images', 'logo.svg')

const LIBRARIES = ['movies', 'series', 'animes', 'games']
const URL_FIELDS = [
  { key: 'posterUrl', kind: 'single', fileBase: 'poster' },
  { key: 'headerUrl', kind: 'single', fileBase: 'header' },
  { key: 'backdropUrl', kind: 'single', fileBase: 'backdrop' },
  { key: 'screenshots', kind: 'array', fileBase: 'screenshot' },
]

const DEFAULT_CONCURRENCY = 10
const DEFAULT_TIMEOUT_MS = 25000
const DEFAULT_RETRIES = 2

const cleanText = (value) => String(value ?? '').trim()

const sanitizeSegment = (value) => cleanText(value)
  .replace(/[<>:"/\\|?*\u0000-\u001F]/g, '_')
  .replace(/\s+/g, '_')
  .replace(/^\.+/, '')
  .slice(0, 120) || 'item'

const extFromContentType = (contentType) => {
  const normalized = cleanText(contentType).toLowerCase().split(';')[0]
  if (normalized === 'image/jpeg' || normalized === 'image/jpg') return '.jpg'
  if (normalized === 'image/png') return '.png'
  if (normalized === 'image/webp') return '.webp'
  if (normalized === 'image/avif') return '.avif'
  if (normalized === 'image/gif') return '.gif'
  if (normalized === 'image/svg+xml') return '.svg'
  if (normalized === 'image/bmp') return '.bmp'
  if (normalized === 'image/tiff') return '.tif'
  return ''
}

const extFromUrl = (value) => {
  const raw = cleanText(value)
  if (raw.startsWith('/')) {
    const cleanPath = raw.split(/[?#]/)[0]
    const ext = path.extname(cleanPath || '').toLowerCase()
    if (ext && ext.length <= 6) return ext
    return ''
  }

  try {
    const parsed = new URL(value)
    const ext = path.extname(parsed.pathname || '').toLowerCase()
    if (ext && ext.length <= 6) return ext
    return ''
  } catch {
    return ''
  }
}

const ensureDir = async (dirPath) => {
  await fs.mkdir(dirPath, { recursive: true })
}

const fileExists = async (filePath) => {
  try {
    await fs.access(filePath)
    return true
  } catch {
    return false
  }
}

const fetchImageBuffer = async (url, timeoutMs) => {
  const controller = new AbortController()
  const timer = setTimeout(() => controller.abort(), timeoutMs)

  try {
    const response = await fetch(url, {
      redirect: 'follow',
      signal: controller.signal,
      headers: {
        'user-agent': 'seans-starter-pack-image-downloader/1.0',
        accept: 'image/*,*/*;q=0.8',
      },
    })

    if (!response.ok) {
      throw new Error(`HTTP ${response.status}`)
    }

    const contentType = response.headers.get('content-type') || ''
    const arr = await response.arrayBuffer()
    const buffer = Buffer.from(arr)

    if (!buffer.length) {
      throw new Error('Empty response body')
    }

    return {
      buffer,
      contentType,
      finalUrl: response.url || url,
    }
  } finally {
    clearTimeout(timer)
  }
}

const isHttpUrl = (value) => /^https?:\/\//i.test(cleanText(value))

const localPathFromUrl = (value) => {
  const raw = cleanText(value)
  if (!raw.startsWith('/')) return ''
  const cleanPath = raw.split(/[?#]/)[0]
  const relative = cleanPath.replace(/^\/+/, '').replace(/\//g, path.sep)
  return path.join(PUBLIC_ROOT, relative)
}

const readLocalImageBuffer = async (sourceUrl) => {
  const localPath = localPathFromUrl(sourceUrl)
  if (!localPath) {
    throw new Error(`Unsupported local image path: ${sourceUrl}`)
  }

  const buffer = await fs.readFile(localPath)
  if (!buffer.length) {
    throw new Error(`Empty local image file: ${sourceUrl}`)
  }

  return {
    buffer,
    contentType: '',
    finalUrl: sourceUrl,
  }
}

const loadImageData = async (sourceUrl, retries, timeoutMs) => {
  if (isHttpUrl(sourceUrl)) {
    return downloadWithRetry(sourceUrl, retries, timeoutMs)
  }

  if (cleanText(sourceUrl).startsWith('/')) {
    return readLocalImageBuffer(sourceUrl)
  }

  throw new Error(`Unsupported image URL format: ${sourceUrl}`)
}

const downloadWithRetry = async (url, retries, timeoutMs) => {
  let lastError = null
  for (let attempt = 0; attempt <= retries; attempt += 1) {
    try {
      return await fetchImageBuffer(url, timeoutMs)
    } catch (error) {
      lastError = error
      if (attempt < retries) {
        await new Promise((resolve) => setTimeout(resolve, 300 * (attempt + 1)))
      }
    }
  }
  throw lastError || new Error('Unknown download error')
}

const readItems = async (libraryKey) => {
  const itemsPath = path.join(LIBRARIES_ROOT, libraryKey, 'items.json')
  const raw = await fs.readFile(itemsPath, 'utf8')
  const data = JSON.parse(raw)
  if (!Array.isArray(data)) {
    throw new Error(`Expected array in ${itemsPath}`)
  }
  return data
}

const collectTasks = (libraryKey, items) => {
  const tasks = []

  for (const item of items) {
    const id = sanitizeSegment(item?.id)

    for (const field of URL_FIELDS) {
      if (field.kind === 'single') {
        const url = cleanText(item?.[field.key])
        if (!url) continue
        tasks.push({
          libraryKey,
          itemId: id,
          field: field.key,
          fileBase: field.fileBase,
          order: 0,
          url,
        })
      } else {
        const values = Array.isArray(item?.[field.key]) ? item[field.key] : []
        for (let index = 0; index < values.length; index += 1) {
          const url = cleanText(values[index])
          if (!url) continue
          tasks.push({
            libraryKey,
            itemId: id,
            field: field.key,
            fileBase: field.fileBase,
            order: index + 1,
            url,
          })
        }
      }
    }
  }

  return tasks
}

const createRunner = async ({ tasks, concurrency, retries, timeoutMs }) => {
  const total = tasks.length
  const urlCache = new Map()
  const manifestByLibrary = new Map()

  const stats = {
    total,
    downloaded: 0,
    reused: 0,
    skippedExisting: 0,
    fallbackUsed: 0,
    failed: 0,
  }

  let cursor = 0
  let finished = 0

  const registerManifest = (task, sourceUrl, outputPath) => {
    const libraryData = manifestByLibrary.get(task.libraryKey) || []
    libraryData.push({
      itemId: task.itemId,
      field: task.field,
      index: task.order,
      sourceUrl,
      output: outputPath.replaceAll('\\\\', '/'),
    })
    manifestByLibrary.set(task.libraryKey, libraryData)
  }

  const processTask = async (task) => {
    let ext = extFromUrl(task.url)
    if (!ext) ext = '.jpg'

    const folderPath = path.join(LIBRARIES_ROOT, task.libraryKey, 'img', task.itemId)
    await ensureDir(folderPath)

    const baseName = task.order > 0 ? `${task.fileBase}-${task.order}` : task.fileBase
    let outputPath = path.join(folderPath, `${baseName}${ext}`)

    if (await fileExists(outputPath)) {
      stats.skippedExisting += 1
      registerManifest(task, task.url, outputPath)
      return
    }

    const cached = urlCache.get(task.url)
    if (cached) {
      const cachedExt = cached.ext || ext
      outputPath = path.join(folderPath, `${baseName}${cachedExt}`)
      if (!(await fileExists(outputPath))) {
        await fs.copyFile(cached.filePath, outputPath)
      }
      stats.reused += 1
      registerManifest(task, task.url, outputPath)
      return
    }

    let result
    try {
      result = await loadImageData(task.url, retries, timeoutMs)
    } catch {
      if (await fileExists(FALLBACK_IMAGE_PATH)) {
        const fallbackOutput = path.join(folderPath, `${baseName}.svg`)
        if (!(await fileExists(fallbackOutput))) {
          await fs.copyFile(FALLBACK_IMAGE_PATH, fallbackOutput)
        }
        stats.fallbackUsed += 1
        registerManifest(task, task.url, fallbackOutput)
        return
      }
      throw new Error(`Source unavailable and fallback missing: ${task.url}`)
    }

    const extFromType = extFromContentType(result.contentType)
    const finalExt = extFromType || extFromUrl(result.finalUrl) || ext
    outputPath = path.join(folderPath, `${baseName}${finalExt}`)

    await fs.writeFile(outputPath, result.buffer)
    urlCache.set(task.url, {
      filePath: outputPath,
      ext: finalExt,
    })

    stats.downloaded += 1
    registerManifest(task, task.url, outputPath)
  }

  const worker = async () => {
    while (true) {
      const currentIndex = cursor
      cursor += 1
      if (currentIndex >= total) return

      const task = tasks[currentIndex]
      try {
        await processTask(task)
      } catch (error) {
        stats.failed += 1
        const message = cleanText(error?.message || String(error))
        console.warn(`[warn] ${task.libraryKey}/${task.itemId}/${task.field}/${task.order}: ${message}`)
      } finally {
        finished += 1
        if (finished % 100 === 0 || finished === total) {
          console.log(`[progress] ${finished}/${total} | downloaded=${stats.downloaded} reused=${stats.reused} skipped=${stats.skippedExisting} failed=${stats.failed}`)
        }
      }
    }
  }

  const workers = Array.from({ length: Math.max(1, concurrency) }, () => worker())
  await Promise.all(workers)

  return {
    stats,
    manifestByLibrary,
  }
}

const saveManifests = async (manifestByLibrary) => {
  for (const [libraryKey, entries] of manifestByLibrary.entries()) {
    const targetPath = path.join(LIBRARIES_ROOT, libraryKey, 'img', 'manifest.json')
    await ensureDir(path.dirname(targetPath))
    const payload = {
      generatedAt: new Date().toISOString(),
      count: entries.length,
      entries,
    }
    await fs.writeFile(targetPath, `${JSON.stringify(payload, null, 2)}\n`, 'utf8')
  }
}

const main = async () => {
  const concurrency = Number(process.env.IMG_DL_CONCURRENCY || DEFAULT_CONCURRENCY)
  const retries = Number(process.env.IMG_DL_RETRIES || DEFAULT_RETRIES)
  const timeoutMs = Number(process.env.IMG_DL_TIMEOUT_MS || DEFAULT_TIMEOUT_MS)
  const failOnMissing = process.env.IMG_DL_FAIL_ON_MISSING === '1'

  console.log(`[start] libraries=${LIBRARIES.join(', ')} concurrency=${concurrency} retries=${retries} timeoutMs=${timeoutMs}`)

  let tasks = []
  for (const libraryKey of LIBRARIES) {
    const items = await readItems(libraryKey)
    const libraryTasks = collectTasks(libraryKey, items)
    tasks = tasks.concat(libraryTasks)
    console.log(`[scan] ${libraryKey}: items=${items.length}, imageRefs=${libraryTasks.length}`)
  }

  const { stats, manifestByLibrary } = await createRunner({
    tasks,
    concurrency,
    retries,
    timeoutMs,
  })

  await saveManifests(manifestByLibrary)

  console.log('[done]')
  console.log(JSON.stringify(stats, null, 2))

  if (stats.failed > 0 && failOnMissing) {
    process.exitCode = 2
  }
}

main().catch((error) => {
  console.error(`[fatal] ${error?.stack || error?.message || String(error)}`)
  process.exitCode = 1
})

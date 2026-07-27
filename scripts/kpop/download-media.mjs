#!/usr/bin/env node

import { mkdir, readFile, rename, stat, unlink, writeFile } from 'node:fs/promises'
import { dirname, resolve } from 'node:path'
import sharp from 'sharp'
import { artistPhotoFileName, labelLogoFileName } from './build-special.mjs'

const text = (value) => typeof value === 'string' ? value.trim() : ''
const argValue = (args, name, fallback) => {
  const prefix = `--${name}=`
  return args.find((arg) => arg.startsWith(prefix))?.slice(prefix.length) ?? fallback
}
const hasFlag = (args, name) => args.includes(`--${name}`)

const thumbnailUrl = (sourceUrl, width) => {
  const url = new URL(sourceUrl)
  if (url.hostname !== 'static.wikia.nocookie.net') return url.href
  url.pathname = url.pathname.replace(
    /\/revision\/latest(?:\/scale-to-width-down\/\d+)?$/,
    `/revision/latest/scale-to-width-down/${width}`,
  )
  return url.href
}

const fetchImage = async (url, attempts = 3) => {
  let lastError = null
  for (let attempt = 1; attempt <= attempts; attempt += 1) {
    try {
      const response = await fetch(url, {
        headers: {
          Accept: 'image/avif,image/webp,image/png,image/jpeg,*/*;q=0.8',
          'User-Agent': 'Shoditsa-Kpop-Media-Importer/1.0',
        },
        signal: AbortSignal.timeout(30_000),
      })
      if (!response.ok) throw new Error(`HTTP ${response.status}`)
      const contentType = response.headers.get('content-type') ?? ''
      if (!contentType.toLowerCase().startsWith('image/')) {
        throw new Error(`Unexpected content type: ${contentType || 'missing'}`)
      }
      return Buffer.from(await response.arrayBuffer())
    } catch (error) {
      lastError = error
      if (attempt < attempts) await new Promise((resolveDelay) => setTimeout(resolveDelay, 350 * attempt))
    }
  }
  throw lastError
}

const optimizeImage = async (input, kind) => {
  const size = kind === 'artist' ? { width: 640, height: 800 } : { width: 256, height: 256 }
  return sharp(input)
    .rotate()
    .resize({ ...size, fit: 'inside', withoutEnlargement: true })
    .webp({ quality: kind === 'artist' ? 82 : 90, effort: 4, smartSubsample: true })
    .toBuffer()
}

const fileExists = async (path) => {
  try {
    return (await stat(path)).size > 0
  } catch {
    return false
  }
}

const writeAtomic = async (path, bytes) => {
  await mkdir(dirname(path), { recursive: true })
  const temporaryPath = `${path}.${process.pid}.tmp`
  await writeFile(temporaryPath, bytes)
  try {
    await rename(temporaryPath, path)
  } catch (error) {
    await unlink(temporaryPath).catch(() => undefined)
    throw error
  }
}

const runPool = async (tasks, concurrency, worker) => {
  let cursor = 0
  const runners = Array.from({ length: Math.min(concurrency, tasks.length) }, async () => {
    while (cursor < tasks.length) {
      const index = cursor
      cursor += 1
      await worker(tasks[index], index)
    }
  })
  await Promise.all(runners)
}

export const run = async (args = process.argv.slice(2)) => {
  const sourcePath = resolve(argValue(args, 'source', 'data/kpop/source/KPop_artists.json'))
  const publicRoot = resolve(argValue(args, 'public-root', 'public/images/kpop'))
  const force = hasFlag(args, 'force')
  const concurrency = Math.max(1, Math.min(16, Number(argValue(args, 'concurrency', '6')) || 6))
  const source = JSON.parse(await readFile(sourcePath, 'utf8'))
  if (!Array.isArray(source) || source.length === 0) throw new Error('K-pop source must be a non-empty array')

  const tasks = []
  for (const artist of source) {
    const sourceId = text(artist['ID артиста'])
    const photoUrl = text(artist['Фотография']?.['Прямая ссылка на изображение'])
    if (!sourceId || !photoUrl) throw new Error(`${sourceId || 'unknown artist'}: direct photo URL is required`)
    tasks.push({
      key: `artist:${sourceId}`,
      kind: 'artist',
      sourceUrl: thumbnailUrl(photoUrl, 800),
      targetPath: resolve(publicRoot, 'artists', artistPhotoFileName(sourceId)),
    })

    const logo = artist['Логотип текущего лейбла']
    const logoUrl = text(logo?.['Прямая ссылка на изображение'])
    const logoFileName = labelLogoFileName(logo)
    if (logoUrl && logoFileName) {
      tasks.push({
        key: `label:${logoFileName}`,
        kind: 'label',
        sourceUrl: thumbnailUrl(logoUrl, 320),
        targetPath: resolve(publicRoot, 'labels', logoFileName),
      })
    }
  }

  const uniqueTasks = [...new Map(tasks.map((task) => [task.targetPath, task])).values()]
  const report = {
    sourcePath,
    publicRoot,
    artists: source.length,
    tasks: uniqueTasks.length,
    downloaded: 0,
    skipped: 0,
    bytes: 0,
    failures: [],
  }

  await runPool(uniqueTasks, concurrency, async (task, index) => {
    if (!force && await fileExists(task.targetPath)) {
      report.skipped += 1
      return
    }
    try {
      const input = await fetchImage(task.sourceUrl)
      const output = await optimizeImage(input, task.kind)
      await writeAtomic(task.targetPath, output)
      report.downloaded += 1
      report.bytes += output.length
      if ((index + 1) % 25 === 0 || index + 1 === uniqueTasks.length) {
        console.log(`[kpop-media] ${index + 1}/${uniqueTasks.length}`)
      }
    } catch (error) {
      report.failures.push({
        key: task.key,
        url: task.sourceUrl,
        error: error instanceof Error ? error.message : String(error),
      })
    }
  })

  console.log(JSON.stringify(report, null, 2))
  if (report.failures.length) throw new Error(`Failed to download ${report.failures.length} K-pop media assets`)
  return report
}

run().catch((error) => {
  console.error(error instanceof Error ? error.stack || error.message : error)
  process.exitCode = 1
})

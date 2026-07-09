import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import archiver from 'archiver'

const __filename = fileURLToPath(import.meta.url)
const __dirname = path.dirname(__filename)
const ARCHIVE_NAME = 'dist.zip'
const FALLBACK_ARCHIVE_NAME = 'dist-yandex.zip'
const rootDir = path.resolve(__dirname, '..')
const distDir = path.join(rootDir, 'dist')
const zipPath = path.join(rootDir, ARCHIVE_NAME)
const fallbackZipPath = path.join(rootDir, FALLBACK_ARCHIVE_NAME)
const includeLibraryImages = process.env.YANDEX_PACK_INCLUDE_IMAGES === '1'

if (!fs.existsSync(distDir)) {
  throw new Error('dist directory not found. Please ensure the build has completed successfully.')
}

const appendArchiveEntries = (archive) => {
  if (includeLibraryImages) {
    archive.directory(distDir, false)
  } else {
    archive.glob('**/*', {
      cwd: distDir,
      ignore: [
        'data/libraries/movies/img/**',
        'data/libraries/series/img/**',
        'data/libraries/animes/img/**',
        'data/libraries/games/img/**',
        'data/libraries/people/img/**',
      ],
    })
  }
}

const createArchive = async (targetPath) => {
  fs.rmSync(targetPath, { force: true })

  const output = fs.createWriteStream(targetPath)
  const archive = archiver('zip', { zlib: { level: 9 } })

  const completed = new Promise((resolve, reject) => {
    output.on('close', resolve)
    output.on('error', reject)
    archive.on('warning', (err) => {
      // ENOENT warnings may occur for transiently missing metadata files and are safe to skip.
      if (err.code !== 'ENOENT') reject(err)
    })
    archive.on('error', reject)
  })

  archive.pipe(output)
  appendArchiveEntries(archive)
  archive.finalize()
  await completed
}

const isFileLockError = (error) => {
  const message = String(error?.message || '').toLowerCase()
  return error?.code === 'EPERM' || error?.errno === -4048 || message.includes('eperm') || message.includes('operation not permitted')
}

try {
  await createArchive(zipPath)
  console.log(`Created ${ARCHIVE_NAME}`)
} catch (error) {
  if (isFileLockError(error)) {
    try {
      console.warn(`${ARCHIVE_NAME} is locked, writing fallback archive ${FALLBACK_ARCHIVE_NAME} instead.`)
      await createArchive(fallbackZipPath)
      console.log(`Created ${FALLBACK_ARCHIVE_NAME}`)
    } catch (fallbackError) {
      console.error('Failed to create Yandex archive:', fallbackError)
      process.exitCode = 1
    }
  } else {
    console.error('Failed to create Yandex archive:', error)
    process.exitCode = 1
  }
}

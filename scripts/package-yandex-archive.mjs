import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import archiver from 'archiver'

const __filename = fileURLToPath(import.meta.url)
const __dirname = path.dirname(__filename)
const ARCHIVE_NAME = 'dist.zip'
const rootDir = path.resolve(__dirname, '..')
const distDir = path.join(rootDir, 'dist')
const zipPath = path.join(rootDir, ARCHIVE_NAME)

if (!fs.existsSync(distDir)) {
  throw new Error('dist directory not found. Please ensure the build has completed successfully.')
}

fs.rmSync(zipPath, { force: true })

const output = fs.createWriteStream(zipPath)
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
archive.directory(distDir, false)
archive.finalize()

try {
  await completed
} catch (error) {
  console.error('Failed to create Yandex archive:', error)
  process.exitCode = 1
}

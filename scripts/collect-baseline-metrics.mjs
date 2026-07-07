import fs from 'node:fs/promises'
import path from 'node:path'

const rootDir = process.cwd()
const distDir = path.join(rootDir, 'dist')
const assetsDir = path.join(distDir, 'assets')
const outputFile = path.join(rootDir, 'docs', 'refactor', 'baseline-metrics.json')

const bytesToKb = (value) => Number((value / 1024).toFixed(2))

const statSafe = async (target) => {
  try {
    return await fs.stat(target)
  } catch {
    return null
  }
}

const collect = async () => {
  const distStat = await statSafe(distDir)
  if (!distStat) throw new Error('dist directory does not exist. Run "npm run build" first.')

  const files = await fs.readdir(assetsDir)
  const assetStats = await Promise.all(
    files.map(async (file) => {
      const fullPath = path.join(assetsDir, file)
      const stat = await fs.stat(fullPath)
      return {
        file,
        bytes: stat.size,
        kb: bytesToKb(stat.size),
      }
    }),
  )

  const payload = {
    collectedAt: new Date().toISOString(),
    dist: {
      bytes: distStat.size,
      kb: bytesToKb(distStat.size),
    },
    assets: assetStats.sort((a, b) => b.bytes - a.bytes),
    runtimeMetricsNote: 'Runtime first-render/search/web-vitals are collected in window.__SEANS_REFACTOR_METRICS__',
  }

  await fs.writeFile(outputFile, `${JSON.stringify(payload, null, 2)}\n`, 'utf8')
  console.log(`Baseline metrics saved to ${path.relative(rootDir, outputFile)}`)
}

collect().catch((error) => {
  console.error(error)
  process.exitCode = 1
})

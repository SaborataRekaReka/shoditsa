import { mkdir, readFile, readdir, stat, writeFile } from 'node:fs/promises'
import { spawn } from 'node:child_process'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..')
const args = Object.fromEntries(process.argv.slice(2).map((argument) => {
  const [key, ...rest] = argument.replace(/^--/, '').split('=')
  return [key, rest.length ? rest.join('=') : true]
}))
const seedsSource = path.resolve(root, String(args.seeds || process.env.npm_config_seeds || 'data/animals/seeds'))
const outputDirectory = path.resolve(root, String(args.out || process.env.npm_config_out || 'data/animals/generated'))
const reportPath = path.resolve(root, String(args.report || process.env.npm_config_report || 'data/animals/generated/build-report.json'))
const concurrency = Math.max(1, Number(args.concurrency || process.env.npm_config_concurrency || 3))
const offset = Math.max(0, Number(args.offset || process.env.npm_config_offset || 0))
const limit = Math.max(1, Number(args.limit || process.env.npm_config_limit || Number.MAX_SAFE_INTEGER))
const includeInteractions = !['0', 'false', 'no'].includes(
  String(args.interactions ?? process.env.npm_config_interactions ?? 'false').toLowerCase(),
)
const skipExisting = !['0', 'false', 'no'].includes(
  String(args.skipExisting ?? process.env.npm_config_skip_existing ?? 'true').toLowerCase(),
)
await mkdir(outputDirectory, { recursive: true })

const sourceStat = await stat(seedsSource)
let seedFiles
if (sourceStat.isDirectory()) {
  seedFiles = (await readdir(seedsSource))
    .filter((name) => name.endsWith('.json'))
    .map((name) => path.join(seedsSource, name))
} else {
  const parsed = JSON.parse(await readFile(seedsSource, 'utf8'))
  const seeds = Array.isArray(parsed) ? parsed : parsed.seeds
  if (!Array.isArray(seeds)) throw new Error('Seed manifest must be an array or contain a seeds array')
  const temporarySeedDirectory = path.join(root, '.tmp', 'animal-pipeline', 'batch-seeds')
  await mkdir(temporarySeedDirectory, { recursive: true })
  seedFiles = await Promise.all(seeds.map(async (seed, index) => {
    const slug = String(seed.id || `seed-${index}`).replace(/^animal:/, '').replace(/[^a-z0-9-]+/gi, '-')
    const seedPath = path.join(temporarySeedDirectory, `${String(index).padStart(4, '0')}-${slug}.json`)
    await writeFile(seedPath, `${JSON.stringify(seed, null, 2)}\n`, 'utf8')
    return seedPath
  }))
}
seedFiles = seedFiles.slice(offset, offset + limit)
const requestedSeedCount = seedFiles.length
if (skipExisting) {
  const existingOutputs = new Set((await readdir(outputDirectory)).filter((name) => name.endsWith('.json')))
  seedFiles = seedFiles.filter((seedPath) => {
    const slug = path.basename(seedPath, '.json').replace(/^\d+-/, '')
    return !existingOutputs.has(`${slug}.json`)
  })
}

let cursor = 0
let completed = 0
const results = []
const runOne = (seedPath) => new Promise((resolve) => {
  const slug = path.basename(seedPath, '.json').replace(/^\d+-/, '')
  const outputPath = path.join(outputDirectory, `${slug}.json`)
  const child = spawn(process.execPath, [
    path.join(root, 'scripts', 'animals', 'build-animal.mjs'),
    `--seed=${seedPath}`,
    `--out=${outputPath}`,
    `--interactions=${includeInteractions}`,
  ], {
    cwd: root,
    stdio: ['ignore', 'pipe', 'pipe'],
  })
  let stdout = ''
  let stderr = ''
  child.stdout.on('data', (chunk) => { stdout += chunk })
  child.stderr.on('data', (chunk) => { stderr += chunk })
  child.on('close', (code) => resolve({
    seed: path.relative(root, seedPath),
    output: path.relative(root, outputPath),
    ok: code === 0,
    code,
    stdout: stdout.trim(),
    stderr: stderr.trim(),
  }))
})

const worker = async () => {
  while (cursor < seedFiles.length) {
    const index = cursor
    cursor += 1
    results[index] = await runOne(seedFiles[index])
    completed += 1
    if (completed % 10 === 0 || completed === seedFiles.length) {
      console.log(`Built ${completed}/${seedFiles.length}`)
    }
  }
}
await Promise.all(Array.from({ length: Math.min(concurrency, seedFiles.length) }, () => worker()))

const failures = results.filter((entry) => !entry.ok)
const report = {
  generatedAt: new Date().toISOString(),
  seedsSource: path.relative(root, seedsSource),
  requestedSeedCount,
  skippedExisting: requestedSeedCount - seedFiles.length,
  seedCount: seedFiles.length,
  succeeded: results.length - failures.length,
  failed: failures.length,
  includeInteractions,
  results,
}
await mkdir(path.dirname(reportPath), { recursive: true })
await writeFile(reportPath, `${JSON.stringify(report, null, 2)}\n`, 'utf8')
console.log(JSON.stringify({
  reportPath: path.relative(root, reportPath),
  seedCount: report.seedCount,
  skippedExisting: report.skippedExisting,
  succeeded: report.succeeded,
  failed: report.failed,
  failures: failures.map((entry) => ({ seed: entry.seed, error: entry.stderr })),
}, null, 2))
if (failures.length) process.exitCode = 1

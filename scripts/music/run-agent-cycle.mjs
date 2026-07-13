import { spawnSync } from 'node:child_process'
import path from 'node:path'

const args = process.argv.slice(2)
const maxItemsArg = args.find((arg) => arg.startsWith('--max-items='))
const maxItems = Math.max(1, Number.parseInt(maxItemsArg?.slice('--max-items='.length) ?? '5', 10) || 5)
const forwarded = args.filter((arg) => !arg.startsWith('--source=') && !arg.startsWith('--max-ai-reviews='))
const candidateSource = process.env.ENRICHMENT_DATA_ROOT
  ? path.join(path.resolve(process.env.ENRICHMENT_DATA_ROOT), 'music', 'discovery', 'discovered-candidates.json')
  : 'data/enrichment-agent/music/discovery/discovered-candidates.json'

const run = (commandArgs) => {
  const result = spawnSync(process.execPath, commandArgs, {
    cwd: process.cwd(),
    env: process.env,
    stdio: 'inherit',
  })
  if (result.status !== 0) process.exit(result.status ?? 1)
}

run([
  'scripts/enrichment-agent/run.mjs',
  'music',
  'discover',
  ...forwarded,
])

run([
  'scripts/enrichment-agent/run.mjs',
  'music',
  'run',
  `--source=${candidateSource}`,
  `--max-items=${maxItems}`,
  `--max-ai-reviews=${maxItems}`,
  ...forwarded.filter((arg) => !arg.startsWith('--max-items=')),
])

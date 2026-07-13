import { spawnSync } from 'node:child_process'
import path from 'node:path'

const args = process.argv.slice(2)
const maxItemsArg = args.find((arg) => arg.startsWith('--max-items='))
const maxItems = Math.max(1, Number.parseInt(maxItemsArg?.slice('--max-items='.length) ?? '5', 10) || 5)
const forwarded = args.filter((arg) => !arg.startsWith('--source=') && !arg.startsWith('--max-ai-reviews='))
const source = process.env.ENRICHMENT_DATA_ROOT
  ? path.join(path.resolve(process.env.ENRICHMENT_DATA_ROOT), 'anime', 'discovery', 'discovered-candidates.json')
  : 'data/enrichment-agent/anime/discovery/discovered-candidates.json'

const run = (commandArgs) => {
  const result = spawnSync(process.execPath, commandArgs, { cwd: process.cwd(), env: process.env, stdio: 'inherit' })
  if (result.status !== 0) process.exit(result.status ?? 1)
}

run(['scripts/enrichment-agent/run.mjs', 'anime', 'discover', ...forwarded])
run([
  'scripts/enrichment-agent/run.mjs', 'anime', 'run', `--source=${source}`,
  `--max-items=${maxItems}`, `--max-ai-reviews=${maxItems}`,
  ...forwarded.filter((arg) => !arg.startsWith('--max-items=')),
])

import { spawnSync } from 'node:child_process'

const args = process.argv.slice(2)
const maxItemsArg = args.find((arg) => arg.startsWith('--max-items='))
const maxItems = Math.max(1, Number.parseInt(maxItemsArg?.slice('--max-items='.length) ?? '5', 10) || 5)
const forwarded = args.filter((arg) => !arg.startsWith('--source=') && !arg.startsWith('--max-ai-reviews='))
const candidateSource = 'data/enrichment-agent/music/discovery/discovered-candidates.json'

const run = (commandArgs) => {
  const result = spawnSync(process.execPath, commandArgs, {
    cwd: process.cwd(),
    env: process.env,
    stdio: 'inherit',
  })
  if (result.status !== 0) process.exit(result.status ?? 1)
}

run([
  'scripts/run-enrichment-agent.mjs',
  'music',
  'discover',
  ...forwarded,
])

run([
  'scripts/run-enrichment-agent.mjs',
  'music',
  'run',
  `--source=${candidateSource}`,
  `--max-items=${maxItems}`,
  `--max-ai-reviews=${maxItems}`,
  ...forwarded.filter((arg) => !arg.startsWith('--max-items=')),
])

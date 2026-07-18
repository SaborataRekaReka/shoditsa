import { spawnSync } from 'node:child_process'
import { readFile, writeFile } from 'node:fs/promises'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const [factsRunId, hintsRunId] = process.argv.slice(2)
if (!factsRunId || !hintsRunId) throw new Error('Usage: sync-production-city-content <facts-run-id> <hints-run-id>')

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..')
const clientTarget = path.join(root, 'public', 'city-content', 'cities.json')
const generatedTarget = path.join(root, 'public', 'data', 'cities.generated.json')
const libraryItemsTarget = path.join(root, 'public', 'data', 'libraries', 'cities', 'items.json')
const librarySourceTarget = path.join(root, 'public', 'data', 'libraries', 'cities', 'source.json')
const sshHost = process.env.CITY_CONTENT_SSH || 'root@72.56.240.222'
const postgresContainer = process.env.CITY_CONTENT_POSTGRES_CONTAINER || 'shoditsa-api-shoditsa-postgres-1'
const sql = `
select coalesce(jsonb_object_agg(f.card_id, jsonb_build_object(
  'plotHint', h.proposed_json->>'plotHint',
  'facts', f.proposed_json->'facts'
)), '{}'::jsonb)::text
from pipeline_run_items f
join pipeline_run_items h on h.run_id='${hintsRunId}' and h.card_id=f.card_id
where f.run_id='${factsRunId}';
`
const remoteCommand = `docker exec -i ${postgresContainer} psql -v ON_ERROR_STOP=1 -U shoditsa_app -d shoditsa -At`
const result = spawnSync('ssh', [sshHost, remoteCommand], { input: sql, encoding: 'utf8', maxBuffer: 16 * 1024 * 1024 })
if (result.status !== 0) throw new Error(result.stderr || `ssh exited with ${result.status}`)
const enrichment = JSON.parse(result.stdout.trim())
const text = (value) => typeof value === 'string' ? value.trim() : ''
const applyEnrichment = (item) => {
  const content = enrichment[item.id]
  if (!content || !text(content.plotHint) || !Array.isArray(content.facts) || !text(content.facts[0])) {
    throw new Error(`Production enrichment is incomplete for ${item.id}`)
  }
  return { ...item, plotHint: text(content.plotHint), facts: content.facts.map(text).filter(Boolean) }
}

const clientItems = JSON.parse(await readFile(clientTarget, 'utf8')).map(applyEnrichment)
if (clientItems.length !== 980) throw new Error(`Expected 980 client cities, found ${clientItems.length}`)
const libraryItems = JSON.parse(await readFile(libraryItemsTarget, 'utf8')).map(applyEnrichment)
const generatedAt = new Date().toISOString()
const source = JSON.parse(await readFile(librarySourceTarget, 'utf8'))
Object.assign(source, { generatedAt, withHint: 980, withFacts: 980 })

await writeFile(clientTarget, `${JSON.stringify(clientItems)}\n`, 'utf8')
await writeFile(generatedTarget, `${JSON.stringify(clientItems, null, 2)}\n`, 'utf8')
await writeFile(libraryItemsTarget, `${JSON.stringify(libraryItems, null, 2)}\n`, 'utf8')
await writeFile(librarySourceTarget, `${JSON.stringify(source, null, 2)}\n`, 'utf8')
console.log(JSON.stringify({ total: 980, withHint: 980, withFacts: 980, generatedAt }, null, 2))

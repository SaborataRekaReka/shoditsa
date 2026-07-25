import { readFile, writeFile } from 'node:fs/promises'
import { resolve } from 'node:path'
import { loadConfig } from '@shoditsa/config'
import { createDatabase } from '@shoditsa/database'
import { loadIntegrationEnvironment } from '../../apps/api/src/modules/admin/integration-secrets.js'
import { kinopoiskKeysFromEnvironment } from './season-sources.mjs'

const args = process.argv.slice(2)
const arg = (name: string) => {
  const exact = args.find((value) => value.startsWith(`${name}=`))
  if (exact) return exact.slice(name.length + 1)
  const index = args.indexOf(name)
  return index >= 0 ? args[index + 1] : undefined
}
const inputPath = resolve(arg('--in') ?? '')
const outputPath = resolve(arg('--out') ?? './var/series-kinopoisk-type-audit.json')
if (!arg('--in')) throw new Error('--in <path> is required')

const config = loadConfig()
const { db, client } = createDatabase(config)
try {
  const environment = await loadIntegrationEnvironment(db, config)
  const keys = kinopoiskKeysFromEnvironment(environment)
  if (!keys.length) throw new Error('No Kinopoisk keys were loaded from admin integrations')
  const items = JSON.parse(await readFile(inputPath, 'utf8')) as Array<{ id: string; kinopoiskId: number; titleRu?: string }>
  const results = []
  let pointer = 0
  for (const item of items) {
    let result: Record<string, unknown> | null = null
    let error: string | null = null
    for (let attempt = 0; attempt < keys.length * 3; attempt += 1) {
      const response = await fetch(`https://kinopoiskapiunofficial.tech/api/v2.2/films/${item.kinopoiskId}`, {
        headers: { 'X-API-KEY': keys[pointer++ % keys.length], Accept: 'application/json' },
      })
      if (response.ok) {
        const payload = await response.json() as Record<string, unknown>
        result = {
          itemId: item.id,
          requestedTitle: item.titleRu ?? null,
          kinopoiskId: item.kinopoiskId,
          nameRu: payload.nameRu ?? null,
          year: payload.year ?? null,
          type: payload.type ?? null,
          serial: payload.serial ?? null,
          completed: payload.completed ?? null,
        }
        break
      }
      error = `http_${response.status}`
      if (response.status < 429 && ![401, 402, 403].includes(response.status)) break
    }
    results.push(result ?? { itemId: item.id, kinopoiskId: item.kinopoiskId, error })
  }
  await writeFile(outputPath, `${JSON.stringify({
    generatedAt: new Date().toISOString(),
    total: results.length,
    serial: results.filter((entry) => entry.serial === true).length,
    nonSerial: results.filter((entry) => entry.serial === false).length,
    results,
  }, null, 2)}\n`, 'utf8')
  console.log(JSON.stringify({ outputPath, total: results.length, serial: results.filter((entry) => entry.serial === true).length, nonSerial: results.filter((entry) => entry.serial === false).length }, null, 2))
} finally {
  await client.end()
}

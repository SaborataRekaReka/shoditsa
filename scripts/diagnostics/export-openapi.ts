import { mkdir, writeFile } from 'node:fs/promises'
import { resolve } from 'node:path'
import { loadConfig } from '@shoditsa/config'
import { buildApp } from '../../apps/api/src/app.js'

const app = await buildApp({ config: loadConfig() })
try {
  await app.ready()
  await mkdir(resolve('./docs/backend'), { recursive: true })
  await writeFile(resolve('./docs/backend/openapi.json'), `${JSON.stringify(app.swagger(), null, 2)}\n`, 'utf8')
  console.log('OpenAPI written to docs/backend/openapi.json')
} finally { await app.close() }

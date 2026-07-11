import { readFileSync, writeFileSync, existsSync } from 'node:fs'
import { resolve } from 'node:path'

const root = resolve(import.meta.dirname, '../..')
const configPath = resolve(root, 'public', 'data', 'daily-config.json')

const rawValue = process.argv[2]
if (rawValue == null) {
  console.error('Usage: npm run daily:salt -- <integer>')
  process.exit(1)
}

const parsed = Math.trunc(Number(rawValue))
if (!Number.isFinite(parsed)) {
  console.error(`Invalid salt value: ${rawValue}`)
  process.exit(1)
}

let config = { globalSalt: 0 }
if (existsSync(configPath)) {
  try {
    const existing = JSON.parse(readFileSync(configPath, 'utf8'))
    if (existing && typeof existing === 'object') {
      config = { ...config, ...existing }
    }
  } catch {
    // Keep defaults if existing file is malformed.
  }
}

config.globalSalt = parsed
writeFileSync(configPath, `${JSON.stringify(config, null, 2)}\n`, 'utf8')

console.log(`Updated global daily salt: ${config.globalSalt}`)
console.log(`Config file: ${configPath}`)

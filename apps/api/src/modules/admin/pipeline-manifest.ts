import { readFile } from 'node:fs/promises'
import { isAbsolute, relative, resolve } from 'node:path'

type ManifestRecord = {
  key: string
  status: 'completed' | 'review' | 'failed'
  path: string | null
  error: string | null
}

type PipelineResultManifest = {
  schemaVersion: 1
  domain: string
  runId: string | null
  records: ManifestRecord[]
}

const inside = (root: string, target: string) => {
  const path = relative(root, target)
  return path !== '' && !path.startsWith('..') && !isAbsolute(path)
}

export const loadPipelineResultManifest = async (enrichmentRoot: string, manifestFile: string, domain: string) => {
  const root = resolve(enrichmentRoot)
  const manifestPath = resolve(manifestFile)
  if (!inside(root, manifestPath)) throw new Error('Pipeline result manifest must be stored inside ENRICHMENT_DATA_ROOT')
  const parsed = JSON.parse(await readFile(manifestPath, 'utf8')) as Partial<PipelineResultManifest>
  if (parsed.schemaVersion !== 1 || parsed.domain !== domain || !Array.isArray(parsed.records)) {
    throw new Error(`Invalid ${domain} pipeline result manifest`)
  }
  const seen = new Set<string>()
  return parsed.records.map((raw) => {
    const key = String(raw?.key ?? '').trim()
    const status = raw?.status
    if (!key || !['completed', 'review', 'failed'].includes(String(status))) throw new Error(`Invalid ${domain} pipeline manifest record`)
    if (seen.has(key)) throw new Error(`Duplicate pipeline manifest record: ${key}`)
    seen.add(key)
    const relativeFile = String(raw?.path ?? '').trim()
    if (status === 'failed' && !relativeFile) return { key, status, file: null, error: String(raw?.error ?? 'Pipeline item failed').slice(0, 1_000) }
    const file = resolve(root, relativeFile)
    if (!relativeFile || !inside(root, file)) throw new Error(`Pipeline record path escapes ENRICHMENT_DATA_ROOT: ${key}`)
    return { key, status, file, error: null }
  })
}

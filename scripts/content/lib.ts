import { createHash } from 'node:crypto'
import { readFile } from 'node:fs/promises'
import { join, resolve } from 'node:path'
import type { ContentMode, TitleItem } from '@shoditsa/contracts'
import { normalize } from '@shoditsa/game-core'

export const LIBRARIES: Array<{ dir: string; mode: ContentMode }> = [
  { dir: 'movies', mode: 'movie' }, { dir: 'series', mode: 'series' },
  { dir: 'animes', mode: 'anime' }, { dir: 'games', mode: 'game' },
  { dir: 'music', mode: 'music' }, { dir: 'diagnoses', mode: 'diagnosis' },
]

export const sha256 = (value: string | Buffer) => createHash('sha256').update(value).digest('hex')
export const arg = (name: string) => {
  const exact = process.argv.find((value) => value.startsWith(`${name}=`))
  if (exact) return exact.slice(name.length + 1)
  const index = process.argv.indexOf(name)
  return index >= 0 ? process.argv[index + 1] : undefined
}
export const hasArg = (name: string) => process.argv.includes(name)

const validMediaUrl = (value: unknown) => value == null || value === '' || (typeof value === 'string' && (
  /^https?:\/\//.test(value) || /^\.?\/?(?:data|media|images)\//.test(value)
))

const validateItem = (value: unknown, mode: ContentMode, seen: Set<string>, file: string, index: number): TitleItem => {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error(`${file}[${index}] must be an object`)
  const item = value as TitleItem
  if (!item.id || typeof item.id !== 'string') throw new Error(`${file}[${index}] has no string id`)
  if (seen.has(item.id)) throw new Error(`Duplicate content id: ${item.id}`)
  if (item.mode !== mode) throw new Error(`${item.id}: expected mode ${mode}, got ${String(item.mode)}`)
  if (typeof item.titleRu !== 'string' || !item.titleRu.trim()) throw new Error(`${item.id}: titleRu is required`)
  if (typeof item.titleOriginal !== 'string') throw new Error(`${item.id}: titleOriginal must be a string`)
  if (!Array.isArray(item.alternativeTitles)) throw new Error(`${item.id}: alternativeTitles must be an array`)
  if (item.popularityScore != null && !Number.isFinite(item.popularityScore)) throw new Error(`${item.id}: popularityScore must be finite`)
  if (item.year != null && (!Number.isInteger(item.year) || item.year < 1800 || item.year > 2200)) throw new Error(`${item.id}: invalid year`)
  if (![item.posterUrl, item.headerUrl, item.backdropUrl, ...(item.screenshots ?? [])].every(validMediaUrl)) throw new Error(`${item.id}: invalid media URL`)
  if (mode === 'music' && typeof item.allowedInGame !== 'boolean') throw new Error(`${item.id}: music allowedInGame must be boolean`)
  if (mode === 'diagnosis' && !(item.icd10?.length || item.icdGroup)) throw new Error(`${item.id}: diagnosis ICD data is required`)
  seen.add(item.id)
  return item
}

export type LoadedLibrary = { mode: ContentMode; dir: string; file: string; checksum: string; items: TitleItem[] }
export type ImportManifest = {
  generatedAt: string
  sourceRoot: string
  checksumSha256: string
  totalItems: number
  modes: Record<string, { file: string; checksumSha256: string; count: number }>
  warnings: string[]
}

export const loadLibraries = async (sourceArg?: string) => {
  const source = resolve(sourceArg ?? './public/data/libraries')
  const seen = new Set<string>()
  const warnings: string[] = []
  const libraries: LoadedLibrary[] = []
  for (const library of LIBRARIES) {
    const file = join(source, library.dir, 'items.json')
    const raw = await readFile(file)
    const parsed = JSON.parse(raw.toString('utf8')) as unknown
    if (!Array.isArray(parsed) || parsed.length === 0) throw new Error(`${file}: library must be a non-empty array`)
    const items = parsed.map((value, index) => validateItem(value, library.mode, seen, file, index))
    libraries.push({ ...library, file, checksum: sha256(raw), items })
  }
  const diagnosis = libraries.find((library) => library.mode === 'diagnosis')!
  const vignetteFile = join(source, diagnosis.dir, 'case-vignettes.by-id.json')
  const vignetteRaw = await readFile(vignetteFile)
  const vignettes = JSON.parse(vignetteRaw.toString('utf8')) as Array<{ diagnosisId: string; caseVignettes: Array<{ id: string; text: string }> }>
  if (!Array.isArray(vignettes) || vignettes.length !== diagnosis.items.length) throw new Error(`Diagnosis vignette groups ${vignettes.length} != diagnosis items ${diagnosis.items.length}`)
  const knownDiagnoses = new Set(diagnosis.items.map((item) => item.id))
  for (const group of vignettes) {
    if (!knownDiagnoses.has(group.diagnosisId) || !Array.isArray(group.caseVignettes) || group.caseVignettes.length === 0) throw new Error(`Invalid vignette group: ${group.diagnosisId}`)
  }
  const modes = Object.fromEntries(libraries.map((library) => [library.mode, { file: library.file, checksumSha256: library.checksum, count: library.items.length }]))
  const manifestBase = { generatedAt: new Date().toISOString(), sourceRoot: source, totalItems: libraries.reduce((sum, library) => sum + library.items.length, 0), modes, warnings }
  const manifest: ImportManifest = { ...manifestBase, checksumSha256: sha256(JSON.stringify({ modes, vignettes: sha256(vignetteRaw) })) }
  return { source, libraries, vignettes, vignetteChecksum: sha256(vignetteRaw), manifest }
}

export const aliasesFor = (item: TitleItem) => {
  const entries = [
    [item.titleRu, 'ru'], [item.titleOriginal, 'original'],
    ...(item.alternativeTitles ?? []).map((value) => [value, 'alternative']),
    ...(item.aliases ?? []).map((value) => [value, 'external']),
  ] as Array<[string | undefined | null, string]>
  const result = new Map<string, { alias: string; normalizedAlias: string; kind: string }>()
  for (const [alias, kind] of entries) {
    const value = String(alias ?? '').trim()
    const normalizedAlias = normalize(value)
    if (value && normalizedAlias && !result.has(normalizedAlias)) result.set(normalizedAlias, { alias: value, normalizedAlias, kind })
  }
  return [...result.values()]
}

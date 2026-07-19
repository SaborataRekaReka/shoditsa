import { createHash } from 'node:crypto'
import { readFile } from 'node:fs/promises'
import { join, resolve } from 'node:path'
import { CONTENT_MODE_IDS, GAME_MODE_MANIFEST, type ContentMode, type TitleItem } from '@shoditsa/contracts'
import { normalize } from '@shoditsa/game-core'

export const LIBRARIES: Array<{ dir: string; mode: ContentMode }> = CONTENT_MODE_IDS.map((mode) => ({
  dir: GAME_MODE_MANIFEST[mode].dataDir,
  mode,
}))
export type ContentLibraryItem = Omit<TitleItem, 'mode'> & { mode: ContentMode; [key: string]: unknown }

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

const validateItem = (value: unknown, mode: ContentMode, seen: Set<string>, file: string, index: number): ContentLibraryItem => {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error(`${file}[${index}] must be an object`)
  const item = value as ContentLibraryItem
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

const externalIdentity = (item: ContentLibraryItem) => {
  if (Number.isFinite(item.externalRanks?.thegamesdb)) return `${item.mode}:thegamesdb:${item.externalRanks!.thegamesdb}`
  if (Number.isFinite(item.kinopoiskId)) return `${item.mode}:kinopoisk:${item.kinopoiskId}`
  if (Number.isFinite(item.shikimoriId)) return `${item.mode}:shikimori:${item.shikimoriId}`
  if (Number.isFinite(item.steamAppId)) return `${item.mode}:steam:${item.steamAppId}`
  return null
}

export type LoadedLibrary = { mode: ContentMode; dir: string; file: string; checksum: string; items: ContentLibraryItem[] }
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
  const seenExternalIds = new Map<string, string>()
  const warnings: string[] = []
  const libraries: LoadedLibrary[] = []
  for (const library of LIBRARIES) {
    const file = join(source, library.dir, 'items.json')
    const raw = await readFile(file)
    const parsed = JSON.parse(raw.toString('utf8')) as unknown
    if (!Array.isArray(parsed) || parsed.length === 0) throw new Error(`${file}: library must be a non-empty array`)
    const items = parsed.map((value, index) => validateItem(value, library.mode, seen, file, index))
    for (const item of items) {
      const identity = externalIdentity(item)
      if (!identity) continue
      const previous = seenExternalIds.get(identity)
      if (previous) throw new Error(`Duplicate external content id ${identity}: ${previous}, ${item.id}`)
      seenExternalIds.set(identity, item.id)
    }
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

export const aliasesFor = (item: ContentLibraryItem) => {
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

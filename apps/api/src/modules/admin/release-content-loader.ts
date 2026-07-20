import { createHash } from 'node:crypto'
import { readFile } from 'node:fs/promises'
import { join, resolve } from 'node:path'
import { CONTENT_MODE_IDS, GAME_MODE_MANIFEST, type ContentMode, type TitleItem } from '@shoditsa/contracts'
import { normalize } from '@shoditsa/game-core'

export const RELEASE_LIBRARIES: Array<{ dir: string; mode: ContentMode }> = CONTENT_MODE_IDS.map((mode) => ({
  dir: GAME_MODE_MANIFEST[mode].dataDir,
  mode,
}))
export type ReleaseContentItem = Omit<TitleItem, 'mode'> & { mode: ContentMode; [key: string]: unknown }

const sha256 = (value: string | Buffer) => createHash('sha256').update(value).digest('hex')
const validMediaUrl = (value: unknown) => value == null || value === '' || (typeof value === 'string' && (
  /^https?:\/\//.test(value) || /^\.?\/?(?:data|media|images)\//.test(value)
))

const validateItem = (value: unknown, mode: ContentMode, seen: Set<string>, file: string, index: number): ReleaseContentItem => {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error(`${file}[${index}] must be an object`)
  const item = value as ReleaseContentItem
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
  if (mode === 'danetki' && (typeof item.condition !== 'string' || typeof item.solution !== 'string' || !Array.isArray(item.keyFacts) || !Array.isArray(item.hints))) throw new Error(`${item.id}: invalid danetki payload`)
  seen.add(item.id)
  return item
}

export type LoadedReleaseLibrary = { mode: ContentMode; dir: string; file: string; checksum: string; items: ReleaseContentItem[] }

export const loadReleaseLibraries = async (sourceRoot: string) => {
  const source = resolve(sourceRoot)
  const seen = new Set<string>()
  const libraries: LoadedReleaseLibrary[] = []
  for (const library of RELEASE_LIBRARIES) {
    const file = join(source, library.dir, 'items.json')
    const raw = await readFile(file)
    const parsed = JSON.parse(raw.toString('utf8')) as unknown
    if (!Array.isArray(parsed) || parsed.length === 0) throw new Error(`${file}: library must be a non-empty array`)
    libraries.push({ ...library, file, checksum: sha256(raw), items: parsed.map((value, index) => validateItem(value, library.mode, seen, file, index)) })
  }
  const diagnosis = libraries.find((library) => library.mode === 'diagnosis')!
  const vignetteRaw = await readFile(join(source, diagnosis.dir, 'case-vignettes.by-id.json'))
  const vignettes = JSON.parse(vignetteRaw.toString('utf8')) as Array<{ diagnosisId: string; caseVignettes: Array<{ id: string; text: string }> }>
  if (!Array.isArray(vignettes) || vignettes.length !== diagnosis.items.length) throw new Error(`Diagnosis vignette groups ${vignettes.length} != diagnosis items ${diagnosis.items.length}`)
  const knownDiagnoses = new Set(diagnosis.items.map((item) => item.id))
  for (const group of vignettes) {
    if (!knownDiagnoses.has(group.diagnosisId) || !Array.isArray(group.caseVignettes) || group.caseVignettes.length === 0) throw new Error(`Invalid vignette group: ${group.diagnosisId}`)
  }
  const modes = Object.fromEntries(libraries.map((library) => [library.mode, { checksumSha256: library.checksum, count: library.items.length }]))
  const manifest = {
    generatedAt: new Date().toISOString(),
    checksumSha256: sha256(JSON.stringify({ modes, vignettes: sha256(vignetteRaw) })),
    totalItems: libraries.reduce((sum, library) => sum + library.items.length, 0),
    modes,
    warnings: [] as string[],
  }
  return { source, libraries, vignettes, manifest }
}

export const releaseAliasesFor = (item: ReleaseContentItem) => {
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

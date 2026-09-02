import { createHash } from 'node:crypto'
import { musicComparisonYear, normalize, resolveMusicRedirectId } from '@shoditsa/game-core'
import type { LibrarySearchIndex, MusicGameTier, TitleItem } from '@shoditsa/contracts'

export type EditorialArtist = {
  id: string
  name: string
  name_cyrillic: string | null
  debut_year: number
  debut_decade: string
  debut_release: string | null
  entity_type: 'группа' | 'соло-исполнитель'
  gender: 'мужской' | 'женский' | 'смешанный' | 'небинарный'
  languages: string[]
  countries: string[]
  career_status: 'карьера завершена' | 'карьера продолжается'
  genres: string[]
  similar_artists: string[]
  most_popular_song: string
  image_url: string
  short_hint: string
}

export type EditorialMusicDocument = {
  dataset: 'music_artists_enriched'
  version: string
  verified_at: string
  count: number
  definitions: Record<string, string>
  artists: EditorialArtist[]
}

export type ArtistCompatibility = {
  id: string
  sourceName: string
  gameTier: MusicGameTier
  aliases: string[]
  matchedLegacyId: string | null
}

export type EditorialMusicOverrides = Record<string, {
  posterUrl?: string
  plotHint?: string
  gameTier?: MusicGameTier
  reason: string
  sourceUrl?: string
}>

const list = (values: string[]) => [...new Map(values.map((value) => [normalize(value), value.trim()] as const).filter(([key]) => key)).values()]
const COUNTRY_NAMES: Record<string, string> = {
  LV: 'Латвия', MD: 'Молдова', RO: 'Румыния',
  Англия: 'Великобритания', 'Республика Корея': 'Южная Корея',
  'Королевство Нидерландов': 'Нидерланды', ФРГ: 'Германия',
}
const GENRE_NAMES: Record<string, string> = {
  'новая волна': 'нью-вейв', 'электроника': 'электронная музыка',
  'традиционная поп-музыка': 'традиционный поп',
}
const TIERS = new Set<MusicGameTier>(['core', 'popular', 'niche', 'discovery', 'experimental'])

export const validateEditorialMusicDocument = (document: EditorialMusicDocument) => {
  const errors: string[] = []
  if (document.dataset !== 'music_artists_enriched' || !document.version || !Array.isArray(document.artists)) {
    throw new Error('Expected a versioned music_artists_enriched document with an artists array')
  }
  if (!document.artists.length || document.count !== document.artists.length) errors.push('Declared and actual artist counts differ, or the catalog is empty')
  const ids = new Set<string>()
  const names = new Set<string>()
  for (const artist of document.artists) {
    const prefix = `${artist.id || '(missing id)'}: `
    if (!artist.id || ids.has(artist.id)) errors.push(`${prefix}missing or duplicate source ID`)
    ids.add(artist.id)
    if (!artist.name || names.has(normalize(artist.name))) errors.push(`${prefix}missing or duplicate artist name`)
    names.add(normalize(artist.name || ''))
    if (!Number.isInteger(artist.debut_year) || artist.debut_year < 1800 || artist.debut_year > Number(document.verified_at.slice(0, 4)) + 1) errors.push(`${prefix}invalid debut year`)
    if (artist.debut_decade !== `${Math.floor(artist.debut_year / 10) * 10}-е`) errors.push(`${prefix}debut decade does not match debut year`)
    if (!['группа', 'соло-исполнитель'].includes(artist.entity_type)) errors.push(`${prefix}unknown entity type`)
    if (!['мужской', 'женский', 'смешанный', 'небинарный'].includes(artist.gender)) errors.push(`${prefix}unknown gender/composition`)
    if (!['карьера завершена', 'карьера продолжается'].includes(artist.career_status)) errors.push(`${prefix}unknown career status`)
    for (const field of ['languages', 'countries', 'genres', 'similar_artists'] as const) {
      if (!Array.isArray(artist[field]) || !artist[field].length || artist[field].some((value) => typeof value !== 'string' || !value.trim())) errors.push(`${prefix}${field} must contain non-empty strings`)
    }
    for (const field of ['image_url', 'short_hint', 'most_popular_song'] as const) {
      if (typeof artist[field] !== 'string' || !artist[field].trim()) errors.push(`${prefix}${field} is required`)
    }
    if (!/^https:\/\//.test(artist.image_url)) errors.push(`${prefix}portrait must use HTTPS`)
  }
  if (errors.length) throw new Error(errors.join('\n'))
}

/** Exact identity matching only. No factual content is copied from the old catalog. */
export const prepareArtistCompatibility = (document: EditorialMusicDocument, previous: TitleItem[]) => {
  validateEditorialMusicDocument(document)
  const byAlias = new Map<string, Map<string, TitleItem>>()
  for (const item of previous.filter((candidate) => candidate.mode === 'music' && candidate.cardType !== 'kpop_artist')) {
    for (const alias of list([item.titleRu, item.titleOriginal, ...(item.alternativeTitles ?? []), ...(item.aliases ?? [])])) {
      const key = normalize(alias)
      const matches = byAlias.get(key) ?? new Map<string, TitleItem>()
      matches.set(item.id, item)
      byAlias.set(key, matches)
    }
  }
  return Object.fromEntries(document.artists.map((artist) => {
    const matches = new Map<string, TitleItem>()
    for (const name of [artist.name, artist.name_cyrillic].filter((value): value is string => Boolean(value))) {
      for (const item of byAlias.get(normalize(name))?.values() ?? []) matches.set(item.id, item)
    }
    if (matches.size > 1) throw new Error(`${artist.id}: ambiguous legacy identity (${[...matches.keys()].join(', ')})`)
    const previousItem = [...matches.values()][0]
    const id = previousItem ? resolveMusicRedirectId(previousItem.id) : `music:editorial:${artist.id}`
    return [artist.id, {
      id,
      sourceName: artist.name,
      gameTier: previousItem?.gameTier && TIERS.has(previousItem.gameTier) ? previousItem.gameTier : 'popular',
      aliases: previousItem ? list([previousItem.titleRu, previousItem.titleOriginal, ...(previousItem.alternativeTitles ?? []), ...(previousItem.aliases ?? [])]) : [],
      matchedLegacyId: previousItem?.id ?? null,
    } satisfies ArtistCompatibility]
  }))
}

export const buildEditorialMusicCatalog = (
  document: EditorialMusicDocument,
  sourceChecksum: string,
  compatibility: Record<string, ArtistCompatibility>,
  overrides: EditorialMusicOverrides = {},
): TitleItem[] => {
  validateEditorialMusicDocument(document)
  const sourceIds = new Set(document.artists.map((artist) => artist.id))
  if (Object.keys(compatibility).length !== sourceIds.size || Object.keys(compatibility).some((id) => !sourceIds.has(id))) throw new Error('Compatibility map must cover exactly the supplied catalog')
  if (Object.keys(overrides).some((id) => !sourceIds.has(id))) throw new Error('Override points outside the supplied catalog')
  const primaryNames = new Map<string, string>()
  for (const artist of document.artists) {
    for (const name of [artist.name, artist.name_cyrillic].filter((value): value is string => Boolean(value))) primaryNames.set(normalize(name), artist.id)
  }
  const items = document.artists.map((artist) => {
    const operational = compatibility[artist.id]
    if (!operational || normalize(operational.sourceName) !== normalize(artist.name)) throw new Error(`${artist.id}: identity mapping does not match the source name`)
    const override = overrides[artist.id]
    const titleRu = artist.name_cyrillic?.trim() || artist.name.trim()
    const aliases = list([artist.name, titleRu, ...operational.aliases]).filter((alias) => !primaryNames.has(normalize(alias)) || primaryNames.get(normalize(alias)) === artist.id)
    const posterUrl = override?.posterUrl ?? artist.image_url
    const gameTier = override?.gameTier ?? operational.gameTier
    if (!TIERS.has(gameTier)) throw new Error(`${artist.id}: invalid gameplay tier`)
    return {
      id: operational.id,
      canonicalId: operational.id,
      mode: 'music',
      titleRu,
      titleOriginal: artist.name.trim(),
      alternativeTitles: aliases.filter((alias) => ![normalize(titleRu), normalize(artist.name)].includes(normalize(alias))),
      aliases,
      musicDebutYear: artist.debut_year,
      musicDebutRelease: artist.debut_release,
      musicLanguages: list(artist.languages),
      musicGender: artist.gender,
      countries: list(artist.countries.map((country) => COUNTRY_NAMES[country] ?? country)),
      genres: list(artist.genres.map((genre) => GENRE_NAMES[genre] ?? genre)),
      musicType: artist.entity_type === 'группа' ? 'Group' : 'Person',
      musicIsActive: artist.career_status === 'карьера продолжается',
      // Kept only for legacy operational consumers; comparisons use actual languages.
      musicOrigin: artist.languages.includes('русский') ? 'ru' : 'intl',
      topTracks: [{ rank: 1, title: artist.most_popular_song, source: `${document.dataset}@${document.version}` }],
      similarArtists: list(artist.similar_artists).filter((name) => ![normalize(artist.name), normalize(titleRu)].includes(normalize(name)))
        .map((name, index) => ({ rank: index + 1, name, source: `${document.dataset}@${document.version}` })),
      posterUrl,
      plotHint: override?.plotHint ?? artist.short_hint,
      gameTier,
      popularityScore: { core: 100, popular: 70, niche: 40, discovery: 20, experimental: 10 }[gameTier],
      contentStatus: 'ready',
      allowedInGame: true,
      musicCatalog: {
        dataset: document.dataset,
        version: document.version,
        sourceId: artist.id,
        sourceChecksum,
        sourceDeclaredVerifiedAt: document.verified_at,
        originalImageUrl: artist.image_url,
      },
      dataQuality: {
        source: [`${document.dataset}@${document.version}`],
        // An upstream "verified_at" is provenance, not our independent fact-check.
        verified: false,
        missingFields: artist.debut_release == null ? ['musicDebutRelease'] : [],
      },
    } satisfies TitleItem
  })
  if (new Set(items.map((item) => item.id)).size !== items.length) throw new Error('Mapped runtime IDs are not unique')
  return items
}

export const musicCatalogChecksum = (value: unknown) => createHash('sha256').update(JSON.stringify(value)).digest('hex')

export const buildEditorialMusicSearchIndex = (items: TitleItem[], generatedAt: string): LibrarySearchIndex => {
  const tokenMap = new Map<string, Set<string>>()
  const docs = items.map((item) => {
    for (const name of [item.titleRu, item.titleOriginal, ...(item.alternativeTitles ?? []), ...(item.aliases ?? [])]) {
      for (const token of normalize(name).split(/\s+/).filter(Boolean)) {
        const ids = tokenMap.get(token) ?? new Set<string>()
        ids.add(item.id)
        tokenMap.set(token, ids)
      }
    }
    return { id: item.id, titleRu: item.titleRu, titleOriginal: item.titleOriginal, alternativeTitles: item.alternativeTitles, year: musicComparisonYear(item), topRank: null, steamAppId: null, icd10: [] }
  })
  return { version: 1, library: 'music', generatedAt, totalItems: items.length, tokensCount: tokenMap.size, docs, tokenToIds: Object.fromEntries([...tokenMap].sort(([left], [right]) => left.localeCompare(right, 'ru-RU')).map(([token, ids]) => [token, [...ids].sort()])) }
}

import type { GameComment, TitleItem } from '@shoditsa/contracts'

export type DtfAnswerRef = {
  mode: 'game'
  titleRu: string
  titleOriginal: string
  year: number
  legacyReleaseYears: number[]
  steamAppIds: number[]
  aliases: string[]
  resolutionOrder: string[]
}

export type DtfPackItem = {
  id: string
  gameId: string
  order: number
  answerRef: DtfAnswerRef
  progressiveHints: GameComment[]
}

export type DtfPackDocument = {
  schemaVersion: number
  pack: {
    id: string
    slug: string
    title: string
    subtitle?: string
    description: string
    itemCount: number
    recommendedMaxAttempts: number
    accessModel: 'free' | 'club' | 'purchase'
    publicationStatus: string
    rightsStatus: string
    uiCopy: {
      prompt: string
      disclaimer: string
      [key: string]: string
    }
    experience?: Record<string, unknown>
    playSets?: unknown[]
  }
  items: DtfPackItem[]
}

export type DtfCatalogGame = {
  itemId: string
  itemVersionId?: string | null
  allowedInGame: boolean
  contentStatus: string | null
  popularityScore: number
  payload: TitleItem
}

export type DtfResolution = {
  item: DtfPackItem
  status: 'resolved' | 'unresolved'
  method: 'steamAppId' | 'normalizedTitleAndYear' | 'normalizedTitle' | null
  catalog: DtfCatalogGame | null
}

export const normalizeDtfIdentity = (value: unknown) => String(value ?? '')
  .normalize('NFKD')
  .toLocaleLowerCase('ru-RU')
  .replace(/\p{M}+/gu, '')
  .replace(/ё/g, 'е')
  .replace(/&/g, ' and ')
  .replace(/['’`]/g, '')
  .replace(/[^\p{L}\p{N}]+/gu, ' ')
  .trim()

const uniqueStrings = (values: unknown[]) => [...new Set(
  values
    .flatMap((value) => Array.isArray(value) ? value : [value])
    .map((value) => String(value ?? '').trim())
    .filter(Boolean),
)]

const numericSteamIds = (value: unknown) => (
  (Array.isArray(value) ? value : [value])
    .map((entry) => Number(entry))
    .filter((entry) => Number.isInteger(entry) && entry > 0)
)

const namesForGame = (game: DtfCatalogGame) => uniqueStrings([
  game.payload.titleRu,
  game.payload.titleOriginal,
  game.payload.alternativeTitles,
  game.payload.aliases,
])

const steamIdsForGame = (game: DtfCatalogGame) => [...new Set([
  ...numericSteamIds(game.payload.steamAppId),
  ...numericSteamIds((game.payload as TitleItem & { steamAppIds?: number[] }).steamAppIds),
])]

const candidateScore = (game: DtfCatalogGame) => (
  (game.itemId.startsWith('promo:') || game.contentStatus === 'promo_pack' ? 0 : 100_000)
  + (game.allowedInGame ? 10_000 : 0)
  + Math.round(Number(game.popularityScore || 0))
)

const chooseBest = (games: DtfCatalogGame[]) => (
  [...games].sort((left, right) => candidateScore(right) - candidateScore(left))[0] ?? null
)

export const resolveDtfPackItem = (item: DtfPackItem, games: DtfCatalogGame[]): DtfResolution => {
  const refSteam = new Set(item.answerRef.steamAppIds.map(Number))
  const refNames = uniqueStrings([
    item.answerRef.titleRu,
    item.answerRef.titleOriginal,
    item.answerRef.aliases,
  ]).map(normalizeDtfIdentity).filter(Boolean)
  const allowedYears = new Set([
    item.answerRef.year,
    ...(item.answerRef.legacyReleaseYears ?? []),
  ].map(Number))

  if (refSteam.size > 0) {
    const match = chooseBest(games.filter((game) => (
      steamIdsForGame(game).some((id) => refSteam.has(id))
    )))
    if (match) return { item, status: 'resolved', method: 'steamAppId', catalog: match }
  }

  const titleYearMatch = chooseBest(games.filter((game) => (
    game.payload.year != null
    && allowedYears.has(Number(game.payload.year))
    && namesForGame(game).map(normalizeDtfIdentity).some((name) => refNames.includes(name))
  )))
  if (titleYearMatch) {
    return { item, status: 'resolved', method: 'normalizedTitleAndYear', catalog: titleYearMatch }
  }

  const titleMatch = chooseBest(games.filter((game) => (
    (game.payload.year == null || allowedYears.has(Number(game.payload.year)))
    && namesForGame(game).map(normalizeDtfIdentity).some((name) => refNames.includes(name))
  )))
  if (titleMatch) return { item, status: 'resolved', method: 'normalizedTitle', catalog: titleMatch }

  return { item, status: 'unresolved', method: null, catalog: null }
}

export const resolveDtfPack = (document: DtfPackDocument, games: DtfCatalogGame[]) => (
  [...document.items]
    .sort((left, right) => left.order - right.order)
    .map((item) => resolveDtfPackItem(item, games))
)

const cleanComment = (comment: GameComment, packId: string): GameComment => {
  const sourceUrl = String(comment.sourceUrl ?? '').trim()
  const sourcePostUrl = String(comment.sourcePostUrl ?? '').trim()
  const sourceExcerpt = String(comment.sourceExcerpt ?? '').replace(/\s+/g, ' ').trim()
  const sourceVerifiedAt = String(comment.sourceVerifiedAt ?? '').trim()
  const contentHash = String(comment.contentHash ?? '').trim()
  return {
    key: String(comment.key ?? '').trim(),
    text: String(comment.text ?? '').replace(/\s+/g, ' ').trim(),
    unlockAfterAttempts: Math.max(0, Math.trunc(Number(comment.unlockAfterAttempts) || 0)),
    type: String(comment.type ?? 'player_comment').trim() || 'player_comment',
    spoilerRisk: comment.spoilerRisk === 'medium' || comment.spoilerRisk === 'high'
      ? comment.spoilerRisk
      : 'low',
    sourceId: String(comment.sourceId ?? '').trim() || null,
    sourcePackId: packId,
    clueStrength: Math.trunc(Number(comment.clueStrength) || 0),
    topics: [...new Set((comment.topics ?? []).map((topic) => String(topic).trim()).filter(Boolean))],
    authorArchetype: String(comment.authorArchetype ?? '').trim() || null,
    ...(sourceUrl ? { sourceUrl } : {}),
    ...(sourcePostUrl ? { sourcePostUrl } : {}),
    ...(sourceExcerpt ? { sourceExcerpt } : {}),
    ...(sourceVerifiedAt ? { sourceVerifiedAt } : {}),
    ...(contentHash ? { contentHash } : {}),
    ...(comment.wasRedacted != null ? { wasRedacted: Boolean(comment.wasRedacted) } : {}),
    ...(comment.redactionReasons != null ? {
      redactionReasons: [...new Set(comment.redactionReasons.map((reason) => String(reason).trim()).filter(Boolean))],
    } : {}),
  }
}

export const mergeDtfComments = (
  payload: TitleItem,
  incoming: GameComment[],
  packId: string,
): TitleItem => {
  const preserved = (payload.comments ?? []).filter((comment) => comment.sourcePackId !== packId)
  const comments = incoming.map((comment) => cleanComment(comment, packId))
  const keys = new Set<string>()
  for (const comment of comments) {
    if (!comment.key || !comment.text) throw new Error(`${payload.id}: DTF comment key and text are required`)
    if (comment.unlockAfterAttempts > 10) throw new Error(`${payload.id}: invalid unlockAfterAttempts for ${comment.key}`)
    if (keys.has(comment.key)) throw new Error(`${payload.id}: duplicate DTF comment key ${comment.key}`)
    keys.add(comment.key)
  }
  return { ...payload, comments: [...preserved, ...comments] }
}

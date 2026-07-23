import { createHash } from 'node:crypto'

export const FORMULA_VERSION = 'games-recognition-v1'
export const SOURCE_VERSION = 'games-public-sources-2026-07'

export const ERA_QUOTAS = Object.freeze({
  before_2000: 80,
  '2000_2009': 170,
  '2010_2016': 250,
  '2017_2021': 270,
  '2022_current': 230,
})

const HUGE_FRANCHISES = new Set([
  'assassins-creed',
  'call-of-duty',
  'final-fantasy',
  'grand-theft-auto',
  'mario',
  'pokemon',
  'star-wars',
  'the-elder-scrolls',
  'the-legend-of-zelda',
])

const FRANCHISE_PATTERNS = [
  ['assassins-creed', /\bassassin'?s creed\b/i],
  ['baldurs-gate', /\bbaldur'?s gate\b/i],
  ['battlefield', /\bbattlefield\b/i],
  ['call-of-duty', /\bcall of duty\b/i],
  ['civilization', /\b(?:sid meier'?s )?civilization\b/i],
  ['counter-strike', /\bcounter[\s-]?strike\b/i],
  ['dark-souls', /\bdark souls\b/i],
  ['diablo', /\bdiablo\b/i],
  ['divinity', /\bdivinity\b/i],
  ['doom', /\bdoom\b/i],
  ['dragon-age', /\bdragon age\b/i],
  ['fallout', /\bfallout\b/i],
  ['far-cry', /\bfar cry\b/i],
  ['fifa', /\b(?:fifa|ea sports fc)\b/i],
  ['final-fantasy', /\bfinal fantasy\b/i],
  ['forza', /\bforza\b/i],
  ['gears-of-war', /\bgears(?: of war)?\b/i],
  ['god-of-war', /\bgod of war\b/i],
  ['grand-theft-auto', /\b(?:grand theft auto|gta)\b/i],
  ['halo', /\bhalo\b/i],
  ['heroes-of-might-and-magic', /\b(?:heroes of might and magic|might & magic heroes)\b/i],
  ['hitman', /\bhitman\b/i],
  ['mario', /\b(?:mario|luigi|wario|yoshi)\b/i],
  ['mass-effect', /\bmass effect\b/i],
  ['metal-gear', /\bmetal gear\b/i],
  ['mortal-kombat', /\bmortal kombat\b/i],
  ['need-for-speed', /\bneed for speed\b/i],
  ['pokemon', /\bpok[eé]mon\b/i],
  ['resident-evil', /\bresident evil\b/i],
  ['silent-hill', /\bsilent hill\b/i],
  ['sonic', /\bsonic\b/i],
  ['star-wars', /\bstar wars\b/i],
  ['street-fighter', /\bstreet fighter\b/i],
  ['the-elder-scrolls', /\b(?:the elder scrolls|morrowind|oblivion|skyrim)\b/i],
  ['the-legend-of-zelda', /\b(?:the legend of zelda|zelda)\b/i],
  ['the-sims', /\bthe sims\b/i],
  ['the-witcher', /\b(?:the witcher|witcher)\b/i],
  ['total-war', /\btotal war\b/i],
  ['warcraft', /\b(?:warcraft|world of warcraft)\b/i],
  ['warhammer', /\bwarhammer\b/i],
  ['wolfenstein', /\bwolfenstein\b/i],
]

const TECHNICAL_PATTERNS = [
  ['demo', /\b(?:demo|демо(?:версия)?)\b/i],
  ['dlc', /\b(?:dlc|downloadable content)\b/i],
  ['soundtrack', /\b(?:soundtrack|ost|саундтрек)\b/i],
  ['playtest', /\bplaytest\b/i],
  ['prologue', /\b(?:prologue|пролог)\b/i],
  ['not_for_resale', /\bnot for resale\b/i],
  ['server', /\b(?:dedicated server|server tool)\b/i],
  ['sdk_or_editor', /\b(?:sdk|level editor|mod tools?|toolkit)\b/i],
  ['benchmark', /\bbenchmark\b/i],
  ['trailer', /\b(?:trailer|трейлер)\b/i],
  ['rom_hack', /\b(?:rom hack|romhack)\b/i],
]

const cleanArray = (values) => [...new Set(
  (Array.isArray(values) ? values : [])
    .map((value) => cleanText(value))
    .filter(Boolean),
)]

export const cleanText = (value) => String(value ?? '')
  .replace(/<[^>]*>/g, ' ')
  .replace(/&nbsp;/gi, ' ')
  .replace(/&amp;/gi, '&')
  .replace(/&quot;/gi, '"')
  .replace(/&#39;|&apos;/gi, "'")
  .replace(/\s+/g, ' ')
  .trim()

export const normalizeTitle = (value) => cleanText(value)
  .normalize('NFKD')
  .toLocaleLowerCase('ru-RU')
  .replace(/\p{M}+/gu, '')
  .replace(/ё/g, 'е')
  .replace(/&/g, ' and ')
  .replace(/[’'`]/g, '')
  .replace(/[^\p{L}\p{N}]+/gu, ' ')
  .trim()

const romanPairs = [
  ['viii', '8'],
  ['vii', '7'],
  ['vi', '6'],
  ['iv', '4'],
  ['iii', '3'],
  ['ii', '2'],
  ['ix', '9'],
  ['v', '5'],
  ['x', '10'],
]

export const answerVariants = (...inputs) => {
  const values = cleanArray(inputs.flat())
  const variants = [...values]
  for (const value of values) {
    const punctuationFree = value.replace(/[™®©:–—_\-.]+/g, ' ').replace(/\s+/g, ' ').trim()
    if (punctuationFree && normalizeTitle(punctuationFree) !== normalizeTitle(value)) variants.push(punctuationFree)
    for (const [roman, arabic] of romanPairs) {
      const pattern = new RegExp(`\\b${roman}\\b`, 'i')
      if (pattern.test(value)) variants.push(value.replace(pattern, arabic))
      const reverse = new RegExp(`\\b${arabic}\\b`)
      if (reverse.test(value)) variants.push(value.replace(reverse, roman.toUpperCase()))
    }
  }
  return cleanArray(variants).filter((value) => normalizeTitle(value).length >= 2)
}

export const technicalReason = (title, type = null, comingSoon = false) => {
  if (type && type !== 'game') return `steam_type_${type}`
  if (comingSoon) return 'unreleased'
  const value = cleanText(title)
  for (const [reason, pattern] of TECHNICAL_PATTERNS) {
    if (pattern.test(value)) return reason
  }
  return null
}

export const editionType = (title) => {
  const value = cleanText(title)
  if (/\bremake\b|ремейк/i.test(value)) return 'remake'
  if (/\bremaster(?:ed)?\b|ремастер/i.test(value)) return 'remaster'
  if (/\b(?:goty|game of the year|complete|definitive|ultimate|deluxe|gold) edition\b/i.test(value)) return 'edition'
  if (/\b(?:dlc|expansion)\b/i.test(value)) return 'dlc'
  if (/\b(?:demo|playtest|prologue)\b/i.test(value)) return 'technical'
  return 'original'
}

export const franchiseKeyFor = (title) => {
  const value = cleanText(title)
  for (const [key, pattern] of FRANCHISE_PATTERNS) {
    if (pattern.test(value)) return key
  }
  return null
}

export const eraKeyFor = (year) => {
  const value = Number(year)
  if (!Number.isInteger(value)) return 'unknown'
  if (value < 2000) return 'before_2000'
  if (value < 2010) return '2000_2009'
  if (value < 2017) return '2010_2016'
  if (value < 2022) return '2017_2021'
  return '2022_current'
}

export const sha256 = (value) => `sha256:${createHash('sha256').update(String(value)).digest('hex')}`

const clamp = (value, min = 0, max = 100) => Math.min(max, Math.max(min, value))
const finite = (value) => Number.isFinite(Number(value)) ? Number(value) : null

const percentileLookup = (rows, selector) => {
  const valuesByEra = new Map()
  for (const row of rows) {
    const value = selector(row)
    if (value == null || !Number.isFinite(value)) continue
    const era = eraKeyFor(row.year)
    const values = valuesByEra.get(era) ?? []
    values.push(value)
    valuesByEra.set(era, values)
  }
  for (const values of valuesByEra.values()) values.sort((a, b) => a - b)
  return (row) => {
    const value = selector(row)
    if (value == null || !Number.isFinite(value)) return null
    const values = valuesByEra.get(eraKeyFor(row.year)) ?? []
    if (!values.length) return null
    let upper = 0
    while (upper < values.length && values[upper] <= value) upper += 1
    return Math.round((upper / values.length) * 10000) / 100
  }
}

const sourceTypeCount = (item) => {
  const sources = new Set([
    ...(item.dataQuality?.source ?? []),
    ...(item.sourceFlags ?? []),
  ].map((value) => {
    const source = String(value).toLowerCase()
    if (source.includes('steamspy')) return 'steamspy'
    if (source.includes('steam_review')) return 'steam_reviews'
    if (source.includes('steam')) return 'steam_store'
    if (source.includes('thegamesdb')) return 'thegamesdb'
    if (source.includes('play_that_game') || source.includes('ptg')) return 'playthatgame'
    if (source.includes('dtf')) return 'dtf'
    if (source.includes('wikidata') || source.includes('wikipedia')) return 'wikimedia'
    return source
  }).filter(Boolean))
  return sources.size
}

const completenessScore = (item) => {
  const checks = [
    cleanText(item.titleRu),
    cleanText(item.titleOriginal),
    Number.isInteger(Number(item.year)),
    cleanArray(item.genres).length,
    cleanArray(item.developers).length,
    cleanArray(item.publishers).length,
    cleanArray(item.platforms).length,
    answerVariants(item.titleRu, item.titleOriginal, item.alternativeTitles, item.aliases).length,
    cleanText(item.plotHint),
  ]
  return Math.round(checks.filter(Boolean).length / checks.length * 100)
}

const componentAverage = (values) => {
  const present = values.filter((value) => value != null && Number.isFinite(value))
  return present.length ? present.reduce((sum, value) => sum + value, 0) / present.length : null
}

export const scoreCatalog = (items) => {
  const totalReviews = (item) => {
    const explicit = finite(item.recognitionSignals?.steamTotalReviews)
    if (explicit != null) return explicit
    if (!item.steamAppId) return null
    const fromVotes = finite(item.votes?.steamReviews)
    return fromVotes != null && fromVotes > 0 ? fromVotes : null
  }
  const russianReviews = (item) => finite(item.recognitionSignals?.steamRussianReviews)
  const owners = (item) => finite(item.recognitionSignals?.steamOwnersMidpoint)
  const ccu = (item) => finite(item.recognitionSignals?.steamCcu)
  const reviewVelocity = (item) => {
    const reviews = totalReviews(item)
    const year = finite(item.year)
    if (reviews == null || year == null) return null
    const ageYears = Math.max(0.25, new Date().getUTCFullYear() - year + 0.5)
    return Math.log10(reviews + 1) / Math.sqrt(ageYears)
  }

  const totalReviewPercentile = percentileLookup(items, (item) => {
    const value = totalReviews(item)
    return value == null ? null : Math.log10(value + 1)
  })
  const ownersPercentile = percentileLookup(items, (item) => {
    const value = owners(item)
    return value == null ? null : Math.log10(value + 1)
  })
  const russianPercentile = percentileLookup(items, (item) => {
    const value = russianReviews(item)
    return value == null ? null : Math.log10(value + 1)
  })
  const ccuPercentile = percentileLookup(items, (item) => {
    const value = ccu(item)
    return value == null ? null : Math.log10(value + 1)
  })
  const velocityPercentile = percentileLookup(items, reviewVelocity)

  return items.map((item) => {
    const signals = {
      steamTotalReviews: totalReviews(item),
      steamRussianReviews: russianReviews(item),
      steamOwnersMidpoint: owners(item),
      steamCcu: ccu(item),
      steamTotalReviewsPercentileByEra: totalReviewPercentile(item),
      steamRussianReviewsPercentileByEra: russianPercentile(item),
      igdbPlayed: finite(item.recognitionSignals?.igdbPlayed),
      igdbVisits: finite(item.recognitionSignals?.igdbVisits),
      currentInterest: componentAverage([ccuPercentile(item), velocityPercentile(item)]),
      chartsCount: finite(item.recognitionSignals?.chartsCount) ?? 0,
      majorAwardsCount: finite(item.recognitionSignals?.majorAwardsCount) ?? 0,
      legacyPtgRank: finite(item.externalRanks?.playThatGame),
      steamSpyRank: finite(item.recognitionSignals?.steamSpyRank),
      manualCisAdjustment: finite(item.recognitionSignals?.manualCisAdjustment) ?? 0,
      manualCisAdjustmentReason: item.recognitionSignals?.manualCisAdjustmentReason ?? null,
      observedAt: item.recognitionSignals?.observedAt ?? null,
    }

    const globalAccumulatedReach = componentAverage([
      signals.steamTotalReviewsPercentileByEra,
      ownersPercentile(item),
    ])
    const rawCis = signals.steamRussianReviewsPercentileByEra
    const cisRecognition = rawCis == null && !signals.manualCisAdjustment
      ? null
      : clamp((rawCis ?? 50) + signals.manualCisAdjustment)
    const igdbPlayedAndVisits = componentAverage([
      signals.igdbPlayed == null ? null : clamp(Math.log10(signals.igdbPlayed + 1) * 20),
      signals.igdbVisits == null ? null : clamp(Math.log10(signals.igdbVisits + 1) * 20),
    ])
    const legacyRank = signals.legacyPtgRank == null
      ? null
      : clamp(100 - ((signals.legacyPtgRank - 1) / 999) * 100)
    const spyRank = signals.steamSpyRank == null
      ? null
      : clamp(100 - ((signals.steamSpyRank - 1) / 2999) * 100)
    const chartsAwardsAndLegacy = componentAverage([
      legacyRank == null ? null : legacyRank * 0.65,
      spyRank,
      signals.chartsCount ? clamp(45 + signals.chartsCount * 8) : null,
      signals.majorAwardsCount ? clamp(55 + signals.majorAwardsCount * 8) : null,
    ])
    const currentAgeAdjustedInterest = signals.currentInterest
    const guessabilityScore = completenessScore(item)

    const weighted = [
      ['globalAccumulatedReach', globalAccumulatedReach, 0.30],
      ['cisRecognition', cisRecognition, 0.25],
      ['igdbPlayedAndVisits', igdbPlayedAndVisits, 0.15],
      ['chartsAwardsAndLegacy', chartsAwardsAndLegacy, 0.10],
      ['currentAgeAdjustedInterest', currentAgeAdjustedInterest, 0.10],
      ['guessabilityScore', guessabilityScore, 0.10],
    ]
    const available = weighted.filter(([, value]) => value != null && Number.isFinite(value))
    const availableWeight = available.reduce((sum, [, , weight]) => sum + weight, 0)
    const recognitionScore = availableWeight
      ? Math.round(available.reduce((sum, [, value, weight]) => sum + value * weight, 0) / availableWeight * 100) / 100
      : 0
    const corroboration = Math.min(1, sourceTypeCount(item) / 3)
    const scoreConfidence = Math.round(Math.min(1, (availableWeight / 1) * (0.55 + corroboration * 0.45)) * 1000) / 1000
    const sourceCount = sourceTypeCount(item)
    const recognitionLevel = recognitionScore >= 85 && sourceCount >= 3
      ? 'mass'
      : recognitionScore >= 65
        ? 'mainstream'
        : recognitionScore >= 40
          ? 'cult_or_genre'
          : 'special_only'

    return {
      ...item,
      recognitionSignals: signals,
      recognitionComponents: Object.fromEntries(weighted.map(([key, value]) => [key, value == null ? null : Math.round(value * 100) / 100])),
      recognitionScore,
      cisScore: cisRecognition == null ? null : Math.round(cisRecognition * 100) / 100,
      trendScore: currentAgeAdjustedInterest == null ? null : Math.round(currentAgeAdjustedInterest * 100) / 100,
      guessabilityScore,
      scoreConfidence,
      scoreFormulaVersion: FORMULA_VERSION,
      recognitionLevel,
    }
  })
}

export const isEngineComplete = (item) => Boolean(
  cleanText(item.titleRu)
  && cleanText(item.titleOriginal)
  && Number.isInteger(Number(item.year))
  && cleanArray(item.genres).length
  && cleanArray(item.developers).length
  && cleanArray(item.publishers).length
  && cleanArray(item.platforms).length
  && answerVariants(item.titleRu, item.titleOriginal, item.alternativeTitles, item.aliases).length,
)

const franchiseLimit = (key) => key ? (HUGE_FRANCHISES.has(key) ? 5 : 3) : Number.POSITIVE_INFINITY

export const selectDailyPool = (catalog, mustIncludeSteamIds = []) => {
  const eligible = catalog
    .filter((item) => item.dailyEligible && isEngineComplete(item) && item.reviewStatus !== 'review_required')
    .sort((left, right) =>
      right.recognitionScore - left.recognitionScore
      || right.scoreConfidence - left.scoreConfidence
      || left.id.localeCompare(right.id, 'en-US'))
  const selected = []
  const selectedIds = new Set()
  const franchiseCounts = new Map()
  const franchiseFallbackIds = []
  const eraCounts = Object.fromEntries(Object.keys(ERA_QUOTAS).map((key) => [key, 0]))

  const canTake = (item, force = false) => {
    if (selectedIds.has(item.id)) return false
    const era = eraKeyFor(item.year)
    if (!(era in ERA_QUOTAS)) return false
    if (!force && eraCounts[era] >= ERA_QUOTAS[era]) return false
    const franchise = item.franchiseKey
    if (!franchise) return true
    return (franchiseCounts.get(franchise) ?? 0) < franchiseLimit(franchise)
  }

  const take = (item) => {
    selected.push(item)
    selectedIds.add(item.id)
    const era = eraKeyFor(item.year)
    eraCounts[era] += 1
    if (item.franchiseKey) franchiseCounts.set(item.franchiseKey, (franchiseCounts.get(item.franchiseKey) ?? 0) + 1)
  }

  for (const steamAppId of mustIncludeSteamIds) {
    const item = eligible.find((candidate) => Number(candidate.steamAppId) === Number(steamAppId))
    if (item && canTake(item)) take(item)
  }

  for (const era of Object.keys(ERA_QUOTAS)) {
    for (const item of eligible) {
      if (eraCounts[era] >= ERA_QUOTAS[era]) break
      if (eraKeyFor(item.year) === era && canTake(item)) take(item)
    }
  }

  if (selected.length < 1000) {
    for (const item of eligible) {
      if (selected.length >= 1000) break
      if (canTake(item, true)) take(item)
    }
  }

  // A complete, validated hint is more important than a soft diversity cap.
  // When the curated catalog is temporarily smaller than the ideal mix, fill
  // the remaining slots with valid cards and expose the fallback in the report.
  if (selected.length < 1000) {
    for (const item of eligible) {
      if (selected.length >= 1000) break
      if (selectedIds.has(item.id)) continue
      take(item)
      franchiseFallbackIds.push(item.id)
    }
  }

  return {
    selected,
    eraCounts,
    franchiseCounts: Object.fromEntries([...franchiseCounts.entries()].sort((left, right) => right[1] - left[1])),
    eligibleCount: eligible.length,
    franchiseFallbackIds,
  }
}

export const thematicPoolsFor = (item) => {
  const text = cleanArray([...(item.genres ?? []), ...(item.steamCategories ?? []), ...(item.notes ?? [])]).join(' ').toLowerCase()
  const pools = []
  if (item.externalRanks?.playThatGame) pools.push('legacy-ptg')
  if (Number(item.year) < 2000) pools.push('retro')
  if (item.franchiseKey === 'mario' || item.franchiseKey === 'pokemon' || item.franchiseKey === 'the-legend-of-zelda'
    || cleanArray(item.publishers).some((value) => /nintendo/i.test(value))) pools.push('nintendo')
  if (!item.steamAppId) pools.push('console-classics')
  if (/\brpg\b|role.play|crpg/.test(text)) pools.push('rpg')
  if (/strategy|стратег/.test(text)) pools.push('strategy')
  if (/indie|инди/.test(text)) pools.push('indie')
  if (/co-op|coop|кооператив|мультиплеер/.test(text)) pools.push('co-op')
  if (/survival|craft|выживание/.test(text)) pools.push('survival')
  if (Number(item.year) >= 2022) pools.push('modern-hits')
  if (item.recognitionLevel === 'cult_or_genre') pools.push('cult')
  if ((item.sourceFlags ?? []).some((value) => String(value).includes('dtf'))) pools.push('dtf-comments')
  if (item.reviewStatus === 'review_required') pools.push('review-required')
  return [...new Set(pools)]
}

export const uniqueStrings = cleanArray

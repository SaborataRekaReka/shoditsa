const kinopoiskKeySlots = Array.from(
  { length: 5 },
  (_, index) => `KINOPOISK_UNOFFICIAL_API_KEY_${index + 1}`,
)

const splitKeys = (value) => String(value ?? '')
  .split(/[\n,;\s]+/)
  .map((entry) => entry.trim())
  .filter(Boolean)

export const kinopoiskKeysFromEnvironment = (environment = process.env) => [...new Set([
  ...splitKeys(environment.KINOPOISK_API_KEYS),
  ...splitKeys(environment.KINOPOISK_API_KEY),
  ...kinopoiskKeySlots.flatMap((key) => splitKeys(environment[key])),
])]

const positiveInteger = (value) => {
  const number = Number(value)
  return Number.isInteger(number) && number > 0 ? number : null
}

export const parseWikidataSeasonBindings = (bindings) => {
  const candidates = new Map()

  for (const binding of Array.isArray(bindings) ? bindings : []) {
    const kinopoiskId = positiveInteger(binding?.kp?.value)
    const seasonsCount = positiveInteger(binding?.seasons?.value)
    const imdbId = typeof binding?.imdb?.value === 'string' && /^tt\d+$/i.test(binding.imdb.value.trim())
      ? binding.imdb.value.trim().toLowerCase()
      : null
    if (kinopoiskId == null || (seasonsCount == null && imdbId == null)) continue

    const key = String(kinopoiskId)
    const current = candidates.get(key) ?? {
      counts: new Set(),
      imdbIds: new Set(),
      itemUrls: new Set(),
    }
    if (seasonsCount != null) current.counts.add(seasonsCount)
    if (imdbId != null) current.imdbIds.add(imdbId)
    if (typeof binding?.item?.value === 'string' && binding.item.value.startsWith('http')) {
      current.itemUrls.add(binding.item.value.replace(/^http:/, 'https:'))
    }
    candidates.set(key, current)
  }

  const counts = new Map()
  const imdbIds = new Map()
  const sourceUrls = new Map()
  const conflicts = []

  for (const [kinopoiskId, candidate] of candidates) {
    const values = [...candidate.counts].sort((left, right) => left - right)
    if (values.length > 1) {
      conflicts.push({ kinopoiskId: Number(kinopoiskId), values })
    } else if (values.length === 1) {
      counts.set(kinopoiskId, values[0])
    }

    const candidateImdbIds = [...candidate.imdbIds].sort()
    if (candidateImdbIds.length === 1) imdbIds.set(kinopoiskId, candidateImdbIds[0])

    const sourceUrl = [...candidate.itemUrls].sort()[0]
    if (sourceUrl) sourceUrls.set(kinopoiskId, sourceUrl)
  }

  return { counts, imdbIds, sourceUrls, conflicts, entityCount: candidates.size }
}

const delay = (milliseconds) => new Promise((resolve) => setTimeout(resolve, milliseconds))

const retryDelay = (response, attempt) => {
  const retryAfter = Number(response.headers.get('retry-after'))
  if (Number.isFinite(retryAfter) && retryAfter > 0) return Math.min(15_000, retryAfter * 1_000)
  return Math.min(8_000, 400 * (attempt + 1))
}

const queryForKinopoiskIds = (ids) => `
SELECT ?kp ?item ?seasons ?imdb WHERE {
  VALUES ?kp { ${ids.map((id) => `"${id}"`).join(' ')} }
  ?item wdt:P2603 ?kp.
  OPTIONAL { ?item wdt:P2437 ?seasons. }
  OPTIONAL {
    ?item wdt:P345 ?imdb.
    FILTER(REGEX(?imdb, "^tt[0-9]+$", "i"))
  }
  FILTER(BOUND(?seasons) || BOUND(?imdb))
}
`

export const fetchWikidataSeasonsByKinopoiskIds = async (
  kinopoiskIds,
  {
    fetchImpl = fetch,
    endpoint = 'https://query.wikidata.org/sparql',
    batchSize = 40,
    maxAttempts = 5,
  } = {},
) => {
  const ids = [...new Set((Array.isArray(kinopoiskIds) ? kinopoiskIds : [])
    .map(positiveInteger)
    .filter((value) => value != null)
    .map(String))]

  const allBindings = []

  for (let offset = 0; offset < ids.length; offset += batchSize) {
    const batch = ids.slice(offset, offset + batchSize)
    let lastError = null

    for (let attempt = 0; attempt < maxAttempts; attempt += 1) {
      let response
      try {
        response = await fetchImpl(endpoint, {
          method: 'POST',
          headers: {
            Accept: 'application/sparql-results+json',
            'Content-Type': 'application/x-www-form-urlencoded;charset=UTF-8',
            'User-Agent': 'shoditsa-series-meta/1.0 (https://shoditsa.ru)',
          },
          body: new URLSearchParams({
            query: queryForKinopoiskIds(batch),
            format: 'json',
          }),
        })
      } catch (error) {
        lastError = error
        if (attempt + 1 < maxAttempts) {
          await delay(Math.min(8_000, 400 * (attempt + 1)))
          continue
        }
        break
      }

      if (response.ok) {
        const payload = await response.json()
        allBindings.push(...(payload?.results?.bindings ?? []))
        lastError = null
        break
      }

      const body = await response.text().catch(() => '')
      lastError = new Error(`Wikidata HTTP ${response.status}: ${body.slice(0, 180)}`)
      if (response.status !== 429 && response.status < 500) break
      if (attempt + 1 < maxAttempts) await delay(retryDelay(response, attempt))
    }

    if (lastError) throw lastError
    if (offset + batchSize < ids.length) await delay(250)
  }

  return parseWikidataSeasonBindings(allBindings)
}

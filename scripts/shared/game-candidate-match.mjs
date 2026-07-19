const EDITION_WORDS = ['edition', 'collection', 'remaster', 'remastered', 'remake', 'definitive', 'goty', 'beta', 'demo', 'pack']
const ROMAN_NUMERALS = new Map([
  ['ii', '2'], ['iii', '3'], ['iv', '4'], ['v', '5'], ['vi', '6'], ['vii', '7'], ['viii', '8'], ['ix', '9'], ['x', '10'],
])

export const normalizeGameCandidateTitle = (value) => String(value || '')
  .toLowerCase()
  .replace(/&/g, ' and ')
  .replace(/[^a-z0-9а-яё\s]/gi, ' ')
  .split(/\s+/)
  .filter(Boolean)
  .map((token) => ROMAN_NUMERALS.get(token) ?? token)
  .join(' ')
  .trim()

const parseYear = (value) => {
  const text = String(value || '').trim()
  const year = Number(text.slice(0, 4))
  return Number.isFinite(year) && year >= 1950 && year <= 2100 ? year : null
}

const titleNumbers = (value) => [...new Set(value.split(' ').filter((token) => /^\d+$/.test(token)))].sort()

export const pickBestGameCandidate = (seed, candidates) => {
  const seedName = normalizeGameCandidateTitle(seed.name)
  const scored = candidates.map((candidate) => {
    const titleNormalized = normalizeGameCandidateTitle(candidate.game_title)
    const year = parseYear(candidate.release_date)
    const seedNumbers = titleNumbers(seedName)
    const candidateNumbers = titleNumbers(titleNormalized)
    let score = 0

    if (titleNormalized === seedName) score += 100
    else if (titleNormalized.startsWith(seedName) || seedName.startsWith(titleNormalized)) score += 80
    else if (titleNormalized.includes(seedName) || seedName.includes(titleNormalized)) score += 60

    if (year != null) {
      const diff = Math.abs(seed.year - year)
      if (diff === 0) score += 22
      else if (diff <= 2) score += 12
      else if (diff <= 5) score += 5
      else score -= 10
    }

    const hasEditionWord = EDITION_WORDS.some((word) => titleNormalized.includes(word))
    const seedHasEditionWord = EDITION_WORDS.some((word) => seedName.includes(word))
    if (hasEditionWord && !seedHasEditionWord) score -= 10
    if (seedNumbers.join(',') !== candidateNumbers.join(',')) score -= 100
    if (year === 1970) score -= 50

    return { candidate, score }
  })

  scored.sort((left, right) => right.score - left.score)
  return scored[0]?.score >= 50 ? scored[0].candidate : null
}

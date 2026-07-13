const normalize = (value) => String(value ?? '')
  .normalize('NFKC')
  .toLowerCase()
  .replace(/ё/g, 'е')
  .replace(/[^a-zа-я0-9]+/gi, ' ')
  .replace(/\s+/g, ' ')
  .trim()

const NON_ARTIST = /(?:\bальбом\b|\bпесня\b|\bсингл\b|\bсаундтрек\b|\bкомпозици[яи]\b|\bдискографи[яи]\b|\balbum\b|\bsong\b|\bsingle\b|\bsoundtrack\b|\brecording\b|\bmusical work\b)/i
const ARTIST = /(?:пев(?:ец|ица)|музыкант|рэпер|композитор|исполнитель|музыкальн(?:ая|ый|ое)\s+(?:группа|коллектив|дуэт|трио|исполнитель)|оркестр|ансамбль|\bsinger\b|\bmusician\b|\brapper\b|\bcomposer\b|\bsongwriter\b|\bmusic(?:al)?\s+(?:artist|group|band|duo|trio|ensemble)\b|\brock band\b|\borchestra\b)/i

const nameMatches = (target, candidate) => {
  const left = normalize(target)
  const right = normalize(candidate)
  if (!left || !right) return false
  return left === right || (Math.min(left.length, right.length) >= 5 && (left.includes(right) || right.includes(left)))
}

const transliterate = (value) => normalize(value).replace(/[а-я]/g, (letter) => ({
  а: 'a', б: 'b', в: 'v', г: 'g', д: 'd', е: 'e', ж: 'zh', з: 'z', и: 'i', й: 'i', к: 'k', л: 'l', м: 'm',
  н: 'n', о: 'o', п: 'p', р: 'r', с: 's', т: 't', у: 'u', ф: 'f', х: 'kh', ц: 'ts', ч: 'ch', ш: 'sh', щ: 'shch',
  ы: 'y', э: 'e', ю: 'yu', я: 'ya', ь: '', ъ: '',
}[letter] ?? letter)).replace(/iya\b/g, 'ia').replace(/iy\b/g, 'i').replace(/\s+/g, ' ').trim()

export const namesReferToSameArtist = (target, candidate) => nameMatches(target, candidate)
  || nameMatches(transliterate(target), transliterate(candidate))

export const scoreWikidataArtistCandidate = (item, artistName) => {
  const names = [item?.label, item?.match?.text, ...(Array.isArray(item?.aliases) ? item.aliases : [])].filter(Boolean)
  const description = String(item?.description ?? '')
  const exactName = names.some((name) => normalize(name) === normalize(artistName))
  const compatibleName = names.some((name) => nameMatches(artistName, name))
  const artistDescriptor = ARTIST.test(description)
  const nonArtistDescriptor = NON_ARTIST.test(description)
  if (!compatibleName || (nonArtistDescriptor && !artistDescriptor)) return null
  const confidence = exactName ? 1 : 0.75
  return {
    item,
    confidence,
    score: confidence + (artistDescriptor ? 0.45 : 0) - (nonArtistDescriptor ? 0.8 : 0),
  }
}

export const validateWikidataArtistIdentity = ({ artistName, names, typeLabels }) => {
  const normalizedTypes = (Array.isArray(typeLabels) ? typeLabels : []).map(String)
  const forbiddenType = normalizedTypes.find((type) => NON_ARTIST.test(type) && !ARTIST.test(type))
  if (forbiddenType) return { valid: false, reason: `non_artist_type:${forbiddenType}` }
  if (!(Array.isArray(names) ? names : []).some((name) => nameMatches(artistName, name))) {
    return { valid: false, reason: 'artist_name_mismatch' }
  }
  return { valid: true, reason: null }
}

export const isNonArtistType = (value) => NON_ARTIST.test(String(value ?? '')) && !ARTIST.test(String(value ?? ''))

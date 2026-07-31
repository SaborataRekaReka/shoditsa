import fs from 'node:fs'
import path from 'node:path'
import { pathToFileURL } from 'node:url'

const ROOT = process.cwd()
const CANONICAL_SOURCE = path.join(ROOT, 'data', 'books', 'source', 'books_enriched_full.json')
const GENERATED_SOURCE = path.join(ROOT, 'public', 'data', 'books.generated.json')
const REPORT_PATH = path.join(ROOT, 'data', 'books', 'build-report.json')

const argValue = (name) => {
  const prefix = `--${name}=`
  const value = process.argv.slice(2).find((arg) => arg.startsWith(prefix))
  return value ? value.slice(prefix.length) : null
}

const readJson = (filePath) => JSON.parse(fs.readFileSync(filePath, 'utf8'))
const writeJson = (filePath, value) => {
  fs.mkdirSync(path.dirname(filePath), { recursive: true })
  fs.writeFileSync(filePath, `${JSON.stringify(value, null, 2)}\n`, 'utf8')
}

const compact = (values) => [...new Set(values.map((value) => String(value ?? '').trim()).filter(Boolean))]
const normalizeText = (value) => String(value ?? '')
  .normalize('NFD')
  .replace(/\p{M}+/gu, '')
  .toLocaleLowerCase('ru-RU')
  .replace(/ё/g, 'е')
  .replace(/[^a-zа-я0-9]+/gi, ' ')
  .trim()

const LANGUAGE_MAP = new Map([
  ['английский', 'Английский'], ['английский язык', 'Английский'], ['американский английский язык', 'Английский'], ['британский английский язык', 'Английский'],
  ['русский', 'Русский'], ['русский язык', 'Русский'],
  ['французский язык', 'Французский'], ['немецкий язык', 'Немецкий'], ['шведский язык', 'Шведский'],
  ['японский язык', 'Японский'], ['итальянский язык', 'Итальянский'], ['тосканский диалект', 'Итальянский'],
  ['польский язык', 'Польский'], ['португальский язык', 'Португальский'], ['испанский язык', 'Испанский'], ['средневековый испанский язык', 'Испанский'],
  ['китайский язык', 'Китайский'], ['мандаринский китайский язык', 'Китайский'], ['корейский язык', 'Корейский'],
  ['латинский язык', 'Латинский'], ['персидский язык', 'Персидский'], ['гомеровский греческий язык', 'Древнегреческий'], ['древнегреческий язык', 'Древнегреческий'],
])

const COUNTRY_MAP = new Map([
  ['СССР', 'Россия'], ['Российская империя', 'Россия'], ['РСФСР', 'Россия'],
  ['Англия', 'Великобритания'], ['Королевство Англия', 'Великобритания'], ['Соединённое Королевство Великобритании и Ирландии', 'Великобритания'],
  ['Британская империя', 'Великобритания'], ['Великобритания (Англия)', 'Великобритания'],
  ['Германская империя', 'Германия'], ['Веймарская республика', 'Германия'], ['Германский рейх', 'Германия'], ['Саксен-Веймар', 'Германия'],
  ['Древняя Греция', 'Греция'], ['Древний Рим', 'Италия'], ['Флорентийская республика', 'Италия'],
  ['Южная Корея', 'Республика Корея'],
])

const GENRE_RULES = [
  ['Фантастика', /фантаст|киберпанк|космическ|апокалип|альтернативная история|литература о вторжении/i],
  ['Фэнтези', /фэнтези|магический реализм|феерия|сказк|произведение о вампирах/i],
  ['Приключения', /приключ|робинзонад|пират|вестерн|рыцарск|плутовск|навигацион/i],
  ['Детектив', /детектив|криминаль|нуар|юридическ/i],
  ['Триллер', /триллер|мистери|сенсацион/i],
  ['Ужасы', /ужас|хоррор|готик|литература странного/i],
  ['Романтика', /любов|романтическ|мелодрам|эротическ/i],
  ['Историческое', /истор|войн|армейск|холокост|эпос|эпопе|сказание/i],
  ['Детское и подростковое', /детск|подрост|нью-эдалт|взрослен|воспитани/i],
  ['Драма', /драм|трагед|социальн|семейн|нравов|современност/i],
  ['Юмор и сатира', /сатир|комед|юмор|парод|чёрный юмор|фельетон/i],
  ['Философское', /философ|экзистенц|аллегор|эзотер/i],
  ['Экспериментальное', /абсурд|антироман|гипертекст|модернизм|постмодерн|метапроз|трансгрессив|эксперимент|эпистоляр|найденной рукописи/i],
  ['Классика', /классик|литература xx века|викториан|романтизм|неоромантизм|критический реализм/i],
  ['Биографическое', /автобиограф|исповедаль/i],
  ['Поэзия и театр', /поэз|поэма|театр|басня/i],
]

const FALLBACK_GENRE = 'Проза'

export const normalizeLanguage = (value) => LANGUAGE_MAP.get(String(value ?? '').trim()) ?? String(value ?? '').replace(/ язык$/i, '').trim()
export const normalizeCountry = (value) => COUNTRY_MAP.get(String(value ?? '').trim()) ?? String(value ?? '').trim()
export const normalizeGenres = (genres) => {
  const raw = compact(Array.isArray(genres) ? genres : [])
  const normalized = compact(GENRE_RULES.filter(([, rule]) => raw.some((genre) => rule.test(genre))).map(([label]) => label))
  return normalized.length ? normalized : [FALLBACK_GENRE]
}

const escapeRegExp = (value) => value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
const accentInsensitivePattern = (value) => [...String(value ?? '').normalize('NFD').replace(/\p{M}+/gu, '')]
  .map((character) => `${escapeRegExp(character)}\\p{M}*`)
  .join('')
const sanitizeClue = (value, titles) => {
  let result = String(value ?? '').trim()
  for (const title of compact(titles).sort((a, b) => b.length - a.length)) {
    if (normalizeText(title).length < 3) continue
    result = result.normalize('NFD').replace(new RegExp(accentInsensitivePattern(title), 'giu'), 'это произведение').normalize('NFC')
  }
  return result.replace(/\s+/g, ' ').trim()
}

const EDITORIAL_CHARACTER_REMOVALS = new Map([
  ['book-300', new Set(['питер паркер'])],
])

const splitAwards = (value) => compact(String(value ?? '').split(/\s*;\s*/))
const safeCoverUrl = (value) => {
  const url = String(value ?? '').trim()
  if (!url) return null
  if (/\.djvu(?:$|\?)/i.test(url)) return `${url}${url.includes('?') ? '&' : '?'}width=720&page=1`
  return url
}

export const buildBookItem = (raw, index) => {
  const names = raw?.['Название'] ?? {}
  const id = String(raw?.['ID книги'] ?? '').trim()
  const titleRu = String(names?.['На русском'] ?? '').trim()
  const titleOriginal = String(names?.['На языке оригинала'] ?? '').trim()
  const author = String(raw?.['Автор'] ?? '').trim()
  const year = Number(raw?.['Год публикации'])
  const adaptations = raw?.['Экранизации'] ?? {}
  const adaptationYears = compact(Array.isArray(adaptations?.['Годы основных экранизаций']) ? adaptations['Годы основных экранизаций'] : [])
    .map(Number).filter(Number.isFinite).sort((a, b) => a - b)
  const adaptationDeclared = Object.values(adaptations).some((value) => normalizeText(value) === '\u0434\u0430')
  const hasAdaptation = adaptationDeclared || adaptationYears.length > 0
  const awards = splitAwards(raw?.['Премии'])
  const removals = EDITORIAL_CHARACTER_REMOVALS.get(id) ?? new Set()
  const characters = compact(Array.isArray(raw?.['Главные персонажи']) ? raw['Главные персонажи'] : [])
    .filter((character) => !removals.has(normalizeText(character)))
    .filter((character) => ![titleRu, titleOriginal].some((title) => normalizeText(character) === normalizeText(title)))
  const bookGenresRaw = compact(Array.isArray(raw?.['Жанры']) ? raw['Жанры'] : [])
  const plotHint = sanitizeClue(raw?.['Аннотация'], [titleRu, titleOriginal])
  const alternativeTitles = titleOriginal && normalizeText(titleOriginal) !== normalizeText(titleRu) ? [titleOriginal] : []
  const bookPublicationYear = Number.isFinite(year) ? year : null

  return {
    id,
    mode: 'book',
    titleRu,
    titleOriginal,
    alternativeTitles,
    ...(bookPublicationYear != null && bookPublicationYear >= 1800 ? { year: bookPublicationYear } : {}),
    countries: compact([normalizeCountry(raw?.['Страна происхождения'])]),
    originalLanguage: normalizeLanguage(raw?.['Язык оригинала']),
    genres: normalizeGenres(bookGenresRaw),
    popularityScore: Number(Math.max(0.2, 1 - index / 360).toFixed(4)),
    posterUrl: safeCoverUrl(raw?.['Ссылка на обложку']),
    description: plotHint || null,
    plotHint: plotHint || null,
    topRank: index + 1,
    aliases: alternativeTitles,
    sourceFlags: ['books-enriched-import'],
    dailyEligible: true,
    reviewStatus: 'machine_verified',
    contentStatus: 'ready',
    allowedInGame: true,
    dataQuality: {
      source: ['user-provided-books-enriched-full'],
      verified: false,
      missingFields: [],
    },
    bookRank: index + 1,
    bookAuthors: compact([author]),
    bookCountry: normalizeCountry(raw?.['Страна происхождения']),
    bookOriginalLanguage: normalizeLanguage(raw?.['Язык оригинала']),
    bookPublicationYear,
    bookGenres: normalizeGenres(bookGenresRaw),
    bookGenresRaw,
    isPartOfSeries: normalizeText(raw?.['Часть цикла']) === 'да',
    hasAdaptation,
    bookAdaptationYears: adaptationYears,
    // Some source cards only confirm that an adaptation exists without listing
    // every release year. Preserve that fact without rendering the impossible
    // combination "adaptation: yes / count: 0" in the comparison grid.
    bookAdaptationCount: hasAdaptation ? Math.max(1, adaptationYears.length) : 0,
    hasAwards: awards.length > 0,
    bookAwards: awards,
    bookMainCharacters: characters,
    bookCoverSourceUrl: String(raw?.['Ссылка на обложку'] ?? '').trim() || null,
  }
}

const validate = (items) => {
  const issues = []
  const ids = new Set()
  for (const item of items) {
    if (!item.id || !item.titleRu || !item.bookAuthors.length) issues.push(`${item.id || '(unknown)'}: missing identity`)
    if (ids.has(item.id)) issues.push(`${item.id}: duplicate id`)
    ids.add(item.id)
    if (!item.posterUrl) issues.push(`${item.id}: missing cover`)
    if (!item.plotHint) issues.push(`${item.id}: missing plot hint`)
    if (item.hasAdaptation && item.bookAdaptationCount < 1) issues.push(`${item.id}: adaptation is declared but count is zero`)
    if (!item.hasAdaptation && item.bookAdaptationCount !== 0) issues.push(`${item.id}: adaptation count exists without an adaptation`)
    const normalizedHint = normalizeText(item.plotHint)
    for (const title of [item.titleRu, item.titleOriginal]) {
      const normalizedTitle = normalizeText(title)
      if (normalizedTitle.length >= 3 && normalizedHint.includes(normalizedTitle)) issues.push(`${item.id}: title leaks into plot hint`)
    }
  }
  return issues
}

const main = () => {
  const externalSource = argValue('source')
  if (externalSource) {
    const resolved = path.resolve(externalSource)
    fs.mkdirSync(path.dirname(CANONICAL_SOURCE), { recursive: true })
    if (resolved !== CANONICAL_SOURCE) fs.copyFileSync(resolved, CANONICAL_SOURCE)
  }
  if (!fs.existsSync(CANONICAL_SOURCE)) throw new Error(`Book source is missing: ${CANONICAL_SOURCE}. Pass --source=<path> once.`)

  const raw = readJson(CANONICAL_SOURCE)
  if (!Array.isArray(raw)) throw new Error('Book source root must be an array')
  const items = raw.map(buildBookItem)
  const issues = validate(items)
  if (issues.length) throw new Error(`Book library validation failed:\n${issues.slice(0, 30).join('\n')}`)

  writeJson(GENERATED_SOURCE, items)
  writeJson(REPORT_PATH, {
    generatedAt: new Date().toISOString(),
    source: path.relative(ROOT, CANONICAL_SOURCE).replaceAll('\\', '/'),
    total: items.length,
    playable: items.filter((item) => item.allowedInGame && item.contentStatus === 'ready').length,
    withCovers: items.filter((item) => item.posterUrl).length,
    withPlotHints: items.filter((item) => item.plotHint).length,
    withCharacters: items.filter((item) => item.bookMainCharacters.length).length,
    withAdaptations: items.filter((item) => item.hasAdaptation).length,
    withAwards: items.filter((item) => item.hasAwards).length,
    normalizedGenres: Object.fromEntries([...new Set(items.flatMap((item) => item.bookGenres))].sort().map((genre) => [genre, items.filter((item) => item.bookGenres.includes(genre)).length])),
  })
  console.log(`books: ${items.length} cards written to ${path.relative(ROOT, GENERATED_SOURCE)}`)
}

if (import.meta.url === pathToFileURL(process.argv[1]).href) main()

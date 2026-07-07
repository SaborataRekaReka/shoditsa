const STOPWORDS = new Set([
  'the',
  'and',
  'for',
  'with',
  'that',
  'this',
  'from',
  'into',
  'about',
  'book',
  'movie',
  'film',
  'part',
  'episode',
  'edition',
  'story',
  'история',
  'фильм',
  'часть',
  'серия',
  'глава',
])

const STORY_NAME_RE = /\b(?:[А-ЯЁ][а-яё]{2,}|[A-Z][a-z]{2,})(?:[- ](?:[А-ЯЁ][а-яё]{2,}|[A-Z][a-z]{2,})){1,2}\b/g
const SENTENCE_LEAD_NAME_RE = /(^|[.!?]\s+)([А-ЯЁ][а-яё]{2,}(?:[- ][А-ЯЁ][а-яё]{2,}){0,2}|[A-Z][a-z]{2,}(?:[- ][A-Z][a-z]{2,}){0,2})(?=\s+(?:[—-]|работает|жив[её]т|пытается|должен|должна|вынужден|вынуждена|оказывается|становится|находит|получает|узна[её]т|обвин[её]н|осужд[её]н|отправляется|ищет|спасает|теряет|нанимает|мечтает|обещает|решает)\b)/g
const PRODUCTION_FACT_RE = /(съ[её]м|режисс|сценар|акт[её]р|актрис|каскад|декорац|оператор|монтаж|прем|оскар|нагр|экраниз|костюм|грим|саундтрек|музык|озвуч|бюджет|локац|студ|постер|адаптац|дубл|трюк|кадр|спецэффект|анимац|номинац|прокат)/i
const WORD_CHAR_CLASS = 'A-Za-zА-Яа-яЁё0-9'
const MOVIE_OVERRIDES = {
  kp_355: {
    plotHint: 'Выдающийся еврейский музыкант пытается пережить оккупацию Варшавы и нацистский террор.',
    description: 'Выдающийся музыкант теряет привычную жизнь после прихода нацистов и пытается пережить оккупацию, гетто и разрушение Варшавы.',
  },
  kp_41519: {
    plotHint: 'Молодой дембель приезжает в Петербург к родственнику и оказывается втянут в криминальные разборки.',
    description: 'Вернувшийся из армии парень едет в большой город к родственнику, но быстро понимает, что тот живет по законам жестокого криминального мира.',
  },
  kp_2213: {
    plotHint: 'На борту роскошного лайнера начала XX века вспыхивает любовь между людьми из разных миров.',
    description: 'Во время первого рейса огромного океанского лайнера встречаются двое молодых людей из совершенно разных слоев общества, и их роман разворачивается на фоне надвигающейся катастрофы.',
  },
  kp_2127: {
    plotHint: 'Бродяга неожиданно становится опекуном оставленного ребёнка.',
    description: 'Одинокий бродяга берёт на себя заботу о ребёнке, и их случайный союз превращается в трогательную историю выживания и привязанности.',
  },
  kp_430: {
    plotHint: 'Нелюдимый великан вынужден отправиться в опасное путешествие, чтобы вернуть себе спокойную жизнь.',
    description: 'Большой зелёный отшельник лишается привычного уединения и вынужден заключить сделку, которая втягивает его в дорогу, спасение пленницы и столкновение со сказочным миром.',
  },
  kp_4664634: {
    plotHint: 'Биографическая драма о физике, возглавившем создание ядерного оружия во время Второй мировой войны.',
    description: 'История американского физика, который руководит секретным военным проектом и сталкивается с моральной ценой научного прорыва.',
  },
  kp_596125: {
    plotHint: 'В 1970-е два пилота «Формулы-1» доводят соперничество до предела физических и психологических возможностей.',
    description: 'Два выдающихся автогонщика с противоположными характерами превращают борьбу за чемпионство в личную дуэль, где каждая ошибка может стоить жизни.',
  },
  kp_44467: {
    plotHint: 'Собрание кооператива превращается в жестокий спор о том, кому не хватит места.',
    description: 'Обычное заседание пайщиков быстро вскрывает эгоизм, страх и лицемерие людей, когда выясняется, что ресурсов на всех не хватит.',
  },
  kp_1048334: {
    plotHint: 'Неудачливый комик в мрачном мегаполисе постепенно превращается в символ хаоса.',
    description: 'Одинокий человек, мечтающий смешить людей, сталкивается с унижением, насилием и безразличием общества, а затем выбирает путь разрушения.',
  },
  kp_102198: {
    plotHint: 'Вена начала XX века. Загадочный фокусник бросает вызов власти и прошлому.',
    description: 'В столице Австро-Венгрии появляется загадочный мастер сцены, чьи представления затрагивают старые чувства, тайны и интересы влиятельных людей.',
  },
  kp_664: {
    plotHint: 'Успешному финансисту показывают, какой могла бы стать его жизнь при другом выборе.',
    description: 'Богатый и самоуверенный бизнесмен внезапно оказывается внутри альтернативной версии собственной судьбы, где главное место занимают семья и повседневная близость.',
  },
  kp_14349: {
    plotHint: 'Невезучий полицейский объединяется с безбашенным водителем ради охоты на банду грабителей.',
    description: 'Суетливый инспектор получает неожиданного союзника в лице уличного лихача, и вместе они пытаются остановить преступников, ускользающих от полиции.',
  },
  kp_7651: {
    plotHint: 'Женщина с сыном связывает жизнь с обаятельным человеком, который оказывается опасным мошенником.',
    description: 'Молодая мать и её сын впускают в дом харизматичного мужчину, но за привлекательной внешностью скрываются криминальные привычки и разрушительная ложь.',
  },
  kp_45028: {
    plotHint: 'Выпускник школы случайно раздражает взрослых своим свободным взглядом на жизнь.',
    description: 'Юноша из позднесоветской Москвы устраивается на простую работу и своим непредсказуемым поведением вскрывает растерянность и фальшь мира взрослых.',
  },
  kp_507: {
    plotHint: 'Из будущего в 1984 год прибывают солдат и киборг, и от исхода их преследования зависит судьба человечества.',
    description: 'В прошлом сталкиваются человек и машина, присланные из постапокалиптического будущего, где война людей и технологий уже почти проиграна.',
  },
  kp_43911: {
    plotHint: 'Психолог прилетает на орбитальную станцию, где учёных преследуют материализованные воспоминания.',
    description: 'Новый специалист прибывает на станцию у загадочной планеты и постепенно понимает, что столкнулся не с технической неисправностью, а с чем-то, меняющим саму природу реальности.',
  },
  kp_2119: {
    plotHint: 'Грустная комедия о бродяге, который случайно становится частью гастролирующего шоу.',
    description: 'Неуклюжий бедняк по воле случая оказывается среди артистов и превращает рабочий хаос под куполом в цепочку комических и трогательных эпизодов.',
  },
  kp_5437614: {
    plotHint: 'Биографическая драма о пути короля поп-музыки от ранних лет к мировой славе.',
    description: 'История артиста, который с детства живёт под давлением сцены и со временем становится одной из самых узнаваемых фигур мировой поп-культуры.',
  },
  kp_636: {
    plotHint: 'В закрытом провинциальном городке появляется женщина, которая меняет жизнь соседей своей лавкой сладостей.',
    description: 'Приезжая хозяйка необычной лавки постепенно расшатывает строгий уклад маленького французского городка, пробуждая в его жителях забытые желания.',
  },
  kp_2058: {
    plotHint: 'Биографическая драма о пути великого комика от бедного детства к мировому успеху.',
    description: 'Фильм прослеживает дорогу выдающегося артиста от нищеты и сценической подёнщины до всемирной известности и режиссёрского признания.',
  },
  kp_544: {
    plotHint: 'Мальчик прячет дома потерявшегося гостя с другой планеты и пытается помочь ему вернуться.',
    description: 'Ребёнок заводит дружбу с существом, случайно оставшимся на Земле, и вместе с близкими пытается спасти его от взрослых и вернуть домой.',
  },
  kp_475: {
    plotHint: 'Раб-гладиатор поднимает восстание против Рима и становится символом свободы.',
    description: 'История пленника, который проходит путь от арены до масштабного бунта, бросающего вызов самой мощной империи своего времени.',
  },
  kp_722827: {
    plotHint: 'Бывший исполнитель роли культового супергероя пытается вернуть себе вес на Бродвее.',
    description: 'Актёр, давно зависший в тени старого экранного образа, ставит театральную пьесу и одновременно сражается с тщеславием, страхом и распадом собственной личности.',
  },
  kp_584405: {
    plotHint: 'Двое напарников документируют опасные будни на улицах Лос-Анджелеса.',
    description: 'Напарники из полицейского района шаг за шагом погружаются в более опасный круг насилия, пока один из них фиксирует их рутину на любительскую камеру.',
  },
  kp_542484: {
    plotHint: 'Большая семья в донской степи живёт под одной крышей, но не может договориться друг с другом.',
    description: 'Под крышей большого семейного гнезда копятся старые обиды, взаимные претензии и скрытое насилие, превращая родственные связи в поле затяжной войны.',
  },
  kp_652: {
    plotHint: 'Доисторическое стадо отправляется в опасный путь к земле, где ещё можно выжить.',
    description: 'После катастрофы группа древних животных ищет новый дом и вынуждена преодолевать враждебную природу, жестокую иерархию и постоянную нехватку ресурсов.',
  },
  kp_2349: {
    plotHint: 'Музыкальная история о школьной любви, статусе и попытке соответствовать чужим ожиданиям в Америке 1950-х.',
    description: 'Роман двух подростков разворачивается среди школьных компаний, танцев, автомобилей и давления модных ролей в солнечной Америке послевоенного десятилетия.',
  },
  kp_6871: {
    plotHint: 'Путешественник отправляется по карте к тайному острову, который обещает рай и приносит разлад.',
    description: 'Молодой искатель впечатлений получает карту к якобы идеальному месту и быстро понимает, что мечта о свободе может превратиться в опасную иллюзию.',
  },
  kp_4554: {
    plotHint: 'Воин с вампирской кровью охотится на того, кто сделал его таким.',
    description: 'Полукровка, стоящий между людьми и ночными хищниками, ведёт личную войну против существа, которое изменило его судьбу и хочет захватить власть.',
  },
  kp_5221: {
    plotHint: 'Команда бывших спецов получает заказ на похищение загадочного кейса, но быстро перестаёт доверять друг другу.',
    description: 'Группа наёмников с военным прошлым берётся за простую на вид операцию и оказывается внутри цепочки предательств, двойной игры и жёстких уличных погонь.',
  },
  kp_6668: {
    plotHint: 'Полярная экспедиция встречает учёного, рассказ которого ведёт к трагическому эксперименту над жизнью и смертью.',
    description: 'В ледяной пустыне исследователь подбирает измождённого человека, чья исповедь постепенно раскрывает историю научной одержимости и чудовищных последствий.',
  },
  kp_5528: {
    plotHint: 'Холодный светский аристократ слишком поздно понимает цену чужого чувства.',
    description: 'Скучающий дворянин отвергает искреннюю любовь, вступает в череду роковых ошибок и лишь спустя годы осознаёт, что потерял главное.',
  },
  kp_433: {
    plotHint: 'Биографическая военная драма о темпераментном американском генерале, чьи решения влияют на ход войны.',
    description: 'История яркого и тяжёлого в общении военачальника, чья энергия, амбиции и вспыльчивость заметно влияют на крупные операции союзников.',
  },
  kp_679: {
    plotHint: 'Вдова с необычными видениями помогает расследовать убийство в небольшом городе.',
    description: 'Женщина, обладающая странной чувствительностью к чужим тайнам, оказывается втянута в расследование жестокого преступления и сталкивается с тем, что предпочитала не видеть.',
  },
}

export const cleanText = (value) => String(value || '').replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim()

const escapeRegExp = (value) => String(value || '').replace(/[.*+?^${}()|[\]\\]/g, '\\$&')

const normalize = (value) => cleanText(value)
  .toLowerCase()
  .replace(/&/g, ' and ')
  .replace(/[«»"'`]/g, ' ')
  .replace(/[^a-z0-9а-яё\s-]/gi, ' ')
  .replace(/\s+/g, ' ')
  .trim()

const unique = (items) => [...new Set(items.filter(Boolean))]

const titleTokens = (title) => unique(normalize(title)
  .split(' ')
  .filter((token) => {
    if (!token || STOPWORDS.has(token)) return false
    if (/^\d+$/.test(token)) return true
    if (/^[ivxlcdm]+$/i.test(token)) return true
    return token.length >= 4
  }))

const titleVariants = (title) => unique([
  cleanText(title),
  cleanText(title).replace(/\s*\([^)]*\)/g, '').trim(),
  cleanText(title).replace(/:\s.*$/, '').trim(),
])

const personNames = (movie) => unique([
  ...(movie.cast ?? []),
  ...(movie.supportingCast ?? []),
  ...(movie.directors ?? []),
  ...(movie.writers ?? []),
  ...(movie.showrunners ?? []),
].flatMap((person) => [cleanText(person?.nameRu), cleanText(person?.nameOriginal)]))

const buildContext = (movie) => {
  const titles = unique([
    movie.titleRu,
    movie.titleOriginal,
    ...(movie.alternativeTitles ?? []),
  ].flatMap(titleVariants))

  const titleWords = unique(titles.flatMap(titleTokens))
  const people = personNames(movie)
  const peopleWords = unique(people.flatMap((name) => normalize(name).split(' ').filter((token) => token.length >= 5)))

  return { titles, titleWords, people, peopleWords }
}

const boundedPattern = (value) => `(^|[^${WORD_CHAR_CLASS}])${escapeRegExp(value)}(?=$|[^${WORD_CHAR_CLASS}])`

const replacePhrases = (text, phrases, replacement = ' ') => {
  let result = text
  for (const phrase of phrases) {
    if (!phrase) continue
    result = result.replace(new RegExp(boundedPattern(phrase), 'giu'), `$1${replacement}`)
  }
  return result
}

const replaceTokens = (text, tokens, replacement = ' ') => {
  let result = text
  for (const token of tokens) {
    if (!token) continue
    result = result.replace(new RegExp(boundedPattern(token), 'giu'), `$1${replacement}`)
  }
  return result
}

const normalizePunctuation = (text) => text
  .replace(/\s+/g, ' ')
  .replace(/\s+([,.;:!?])/g, '$1')
  .replace(/([,.;:!?]){2,}/g, '$1')
  .replace(/^[\s,;:!?-]+/, '')
  .replace(/[\s,;:!?-]+$/, '')
  .trim()

const maskNarrativeNames = (text) => normalizePunctuation(text
  .replace(SENTENCE_LEAD_NAME_RE, '$1Главный персонаж')
  .replace(STORY_NAME_RE, 'персонаж'))

const sanitizeText = (text, context) => {
  let result = cleanText(text)
  if (!result) return ''

  result = replacePhrases(result, context.titles)
  result = replaceTokens(result, context.titleWords)
  result = replacePhrases(result, context.people)
  result = replaceTokens(result, context.peopleWords)
  result = maskNarrativeNames(result)
  result = result
    .replace(/\(\s*\)/g, ' ')
    .replace(/\[\s*\]/g, ' ')
    .replace(/\s+[—-]\s+/g, ' — ')
  return normalizePunctuation(result)
}

const splitSentences = (text) => cleanText(text).match(/[^.!?]+[.!?]?/g) ?? []

const cropText = (text, maxLength) => {
  const value = normalizePunctuation(text)
  if (!value) return ''
  return value.length > maxLength ? `${value.slice(0, maxLength).trimEnd()}...` : value
}

const buildFallbackPlot = (movie) => {
  const genres = (movie.genres ?? []).slice(0, 2).join(', ')
  const prefix = genres ? `${genres[0].toUpperCase()}${genres.slice(1)}-история` : 'История'
  return `${prefix} о сложном выборе, давлении обстоятельств и последствиях принятых решений.`
}

const buildNarrative = (text, context, { maxLength, maxSentences }) => {
  const sanitized = sanitizeText(text, context)
  if (!sanitized) return ''

  const picked = []
  for (const sentence of splitSentences(sanitized)) {
    const cleanSentence = normalizePunctuation(sentence)
    if (!cleanSentence) continue
    picked.push(cleanSentence)
    if (picked.length >= maxSentences) break
    if (picked.join(' ').length >= maxLength) break
  }

  return cropText(picked.join(' '), maxLength)
}

const riskHits = (text, context) => {
  const normalized = normalize(text)
  if (!normalized) return { titleHits: [], peopleHits: [] }
  const titleHits = context.titleWords.filter((token) => token && normalized.includes(token))
  const peopleHits = context.peopleWords.filter((token) => token && normalized.includes(token))
  return {
    titleHits: unique(titleHits),
    peopleHits: unique(peopleHits),
  }
}

const isRisky = (text, context) => {
  const hits = riskHits(text, context)
  STORY_NAME_RE.lastIndex = 0
  return hits.titleHits.length > 0 || hits.peopleHits.length > 0 || STORY_NAME_RE.test(text)
}

const sanitizeFacts = (facts, context) => {
  return (facts ?? [])
    .map((fact) => sanitizeText(fact, context))
    .filter((fact) => fact.length >= 40)
    .filter((fact) => PRODUCTION_FACT_RE.test(fact))
    .filter((fact) => !isRisky(fact, context))
    .slice(0, 3)
}

export const auditMovieRecord = (movie) => {
  const context = buildContext(movie)
  const hits = []
  const fields = [
    ['plotHint', movie.plotHint],
    ['description', movie.description],
    ['slogan', movie.slogan],
    ...((movie.facts ?? []).map((fact, index) => [`fact[${index}]`, fact])),
  ]

  for (const [field, value] of fields) {
    const text = cleanText(value)
    if (!text) continue
    const risk = riskHits(text, context)
    const nameMatch = text.match(STORY_NAME_RE)
    if (risk.titleHits.length || risk.peopleHits.length || nameMatch) {
      hits.push({
        field,
        titleHits: risk.titleHits,
        peopleHits: risk.peopleHits,
        properNames: unique(nameMatch ?? []).slice(0, 4),
      })
    }
  }

  return { risky: hits.length > 0, hits }
}

export const sanitizeMovieRecord = (movie) => {
  const context = buildContext(movie)
  const plotSource = cleanText(movie.plotHint || movie.description || '')
  const descriptionSource = cleanText(movie.description || movie.plotHint || '')
  const basePlotHint = buildNarrative(plotSource, context, { maxLength: 190, maxSentences: 2 }) || buildFallbackPlot(movie)
  const baseDescription = buildNarrative(descriptionSource, context, { maxLength: 420, maxSentences: 3 }) || basePlotHint
  const sloganCandidate = cropText(sanitizeText(movie.slogan, context), 140)
  const slogan = sloganCandidate && sloganCandidate.length >= 16 && !isRisky(sloganCandidate, context) ? sloganCandidate : null
  const facts = sanitizeFacts(movie.facts, context)
  const overrides = MOVIE_OVERRIDES[movie.id] ?? null
  const plotHint = overrides?.plotHint ?? basePlotHint
  const description = overrides?.description ?? baseDescription

  return {
    ...movie,
    plotHint,
    description,
    slogan,
    facts,
  }
}
import fs from 'node:fs'
import path from 'node:path'

const ROOT = process.cwd()
const DATA_PATHS = [
  'public/data/libraries/music/items.json',
  'public/data/music.generated.json',
]
const INDEX_PATH = 'public/data/libraries/music/search-index.json'

const normalize = (value) => String(value ?? '')
  .normalize('NFKC')
  .toLocaleLowerCase('ru-RU')
  .replace(/ё/g, 'е')
  .replace(/[^a-zа-я0-9]+/gi, ' ')
  .trim()

const tokenize = (value) => normalize(value)
  .split(/\s+/)
  .map((token) => token.trim())
  .filter((token) => token.length >= 2)

const unique = (values) => [...new Set(values)]
const removeValues = (values, unwanted) => (Array.isArray(values) ? values : [])
  .filter((value) => !unwanted.has(String(value)))
const removeLinks = (values, unwantedIds) => (Array.isArray(values) ? values : [])
  .filter((url) => {
    const text = String(url ?? '').trim()
    if (!text || text === 'https://1') return false
    return ![...unwantedIds].some((id) => text.includes(id))
  })
const withoutImagePatterns = (values, patterns) => (Array.isArray(values) ? values : [])
  .filter((url) => !patterns.some((pattern) => String(url).toLocaleLowerCase('en-US').includes(pattern)))
const rerank = (values) => values.map((value, index) => ({ ...value, rank: index + 1 }))

const HINTS = {
  'music:001_michael-jackson': 'Американский певец начал карьеру ребёнком в семейной группе, а позже превратил поп-концерт в синтез вокала, хореографии и кинематографичных клипов.',
  'music:015_andy-panda': 'Осетинский рэпер сменил ранний сценический образ на имя с чёрно-белым зверем и вместе с постоянным партнёром записал один из крупнейших русскоязычных хитов YouTube.',
  'music:024_by-индия': 'Белорусский R&B-исполнитель соединяет мягкую вокальную подачу, современный бит и атмосферу ночного клубного попа.',
  'music:025_hugel': 'Французский диджей из Марселя соединяет хаус с латинскими ритмами и превращает знакомые мелодии в фестивальные танцевальные версии.',
  'music:043_navai': 'Один из двух азербайджанских голосов популярного московского дуэта продолжил сольную карьеру в мелодичном поп-рэпе с литературными и дорожными образами.',
  'music:045_da-ti': 'Англоязычный электронный проект середины 2020-х соединяет клубный поп с цифровой эстетикой и сохраняет минимум публичной информации об авторе.',
  'music:056_александра-чистякова': 'Молодая русскоязычная певица начала выпускать заметные релизы в 2020-х и работает в современной поп-эстетике с акцентом на сольный вокал.',
  'music:092_фара-ночи': 'Русскоязычный поп-проект 2026 года строит песни вокруг романтических образов моря, вечернего города и внезапного расставания.',
  'music:093_skryptonite': 'Живой коллектив из Казахстана переносит рэп-материал своего основателя в формат инструментальной группы с джазовыми красками и импровизацией.',
  'music:102_10age': 'Петербургский рэпер конца 2010-х соединяет мрачную интонацию, поп-мелодику и резкий хип-хоп-бит; широкую известность ему принесли песни о внутренней пустоте.',
  'music:111_sabi': 'Российская поп-певица с азербайджанскими корнями получила вирусную известность в 2025 году благодаря ироничной песне-списку требований к отношениям.',
  'music:136_папин-олимпос': 'Волгоградская группа соединяет поп-панк с подростковой тоской, школьными сюжетами и яркими образами провинциального взросления.',
  'music:146_ray-charles': 'Слепой американский пианист соединил госпел, блюз и ритм-н-блюз и стал одним из ключевых музыкантов раннего соула.',
  'music:160_ленинград': 'Петербургская группа соединяет духовые аранжировки, панк-кабаре и сатирические песни о бытовой жизни; концерты держатся на театральной провокации.',
  'music:195_rhyme': 'Казахстанский поп- и хип-хоп-исполнитель соединяет мелодичный вокал с танцевальными ритмами и часто записывает совместные треки с артистами местной сцены.',
  'music:199_dsprite': 'Русскоязычный интернет-артист строит короткие меланхоличные треки вокруг личных обращений, летних воспоминаний и цифровой эстетики.',
  'music:216_barabanov': 'Русскоязычный проект 2020-х работает в современной поп-эстетике и строит песни вокруг личных переживаний и лаконичных электронных аранжировок.',
  'music:237_janeen': 'Продюсер русско-грузинского происхождения выпускает современную электронную музыку под международно оформленным сценическим именем.',
  'music:242_dj-biakoff': 'Русскоязычный электронный проект 2020-х выпускает лёгкие поп-треки о расставании, контрастных чувствах и повседневных радостях.',
  'music:243_darksn-w': 'Интернет-артист 2020-х строит мрачный электронный образ вокруг холодной эстетики и стилизованного латинского написания.',
  'music:246_eminem': 'Рэпер из Детройта построил творчество на технически плотной рифмовке, чёрном юморе и конфликте между публичным образом и вымышленным персонажем.',
  'music:272_bruce-springsteen': 'Американский рок-автор превращает истории рабочих городов и дальних дорог в марафонские концерты, где важную роль играет саксофон.',
  'music:273_jerry-lee-lewis': 'Американский пионер рок-н-ролла сделал фортепиано столь же агрессивным, как гитару: играл стоя и ногами, соединяя кантри, буги-вуги и сценический азарт.',
  'music:284_madonna': 'Американская поп-певица десятилетиями меняла сценические образы, соединяя танцевальную музыку с провокационными темами религии, пола и массовой культуры.',
  'music:305_parliament-funkadelic': 'Большой американский фанк-коллектив превратил концерты в афрофутуристическое шоу с космическими декорациями и сильно повлиял на хип-хоп-сэмплинг.',
  'music:331_black-sabbath': 'Четверо музыкантов из промышленного Бирмингема сделали тяжёлые риффы, тритон и мрачные тексты основой раннего хеви-метала.',
  'music:352_billie-holiday': 'Американская джазовая певица 1930–1950-х пела с хрупкой, чуть запаздывающей фразировкой и часто выходила на сцену с гардениями в волосах.',
  'music:361_george-jones': 'Кантри-певец с выразительным голосом превращал истории утраты и сожаления в драматические баллады; бурная концертная репутация стала частью его легенды.',
  'music:404_t-rex': 'Британская группа начала с психоделического фолка, затем упростила риффы, добавила блёстки и стала одним из главных двигателей раннего глэм-рока.',
  'music:417_santana': 'Латиноамериканская перкуссия и протяжный гитарный тон вывели эту группу на Вудсток; спустя три десятилетия она снова поднялась на вершины чартов.',
  'music:476_soundgarden': 'Сиэтлская группа соединяла необычные размеры, тяжёлые риффы и мощный голос с широким диапазоном; её музыка стала одной из опор гранжа.',
  'music:484_primus': 'Американское трио сделало бас ведущим инструментом и соединило фанк-метал с абсурдными историями о рыбаках, гонщиках и других странных персонажах.',
  'music:495_3-doors-down': 'Американская пост-гранж-группа из Миссисипи стала заметной в начале 2000-х благодаря мелодичному радиороку и мощному мужскому вокалу.',
}

const ALIAS_REMOVALS = {
  'music:001_michael-jackson': ['W.A. Mozart'],
  'music:014_bts': ['Voskresenie'],
  'music:089_tiesto': ['Maxi Jazz & Tiësto', 'Tiësto & Maxi Jazz'],
  'music:336_carlos-santana': ['Santana'],
  'music:347_b-b-king': ['Ben E. King'],
}

const BAD_LINK_IDS = {
  'music:051_ed-sheeran': ['deezer.com/artist/307678801'],
  'music:083_beyonce': ['open.spotify.com/artist/6HOb77B9Vyl7bdKj8YSfDS'],
  'music:134_ckay': ['deezer.com/artist/97160642'],
  'music:147_elton-john': ['deezer.com/artist/330392941'],
  'music:181_sean-paul': ['deezer.com/artist/266523712'],
  'music:229_alok': ['deezer.com/artist/62524832'],
  'music:253_elvis-presley': ['deezer.com/artist/252533572'],
  'music:286_john-lennon': ['open.spotify.com/artist/7wcH6naXfssACcXRregV1H'],
  'music:295_patti-smith': ['deezer.com/artist/10541665'],
  'music:312_the-kinks': ['deezer.com/artist/6979941'],
  'music:320_radiohead': ['deezer.com/artist/323887691'],
  'music:336_carlos-santana': ['open.spotify.com/artist/7yGQgQiiKpg2k00JXf8hJk'],
  'music:413_earth-wind-fire': ['deezer.com/artist/264926312'],
  'music:421_blondie': ['deezer.com/artist/12484470'],
  'music:458_rancid': ['deezer.com/artist/272620052'],
}

const DOWNGRADE_IDS = new Set([
  'music:099_антон-токарев',
  'music:117_ева-власова',
  'music:119_elman',
  'music:134_ckay',
  'music:138_chael',
  'music:174_igor-krutoy',
  'music:199_dsprite',
  'music:239_каспиискии-груз',
])

const updateItem = (item) => {
  const next = JSON.parse(JSON.stringify(item))
  const id = next.id

  if (HINTS[id]) next.plotHint = HINTS[id]

  const aliasesToRemove = new Set(ALIAS_REMOVALS[id] ?? [])
  if (aliasesToRemove.size) {
    next.alternativeTitles = removeValues(next.alternativeTitles, aliasesToRemove)
    next.aliases = removeValues(next.aliases, aliasesToRemove)
  }

  next.musicLinks = removeLinks(next.musicLinks, new Set(BAD_LINK_IDS[id] ?? []))

  if (id === 'music:001_michael-jackson') {
    next.genres = ['dance', 'dance-pop', 'disco', 'funk', 'pop', 'r&b', 'soul']
  }

  if (id === 'music:006_artik') {
    next.screenshots = withoutImagePatterns(next.screenshots, ['2024_%d0%b2%d0%b8%d0%b4_%d0%bd%d0%b0_%d0%b3%d0%be%d1%80%d0%be%d0%b4'])
  }

  if (id === 'music:010_adele') {
    const badHash = 'da6527a44f606d72ddf4010d'
    next.screenshots = withoutImagePatterns(next.screenshots, [badHash])
    next.posterUrl = null
    next.headerUrl = next.screenshots.find((url) => /banner/i.test(url)) ?? null
    next.backdropUrl = next.screenshots.find((url) => /fanart/i.test(url)) ?? next.headerUrl
  }

  if (id === 'music:028_полка') {
    next.screenshots = withoutImagePatterns(next.screenshots, ['la_polka'])
  }

  if (id === 'music:041_rocket') {
    next.screenshots = withoutImagePatterns(next.screenshots, ['soyuz_tma-9', 'apollo_11_saturn_v', 'chinese_rocket'])
  }

  if (id === 'music:055_марго-нуар' || id === 'music:056_александра-чистякова') {
    const unresolvedSharedArtwork = '71b71b8409b811a397aab267'
    for (const key of ['posterUrl', 'headerUrl', 'backdropUrl']) {
      if (String(next[key] ?? '').includes(unresolvedSharedArtwork)) next[key] = null
    }
    next.screenshots = withoutImagePatterns(next.screenshots, [unresolvedSharedArtwork])
  }

  if (id === 'music:093_skryptonite') {
    next.alternativeTitles = []
    next.aliases = []
    next.screenshots = withoutImagePatterns(next.screenshots, ['scriptonite.jpg'])
    next.topTracks = rerank((next.topTracks ?? []).filter((track) => normalize(track.title) === normalize('не расслабляйся')))
    next.topAlbums = rerank((next.topAlbums ?? []).filter((album) => normalize(album.title) === normalize('не расслабляйся')))
    next.similarArtists = []
    if (Array.isArray(next.dataQuality?.source)) {
      next.dataQuality.source = next.dataQuality.source.filter((source) => source !== 'lastfm')
    }
  }

  if (id === 'music:095_гуф' || id === 'music:109_tima-ishet-svet' || id === 'music:239_каспиискии-груз') {
    const placeholderHash = '2a96cbd8b46e442fc41c2b86b821562f'
    for (const key of ['posterUrl', 'headerUrl', 'backdropUrl']) {
      if (String(next[key] ?? '').includes(placeholderHash)) next[key] = null
    }
    next.screenshots = withoutImagePatterns(next.screenshots, [placeholderHash])
  }

  if (id === 'music:109_tima-ishet-svet') {
    const source = 'https://the-flow.ru/features/tima-ishchet-svet-intervyu'
    next.musicLinks = unique([...(next.musicLinks ?? []), source])
    if (Array.isArray(next.dataQuality?.missingFields)) {
      next.dataQuality.missingFields = next.dataQuality.missingFields.filter((field) => field !== 'canonical_link_missing')
    }
    if (Array.isArray(next.verification?.issues)) {
      next.verification.issues = next.verification.issues.filter((issue) => issue !== 'canonical_link_missing')
    }
  }

  if (id === 'music:336_carlos-santana') {
    next.genres = ['latin rock', 'blues rock', 'jazz rock']
    const soloTracks = new Set(['bella', 'europa', 'blues for salvador'])
    const soloAlbums = new Set(['the best instrumentals', 'live at the 1988 montreux jazz festival', 'havana moon'])
    next.topTracks = rerank((next.topTracks ?? []).filter((track) => soloTracks.has(normalize(track.title))))
    next.topAlbums = rerank((next.topAlbums ?? []).filter((album) => soloAlbums.has(normalize(album.title))))
    next.slogan = 'Blues for Salvador'
    next.plotHint = 'Мексиканско-американский гитарист сделал певучие длинные ноты узнаваемой подписью и соединил блюз-рок с афрокубинскими и латиноамериканскими ритмами.'
    next.facts = (next.facts ?? []).map((fact) => /трек №1/i.test(fact) ? 'Известная сольная запись: Blues for Salvador' : fact)
  }

  if (id === 'music:424_devo') {
    const badHash = 'da6527a44f606d72ddf4010d'
    next.year = 1973
    next.screenshots = withoutImagePatterns(next.screenshots, [badHash])
    next.posterUrl = next.screenshots.find((url) => /devo_2025/i.test(url)) ?? null
    next.headerUrl = next.screenshots.find((url) => /banner/i.test(url)) ?? null
    next.backdropUrl = next.screenshots.find((url) => /fanart/i.test(url)) ?? next.headerUrl
    for (const key of ['description', 'shortDescription']) {
      if (typeof next[key] === 'string') next[key] = next[key].replace(/1972/g, '1973')
    }
    next.facts = (next.facts ?? []).map((fact) => String(fact).replace(/1972/g, '1973'))
  }

  if (DOWNGRADE_IDS.has(id)) {
    next.contentStatus = 'limited'
    next.allowedInGame = false
    next.gameWeight = Math.min(Number(next.gameWeight) || 0, 0.2)
    if (next.dataQuality) next.dataQuality.verified = false
    if (next.verification) next.verification.status = 'needs_review'
  }

  return next
}

const buildSearchIndex = (items) => {
  const tokenMap = new Map()
  const docs = items.map((item) => {
    const names = [item.titleRu, item.titleOriginal, ...(item.alternativeTitles ?? [])].filter(Boolean)
    const seen = new Set()
    for (const name of names) {
      for (const token of tokenize(name)) {
        if (seen.has(token)) continue
        seen.add(token)
        const ids = tokenMap.get(token) ?? []
        ids.push(item.id)
        tokenMap.set(token, ids)
      }
    }
    return {
      id: item.id,
      titleRu: item.titleRu ?? null,
      titleOriginal: item.titleOriginal ?? null,
      alternativeTitles: item.alternativeTitles ?? [],
      year: Number.isFinite(item.year) ? item.year : null,
      topRank: Number.isFinite(item.topRank) ? item.topRank : null,
      steamAppId: item.steamAppId ?? null,
      icd10: item.icd10 ?? [],
    }
  })

  const tokenEntries = [...tokenMap.entries()]
    .sort((a, b) => a[0].localeCompare(b[0], 'ru-RU'))
    .map(([token, ids]) => [token, unique(ids).sort((a, b) => a.localeCompare(b, 'ru-RU'))])

  return {
    version: 1,
    library: 'music',
    generatedAt: new Date().toISOString(),
    totalItems: docs.length,
    tokensCount: tokenEntries.length,
    docs,
    tokenToIds: Object.fromEntries(tokenEntries),
  }
}

const arrays = DATA_PATHS.map((relativePath) => {
  const absolutePath = path.join(ROOT, relativePath)
  const payload = JSON.parse(fs.readFileSync(absolutePath, 'utf8'))
  if (!Array.isArray(payload)) throw new Error(`Expected array: ${relativePath}`)
  return { relativePath, absolutePath, payload }
})

const baseline = JSON.stringify(arrays[0].payload)
for (const entry of arrays.slice(1)) {
  if (JSON.stringify(entry.payload) !== baseline) {
    throw new Error(`Music runtime sources differ before update: ${arrays[0].relativePath} vs ${entry.relativePath}`)
  }
}

const updated = arrays[0].payload.map(updateItem)
for (const entry of arrays) {
  fs.writeFileSync(entry.absolutePath, `${JSON.stringify(updated, null, 2)}\n`, 'utf8')
  console.log(`Updated: ${entry.relativePath}`)
}

const index = buildSearchIndex(updated)
fs.writeFileSync(path.join(ROOT, INDEX_PATH), `${JSON.stringify(index, null, 2)}\n`, 'utf8')
console.log(`Updated: ${INDEX_PATH}`)
console.log(`Cards: ${updated.length}`)
console.log(`Hints rewritten: ${Object.keys(HINTS).length}`)

#!/usr/bin/env node

import { createHash } from 'node:crypto'
import { mkdir, readFile, writeFile } from 'node:fs/promises'
import { dirname, resolve } from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'

export const KPOP_PACK_ID = 'kpop-artists-admin-v1'

export const KPOP_GENERATIONS = [
  { generation: 1, from: 1990, to: 2004 },
  { generation: 2, from: 2005, to: 2011 },
  { generation: 3, from: 2012, to: 2017 },
  { generation: 4, from: 2018, to: 2022 },
  { generation: 5, from: 2023, to: null },
]

export const generationForDebutYear = (year) => {
  if (!Number.isInteger(year)) return null
  if (year <= 2004) return 1
  if (year <= 2011) return 2
  if (year <= 2017) return 3
  if (year <= 2022) return 4
  return 5
}

const text = (value) => typeof value === 'string' ? value.trim() : ''
const nullableText = (value) => text(value) || null
const stringList = (value) => Array.isArray(value) ? value.map(text).filter(Boolean) : []
const namesFromAlternatives = (value) => Array.isArray(value)
  ? value.map((entry) => typeof entry === 'string' ? text(entry) : text(entry?.['Название'])).filter(Boolean)
  : []
const unique = (values) => [...new Set(values.map(text).filter(Boolean))]
const sourceImageUrl = (value) => nullableText(value?.['Прямая ссылка на изображение'])

export const artistPhotoFileName = (sourceId) => `${encodeURIComponent(sourceId)}.webp`
export const artistPhotoUrl = (sourceId, photo) => sourceImageUrl(photo)
  ? `/images/kpop/artists/${artistPhotoFileName(sourceId)}`
  : null
export const labelLogoFileName = (logo) => {
  const url = sourceImageUrl(logo)
  return url ? `${createHash('sha256').update(url).digest('hex').slice(0, 16)}.webp` : null
}
export const labelLogoUrl = (logo) => {
  const fileName = labelLogoFileName(logo)
  return fileName ? `/images/kpop/labels/${fileName}` : null
}

const musicType = (performerType) => {
  if (performerType === 'Соло-исполнитель') return 'Person'
  if (performerType === 'Группа' || performerType === 'Саб-юнит') return 'Group'
  return 'Project'
}

const musicActive = (status) => {
  if (status === 'Карьера продолжается' || status === 'Перерыв') return true
  if (status === 'Карьера завершена' || status === 'Группа распущена') return false
  return null
}

export const transformKpopArtist = (source, index = 0) => {
  const sourceId = text(source['ID артиста'])
  const english = text(source['Имя на английском'])
  const russian = nullableText(source['Имя на русском'])
  const hangul = nullableText(source['Имя на хангыле'])
  const performerType = nullableText(source['Тип исполнителя'])
  const debutYear = Number.isInteger(source['Год дебюта']) ? source['Год дебюта'] : null
  const activityStatus = nullableText(source['Статус активности'])
  const alternatives = namesFromAlternatives(source['Альтернативные названия'])
  const photoFileName = nullableText(source['Фотография']?.['Имя файла'])
  const debutSong = nullableText(source['Дебютная песня'])
  const debutRelease = nullableText(source['Дебютный релиз'])
  const titleRu = russian || english
  const aliases = unique([english, russian, hangul, ...alternatives]).filter((value) => value !== titleRu)

  if (!sourceId || !english || !titleRu) {
    throw new Error(`K-pop source row ${index + 1} is missing ID or English name`)
  }
  if (!debutYear) throw new Error(`${sourceId}: debut year is required`)

  return {
    id: `kpop:${sourceId}`,
    mode: 'music',
    cardType: 'kpop_artist',
    titleRu,
    titleOriginal: english,
    alternativeTitles: aliases,
    aliases,
    activityStartYear: debutYear,
    countries: ['KR'],
    genres: ['k-pop'],
    popularityScore: Math.max(1, 1_000 - index),
    posterUrl: artistPhotoUrl(sourceId, source['Фотография']),
    contentStatus: 'test',
    allowedInGame: false,
    gameTier: 'experimental',
    musicType: musicType(performerType),
    musicIsActive: musicActive(activityStatus),
    musicOrigin: 'intl',
    kpopNameEnglish: english,
    kpopNameRussian: russian,
    kpopNameHangul: hangul,
    kpopPerformerType: performerType,
    kpopGender: nullableText(source['Пол']),
    kpopGeneration: generationForDebutYear(debutYear),
    kpopCurrentLabel: nullableText(source['Текущий корейский лейбл']),
    kpopCurrentLabelLogoUrl: labelLogoUrl(source['Логотип текущего лейбла']),
    kpopDebutMembers: Number.isInteger(source['Участников на дебюте']) ? source['Участников на дебюте'] : null,
    kpopActivityStatus: activityStatus,
    kpopPhotoFileName: photoFileName,
    kpopClues: {
      fandom: nullableText(source['Название фандома']),
      parentGroup: nullableText(source['Родительская группа']),
      leaders: stringList(source['Лидер']),
      maknaes: stringList(source['Макнэ']),
      officialColors: stringList(source['Официальные цвета']),
      debutSong,
      debutRelease,
      alternativeNames: alternatives,
      debutLabel: nullableText(source['Корейский лейбл на дебюте']),
    },
    dataQuality: {
      source: ['KPop_artists.json'],
      verified: false,
      missingFields: [
        ...(!photoFileName ? ['posterUrl'] : []),
        ...(!source['Логотип текущего лейбла'] ? ['kpopCurrentLabelLogoUrl'] : []),
      ],
    },
  }
}

export const buildKpopSpecial = (source) => {
  if (!Array.isArray(source) || source.length === 0) throw new Error('K-pop source must be a non-empty array')
  const items = source.map(transformKpopArtist)
  const ids = new Set(items.map((item) => item.id))
  if (ids.size !== items.length) throw new Error('K-pop source contains duplicate artist IDs')
  const generationCounts = Object.fromEntries(KPOP_GENERATIONS.map(({ generation }) => [
    String(generation),
    items.filter((item) => item.kpopGeneration === generation).length,
  ]))
  return {
    schemaVersion: 1,
    generatedAt: new Date().toISOString(),
    source: 'data/kpop/source/KPop_artists.json',
    generationRules: KPOP_GENERATIONS,
    pack: {
      id: KPOP_PACK_ID,
      slug: KPOP_PACK_ID,
      mode: 'music',
      title: 'K-pop: угадай артиста',
      subtitle: `Один артист в день · ${items.length} артистов`,
      description: 'Ежедневный закрытый спецпоказ: один K-pop артист в день по правилам обычного режима «Угадай музыку».',
      coverUrl: '/images/specials/kpop-special-card.webp',
      titlePosterUrl: '/images/specials/kpop-title-poster.webp',
      status: 'draft',
      accessModel: 'club',
      adminOnly: false,
      cadence: 'daily',
      maxAttempts: 10,
    },
    counts: {
      items: items.length,
      generations: generationCounts,
      withPhotos: items.filter((item) => item.kpopPhotoFileName).length,
      withCurrentLabelLogos: items.filter((item) => item.kpopCurrentLabelLogoUrl).length,
    },
    items,
  }
}

const argValue = (args, name, fallback) => {
  const prefix = `--${name}=`
  return args.find((arg) => arg.startsWith(prefix))?.slice(prefix.length) ?? fallback
}

export const run = async (args = process.argv.slice(2)) => {
  const sourcePath = resolve(argValue(args, 'source', 'data/kpop/source/KPop_artists.json'))
  const outputPath = resolve(argValue(args, 'out', 'data/kpop/kpop-artists-admin-v1.json'))
  const source = JSON.parse(await readFile(sourcePath, 'utf8'))
  const document = buildKpopSpecial(source)
  await mkdir(dirname(outputPath), { recursive: true })
  await writeFile(outputPath, `${JSON.stringify(document, null, 2)}\n`, 'utf8')
  console.log(JSON.stringify({
    outputPath,
    packId: document.pack.id,
    counts: document.counts,
    generationRules: document.generationRules,
  }, null, 2))
  return document
}

const isCli = process.argv[1]
  && pathToFileURL(resolve(process.argv[1])).href === import.meta.url
if (isCli) run().catch((error) => {
  console.error(error instanceof Error ? error.stack || error.message : error)
  process.exitCode = 1
})

export const moduleDirectory = dirname(fileURLToPath(import.meta.url))

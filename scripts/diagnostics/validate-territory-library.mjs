#!/usr/bin/env node

import { readFile } from 'node:fs/promises'
import { resolve } from 'node:path'

const EXPECTED_COUNT = 200
const EXPECTED_DIFFICULTIES = Object.freeze({ easy: 60, medium: 100, hard: 40 })
const CATEGORIES = Object.freeze({
  geography: 'География',
  history: 'История',
  science: 'Наука и природа',
  literature_art: 'Литература и искусство',
  cinema_music: 'Кино и музыка',
  technology: 'Технологии',
  sport: 'Спорт',
  world_culture: 'Культура мира',
})
const EXPECTED_PER_CATEGORY = EXPECTED_COUNT / Object.keys(CATEGORIES).length
const EXPECTED_CORRECT_POSITIONS = EXPECTED_COUNT / 4
const DEFAULT_SOURCE = './public/data/libraries/territory/items.json'
const CYRILLIC_RE = /[А-ЯЁа-яё]/u
const CURRENT_FACT_RE = /\b(?:сейчас|сегодня|текущ(?:ий|ая|ее|ие)|действующ(?:ий|ая|ее|ие)|на сегодняшний день|последн(?:ий|яя|ее|ие))\b/iu
const WIKIDATA_RE = /^https:\/\/www\.wikidata\.org\/wiki\/(Q\d+)$/u
const QID_RE = /^Q\d+$/u
const PID_RE = /^P\d+$/u
const CLAIM_ID_RE = /^Q\d+\$[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/iu
const VERIFY_TYPES = new Set(['wikibase-entityid', 'string', 'quantity', 'time'])
const OPTION_IDS = Object.freeze(['a', 'b', 'c', 'd'])
const VERIFY_CONCURRENCY = 4

const arg = (name) => {
  const direct = process.argv.find((value) => value.startsWith(`${name}=`))
  if (direct) return direct.slice(name.length + 1)
  const index = process.argv.indexOf(name)
  return index >= 0 ? process.argv[index + 1] : undefined
}

const hasFlag = (name) => process.argv.includes(name)
const normalized = (value) => String(value ?? '')
  .normalize('NFKC')
  .toLocaleLowerCase('ru-RU')
  .replace(/ё/gu, 'е')
  .replace(/[^\p{L}\p{N}]+/gu, ' ')
  .trim()
const isPlainObject = (value) => Boolean(value) && typeof value === 'object' && !Array.isArray(value)
const validIsoDate = (value) => typeof value === 'string'
  && /^\d{4}-\d{2}-\d{2}$/u.test(value)
  && !Number.isNaN(Date.parse(`${value}T00:00:00Z`))
const unique = (values) => new Set(values).size === values.length
const sleep = (milliseconds) => new Promise((done) => setTimeout(done, milliseconds))

const source = resolve(arg('--source') ?? DEFAULT_SOURCE)
const verifySources = hasFlag('--verify-sources')
const parsed = JSON.parse(await readFile(source, 'utf8'))
const errors = []
const warnings = []
const verificationWork = []

if (!Array.isArray(parsed)) {
  throw new Error(`${source}: корень библиотеки должен быть JSON-массивом`)
}

const ids = new Set()
const externalIds = new Set()
const prompts = new Set()
const statementIds = new Set()
const categoryCounts = Object.fromEntries(Object.keys(CATEGORIES).map((category) => [category, 0]))
const difficultyCounts = { easy: 0, medium: 0, hard: 0 }
const correctPositionCounts = Object.fromEntries(OPTION_IDS.map((id) => [id, 0]))
let wikidataCount = 0

const fail = (id, message) => errors.push(`${id}: ${message}`)

for (const [index, item] of parsed.entries()) {
  const id = typeof item?.id === 'string' && item.id ? item.id : `items[${index}]`
  if (!isPlainObject(item)) {
    fail(id, 'элемент должен быть объектом')
    continue
  }

  const serial = String(index + 1).padStart(3, '0')
  if (item.id !== `territory:ru-${serial}`) fail(id, `ожидался последовательный id territory:ru-${serial}`)
  if (ids.has(item.id)) fail(id, 'дублирующийся id')
  ids.add(item.id)
  if (item.externalId !== `ru-${serial}`) fail(id, `externalId должен быть ru-${serial}`)
  if (externalIds.has(item.externalId)) fail(id, 'дублирующийся externalId')
  externalIds.add(item.externalId)
  if (item.mode !== 'territory') fail(id, `mode должен быть territory, получено ${String(item.mode)}`)
  if (item.schemaVersion !== 1) fail(id, 'schemaVersion должен быть 1')
  if (item.questionType !== 'choice') fail(id, 'questionType должен быть choice')
  if (item.type != null && item.type !== 'multiple_choice') fail(id, 'устаревший type допустим только как multiple_choice')
  if (item.locale !== 'ru-RU') fail(id, 'locale должен быть ru-RU')
  if (item.allowedInGame !== true || item.contentStatus !== 'ready') {
    fail(id, 'выпускаемый вопрос должен быть ready и allowedInGame=true')
  }
  if (typeof item.titleRu !== 'string' || !item.titleRu.trim()
    || typeof item.titleOriginal !== 'string' || !Array.isArray(item.alternativeTitles)) {
    fail(id, 'отсутствуют обязательные release-content поля titleRu/titleOriginal/alternativeTitles')
  }
  if (item.popularityScore != null && !Number.isFinite(item.popularityScore)) {
    fail(id, 'popularityScore должен быть конечным числом')
  }

  if (!isPlainObject(item.category)
    || !Object.hasOwn(CATEGORIES, item.category.id)
    || item.category.label !== CATEGORIES[item.category.id]) {
    fail(id, `category должен быть одним из canonical объектов; получено ${JSON.stringify(item.category)}`)
  } else {
    categoryCounts[item.category.id] += 1
  }
  if (!Object.hasOwn(difficultyCounts, item.difficulty)) fail(id, `неизвестная сложность ${String(item.difficulty)}`)
  else difficultyCounts[item.difficulty] += 1

  if (typeof item.prompt !== 'string' || item.prompt.trim().length < 12 || !CYRILLIC_RE.test(item.prompt)) {
    fail(id, 'prompt должен быть содержательным русским текстом')
  }
  const promptKey = normalized(item.prompt)
  if (!promptKey) fail(id, 'prompt пуст после нормализации')
  else if (prompts.has(promptKey)) fail(id, 'дублирующийся prompt')
  prompts.add(promptKey)
  if (CURRENT_FACT_RE.test(item.prompt ?? '') || CURRENT_FACT_RE.test(item.explanation ?? '')) {
    fail(id, 'вопрос зависит от текущего или относительного момента времени')
  }

  if (!Array.isArray(item.options) || item.options.length !== 4) {
    fail(id, 'options должен содержать ровно четыре варианта')
  } else {
    const optionIds = []
    const optionTexts = new Set()
    for (const option of item.options) {
      if (!isPlainObject(option) || typeof option.id !== 'string' || !OPTION_IDS.includes(option.id)) {
        fail(id, 'каждый option должен иметь id a, b, c или d')
        continue
      }
      optionIds.push(option.id)
      if (typeof option.text !== 'string' || !option.text.trim()) fail(id, `пустой текст варианта ${option.id}`)
      const textKey = normalized(option.text)
      if (optionTexts.has(textKey)) fail(id, `дублирующийся текст варианта «${option.text}»`)
      optionTexts.add(textKey)
    }
    if (!unique(optionIds) || OPTION_IDS.some((optionId) => !optionIds.includes(optionId))) {
      fail(id, 'option ids должны быть уникальным набором a, b, c, d')
    }
    if (!optionIds.includes(item.correctOptionId)) fail(id, 'correctOptionId не указывает на существующий вариант')
    else correctPositionCounts[item.correctOptionId] += 1
  }

  if (typeof item.explanation !== 'string' || item.explanation.trim().length < 16 || !CYRILLIC_RE.test(item.explanation)) {
    fail(id, 'explanation должен быть содержательным русским текстом')
  }

  if (!isPlainObject(item.provenance)) {
    fail(id, 'provenance обязателен')
    continue
  }
  const provenance = item.provenance
  if (provenance.dataset !== 'Wikidata') fail(id, 'provenance.dataset должен быть Wikidata')
  const sourceMatch = typeof provenance.sourceUrl === 'string' ? provenance.sourceUrl.match(WIKIDATA_RE) : null
  if (!sourceMatch) fail(id, 'provenance.sourceUrl должен вести прямо на Wikidata entity')
  else wikidataCount += 1
  if (typeof provenance.sourceTitle !== 'string' || !provenance.sourceTitle.trim()) fail(id, 'provenance.sourceTitle обязателен')
  if (provenance.license !== 'CC0-1.0') fail(id, 'для банка ожидается license CC0-1.0')
  if (provenance.licenseUrl !== 'https://creativecommons.org/publicdomain/zero/1.0/') {
    fail(id, 'licenseUrl должен вести на CC0 1.0')
  }
  if (provenance.attribution !== 'Wikidata contributors') fail(id, 'ожидается attribution Wikidata contributors')
  if (!validIsoDate(provenance.retrievedAt)) fail(id, 'retrievedAt должен быть датой YYYY-MM-DD')

  if (!Array.isArray(provenance.entityIds) || provenance.entityIds.length === 0
    || provenance.entityIds.some((value) => !QID_RE.test(value)) || !unique(provenance.entityIds)) {
    fail(id, 'entityIds должен быть непустым уникальным массивом Wikidata QID')
  }
  if (!Array.isArray(provenance.propertyIds) || provenance.propertyIds.length === 0
    || provenance.propertyIds.some((value) => !PID_RE.test(value)) || !unique(provenance.propertyIds)) {
    fail(id, 'propertyIds должен быть непустым уникальным массивом Wikidata PID')
  }
  if (typeof provenance.sourceQuestionId !== 'string' || !CLAIM_ID_RE.test(provenance.sourceQuestionId)) {
    fail(id, 'sourceQuestionId должен быть реальным Wikidata statement GUID')
  } else if (statementIds.has(provenance.sourceQuestionId.toLocaleLowerCase('en-US'))) {
    fail(id, 'дублирующийся Wikidata statement GUID')
  } else {
    statementIds.add(provenance.sourceQuestionId.toLocaleLowerCase('en-US'))
  }

  if (!Array.isArray(provenance.verificationClaims) || provenance.verificationClaims.length !== 1) {
    fail(id, 'verificationClaims должен содержать ровно одно проверяемое утверждение')
    continue
  }
  const claim = provenance.verificationClaims[0]
  if (!isPlainObject(claim) || !QID_RE.test(claim.entityId ?? '') || !PID_RE.test(claim.propertyId ?? '')) {
    fail(id, 'verificationClaim должен содержать корректные entityId/propertyId')
    continue
  }
  if (!provenance.entityIds?.includes(claim.entityId)) fail(id, 'verificationClaim.entityId отсутствует в entityIds')
  if (!provenance.propertyIds?.includes(claim.propertyId)) fail(id, 'verificationClaim.propertyId отсутствует в propertyIds')
  if (sourceMatch?.[1] !== claim.entityId) fail(id, 'sourceUrl и verificationClaim.entityId расходятся')
  if (!VERIFY_TYPES.has(claim.expectedValueType)) fail(id, `неподдерживаемый expectedValueType ${String(claim.expectedValueType)}`)
  if (typeof claim.expectedValue !== 'string' || !claim.expectedValue.length) fail(id, 'expectedValue должен быть непустой строкой')
  if (claim.expectedValueType === 'wikibase-entityid' && !QID_RE.test(claim.expectedValue ?? '')) {
    fail(id, 'entity expectedValue должен быть QID')
  }
  verificationWork.push({ id, sourceQuestionId: provenance.sourceQuestionId, ...claim })
}

if (parsed.length !== EXPECTED_COUNT) errors.push(`library: ожидалось ${EXPECTED_COUNT} вопросов, получено ${parsed.length}`)
for (const category of Object.keys(CATEGORIES)) {
  if (categoryCounts[category] !== EXPECTED_PER_CATEGORY) {
    errors.push(`library: категория ${category} должна содержать ${EXPECTED_PER_CATEGORY} вопросов, получено ${categoryCounts[category]}`)
  }
}
for (const [difficulty, expected] of Object.entries(EXPECTED_DIFFICULTIES)) {
  if (difficultyCounts[difficulty] !== expected) {
    errors.push(`library: сложность ${difficulty} должна содержать ${expected} вопросов, получено ${difficultyCounts[difficulty]}`)
  }
}
for (const optionId of OPTION_IDS) {
  if (correctPositionCounts[optionId] !== EXPECTED_CORRECT_POSITIONS) {
    errors.push(`library: правильный ответ должен занимать позицию ${optionId} ровно ${EXPECTED_CORRECT_POSITIONS} раз, получено ${correctPositionCounts[optionId]}`)
  }
}
if (wikidataCount !== parsed.length) {
  errors.push(`library: все provenance URL должны вести прямо на Wikidata entity; получено ${wikidataCount}/${parsed.length}`)
}

const fetchEntity = async (entityId) => {
  const url = `https://www.wikidata.org/wiki/Special:EntityData/${entityId}.json`
  let lastError
  for (let attempt = 0; attempt < 4; attempt += 1) {
    const controller = new AbortController()
    const timeout = setTimeout(() => controller.abort(), 20_000)
    try {
      const response = await fetch(url, {
        headers: {
          Accept: 'application/json',
          'User-Agent': 'shoditsa-territory-validator/1.0 (https://shoditsa.ru)',
        },
        signal: controller.signal,
      })
      if (response.ok) {
        const payload = await response.json()
        const entity = payload?.entities?.[entityId]
        if (!entity) throw new Error(`ответ не содержит entities.${entityId}`)
        return entity
      }
      lastError = new Error(`HTTP ${response.status} ${response.statusText}`)
      if (response.status !== 429 && response.status < 500) break
      const retryAfter = Number(response.headers.get('retry-after'))
      await sleep(Number.isFinite(retryAfter) ? retryAfter * 1000 : 750 * (2 ** attempt))
    } catch (error) {
      lastError = error
      if (attempt < 3) await sleep(750 * (2 ** attempt))
    } finally {
      clearTimeout(timeout)
    }
  }
  throw new Error(`${url}: ${lastError instanceof Error ? lastError.message : String(lastError)}`)
}

const actualValue = (datavalue) => {
  if (datavalue?.type === 'wikibase-entityid') return datavalue.value?.id
  if (datavalue?.type === 'quantity') return datavalue.value?.amount
  if (datavalue?.type === 'time') return datavalue.value?.time
  return datavalue?.value
}

let sourceVerified = 0
if (verifySources && errors.length === 0) {
  const entityIds = [...new Set(verificationWork.map((work) => work.entityId))]
  const entityMap = new Map()
  let cursor = 0
  const workers = Array.from({ length: Math.min(VERIFY_CONCURRENCY, entityIds.length) }, async () => {
    while (cursor < entityIds.length) {
      const index = cursor
      cursor += 1
      const entityId = entityIds[index]
      try {
        entityMap.set(entityId, await fetchEntity(entityId))
      } catch (error) {
        errors.push(`${entityId}: не удалось загрузить Special:EntityData — ${error instanceof Error ? error.message : String(error)}`)
      }
    }
  })
  await Promise.all(workers)

  for (const work of verificationWork) {
    const statements = entityMap.get(work.entityId)?.claims?.[work.propertyId] ?? []
    const exactStatement = statements.find((statement) => statement.id === work.sourceQuestionId)
    if (!exactStatement) {
      fail(work.id, `в ${work.entityId}/${work.propertyId} отсутствует statement ${work.sourceQuestionId}`)
      continue
    }
    const datavalue = exactStatement.mainsnak?.datavalue
    const matches = exactStatement.rank !== 'deprecated'
      && exactStatement.mainsnak?.snaktype === 'value'
      && datavalue?.type === work.expectedValueType
      && actualValue(datavalue) === work.expectedValue
    if (!matches) {
      fail(work.id, `Wikidata statement ${work.sourceQuestionId} не подтверждает ${work.expectedValueType}=${JSON.stringify(work.expectedValue)}`)
      continue
    }
    sourceVerified += 1
  }
  if (sourceVerified !== parsed.length) {
    errors.push(`library: Wikidata подтвердил ${sourceVerified}/${parsed.length} карточек`)
  }
}

const summary = {
  source,
  count: parsed.length,
  categories: categoryCounts,
  difficulties: difficultyCounts,
  correctPositions: correctPositionCounts,
  wikidataProvenance: wikidataCount,
  sourceVerification: verifySources ? { requested: true, verified: sourceVerified } : { requested: false },
  warnings,
  errors: errors.length,
}

if (errors.length) {
  console.error(JSON.stringify({ ...summary, findings: errors }, null, 2))
  process.exitCode = 1
} else {
  console.log(JSON.stringify(summary, null, 2))
}

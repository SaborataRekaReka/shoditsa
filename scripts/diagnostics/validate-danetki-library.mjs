import { readFile } from 'node:fs/promises'
import { resolve } from 'node:path'

const source = resolve('public/data/libraries/danetki/items.json')
const items = JSON.parse(await readFile(source, 'utf8'))
const errors = []
const allowed = {
  difficulty: new Set(['easy', 'medium', 'hard']),
  audience: new Set(['family', 'teen', 'adult']),
  tone: new Set(['light', 'warm', 'wonder', 'mystery', 'tense', 'dark']),
}
const normalized = (value) => String(value ?? '').normalize('NFKC').toLocaleLowerCase('ru-RU').replace(/ё/g, 'е').replace(/[^a-zа-я0-9]+/gi, ' ').trim()
const nonEmptyStrings = (value, minimum = 1) => Array.isArray(value) && value.length >= minimum && value.every((entry) => typeof entry === 'string' && entry.trim())
const uniqueValues = (field) => {
  const seen = new Set()
  for (const item of items) {
    const value = item[field]
    if (seen.has(value)) errors.push(`${item.id}: duplicate ${field} "${value}"`)
    seen.add(value)
  }
}

if (!Array.isArray(items)) errors.push('Library root must be an array')
if (items.length < 30) errors.push(`Library must contain at least 30 ready stories; found ${items.length}`)

for (const item of items) {
  const key = item?.id || '<missing-id>'
  if (item.mode !== 'danetki') errors.push(`${key}: mode must be danetki`)
  if (!/^danetka_[a-z0-9_]+$/.test(String(item.id))) errors.push(`${key}: invalid stable id`)
  if (!/^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(String(item.slug))) errors.push(`${key}: invalid stable slug`)
  if (!String(item.titleRu ?? '').trim()) errors.push(`${key}: missing titleRu`)
  if (String(item.condition ?? '').trim().length < 80) errors.push(`${key}: condition is too short`)
  if (String(item.solution ?? '').trim().length < 120) errors.push(`${key}: solution is too short`)
  if (!allowed.difficulty.has(item.difficulty)) errors.push(`${key}: invalid difficulty`)
  if (!allowed.audience.has(item.audience)) errors.push(`${key}: invalid audience`)
  if (!allowed.tone.has(item.tone)) errors.push(`${key}: invalid tone`)
  if (!Number.isInteger(item.estimatedMinutes) || item.estimatedMinutes < 3 || item.estimatedMinutes > 20) errors.push(`${key}: estimatedMinutes must be an integer from 3 to 20`)
  if (typeof item.isClassic !== 'boolean') errors.push(`${key}: isClassic must be boolean`)
  if (!String(item.sourceNote ?? '').trim()) errors.push(`${key}: sourceNote is required`)
  if (!/^\d{4}-\d{2}-\d{2}$/.test(String(item.publishedAt))) errors.push(`${key}: publishedAt must use YYYY-MM-DD`)
  if (item.indexable !== true || item.allowedInGame !== true || item.contentStatus !== 'ready') errors.push(`${key}: item must be ready, indexable and allowed in game`)
  if (!nonEmptyStrings(item.genres)) errors.push(`${key}: at least one genre is required`)
  if (!nonEmptyStrings(item.tags, 3)) errors.push(`${key}: at least three tags are required`)
  if (!nonEmptyStrings(item.starterQuestions, 3)) errors.push(`${key}: at least three starter questions are required`)
  if (!Array.isArray(item.keyFacts) || item.keyFacts.length < 5 || item.keyFacts.length > 7) errors.push(`${key}: keyFacts must contain 5–7 facts`)
  if (!Array.isArray(item.hints) || item.hints.length !== 3 || item.hints.some((hint, index) => hint.level !== index + 1 || !String(hint.text ?? '').trim())) errors.push(`${key}: hints must contain levels 1, 2 and 3`)

  const factIds = new Set()
  for (const fact of item.keyFacts ?? []) {
    if (!String(fact.id ?? '').trim() || factIds.has(fact.id)) errors.push(`${key}: key fact ids must be unique and non-empty`)
    factIds.add(fact.id)
    if (!String(fact.text ?? '').trim() || !nonEmptyStrings(fact.aliases)) errors.push(`${key}: each key fact needs text and aliases`)
    if (typeof fact.required !== 'boolean') errors.push(`${key}: key fact ${fact.id} is missing required flag`)
  }
  const requiredIds = item.answerRules?.requiredFactIds
  if (!nonEmptyStrings(requiredIds, 3) || requiredIds.some((id) => !factIds.has(id))) errors.push(`${key}: answerRules references missing or too few facts`)
  if (typeof item.answerRules?.minCoverage !== 'number' || item.answerRules.minCoverage < .65 || item.answerRules.minCoverage > 1) errors.push(`${key}: minCoverage must be from 0.65 to 1`)
}

uniqueValues('id')
uniqueValues('slug')
for (const field of ['condition', 'solution']) {
  const seen = new Map()
  for (const item of items) {
    const value = normalized(item[field])
    if (seen.has(value)) errors.push(`${item.id}: duplicate normalized ${field} with ${seen.get(value)}`)
    seen.set(value, item.id)
  }
}

const counts = (field) => Object.fromEntries([...new Set(items.map((item) => item[field]))].map((value) => [value, items.filter((item) => item[field] === value).length]))
const difficulties = counts('difficulty')
for (const level of allowed.difficulty) if ((difficulties[level] ?? 0) < 6) errors.push(`Difficulty ${level} needs at least 6 stories`)
const familyCount = items.filter((item) => item.audience === 'family').length
if (familyCount < 12) errors.push(`Family-safe collection needs at least 12 stories; found ${familyCount}`)
const classicShare = items.filter((item) => item.isClassic).length / items.length
if (classicShare < .1 || classicShare > .3) errors.push(`Classic share must stay between 10% and 30%; found ${Math.round(classicShare * 100)}%`)

if (errors.length) {
  console.error(`Danetki library validation failed (${errors.length}):\n- ${errors.join('\n- ')}`)
  process.exit(1)
}

console.log(JSON.stringify({
  status: 'ok',
  total: items.length,
  difficulty: difficulties,
  audience: counts('audience'),
  classics: items.filter((item) => item.isClassic).length,
  indexable: items.filter((item) => item.indexable).length,
}, null, 2))

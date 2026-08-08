import fs from 'node:fs'
import path from 'node:path'
import { createDecipheriv, createHash } from 'node:crypto'
import { ProxyAgent, fetch as undiciFetch } from 'undici'
import postgres from 'postgres'

const ROOT = process.cwd()
const SOURCE = path.join(ROOT, 'data', 'characters', 'seeds', 'characters.expansion330.json')
const OUTPUT = path.join(ROOT, 'data', 'characters', 'seeds', 'characters.expansion330.editorial.json')
const MODEL = process.env.CHARACTER_EDITORIAL_MODEL?.trim() || 'gpt-5-mini'
const REVIEW_EXISTING = process.env.CHARACTER_EDITORIAL_REVIEW === 'true'
const FORCE_SLUGS = new Set((process.env.CHARACTER_EDITORIAL_FORCE_SLUGS ?? '').split(',').map((value) => value.trim()).filter(Boolean))
const REASONING_EFFORT = process.env.CHARACTER_EDITORIAL_REASONING === 'medium' ? 'medium' : 'low'
const BATCH_SIZE = MODEL === 'gpt-5' ? 4 : 6
const CONCURRENCY = 3
const ALLOWED_ARCHETYPES = new Set(['Герой', 'Антигерой', 'Антагонист', 'Наставник', 'Трикстер', 'Избранный', 'Мятежник', 'Искатель', 'Правитель', 'Творец', 'Опекун', 'Невинный', 'Мудрец', 'Любовник', 'Злодей', 'Жертва', 'Изгой', 'Соперник', 'Искуситель', 'Мститель', 'Защитник', 'Чудовище'])

const loadProductionIntegrations = async () => {
  const databaseUrl = process.env.DATABASE_URL?.trim()
  const secretsKey = process.env.PIPELINE_SECRETS_KEY?.trim() || process.env.BETTER_AUTH_SECRET?.trim()
  if (!databaseUrl || !secretsKey) throw new Error('DATABASE_URL and the pipeline secrets key are required')
  const sql = postgres(databaseUrl, { max: 1, idle_timeout: 10, connect_timeout: 10, prepare: false })
  try {
    const rows = await sql<Array<{ key: string; encryptedValue: string; iv: string; authTag: string }>>`
      select key, encrypted_value as "encryptedValue", iv, auth_tag as "authTag"
      from integration_secrets
      where key in ('OPENAI_API_KEY', 'MUSIC_OUTBOUND_PROXY_URL')
    `
    const key = createHash('sha256').update(`shoditsa:pipeline-integrations:v1:${secretsKey}`).digest()
    const values = Object.fromEntries(rows.map((row) => {
      const decipher = createDecipheriv('aes-256-gcm', key, Buffer.from(row.iv, 'base64'))
      decipher.setAuthTag(Buffer.from(row.authTag, 'base64'))
      const value = Buffer.concat([decipher.update(Buffer.from(row.encryptedValue, 'base64')), decipher.final()]).toString('utf8')
      return [row.key, value]
    }))
    return {
      openAiApiKey: values.OPENAI_API_KEY || process.env.OPENAI_API_KEY || '',
      proxyUrl: values.MUSIC_OUTBOUND_PROXY_URL || process.env.OPENAI_OUTBOUND_PROXY_URL || process.env.MUSIC_OUTBOUND_PROXY_URL || '',
    }
  } finally {
    await sql.end()
  }
}

type SourceCard = {
  id: string
  slug: string
  titleRu: string
  titleOriginal: string
  alternativeTitles?: string[]
  aliases?: string[]
  characterSourceWork: string
  characterSourceAuthor: string
  characterSourceTypes: string[]
  characterOriginCultures: string[]
  characterNature: string
  characterGender: string
  characterAgeGroup: string
  characterRoles: string[]
  characterAbilities: string[]
  iconicObjects: string[]
}

type EditorialCard = {
  slug: string
  characterRoles: string[]
  characterArchetypes: string[]
  characterAbilities: string[]
  characterSettings: string[]
  plotHint: string
}

type EditorialPack = {
  version: 1
  model: string
  generatedAt: string
  reviewedSlugs?: string[]
  items: Record<string, Omit<EditorialCard, 'slug'>>
}

const normalize = (value: unknown) => String(value ?? '')
  .normalize('NFKD')
  .toLocaleLowerCase('ru-RU')
  .replace(/[\u0300-\u036f]/g, '')
  .replace(/ё/g, 'е')
  .replace(/[^a-zа-я0-9]+/gi, ' ')
  .trim()

const uniqueText = (value: unknown, min: number, max: number, label: string) => {
  if (!Array.isArray(value)) throw new Error(`${label}: expected array`)
  const result = [...new Map(value.map((entry) => {
    const text = String(entry ?? '').trim()
    const display = text ? `${text.charAt(0).toLocaleUpperCase('ru-RU')}${text.slice(1)}` : ''
    return [normalize(display), display]
  })).values()].filter(Boolean)
  if (result.length < min || result.length > max) throw new Error(`${label}: expected ${min}-${max} values, found ${result.length}`)
  return result
}

const sameSet = (left: string[], right: string[]) => {
  const a = left.map(normalize).sort()
  const b = right.map(normalize).sort()
  return a.length === b.length && a.every((entry, index) => entry === b[index])
}

const escapeRegExp = (value: string) => value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
const hideAnswerTitles = (hint: string, source: SourceCard) => {
  const replacement = source.characterGender === 'Женщина' ? 'героиня' : source.characterGender === 'Мужчина' ? 'герой' : 'персонаж'
  return [source.titleRu, source.titleOriginal, ...(source.alternativeTitles ?? []), ...(source.aliases ?? [])]
    .map((value) => String(value ?? '').trim())
    .filter((value) => value.length >= 4)
    .sort((left, right) => right.length - left.length)
    .reduce((text, title) => text.replace(new RegExp(escapeRegExp(title), 'giu'), replacement), hint)
}

const validateCard = (raw: EditorialCard, source: SourceCard): EditorialCard => {
  if (raw?.slug !== source.slug) throw new Error(`${source.slug}: model returned another slug`)
  let characterRoles = uniqueText(raw.characterRoles, 1, 2, `${source.slug}: roles`)
  let characterArchetypes = uniqueText(raw.characterArchetypes, 1, 2, `${source.slug}: archetypes`)
  const characterAbilities = uniqueText(raw.characterAbilities, 1, 2, `${source.slug}: abilities`)
  const characterSettings = uniqueText(raw.characterSettings, 2, 3, `${source.slug}: settings`)
  if (sameSet(characterRoles, characterArchetypes)) throw new Error(`${source.slug}: roles duplicate archetypes`)
  const archetypeKeys = new Set(characterArchetypes.map(normalize))
  const concreteRoles = characterRoles.filter((value) => !archetypeKeys.has(normalize(value)))
  if (concreteRoles.length) characterRoles = concreteRoles
  else {
    const roleKeys = new Set(characterRoles.map(normalize))
    characterArchetypes = characterArchetypes.filter((value) => !roleKeys.has(normalize(value)))
    if (!characterArchetypes.length) throw new Error(`${source.slug}: every role duplicates every archetype`)
  }
  const invalidArchetype = characterArchetypes.find((value) => !ALLOWED_ARCHETYPES.has(value))
  if (invalidArchetype) throw new Error(`${source.slug}: unsupported archetype ${invalidArchetype}`)
  const verboseValue = [...characterRoles, ...characterArchetypes, ...characterAbilities, ...characterSettings]
    .find((value) => value.length > 48 || /[\/]|\bсоц\./i.test(value))
  if (verboseValue) throw new Error(`${source.slug}: verbose or malformed field value ${verboseValue}`)
  const bannedSetting = characterSettings.find((value) => ['общество', 'театр', 'легендарный мир'].includes(normalize(value)))
  if (bannedSetting) throw new Error(`${source.slug}: generic/non-diegetic setting ${bannedSetting}`)
  const plotHint = hideAnswerTitles(String(raw.plotHint ?? '').replace(/\s+/g, ' ').trim(), source)
  if (plotHint.length < 130 || plotHint.length > 340) throw new Error(`${source.slug}: hint length ${plotHint.length}`)
  if (/^Этот персонаж действует как/i.test(plotHint)) throw new Error(`${source.slug}: legacy hint template`)
  const normalizedHint = normalize(plotHint)
  for (const title of [source.titleRu, source.titleOriginal, ...(source.alternativeTitles ?? []), ...(source.aliases ?? [])]) {
    const normalizedTitle = normalize(title)
    if (normalizedTitle.length >= 4 && normalizedHint.includes(normalizedTitle)) throw new Error(`${source.slug}: hint leaks title ${title}`)
  }
  return { slug: source.slug, characterRoles, characterArchetypes, characterAbilities, characterSettings, plotHint }
}

const schema = {
  type: 'object',
  additionalProperties: false,
  properties: {
    cards: {
      type: 'array',
      items: {
        type: 'object',
        additionalProperties: false,
        properties: {
          slug: { type: 'string' },
          characterRoles: { type: 'array', minItems: 1, maxItems: 2, items: { type: 'string' } },
          characterArchetypes: { type: 'array', minItems: 1, maxItems: 2, items: { type: 'string' } },
          characterAbilities: { type: 'array', minItems: 1, maxItems: 2, items: { type: 'string' } },
          characterSettings: { type: 'array', minItems: 2, maxItems: 3, items: { type: 'string' } },
          plotHint: { type: 'string' },
        },
        required: ['slug', 'characterRoles', 'characterArchetypes', 'characterAbilities', 'characterSettings', 'plotHint'],
      },
    },
  },
  required: ['cards'],
} as const

const prompt = (cards: SourceCard[], drafts: Record<string, Omit<EditorialCard, 'slug'>>, retryReason = '') => [
  'Ты — старший фактчекер и литературный редактор русскоязычной игры «Угадай персонажа». Перед тобой машинный черновик, в котором могут быть галлюцинации, влияние экранизаций, неверные архетипы, опечатки и канцелярит.',
  'Перепиши каждую карточку консервативно и только по литературному, мифологическому или фольклорному первоисточнику. Если не уверен в детали, замени её на более общее, но бесспорно верное значение.',
  'Роли: 1–2 короткие конкретные функции, профессии или положения внутри истории — сыщик, королева, мореплаватель, слуга. Не подменяй роль чертой характера.',
  'Архетипы: 1–2 устойчивые сюжетные модели, которые не повторяют роли. Разрешены только: Герой, Антигерой, Антагонист, Наставник, Трикстер, Избранный, Мятежник, Искатель, Правитель, Творец, Опекун, Невинный, Мудрец, Любовник, Злодей, Жертва, Изгой, Соперник, Искуситель, Мститель, Защитник, Чудовище. Не раздавай Трикстера, Избранного и Наставника без явного основания.',
  'Способности: 1–2 устойчивых умения или сверхъестественных свойства, каждое не длиннее четырёх-пяти слов. Это не биологическая природа, не разовое событие и не абстрактное настроение.',
  'Мир: 2–3 коротких, реально значимых места или среды действия именно этого персонажа. Не используй экранные декорации, «Общество», «Театр» как медиум, «Легендарный мир», слэши и выдуманные географические уточнения.',
  'Подсказка: ровно 2 грамотных предложения на 140–300 знаков о характерном поступке, конфликте или выборе. Не называй персонажа и произведение, не перечисляй поля, не используй общие фразы и не пересказывай финал целиком.',
  'Вычитай русский язык: никаких опечаток, сокращений, неестественных оборотов и строчной буквы у имён собственных. Не добавляй объяснений за пределами JSON.',
  retryReason ? `Исправь ошибку предыдущего ответа: ${retryReason}` : '',
  `Карточки: ${JSON.stringify(cards.map((card) => ({
    slug: card.slug,
    titleRu: card.titleRu,
    titleOriginal: card.titleOriginal,
    sourceWork: card.characterSourceWork,
    sourceAuthor: card.characterSourceAuthor,
    sourceTypes: card.characterSourceTypes,
    originCultures: card.characterOriginCultures,
    nature: card.characterNature,
    gender: card.characterGender,
    ageGroup: card.characterAgeGroup,
    currentRoles: card.characterRoles,
    currentAbilities: card.characterAbilities,
    iconicObjects: card.iconicObjects,
    currentDraft: drafts[card.slug] ?? null,
  })))}`,
].filter(Boolean).join('\n\n')

const responseText = (payload: Record<string, unknown>) => {
  if (typeof payload.output_text === 'string') return payload.output_text
  const chunks: string[] = []
  for (const item of Array.isArray(payload.output) ? payload.output : []) {
    if (!item || typeof item !== 'object') continue
    for (const part of Array.isArray((item as { content?: unknown[] }).content) ? (item as { content: unknown[] }).content : []) {
      if (part && typeof part === 'object' && typeof (part as { text?: unknown }).text === 'string') chunks.push((part as { text: string }).text)
    }
  }
  return chunks.join('\n')
}

const requestBatch = async (cards: SourceCard[], drafts: Record<string, Omit<EditorialCard, 'slug'>>, apiKey: string, proxyUrl: string) => {
  let retryReason = ''
  for (let attempt = 1; attempt <= 3; attempt += 1) {
    const dispatcher = proxyUrl ? new ProxyAgent(proxyUrl) : null
    const controller = new AbortController()
    const timeout = setTimeout(() => controller.abort(), 180_000)
    try {
      const response = await undiciFetch('https://api.openai.com/v1/responses', {
        method: 'POST',
        headers: { Authorization: `Bearer ${apiKey}`, 'Content-Type': 'application/json' },
        body: JSON.stringify({
          model: MODEL,
          input: prompt(cards, drafts, retryReason),
          reasoning: { effort: REASONING_EFFORT },
          max_output_tokens: 6_000,
          text: { format: { type: 'json_schema', name: 'character_editorial_batch', strict: true, schema } },
        }),
        signal: controller.signal,
        ...(dispatcher ? { dispatcher } : {}),
      })
      const payload = await response.json() as Record<string, unknown>
      if (!response.ok) throw new Error(String((payload.error as { message?: unknown } | undefined)?.message ?? `OpenAI HTTP ${response.status}`))
      const parsed = JSON.parse(responseText(payload)) as { cards?: EditorialCard[] }
      if (!Array.isArray(parsed.cards) || parsed.cards.length !== cards.length) throw new Error(`expected ${cards.length} cards, received ${parsed.cards?.length ?? 0}`)
      const bySlug = new Map(parsed.cards.map((card) => [card.slug, card]))
      const validated = cards.map((card) => validateCard(bySlug.get(card.slug) as EditorialCard, card))
      const usage = payload.usage as { input_tokens?: number; output_tokens?: number } | undefined
      return { validated, inputTokens: usage?.input_tokens ?? 0, outputTokens: usage?.output_tokens ?? 0 }
    } catch (error) {
      retryReason = error instanceof Error ? error.message : String(error)
      if (attempt === 3) throw error
      await new Promise((resolve) => setTimeout(resolve, attempt * 1_500))
    } finally {
      clearTimeout(timeout)
      if (dispatcher) await dispatcher.close()
    }
  }
  throw new Error('unreachable')
}

const writePack = (items: EditorialPack['items'], reviewedSlugs: Set<string>) => {
  const pack: EditorialPack = { version: 1, model: MODEL, generatedAt: new Date().toISOString(), reviewedSlugs: [...reviewedSlugs].sort(), items }
  fs.writeFileSync(OUTPUT, `${JSON.stringify(pack, null, 2)}\n`, 'utf8')
}

const main = async () => {
  const source = JSON.parse(fs.readFileSync(SOURCE, 'utf8')) as { items: SourceCard[] }
  if (!Array.isArray(source.items) || source.items.length !== 330) throw new Error('Expected the 330-card expansion source')
  const existing = fs.existsSync(OUTPUT) ? JSON.parse(fs.readFileSync(OUTPUT, 'utf8')) as EditorialPack : null
  const items: EditorialPack['items'] = existing?.version === 1 ? { ...existing.items } : {}
  const reviewedSlugs = new Set(existing?.reviewedSlugs ?? [])
  const pending = FORCE_SLUGS.size
    ? source.items.filter((card) => FORCE_SLUGS.has(card.slug))
    : REVIEW_EXISTING
      ? source.items.filter((card) => !reviewedSlugs.has(card.slug))
      : source.items.filter((card) => !items[card.slug])
  if (!pending.length) {
    console.log('character editorial: all 330 cards are already enriched')
    return
  }

  const { openAiApiKey: apiKey, proxyUrl } = await loadProductionIntegrations()
  if (!apiKey) throw new Error('OPENAI_API_KEY is not configured in admin integrations')

  const batches: SourceCard[][] = []
  for (let index = 0; index < pending.length; index += BATCH_SIZE) batches.push(pending.slice(index, index + BATCH_SIZE))
  let cursor = 0
  let inputTokens = 0
  let outputTokens = 0
  const worker = async () => {
    while (cursor < batches.length) {
      const batchIndex = cursor
      cursor += 1
      const result = await requestBatch(batches[batchIndex], items, apiKey, proxyUrl)
      for (const card of result.validated) {
        const { slug, ...editorialCard } = card
        items[slug] = editorialCard
        if (REVIEW_EXISTING) reviewedSlugs.add(slug)
      }
      inputTokens += result.inputTokens
      outputTokens += result.outputTokens
      writePack(items, reviewedSlugs)
      console.log(`character editorial: batch ${batchIndex + 1}/${batches.length}, ready ${Object.keys(items).length}/330`)
    }
  }
  await Promise.all(Array.from({ length: Math.min(CONCURRENCY, batches.length) }, () => worker()))
  const missing = source.items.filter((card) => !items[card.slug])
  if (missing.length) throw new Error(`Editorial enrichment is incomplete: ${missing.map((card) => card.slug).join(', ')}`)
  writePack(items, reviewedSlugs)
  console.log(`character editorial complete: 330 cards; tokens ${inputTokens} input / ${outputTokens} output`)
}

await main()

import { randomUUID } from 'node:crypto'
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { fetch as undiciFetch, ProxyAgent } from 'undici'

type PersistedPortrait = {
  url: string
  width: number
  height: number
  bytes: number
}

type PortraitSpec = {
  id: string
  title: string
  description: string
}

type ExpansionPortraitSource = {
  batchId?: unknown
  items?: Array<{ id?: unknown; titleRu?: unknown; portraitDescription?: unknown }>
}

export type OpenAiPortraitTestItem = PortraitSpec & PersistedPortrait & { storage: 'media' | 'memory' }
export type OpenAiPortraitTestJob = {
  id: string
  status: 'queued' | 'running' | 'completed' | 'failed'
  model: 'gpt-image-2'
  quality: 'low'
  size: '1024x1536'
  count: number
  estimatedOutputCostUsd: number
  createdAt: string
  completedAt: string | null
  items: OpenAiPortraitTestItem[]
  error: string | null
  warning: string | null
}

const PORTRAITS: readonly PortraitSpec[] = [
  {
    id: 'sherlock-holmes',
    title: 'Шерлок Холмс',
    description: 'Victorian consulting detective, about 50 years old. Invented non-celebrity face with a long aquiline nose, square chin, warm brown eyes, straight ash-brown hair receding at the temples, and lightly weathered skin. Tailored charcoal coat and waistcoat. Avoid the young, pale, high-cheekboned, curly-black-haired screen-detective look.',
  },
  {
    id: 'alice',
    title: 'Алиса',
    description: 'Curious twelve-year-old Victorian literary heroine with an invented non-celebrity face, chestnut-brown bobbed hair, hazel eyes, and a practical moss-green day dress with restrained cream details. Expressive thoughtful gaze and subtle surreal garden atmosphere. No blue dress, white pinafore, or black hair bow.',
  },
  {
    id: 'count-dracula',
    title: 'Граф Дракула',
    description: 'Aristocratic Transylvanian count from the original gothic novel, visibly older, with an invented gaunt face, high bridge of the nose, iron-grey swept-back hair, long pale moustache, bushy eyebrows, and a controlled ominous presence. Black formal evening coat without theatrical red lining.',
  },
  {
    id: 'robin-hood',
    title: 'Робин Гуд',
    description: 'Legendary English outlaw and skilled archer in his late thirties, with an invented weathered face, slightly crooked nose, short auburn-brown hair, light stubble, and a confident humane expression. Practical olive and russet wool clothing, no feathered cap, Sherwood forest atmosphere.',
  },
  {
    id: 'captain-nemo',
    title: 'Капитан Немо',
    description: 'Mysterious nineteenth-century South Asian prince, engineer, and submarine captain from the original novels, about 50 years old, with an invented non-celebrity face, copper-brown skin, strong nose, intense dark eyes, and a full salt-and-pepper beard. Restrained naval-inspired coat and deep-ocean atmosphere.',
  },
] as const

const expansionPortraits = () => {
  const source = JSON.parse(readFileSync(resolve('data/characters/seeds/characters.expansion50.json'), 'utf8')) as ExpansionPortraitSource
  if (source.batchId !== 'character-expansion-50' || !Array.isArray(source.items) || source.items.length !== 50) {
    throw new Error('Character expansion portrait source must contain exactly 50 items')
  }
  const portraits = source.items.map((item, index): PortraitSpec => {
    const canonicalId = String(item.id ?? '')
    const id = canonicalId.replace(/^character:/, '')
    const title = String(item.titleRu ?? '').trim()
    const description = String(item.portraitDescription ?? '').trim()
    if (!/^character:[a-z0-9-]+$/.test(canonicalId) || !title || description.length < 80) {
      throw new Error(`Invalid character portrait source row ${index + 1}`)
    }
    return { id, title, description }
  })
  if (new Set(portraits.map((portrait) => portrait.id)).size !== portraits.length) throw new Error('Character portrait ids must be unique')
  return portraits
}

const jobs = new Map<string, OpenAiPortraitTestJob>()
let activeJobId: string | null = null

const cleanJobs = () => {
  const cutoff = Date.now() - 60 * 60 * 1000
  for (const [id, job] of jobs) {
    if (new Date(job.createdAt).getTime() < cutoff && id !== activeJobId) jobs.delete(id)
  }
}

const record = (value: unknown): Record<string, unknown> => value && typeof value === 'object' && !Array.isArray(value)
  ? value as Record<string, unknown>
  : {}

const safeError = (error: unknown) => {
  const message = error instanceof Error ? error.message : String(error)
  return message.replace(/sk-[A-Za-z0-9_-]+/g, '[redacted]').slice(0, 500)
}

const delay = (milliseconds: number) => new Promise((resolveDelay) => setTimeout(resolveDelay, milliseconds))

const portraitPrompt = (portrait: PortraitSpec) => [
  `Create an original vertical character portrait of ${portrait.title}.`,
  portrait.description,
  'Treat the character name only as narrative context, never as a visual reference. Invent the facial identity from scratch as a fictional person who is not recognizable as any real person, performer, actor, or celebrity. Follow the supplied physical traits instead of converging on the best-known screen portrayal.',
  'Base the interpretation only on the public-domain literary or folklore source. Do not imitate any film, television, game, comic, or animation adaptation; any actor or celebrity; any existing illustration, poster, costume design, franchise logo, or studio style. Do not reproduce a recognizable performer\'s facial geometry, hairline, eyes, nose, mouth, or signature styling.',
  'For characters with famous adaptations, deliberately diverge from their familiar screen image in at least four visible ways: age, face shape, nose or jaw, eye colour, hair colour or texture, hairline, clothing silhouette, and palette.',
  'Art direction: use the established Shoditsa visual language — a graphic editorial manga character illustration combined with a retro investigative scrapbook collage. Crisp hand-inked linework with varied black strokes, restrained cel shading, subtle watercolour washes, screen-print halftone, cross-hatching, and visible aged-paper grain. Use a limited palette of warm ivory, charcoal black, forest green, mustard ochre, muted coral, and dusty blue.',
  'Composition: an expressive waist-up character with a clean readable silhouette, slightly off-centre three-quarter pose, and age-appropriate facial proportions. Behind the character, use a sparse full-bleed collage of torn paper, taped archival cards, simple grids, diagram marks, and two or three story-specific symbolic objects. Keep the face and silhouette dominant; the collage must not become a busy poster.',
  'Where the character description explicitly calls for adult beauty or sensual magnetism, make it tasteful, emotionally convincing, source-appropriate and non-explicit through gaze, posture, silhouette, fabric and lighting. Keep the character fully clothed in opaque period-appropriate garments: no nudity, lingerie, transparent fabric, fetish styling or pornographic framing. Never sexualize a child, adolescent, childlike character or animal.',
  'Do not use photorealism, oil-paint impasto, cinematic photography, glossy 3D rendering, airbrushed skin, or a generic polished fantasy-book-cover look. Do not give every character the same youthful anime face.',
  'The result must contain only the artwork: no frame, no card UI, no typography, no letters, no numbers, no signature, no logo, and no watermark.',
].join(' ')

const requestPortrait = async (options: {
  apiKey: string
  dispatcher: ProxyAgent | null
  portrait: PortraitSpec
}) => {
  for (let attempt = 1; attempt <= 3; attempt += 1) {
    const controller = new AbortController()
    const timer = setTimeout(() => controller.abort(), 5 * 60 * 1000)
    try {
      const response = await undiciFetch('https://api.openai.com/v1/images/generations', {
        method: 'POST',
        headers: { Authorization: `Bearer ${options.apiKey}`, 'Content-Type': 'application/json' },
        body: JSON.stringify({
          model: 'gpt-image-2',
          prompt: portraitPrompt(options.portrait),
          n: 1,
          size: '1024x1536',
          quality: 'low',
          background: 'opaque',
          output_format: 'webp',
          output_compression: 90,
        }),
        signal: controller.signal,
        ...(options.dispatcher ? { dispatcher: options.dispatcher } : {}),
      })
      const payload = record(await response.json())
      if (!response.ok) {
        const error = new Error(String(record(payload.error).message ?? `OpenAI HTTP ${response.status}`))
        if (attempt < 3 && (response.status === 408 || response.status === 409 || response.status === 429 || response.status >= 500)) {
          await delay(1_500 * attempt)
          continue
        }
        throw error
      }
      const first = Array.isArray(payload.data) ? record(payload.data[0]) : {}
      const base64 = typeof first.b64_json === 'string' ? first.b64_json : ''
      if (!base64) throw new Error('OpenAI image response contains no image data')
      return base64
    } finally {
      clearTimeout(timer)
    }
  }
  throw new Error('OpenAI image request exhausted all attempts')
}

const settleWithConcurrency = async <T, R>(items: readonly T[], concurrency: number, worker: (item: T) => Promise<R>) => {
  const results = Array<PromiseSettledResult<R>>(items.length)
  let nextIndex = 0
  await Promise.all(Array.from({ length: Math.min(concurrency, items.length) }, async () => {
    while (nextIndex < items.length) {
      const index = nextIndex
      nextIndex += 1
      try { results[index] = { status: 'fulfilled', value: await worker(items[index]!) } }
      catch (reason) { results[index] = { status: 'rejected', reason } }
    }
  }))
  return results
}

const runJob = async (options: {
  job: OpenAiPortraitTestJob
  apiKey: string
  proxyUrl?: string
  portraits: readonly PortraitSpec[]
  persist: (input: { base64: string; fileName: string }) => Promise<PersistedPortrait>
}) => {
  const { job } = options
  job.status = 'running'
  const dispatcher = options.proxyUrl ? new ProxyAgent(options.proxyUrl) : null
  try {
    const settled = await settleWithConcurrency(options.portraits, 4, async (portrait) => {
      const base64 = await requestPortrait({ apiKey: options.apiKey, dispatcher, portrait })
      try {
        const persisted = await options.persist({ base64, fileName: `${portrait.id}.webp` })
        const item = { ...portrait, ...persisted, storage: 'media' as const }
        job.items.push(item)
        return item
      } catch {
        const item = {
          ...portrait,
          url: `data:image/webp;base64,${base64}`,
          width: 1024,
          height: 1536,
          bytes: Buffer.byteLength(base64, 'base64'),
          storage: 'memory' as const,
        }
        job.items.push(item)
        return item
      }
    })
    job.items = settled.flatMap((result) => result.status === 'fulfilled' ? [result.value] : [])
    const failures = settled.flatMap((result) => result.status === 'rejected' ? [safeError(result.reason)] : [])
    if (failures.length) {
      job.status = 'failed'
      job.error = `${failures.length} of ${job.count} portraits failed: ${failures.join('; ')}`.slice(0, 500)
    } else {
      job.status = 'completed'
      if (job.items.some((item) => item.storage === 'memory')) {
        job.warning = 'Media storage is unavailable; portraits are kept in protected process memory for one hour.'
      }
    }
  } catch (error) {
    job.status = 'failed'
    job.error = safeError(error)
  } finally {
    job.completedAt = new Date().toISOString()
    activeJobId = null
    if (dispatcher) await dispatcher.close()
  }
  return job
}

export const startOpenAiPortraitTest = (options: {
  apiKey: string
  proxyUrl?: string
  portraitIds?: readonly string[]
  portraitBatch?: 'character-expansion-50'
  persist: (input: { base64: string; fileName: string }) => Promise<PersistedPortrait>
}) => {
  cleanJobs()
  if (activeJobId) return { job: jobs.get(activeJobId)!, started: false, completion: null }
  const requestedIds = new Set(options.portraitIds ?? [])
  const sourcePortraits = options.portraitBatch === 'character-expansion-50' ? expansionPortraits() : PORTRAITS
  const portraits = requestedIds.size ? sourcePortraits.filter((portrait) => requestedIds.has(portrait.id)) : sourcePortraits
  if (!portraits.length) throw new Error('At least one known portrait id is required')
  const job: OpenAiPortraitTestJob = {
    id: randomUUID(),
    status: 'queued',
    model: 'gpt-image-2',
    quality: 'low',
    size: '1024x1536',
    count: portraits.length,
    estimatedOutputCostUsd: Number((portraits.length * 0.005).toFixed(3)),
    createdAt: new Date().toISOString(),
    completedAt: null,
    items: [],
    error: null,
    warning: null,
  }
  jobs.set(job.id, job)
  activeJobId = job.id
  const completion = runJob({ ...options, portraits, job })
  return { job, started: true, completion }
}

export const getOpenAiPortraitTest = (id: string) => jobs.get(id) ?? null

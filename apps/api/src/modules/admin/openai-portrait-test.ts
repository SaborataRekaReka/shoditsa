import { randomUUID } from 'node:crypto'
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

export type OpenAiPortraitTestItem = PortraitSpec & PersistedPortrait & { storage: 'media' | 'memory' }
export type OpenAiPortraitTestJob = {
  id: string
  status: 'queued' | 'running' | 'completed' | 'failed'
  model: 'gpt-image-2'
  quality: 'low'
  size: '1024x1536'
  count: 5
  estimatedOutputCostUsd: 0.025
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
    description: 'Victorian consulting detective, lean face, sharp observant eyes, dark wavy hair, tailored charcoal coat and waistcoat.',
  },
  {
    id: 'alice',
    title: 'Алиса',
    description: 'Curious young Victorian literary heroine, practical pale-blue dress, expressive thoughtful gaze, subtle surreal garden atmosphere.',
  },
  {
    id: 'count-dracula',
    title: 'Граф Дракула',
    description: 'Aristocratic Transylvanian count from the original gothic novel, severe features, black formal evening coat, controlled ominous presence.',
  },
  {
    id: 'robin-hood',
    title: 'Робин Гуд',
    description: 'Legendary English outlaw and skilled archer, weathered green wool clothing, confident humane expression, Sherwood forest atmosphere.',
  },
  {
    id: 'captain-nemo',
    title: 'Капитан Немо',
    description: 'Mysterious nineteenth-century submarine captain from the original novel, dignified dark beard, naval-inspired coat, deep-ocean atmosphere.',
  },
] as const

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

const portraitPrompt = (portrait: PortraitSpec) => [
  `Create an original vertical character portrait of ${portrait.title}.`,
  portrait.description,
  'Base the interpretation only on the public-domain literary or folklore source. Do not imitate any film, television, game, comic, animation adaptation, actor, celebrity, existing illustration, poster, costume design, franchise logo, or studio style.',
  'Art direction: premium editorial storybook portrait, painterly realism with visible brush texture, elegant dramatic lighting, deep jewel-tone background with restrained gold accents, expressive face, waist-up centered composition, visually cohesive collectible card series.',
  'The result must contain only the artwork: no frame, no card UI, no typography, no letters, no numbers, no signature, no logo, and no watermark.',
].join(' ')

const requestPortrait = async (options: {
  apiKey: string
  dispatcher: ProxyAgent | null
  portrait: PortraitSpec
}) => {
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
    if (!response.ok) throw new Error(String(record(payload.error).message ?? `OpenAI HTTP ${response.status}`))
    const first = Array.isArray(payload.data) ? record(payload.data[0]) : {}
    const base64 = typeof first.b64_json === 'string' ? first.b64_json : ''
    if (!base64) throw new Error('OpenAI image response contains no image data')
    return base64
  } finally {
    clearTimeout(timer)
  }
}

const runJob = async (options: {
  job: OpenAiPortraitTestJob
  apiKey: string
  proxyUrl?: string
  persist: (input: { base64: string; fileName: string }) => Promise<PersistedPortrait>
}) => {
  const { job } = options
  job.status = 'running'
  const dispatcher = options.proxyUrl ? new ProxyAgent(options.proxyUrl) : null
  try {
    const settled = await Promise.allSettled(PORTRAITS.map(async (portrait) => {
      const base64 = await requestPortrait({ apiKey: options.apiKey, dispatcher, portrait })
      try {
        const persisted = await options.persist({ base64, fileName: `${portrait.id}.webp` })
        return { ...portrait, ...persisted, storage: 'media' as const }
      } catch {
        return {
          ...portrait,
          url: `data:image/webp;base64,${base64}`,
          width: 1024,
          height: 1536,
          bytes: Buffer.byteLength(base64, 'base64'),
          storage: 'memory' as const,
        }
      }
    }))
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
  persist: (input: { base64: string; fileName: string }) => Promise<PersistedPortrait>
}) => {
  cleanJobs()
  if (activeJobId) return { job: jobs.get(activeJobId)!, started: false, completion: null }
  const job: OpenAiPortraitTestJob = {
    id: randomUUID(),
    status: 'queued',
    model: 'gpt-image-2',
    quality: 'low',
    size: '1024x1536',
    count: 5,
    estimatedOutputCostUsd: 0.025,
    createdAt: new Date().toISOString(),
    completedAt: null,
    items: [],
    error: null,
    warning: null,
  }
  jobs.set(job.id, job)
  activeJobId = job.id
  const completion = runJob({ ...options, job })
  return { job, started: true, completion }
}

export const getOpenAiPortraitTest = (id: string) => jobs.get(id) ?? null

import { createHash } from 'node:crypto'
import { mkdirSync, readFileSync, statSync, writeFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { join } from 'node:path'
import type { Catalog } from '../../../features/svoyak/contracts'

export type { BankQuestion, Bank, QuestionBank } from '@shoditsa/game-core/svoyak-bank'
import type { BankQuestion, Bank, QuestionBank } from '@shoditsa/game-core/svoyak-bank'

const origin = 'http://127.0.0.1:5188'
const privateRoot = fileURLToPath(new URL('../../../../../../archive/local/', import.meta.url))
const cacheDirectory = join(privateRoot, 'svoyak-game')
const cachePath = join(cacheDirectory, 'bank-cache.json')
const sourceSignature = () => ['library.sqlite3', 'editorial.sqlite3', 'editorial.sqlite3-wal'].map(name => {
  try { const stat = statSync(join(privateRoot, 'svoyak-library', name)); return `${name}:${stat.size}:${stat.mtimeMs}` } catch { return `${name}:missing` }
}).join('|')
async function read(path: string): Promise<any> {
  const response = await fetch(`${origin}/library-api/${path}`, { signal: AbortSignal.timeout(15_000) })
  if (!response.ok) throw new Error('Библиотека вопросов недоступна. Запустите локальный редактор на порту 5188.')
  return response.json()
}
async function parallel<T, R>(items: T[], work: (item: T) => Promise<R>): Promise<R[]> {
  let index = 0
  const output: R[] = new Array(items.length)
  await Promise.all(Array.from({ length: Math.min(6, items.length) }, async () => {
    while (index < items.length) { const i = index++; output[i] = await work(items[i]) }
  }))
  return output
}

/** Read-only bridge to the existing editorial runtime; never calls build/play/review. */
export class EditorialQuestionBank implements QuestionBank {
  private cached?: { signature: string; value: Bank }
  private loading?: Promise<Bank>
  async load(): Promise<Bank> {
    const signature = sourceSignature()
    if (this.cached?.signature === signature) return this.cached.value
    if (!this.cached) {
      try { const cached = JSON.parse(readFileSync(cachePath, 'utf8')); if (cached.signature === signature) { this.cached = cached; return cached.value } } catch { /* Rebuild a disposable cache from the editorial runtime. */ }
    }
    if (this.loading) return this.loading
    this.loading = this.refresh().finally(() => { this.loading = undefined })
    return this.loading
  }
  private async refresh(): Promise<Bank> {
    const [stats, edition] = await Promise.all([read('stats'), read('edition')])
    const approved = edition.items.filter((q: any) => q.review_status === 'approved')
    const details = await parallel<any, any>(approved, q => read(`question/${encodeURIComponent(q.id)}`))
    const questions: BankQuestion[] = details.filter(q => q.blockers?.length === 0 && q.media_policy === 'text_only').map(q => ({
      id: q.id, hash: q.content_hash, themeId: q.editorial_theme || `${q.pack_id}:${q.theme_name}`,
      theme: q.editorial_theme || q.theme_name, topic: q.topics[0]?.topic_slug ?? 'everyday',
      packId: q.pack_id, packTitle: q.pack_title, prompt: q.prompt, answer: q.answer,
      aliases: q.aliases ?? [], note: q.host_note ?? '', source: q.source_url, difficulty: q.difficulty ?? 3,
      age: q.age_min ?? 18, duplicateIds: (q.related ?? []).filter((x: any) => ['exact_duplicate', 'possible_duplicate'].includes(x.kind)).map((x: any) => x.id),
    }))
    const revision = createHash('sha256').update(questions.map(q => `${q.id}:${q.hash}`).sort().join('\n')).digest('hex').slice(0, 20)
    const catalog: Catalog = {
      revision, localOnly: true, total: edition.summary.total, playable: questions.length,
      packs: stats.packs_list.map((p: any) => ({ id: p.id, title: p.title, total: p.questions,
        playable: questions.filter(q => q.packId === p.id).length,
        topics: [...new Set(questions.filter(q => q.packId === p.id).map(q => q.topic))],
      })),
      topics: stats.topics.map((t: any) => ({ id: t.slug, label: t.label, playable: questions.filter(q => q.topic === t.slug).length })),
    }
    const value = { catalog, questions }
    this.cached = { signature: sourceSignature(), value }
    try { mkdirSync(cacheDirectory, { recursive: true }); writeFileSync(cachePath, JSON.stringify(this.cached)) } catch { /* The in-memory bank remains usable. */ }
    return value
  }
  async validate(questions: BankQuestion[]) {
    const current = await parallel(questions, q => read(`question/${encodeURIComponent(q.id)}`))
    if (current.some((q, i) => q.blockers?.length !== 0 || q.content_hash !== questions[i].hash || q.media_policy !== 'text_only')) {
      this.cached = undefined
      try { writeFileSync(cachePath, '{}') } catch { /* Optional cache. */ }
      throw new Error('Вопросы в библиотеке изменились или сняты с допуска. Соберите общий пак заново.')
    }
  }
}

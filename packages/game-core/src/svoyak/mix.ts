import { createHash } from 'node:crypto'
import type { Bank, BankQuestion } from './bank.js'
import type { Member, MixPlan, RoomSettings, ThemeInfo } from '@shoditsa/contracts/svoyak'
import { themeGroups, promptIdentity } from './groups.js'
export { themeGroups } from './groups.js'

export type SelectedTheme = ThemeInfo & { questions: (BankQuestion & { points: number })[] }
export const normalized = (value: string) => value.toLocaleLowerCase('ru-RU').replace(/ё/g, 'е').replace(/[^\p{L}\p{N}]+/gu, ' ').trim()
export const questionIdentity = (value: string) => value.replace(/^(\d+):[a-f0-9]{8,64}:/, '$1:')
const tie = (seed: string, id: string) => createHash('sha256').update(`${seed}:${id}`).digest('hex')
const matches = (member: Member, topic: string) => !member.preferences.topics.length || member.preferences.topics.includes(topic)

/** Full database pool, normalized participant votes and whole-theme weighted allocation. */
export function buildMix(bank: Bank, players: Member[], settings: RoomSettings, seed: string): { plan: MixPlan; themes: SelectedTheme[] } {
  const candidates = bank.questions.filter(q => q.age <= settings.age)
  const complete = themeGroups(candidates)
  const availableTopics = [...new Set(complete.map(group => group.questions[0].topic))]
  const weights = new Map<string, number>()
  for (const player of players) {
    const interests = player.preferences.topics.length ? [...new Set(player.preferences.topics)] : availableTopics
    for (const topic of interests) weights.set(topic, (weights.get(topic) ?? 0) + 1 / interests.length)
  }
  const totalWeight = [...weights.values()].reduce((sum, weight) => sum + weight, 0)
  const available = complete.filter(group => (weights.get(group.questions[0].topic) ?? 0) > 0)
  const wanted = settings.rounds * settings.themesPerRound
  const themes: SelectedTheme[] = [], usedIds = new Set<string>(), usedAnswers = new Set<string>(), usedPrompts = new Set<string>()
  const coverage = new Map(players.map(p => [p.id, 0]))
  while (available.length && themes.length < wanted) {
    const missing = players.filter(p => !coverage.get(p.id))
    const protectCoverage = wanted - themes.length <= missing.length
    const uncovered = (group: typeof available[number]) => protectCoverage ? missing.filter(p => matches(p, group.questions[0].topic)).length : 0
    const score = (group: typeof available[number]) => {
      const topic = group.questions[0].topic
      return wanted * (weights.get(topic) ?? 0) / totalWeight - themes.filter(t => t.topic === topic).length
    }
    available.sort((a, b) => uncovered(b) - uncovered(a) || score(b) - score(a) || tie(seed, a.id).localeCompare(tie(seed, b.id)))
    const group = available.shift()!
    const chosen: BankQuestion[] = []
    for (const q of [...group.questions].sort((a, b) => tie(seed, a.id).localeCompare(tie(seed, b.id)))) {
      const other = [...themes.flatMap(t => t.questions), ...chosen]
      if (usedIds.has(q.id) || other.some(x => x.duplicateIds.includes(q.id) || q.duplicateIds.includes(x.id))) continue
      const answers = [q.answer, ...q.aliases].map(normalized).filter(Boolean)
      if (answers.some(a => usedAnswers.has(a) || chosen.some(c => [c.answer, ...c.aliases].map(normalized).includes(a)))) continue
      if (usedPrompts.has(promptIdentity(q, normalized)) || chosen.some(c => promptIdentity(c, normalized) === promptIdentity(q, normalized))) continue
      chosen.push(q)
      if (chosen.length === 5) break
    }
    if (chosen.length < 5) continue
    chosen.sort((a, b) => a.difficulty - b.difficulty || tie(seed, a.id).localeCompare(tie(seed, b.id)))
    const first = chosen[0]
    const label = bank.catalog.topics.find(t => t.id === first.topic)?.label ?? first.topic
    const theme: SelectedTheme = { id: group.id, name: group.mixed ? `${label}: сборная тема` : first.theme, topic: first.topic,
      packTitle: group.mixed ? 'Смешанная подборка' : first.packTitle, round: Math.floor(themes.length / settings.themesPerRound) + 1,
      questions: chosen.map((q, i) => ({ ...q, points: (i + 1) * 100 * (Math.floor(themes.length / settings.themesPerRound) + 1) })),
    }
    themes.push(theme)
    for (const q of chosen) { usedIds.add(q.id); usedPrompts.add(promptIdentity(q, normalized)); for (const a of [q.answer, ...q.aliases]) usedAnswers.add(normalized(a)) }
    for (const player of players) if (matches(player, theme.topic)) coverage.set(player.id, coverage.get(player.id)! + 1)
  }
  if (themes.length < wanted) throw new Error(`По выбранным интересам в базе доступно ${themes.length} полных тем по 5 вопросов, нужно ${wanted}. Добавьте интересы или уменьшите число тем и раундов.`)
  const missing = players.filter(p => !coverage.get(p.id))
  if (missing.length) throw new Error(`Не удалось учесть интересы: ${missing.map(p => p.name).join(', ')}. Добавьте интересы или увеличьте число тем и соберите заново.`)
  return { themes, plan: { algorithm: 'topics-v2', id: seed, libraryRevision: bank.catalog.revision, questions: wanted * 5,
    distribution: [...weights].map(([topic, weight]) => ({ topic, weight: weight / totalWeight, questions: themes.filter(t => t.topic === topic).length * 5 })),
    estimatedMinutes: Math.ceil(wanted * 5 * 1.5), themes: themes.map(({ questions: _, ...theme }) => theme),
    coverage: players.map(p => ({ playerId: p.id, name: p.name, themes: coverage.get(p.id)! })),
  } }
}

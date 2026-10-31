import type { BankQuestion } from './bank.js'

/** Keep complete author themes; pool incomplete themes by the player's chosen topic. */
export function themeGroups(questions: BankQuestion[]) {
  const original = new Map<string, BankQuestion[]>()
  for (const q of questions) {
    const key = `${q.themeId}:${q.topic}`
    original.set(key, [...(original.get(key) ?? []), q])
  }
  const complete = [...original].filter(([, rows]) => rows.length >= 5)
  const remainder = new Map<string, BankQuestion[]>()
  for (const rows of original.values()) if (rows.length < 5)
    for (const q of rows) remainder.set(q.topic, [...(remainder.get(q.topic) ?? []), q])
  // A small remainder borrows an entire matching theme, so every ready card stays reachable.
  for (const [topic, rows] of remainder) if (rows.length < 5) {
    const index = complete.findIndex(([, group]) => group[0].topic === topic)
    if (index >= 0) rows.push(...complete.splice(index, 1)[0][1])
  }
  return [
    ...complete.map(([id, rows]) => ({ id, questions: rows, mixed: false })),
    ...[...remainder].filter(([, rows]) => rows.length >= 5)
      .map(([topic, rows]) => ({ id: `mixed:${topic}`, questions: rows, mixed: true })),
  ]
}

/** Identical media instructions are not duplicates when their question assets differ. */
export const promptIdentity = (q: BankQuestion, normalize: (text: string) => string) =>
  JSON.stringify([normalize(q.prompt), (q.media ?? []).filter(m => m.phase !== 'answer').map(m => [m.kind, m.url])])

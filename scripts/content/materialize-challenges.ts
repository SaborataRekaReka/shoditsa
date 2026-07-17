import { and, asc, eq } from 'drizzle-orm'
import { loadConfig } from '@shoditsa/config'
import { contentItemVersions, contentRevisions, createDatabase, dailyChallenges } from '@shoditsa/database'
import type { ApiDifficultyKey, PeriodKey, TitleItem, TitleMode } from '@shoditsa/contracts'
import { dailyTitle, DIFFICULTY_ORDER, PERIODS, poolFor } from '@shoditsa/game-core'
import { arg } from './lib.js'

const daysBefore = Number(arg('--days-before') ?? 90)
const daysAfter = Number(arg('--days-after') ?? 30)
const { db, client } = createDatabase(loadConfig())
try {
  const revision = await db.select({ id: contentRevisions.id }).from(contentRevisions).where(eq(contentRevisions.status, 'active')).limit(1)
  if (!revision[0]) throw new Error('No active revision')
  const rows = await db.select({ id: contentItemVersions.id, mode: contentItemVersions.mode, payload: contentItemVersions.payload })
    .from(contentItemVersions).where(and(eq(contentItemVersions.revisionId, revision[0].id), eq(contentItemVersions.allowedInGame, true))).orderBy(asc(contentItemVersions.sortOrder))
  const byMode = new Map<TitleMode, Array<{ id: string; item: TitleItem }>>()
  for (const row of rows) {
    if (row.mode === 'city') continue
    const list = byMode.get(row.mode) ?? []
    list.push({ id: row.id, item: row.payload as TitleItem }); byMode.set(row.mode, list)
  }
  const salt = Number(process.env.DAILY_GLOBAL_SALT ?? 0)
  let count = 0
  for (let delta = -daysBefore; delta <= daysAfter; delta += 1) {
    const date = new Date(); date.setUTCDate(date.getUTCDate() + delta)
    const puzzleDate = new Intl.DateTimeFormat('en-CA', { timeZone: 'Europe/Moscow', year: 'numeric', month: '2-digit', day: '2-digit' }).format(date)
    for (const [mode, entries] of byMode) {
      const periods = ['movie', 'series', 'anime'].includes(mode) ? Object.keys(PERIODS) as PeriodKey[] : ['all'] as PeriodKey[]
      const difficulties: Array<ApiDifficultyKey | null> = mode === 'music' ? DIFFICULTY_ORDER.map((value) => value as ApiDifficultyKey) : [null]
      for (const period of periods) for (const difficulty of difficulties) {
        const pool = poolFor(entries.map((entry) => entry.item), mode, period)
        const answer = dailyTitle(pool, mode, period, puzzleDate, salt, difficulty ?? '')
        if (!answer) continue
        const answerVersion = entries.find((entry) => entry.item.id === answer.id)!
        const variant = difficulty ?? '-'
        const key = `${puzzleDate}|${mode}|${period}|${variant}|${salt}|v1`
        await db.insert(dailyChallenges).values({ challengeKey: key, puzzleDate, mode, period, difficulty, variantKey: variant, revisionId: revision[0].id, answerItemVersionId: answerVersion.id, globalSalt: salt, algorithmVersion: 1 }).onConflictDoNothing()
        count += 1
      }
    }
  }
  console.log(`Materialized ${count} challenge variants for revision ${revision[0].id}`)
} finally { await client.end() }

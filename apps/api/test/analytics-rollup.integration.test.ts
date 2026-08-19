import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { and, asc, eq, inArray } from 'drizzle-orm'
import { loadConfig } from '@shoditsa/config'
import {
  analyticsEventDaily,
  clientEvents,
  createDatabase,
  user,
  type Database,
} from '@shoditsa/database'
import { rollupClientEventRetention } from '../src/modules/stats/analytics-rollup-service.js'

const NOW = new Date('2026-08-19T12:00:00.000Z')
const OLD_DATE = '2026-07-10'
const OLD_OCCURRED_AT = new Date(`${OLD_DATE}T10:00:00.000Z`)
const RETAINED_DATE = '2026-07-15'
const RETAINED_OCCURRED_AT = new Date(`${RETAINED_DATE}T10:00:00.000Z`)

describe('analytics daily rollup PostgreSQL integration', () => {
  let database: ReturnType<typeof createDatabase>

  beforeAll(() => {
    database = createDatabase(loadConfig())
  })

  afterAll(async () => {
    await database?.client.end()
  })

  it('deduplicates compatibility events, retains the overlap, retries idempotently, and rolls back failures', async () => {
    const rollbackTest = new Error('rollback analytics rollup integration fixture')

    try {
      await database.db.transaction(async (tx) => {
        // Make marker assertions deterministic without changing the database:
        // this whole fixture, including this delete, is rolled back below.
        await tx.delete(analyticsEventDaily)

        const userId = crypto.randomUUID()
        await tx.insert(user).values({
          id: userId,
          name: 'Analytics rollup integration user',
          email: `analytics-rollup-${userId}@example.test`,
          emailVerified: true,
        })

        const oldCanonicalId = crypto.randomUUID()
        const oldLegacyId = crypto.randomUUID()
        const retainedCanonicalId = crypto.randomUUID()
        const retainedLegacyId = crypto.randomUUID()
        const allEventIds = [oldCanonicalId, oldLegacyId, retainedCanonicalId, retainedLegacyId]
        const eventProperties = (transitionId: string, acquisitionId: string) => ({
          transition_id: transitionId,
          acquisition_id: acquisitionId,
          entry_source: 'organic_search',
          entry_search_engine: 'yandex',
          entry_path: '/danetki/dlya-detey',
          to_mode: 'movie',
        })

        await tx.insert(clientEvents).values([
          {
            eventId: oldCanonicalId,
            eventName: 'game_next_clicked',
            occurredAt: OLD_OCCURRED_AT,
            userId,
            route: '/danetki/dlya-detey',
            properties: eventProperties('transition-old', 'acquisition-old'),
          },
          {
            eventId: oldLegacyId,
            eventName: 'danetki_cross_game_clicked',
            occurredAt: new Date(OLD_OCCURRED_AT.getTime() + 1_000),
            userId,
            route: '/danetki/dlya-detey',
            properties: eventProperties('transition-old', 'acquisition-old'),
          },
          {
            eventId: retainedCanonicalId,
            eventName: 'game_next_clicked',
            occurredAt: RETAINED_OCCURRED_AT,
            userId,
            route: '/danetki/dlya-detey',
            properties: eventProperties('transition-retained', 'acquisition-retained'),
          },
          {
            eventId: retainedLegacyId,
            eventName: 'danetki_cross_game_clicked',
            occurredAt: new Date(RETAINED_OCCURRED_AT.getTime() + 1_000),
            userId,
            route: '/danetki/dlya-detey',
            properties: eventProperties('transition-retained', 'acquisition-retained'),
          },
        ])

        let executions = 0
        const injectedFailure = new Error('injected failure before rollup completion marker')
        const failingDatabase = {
          transaction: (callback: (inner: Database) => Promise<unknown>) => tx.transaction(async (nested) => {
            const failingTransaction = {
              execute: async (query: Parameters<typeof nested.execute>[0]) => {
                executions += 1
                if (executions === 4) throw injectedFailure
                return nested.execute(query)
              },
            } as unknown as Database
            return callback(failingTransaction)
          }),
        } as unknown as Database

        await expect(rollupClientEventRetention(failingDatabase, NOW)).rejects.toBe(injectedFailure)
        expect(executions).toBe(4)
        expect(await tx.select({ eventName: analyticsEventDaily.eventName }).from(analyticsEventDaily)).toEqual([])
        expect((await tx.select({ eventId: clientEvents.eventId }).from(clientEvents)
          .where(inArray(clientEvents.eventId, allEventIds)))).toHaveLength(4)

        await rollupClientEventRetention(tx as unknown as Database, NOW)

        const archived = await tx.select({
          activityDate: analyticsEventDaily.activityDate,
          eventsCount: analyticsEventDaily.eventsCount,
          usersCount: analyticsEventDaily.usersCount,
          acquisitionsCount: analyticsEventDaily.acquisitionsCount,
        }).from(analyticsEventDaily).where(and(
          inArray(analyticsEventDaily.activityDate, [OLD_DATE, RETAINED_DATE]),
          eq(analyticsEventDaily.eventName, 'game_next_clicked'),
          eq(analyticsEventDaily.entrySource, 'organic_search'),
          eq(analyticsEventDaily.searchEngine, 'yandex'),
          eq(analyticsEventDaily.entryPath, '/danetki/dlya-detey'),
          eq(analyticsEventDaily.mode, 'movie'),
        )).orderBy(asc(analyticsEventDaily.activityDate))

        expect(archived).toEqual([
          { activityDate: OLD_DATE, eventsCount: 1, usersCount: 1, acquisitionsCount: 1 },
          { activityDate: RETAINED_DATE, eventsCount: 1, usersCount: 1, acquisitionsCount: 1 },
        ])

        const completionMarkers = await tx.select({ activityDate: analyticsEventDaily.activityDate })
          .from(analyticsEventDaily).where(and(
            eq(analyticsEventDaily.eventName, '__rollup_complete__'),
            inArray(analyticsEventDaily.activityDate, [OLD_DATE, RETAINED_DATE]),
          )).orderBy(asc(analyticsEventDaily.activityDate))
        expect(completionMarkers).toEqual([{ activityDate: OLD_DATE }, { activityDate: RETAINED_DATE }])

        const retentionMarkers = await tx.select({ activityDate: analyticsEventDaily.activityDate })
          .from(analyticsEventDaily).where(eq(analyticsEventDaily.eventName, '__raw_retention_38_started__'))
        expect(retentionMarkers).toEqual([{ activityDate: '2026-08-19' }])

        const remainingRaw = await tx.select({ eventId: clientEvents.eventId })
          .from(clientEvents).where(inArray(clientEvents.eventId, allEventIds))
        expect(new Set(remainingRaw.map((row) => row.eventId))).toEqual(new Set([retainedCanonicalId, retainedLegacyId]))

        await rollupClientEventRetention(tx as unknown as Database, NOW)
        const archivedAfterRetry = await tx.select({
          activityDate: analyticsEventDaily.activityDate,
          eventsCount: analyticsEventDaily.eventsCount,
          usersCount: analyticsEventDaily.usersCount,
          acquisitionsCount: analyticsEventDaily.acquisitionsCount,
        }).from(analyticsEventDaily).where(and(
          inArray(analyticsEventDaily.activityDate, [OLD_DATE, RETAINED_DATE]),
          eq(analyticsEventDaily.eventName, 'game_next_clicked'),
          eq(analyticsEventDaily.entrySource, 'organic_search'),
          eq(analyticsEventDaily.searchEngine, 'yandex'),
          eq(analyticsEventDaily.entryPath, '/danetki/dlya-detey'),
          eq(analyticsEventDaily.mode, 'movie'),
        )).orderBy(asc(analyticsEventDaily.activityDate))
        expect(archivedAfterRetry).toEqual(archived)

        throw rollbackTest
      })
    } catch (error) {
      if (error !== rollbackTest) throw error
    }
  })
})

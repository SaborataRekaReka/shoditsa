import { randomUUID } from 'node:crypto'
import { readFileSync } from 'node:fs'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { and, eq, sql } from 'drizzle-orm'
import { loadConfig } from '@shoditsa/config'
import type { TitleItem } from '@shoditsa/contracts'
import { auditLog, contentAliases, contentItems, contentItemVersions, contentRevisions, createDatabase, diagnosisVignettes, playerProfiles, user } from '@shoditsa/database'
import { contentPayloadsEqual } from '../src/modules/admin/content-service.js'
import { stageMusicCatalogReplacement } from '../src/modules/admin/music-catalog-replacement.js'

describe('immutable editorial music replacement', () => {
  const artistId = `music:replacement-test:${randomUUID()}`
  const actorId = randomUUID()
  const source = JSON.parse(readFileSync(new URL('../../../public/data/libraries/music/items.json', import.meta.url), 'utf8')) as TitleItem[]
  const items = source.map((item, index) => index ? item : { ...item, id: artistId, canonicalId: artistId })
  let database: ReturnType<typeof createDatabase>
  let baseId = ''
  let targetId = ''
  let before: Array<typeof contentItemVersions.$inferSelect> = []
  beforeAll(async () => {
    const config = loadConfig()
    if (config.production) throw new Error('Music replacement integration tests must not run in production')
    database = createDatabase(config)
    baseId = (await database.db.select().from(contentRevisions).where(eq(contentRevisions.status, 'active')).limit(1))[0].id
    before = await database.db.select().from(contentItemVersions).where(eq(contentItemVersions.revisionId, baseId))
    await database.db.insert(user).values({ id: actorId, name: 'Music migration test', email: `${actorId}@integration.invalid`, emailVerified: true })
    await database.db.insert(playerProfiles).values({ userId: actorId, role: 'admin' })
  })
  afterAll(async () => {
    if (!database) return
    await database.db.delete(auditLog).where(eq(auditLog.actorUserId, actorId))
    if (targetId) await database.db.delete(contentRevisions).where(and(eq(contentRevisions.id, targetId), eq(contentRevisions.status, 'ready')))
    await database.db.delete(contentItems).where(eq(contentItems.id, artistId))
    await database.db.delete(user).where(eq(user.id, actorId))
    await database.client.end()
  })

  it('replaces the ordinary roster exactly while preserving other modes, K-pop, aliases and vignettes', async () => {
    const result = await stageMusicCatalogReplacement(database.db, items, baseId, actorId)
    targetId = result.revisionId
    expect(result.created).toBe(true)
    const after = await database.db.select().from(contentItemVersions).where(eq(contentItemVersions.revisionId, targetId))
    const ordinary = after.filter((row) => row.mode === 'music' && (row.payload as TitleItem).cardType !== 'kpop_artist')
    expect(ordinary.map((row) => row.itemId).sort()).toEqual(items.map((item) => item.id).sort())
    const preserved = before.filter((row) => row.mode !== 'music' || (row.payload as TitleItem).cardType === 'kpop_artist')
    const afterById = new Map(after.map((row) => [row.itemId, row]))
    for (const old of preserved) {
      const next = afterById.get(old.itemId)!
      expect(next, old.itemId).toBeDefined()
      expect(contentPayloadsEqual(old.payload as Record<string, unknown>, next.payload as Record<string, unknown>), old.itemId).toBe(true)
      expect(next.allowedInGame).toBe(old.allowedInGame)
      expect(next.sortOrder).toBe(old.sortOrder)
    }
    const preservedAliases = async (revisionId: string) => database.db.select({ itemId: contentItemVersions.itemId, alias: contentAliases.alias, normalized: contentAliases.normalizedAlias, kind: contentAliases.kind })
      .from(contentAliases).innerJoin(contentItemVersions, eq(contentItemVersions.id, contentAliases.itemVersionId))
      .where(and(eq(contentItemVersions.revisionId, revisionId), sql`(${contentItemVersions.mode} <> 'music' or ${contentItemVersions.payload}->>'cardType' = 'kpop_artist')`))
      .orderBy(contentItemVersions.itemId, contentAliases.normalizedAlias)
    expect(await preservedAliases(targetId)).toEqual(await preservedAliases(baseId))
    const vignettes = async (revisionId: string) => database.db.select({ itemId: contentItemVersions.itemId, text: diagnosisVignettes.text, sort: diagnosisVignettes.sortOrder })
      .from(diagnosisVignettes).innerJoin(contentItemVersions, eq(contentItemVersions.id, diagnosisVignettes.itemVersionId))
      .where(eq(contentItemVersions.revisionId, revisionId)).orderBy(contentItemVersions.itemId, diagnosisVignettes.sortOrder)
    expect(await vignettes(targetId)).toEqual(await vignettes(baseId))
    expect((await database.db.select().from(contentRevisions).where(eq(contentRevisions.id, targetId)))[0].status).toBe('ready')
    expect((await database.db.select().from(contentRevisions).where(eq(contentRevisions.status, 'active')))[0].id).toBe(baseId)
    expect(await database.db.select().from(contentItemVersions).where(eq(contentItemVersions.revisionId, baseId))).toEqual(before)
  })

  it('refuses a stale base and safely reuses the identical staged revision', async () => {
    await expect(stageMusicCatalogReplacement(database.db, items, randomUUID(), actorId)).rejects.toThrow(/Active revision changed/)
    const again = await stageMusicCatalogReplacement(database.db, items, baseId, actorId)
    expect(again.created).toBe(false)
    expect(again.revisionId).toBe(targetId)
  })
})

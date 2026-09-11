import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { eq } from 'drizzle-orm'
import { loadConfig } from '@shoditsa/config'
import { authEvents, clientEvents, commerceProducts, contentItemVersions, createDatabase, gameSessions, paymentOrders, playerProfiles, user, type Database } from '@shoditsa/database'
import { loadAdminCampaignFunnel } from '../src/modules/admin/campaign-funnel-service.js'

describe('campaign funnel SQL (isolated PostgreSQL fixture, rolled back)', () => {
  let database: ReturnType<typeof createDatabase> | undefined
  beforeAll(() => {
    const config = loadConfig()
    const target = new URL(config.databaseUrl)
    if (config.production || !['localhost', '127.0.0.1', '[::1]'].includes(target.hostname) || target.port !== '5435' || target.pathname !== '/shoditsa_growth_test') {
      throw new Error('Campaign integration requires isolated local PostgreSQL :5435/shoditsa_growth_test')
    }
    database = createDatabase(config)
  })
  afterAll(async () => { await database?.client.end() })

  it('executes actual SQL joins and excludes admins, existing accounts, pending consent and stub orders', async () => {
    const rollback = new Error('rollback campaign test fixtures')
    try {
      await database!.db.transaction(async (tx) => {
        const content = (await tx.select().from(contentItemVersions).where(eq(contentItemVersions.mode, 'diagnosis')).limit(1))[0]
        if (!content) throw new Error('Local Diagnosis content must be seeded')
        const [guestId, accountId, adminId, existingId] = Array.from({ length: 4 }, () => crypto.randomUUID())
        const [acquisitionId, adminAcquisitionId, existingAcquisitionId, pendingId] = Array.from({ length: 4 }, () => crypto.randomUUID())
        const source = `qa_${crypto.randomUUID().replaceAll('-', '')}`
        const campaign = 'diagnosis_pilot_integration'
        const from = new Date('2026-09-05T10:00:00Z')
        const signupAt = new Date('2026-09-05T10:10:00Z')
        await tx.insert(user).values([
          { id: guestId, name: 'Campaign fixture', email: `${guestId}@example.test`, isAnonymous: true, createdAt: from },
          { id: accountId, name: 'Campaign fixture', email: `${accountId}@example.test`, isAnonymous: false, createdAt: signupAt },
          { id: adminId, name: 'Campaign fixture', email: `${adminId}@example.test`, isAnonymous: false, createdAt: signupAt },
          { id: existingId, name: 'Campaign fixture', email: `${existingId}@example.test`, isAnonymous: false, createdAt: new Date('2026-08-01T00:00:00Z') },
        ])
        await tx.insert(playerProfiles).values([guestId, accountId, adminId, existingId].map((userId) => ({ userId, role: userId === adminId ? 'admin' as const : 'player' as const })))
        const sessions = [crypto.randomUUID(), crypto.randomUUID()]
        await tx.insert(gameSessions).values(sessions.map((id, index) => ({ id, userId: guestId, kind: 'daily', mode: 'diagnosis' as const, period: 'all' as const, puzzleDate: `2026-09-0${5 + index}`, revisionId: content.revisionId, answerItemVersionId: content.id, rulesVersion: 1, startedAt: new Date(`2026-09-05T10:0${1 + index * 4}:00Z`), completedAt: new Date(`2026-09-05T10:0${3 + index * 4}:00Z`), status: 'won', completionType: 'direct_win' })))
        const properties = (id: string, consent = 'accepted') => ({ acquisition_id: id, analytics_consent: consent, entry_path: '/games/diagnosis', utm_source: source, utm_medium: 'paid_social', utm_campaign: campaign })
        await tx.insert(clientEvents).values([
          { eventId: crypto.randomUUID(), eventName: 'page_view', occurredAt: from, userId: guestId, properties: properties(acquisitionId) },
          ...sessions.map((id, index) => ({ eventId: crypto.randomUUID(), eventName: 'game_session_complete', occurredAt: new Date(`2026-09-05T10:0${3 + index * 4}:00Z`), userId: guestId, gameSessionId: id, properties: properties(acquisitionId) })),
          { eventId: crypto.randomUUID(), eventName: 'page_view', occurredAt: from, userId: adminId, properties: properties(adminAcquisitionId) },
          { eventId: crypto.randomUUID(), eventName: 'page_view', occurredAt: from, userId: existingId, properties: properties(existingAcquisitionId) },
          { eventId: crypto.randomUUID(), eventName: 'page_view', occurredAt: from, userId: guestId, properties: properties(pendingId, 'pending') },
        ])
        await tx.insert(authEvents).values([
          { userId: accountId, eventName: 'sign_up', result: 'success', occurredAt: signupAt, acquisitionId, entryPath: '/games/diagnosis', utmSource: source, utmMedium: 'paid_social', utmCampaign: campaign },
          { userId: adminId, eventName: 'sign_up', result: 'success', occurredAt: signupAt, acquisitionId: adminAcquisitionId, entryPath: '/games/diagnosis', utmSource: source, utmMedium: 'paid_social', utmCampaign: campaign },
          { userId: existingId, eventName: 'sign_up', result: 'success', occurredAt: signupAt, acquisitionId: existingAcquisitionId, entryPath: '/games/diagnosis', utmSource: source, utmMedium: 'paid_social', utmCampaign: campaign },
          { userId: existingId, eventName: 'sign_in', result: 'success', occurredAt: signupAt, acquisitionId: existingAcquisitionId, entryPath: '/games/diagnosis', utmSource: source, utmMedium: 'paid_social', utmCampaign: campaign },
        ])
        const productId = `campaign_qa_${crypto.randomUUID()}`
        await tx.insert(commerceProducts).values({ id: productId, kind: 'club', title: 'Test only', description: 'Rolled-back fixture', priceMinor: 19900, currency: 'RUB', durationDays: 30, entitlementKey: 'club' })
        await tx.insert(paymentOrders).values(['cloudpayments', 'stub'].map((provider) => ({ userId: accountId, productId, provider, status: 'paid', amountMinor: 19900, currency: 'RUB', idempotencyKey: crypto.randomUUID(), createdAt: new Date('2026-09-05T10:11:00Z'), paidAt: new Date('2026-09-05T10:12:00Z') })))
        const report = await loadAdminCampaignFunnel(tx as unknown as Database, 7, new Date('2026-09-11T12:00:00Z'))
        const row = report.items.find((item) => item.source === source)
        expect(row).toMatchObject({ acquisitions: 2, started: 1, completed: 1, repeatCompleted: 1, registered: 1, registeredAfterCompletion: 1, paidClub: 1, paidClubOrders: 1 })
        expect(JSON.stringify(report)).not.toMatch(/example\.test|Campaign fixture/)
        expect(JSON.stringify(report)).not.toContain(guestId)
        expect(JSON.stringify(report)).not.toContain(acquisitionId)
        throw rollback
      })
    } catch (error) { if (error !== rollback) throw error }
  })
})

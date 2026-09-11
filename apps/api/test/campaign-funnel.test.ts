import { describe, expect, it, vi } from 'vitest'
import type { Database } from '@shoditsa/database'
import { buildAdminCampaignFunnel, loadAdminCampaignFunnel, type CampaignEventRow, type CampaignSessionRow, type CampaignSignupRow, type CampaignOrderRow } from '../src/modules/admin/campaign-funnel-service.js'

const now = new Date('2026-09-11T10:00:00Z')
const acquisitionId = '00000000-0000-4000-8000-000000000001'
const secondId = '00000000-0000-4000-8000-000000000002'
const event = (patch: Partial<CampaignEventRow> = {}): CampaignEventRow => ({ eventId: 'event-1', userId: 'guest', occurredAt: '2026-09-05T10:00:00Z', gameSessionId: null, properties: { acquisition_id: acquisitionId, analytics_consent: 'accepted', entry_path: '/games/diagnosis', utm_source: 'tg_medical', utm_medium: 'paid_social', utm_campaign: 'diagnosis_pilot_202609' }, ...patch })
const session = (patch: Partial<CampaignSessionRow> = {}): CampaignSessionRow => ({ id: 'session-1', userId: 'guest', mode: 'diagnosis', packId: null, startedAt: '2026-09-05T10:01:00Z', completedAt: '2026-09-05T10:05:00Z', status: 'won', ...patch })
const signup = (patch: Partial<CampaignSignupRow> = {}): CampaignSignupRow => ({ eventId: 'signup-1', userId: 'account', acquisitionId, occurredAt: '2026-09-05T10:10:00Z', accountCreatedAt: '2026-09-05T10:10:00Z', entryPath: '/games/diagnosis', utmSource: 'tg_medical', utmMedium: 'paid_social', utmCampaign: 'diagnosis_pilot_202609', ...patch })
const order = (patch: Partial<CampaignOrderRow> = {}): CampaignOrderRow => ({ id: 'order-1', userId: 'account', createdAt: '2026-09-05T10:11:00Z', paidAt: '2026-09-05T10:12:00Z', status: 'paid', provider: 'cloudpayments', productKind: 'club', ...patch })
const report = (patch: Partial<Parameters<typeof buildAdminCampaignFunnel>[0]> = {}) => buildAdminCampaignFunnel({ days: 7, now, events: [], sessions: [], signups: [], orders: [], ...patch })

describe('campaign funnel cohorts', () => {
  it('joins distinct owned sessions, actual new signup and subsequent paid club order without exposing identifiers', () => {
    const first = event()
    const result = report({ events: [first, first, event({ eventId: 'start-1', occurredAt: '2026-09-05T10:02:00Z', gameSessionId: 'session-1' }), event({ eventId: 'finish-1', occurredAt: '2026-09-05T10:05:00Z', gameSessionId: 'session-1' }), event({ eventId: 'start-2', occurredAt: '2026-09-05T10:08:00Z', gameSessionId: 'session-2' })], sessions: [session(), session({ id: 'session-2', startedAt: '2026-09-05T10:06:00Z', completedAt: '2026-09-05T10:09:00Z', status: 'lost' })], signups: [signup(), signup()], orders: [order(), order(), order({ id: 'stub', provider: 'stub' })] })
    expect(result.summary).toMatchObject({ acquisitions: 1, started: 1, completed: 1, repeatCompleted: 1, registered: 1, registeredAfterCompletion: 1, paidClub: 1, paidClubOrders: 1, matured24h: 1, matured7d: 0 })
    expect(result.coverage).toMatchObject({ campaignEvents: 4, sessionLinks: 2, matchedSessionLinks: 2, unmatchedSessionLinks: 0, retentionD2To7: null, wholeSiteConsentCoverage: null })
    expect(JSON.stringify(result)).not.toContain(acquisitionId)
    expect(JSON.stringify(result)).not.toContain('signup-1')
    expect(JSON.stringify(result)).not.toContain('session-1')
  })

  it('uses the first consented event in RAW, excludes earlier cohorts and the current day', () => {
    const props = event().properties as Record<string, unknown>
    const result = report({ events: [event({ eventId: 'prior', occurredAt: '2026-09-03T10:00:00Z' }), event(), event({ eventId: 'today', occurredAt: '2026-09-11T00:00:00Z', properties: { ...props, acquisition_id: secondId } })] })
    expect(result.summary.acquisitions).toBe(0)
    expect(result.window).toEqual({ fromInclusive: '2026-09-04T00:00:00.000Z', toExclusive: '2026-09-11T00:00:00.000Z', timezone: 'UTC' })
    expect(result.coverage.firstObservedAt).toBe('2026-09-03T10:00:00.000Z')
    expect(result.status).toBe('no_observations')
  })

  it('excludes missing consent, unsafe slugs, research, other landing and other media', () => {
    const properties = event().properties as Record<string, unknown>
    const variants = [{ analytics_consent: 'pending' }, { analytics_consent: 'rejected' }, { utm_source: 'mail@example.com' }, { utm_source: 'user_test' }, { utm_campaign: 'other_pilot' }, { utm_medium: 'organic' }, { entry_path: '/games/character' }, { acquisition_id: 'not-a-uuid' }]
    const result = report({ events: variants.map((patch, i) => event({ eventId: `excluded-${i}`, properties: { ...properties, ...patch } })) })
    expect(result.summary.acquisitions).toBe(0)
    expect(result.items).toEqual([])
    expect(JSON.stringify(result)).not.toContain('mail@example.com')
  })

  it('does not silently pick a winner for conflicting UTM on the same acquisition', () => {
    const properties = event().properties as Record<string, unknown>
    const result = report({ events: [event(), event({ eventId: 'conflict', properties: { ...properties, utm_source: 'another_channel' } })] })
    expect(result.summary.acquisitions).toBe(0)
    expect(result.coverage.conflictingAcquisitions).toBe(1)
  })

  it('rejects other owners, private packs, old starts and late completions', () => {
    const sessions = [session({ id: 'foreign', userId: 'another-owner' }), session({ id: 'private', packId: 'private-pack' }), session({ id: 'old', startedAt: '2026-09-01T00:00:00Z' }), session({ id: 'late', completedAt: '2026-09-11T00:00:00Z' })]
    const result = report({ events: [event(), ...sessions.map((item) => event({ eventId: item.id, gameSessionId: item.id, occurredAt: '2026-09-05T10:03:00Z' }))], sessions })
    expect(result.summary).toMatchObject({ acquisitions: 1, started: 1, completed: 0, repeatCompleted: 0 })
    expect(result.coverage).toMatchObject({ sessionLinks: 4, matchedSessionLinks: 1, unmatchedSessionLinks: 3 })
  })

  it('requires new account time and matching campaign, not any auth event with an acquisition', () => {
    const result = report({ events: [event()], signups: [signup({ userId: 'existing', accountCreatedAt: '2026-09-01T00:00:00Z' }), signup({ userId: 'other-campaign', utmSource: 'other' }), signup({ userId: 'late', occurredAt: '2026-09-11T00:00:00Z' })], orders: [order()] })
    expect(result.summary.registered).toBe(0)
    expect(result.summary.paidClub).toBe(0)
  })

  it('can register before completion without claiming a completed-to-registration conversion', () => {
    const result = report({ events: [event()], signups: [signup()], orders: [order({ id: 'early', createdAt: '2026-09-05T10:09:00Z' }), order({ id: 'not-paid', status: 'pending' }), order({ id: 'tickets', productKind: 'tickets' }), order({ id: 'late', paidAt: '2026-09-11T00:00:00Z' })] })
    expect(result.summary).toMatchObject({ registered: 1, registeredAfterCompletion: 0, paidClub: 0 })
  })

  it('separates channel rows and marks partial data without invented rates or retention', () => {
    const props = event().properties as Record<string, unknown>
    const result = report({ days: 14, truncated: true, events: [event(), event({ eventId: 'second', occurredAt: '2026-09-01T10:00:00Z', properties: { ...props, acquisition_id: secondId, utm_source: 'tg_referral', utm_medium: 'referral' } })] })
    expect(result.items).toHaveLength(2)
    expect(result.summary).toMatchObject({ acquisitions: 2, matured7d: 1 })
    expect(result.status).toBe('partial')
    expect(result.coverage.truncated).toBe(true)
    expect(result.coverage.retentionD2To7).toBeNull()
  })
})

describe('campaign funnel loader', () => {
  it('returns no observations without scanning auth or orders when no consented campaign exists', async () => {
    const execute = vi.fn().mockResolvedValue([])
    const result = await loadAdminCampaignFunnel({ execute } as unknown as Database, 7, now)
    expect(execute).toHaveBeenCalledTimes(1)
    expect(result.status).toBe('no_observations')
  })
})

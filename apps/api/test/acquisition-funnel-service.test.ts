import { describe, expect, it, vi } from 'vitest'
import type { Database } from '@shoditsa/database'
import {
  acquisitionReportWindow,
  attachAdminAcquisitionDailyArchive,
  buildAdminAcquisitionFunnel,
  canonicalAnalyticsEntryPath,
  loadAdminAcquisitionFunnel,
  type AcquisitionClientEventRow,
  type AcquisitionDailyRow,
  type AcquisitionSignUpRow,
} from '../src/modules/admin/acquisition-funnel-service.js'

const NOW = new Date('2026-08-19T12:00:00.000Z')

const clientEvent = (
  eventId: string,
  eventName: string,
  occurredAt: string,
  properties: Record<string, unknown>,
  options: Partial<Pick<AcquisitionClientEventRow, 'userId' | 'gameSessionId' | 'route'>> = {},
): AcquisitionClientEventRow => ({
  eventId,
  eventName,
  occurredAt,
  properties,
  userId: options.userId ?? 'user-1',
  gameSessionId: options.gameSessionId ?? null,
  route: options.route ?? '/games/danetki',
})

const signUp = (eventId: string, occurredAt: string, userId = 'user-1'): AcquisitionSignUpRow => ({ eventId, occurredAt, userId })
const dailyRow = (activityDate: string, eventName: string, eventsCount = 0, options: Partial<AcquisitionDailyRow> = {}): AcquisitionDailyRow => ({
  activityDate,
  eventName,
  entrySource: 'organic_search',
  searchEngine: 'yandex',
  entryPath: '/danetki',
  mode: 'danetki',
  eventsCount,
  usersCount: eventsCount,
  acquisitionsCount: eventsCount,
  ...options,
})

describe('admin acquisition funnel', () => {
  it('deduplicates compatibility events and attributes a registration to the organic cohort', () => {
    const events = [
      clientEvent('page-organic', 'page_view', '2026-08-13T09:00:00.000Z', {
        acquisition_id: 'acq-1', entry_source: 'organic_search', entry_path: '/games/danetki', entry_search_engine: 'Яндекс', mode: 'danetki',
      }),
      clientEvent('start-generic', 'game_session_start', '2026-08-13T09:01:00.000Z', { acquisition_id: 'acq-1', mode: 'danetki' }, { gameSessionId: 'session-1' }),
      clientEvent('start-legacy', 'danetki_room_started', '2026-08-13T09:01:01.000Z', { acquisition_id: 'acq-1', mode: 'danetki' }, { gameSessionId: 'session-1' }),
      clientEvent('complete-generic', 'game_session_complete', '2026-08-13T09:08:00.000Z', { acquisition_id: 'acq-1', mode: 'danetki' }, { gameSessionId: 'session-1' }),
      clientEvent('complete-legacy', 'danetki_room_completed', '2026-08-13T09:08:01.000Z', { acquisition_id: 'acq-1', mode: 'danetki' }, { gameSessionId: 'session-1' }),
      clientEvent('transition-1', 'game_next_clicked', '2026-08-13T09:09:00.000Z', { acquisition_id: 'acq-1', transition_id: 'transition-1', mode: 'danetki' }),
      clientEvent('legacy-transition', 'danetki_cross_game_clicked', '2026-08-13T09:09:01.000Z', { acquisition_id: 'acq-1', transition_id: 'transition-1', mode: 'danetki' }, { gameSessionId: 'session-1' }),
      clientEvent('legacy-recommendation', 'danetki_cross_game_clicked', '2026-08-13T09:09:30.000Z', { acquisition_id: 'acq-1', mode: 'danetki', toMode: 'character' }),
      clientEvent('next-start', 'game_next_start', '2026-08-13T09:10:00.000Z', { acquisition_id: 'acq-1', transition_id: 'transition-1', to_mode: 'diagnosis' }, { gameSessionId: 'session-2', route: '/games/diagnosis' }),
      clientEvent('page-direct', 'page_view', '2026-08-13T10:00:00.000Z', { entry_source: 'direct' }, { userId: 'user-2', route: '/' }),
    ]

    const result = buildAdminAcquisitionFunnel(events, [
      signUp('signup-1', '2026-08-14T09:00:00.000Z'),
      signUp('signup-duplicate', '2026-08-14T09:01:00.000Z'),
    ], 7, NOW)

    expect(result.summary).toMatchObject({
      organicLandings: 1,
      organicUsers: 1,
      starts: 1,
      completions: 1,
      nextClicks: 1,
      nextStarts: 1,
      signUps: 1,
      landingToStartRate: 100,
      startToCompleteRate: 100,
      completeToNextStartRate: 100,
      landingToSignUpRate: 100,
    })
    expect(result.byLanding[0]).toMatchObject({ label: '/games/danetki', searchEngine: 'yandex', organicLandings: 1, starts: 1, completions: 1, signUps: 1 })
    expect(result.byMode.find((entry) => entry.key === 'danetki')).toMatchObject({ organicLandings: 1, starts: 1, completions: 1, signUps: 1 })
    expect(result.activityByMode.find((entry) => entry.key === 'diagnosis')?.nextStarts).toBe(1)
    expect(result.activityByMode.find((entry) => entry.key === 'character')?.nextClicks).toBe(1)
    expect(result.coverage).toMatchObject({ lifecycleEvents: 8, lifecycleEventsWithAcquisition: 8, lifecycleEventRate: 100, pageViews: 2, pageViewsWithAcquisition: 1, successfulSignUps: 2, signUpsAttributedToOrganic: 2 })
  })

  it('reports missing attribution instead of treating it as direct or as an organic conversion', () => {
    const events = [
      clientEvent('organic-unkeyed', 'page_view', '2026-08-15T09:00:00.000Z', { entry_source: 'organic_search', entry_path: '/games/character' }, { route: '/games/character' }),
      clientEvent('start-unkeyed', 'game_session_start', '2026-08-15T09:01:00.000Z', { entry_source: 'organic_search', mode: 'character' }, { gameSessionId: 'session-2', route: '/games/character' }),
    ]

    const result = buildAdminAcquisitionFunnel(events, [signUp('signup-2', '2026-08-15T09:05:00.000Z')], 7, NOW)

    expect(result.summary.organicLandings).toBe(0)
    expect(result.summary.starts).toBe(0)
    expect(result.summary.signUps).toBe(0)
    expect(result.coverage).toMatchObject({
      lifecycleEvents: 1,
      lifecycleEventsWithAcquisition: 0,
      lifecycleEventRate: 0,
      successfulSignUps: 1,
      signUpsAttributedToOrganic: 0,
      signUpAttributionRate: 0,
      unkeyedOrganicEvents: 2,
    })
  })

  it('does not attribute a registration outside the bounded seven-day window', () => {
    const events = [clientEvent('old-organic', 'page_view', '2026-08-01T09:00:00.000Z', {
      acquisition_id: 'acq-old', entry_source: 'organic_search', entry_path: '/games/diagnosis', mode: 'diagnosis',
    }, { route: '/games/diagnosis' })]

    const result = buildAdminAcquisitionFunnel(events, [signUp('signup-late', '2026-08-09T09:01:00.000Z')], 31, NOW)

    expect(result.summary.organicLandings).toBe(1)
    expect(result.summary.signUps).toBe(0)
    expect(result.coverage.signUpsAttributedToOrganic).toBe(0)
    expect(result.coverage.retentionTruncationPossible).toBe(false)
  })

  it('scopes acquisition ids by user and canonicalizes private high-cardinality paths', () => {
    const events = [
      clientEvent('entry-1', 'page_view', '2026-08-15T09:00:00.000Z', {
        acquisition_id: 'shared-id', entry_source: 'organic_search', entry_path: '/sessions/27e0927b-9720-4e72-b831-15fa9c8f38eb',
      }, { userId: 'user-1', route: '/sessions/27e0927b-9720-4e72-b831-15fa9c8f38eb' }),
      clientEvent('start-1', 'game_session_start', '2026-08-15T09:01:00.000Z', { acquisition_id: 'shared-id' }, { userId: 'user-1', gameSessionId: 'session-1' }),
      clientEvent('entry-2', 'page_view', '2026-08-15T10:00:00.000Z', {
        acquisition_id: 'shared-id', entry_source: 'organic_search', entry_path: '/games/movie',
      }, { userId: 'user-2', route: '/games/movie' }),
      clientEvent('start-2', 'game_session_start', '2026-08-15T10:01:00.000Z', { acquisition_id: 'shared-id' }, { userId: 'user-2', gameSessionId: 'session-2' }),
    ]

    const result = buildAdminAcquisitionFunnel(events, [], 7, NOW)

    expect(result.summary).toMatchObject({ organicLandings: 2, organicUsers: 2, starts: 2 })
    expect(result.byLanding.some((entry) => entry.label.includes('27e0927b'))).toBe(false)
    expect(result.byLanding.find((entry) => entry.label === '/other')?.starts).toBe(1)
    expect(canonicalAnalyticsEntryPath('/auth/reset?token=secret')).toBe('/other')
  })

  it('counts conversion stages once per acquisition and session activity separately', () => {
    const events = [
      clientEvent('entry', 'page_view', '2026-08-15T09:00:00.000Z', {
        acquisition_id: 'acq-sessions', entry_source: 'organic_search', entry_path: '/games/character', mode: 'danetki',
      }, { route: '/games/character' }),
      clientEvent('start-a', 'game_session_start', '2026-08-15T09:01:00.000Z', { acquisition_id: 'acq-sessions', mode: 'character' }, { gameSessionId: 'session-a', route: '/games/character' }),
      clientEvent('start-b', 'game_session_start', '2026-08-15T09:02:00.000Z', { acquisition_id: 'acq-sessions', mode: 'diagnosis' }, { gameSessionId: 'session-b', route: '/games/diagnosis' }),
    ]

    const result = buildAdminAcquisitionFunnel(events, [], 7, NOW)

    expect(result.summary).toMatchObject({ organicLandings: 1, starts: 1, landingToStartRate: 100 })
    expect(result.summary.activity.sessionStarts).toBe(2)
    expect(result.byMode.find((entry) => entry.key === 'character')?.starts).toBe(1)
    expect(result.byMode.find((entry) => entry.key === 'danetki')).toBeUndefined()
    expect(result.activityByMode.find((entry) => entry.key === 'diagnosis')?.sessionStarts).toBe(1)
  })

  it('attributes signup to the latest acquisition start, not the latest event in an older acquisition', () => {
    const events = [
      clientEvent('entry-a', 'page_view', '2026-08-13T09:00:00.000Z', { acquisition_id: 'acq-a', entry_source: 'organic_search', entry_path: '/games/diagnosis' }, { route: '/games/diagnosis' }),
      clientEvent('entry-b', 'page_view', '2026-08-14T09:00:00.000Z', { acquisition_id: 'acq-b', entry_source: 'organic_search', entry_path: '/games/character' }, { route: '/games/character' }),
      clientEvent('late-a', 'game_session_start', '2026-08-15T09:00:00.000Z', { acquisition_id: 'acq-a' }, { gameSessionId: 'session-a', route: '/games/diagnosis' }),
    ]

    const result = buildAdminAcquisitionFunnel(events, [signUp('signup', '2026-08-16T09:00:00.000Z')], 7, NOW)

    expect(result.byLanding.find((entry) => entry.label === '/games/character')?.signUps).toBe(1)
    expect(result.byLanding.find((entry) => entry.label === '/games/diagnosis')?.signUps).toBe(0)
  })

  it('keeps the 31-day cohort exact in raw and exposes daily activity as a separate archive', () => {
    const window = acquisitionReportWindow(31, NOW)
    const raw = buildAdminAcquisitionFunnel([
      clientEvent('raw-entry', 'page_view', '2026-08-18T09:00:00.000Z', { acquisition_id: 'raw-acq', entry_source: 'organic_search', entry_path: '/games/movie' }, { route: '/games/movie' }),
      clientEvent('raw-start', 'game_session_start', '2026-08-18T09:01:00.000Z', { acquisition_id: 'raw-acq', mode: 'movie' }, { gameSessionId: 'raw-session', route: '/games/movie' }),
    ], [], 31, NOW, { from: window.reportFrom, to: window.reportTo })
    const result = attachAdminAcquisitionDailyArchive(raw, [
      dailyRow('2026-07-19', '__rollup_complete__'),
      dailyRow('2026-07-19', 'game_session_start', 3),
      dailyRow('2026-07-19', 'game_session_complete', 2),
      dailyRow('2026-08-01', '__raw_retention_38_started__', 0, { entrySource: 'system' }),
    ], window)

    expect(result.summary).toMatchObject({ organicLandings: 1, starts: 1, organicUsers: 1, landingToStartRate: 100 })
    expect(result.dailyActivityArchive).toMatchObject({ complete: true, sessionStarts: 3, sessionCompletions: 2 })
    expect(result.dataSources).toMatchObject({ strategy: 'raw_with_daily_archive', eventTotalsExact: true, acquisitionTotalsExact: true, uniqueUsersExact: true })
    expect(result.dataSources.daily).toMatchObject({ expectedCompleteDays: 1, confirmedCompleteDays: 1, complete: true, role: 'activity_archive' })
  })

  it('marks the 31-day raw cohort partial until the 38-day retention window has matured', () => {
    const window = acquisitionReportWindow(31, NOW)
    const raw = buildAdminAcquisitionFunnel([], [], 31, NOW, { from: window.reportFrom, to: window.reportTo })
    const result = attachAdminAcquisitionDailyArchive(raw, [
      dailyRow('2026-08-15', '__raw_retention_38_started__', 0, { entrySource: 'system' }),
    ], window)

    expect(result.dataSources.raw).toMatchObject({ exactWindowReady: false, retentionStartedAt: '2026-08-15T00:00:00.000Z' })
    expect(result.dataSources.eventTotalsExact).toBe(false)
    expect(result.coverage.retentionTruncationPossible).toBe(true)
    expect(result.dailyActivityArchive).toBeNull()
  })

  it('uses complete UTC report boundaries and a seven-day raw attribution lookback', () => {
    const window = acquisitionReportWindow(31, NOW)

    expect(window.reportFrom.toISOString()).toBe('2026-07-19T00:00:00.000Z')
    expect(window.reportTo.toISOString()).toBe('2026-08-19T00:00:00.000Z')
    expect(window.rawFrom.toISOString()).toBe(window.reportFrom.toISOString())
    expect(window.archiveTo.toISOString()).toBe('2026-07-20T00:00:00.000Z')
  })

  it('loads the two read-only sources and normalizes the response', async () => {
    const execute = vi.fn()
      .mockResolvedValueOnce([clientEvent('page-1', 'page_view', '2026-08-18T09:00:00.000Z', {
        acquisition_id: 'acq-db', entry_source: 'organic_search', entry_path: '/', entry_search_engine: 'Google',
      }, { route: '/' })])
      .mockResolvedValueOnce([signUp('signup-db', '2026-08-18T10:00:00.000Z')])
    const db = { execute } as unknown as Database

    const result = await loadAdminAcquisitionFunnel(db, 14, NOW)

    expect(execute).toHaveBeenCalledTimes(2)
    expect(result.periodDays).toBe(14)
    expect(result.summary).toMatchObject({ organicLandings: 1, signUps: 1 })
    expect(result.byLanding[0]?.label).toBe('Главная')
  })
})

import { describe, expect, it } from 'vitest'
import { createElement } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import type { AdminCampaignFunnelResponse } from '@shoditsa/contracts'
import { CampaignFunnelData } from './AdminCampaignFunnel'

const report: AdminCampaignFunnelResponse = {
  generatedAt: '2026-09-11T10:00:00Z', days: 7,
  window: { fromInclusive: '2026-09-04T00:00:00Z', toExclusive: '2026-09-11T00:00:00Z', timezone: 'UTC' },
  status: 'no_observations', items: [],
  summary: { acquisitions: 0, started: 0, completed: 0, repeatCompleted: 0, registered: 0, registeredAfterCompletion: 0, paidClub: 0, paidClubOrders: 0, matured24h: 0, matured7d: 0 },
  coverage: { rawFromInclusive: '2026-08-04T00:00:00Z', rawRetentionDays: 38, firstObservedAt: null, campaignEvents: 0, sessionLinks: 0, matchedSessionLinks: 0, unmatchedSessionLinks: 0, conflictingAcquisitions: 0, truncated: false, wholeSiteConsentCoverage: null, retentionD2To7: null },
  methodology: ['Только измеренные входы.'],
}

describe('campaign report presentation', () => {
  it('does not present missing campaign history as zero traffic', () => {
    const html = renderToStaticMarkup(createElement(CampaignFunnelData, { report }))
    expect(html).toContain('Это не значит, что никто не приходил')
    expect(html).toContain('Пока не измерено')
    expect(html).not.toContain('<table>')
  })
  it('labels incomplete observations and keeps source slugs as text', () => {
    const html = renderToStaticMarkup(createElement(CampaignFunnelData, { report: { ...report, status: 'partial', items: [{ ...report.summary, source: 'tg_medical', medium: 'paid_social', campaign: 'diagnosis_pilot_202609', landing: '/games/diagnosis' }] } }))
    expect(html).toContain('Выборка неполная')
    expect(html).toContain('не события и не уникальных людей')
    expect(html).toContain('tg_medical')
  })
})

// Development-only visual fixture. All values are invented; no API calls or production mutations.
import { useState } from 'react'
import { createRoot } from 'react-dom/client'
import type { AdminCampaignFunnelResponse, AdminCampaignFunnelRow } from '@shoditsa/contracts'
import { CampaignFunnelData } from '../src/admin/AdminCampaignFunnel'
import '../src/styles.css'
import '../src/admin/admin.css'

const fetchAsset = window.fetch.bind(window)
window.fetch = (input, init) => {
  const url = typeof input === 'string' ? input : input instanceof URL ? input.toString() : input.url
  return url.includes('/api/') ? Promise.resolve(new Response('Изолированный макет: API заблокирован', { status: 403 })) : fetchAsset(input, init)
}
const empty = { acquisitions: 0, started: 0, completed: 0, repeatCompleted: 0, registered: 0, registeredAfterCompletion: 0, paidClub: 0, paidClubOrders: 0, matured24h: 0, matured7d: 0 }
const row: AdminCampaignFunnelRow = { ...empty, source: 'tg_demo_medical', medium: 'paid_social', campaign: 'diagnosis_pilot_demo_202609', landing: '/games/diagnosis', acquisitions: 100, started: 67, completed: 41, repeatCompleted: 15, registered: 8, registeredAfterCompletion: 5, paidClub: 1, paidClubOrders: 1, matured24h: 84, matured7d: 32 }
const report: AdminCampaignFunnelResponse = {
  generatedAt: '2026-09-11T12:00:00Z', days: 14, window: { fromInclusive: '2026-08-28T00:00:00Z', toExclusive: '2026-09-11T00:00:00Z', timezone: 'UTC' }, status: 'observed', items: [row], summary: row,
  coverage: { rawFromInclusive: '2026-08-04T00:00:00Z', rawRetentionDays: 38, firstObservedAt: '2026-08-28T12:00:00Z', campaignEvents: 400, sessionLinks: 88, matchedSessionLinks: 86, unmatchedSessionLinks: 2, conflictingAcquisitions: 0, truncated: false, wholeSiteConsentCoverage: null, retentionD2To7: null },
  methodology: ['Демонстрационные, полностью вымышленные значения. Не результаты реальной рекламы.', 'Единица — наблюдаемый acquisition ID, не человек. Органика сюда не входит.', 'У поздних входов меньше времени. Это не равнозрелая конверсия; D2–7 и полная доля согласившихся пока не измерены.'],
}
function Preview() {
  const [variant, setVariant] = useState<'empty' | 'observed' | 'partial'>('observed')
  const data: AdminCampaignFunnelResponse = variant === 'empty' ? { ...report, status: 'no_observations', summary: empty, items: [], coverage: { ...report.coverage, firstObservedAt: null, campaignEvents: 0, sessionLinks: 0, matchedSessionLinks: 0, unmatchedSessionLinks: 0 } } : { ...report, status: variant, coverage: { ...report.coverage, truncated: variant === 'partial' } }
  return <main className="admin-root" style={{ padding: 16, display: 'block', minHeight: '100vh' }}><div style={{ maxWidth: 1280, margin: '0 auto' }}>
    <aside style={{ padding: 16, marginBottom: 20, border: '1px solid #e0c16e', background: '#fff7d7', borderRadius: 12 }}><strong>Только UI-макет. Все числа вымышлены.</strong><p>API заблокирован; аккаунты, события и заказы не создаются.</p><div style={{ display: 'flex', flexWrap: 'wrap', gap: 8 }}>{([['observed', 'Пример данных'], ['empty', 'Ещё нет данных'], ['partial', 'Неполная выборка']] as const).map(([value, label]) => <button className="admin-btn" key={value} type="button" aria-pressed={variant === value} onClick={() => setVariant(value)}>{label}</button>)}</div></aside>
    <section className="admin-panel admin-campaign"><header className="admin-campaign__header"><div><span className="admin-kicker">Привлечение · отдельный пилот</span><h2>Продвижение «Диагнозов»</h2><p>От измеренного входа до повторной игры и клуба.</p></div><div className="admin-periods"><button type="button">7 дней</button><button type="button" className="is-active">14 дней</button><button type="button">31 день</button></div></header><CampaignFunnelData report={data} /></section>
  </div></main>
}
createRoot(document.getElementById('root')!).render(<Preview />)

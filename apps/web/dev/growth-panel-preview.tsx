// Development-only visual fixture. No backend requests or changes to the live experiment.
import { createRoot } from 'react-dom/client'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { GROWTH_MEASUREMENT_FROM, GROWTH_NOT_BEFORE, growthFeatures, type GrowthReport } from '@shoditsa/contracts'
import { GrowthPanel } from '../src/admin/GrowthPanel'
import '../src/styles.css'
import '../src/admin/admin.css'

const client = new QueryClient({ defaultOptions: { queries: { enabled: false } } })
const policy = { stage: 'baseline', changedAt: null, registrationOpenedAt: null } as const
for (const days of [7, 14, 31] as const) {
  const values = { 7: [69, 41, 4, 3, 0], 14: [148, 87, 7, 3, 1], 31: [348, 183, 12, 8, 1] }[days]
  const data: GrowthReport = {
    policy, effective: growthFeatures(policy), notBefore: GROWTH_NOT_BEFORE, nextStageAvailableAt: GROWTH_NOT_BEFORE,
    period: { from: new Date(Date.parse('2026-09-07T00:00:00Z') - days * 86400000).toISOString(), toExclusive: '2026-09-07T00:00:00Z', days },
    measurement: { from: GROWTH_MEASUREMENT_FROM, coverage: 'not_started', definitionsVersion: 'linked-repeat-v2-free-archive', offerVisibilityVersion: 'visible-v2', freeArchiveFirstObservedAt: null },
    sessions: { completions: values[0], firstCompleters: values[1], measuredCompleters: null, repeatStarts: null, repeatCompletions: null, repeatingCompleters: null, repeatByAccessSource: null, bonusStarts: 0, bonusCompletions: 0, clubStarts: null },
    accounts: { created: values[2], signUps: values[3], bonusGranted: 0, bonusPlayers: 0 },
    commerce: { orders: values[4], paidOrders: values[4], payingUsers: values[4], paidUsersUsedClub: null, revenueMinor: values[4] * 19900 },
    events: [],
  }
  client.setQueryData(['admin', 'growth', days], data)
}
const fetchAsset = window.fetch.bind(window)
window.fetch = (input, init) => {
  const url = typeof input === 'string' ? input : input instanceof URL ? input.toString() : input.url
  return url.includes('/api/') ? Promise.resolve(new Response('Изолированная проверка: запрос заблокирован', { status: 403 })) : fetchAsset(input, init)
}
createRoot(document.getElementById('root')!).render(<QueryClientProvider client={client}><main className="admin-root" style={{ padding: 20 }}><div style={{ maxWidth: 1250, margin: '0 auto' }}><p>Проверка оформления · сохранённый пример, не живые данные · изменения на сервере запрещены</p><GrowthPanel /></div></main></QueryClientProvider>)

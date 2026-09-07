// Development-only entry: not an input to the production build. No real orders/accounts.
import { useState } from 'react'
import { createRoot } from 'react-dom/client'
import { DEFAULT_CLUB_PRODUCTS, growthFeatures } from '@shoditsa/contracts'
import { GameResult } from '../src/features/result/GameResult'
import { CheckoutButton } from '../src/features/commerce/CheckoutButton'
import { ClubCard } from '../src/features/commerce/ClubCard'
import '../src/features/commerce/CommercialShell.css'
import '../src/features/commerce/ClubScreen.css'
import '../src/styles.css'

const fetchAsset = window.fetch.bind(window)
let orderAttempts = 0
window.fetch = async (input, init) => {
  const url = typeof input === 'string' ? input : input instanceof URL ? input.toString() : input.url
  if (url.includes('/api/')) {
    if (url.includes('/commerce/checkout')) orderAttempts++
    document.querySelector('[data-orders]')!.textContent = `Попыток заказа: ${orderAttempts}`
    return new Response(JSON.stringify({ error: { code: 'QA_ONLY', message: 'Изолированная проверка: реальный заказ не создавался' } }), { status: 403, headers: { 'content-type': 'application/json' } })
  }
  return fetchAsset(input, init)
}
function Preview() {
  const [guest, setGuest] = useState(() => new URLSearchParams(window.location.search).get('account') !== 'yes')
  const [bonus, setBonus] = useState(3)
  const [shortage, setShortage] = useState(false)
  const [message, setMessage] = useState('')
  const growth = growthFeatures({ stage: 'club', changedAt: null, registrationOpenedAt: null }, new Date('2026-10-01'))
  return <main style={{ maxWidth: 920, margin: '24px auto', padding: 16 }}>
    <aside style={{ padding: 16, background: '#f5efdf', color: '#18231c', marginBottom: 24 }}>
      <strong>Изолированная проверка — не production</strong><p data-orders>Попыток заказа: 0</p>
      <button onClick={() => setGuest(!guest)}>Гость / аккаунт</button>{' '}
      <button onClick={() => { setShortage(!shortage); setBonus(0) }}>Недостаточно билетов</button>
      <p role="status">{message}</p>
    </aside>
    <GameResult sessionId="271279c2-daa4-45a7-8c98-7e9d6e562d07" growth={growth} accountState={guest ? 'guest' : 'authenticated'} mode="diagnosis" won attempts={3} title="Мигрень" meta="Нервная система" tags={['Эпизодическая']} poster={<img src="/images/diagnosis-systems/nervous.svg" width="100" alt=""/>} award={null} copied={false} autoScroll={false} nextLabel="Играть дальше: Животные" nextMode="animal" nextActionLabel="Играть" completedToday={1} recommendedModes={['animal','character','book']} onRecommendedMode={(mode) => setMessage(`Открыта другая игра: ${mode}`)} onNext={() => setMessage('Открыта следующая игра маршрута')} configureLabel="Настроить" onConfigure={() => setMessage('Настройки')} onReplay={() => { setBonus(Math.max(0, bonus - 1)); setMessage('Следующий случай запущен') }} replayCost={!guest && bonus ? 0 : 60} replayShortage={shortage ? 60 : 0} replayAccessSource={!guest && bonus ? 'registration_bonus' : 'tickets'} registrationBonusRemaining={guest ? 0 : bonus} monthlyClubProduct={DEFAULT_CLUB_PRODUCTS[0]} clubOfferEligible={shortage} />
    <section className="club-lobby-screen" style={{ marginTop: 32, padding: 24 }}>
      <h2>Клубный билет · 199 ₽ на 30 дней</h2>
      <ClubCard eyebrow="Клубный билет" title="30 дней" priceLabel="199 ₽" unitLabel="Один платёж на 30 дней" features={[{ label: 'Свободная игра', value: 'Без списаний' }]} note="Автопродление — только по вашему выбору" action={<CheckoutButton product={DEFAULT_CLUB_PRODUCTS[0]} authenticated={!guest} />} />
    </section>
  </main>
}
createRoot(document.getElementById('root')!).render(<Preview />)

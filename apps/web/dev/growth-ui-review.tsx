// Development-only visual fixture. No API calls, accounts, orders or production feature activation.
import { useState } from 'react'
import { createRoot } from 'react-dom/client'
import { growthFeatures } from '@shoditsa/contracts'
import { GameResult } from '../src/features/result/GameResult'
import { CharacterFirstMove } from '../src/features/game-session/CharacterFirstMove'
import { ChallengeInvite } from '../src/features/challenge/ChallengeInvite'
import '../src/styles.css'

window.fetch = async () => new Response('{}', { status: 403 })

function Review() {
  const [query, setQuery] = useState('')
  const [message, setMessage] = useState('')
  const [invite, setInvite] = useState(false)
  const [pending, setPending] = useState(false)
  const growth = growthFeatures({ stage: 'replay', changedAt: null, registrationOpenedAt: null }, new Date('2026-10-01'))
  return <main style={{ maxWidth: 940, margin: '24px auto', padding: 16 }}>
    <aside style={{ padding: 16, marginBottom: 24, background: '#f5efdf', color: '#18231c' }}>
      <strong>Изолированный макет: будущий этап, не прод</strong>
      <p role="status">{message || 'Ни аккаунты, ни заказы здесь не создаются.'}</p>
      <button onClick={() => setInvite(true)}>Показать приглашение</button>{' '}
      <button onClick={() => setPending(!pending)}>Переключить ожидание</button>
    </aside>
    <CharacterFirstMove onExample={setQuery} variant={query === 'Гарри Поттер' ? 'empty-search' : 'intro'} />
    <label>Проверка подстановки имени <input aria-label="Проверка имени" value={query} onChange={(event) => setQuery(event.target.value)} /></label>
    <GameResult sessionId="271279c2-daa4-45a7-8c98-7e9d6e562d07" growth={growth} accountState="guest"
      mode="diagnosis" won attempts={3} title="Мигрень" meta="Нервная система" tags={['Эпизодическая']}
      poster={<img src="/images/diagnosis-systems/nervous.svg" width="100" alt="" />}
      award={null} copied={false} autoScroll={false} nextLabel="Играть дальше: Животные" nextMode="animal"
      nextActionLabel="Играть" completedToday={1} recommendedModes={['animal', 'character', 'book']}
      onRecommendedMode={(mode) => setMessage(`Выбрана другая игра: ${mode}`)} onNext={() => setMessage('Открыты Животные')}
      configureLabel="Настроить" onConfigure={() => setMessage('Настройки')}
      onReplay={() => setMessage('Открыт бесплатный непроигранный диагноз из архива — списания нет')}
      replayCost={0} replayShortage={0} replayPending={pending} replayAccessSource="free_archive" />
    {invite && <ChallengeInvite challenge={{ mode: 'diagnosis', date: '2026-09-10', period: 'all', opponentAttempts: 4 }}
      isPending={pending} onAccept={() => { setInvite(false); setMessage('Запрошена собственная сессия игрока, не сессия друга') }}
      onDismiss={() => { setInvite(false); setMessage('Приглашение закрыто') }} />}
  </main>
}
createRoot(document.getElementById('root')!).render(<Review />)

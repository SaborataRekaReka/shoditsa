import { useEffect, useRef, useState } from 'react'
import { useQuery } from '@tanstack/react-query'
import { Clapperboard, Gamepad2, Play, Sparkles } from 'lucide-react'
import type { GameSessionSnapshot } from '@shoditsa/contracts'
import { ActionButton, AppHeader, ScreenBack } from '../../components/app-shell/AppShell'
import { GameLaunchControls } from '../../components/game-launch-controls/GameLaunchControls'
import { GameScreenShell } from '../../components/game-shell/GameScreenShell'
import { api, queryKeys } from '../../api/client'
import { SERVER_RUNTIME } from '../../hooks/use-server-runtime'
import { trackClientEvent } from '../../app/client-events'
import { publicAssetUrl } from '../../app/public-asset'
import { DtfLeaderboard } from '../dtf-comments/DtfLeaderboard'
import './CommercialShell.css'

type ShellProps = {
  onHome: () => void
  onArchive: () => void
  onStats: () => void
  onRules: () => void
  onReview: () => void
}

const money = (minor: number | null, currency: string | null) =>
  minor === null || !currency
    ? null
    : new Intl.NumberFormat('ru-RU', {
        style: 'currency',
        currency,
        maximumFractionDigits: 0,
      }).format(minor / 100)

const fallbackCover = publicAssetUrl(
  'images/title-posters/game-ticket-poster.webp',
)

export function SpecialsScreen({
  onHome,
  onArchive,
  onStats,
  onRules,
  onReview,
}: ShellProps) {
  const packs = useQuery({
    queryKey: queryKeys.packs,
    queryFn: api.packs,
    enabled: SERVER_RUNTIME,
  })
  return (
    <>
      <AppHeader
        onHome={onHome}
        onArchive={onArchive}
        onStats={onStats}
        onRules={onRules}
        onReview={onReview}
      />
      <main className="specials-screen">
        <ScreenBack onBack={onHome} label="На главную" />
        <header className="specials-hero">
          <div className="specials-hero__copy">
            <span>
              <Sparkles /> Спецпоказы
            </span>
            <h1>
              Тематические{' '}
              <br aria-hidden="true" />
              сеансы
            </h1>
            <p>
              Отдельные подборки с собственным прогрессом. Первые игры некоторых
              показов можно открыть бесплатно.
            </p>
          </div>
          <div className="specials-hero__poster" aria-hidden="true">
            <img src={fallbackCover} alt="" />
            <span>
              NOW
              <br />
              SHOWING
            </span>
          </div>
        </header>
        {packs.isLoading && <p>Готовим афишу…</p>}
        {packs.isError && (
          <p role="alert">Не удалось загрузить афишу. Попробуйте ещё раз.</p>
        )}
        <section className="specials-grid">
          {(packs.data?.items ?? []).map((pack) => (
            <a
              key={pack.id}
              href={`/specials/${encodeURIComponent(pack.id)}`}
              className="special-card"
            >
              <figure>
                <img
                  src={pack.coverUrl || fallbackCover}
                  alt=""
                  loading="lazy"
                />
              </figure>
              <div className="special-card__copy">
                <span>
                  <Clapperboard /> {pack.totalItems} игр · {pack.completedItems}{' '}
                  пройдено
                </span>
                <h2>{pack.title}</h2>
                <p>{pack.subtitle || pack.description}</p>
              </div>
              <strong>
                {pack.owned
                  ? 'Куплено навсегда'
                  : pack.access === 'club'
                    ? 'В клубе'
                    : pack.access === 'free'
                      ? 'Бесплатно'
                      : (money(pack.priceMinor, pack.currency) ?? 'Открыть')}
              </strong>
            </a>
          ))}
        </section>
      </main>
    </>
  )
}

export function SpecialDetailScreen({
  packId,
  onHome,
  onArchive,
  onStats,
  onRules,
  onReview,
  onSession,
}: ShellProps & { packId: string; onSession: (session: GameSessionSnapshot) => void }) {
  const [starting, setStarting] = useState(false)
  const [error, setError] = useState('')
  const mountedRef = useRef(true)
  const packQuery = useQuery({
    queryKey: queryKeys.pack(packId),
    queryFn: () => api.pack(packId),
    enabled: SERVER_RUNTIME && Boolean(packId),
  })
  const pack = packQuery.data?.pack
  const isDtfPack = packId === 'dtf-game-comments-25-v1'
  const leaderboardQuery = useQuery({
    queryKey: queryKeys.packLeaderboard(packId),
    queryFn: () => api.packLeaderboard(packId),
    enabled: SERVER_RUNTIME && Boolean(pack) && isDtfPack,
    staleTime: 30_000,
  })
  const nextEntry = pack && pack.completedItems < pack.totalItems
    ? pack.entries.find((entry) => entry.accessible && !entry.completed)
      ?? pack.entries.find((entry) => entry.accessible)
      ?? null
    : null

  useEffect(() => {
    mountedRef.current = true
    return () => {
      mountedRef.current = false
    }
  }, [])

  useEffect(() => {
    if (!pack) return
    trackClientEvent('pack_opened', {
      packId: pack.id,
      access: pack.access,
      owned: pack.owned,
    })
    if (pack.access === 'locked')
      trackClientEvent('pack_paywall_view', {
        packId: pack.id,
        productId: pack.productId,
      })
  }, [pack])

  const start = async () => {
    if (starting || !nextEntry) return
    setStarting(true)
    setError('')
    try {
      const response = await api.startPack(packId, nextEntry.position)
      if (mountedRef.current) onSession(response.session)
    } catch (value) {
      if (mountedRef.current) setError(
        value instanceof Error ? value.message : 'Не удалось начать игру.',
      )
    } finally {
      if (mountedRef.current) setStarting(false)
    }
  }

  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.defaultPrevented) return
      if (event.key === 'Escape') {
        event.preventDefault()
        onHome()
      }
      if (event.key === 'Enter' && nextEntry && !starting) {
        event.preventDefault()
        void start()
      }
    }
    window.addEventListener('keydown', onKeyDown)
    return () => window.removeEventListener('keydown', onKeyDown)
  }, [nextEntry, onHome, starting])

  return (
    <>
      <AppHeader
        onHome={onHome}
        onArchive={onArchive}
        onStats={onStats}
        onRules={onRules}
        onReview={onReview}
      />
      {packQuery.isLoading && <main className="specials-screen"><ScreenBack onBack={onHome} label="На главную" /><p>Готовим игру…</p></main>}
      {packQuery.isError && <main className="specials-screen"><ScreenBack onBack={onHome} label="На главную" /><p role="alert">Спецпоказ не найден или временно недоступен.</p></main>}
      {pack && <GameScreenShell variant="title" onBack={onHome} className="title-screen special-title-screen">
        <section className="title-stage">
          <div className="title-game-mark">
            <span><Gamepad2 /></span>
            <i>DTF · спецпоказ · {pack.totalItems} игр</i>
            <h1>{pack.title}</h1>
          </div>
          <time>{pack.subtitle || 'Специальная подборка DTF'}</time>
          <p>{pack.description}</p>
          <section className="admit-ticket admit-ticket--dossier special-title-ticket" aria-labelledby="ticket-dtf-comments">
            <div className="admit-ticket__stub admit-ticket__stub--poster admit-ticket__stub--game">
              <img className="admit-ticket__stub-art" src={pack.coverUrl || fallbackCover} alt="" aria-hidden="true" decoding="async" />
              <span>ВХОД</span><strong>ОДИН</strong><small>DTF</small><em>{pack.totalItems} ИГР</em><i />
            </div>
            <div className="admit-ticket__body">
              <div className="ticket-kicker"><span>Игра «Игры»</span><i /><small>специальный набор</small></div>
              <h2 id="ticket-dtf-comments">Угадайте игру по комментариям</h2>
              <p>Всё работает как в обычной игре «Игры»: выбирайте ответ из общего каталога и сверяйте подсказки. В этом показе — <strong>6 попыток</strong> на каждую игру.</p>
              <div className="special-title-progress" aria-label={`Пройдено ${pack.completedItems} из ${pack.totalItems}`}>
                <span><strong>{pack.completedItems}</strong> / {pack.totalItems} пройдено</span>
                <i><b style={{ width: `${pack.totalItems ? Math.round(pack.completedItems / pack.totalItems * 100) : 0}%` }} /></i>
              </div>
              <GameLaunchControls
                mode="game"
                action={<ActionButton className={`play-button game-launch-controls__play ${!nextEntry ? 'is-disabled' : ''}`} disabled={!nextEntry || starting} onClick={() => void start()}>
                  <Play /> {starting ? 'Запускаем…' : pack.completedItems > 0 ? `Продолжить · игра ${nextEntry?.position ?? pack.totalItems} из ${pack.totalItems}` : 'Начать игру'}
                  {nextEntry && !starting && <span className="keycap-hint keycap-hint--inline" aria-hidden="true">Enter</span>}
                </ActionButton>}
              />
              {error && <p className="specials-error" role="alert">{error}</p>}
            </div>
          </section>
          {isDtfPack && <DtfLeaderboard
            data={leaderboardQuery.data}
            loading={leaderboardQuery.isLoading}
            error={leaderboardQuery.isError}
          />}
        </section>
      </GameScreenShell>}
    </>
  )
}

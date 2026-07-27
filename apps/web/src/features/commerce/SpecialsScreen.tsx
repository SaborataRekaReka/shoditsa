import { useEffect, useRef, useState } from 'react'
import { useQuery } from '@tanstack/react-query'
import { CalendarDays, Clapperboard, Gamepad2, LockKeyhole, Music2, Play, Sparkles, Trophy } from 'lucide-react'
import { KPOP_ARTISTS_PACK_ID, type GameSessionSnapshot } from '@shoditsa/contracts'
import { ActionButton, AppHeader, Modal, ScreenBack } from '../../components/app-shell/AppShell'
import { GameLaunchControls, GameOptionAction } from '../../components/game-launch-controls/GameLaunchControls'
import { GameScreenShell } from '../../components/game-shell/GameScreenShell'
import { ClubAccessPanel } from '../../components/club-access-panel/ClubAccessPanel'
import { api, queryKeys } from '../../api/client'
import { SERVER_RUNTIME } from '../../hooks/use-server-runtime'
import { trackClientEvent } from '../../app/client-events'
import { publicAssetUrl } from '../../app/public-asset'
import { KPOP_GENERATION_RANGES } from '../../game'
import { DtfLeaderboard } from '../dtf-comments/DtfLeaderboard'
import { AdmissionTitleTicket, TicketKicker } from '../../components/title-ticket'
import { InlineAlert, LinearProgress } from '../../components/ui'
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
const kpopTitlePoster = publicAssetUrl('images/specials/kpop-title-poster.webp')

const packSubject = (packId: string, totalItems: number) => (
  packId === KPOP_ARTISTS_PACK_ID ? `Ежедневная игра · ${totalItems} артистов` : `${totalItems} игр`
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
              Отдельные подборки с собственным прогрессом. Они входят в Клуб,
              а отдельный показ может быть открыт персонально.
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
              className={`special-card ${pack.id === KPOP_ARTISTS_PACK_ID ? 'special-card--kpop' : ''}`}
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
                  <Clapperboard /> {packSubject(pack.id, pack.totalItems)}
                  {pack.id !== KPOP_ARTISTS_PACK_ID && pack.access !== 'locked' && <> · {pack.completedItems} пройдено</>}
                </span>
                <h2>{pack.title}</h2>
                <p>{pack.subtitle || pack.description}</p>
              </div>
              <strong>
                {pack.access === 'locked'
                  ? <><LockKeyhole aria-hidden="true" /> Только в Клубе</>
                  : pack.access === 'admin'
                    ? 'QA-доступ'
                    : pack.access === 'personal'
                      ? 'Персональный доступ'
                      : 'Доступно в Клубе'}
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
  const [leaderboardOpen, setLeaderboardOpen] = useState(false)
  const mountedRef = useRef(true)
  const packQuery = useQuery({
    queryKey: queryKeys.pack(packId),
    queryFn: () => api.pack(packId),
    enabled: SERVER_RUNTIME && Boolean(packId),
  })
  const pack = packQuery.data?.pack
  const isDtfPack = packId === 'dtf-game-comments-25-v1'
  const isKpopPack = packId === KPOP_ARTISTS_PACK_ID
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
  const canStart = pack?.access !== 'locked' && (isKpopPack || Boolean(nextEntry))

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
    if (pack.access === 'locked')
      trackClientEvent('special_locked_view', {
        packId: pack.id,
        placement: 'special_detail',
      })
  }, [pack])

  const start = async () => {
    if (starting || !canStart) return
    setStarting(true)
    setError('')
    try {
      const response = isKpopPack
        ? await api.start({
            kind: 'daily',
            mode: 'music',
            period: 'all',
            variantKey: KPOP_ARTISTS_PACK_ID,
          }, crypto.randomUUID())
        : await api.startPack(packId, nextEntry!.position)
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
      if (leaderboardOpen) return
      if (event.key === 'Escape') {
        event.preventDefault()
        onHome()
      }
      if (event.key === 'Enter' && canStart && !starting) {
        event.preventDefault()
        void start()
      }
    }
    window.addEventListener('keydown', onKeyDown)
    return () => window.removeEventListener('keydown', onKeyDown)
  }, [canStart, leaderboardOpen, onHome, starting])

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
            <span>{isKpopPack ? <Music2 /> : <Gamepad2 />}</span>
            <i>{isKpopPack ? 'K-pop · клубный спецпоказ' : 'DTF · клубный спецпоказ'} · {packSubject(pack.id, pack.totalItems)}</i>
            <h1>{pack.title}</h1>
          </div>
          <time>{pack.subtitle || (isKpopPack ? 'Пять поколений корейской поп-сцены' : 'Специальная подборка DTF')}</time>
          <p>{pack.description}</p>
          <AdmissionTitleTicket
            id={isKpopPack ? 'ticket-kpop-artists' : 'ticket-dtf-comments'}
            mode={isKpopPack ? 'music' : 'game'}
            posterUrl={isKpopPack ? kpopTitlePoster : pack.coverUrl || fallbackCover}
            stubLabel="ВХОД"
            stubTitle="ОДИН"
            stubMeta={isKpopPack ? 'K-POP' : 'DTF'}
            stubEnd={isKpopPack ? `${pack.totalItems} АРТИСТОВ` : `${pack.totalItems} ИГР`}
            className={`special-title-ticket ${isKpopPack ? 'special-title-ticket--kpop' : ''}`}
          >
              <TicketKicker title={isKpopPack ? 'K-pop artist dossier' : 'Игра «Игры»'} detail={pack.access === 'locked' ? 'только в Клубе' : pack.access === 'admin' ? 'QA-доступ' : pack.access === 'personal' ? 'персональный доступ' : 'доступно в Клубе'} />
              <h2 id={isKpopPack ? 'ticket-kpop-artists' : 'ticket-dtf-comments'}>
                {isKpopPack ? 'Угадайте K-pop артиста' : 'Угадайте игру по комментариям'}
              </h2>
              {isKpopPack
                ? <>
                  <p>Каждый день выбирается один K-pop артист. Угадывайте его за <strong>10 попыток</strong> — точно так же, как в обычном режиме «Угадай музыку».</p>
                  <details className="kpop-generation-note">
                    <summary>Как считаются поколения K-pop</summary>
                    <ol>{KPOP_GENERATION_RANGES.map((entry) => <li key={entry.generation}><strong>{entry.label}</strong><span>{entry.years}</span></li>)}</ol>
                  </details>
                </>
                : <p>Всё работает как в обычной игре «Игры»: выбирайте ответ из общего каталога и сверяйте подсказки. В этом показе — <strong>6 попыток</strong> на каждую игру.</p>}
              {isKpopPack
                ? <div className="kpop-daily-cadence">
                  <CalendarDays />
                  <span><strong>Один артист сегодня</strong><small>Новая ежедневная игра в 00:00 МСК</small></span>
                </div>
                : <LinearProgress
                  value={pack.completedItems}
                  max={pack.totalItems}
                  valueLabel={<><strong>{pack.completedItems}</strong> / {pack.totalItems}</>}
                  label="пройдено"
                  className="special-title-progress"
                />}
              {pack.access === 'locked'
                ? <ClubAccessPanel
                  title="Спецпоказы доступны участникам Клуба"
                  description="Архив с первого дня, свободная игра, комнаты с друзьями без билетиков и все спецпоказы."
                  primaryLabel="Вступить в Клуб — 199 ₽"
                  secondaryLabel="Или 1 790 ₽ за год"
                  onPrimary={() => {
                    trackClientEvent('special_club_cta_clicked', { packId, placement: 'special_detail' })
                    window.location.assign('/club')
                  }}
                  onSecondary={() => window.location.assign('/club')}
                />
                : <GameLaunchControls
                mode={isKpopPack ? 'music' : 'game'}
                action={<ActionButton className={`play-button game-launch-controls__play ${!canStart ? 'is-disabled' : ''}`} disabled={!canStart || starting} onClick={() => void start()}>
                  <Play /> {starting ? 'Запускаем…' : isKpopPack ? 'Играть сегодня' : pack.completedItems > 0 ? 'Продолжить' : 'Начать игру'}
                  {canStart && !starting && <span className="keycap-hint keycap-hint--inline" aria-hidden="true">Enter</span>}
                </ActionButton>}
                option={isDtfPack
                  ? <GameOptionAction
                    label="Общий зачёт"
                    labelIcon={<Trophy />}
                    value="Открыть рейтинг"
                    onClick={() => setLeaderboardOpen(true)}
                  />
                  : undefined}
              />}
              {error && <InlineAlert tone="danger" className="specials-error">{error}</InlineAlert>}
          </AdmissionTitleTicket>
        </section>
      </GameScreenShell>}
      {leaderboardOpen && <Modal className="dtf-leaderboard-modal" title="Общий зачёт" onClose={() => setLeaderboardOpen(false)}>
        <DtfLeaderboard
          data={leaderboardQuery.data}
          loading={leaderboardQuery.isLoading}
          error={leaderboardQuery.isError}
        />
      </Modal>}
    </>
  )
}

import { useEffect, useId, useMemo, useRef, useState, type KeyboardEvent as ReactKeyboardEvent } from 'react'
import { useMutation, useQueryClient } from '@tanstack/react-query'
import {
  FULL_HOUSE_MODE_IDS,
  type ConnectionsColor,
  type ConnectionsGuessResponse,
  type GameResponse,
  type GameSessionSnapshot,
} from '@shoditsa/contracts'
import {
  Check,
  ChevronDown,
  Copy,
  Lightbulb,
  LoaderCircle,
  RotateCcw,
  Send,
  Shuffle,
  Sparkles,
  Ticket,
  Waypoints,
  X,
} from 'lucide-react'
import { api, ApiClientError, queryKeys } from '../../api/client'
import { trackClientEvent } from '../../app/client-events'
import { MODE_CONFIG } from '../../app/mode-config'
import { MODE_PRESENTATION } from '../../app/mode-presentation'
import { ActionButton, AppHeader } from '../../components/app-shell/AppShell'
import { GameScreenShell } from '../../components/game-shell/GameScreenShell'
import { ControlButton, InlineAlert } from '../../components/ui'
import { ResultActionBar } from '../result/ResultActionBar'
import { ContentReport, type ContentReportReason } from '../content-report/ContentReport'
import { useServerRuntime } from '../../hooks/use-server-runtime'
import { formatDays } from '../../game'
import { copyText, shareTextWithFallback } from '../../game/sharing'
import { dayNumber } from '../../game/day-number'
import type { TitleMode } from '../../types'
import { connectionsShareText } from './connections-sharing'
import { ConnectionsSelectionLinks } from './ConnectionsSelectionLinks'
import './ConnectionsGamePage.css'

export type ConnectionsSession = Extract<GameSessionSnapshot, { engine: 'connections_grid' }>

type Props = {
  sessionId: string
  session: ConnectionsSession
  onHome: () => void
  onBack: () => void
  onArchive: () => void
  onStats: () => void
  onRules: () => void
  onReview: () => void
  onPlayNext: (mode: TitleMode | null) => void
}

type ConnectionsReward = NonNullable<ConnectionsGuessResponse['reward']>

const NEXT_MODE_ORDER: TitleMode[] = ['diagnosis', 'animal', 'book', 'movie', 'series', 'anime', 'game', 'city', 'music']

const dateLabel = (date: string) => new Intl.DateTimeFormat('ru-RU', {
  day: 'numeric',
  month: 'long',
  timeZone: 'Europe/Moscow',
}).format(new Date(`${date}T12:00:00+03:00`))

const errorText = (error: unknown) => (
  error instanceof ApiClientError
    ? error.message
    : error instanceof Error
      ? error.message
      : 'Не удалось выполнить действие'
)

const shuffled = <T,>(values: readonly T[]) => {
  const result = [...values]
  for (let index = result.length - 1; index > 0; index -= 1) {
    const target = Math.floor(Math.random() * (index + 1))
    ;[result[index], result[target]] = [result[target], result[index]]
  }
  return result
}

const toggleDetailsOnKey = (event: ReactKeyboardEvent<HTMLElement>) => {
  if (event.key !== 'Enter' && event.key !== ' ') return
  event.preventDefault()
  const details = event.currentTarget.closest('details')
  if (details) details.open = !details.open
}

export function ConnectionsGamePage({
  sessionId,
  session,
  onHome,
  onBack,
  onArchive,
  onStats,
  onRules,
  onReview,
  onPlayNext,
}: Props) {
  const client = useQueryClient()
  const runtime = useServerRuntime()
  const state = session.connections
  const [selected, setSelected] = useState<string[]>([])
  const [order, setOrder] = useState(() => state.tiles.map((tile) => tile.id))
  const [message, setMessage] = useState('')
  const [feedback, setFeedback] = useState<'correct' | 'wrong' | 'one_away' | null>(null)
  const [copied, setCopied] = useState(false)
  const [lastReward, setLastReward] = useState<ConnectionsReward | null>(null)
  const guessKey = useRef<string | null>(null)
  const hintKey = useRef<string | null>(null)
  const started = useRef(false)
  const completionTracked = useRef(false)
  const gridShellRef = useRef<HTMLDivElement>(null)
  const tileRefs = useRef(new Map<string, HTMLButtonElement>())

  const solvedTileIds = useMemo(
    () => new Set(state.solvedGroups.flatMap((group) => group.tiles.map((tile) => tile.id))),
    [state.solvedGroups],
  )
  const tileById = useMemo(() => new Map(state.tiles.map((tile) => [tile.id, tile])), [state.tiles])
  const remainingIds = order.filter((tileId) => !solvedTileIds.has(tileId))
  const terminal = state.status !== 'playing'
  const pending = false

  const refreshRelated = async () => Promise.all([
    client.invalidateQueries({ queryKey: queryKeys.dashboard }),
    client.invalidateQueries({ queryKey: queryKeys.ledger }),
    client.invalidateQueries({ queryKey: ['archive'] }),
  ])

  const guess = useMutation({
    mutationFn: ({ tileIds, key }: { tileIds: [string, string, string, string]; key: string }) => (
      api.connectionsGuess(sessionId, tileIds, key)
    ),
    retry: (count, error) => count < 1 && error instanceof ApiClientError && error.code === 'NETWORK_TIMEOUT',
    onSuccess: async (response) => {
      guessKey.current = null
      if (response.session.engine !== 'connections_grid') return
      client.setQueryData<GameResponse>(queryKeys.game(sessionId), { session: response.session })
      setSelected([])
      setFeedback(response.result)
      setMessage(
        response.result === 'correct'
          ? 'Группа сходится!'
          : response.result === 'one_away'
            ? 'Одна карточка лишняя'
            : 'Не сходится. Попробуйте ещё.',
      )
      if (response.reward) setLastReward(response.reward)
      const next = response.session.connections
      const common = {
        mode: 'connections',
        sessionKind: response.session.kind,
        puzzleDate: response.session.puzzleDate,
        difficulty: response.session.difficulty,
        guessPosition: next.guesses.length,
        mistakesUsed: next.mistakesUsed,
        groupsSolved: next.solvedGroups.length,
        hintsUsed: next.hints.length,
        rulesVersion: response.session.rulesVersion,
      }
      if (response.result === 'one_away') trackClientEvent('connections_one_away', common, { gameSessionId: sessionId })
      if (response.result === 'correct') trackClientEvent('connections_group_solved', common, { gameSessionId: sessionId })
      await refreshRelated()
    },
    onError: async (error) => {
      setMessage(errorText(error))
      setFeedback(null)
      if (error instanceof ApiClientError && (error.status === 409 || error.code === 'NETWORK_TIMEOUT')) {
        await client.invalidateQueries({ queryKey: queryKeys.game(sessionId) })
      }
    },
  })

  const hint = useMutation({
    mutationFn: ({ checkpoint, key }: { checkpoint: 1 | 3; key: string }) => (
      api.connectionsHint(sessionId, checkpoint, key)
    ),
    retry: (count, error) => count < 1 && error instanceof ApiClientError && error.code === 'NETWORK_TIMEOUT',
    onSuccess: (response) => {
      hintKey.current = null
      if (response.session.engine !== 'connections_grid') return
      client.setQueryData<GameResponse>(queryKeys.game(sessionId), { session: response.session })
      setMessage(`Подсказка: ${response.hint.text}`)
      trackClientEvent('connections_hint_used', {
        mode: 'connections',
        sessionKind: response.session.kind,
        puzzleDate: response.session.puzzleDate,
        difficulty: response.session.difficulty,
        mistakesUsed: response.session.connections.mistakesUsed,
        groupsSolved: response.session.connections.solvedGroups.length,
        hintsUsed: response.session.connections.hints.length,
        rulesVersion: response.session.rulesVersion,
      }, { gameSessionId: sessionId })
    },
    onError: (error) => setMessage(errorText(error)),
  })

  const isPending = guess.isPending || hint.isPending || pending

  useEffect(() => {
    setOrder((current) => {
      const known = new Set(current)
      const appended = state.tiles.map((tile) => tile.id).filter((tileId) => !known.has(tileId))
      return current.length ? [...current, ...appended] : state.tiles.map((tile) => tile.id)
    })
    setSelected((current) => current.filter((tileId) => !solvedTileIds.has(tileId)))
  }, [solvedTileIds, state.tiles])

  useEffect(() => {
    if (started.current) return
    started.current = true
    trackClientEvent('connections_started', {
      mode: 'connections',
      sessionKind: session.kind,
      puzzleDate: session.puzzleDate,
      difficulty: session.difficulty,
      mistakesUsed: state.mistakesUsed,
      groupsSolved: state.solvedGroups.length,
      hintsUsed: state.hints.length,
      rulesVersion: session.rulesVersion,
    }, { gameSessionId: sessionId })
  }, [session, sessionId, state])

  useEffect(() => {
    if (!terminal || completionTracked.current) return
    completionTracked.current = true
    trackClientEvent('connections_completed', {
      mode: 'connections',
      sessionKind: session.kind,
      puzzleDate: session.puzzleDate,
      difficulty: session.difficulty,
      mistakesUsed: state.mistakesUsed,
      groupsSolved: state.solvedGroups.length,
      hintsUsed: state.hints.length,
      outcome: state.status,
      rulesVersion: session.rulesVersion,
    }, { gameSessionId: sessionId })
  }, [session, sessionId, state, terminal])

  const toggle = (tileId: string) => {
    if (isPending || terminal || solvedTileIds.has(tileId)) return
    setFeedback(null)
    setMessage('')
    setSelected((current) => {
      if (current.includes(tileId)) return current.filter((id) => id !== tileId)
      return current.length < 4 ? [...current, tileId] : current
    })
  }

  const submit = () => {
    if (selected.length !== 4 || isPending || terminal) return
    const tileIds = selected as [string, string, string, string]
    const key = guessKey.current ?? crypto.randomUUID()
    guessKey.current = key
    trackClientEvent('connections_guess_submitted', {
      mode: 'connections',
      sessionKind: session.kind,
      puzzleDate: session.puzzleDate,
      difficulty: session.difficulty,
      guessPosition: state.guesses.length + 1,
      mistakesUsed: state.mistakesUsed,
      groupsSolved: state.solvedGroups.length,
      hintsUsed: state.hints.length,
      rulesVersion: session.rulesVersion,
    }, { gameSessionId: sessionId })
    guess.mutate({ tileIds, key })
  }

  const openHint = () => {
    if (!state.hintAvailableAt || isPending || terminal) return
    const key = hintKey.current ?? crypto.randomUUID()
    hintKey.current = key
    hint.mutate({ checkpoint: state.hintAvailableAt, key })
  }

  const copyResult = async () => {
    const resultUrl = new URL('/games/connections', window.location.origin).toString()
    const success = await copyText(`${connectionsShareText(session.puzzleDate, state)}\n${resultUrl}`)
    setCopied(success)
    trackClientEvent('connections_shared', {
      mode: 'connections',
      sessionKind: session.kind,
      puzzleDate: session.puzzleDate,
      difficulty: session.difficulty,
      mistakesUsed: state.mistakesUsed,
      groupsSolved: state.solvedGroups.length,
      hintsUsed: state.hints.length,
      outcome: state.status,
      shareMethod: 'clipboard',
      success,
      rulesVersion: session.rulesVersion,
    }, { gameSessionId: sessionId })
  }

  const shareChallenge = async () => {
    const resultUrl = new URL('/games/connections', window.location.origin).toString()
    const outcome = await shareTextWithFallback(
      'Сходится! — вызов',
      `Сможешь найти все четыре связи дня?\n${connectionsShareText(session.puzzleDate, state)}`,
      resultUrl,
    )
    if (outcome === 'copied') {
      setCopied(true)
      window.setTimeout(() => setCopied(false), 1800)
    }
  }

  const completedModes = new Set(
    (runtime.dashboard?.today?.completedModes ?? []).filter((mode) =>
      (FULL_HOUSE_MODE_IDS as readonly string[]).includes(mode),
    ),
  )
  if (terminal && session.kind === 'daily') completedModes.add('connections')
  const completedToday = completedModes.size
  const nextMode = session.kind === 'daily'
    ? NEXT_MODE_ORDER.find((candidate) => !completedModes.has(candidate)) ?? null
    : null

  const mistakeDots = <span className="connections-mistakes" aria-label={`Ошибок: ${state.mistakesUsed} из 4`}>
    <span>Ошибки</span>
    {Array.from({ length: 4 }, (_, index) => (
      <i key={index} className={index < state.mistakesUsed ? 'is-used' : ''}>
        {index < state.mistakesUsed ? <X /> : null}
      </i>
    ))}
  </span>

  return <>
    <AppHeader onHome={onHome} onArchive={onArchive} onStats={onStats} onRules={onRules} onReview={onReview} />
    <GameScreenShell
      className={`connections-game${feedback ? ` connections-game--${feedback}` : ''}`}
      variant="session"
      wide
      onBack={onBack}
    >
      <div className="connections-layout">
        <aside className="connections-sidebar" aria-label="Состояние игры">
          <span className="connections-sidebar__icon" aria-hidden="true"><Waypoints /></span>
          <div className="connections-sidebar__title">
            <p>Игра дня · №{dayNumber(session.puzzleDate)}</p>
            <h1 id="connections-game-title">Связи</h1>
            <span className="connections-sidebar__scraps" aria-hidden="true"><i /><i /><i /></span>
          </div>
          <time dateTime={session.puzzleDate}>{dateLabel(session.puzzleDate)}</time>
          <p className="connections-sidebar__lead">Соберите 4 группы по 4 слова</p>

          <div className="connections-sidebar__section connections-sidebar__progress">
            <strong><b>{state.solvedGroups.length}</b> / 4 группы</strong>
            <div aria-label={`Собрано групп: ${state.solvedGroups.length} из 4`}>
              {Array.from({ length: 4 }, (_, index) => <i key={index} className={index < state.solvedGroups.length ? 'is-complete' : ''} />)}
            </div>
          </div>

          <div className="connections-sidebar__section connections-sidebar__mistakes">
            {mistakeDots}
          </div>

          {!terminal && <ControlButton
            className="connections-sidebar__hint"
            onClick={openHint}
            disabled={!state.hintAvailableAt || isPending}
          >
            <Lightbulb /> Открыть подсказку
          </ControlButton>}
        </aside>

        <section className="connections-board" aria-labelledby="connections-game-title">
          {!terminal && <div className="connections-grid-shell" ref={gridShellRef}>
            <ConnectionsSelectionLinks
              hostRef={gridShellRef}
              tileRefs={tileRefs}
              selected={selected}
              layoutKey={remainingIds.join('|')}
            />
            <div className="connections-solved" aria-live="polite">
              {state.solvedGroups.map((group) => (
                <article key={group.color} className={`connections-solved__group connections-color--${group.color}`}>
                  <strong>{group.title}</strong>
                  <span>{group.tiles.map((tile) => tile.label).join(', ')}</span>
                  {group.autoSolved && <small>последняя группа раскрыта автоматически</small>}
                </article>
              ))}
            </div>

            <div
              className={`connections-grid${guess.isPending ? ' is-submitting' : ''}`}
              aria-label="Карточки со словами"
              aria-busy={guess.isPending}
            >
              {remainingIds.map((tileId) => {
                const tile = tileById.get(tileId)
                if (!tile) return null
                const selectedIndex = selected.indexOf(tileId)
                const isSelected = selectedIndex !== -1
                return <ControlButton
                  key={tileId}
                  ref={(node) => {
                    if (node) tileRefs.current.set(tileId, node)
                    else tileRefs.current.delete(tileId)
                  }}
                  type="button"
                  className={isSelected ? 'is-selected' : ''}
                  aria-pressed={isSelected}
                  disabled={isPending}
                  onClick={() => toggle(tileId)}
                >
                  {isSelected && <small className="connections-tile__number" aria-hidden="true">{selectedIndex + 1}</small>}
                  <span className="connections-tile__label">{tile.label}</span>
                </ControlButton>
              })}
            </div>
          </div>}

          {!terminal && (isPending || message) && <div
            className={`connections-message${feedback ? ` connections-message--${feedback}` : ''}`}
            role="status"
            aria-live="polite"
          >
            {isPending
              ? <><LoaderCircle className="is-spinning" /> Проверяем связь…</>
              : <>{feedback === 'correct' ? <Check /> : feedback === 'one_away' ? <Sparkles /> : <X />}{message}</>}
          </div>}

          {!terminal && <div className="connections-controls">
            <ControlButton
              className="connections-controls__shuffle"
              onClick={() => setOrder((current) => {
                const remaining = new Set(remainingIds)
                const shuffledRemaining = shuffled(current.filter((id) => remaining.has(id)))
                let offset = 0
                return current.map((id) => remaining.has(id) ? shuffledRemaining[offset++] : id)
              })}
              disabled={isPending}
            >
              <Shuffle /> Перемешать
            </ControlButton>
            <ControlButton
              className="connections-controls__clear"
              onClick={() => setSelected([])}
              disabled={isPending || selected.length === 0}
            >
              <RotateCcw /> Снять выбор
            </ControlButton>
            <ActionButton
              className="connections-controls__submit"
              onClick={submit}
              disabled={isPending || selected.length !== 4}
              aria-label={selected.length === 4
                ? 'Проверить выбранную группу'
                : `Проверить группу: выберите ещё ${4 - selected.length}`}
            >
              <Check />
              Проверить группу
            </ActionButton>
          </div>}

          {terminal && <ConnectionsResult
            session={session}
            copied={copied}
            reward={lastReward}
            streak={runtime.dashboard?.attendance?.currentDailyStreak ?? null}
            completedToday={completedToday}
            nextMode={nextMode}
            onCopy={() => void copyResult()}
            onChallenge={() => void shareChallenge()}
            onNext={() => nextMode ? onPlayNext(nextMode) : onHome()}
            onArchive={onArchive}
            onReport={async (reason, comment) => {
              await api.contentReport({ sessionId, reason, comment: comment || undefined })
              trackClientEvent('connections_report_submitted', {
                mode: 'connections',
                sessionKind: session.kind,
                puzzleDate: session.puzzleDate,
                difficulty: session.difficulty,
                mistakesUsed: state.mistakesUsed,
                groupsSolved: state.solvedGroups.length,
                hintsUsed: state.hints.length,
                reason,
                rulesVersion: session.rulesVersion,
              }, { gameSessionId: sessionId })
            }}
          />}

          {(guess.error || hint.error) && !message && <InlineAlert tone="danger">{errorText(guess.error ?? hint.error)}</InlineAlert>}
        </section>
      </div>
    </GameScreenShell>
  </>
}

export function ConnectionsResult({
  session,
  copied,
  reward,
  streak,
  completedToday,
  nextMode,
  onCopy,
  onChallenge,
  onNext,
  onArchive,
  onReport,
  autoScroll = true,
}: {
  session: ConnectionsSession
  copied: boolean
  reward: ConnectionsReward | null
  streak: number | null
  completedToday: number
  nextMode: TitleMode | null
  onCopy: () => void
  onChallenge: () => void
  onNext: () => void
  onArchive: () => void
  onReport: (reason: ContentReportReason, comment: string) => void | Promise<void>
  autoScroll?: boolean
}) {
  const state = session.connections
  const won = state.status === 'won'
  const resultRef = useRef<HTMLElement>(null)
  const rewardId = useId()
  useEffect(() => {
    if (!autoScroll) return
    const frame = window.requestAnimationFrame(() => resultRef.current?.scrollIntoView({ behavior: 'smooth', block: 'start' }))
    return () => window.cancelAnimationFrame(frame)
  }, [autoScroll])
  const nextDestination = nextMode ? MODE_CONFIG[nextMode].title : 'Другие игры дня'
  const nextArtworkUrl = nextMode
    ? MODE_PRESENTATION[nextMode].watermarkUrl
    : MODE_PRESENTATION.diagnosis.watermarkUrl
  const routeTotal = FULL_HOUSE_MODE_IDS.length
  const routeCompleted = Math.min(completedToday, routeTotal)
  const rewardTitle = reward
    ? reward.alreadyClaimed
      ? 'Награда уже получена'
      : `Получено +${reward.total} билетов`
    : session.kind === 'daily'
      ? 'Награда учтена'
      : 'Архивная игра завершена'
  const rewardHint = reward && !reward.alreadyClaimed
    ? 'Посмотреть начисление'
    : session.kind === 'daily'
      ? 'Подробнее о начислении'
      : 'Как работает архив'
  return <section ref={resultRef} className={`connections-result connections-result--${state.status}`} aria-labelledby="connections-result-title">
    <div className="connections-result__summary">
      <div className="connections-result__outcome">
        <p>{won ? 'Все 4 связи найдены' : `Найдено ${state.solvedGroups.length} из 4 связей`}</p>
        <h2 id="connections-result-title">{won ? 'Всё сошлось!' : 'Сегодня не сошлось'}</h2>
        <div className="connections-result__meta" aria-label={`Ошибок: ${state.mistakesUsed} из 4. Подсказок: ${state.hints.length}.`}>
          <span>Ошибки {state.mistakesUsed}/4</span>
          <i aria-hidden="true" />
          <span>Подсказки {state.hints.length}</span>
        </div>
      </div>
    </div>

    <ResultActionBar
      nextLabel={nextMode ? `Играть дальше: ${nextDestination}` : 'К другим играм дня'}
      nextDestination={nextDestination}
      nextArtworkUrl={nextArtworkUrl}
      nextTicketNumber={`${String(Math.min(routeCompleted + 1, routeTotal)).padStart(2, '0')}/${String(routeTotal).padStart(2, '0')}`}
      configureLabel="Открыть архив"
      copied={copied}
      onNext={onNext}
      onConfigure={onArchive}
      onChallenge={onChallenge}
      onCopy={onCopy}
      showTip={false}
      showReplayGate
      compactNext
      afterLabel={null}
      showCopy={false}
    />

    <section className="connections-result__groups" aria-label="Категории этого раунда">
      <header>
        <div>
          <span>Решение</span>
          <strong>Как сошлись слова</strong>
        </div>
        <small>{state.solvedGroups.length} категории</small>
      </header>
      <div className="connections-result__groups-grid">
        {state.solvedGroups.map((group, index) => (
          <article key={group.color} className={`connections-result__group connections-result__group--${group.color}`}>
            <span className="connections-result__group-number" aria-hidden="true">{String(index + 1).padStart(2, '0')}</span>
            <div>
              <strong>{group.title}</strong>
              <small>{group.tiles.map((tile) => tile.label).join(' · ')}</small>
            </div>
          </article>
        ))}
      </div>
    </section>

    <details className="reward-breakdown connections-result__reward">
      <summary role="button" aria-controls={rewardId} onKeyDown={toggleDetailsOnKey}>
        <span className="connections-result__reward-icon" aria-hidden="true"><Ticket /></span>
        <span className="connections-result__accordion-copy">
          <strong>{rewardTitle}</strong>
          <small>{rewardHint}</small>
        </span>
        <ChevronDown aria-hidden="true" />
      </summary>
      <div id={rewardId} className="connections-result__reward-body">
        {reward && !reward.alreadyClaimed
          ? <ul>
              {!!reward.components.completion && <li><span>За завершение</span><strong>+{reward.components.completion}</strong></li>}
              {!!reward.components.win && <li><span>За победу</span><strong>+{reward.components.win}</strong></li>}
              {!!reward.components.efficiency && <li><span>За аккуратность</span><strong>+{reward.components.efficiency}</strong></li>}
              {!!reward.components.firstGame && <li><span>Первая игра дня</span><strong>+{reward.components.firstGame}</strong></li>}
              {!!reward.components.route3 && <li><span>Маршрут дня</span><strong>+{reward.components.route3}</strong></li>}
              {!!reward.components.fullRoute && <li><span>Полный маршрут</span><strong>+{reward.components.fullRoute}</strong></li>}
              {!!reward.components.streakMilestone && <li><span>Бонус за серию</span><strong>+{reward.components.streakMilestone}</strong></li>}
              <li className="connections-result__reward-total"><span>Итого</span><strong>+{reward.total}</strong></li>
            </ul>
          : <p>
              <strong>{session.kind === 'daily' ? 'Повторного начисления не будет' : 'Архив — для игры и статистики'}</strong>
              <span>{session.kind === 'daily'
                ? reward
                  ? `Билеты уже были добавлены. Баланс после начисления: ${reward.balanceAfter}.`
                  : 'Билеты за эту игру уже учтены в балансе. При повторном открытии результата сумма не начисляется ещё раз.'
                : 'За архивные партии билеты не начисляются, но результат сохраняется в статистике.'}</span>
            </p>}
      </div>
    </details>

    <div className="connections-result__utility result-card__wide">
      <span>Серия: {streak == null ? '—' : formatDays(streak)}</span>
      <a href={`https://t.me/share/url?url=${encodeURIComponent(new URL('/games/connections', window.location.origin).toString())}&text=${encodeURIComponent(connectionsShareText(session.puzzleDate, state))}`} target="_blank" rel="noreferrer"><Send aria-hidden="true" /> Telegram</a>
      <ContentReport prompt="Нашли ошибку в раунде?" thanks="Спасибо, проверим раунд." onSubmit={onReport} />
      <ControlButton className="connections-result__copy" onClick={onCopy}>
        {copied ? <Check aria-hidden="true" /> : <Copy aria-hidden="true" />}
        <span>{copied ? 'Скопировано' : 'Скопировать результат'}</span>
      </ControlButton>
    </div>
  </section>
}

import { useEffect, useMemo, useRef, useState } from 'react'
import { useMutation, useQueryClient } from '@tanstack/react-query'
import type { ConnectionsColor, GameResponse, GameSessionSnapshot } from '@shoditsa/contracts'
import {
  CalendarDays,
  Check,
  Grid2X2,
  Lightbulb,
  LoaderCircle,
  RotateCcw,
  Shuffle,
  Sparkles,
  X,
} from 'lucide-react'
import { api, ApiClientError, queryKeys } from '../../api/client'
import { publicAssetUrl } from '../../app/public-asset'
import { trackClientEvent } from '../../app/client-events'
import { ActionButton, AppHeader } from '../../components/app-shell/AppShell'
import { GameScreenShell } from '../../components/game-shell/GameScreenShell'
import { ControlButton, InlineAlert } from '../../components/ui'
import { ResultActionBar } from '../result/ResultActionBar'
import { ContentReport, type ContentReportReason } from '../content-report/ContentReport'
import { useServerRuntime } from '../../hooks/use-server-runtime'
import { copyText } from '../../game/sharing'
import { dayNumber } from '../../game/day-number'
import { connectionsShareText } from './connections-sharing'
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
}

const colorLabel: Record<ConnectionsColor, string> = {
  yellow: 'жёлтая',
  green: 'зелёная',
  blue: 'синяя',
  purple: 'фиолетовая',
}

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

export function ConnectionsGamePage({
  sessionId,
  session,
  onHome,
  onBack,
  onArchive,
  onStats,
  onRules,
  onReview,
}: Props) {
  const client = useQueryClient()
  const runtime = useServerRuntime()
  const state = session.connections
  const [selected, setSelected] = useState<string[]>([])
  const [order, setOrder] = useState(() => state.tiles.map((tile) => tile.id))
  const [message, setMessage] = useState('')
  const [feedback, setFeedback] = useState<'correct' | 'wrong' | 'one_away' | null>(null)
  const [copied, setCopied] = useState(false)
  const [lastReward, setLastReward] = useState<{ total: number; balanceAfter: number } | null>(null)
  const guessKey = useRef<string | null>(null)
  const hintKey = useRef<string | null>(null)
  const started = useRef(false)
  const completionTracked = useRef(false)

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
      if (response.reward) setLastReward({ total: response.reward.total, balanceAfter: response.reward.balanceAfter })
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
    const success = await copyText(connectionsShareText(session.puzzleDate, state))
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
      status={mistakeDots}
    >
      <section className="connections-board" aria-labelledby="connections-game-title">
        <header className="connections-board__head">
          <span className="connections-board__icon" aria-hidden="true"><Grid2X2 /></span>
          <div>
            <p><CalendarDays /> {dateLabel(session.puzzleDate)} · №{dayNumber(session.puzzleDate)}</p>
            <h1 id="connections-game-title">Связи дня</h1>
            <small>Новая сетка в 00:00 МСК</small>
          </div>
        </header>

        <div className="connections-solved" aria-live="polite">
          {state.solvedGroups.map((group) => (
            <article key={group.color} className={`connections-solved__group connections-color--${group.color}`}>
              <strong>{group.title}</strong>
              <span>{group.tiles.map((tile) => tile.label).join(', ')}</span>
              {group.autoSolved && <small>последняя группа раскрыта автоматически</small>}
            </article>
          ))}
        </div>

        {!terminal && <div
          className={`connections-grid${guess.isPending ? ' is-submitting' : ''}`}
          aria-label="Карточки со словами"
          aria-busy={guess.isPending}
        >
          {remainingIds.map((tileId) => {
            const tile = tileById.get(tileId)
            if (!tile) return null
            const isSelected = selected.includes(tileId)
            return <ControlButton
              key={tileId}
              type="button"
              className={isSelected ? 'is-selected' : ''}
              aria-pressed={isSelected}
              disabled={isPending}
              onClick={() => toggle(tileId)}
            >
              <span>{tile.label}</span>
            </ControlButton>
          })}
        </div>}

        {!terminal && <div
          className={`connections-message${feedback ? ` connections-message--${feedback}` : ''}`}
          role="status"
          aria-live="polite"
        >
          {isPending
            ? <><LoaderCircle className="is-spinning" /> Проверяем связь…</>
            : message
              ? <>{feedback === 'correct' ? <Check /> : feedback === 'one_away' ? <Sparkles /> : <X />}{message}</>
              : <>Выберите четыре карточки</>}
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
          {state.hintAvailableAt && <ControlButton className="connections-controls__hint" onClick={openHint} disabled={isPending}>
            <Lightbulb /> Подсказка
          </ControlButton>}
          <ActionButton className="connections-controls__submit" onClick={submit} disabled={isPending || selected.length !== 4}>
            <Check /> Проверить
          </ActionButton>
        </div>}

        {terminal && <ConnectionsResult
          session={session}
          copied={copied}
          reward={lastReward}
          streak={runtime.dashboard?.attendance?.currentDailyStreak ?? null}
          onCopy={() => void copyResult()}
          onHome={onHome}
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
    </GameScreenShell>
  </>
}

function ConnectionsResult({
  session,
  copied,
  reward,
  streak,
  onCopy,
  onHome,
  onArchive,
  onReport,
}: {
  session: ConnectionsSession
  copied: boolean
  reward: { total: number; balanceAfter: number } | null
  streak: number | null
  onCopy: () => void
  onHome: () => void
  onArchive: () => void
  onReport: (reason: ContentReportReason, comment: string) => void | Promise<void>
}) {
  const state = session.connections
  return <section className={`connections-result connections-result--${state.status}`} aria-labelledby="connections-result-title">
    <div className="connections-result__summary">
      <span className="connections-result__mark" aria-hidden="true">{state.status === 'won' ? <Check /> : <X />}</span>
      <p>Связи №{dayNumber(session.puzzleDate)}</p>
      <h2 id="connections-result-title">{state.status === 'won' ? 'Всё сошлось!' : 'Сегодня не сошлось'}</h2>
      <div className="connections-result__facts">
        <span><strong>{state.mistakesUsed}</strong> ошибок</span>
        <span><strong>{state.hints.length}</strong> подсказок</span>
        <span><strong>{streak ?? '—'}</strong> дней серии</span>
        {reward && <span><strong>+{reward.total}</strong> билетов</span>}
      </div>
    </div>

    <div className="connections-result__groups">
      {state.solvedGroups.map((group) => (
        <article key={group.color} className={`connections-solved__group connections-color--${group.color}`}>
          <strong>{group.title}</strong>
          <span>{group.tiles.map((tile) => tile.label).join(', ')}</span>
        </article>
      ))}
    </div>

    <div className="connections-history">
      <h3>История попыток</h3>
      <div>
        {state.guesses.map((guess) => (
          <span key={guess.position} aria-label={`Попытка ${guess.position}: ${guess.result}`}>
            {guess.colorRow?.map((color, index) => <i key={`${color}-${index}`} className={`connections-color--${color}`} title={colorLabel[color]} />)}
          </span>
        ))}
      </div>
    </div>

    <ResultActionBar
      nextLabel="Играть дальше"
      nextDestination="Другие игры дня"
      nextArtworkUrl={publicAssetUrl('images/connections/connections-title-hero.webp')}
      nextTicketNumber={`№${dayNumber(session.puzzleDate)}`}
      configureLabel="Открыть архив"
      copied={copied}
      onNext={onHome}
      onConfigure={onArchive}
      onCopy={onCopy}
      showTip={false}
    />
    <ContentReport prompt="Нашли ошибку в раунде?" thanks="Спасибо, проверим раунд." onSubmit={onReport} />
  </section>
}

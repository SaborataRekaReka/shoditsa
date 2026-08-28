import { useEffect, useId, useMemo, useRef, useState } from 'react'
import type { TerritoryPublicSnapshot } from '@shoditsa/contracts'
import { Check, Clock3, Crosshair, LoaderCircle, Map, RotateCcw } from 'lucide-react'
import { ActionButton, ControlButton, InlineAlert } from '../../components/ui'
import { deterministicClientEventId } from '../../app/client-events'
import { TerritoryBoard } from './TerritoryBoard'
import { trackTerritoryEvent } from './territory-analytics'
import './TerritoryRoomGame.css'

export type TerritoryRoomGameProps = {
  snapshot: TerritoryPublicSnapshot
  currentMemberId: string
  onSubmitAnswer: (duelId: string, optionToken: string) => Promise<void>
  onCapture: (territoryId: string) => Promise<void>
  onRematch: () => Promise<void>
  busy?: boolean
  error?: string
}

const optionLetters = ['А', 'Б', 'В', 'Г'] as const

const territoryWord = (value: number) => {
  const lastTwo = value % 100
  const last = value % 10
  if (lastTwo >= 11 && lastTwo <= 14) return 'территорий'
  if (last === 1) return 'территория'
  if (last >= 2 && last <= 4) return 'территории'
  return 'территорий'
}

const pointsWord = (value: number) => {
  const lastTwo = value % 100
  const last = value % 10
  if (lastTwo >= 11 && lastTwo <= 14) return 'очков'
  if (last === 1) return 'очко'
  if (last >= 2 && last <= 4) return 'очка'
  return 'очков'
}

const difficultyLabel = {
  easy: 'лёгкий вопрос',
  medium: 'средний вопрос',
  hard: 'сложный вопрос',
} as const

const safeHttpUrl = (value: string | null) => {
  if (!value) return null
  try {
    const url = new URL(value)
    return url.protocol === 'http:' || url.protocol === 'https:' ? value : null
  } catch {
    return null
  }
}

const duelResultCopy = (snapshot: TerritoryPublicSnapshot, currentMemberId: string) => {
  const reveal = snapshot.reveal
  if (!reveal) return { title: 'Раунд завершён', description: 'Готовим следующий вопрос.' }
  if (reveal.result === 'no_correct') return { title: 'Никто не ответил верно', description: reveal.explanation }
  if (reveal.result === 'speed_tie') return { title: 'Ответили одновременно', description: reveal.explanation }
  if (reveal.winnerUserId === currentMemberId) {
    return { title: reveal.result === 'faster' ? 'Вы ответили быстрее' : 'Ваш ответ верный', description: reveal.explanation }
  }
  return { title: reveal.result === 'faster' ? 'Соперник оказался быстрее' : 'Территорию разыграет соперник', description: reveal.explanation }
}

const finishCopy = (snapshot: Extract<TerritoryPublicSnapshot, { phase: 'finished' }>, currentMemberId: string) => {
  if (!snapshot.winnerUserId || snapshot.finishReason === 'draw') {
    return { kicker: 'Матч завершён', title: 'Карта поделена поровну', description: 'Ничья. Можно сразу сыграть ещё раз на новой карте.' }
  }
  const won = snapshot.winnerUserId === currentMemberId
  const reason = snapshot.finishReason === 'forfeit'
    ? won ? 'Соперник покинул матч.' : 'Матч завершён досрочно.'
    : snapshot.finishReason === 'territory_value'
      ? 'При равном числе земель исход решила их суммарная ценность.'
    : snapshot.finishReason === 'correct_time'
      ? 'Исход решил суммарный темп верных ответов.'
      : snapshot.finishReason === 'correct_answers'
        ? 'При равной карте исход решило число верных ответов.'
        : 'Победитель удержал больше территорий.'
  return {
    kicker: won ? 'Победа' : 'Матч завершён',
    title: won ? 'Карта за вами' : 'Соперник удержал карту',
    description: reason,
  }
}

const statusFeedCopy = (snapshot: TerritoryPublicSnapshot, currentMemberId: string, answerPending: boolean) => {
  const nameFor = (userId: string | null) => snapshot.players.find((player) => player.userId === userId)?.displayName || 'Соперник'
  if (snapshot.phase === 'countdown') return snapshot.duelNumber === 1
    ? { lead: 'Карта готова', text: ' — первая дуэль начнётся автоматически' }
    : { lead: `Дуэль ${snapshot.duelNumber}`, text: ' — следующий вопрос уже готов' }
  if (snapshot.phase === 'question') {
    const answered = Boolean(snapshot.question.ownOptionId || answerPending)
    return answered
      ? { lead: 'Ответ принят', text: snapshot.question.opponentAnswered ? ' — оба игрока ответили' : ' — соперник ещё думает' }
      : { lead: `Дуэль ${snapshot.duelNumber}`, text: ' — выберите вариант и подтвердите ответ' }
  }
  if (snapshot.phase === 'reveal') {
    if (!snapshot.reveal.winnerUserId) return { lead: 'Без захвата', text: ' — победитель в этой дуэли не определён' }
    const isYou = snapshot.reveal.winnerUserId === currentMemberId
    return { lead: isYou ? 'Вы выиграли дуэль' : nameFor(snapshot.reveal.winnerUserId), text: ' — получает право на атаку' }
  }
  if (snapshot.phase === 'capture') {
    const isYou = snapshot.capture.actorUserId === currentMemberId
    return {
      lead: isYou ? 'Вы атакуете' : nameFor(snapshot.capture.actorUserId),
      text: isYou ? ' — выберите соседнюю территорию на карте' : ' выбирает территорию для захвата',
    }
  }
  if (!snapshot.winnerUserId) return { lead: 'Ничья', text: ' — карта поделена поровну' }
  return snapshot.winnerUserId === currentMemberId
    ? { lead: 'Карта за вами', text: ' — вы победили в матче' }
    : { lead: nameFor(snapshot.winnerUserId), text: ' удержал больше карты' }
}

function usePhaseSeconds(snapshot: TerritoryPublicSnapshot) {
  const [clientNow, setClientNow] = useState(() => Date.now())
  const serverOffset = useMemo(() => {
    const parsed = Date.parse(snapshot.serverTime)
    return Number.isFinite(parsed) ? parsed - Date.now() : 0
  }, [snapshot.serverTime])

  useEffect(() => {
    if (!snapshot.phaseEndsAt) return
    setClientNow(Date.now())
    const timer = window.setInterval(() => setClientNow(Date.now()), 250)
    return () => window.clearInterval(timer)
  }, [snapshot.phaseEndsAt])

  if (!snapshot.phaseEndsAt) return null
  const end = Date.parse(snapshot.phaseEndsAt)
  if (!Number.isFinite(end)) return null
  return Math.max(0, Math.ceil((end - (clientNow + serverOffset)) / 1000))
}

function TerritoryPlayerHud({
  player,
  seat,
  currentMemberId,
  currentActorUserId,
}: {
  player: TerritoryPublicSnapshot['players'][number]
  seat: 0 | 1
  currentMemberId: string
  currentActorUserId: string | null
}) {
  const isYou = player.userId === currentMemberId
  const crest = <span className="territory-player__crest" aria-hidden="true">{player.displayName.trim().slice(0, 1).toLocaleUpperCase('ru-RU') || '•'}</span>
  const copy = <span className="territory-player__copy">
    <small>{isYou ? 'Вы' : 'Соперник'}</small>
    <strong>{player.displayName}<b aria-hidden="true"> · {player.territoryCount}</b></strong>
  </span>
  const score = <span className="territory-player__score">
    <span className="territory-room-game__sr-only">{player.territoryCount} {territoryWord(player.territoryCount)}, стоимость {player.territoryValueTotal} {pointsWord(player.territoryValueTotal)}</span>
    <small aria-hidden="true">{player.territoryValueTotal} оч.</small>
  </span>
  return <div className={`territory-player territory-player--${seat === 0 ? 'light' : 'deep'}${seat === 1 ? ' territory-player--right' : ''}${currentActorUserId === player.userId ? ' is-current' : ''}`}>
    {seat === 0 ? <>{crest}{copy}{score}</> : <>{score}{copy}{crest}</>}
  </div>
}

function QuestionPanel({
  snapshot,
  busy,
  expired,
  selectedOptionId,
  pendingOptionId,
  onSelect,
  onConfirm,
}: {
  snapshot: Extract<TerritoryPublicSnapshot, { phase: 'question' }>
  busy: boolean
  expired: boolean
  selectedOptionId: string | null
  pendingOptionId: string | null
  onSelect: (optionId: string) => void
  onConfirm: () => void
}) {
  const question = snapshot.question
  const titleId = useId()
  const ownOptionId = question.ownOptionId ?? pendingOptionId ?? selectedOptionId
  const answered = Boolean(question.ownOptionId || pendingOptionId)
  return <>
    <div className="territory-question-panel__copy">
      <span className="territory-question-panel__kicker">{question.category.label} · {difficultyLabel[question.difficulty]}</span>
      <h2 id={titleId}>{question.prompt}</h2>
      <p aria-live="polite">{answered
        ? question.opponentAnswered ? 'Оба ответа приняты. Открываем результат.' : 'Ответ принят. Ждём соперника.'
        : expired ? 'Время вышло. Открываем результат дуэли.'
        : selectedOptionId ? 'Можно изменить выбор до подтверждения.' : 'Выберите один вариант и подтвердите ответ.'}</p>
    </div>
    <div className="territory-question-panel__actions" role="group" aria-labelledby={titleId} aria-busy={busy}>
      {question.options.map((option, index) => <ControlButton
        key={option.id}
        className={`territory-option${ownOptionId === option.id ? ' is-own' : ''}`}
        type="button"
        aria-pressed={ownOptionId === option.id}
        disabled={busy || answered || expired}
        onClick={() => onSelect(option.id)}
      >
        <i aria-hidden="true" />
        <span className="territory-room-game__sr-only">Вариант {optionLetters[index]}. </span>
        <span>{option.text}</span>
      </ControlButton>)}
    </div>
    <div className="territory-question-panel__confirm">
      <ActionButton
        className="territory-question-panel__action territory-question-panel__answer"
        type="button"
        onClick={onConfirm}
        disabled={busy || answered || expired || !selectedOptionId}
      >
        {pendingOptionId && <LoaderCircle aria-hidden="true" />}
        {answered ? pendingOptionId ? 'ОТПРАВЛЯЕМ…' : 'ОТВЕТ ПРИНЯТ' : expired ? 'ВРЕМЯ ВЫШЛО' : 'ОТВЕТИТЬ'}
      </ActionButton>
    </div>
  </>
}

function RevealPanel({ snapshot, currentMemberId }: {
  snapshot: Extract<TerritoryPublicSnapshot, { phase: 'reveal' }>
  currentMemberId: string
}) {
  const reveal = snapshot.reveal
  const ownAnswer = reveal.answers.find((answer) => answer.userId === currentMemberId)
  const copy = duelResultCopy(snapshot, currentMemberId)
  const provenanceLabel = reveal.provenance.attribution || reveal.provenance.dataset
  const sourceUrl = safeHttpUrl(reveal.provenance.sourceUrl)
  return <>
    <div className="territory-question-panel__copy" aria-live="polite">
      <span className="territory-question-panel__kicker">Итог дуэли</span>
      <h2>{copy.title}</h2>
      <p>{copy.description}</p>
      <small className="territory-question-panel__source">
        Источник: {sourceUrl
          ? <a href={sourceUrl} target="_blank" rel="noreferrer">{provenanceLabel}</a>
          : provenanceLabel} · {reveal.provenance.license}
      </small>
    </div>
    <div className="territory-question-panel__actions" aria-label="Ответы завершённого вопроса">
      {reveal.options.map((option, index) => <div
        key={option.id}
        className={`territory-option ui-control${option.id === reveal.correctOptionId ? ' is-correct' : ''}${ownAnswer?.optionId === option.id ? ' is-own' : ''}${ownAnswer?.optionId === option.id && !ownAnswer.correct ? ' is-wrong' : ''}`}
      >
        <i aria-hidden="true" />
        <span className="territory-room-game__sr-only">Вариант {optionLetters[index]}. </span>
        <span>{option.text}</span>
      </div>)}
    </div>
    <div className="territory-question-panel__status" role="status">
      {ownAnswer?.correct ? <Check aria-hidden="true" /> : <Clock3 aria-hidden="true" />}
      <span>{ownAnswer?.correct ? 'Ваш ответ верный' : 'Следующая дуэль скоро'}</span>
    </div>
  </>
}

function CapturePanel({ snapshot, currentMemberId, pendingCellId, busy }: {
  snapshot: Extract<TerritoryPublicSnapshot, { phase: 'capture' }>
  currentMemberId: string
  pendingCellId: string | null
  busy: boolean
}) {
  const isActor = snapshot.capture.actorUserId === currentMemberId
  return <>
    <div className="territory-question-panel__copy">
      <span className="territory-question-panel__kicker">Право на захват</span>
      <h2>{isActor ? 'Выберите территорию на карте' : 'Соперник выбирает территорию'}</h2>
      <p>{isActor
        ? 'Янтарным контуром отмечены доступные земли, число показывает ценность. Нажмите на территорию — выбор сразу отправится на сервер.'
        : 'Карта обновится одновременно у обоих игроков после выбора.'}</p>
    </div>
    <div className="territory-question-panel__status territory-question-panel__status--wide" role="status">
      {busy || pendingCellId ? <LoaderCircle aria-hidden="true" /> : isActor ? <Map aria-hidden="true" /> : <Clock3 aria-hidden="true" />}
      <span>{busy || pendingCellId ? 'Закрепляем территорию…' : isActor ? `${snapshot.capture.legalCellIds.length} доступно для захвата` : 'Ждём ход соперника'}</span>
    </div>
  </>
}

function FinishedPanel({
  snapshot,
  currentMemberId,
  busy,
  onRematch,
}: {
  snapshot: Extract<TerritoryPublicSnapshot, { phase: 'finished' }>
  currentMemberId: string
  busy: boolean
  onRematch: () => void
}) {
  const copy = finishCopy(snapshot, currentMemberId)
  const ready = snapshot.rematchReadyUserIds.includes(currentMemberId)
  return <div className="territory-finished">
    <div className="territory-question-panel__copy">
      <span className="territory-question-panel__kicker">{copy.kicker}</span>
      <h2>{copy.title}</h2>
      <p>{copy.description}</p>
    </div>
    {ready
      ? <div className="territory-question-panel__status" role="status"><Check aria-hidden="true" /><span>Вы готовы. Ждём соперника.</span></div>
      : <ActionButton className="territory-question-panel__action" type="button" onClick={onRematch} disabled={busy}><RotateCcw aria-hidden="true" />{busy ? 'Готовим матч…' : 'Играть ещё'}</ActionButton>}
  </div>
}

export function TerritoryRoomGame({
  snapshot,
  currentMemberId,
  onSubmitAnswer,
  onCapture,
  onRematch,
  busy = false,
  error,
}: TerritoryRoomGameProps) {
  const secondsLeft = usePhaseSeconds(snapshot)
  const [selectedOptionId, setSelectedOptionId] = useState<string | null>(null)
  const [pendingOptionId, setPendingOptionId] = useState<string | null>(null)
  const [pendingCellId, setPendingCellId] = useState<string | null>(null)
  const [rematchPending, setRematchPending] = useState(false)
  const trackedLifecycleRef = useRef(new Set<string>())
  const actionBusy = busy || Boolean(pendingOptionId || pendingCellId || rematchPending)
  const currentPlayerSeat = snapshot.players.findIndex((player) => player.userId === currentMemberId)
  const capture = snapshot.phase === 'capture' ? snapshot.capture : null
  const currentActorUserId = capture?.actorUserId ?? null
  const legalCellIds = capture?.actorUserId === currentMemberId ? capture.legalCellIds : []
  const capturedCellId = snapshot.reveal?.capturedCellId ?? null

  useEffect(() => {
    setSelectedOptionId(null)
    setPendingOptionId(null)
  }, [snapshot.duelNumber, snapshot.phase])

  useEffect(() => {
    if (snapshot.phase === 'question' && snapshot.question.ownOptionId) setPendingOptionId(null)
  }, [snapshot])

  useEffect(() => {
    if (snapshot.phase !== 'capture') setPendingCellId(null)
  }, [snapshot.phase])

  useEffect(() => {
    if (snapshot.phase !== 'finished' || snapshot.rematchReadyUserIds.includes(currentMemberId)) setRematchPending(false)
  }, [currentMemberId, snapshot])

  useEffect(() => {
    const eventName = snapshot.matchNumber === 1 ? 'territory_room_started' : 'territory_rematch_started'
    const key = `${eventName}:${snapshot.matchId}`
    if (trackedLifecycleRef.current.has(key)) return
    trackedLifecycleRef.current.add(key)
    trackTerritoryEvent(eventName, {
      matchId: snapshot.matchId,
      matchNumber: snapshot.matchNumber,
      rulesVersion: snapshot.rulesVersion,
    }, { eventId: deterministicClientEventId(`${snapshot.matchId}:${currentMemberId}`, eventName) })
  }, [currentMemberId, snapshot.matchId, snapshot.matchNumber, snapshot.rulesVersion])

  useEffect(() => {
    if (!snapshot.reveal) return
    const key = `duel:${snapshot.matchId}:${snapshot.reveal.duelId}`
    if (trackedLifecycleRef.current.has(key)) return
    trackedLifecycleRef.current.add(key)
    trackTerritoryEvent('territory_duel_completed', {
      matchId: snapshot.matchId,
      duelId: snapshot.reveal.duelId,
      matchNumber: snapshot.matchNumber,
      duelNumber: snapshot.duelNumber,
      result: snapshot.reveal.result,
      won: snapshot.reveal.winnerUserId === currentMemberId,
      rulesVersion: snapshot.rulesVersion,
    }, { eventId: deterministicClientEventId(`${snapshot.matchId}:${snapshot.reveal.duelId}:${currentMemberId}`, 'territory_duel_completed') })
  }, [currentMemberId, snapshot.duelNumber, snapshot.matchId, snapshot.matchNumber, snapshot.reveal, snapshot.rulesVersion])

  useEffect(() => {
    if (snapshot.phase !== 'finished') return
    const key = `match:${snapshot.matchId}`
    if (trackedLifecycleRef.current.has(key)) return
    trackedLifecycleRef.current.add(key)
    trackTerritoryEvent('territory_match_completed', {
      matchId: snapshot.matchId,
      matchNumber: snapshot.matchNumber,
      duelNumber: snapshot.duelNumber,
      finishReason: snapshot.finishReason ?? 'draw',
      won: snapshot.winnerUserId === currentMemberId,
      rulesVersion: snapshot.rulesVersion,
    }, { eventId: deterministicClientEventId(`${snapshot.matchId}:${currentMemberId}`, 'territory_match_completed') })
  }, [currentMemberId, snapshot.duelNumber, snapshot.matchId, snapshot.matchNumber, snapshot.phase, snapshot.rulesVersion, snapshot.finishReason, snapshot.winnerUserId])

  const submitSelectedOption = async () => {
    if (actionBusy || secondsLeft === 0 || snapshot.phase !== 'question' || snapshot.question.ownOptionId || !selectedOptionId) return
    const optionId = selectedOptionId
    setPendingOptionId(optionId)
    try {
      await onSubmitAnswer(snapshot.question.duelId, optionId)
    } catch {
      setPendingOptionId(null)
    }
  }

  const captureCell = async (cellId: string) => {
    if (actionBusy || snapshot.phase !== 'capture' || snapshot.capture.actorUserId !== currentMemberId || !snapshot.capture.legalCellIds.includes(cellId)) return
    setPendingCellId(cellId)
    try {
      await onCapture(cellId)
    } catch {
      setPendingCellId(null)
    }
  }

  const requestRematch = async () => {
    if (actionBusy || snapshot.phase !== 'finished' || snapshot.rematchReadyUserIds.includes(currentMemberId)) return
    setRematchPending(true)
    const key = `rematch-click:${snapshot.matchId}`
    if (!trackedLifecycleRef.current.has(key)) {
      trackedLifecycleRef.current.add(key)
      trackTerritoryEvent('territory_rematch_clicked', {
        matchId: snapshot.matchId,
        matchNumber: snapshot.matchNumber,
        rulesVersion: snapshot.rulesVersion,
      }, { eventId: deterministicClientEventId(`${snapshot.matchId}:${currentMemberId}`, 'territory_rematch_clicked') })
    }
    try {
      await onRematch()
    } catch {
      setRematchPending(false)
    }
  }

  const centerLabel = snapshot.phase === 'countdown'
    ? snapshot.duelNumber === 1 ? 'До начала' : 'Между дуэлями'
    : snapshot.phase === 'question'
      ? `Дуэль ${snapshot.duelNumber} из ${snapshot.maxDuels}`
      : snapshot.phase === 'reveal'
        ? 'Итог дуэли'
        : snapshot.phase === 'capture'
          ? snapshot.capture.actorUserId === currentMemberId ? 'Ваш захват' : 'Ход соперника'
          : 'Матч завершён'
  const feed = statusFeedCopy(snapshot, currentMemberId, Boolean(pendingOptionId))

  useEffect(() => {
    const frame = window.requestAnimationFrame(() => window.scrollTo({ top: 0, behavior: 'auto' }))
    return () => window.cancelAnimationFrame(frame)
  }, [snapshot.matchNumber])

  return <section className={`territory-room-game territory-room-game--${snapshot.phase} territory-room-game--you-${currentPlayerSeat === 1 ? 'deep' : 'light'}`} aria-label="Матч «Захват»">
    <header className="territory-hud">
      <TerritoryPlayerHud player={snapshot.players[0]} seat={0} currentMemberId={currentMemberId} currentActorUserId={currentActorUserId} />
      <div className="territory-turn" aria-label={`${centerLabel}. Ход ${snapshot.duelNumber} из ${snapshot.maxDuels}. Матч номер ${snapshot.matchNumber}.`}>
        <span aria-hidden="true">ХОД</span>
        <strong aria-hidden="true">{snapshot.duelNumber}<small> из {snapshot.maxDuels}</small></strong>
        <i aria-hidden="true" />
        {secondsLeft !== null
          ? <><Clock3 aria-hidden="true" /><time className={secondsLeft <= 5 ? 'is-urgent' : undefined} dateTime={`PT${secondsLeft}S`} aria-label={`Осталось ${secondsLeft} секунд`}>{secondsLeft}<small aria-hidden="true"> сек</small></time></>
          : <b aria-hidden="true">{snapshot.phase === 'finished' ? 'ИТОГ' : centerLabel}</b>}
      </div>
      <TerritoryPlayerHud player={snapshot.players[1]} seat={1} currentMemberId={currentMemberId} currentActorUserId={currentActorUserId} />
    </header>

    <TerritoryBoard
      map={snapshot.map}
      ownership={snapshot.ownership}
      players={snapshot.players}
      currentMemberId={currentMemberId}
      legalCellIds={legalCellIds}
      selectedCellId={pendingCellId}
      capturedCellId={capturedCellId}
      disabled={actionBusy}
      onCapture={(cellId) => void captureCell(cellId)}
    />

    <div className="territory-status-feed" role="status" aria-live="polite">
      <Crosshair aria-hidden="true" />
      <span><strong>{feed.lead}</strong>{feed.text}</span>
    </div>

    <section className="territory-question-panel" aria-label="Состояние текущей дуэли">
      {snapshot.phase === 'countdown' && <div className="territory-countdown">
        <span>{snapshot.duelNumber === 1 ? 'Карта готова' : `Дуэль ${snapshot.duelNumber}`}</span>
        <strong>{secondsLeft ?? 0}</strong>
        <p>{snapshot.duelNumber === 1 ? 'Первая дуэль начнётся автоматически' : 'Следующий вопрос появится автоматически'}</p>
      </div>}
      {snapshot.phase === 'question' && <QuestionPanel
        snapshot={snapshot}
        busy={actionBusy}
        expired={secondsLeft === 0}
        selectedOptionId={selectedOptionId}
        pendingOptionId={pendingOptionId}
        onSelect={setSelectedOptionId}
        onConfirm={() => void submitSelectedOption()}
      />}
      {snapshot.phase === 'reveal' && <RevealPanel snapshot={snapshot} currentMemberId={currentMemberId} />}
      {snapshot.phase === 'capture' && <CapturePanel snapshot={snapshot} currentMemberId={currentMemberId} pendingCellId={pendingCellId} busy={actionBusy} />}
      {snapshot.phase === 'finished' && <FinishedPanel snapshot={snapshot} currentMemberId={currentMemberId} busy={actionBusy} onRematch={() => void requestRematch()} />}
      {error && <InlineAlert className="territory-question-panel__error" tone="danger">{error}</InlineAlert>}
    </section>

    <span className="territory-room-game__sr-only" aria-live="polite">
      {snapshot.phase === 'capture'
        ? snapshot.capture.actorUserId === currentMemberId ? 'Ваш ход: выберите доступную территорию.' : 'Соперник выбирает территорию.'
        : snapshot.phase === 'finished'
          ? snapshot.winnerUserId === currentMemberId ? 'Вы победили.' : snapshot.winnerUserId ? 'Победил соперник.' : 'Матч завершился вничью.'
          : ''}
    </span>
  </section>
}

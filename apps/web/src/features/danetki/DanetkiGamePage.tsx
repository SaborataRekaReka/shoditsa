import { useEffect, useMemo, useRef, useState, type FormEvent } from 'react'
import { useMutation, useQueryClient } from '@tanstack/react-query'
import type { GameResponse, GameSessionSnapshot } from '@shoditsa/contracts'
import { ArrowUp, CalendarDays, Check, Copy, DoorOpen, HelpCircle, Lightbulb, LoaderCircle, RefreshCw, Sparkles, Users } from 'lucide-react'
import { api, ApiClientError, danetkiEventsUrl, queryKeys } from '../../api/client'
import { publicAssetUrl } from '../../app/public-asset'
import { deterministicClientEventId, trackClientEvent } from '../../app/client-events'
import { trackMetrikaGoal } from '../../app/metrics'
import { trackGameCompleteOnce } from '../../app/game-analytics'
import type { TitleMode } from '../../types'
import { ActionButton, AppHeader } from '../../components/app-shell/AppShell'
import { useServerRuntime } from '../../hooks/use-server-runtime'
import { withFilledDanetkiVisualFixture } from './DanetkiGamePage.fixture'
import { isFreshDanetkiCompletion } from './danetki-analytics'
import { GameScreenShell } from '../../components/game-shell/GameScreenShell'
import { ControlButton, DialogSurface, InlineAlert, SegmentedProgress, TextArea, TextInput } from '../../components/ui'
import { DanetkiRegistrationOffer } from './DanetkiRegistrationOffer'
import { DanetkiResult } from './DanetkiResult'
import './DanetkiGamePage.css'
import './DanetkiSession.css'
import './DanetkiCaseHeader.css'
import './DanetkiInvestigation.css'
import './DanetkiOutcome.css'
import './DanetkiGameShell.css'

type Props = {
  sessionId: string
  session: GameSessionSnapshot
  onHome: () => void
  onBack: () => void
  onArchive: () => void
  onStats: () => void
  onRules: () => void
  onReview: () => void
  onPlayNext: (mode: TitleMode) => void
}

const errorText = (error: unknown) => error instanceof ApiClientError ? error.message : error instanceof Error ? error.message : 'Не удалось выполнить действие'
const localTime = (value: string) => new Intl.DateTimeFormat('ru-RU', { hour: '2-digit', minute: '2-digit' }).format(new Date(value))

export function DanetkiGamePage({ sessionId, session, onHome, onBack, onArchive, onStats, onRules, onReview, onPlayNext }: Props) {
  const client = useQueryClient()
  const runtime = useServerRuntime()
  const liveState = session.danetki!
  const state = useMemo(() => import.meta.env.DEV && typeof window !== 'undefined' && new URLSearchParams(window.location.search).get('danetkiFixture') === 'filled'
    ? withFilledDanetkiVisualFixture(liveState)
    : liveState, [liveState])
  const isOwner = state.members.some((member) => member.userId === state.currentUserId && member.role === 'owner')
  const [draft, setDraft] = useState('')
  const [connection, setConnection] = useState<'connected' | 'reconnecting' | 'offline'>('reconnecting')
  const [error, setError] = useState('')
  const [dialog, setDialog] = useState<'guess' | 'hint' | 'surrender' | 'invite' | null>(null)
  const [guess, setGuess] = useState('')
  const [inviteLink, setInviteLink] = useState('')
  const [copied, setCopied] = useState(false)
  const [newMessages, setNewMessages] = useState(0)
  const listRef = useRef<HTMLDivElement>(null)
  const outcomeRef = useRef<HTMLDivElement>(null)
  const wasNearBottom = useRef(true)
  const previousMessageCount = useRef(state.messages.length)
  const sendKey = useRef<string | null>(null)
  const previousSessionStatus = useRef(session.status)
  const limitTracked = useRef(false)
  const firstQuestionSource = useRef<'typed' | 'starter' | 'unknown'>('unknown')

  const refresh = async () => client.invalidateQueries({ queryKey: queryKeys.game(sessionId) })
  const inviteHref = (token: string) => {
    const url = new URL(window.location.href)
    const root = url.pathname.replace(/\/sessions\/.*$/, '').replace(/\/$/, '')
    return `${url.origin}${root}/danetki/join/${encodeURIComponent(token)}`
  }
  useEffect(() => {
    let source: EventSource | null = null
    let poll: number | null = null
    const startPolling = () => {
      if (poll != null) return
      poll = window.setInterval(() => void refresh(), 5_000)
    }
    try {
      source = new EventSource(danetkiEventsUrl(sessionId), { withCredentials: true })
      source.onopen = () => { setConnection('connected'); if (poll != null) { window.clearInterval(poll); poll = null } }
      source.onerror = () => { setConnection(navigator.onLine ? 'reconnecting' : 'offline'); startPolling() }
      source.addEventListener('session.snapshot', (event) => {
        const next = JSON.parse((event as MessageEvent).data) as GameSessionSnapshot
        client.setQueryData<GameResponse>(queryKeys.game(sessionId), { session: next })
      })
      for (const eventName of ['message.created', 'ai.status', 'session.finished', 'member.joined', 'member.left']) {
        source.addEventListener(eventName, () => void refresh())
      }
    } catch { setConnection('offline'); startPolling() }
    return () => { source?.close(); if (poll != null) window.clearInterval(poll) }
  }, [client, sessionId])

  useEffect(() => {
    const added = Math.max(0, state.messages.length - previousMessageCount.current)
    previousMessageCount.current = state.messages.length
    if (!wasNearBottom.current) {
      if (added) setNewMessages((current) => current + added)
      return
    }
    setNewMessages(0)
    listRef.current?.scrollTo({ top: listRef.current.scrollHeight, behavior: 'smooth' })
  }, [state.messages.length])

  useEffect(() => {
    if (state.questionCount <= 0) return
    const storageKey = `shoditsa:danetki-engaged:${sessionId}`
    try { if (window.sessionStorage.getItem(storageKey)) return; window.sessionStorage.setItem(storageKey, '1') } catch { /* continue without deduplication */ }
    const payload = {
      mode: 'danetki',
      sessionKind: session.kind,
      roomMode: state.roomMode,
      questionCount: state.questionCount,
      entryMethod: firstQuestionSource.current,
    }
    trackClientEvent('danetki_first_question', payload, { gameSessionId: sessionId })
    trackMetrikaGoal('danetki_first_question', payload)
  }, [session.kind, sessionId, state.questionCount, state.roomMode])

  useEffect(() => {
    const completedNow = isFreshDanetkiCompletion(previousSessionStatus.current, session.status)
    previousSessionStatus.current = session.status
    if (!completedNow || !isOwner) return
    const completionMeta = {
      mode: 'danetki' as const,
      kind: session.kind,
      outcome: session.status,
      attempts: state.questionCount,
      room_mode: state.roomMode,
    }
    trackGameCompleteOnce(sessionId, completionMeta)
    trackMetrikaGoal('danetki_room_completed', completionMeta)
    void Promise.all([
      client.invalidateQueries({ queryKey: queryKeys.dashboard }),
      client.invalidateQueries({ queryKey: queryKeys.ledger }),
    ])
  }, [client, isOwner, session.id, session.kind, session.status, state.questionCount, state.roomMode])

  useEffect(() => {
    if (!isOwner || session.status === 'playing') return
    const balanceBefore = runtime.dashboard?.wallet.balance ?? 0
    const amount = session.status === 'won' && session.kind === 'daily' && isOwner ? runtime.dashboard?.economyRules.danetki.ownerDailyCompletionReward ?? 10 : 0
    trackClientEvent('danetki_room_completed', {
      balanceBefore,
      balanceAfter: balanceBefore + amount,
      amount,
      required: 0,
      shortage: 0,
      source: session.kind === 'daily' ? 'danetki-daily' : 'danetki-room',
      sink: null,
      mode: 'danetki',
      sessionKind: session.kind,
      roomMode: state.roomMode,
      questionCount: state.questionCount,
      outcome: session.status,
      dailyCompletedCount: runtime.dashboard?.today?.completedModes.length ?? 0,
      streak: runtime.dashboard?.attendance?.currentDailyStreak ?? 0,
      rulesVersion: session.rulesVersion,
      hasClub: runtime.dashboard?.membership.active ?? false,
    }, {
      eventId: deterministicClientEventId(session.id, 'danetki_room_completed'),
      gameSessionId: session.id,
    })
  }, [isOwner, runtime.dashboard, session.id, session.kind, session.rulesVersion, session.status, state.questionCount, state.roomMode])

  useEffect(() => {
    if (state.questionsRemaining > 0 || limitTracked.current) return
    limitTracked.current = true
    const balance = runtime.dashboard?.wallet.balance ?? 0
    trackClientEvent('danetki_limit_reached', {
      balanceBefore: balance,
      balanceAfter: balance,
      amount: 0,
      mode: 'danetki',
      sessionKind: session.kind,
      roomMode: state.roomMode,
      questionCount: state.questionCount,
      required: state.questionLimit,
      shortage: 0,
      source: 'danetki-room',
      sink: null,
      dailyCompletedCount: runtime.dashboard?.today?.completedModes.length ?? 0,
      streak: runtime.dashboard?.attendance?.currentDailyStreak ?? 0,
      rulesVersion: session.rulesVersion,
      hasClub: runtime.dashboard?.membership.active ?? false,
    }, { gameSessionId: session.id })
  }, [runtime.dashboard, session.id, session.kind, session.rulesVersion, state.questionCount, state.questionLimit, state.questionsRemaining, state.roomMode])

  useEffect(() => {
    if (session.status === 'playing') return
    const frame = window.requestAnimationFrame(() => outcomeRef.current?.scrollIntoView({
      behavior: window.matchMedia('(prefers-reduced-motion: reduce)').matches ? 'auto' : 'smooth',
      block: 'center',
    }))
    return () => window.cancelAnimationFrame(frame)
  }, [session.status])

  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key !== 'Escape' || dialog) return
      if (event.target instanceof HTMLInputElement || event.target instanceof HTMLTextAreaElement || event.target instanceof HTMLSelectElement || (event.target instanceof HTMLElement && event.target.isContentEditable)) return
      event.preventDefault()
      onBack()
    }
    window.addEventListener('keydown', onKeyDown)
    return () => window.removeEventListener('keydown', onKeyDown)
  }, [dialog, onBack])

  const send = useMutation({
    mutationFn: ({ text, key }: { text: string; key: string }) => api.danetkiMessage(sessionId, text, key),
    onSuccess: async () => { sendKey.current = null; setDraft(''); setError(''); await refresh() },
    onError: (failure) => setError(errorText(failure)),
  })
  const hint = useMutation({ mutationFn: () => api.danetkiHint(sessionId, crypto.randomUUID()), onSuccess: async () => { setDialog(null); await refresh() }, onError: (failure) => setError(errorText(failure)) })
  const finalGuess = useMutation({ mutationFn: () => api.danetkiGuess(sessionId, guess, crypto.randomUUID()), onSuccess: async () => { setDialog(null); setGuess(''); await refresh() }, onError: (failure) => setError(errorText(failure)) })
  const surrender = useMutation({ mutationFn: () => api.danetkiSurrender(sessionId, crypto.randomUUID()), onSuccess: async () => { setDialog(null); await refresh() }, onError: (failure) => setError(errorText(failure)) })
  const invite = useMutation({
    mutationFn: () => api.danetkiInvite(sessionId, crypto.randomUUID()),
    onSuccess: ({ token }) => {
      setInviteLink(inviteHref(token))
    },
    onError: (failure) => setError(errorText(failure)),
  })
  const retryAi = useMutation({ mutationFn: () => api.danetkiRetryAi(sessionId, crypto.randomUUID()), onSuccess: async () => { setError(''); await refresh() }, onError: (failure) => setError(errorText(failure)) })
  const leave = useMutation({ mutationFn: () => api.danetkiLeave(sessionId, crypto.randomUUID()), onSuccess: onHome, onError: (failure) => setError(errorText(failure)) })

  const submit = (event: FormEvent) => {
    event.preventDefault()
    const text = draft.trim()
    if (text.length < 2 || send.isPending) return
    firstQuestionSource.current = 'typed'
    const key = sendKey.current ?? crypto.randomUUID()
    sendKey.current = key
    send.mutate({ text, key })
  }
  const activeMembers = useMemo(() => state.members.filter((member) => !member.leftAt), [state.members])
  const currentTurn = activeMembers.find((member) => member.userId === state.currentTurnUserId)
  const isMyTurn = state.roomMode === 'solo' || state.currentTurnUserId === state.currentUserId
  const hostReady = state.aiStatus !== 'queued' && state.aiStatus !== 'processing'
  const participantWord = activeMembers.length % 10 === 1 && activeMembers.length % 100 !== 11
    ? 'участник'
    : activeMembers.length % 10 >= 2 && activeMembers.length % 10 <= 4 && (activeMembers.length % 100 < 12 || activeMembers.length % 100 > 14)
      ? 'участника'
      : 'участников'
  const questionWord = state.questionCount % 10 === 1 && state.questionCount % 100 !== 11
    ? 'вопрос'
    : state.questionCount % 10 >= 2 && state.questionCount % 10 <= 4 && (state.questionCount % 100 < 12 || state.questionCount % 100 > 14)
      ? 'вопроса'
      : 'вопросов'
  const hostStatus = connection === 'offline'
    ? 'Ведущий не в сети'
    : connection === 'reconnecting'
      ? 'Восстанавливаем связь'
      : state.aiStatus === 'processing' || state.aiStatus === 'queued'
        ? 'Ведущий думает…'
        : state.aiStatus === 'error' ? 'Ведущий временно недоступен' : 'Ведущий на связи'
  const hostState = connection === 'connected' ? state.aiStatus : connection
  const submitStarterQuestion = (question: string) => {
    const text = question.trim()
    if (text.length < 2 || send.isPending || state.questionsRemaining <= 0 || !isMyTurn || !hostReady) return
    firstQuestionSource.current = 'starter'
    const key = crypto.randomUUID()
    sendKey.current = key
    setDraft(text)
    send.mutate({ text, key })
  }
  const difficulty = state.puzzle.difficulty === 'easy' ? 'лёгкая' : state.puzzle.difficulty === 'hard' ? 'сложная' : 'средняя'
  const puzzleDate = new Date(`${session.puzzleDate}T12:00:00`)
  const dateLabel = Number.isNaN(puzzleDate.getTime())
    ? session.puzzleDate
    : new Intl.DateTimeFormat('ru-RU', { day: 'numeric', month: 'long' }).format(puzzleDate)
  const dateBadge = Number.isNaN(puzzleDate.getTime())
    ? session.puzzleDate
    : `${String(puzzleDate.getDate()).padStart(2, '0')}/${String(puzzleDate.getMonth() + 1).padStart(2, '0')}`
  const caseNumber = (state.puzzle.id.match(/\d+/g)?.join('') ?? dateBadge.replace(/\D/g, '')).slice(-3).padStart(3, '0')
  return <div className={`danetki-page danetki-page--session${dialog ? ' is-dialog-open' : ''}`}>
    <AppHeader onHome={onHome} onArchive={onArchive} onStats={onStats} onRules={onRules} onReview={onReview} hideMobileNav />

    <GameScreenShell
      variant="session"
      onBack={onBack}
      className="game-shell danetki-main"
      status={connection !== 'connected' && <span className={`danetki-connection danetki-connection--${connection}`}>{connection === 'offline' ? 'нет сети' : 'переподключение'}</span>}
    >
      <section className="game-heading danetki-game-heading">
        <div>
          <div className="game-heading__kicker"><span>{session.kind === 'daily' ? 'Сегодня' : 'Архив'} · Дело №{caseNumber} · {difficulty}</span></div>
          <h1>{session.kind === 'daily' ? 'Данетка дня' : 'Архивная данетка'}</h1>
          <p>{dateLabel} · обновление в 00:00 МСК</p>
        </div>
        <div className="mini-ticket danetki-mini-ticket" aria-hidden="true"><CalendarDays /><span>{dateBadge.slice(0, 2)}<small>/{dateBadge.slice(-2)}</small></span></div>
      </section>

      <section className="danetki-case-brief" aria-labelledby="danetki-case-title">
        <header>
          <span id="danetki-case-title"><HelpCircle aria-hidden="true" /> Ситуация</span>
          <strong>Дело №{caseNumber}</strong>
        </header>
        <p>{state.puzzle.condition}</p>
        {session.status === 'playing' && state.questionCount === 0 && state.puzzle.starterQuestions.length > 0 && <div className="danetki-starter-questions" aria-label="Готовые стартовые вопросы">
          <span>Начать одним нажатием</span>
          <div>{state.puzzle.starterQuestions.slice(0, 3).map((question) => <ControlButton
            key={question}
            type="button"
            disabled={send.isPending || state.questionsRemaining <= 0 || !isMyTurn || !hostReady}
            onClick={() => submitStarterQuestion(question)}
          >{question}</ControlButton>)}</div>
        </div>}
        <footer>
          <span>Задавайте вопросы, на которые можно ответить «да» или «нет»</span>
          <span className={`danetki-host-status danetki-host-status--${hostState}`}><i aria-hidden="true" />{hostStatus}</span>
          {state.aiStatus === 'error' && <ControlButton type="button" className="danetki-host-retry" onClick={() => retryAi.mutate()} disabled={retryAi.isPending}><RefreshCw /> Повторить</ControlButton>}
        </footer>
      </section>

      {session.status === 'playing' && <div className="progress-row danetki-progress-row">
        <SegmentedProgress value={state.questionCount} max={state.questionLimit} segments={10} label="Вопросы ведущему" className="danetki-question-progress" />
        <ActionButton type="button" variant="hint" className="hint-trigger" onClick={() => setDialog('hint')} disabled={state.hintLevel >= 3}><Lightbulb /> Подсказка {state.hintLevel}/3</ActionButton>
      </div>}

      <section className="danetki-investigation">
        <div className="danetki-room-toolbar">
          <div className="danetki-room-summary">
            <strong>Ход расследования</strong>
            <small>{state.roomMode === 'group' ? `${activeMembers.length} ${participantWord} · вопросы по очереди` : 'Чат с ведущим'}</small>
          </div>
          <span className="danetki-question-count"><HelpCircle /> {state.questionCount} <i>из {state.questionLimit}</i></span>
          {state.roomMode === 'group' && <div className="danetki-members" aria-label={`${activeMembers.length} ${participantWord}`}>
              <span className="danetki-avatar danetki-avatar--host" title="Ведущий"><img src={publicAssetUrl('images/danetki/host-avatar.webp')} width="32" height="32" alt="" /></span>
              {activeMembers.slice(0, 2).map((member) => <span key={member.userId} className={`danetki-avatar ${member.userId === state.currentUserId ? 'is-current' : ''}`} title={member.displayName} data-color={member.colorKey}>{member.displayName.slice(0, 1).toUpperCase()}</span>)}
              {activeMembers.length > 2 && <span className="danetki-avatar danetki-avatar--more" title={`Ещё участников: ${activeMembers.length - 2}`}>+{activeMembers.length - 2}</span>}
            </div>}
          {state.roomMode === 'group' && <div className="danetki-room-tools">{currentTurn && <span className={`danetki-turn${isMyTurn ? ' is-current' : ''}`}>{isMyTurn ? 'Ваш ход' : `Ход: ${currentTurn.displayName}`}</span>}{state.canInvite && <ActionButton type="button" variant="secondary" aria-label="Пригласить участника" title="Пригласить участника" onClick={() => invite.mutate(undefined, { onSuccess: () => setDialog('invite') })} disabled={invite.isPending}><Users /></ActionButton>}<ActionButton type="button" variant="ghost" aria-label="Выйти из комнаты" title="Выйти из комнаты" onClick={() => leave.mutate()} disabled={leave.isPending}><DoorOpen /></ActionButton></div>}
        </div>

        <div className="danetki-messages" ref={listRef} role="log" aria-live="polite" onScroll={(event) => { const node = event.currentTarget; wasNearBottom.current = node.scrollHeight - node.scrollTop - node.clientHeight < 80; if (wasNearBottom.current) setNewMessages(0) }}>
          {state.roomMode === 'group' && activeMembers.length === 1 && <div className="danetki-system danetki-waiting"><Users /><span>Комната готова. Отправьте ссылку друзьям — расследование синхронизируется для всех.</span></div>}
          {!state.messages.length && <div className="danetki-empty"><Sparkles /><p>Расследование начинается. Задайте свой вопрос ведущему.</p></div>}
          {state.messages.map((message) => {
            if (message.senderKind === 'system') return <div key={message.id} className={`danetki-system ${message.messageType === 'solution' ? 'is-solution' : ''}`}><span>{message.text}</span><time>{localTime(message.createdAt)}</time></div>
            const mine = message.senderUserId === state.currentUserId
            const sender = message.senderUserId ? state.members.find((member) => member.userId === message.senderUserId) : null
            const senderName = message.senderKind === 'ai' ? 'Ведущий' : message.senderName ?? sender?.displayName ?? 'Игрок'
            return <article key={message.id} className={`danetki-message ${mine ? 'is-mine' : ''} ${message.senderKind === 'user' ? 'is-user' : 'is-ai'} is-${message.classification ?? 'neutral'}`}>
              <span className="danetki-message__avatar" data-color={sender?.colorKey}>{message.senderKind === 'ai' ? <img src={publicAssetUrl('images/danetki/host-avatar.webp')} width="30" height="30" alt="" /> : senderName.slice(0, 1).toUpperCase()}</span>
              <div className="danetki-message__bubble"><header><strong className="danetki-message__author">{mine ? 'Вы' : senderName}</strong><time>{localTime(message.createdAt)}</time></header><p>{message.text}</p></div>
            </article>
          })}
          {(send.isPending || send.isError) && send.variables && <article className="danetki-message is-mine is-user is-pending">
            <span className="danetki-message__avatar">В</span>
            <div className="danetki-message__bubble"><header><strong className="danetki-message__author">Вы</strong><small>{send.isPending ? 'Отправляется…' : 'Не отправлено'}</small></header><p>{send.variables.text}</p>{send.isError && <ControlButton type="button" onClick={() => send.mutate(send.variables!)}>Повторить</ControlButton>}</div>
          </article>}
          {(state.aiStatus === 'queued' || state.aiStatus === 'processing') && <div className="danetki-typing"><span className="danetki-message__avatar"><img src={publicAssetUrl('images/danetki/host-avatar.webp')} width="30" height="30" alt="" /></span><span><i /><i /><i /></span></div>}
        </div>
        {newMessages > 0 && <ControlButton type="button" className="danetki-new-messages" onClick={() => { wasNearBottom.current = true; setNewMessages(0); listRef.current?.scrollTo({ top: listRef.current.scrollHeight, behavior: 'smooth' }) }}>Новые сообщения · {newMessages}</ControlButton>}

      </section>

      {session.status === 'playing' && <section className="search-area search-area--sticky danetki-search-area">
        <div className="sticky-composer__status" role="status" aria-live="polite">
          <span>{!isMyTurn ? `Сейчас спрашивает ${currentTurn?.displayName ?? 'другой игрок'}` : !hostReady ? 'Ведущий готовит ответ…' : `Следующий вопрос · ${state.questionCount + 1}`}</span>
          <strong>{state.questionsRemaining} осталось</strong>
        </div>
        <form className="danetki-composer" onSubmit={submit}><TextArea surface="paper" value={draft} onChange={(event) => setDraft(event.target.value)} onKeyDown={(event) => { if (event.key === 'Enter' && !event.shiftKey) { event.preventDefault(); event.currentTarget.form?.requestSubmit() } }} maxLength={300} rows={1} placeholder={state.questionsRemaining <= 0 ? 'Лимит вопросов исчерпан' : !isMyTurn ? `Сейчас спрашивает ${currentTurn?.displayName ?? 'другой игрок'}` : !hostReady ? 'Дождитесь ответа ведущего…' : 'Спросите ведущего…'} aria-label="Вопрос ведущему" disabled={state.questionsRemaining <= 0 || !isMyTurn || !hostReady} /><ActionButton type="submit" className="danetki-composer__send" disabled={send.isPending || draft.trim().length < 2 || state.questionsRemaining <= 0 || !isMyTurn || !hostReady} aria-label="Отправить вопрос" title={isMyTurn ? 'Отправить вопрос' : 'Дождитесь своего хода'}>{send.isPending ? <LoaderCircle className="danetki-spinner" /> : <ArrowUp strokeWidth={2.6} />}</ActionButton></form>
        <div className="danetki-composer-actions"><ActionButton type="button" variant="secondary" onClick={() => setDialog('guess')}><Check /> Я знаю разгадку</ActionButton><ActionButton type="button" variant="ghost" onClick={() => setDialog('surrender')}><DoorOpen /> Сдаться</ActionButton></div>
      </section>}

      {session.status === 'playing' && state.questionCount >= 3 && <DanetkiRegistrationOffer placement="investigation" sessionId={session.id} questionCount={state.questionCount} story={state.puzzle.id} />}

      {error && <InlineAlert tone="danger" className="danetki-error" onDismiss={() => setError('')}>{error}</InlineAlert>}
      {session.status !== 'playing' && <div ref={outcomeRef}>
        <DanetkiResult
          status={session.status === 'won' ? 'won' : 'lost'}
          completionType={session.completionType}
          questionCount={state.questionCount}
          questionWord={questionWord}
          hintLevel={state.hintLevel}
          sessionId={session.id}
          story={state.puzzle.id}
          completedModes={runtime.dashboard?.today?.completedModes}
          onPlayNext={onPlayNext}
          onHome={onHome}
        />
      </div>}
    </GameScreenShell>

    {dialog && <DialogSurface backdropClassName="danetki-dialog-backdrop" className="danetki-dialog" onClose={() => setDialog(null)} ariaLabelledBy="danetki-dialog-title">
      {dialog === 'guess' && <><h2 id="danetki-dialog-title">Ваша разгадка</h2><p>{state.roomMode === 'group' ? 'Опишите всю причинно-следственную связь. Версию увидят все участники.' : 'Опишите всю причинно-следственную связь. Ведущий проверит версию.'}</p><TextArea surface="paper" rows={7} maxLength={1500} value={guess} onChange={(event) => setGuess(event.target.value)} autoFocus /><div><ActionButton variant="secondary" onClick={() => setDialog(null)}>Отмена</ActionButton><ActionButton disabled={guess.trim().length < 20 || finalGuess.isPending} onClick={() => finalGuess.mutate()}>{finalGuess.isPending ? 'Проверяем…' : 'Проверить версию'}</ActionButton></div></>}
      {dialog === 'hint' && <><h2 id="danetki-dialog-title">Открыть подсказку?</h2><p>{state.roomMode === 'group' ? 'Подсказку увидят все участники комнаты. Она снизит итоговый результат.' : 'Подсказка появится в протоколе и снизит итоговый результат.'}</p><div><ActionButton variant="secondary" onClick={() => setDialog(null)}>Отмена</ActionButton><ActionButton disabled={hint.isPending} onClick={() => hint.mutate()}>Показать подсказку</ActionButton></div></>}
      {dialog === 'surrender' && <><h2 id="danetki-dialog-title">Завершить расследование?</h2><p>{state.roomMode === 'group' ? 'Ваш голос будет учтён. Для сдачи нужны голоса всех активных участников.' : 'После сдачи откроется полная авторская разгадка.'}</p><div><ActionButton variant="secondary" onClick={() => setDialog(null)}>Продолжить игру</ActionButton><ActionButton variant="danger" disabled={surrender.isPending} onClick={() => surrender.mutate()}>Сдаться</ActionButton></div></>}
      {dialog === 'invite' && <><h2 id="danetki-dialog-title">Пригласить в расследование</h2><p>Ссылка действует 24 часа.</p><TextInput surface="paper" aria-label="Ссылка-приглашение" readOnly value={inviteLink} /><div><ActionButton variant="secondary" onClick={() => setDialog(null)}>Готово</ActionButton><ActionButton onClick={async () => { await navigator.clipboard.writeText(inviteLink); setCopied(true) }}><Copy /> {copied ? 'Скопировано' : 'Копировать'}</ActionButton></div></>}
    </DialogSurface>}
  </div>
}

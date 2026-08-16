import { useEffect, useMemo, useRef, useState, type FormEvent } from 'react'
import { useMutation, useQueryClient } from '@tanstack/react-query'
import type { GameResponse, GameSessionSnapshot } from '@shoditsa/contracts'
import { ArrowRight, BookOpen, CalendarDays, Check, CheckCircle2, Clock3, Copy, DoorOpen, HelpCircle, Lightbulb, LoaderCircle, RefreshCw, Save, Send, Sparkles, Users } from 'lucide-react'
import { api, ApiClientError, danetkiEventsUrl, queryKeys } from '../../api/client'
import { publicAssetUrl } from '../../app/public-asset'
import { trackClientEvent } from '../../app/client-events'
import { trackMetrikaGoal } from '../../app/metrics'
import { trackGameCompleteOnce } from '../../app/game-analytics'
import { ActionButton, AppHeader } from '../../components/app-shell/AppShell'
import { useServerRuntime } from '../../hooks/use-server-runtime'
import { withFilledDanetkiVisualFixture } from './DanetkiGamePage.fixture'
import { GameScreenShell } from '../../components/game-shell/GameScreenShell'
import { ControlButton, DialogSurface, InlineAlert, TextArea, TextInput } from '../../components/ui'
import { useAuthSession } from '../auth/use-auth-session'
import {
  currentDanetkiReturnUrl,
  danetkiRegistrationHref,
  rememberDanetkiRegistrationIntent,
  type DanetkiRegistrationPlacement,
} from './danetki-registration-attribution'
import './DanetkiGamePage.css'
import './DanetkiSession.css'
import './DanetkiCaseHeader.css'
import './DanetkiInvestigation.css'
import './DanetkiOutcome.css'

type Props = {
  sessionId: string
  session: GameSessionSnapshot
  onHome: () => void
  onBack: () => void
  onArchive: () => void
  onStats: () => void
  onRules: () => void
  onReview: () => void
}

const errorText = (error: unknown) => error instanceof ApiClientError ? error.message : error instanceof Error ? error.message : 'Не удалось выполнить действие'
const localTime = (value: string) => new Intl.DateTimeFormat('ru-RU', { hour: '2-digit', minute: '2-digit' }).format(new Date(value))

function DanetkiRegistrationOffer({ placement, sessionId, questionCount }: { placement: Extract<DanetkiRegistrationPlacement, 'investigation' | 'result'>; sessionId: string; questionCount: number }) {
  const { session: authSession, loading } = useAuthSession()
  const viewTracked = useRef(false)
  const guest = !authSession || authSession.isAnonymous
  const returnUrl = currentDanetkiReturnUrl()
  const href = danetkiRegistrationHref(placement, returnUrl)

  useEffect(() => {
    if (loading || !guest || viewTracked.current) return
    viewTracked.current = true
    const payload = { placement, mode: 'danetki', questionCount }
    trackClientEvent('danetki_registration_offer_view', payload, { gameSessionId: sessionId })
    trackMetrikaGoal('danetki_registration_offer_view', payload)
  }, [guest, loading, placement, questionCount, sessionId])

  if (loading) return null
  if (!guest) return placement === 'result' ? <section className="danetki-registration-offer is-saved" aria-label="Прогресс сохранён"><span><CheckCircle2 aria-hidden="true" /></span><div><strong>Расследование сохранено</strong><p>Результат, серия дней и статистика доступны в вашем профиле.</p></div></section> : null

  const click = () => {
    rememberDanetkiRegistrationIntent(placement, returnUrl)
    const payload = { placement, mode: 'danetki', questionCount, returnUrl }
    trackClientEvent('danetki_registration_offer_clicked', payload, { gameSessionId: sessionId })
    trackMetrikaGoal('danetki_registration_offer_clicked', payload)
  }
  return <section className={`danetki-registration-offer danetki-registration-offer--${placement}`} aria-label="Сохранить расследование">
    <span><Save aria-hidden="true" /></span>
    <div><strong>{placement === 'result' ? 'Сохраните закрытое дело' : 'Не потеряйте расследование'}</strong><p>{placement === 'result' ? 'Аккаунт сохранит результат, серию дней и статистику на любом устройстве.' : 'После регистрации вы вернётесь в это дело, а прогресс останется в профиле.'}</p></div>
    <a href={href} onClick={click}>{placement === 'result' ? 'Сохранить в аккаунте' : 'Создать аккаунт'}</a>
  </section>
}

export function DanetkiGamePage({ sessionId, session, onHome, onBack, onArchive, onStats, onRules, onReview }: Props) {
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
  const outcomeRef = useRef<HTMLElement>(null)
  const wasNearBottom = useRef(true)
  const previousMessageCount = useRef(state.messages.length)
  const sendKey = useRef<string | null>(null)
  const completionTracked = useRef(false)
  const previousSessionStatus = useRef(session.status)
  const limitTracked = useRef(false)

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
    const payload = { mode: 'danetki', sessionKind: session.kind, roomMode: state.roomMode, questionCount: state.questionCount }
    trackClientEvent('danetki_first_question', payload, { gameSessionId: sessionId })
    trackMetrikaGoal('danetki_first_question', payload)
  }, [session.kind, sessionId, state.questionCount, state.roomMode])

  useEffect(() => {
    const completedNow = previousSessionStatus.current === 'playing' && session.status !== 'playing'
    previousSessionStatus.current = session.status
    if (completedNow) {
      trackGameCompleteOnce(sessionId, {
        mode: 'danetki',
        kind: session.kind,
        outcome: session.status,
        attempts: state.questionCount,
        room_mode: state.roomMode,
      })
    }
    if (session.status === 'playing' || completionTracked.current) return
    completionTracked.current = true
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
    }, { gameSessionId: session.id })
    void Promise.all([
      client.invalidateQueries({ queryKey: queryKeys.dashboard }),
      client.invalidateQueries({ queryKey: queryKeys.ledger }),
    ])
  }, [client, isOwner, runtime.dashboard, session.id, session.kind, session.rulesVersion, session.status, state.questionCount, state.roomMode])

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
  const difficulty = state.puzzle.difficulty === 'easy' ? 'лёгкая' : state.puzzle.difficulty === 'hard' ? 'сложная' : 'средняя'
  const puzzleDate = new Date(`${session.puzzleDate}T12:00:00`)
  const dateLabel = Number.isNaN(puzzleDate.getTime())
    ? session.puzzleDate
    : new Intl.DateTimeFormat('ru-RU', { day: 'numeric', month: 'long' }).format(puzzleDate)
  const dateBadge = Number.isNaN(puzzleDate.getTime())
    ? session.puzzleDate
    : `${String(puzzleDate.getDate()).padStart(2, '0')}/${String(puzzleDate.getMonth() + 1).padStart(2, '0')}`
  const caseNumber = (state.puzzle.id.match(/\d+/g)?.join('') ?? dateBadge.replace(/\D/g, '')).slice(-3).padStart(3, '0')

  return <div className="danetki-page danetki-page--session">
    <AppHeader onHome={onHome} onArchive={onArchive} onStats={onStats} onRules={onRules} onReview={onReview} />

    <GameScreenShell
      variant="session"
      onBack={onBack}
      wide
      className="game-shell danetki-main"
      status={connection !== 'connected' && <span className={`danetki-connection danetki-connection--${connection}`}>{connection === 'offline' ? 'нет сети' : 'переподключение'}</span>}
    >

      <section className="danetki-situation">
        <div className="danetki-situation__copy">
          <span className="danetki-kicker">{session.kind === 'daily' ? `Сегодня · Данетка №${caseNumber} · ${difficulty}` : `Архив · Данетка · ${difficulty}`}</span>
          <h1>{session.kind === 'daily' ? 'Данетка дня' : 'Архивная данетка'}</h1>
          <div className="danetki-case-meta"><span>{dateLabel} · обновление в 00:00 МСК</span><strong>Дело №{caseNumber} · вход</strong></div>
          <p>{state.puzzle.condition}</p>
          <small>Задавайте вопросы, на которые можно ответить «да» или «нет».</small>
        </div>
        <div className="danetki-case-date" aria-label={`Дата: ${dateBadge}`}><CalendarDays aria-hidden="true" /><strong>{dateBadge}</strong></div>
        <div className={`danetki-host danetki-host--${state.aiStatus}`}>
          <div className="danetki-artwork" aria-hidden="true">
            <picture><source srcSet={publicAssetUrl('images/danetki/danetka-detective-hero.webp')} type="image/webp" /><img src={publicAssetUrl('images/danetki/danetka-detective-hero.png')} width="1672" height="941" decoding="async" fetchPriority="high" alt="" /></picture>
            <span className="danetki-artwork__case"><i>Дело</i><b>№ {caseNumber}</b></span>
          </div>
          {state.aiStatus === 'error' && <ControlButton type="button" onClick={() => retryAi.mutate()} disabled={retryAi.isPending}><RefreshCw /> Повторить</ControlButton>}
        </div>
        <div className={`danetki-hostline danetki-hostline--${hostState}`}><strong><i aria-hidden="true" />{hostStatus}</strong><span>{state.aiStatus === 'error' ? 'Попробуйте повторить запрос' : 'Реагирует на ваши вопросы'}</span></div>
      </section>

      <section className="danetki-investigation">
        <div className="danetki-room-toolbar">
          <div className="danetki-room-summary">
            <strong>Протокол расследования</strong>
            <div className="danetki-members" aria-label={`${activeMembers.length} ${participantWord}`}>
              <span className="danetki-avatar danetki-avatar--host" title="Ведущий"><img src={publicAssetUrl('images/danetki/host-avatar.webp')} width="32" height="32" alt="" /></span>
              {activeMembers.slice(0, 2).map((member) => <span key={member.userId} className={`danetki-avatar ${member.userId === state.currentUserId ? 'is-current' : ''}`} title={member.displayName} data-color={member.colorKey}>{member.displayName.slice(0, 1).toUpperCase()}</span>)}
              {activeMembers.length > 2 && <span className="danetki-avatar danetki-avatar--more" title={`Ещё участников: ${activeMembers.length - 2}`}>+{activeMembers.length - 2}</span>}
              <small><Users /> {activeMembers.length} {participantWord}</small>
            </div>
          </div>
          <div className="danetki-room-tools"><span className="danetki-question-count"><HelpCircle /> {state.questionCount} {questionWord}</span>{state.roomMode === 'group' && currentTurn && <span className={`danetki-turn${isMyTurn ? ' is-current' : ''}`}>{isMyTurn ? 'Ваш ход' : `Ход: ${currentTurn.displayName}`}</span>}<ActionButton type="button" variant="secondary" onClick={() => listRef.current?.scrollTo({ top: 0, behavior: 'smooth' })}><Clock3 /> История</ActionButton>{state.canInvite && <ActionButton type="button" variant="secondary" onClick={() => invite.mutate(undefined, { onSuccess: () => setDialog('invite') })} disabled={invite.isPending}><Users /> Пригласить</ActionButton>}{state.roomMode === 'group' && <ActionButton type="button" variant="ghost" onClick={() => leave.mutate()} disabled={leave.isPending}><DoorOpen /> Выйти</ActionButton>}</div>
        </div>

        <div className="danetki-messages" ref={listRef} role="log" aria-live="polite" onScroll={(event) => { const node = event.currentTarget; wasNearBottom.current = node.scrollHeight - node.scrollTop - node.clientHeight < 80; if (wasNearBottom.current) setNewMessages(0) }}>
          {state.roomMode === 'group' && activeMembers.length === 1 && <div className="danetki-system danetki-waiting"><Users /><span>Комната готова. Отправьте ссылку друзьям — расследование синхронизируется для всех.</span></div>}
          {!state.messages.length && <div className="danetki-empty"><Sparkles /><p>Расследование начинается. Задайте свой вопрос ведущему.</p></div>}
          {state.messages.map((message) => {
            if (message.senderKind === 'system') return <div key={message.id} className={`danetki-system ${message.messageType === 'solution' ? 'is-solution' : ''}`}><span>{message.text}</span><time>{localTime(message.createdAt)}</time></div>
            const mine = message.senderUserId === state.currentUserId
            const userMessage = message.senderKind === 'user'
            const sender = message.senderUserId ? state.members.find((member) => member.userId === message.senderUserId) : null
            const senderName = message.senderKind === 'ai' ? 'Ведущий' : message.senderName ?? sender?.displayName ?? 'Игрок'
            return <article key={message.id} className={`danetki-message ${mine ? 'is-mine' : ''} ${userMessage ? 'is-user' : ''} ${message.senderKind === 'ai' ? 'is-ai' : ''}`}>
              <span className="danetki-message__avatar" data-color={sender?.colorKey}>{message.senderKind === 'ai' ? <img src={publicAssetUrl('images/danetki/host-avatar.webp')} width="30" height="30" alt="" /> : senderName.slice(0, 1).toUpperCase()}</span>
              <div className="danetki-message__bubble"><strong className="danetki-message__author">{senderName}</strong><p>{message.text}</p><time>{localTime(message.createdAt)}</time></div>
            </article>
          })}
          {(send.isPending || send.isError) && send.variables && <article className="danetki-message is-mine is-user is-pending">
            <span className="danetki-message__avatar">В</span>
            <div className="danetki-message__bubble"><strong className="danetki-message__author">Вы</strong><p>{send.variables.text}</p><small>{send.isPending ? 'Отправляется…' : 'Не отправлено'}</small>{send.isError && <ControlButton type="button" onClick={() => send.mutate(send.variables!)}>Повторить</ControlButton>}</div>
          </article>}
          {(state.aiStatus === 'queued' || state.aiStatus === 'processing') && <div className="danetki-typing"><LoaderCircle /> Ведущий обдумывает вопрос</div>}
        </div>
        {newMessages > 0 && <ControlButton type="button" className="danetki-new-messages" onClick={() => { wasNearBottom.current = true; setNewMessages(0); listRef.current?.scrollTo({ top: listRef.current.scrollHeight, behavior: 'smooth' }) }}>Новые сообщения · {newMessages}</ControlButton>}

        {session.status === 'playing' && <>
          <form className="danetki-composer" onSubmit={submit}><TextArea surface="paper" value={draft} onChange={(event) => setDraft(event.target.value)} onKeyDown={(event) => { if (event.key === 'Enter' && !event.shiftKey) { event.preventDefault(); event.currentTarget.form?.requestSubmit() } }} maxLength={300} rows={1} placeholder={state.questionsRemaining <= 0 ? 'Лимит вопросов исчерпан' : !isMyTurn ? `Сейчас спрашивает ${currentTurn?.displayName ?? 'другой игрок'}` : !hostReady ? 'Дождитесь ответа ведущего…' : 'Напишите вопрос…'} aria-label="Вопрос ведущему" disabled={state.questionsRemaining <= 0 || !isMyTurn || !hostReady} /><ActionButton type="submit" className="danetki-composer__send" disabled={send.isPending || draft.trim().length < 2 || state.questionsRemaining <= 0 || !isMyTurn || !hostReady} aria-label="Отправить вопрос" title={isMyTurn ? 'Отправить вопрос' : 'Дождитесь своего хода'}>{send.isPending ? <LoaderCircle className="danetki-spinner" /> : <Send />}</ActionButton></form>
        </>}
      </section>

      {session.status === 'playing' && state.questionCount >= 3 && <DanetkiRegistrationOffer placement="investigation" sessionId={session.id} questionCount={state.questionCount} />}

      {error && <InlineAlert tone="danger" className="danetki-error" onDismiss={() => setError('')}>{error}</InlineAlert>}
      {session.status === 'playing' ? <div className="danetki-session-actions">
        <ActionButton type="button" variant="primary" onClick={() => setDialog('guess')}><Check /> Я знаю разгадку</ActionButton>
        <ActionButton type="button" variant="secondary" onClick={() => setDialog('hint')} disabled={state.hintLevel >= 3}><Lightbulb /> Подсказка {state.hintLevel}/3</ActionButton>
        <ActionButton type="button" variant="ghost" onClick={() => setDialog('surrender')}><DoorOpen /> Сдаться</ActionButton>
      </div> : <section ref={outcomeRef} className={`danetki-outcome danetki-outcome--${session.status}`} aria-labelledby="danetki-outcome-title" aria-live="polite">
        <span className="danetki-outcome__mark" aria-hidden="true"><CheckCircle2 /></span>
        <div className="danetki-outcome__copy">
          <span>{session.status === 'won' ? 'Версия подтверждена' : session.completionType === 'answer_revealed' ? 'Вы сдались' : 'Разгадка открыта'}</span>
          <h2 id="danetki-outcome-title">Дело закрыто</h2>
          <p>{session.status === 'won' ? 'Вы восстановили цепочку событий.' : session.completionType === 'answer_revealed' ? 'Расследование завершено по вашему решению.' : 'Расследование завершено.'} Полная разгадка сохранена в протоколе выше.</p>
          <div className="danetki-outcome__meta">
            <span><HelpCircle aria-hidden="true" /> {state.questionCount} {questionWord}</span>
            <span><Lightbulb aria-hidden="true" /> {state.hintLevel > 0 ? `Подсказки: ${state.hintLevel}/3` : 'Без подсказок'}</span>
          </div>
        </div>
        <div className="danetki-outcome__conversion">
          <DanetkiRegistrationOffer placement="result" sessionId={session.id} questionCount={state.questionCount} />
          <div><a href="/danetki"><BookOpen aria-hidden="true" /> Все данетки с ответами</a><ActionButton type="button" className="danetki-outcome__action" onClick={onHome}>К другим играм <ArrowRight aria-hidden="true" /></ActionButton></div>
        </div>
      </section>}
    </GameScreenShell>

    {dialog && <DialogSurface backdropClassName="danetki-dialog-backdrop" className="danetki-dialog" onClose={() => setDialog(null)} ariaLabelledBy="danetki-dialog-title">
      {dialog === 'guess' && <><h2 id="danetki-dialog-title">Ваша разгадка</h2><p>{state.roomMode === 'group' ? 'Опишите всю причинно-следственную связь. Версию увидят все участники.' : 'Опишите всю причинно-следственную связь. Ведущая проверит версию.'}</p><TextArea surface="paper" rows={7} maxLength={1500} value={guess} onChange={(event) => setGuess(event.target.value)} autoFocus /><div><ActionButton variant="secondary" onClick={() => setDialog(null)}>Отмена</ActionButton><ActionButton disabled={guess.trim().length < 20 || finalGuess.isPending} onClick={() => finalGuess.mutate()}>{finalGuess.isPending ? 'Проверяем…' : 'Проверить версию'}</ActionButton></div></>}
      {dialog === 'hint' && <><h2 id="danetki-dialog-title">Открыть подсказку?</h2><p>{state.roomMode === 'group' ? 'Подсказку увидят все участники комнаты. Она снизит итоговый результат.' : 'Подсказка появится в протоколе и снизит итоговый результат.'}</p><div><ActionButton variant="secondary" onClick={() => setDialog(null)}>Отмена</ActionButton><ActionButton disabled={hint.isPending} onClick={() => hint.mutate()}>Показать подсказку</ActionButton></div></>}
      {dialog === 'surrender' && <><h2 id="danetki-dialog-title">Завершить расследование?</h2><p>{state.roomMode === 'group' ? 'Ваш голос будет учтён. Для сдачи нужны голоса всех активных участников.' : 'После сдачи откроется полная авторская разгадка.'}</p><div><ActionButton variant="secondary" onClick={() => setDialog(null)}>Продолжить игру</ActionButton><ActionButton variant="danger" disabled={surrender.isPending} onClick={() => surrender.mutate()}>Сдаться</ActionButton></div></>}
      {dialog === 'invite' && <><h2 id="danetki-dialog-title">Пригласить в расследование</h2><p>Ссылка действует 24 часа.</p><TextInput surface="paper" aria-label="Ссылка-приглашение" readOnly value={inviteLink} /><div><ActionButton variant="secondary" onClick={() => setDialog(null)}>Готово</ActionButton><ActionButton onClick={async () => { await navigator.clipboard.writeText(inviteLink); setCopied(true) }}><Copy /> {copied ? 'Скопировано' : 'Копировать'}</ActionButton></div></>}
    </DialogSurface>}
  </div>
}

import { useEffect, useMemo, useRef, useState, type FormEvent } from 'react'
import { useMutation, useQueryClient } from '@tanstack/react-query'
import type { GameResponse, GameSessionSnapshot } from '@shoditsa/contracts'
import { ArrowLeft, Check, Clock3, Copy, DoorOpen, HelpCircle, Lightbulb, LoaderCircle, RefreshCw, Send, Sparkles, Users } from 'lucide-react'
import { api, ApiClientError, danetkiEventsUrl, queryKeys } from '../../api/client'
import { publicAssetUrl } from '../../app/public-asset'
import { trackClientEvent } from '../../app/client-events'
import { useServerRuntime } from '../../hooks/use-server-runtime'
import './DanetkiGamePage.css'

type Props = {
  sessionId: string
  session: GameSessionSnapshot
  onHome: () => void
  onBack: () => void
}

const errorText = (error: unknown) => error instanceof ApiClientError ? error.message : error instanceof Error ? error.message : 'Не удалось выполнить действие'
const localTime = (value: string) => new Intl.DateTimeFormat('ru-RU', { hour: '2-digit', minute: '2-digit' }).format(new Date(value))

export const SESSION_RENDERER_BY_ENGINE = { danetki_chat: DanetkiGamePage }

export function DanetkiGamePage({ sessionId, session, onHome, onBack }: Props) {
  const client = useQueryClient()
  const runtime = useServerRuntime()
  const state = session.danetki!
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
  const dialogRef = useRef<HTMLElement>(null)
  const returnFocusRef = useRef<HTMLElement | null>(null)
  const wasNearBottom = useRef(true)
  const previousMessageCount = useRef(state.messages.length)
  const sendKey = useRef<string | null>(null)
  const completionTracked = useRef(false)
  const limitTracked = useRef(false)

  const refresh = async () => client.invalidateQueries({ queryKey: queryKeys.game(sessionId) })
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
    if (session.status === 'playing' || completionTracked.current) return
    completionTracked.current = true
    const balanceBefore = runtime.dashboard?.wallet.balance ?? 0
    const amount = session.kind === 'daily' && isOwner ? runtime.dashboard?.economyRules.danetki.ownerDailyCompletionReward ?? 10 : 0
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
    if (!dialog) return
    returnFocusRef.current = document.activeElement instanceof HTMLElement ? document.activeElement : null
    const node = dialogRef.current
    const focusable = () => [...(node?.querySelectorAll<HTMLElement>('button:not([disabled]), input:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])') ?? [])]
    focusable()[0]?.focus()
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') { event.preventDefault(); setDialog(null); return }
      if (event.key !== 'Tab') return
      const items = focusable()
      if (!items.length) return
      const first = items[0]; const last = items[items.length - 1]
      if (event.shiftKey && document.activeElement === first) { event.preventDefault(); last.focus() }
      else if (!event.shiftKey && document.activeElement === last) { event.preventDefault(); first.focus() }
    }
    document.addEventListener('keydown', onKeyDown)
    return () => { document.removeEventListener('keydown', onKeyDown); returnFocusRef.current?.focus(); returnFocusRef.current = null }
  }, [dialog])

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
      const url = new URL(window.location.href)
      const root = url.pathname.replace(/\/sessions\/.*$/, '').replace(/\/$/, '')
      setInviteLink(`${url.origin}${root}/danetki/join/${encodeURIComponent(token)}`)
      setDialog('invite')
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
  const hostStatus = state.aiStatus === 'processing' || state.aiStatus === 'queued' ? 'Ведущий думает…' : state.aiStatus === 'error' ? 'Ведущий временно недоступен' : 'Ведущий на связи'

  return <div className="danetki-page">
    <header className="danetki-nav">
      <button type="button" onClick={onBack} aria-label="Назад"><ArrowLeft /></button>
      <button type="button" className="danetki-brand" onClick={onHome}>Сходится!</button>
      <span className={`danetki-connection danetki-connection--${connection}`}>{connection === 'connected' ? 'онлайн' : connection === 'offline' ? 'нет сети' : 'переподключение'}</span>
    </header>

    <main className="danetki-main">
      <section className="danetki-heading">
        <div><span>{session.kind === 'daily' ? 'Данетка дня' : 'Архивная данетка'}</span><h1>{state.puzzle.titleRu}</h1><p>{session.puzzleDate} · {state.puzzle.difficulty === 'easy' ? 'лёгкая' : state.puzzle.difficulty === 'hard' ? 'сложная' : 'средняя'}</p></div>
        <div className="danetki-count"><HelpCircle /><strong>{state.questionCount}</strong><span>вопросов</span></div>
      </section>

      <section className="danetki-situation">
        <div className="danetki-situation__copy"><span className="danetki-kicker"><Sparkles /> Ситуация</span><p>{state.puzzle.condition}</p><small>Задавайте вопросы, на которые можно ответить «да» или «нет».</small></div>
        <div className={`danetki-host danetki-host--${state.aiStatus}`}><span aria-hidden="true">✦</span><img src={publicAssetUrl('media/danetki/host/host-neutral.webp')} width="720" height="900" decoding="async" fetchPriority="high" alt="ИИ-ведущий расследования с лупой" /><small>{hostStatus}</small>{state.aiStatus === 'error' && <button type="button" onClick={() => retryAi.mutate()} disabled={retryAi.isPending}><RefreshCw /> Повторить</button>}</div>
      </section>

      <section className="danetki-investigation">
        <div className="danetki-room-toolbar">
          <div className="danetki-members" aria-label={`Участников: ${activeMembers.length}`}>
            {activeMembers.map((member) => <span key={member.userId} className={`danetki-avatar ${member.userId === state.currentUserId ? 'is-current' : ''}`} title={member.displayName} data-color={member.colorKey}>{member.displayName.slice(0, 1).toUpperCase()}</span>)}
            <small><Users /> {activeMembers.length}</small>
          </div>
          <div className="danetki-room-tools"><button type="button" onClick={() => listRef.current?.scrollTo({ top: 0, behavior: 'smooth' })}><Clock3 /> История</button>{state.canInvite && <button type="button" onClick={() => invite.mutate()} disabled={invite.isPending}><Users /> Пригласить</button>}{state.roomMode === 'group' && <button type="button" onClick={() => leave.mutate()} disabled={leave.isPending}><DoorOpen /> Выйти</button>}</div>
        </div>

        <div className="danetki-messages" ref={listRef} aria-live="polite" onScroll={(event) => { const node = event.currentTarget; wasNearBottom.current = node.scrollHeight - node.scrollTop - node.clientHeight < 80; if (wasNearBottom.current) setNewMessages(0) }}>
          {state.roomMode === 'group' && activeMembers.length === 1 && <div className="danetki-system danetki-waiting"><Users /><span>Комната готова. Отправьте ссылку друзьям — расследование синхронизируется для всех.</span></div>}
          {!state.messages.length && <div className="danetki-empty"><Sparkles /><p>Расследование начинается. Выберите стартовый вопрос или задайте свой.</p></div>}
          {state.messages.map((message) => {
            if (message.senderKind === 'system') return <div key={message.id} className={`danetki-system ${message.messageType === 'solution' ? 'is-solution' : ''}`}><span>{message.text}</span><time>{localTime(message.createdAt)}</time></div>
            const mine = message.senderUserId === state.currentUserId
            return <article key={message.id} className={`danetki-message ${mine ? 'is-mine' : ''} ${message.senderKind === 'ai' ? 'is-ai' : ''}`}>
              <div className="danetki-message__author">{message.senderKind === 'ai' ? <><Sparkles /> Ведущий</> : message.senderName ?? 'Игрок'}</div>
              <div className="danetki-message__bubble"><p>{message.text}</p><time>{localTime(message.createdAt)}</time></div>
            </article>
          })}
          {(send.isPending || send.isError) && send.variables && <article className="danetki-message is-mine is-pending">
            <div className="danetki-message__author">Вы</div>
            <div className="danetki-message__bubble"><p>{send.variables.text}</p><small>{send.isPending ? 'Отправляется…' : 'Не отправлено'}</small>{send.isError && <button type="button" onClick={() => send.mutate(send.variables!)}>Повторить</button>}</div>
          </article>}
          {(state.aiStatus === 'queued' || state.aiStatus === 'processing') && <div className="danetki-typing"><LoaderCircle /> Ведущий обдумывает вопрос</div>}
        </div>
        {newMessages > 0 && <button type="button" className="danetki-new-messages" onClick={() => { wasNearBottom.current = true; setNewMessages(0); listRef.current?.scrollTo({ top: listRef.current.scrollHeight, behavior: 'smooth' }) }}>Новые сообщения · {newMessages}</button>}

        {session.status === 'playing' && <>
          <div className="danetki-suggestions">{state.puzzle.starterQuestions.slice(0, 3).map((question) => <button key={question} type="button" onClick={() => setDraft(question)}>{question}</button>)}</div>
          {state.questionCount >= state.questionWarningAt && <p className="danetki-question-limit" role="status">
            {state.questionsRemaining > 0
              ? `Осталось вопросов: ${state.questionsRemaining} из ${state.questionLimit}`
              : `Лимит ${state.questionLimit} вопросов исчерпан. Завершите расследование финальной версией или откройте разгадку.`}
          </p>}
          <form className="danetki-composer" onSubmit={submit}><textarea value={draft} onChange={(event) => setDraft(event.target.value)} maxLength={300} rows={2} placeholder={state.questionsRemaining > 0 ? 'Спросите о ситуации…' : 'Лимит вопросов исчерпан'} aria-label="Вопрос ведущей" disabled={state.questionsRemaining <= 0} /><button type="submit" disabled={send.isPending || draft.trim().length < 2 || state.questionsRemaining <= 0} aria-label="Отправить вопрос">{send.isPending ? <LoaderCircle /> : <Send />}</button></form>
        </>}
      </section>

      {error && <div className="danetki-error" role="alert">{error}<button type="button" onClick={() => setError('')}>Закрыть</button></div>}
      {session.status === 'playing' ? <div className="danetki-actions">
        <button type="button" className="is-primary" onClick={() => setDialog('guess')}><Check /> Я знаю разгадку</button>
        <button type="button" onClick={() => setDialog('hint')} disabled={state.hintLevel >= 3}><Lightbulb /> Подсказка {state.hintLevel}/3</button>
        <button type="button" onClick={() => setDialog('surrender')}><DoorOpen /> Сдаться</button>
      </div> : <section className={`danetki-result danetki-result--${session.status}`}><Sparkles /><h2>{session.status === 'won' ? 'Расследование завершено!' : 'Данетка раскрыта'}</h2><p>{state.solution}</p><button type="button" onClick={onHome}>На главную</button></section>}
    </main>

    {dialog && <div className="danetki-dialog-backdrop" role="presentation" onMouseDown={(event) => { if (event.target === event.currentTarget) setDialog(null) }}><section ref={dialogRef} className="danetki-dialog" role="dialog" aria-modal="true" aria-labelledby="danetki-dialog-title">
      {dialog === 'guess' && <><h2 id="danetki-dialog-title">Ваша разгадка</h2><p>Опишите всю причинно-следственную связь. Версию увидят все участники.</p><textarea rows={7} maxLength={1500} value={guess} onChange={(event) => setGuess(event.target.value)} autoFocus /><div><button type="button" onClick={() => setDialog(null)}>Отмена</button><button type="button" className="is-primary" disabled={guess.trim().length < 20 || finalGuess.isPending} onClick={() => finalGuess.mutate()}>{finalGuess.isPending ? 'Проверяем…' : 'Проверить версию'}</button></div></>}
      {dialog === 'hint' && <><h2 id="danetki-dialog-title">Открыть подсказку?</h2><p>Подсказку увидят все участники комнаты. Она снизит итоговый результат.</p><div><button type="button" onClick={() => setDialog(null)}>Отмена</button><button type="button" className="is-primary" disabled={hint.isPending} onClick={() => hint.mutate()}>Показать подсказку</button></div></>}
      {dialog === 'surrender' && <><h2 id="danetki-dialog-title">Завершить расследование?</h2><p>{state.roomMode === 'group' ? 'Ваш голос будет учтён. Для сдачи нужны голоса всех активных участников.' : 'После сдачи откроется полная авторская разгадка.'}</p><div><button type="button" onClick={() => setDialog(null)}>Продолжить игру</button><button type="button" className="is-danger" disabled={surrender.isPending} onClick={() => surrender.mutate()}>Сдаться</button></div></>}
      {dialog === 'invite' && <><h2 id="danetki-dialog-title">Пригласить в расследование</h2><p>Ссылка действует 24 часа.</p><input aria-label="Ссылка-приглашение" readOnly value={inviteLink} /><div><button type="button" onClick={() => setDialog(null)}>Готово</button><button type="button" className="is-primary" onClick={async () => { await navigator.clipboard.writeText(inviteLink); setCopied(true) }}><Copy /> {copied ? 'Скопировано' : 'Копировать'}</button></div></>}
    </section></div>}
  </div>
}

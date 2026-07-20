import { useState, type FormEvent } from 'react'
import { useMutation, useQuery } from '@tanstack/react-query'
import type { DanetkiRoomMode, GameSessionSnapshot } from '@shoditsa/contracts'
import { ArrowLeft, CalendarDays, Clock3, HelpCircle, LoaderCircle, Sparkles, UserRound, Users } from 'lucide-react'
import { api, ApiClientError } from '../../api/client'
import { ensureServerSession } from '../../hooks/use-server-runtime'
import { publicAssetUrl } from '../../app/public-asset'
import './DanetkiGamePage.css'

const messageFor = (error: unknown) => error instanceof ApiClientError
  ? error.message
  : error instanceof Error ? error.message : 'Не удалось выполнить действие'

export function DanetkiLobbyPage({ onHome, onStart, onContinue, onStartArchive, onStartFreePlay, busy, error }: {
  onHome: () => void
  onStart: (roomMode: DanetkiRoomMode) => void
  onContinue?: () => void
  onStartArchive?: (date: string) => void
  onStartFreePlay?: () => void
  busy: boolean
  error?: string
}) {
  const [archiveDate, setArchiveDate] = useState('')
  return <div className="danetki-entry">
    <header className="danetki-nav">
      <button type="button" onClick={onHome} aria-label="На главную"><ArrowLeft /></button>
      <button type="button" className="danetki-brand" onClick={onHome}>Сходится!</button>
    </header>
    <main className="danetki-entry__main">
      <section className="danetki-entry__hero">
        <div><span><Sparkles /> Новый игровой режим</span><h1>Данетки</h1><p>Раскройте необычную историю, задавая ИИ-ведущей вопросы, на которые можно ответить «да» или «нет».</p></div>
        <div className="danetki-host"><span aria-hidden="true">✦</span><img src={publicAssetUrl('media/danetki/host/host-neutral.webp')} width="720" height="900" decoding="async" fetchPriority="high" alt="ИИ-ведущий Данеток с лупой" /><small>Ведущий на связи</small></div>
      </section>
      <section className="danetki-entry__daily">
        <div className="danetki-entry__label"><CalendarDays /> Данетка дня</div>
        <h2>Начать расследование</h2>
        <p>Играйте самостоятельно или создайте общую комнату для компании до шести человек.</p>
        {onContinue && <button type="button" className="danetki-entry__continue" onClick={onContinue}><Clock3 /> Продолжить незавершённое расследование</button>}
        <div className="danetki-entry__choices">
          <button type="button" onClick={() => onStart('solo')} disabled={busy}><UserRound /><strong>Начать одному</strong><span>Вы и ИИ-ведущая</span></button>
          <button type="button" onClick={() => onStart('group')} disabled={busy}><Users /><strong>Создать комнату</strong><span>Пригласить до 5 друзей</span></button>
        </div>
        <div className="danetki-entry__alternatives">
          <label><span>Архив по дате</span><input type="date" value={archiveDate} max={new Date().toISOString().slice(0, 10)} onChange={(event) => setArchiveDate(event.target.value)} /></label>
          <button type="button" disabled={busy || !archiveDate} onClick={() => onStartArchive?.(archiveDate)}><CalendarDays /> Играть из архива</button>
          <button type="button" disabled={busy} onClick={onStartFreePlay}><Sparkles /> Свободная игра</button>
        </div>
        {busy && <p className="danetki-entry__status"><LoaderCircle /> Готовим расследование…</p>}
        {error && <p className="danetki-entry__inline-error" role="alert">{error}</p>}
      </section>
      <section className="danetki-entry__rules"><HelpCircle /><div><h2>Как играть</h2><p>Читайте условие, проверяйте версии вопросами, используйте три общие подсказки и отправьте полную разгадку, когда восстановите причинно-следственную связь.</p></div></section>
    </main>
  </div>
}

export function DanetkiJoinPage({ token, onHome, onJoined }: {
  token: string
  onHome: () => void
  onJoined: (session: GameSessionSnapshot) => void
}) {
  const [displayName, setDisplayName] = useState('')
  const preview = useQuery({ queryKey: ['danetki', 'invite', token], queryFn: () => api.danetkiInvitePreview(token), retry: false })
  const join = useMutation({
    mutationFn: async () => {
      await ensureServerSession()
      return api.danetkiJoin(token, displayName.trim(), crypto.randomUUID())
    },
    onSuccess: ({ session }) => onJoined(session),
  })
  const submit = (event: FormEvent) => {
    event.preventDefault()
    if (!displayName.trim() || join.isPending) return
    join.mutate()
  }
  const error = preview.error ?? join.error

  return <div className="danetki-entry">
    <header className="danetki-nav"><button type="button" onClick={onHome} aria-label="На главную"><ArrowLeft /></button><button type="button" className="danetki-brand" onClick={onHome}>Сходится!</button></header>
    <main className="danetki-join">
      {preview.isLoading && <section><LoaderCircle className="danetki-spinner" /><h1>Проверяем приглашение…</h1></section>}
      {error && <section className="is-error"><HelpCircle /><h1>Не получилось войти в комнату</h1><p>{messageFor(error)}</p><button type="button" onClick={onHome}>На главную</button></section>}
      {preview.data && !join.isSuccess && <section>
        <Sparkles /><span>Приглашение в расследование</span><h1>{preview.data.title}</h1>
        <p>Вас приглашает <strong>{preview.data.ownerName}</strong>. В комнате {preview.data.participants} из {preview.data.capacity} участников.</p>
        <form onSubmit={submit}><label>Как вас показывать другим игрокам<input value={displayName} onChange={(event) => setDisplayName(event.target.value)} minLength={1} maxLength={40} autoFocus placeholder="Ваше имя" /></label><button type="submit" disabled={join.isPending || !displayName.trim()}>{join.isPending ? <><LoaderCircle /> Входим…</> : <><Users /> Присоединиться</>}</button></form>
      </section>}
    </main>
  </div>
}

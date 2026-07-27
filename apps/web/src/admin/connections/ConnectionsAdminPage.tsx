import { useMemo, useRef, useState } from 'react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import {
  BadgeCheck,
  CalendarDays,
  CircleAlert,
  Download,
  FileJson,
  Grid2X2,
  LoaderCircle,
  RefreshCw,
  Upload,
} from 'lucide-react'
import {
  adminApi,
  type ConnectionsImportPreview,
  type ConnectionsRoundAdminItem,
} from '../api'
import './ConnectionsAdminPage.css'

const today = () => new Intl.DateTimeFormat('en-CA', {
  timeZone: 'Europe/Moscow',
  year: 'numeric',
  month: '2-digit',
  day: '2-digit',
}).format(new Date())

const addDays = (date: string, days: number) => {
  const value = new Date(`${date}T12:00:00Z`)
  value.setUTCDate(value.getUTCDate() + days)
  return value.toISOString().slice(0, 10)
}

const errorText = (error: unknown) => error instanceof Error ? error.message : 'Не удалось выполнить действие'

export function ConnectionsAdminPage({
  notify,
  onEdit,
}: {
  notify: (tone: 'success' | 'error' | 'info', text: string) => void
  onEdit: (itemId: string) => void
}) {
  const client = useQueryClient()
  const input = useRef<HTMLInputElement>(null)
  const [document, setDocument] = useState<Record<string, unknown> | null>(null)
  const [fileName, setFileName] = useState('')
  const [preview, setPreview] = useState<ConnectionsImportPreview | null>(null)
  const [startDate, setStartDate] = useState(today)
  const [selected, setSelected] = useState<Set<string>>(new Set())
  const rangeEnd = addDays(today(), 60)
  const rounds = useQuery({ queryKey: ['admin', 'connections', 'rounds'], queryFn: adminApi.connectionsRounds })
  const schedule = useQuery({
    queryKey: ['admin', 'connections', 'schedule', rangeEnd],
    queryFn: () => adminApi.connectionsSchedule(today(), rangeEnd),
  })
  const analytics = useQuery({ queryKey: ['admin', 'connections', 'analytics'], queryFn: adminApi.connectionsAnalytics })
  const scheduledVersions = useMemo(
    () => new Set((schedule.data?.items ?? []).filter((item) => !item.cancelledAt).map((item) => item.itemVersionId)),
    [schedule.data],
  )
  const readyRounds = useMemo(
    () => (rounds.data?.items ?? []).filter((round) => (
      round.allowedInGame
      && round.contentStatus === 'ready'
      && !round.issues.some((issue) => issue.severity === 'error')
      && !scheduledVersions.has(round.itemVersionId)
    )),
    [rounds.data, scheduledVersions],
  )

  const previewImport = useMutation({
    mutationFn: (value: Record<string, unknown>) => adminApi.connectionsImportPreview(value),
    onSuccess: (value) => {
      setPreview(value)
      notify(value.summary.invalid ? 'error' : 'success', value.summary.invalid
        ? `В файле ${value.summary.invalid} раундов с ошибками`
        : `Проверено раундов: ${value.summary.valid}`)
    },
    onError: (error) => notify('error', errorText(error)),
  })
  const applyImport = useMutation({
    mutationFn: () => adminApi.connectionsImportApply(document!, `Импорт ${fileName || 'connections JSON'}`),
    onSuccess: async (value) => {
      notify('success', `В рабочую версию добавлено: ${value.summary.staged}`)
      await Promise.all([
        client.invalidateQueries({ queryKey: ['admin', 'connections'] }),
        client.invalidateQueries({ queryKey: ['admin', 'content'] }),
      ])
    },
    onError: (error) => notify('error', errorText(error)),
  })
  const bulkSchedule = useMutation({
    mutationFn: () => adminApi.connectionsScheduleBulk(
      startDate,
      readyRounds.filter((round) => selected.has(round.itemVersionId)).map((round) => round.itemVersionId),
      'Массовое расписание раундов «Связей»',
    ),
    onSuccess: async (value) => {
      setSelected(new Set())
      notify('success', `Поставлено в расписание: ${value.items.length}`)
      await Promise.all([
        client.invalidateQueries({ queryKey: ['admin', 'connections', 'schedule'] }),
        client.invalidateQueries({ queryKey: ['admin', 'connections', 'analytics'] }),
      ])
    },
    onError: (error) => notify('error', errorText(error)),
  })

  const loadFile = async (file?: File) => {
    if (!file) return
    try {
      const value = JSON.parse(await file.text()) as Record<string, unknown>
      setDocument(value)
      setFileName(file.name)
      setPreview(null)
      previewImport.mutate(value)
    } catch {
      notify('error', 'Файл не является корректным JSON')
    }
  }
  const toggle = (id: string) => setSelected((current) => {
    const next = new Set(current)
    next.has(id) ? next.delete(id) : next.add(id)
    return next
  })
  const selectAllReady = () => setSelected(new Set(readyRounds.map((round) => round.itemVersionId)))
  const exportRounds = () => {
    const value = {
      version: 1,
      locale: 'ru',
      rounds: (rounds.data?.items ?? []).map((round) => ({
        id: String(round.payload.externalId ?? round.itemId.replace(/^connections:/, '')),
        difficulty: round.payload.difficulty,
        tiles: round.payload.tiles,
        groups: round.payload.groups,
        ...(round.payload.editorial ? { editorial: round.payload.editorial } : {}),
      })),
    }
    const url = URL.createObjectURL(new Blob([JSON.stringify(value, null, 2)], { type: 'application/json;charset=utf-8' }))
    const link = globalThis.document.createElement('a')
    link.href = url
    link.download = `connections-ru-${today()}.json`
    link.click()
    URL.revokeObjectURL(url)
    notify('success', `Экспортировано раундов: ${value.rounds.length}`)
  }

  return <div className="connections-admin">
    <header className="connections-admin__head">
      <div>
        <span>Ежедневная игра · hosted</span>
        <h1><Grid2X2 /> Связи</h1>
        <p>Импортируйте раунды, проверьте четыре группы и управляйте immutable-расписанием.</p>
      </div>
      <div className="connections-admin__head-actions">
        <button className="admin-btn admin-btn--secondary" disabled={!rounds.data?.items.length} onClick={exportRounds}><Download /> Экспорт JSON</button>
        <button className="admin-btn admin-btn--secondary" onClick={() => {
          void rounds.refetch()
          void schedule.refetch()
          void analytics.refetch()
        }}><RefreshCw /> Обновить</button>
      </div>
    </header>

    <section className="connections-admin__metrics" aria-label="Сводка режима">
      <article><small>Раундов active</small><strong>{rounds.data?.items.length ?? '—'}</strong><span>готовый контент</span></article>
      <article><small>Расписано вперёд</small><strong>{analytics.data?.scheduledAhead ?? '—'}</strong><span>дней, включая сегодня</span></article>
      <article><small>Сыграно</small><strong>{analytics.data?.played ?? '—'}</strong><span>сеансов</span></article>
      <article><small>Средние ошибки</small><strong>{analytics.data ? analytics.data.averageMistakes.toFixed(1) : '—'}</strong><span>на сеанс</span></article>
      <article><small>Подсказки</small><strong>{analytics.data ? analytics.data.averageHints.toFixed(1) : '—'}</strong><span>на сеанс</span></article>
      <article><small>Открытые репорты</small><strong>{analytics.data?.openReports ?? '—'}</strong><span>нужна проверка</span></article>
    </section>

    <div className="connections-admin__columns">
      <section className="admin-panel connections-admin__import">
        <header><div><span>Шаг 1</span><h2>Импорт базы</h2></div><FileJson /></header>
        <button className="connections-admin__drop" onClick={() => input.current?.click()}>
          {previewImport.isPending ? <LoaderCircle className="is-spinning" /> : <Upload />}
          <strong>{fileName || 'Выбрать connections JSON'}</strong>
          <small>Формат version 1 · исходный файл преобразуется автоматически</small>
        </button>
        <input ref={input} type="file" accept="application/json,.json" hidden onChange={(event) => {
          void loadFile(event.currentTarget.files?.[0])
          event.currentTarget.value = ''
        }} />
        {preview && <div className="connections-admin__preview">
          <div className={preview.summary.invalid ? 'is-error' : 'is-valid'}>
            {preview.summary.invalid ? <CircleAlert /> : <BadgeCheck />}
            <span><strong>{preview.summary.valid}/{preview.summary.total} готовы</strong><small>{preview.summary.warnings} предупреждений · {preview.summary.invalid} ошибок</small></span>
          </div>
          <div>{preview.items.map((item) => <article key={item.id}>
            <span className={item.valid ? 'is-valid' : 'is-error'}>{item.valid ? <BadgeCheck /> : <CircleAlert />}</span>
            <div><strong>{item.title}</strong><small>{item.id}</small>{item.issues.length > 0 && <p>{item.issues.map((issue) => issue.message).join(' · ')}</p>}</div>
          </article>)}</div>
          <button className="admin-btn admin-btn--primary" disabled={preview.summary.invalid > 0 || applyImport.isPending} onClick={() => applyImport.mutate()}>
            {applyImport.isPending ? <LoaderCircle /> : <Upload />} В рабочую версию
          </button>
        </div>}
      </section>

      <section className="admin-panel connections-admin__schedule">
        <header><div><span>Шаг 2</span><h2>Массовое расписание</h2></div><CalendarDays /></header>
        <label><span>Дата начала</span><input type="date" min={today()} value={startDate} onChange={(event) => setStartDate(event.target.value)} /></label>
        <div className="connections-admin__ready-head">
          <span>Нерасписанные ready-раунды: <strong>{readyRounds.length}</strong></span>
          <button onClick={selectAllReady}>Выбрать все</button>
        </div>
        <div className="connections-admin__ready">
          {readyRounds.length ? readyRounds.map((round, index) => <label key={round.itemVersionId}>
            <input type="checkbox" checked={selected.has(round.itemVersionId)} onChange={() => toggle(round.itemVersionId)} />
            <span><strong>{round.titleRu}</strong><small>{addDays(startDate, index)} · {String(round.payload.difficulty ?? '—')}</small></span>
          </label>) : <p>Все готовые раунды уже стоят в расписании.</p>}
        </div>
        <button className="admin-btn admin-btn--primary" disabled={!selected.size || bulkSchedule.isPending} onClick={() => bulkSchedule.mutate()}>
          {bulkSchedule.isPending ? <LoaderCircle /> : <CalendarDays />} Поставить подряд ({selected.size})
        </button>
      </section>
    </div>

    <section className="admin-panel connections-admin__calendar">
      <header><div><span>Следующие 60 дней · ближайший пропуск {analytics.data?.nearestGap ?? '—'}</span><h2>Расписание</h2></div><CalendarDays /></header>
      <div>{schedule.data?.items.length ? schedule.data.items.map((item) => <article key={item.puzzleDate} className={item.cancelledAt ? 'is-cancelled' : ''}>
        <time>{new Intl.DateTimeFormat('ru-RU', { day: '2-digit', month: 'short', weekday: 'short' }).format(new Date(`${item.puzzleDate}T12:00:00Z`))}</time>
        <span><strong>{item.titleRu}</strong><small>{item.itemId}</small></span>
        <b>{item.cancelledAt ? 'Отменён' : item.puzzleDate === today() ? 'Сегодня' : 'Запланирован'}</b>
      </article>) : <p>На ближайшие 60 дней раунды не запланированы.</p>}</div>
    </section>

    <section className="admin-panel connections-admin__rounds">
      <header><div><span>Active revision</span><h2>Раунды и валидация</h2></div><Grid2X2 /></header>
      <div>{(rounds.data?.items ?? []).map((round: ConnectionsRoundAdminItem) => {
        const errors = round.issues.filter((issue) => issue.severity === 'error')
        const warnings = round.issues.filter((issue) => issue.severity === 'warning')
        return <button key={round.itemId} onClick={() => onEdit(round.itemId)}>
          <span className={errors.length ? 'is-error' : 'is-valid'}>{errors.length ? <CircleAlert /> : <BadgeCheck />}</span>
          <span><strong>{round.titleRu}</strong><small>{round.itemId} · {String(round.payload.difficulty ?? '—')}</small>{warnings.length > 0 && <p>{warnings.map((issue) => issue.message).join(' · ')}</p>}</span>
          <b>{errors.length ? `${errors.length} ошибок` : round.contentStatus}</b>
        </button>
      })}</div>
    </section>
  </div>
}

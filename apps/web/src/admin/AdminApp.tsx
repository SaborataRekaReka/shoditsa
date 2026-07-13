import { useEffect, useMemo, useRef, useState, type ReactNode } from 'react'
import { useInfiniteQuery, useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import {
  Activity, AlertTriangle, Archive, ArrowLeft, BadgeCheck, Bot, Boxes, BriefcaseBusiness, Bug,
  Check, ChevronDown, ChevronRight, CircleDollarSign, CircleGauge, Clapperboard, Clock3, Copy, Database, Eye,
  Download, FileClock, FileJson, Filter, HeartPulse, History, Image as ImageIcon, KeyRound, LayoutDashboard, ListChecks,
  LoaderCircle, LockKeyhole, Menu, MoreHorizontal, PanelRightClose, Play, Plus, RefreshCw, Rocket, Upload,
  Save, Search, Settings2, ShieldCheck, Sparkles, SquarePen, Tags, Ticket, Trash2, UserRound,
  UsersRound, WandSparkles, X,
} from 'lucide-react'
import type { AdminContentListItem, AdminTimelineEvent, ContentMode } from '@shoditsa/contracts'
import { AdminApiError, adminApi, type AdminItemDetail } from './api'
import './admin.css'

type Section = 'dashboard' | 'content' | 'reports' | 'pipelines' | 'users' | 'events' | 'quality' | 'economy' | 'integrations' | 'system' | 'audit'
type Notice = { id: string; tone: 'success' | 'error' | 'info'; text: string }

const MODES: Array<{ value: ContentMode; label: string }> = [
  { value: 'movie', label: 'Кино' }, { value: 'series', label: 'Сериалы' }, { value: 'anime', label: 'Аниме' },
  { value: 'game', label: 'Игры' }, { value: 'music', label: 'Музыка' }, { value: 'diagnosis', label: 'Диагнозы' },
]
const MODE_LABEL = Object.fromEntries(MODES.map((mode) => [mode.value, mode.label])) as Record<ContentMode, string>
const REPORT_REASON: Record<string, string> = {
  wrong_fact: 'Неверный факт', disputed_comparison: 'Спорное сравнение', title_not_found: 'Не принимается ответ', bad_hint: 'Плохая подсказка',
  bad_image: 'Плохое изображение', duplicate_card: 'Дубликат', typo_or_translation: 'Опечатка / перевод', technical_error: 'Техническая ошибка', other: 'Другое',
}
const STATUS_LABEL: Record<string, string> = {
  open: 'Новый', in_progress: 'В работе', resolved: 'Исправлен', dismissed: 'Отклонён', duplicate: 'Дубликат',
  queued: 'В очереди', running: 'Выполняется', completed: 'Готово', failed: 'Ошибка', review_required: 'Нужна проверка',
  partially_failed: 'Частично с ошибками', approved: 'Одобрено', staged: 'В рабочей версии', published: 'Опубликовано', cancelled: 'Отменено',
  create: 'Добавить', update: 'Изменить', unchanged: 'Без изменений', conflict: 'Конфликт', invalid: 'Ошибка',
}

const formatDate = (value: unknown) => value ? new Intl.DateTimeFormat('ru-RU', {
  timeZone: 'Asia/Almaty', day: '2-digit', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit',
}).format(new Date(String(value))) : '—'
const compactDate = (value: unknown) => value ? new Intl.DateTimeFormat('ru-RU', { timeZone: 'Asia/Almaty', day: '2-digit', month: 'short', hour: '2-digit', minute: '2-digit' }).format(new Date(String(value))) : '—'
const record = (value: unknown): Record<string, any> => value && typeof value === 'object' && !Array.isArray(value) ? value as Record<string, any> : {}
const array = (value: unknown) => Array.isArray(value) ? value : []
const title = (value: unknown) => String(value ?? '').trim() || 'Без названия'
const pipelineWarnings = (value: unknown) => {
  const labels: string[] = []; const providers = new Set<string>()
  for (const raw of array(value).map(String)) {
    const provider = raw.startsWith('musicbrainz_') ? 'MusicBrainz' : raw.startsWith('lastfm_') ? 'Last.fm'
      : raw.startsWith('theaudiodb_') ? 'TheAudioDB' : raw.startsWith('spotify_') || raw.includes('Country, region, or territory') ? 'Spotify' : null
    if (provider) { if (!providers.has(provider)) labels.push(`${provider} временно недоступен — использованы резервные источники`); providers.add(provider); continue }
    labels.push(raw === 'conflict_canonical_name' ? 'Найдены разные варианты имени — проверьте основное название'
      : raw === 'conflict_country' ? 'Источники расходятся по стране'
        : raw === 'conflict_begin_year' ? 'Источники расходятся по году начала карьеры' : raw)
  }
  return [...new Set(labels)]
}
const errorText = (error: unknown) => error instanceof AdminApiError ? `${error.message}${error.code ? ` · ${error.code}` : ''}` : error instanceof Error ? error.message : 'Неизвестная ошибка'
const statusTone = (status: unknown) => ['failed', 'critical', 'blocked', 'dismissed', 'conflict', 'invalid'].includes(String(status)) ? 'danger'
  : ['running', 'in_progress', 'warning', 'partially_failed'].includes(String(status)) ? 'warning'
    : ['completed', 'published', 'resolved', 'active', 'ready'].includes(String(status)) ? 'success' : 'neutral'

const sectionFromPath = (): { section: Section; id: string | null } => {
  const parts = window.location.pathname.replace(/^\/admin\/?/, '').split('/').filter(Boolean)
  const candidate = (parts[0] || 'dashboard') as Section
  const allowed: Section[] = ['dashboard', 'content', 'reports', 'pipelines', 'users', 'events', 'quality', 'economy', 'integrations', 'system', 'audit']
  return { section: allowed.includes(candidate) ? candidate : 'dashboard', id: parts[1] ? decodeURIComponent(parts.slice(1).join('/')) : null }
}

function useRoute() {
  const [route, setRoute] = useState(sectionFromPath)
  useEffect(() => { const onPop = () => setRoute(sectionFromPath()); addEventListener('popstate', onPop); return () => removeEventListener('popstate', onPop) }, [])
  const navigate = (section: Section, id?: string | null) => {
    const url = `/admin/${section}${id ? `/${encodeURIComponent(id)}` : ''}`
    history.pushState({}, '', url); setRoute({ section, id: id ?? null }); scrollTo({ top: 0 })
  }
  return { ...route, navigate }
}

function Status({ value, children }: { value: unknown; children?: ReactNode }) {
  return <span className={`admin-status admin-status--${statusTone(value)}`}><i />{children ?? STATUS_LABEL[String(value)] ?? String(value ?? '—')}</span>
}

function Empty({ icon, title: heading, text, action }: { icon?: ReactNode; title: string; text: string; action?: ReactNode }) {
  return <div className="admin-empty">{icon ?? <Boxes />}<h3>{heading}</h3><p>{text}</p>{action}</div>
}

function Loading({ label = 'Загружаем данные…' }: { label?: string }) {
  return <div className="admin-loading"><LoaderCircle />{label}</div>
}

function PageHead({ eyebrow, title: heading, description, actions }: { eyebrow?: string; title: string; description?: string; actions?: ReactNode }) {
  return <div className="admin-page-head"><div>{eyebrow && <span>{eyebrow}</span>}<h1>{heading}</h1>{description && <p>{description}</p>}</div>{actions && <div className="admin-page-actions">{actions}</div>}</div>
}

function ErrorState({ error, retry }: { error: unknown; retry?: () => void }) {
  return <div className="admin-error" role="alert"><AlertTriangle /><div><strong>Не удалось загрузить данные</strong><p>{errorText(error)}</p></div>{retry && <button className="admin-btn admin-btn--secondary" onClick={retry}><RefreshCw />Повторить</button>}</div>
}

function DashboardPage({ navigate }: { navigate: (section: Section, id?: string | null) => void }) {
  const dashboard = useQuery({ queryKey: ['admin', 'dashboard'], queryFn: adminApi.dashboard, refetchInterval: 15_000 })
  if (dashboard.isLoading) return <Loading />
  if (dashboard.error || !dashboard.data) return <ErrorState error={dashboard.error} retry={() => void dashboard.refetch()} />
  const { counters } = dashboard.data
  const cards = [
    ['Новые репорты', counters.newReports, Bug, 'reports'], ['Критические проблемы', counters.criticalIssues, AlertTriangle, 'quality'],
    ['Задачи в работе', counters.activeJobs, Activity, 'system'], ['ИИ ждёт проверки', counters.pipelineReview, Bot, 'pipelines'],
    ['Активны за 24 часа', counters.activeUsers24h, UsersRound, 'users'], ['Сессии за 24 часа', counters.sessionsStarted24h, Play, 'events'],
  ] as const
  return <>
    <PageHead eyebrow="Оперативная сводка" title="Обзор" description="То, что требует внимания прямо сейчас." actions={<button className="admin-btn admin-btn--secondary" onClick={() => void dashboard.refetch()}><RefreshCw />Обновить</button>} />
    <div className="admin-kpis">{cards.map(([label, value, Icon, section]) => <button key={label} onClick={() => navigate(section)}><span><Icon /></span><strong>{value}</strong><small>{label}</small><ChevronRight /></button>)}</div>
    <div className="admin-dashboard-grid">
      <section className="admin-panel admin-attention"><header><div><span>Требует внимания</span><h2>Очередь на сегодня</h2></div><button onClick={() => navigate('reports')}>Вся очередь <ChevronRight /></button></header>
        {dashboard.data.recentReports.length ? <div className="admin-feed">{dashboard.data.recentReports.map((raw) => { const item = record(raw); return <button key={String(item.id)} onClick={() => navigate('reports', String(item.id))}><span className="admin-feed__icon"><Bug /></span><span><strong>{REPORT_REASON[String(item.reason)] ?? title(item.reason)}</strong><small>{title(item.itemId)} · {compactDate(item.createdAt)}</small></span><Status value={item.status} /></button> })}</div> : <Empty title="Очередь пуста" text="Новых сообщений от игроков нет." icon={<BadgeCheck />} />}
      </section>
      <section className="admin-panel"><header><div><span>Контент</span><h2>Рабочая версия</h2></div><button onClick={() => navigate('content')}>Открыть <ChevronRight /></button></header>
        <div className="admin-workspace-card"><div><span>Базовая ревизия</span><strong>{dashboard.data.activeRevision?.version ?? 'Не определена'}</strong></div><div><span>Изменений</span><strong>{dashboard.data.workspace?.changesCount ?? 0}</strong></div><div><span>Ошибок</span><strong>{dashboard.data.workspace?.errorsCount ?? 0}</strong></div><Status value={dashboard.data.workspace?.status} /></div>
        <div className="admin-mode-counts">{dashboard.data.activeRevision?.counts.map((mode) => <div key={mode.mode}><span>{MODE_LABEL[mode.mode]}</span><strong>{mode.count.toLocaleString('ru-RU')}</strong></div>)}</div>
      </section>
      <section className="admin-panel"><header><div><span>Последние изменения</span><h2>Карточки</h2></div></header>
        {dashboard.data.recentChanges.length ? <div className="admin-feed admin-feed--plain">{dashboard.data.recentChanges.map((raw) => { const item = record(raw); return <button key={String(item.id)} onClick={() => navigate('content', String(item.itemId))}><span><strong>{title(item.itemId)}</strong><small>{array(item.changedFields).join(', ') || 'Изменение карточки'} · {compactDate(item.updatedAt)}</small></span><Status value={item.source}>{String(item.source)}</Status></button> })}</div> : <Empty title="Изменений нет" text="Сохранённые правки появятся здесь." />}
      </section>
      <section className="admin-panel"><header><div><span>Автоматизация</span><h2>Последние запуски ИИ</h2></div><button onClick={() => navigate('pipelines')}>Пайплайны <ChevronRight /></button></header>
        {dashboard.data.recentRuns.length ? <div className="admin-feed admin-feed--plain">{dashboard.data.recentRuns.map((raw) => { const item = record(raw); return <button key={String(item.id)} onClick={() => navigate('pipelines', String(item.id))}><span><strong>Музыка · {Number(item.itemsProcessed ?? 0)}/{Number(item.itemsTotal ?? 0)}</strong><small>{compactDate(item.createdAt)}</small></span><Status value={item.status} /></button> })}</div> : <Empty title="Запусков ещё нет" text="Музыкальный пайплайн можно запустить из каталога." icon={<WandSparkles />} />}
      </section>
    </div>
  </>
}

function WorkspaceBar({ notify }: { notify: (tone: Notice['tone'], text: string) => void }) {
  const client = useQueryClient(); const workspace = useQuery({ queryKey: ['admin', 'workspace'], queryFn: adminApi.workspace, refetchInterval: 5_000 })
  const validate = useMutation({ mutationFn: adminApi.validateWorkspace, onSuccess: (data) => { void client.invalidateQueries({ queryKey: ['admin', 'workspace'] }); notify(Number(data.errors ?? 0) ? 'error' : 'success', Number(data.errors ?? 0) ? `Найдено ошибок: ${data.errors}` : `Проверка завершена · предупреждений: ${data.warnings ?? 0}`) }, onError: (error) => notify('error', errorText(error)) })
  const build = useMutation({ mutationFn: adminApi.buildWorkspace, onSuccess: () => { notify('info', 'Сборка поставлена в очередь'); void client.invalidateQueries({ queryKey: ['admin', 'jobs'] }); void client.invalidateQueries({ queryKey: ['admin', 'workspace'] }) }, onError: (error) => notify('error', errorText(error)) })
  const activate = useMutation({ mutationFn: adminApi.activateWorkspace, onSuccess: () => { notify('success', 'Новая ревизия опубликована'); void client.invalidateQueries({ queryKey: ['admin'] }) }, onError: (error) => notify('error', errorText(error)) })
  const data = workspace.data
  return <div className="admin-workspace-bar"><div className="admin-workspace-bar__state"><span>Рабочая версия</span><strong>{data ? `${data.changesCount} изменений` : 'Загрузка…'}</strong>{data && <Status value={data.status} />}<small>{data ? `Ошибок ${data.errorsCount} · предупреждений ${data.warningsCount}` : ''}</small></div><div>
    <button className="admin-btn admin-btn--secondary" onClick={() => validate.mutate()} disabled={validate.isPending || !data}><ListChecks />Проверить</button>
    {data?.status === 'ready' ? <button className="admin-btn admin-btn--primary" onClick={() => activate.mutate()} disabled={activate.isPending}><Rocket />Опубликовать {data.changesCount}</button>
      : <button className="admin-btn admin-btn--primary" onClick={() => build.mutate()} disabled={build.isPending || !data?.changesCount || data.status !== 'open'}><Rocket />Собрать ревизию</button>}
  </div></div>
}

function FieldEditor({ name, value, disabled, onChange }: { name: string; value: unknown; disabled?: boolean; onChange: (value: unknown) => void }) {
  const label = name.replace(/([A-Z])/g, ' $1').replace(/^./, (letter) => letter.toLocaleUpperCase('ru-RU'))
  if (typeof value === 'boolean' || name === 'allowedInGame') return <label className="admin-field admin-field--check"><input type="checkbox" checked={Boolean(value)} disabled={disabled} onChange={(event) => onChange(event.target.checked)} /><span><strong>{label}</strong><small>{value ? 'Включено' : 'Выключено'}</small></span></label>
  if (typeof value === 'number' || ['year', 'endYear', 'runtime', 'episodes', 'seasonsCount', 'popularityScore', 'topRank'].includes(name)) return <label className="admin-field"><span>{label}</span><input type="number" value={value == null ? '' : String(value)} disabled={disabled} onChange={(event) => onChange(event.target.value === '' ? null : Number(event.target.value))} /></label>
  if (Array.isArray(value)) return <label className="admin-field admin-field--wide"><span>{label}<small>{value.length} знач.</small></span><textarea value={value.map((entry) => typeof entry === 'string' ? entry : JSON.stringify(entry)).join('\n')} disabled={disabled} onChange={(event) => onChange(event.target.value.split('\n').map((entry) => entry.trim()).filter(Boolean).map((entry) => { try { return JSON.parse(entry) } catch { return entry } }))} /></label>
  if (value && typeof value === 'object') return <label className="admin-field admin-field--wide"><span>{label}<small>JSON</small></span><textarea className="admin-code-input" value={JSON.stringify(value, null, 2)} disabled={disabled} onChange={(event) => { try { onChange(JSON.parse(event.target.value)) } catch { /* keep last valid object */ } }} /></label>
  const multiline = ['description', 'plotHint', 'slogan', 'notes', 'facts', 'safetyDisclaimer'].some((part) => name.toLocaleLowerCase().includes(part.toLocaleLowerCase()))
  return <label className={`admin-field ${multiline ? 'admin-field--wide' : ''}`}><span>{label}{typeof value === 'string' && <small>{value.length}</small>}</span>{multiline
    ? <textarea value={String(value ?? '')} disabled={disabled} onChange={(event) => onChange(event.target.value)} />
    : <input value={String(value ?? '')} disabled={disabled} onChange={(event) => onChange(event.target.value)} />}</label>
}

function PreviewCard({ payload, mode }: { payload: Record<string, unknown>; mode: ContentMode }) {
  const poster = typeof payload.posterUrl === 'string' ? payload.posterUrl : typeof payload.headerUrl === 'string' ? payload.headerUrl : null
  const hint = String(payload.plotHint ?? payload.description ?? 'Подсказка пока не заполнена')
  return <div className="admin-preview"><div className="admin-preview__toolbar"><button className="is-active">Desktop</button><button>Mobile</button><span>{MODE_LABEL[mode]}</span></div><div className="admin-preview__stage"><article><div className="admin-preview__media">{poster ? <img src={poster} alt="" /> : <ImageIcon />}</div><span>Попытка 1 из 10</span><h3>{hint}</h3><div className="admin-preview__hints"><button>Подсказка о сюжете</button><button>Интересный факт</button></div><div className="admin-preview__answer"><Search /><span>Введите вариант ответа</span></div></article></div><footer><strong>Допустимые ответы</strong><p>{[payload.titleRu, payload.titleOriginal, ...array(payload.alternativeTitles)].filter(Boolean).join(' · ') || 'Не заданы'}</p></footer></div>
}

function MediaUpload({ itemId, field, onUploaded, notify }: { itemId: string; field: string; onUploaded: (url: string) => void; notify: (tone: Notice['tone'], text: string) => void }) {
  const input = useRef<HTMLInputElement>(null)
  const purpose = field === 'screenshots' ? 'screenshot' : field as 'posterUrl' | 'headerUrl' | 'backdropUrl'
  const upload = useMutation({
    mutationFn: async (file: File) => {
      if (!['image/jpeg', 'image/png', 'image/webp'].includes(file.type)) throw new AdminApiError(422, 'MEDIA_FORMAT_UNSUPPORTED', 'Допустимы JPEG, PNG и WebP')
      if (file.size > 5 * 1024 * 1024) throw new AdminApiError(413, 'MEDIA_TOO_LARGE', 'Размер изображения не должен превышать 5 МБ')
      return adminApi.uploadMedia(itemId, file, purpose)
    },
    onSuccess: (result) => { onUploaded(result.url); notify('success', `Изображение загружено: ${result.width}×${result.height}`) },
    onError: (error) => notify('error', errorText(error)),
  })
  const choose = (files: FileList | null) => { const file = files?.[0]; if (file) upload.mutate(file) }
  return <div className={`admin-media-upload${upload.isPending ? ' is-loading' : ''}`} onDragOver={(event) => event.preventDefault()} onDrop={(event) => { event.preventDefault(); choose(event.dataTransfer.files) }}>
    <input ref={input} type="file" accept="image/jpeg,image/png,image/webp" onChange={(event) => choose(event.target.files)} />
    <button type="button" onClick={() => input.current?.click()} disabled={upload.isPending}>{upload.isPending ? <LoaderCircle /> : <ImageIcon />}{upload.isPending ? 'Загрузка…' : 'Выбрать или перетащить изображение'}</button>
    <small>JPEG, PNG или WebP · до 5 МБ · от 320×180</small>
  </div>
}

function ItemEditor({ itemId, onClose, notify }: { itemId: string; onClose: () => void; notify: (tone: Notice['tone'], text: string) => void }) {
  const client = useQueryClient(); const detail = useQuery({ queryKey: ['admin', 'item', itemId], queryFn: () => adminApi.contentItem(itemId) })
  const [tab, setTab] = useState<'data' | 'preview' | 'reports' | 'history' | 'technical'>('data')
  const [payload, setPayload] = useState<Record<string, unknown>>({}); const [original, setOriginal] = useState(''); const [advanced, setAdvanced] = useState(false); const [restored, setRestored] = useState(false)
  const historyQuery = useQuery({ queryKey: ['admin', 'history', itemId], queryFn: () => adminApi.contentHistory(itemId), enabled: tab === 'history' })
  const storageKey = `shoditsa:admin:draft:${itemId}`
  useEffect(() => {
    if (!detail.data) return
    const server = detail.data.draft?.afterPayload ?? detail.data.active?.payload ?? {}
    const serverJson = JSON.stringify(server)
    let next = server
    try { const local = JSON.parse(localStorage.getItem(storageKey) || 'null') as { server: string; payload: Record<string, unknown> } | null; if (local?.server === serverJson) { next = local.payload; setRestored(JSON.stringify(next) !== serverJson) } } catch { /* ignored */ }
    setPayload(next); setOriginal(serverJson)
  }, [detail.data, storageKey])
  const dirty = Boolean(original) && JSON.stringify(payload) !== original
  useEffect(() => { if (dirty) localStorage.setItem(storageKey, JSON.stringify({ server: original, payload })); else localStorage.removeItem(storageKey) }, [dirty, original, payload, storageKey])
  const save = useMutation({
    mutationFn: () => adminApi.saveItem(itemId, { mode: detail.data!.active?.mode ?? detail.data!.draft!.mode, payload, expectedVersion: detail.data!.draft?.version ?? 0, source: 'manual' }),
    onSuccess: () => { localStorage.removeItem(storageKey); notify('success', 'Карточка сохранена в рабочую версию'); void client.invalidateQueries({ queryKey: ['admin', 'item', itemId] }); void client.invalidateQueries({ queryKey: ['admin', 'content'] }); void client.invalidateQueries({ queryKey: ['admin', 'workspace'] }) },
    onError: (error) => notify('error', errorText(error)),
  })
  const discard = useMutation({ mutationFn: () => adminApi.discardItem(itemId), onSuccess: () => { localStorage.removeItem(storageKey); notify('success', 'Правка отменена'); void client.invalidateQueries({ queryKey: ['admin', 'item', itemId] }); void client.invalidateQueries({ queryKey: ['admin', 'workspace'] }) }, onError: (error) => notify('error', errorText(error)) })
  useEffect(() => {
    const onKey = (event: KeyboardEvent) => { if ((event.ctrlKey || event.metaKey) && event.key.toLocaleLowerCase() === 's') { event.preventDefault(); if (dirty && !save.isPending) save.mutate() } }
    addEventListener('keydown', onKey); return () => removeEventListener('keydown', onKey)
  }, [dirty, save])
  const close = () => { if (!dirty || confirm('Закрыть карточку? Несохранённый текст останется в этом браузере.')) onClose() }
  if (detail.isLoading) return <aside className="admin-drawer"><Loading /></aside>
  if (detail.error || !detail.data) return <aside className="admin-drawer"><div className="admin-drawer__head"><button onClick={close}><X /></button></div><ErrorState error={detail.error} retry={() => void detail.refetch()} /></aside>
  const data = detail.data; const mode = data.active?.mode ?? data.draft!.mode
  const fields = data.schema.groups.flatMap((group) => group.fields); const known = new Set(fields)
  return <aside className="admin-drawer" aria-label={`Карточка ${itemId}`}>
    <header className="admin-drawer__head"><div><span>{MODE_LABEL[mode]}</span><h2>{title(payload.titleRu || itemId)}</h2><small>{itemId} · {data.active?.revisionId ? `версия ${String(data.active.revisionId).slice(0, 8)}` : 'новая карточка'}</small></div><div>{dirty && <Status value="warning">Не сохранено</Status>}<button onClick={close} aria-label="Закрыть"><PanelRightClose /></button></div></header>
    {restored && <div className="admin-recovered"><FileClock />Восстановлен несохранённый текст из этого браузера.</div>}
    <nav className="admin-tabs">{([['data', 'Данные'], ['preview', 'Как в игре'], ['reports', `Баг-репорты ${data.reports.length || ''}`], ['history', 'История'], ['technical', 'Техническое']] as const).map(([key, label]) => <button key={key} className={tab === key ? 'is-active' : ''} onClick={() => setTab(key)}>{label}</button>)}</nav>
    <div className="admin-drawer__body">
      {tab === 'data' && <>{data.schema.groups.map((group) => <section className="admin-form-section" key={group.key}><header><h3>{group.title}</h3><span>{group.fields.filter((field) => payload[field] != null && payload[field] !== '').length}/{group.fields.length}</span></header><div className="admin-form-grid">{group.fields.map((field) => {
        if (!['posterUrl', 'headerUrl', 'backdropUrl', 'screenshots'].includes(field)) return <FieldEditor key={field} name={field} value={payload[field]} disabled={field === 'id' || field === 'mode'} onChange={(value) => setPayload((current) => ({ ...current, [field]: value }))} />
        return <div className="admin-media-field" key={field}><FieldEditor name={field} value={payload[field]} onChange={(value) => setPayload((current) => ({ ...current, [field]: value }))} /><MediaUpload itemId={itemId} field={field} notify={notify} onUploaded={(url) => setPayload((current) => field === 'screenshots' ? { ...current, screenshots: [...array(current.screenshots), url] } : { ...current, [field]: url })} /></div>
      })}</div></section>)}
        {[...Object.keys(payload).filter((field) => !known.has(field))].length > 0 && <details className="admin-extra-fields"><summary>Остальные поля payload <ChevronDown /></summary><div className="admin-form-grid">{Object.keys(payload).filter((field) => !known.has(field)).map((field) => <FieldEditor key={field} name={field} value={payload[field]} onChange={(value) => setPayload((current) => ({ ...current, [field]: value }))} />)}</div></details>}</>}
      {tab === 'preview' && <PreviewCard payload={payload} mode={mode} />}
      {tab === 'reports' && <div className="admin-related-list">{data.reports.length ? data.reports.map((raw) => { const report = record(raw); return <article key={String(report.id)}><header><Status value={report.status} /><time>{formatDate(report.createdAt)}</time></header><strong>{REPORT_REASON[String(report.reason)] ?? title(report.reason)}</strong><p>{title(report.comment || 'Комментарий не добавлен')}</p></article> }) : <Empty title="Репортов нет" text="По этой карточке игроки пока ничего не сообщали." icon={<BadgeCheck />} />}</div>}
      {tab === 'history' && (historyQuery.isLoading ? <Loading /> : <div className="admin-history">{historyQuery.data?.versions.map((raw) => { const version = record(raw); const versionPayload = record(version.payload); return <article key={String(version.id)}><span><History /></span><div><header><strong>{title(version.revisionVersion)}</strong><Status value={version.revisionStatus} /><time>{formatDate(version.createdAt)}</time></header><p>{title(versionPayload.titleRu)} · {Object.keys(versionPayload).length} полей</p><button className="admin-link" onClick={() => { setPayload(versionPayload); setTab('data') }}>Взять это значение в рабочую версию</button></div></article> })}</div>)}
      {tab === 'technical' && <div className="admin-technical"><div className="admin-technical__actions"><button className="admin-btn admin-btn--secondary" onClick={() => void navigator.clipboard.writeText(JSON.stringify(payload, null, 2))}><Copy />Копировать JSON</button><button className="admin-btn admin-btn--secondary" onClick={() => { if (!advanced && !confirm('Расширенное редактирование позволяет изменить технические поля. Продолжить?')) return; setAdvanced((value) => !value) }}><SquarePen />{advanced ? 'Закрыть редактирование' : 'Расширенное редактирование'}</button></div><textarea readOnly={!advanced} value={JSON.stringify(payload, null, 2)} onChange={(event) => { try { setPayload(JSON.parse(event.target.value)) } catch { /* keep valid JSON */ } }} /></div>}
    </div>
    <footer className="admin-drawer__footer"><div>{data.issues.length ? <span className="admin-inline-warning"><AlertTriangle />Проблем качества: {data.issues.length}</span> : <span className="admin-inline-ok"><Check />Критических проблем нет</span>}</div><button className="admin-btn admin-btn--ghost" onClick={() => discard.mutate()} disabled={!data.draft || discard.isPending}><Trash2 />Отменить правку</button><button className="admin-btn admin-btn--primary" onClick={() => save.mutate()} disabled={!dirty || save.isPending}>{save.isPending ? <LoaderCircle /> : <Save />}Сохранить <kbd>Ctrl S</kbd></button></footer>
  </aside>
}

function NewCardDialog({ close, done, notify }: { close: () => void; done: (id: string) => void; notify: (tone: Notice['tone'], text: string) => void }) {
  const [mode, setMode] = useState<ContentMode>('movie'); const [id, setId] = useState(''); const [titleRu, setTitleRu] = useState('')
  const save = useMutation({ mutationFn: () => adminApi.saveItem(id.trim(), { mode, expectedVersion: 0, source: 'manual', reason: 'Новая карточка', payload: { id: id.trim(), mode, titleRu: titleRu.trim(), titleOriginal: '', alternativeTitles: [], allowedInGame: true, plotHint: '', ...(mode === 'music' ? { aliases: [], gameTier: 'popular' } : {}), ...(mode === 'diagnosis' ? { icd10: [], icdGroup: 'pending' } : {}) } }), onSuccess: () => { notify('success', 'Новая карточка добавлена в рабочую версию'); done(id.trim()) }, onError: (error) => notify('error', errorText(error)) })
  return <div className="admin-modal-backdrop" onMouseDown={(event) => event.target === event.currentTarget && close()}><div className="admin-modal"><header><div><span>Новая identity</span><h2>Добавить карточку</h2></div><button onClick={close}><X /></button></header><div className="admin-modal__body"><label className="admin-field"><span>Категория</span><select value={mode} onChange={(event) => setMode(event.target.value as ContentMode)}>{MODES.map((entry) => <option key={entry.value} value={entry.value}>{entry.label}</option>)}</select></label><label className="admin-field"><span>Внутренний ID</span><input value={id} onChange={(event) => setId(event.target.value)} placeholder={`${mode}:...`} /><small>После первого сохранения ID и категория не меняются.</small></label><label className="admin-field"><span>Основное название</span><input value={titleRu} onChange={(event) => setTitleRu(event.target.value)} autoFocus /></label></div><footer><button className="admin-btn admin-btn--secondary" onClick={close}>Отмена</button><button className="admin-btn admin-btn--primary" disabled={!id.trim() || !titleRu.trim() || save.isPending} onClick={() => save.mutate()}><Plus />Добавить в рабочую версию</button></footer></div></div>
}

const exchangeItemKey = (mode: ContentMode, id: string) => JSON.stringify([mode, id])

const downloadJson = (document: Record<string, unknown>) => {
  const blob = new Blob([`${JSON.stringify(document, null, 2)}\n`], { type: 'application/json;charset=utf-8' })
  const url = URL.createObjectURL(blob); const anchor = window.document.createElement('a')
  anchor.href = url; anchor.download = `shoditsa-content-${new Date().toISOString().slice(0, 10)}-${String(document.exportId ?? 'export').slice(0, 8)}.json`
  anchor.click(); URL.revokeObjectURL(url)
}

function ContentExchangeDialog({ initialTab, itemIds, close, notify, done }: { initialTab: 'export' | 'import'; itemIds: string[]; close: () => void; notify: (tone: Notice['tone'], text: string) => void; done: () => void }) {
  const [tab, setTab] = useState<'export' | 'import'>(initialTab)
  const [fields, setFields] = useState<Set<string>>(new Set()); const fieldsInitialized = useRef(false)
  const [document, setDocument] = useState<Record<string, unknown> | null>(null); const [fileName, setFileName] = useState('')
  const [parseError, setParseError] = useState(''); const [importItems, setImportItems] = useState<Set<string>>(new Set()); const [reason, setReason] = useState('Импорт карточек из JSON')
  const selection = useQuery({ queryKey: ['admin', 'content-exchange-selection', itemIds], queryFn: () => adminApi.contentExchangeSelection(itemIds), enabled: tab === 'export' && itemIds.length > 0 })
  useEffect(() => {
    if (!fieldsInitialized.current && selection.data) { setFields(new Set(selection.data.fields.map((entry) => entry.field))); fieldsInitialized.current = true }
  }, [selection.data])
  const exportMutation = useMutation({
    mutationFn: () => adminApi.exportContentExchange(itemIds, [...fields]),
    onSuccess: (result) => { downloadJson(result); notify('success', `Экспортировано карточек: ${itemIds.length}`) },
    onError: (error) => notify('error', errorText(error)),
  })
  const preview = useMutation({
    mutationFn: (value: Record<string, unknown>) => adminApi.previewContentExchangeImport(value),
    onSuccess: (result) => setImportItems(new Set(result.items.filter((item) => item.status === 'create' || item.status === 'update').map((item) => exchangeItemKey(item.mode, item.id)))),
    onError: (error) => notify('error', errorText(error)),
  })
  const apply = useMutation({
    mutationFn: () => adminApi.applyContentExchangeImport({
      document, previewHash: preview.data!.previewHash,
      items: preview.data!.items.filter((item) => importItems.has(exchangeItemKey(item.mode, item.id))).map(({ id, mode }) => ({ id, mode })),
      reason, confirmation: true,
    }),
    onSuccess: (result) => { notify(result.summary.failed ? 'info' : 'success', `В рабочую версию добавлено: ${result.summary.staged}, ошибок: ${result.summary.failed}`); done() },
    onError: (error) => notify('error', errorText(error)),
  })
  const loadFile = async (file: File) => {
    setFileName(file.name); setParseError(''); setDocument(null); preview.reset(); setImportItems(new Set())
    if (file.size > 15 * 1024 * 1024) { setParseError('Файл больше 15 МБ'); return }
    try {
      const parsed = JSON.parse(await file.text()) as unknown; const value = record(parsed)
      if (value.format !== 'shoditsa-content-exchange' || value.schemaVersion !== 1) throw new Error('Это не файл обмена Shoditsa версии 1')
      setDocument(value); preview.mutate(value)
    } catch (error) { setParseError(error instanceof Error ? error.message : 'Не удалось прочитать JSON') }
  }
  const actionableCount = preview.data?.items.filter((item) => importItems.has(exchangeItemKey(item.mode, item.id))).length ?? 0
  return <div className="admin-modal-backdrop" onMouseDown={(event) => event.target === event.currentTarget && close()}><div className="admin-modal admin-modal--exchange">
    <header><div><span>Версионированный JSON · schema v1</span><h2>Экспорт и импорт контента</h2></div><button onClick={close}><X /></button></header>
    <div className="admin-exchange-tabs"><button className={tab === 'export' ? 'is-active' : ''} onClick={() => setTab('export')}><Download />Экспорт</button><button className={tab === 'import' ? 'is-active' : ''} onClick={() => setTab('import')}><Upload />Импорт</button></div>
    <div className="admin-modal__body">
      {tab === 'export' ? !itemIds.length ? <Empty title="Сначала выберите карточки" text="Закройте окно, отметьте нужные строки в таблице и снова откройте экспорт." icon={<FileJson />} /> : selection.isLoading ? <Loading /> : selection.error ? <ErrorState error={selection.error} /> : <>
        <div className="admin-exchange-summary"><div><span>Выбрано карточек</span><strong>{selection.data?.found ?? 0}</strong></div><div><span>Доступно полей</span><strong>{selection.data?.fields.length ?? 0}</strong></div><div><span>Будет экспортировано</span><strong>{fields.size}</strong></div></div>
        <div className="admin-exchange-mode-list">{MODES.filter((entry) => Number(selection.data?.modes[entry.value])).map((entry) => <span key={entry.value}>{entry.label}: <b>{selection.data?.modes[entry.value]}</b></span>)}</div>
        <section className="admin-exchange-fields"><header><div><strong>Поля JSON</strong><small>ID и категория добавляются автоматически как служебная identity.</small></div><div><button onClick={() => setFields(new Set(selection.data?.fields.map((entry) => entry.field)))}>Выбрать всё</button><button onClick={() => setFields(new Set())}>Снять всё</button></div></header><div>{selection.data?.fields.map((entry) => <label key={entry.field}><input type="checkbox" checked={fields.has(entry.field)} onChange={(event) => setFields((current) => { const next = new Set(current); event.target.checked ? next.add(entry.field) : next.delete(entry.field); return next })} /><span><code>{entry.field}</code><small>есть у {entry.count} из {selection.data!.found}</small></span></label>)}</div></section>
      </> : <>
        <label className="admin-exchange-upload"><Upload /><span><strong>{fileName || 'Выберите JSON-файл'}</strong><small>Система сначала покажет, что будет создано или изменено. Прямой записи без preview нет.</small></span><input type="file" accept=".json,application/json" onChange={(event) => { const file = event.target.files?.[0]; if (file) void loadFile(file) }} /></label>
        {parseError && <div className="admin-exchange-error"><AlertTriangle />{parseError}</div>}
        {preview.isPending && <Loading />}
        {preview.data && <><div className="admin-exchange-summary"><div><span>Новые</span><strong>{preview.data.summary.create}</strong></div><div><span>Изменить</span><strong>{preview.data.summary.update}</strong></div><div><span>Без изменений</span><strong>{preview.data.summary.unchanged}</strong></div><div><span>Конфликты</span><strong>{preview.data.summary.conflict}</strong></div><div><span>Ошибки</span><strong>{preview.data.summary.invalid}</strong></div></div>
          <div className="admin-exchange-import-list">{preview.data.items.slice(0, 500).map((item) => { const actionable = item.status === 'create' || item.status === 'update'; const key = exchangeItemKey(item.mode, item.id); return <article key={key} className={`is-${item.status}`}><input type="checkbox" disabled={!actionable} checked={importItems.has(key)} onChange={(event) => setImportItems((current) => { const next = new Set(current); event.target.checked ? next.add(key) : next.delete(key); return next })} /><div><header><strong>{item.title}</strong><Status value={item.status} /></header><small>{MODE_LABEL[item.mode]} · <code>{item.id}</code></small><p>{item.message || (item.changedFields.length ? `Поля: ${item.changedFields.join(', ')}` : 'Изменений нет')}</p>{item.conflicts.length > 0 && <em>Конфликтуют: {item.conflicts.join(', ')}</em>}{item.issues.length > 0 && <em>{item.issues.map((issue) => String(issue.message ?? issue.code)).join(' · ')}</em>}</div></article> })}</div>
          <label className="admin-field admin-field--wide"><span>Причина изменений</span><input value={reason} onChange={(event) => setReason(event.target.value)} /></label>
        </>}
      </>}
    </div>
    <footer><button className="admin-btn admin-btn--secondary" onClick={close}>Отмена</button>{tab === 'export' ? <button className="admin-btn admin-btn--primary" disabled={!itemIds.length || !fields.size || exportMutation.isPending} onClick={() => exportMutation.mutate()}><Download />Скачать JSON</button> : <button className="admin-btn admin-btn--primary" disabled={!document || !preview.data || !actionableCount || reason.trim().length < 3 || apply.isPending} onClick={() => apply.mutate()}><Check />Добавить {actionableCount} в рабочую версию</button>}</footer>
  </div></div>
}

function ContentPage({ selectedId, navigate, notify }: { selectedId: string | null; navigate: (section: Section, id?: string | null) => void; notify: (tone: Notice['tone'], text: string) => void }) {
  const client = useQueryClient(); const params = new URLSearchParams(location.search)
  const [q, setQ] = useState(params.get('q') ?? ''); const [mode, setMode] = useState(params.get('mode') ?? ''); const [publication, setPublication] = useState(params.get('publication') ?? 'all'); const [pageSize, setPageSize] = useState<20 | 40 | 60 | 100>(60); const [view, setView] = useState<'table' | 'grid' | 'review'>('table'); const [selected, setSelected] = useState<Set<string>>(new Set()); const [adding, setAdding] = useState(false); const [exchange, setExchange] = useState<'export' | 'import' | null>(null); const loadMoreRef = useRef<HTMLDivElement | null>(null)
  useEffect(() => { const next = new URLSearchParams(); if (q) next.set('q', q); if (mode) next.set('mode', mode); if (publication !== 'all') next.set('publication', publication); history.replaceState({}, '', `${location.pathname}${next.size ? `?${next}` : ''}`) }, [q, mode, publication])
  const items = useInfiniteQuery({ queryKey: ['admin', 'content', { q, mode, publication, pageSize }], initialPageParam: null as string | null, queryFn: ({ pageParam }) => adminApi.contentItems({ q, mode, publication, limit: pageSize, cursor: pageParam ?? undefined }), getNextPageParam: (lastPage) => lastPage.nextCursor })
  const listedItems = useMemo(() => items.data?.pages.flatMap((page) => page.items) ?? [], [items.data])
  const totalItems = items.data?.pages[0]?.total ?? 0
  useEffect(() => { const target = loadMoreRef.current; if (!target || !items.hasNextPage || items.isFetchingNextPage) return; const observer = new IntersectionObserver(([entry]) => { if (entry.isIntersecting) void items.fetchNextPage() }, { rootMargin: '320px' }); observer.observe(target); return () => observer.disconnect() }, [items.fetchNextPage, items.hasNextPage, items.isFetchingNextPage])
  const bulk = useMutation({ mutationFn: (operation: 'allow' | 'disallow') => adminApi.bulkContent({ itemIds: [...selected], operation, reason: operation === 'allow' ? 'Массовое включение в игру' : 'Массовое исключение из игры' }), onSuccess: (data) => { notify('success', `Обработано: ${data.succeeded ?? 0}, ошибок: ${data.failed ?? 0}`); setSelected(new Set()); void client.invalidateQueries({ queryKey: ['admin', 'content'] }); void client.invalidateQueries({ queryKey: ['admin', 'workspace'] }) }, onError: (error) => notify('error', errorText(error)) })
  return <>
    <PageHead eyebrow="Контент" title="Карточки" description="Поиск, проверка и публикация всех шести игровых библиотек." actions={<><div className="admin-view-switch"><button className={view === 'table' ? 'is-active' : ''} onClick={() => setView('table')}><Menu />Таблица</button><button className={view === 'grid' ? 'is-active' : ''} onClick={() => setView('grid')}><Boxes />Карточки</button><button className={view === 'review' ? 'is-active' : ''} onClick={() => setView('review')}><Eye />Проверка</button></div><button className="admin-btn admin-btn--secondary" onClick={() => setExchange('import')}><Upload />Импорт JSON</button><button className="admin-btn admin-btn--secondary" disabled={!selected.size} onClick={() => setExchange('export')}><Download />Экспорт JSON{selected.size ? ` · ${selected.size}` : ''}</button><button className="admin-btn admin-btn--primary" onClick={() => setAdding(true)}><Plus />Добавить карточку</button></>} />
    <WorkspaceBar notify={notify} />
    <div className="admin-toolbar"><label className="admin-search"><Search /><input value={q} onChange={(event) => setQ(event.target.value)} placeholder="Название, альтернативное название или ID" />{q && <button onClick={() => setQ('')}><X /></button>}</label><label><Filter /><select value={mode} onChange={(event) => setMode(event.target.value)}><option value="">Все категории</option>{MODES.map((entry) => <option key={entry.value} value={entry.value}>{entry.label}</option>)}</select></label><label><Archive /><select value={publication} onChange={(event) => setPublication(event.target.value)}><option value="all">Все статусы</option><option value="published">Опубликованы</option><option value="hidden">Скрыты</option></select></label><label><ListChecks /><select aria-label="Размер страницы" value={pageSize} onChange={(event) => { setPageSize(Number(event.target.value) as 20 | 40 | 60 | 100); setSelected(new Set()) }}><option value={20}>20</option><option value={40}>40</option><option value={60}>60</option><option value={100}>100</option></select></label><button className="admin-btn admin-btn--secondary" onClick={() => void items.refetch()}><RefreshCw /></button></div>
    {selected.size > 0 && <div className="admin-bulk"><strong>Выбрано: {selected.size}</strong><button onClick={() => setExchange('export')}><Download />Экспорт JSON</button><button onClick={() => bulk.mutate('allow')}><Check />Разрешить в игре</button><button onClick={() => bulk.mutate('disallow')}><Archive />Скрыть</button><button onClick={() => setSelected(new Set())}><X />Снять выбор</button></div>}
    {items.isLoading ? <Loading /> : items.error ? <ErrorState error={items.error} retry={() => void items.refetch()} /> : !listedItems.length ? <Empty title="Ничего не найдено" text="Измените запрос или сбросьте фильтры." icon={<Search />} action={<button className="admin-btn admin-btn--secondary" onClick={() => { setQ(''); setMode(''); setPublication('all') }}>Сбросить фильтры</button>} />
      : view === 'grid' ? <div className="admin-content-grid">{listedItems.map((item) => <button key={item.id} onClick={() => navigate('content', item.id)}><div>{item.posterUrl ? <img src={item.posterUrl} alt="" /> : <ImageIcon />}{item.draftVersion && <span>Draft v{item.draftVersion}</span>}</div><small>{MODE_LABEL[item.mode]}</small><strong>{item.titleRu}</strong><p>{item.titleOriginal || item.id}</p><footer><Status value={item.allowedInGame ? 'active' : 'blocked'}>{item.allowedInGame ? 'В игре' : 'Скрыта'}</Status><span>{item.completeness}%</span></footer></button>)}</div>
        : <div className="admin-table-wrap"><table className="admin-table"><thead><tr><th className="admin-check"><input type="checkbox" aria-label="Выбрать все" checked={selected.size === listedItems.length && selected.size > 0} onChange={(event) => setSelected(event.target.checked ? new Set(listedItems.map((item) => item.id)) : new Set())} /></th><th>Карточка</th><th>ID</th><th>Категория</th><th>Статус</th><th>Полнота</th><th>Репорты</th><th>Качество</th><th>Изменена</th><th /></tr></thead><tbody>{listedItems.map((item) => <tr key={item.id} className={selectedId === item.id ? 'is-open' : ''}><td className="admin-check"><input type="checkbox" aria-label={`Выбрать ${item.titleRu}`} checked={selected.has(item.id)} onChange={(event) => setSelected((current) => { const next = new Set(current); event.target.checked ? next.add(item.id) : next.delete(item.id); return next })} /></td><td><button className="admin-title-cell" onClick={() => navigate('content', item.id)}>{item.posterUrl ? <img src={item.posterUrl} alt="" /> : <span><ImageIcon /></span>}<span><strong>{item.titleRu}</strong><small>{item.titleOriginal || 'Без оригинального названия'}{item.year ? ` · ${item.year}` : ''}</small></span></button></td><td><code>{item.id}</code></td><td>{MODE_LABEL[item.mode]}</td><td><Status value={item.allowedInGame ? 'active' : 'blocked'}>{item.allowedInGame ? 'В игре' : 'Скрыта'}</Status>{item.draftVersion && <small className="admin-draft-label">Draft v{item.draftVersion}</small>}</td><td><div className="admin-completeness"><i style={{ width: `${item.completeness}%` }} /><span>{item.completeness}%</span></div></td><td>{item.reportsCount ? <button className="admin-count admin-count--warn" onClick={() => navigate('reports')}>{item.reportsCount}</button> : '—'}</td><td>{item.issuesCount ? <span className="admin-count admin-count--danger">{item.issuesCount}</span> : <Check className="admin-table-ok" />}</td><td>{compactDate(item.updatedAt)}</td><td><button className="admin-icon-btn" onClick={() => navigate('content', item.id)}><ChevronRight /></button></td></tr>)}</tbody></table><footer className="admin-table-footer"><span>Показано {listedItems.length} из {totalItems.toLocaleString('ru-RU')}</span></footer></div>}<div className="admin-content-pagination" ref={loadMoreRef}>{items.hasNextPage ? <button className="admin-btn admin-btn--secondary" disabled={items.isFetchingNextPage} onClick={() => void items.fetchNextPage()}>{items.isFetchingNextPage ? <LoaderCircle className="admin-spinner" /> : null}{items.isFetchingNextPage ? 'Загружаем…' : 'Загрузить ещё'}</button> : <span>Все карточки загружены</span>}</div>
    {selectedId && <ItemEditor itemId={selectedId} onClose={() => navigate('content')} notify={notify} />}
    {adding && <NewCardDialog close={() => setAdding(false)} done={(id) => { setAdding(false); navigate('content', id); void client.invalidateQueries({ queryKey: ['admin', 'content'] }); void client.invalidateQueries({ queryKey: ['admin', 'workspace'] }) }} notify={notify} />}
    {exchange && <ContentExchangeDialog initialTab={exchange} itemIds={[...selected]} close={() => setExchange(null)} notify={notify} done={() => { setExchange(null); setSelected(new Set()); void client.invalidateQueries({ queryKey: ['admin', 'content'] }); void client.invalidateQueries({ queryKey: ['admin', 'workspace'] }) }} />}
  </>
}

function ReportsPage({ selectedId, navigate, notify }: { selectedId: string | null; navigate: (section: Section, id?: string | null) => void; notify: (tone: Notice['tone'], text: string) => void }) {
  const client = useQueryClient(); const [status, setStatus] = useState('open'); const [reason, setReason] = useState('')
  const reports = useQuery({ queryKey: ['admin', 'reports', { status, reason }], queryFn: () => adminApi.reports({ status, reason, limit: 60 }) })
  const detail = useQuery({ queryKey: ['admin', 'report', selectedId], queryFn: () => adminApi.report(selectedId!), enabled: Boolean(selectedId) })
  const patch = useMutation({ mutationFn: ({ id, body }: { id: string; body: Record<string, unknown> }) => adminApi.patchReport(id, body), onSuccess: () => { notify('success', 'Статус отчёта обновлён'); void client.invalidateQueries({ queryKey: ['admin', 'reports'] }); void client.invalidateQueries({ queryKey: ['admin', 'report'] }) }, onError: (error) => notify('error', errorText(error)) })
  const resolve = (nextStatus: string) => {
    if (!selectedId) return
    if (nextStatus === 'in_progress') return patch.mutate({ id: selectedId, body: { status: 'in_progress', assignedTo: null } })
    const type = prompt('Итог: fixed_by_revision, already_fixed, expected_behavior, insufficient_data, duplicate или other', nextStatus === 'duplicate' ? 'duplicate' : 'fixed_by_revision')
    if (!type) return; const comment = prompt('Короткий комментарий к решению') ?? ''
    const duplicateOfReportId = type === 'duplicate' ? prompt('ID основного отчёта') : null
    patch.mutate({ id: selectedId, body: { status: nextStatus, resolutionType: type, resolutionComment: comment, ...(duplicateOfReportId ? { duplicateOfReportId } : {}) } })
  }
  const current = detail.data ? record(detail.data.report) : null; const game = detail.data ? record(detail.data.game) : null
  return <><PageHead eyebrow="Обратная связь" title="Баг-репорты" description="Разбирайте проблему вместе со снимком раунда и текущей карточкой." actions={<button className="admin-btn admin-btn--secondary" onClick={() => void reports.refetch()}><RefreshCw />Обновить очередь</button>} />
    <div className="admin-toolbar"><label><Filter /><select value={status} onChange={(event) => setStatus(event.target.value)}><option value="">Все статусы</option><option value="open">Новые</option><option value="in_progress">В работе</option><option value="resolved">Исправлены</option><option value="dismissed">Отклонены</option><option value="duplicate">Дубликаты</option></select></label><label><Bug /><select value={reason} onChange={(event) => setReason(event.target.value)}><option value="">Все причины</option>{Object.entries(REPORT_REASON).map(([value, label]) => <option key={value} value={value}>{label}</option>)}</select></label></div>
    <div className="admin-split"><section className="admin-list-panel">{reports.isLoading ? <Loading /> : reports.error ? <ErrorState error={reports.error} /> : reports.data?.items.length ? reports.data.items.map((entry) => { const report = record(entry.report); return <button key={String(report.id)} className={selectedId === report.id ? 'is-active' : ''} onClick={() => navigate('reports', String(report.id))}><span className={`admin-list-icon admin-list-icon--${statusTone(report.status)}`}><Bug /></span><span><header><strong>{REPORT_REASON[String(report.reason)] ?? title(report.reason)}</strong><time>{compactDate(report.createdAt)}</time></header><p>{title(entry.titleRu)} · {entry.userEmail}</p><small>{title(report.comment || 'Без комментария')}</small></span><Status value={report.status} /></button> }) : <Empty title="Очередь пуста" text="Для выбранных фильтров отчётов нет." />}</section>
      <section className="admin-detail-panel">{!selectedId ? <Empty title="Выберите отчёт" text="Справа появится контекст игрового раунда и текущая карточка." icon={<PanelRightClose />} /> : detail.isLoading ? <Loading /> : detail.error || !current ? <ErrorState error={detail.error} /> : <><header className="admin-detail-head"><div><span>Отчёт {String(current.id).slice(0, 8)}</span><h2>{REPORT_REASON[String(current.reason)] ?? title(current.reason)}</h2><p>{formatDate(current.createdAt)} · {title(record(detail.data!.reporter).email)}</p></div><Status value={current.status} /></header><div className="admin-report-actions"><button onClick={() => resolve('in_progress')} disabled={patch.isPending}><Clock3 />В работу</button><button onClick={() => resolve('resolved')}><Check />Исправлено</button><button onClick={() => resolve('dismissed')}><X />Отклонить</button><button onClick={() => resolve('duplicate')}><Copy />Дубликат</button></div><div className="admin-report-comment"><span>Комментарий игрока</span><p>{title(current.comment || 'Комментарий не оставлен')}</p>{current.clientErrorId && <code>Ошибка: {String(current.clientErrorId)}</code>}</div><div className="admin-report-context"><div><span>Режим</span><strong>{MODE_LABEL[String(current.mode) as ContentMode]}</strong></div><div><span>Статус раунда</span><strong>{title(game?.status)}</strong></div><div><span>Попыток</span><strong>{String(game?.attemptsCount ?? 0)}</strong></div><div><span>Версия правил</span><strong>{String(game?.rulesVersion ?? '—')}</strong></div></div><div className="admin-compare"><header><h3>Карточка в момент игры</h3><button className="admin-link" onClick={() => navigate('content', String(current.itemId))}>Открыть редактор рядом <ChevronRight /></button></header><div><article><span>Снимок раунда</span><strong>{title(record(detail.data!.snapshot).titleRu)}</strong><pre>{JSON.stringify(detail.data!.snapshot, null, 2)}</pre></article><article><span>Active + draft</span><strong>{title(record(record(detail.data!.draft).afterPayload || record(detail.data!.active).payload).titleRu)}</strong><pre>{JSON.stringify(record(detail.data!.draft).afterPayload || record(detail.data!.active).payload, null, 2)}</pre></article></div></div><section className="admin-round-log"><h3>Хронология раунда</h3>{array(detail.data!.attempts).map((raw, index) => { const attempt = record(raw); return <div key={String(attempt.id)}><span>{index + 1}</span><p>Попытка · {attempt.isCorrect ? 'верно' : 'неверно'}</p><time>{compactDate(attempt.createdAt)}</time></div> })}{array(detail.data!.hints).map((raw) => { const hint = record(raw); return <div key={String(hint.id)}><span>?</span><p>Открыта подсказка {title(hint.hintKey)}</p><time>{compactDate(hint.createdAt)}</time></div> })}</section></>}</section>
    </div></>
}

type ManualArtist = { artist: string; country?: string; hint?: string }
type ManualMovie = { kinopoiskId: number; hint?: string }
type ManualAnime = { shikimoriId: number; hint?: string }
type PipelineKey = 'music' | 'movie' | 'anime'

const parseArtistList = (value: string): ManualArtist[] => value.split(/\r?\n/).flatMap((raw, index) => {
  const line = raw.trim()
  if (!line || (index === 0 && /^(artist|исполнитель)([,;\t]|$)/i.test(line))) return []
  const separator = line.includes('\t') ? '\t' : line.includes(';') ? ';' : line.includes(',') ? ',' : null
  const parts = separator ? line.split(separator).map((entry) => entry.trim().replace(/^"|"$/g, '')) : [line]
  return [{ artist: parts[0], ...(parts[1] ? { country: parts[1] } : {}), ...(parts.slice(2).join(' ').trim() ? { hint: parts.slice(2).join(' ').trim() } : {}) }]
}).slice(0, 500)

const parseMovieList = (value: string): ManualMovie[] => value.split(/\r?\n/).flatMap((raw, index) => {
  const line = raw.trim()
  if (!line || (index === 0 && /^(kinopoisk|кинопоиск|id)([,;\t]|$)/i.test(line))) return []
  const [rawId, ...rest] = line.split(/[;,\t]/).map((entry) => entry.trim().replace(/^"|"$/g, ''))
  const match = rawId.match(/(?:kinopoisk\.ru\/(?:film|series)\/|kp[_:-]?)?(\d+)/i)
  const kinopoiskId = Number(match?.[1])
  return Number.isInteger(kinopoiskId) && kinopoiskId > 0 ? [{ kinopoiskId, ...(rest.join(' ').trim() ? { hint: rest.join(' ').trim() } : {}) }] : []
}).slice(0, 500)

const parseAnimeList = (value: string): ManualAnime[] => value.split(/\r?\n/).flatMap((raw, index) => {
  const line = raw.trim()
  if (!line || (index === 0 && /^(shikimori|шикимори|id)([,;\t]|$)/i.test(line))) return []
  const [rawId, ...rest] = line.split(/[;,\t]/).map((entry) => entry.trim().replace(/^"|"$/g, ''))
  const match = rawId.match(/(?:shikimori\.(?:one|io)\/(?:animes?|anime)\/|shiki[_:-]?)?(\d+)/i)
  const shikimoriId = Number(match?.[1])
  return Number.isInteger(shikimoriId) && shikimoriId > 0 ? [{ shikimoriId, ...(rest.join(' ').trim() ? { hint: rest.join(' ').trim() } : {}) }] : []
}).slice(0, 500)

function PipelinesPage({ selectedId, navigate, notify }: { selectedId: string | null; navigate: (section: Section, id?: string | null) => void; notify: (tone: Notice['tone'], text: string) => void }) {
  const client = useQueryClient()
  const pipelines = useQuery({ queryKey: ['admin', 'pipelines'], queryFn: adminApi.pipelines })
  const runs = useQuery({ queryKey: ['admin', 'pipeline-runs'], queryFn: adminApi.pipelineRuns, refetchInterval: 5_000 })
  const items = useQuery({ queryKey: ['admin', 'pipeline-items', selectedId], queryFn: () => adminApi.pipelineItems(selectedId!), enabled: Boolean(selectedId), refetchInterval: selectedId ? 5_000 : false })
  const [scenario, setScenario] = useState('manual'); const [maxItems, setMaxItems] = useState(5); const [starting, setStarting] = useState(false); const [pipelineKey, setPipelineKey] = useState<PipelineKey>('music')
  const [artistText, setArtistText] = useState(''); const artists = useMemo(() => parseArtistList(artistText), [artistText])
  const [movieText, setMovieText] = useState(''); const movies = useMemo(() => parseMovieList(movieText), [movieText])
  const [animeText, setAnimeText] = useState(''); const anime = useMemo(() => parseAnimeList(animeText), [animeText])
  const manualItems = pipelineKey === 'music' ? artists : pipelineKey === 'movie' ? movies : anime
  const manualPayload = pipelineKey === 'music' ? { artists } : pipelineKey === 'movie' ? { movies } : { anime }
  const preview = useQuery({ queryKey: ['admin', 'pipeline-manual-preview', pipelineKey, manualItems], queryFn: () => adminApi.pipelineManualPreview(pipelineKey, manualItems), enabled: starting && scenario === 'manual' && manualItems.length > 0 })
  const estimate = useQuery({
    queryKey: ['admin', 'pipeline-estimate', pipelineKey, scenario, maxItems, manualItems], enabled: scenario !== 'manual' || manualItems.length > 0,
    queryFn: () => adminApi.pipelineEstimate(pipelineKey, { scenario, maxItems, ...(scenario === 'manual' ? manualPayload : {}), aiMode: 'auto', model: 'gpt-5-mini', webSearch: true }),
  })
  const start = useMutation({
    mutationFn: () => adminApi.startPipeline(pipelineKey, { scenario, maxItems, ...(scenario === 'manual' ? manualPayload : {}), aiMode: 'auto', model: 'gpt-5-mini', webSearch: true }),
    onSuccess: (data) => { notify('success', pipelineKey === 'music' ? 'Музыкальный пайплайн запущен' : pipelineKey === 'movie' ? 'Кино-пайплайн запущен' : 'Аниме-пайплайн запущен'); setStarting(false); navigate('pipelines', data.runId); void client.invalidateQueries({ queryKey: ['admin', 'pipeline-runs'] }) },
    onError: (error) => notify('error', errorText(error)),
  })
  const decide = useMutation({ mutationFn: ({ itemId, approved }: { itemId: string; approved: boolean }) => { const item = items.data?.items.find((entry) => entry.id === itemId); const before = record(item?.beforeJson); const proposed = record(item?.proposedJson); const fieldDecisions = Object.fromEntries([...new Set([...Object.keys(before), ...Object.keys(proposed)])].filter((field) => JSON.stringify(before[field]) !== JSON.stringify(proposed[field])).map((field) => [field, { action: approved ? 'accept' : 'keep' }])); return adminApi.pipelineDecision(selectedId!, itemId, { approved, fieldDecisions }) }, onSuccess: () => { notify('success', 'Решение сохранено'); void client.invalidateQueries({ queryKey: ['admin', 'pipeline-items', selectedId] }) }, onError: (error) => notify('error', errorText(error)) })
  const approve = useMutation({ mutationFn: (publish: boolean) => adminApi.approvePipeline(selectedId!, {}, publish), onSuccess: (_, publish) => { notify('success', publish ? 'Выбранные изменения опубликованы' : 'Изменения добавлены в рабочую версию'); void client.invalidateQueries({ queryKey: ['admin'] }) }, onError: (error) => notify('error', errorText(error)) })
  const cancel = useMutation({ mutationFn: () => adminApi.cancelPipeline(selectedId!), onSuccess: () => { notify('info', 'Остановка запрошена'); void runs.refetch() }, onError: (error) => notify('error', errorText(error)) })
  const selectedRun = runs.data?.items.find((entry) => entry.id === selectedId)
  const previewSummary = record(preview.data?.summary); const readyItems = Number(previewSummary.ready ?? 0)
  const pipelineLabel = (key: unknown) => key === 'music' ? 'Музыка' : key === 'movie' ? 'Кино' : key === 'anime' ? 'Аниме' : 'Пайплайн'
  const pipelineDetailTitle = (key: unknown) => key === 'music' ? 'Музыкальный пайплайн' : key === 'movie' ? 'Кино-пайплайн Кинопоиска' : key === 'anime' ? 'Аниме-пайплайн Shikimori' : 'Контентный пайплайн'
  const pipelineIcon = (key: unknown) => key === 'music' ? <WandSparkles /> : key === 'movie' ? <Clapperboard /> : key === 'anime' ? <Sparkles /> : <Bot />
  const manualText = pipelineKey === 'music' ? artistText : pipelineKey === 'movie' ? movieText : animeText
  const setManualText = pipelineKey === 'music' ? setArtistText : pipelineKey === 'movie' ? setMovieText : setAnimeText
  const manualFieldLabel = pipelineKey === 'music' ? 'Исполнители' : pipelineKey === 'movie' ? 'Фильмы Кинопоиска' : 'Аниме Shikimori'
  const manualPlaceholder = pipelineKey === 'music' ? 'Кино\nDepeche Mode\nPhoenix,Франция,indie rock band' : pipelineKey === 'movie' ? '326\nhttps://www.kinopoisk.ru/film/435/\n535341,добавить фильм из списка' : '16498\nhttps://shikimori.one/animes/5114\n9253,добавить аниме из списка'
  const manualHelp = pipelineKey === 'music' ? 'Формат: имя или CSV «artist,country,hint». Страна и уточнение необязательны.' : pipelineKey === 'movie' ? 'Формат: ID или ссылка Кинопоиска. После запятой можно добавить внутреннее уточнение.' : 'Формат: ID или ссылка Shikimori. После запятой можно добавить внутреннее уточнение.'
  const openPipeline = (key: unknown) => { if (key === 'music' || key === 'movie' || key === 'anime') { setPipelineKey(key); setScenario('manual'); setStarting(true) } }
  return <><PageHead eyebrow="Автоматизация" title="ИИ-пайплайны" description="Управляемые очереди контента, подробная проверка и применение предложений через общую рабочую версию." actions={<><button className="admin-btn admin-btn--secondary" onClick={() => openPipeline('anime')}><Sparkles />Запустить аниме</button><button className="admin-btn admin-btn--secondary" onClick={() => openPipeline('movie')}><Clapperboard />Запустить кино</button><button className="admin-btn admin-btn--primary" onClick={() => openPipeline('music')}><WandSparkles />Запустить музыку</button></>} />
    <div className="admin-pipeline-catalog">{pipelines.data?.items.map((raw) => { const pipeline = record(raw); return <article key={String(pipeline.key)} className={pipeline.state === 'not_connected' ? 'is-disabled' : ''}><div className="admin-pipeline-icon">{pipeline.key === 'music' ? <WandSparkles /> : pipeline.key === 'movie' ? <Clapperboard /> : pipeline.key === 'anime' ? <Sparkles /> : <Bot />}</div><div><Status value={pipeline.state === 'connected' ? 'active' : 'neutral'}>{pipeline.state === 'connected' ? 'Подключён' : 'Ещё не подключён'}</Status><h3>{title(pipeline.title)}</h3><p>{title(pipeline.description)}</p><small>{pipeline.awaitingReview ? `Ждут проверки: ${pipeline.awaitingReview}` : 'Нет результатов на проверке'}</small></div>{pipeline.state === 'connected' && <button onClick={() => openPipeline(pipeline.key)}>Запустить <Play /></button>}</article> })}</div>
    <div className="admin-split admin-split--pipeline">
      <section className="admin-list-panel">
        <header className="admin-subhead"><h2>Запуски</h2><button onClick={() => void runs.refetch()}><RefreshCw /></button></header>
        {runs.data?.items.map((raw) => { const run = record(raw); return <button key={String(run.id)} className={selectedId === run.id ? 'is-active' : ''} onClick={() => navigate('pipelines', String(run.id))}><span className="admin-list-icon">{pipelineIcon(run.pipelineKey)}</span><span><header><strong>{pipelineLabel(run.pipelineKey)} · {Number(run.itemsProcessed ?? 0)}/{Number(run.itemsTotal ?? 0)}</strong><time>{compactDate(run.createdAt)}</time></header><p>{title(record(run.inputDefinitionJson).scenario)}</p><small>{run.safeErrorMessage ? title(run.safeErrorMessage) : `Успешно ${run.itemsSucceeded ?? 0}, ошибок ${run.itemsFailed ?? 0} · $${Number(run.actualCost ?? 0).toFixed(4)}`}</small></span><Status value={run.status} /></button>})}
      </section>
      <section className="admin-detail-panel">{!selectedRun ? <Empty title="Выберите запуск" text="Здесь появятся прогресс, фактическая стоимость, diff и решения по полям." icon={<WandSparkles />} /> : <>
        <header className="admin-detail-head"><div><span>Запуск {String(selectedRun.id).slice(0, 8)}</span><h2>{pipelineDetailTitle(selectedRun.pipelineKey)}</h2><p>{formatDate(selectedRun.createdAt)} · {title(record(selectedRun.settingsJson).model)}</p></div><div className="admin-detail-head__actions">{['queued', 'running'].includes(String(selectedRun.status)) && <button onClick={() => cancel.mutate()} disabled={cancel.isPending}><X />Остановить</button>}<Status value={selectedRun.status} /></div></header>
        <div className="admin-run-progress"><div><span>Обработано</span><strong>{String(selectedRun.itemsProcessed ?? 0)} / {String(selectedRun.itemsTotal ?? 0)}</strong></div><i><b style={{ width: `${Math.min(100, Number(selectedRun.itemsProcessed ?? 0) / Math.max(1, Number(selectedRun.itemsTotal ?? 1)) * 100)}%` }} /></i><div><span>Успешно {String(selectedRun.itemsSucceeded ?? 0)}</span><span>Ошибок {String(selectedRun.itemsFailed ?? 0)}</span><span>Оценка ${Number(selectedRun.estimatedCost ?? 0).toFixed(2)}</span><strong>Фактически ${Number(selectedRun.actualCost ?? 0).toFixed(6)}</strong></div></div>
        <div className="admin-pipeline-items">{items.isLoading ? <Loading /> : items.data?.items.length ? items.data.items.map((raw) => { const item = record(raw); const before = record(item.beforeJson); const proposed = record(item.proposedJson); const fields = [...new Set([...Object.keys(before), ...Object.keys(proposed)])].filter((field) => JSON.stringify(before[field]) !== JSON.stringify(proposed[field])); const warnings = pipelineWarnings(item.warningsJson); return <article key={String(item.id)}><header><div><Status value={item.status} /><strong>{title(proposed.titleRu || proposed.name || item.entityKey)}</strong><small>Изменено полей: {fields.length}</small></div><div><button onClick={() => decide.mutate({ itemId: String(item.id), approved: false })}>Отклонить</button><button className="is-primary" onClick={() => decide.mutate({ itemId: String(item.id), approved: true })}>Принять</button></div></header><div className="admin-diff">{fields.slice(0, 20).map((field) => <div key={field}><strong>{field}</strong><pre>{JSON.stringify(before[field], null, 2) ?? '—'}</pre><ChevronRight /><pre>{JSON.stringify(proposed[field], null, 2) ?? '—'}</pre></div>)}</div>{warnings.length > 0 && <footer><AlertTriangle />{warnings.join(' · ')}</footer>}</article> }) : <Empty title="Результатов пока нет" text={['queued', 'running'].includes(String(selectedRun.status)) ? 'Worker обрабатывает список партиями. Страница обновится автоматически.' : 'Запуск не создал проверяемых результатов.'} />}</div>
        {items.data?.items.some((item) => item.status === 'approved') && <div className="admin-sticky-actions"><span>Одобренные результаты готовы к применению</span><button className="admin-btn admin-btn--secondary" onClick={() => approve.mutate(false)}>В рабочую версию</button><button className="admin-btn admin-btn--primary" onClick={() => approve.mutate(true)}>Одобрить и опубликовать</button></div>}
      </>}</section>
    </div>
    {starting && <div className="admin-modal-backdrop" onMouseDown={(event) => event.target === event.currentTarget && setStarting(false)}>
      <div className="admin-modal admin-modal--pipeline">
        <header><div><span>{pipelineDetailTitle(pipelineKey)} · gpt-5-mini</span><h2>Новый запуск</h2></div><button onClick={() => setStarting(false)}><X /></button></header>
        <div className="admin-modal__body">
          <label className="admin-field admin-field--wide"><span>Сценарий</span><select value={scenario} onChange={(event) => setScenario(event.target.value)}><option value="manual">Создать карточки по моему списку</option><option value="discover">{pipelineKey === 'music' ? 'Найти и подготовить новых исполнителей' : pipelineKey === 'movie' ? 'Взять новые фильмы из топа Кинопоиска' : 'Взять новые аниме из топа Shikimori'}</option><option value="candidates">Обработать найденных кандидатов</option><option value="review">Перепроверить очередь ручной проверки</option></select></label>
          {scenario === 'manual' && <>
            <label className="admin-field admin-field--wide admin-artist-import"><span>{manualFieldLabel} <small>до 500 строк</small></span><textarea value={manualText} onChange={(event) => setManualText(event.target.value)} placeholder={manualPlaceholder} /><small>{manualHelp}</small><label className="admin-file-button"><Upload />Загрузить TXT или CSV<input type="file" accept=".txt,.csv,text/plain,text/csv" onChange={(event) => { const file = event.target.files?.[0]; if (file) void file.text().then(setManualText) }} /></label></label>
            <div className="admin-import-preview"><header><strong>Предварительная проверка</strong><span>{preview.isFetching ? 'Проверяем…' : `${manualItems.length} строк`}</span></header>{preview.data && <><div className="admin-import-summary"><span><b>{readyItems}</b> новых</span><span><b>{String(previewSummary.existing ?? 0)}</b> уже есть</span><span><b>{String(previewSummary.duplicates ?? 0)}</b> дублей</span></div><div className="admin-import-list">{preview.data.items.slice(0, 100).map((raw) => { const item = record(raw); const identity = pipelineKey === 'music' ? title(item.artist) : pipelineKey === 'movie' ? `Кинопоиск #${String(item.kinopoiskId)}` : `Shikimori #${String(item.shikimoriId)}`; return <div key={`${item.index}-${item.artist ?? item.kinopoiskId ?? item.shikimoriId}`}><strong>{identity}</strong><small>{item.country || item.existingTitle || item.hint || '—'}</small><Status value={item.status}>{item.status === 'ready' ? 'Новый' : item.status === 'existing_card' ? 'Уже есть' : item.status === 'duplicate_input' ? 'Дубль' : 'Ошибка'}</Status></div> })}</div></>}</div>
          </>}
          <label className="admin-field"><span>{scenario === 'manual' ? 'Размер партии' : 'Количество'} · {maxItems}</span><input type="range" min="1" max="20" value={maxItems} onChange={(event) => setMaxItems(Number(event.target.value))} /><small>{scenario === 'manual' ? 'После каждой партии прогресс и расход сохраняются в БД.' : 'Максимум элементов в текущем запуске.'}</small></label>
          <div className="admin-estimate"><CircleDollarSign /><div><span>Ориентировочная оценка</span><strong>${String(estimate.data?.estimatedCost ?? '—')}</strong><small>{String(estimate.data?.aiReviewCalls ?? '—')} AI-вызовов · фактическая сумма считается по usage и web search calls</small></div></div>
        </div>
        <footer><button className="admin-btn admin-btn--secondary" onClick={() => setStarting(false)}>Отмена</button><button className="admin-btn admin-btn--primary" disabled={start.isPending || (scenario === 'manual' && (!readyItems || preview.isFetching))} onClick={() => start.mutate()}><Play />{scenario === 'manual' ? `Запустить ${readyItems} ${pipelineKey === 'music' ? 'артистов' : pipelineKey === 'movie' ? 'фильмов' : 'аниме'}` : `Запустить ${maxItems} элементов`}</button></footer>
      </div>
    </div>}
  </>
}

function UsersPage({ selectedId, navigate, notify }: { selectedId: string | null; navigate: (section: Section, id?: string | null) => void; notify: (tone: Notice['tone'], text: string) => void }) {
  const client = useQueryClient(); const [q, setQ] = useState(''); const [status, setStatus] = useState(''); const users = useQuery({ queryKey: ['admin', 'users', { q, status }], queryFn: () => adminApi.users({ q, status, limit: 60 }) }); const detail = useQuery({ queryKey: ['admin', 'user', selectedId], queryFn: () => adminApi.user(selectedId!), enabled: Boolean(selectedId) })
  const action = useMutation({ mutationFn: ({ type, id }: { type: string; id: string }) => { if (type === 'block') { const reason = prompt('Обязательная причина блокировки'); if (!reason) throw new Error('Действие отменено'); return adminApi.blockUser(id, { reason, revokeSessions: true, blockedUntil: null }) } if (type === 'unblock') { const reason = prompt('Причина разблокировки'); if (!reason) throw new Error('Действие отменено'); return adminApi.unblockUser(id, reason) } if (type === 'note') { const note = prompt('Внутренняя заметка'); if (!note) throw new Error('Действие отменено'); return adminApi.addUserNote(id, note) } if (type === 'wallet') { const amount = Number(prompt('Корректировка билетов (может быть отрицательной)', '10')); const reason = prompt('Причина корректировки'); if (!Number.isFinite(amount) || !reason) throw new Error('Действие отменено'); return adminApi.adjustWallet(id, amount, reason) } return adminApi.revokeSessions(id) }, onSuccess: () => { notify('success', 'Действие выполнено'); void client.invalidateQueries({ queryKey: ['admin', 'users'] }); void client.invalidateQueries({ queryKey: ['admin', 'user', selectedId] }) }, onError: (error) => { if (errorText(error) !== 'Действие отменено') notify('error', errorText(error)) } })
  const data = detail.data; const account = record(data?.user); const profile = record(data?.profile); const wallet = record(data?.wallet)
  return <><PageHead eyebrow="Аккаунты" title="Пользователи" description="Активность, игровые сессии, билеты, репорты и безопасные административные действия." />
    <div className="admin-toolbar"><label className="admin-search"><Search /><input value={q} onChange={(event) => setQ(event.target.value)} placeholder="Email, ID или имя" /></label><label><ShieldCheck /><select value={status} onChange={(event) => setStatus(event.target.value)}><option value="">Все состояния</option><option value="active">Активны</option><option value="blocked">Заблокированы</option></select></label></div>
    <div className="admin-split"><section className="admin-list-panel">{users.isLoading ? <Loading /> : users.data?.items.map((userItem) => <button key={userItem.id} className={selectedId === userItem.id ? 'is-active' : ''} onClick={() => navigate('users', userItem.id)}><span className="admin-user-avatar">{userItem.isAnonymous ? '?' : title(userItem.displayName || userItem.name).slice(0, 1)}</span><span><header><strong>{userItem.isAnonymous ? 'Гость' : title(userItem.displayName || userItem.name)}</strong><time>{compactDate(userItem.lastActivityAt)}</time></header><p>{userItem.isAnonymous ? userItem.id : userItem.email}</p><small>{userItem.sessionsCount} сессий · {userItem.balance} билетов</small></span><Status value={userItem.accountStatus} /></button>)}</section><section className="admin-detail-panel">{!selectedId ? <Empty title="Выберите пользователя" text="Откроются профиль, активность и операции." icon={<UserRound />} /> : detail.isLoading ? <Loading /> : detail.error ? <ErrorState error={detail.error} /> : <><header className="admin-user-head"><span className="admin-user-avatar admin-user-avatar--large">{title(profile.displayName || account.name).slice(0, 1)}</span><div><Status value={profile.accountStatus} /><h2>{title(profile.displayName || account.name)}</h2><p>{title(account.email)} · <code>{selectedId}</code></p></div></header><div className="admin-user-actions"><button onClick={() => action.mutate({ type: profile.accountStatus === 'blocked' ? 'unblock' : 'block', id: selectedId })}><LockKeyhole />{profile.accountStatus === 'blocked' ? 'Разблокировать' : 'Заблокировать'}</button><button onClick={() => action.mutate({ type: 'revoke', id: selectedId })}><RefreshCw />Завершить сессии</button><button onClick={() => action.mutate({ type: 'note', id: selectedId })}><SquarePen />Заметка</button><button onClick={() => action.mutate({ type: 'wallet', id: selectedId })}><Ticket />Билеты</button><button onClick={() => void navigator.clipboard.writeText(selectedId)}><Copy />Копировать ID</button></div><div className="admin-user-kpis"><div><span>Баланс</span><strong>{String(wallet.balance ?? 0)}</strong><small>заработано {String(wallet.lifetimeEarned ?? 0)}</small></div><div><span>Сессии</span><strong>{array(data?.sessions).length}</strong><small>последние 30</small></div><div><span>Репорты</span><strong>{array(data?.reports).length}</strong><small>последние 30</small></div><div><span>Серия</span><strong>{String(record(data?.attendance).currentDailyStreak ?? 0)}</strong><small>дней</small></div></div><div className="admin-user-columns"><section><h3>Последние игровые сессии</h3>{array(data?.sessions).map((raw) => { const sessionItem = record(raw); return <button key={String(sessionItem.id)} onClick={() => navigate('events', String(sessionItem.id))}><span><strong>{MODE_LABEL[String(sessionItem.mode) as ContentMode]}</strong><small>{title(sessionItem.kind)} · {compactDate(sessionItem.startedAt)}</small></span><Status value={sessionItem.status} /></button> })}</section><section><h3>Операции баланса</h3>{array(data?.ledger).map((raw) => { const entry = record(raw); return <div key={String(entry.id)}><span><strong>{Number(entry.amount) > 0 ? '+' : ''}{String(entry.amount)}</strong><small>{title(entry.reason)}</small></span><time>{compactDate(entry.createdAt)}</time></div> })}</section></div><section className="admin-notes"><h3>Внутренние заметки</h3>{array(data?.notes).length ? array(data?.notes).map((raw) => { const note = record(raw); return <article key={String(note.id)}><p>{title(note.text)}</p><time>{formatDate(note.createdAt)}</time></article> }) : <p>Заметок нет.</p>}</section></>}</section></div></>
}

function EventsPage({ sessionId }: { sessionId: string | null }) {
  const [period, setPeriod] = useState('24h'); const [type, setType] = useState(''); const [errorsOnly, setErrorsOnly] = useState(false)
  const from = useMemo(() => new Date(Date.now() - ({ '1h': 3_600_000, '24h': 86_400_000, '7d': 604_800_000, '30d': 2_592_000_000 }[period] ?? 86_400_000)).toISOString(), [period])
  const events = useQuery({ queryKey: ['admin', 'events', { period, type, errorsOnly, sessionId }], queryFn: () => adminApi.events({ from, type, errorsOnly, gameSessionId: sessionId ?? undefined, limit: 100 }) })
  return <><PageHead eyebrow="Диагностика пути" title="События" description="Read model поверх игр, авторизации, ledger, репортов и компактной клиентской телеметрии." actions={<button className="admin-btn admin-btn--secondary" onClick={() => void events.refetch()}><RefreshCw />Обновить</button>} /><div className="admin-toolbar"><div className="admin-periods">{['1h', '24h', '7d', '30d'].map((value) => <button key={value} className={period === value ? 'is-active' : ''} onClick={() => setPeriod(value)}>{value === '1h' ? '1 час' : value === '24h' ? '24 часа' : value === '7d' ? '7 дней' : '30 дней'}</button>)}</div><label><Activity /><select value={type} onChange={(event) => setType(event.target.value)}><option value="">Все события</option><option value="game_started">Игра начата</option><option value="attempt">Попытка</option><option value="hint_opened">Подсказка</option><option value="content_report">Баг-репорт</option><option value="wallet">Баланс</option><option value="client_error">Ошибка клиента</option></select></label><label className="admin-toggle"><input type="checkbox" checked={errorsOnly} onChange={(event) => setErrorsOnly(event.target.checked)} />Только ошибки</label></div>{sessionId && <div className="admin-context-filter"><Activity />Игровая сессия <code>{sessionId}</code><a href="/admin/events">Сбросить</a></div>}
    {events.isLoading ? <Loading /> : events.error ? <ErrorState error={events.error} /> : <div className="admin-events">{events.data?.items.map((event: AdminTimelineEvent) => <details key={event.id}><summary><span className={`admin-event-icon admin-event-icon--${event.type}`}><Activity /></span><span><strong>{event.title}</strong><small>{event.summary}</small></span><time>{formatDate(event.occurredAt)}</time><code>{event.sourceTable}</code><ChevronDown /></summary><div><dl><dt>User</dt><dd>{event.userId}</dd><dt>Game session</dt><dd>{event.gameSessionId ?? '—'}</dd><dt>Item</dt><dd>{event.itemId ?? '—'}</dd><dt>Request ID</dt><dd>{event.requestId ?? '—'}</dd></dl><pre>{JSON.stringify(event.details, null, 2)}</pre></div></details>)}</div>}
  </>
}

function QualityPage({ navigate, notify }: { navigate: (section: Section, id?: string | null) => void; notify: (tone: Notice['tone'], text: string) => void }) {
  const client = useQueryClient(); const issues = useQuery({ queryKey: ['admin', 'quality'], queryFn: adminApi.qualityIssues }); const run = useMutation({ mutationFn: adminApi.runQuality, onSuccess: () => { notify('info', 'Проверка качества поставлена в очередь'); void client.invalidateQueries({ queryKey: ['admin', 'jobs'] }) }, onError: (error) => notify('error', errorText(error)) })
  const accept = useMutation({ mutationFn: ({ id, comment }: { id: string; comment: string }) => adminApi.patchQualityIssue(id, { status: 'accepted', comment }), onSuccess: () => { notify('success', 'Исключение сохранено'); void client.invalidateQueries({ queryKey: ['admin', 'quality'] }) }, onError: (error) => notify('error', errorText(error)) })
  const grouped = useMemo(() => Object.entries((issues.data?.items ?? []).reduce<Record<string, Array<Record<string, unknown>>>>((result, raw) => {
    const key = String(raw.ruleKey); (result[key] ??= []).push(raw); return result
  }, {})), [issues.data])
  return <><PageHead eyebrow="Автоматические правила" title="Контроль качества" description="Ошибки схемы, подсказок, дублей, медиа и допустимых ответов." actions={<button className="admin-btn admin-btn--primary" onClick={() => run.mutate()}><RefreshCw />Запустить проверку</button>} />{issues.isLoading ? <Loading /> : !grouped.length ? <Empty title="Открытых проблем нет" text="Запустите проверку, чтобы подтвердить актуальное состояние active revision." icon={<BadgeCheck />} /> : <div className="admin-quality">{grouped.map(([rule, entries]) => <section key={rule}><header><div><AlertTriangle /><span><strong>{rule}</strong><small>Открытых проблем: {entries.length}</small></span></div><Status value={entries.some((entry) => entry.severity === 'critical') ? 'critical' : 'warning'} /></header>{entries.map((entry) => <div className="admin-quality-row" key={String(entry.id)}><button onClick={() => navigate('content', String(entry.itemId))}><span><strong>{title(entry.itemId)}</strong><small>{MODE_LABEL[String(entry.mode) as ContentMode]} · {title(entry.field)}</small></span><p>{title(entry.message)}</p><ChevronRight /></button><button className="admin-link" onClick={() => { const comment = prompt('Почему это предупреждение допустимо?'); if (comment?.trim()) accept.mutate({ id: String(entry.id), comment: comment.trim() }) }}>Допустимо</button></div>)}</section>)}</div>}</>
}

function EconomyPage({ notify }: { notify: (tone: Notice['tone'], text: string) => void }) {
  const client = useQueryClient(); const promos = useQuery({ queryKey: ['admin', 'promos'], queryFn: adminApi.promos }); const [creating, setCreating] = useState(false); const [code, setCode] = useState(''); const [promoTitle, setPromoTitle] = useState(''); const [reward, setReward] = useState(25)
  const create = useMutation({ mutationFn: () => adminApi.createPromo({ code, title: promoTitle, rewardValue: reward, rewardType: 'tickets', perUserLimit: 1, globalLimit: null }), onSuccess: () => { notify('success', 'Промокод создан. Сохраните исходный код: повторно его показать нельзя.'); setCreating(false); setCode(''); setPromoTitle(''); void client.invalidateQueries({ queryKey: ['admin', 'promos'] }) }, onError: (error) => notify('error', errorText(error)) })
  return <><PageHead eyebrow="Билеты и промокоды" title="Экономика" description="Append-only ledger и безопасное управление кодами без показа HMAC credential data." actions={<button className="admin-btn admin-btn--primary" onClick={() => setCreating(true)}><Plus />Создать промокод</button>} /><div className="admin-economy-grid"><section className="admin-panel"><header><div><span>Промокоды</span><h2>Активные и завершённые</h2></div></header><div className="admin-promo-list">{promos.data?.items.map((raw) => { const entry = record(raw); const promo = record(entry.promo); return <article key={String(promo.id)}><span className="admin-list-icon"><Tags /></span><div><strong>{title(promo.title)}</strong><small>{promo.enabled ? 'Активен' : 'Отключён'} · {String(entry.redemptions ?? 0)} применений</small><p>{String(record(promo.rewardValue).amount ?? promo.rewardValue)} билетов · лимит {String(promo.perUserLimit)}/польз.</p></div><Status value={promo.enabled ? 'active' : 'blocked'} /></article> })}</div></section><section className="admin-panel admin-ledger-explainer"><header><div><span>Гарантия</span><h2>Ledger не редактируется</h2></div></header><CircleDollarSign /><h3>Каждая корректировка — отдельная операция</h3><p>Баланс меняется только через audited endpoint с обязательной причиной и idempotency key. Старые операции нельзя удалить или переписать.</p><a href="/admin/users">Найти пользователя для корректировки <ChevronRight /></a></section></div>{creating && <div className="admin-modal-backdrop"><div className="admin-modal"><header><div><span>Credential показывается один раз</span><h2>Новый промокод</h2></div><button onClick={() => setCreating(false)}><X /></button></header><div className="admin-modal__body"><label className="admin-field"><span>Сырой код</span><input value={code} onChange={(event) => setCode(event.target.value)} placeholder="SHODITSA-2026" /></label><label className="admin-field"><span>Название</span><input value={promoTitle} onChange={(event) => setPromoTitle(event.target.value)} placeholder="Летний подарок" /></label><label className="admin-field"><span>Билетов</span><input type="number" min="1" value={reward} onChange={(event) => setReward(Number(event.target.value))} /></label><div className="admin-warning"><AlertTriangle />После создания БД хранит только HMAC hash. Потерянный код восстановить нельзя.</div></div><footer><button className="admin-btn admin-btn--secondary" onClick={() => setCreating(false)}>Отмена</button><button className="admin-btn admin-btn--primary" onClick={() => create.mutate()} disabled={!code || !promoTitle || create.isPending}>Создать код</button></footer></div></div>}</>
}

function SystemPage({ notify }: { notify: (tone: Notice['tone'], text: string) => void }) {
  const client = useQueryClient(); const health = useQuery({ queryKey: ['admin', 'health'], queryFn: adminApi.health, refetchInterval: 10_000 }); const jobs = useQuery({ queryKey: ['admin', 'jobs'], queryFn: adminApi.jobs, refetchInterval: 5_000 }); const revisions = useQuery({ queryKey: ['admin', 'revisions'], queryFn: adminApi.revisions }); const salt = useQuery({ queryKey: ['admin', 'salt'], queryFn: adminApi.dailySalt }); const challenges = useQuery({ queryKey: ['admin', 'daily-challenges'], queryFn: adminApi.dailyChallenges })
  const retry = useMutation({ mutationFn: adminApi.retryJob, onSuccess: () => { notify('success', 'Повтор поставлен в очередь'); void client.invalidateQueries({ queryKey: ['admin', 'jobs'] }) }, onError: (error) => notify('error', errorText(error)) })
  const updateSalt = useMutation({ mutationFn: async () => { const current = Number(record(salt.data).value ?? 0); const confirmCurrent = Number(prompt('Введите текущее значение daily salt', String(current))); if (confirmCurrent !== current) throw new Error('Текущее значение не совпало'); const next = Number(prompt('Новое значение')); const reason = prompt('Причина изменения'); if (!Number.isInteger(next) || !reason || !confirm('Изменение повлияет на будущие загадки. Продолжить?')) throw new Error('Действие отменено'); return adminApi.updateDailySalt(current, next, reason) }, onSuccess: () => { notify('success', 'Daily salt обновлён'); void salt.refetch() }, onError: (error) => { if (errorText(error) !== 'Действие отменено') notify('error', errorText(error)) } })
  const activate = useMutation({ mutationFn: async (revision: Record<string, unknown>) => { const rollback = revision.status === 'retired'; const reason = rollback ? prompt('Причина отката на эту ревизию') : undefined; if ((rollback && !reason?.trim()) || !confirm(rollback ? 'Откат немедленно изменит active revision. Продолжить?' : 'Активировать готовую ревизию?')) throw new Error('Действие отменено'); return adminApi.activateRevision(String(revision.id), reason?.trim()) }, onSuccess: () => { notify('success', 'Active revision обновлена'); void revisions.refetch(); void client.invalidateQueries({ queryKey: ['admin', 'dashboard'] }) }, onError: (error) => { if (errorText(error) !== 'Действие отменено') notify('error', errorText(error)) } })
  const replaceChallenge = useMutation({ mutationFn: async (challenge: Record<string, unknown>) => { const target = prompt(`ID новой карточки для ${title(challenge.puzzleDate)} (${MODE_LABEL[String(challenge.mode) as ContentMode]})`); const reason = prompt('Причина срочной замены'); if (!target?.trim() || !reason?.trim() || !confirm('Будущая загадка будет заменена. Действие попадёт в аудит. Продолжить?')) throw new Error('Действие отменено'); return adminApi.replaceDailyChallenge(String(challenge.id), target.trim(), reason.trim()) }, onSuccess: () => { notify('success', 'Будущая загадка заменена'); void challenges.refetch() }, onError: (error) => { if (errorText(error) !== 'Действие отменено') notify('error', errorText(error)) } })
  const healthRecord = record(health.data); const checks = record(healthRecord.checks); const appInfo = record(healthRecord.app)
  return <><PageHead eyebrow="Эксплуатация" title="Система" description="База данных, очередь PostgreSQL, воркеры, ревизии и игровые настройки." actions={<button className="admin-btn admin-btn--secondary" onClick={() => { void health.refetch(); void jobs.refetch(); void challenges.refetch() }}><RefreshCw />Обновить</button>} /><div className="admin-system-health"><article><span><Database /></span><div><small>PostgreSQL</small><strong>{checks.database ? 'Доступна' : 'Недоступна'}</strong></div><Status value={checks.database ? 'active' : 'failed'} /></article><article><span><BriefcaseBusiness /></span><div><small>Очередь</small><strong>{String(checks.queueDepth ?? '—')} задач</strong></div><Status value={Number(checks.queueDepth ?? 0) > 20 ? 'warning' : 'active'} /></article><article><span><ImageIcon /></span><div><small>Медиа</small><strong>{checks.mediaRootConfigured ? 'Настроено' : 'Не настроено'}</strong></div><Status value={checks.mediaRootConfigured ? 'active' : 'warning'} /></article><article><span><Boxes /></span><div><small>Версия</small><strong>{title(appInfo.version)}</strong></div><code>{title(appInfo.gitSha).slice(0, 10)}</code></article></div><div className="admin-system-grid"><section className="admin-panel"><header><div><span>PostgreSQL queue</span><h2>Фоновые задачи</h2></div></header><div className="admin-jobs">{jobs.data?.items.map((raw) => { const job = record(raw); const progress = record(job.progress); return <article key={String(job.id)}><span className="admin-list-icon">{job.type === 'music_pipeline' ? <Bot /> : job.type === 'content_revision_build' ? <Rocket /> : <BriefcaseBusiness />}</span><div><header><strong>{title(job.type)}</strong><Status value={job.status} /></header><small>{compactDate(job.createdAt)} · попытка {String(job.attempts ?? 0)}/{String(job.maxAttempts ?? 0)}</small>{job.status === 'running' && <i><b style={{ width: `${Number(progress.percent ?? 15)}%` }} /></i>}{job.safeErrorMessage && <p>{title(job.safeErrorMessage)}</p>}</div>{job.status === 'failed' && <button onClick={() => retry.mutate(String(job.id))}><RefreshCw />Повторить</button>}</article> })}</div></section><section className="admin-panel"><header><div><span>Immutable snapshots</span><h2>Ревизии контента</h2></div></header><div className="admin-revisions">{revisions.data?.items.slice(0, 12).map((raw) => { const revision = record(raw); return <article key={String(revision.id)}><span><strong>{title(revision.version)}</strong><small>{compactDate(revision.createdAt)} · {String(revision.checksumSha256).slice(0, 10)}</small></span><Status value={revision.status} />{['ready', 'retired'].includes(String(revision.status)) && <button onClick={() => activate.mutate(revision)}>{revision.status === 'retired' ? 'Откатить' : 'Активировать'}</button>}</article> })}</div></section><section className="admin-panel admin-settings-card"><header><div><span>Игровые настройки</span><h2>Daily global salt</h2></div></header><div><CircleGauge /><span><small>Текущее значение</small><strong>{String(record(salt.data).value ?? '—')}</strong></span><button className="admin-btn admin-btn--secondary" onClick={() => updateSalt.mutate()}><Settings2 />Изменить</button></div><p>Влияет только на будущую материализацию загадок. Текущая загадка дня не меняется.</p></section><section className="admin-panel"><header><div><span>Опасное действие</span><h2>Будущие загадки</h2></div></header><div className="admin-revisions">{challenges.data?.items.slice(0, 30).map((raw) => { const entry = record(raw); const challenge = record(entry.challenge); return <article key={String(challenge.id)}><span><strong>{title(entry.titleRu)}</strong><small>{title(challenge.puzzleDate)} · {MODE_LABEL[String(challenge.mode) as ContentMode]} · {title(challenge.period)}</small></span><button onClick={() => replaceChallenge.mutate(challenge)}>Заменить</button></article> })}</div>{!challenges.data?.items.length && <p>Будущих материализованных загадок нет.</p>}</section></div></>
}

function IntegrationsPage({ notify }: { notify: (tone: Notice['tone'], text: string) => void }) {
  const client = useQueryClient(); const integrations = useQuery({ queryKey: ['admin', 'integrations'], queryFn: adminApi.integrations })
  const [values, setValues] = useState<Record<string, string>>({})
  const save = useMutation({
    mutationFn: ({ key, value }: { key: string; value: string }) => adminApi.saveIntegration(key, value),
    onSuccess: (_, variables) => { setValues((current) => ({ ...current, [variables.key]: '' })); notify('success', 'Настройка зашифрована и сохранена'); void client.invalidateQueries({ queryKey: ['admin', 'integrations'] }) },
    onError: (error) => notify('error', errorText(error)),
  })
  const remove = useMutation({
    mutationFn: async (key: string) => { if (!confirm('Удалить сохранённое значение? Если есть переменная окружения, снова будет использоваться она.')) throw new Error('Действие отменено'); return adminApi.deleteIntegration(key) },
    onSuccess: () => { notify('info', 'Сохранённое значение удалено'); void client.invalidateQueries({ queryKey: ['admin', 'integrations'] }) },
    onError: (error) => { if (errorText(error) !== 'Действие отменено') notify('error', errorText(error)) },
  })
  return <><PageHead eyebrow="Зашифрованное хранилище" title="API-интеграции" description="Все внешние ключи музыкального и кино-пайплайнов в одном месте. Исходные значения никогда не возвращаются в браузер." actions={<button className="admin-btn admin-btn--secondary" onClick={() => void integrations.refetch()}><RefreshCw />Обновить</button>} />
    <div className="admin-integration-banner"><ShieldCheck /><div><strong>AES-256-GCM · write-only</strong><p>После сохранения сервер показывает только маску и источник настройки. Worker получает расшифрованное значение только перед запуском дочернего процесса.</p></div></div>
    <div className="admin-integrations-grid">{integrations.isLoading ? <Loading /> : integrations.data?.items.map((raw) => { const item = record(raw); const value = values[String(item.key)] ?? ''; const busy = save.isPending && save.variables?.key === item.key; return <section key={String(item.key)} className="admin-integration-card"><header><span><KeyRound /></span><div><small>{title(item.provider)}</small><h2>{title(item.title)}</h2></div><Status value={item.configured ? 'active' : item.required ? 'failed' : 'neutral'}>{item.configured ? 'Настроено' : item.required ? 'Обязательно' : 'Необязательно'}</Status></header><p>{title(item.description)}</p><div className="admin-integration-current"><span>Текущее значение</span><code>{item.maskedValue || 'Не задано'}</code><small>{item.source === 'admin' ? 'Сохранено в зашифрованном хранилище' : item.source === 'environment' ? 'Получено из переменной окружения' : 'Провайдер будет пропущен или использует публичный режим'}</small></div><label className="admin-field"><span>Новое значение</span><input type={item.secret ? 'password' : 'text'} autoComplete="new-password" value={value} onChange={(event) => setValues((current) => ({ ...current, [String(item.key)]: event.target.value }))} placeholder={item.configured ? 'Введите только для замены' : 'Вставьте значение'} /></label><footer><button className="admin-btn admin-btn--primary" disabled={!value.trim() || busy} onClick={() => save.mutate({ key: String(item.key), value: value.trim() })}><Save />Сохранить</button>{item.source === 'admin' && <button className="admin-btn admin-btn--secondary" onClick={() => remove.mutate(String(item.key))}><Trash2 />Удалить override</button>}</footer></section> })}</div>
  </>
}

function AuditPage() {
  const audit = useQuery({ queryKey: ['admin', 'audit'], queryFn: adminApi.audit })
  return <><PageHead eyebrow="Только чтение" title="Журнал администратора" description="Неизменяемый след всех административных мутаций и экспортов." actions={<button className="admin-btn admin-btn--secondary" onClick={() => void audit.refetch()}><RefreshCw />Обновить</button>} />{audit.isLoading ? <Loading /> : <div className="admin-table-wrap"><table className="admin-table"><thead><tr><th>Время</th><th>Действие</th><th>Сущность</th><th>ID</th><th>Результат</th><th>Request ID</th></tr></thead><tbody>{audit.data?.items.map((raw) => { const item = record(raw); return <tr key={String(item.id)}><td>{formatDate(item.createdAt)}</td><td><strong>{title(item.action)}</strong>{item.reason && <small>{title(item.reason)}</small>}</td><td>{title(item.entityType)}</td><td><code>{title(item.entityId)}</code></td><td><Status value={item.result} /></td><td><code>{title(item.requestId)}</code></td></tr> })}</tbody></table></div>}</>
}

const MENU: Array<{ id: Section; label: string; icon: typeof LayoutDashboard }> = [
  { id: 'dashboard', label: 'Обзор', icon: LayoutDashboard }, { id: 'content', label: 'Карточки', icon: Boxes },
  { id: 'reports', label: 'Баг-репорты', icon: Bug }, { id: 'pipelines', label: 'ИИ-пайплайны', icon: WandSparkles },
  { id: 'users', label: 'Пользователи', icon: UsersRound }, { id: 'events', label: 'События', icon: Activity },
  { id: 'quality', label: 'Контроль качества', icon: ListChecks }, { id: 'economy', label: 'Экономика', icon: CircleDollarSign },
  { id: 'integrations', label: 'API-интеграции', icon: KeyRound }, { id: 'system', label: 'Система', icon: Settings2 }, { id: 'audit', label: 'Журнал администратора', icon: FileClock },
]

export default function AdminApp() {
  const route = useRoute(); const [notices, setNotices] = useState<Notice[]>([]); const [global, setGlobal] = useState(''); const searchRef = useRef<HTMLInputElement>(null)
  const me = useQuery({ queryKey: ['admin', 'me'], queryFn: adminApi.me, retry: false }); const access = useQuery({ queryKey: ['admin', 'access'], queryFn: adminApi.health, enabled: me.data?.user.role === 'admin', retry: false }); const jobs = useQuery({ queryKey: ['admin', 'jobs', 'header'], queryFn: adminApi.jobs, enabled: access.isSuccess, refetchInterval: 5_000 })
  const globalResults = useQuery({ queryKey: ['admin', 'global-search', global], enabled: global.trim().length >= 2, queryFn: async () => { const [content, users, reports] = await Promise.all([adminApi.contentItems({ q: global, limit: 6 }), adminApi.users({ q: global, limit: 5 }), adminApi.reports({ q: global, limit: 5 })]); return { content: content.items, users: users.items, reports: reports.items } } })
  const notify = (tone: Notice['tone'], text: string) => { const id = crypto.randomUUID(); setNotices((current) => [...current, { id, tone, text }]); setTimeout(() => setNotices((current) => current.filter((notice) => notice.id !== id)), 4500) }
  useEffect(() => { const shortcut = (event: KeyboardEvent) => { if ((event.ctrlKey || event.metaKey) && event.key === 'k') { event.preventDefault(); searchRef.current?.focus() } }; addEventListener('keydown', shortcut); return () => removeEventListener('keydown', shortcut) }, [])
  if (me.isLoading || (me.data?.user.role === 'admin' && access.isLoading)) return <div className="admin-gate"><div className="admin-gate__brand"><img src="/images/logo.svg" alt="Сходится!" /><LoaderCircle /></div><p>Проверяем административный доступ…</p></div>
  if (me.error || me.data?.user.role !== 'admin' || access.error) return <div className="admin-gate admin-gate--denied"><span><ShieldCheck /></span><h1>Административный доступ закрыт</h1><p>Войдите как разрешённый владелец проекта. Сервер дополнительно проверяет роль, UUID и email.</p><a className="admin-btn admin-btn--primary" href="/">Вернуться в игру</a>{(me.error || access.error) && <code>{errorText(me.error || access.error)}</code>}</div>
  const activeJobs = jobs.data?.items.filter((item) => ['queued', 'running'].includes(String(item.status))).length ?? 0
  return <div className="admin-root"><aside className="admin-sidebar"><a className="admin-brand" href="/" aria-label="Сходится! — игра"><img src="/images/logo.svg" alt="Сходится!" /><span>ADMIN</span></a><nav>{MENU.map(({ id, label, icon: Icon }) => <button key={id} className={route.section === id ? 'is-active' : ''} onClick={() => route.navigate(id)}><Icon /><span>{label}</span>{id === 'reports' && <i />}</button>)}</nav><footer><div className="admin-admin-card"><span>{title(me.data.user.name).slice(0, 1)}</span><div><strong>{title(me.data.user.name)}</strong><small>{me.data.user.email}</small></div></div><a href="/"><ArrowLeft />Вернуться в игру</a></footer></aside><div className="admin-main"><header className="admin-topbar"><div className="admin-global-search"><Search /><input ref={searchRef} value={global} onChange={(event) => setGlobal(event.target.value)} placeholder="Глобальный поиск" /><kbd>Ctrl K</kbd>{globalResults.data && global.trim().length >= 2 && <div className="admin-search-results"><section><span>Карточки</span>{globalResults.data.content.map((item: AdminContentListItem) => <button key={item.id} onClick={() => { route.navigate('content', item.id); setGlobal('') }}><Boxes /><span><strong>{item.titleRu}</strong><small>{MODE_LABEL[item.mode]} · {item.id}</small></span></button>)}</section><section><span>Пользователи</span>{globalResults.data.users.map((item) => <button key={item.id} onClick={() => { route.navigate('users', item.id); setGlobal('') }}><UserRound /><span><strong>{item.isAnonymous ? 'Гость' : item.displayName || item.name}</strong><small>{item.email}</small></span></button>)}</section><section><span>Репорты</span>{globalResults.data.reports.map((entry) => <button key={String(entry.report.id)} onClick={() => { route.navigate('reports', String(entry.report.id)); setGlobal('') }}><Bug /><span><strong>{REPORT_REASON[String(entry.report.reason)]}</strong><small>{entry.titleRu}</small></span></button>)}</section></div>}</div><button className="admin-job-indicator" onClick={() => route.navigate('system')}><Activity />{activeJobs ? <><strong>{activeJobs}</strong><span>задач выполняется</span></> : <span>Фоновых задач нет</span>}</button><div className="admin-topbar-user"><span>{title(me.data.user.name).slice(0, 1)}</span><div><strong>{title(me.data.user.name)}</strong><small>Asia/Almaty</small></div></div></header><main className="admin-content">
    {route.section === 'dashboard' && <DashboardPage navigate={route.navigate} />}
    {route.section === 'content' && <ContentPage selectedId={route.id} navigate={route.navigate} notify={notify} />}
    {route.section === 'reports' && <ReportsPage selectedId={route.id} navigate={route.navigate} notify={notify} />}
    {route.section === 'pipelines' && <PipelinesPage selectedId={route.id} navigate={route.navigate} notify={notify} />}
    {route.section === 'users' && <UsersPage selectedId={route.id} navigate={route.navigate} notify={notify} />}
    {route.section === 'events' && <EventsPage sessionId={route.id} />}
    {route.section === 'quality' && <QualityPage navigate={route.navigate} notify={notify} />}
    {route.section === 'economy' && <EconomyPage notify={notify} />}
    {route.section === 'integrations' && <IntegrationsPage notify={notify} />}
    {route.section === 'system' && <SystemPage notify={notify} />}
    {route.section === 'audit' && <AuditPage />}
  </main></div><div className="admin-notices" aria-live="polite">{notices.map((notice) => <div key={notice.id} className={`admin-notice admin-notice--${notice.tone}`}>{notice.tone === 'success' ? <Check /> : notice.tone === 'error' ? <AlertTriangle /> : <Activity />}<span>{notice.text}</span><button onClick={() => setNotices((current) => current.filter((item) => item.id !== notice.id))}><X /></button></div>)}</div></div>
}

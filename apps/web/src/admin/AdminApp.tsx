import { useEffect, useId, useMemo, useRef, useState, type ReactNode } from 'react'
import { useInfiniteQuery, useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import {
  Activity, AlertTriangle, Archive, ArrowLeft, BadgeCheck, Bot, Boxes, BriefcaseBusiness, Bug,
  Check, ChevronDown, ChevronLeft, ChevronRight, CircleDollarSign, CircleGauge, Clapperboard, Clock3, Copy, Database, Eye,
  Download, FileClock, FileJson, Filter, HeartPulse, History, Image as ImageIcon, KeyRound, LayoutDashboard, ListChecks,
  LayoutTemplate, LoaderCircle, LockKeyhole, Menu, MoreHorizontal, PanelRightClose, Play, Plus, RefreshCw, Rocket, Upload,
  Save, Search, Settings2, ShieldCheck, Sparkles, SquarePen, Tags, Ticket, Trash2, UserRound,
  UsersRound, WandSparkles, X,
} from 'lucide-react'
import type { AdminContentListItem, AdminContentTag, AdminDashboardResponse, AdminTimelineEvent, ContentMode } from '@shoditsa/contracts'
import { AdminApiError, adminApi, type AdminItemDetail } from './api'
import { parseAnimeList, parseArtistList, parseMovieList } from './pipeline-manual-input'
import { GameBuilderPage } from './GameBuilderPage'
import './admin.css'

type Section = 'dashboard' | 'content' | 'builder' | 'reports' | 'pipelines' | 'users' | 'events' | 'quality' | 'economy' | 'integrations' | 'system' | 'audit'
type Notice = { id: string; tone: 'success' | 'error' | 'info'; text: string }

function TagPicker({ tags, value, onChange, label, onCreate, compact = false, disabled = false }: { tags: AdminContentTag[]; value: string[]; onChange: (ids: string[]) => void; label: string; onCreate?: (name: string) => Promise<AdminContentTag>; compact?: boolean; disabled?: boolean }) {
  const [query, setQuery] = useState('')
  const [creating, setCreating] = useState(false)
  const listId = useId().replace(/:/g, '')
  const selected = new Set(value)
  const available = tags.filter((tag) => !selected.has(tag.id))
  const commit = async () => {
    const name = query.trim()
    if (!name || disabled || creating) return
    const normalized = name.toLocaleLowerCase('ru-RU')
    const found = available.find((tag) => tag.name.toLocaleLowerCase('ru-RU') === normalized)
      ?? available.find((tag) => tag.name.toLocaleLowerCase('ru-RU').startsWith(normalized))
    if (found) { onChange([...value, found.id]); setQuery(''); return }
    if (!onCreate) return
    setCreating(true)
    try { const created = await onCreate(name); onChange([...value, created.id]); setQuery('') } finally { setCreating(false) }
  }
  return <div className={`admin-tag-picker ${compact ? 'admin-tag-picker--compact' : ''}`}><span>{label}</span><div className="admin-tag-picker__control">{value.map((id) => { const tag = tags.find((entry) => entry.id === id); return tag ? <button key={id} type="button" style={{ borderColor: tag.color }} disabled={disabled} onClick={() => onChange(value.filter((entry) => entry !== id))}>{tag.name}<X /></button> : null })}<input list={listId} value={query} disabled={disabled || creating} onChange={(event) => setQuery(event.target.value)} onKeyDown={(event) => { if (event.key === 'Enter' || event.key === ',') { event.preventDefault(); void commit() } }} onBlur={() => { if (available.some((tag) => tag.name.toLocaleLowerCase('ru-RU') === query.trim().toLocaleLowerCase('ru-RU'))) void commit() }} placeholder={value.length ? 'Ещё тег…' : 'Введите тег…'} /><datalist id={listId}>{available.map((tag) => <option key={tag.id} value={tag.name}>{tag.itemsCount == null ? tag.name : `${tag.name} · ${tag.itemsCount}`}</option>)}</datalist></div></div>
}

const TagList = ({ tags }: { tags: AdminContentTag[] }) => <span className="admin-tags">{tags.map((tag) => <span key={tag.id} style={{ borderColor: tag.color }}>{tag.name}</span>)}</span>

const MODES: Array<{ value: ContentMode; label: string }> = [
  { value: 'movie', label: 'Кино' }, { value: 'series', label: 'Сериалы' }, { value: 'anime', label: 'Аниме' },
  { value: 'game', label: 'Игры' }, { value: 'music', label: 'Музыка' }, { value: 'diagnosis', label: 'Диагнозы' },
]
const MODE_LABEL = Object.fromEntries(MODES.map((mode) => [mode.value, mode.label])) as Record<ContentMode, string>
type ContentFieldFilter = string
type ContentFieldOption = { value: string; label: string }
type ContentFieldGroup = { label: string; options: ContentFieldOption[] }

const CONTENT_FIELD_GROUPS: ContentFieldGroup[] = [
  {
    label: 'По всей карточке',
    options: [
      { value: 'all', label: 'Все поля карточки и метаданные' },
      { value: 'title', label: 'Все варианты названия' },
      { value: 'id', label: 'id — внутренний ID' },
      { value: 'mode', label: 'mode — категория' },
      { value: 'publicationStatus', label: 'publicationStatus — статус в игре' },
      { value: 'changeSource', label: 'changeSource — источник изменения' },
      { value: 'pipeline', label: 'pipeline — пайплайн' },
      { value: 'tags', label: 'tags — теги' },
      { value: 'allHints', label: 'Все подсказки, описание и факты' },
      { value: 'reports', label: 'reports — количество репортов' },
      { value: 'issues', label: 'issues — количество проблем' },
    ],
  },
  {
    label: 'Общие поля payload',
    options: [
      { value: 'titleRu', label: 'titleRu — русское название' },
      { value: 'titleOriginal', label: 'titleOriginal — оригинальное название' },
      { value: 'alternativeTitles', label: 'alternativeTitles — другие названия' },
      { value: 'year', label: 'year — год' },
      { value: 'activityStartYear', label: 'activityStartYear — начало активности' },
      { value: 'endYear', label: 'endYear — год окончания' },
      { value: 'releaseDate', label: 'releaseDate — дата выхода' },
      { value: 'countries', label: 'countries — страны' },
      { value: 'originalLanguage', label: 'originalLanguage — язык оригинала' },
      { value: 'genres', label: 'genres — жанры' },
      { value: 'plotHint', label: 'plotHint — сюжетная подсказка' },
      { value: 'description', label: 'description — описание' },
      { value: 'shortDescription', label: 'shortDescription — краткое описание' },
      { value: 'slogan', label: 'slogan — слоган' },
      { value: 'facts', label: 'facts — факты' },
      { value: 'allowedInGame', label: 'allowedInGame — допуск в игру' },
    ],
  },
  {
    label: 'Изображения payload',
    options: [
      { value: 'posterUrl', label: 'posterUrl — постер' },
      { value: 'headerUrl', label: 'headerUrl — обложка' },
      { value: 'backdropUrl', label: 'backdropUrl — фон' },
      { value: 'screenshots', label: 'screenshots — скриншоты' },
    ],
  },
  {
    label: 'Кино и сериалы payload',
    options: [
      { value: 'runtime', label: 'runtime — длительность' },
      { value: 'runtimeMinutes', label: 'runtimeMinutes — длительность, мин.' },
      { value: 'ageRating', label: 'ageRating — возрастной рейтинг' },
      { value: 'budget', label: 'budget — бюджет' },
      { value: 'directors', label: 'directors — режиссёры' },
      { value: 'writers', label: 'writers — сценаристы' },
      { value: 'cast', label: 'cast — актёры' },
      { value: 'supportingCast', label: 'supportingCast — второй план' },
      { value: 'kinopoiskId', label: 'kinopoiskId — ID Кинопоиска' },
      { value: 'imdbId', label: 'imdbId — ID IMDb' },
      { value: 'ratings', label: 'ratings — рейтинги' },
      { value: 'awards', label: 'awards — награды' },
      { value: 'episodes', label: 'episodes — эпизоды' },
      { value: 'seasonsCount', label: 'seasonsCount — сезоны' },
      { value: 'seriesStatus', label: 'seriesStatus — статус сериала' },
      { value: 'showrunners', label: 'showrunners — шоураннеры' },
    ],
  },
  {
    label: 'Аниме payload',
    options: [
      { value: 'kind', label: 'kind — формат аниме' },
      { value: 'status', label: 'status — статус аниме' },
      { value: 'episodesAired', label: 'episodesAired — вышедшие эпизоды' },
      { value: 'source', label: 'source — первоисточник аниме' },
      { value: 'studios', label: 'studios — студии' },
      { value: 'shikimoriId', label: 'shikimoriId — ID Shikimori' },
      { value: 'shikimoriScore', label: 'shikimoriScore — рейтинг Shikimori' },
      { value: 'shikimoriUrl', label: 'shikimoriUrl — ссылка Shikimori' },
    ],
  },
  {
    label: 'Игры payload',
    options: [
      { value: 'developers', label: 'developers — разработчики' },
      { value: 'publishers', label: 'publishers — издатели' },
      { value: 'platforms', label: 'platforms — платформы' },
      { value: 'steamCategories', label: 'steamCategories — категории Steam' },
      { value: 'steamTags', label: 'steamTags — теги Steam' },
      { value: 'steamAppId', label: 'steamAppId — ID Steam' },
      { value: 'steamUrl', label: 'steamUrl — ссылка Steam' },
      { value: 'price', label: 'price — цена' },
      { value: 'metacritic', label: 'metacritic — рейтинг Metacritic' },
    ],
  },
  {
    label: 'Музыка payload',
    options: [
      { value: 'canonicalId', label: 'canonicalId — канонический ID' },
      { value: 'aliases', label: 'aliases — псевдонимы' },
      { value: 'gameTier', label: 'gameTier — уровень узнаваемости' },
      { value: 'contentStatus', label: 'contentStatus — готовность контента' },
      { value: 'musicIsActive', label: 'musicIsActive — активность исполнителя' },
      { value: 'musicOrigin', label: 'musicOrigin — происхождение' },
      { value: 'musicType', label: 'musicType — тип исполнителя' },
      { value: 'topTracks', label: 'topTracks — популярные треки' },
      { value: 'topAlbums', label: 'topAlbums — популярные альбомы' },
      { value: 'similarArtists', label: 'similarArtists — похожие исполнители' },
      { value: 'members', label: 'members — участники' },
      { value: 'associatedActs', label: 'associatedActs — связанные проекты' },
      { value: 'musicLinks', label: 'musicLinks — ссылки' },
      { value: 'dataQuality', label: 'dataQuality — качество данных' },
    ],
  },
  {
    label: 'Диагнозы payload',
    options: [
      { value: 'icd10', label: 'icd10 — МКБ-10' },
      { value: 'icdGroup', label: 'icdGroup — группа МКБ' },
      { value: 'bodySystems', label: 'bodySystems — системы организма' },
      { value: 'diseaseTypes', label: 'diseaseTypes — типы заболевания' },
      { value: 'course', label: 'course — течение' },
      { value: 'contagiousness', label: 'contagiousness — заразность' },
      { value: 'symptoms', label: 'symptoms — симптомы' },
      { value: 'keySymptoms', label: 'keySymptoms — ключевые симптомы' },
      { value: 'diagnostics', label: 'diagnostics — диагностика' },
      { value: 'risks', label: 'risks — риски' },
      { value: 'severity', label: 'severity — тяжесть' },
      { value: 'urgency', label: 'urgency — срочность' },
      { value: 'safetyDisclaimer', label: 'safetyDisclaimer — предупреждение' },
      { value: 'caseVignettes', label: 'caseVignettes — клинические случаи' },
    ],
  },
]
const CONTENT_FIELD_FILTERS = new Set(CONTENT_FIELD_GROUPS.flatMap((group) => group.options.map((option) => option.value)))
const CONTENT_NUMERIC_FILTER_FIELDS = new Set([
  'reports', 'issues', 'year', 'activityStartYear', 'endYear', 'runtime', 'runtimeMinutes',
  'kinopoiskId', 'episodes', 'seasonsCount', 'episodesAired', 'animeEpisodesAired',
  'shikimoriId', 'shikimoriScore', 'steamAppId', 'metacritic',
])
const CONTENT_FIELD_OPERATORS = [
  { value: 'contains', label: 'Содержит' },
  { value: 'not_contains', label: 'Не содержит' },
  { value: 'equals', label: 'Равно (=)' },
  { value: 'not_equals', label: 'Не равно (≠)' },
  { value: 'starts_with', label: 'Начинается с' },
  { value: 'ends_with', label: 'Заканчивается на' },
  { value: 'empty', label: 'Пустое' },
  { value: 'not_empty', label: 'Не пустое' },
  { value: 'gt', label: 'Больше (>)' },
  { value: 'gte', label: 'Больше или равно (≥)' },
  { value: 'lt', label: 'Меньше (<)' },
  { value: 'lte', label: 'Меньше или равно (≤)' },
  { value: 'is_true', label: 'Истина / Да' },
  { value: 'is_false', label: 'Ложь / Нет' },
] as const
type ContentFieldOperator = typeof CONTENT_FIELD_OPERATORS[number]['value']
const CONTENT_FIELD_OPERATOR_VALUES = new Set<string>(CONTENT_FIELD_OPERATORS.map((operator) => operator.value))
const CONTENT_FIELD_NO_VALUE_OPERATORS = new Set<ContentFieldOperator>(['empty', 'not_empty', 'is_true', 'is_false'])
const CONTENT_FIELD_COMPARISON_OPERATORS = new Set<ContentFieldOperator>(['gt', 'gte', 'lt', 'lte'])
const CONTENT_LENGTH_OPERATOR_LABELS: Partial<Record<ContentFieldOperator, string>> = {
  gt: 'Длина больше (>)', gte: 'Длина не меньше (≥)', lt: 'Длина меньше (<)', lte: 'Длина не больше (≤)',
}
const contentFieldUsesLength = (field: string, operator: ContentFieldOperator) => CONTENT_FIELD_COMPARISON_OPERATORS.has(operator) && !CONTENT_NUMERIC_FILTER_FIELDS.has(field)
const contentFieldOperatorLabel = (operator: ContentFieldOperator, field?: string) => field && contentFieldUsesLength(field, operator)
  ? CONTENT_LENGTH_OPERATOR_LABELS[operator] ?? operator
  : CONTENT_FIELD_OPERATORS.find((entry) => entry.value === operator)?.label ?? operator
const REPORT_REASON: Record<string, string> = {
  wrong_fact: 'Неверный факт', disputed_comparison: 'Спорное сравнение', title_not_found: 'Не принимается ответ', bad_hint: 'Плохая подсказка',
  bad_image: 'Плохое изображение', duplicate_card: 'Дубликат', typo_or_translation: 'Опечатка / перевод', technical_error: 'Техническая ошибка', other: 'Другое',
}
const STATUS_LABEL: Record<string, string> = {
  open: 'Новый', in_progress: 'В работе', resolved: 'Исправлен', dismissed: 'Отклонён', duplicate: 'Дубликат',
  queued: 'В очереди', running: 'Выполняется', completed: 'Готово', failed: 'Ошибка', review_required: 'Нужна проверка',
  partially_failed: 'Частично с ошибками', approved: 'Одобрено', staged: 'В рабочей версии', published: 'Опубликовано', partially_published: 'Частично опубликовано', cancelled: 'Отменено',
  create: 'Добавить', update: 'Изменить', unchanged: 'Без изменений', conflict: 'Конфликт', invalid: 'Ошибка',
  update_available: 'Доступно обновление', building: 'Собирается', active: 'Активно', ready: 'Готово', retired: 'Архив',
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
      : raw.startsWith('theaudiodb_') ? 'TheAudioDB'
        : raw.startsWith('spotify_') ? 'Spotify'
          : raw.startsWith('AI reviewer') || raw.startsWith('OpenAI') || raw.includes('Country, region, or territory') ? 'OpenAI' : null
    if (provider) { if (!providers.has(provider)) labels.push(`${provider} временно недоступен — использованы резервные источники`); providers.add(provider); continue }
    if (raw === 'hint_answer_leak_risk') { labels.push('Подсказка может раскрывать ответ — требуется ручная правка'); continue }
    labels.push(raw === 'conflict_canonical_name' ? 'Найдены разные варианты имени — проверьте основное название'
      : raw === 'conflict_country' ? 'Источники расходятся по стране'
        : raw === 'conflict_begin_year' ? 'Источники расходятся по году начала карьеры' : raw)
  }
  return [...new Set(labels)]
}
const errorText = (error: unknown) => error instanceof AdminApiError ? `${error.message}${error.code ? ` · ${error.code}` : ''}` : error instanceof Error ? error.message : 'Неизвестная ошибка'
type PipelineApprovalFailure = { invalidCount: number; items: Array<{ itemId: string; entityKey: string; message: string; fieldErrors: Array<{ field: string; message: string }> }> }
const pipelineApprovalFailure = (error: unknown): PipelineApprovalFailure | null => {
  if (!(error instanceof AdminApiError) || error.code !== 'PIPELINE_ITEMS_INVALID') return null
  const items = array(error.details.items).map((raw) => {
    const item = record(raw)
    return {
      itemId: String(item.itemId ?? ''),
      entityKey: String(item.entityKey ?? ''),
      message: String(item.message ?? 'Результат нельзя применить'),
      fieldErrors: array(item.fieldErrors).map((fieldRaw) => {
        const field = record(fieldRaw)
        return { field: String(field.field ?? ''), message: String(field.message ?? '') }
      }),
    }
  })
  return { invalidCount: Number(error.details.invalidCount ?? items.length), items }
}
const pipelineApprovalErrorText = (error: unknown) => {
  const failure = pipelineApprovalFailure(error)
  if (!failure?.items.length) return errorText(error)
  const first = failure.items[0]
  const field = first.fieldErrors[0]
  return `Не удалось применить: ${first.entityKey || first.itemId} — ${field ? `${field.field}: ${field.message}` : first.message}${failure.invalidCount > 1 ? ` (и ещё ${failure.invalidCount - 1})` : ''}`
}
function useDebouncedValue<T>(value: T, delayMs: number) {
  const [debounced, setDebounced] = useState(value)
  useEffect(() => {
    const timeout = window.setTimeout(() => setDebounced(value), delayMs)
    return () => window.clearTimeout(timeout)
  }, [delayMs, value])
  return debounced
}
const statusTone = (status: unknown) => ['failed', 'critical', 'blocked', 'dismissed', 'conflict', 'invalid'].includes(String(status)) ? 'danger'
  : ['running', 'in_progress', 'warning', 'partially_failed', 'building', 'update_available'].includes(String(status)) ? 'warning'
    : ['completed', 'published', 'resolved', 'active', 'ready'].includes(String(status)) ? 'success' : 'neutral'
const asContentMode = (value: unknown, fallback: ContentMode): ContentMode => typeof value === 'string' && value in MODE_LABEL ? value as ContentMode : fallback

const sectionFromPath = (): { section: Section; id: string | null; search: string } => {
  const parts = window.location.pathname.replace(/^\/admin\/?/, '').split('/').filter(Boolean)
  const candidate = (parts[0] || 'dashboard') as Section
  const allowed: Section[] = ['dashboard', 'content', 'builder', 'reports', 'pipelines', 'users', 'events', 'quality', 'economy', 'integrations', 'system', 'audit']
  return {
    section: allowed.includes(candidate) ? candidate : 'dashboard',
    id: parts[1] ? decodeURIComponent(parts.slice(1).join('/')) : null,
    search: window.location.search,
  }
}

function useRoute() {
  const [route, setRoute] = useState(sectionFromPath)
  useEffect(() => { const onPop = () => setRoute(sectionFromPath()); addEventListener('popstate', onPop); return () => removeEventListener('popstate', onPop) }, [])
  const navigate = (section: Section, id?: string | null, search = '') => {
    const normalizedSearch = search ? (search.startsWith('?') ? search : `?${search}`) : ''
    const url = `/admin/${section}${id ? `/${encodeURIComponent(id)}` : ''}${normalizedSearch}`
    history.pushState({}, '', url); setRoute({ section, id: id ?? null, search: normalizedSearch }); scrollTo({ top: 0 })
  }
  const navigateContentMode = (mode: ContentMode) => {
    const search = `?mode=${encodeURIComponent(mode)}`
    history.pushState({}, '', `/admin/content${search}`)
    setRoute({ section: 'content', id: null, search })
    scrollTo({ top: 0 })
  }
  return { ...route, navigate, navigateContentMode }
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

function ContentRevisionControl({ activeRevision, navigate, notify }: {
  activeRevision: AdminDashboardResponse['activeRevision']
  navigate: (section: Section, id?: string | null) => void
  notify: (tone: Notice['tone'], text: string) => void
}) {
  const client = useQueryClient()
  const release = useQuery({ queryKey: ['admin', 'release-content'], queryFn: adminApi.releaseContent, refetchInterval: 5_000 })
  const revisions = useQuery({ queryKey: ['admin', 'revisions'], queryFn: adminApi.revisions, refetchInterval: 10_000 })
  const workspace = useQuery({ queryKey: ['admin', 'workspace'], queryFn: adminApi.workspace, refetchInterval: 5_000 })
  const refreshContentState = () => {
    void client.invalidateQueries({ queryKey: ['admin', 'release-content'] })
    void client.invalidateQueries({ queryKey: ['admin', 'revisions'] })
    void client.invalidateQueries({ queryKey: ['admin', 'dashboard'] })
    void client.invalidateQueries({ queryKey: ['admin', 'workspace'] })
  }
  const buildRelease = useMutation({
    mutationFn: async () => {
      const preview = release.data?.preview
      if (!preview || !confirm(`Создать безопасную ревизию из текущего релиза?\n\nОбновится: ${preview.updated}\nДобавится: ${preview.added}\nСохранится только из БД: ${preview.preserved}\nУдалится: 0\n\nАктивный контент не изменится до отдельной активации.`)) throw new Error('Действие отменено')
      return adminApi.buildReleaseContent()
    },
    onSuccess: () => { notify('info', 'Сборка ревизии из релиза поставлена в очередь'); refreshContentState(); void client.invalidateQueries({ queryKey: ['admin', 'jobs'] }) },
    onError: (error) => { if (errorText(error) !== 'Действие отменено') notify('error', errorText(error)) },
  })
  const activateRevision = useMutation({
    mutationFn: async (revision: Record<string, unknown>) => {
      const rollback = revision.status === 'retired'
      const reason = rollback ? prompt('Причина отката на эту ревизию') : undefined
      if ((rollback && !reason?.trim()) || !confirm(rollback ? 'Откат немедленно изменит активный игровой контент. Продолжить?' : 'Активировать эту ревизию как игровой контент?')) throw new Error('Действие отменено')
      return adminApi.activateRevision(String(revision.id), reason?.trim())
    },
    onSuccess: () => { notify('success', 'Активная ревизия обновлена'); refreshContentState() },
    onError: (error) => { if (errorText(error) !== 'Действие отменено') notify('error', errorText(error)) },
  })
  const validateWorkspace = useMutation({
    mutationFn: adminApi.validateWorkspace,
    onSuccess: (data) => { refreshContentState(); notify(Number(data.errors ?? 0) ? 'error' : 'success', Number(data.errors ?? 0) ? `Найдено ошибок: ${data.errors}` : `Проверка завершена · предупреждений: ${data.warnings ?? 0}`) },
    onError: (error) => notify('error', errorText(error)),
  })
  const buildWorkspace = useMutation({
    mutationFn: adminApi.buildWorkspace,
    onSuccess: () => { notify('info', 'Сборка рабочей ревизии поставлена в очередь'); refreshContentState(); void client.invalidateQueries({ queryKey: ['admin', 'jobs'] }) },
    onError: (error) => notify('error', errorText(error)),
  })
  const activateWorkspace = useMutation({
    mutationFn: adminApi.activateWorkspace,
    onSuccess: () => { notify('success', 'Рабочая ревизия опубликована'); refreshContentState() },
    onError: (error) => notify('error', errorText(error)),
  })
  const releaseState = release.data?.state
  const releaseLabel = releaseState === 'active' ? 'Каталог релиза активен' : releaseState === 'ready' ? 'Ревизия готова к активации' : releaseState === 'building' ? 'Ревизия собирается' : releaseState === 'failed' ? 'Сборка завершилась ошибкой' : 'Доступно обновление из релиза'
  const workspaceData = workspace.data
  return <section className="admin-panel admin-revision-control"><header><div><span>Управление контентом</span><h2>Ревизии и публикация</h2></div><button onClick={() => { void release.refetch(); void revisions.refetch(); void workspace.refetch() }}>Обновить <RefreshCw /></button></header>
    <div className="admin-revision-summary">
      <div><small>Активная ревизия БД</small><strong>{activeRevision?.version ?? 'Не определена'}</strong><code>{String(release.data?.activeRevision?.checksumSha256 ?? '').slice(0, 12) || '—'}</code></div>
      <div><small>Безопасное наложение релиза</small><strong>{release.isLoading ? 'Проверяем…' : release.error ? 'Недоступно' : releaseLabel}</strong><code>{release.data ? `${release.data.release.gitSha.slice(0, 10)} · ${release.data.release.totalItems.toLocaleString('ru-RU')} в релизе → ${release.data.preview.finalItems.toLocaleString('ru-RU')} в ревизии` : '—'}</code></div>
      <div className="admin-revision-summary__action"><Status value={releaseState ?? (release.error ? 'failed' : 'neutral')} />{release.data?.updateAvailable && <button className="admin-btn admin-btn--primary" disabled={buildRelease.isPending} onClick={() => buildRelease.mutate()}><Rocket />{releaseState === 'failed' ? 'Повторить безопасную сборку' : 'Создать безопасную ревизию'}</button>}</div>
    </div>
    {release.data && <div className="admin-release-preview"><span><small>Будет обновлено</small><strong>{release.data.preview.updated.toLocaleString('ru-RU')}</strong></span><span><small>Будет добавлено</small><strong>{release.data.preview.added.toLocaleString('ru-RU')}</strong></span><span><small>Сохранится из БД</small><strong>{release.data.preview.preserved.toLocaleString('ru-RU')}</strong></span><span className="is-safe"><small>Будет удалено</small><strong>0</strong></span><p><ShieldCheck />Совпадающие ID обновляются из релиза; отсутствующие в JSON карточки копируются из активной ревизии без изменений.</p></div>}
    {release.error && <ErrorState error={release.error} retry={() => void release.refetch()} />}
    <div className="admin-revision-columns">
      <div className="admin-revision-workspace"><header><span><strong>Рабочая версия</strong><small>Ручные правки карточек</small></span><Status value={workspaceData?.status} /></header><div><span><small>Изменений</small><strong>{workspaceData?.changesCount ?? 0}</strong></span><span><small>Ошибок</small><strong>{workspaceData?.errorsCount ?? 0}</strong></span><span><small>Предупреждений</small><strong>{workspaceData?.warningsCount ?? 0}</strong></span></div><footer><button className="admin-btn admin-btn--secondary" disabled={!workspaceData || validateWorkspace.isPending} onClick={() => validateWorkspace.mutate()}><ListChecks />Проверить</button>{workspaceData?.status === 'ready' ? <button className="admin-btn admin-btn--primary" disabled={activateWorkspace.isPending} onClick={() => activateWorkspace.mutate()}><Rocket />Опубликовать</button> : <button className="admin-btn admin-btn--primary" disabled={!workspaceData?.changesCount || workspaceData.status !== 'open' || buildWorkspace.isPending} onClick={() => buildWorkspace.mutate()}><Rocket />Собрать ревизию</button>}<button className="admin-btn admin-btn--secondary" onClick={() => navigate('content')}>Открыть карточки <ChevronRight /></button></footer></div>
      <div className="admin-revisions"><header><strong>Последние ревизии</strong><small>Готовые можно активировать, retired — вернуть откатом</small></header>{revisions.data?.items.slice(0, 8).map((raw) => { const revision = record(raw); return <article key={String(revision.id)}><span><strong>{title(revision.version)}</strong><small>{compactDate(revision.createdAt)} · {String(revision.checksumSha256).slice(0, 10)}</small></span><Status value={revision.status} />{['ready', 'retired'].includes(String(revision.status)) && <button disabled={activateRevision.isPending} onClick={() => activateRevision.mutate(revision)}>{revision.status === 'retired' ? 'Откатить' : 'Активировать'}</button>}</article> })}</div>
    </div>
    <div className="admin-mode-counts">{activeRevision?.counts.map((mode) => <div key={mode.mode}><span>{MODE_LABEL[mode.mode]}</span><strong>{mode.count.toLocaleString('ru-RU')}</strong></div>)}</div>
  </section>
}

function DashboardPage({ navigate, notify }: { navigate: (section: Section, id?: string | null) => void; notify: (tone: Notice['tone'], text: string) => void }) {
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
      <ContentRevisionControl activeRevision={dashboard.data.activeRevision} navigate={navigate} notify={notify} />
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

const previewValue = (value: unknown): string => {
  if (value == null || value === '') return ''
  if (typeof value === 'boolean') return value ? 'Да' : 'Нет'
  if (Array.isArray(value)) return value.map((entry) => previewValue(entry)).filter(Boolean).join(', ')
  if (typeof value === 'object') {
    const entry = record(value)
    return previewValue(entry.name ?? entry.titleRu ?? entry.title ?? entry.value ?? '')
  }
  return String(value).trim()
}

const previewPath = (payload: Record<string, unknown>, path: string): unknown => {
  let value: unknown = payload
  for (const part of path.split('.')) {
    value = Array.isArray(value) ? value[Number(part)] : record(value)[part]
  }
  return value
}

const contentPreviewFields = (payload: Record<string, unknown>, mode: ContentMode) => {
  const shared: Array<[string, string[]]> = [
    ['Год', ['year', 'releaseYear', 'startYear']],
    ['Страна', ['country', 'countries']],
    ['Жанры', ['genres']],
  ]
  const byMode: Record<ContentMode, Array<[string, string[]]>> = {
    movie: [
      ['Кинопоиск', ['ratings.kp', 'kinopoiskRating', 'ratingKinopoisk']],
      ['IMDb', ['ratings.imdb', 'imdbRating']],
      ['Хронометраж', ['runtimeMinutes', 'runtime']],
      ['Возраст', ['ageRating', 'age']],
      ['Режиссёр', ['directors', 'director']],
      ['Актёры', ['cast', 'actors']],
    ],
    series: [
      ['Кинопоиск', ['ratings.kp', 'kinopoiskRating', 'ratingKinopoisk']],
      ['IMDb', ['ratings.imdb', 'imdbRating']],
      ['Сезоны', ['seasonsCount', 'seasons']],
      ['Эпизоды', ['episodesCount', 'episodes']],
      ['Статус', ['seriesStatus', 'status']],
      ['Возраст', ['ageRating', 'age']],
    ],
    anime: [
      ['Оценка', ['shikimoriScore', 'score', 'ratings.shikimori']],
      ['Эпизоды', ['episodes', 'animeEpisodesAired']],
      ['Студия', ['studios', 'studio']],
      ['Статус', ['animeStatus', 'status']],
      ['Источник', ['animeSource', 'sourceMaterial']],
      ['Возраст', ['ageRating', 'rating']],
    ],
    game: [
      ['Платформы', ['platforms']],
      ['Разработчик', ['developers', 'developer']],
      ['Издатель', ['publishers', 'publisher']],
      ['Metacritic', ['metacritic', 'ratings.metacritic']],
      ['Категории', ['steamCategories', 'categories']],
      ['Возраст', ['ageRating', 'requiredAge']],
    ],
    music: [
      ['Тип', ['musicType', 'artistType', 'type']],
      ['Активен', ['musicIsActive', 'isActive']],
      ['Популярный трек', ['topTracks.0.title', 'topTracks.0.name']],
      ['Популярный альбом', ['topAlbums.0.title', 'topAlbums.0.name']],
      ['Похожие исполнители', ['similarArtists']],
      ['Слушатели', ['listeners', 'votes.gamesPlayed']],
    ],
    diagnosis: [
      ['МКБ-10', ['icd10', 'icdCode']],
      ['Группа', ['icdGroup']],
      ['Система организма', ['bodySystems']],
      ['Тип', ['diseaseTypes']],
      ['Течение', ['course']],
      ['Симптомы', ['keySymptoms', 'symptoms']],
    ],
  }
  return [...shared, ...byMode[mode]].map(([label, paths]) => {
    const value = paths.map((path) => previewValue(previewPath(payload, path))).find(Boolean) ?? ''
    return { label, value }
  }).filter((entry) => entry.value).slice(0, 9)
}

function ContentPreviewModal({
  items,
  currentId,
  onChange,
  onClose,
  onEdit,
  notify,
}: {
  items: AdminContentListItem[]
  currentId: string
  onChange: (itemId: string) => void
  onClose: () => void
  onEdit: (itemId: string) => void
  notify: (tone: Notice['tone'], text: string) => void
}) {
  const client = useQueryClient()
  const currentIndex = Math.max(0, items.findIndex((item) => item.id === currentId))
  const currentItem = items[currentIndex]
  const detail = useQuery({
    queryKey: ['admin', 'item', currentId],
    queryFn: () => adminApi.contentItem(currentId),
    enabled: Boolean(currentId),
  })
  const [note, setNote] = useState('')
  const [reviewOverrides, setReviewOverrides] = useState<Record<string, { approved: boolean; note: string }>>({})
  const serverReview = detail.data?.decisions.map(record).find((entry) => entry.field === '__card_preview__')
  const serverDecision = record(serverReview?.decision)
  const savedReview = reviewOverrides[currentId] ?? (typeof serverDecision.approved === 'boolean'
    ? { approved: serverDecision.approved, note: String(serverDecision.note ?? '') }
    : null)
  const reviewStatus = savedReview ? (savedReview.approved ? 'approved' : 'issue') : 'pending'

  useEffect(() => {
    setNote(savedReview?.note ?? '')
  }, [currentId, savedReview?.note])

  useEffect(() => {
    const previousOverflow = document.body.style.overflow
    document.body.style.overflow = 'hidden'
    return () => { document.body.style.overflow = previousOverflow }
  }, [])

  useEffect(() => {
    if (currentItem || !items.length) return
    onChange(items[0].id)
  }, [currentItem, items, onChange])

  useEffect(() => {
    for (const neighbor of [items[currentIndex - 1], items[currentIndex + 1]]) {
      if (!neighbor) continue
      void client.prefetchQuery({ queryKey: ['admin', 'item', neighbor.id], queryFn: () => adminApi.contentItem(neighbor.id), staleTime: 30_000 })
    }
  }, [client, currentIndex, items])

  const review = useMutation({
    mutationFn: ({ itemId, approved, reviewNote }: { itemId: string; approved: boolean; reviewNote: string }) =>
      adminApi.reviewDecision(itemId, '__card_preview__', { approved, ...(reviewNote.trim() ? { note: reviewNote.trim() } : {}) }),
    onSuccess: (_, variables) => {
      setReviewOverrides((current) => ({ ...current, [variables.itemId]: { approved: variables.approved, note: variables.reviewNote.trim() } }))
      void client.invalidateQueries({ queryKey: ['admin', 'item', variables.itemId] })
      void client.invalidateQueries({ queryKey: ['admin', 'content'] })
      notify(variables.approved ? 'success' : 'info', variables.approved ? 'Карточка отмечена как проверенная' : 'Проблема отмечена и сохранена')
    },
    onError: (error) => notify('error', errorText(error)),
  })

  const move = (direction: -1 | 1) => {
    const target = items[currentIndex + direction]
    if (target) onChange(target.id)
  }
  const submitReview = (approved: boolean) => {
    if (!currentItem || review.isPending) return
    review.mutate({ itemId: currentItem.id, approved, reviewNote: note })
  }

  useEffect(() => {
    const handleKeyDown = (event: KeyboardEvent) => {
      const target = event.target as HTMLElement | null
      if (target?.matches('input, textarea, select, [contenteditable="true"]') || event.metaKey || event.ctrlKey || event.altKey) return
      if (event.key === 'Escape') onClose()
      if (event.key === 'ArrowLeft') move(-1)
      if (event.key === 'ArrowRight') move(1)
      if (event.key.toLocaleLowerCase() === 'x') submitReview(false)
      if (event.key.toLocaleLowerCase() === 'c') submitReview(true)
    }
    window.addEventListener('keydown', handleKeyDown)
    return () => window.removeEventListener('keydown', handleKeyDown)
  })

  if (!currentItem) return null
  const payload = detail.data?.draft?.afterPayload ?? detail.data?.active?.payload ?? {}
  const mode = detail.data ? asContentMode(detail.data.draft?.mode ?? detail.data.active?.mode, currentItem.mode) : currentItem.mode
  const poster = [payload.posterUrl, payload.headerUrl, payload.backdropUrl, currentItem.posterUrl].map(previewValue).find(Boolean) ?? ''
  const hint = [payload.plotHint, array(payload.facts)[0], payload.shortDescription, payload.description].map(previewValue).find(Boolean) ?? 'Подсказка не заполнена'
  const originalTitle = previewValue(payload.titleOriginal) || currentItem.titleOriginal
  const year = previewValue(payload.year) || previewValue(currentItem.year)
  const country = previewValue(payload.country ?? payload.countries)
  const genres = array(payload.genres).map(previewValue).filter(Boolean).slice(0, 6)
  const fields = contentPreviewFields(payload, mode)
  const warnings = [
    !poster ? 'Нет изображения' : '',
    hint === 'Подсказка не заполнена' ? 'Нет игровой подсказки' : '',
    currentItem.issuesCount ? `Открытые проблемы качества: ${currentItem.issuesCount}` : '',
    detail.data?.issues.length ? `Детальных замечаний: ${detail.data.issues.length}` : '',
  ].filter(Boolean)

  return <div className="admin-modal-backdrop admin-modal-backdrop--moderation admin-content-preview-backdrop" role="presentation" onMouseDown={(event) => event.target === event.currentTarget && onClose()}>
    <div className="admin-modal admin-modal--moderation admin-content-preview-modal" role="dialog" aria-modal="true" aria-label={`Предпросмотр ${currentItem.titleRu}`}>
      <header>
        <div><span>{MODE_LABEL[mode]} · Предпросмотр текущей выборки</span><h2>Карточка как в игре</h2></div>
        <div className="admin-content-preview-header-actions">
          <button className="admin-content-preview-edit" onClick={() => onEdit(currentItem.id)}><SquarePen />Редактировать</button>
          <button className="admin-content-preview-close" aria-label="Закрыть предпросмотр" onClick={onClose}><X /></button>
        </div>
      </header>
      <div className="admin-modal__body admin-modal__body--moderation">
        <section className="review-stats admin-review-stats">
          <article><small>Позиция</small><strong>{currentIndex + 1}/{items.length}</strong></article>
          <article><small>Загружено в таблице</small><strong>{items.length}</strong></article>
          <article><small>Результат проверки</small><strong>{reviewStatus === 'approved' ? 'Всё в порядке' : reviewStatus === 'issue' ? 'Есть проблема' : 'Не проверена'}</strong></article>
          <article><small>Горячие клавиши</small><strong>← → · X / C</strong></article>
        </section>
        {detail.isLoading ? <Loading /> : detail.error ? <ErrorState error={detail.error} retry={() => void detail.refetch()} /> : <>
          <section className={`attempt-card attempt-card--screen admin-attempt-card ${warnings.length ? 'has-conflict' : ''}`}>
            <div className="attempt-card__header admin-attempt-card__header">
              <span className="attempt-card__number">{String(currentIndex + 1).padStart(2, '0')}</span>
              {poster ? <img className="review-card__poster" src={poster} alt="" /> : <div className="review-card__poster admin-review-poster-fallback"><ImageIcon /></div>}
              <div className="attempt-card__identity">
                <span className="attempt-label">Попытка воспроизведения · {MODE_LABEL[mode]}</span>
                <h2>{previewValue(payload.titleRu) || currentItem.titleRu}</h2>
                <p className="gm-head__sub">
                  {originalTitle && <span className="gm-head__orig">{originalTitle}</span>}
                  {year && <><i className="gm-head__dot" aria-hidden="true">·</i><span className="gm-year">{year}</span></>}
                  {country && <><i className="gm-head__dot" aria-hidden="true">·</i><span className="gm-year">{country}</span></>}
                </p>
                {!!genres.length && <div className="gm-genres">{genres.map((genre) => <span key={genre} className="gm-genre">{genre}</span>)}</div>}
              </div>
              <div className={`review-approval-badge admin-content-preview-status is-${reviewStatus}`}><small>Проверка</small><strong>{reviewStatus === 'approved' ? 'В порядке' : reviewStatus === 'issue' ? 'Проблема' : 'Ожидает'}</strong></div>
            </div>
            {!!warnings.length && <div className="review-conflict-banner"><strong><AlertTriangle /> Проверьте карточку</strong><span>{warnings.join(' • ')}</span></div>}
            <div className="admin-attempt-fields">{fields.length ? fields.map((entry) => <article className="admin-attempt-field" key={entry.label}><small>{entry.label}</small><strong>{entry.value}</strong></article>) : <p className="admin-attempt-fields__empty">Недостаточно игровых полей для предпросмотра попытки.</p>}</div>
          </section>
          <section className="assist-revealed"><article className="assist-reveal-card"><span><Sparkles /> Подсказка в игре</span><p>{hint}</p></article></section>
          <section className={`admin-content-preview-review is-${reviewStatus}`}>
            <label>
              <input type="checkbox" checked={reviewStatus === 'issue'} disabled={review.isPending} onChange={(event) => submitReview(!event.target.checked)} />
              <span><strong><Bug /> Есть проблема</strong><small>Отметка сохранится в журнале ревью карточки.</small></span>
            </label>
            <div>
              <textarea value={note} onChange={(event) => setNote(event.target.value)} maxLength={1000} placeholder="Что именно нужно исправить? Например: неверный постер, обрезан текст, плохая подсказка…" />
              <button className="ui-button ui-button--secondary" onClick={() => submitReview(false)} disabled={review.isPending || !note.trim()}><Save />Сохранить комментарий</button>
            </div>
          </section>
          <section className="admin-moderation-meta">
            <article><small>Полнота</small><strong>{currentItem.completeness}%</strong></article>
            <article><small>Источник</small><strong>{currentItem.draftVersion ? `Draft v${currentItem.draftVersion}` : 'Active'}</strong></article>
            <article><small>ID карточки</small><strong>{currentItem.id}</strong></article>
            <article><small>Репорты / качество</small><strong>{currentItem.reportsCount} / {currentItem.issuesCount}</strong></article>
          </section>
        </>}
      </div>
      <footer className="admin-review-footer">
        <button className="ui-button ui-button--ghost" onClick={() => move(-1)} disabled={currentIndex === 0 || review.isPending}><ChevronLeft />Назад<span className="keycap-hint keycap-hint--inline" aria-hidden="true">←</span></button>
        <button className={`ui-button ui-button--secondary admin-content-preview-issue ${reviewStatus === 'issue' ? 'is-active' : ''}`} onClick={() => submitReview(false)} disabled={review.isPending}><Bug />Есть проблема<span className="keycap-hint keycap-hint--inline" aria-hidden="true">X</span></button>
        <button className={`ui-button ui-button--primary ${reviewStatus === 'approved' ? 'is-active' : ''}`} onClick={() => submitReview(true)} disabled={review.isPending}><BadgeCheck />Всё в порядке<span className="keycap-hint keycap-hint--inline" aria-hidden="true">C</span></button>
        <button className="ui-button ui-button--ghost" onClick={() => move(1)} disabled={currentIndex >= items.length - 1 || review.isPending}>Дальше<ChevronRight /><span className="keycap-hint keycap-hint--inline" aria-hidden="true">→</span></button>
      </footer>
    </div>
  </div>
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
  const allTags = useQuery({ queryKey: ['admin', 'content-tags'], queryFn: adminApi.tags })
  const changeTag = useMutation({
    mutationFn: ({ tagId, operation }: { tagId: string; operation: 'add_tag' | 'remove_tag' }) => adminApi.bulkContent({ itemIds: [itemId], operation, value: tagId, reason: operation === 'add_tag' ? 'Тег назначен карточке' : 'Тег снят с карточки' }),
    onSuccess: () => { void client.invalidateQueries({ queryKey: ['admin', 'item', itemId] }); void client.invalidateQueries({ queryKey: ['admin', 'content'] }); void client.invalidateQueries({ queryKey: ['admin', 'content-tags'] }) },
    onError: (error) => notify('error', errorText(error)),
  })
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
      <section className="admin-form-section admin-card-tags"><header><h3>Теги карточки</h3><span>{data.tags.length}</span></header><TagPicker tags={allTags.data?.items ?? []} value={data.tags.map((tag) => tag.id)} onChange={(ids) => { const before = new Set(data.tags.map((tag) => tag.id)); const added = ids.find((id) => !before.has(id)); const removed = data.tags.find((tag) => !ids.includes(tag.id))?.id; if (added) changeTag.mutate({ tagId: added, operation: 'add_tag' }); else if (removed) changeTag.mutate({ tagId: removed, operation: 'remove_tag' }) }} label="Операционные теги" /><button className="admin-btn admin-btn--secondary" onClick={async () => { const name = prompt('Название нового тега'); if (!name?.trim()) return; try { const tag = await adminApi.createTag(name.trim()); await client.invalidateQueries({ queryKey: ['admin', 'content-tags'] }); changeTag.mutate({ tagId: tag.id, operation: 'add_tag' }) } catch (error) { notify('error', errorText(error)) } }}><Plus />Создать и назначить</button></section>
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

const downloadBlob = (blob: Blob, fileName: string | null) => {
  const url = URL.createObjectURL(blob); const anchor = window.document.createElement('a')
  anchor.href = url; anchor.download = fileName || `shoditsa-content-${new Date().toISOString().slice(0, 10)}.json`
  anchor.click(); window.setTimeout(() => URL.revokeObjectURL(url), 1_000)
}

function ContentExchangeDialog({ initialTab, itemIds, close, notify, done }: { initialTab: 'export' | 'import'; itemIds: string[]; close: () => void; notify: (tone: Notice['tone'], text: string) => void; done: () => void }) {
  const [tab, setTab] = useState<'export' | 'import'>(initialTab)
  const [fields, setFields] = useState<Set<string>>(new Set()); const fieldsInitialized = useRef(false)
  const [document, setDocument] = useState<Record<string, unknown> | null>(null); const [fileName, setFileName] = useState('')
  const [parseError, setParseError] = useState(''); const [importItems, setImportItems] = useState<Set<string>>(new Set()); const [reason, setReason] = useState('Импорт карточек из JSON')
  const selectionKey = useMemo(() => {
    let hash = 2_166_136_261
    for (const id of itemIds) for (let index = 0; index < id.length; index += 1) hash = Math.imul(hash ^ id.charCodeAt(index), 16_777_619)
    return `${itemIds.length}:${hash >>> 0}`
  }, [itemIds])
  const selection = useQuery({ queryKey: ['admin', 'content-exchange-selection', selectionKey], queryFn: () => adminApi.contentExchangeSelection(itemIds), enabled: tab === 'export' && itemIds.length > 0, staleTime: 30_000 })
  useEffect(() => {
    if (!fieldsInitialized.current && selection.data) { setFields(new Set(selection.data.fields.map((entry) => entry.field))); fieldsInitialized.current = true }
  }, [selection.data])
  const exportMutation = useMutation({
    mutationFn: () => adminApi.exportContentExchange(itemIds, [...fields]),
    onSuccess: ({ blob, fileName: exportedFileName }) => { downloadBlob(blob, exportedFileName); notify('success', `Экспортировано карточек: ${itemIds.length} · ${(blob.size / 1024 / 1024).toFixed(1)} МБ`) },
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
    <footer><button className="admin-btn admin-btn--secondary" onClick={close}>Отмена</button>{tab === 'export' ? <button className="admin-btn admin-btn--primary" disabled={!itemIds.length || !fields.size || exportMutation.isPending} onClick={() => exportMutation.mutate()}>{exportMutation.isPending ? <LoaderCircle /> : <Download />}{exportMutation.isPending ? 'Собираем файл…' : 'Скачать JSON'}</button> : <button className="admin-btn admin-btn--primary" disabled={!document || !preview.data || !actionableCount || reason.trim().length < 3 || apply.isPending} onClick={() => apply.mutate()}><Check />Добавить {actionableCount} в рабочую версию</button>}</footer>
  </div></div>
}

function ContentPageLegacy({ selectedId, navigate, notify }: { selectedId: string | null; navigate: (section: Section, id?: string | null) => void; notify: (tone: Notice['tone'], text: string) => void }) {
  const client = useQueryClient(); const params = new URLSearchParams(location.search)
  const [q, setQ] = useState(params.get('q') ?? ''); const [mode, setMode] = useState(params.get('mode') ?? ''); const [publication, setPublication] = useState(params.get('publication') ?? 'all'); const [pageSize, setPageSize] = useState<20 | 40 | 60 | 100>(60); const [view, setView] = useState<'table' | 'grid' | 'review'>('table'); const [selected, setSelected] = useState<Set<string>>(new Set()); const [adding, setAdding] = useState(false); const [exchange, setExchange] = useState<'export' | 'import' | null>(null); const loadMoreRef = useRef<HTMLDivElement | null>(null)
  useEffect(() => { const next = new URLSearchParams(); if (q) next.set('q', q); if (mode) next.set('mode', mode); if (publication !== 'all') next.set('publication', publication); history.replaceState({}, '', `${location.pathname}${next.size ? `?${next}` : ''}`) }, [q, mode, publication])
  const items = useInfiniteQuery({ queryKey: ['admin', 'content', { q, mode, publication, pageSize }], initialPageParam: null as string | null, queryFn: ({ pageParam }) => adminApi.contentItems({ q, mode, publication, limit: pageSize, cursor: pageParam ?? undefined }), getNextPageParam: (lastPage) => lastPage.nextCursor })
  const listedItems = useMemo(() => items.data?.pages.flatMap((page) => page.items) ?? [], [items.data])
  const totalItems = items.data?.pages[0]?.total ?? 0
  useEffect(() => { const target = loadMoreRef.current; if (!target || !items.hasNextPage || items.isFetchingNextPage) return; const observer = new IntersectionObserver(([entry]) => { if (entry.isIntersecting) void items.fetchNextPage() }, { rootMargin: '320px' }); observer.observe(target); return () => observer.disconnect() }, [items.fetchNextPage, items.hasNextPage, items.isFetchingNextPage])
  const bulk = useMutation({ mutationFn: (operation: 'allow' | 'disallow') => adminApi.bulkContent({ itemIds: [...selected], operation, reason: operation === 'allow' ? 'Массовое включение в игру' : 'Массовое исключение из игры' }), onSuccess: (data) => { notify('success', `Обработано: ${data.succeeded ?? 0}, ошибок: ${data.failed ?? 0}`); setSelected(new Set()); void client.invalidateQueries({ queryKey: ['admin', 'content'] }); void client.invalidateQueries({ queryKey: ['admin', 'workspace'] }) }, onError: (error) => notify('error', errorText(error)) })
  return (
    <>
      <PageHead
        eyebrow="Контент"
        title="Карточки"
        description="Поиск, проверка и публикация всех шести игровых библиотек."
        actions={
          <>
            <div className="admin-view-switch">
              <button
                className={view === "table" ? "is-active" : ""}
                onClick={() => setView("table")}
              >
                <Menu />
                Таблица
              </button>
              <button
                className={view === "grid" ? "is-active" : ""}
                onClick={() => setView("grid")}
              >
                <Boxes />
                Карточки
              </button>
              <button
                className={view === "review" ? "is-active" : ""}
                onClick={() => setView("review")}
              >
                <Eye />
                Проверка
              </button>
            </div>
            <button
              className="admin-btn admin-btn--secondary"
              onClick={() => setExchange("import")}
            >
              <Upload />
              Импорт JSON
            </button>
            <button
              className="admin-btn admin-btn--secondary"
              disabled={!selected.size}
              onClick={() => setExchange("export")}
            >
              <Download />
              Экспорт JSON{selected.size ? ` · ${selected.size}` : ""}
            </button>
            <button
              className="admin-btn admin-btn--primary"
              onClick={() => setAdding(true)}
            >
              <Plus />
              Добавить карточку
            </button>
          </>
        }
      />
      <WorkspaceBar notify={notify} />
      <div className="admin-toolbar">
        <label className="admin-search">
          <Search />
          <input
            value={q}
            onChange={(event) => setQ(event.target.value)}
            placeholder="Название, альтернативное название или ID"
          />
          {q && (
            <button onClick={() => setQ("")}>
              <X />
            </button>
          )}
        </label>
        <label>
          <Filter />
          <select
            value={mode}
            onChange={(event) => setMode(event.target.value)}
          >
            <option value="">Все категории</option>
            {MODES.map((entry) => (
              <option key={entry.value} value={entry.value}>
                {entry.label}
              </option>
            ))}
          </select>
        </label>
        <label>
          <Archive />
          <select
            value={publication}
            onChange={(event) => setPublication(event.target.value)}
          >
            <option value="all">Все статусы</option>
            <option value="published">Опубликованы</option>
            <option value="hidden">Скрыты</option>
          </select>
        </label>
        <label>
          <ListChecks />
          <select
            aria-label="Размер страницы"
            value={pageSize}
            onChange={(event) => {
              setPageSize(Number(event.target.value) as 20 | 40 | 60 | 100);
              setSelected(new Set());
            }}
          >
            <option value={20}>20</option>
            <option value={40}>40</option>
            <option value={60}>60</option>
            <option value={100}>100</option>
          </select>
        </label>
        <button
          className="admin-btn admin-btn--secondary"
          onClick={() => void items.refetch()}
        >
          <RefreshCw />
        </button>
      </div>
      {selected.size > 0 && (
        <div className="admin-bulk">
          <strong>Выбрано: {selected.size}</strong>
          <button onClick={() => setExchange("export")}>
            <Download />
            Экспорт JSON
          </button>
          <button onClick={() => bulk.mutate("allow")}>
            <Check />
            Разрешить в игре
          </button>
          <button onClick={() => bulk.mutate("disallow")}>
            <Archive />
            Скрыть
          </button>
          <button onClick={() => setSelected(new Set())}>
            <X />
            Снять выбор
          </button>
        </div>
      )}
      {items.isLoading ? (
        <Loading />
      ) : items.error ? (
        <ErrorState error={items.error} retry={() => void items.refetch()} />
      ) : !listedItems.length ? (
        <Empty
          title="Ничего не найдено"
          text="Измените запрос или сбросьте фильтры."
          icon={<Search />}
          action={
            <button
              className="admin-btn admin-btn--secondary"
              onClick={() => {
                setQ("");
                setMode("");
                setPublication("all");
              }}
            >
              Сбросить фильтры
            </button>
          }
        />
      ) : view === "grid" ? (
        <div className="admin-content-grid">
          {listedItems.map((item) => (
            <button key={item.id} onClick={() => navigate("content", item.id)}>
              <div>
                {item.posterUrl ? (
                  <img src={item.posterUrl} alt="" />
                ) : (
                  <ImageIcon />
                )}
                {item.draftVersion && <span>Draft v{item.draftVersion}</span>}
              </div>
              <small>{MODE_LABEL[item.mode]}</small>
              <strong>{item.titleRu}</strong>
              <p>{item.titleOriginal || item.id}</p>
              <footer>
                <Status value={item.allowedInGame ? "active" : "blocked"}>
                  {item.allowedInGame ? "В игре" : "Скрыта"}
                </Status>
                <span>{item.completeness}%</span>
              </footer>
            </button>
          ))}
        </div>
      ) : (
        <div className="admin-table-wrap">
          <table className="admin-table">
            <thead>
              <tr>
                <th className="admin-check">
                  <input
                    type="checkbox"
                    aria-label="Выбрать все"
                    checked={
                      selected.size === listedItems.length && selected.size > 0
                    }
                    onChange={(event) =>
                      setSelected(
                        event.target.checked
                          ? new Set(listedItems.map((item) => item.id))
                          : new Set(),
                      )
                    }
                  />
                </th>
                <th>Карточка</th>
                <th>ID</th>
                <th>Категория</th>
                <th>Статус</th>
                <th>Полнота</th>
                <th>Репорты</th>
                <th>Качество</th>
                <th>Изменена</th>
                <th />
              </tr>
            </thead>
            <tbody>
              {listedItems.map((item) => (
                <tr
                  key={item.id}
                  className={selectedId === item.id ? "is-open" : ""}
                >
                  <td className="admin-check">
                    <input
                      type="checkbox"
                      aria-label={`Выбрать ${item.titleRu}`}
                      checked={selected.has(item.id)}
                      onChange={(event) =>
                        setSelected((current) => {
                          const next = new Set(current);
                          event.target.checked
                            ? next.add(item.id)
                            : next.delete(item.id);
                          return next;
                        })
                      }
                    />
                  </td>
                  <td>
                    <button
                      className="admin-title-cell"
                      onClick={() => navigate("content", item.id)}
                    >
                      {item.posterUrl ? (
                        <img src={item.posterUrl} alt="" />
                      ) : (
                        <span>
                          <ImageIcon />
                        </span>
                      )}
                      <span>
                        <strong>{item.titleRu}</strong>
                        <small>
                          {item.titleOriginal || "Без оригинального названия"}
                          {item.year ? ` · ${item.year}` : ""}
                        </small>
                      </span>
                    </button>
                  </td>
                  <td>
                    <code>{item.id}</code>
                  </td>
                  <td>{MODE_LABEL[item.mode]}</td>
                  <td>
                    <Status value={item.allowedInGame ? "active" : "blocked"}>
                      {item.allowedInGame ? "В игре" : "Скрыта"}
                    </Status>
                    {item.draftVersion && (
                      <small className="admin-draft-label">
                        Draft v{item.draftVersion}
                      </small>
                    )}
                  </td>
                  <td>
                    <div className="admin-completeness">
                      <i style={{ width: `${item.completeness}%` }} />
                      <span>{item.completeness}%</span>
                    </div>
                  </td>
                  <td>
                    {item.reportsCount ? (
                      <button
                        className="admin-count admin-count--warn"
                        onClick={() => navigate("reports")}
                      >
                        {item.reportsCount}
                      </button>
                    ) : (
                      "—"
                    )}
                  </td>
                  <td>
                    {item.issuesCount ? (
                      <span className="admin-count admin-count--danger">
                        {item.issuesCount}
                      </span>
                    ) : (
                      <Check className="admin-table-ok" />
                    )}
                  </td>
                  <td>{compactDate(item.updatedAt)}</td>
                  <td>
                    <button
                      className="admin-icon-btn"
                      onClick={() => navigate("content", item.id)}
                    >
                      <ChevronRight />
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
          <footer className="admin-table-footer">
            <span>
              Показано {listedItems.length} из{" "}
              {totalItems.toLocaleString("ru-RU")}
            </span>
          </footer>
        </div>
      )}
      <div className="admin-content-pagination" ref={loadMoreRef}>
        {items.hasNextPage ? (
          <button
            className="admin-btn admin-btn--secondary"
            disabled={items.isFetchingNextPage}
            onClick={() => void items.fetchNextPage()}
          >
            {items.isFetchingNextPage ? (
              <LoaderCircle className="admin-spinner" />
            ) : null}
            {items.isFetchingNextPage ? "Загружаем…" : "Загрузить ещё"}
          </button>
        ) : (
          <span>Все карточки загружены</span>
        )}
      </div>
      {selectedId && (
        <ItemEditor
          itemId={selectedId}
          onClose={() => navigate("content")}
          notify={notify}
        />
      )}
      {adding && (
        <NewCardDialog
          close={() => setAdding(false)}
          done={(id) => {
            setAdding(false);
            navigate("content", id);
            void client.invalidateQueries({ queryKey: ["admin", "content"] });
            void client.invalidateQueries({ queryKey: ["admin", "workspace"] });
          }}
          notify={notify}
        />
      )}
      {exchange && (
        <ContentExchangeDialog
          initialTab={exchange}
          itemIds={[...selected]}
          close={() => setExchange(null)}
          notify={notify}
          done={() => {
            setExchange(null);
            setSelected(new Set());
            void client.invalidateQueries({ queryKey: ["admin", "content"] });
            void client.invalidateQueries({ queryKey: ["admin", "workspace"] });
          }}
        />
      )}
    </>
  );
}

function ContentPage({ selectedId, navigate, notify }: { selectedId: string | null; navigate: (section: Section, id?: string | null, search?: string) => void; notify: (tone: Notice['tone'], text: string) => void }) {
  const client = useQueryClient();
  const params = new URLSearchParams(location.search);
  const routeMode = params.get('mode');
  const scopedMode = MODES.some((entry) => entry.value === routeMode)
    ? (routeMode as ContentMode)
    : null;

  type ContentSortKey =
    | "titleRu"
    | "id"
    | "mode"
    | "status"
    | "source"
    | "pipelineKey"
    | "tags"
    | "fieldsFilled"
    | "hasHint"
    | "completeness"
    | "reportsCount"
    | "issuesCount"
    | "updatedAt";
  const sortableKeys: ContentSortKey[] = [
    "titleRu",
    "id",
    "mode",
    "status",
    "source",
    "pipelineKey",
    "tags",
    "fieldsFilled",
    "hasHint",
    "completeness",
    "reportsCount",
    "issuesCount",
    "updatedAt",
  ];
  const parseTriState = (value: string | null): "all" | "yes" | "no" =>
    value === "yes" || value === "no" ? value : "all";
  const parseFieldFilter = (value: string | null): ContentFieldFilter =>
    value && CONTENT_FIELD_FILTERS.has(value)
      ? value
      : "all";
  const parseFieldOperator = (value: string | null): ContentFieldOperator =>
    value && CONTENT_FIELD_OPERATOR_VALUES.has(value) ? value as ContentFieldOperator : 'contains';
  const parseSortKey = (value: string | null): ContentSortKey =>
    value && sortableKeys.includes(value as ContentSortKey)
      ? (value as ContentSortKey)
      : "updatedAt";
  const parseSortOrder = (value: string | null): "asc" | "desc" =>
    value === "asc" || value === "desc" ? value : "desc";
  const sourceLabelMap: Record<string, string> = {
    manual: "Ручное",
    ai_pipeline: "AI пайплайн",
    bulk: "Массовое",
    import: "Импорт",
    rollback: "Откат",
    report_fix: "Фикс по репорту",
  };
  const pipelineLabelMap: Record<string, string> = {
    music: "Музыка",
    movie: "Кино",
    anime: "Аниме",
  };

  const [q, setQ] = useState(params.get("q") ?? "");
  const [mode, setMode] = useState(scopedMode ?? params.get("mode") ?? "");
  const [publication, setPublication] = useState(
    params.get("publication") ?? "all",
  );
  const [source, setSource] = useState(params.get("source") ?? "");
  const [pipelineFilter, setPipelineFilter] = useState(
    params.get("pipeline") ?? "",
  );
  const [hintFilter, setHintFilter] = useState<"all" | "yes" | "no">(
    parseTriState(params.get("hasHint")),
  );
  const [reportsFilter, setReportsFilter] = useState<"all" | "yes" | "no">(
    parseTriState(params.get("hasReports")),
  );
  const [issuesFilter, setIssuesFilter] = useState<"all" | "yes" | "no">(
    parseTriState(params.get("hasIssues")),
  );
  const [includeTagIds, setIncludeTagIds] = useState<string[]>(
    params.get("includeTags")?.split(",").filter(Boolean) ?? [],
  );
  const [excludeTagIds, setExcludeTagIds] = useState<string[]>(
    params.get("excludeTags")?.split(",").filter(Boolean) ?? [],
  );
  const [tagMatch, setTagMatch] = useState<"all" | "any">(
    params.get("tagMatch") === "any" ? "any" : "all",
  );
  const [bulkTagIds, setBulkTagIds] = useState<string[]>([]);
  const [fieldFilter, setFieldFilter] = useState<ContentFieldFilter>(
    parseFieldFilter(params.get("field")),
  );
  const [fieldFilterOperator, setFieldFilterOperator] = useState<ContentFieldOperator>(
    parseFieldOperator(params.get('fieldOp')),
  );
  const [fieldFilterValue, setFieldFilterValue] = useState(
    params.get("fieldQ") ?? "",
  );
  const [sortBy, setSortBy] = useState<ContentSortKey>(
    parseSortKey(params.get("sortBy")),
  );
  const [sortOrder, setSortOrder] = useState<"asc" | "desc">(
    parseSortOrder(params.get("sortOrder")),
  );
  const [pageSize, setPageSize] = useState<20 | 40 | 60 | 100>(() => {
    const value = Number(params.get('limit'))
    return [20, 40, 60, 100].includes(value) ? value as 20 | 40 | 60 | 100 : 60
  });
  const [view, setView] = useState<"table" | "grid">(() => {
    const value = params.get('view')
    return value === 'grid' ? value : 'table'
  });
  const [previewId, setPreviewId] = useState<string | null>(null);
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [selectionAnchorIndex, setSelectionAnchorIndex] = useState<
    number | null
  >(null);
  const [adding, setAdding] = useState(false);
  const [exchange, setExchange] = useState<"export" | "import" | null>(null);
  const loadMoreRef = useRef<HTMLDivElement | null>(null);
  const tags = useQuery({
    queryKey: ["admin", "content-tags"],
    queryFn: adminApi.tags,
  });
  const fieldOperatorNeedsValue = !CONTENT_FIELD_NO_VALUE_OPERATORS.has(fieldFilterOperator);
  const fieldComparisonUsesLength = contentFieldUsesLength(fieldFilter, fieldFilterOperator);
  const debouncedQ = useDebouncedValue(q.trim(), 300);
  const debouncedFieldFilterValue = useDebouncedValue(fieldFilterValue.trim(), 350);
  const appliedFieldFilterValue = fieldOperatorNeedsValue ? debouncedFieldFilterValue : '';
  const filtersPending = q.trim() !== debouncedQ || (fieldOperatorNeedsValue && fieldFilterValue.trim() !== debouncedFieldFilterValue);

  useEffect(() => {
    const next = new URLSearchParams();
    if (q) next.set("q", q);
    if (mode) next.set("mode", mode);
    if (publication !== "all") next.set("publication", publication);
    if (source) next.set("source", source);
    if (pipelineFilter) next.set("pipeline", pipelineFilter);
    if (hintFilter !== "all") next.set("hasHint", hintFilter);
    if (reportsFilter !== "all") next.set("hasReports", reportsFilter);
    if (issuesFilter !== "all") next.set("hasIssues", issuesFilter);
    if (includeTagIds.length) next.set("includeTags", includeTagIds.join(","));
    if (excludeTagIds.length) next.set("excludeTags", excludeTagIds.join(","));
    if (tagMatch !== "all") next.set("tagMatch", tagMatch);
    if (fieldFilter !== "all") next.set("field", fieldFilter);
    if (fieldFilterOperator !== 'contains') next.set('fieldOp', fieldFilterOperator);
    if (fieldOperatorNeedsValue && fieldFilterValue.trim()) next.set("fieldQ", fieldFilterValue.trim());
    if (sortBy !== "updatedAt") next.set("sortBy", sortBy);
    if (sortOrder !== "desc") next.set("sortOrder", sortOrder);
    if (pageSize !== 60) next.set('limit', String(pageSize));
    if (view !== 'table') next.set('view', view);
    history.replaceState(
      {},
      "",
      `${location.pathname}${next.size ? `?${next}` : ""}`,
    );
  }, [
    excludeTagIds,
    fieldFilter,
    fieldFilterOperator,
    fieldFilterValue,
    fieldOperatorNeedsValue,
    hintFilter,
    includeTagIds,
    issuesFilter,
    mode,
    pipelineFilter,
    publication,
    q,
    reportsFilter,
    sortBy,
    sortOrder,
    source,
    tagMatch,
    pageSize,
    view,
  ]);

  const items = useInfiniteQuery({
    queryKey: [
      "admin",
      "content",
      {
        q: debouncedQ,
        mode,
        publication,
        pageSize,
        source,
        pipelineFilter,
        hintFilter,
        reportsFilter,
        issuesFilter,
        includeTagIds,
        excludeTagIds,
        tagMatch,
        fieldFilter,
        fieldFilterOperator,
        fieldFilterValue: appliedFieldFilterValue,
        sortBy,
        sortOrder,
      },
    ],
    initialPageParam: null as string | null,
    queryFn: ({ pageParam, signal }) =>
      adminApi.contentItems({
        q: debouncedQ,
        mode,
        publication,
        source,
        pipelineKey: pipelineFilter || undefined,
        hasHint:
          hintFilter === "yes" ? true : hintFilter === "no" ? false : undefined,
        hasReports:
          reportsFilter === "yes"
            ? true
            : reportsFilter === "no"
              ? false
              : undefined,
        hasIssues:
          issuesFilter === "yes"
            ? true
            : issuesFilter === "no"
              ? false
              : undefined,
        includeTagIds: includeTagIds.join(",") || undefined,
        excludeTagIds: excludeTagIds.join(",") || undefined,
        tagMatch,
        field: fieldFilter,
        fieldOp: fieldFilterOperator !== 'contains' ? fieldFilterOperator : undefined,
        fieldQ: appliedFieldFilterValue || undefined,
        sort: sortBy === "tags" ? "tag" : undefined,
        order: sortBy === "tags" ? sortOrder : undefined,
        limit: pageSize,
        cursor: pageParam ?? undefined,
      }, signal),
    getNextPageParam: (lastPage) => lastPage.nextCursor,
    placeholderData: (previous) => previous,
    staleTime: 15_000,
  });

  const listedItems = useMemo(
    () =>
      (items.data?.pages.flatMap(
        (page) => page.items,
      ) as AdminContentListItem[]) ?? [],
    [items.data],
  );
  const totalItems = items.data?.pages[0]?.total ?? 0;
  const selectAllMatching = useMutation({
    mutationFn: async () => {
      const ids: string[] = [];
      let cursor: string | undefined;
      do {
        const page = await adminApi.contentItems({
          q: debouncedQ,
          mode,
          publication,
          source,
          pipelineKey: pipelineFilter || undefined,
          hasHint: hintFilter === "yes" ? true : hintFilter === "no" ? false : undefined,
          hasReports: reportsFilter === "yes" ? true : reportsFilter === "no" ? false : undefined,
          hasIssues: issuesFilter === "yes" ? true : issuesFilter === "no" ? false : undefined,
          includeTagIds: includeTagIds.join(",") || undefined,
          excludeTagIds: excludeTagIds.join(",") || undefined,
          tagMatch,
          field: fieldFilter,
          fieldOp: fieldFilterOperator !== 'contains' ? fieldFilterOperator : undefined,
          fieldQ: appliedFieldFilterValue || undefined,
          sort: sortBy === "tags" ? "tag" : undefined,
          order: sortBy === "tags" ? sortOrder : undefined,
          limit: 100,
          cursor,
        });
        if (page.total > 5_000) throw new AdminApiError(422, "CONTENT_BULK_LIMIT", `Найдено ${page.total.toLocaleString("ru-RU")} карточек. Уточните фильтр до 5 000 элементов для массового действия.`);
        ids.push(...page.items.map((item) => item.id));
        cursor = page.nextCursor ?? undefined;
      } while (cursor);
      return ids;
    },
    onSuccess: (ids) => {
      setSelected(new Set(ids));
      setSelectionAnchorIndex(null);
      notify("success", `Выбраны все карточки по фильтру: ${ids.length}`);
    },
    onError: (error) => notify("error", errorText(error)),
  });

  useEffect(() => {
    const target = loadMoreRef.current;
    if (!target || !items.hasNextPage || items.isFetchingNextPage) return;
    const observer = new IntersectionObserver(
      ([entry]) => {
        if (entry.isIntersecting) void items.fetchNextPage();
      },
      { rootMargin: "320px" },
    );
    observer.observe(target);
    return () => observer.disconnect();
  }, [items.fetchNextPage, items.hasNextPage, items.isFetchingNextPage]);

  const sourceLabel = (value: AdminContentListItem["source"]) =>
    value ? (sourceLabelMap[value] ?? value) : "—";
  const pipelineLabel = (value: AdminContentListItem["pipelineKey"]) =>
    value ? (pipelineLabelMap[value] ?? value) : "—";
  const asNumber = (value: unknown) =>
    Number.isFinite(Number(value)) ? Number(value) : 0;

  const sortedItems = useMemo(() => {
    const compareText = (left: string, right: string) =>
      left.localeCompare(right, "ru-RU", { sensitivity: "base" });
    const compareNumber = (left: number, right: number) =>
      left === right ? 0 : left > right ? 1 : -1;
    const compare = (
      left: AdminContentListItem,
      right: AdminContentListItem,
    ) => {
      if (sortBy === "titleRu") return compareText(left.titleRu, right.titleRu);
      if (sortBy === "id") return compareText(left.id, right.id);
      if (sortBy === "mode")
        return compareText(MODE_LABEL[left.mode], MODE_LABEL[right.mode]);
      if (sortBy === "status")
        return compareNumber(
          left.allowedInGame ? 1 : 0,
          right.allowedInGame ? 1 : 0,
        );
      if (sortBy === "source")
        return compareText(sourceLabel(left.source), sourceLabel(right.source));
      if (sortBy === "pipelineKey")
        return compareText(
          pipelineLabel(left.pipelineKey),
          pipelineLabel(right.pipelineKey),
        );
      if (sortBy === "tags")
        return compareText(
          left.tags.map((tag) => tag.name).join(", "),
          right.tags.map((tag) => tag.name).join(", "),
        );
      if (sortBy === "fieldsFilled")
        return compareNumber(left.fieldsFilled, right.fieldsFilled);
      if (sortBy === "hasHint")
        return compareNumber(left.hasHint ? 1 : 0, right.hasHint ? 1 : 0);
      if (sortBy === "completeness")
        return compareNumber(left.completeness, right.completeness);
      if (sortBy === "reportsCount")
        return compareNumber(left.reportsCount, right.reportsCount);
      if (sortBy === "issuesCount")
        return compareNumber(left.issuesCount, right.issuesCount);
      return compareNumber(
        Date.parse(left.updatedAt) || 0,
        Date.parse(right.updatedAt) || 0,
      );
    };
    const direction = sortOrder === "asc" ? 1 : -1;
    return [...listedItems].sort((left, right) => {
      const result = compare(left, right);
      if (result !== 0) return result * direction;
      return left.id.localeCompare(right.id, "ru-RU", { sensitivity: "base" });
    });
  }, [listedItems, sortBy, sortOrder]);

  const selectedVisibleCount = useMemo(
    () =>
      sortedItems.reduce(
        (count, item) => count + (selected.has(item.id) ? 1 : 0),
        0,
      ),
    [selected, sortedItems],
  );
  const selectedItemIds = useMemo(() => [...selected], [selected]);

  const bulk = useMutation({
    mutationFn: async (operation: "allow" | "disallow" | "add_tag" | "remove_tag") => {
      if (operation === 'add_tag' || operation === 'remove_tag') {
        const responses = await Promise.all(bulkTagIds.map((tagId) => adminApi.bulkContent({ itemIds: [...selected], operation, value: tagId, reason: operation === 'add_tag' ? 'Массовое назначение тегов' : 'Массовое снятие тегов' })))
        return { succeeded: selected.size, failed: responses.some((response) => Number(response.failed ?? 0) > 0) ? selected.size : 0, tagCount: bulkTagIds.length }
      }
      return adminApi.bulkContent({ itemIds: [...selected], operation, reason: operation === 'allow' ? 'Массовое включение в игру' : 'Массовое исключение из игры' })
    },
    onSuccess: (data) => {
      notify(
        "success",
        `Обработано: ${data.succeeded ?? 0}, ошибок: ${data.failed ?? 0}`,
      );
      setSelected(new Set());
      setBulkTagIds([]);
      setSelectionAnchorIndex(null);
      void client.invalidateQueries({ queryKey: ["admin", "content"] });
      void client.invalidateQueries({ queryKey: ["admin", "workspace"] });
      void client.invalidateQueries({ queryKey: ["admin", "content-tags"] });
    },
    onError: (error) => notify("error", errorText(error)),
  });
  const updateRowTags = useMutation({
    mutationFn: ({ itemId, current, next }: { itemId: string; current: string[]; next: string[] }) => {
      const before = new Set(current)
      const added = next.find((id) => !before.has(id))
      const removed = current.find((id) => !next.includes(id))
      if (!added && !removed) return Promise.resolve({})
      return adminApi.bulkContent({ itemIds: [itemId], operation: added ? 'add_tag' : 'remove_tag', value: added ?? removed, reason: added ? 'Тег назначен в таблице карточек' : 'Тег снят в таблице карточек' })
    },
    onSuccess: () => { void client.invalidateQueries({ queryKey: ['admin', 'content'] }); void client.invalidateQueries({ queryKey: ['admin', 'content-tags'] }) },
    onError: (error) => notify('error', errorText(error)),
  })
  const createTag = async (name: string) => {
    const created = await adminApi.createTag(name)
    await client.invalidateQueries({ queryKey: ['admin', 'content-tags'] })
    return created
  }

  const toggleSort = (key: ContentSortKey) => {
    const defaultDesc = new Set<ContentSortKey>([
      "updatedAt",
      "reportsCount",
      "issuesCount",
      "completeness",
      "fieldsFilled",
    ]);
    if (sortBy === key) {
      setSortOrder((current) => (current === "asc" ? "desc" : "asc"));
      return;
    }
    setSortBy(key);
    setSortOrder(defaultDesc.has(key) ? "desc" : "asc");
  };

  const sortMark = (key: ContentSortKey) => {
    if (sortBy !== key) return "↕";
    return sortOrder === "asc" ? "▲" : "▼";
  };

  const updateSelection = (
    itemId: string,
    rowIndex: number,
    checked: boolean,
    withShift: boolean,
  ) => {
    setSelected((current) => {
      const next = new Set(current);
      if (withShift && selectionAnchorIndex != null && sortedItems.length > 0) {
        const from = Math.min(selectionAnchorIndex, rowIndex);
        const to = Math.max(selectionAnchorIndex, rowIndex);
        for (let index = from; index <= to; index += 1) {
          const targetId = sortedItems[index]?.id;
          if (!targetId) continue;
          if (checked) next.add(targetId);
          else next.delete(targetId);
        }
      } else if (checked) {
        next.add(itemId);
      } else {
        next.delete(itemId);
      }
      return next;
    });
    setSelectionAnchorIndex(rowIndex);
  };

  const resetFilters = () => {
    setQ("");
    setMode(scopedMode ?? "");
    setPublication("all");
    setSource("");
    setPipelineFilter("");
    setHintFilter("all");
    setReportsFilter("all");
    setIssuesFilter("all");
    setIncludeTagIds([]);
    setExcludeTagIds([]);
    setTagMatch("all");
    setFieldFilter("all");
    setFieldFilterOperator('contains');
    setFieldFilterValue("");
    setSortBy("updatedAt");
    setSortOrder("desc");
    setSelected(new Set());
    setSelectionAnchorIndex(null);
  };

  const hasFieldFilter = fieldOperatorNeedsValue ? Boolean(fieldFilterValue.trim()) : true;
  const openItem = (itemId: string) => navigate('content', itemId, location.search);
  const closeItem = () => navigate('content', null, location.search);
  const openPreview = (itemId?: string) => {
    const target = itemId ? sortedItems.find((item) => item.id === itemId) : sortedItems[0];
    if (target) setPreviewId(target.id);
  };

  return (
    <>
      <PageHead
        eyebrow="Контент"
        title={scopedMode ? `Карточки · ${MODE_LABEL[scopedMode]}` : "Карточки"}
        description={scopedMode ? `Поиск, проверка и публикация карточек категории «${MODE_LABEL[scopedMode]}».` : "Поиск, проверка и публикация всех шести игровых библиотек."}
        actions={
          <>
            <div className="admin-view-switch">
              <button
                className={view === "table" ? "is-active" : ""}
                onClick={() => setView("table")}
              >
                <Menu />
                Таблица
              </button>
              <button
                className={view === "grid" ? "is-active" : ""}
                onClick={() => setView("grid")}
              >
                <Boxes />
                Карточки
              </button>
              <button
                className={previewId ? "is-active" : ""}
                onClick={() => openPreview()}
                disabled={!sortedItems.length}
              >
                <Eye />
                Проверка
              </button>
            </div>
            <button
              className="admin-btn admin-btn--secondary"
              onClick={() => setExchange("import")}
            >
              <Upload />
              Импорт JSON
            </button>
            <button
              className="admin-btn admin-btn--secondary"
              disabled={!selected.size}
              onClick={() => setExchange("export")}
            >
              <Download />
              Экспорт JSON{selected.size ? ` · ${selected.size}` : ""}
            </button>
            <button
              className="admin-btn admin-btn--primary"
              onClick={() => setAdding(true)}
            >
              <Plus />
              Добавить карточку
            </button>
          </>
        }
      />
      <WorkspaceBar notify={notify} />

      <div className="admin-toolbar admin-toolbar--content">
        <label className="admin-search">
          <Search />
          <input
            value={q}
            onChange={(event) => setQ(event.target.value)}
            placeholder="Название, альтернативное название или ID"
          />
          {q && (
            <button onClick={() => setQ("")}>
              <X />
            </button>
          )}
        </label>
        {!scopedMode && <label>
          <Filter />
          <select
            value={mode}
            onChange={(event) => setMode(event.target.value)}
          >
            <option value="">Все категории</option>
            {MODES.map((entry) => (
              <option key={entry.value} value={entry.value}>
                {entry.label}
              </option>
            ))}
          </select>
        </label>}
        <label>
          <Archive />
          <select
            value={publication}
            onChange={(event) => setPublication(event.target.value)}
          >
            <option value="all">Все статусы</option>
            <option value="published">Опубликованы</option>
            <option value="hidden">Скрыты</option>
          </select>
        </label>
        <label>
          <FileJson />
          <select
            value={source}
            onChange={(event) => setSource(event.target.value)}
          >
            <option value="">Все источники</option>
            <option value="manual">Ручное</option>
            <option value="ai_pipeline">AI пайплайн</option>
            <option value="bulk">Массовое</option>
            <option value="import">Импорт</option>
            <option value="rollback">Откат</option>
            <option value="report_fix">Фикс по репорту</option>
          </select>
        </label>
        <label>
          <Bot />
          <select
            value={pipelineFilter}
            onChange={(event) => setPipelineFilter(event.target.value)}
          >
            <option value="">Любой пайплайн</option>
            <option value="music">Музыка</option>
            <option value="movie">Кино</option>
            <option value="anime">Аниме</option>
          </select>
        </label>
        <label>
          <Sparkles />
          <select
            value={hintFilter}
            onChange={(event) =>
              setHintFilter(event.target.value as "all" | "yes" | "no")
            }
          >
            <option value="all">Подсказка: все</option>
            <option value="yes">Подсказка: есть</option>
            <option value="no">Подсказка: нет</option>
          </select>
        </label>
        <label>
          <Bug />
          <select
            value={reportsFilter}
            onChange={(event) =>
              setReportsFilter(event.target.value as "all" | "yes" | "no")
            }
          >
            <option value="all">Репорты: все</option>
            <option value="yes">Репорты: есть</option>
            <option value="no">Репорты: нет</option>
          </select>
        </label>
        <label>
          <AlertTriangle />
          <select
            aria-label="Фильтр качества"
            value={issuesFilter}
            onChange={(event) =>
              setIssuesFilter(event.target.value as "all" | "yes" | "no")
            }
          >
            <option value="all">Качество: все</option>
            <option value="yes">Качество: есть проблемы</option>
            <option value="no">Качество: без проблем</option>
          </select>
        </label>
        <label>
          <ListChecks />
          <select
            aria-label="Размер страницы"
            value={pageSize}
            onChange={(event) => {
              setPageSize(Number(event.target.value) as 20 | 40 | 60 | 100);
              setSelected(new Set());
              setSelectionAnchorIndex(null);
            }}
          >
            <option value={20}>20</option>
            <option value={40}>40</option>
            <option value={60}>60</option>
            <option value={100}>100</option>
          </select>
        </label>
        <button
          className="admin-btn admin-btn--secondary"
          onClick={() => void items.refetch()}
        >
          <RefreshCw />
        </button>
        <button
          className="admin-btn admin-btn--secondary"
          disabled={!totalItems || filtersPending || selectAllMatching.isPending}
          title="Выбирает все карточки из базы, совпавшие с текущими фильтрами"
          onClick={() => selectAllMatching.mutate()}
        >
          {selectAllMatching.isPending ? <LoaderCircle /> : <ListChecks />}
          {selectAllMatching.isPending ? "Собираем выборку…" : `Выбрать все · ${totalItems}`}
        </button>
      </div>

      <section className="admin-content-filter-panel" aria-label="Фильтры карточек">
        <div className="admin-content-tag-filters">
          <TagPicker
            tags={tags.data?.items ?? []}
            value={includeTagIds}
            onChange={(ids) => {
              setIncludeTagIds(ids);
              setSelected(new Set());
            }}
            label="С тегами"
          />
          <label>
            <Tags />
            <select
              value={tagMatch}
              onChange={(event) =>
                setTagMatch(event.target.value as "all" | "any")
              }
            >
              <option value="all">Должны быть все</option>
              <option value="any">Достаточно любого</option>
            </select>
          </label>
          <TagPicker
            tags={tags.data?.items ?? []}
            value={excludeTagIds}
            onChange={(ids) => {
              setExcludeTagIds(ids);
              setSelected(new Set());
            }}
            label="Исключить теги"
          />
        </div>
        <div className="admin-content-local-filters">
          <div className="admin-content-field-filter" title="Ищет совпадения по всей базе, а не только среди загруженных строк">
            <label>
              <Filter />
              <select
                aria-label="Поле для фильтрации"
                value={fieldFilter}
                onChange={(event) => {
                  setFieldFilter(event.target.value as ContentFieldFilter);
                  setSelected(new Set());
                  setSelectionAnchorIndex(null);
                }}
              >
                {CONTENT_FIELD_GROUPS.map((group) => (
                  <optgroup key={group.label} label={group.label}>
                    {group.options.map((option) => (
                      <option key={option.value} value={option.value}>{option.label}</option>
                    ))}
                  </optgroup>
                ))}
              </select>
            </label>
            <label>
              <Settings2 />
              <select
                aria-label="Условие фильтрации"
                value={fieldFilterOperator}
                onChange={(event) => {
                  setFieldFilterOperator(event.target.value as ContentFieldOperator);
                  setSelected(new Set());
                  setSelectionAnchorIndex(null);
                }}
              >
                {CONTENT_FIELD_OPERATORS.map((operator) => (
                  <option key={operator.value} value={operator.value}>{contentFieldOperatorLabel(operator.value, fieldFilter)}</option>
                ))}
              </select>
            </label>
            <label className="admin-search admin-search--compact">
              <Search />
              <input
                aria-label="Значение поля"
                value={fieldFilterValue}
                disabled={!fieldOperatorNeedsValue}
                onChange={(event) => {
                  setFieldFilterValue(event.target.value);
                  setSelected(new Set());
                  setSelectionAnchorIndex(null);
                }}
                inputMode={['gt', 'gte', 'lt', 'lte'].includes(fieldFilterOperator) ? 'decimal' : 'text'}
                placeholder={!fieldOperatorNeedsValue ? 'Значение не требуется' : fieldComparisonUsesLength ? 'Количество символов…' : ['gt', 'gte', 'lt', 'lte'].includes(fieldFilterOperator) ? 'Введите число…' : fieldFilterOperator === 'equals' || fieldFilterOperator === 'not_equals' ? 'Введите точное значение…' : 'Введите значение…'}
              />
              {fieldOperatorNeedsValue && fieldFilterValue && (
                <button aria-label="Очистить значение фильтра" onClick={() => setFieldFilterValue("")}>
                  <X />
                </button>
              )}
            </label>
            <span className={filtersPending || (items.isFetching && !items.isFetchingNextPage) ? 'is-loading' : undefined}>
              {filtersPending || (items.isFetching && !items.isFetchingNextPage) ? <LoaderCircle /> : <Database />}
              {filtersPending ? 'Применяем…' : items.isFetching && !items.isFetchingNextPage ? 'Обновляем…' : 'Вся база'}
            </span>
          </div>
          <label>
            <Tags />
            <select
              value={sortBy}
              onChange={(event) =>
                setSortBy(event.target.value as ContentSortKey)
              }
            >
              <option value="updatedAt">Сортировка: изменено</option>
              <option value="titleRu">Сортировка: название</option>
              <option value="tags">Сортировка: тег</option>
            </select>
          </label>
          <label>
            <ChevronDown />
            <select
              value={sortOrder}
              onChange={(event) =>
                setSortOrder(event.target.value as "asc" | "desc")
              }
            >
              <option value="asc">По возрастанию</option>
              <option value="desc">По убыванию</option>
            </select>
          </label>
          <button
            className="admin-btn admin-btn--secondary"
            onClick={resetFilters}
          >
            Сбросить фильтры
          </button>
        </div>
      </section>

      {selected.size > 0 && (
        <div className="admin-bulk">
          <strong>Выбрано: {selected.size}</strong>
          <button onClick={() => setExchange("export")}>
            <Download />
            Экспорт JSON
          </button>
          <button onClick={() => bulk.mutate("allow")}>
            <Check />
            Разрешить в игре
          </button>
          <button onClick={() => bulk.mutate("disallow")}>
            <Archive />
            Скрыть
          </button>
          <details className="admin-bulk-tags">
            <summary><Tags />Теги{bulkTagIds.length ? ` · ${bulkTagIds.length}` : ""}</summary>
            <div>
              <TagPicker compact label="Массовые теги" tags={tags.data?.items ?? []} value={bulkTagIds} onChange={setBulkTagIds} onCreate={createTag} />
              <button disabled={!bulkTagIds.length} onClick={() => bulk.mutate("add_tag")}>
                <Tags />
                Назначить · {bulkTagIds.length}
              </button>
              <button
                disabled={!bulkTagIds.length}
                onClick={() => bulk.mutate("remove_tag")}
              >
                <X />
                Снять · {bulkTagIds.length}
              </button>
            </div>
          </details>
          <button
            onClick={() => {
              setSelected(new Set());
              setSelectionAnchorIndex(null);
            }}
          >
            <X />
            Снять выбор
          </button>
        </div>
      )}

      {items.isLoading ? (
        <Loading />
      ) : items.error ? (
        <ErrorState error={items.error} retry={() => void items.refetch()} />
      ) : !listedItems.length ? (
        <Empty
          title={hasFieldFilter ? "По выбранному полю совпадений нет" : "Ничего не найдено"}
          text={hasFieldFilter ? "Измените поле или искомое значение. Поиск выполняется по всей базе карточек." : "Измените запрос или сбросьте фильтры."}
          icon={hasFieldFilter ? <Filter /> : <Search />}
          action={
            <button
              className="admin-btn admin-btn--secondary"
              onClick={() => {
                if (hasFieldFilter) {
                  setFieldFilter("all");
                  setFieldFilterValue("");
                } else resetFilters();
              }}
            >
              {hasFieldFilter ? "Сбросить фильтр по полю" : "Сбросить фильтры"}
            </button>
          }
        />
      ) : view === "grid" ? (
        <div className="admin-content-grid">
          {sortedItems.map((item) => (
            <button key={item.id} onClick={() => openPreview(item.id)} title="Открыть предпросмотр карточки">
              <div>
                {item.posterUrl ? (
                  <img src={item.posterUrl} alt="" loading="lazy" decoding="async" />
                ) : (
                  <ImageIcon />
                )}
                {item.draftVersion && <span>Draft v{item.draftVersion}</span>}
              </div>
              <small>{MODE_LABEL[item.mode]}</small>
              <strong>{item.titleRu}</strong>
              <p>{item.titleOriginal || item.id}</p>
              <footer>
                <Status value={item.allowedInGame ? "active" : "blocked"}>
                  {item.allowedInGame ? "В игре" : "Скрыта"}
                </Status>
                <span>
                  {item.fieldsFilled}/{item.fieldsTotal} · {item.completeness}%
                </span>
              </footer>
            </button>
          ))}
        </div>
      ) : (
        <div className="admin-table-wrap">
          <table className="admin-table">
            <thead>
              <tr>
                <th className="admin-check">
                  <input
                    type="checkbox"
                    aria-label="Выбрать все"
                    checked={
                      sortedItems.length > 0 &&
                      selectedVisibleCount === sortedItems.length
                    }
                    onChange={(event) => {
                      const checked = event.target.checked;
                      setSelected((current) => {
                        const next = new Set(current);
                        for (const item of sortedItems) {
                          if (checked) next.add(item.id);
                          else next.delete(item.id);
                        }
                        return next;
                      });
                      setSelectionAnchorIndex(null);
                    }}
                  />
                </th>
                <th>
                  <button
                    className="admin-th-sort"
                    onClick={() => toggleSort("titleRu")}
                  >
                    Карточка{" "}
                    <span
                      className={`admin-th-sort__mark ${sortBy === "titleRu" ? "is-active" : ""}`}
                    >
                      {sortMark("titleRu")}
                    </span>
                  </button>
                </th>
                <th>
                  <button
                    className="admin-th-sort"
                    onClick={() => toggleSort("id")}
                  >
                    ID{" "}
                    <span
                      className={`admin-th-sort__mark ${sortBy === "id" ? "is-active" : ""}`}
                    >
                      {sortMark("id")}
                    </span>
                  </button>
                </th>
                <th>
                  <button
                    className="admin-th-sort"
                    onClick={() => toggleSort("mode")}
                  >
                    Категория{" "}
                    <span
                      className={`admin-th-sort__mark ${sortBy === "mode" ? "is-active" : ""}`}
                    >
                      {sortMark("mode")}
                    </span>
                  </button>
                </th>
                <th>
                  <button
                    className="admin-th-sort"
                    onClick={() => toggleSort("status")}
                  >
                    Статус{" "}
                    <span
                      className={`admin-th-sort__mark ${sortBy === "status" ? "is-active" : ""}`}
                    >
                      {sortMark("status")}
                    </span>
                  </button>
                </th>
                <th>
                  <button
                    className="admin-th-sort"
                    onClick={() => toggleSort("source")}
                  >
                    Источник{" "}
                    <span
                      className={`admin-th-sort__mark ${sortBy === "source" ? "is-active" : ""}`}
                    >
                      {sortMark("source")}
                    </span>
                  </button>
                </th>
                <th>
                  <button
                    className="admin-th-sort"
                    onClick={() => toggleSort("pipelineKey")}
                  >
                    Пайплайн{" "}
                    <span
                      className={`admin-th-sort__mark ${sortBy === "pipelineKey" ? "is-active" : ""}`}
                    >
                      {sortMark("pipelineKey")}
                    </span>
                  </button>
                </th>
                <th>
                  <button
                    className="admin-th-sort"
                    onClick={() => toggleSort("tags")}
                  >
                    Теги{" "}
                    <span className={`admin-th-sort__mark ${sortBy === "tags" ? "is-active" : ""}`}>
                      {sortMark("tags")}
                    </span>
                  </button>
                </th>
                <th>
                  <button
                    className="admin-th-sort"
                    onClick={() => toggleSort("fieldsFilled")}
                  >
                    Поля{" "}
                    <span
                      className={`admin-th-sort__mark ${sortBy === "fieldsFilled" ? "is-active" : ""}`}
                    >
                      {sortMark("fieldsFilled")}
                    </span>
                  </button>
                </th>
                <th>
                  <button
                    className="admin-th-sort"
                    onClick={() => toggleSort("hasHint")}
                  >
                    Подсказка{" "}
                    <span
                      className={`admin-th-sort__mark ${sortBy === "hasHint" ? "is-active" : ""}`}
                    >
                      {sortMark("hasHint")}
                    </span>
                  </button>
                </th>
                <th>
                  <button
                    className="admin-th-sort"
                    onClick={() => toggleSort("completeness")}
                  >
                    Полнота{" "}
                    <span
                      className={`admin-th-sort__mark ${sortBy === "completeness" ? "is-active" : ""}`}
                    >
                      {sortMark("completeness")}
                    </span>
                  </button>
                </th>
                <th>
                  <button
                    className="admin-th-sort"
                    onClick={() => toggleSort("reportsCount")}
                  >
                    Репорты{" "}
                    <span
                      className={`admin-th-sort__mark ${sortBy === "reportsCount" ? "is-active" : ""}`}
                    >
                      {sortMark("reportsCount")}
                    </span>
                  </button>
                </th>
                <th>
                  <button
                    className="admin-th-sort"
                    onClick={() => toggleSort("issuesCount")}
                  >
                    Качество{" "}
                    <span
                      className={`admin-th-sort__mark ${sortBy === "issuesCount" ? "is-active" : ""}`}
                    >
                      {sortMark("issuesCount")}
                    </span>
                  </button>
                </th>
                <th>
                  <button
                    className="admin-th-sort"
                    onClick={() => toggleSort("updatedAt")}
                  >
                    Изменена{" "}
                    <span
                      className={`admin-th-sort__mark ${sortBy === "updatedAt" ? "is-active" : ""}`}
                    >
                      {sortMark("updatedAt")}
                    </span>
                  </button>
                </th>
                <th />
              </tr>
            </thead>
            <tbody>
              {sortedItems.map((item, rowIndex) => (
                <tr
                  key={item.id}
                  className={selectedId === item.id ? "is-open" : ""}
                >
                  <td className="admin-check">
                    <input
                      type="checkbox"
                      aria-label={`Выбрать ${item.titleRu}`}
                      checked={selected.has(item.id)}
                      onChange={(event) =>
                        updateSelection(
                          item.id,
                          rowIndex,
                          event.target.checked,
                          event.nativeEvent instanceof MouseEvent
                            ? event.nativeEvent.shiftKey
                            : false,
                        )
                      }
                    />
                  </td>
                  <td>
                    <div className="admin-title-actions">
                      <button
                        className="admin-title-cell"
                        onClick={() => openItem(item.id)}
                      >
                        {item.posterUrl ? (
                          <img src={item.posterUrl} alt="" loading="lazy" decoding="async" />
                        ) : (
                          <span>
                            <ImageIcon />
                          </span>
                        )}
                        <span>
                          <strong>{item.titleRu}</strong>
                          <small>
                            {item.titleOriginal || "Без оригинального названия"}
                            {item.year ? ` · ${item.year}` : ""}
                          </small>
                        </span>
                      </button>
                      <button className="admin-title-preview" title="Предпросмотр как в игре" aria-label={`Предпросмотр ${item.titleRu}`} onClick={() => openPreview(item.id)}><Eye /></button>
                    </div>
                  </td>
                  <td>
                    <code>{item.id}</code>
                  </td>
                  <td>{MODE_LABEL[item.mode]}</td>
                  <td>
                    <Status value={item.allowedInGame ? "active" : "blocked"}>
                      {item.allowedInGame ? "В игре" : "Скрыта"}
                    </Status>
                    {item.draftVersion && (
                      <small className="admin-draft-label">
                        Draft v{item.draftVersion}
                      </small>
                    )}
                  </td>
                  <td>
                    <span
                      className={`admin-source-chip ${item.source ? `admin-source-chip--${item.source}` : ""}`}
                    >
                      {sourceLabel(item.source)}
                    </span>
                  </td>
                  <td>{pipelineLabel(item.pipelineKey)}</td>
                  <td className="admin-tags-cell">
                    <TagPicker
                      compact
                      label="Теги"
                      tags={tags.data?.items ?? []}
                      value={item.tags.map((tag) => tag.id)}
                      disabled={updateRowTags.isPending}
                      onCreate={createTag}
                      onChange={(next) => updateRowTags.mutate({ itemId: item.id, current: item.tags.map((tag) => tag.id), next })}
                    />
                  </td>
                  <td>
                    {item.fieldsFilled}/{item.fieldsTotal}
                  </td>
                  <td>
                    {item.hasHint ? (
                      <Status value="active">Есть</Status>
                    ) : (
                      <Status value="warning">Нет</Status>
                    )}
                  </td>
                  <td>
                    <div
                      className="admin-completeness admin-completeness--hint"
                      data-tooltip={
                        item.missingFields.length
                          ? `Не хватает: ${item.missingFields.join(", ")}`
                          : "Все базовые поля заполнены"
                      }
                    >
                      <i style={{ width: `${item.completeness}%` }} />
                      <span>{item.completeness}%</span>
                    </div>
                  </td>
                  <td>
                    {item.reportsCount ? (
                      <button
                        className="admin-count admin-count--warn"
                        onClick={() => navigate("reports")}
                      >
                        {item.reportsCount}
                      </button>
                    ) : (
                      "—"
                    )}
                  </td>
                  <td>
                    {item.issuesCount ? (
                      <span className="admin-count admin-count--danger">
                        {item.issuesCount}
                      </span>
                    ) : (
                      <Check className="admin-table-ok" />
                    )}
                  </td>
                  <td>{compactDate(item.updatedAt)}</td>
                  <td>
                    <div className="admin-row-actions">
                      <button className="admin-icon-btn" title="Предпросмотр как в игре" aria-label={`Предпросмотр ${item.titleRu}`} onClick={() => openPreview(item.id)}><Eye /></button>
                      <button className="admin-icon-btn" title="Открыть редактор" aria-label={`Редактировать ${item.titleRu}`} onClick={() => openItem(item.id)}><ChevronRight /></button>
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
          <footer className="admin-table-footer">
            <span>
              Показано {sortedItems.length} из{" "}
              {totalItems.toLocaleString("ru-RU")}
              {hasFieldFilter ? ` · ${fieldFilter} · ${contentFieldOperatorLabel(fieldFilterOperator, fieldFilter)}${fieldOperatorNeedsValue ? ` · ${fieldFilterValue.trim()}` : ''}` : ""}
            </span>
          </footer>
        </div>
      )}

      <div className="admin-content-pagination" ref={loadMoreRef}>
        {items.hasNextPage
          ? items.isFetchingNextPage
            ? "Загружаем дальше…"
            : "Прокрутите ниже, чтобы догрузить список"
          : `Загружены все ${listedItems.length.toLocaleString("ru-RU")}`}
      </div>

      {selectedId && (
        <ItemEditor
          itemId={selectedId}
          onClose={closeItem}
          notify={notify}
        />
      )}
      {previewId && (
        <ContentPreviewModal
          items={sortedItems}
          currentId={previewId}
          onChange={setPreviewId}
          onClose={() => setPreviewId(null)}
          onEdit={(itemId) => {
            setPreviewId(null);
            openItem(itemId);
          }}
          notify={notify}
        />
      )}
      {adding && (
        <NewCardDialog
          close={() => setAdding(false)}
          done={(id) => {
            setAdding(false);
            openItem(id);
            void client.invalidateQueries({ queryKey: ["admin", "content"] });
            void client.invalidateQueries({ queryKey: ["admin", "workspace"] });
          }}
          notify={notify}
        />
      )}
      {exchange && (
        <ContentExchangeDialog
          initialTab={exchange}
          itemIds={selectedItemIds}
          close={() => setExchange(null)}
          notify={notify}
          done={() => {
            setExchange(null);
            setSelected(new Set());
            setSelectionAnchorIndex(null);
            void client.invalidateQueries({ queryKey: ["admin", "content"] });
            void client.invalidateQueries({ queryKey: ["admin", "workspace"] });
          }}
        />
      )}
    </>
  );
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

type PipelineKey = 'music' | 'movie' | 'anime' | 'normalization'

const NORMALIZATION_COMMON_FIELDS = ['titleRu', 'titleOriginal', 'alternativeTitles', 'year', 'endYear', 'plotHint', 'slogan', 'facts', 'genres', 'allowedInGame', 'posterUrl', 'headerUrl', 'backdropUrl', 'screenshots']
const NORMALIZATION_MODE_FIELDS: Record<ContentMode, string[]> = {
  movie: ['runtimeMinutes', 'ageRating', 'budget', 'directors', 'writers', 'cast', 'countries', 'kinopoiskId', 'imdbId', 'ratings', 'awards'],
  series: ['episodes', 'seasonsCount', 'seriesStatus', 'showrunners', 'writers', 'cast', 'countries', 'kinopoiskId', 'imdbId'],
  anime: ['animeKind', 'animeStatus', 'episodes', 'animeEpisodesAired', 'animeSource', 'studios', 'countries', 'shikimoriId', 'shikimoriScore', 'shikimoriUrl'],
  game: ['developers', 'publishers', 'platforms', 'steamCategories', 'steamTags', 'steamAppId', 'steamUrl', 'price', 'metacritic', 'countries'],
  music: ['activityStartYear', 'endYear', 'countries', 'aliases', 'gameTier', 'contentStatus', 'musicIsActive', 'musicOrigin', 'musicType', 'topTracks', 'topAlbums', 'similarArtists', 'members', 'associatedActs', 'musicLinks', 'dataQuality'],
  diagnosis: ['icd10', 'icdGroup', 'bodySystems', 'diseaseTypes', 'course', 'contagiousness', 'symptoms', 'diagnostics', 'risks', 'severity', 'urgency', 'safetyDisclaimer', 'caseVignettes'],
}
const NORMALIZATION_FIELD_LABELS: Record<string, string> = {
  activityStartYear: 'Начало деятельности', year: 'Год', endYear: 'Год окончания', titleRu: 'Русское название',
  titleOriginal: 'Оригинальное название', alternativeTitles: 'Альтернативные названия', plotHint: 'Подсказка', slogan: 'Слоган',
  facts: 'Факты', genres: 'Жанры', countries: 'Страны', allowedInGame: 'Допуск в игру', posterUrl: 'Постер',
  headerUrl: 'Обложка', backdropUrl: 'Фон', screenshots: 'Скриншоты', runtimeMinutes: 'Длительность', ageRating: 'Возрастной рейтинг',
  directors: 'Режиссёры', writers: 'Сценаристы', cast: 'Актёры', ratings: 'Рейтинги', awards: 'Награды',
}
const normalizationFallbackFields = (mode: ContentMode) => [...new Set([
  ...NORMALIZATION_COMMON_FIELDS.filter((field) => !(mode === 'music' && field === 'year')),
  ...NORMALIZATION_MODE_FIELDS[mode],
])].map((field) => ({ field, label: NORMALIZATION_FIELD_LABELS[field] ?? field }))

function PipelinesPage({ selectedId, navigate, notify }: { selectedId: string | null; navigate: (section: Section, id?: string | null) => void; notify: (tone: Notice['tone'], text: string) => void }) {
  const client = useQueryClient()
  const pipelines = useQuery({ queryKey: ['admin', 'pipelines'], queryFn: adminApi.pipelines })
  const runs = useQuery({ queryKey: ['admin', 'pipeline-runs'], queryFn: adminApi.pipelineRuns, refetchInterval: 5_000 })
  const selectedRun = runs.data?.items.find((entry) => entry.id === selectedId)
  const items = useQuery({ queryKey: ['admin', 'pipeline-items', selectedId], queryFn: () => adminApi.pipelineItems(selectedId!), enabled: Boolean(selectedId), refetchInterval: selectedId ? 5_000 : false })
  const contentTags = useQuery({ queryKey: ['admin', 'content-tags'], queryFn: adminApi.tags })
  const runEvents = useQuery({
    queryKey: ['admin', 'pipeline-events', selectedId],
    queryFn: () => adminApi.pipelineRunEvents(selectedId!),
    enabled: Boolean(selectedId),
    refetchInterval: selectedRun && ['queued', 'running'].includes(String(selectedRun.status)) ? 2_500 : false,
  })
  const [scenario, setScenario] = useState('manual'); const [maxItems, setMaxItems] = useState(5); const [starting, setStarting] = useState(false); const [pipelineKey, setPipelineKey] = useState<PipelineKey>('music')
  const [repeatSourceRunId, setRepeatSourceRunId] = useState<string | null>(null)
  const [pipelineAiMode, setPipelineAiMode] = useState<'auto' | 'never'>('auto')
  const [pipelineWebSearch, setPipelineWebSearch] = useState(true)
  const [includeExisting, setIncludeExisting] = useState(false)
  const [selectedPipelineIdsText, setSelectedPipelineIdsText] = useState('')
  const [normalizationMode, setNormalizationMode] = useState<ContentMode>('music')
  const [normalizationField, setNormalizationField] = useState('activityStartYear')
  const [normalizationPrompt, setNormalizationPrompt] = useState('Проверь по надежным источникам и унифицируй значение. Для сольного артиста укажи первый подтвержденный год профессиональной музыкальной деятельности или дебюта, для группы — год основания. Никогда не используй год рождения. Если надежных данных нет — очисти поле.')
  const normalizationPromptRef = useRef<HTMLTextAreaElement>(null)
  const [normalizationContextFields, setNormalizationContextFields] = useState<string[]>([])
  const [normalizationScope, setNormalizationScope] = useState<'all' | 'selected'>('all')
  const [normalizationQuery, setNormalizationQuery] = useState('')
  const [normalizationSelected, setNormalizationSelected] = useState<Set<string>>(new Set())
  const [normalizationIncludeTags, setNormalizationIncludeTags] = useState<string[]>([])
  const [normalizationExcludeTags, setNormalizationExcludeTags] = useState<string[]>([])
  const [normalizationTagMatch, setNormalizationTagMatch] = useState<'all' | 'any'>('all')
  const [normalizationPrefilled, setNormalizationPrefilled] = useState(false)
  const [artistText, setArtistText] = useState(''); const artists = useMemo(() => parseArtistList(artistText), [artistText])
  const [movieText, setMovieText] = useState(''); const movies = useMemo(() => parseMovieList(movieText), [movieText])
  const [animeText, setAnimeText] = useState(''); const anime = useMemo(() => parseAnimeList(animeText), [animeText])
  const manualItems = pipelineKey === 'music' ? artists : pipelineKey === 'movie' ? movies : anime
  const selectedPipelineIds = useMemo(() => [...new Set(selectedPipelineIdsText.split(/\r?\n|,/).map((entry) => entry.trim()).filter(Boolean))].slice(0, 20), [selectedPipelineIdsText])
  const manualPayload = pipelineKey === 'music' ? { artists, includeExisting } : pipelineKey === 'movie' ? { movies, includeExisting } : { anime, includeExisting }
  const preview = useQuery({ queryKey: ['admin', 'pipeline-manual-preview', pipelineKey, manualItems], queryFn: () => adminApi.pipelineManualPreview(pipelineKey as 'music' | 'movie' | 'anime', manualItems), enabled: starting && pipelineKey !== 'normalization' && scenario === 'manual' && manualItems.length > 0 })
  const normalizationFieldsQuery = useQuery({ queryKey: ['admin', 'normalization-fields', normalizationMode], queryFn: () => adminApi.normalizationFields(normalizationMode), enabled: starting && pipelineKey === 'normalization', retry: 1, staleTime: 5 * 60_000 })
  const normalizationFieldOptions = useMemo(() => {
    const remote = normalizationFieldsQuery.data?.mode === normalizationMode ? normalizationFieldsQuery.data.items : []
    return remote.length ? remote : normalizationFallbackFields(normalizationMode)
  }, [normalizationFieldsQuery.data, normalizationMode])
  useEffect(() => {
    if (!normalizationFieldOptions.some((entry) => entry.field === normalizationField)) setNormalizationField(normalizationFieldOptions[0]?.field ?? '')
  }, [normalizationField, normalizationFieldOptions])
  useEffect(() => {
    if (starting && pipelineKey === 'normalization' && !normalizationPrefilled && normalizationFieldsQuery.data?.mode === normalizationMode) {
      setNormalizationContextFields(normalizationFieldsQuery.data.defaultContextFields)
    }
  }, [starting, pipelineKey, normalizationMode, normalizationPrefilled, normalizationFieldsQuery.data?.mode])
  const normalizationTags = useQuery({ queryKey: ['admin', 'content-tags'], queryFn: adminApi.tags, enabled: starting && pipelineKey === 'normalization' })
  const normalizationCandidates = useQuery({ queryKey: ['admin', 'normalization-candidates', normalizationMode, normalizationQuery, normalizationIncludeTags, normalizationExcludeTags, normalizationTagMatch], queryFn: () => adminApi.contentItems({ mode: normalizationMode, q: normalizationQuery || undefined, includeTagIds: normalizationIncludeTags.join(',') || undefined, excludeTagIds: normalizationExcludeTags.join(',') || undefined, tagMatch: normalizationTagMatch, limit: 100, sort: 'title' }), enabled: starting && pipelineKey === 'normalization' })
  const normalizationUnknownVariables = useMemo(() => {
    const allowed = new Set((normalizationFieldsQuery.data?.variables ?? []).map((entry) => entry.name))
    if (!allowed.size) return []
    return [...new Set([...normalizationPrompt.matchAll(/%([^%\s]{1,80})%/g)].map((match) => match[1]).filter((name) => !allowed.has(name)))]
  }, [normalizationPrompt, normalizationFieldsQuery.data?.variables])
  const normalizationPayload = { mode: normalizationMode, field: normalizationField, prompt: normalizationPrompt, contextFields: normalizationContextFields, scope: normalizationScope, itemIds: normalizationScope === 'selected' ? [...normalizationSelected] : undefined, query: normalizationQuery || undefined, includeTagIds: normalizationIncludeTags, excludeTagIds: normalizationExcludeTags, tagMatch: normalizationTagMatch, maxItems, model: 'gpt-5-mini', webSearch: pipelineWebSearch }
  const [normalizationPreviewPayload, setNormalizationPreviewPayload] = useState<Record<string, unknown> | null>(null)
  useEffect(() => {
    if (!starting || pipelineKey !== 'normalization' || normalizationPrompt.trim().length < 10 || normalizationUnknownVariables.length || (normalizationScope === 'selected' && !normalizationSelected.size)) {
      setNormalizationPreviewPayload(null)
      return
    }
    const timer = window.setTimeout(() => setNormalizationPreviewPayload(normalizationPayload), 450)
    return () => window.clearTimeout(timer)
  }, [starting, pipelineKey, normalizationMode, normalizationField, normalizationPrompt, normalizationContextFields, normalizationScope, normalizationQuery, normalizationSelected, normalizationIncludeTags, normalizationExcludeTags, normalizationTagMatch, maxItems, normalizationUnknownVariables.length])
  const normalizationRenderedPreview = useQuery({
    queryKey: ['admin', 'normalization-rendered-preview', normalizationPreviewPayload],
    queryFn: () => adminApi.normalizationPreview(normalizationPreviewPayload!),
    enabled: Boolean(normalizationPreviewPayload),
    retry: false,
  })
  const estimate = useQuery({
    queryKey: ['admin', 'pipeline-estimate', pipelineKey, scenario, maxItems, manualItems, includeExisting, selectedPipelineIds, pipelineAiMode, pipelineWebSearch, normalizationMode, normalizationField, normalizationPrompt, normalizationContextFields, normalizationScope, normalizationQuery, normalizationSelected.size, normalizationIncludeTags, normalizationExcludeTags, normalizationTagMatch], enabled: pipelineKey === 'normalization' ? normalizationPrompt.trim().length >= 10 && !normalizationUnknownVariables.length && (normalizationScope === 'all' || normalizationSelected.size > 0) : scenario === 'manual' ? manualItems.length > 0 : scenario === 'selected' ? selectedPipelineIds.length > 0 && selectedPipelineIds.length <= maxItems : true,
    queryFn: () => pipelineKey === 'normalization' ? adminApi.pipelineEstimate('normalization', normalizationPayload) : adminApi.pipelineEstimate(pipelineKey, { scenario, maxItems, ...(scenario === 'manual' ? manualPayload : {}), ...(scenario === 'selected' ? { itemIds: selectedPipelineIds } : {}), aiMode: pipelineAiMode, model: 'gpt-5-mini', webSearch: pipelineWebSearch }),
  })
  const start = useMutation({
    mutationFn: () => pipelineKey === 'normalization' ? adminApi.startPipeline('normalization', normalizationPayload) : adminApi.startPipeline(pipelineKey, { scenario, maxItems, ...(scenario === 'manual' ? manualPayload : {}), ...(scenario === 'selected' ? { itemIds: selectedPipelineIds } : {}), aiMode: pipelineAiMode, model: 'gpt-5-mini', webSearch: pipelineWebSearch }),
    onSuccess: (data) => { notify('success', pipelineKey === 'music' ? 'Музыкальный пайплайн запущен' : pipelineKey === 'movie' ? 'Кино-пайплайн запущен' : pipelineKey === 'anime' ? 'Аниме-пайплайн запущен' : 'Нормализация запущена'); setStarting(false); setRepeatSourceRunId(null); navigate('pipelines', data.runId); void client.invalidateQueries({ queryKey: ['admin', 'pipeline-runs'] }) },
    onError: (error) => notify('error', errorText(error)),
  })
  const runItems = items.data?.items ?? []
  const [selectedPipelineItems, setSelectedPipelineItems] = useState<Set<string>>(new Set())
  const [pipelineBulkTagIds, setPipelineBulkTagIds] = useState<string[]>([])
  const [activePipelineItemId, setActivePipelineItemId] = useState<string | null>(null)
  const [approvalFailure, setApprovalFailure] = useState<PipelineApprovalFailure | null>(null)
  const [moderationOpen, setModerationOpen] = useState(false)
  const [moderationIndex, setModerationIndex] = useState(0)
  useEffect(() => {
    setSelectedPipelineItems(new Set())
    setPipelineBulkTagIds([])
    setActivePipelineItemId(null)
    setApprovalFailure(null)
    setModerationOpen(false)
    setModerationIndex(0)
  }, [selectedId])

  const isItemReviewable = (item: Record<string, any>) => ['review_required', 'approved', 'rejected'].includes(String(item.status)) && Boolean(item.proposedJson && typeof item.proposedJson === 'object' && !Array.isArray(item.proposedJson))
  const itemDiffFields = (item: Record<string, any>) => {
    const before = record(item.beforeJson)
    const proposed = record(item.proposedJson)
    return [...new Set([...Object.keys(before), ...Object.keys(proposed)])].filter((field) => JSON.stringify(before[field]) !== JSON.stringify(proposed[field]))
  }
  const itemFieldDecisions = (item: Record<string, any>, approved: boolean) => Object.fromEntries(itemDiffFields(item).map((field) => [field, { action: approved ? 'accept' : 'keep' }]))

  const decide = useMutation({
    mutationFn: ({ itemId, approved }: { itemId: string; approved: boolean }) => {
      const item = runItems.find((entry) => entry.id === itemId)
      if (!item) throw new Error('Результат пайплайна не найден')
      return adminApi.pipelineDecision(selectedId!, itemId, { approved, fieldDecisions: itemFieldDecisions(record(item), approved) })
    },
    onSuccess: () => {
      notify('success', 'Решение сохранено')
      void client.invalidateQueries({ queryKey: ['admin', 'pipeline-items', selectedId] })
    },
    onError: (error) => notify('error', errorText(error)),
  })
  const decideBulk = useMutation({
    mutationFn: ({ itemIds, approved }: { itemIds: string[]; approved: boolean }) => adminApi.pipelineBulkDecision(selectedId!, { itemIds, approved }),
    onSuccess: (result) => {
      notify(result.failed ? 'info' : 'success', `${result.approved ? 'Принято' : 'Отклонено'}: ${result.success}, ошибок: ${result.failed}`)
      setSelectedPipelineItems(new Set())
      void client.invalidateQueries({ queryKey: ['admin', 'pipeline-items', selectedId] })
    },
    onError: (error) => notify('error', errorText(error)),
  })
  const regenerateItem = useMutation({
    mutationFn: (itemId: string) => adminApi.regeneratePipelineItem(selectedId!, itemId),
    onSuccess: () => {
      notify('success', 'Айтем поставлен на повторную генерацию')
      void client.invalidateQueries({ queryKey: ['admin', 'pipeline-runs'] })
      void client.invalidateQueries({ queryKey: ['admin', 'pipeline-items', selectedId] })
      void client.invalidateQueries({ queryKey: ['admin', 'pipeline-events', selectedId] })
    },
    onError: (error) => notify('error', errorText(error)),
  })
  const retryFailedItems = useMutation({
    mutationFn: () => adminApi.retryFailedPipelineItems(selectedId!),
    onSuccess: (result) => {
      notify('success', `Ошибочные айтемы поставлены на перегенерацию: ${result.failedCount}`)
      void client.invalidateQueries({ queryKey: ['admin', 'pipeline-runs'] })
      void client.invalidateQueries({ queryKey: ['admin', 'pipeline-items', selectedId] })
      void client.invalidateQueries({ queryKey: ['admin', 'pipeline-events', selectedId] })
    },
    onError: (error) => notify('error', errorText(error)),
  })
  const approve = useMutation({
    mutationFn: ({ publish, itemIds }: { publish: boolean; itemIds?: string[] }) => adminApi.approvePipeline(selectedId!, itemIds?.length ? { itemIds } : {}, publish),
    onSuccess: (result, variables) => {
      const publishedTag = record(result).tag
      setApprovalFailure(null)
      notify('success', variables.publish ? `Изменения опубликованы${publishedTag?.name ? ` · тег «${publishedTag.name}» назначен` : ''}` : 'Изменения добавлены в рабочую версию')
      setSelectedPipelineItems(new Set())
      void client.invalidateQueries({ queryKey: ['admin'] })
    },
    onError: (error) => {
      setApprovalFailure(pipelineApprovalFailure(error))
      notify('error', pipelineApprovalErrorText(error))
    },
  })
  const updatePipelineItemTags = useMutation({
    mutationFn: ({ cardId, current, next }: { cardId: string; current: string[]; next: string[] }) => {
      const before = new Set(current)
      const added = next.find((id) => !before.has(id))
      const removed = current.find((id) => !next.includes(id))
      if (!added && !removed) return Promise.resolve({})
      return adminApi.bulkContent({ itemIds: [cardId], operation: added ? 'add_tag' : 'remove_tag', value: added ?? removed, reason: added ? 'Тег назначен в таблице пайплайна' : 'Тег снят в таблице пайплайна' })
    },
    onSuccess: () => { void client.invalidateQueries({ queryKey: ['admin', 'pipeline-items', selectedId] }); void client.invalidateQueries({ queryKey: ['admin', 'content-tags'] }); void client.invalidateQueries({ queryKey: ['admin', 'content'] }) },
    onError: (error) => notify('error', errorText(error)),
  })
  const createPipelineTag = async (name: string) => {
    const created = await adminApi.createTag(name)
    await client.invalidateQueries({ queryKey: ['admin', 'content-tags'] })
    return created
  }
  const updateSelectedPipelineItemTags = useMutation({
    mutationFn: async (operation: 'add_tag' | 'remove_tag') => {
      const cardIds = [...new Set(
        runItems
          .filter((entry) => selectedPipelineItems.has(String(entry.id)))
          .map((entry) => String(record(entry).cardId ?? ''))
          .filter(Boolean),
      )]
      if (!cardIds.length) throw new Error('У выбранных результатов ещё нет связанных карточек')
      let failed = 0
      for (const tagId of pipelineBulkTagIds) {
        const result = await adminApi.bulkContent({
          itemIds: cardIds,
          operation,
          value: tagId,
          reason: operation === 'add_tag' ? 'Массовое назначение тегов в результатах пайплайна' : 'Массовое снятие тегов в результатах пайплайна',
        })
        failed += Number(result.failed ?? 0)
      }
      return { operation, cardCount: cardIds.length, tagCount: pipelineBulkTagIds.length, failed }
    },
    onSuccess: (result) => {
      notify(result.failed ? 'info' : 'success', `${result.operation === 'add_tag' ? 'Теги назначены' : 'Теги сняты'}: карточек ${result.cardCount}, тегов ${result.tagCount}${result.failed ? `, ошибок ${result.failed}` : ''}`)
      setPipelineBulkTagIds([])
      void client.invalidateQueries({ queryKey: ['admin', 'pipeline-items', selectedId] })
      void client.invalidateQueries({ queryKey: ['admin', 'content-tags'] })
      void client.invalidateQueries({ queryKey: ['admin', 'content'] })
    },
    onError: (error) => notify('error', errorText(error)),
  })
  const isPipelineKey = (value: unknown): value is PipelineKey => value === 'music' || value === 'movie' || value === 'anime' || value === 'normalization'
  const safeText = (value: unknown) => typeof value === 'string' ? value.trim() : ''
  const continueRun = useMutation({
    mutationFn: () => adminApi.continuePipelineRun(selectedId!),
    onSuccess: () => {
      notify('success', 'Продолжение поставлено в очередь')
      void runs.refetch()
      void client.invalidateQueries({ queryKey: ['admin', 'pipeline-runs'] })
      void client.invalidateQueries({ queryKey: ['admin', 'pipeline-items'] })
      void client.invalidateQueries({ queryKey: ['admin', 'pipeline-events'] })
    },
    onError: (error) => notify('error', errorText(error)),
  })
  const cancel = useMutation({ mutationFn: () => adminApi.cancelPipeline(selectedId!), onSuccess: () => { notify('info', 'Остановка запрошена'); void runs.refetch() }, onError: (error) => notify('error', errorText(error)) })
  const removeRun = useMutation({
    mutationFn: (runId: string) => adminApi.deletePipelineRun(runId),
    onSuccess: (_result, runId) => {
      notify('success', 'Запуск удалён')
      if (selectedId === runId) navigate('pipelines')
      void client.invalidateQueries({ queryKey: ['admin', 'pipeline-runs'] })
      void client.removeQueries({ queryKey: ['admin', 'pipeline-items', runId] })
      void client.removeQueries({ queryKey: ['admin', 'pipeline-events', runId] })
    },
    onError: (error) => notify('error', errorText(error)),
  })
  const cleanupRuns = useMutation({
    mutationFn: (keepLatest: number) => adminApi.cleanupPipelineRuns(keepLatest),
    onSuccess: (result) => {
      notify('success', `Удалено старых запусков: ${String(record(result).deleted ?? 0)}`)
      if (selectedId && !runs.data?.items.some((entry) => entry.id === selectedId)) navigate('pipelines')
      void client.invalidateQueries({ queryKey: ['admin', 'pipeline-runs'] })
      void client.invalidateQueries({ queryKey: ['admin', 'pipeline-items'] })
      void client.invalidateQueries({ queryKey: ['admin', 'pipeline-events'] })
    },
    onError: (error) => notify('error', errorText(error)),
  })
  const previewSummary = record(preview.data?.summary); const readyItems = Number(previewSummary.ready ?? 0)
  const runnableManualItems = readyItems + (includeExisting ? Number(previewSummary.existing ?? 0) : 0)
  const pipelineLabel = (key: unknown) => key === 'music' ? 'Музыка' : key === 'movie' ? 'Кино' : key === 'anime' ? 'Аниме' : key === 'normalization' ? 'Нормализация' : 'Пайплайн'
  const pipelineDetailTitle = (key: unknown) => key === 'music' ? 'Музыкальный пайплайн' : key === 'movie' ? 'Кино-пайплайн Кинопоиска' : key === 'anime' ? 'Аниме-пайплайн Shikimori' : key === 'normalization' ? 'Универсальная нормализация' : 'Контентный пайплайн'
  const pipelineIcon = (key: unknown) => key === 'music' ? <WandSparkles /> : key === 'movie' ? <Clapperboard /> : key === 'anime' ? <Sparkles /> : <Bot />
  const pipelinePulseText = (status: string) => status === 'queued' ? 'В очереди' : status === 'running' ? 'В работе' : 'Остановлен'
  const manualText = pipelineKey === 'music' ? artistText : pipelineKey === 'movie' ? movieText : animeText
  const setManualText = pipelineKey === 'music' ? setArtistText : pipelineKey === 'movie' ? setMovieText : setAnimeText
  const manualFieldLabel = pipelineKey === 'music' ? 'Исполнители' : pipelineKey === 'movie' ? 'Фильмы Кинопоиска' : 'Аниме Shikimori'
  const manualPlaceholder = pipelineKey === 'music' ? 'Кино\nDepeche Mode\nPhoenix,Франция,indie rock band' : pipelineKey === 'movie' ? 'В поисках Немо (Finding Nemo, 2003)\nЧёрная Пантера (Black Panther, 2018)\nБэтмен (The Batman, 2022)' : '16498\nhttps://shikimori.one/animes/5114\n9253,добавить аниме из списка'
  const manualHelp = pipelineKey === 'music' ? 'Формат: имя или CSV «artist,country,hint». Страна и уточнение необязательны.' : pipelineKey === 'movie' ? 'Один фильм на строку: «Название (Original title, год)» или просто название. Предпросмотр проверяет только нашу базу; ID Кинопоиска найдутся после запуска.' : 'Формат: только ID или ссылка Shikimori. Названия без ID не распознаются. После запятой можно добавить внутреннее уточнение.'
  const insertNormalizationVariable = (token: string) => {
    const textarea = normalizationPromptRef.current
    const start = textarea?.selectionStart ?? normalizationPrompt.length
    const end = textarea?.selectionEnd ?? start
    const next = `${normalizationPrompt.slice(0, start)}${token}${normalizationPrompt.slice(end)}`
    setNormalizationPrompt(next)
    window.requestAnimationFrame(() => {
      normalizationPromptRef.current?.focus()
      normalizationPromptRef.current?.setSelectionRange(start + token.length, start + token.length)
    })
  }
  const closePipelineDialog = () => { setStarting(false); setRepeatSourceRunId(null); setNormalizationPrefilled(false) }
  const openPipeline = (key: unknown) => {
    if (!isPipelineKey(key)) return
    setPipelineKey(key)
    setScenario('manual')
    setMaxItems(key === 'normalization' ? 100 : 5)
    setPipelineAiMode('auto')
    setPipelineWebSearch(true)
    setIncludeExisting(false)
    setSelectedPipelineIdsText('')
    setArtistText('')
    setMovieText('')
    setAnimeText('')
    setRepeatSourceRunId(null)
    if (key === 'normalization') {
      setNormalizationScope('all')
      setNormalizationQuery('')
      setNormalizationSelected(new Set())
      setNormalizationIncludeTags([])
      setNormalizationExcludeTags([])
      setNormalizationTagMatch('all')
    }
    setNormalizationPrefilled(false)
    setStarting(true)
  }
  const openRepeatRun = (rawRun: Record<string, any>) => {
    const key = rawRun.pipelineKey
    if (!isPipelineKey(key)) { notify('info', 'Повтор для этого пайплайна недоступен'); return }
    const input = record(rawRun.inputDefinitionJson)
    const settings = record(rawRun.settingsJson)
    const rawScenario = String(input.scenario || 'discover')
    const nextScenario = ['discover', 'candidates', 'review', 'selected', 'manual'].includes(rawScenario) ? rawScenario : 'discover'
    const itemIds = array(input.itemIds).map(String).filter(Boolean)
    setPipelineKey(key)
    setRepeatSourceRunId(String(rawRun.id))
    setPipelineAiMode(settings.aiMode === 'never' ? 'never' : 'auto')
    setPipelineWebSearch(settings.webSearch !== false)
    setIncludeExisting(nextScenario === 'manual' ? true : input.includeExisting === true)
    setMaxItems(Math.max(1, Math.min(key === 'normalization' ? 500 : 20, Number(settings.maxItems ?? rawRun.itemsTotal ?? (key === 'normalization' ? 100 : 5)) || 5)))
    setSelectedPipelineIdsText(itemIds.slice(0, 20).join('\n'))
    setArtistText('')
    setMovieText('')
    setAnimeText('')
    if (key === 'normalization') {
      const mode = asContentMode(input.mode, 'music')
      setNormalizationMode(mode)
      setNormalizationField(safeText(input.field) || (mode === 'music' ? 'activityStartYear' : 'year'))
      setNormalizationPrompt(safeText(input.prompt))
      setNormalizationContextFields(array(input.contextFields).map(String))
      setNormalizationScope(input.scope === 'selected' ? 'selected' : 'all')
      setNormalizationQuery(safeText(input.query))
      setNormalizationSelected(new Set(itemIds.slice(0, 500)))
      setNormalizationIncludeTags(array(input.includeTagIds).map(String))
      setNormalizationExcludeTags(array(input.excludeTagIds).map(String))
      setNormalizationTagMatch(input.tagMatch === 'any' ? 'any' : 'all')
      setNormalizationPrefilled(true)
    } else {
      setScenario(nextScenario)
      setNormalizationPrefilled(false)
      if (key === 'music') setArtistText(array(input.artists).map((entry) => { const item = record(entry); return [safeText(item.artist), safeText(item.country), safeText(item.hint)].join('\t').replace(/\t+$/g, '') }).filter(Boolean).join('\n'))
      if (key === 'movie') setMovieText(array(input.movies).map((entry) => { const item = record(entry); if (Number.isInteger(Number(item.kinopoiskId)) && Number(item.kinopoiskId) > 0) return [String(item.kinopoiskId), safeText(item.hint)].filter(Boolean).join('\t'); const query = safeText(item.query); return query ? `${query}${Number.isInteger(Number(item.year)) ? ` (${String(item.year)})` : ''}` : '' }).filter(Boolean).join('\n'))
      if (key === 'anime') setAnimeText(array(input.anime).map((entry) => { const item = record(entry); return [String(item.shikimoriId ?? ''), safeText(item.hint)].filter(Boolean).join('\t') }).filter(Boolean).join('\n'))
    }
    setStarting(true)
  }
  const events = record(runEvents.data)
  const eventRows = array(events.events).map(record)
  const journalLines = array(events.journalLines).map((line) => String(line))
  const statsByStatus = record(record(events.itemStats).byStatus)
  const heartbeatAgeMs = Number(events.heartbeatAgeMs)
  const heartbeatAgeSec = Number.isFinite(heartbeatAgeMs) ? Math.round(heartbeatAgeMs / 1_000) : null
  const progressPercent = Number.isFinite(Number(events.progressPercent))
    ? Number(events.progressPercent)
    : Math.min(100, Math.round(Number(selectedRun?.itemsProcessed ?? 0) / Math.max(1, Number(selectedRun?.itemsTotal ?? 1)) * 100))
  const stale = Boolean(events.stale)
  const runStatus = String(selectedRun?.status ?? '')
  const failedItemCount = Number(statsByStatus.failed ?? 0)
  const canRetryFailedItems = failedItemCount > 0 && !['queued', 'running'].includes(runStatus)
  const totalItems = Number(selectedRun?.itemsTotal ?? 0)
  const processedItems = Number(selectedRun?.itemsProcessed ?? 0)
  const hasRemainingItems = totalItems > 0 && processedItems < totalItems
  const canContinueRun = hasRemainingItems && (
    (['queued', 'running'].includes(runStatus) && stale)
    || ['failed', 'partially_failed', 'cancelled'].includes(runStatus)
  )
  const lifecycleMessage = title(events.lifecycleMessage || (selectedRun ? pipelinePulseText(String(selectedRun.status)) : 'Ожидание'))
  const selectedItemsData = useMemo(() => runItems.filter((entry) => selectedPipelineItems.has(String(entry.id))), [runItems, selectedPipelineItems])
  const selectedPipelineCardCount = useMemo(() => new Set(selectedItemsData.map((entry) => String(record(entry).cardId ?? '')).filter(Boolean)).size, [selectedItemsData])
  const selectedReviewableIds = useMemo(() => selectedItemsData.filter((entry) => isItemReviewable(record(entry))).map((entry) => String(entry.id)), [selectedItemsData])
  const selectedApprovedIds = useMemo(() => selectedItemsData.filter((entry) => String(entry.status) === 'approved').map((entry) => String(entry.id)), [selectedItemsData])
  const approvedItemIds = useMemo(() => runItems.filter((entry) => String(entry.status) === 'approved' && isItemReviewable(record(entry))).map((entry) => String(entry.id)), [runItems])
  const activePipelineItem = useMemo(() => runItems.find((entry) => String(entry.id) === activePipelineItemId) ?? null, [runItems, activePipelineItemId])
  const reviewQueue = useMemo(() => runItems.filter((entry) => isItemReviewable(record(entry))), [runItems])
  const moderationRawItem = reviewQueue[moderationIndex] ?? null
  const moderationItem = moderationRawItem ? record(moderationRawItem) : null
  const fallbackModerationMode: ContentMode = selectedRun?.pipelineKey === 'normalization'
    ? asContentMode(record(selectedRun.inputDefinitionJson).mode, 'music')
    : selectedRun?.pipelineKey === 'movie' ? 'movie' : selectedRun?.pipelineKey === 'anime' ? 'anime' : 'music'
  const moderationProposed = record(moderationItem?.proposedJson)
  const moderationBefore = record(moderationItem?.beforeJson)
  const moderationCard = record(moderationItem?.card)
  const moderationMode = asContentMode(moderationProposed.mode || moderationBefore.mode || moderationCard.mode, fallbackModerationMode)
  const moderationTitle = title(moderationProposed.titleRu || moderationBefore.titleRu || moderationCard.titleRu || moderationProposed.name || moderationItem?.entityKey)
  const moderationSubtitle = title(moderationProposed.titleOriginal || moderationBefore.titleOriginal || moderationCard.titleOriginal || moderationItem?.entityKey)
  const moderationWarnings = moderationItem ? pipelineWarnings(moderationItem.warningsJson) : []
  const moderationFieldText = (value: unknown): string => {
    if (value == null) return ''
    if (typeof value === 'string') return value.trim()
    if (typeof value === 'number') return Number.isFinite(value) ? String(value) : ''
    if (typeof value === 'boolean') return value ? 'Да' : 'Нет'
    if (Array.isArray(value)) {
      const values = value.map((entry) => moderationFieldText(entry)).filter(Boolean)
      if (!values.length) return ''
      const visible = values.slice(0, 5)
      return `${visible.join(', ')}${values.length > visible.length ? ' …' : ''}`
    }
    const source = record(value)
    return [source.titleRu, source.titleOriginal, source.title, source.name, source.value, source.id]
      .map((entry) => moderationFieldText(entry))
      .find(Boolean) || ''
  }
  const moderationField = (label: string, ...candidates: unknown[]) => {
    for (const candidate of candidates) {
      const value = moderationFieldText(candidate)
      if (value) return { label, value }
    }
    return null
  }
  const moderationGenres = array(moderationProposed.genres).map((entry) => moderationFieldText(entry)).filter(Boolean).slice(0, 6)
  const moderationYear = moderationFieldText(moderationProposed.year) || moderationFieldText(moderationProposed.releaseYear) || moderationFieldText(moderationProposed.startYear)
  const moderationCountry = moderationFieldText(array(moderationProposed.countries)[0]) || moderationFieldText(moderationProposed.country) || moderationFieldText(moderationProposed.originCountry)
  const moderationTopTrack = record(array(moderationProposed.topTracks)[0])
  const moderationTopAlbum = record(array(moderationProposed.topAlbums)[0])
  const moderationSimilarArtists = array(moderationProposed.similarArtists)
    .map((entry) => moderationFieldText(record(entry).name || entry))
    .filter(Boolean)
  const moderationAttemptFields = (() => {
    const shared = [
      moderationField('Страна', moderationCountry, moderationProposed.countries),
      moderationField('Год', moderationYear),
      moderationField('Жанры', moderationProposed.genres),
    ]
    const movieFields = [
      moderationField('Кинопоиск', moderationProposed.kp, moderationProposed.kpRating, moderationProposed.kinopoiskRating),
      moderationField('IMDb', moderationProposed.imdb, moderationProposed.imdbRating),
      moderationField('Возраст', moderationProposed.ageRating, moderationProposed.age),
      moderationField('Хронометраж', moderationProposed.runtime, moderationProposed.durationMinutes),
    ]
    const animeFields = [
      moderationField('Эпизоды', moderationProposed.episodes, moderationProposed.episodesAired),
      moderationField('Студия', moderationProposed.studio, moderationProposed.studios),
      moderationField('Статус', moderationProposed.animeStatus, moderationProposed.seriesStatus, moderationProposed.status),
      moderationField('Источник', moderationProposed.animeSource, moderationProposed.source),
    ]
    const musicFields = [
      moderationField('Тип', moderationProposed.musicType, moderationProposed.type),
      moderationField('Статус', moderationProposed.musicIsActive, moderationProposed.activityStatus),
      moderationField('Топ-трек', moderationTopTrack.title, moderationTopTrack.name, moderationProposed.topTrack),
      moderationField('Топ-альбом', moderationTopAlbum.title, moderationTopAlbum.name, moderationProposed.topAlbum),
      moderationField('Похожие', moderationSimilarArtists),
      moderationField('Слушатели', moderationProposed.listeners, record(moderationProposed.votes).gamesPlayed),
    ]
    const gameFields = [
      moderationField('Платформы', moderationProposed.platforms),
      moderationField('Разработчик', moderationProposed.developers, moderationProposed.developer),
      moderationField('Издатель', moderationProposed.publishers, moderationProposed.publisher),
      moderationField('Рейтинг', moderationProposed.metacritic, moderationProposed.rating),
    ]
    const modeSpecific = moderationMode === 'music'
      ? musicFields
      : moderationMode === 'anime'
        ? [...movieFields, ...animeFields]
        : moderationMode === 'game'
          ? gameFields
          : movieFields
    return [...shared, ...modeSpecific]
      .filter((entry): entry is { label: string; value: string } => Boolean(entry?.value))
      .slice(0, 9)
  })()
  const moderationChangedFields = moderationItem ? itemDiffFields(moderationItem) : []
  const moderationHint = (() => {
    const firstFact = array(moderationProposed.facts).map((entry) => typeof entry === 'string' ? entry.trim() : '').find(Boolean)
    return [moderationProposed.plotHint, moderationProposed.description, firstFact].map((entry) => typeof entry === 'string' ? entry.trim() : '').find(Boolean) || 'Подсказка не заполнена'
  })()
  const moderationPoster = [moderationProposed.posterUrl, moderationProposed.headerUrl, moderationProposed.backdropUrl, ...array(moderationProposed.screenshots)].map((entry) => typeof entry === 'string' ? entry.trim() : '').find(Boolean) || ''
  useEffect(() => {
    setModerationIndex((current) => Math.min(current, Math.max(0, reviewQueue.length - 1)))
    if (!reviewQueue.length) setModerationOpen(false)
  }, [reviewQueue.length])

  const copyJson = async (payload: unknown, label: string) => {
    try {
      await navigator.clipboard.writeText(JSON.stringify(payload, null, 2))
      notify('success', `${label} скопирован`)
    } catch {
      notify('error', 'Не удалось скопировать в буфер обмена')
    }
  }

  const requestCleanup = () => {
    const raw = prompt('Сколько последних завершённых запусков оставить?', '30')
    if (raw == null) return
    const keepLatest = Number(raw)
    if (!Number.isInteger(keepLatest) || keepLatest < 0) {
      notify('error', 'Введите целое число 0 или больше')
      return
    }
    cleanupRuns.mutate(keepLatest)
  }

  const requestRestartRun = () => {
    if (!selectedRun) return
    openRepeatRun(record(selectedRun))
  }

  const requestContinueRun = () => {
    if (!selectedRun) return
    const processed = Number(selectedRun.itemsProcessed ?? 0)
    const total = Number(selectedRun.itemsTotal ?? 0)
    if (total <= 0) {
      notify('info', 'Для этого запуска не определено количество элементов для продолжения')
      return
    }
    const isActive = ['queued', 'running'].includes(String(selectedRun.status))
    if (isActive && !stale) {
      notify('info', 'Процесс уже активен. Продолжение доступно только для stale запуска')
      return
    }
    if (processed >= total) {
      notify('info', 'Все элементы уже обработаны. Продолжение не требуется')
      return
    }
    if (!confirm(`Продолжить процесс с текущего прогресса ${processed}/${total}?`)) return
    continueRun.mutate()
  }

  const requestRegenerateItem = (itemId: string, entityKey: unknown) => {
    if (selectedRun?.pipelineKey !== 'normalization') {
      notify('info', 'Повторная генерация отдельного айтема доступна для универсальной нормализации')
      return
    }
    if (!confirm(`Перегенерировать только ${title(entityKey)}? Будет выполнен один новый платный запрос GPT-5 mini; остальные айтемы не изменятся.`)) return
    regenerateItem.mutate(itemId)
  }

  const requestRetryFailedItems = () => {
    if (!canRetryFailedItems) return
    if (!confirm(`Перегенерировать ${failedItemCount} ошибочных айтемов? Успешные результаты не изменятся. Будут списаны кредиты только за повторные запросы.`)) return
    retryFailedItems.mutate()
  }

  const requestDeleteRun = (rawRun: Record<string, any> | undefined = selectedRun ? record(selectedRun) : undefined) => {
    if (!rawRun) return
    const active = ['queued', 'running'].includes(String(rawRun.status))
    const message = active
      ? 'Удалить процесс и все его результаты? Для активного запуска удаление возможно только при stale heartbeat.'
      : 'Удалить этот запуск и все его результаты? Действие необратимо.'
    if (!confirm(message)) return
    removeRun.mutate(String(rawRun.id))
  }

  const openModeration = () => {
    if (!reviewQueue.length) return
    const targetIndex = activePipelineItemId ? reviewQueue.findIndex((entry) => String(entry.id) === activePipelineItemId) : 0
    setModerationIndex(targetIndex >= 0 ? targetIndex : 0)
    setModerationOpen(true)
  }

  const moveModeration = (direction: -1 | 1) => {
    setModerationIndex((current) => {
      const next = current + direction
      if (next < 0) return 0
      return Math.min(next, Math.max(0, reviewQueue.length - 1))
    })
  }

  const submitModerationDecision = (approved: boolean) => {
    if (!moderationItem) return
    const currentItemId = String(moderationItem.id)
    const nextIndex = Math.min(moderationIndex + 1, Math.max(0, reviewQueue.length - 1))
    decide.mutate({ itemId: currentItemId, approved }, {
      onSuccess: () => {
        setModerationIndex(nextIndex)
      },
    })
  }

  useEffect(() => {
    if (!moderationOpen || !moderationItem) return
    const handleModerationHotkeys = (event: KeyboardEvent) => {
      if (event.ctrlKey || event.metaKey || event.altKey) return
      const target = event.target
      if (target instanceof HTMLElement) {
        const tag = target.tagName
        if (target.isContentEditable || tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT') return
      }
      if (decide.isPending) return
      if (event.key === 'ArrowLeft') {
        event.preventDefault()
        moveModeration(-1)
        return
      }
      if (event.key === 'ArrowRight') {
        event.preventDefault()
        moveModeration(1)
        return
      }
      if (event.repeat) return
      if (event.code === 'KeyC') {
        event.preventDefault()
        submitModerationDecision(true)
        return
      }
      if (event.code === 'KeyX') {
        event.preventDefault()
        submitModerationDecision(false)
      }
    }
    addEventListener('keydown', handleModerationHotkeys)
    return () => removeEventListener('keydown', handleModerationHotkeys)
  }, [decide.isPending, moderationItem, moderationOpen, moveModeration, submitModerationDecision])

  return (
    <>
      <PageHead
        eyebrow="Автоматизация"
        title="ИИ-пайплайны"
        description="Управляемые очереди контента, подробная проверка и применение предложений через общую рабочую версию."
        actions={
          <>
            <button
              className="admin-btn admin-btn--secondary"
              onClick={() => openPipeline("anime")}
            >
              <Sparkles />
              Запустить аниме
            </button>
            <button
              className="admin-btn admin-btn--secondary"
              onClick={() => openPipeline("movie")}
            >
              <Clapperboard />
              Запустить кино
            </button>
            <button
              className="admin-btn admin-btn--secondary"
              onClick={() => openPipeline("music")}
            >
              <WandSparkles />
              Запустить музыку
            </button>
            <button
              className="admin-btn admin-btn--primary"
              onClick={() => openPipeline("normalization")}
            >
              <Bot />
              Нормализовать поле
            </button>
          </>
        }
      />
      <div className="admin-pipeline-catalog">
        {pipelines.data?.items.map((raw) => {
          const pipeline = record(raw);
          return (
            <article
              key={String(pipeline.key)}
              className={
                pipeline.state === "not_connected" ? "is-disabled" : ""
              }
            >
              <div className="admin-pipeline-icon">
                {pipeline.key === "music" ? (
                  <WandSparkles />
                ) : pipeline.key === "movie" ? (
                  <Clapperboard />
                ) : pipeline.key === "anime" ? (
                  <Sparkles />
                ) : (
                  <Bot />
                )}
              </div>
              <div>
                <Status
                  value={pipeline.state === "connected" ? "active" : "neutral"}
                >
                  {pipeline.state === "connected"
                    ? "Подключён"
                    : "Ещё не подключён"}
                </Status>
                <h3>{title(pipeline.title)}</h3>
                <p>{title(pipeline.description)}</p>
                <small>
                  {pipeline.awaitingReview
                    ? `Ждут проверки: ${pipeline.awaitingReview}`
                    : "Нет результатов на проверке"}
                </small>
              </div>
              {pipeline.state === "connected" && (
                <button onClick={() => openPipeline(pipeline.key)}>
                  Запустить <Play />
                </button>
              )}
            </article>
          );
        })}
      </div>
      <div className="admin-split admin-split--pipeline">
        <section className="admin-list-panel">
          <header className="admin-subhead">
            <h2>Запуски</h2>
            <div className="admin-subhead__actions">
              <button
                onClick={requestCleanup}
                title="Удалить старые завершённые запуски"
              >
                <Trash2 />
              </button>
              <button
                onClick={() => void runs.refetch()}
                title="Обновить список"
              >
                <RefreshCw />
              </button>
            </div>
          </header>
          {runs.data?.items.map((raw) => {
            const run = record(raw);
            const live = ["queued", "running"].includes(String(run.status));
            const heartbeat = run.heartbeatAt
              ? Math.round(
                  (Date.now() - new Date(String(run.heartbeatAt)).getTime()) /
                    1_000,
                )
              : null;
            const staleRun = live && heartbeat != null && heartbeat > 180;
            const summary = run.safeErrorMessage
              ? title(run.safeErrorMessage)
              : live
                ? staleRun
                  ? `Нет heartbeat ${heartbeat}s`
                  : `${pipelinePulseText(String(run.status))}${heartbeat != null ? ` · heartbeat ${heartbeat}s назад` : ""}`
                : `Успешно ${run.itemsSucceeded ?? 0}, ошибок ${run.itemsFailed ?? 0} · $${Number(run.actualCost ?? 0).toFixed(4)}`;
            return (
              <article
                key={String(run.id)}
                className={`admin-pipeline-run-item ${selectedId === run.id ? "is-active" : ""}`}
              >
                <button
                  className="admin-pipeline-run-item__main"
                  onClick={() => navigate("pipelines", String(run.id))}
                >
                  <span className="admin-list-icon">
                    {pipelineIcon(run.pipelineKey)}
                  </span>
                  <span>
                    <header>
                      <strong>
                        {pipelineLabel(run.pipelineKey)} ·{" "}
                        {Number(run.itemsProcessed ?? 0)}/
                        {Number(run.itemsTotal ?? 0)}
                      </strong>
                      <time>{compactDate(run.createdAt)}</time>
                    </header>
                    <p>{title(record(run.inputDefinitionJson).scenario)}</p>
                    <small className={live ? "is-live" : ""}>{summary}</small>
                  </span>
                  <Status value={run.status} />
                </button>
                {!live && (
                  <div className="admin-pipeline-run-item__actions">
                    <button
                      type="button"
                      title="Запустить ещё раз с этими настройками"
                      aria-label={`Запустить ещё раз ${pipelineLabel(run.pipelineKey)} ${String(run.id).slice(0, 8)}`}
                      disabled={start.isPending}
                      onClick={() => openRepeatRun(run)}
                    >
                      <RefreshCw />
                    </button>
                    <button
                      type="button"
                      title="Удалить этот запуск"
                      aria-label={`Удалить запуск ${pipelineLabel(run.pipelineKey)} ${String(run.id).slice(0, 8)}`}
                      disabled={removeRun.isPending && removeRun.variables === String(run.id)}
                      onClick={() => requestDeleteRun(run)}
                    >
                      <Trash2 />
                    </button>
                  </div>
                )}
              </article>
            );
          })}
        </section>
        <section className="admin-detail-panel">
          {!selectedRun ? (
            <Empty
              title="Выберите запуск"
              text="Здесь появятся прогресс, фактическая стоимость, diff и решения по полям."
              icon={<WandSparkles />}
            />
          ) : (
            <>
              <header className="admin-detail-head">
                <div>
                  <span>Запуск {String(selectedRun.id).slice(0, 8)}</span>
                  <h2>{pipelineDetailTitle(selectedRun.pipelineKey)}</h2>
                  <p>
                    {formatDate(selectedRun.createdAt)} ·{" "}
                    {title(record(selectedRun.settingsJson).model)}
                  </p>
                </div>
                <div className="admin-detail-head__actions">
                  <button
                    onClick={() =>
                      void navigator.clipboard.writeText(String(selectedRun.id))
                    }
                  >
                    <Copy />
                    ID
                  </button>
                  {canContinueRun && (
                    <button
                      onClick={requestContinueRun}
                      disabled={
                        continueRun.isPending ||
                        start.isPending ||
                        cancel.isPending ||
                        removeRun.isPending
                      }
                    >
                      <Play />
                      Продолжить
                    </button>
                  )}
                  <button
                    onClick={requestRestartRun}
                    disabled={start.isPending || continueRun.isPending}
                  >
                    <RefreshCw />
                    Перезапустить процесс
                  </button>
                  {canRetryFailedItems && (
                    <button
                      onClick={requestRetryFailedItems}
                      disabled={retryFailedItems.isPending || continueRun.isPending || removeRun.isPending}
                      title="Повторить только ошибочные айтемы"
                    >
                      <RefreshCw />
                      Перегенерировать ошибки · {failedItemCount}
                    </button>
                  )}
                  {["queued", "running"].includes(
                    String(selectedRun.status),
                  ) && (
                    <button
                      onClick={() => cancel.mutate()}
                      disabled={cancel.isPending || continueRun.isPending}
                    >
                      <X />
                      Остановить
                    </button>
                  )}
                  <button
                    onClick={() => requestDeleteRun()}
                    disabled={
                      removeRun.isPending ||
                      cancel.isPending ||
                      continueRun.isPending
                    }
                  >
                    <Trash2 />
                    Удалить процесс
                  </button>
                  <Status value={selectedRun.status} />
                </div>
              </header>
              <div className="admin-run-progress">
                <div>
                  <span>Обработано</span>
                  <strong>
                    {String(selectedRun.itemsProcessed ?? 0)} /{" "}
                    {String(selectedRun.itemsTotal ?? 0)}
                  </strong>
                </div>
                <i>
                  <b style={{ width: `${progressPercent}%` }} />
                </i>
                <div>
                  <span>Успешно {String(selectedRun.itemsSucceeded ?? 0)}</span>
                  <span>Ошибок {String(selectedRun.itemsFailed ?? 0)}</span>
                  <span>
                    Оценка ${Number(selectedRun.estimatedCost ?? 0).toFixed(2)}
                  </span>
                  <strong>
                    Фактически ${Number(selectedRun.actualCost ?? 0).toFixed(6)}
                  </strong>
                </div>
                {Object.keys(record(selectedRun.usageJson)).length > 0 && (
                  <small>
                    Токены: вход{" "}
                    {Number(
                      record(selectedRun.usageJson).inputTokens ?? 0,
                    ).toLocaleString("ru-RU")}{" "}
                    · кэш{" "}
                    {Number(
                      record(selectedRun.usageJson).cachedInputTokens ?? 0,
                    ).toLocaleString("ru-RU")}{" "}
                    · выход{" "}
                    {Number(
                      record(selectedRun.usageJson).outputTokens ?? 0,
                    ).toLocaleString("ru-RU")}{" "}
                    · web search{" "}
                    {String(record(selectedRun.usageJson).webSearchCalls ?? 0)}
                  </small>
                )}
              </div>
              <div className="admin-run-live">
                <header>
                  <div>
                    <strong>Ход выполнения</strong>
                    <small>{lifecycleMessage}</small>
                  </div>
                  <span
                    className={`admin-run-pulse ${["queued", "running"].includes(String(selectedRun.status)) ? "is-live" : ""} ${stale ? "is-stale" : ""}`}
                  >
                    {stale
                      ? "нет heartbeat"
                      : heartbeatAgeSec == null
                        ? "ожидание"
                        : `${heartbeatAgeSec}s`}
                  </span>
                </header>
                <div className="admin-run-live__stats">
                  <span>
                    В очереди/в работе:{" "}
                    {String(
                      Number(statsByStatus.pending ?? 0) +
                        Number(statsByStatus.running ?? 0),
                    )}
                  </span>
                  <span>
                    На проверке: {String(statsByStatus.review_required ?? 0)}
                  </span>
                  <span>Провалено: {String(statsByStatus.failed ?? 0)}</span>
                  <span>Одобрено: {String(statsByStatus.approved ?? 0)}</span>
                </div>
                {eventRows.length ? (
                  <div className="admin-run-events">
                    {eventRows.slice(0, 24).map((entry) => (
                      <div key={String(entry.id)}>
                        <time>{compactDate(entry.at)}</time>
                        <p>{title(entry.message)}</p>
                        <small>
                          {entry.status
                            ? (STATUS_LABEL[String(entry.status)] ??
                              String(entry.status))
                            : title(entry.type)}
                        </small>
                      </div>
                    ))}
                  </div>
                ) : (
                  <p className="admin-run-events__empty">
                    События пока не поступили
                  </p>
                )}
                <details
                  className="admin-run-journal"
                  open={Boolean(
                    ["queued", "running"].includes(
                      String(selectedRun.status),
                    ) && journalLines.length,
                  )}
                >
                  <summary>Журнал процесса ({journalLines.length})</summary>
                  {journalLines.length ? (
                    <pre>{journalLines.join("\n")}</pre>
                  ) : (
                    <p>Лог пока пуст.</p>
                  )}
                </details>
              </div>
              <div className="admin-run-settings">
                <header>
                  <h3>Настройки запуска</h3>
                  <div>
                    <button
                      className="admin-link"
                      onClick={() =>
                        void copyJson(
                          record(selectedRun.inputDefinitionJson),
                          "Input JSON",
                        )
                      }
                    >
                      <Copy />
                      Скопировать input
                    </button>
                    <button
                      className="admin-link"
                      onClick={() =>
                        void copyJson(
                          record(selectedRun.settingsJson),
                          "Settings JSON",
                        )
                      }
                    >
                      <Copy />
                      Скопировать settings
                    </button>
                  </div>
                </header>
                <div>
                  <article>
                    <span>Input definition</span>
                    <pre>
                      {JSON.stringify(
                        record(selectedRun.inputDefinitionJson),
                        null,
                        2,
                      )}
                    </pre>
                  </article>
                  <article>
                    <span>Settings</span>
                    <pre>
                      {JSON.stringify(
                        record(selectedRun.settingsJson),
                        null,
                        2,
                      )}
                    </pre>
                  </article>
                </div>
              </div>
              <div className="admin-pipeline-review">
                {items.isLoading ? (
                  <Loading />
                ) : runItems.length ? (
                  <>
                    <header className="admin-pipeline-review__head">
                      <div>
                        <h3>Результаты на проверке</h3>
                        <small>
                          Таблица для массового согласования. Клик по строке
                          открывает подробный diff справа.
                        </small>
                      </div>
                      <div>
                        <button
                          className="admin-btn admin-btn--secondary"
                          disabled={!reviewQueue.length}
                          onClick={openModeration}
                        >
                          <Play />
                          Начать модерацию
                        </button>
                        <button
                          className="admin-btn admin-btn--secondary"
                          disabled={
                            !selectedReviewableIds.length ||
                            decideBulk.isPending
                          }
                          onClick={() =>
                            decideBulk.mutate({
                              itemIds: selectedReviewableIds,
                              approved: false,
                            })
                          }
                        >
                          <X />
                          Отклонить выбранные
                        </button>
                        <button
                          className="admin-btn admin-btn--primary"
                          disabled={
                            !selectedReviewableIds.length ||
                            decideBulk.isPending
                          }
                          onClick={() =>
                            decideBulk.mutate({
                              itemIds: selectedReviewableIds,
                              approved: true,
                            })
                          }
                        >
                          <Check />
                          Принять выбранные
                        </button>
                      </div>
                    </header>
                    {selectedPipelineItems.size > 0 && (
                      <div className="admin-pipeline-review__bulk-tags">
                        <strong>Выбрано: {selectedPipelineItems.size}</strong>
                        <TagPicker
                          compact
                          label="Массовые теги"
                          tags={contentTags.data?.items ?? []}
                          value={pipelineBulkTagIds}
                          onChange={setPipelineBulkTagIds}
                          onCreate={createPipelineTag}
                          disabled={updateSelectedPipelineItemTags.isPending}
                        />
                        <button
                          className="admin-btn admin-btn--secondary"
                          disabled={!pipelineBulkTagIds.length || !selectedPipelineCardCount || updateSelectedPipelineItemTags.isPending}
                          onClick={() => updateSelectedPipelineItemTags.mutate('add_tag')}
                        >
                          <Tags />
                          Назначить теги · {pipelineBulkTagIds.length}
                        </button>
                        <button
                          className="admin-btn admin-btn--secondary"
                          disabled={!pipelineBulkTagIds.length || !selectedPipelineCardCount || updateSelectedPipelineItemTags.isPending}
                          onClick={() => updateSelectedPipelineItemTags.mutate('remove_tag')}
                        >
                          <X />
                          Снять теги · {pipelineBulkTagIds.length}
                        </button>
                      </div>
                    )}
                    <div className="admin-table-wrap admin-table-wrap--pipeline">
                      <table className="admin-table">
                        <thead>
                          <tr>
                            <th className="admin-check">
                              <input
                                type="checkbox"
                                aria-label="Выбрать все результаты"
                                checked={
                                  selectedPipelineItems.size > 0 &&
                                  selectedPipelineItems.size ===
                                    runItems.filter((entry) =>
                                      isItemReviewable(record(entry)),
                                    ).length
                                }
                                onChange={(event) =>
                                  setSelectedPipelineItems(
                                    event.target.checked
                                      ? new Set(
                                          runItems
                                            .filter((entry) =>
                                              isItemReviewable(record(entry)),
                                            )
                                            .map((entry) => String(entry.id)),
                                        )
                                      : new Set(),
                                  )
                                }
                              />
                            </th>
                            <th>Карточка</th>
                            <th>Статус</th>
                            <th>Изменено</th>
                            <th>Теги</th>
                            <th>Предупреждения</th>
                            <th>Обновлено</th>
                            <th />
                          </tr>
                        </thead>
                        <tbody>
                          {runItems.map((raw) => {
                            const item = record(raw);
                            const proposed = record(item.proposedJson);
                            const before = record(item.beforeJson);
                            const card = record(item.card);
                            const itemTitle = title(proposed.titleRu || before.titleRu || card.titleRu || proposed.name || item.entityKey);
                            const fields = itemDiffFields(item);
                            const warnings = pipelineWarnings(
                              item.warningsJson,
                            );
                            const itemId = String(item.id);
                            const reviewable = isItemReviewable(item);
                            const regenerating =
                              regenerateItem.isPending &&
                              regenerateItem.variables === itemId;
                            const canRegenerate =
                              selectedRun.pipelineKey === "normalization" &&
                              !item.workspaceChangeId &&
                              !item.appliedRevisionId &&
                              ![
                                "staged",
                                "published",
                                "running",
                                "pending",
                              ].includes(String(item.status));
                            return (
                              <tr
                                key={itemId}
                                className={
                                  activePipelineItemId === itemId
                                    ? "is-open"
                                    : ""
                                }
                              >
                                <td className="admin-check">
                                  <input
                                    type="checkbox"
                                    aria-label={`Выбрать ${itemTitle}`}
                                    disabled={!reviewable}
                                    checked={selectedPipelineItems.has(itemId)}
                                    onChange={(event) =>
                                      setSelectedPipelineItems((current) => {
                                        const next = new Set(current);
                                        event.target.checked
                                          ? next.add(itemId)
                                          : next.delete(itemId);
                                        return next;
                                      })
                                    }
                                  />
                                </td>
                                <td>
                                  <button
                                    className="admin-title-cell"
                                    onClick={() =>
                                      setActivePipelineItemId(itemId)
                                    }
                                  >
                                    <span>
                                      {pipelineIcon(selectedRun.pipelineKey)}
                                    </span>
                                    <span>
                                      <strong>
                                        {title(
                                          proposed.titleRu ||
                                            before.titleRu ||
                                            card.titleRu ||
                                            proposed.name ||
                                            item.entityKey,
                                        )}
                                      </strong>
                                      <small>{title(item.entityKey)}</small>
                                    </span>
                                  </button>
                                </td>
                                <td>
                                  <Status value={item.status} />
                                </td>
                                <td>{fields.length}</td>
                                <td className="admin-tags-cell admin-tags-cell--pipeline">
                                  <TagPicker
                                    compact
                                    label="Теги"
                                    tags={contentTags.data?.items ?? []}
                                    value={array(item.tags).map((tag) => String(record(tag).id))}
                                    disabled={!item.cardId || updatePipelineItemTags.isPending}
                                    onCreate={createPipelineTag}
                                    onChange={(next) => updatePipelineItemTags.mutate({ cardId: String(item.cardId), current: array(item.tags).map((tag) => String(record(tag).id)), next })}
                                  />
                                </td>
                                <td>
                                  {warnings.length ? (
                                    <span className="admin-count admin-count--warn">
                                      {warnings.length}
                                    </span>
                                  ) : (
                                    <Check className="admin-table-ok" />
                                  )}
                                </td>
                                <td>
                                  {compactDate(
                                    item.updatedAt || item.createdAt,
                                  )}
                                </td>
                                <td>
                                  <div className="admin-row-actions">
                                    {canRegenerate && (
                                      <button
                                        className="admin-icon-btn"
                                        title="Перегенерировать только этот айтем"
                                        aria-label={`Перегенерировать ${title(item.entityKey)}`}
                                        disabled={
                                          regenerateItem.isPending ||
                                          decide.isPending
                                        }
                                        onClick={() =>
                                          requestRegenerateItem(
                                            itemId,
                                            item.entityKey,
                                          )
                                        }
                                      >
                                        {regenerating ? (
                                          <LoaderCircle className="admin-spinner" />
                                        ) : (
                                          <RefreshCw />
                                        )}
                                      </button>
                                    )}
                                    {reviewable && (
                                      <>
                                        <button
                                          className="admin-icon-btn"
                                          title="Отклонить"
                                          onClick={() =>
                                            decide.mutate({
                                              itemId,
                                              approved: false,
                                            })
                                          }
                                          disabled={regenerateItem.isPending}
                                        >
                                          <X />
                                        </button>
                                        <button
                                          className="admin-icon-btn"
                                          title="Принять"
                                          onClick={() =>
                                            decide.mutate({
                                              itemId,
                                              approved: true,
                                            })
                                          }
                                          disabled={regenerateItem.isPending}
                                        >
                                          <Check />
                                        </button>
                                      </>
                                    )}
                                  </div>
                                </td>
                              </tr>
                            );
                          })}
                        </tbody>
                      </table>
                    </div>
                  </>
                ) : (
                  <Empty
                    title="Результатов пока нет"
                    text={
                      ["queued", "running"].includes(String(selectedRun.status))
                        ? "Worker обрабатывает список партиями. Страница обновится автоматически."
                        : "Запуск не создал проверяемых результатов."
                    }
                  />
                )}
              </div>
              {approvalFailure && (
                <div className="admin-error admin-pipeline-approval-error" role="alert">
                  <AlertTriangle />
                  <div>
                    <strong>Нельзя применить {approvalFailure.invalidCount} {approvalFailure.invalidCount === 1 ? "результат" : "результата"}</strong>
                    {approvalFailure.items.slice(0, 5).map((item) => (
                      <p key={item.itemId}>
                        <b>{item.entityKey || item.itemId}</b> — {item.fieldErrors.length
                          ? item.fieldErrors.map((field) => `${field.field}: ${field.message}`).join("; ")
                          : item.message}
                      </p>
                    ))}
                    {approvalFailure.invalidCount > approvalFailure.items.length && <p>Показаны первые {approvalFailure.items.length} проблемных результатов.</p>}
                  </div>
                  {approvedItemIds.some((itemId) => !approvalFailure.items.some((item) => item.itemId === itemId)) && (
                    <button
                      className="admin-btn admin-btn--secondary"
                      onClick={() => setSelectedPipelineItems(new Set(approvedItemIds.filter((itemId) => !approvalFailure.items.some((item) => item.itemId === itemId))))}
                    >
                      Выбрать остальные
                    </button>
                  )}
                  <button className="admin-icon-btn" aria-label="Закрыть сообщение" onClick={() => setApprovalFailure(null)}><X /></button>
                </div>
              )}
              {approvedItemIds.length > 0 && (
                <div className="admin-sticky-actions">
                  <span>
                    Одобрено: {approvedItemIds.length}. «В рабочую версию»
                    только стаджит изменения, «Одобрить и опубликовать» сразу
                    активирует новую ревизию.
                  </span>
                  <button
                    className="admin-btn admin-btn--secondary"
                    disabled={approve.isPending}
                    onClick={() =>
                      approve.mutate({
                        publish: false,
                        itemIds: selectedApprovedIds.length
                          ? selectedApprovedIds
                          : undefined,
                      })
                    }
                  >
                    В рабочую версию
                    {selectedApprovedIds.length
                      ? ` · ${selectedApprovedIds.length}`
                      : ""}
                  </button>
                  <button
                    className="admin-btn admin-btn--primary"
                    disabled={approve.isPending}
                    onClick={() =>
                      approve.mutate({
                        publish: true,
                        itemIds: selectedApprovedIds.length
                          ? selectedApprovedIds
                          : undefined,
                      })
                    }
                  >
                    Одобрить и опубликовать
                    {selectedApprovedIds.length
                      ? ` · ${selectedApprovedIds.length}`
                      : ""}
                  </button>
                </div>
              )}
            </>
          )}
        </section>
      </div>
      {moderationOpen && selectedRun && moderationItem && (
        <div
          className="admin-modal-backdrop admin-modal-backdrop--moderation"
          onMouseDown={(event) =>
            event.target === event.currentTarget && setModerationOpen(false)
          }
        >
          <div className="admin-modal admin-modal--moderation">
            <header>
              <div>
                <span>
                  {pipelineLabel(selectedRun.pipelineKey)} · Ручная модерация
                </span>
                <h2>Карточка как в игре</h2>
              </div>
              <button onClick={() => setModerationOpen(false)}>
                <X />
              </button>
            </header>
            <div className="admin-modal__body admin-modal__body--moderation">
              <section className="review-stats admin-review-stats">
                <article>
                  <small>Позиция</small>
                  <strong>
                    {reviewQueue.length
                      ? `${moderationIndex + 1}/${reviewQueue.length}`
                      : "0/0"}
                  </strong>
                </article>
                <article>
                  <small>Ожидают решения</small>
                  <strong>{reviewQueue.length}</strong>
                </article>
                <article>
                  <small>Подсказка</small>
                  <strong>
                    {moderationHint === "Подсказка не заполнена"
                      ? "Нет"
                      : "Есть"}
                  </strong>
                </article>
                <article>
                  <small>Горячие клавиши</small>
                  <strong>← → · X / C</strong>
                </article>
              </section>
              <section
                className={`attempt-card attempt-card--screen admin-attempt-card ${moderationWarnings.length ? "has-conflict" : ""}`}
              >
                <div className="attempt-card__header admin-attempt-card__header">
                  <span className="attempt-card__number">
                    {String(moderationIndex + 1).padStart(2, "0")}
                  </span>
                  {moderationPoster ? (
                    <img
                      className="review-card__poster"
                      src={moderationPoster}
                      alt={moderationTitle}
                    />
                  ) : (
                    <div className="review-card__poster admin-review-poster-fallback">
                      {pipelineIcon(selectedRun.pipelineKey)}
                    </div>
                  )}
                  <div className="attempt-card__identity">
                    <span className="attempt-label">
                      Попытка воспроизведения · {MODE_LABEL[moderationMode]}
                    </span>
                    <h2>{moderationTitle}</h2>
                    <p className="gm-head__sub">
                      <span className="gm-head__orig">
                        {moderationSubtitle}
                      </span>
                      {moderationYear && (
                        <>
                          <i className="gm-head__dot" aria-hidden="true">
                            ·
                          </i>
                          <span className="gm-year">{moderationYear}</span>
                        </>
                      )}
                      {moderationCountry && (
                        <>
                          <i className="gm-head__dot" aria-hidden="true">
                            ·
                          </i>
                          <span className="gm-year">{moderationCountry}</span>
                        </>
                      )}
                    </p>
                    {!!moderationGenres.length && (
                      <div className="gm-genres">
                        {moderationGenres.map((genre) => (
                          <span key={genre} className="gm-genre">
                            {genre}
                          </span>
                        ))}
                      </div>
                    )}
                  </div>
                  <div className="review-approval-badge">
                    <small>Статус</small>
                    <strong>
                      {STATUS_LABEL[String(moderationItem.status)] ??
                        title(moderationItem.status)}
                    </strong>
                  </div>
                </div>
                {!!moderationWarnings.length && (
                  <div className="review-conflict-banner">
                    <strong>
                      <AlertTriangle /> Предупреждения
                    </strong>
                    <span>{moderationWarnings.join(" • ")}</span>
                  </div>
                )}
                <div className="admin-attempt-fields">
                  {moderationAttemptFields.length ? (
                    moderationAttemptFields.map((entry) => (
                      <article
                        className="admin-attempt-field"
                        key={entry.label}
                      >
                        <small>{entry.label}</small>
                        <strong>{entry.value}</strong>
                      </article>
                    ))
                  ) : (
                    <p className="admin-attempt-fields__empty">
                      Недостаточно игровых полей для предпросмотра попытки.
                    </p>
                  )}
                </div>
              </section>
              <section className="assist-revealed">
                <article className="assist-reveal-card">
                  <span>
                    <Sparkles /> Подсказка в игре
                  </span>
                  <p>{moderationHint}</p>
                </article>
              </section>
              <section className="admin-moderation-meta">
                <article>
                  <small>Изменено полей</small>
                  <strong>{moderationChangedFields.length}</strong>
                </article>
                <article>
                  <small>Обновлено</small>
                  <strong>
                    {compactDate(
                      moderationItem.updatedAt || moderationItem.createdAt,
                    )}
                  </strong>
                </article>
                <article>
                  <small>ID карточки</small>
                  <strong>{title(moderationItem.entityKey)}</strong>
                </article>
                <article>
                  <small>Предупреждения</small>
                  <strong>{moderationWarnings.length || "Нет"}</strong>
                </article>
                {moderationChangedFields.length > 0 && (
                  <div className="admin-moderation-changes">
                    {moderationChangedFields.map((field) => (
                      <span key={field}>{field}</span>
                    ))}
                  </div>
                )}
              </section>
            </div>
            <footer className="admin-review-footer">
              <button
                className="ui-button ui-button--ghost"
                onClick={() => moveModeration(-1)}
                disabled={moderationIndex === 0 || decide.isPending}
              >
                <ChevronLeft />
                Назад
                <span
                  className="keycap-hint keycap-hint--inline"
                  aria-hidden="true"
                >
                  ←
                </span>
              </button>
              <button
                className="ui-button ui-button--secondary"
                onClick={() => submitModerationDecision(false)}
                disabled={decide.isPending}
              >
                <X />
                Отклонить
                <span
                  className="keycap-hint keycap-hint--inline"
                  aria-hidden="true"
                >
                  X
                </span>
              </button>
              <button
                className="ui-button ui-button--primary"
                onClick={() => submitModerationDecision(true)}
                disabled={decide.isPending}
              >
                <Check />
                Одобрить
                <span
                  className="keycap-hint keycap-hint--inline"
                  aria-hidden="true"
                >
                  C
                </span>
              </button>
              <button
                className="ui-button ui-button--ghost"
                onClick={() => moveModeration(1)}
                disabled={
                  moderationIndex >= reviewQueue.length - 1 || decide.isPending
                }
              >
                Дальше
                <ChevronRight />
                <span
                  className="keycap-hint keycap-hint--inline"
                  aria-hidden="true"
                >
                  →
                </span>
              </button>
            </footer>
          </div>
        </div>
      )}
      {selectedRun && activePipelineItem && (
        <div className="admin-drawer">
          <header className="admin-drawer__head">
            <div>
              <small>
                {pipelineLabel(selectedRun.pipelineKey)} ·{" "}
                {title(activePipelineItem.entityKey)}
              </small>
              <h2>
                {title(
                  record(activePipelineItem.proposedJson).titleRu ||
                    record(activePipelineItem.beforeJson).titleRu ||
                    record(activePipelineItem.card).titleRu ||
                    record(activePipelineItem.proposedJson).name ||
                    activePipelineItem.entityKey,
                )}
              </h2>
            </div>
            <div>
              <Status value={activePipelineItem.status} />
              <button onClick={() => setActivePipelineItemId(null)}>
                <X />
              </button>
            </div>
          </header>
          <div className="admin-drawer__body">
            <div className="admin-diff">
              {itemDiffFields(record(activePipelineItem)).map((field) => (
                <div key={field}>
                  <strong>{field}</strong>
                  <pre>
                    {JSON.stringify(
                      record(activePipelineItem.beforeJson)[field],
                      null,
                      2,
                    ) ?? "—"}
                  </pre>
                  <ChevronRight />
                  <pre>
                    {JSON.stringify(
                      record(activePipelineItem.proposedJson)[field],
                      null,
                      2,
                    ) ?? "—"}
                  </pre>
                </div>
              ))}
            </div>
            {pipelineWarnings(activePipelineItem.warningsJson).length > 0 && (
              <div className="admin-pipeline-item-warnings">
                <AlertTriangle />
                {pipelineWarnings(activePipelineItem.warningsJson).join(" · ")}
              </div>
            )}
          </div>
          <footer className="admin-drawer__footer">
            <div>
              <small>{title(activePipelineItem.entityKey)}</small>
            </div>
            {isItemReviewable(record(activePipelineItem)) ? (
              <>
                <button
                  className="admin-btn admin-btn--secondary"
                  onClick={() => decide.mutate({ itemId: String(activePipelineItem.id), approved: false })}
                >
                  <X />
                  Отклонить
                </button>
                <button
                  className="admin-btn admin-btn--primary"
                  onClick={() => decide.mutate({ itemId: String(activePipelineItem.id), approved: true })}
                >
                  <Check />
                  Принять
                </button>
              </>
            ) : selectedRun.pipelineKey === 'normalization' && String(activePipelineItem.status) === 'failed' ? (
              <button
                className="admin-btn admin-btn--primary"
                disabled={regenerateItem.isPending}
                onClick={() => requestRegenerateItem(String(activePipelineItem.id), String(activePipelineItem.entityKey))}
              >
                <RefreshCw />
                Перегенерировать айтем
              </button>
            ) : null}
          </footer>
        </div>
      )}
      {starting && (
        <div
          className="admin-modal-backdrop"
          onMouseDown={(event) =>
            event.target === event.currentTarget && closePipelineDialog()
          }
        >
          <div className="admin-modal admin-modal--pipeline">
            <header>
              <div>
                <span>{pipelineDetailTitle(pipelineKey)} · gpt-5-mini{repeatSourceRunId ? ` · на основе ${repeatSourceRunId.slice(0, 8)}` : ''}</span>
                <h2>{repeatSourceRunId ? 'Повторный запуск' : 'Новый запуск'}</h2>
              </div>
              <button onClick={closePipelineDialog}>
                <X />
              </button>
            </header>
            <div className="admin-modal__body">
              {pipelineKey === "normalization" ? (
                <>
                  <label className="admin-field admin-field--wide">
                    <span>Категория</span>
                    <select
                      value={normalizationMode}
                      onChange={(event) => {
                        const mode = event.target.value as ContentMode;
                        setNormalizationMode(mode);
                        setNormalizationField(
                          mode === "music" ? "activityStartYear" : "year",
                        );
                        setNormalizationContextFields([]);
                        setNormalizationSelected(new Set());
                        setNormalizationPrefilled(false);
                      }}
                    >
                      {Object.entries(MODE_LABEL).map(([value, label]) => (
                        <option key={value} value={value}>
                          {label}
                        </option>
                      ))}
                    </select>
                  </label>
                  <label className="admin-field admin-field--wide">
                    <span>Поле</span>
                    <select
                      value={normalizationField}
                      onChange={(event) =>
                        setNormalizationField(event.target.value)
                      }
                    >
                      {normalizationFieldOptions.map((entry) => (
                        <option key={entry.field} value={entry.field}>
                          {entry.label} · {entry.field}
                        </option>
                      ))}
                    </select>
                    {normalizationFieldsQuery.isFetching && <small>Проверяем доступные поля на сервере…</small>}
                    {normalizationFieldsQuery.isError && <small>Серверный список временно недоступен — показаны безопасные поля категории.</small>}
                  </label>
                  <div className="admin-field admin-field--wide admin-normalization-template">
                    <span>Инструкция модели</span>
                    <textarea
                      ref={normalizationPromptRef}
                      value={normalizationPrompt}
                      onChange={(event) =>
                        setNormalizationPrompt(event.target.value)
                      }
                      rows={6}
                    />
                    <small>
                      Переменные подставляются отдельно для каждой карточки перед вызовом GPT-5 mini.
                    </small>
                    <details open>
                      <summary>Вставить переменную</summary>
                      <div className="admin-normalization-variables">
                        {normalizationFieldsQuery.data?.variables.map((entry) => (
                          <button key={entry.name} type="button" title={entry.label} onClick={() => insertNormalizationVariable(entry.token)}>
                            {entry.token}
                          </button>
                        ))}
                      </div>
                    </details>
                    {normalizationUnknownVariables.length > 0 && (
                      <div className="admin-normalization-warning">
                        <AlertTriangle /> Неизвестные переменные: {normalizationUnknownVariables.map((name) => `%${name}%`).join(', ')}
                      </div>
                    )}
                  </div>
                  <section className="admin-normalization-context">
                    <header>
                      <div>
                        <strong>Контекст для модели</strong>
                        <small>Название, оригинальное название, ID и нормализуемое поле передаются всегда. Остальные поля выбираете вы.</small>
                      </div>
                      <button type="button" onClick={() => setNormalizationContextFields(normalizationFieldsQuery.data?.defaultContextFields ?? [])}>По умолчанию</button>
                    </header>
                    <div>
                      {normalizationFieldsQuery.data?.contextOptions.map((entry) => {
                        const mandatory = entry.field === 'titleRu' || entry.field === 'titleOriginal' || entry.field === normalizationField
                        const checked = mandatory || normalizationContextFields.includes(entry.field)
                        return (
                          <label key={entry.field} className={mandatory ? 'is-mandatory' : ''}>
                            <input
                              type="checkbox"
                              checked={checked}
                              disabled={mandatory}
                              onChange={(event) => setNormalizationContextFields((current) => event.target.checked
                                ? [...new Set([...current, entry.field])]
                                : current.filter((field) => field !== entry.field))}
                            />
                            <span>{entry.label}</span>
                            <small>%{entry.field}%</small>
                          </label>
                        )
                      })}
                    </div>
                  </section>
                  <section className="admin-normalization-preview">
                    <header>
                      <div>
                        <strong>Предпросмотр на первой подходящей карточке</strong>
                        <small>Это бесплатный локальный рендер — ИИ не вызывается.</small>
                      </div>
                      {normalizationRenderedPreview.isFetching && <LoaderCircle className="is-spinning" />}
                    </header>
                    {normalizationRenderedPreview.error ? (
                      <div className="admin-normalization-warning"><AlertTriangle /> {errorText(normalizationRenderedPreview.error)}</div>
                    ) : normalizationRenderedPreview.data ? (
                      <>
                        <p><strong>{normalizationRenderedPreview.data.item.titleRu || normalizationRenderedPreview.data.item.titleOriginal || normalizationRenderedPreview.data.item.id}</strong><small>{normalizationRenderedPreview.data.item.id}</small></p>
                        <label>Итоговая инструкция<pre>{normalizationRenderedPreview.data.renderedPrompt}</pre></label>
                        <details><summary>Структурированный контекст</summary><pre>{JSON.stringify(normalizationRenderedPreview.data.context, null, 2)}</pre></details>
                      </>
                    ) : <small>Заполните инструкцию и выберите карточки — здесь появится точный промпт.</small>}
                  </section>
                  <label className="admin-field admin-field--wide">
                    <span>Поиск карточек</span>
                    <input
                      value={normalizationQuery}
                      onChange={(event) => {
                        setNormalizationQuery(event.target.value);
                        setNormalizationSelected(new Set());
                      }}
                      placeholder="Название или ID; пусто — вся категория"
                    />
                  </label>
                  <section className="admin-normalization-tags">
                    <TagPicker
                      tags={normalizationTags.data?.items ?? []}
                      value={normalizationIncludeTags}
                      onChange={(ids) => {
                        setNormalizationIncludeTags(ids);
                        setNormalizationSelected(new Set());
                      }}
                      label="Включить карточки с тегами"
                    />
                    <label className="admin-field">
                      <span>Совпадение включаемых тегов</span>
                      <select
                        value={normalizationTagMatch}
                        onChange={(event) => {
                          setNormalizationTagMatch(
                            event.target.value as "all" | "any",
                          );
                          setNormalizationSelected(new Set());
                        }}
                      >
                        <option value="all">Есть все выбранные теги</option>
                        <option value="any">Есть хотя бы один тег</option>
                      </select>
                    </label>
                    <TagPicker
                      tags={normalizationTags.data?.items ?? []}
                      value={normalizationExcludeTags}
                      onChange={(ids) => {
                        setNormalizationExcludeTags(ids);
                        setNormalizationSelected(new Set());
                      }}
                      label="Исключить карточки с тегами"
                    />
                  </section>
                  <div className="admin-periods">
                    <button
                      className={
                        normalizationScope === "all" ? "is-active" : ""
                      }
                      onClick={() => setNormalizationScope("all")}
                    >
                      Все подходящие
                    </button>
                    <button
                      className={
                        normalizationScope === "selected" ? "is-active" : ""
                      }
                      onClick={() => setNormalizationScope("selected")}
                    >
                      Только выбранные · {normalizationSelected.size}
                    </button>
                  </div>
                  {normalizationScope === "selected" && (
                    <div className="admin-import-list">
                      {normalizationCandidates.isLoading ? (
                        <Loading />
                      ) : (
                        normalizationCandidates.data?.items.map((item) => (
                          <label key={item.id}>
                            <input
                              type="checkbox"
                              checked={normalizationSelected.has(item.id)}
                              onChange={(event) =>
                                setNormalizationSelected((current) => {
                                  const next = new Set(current);
                                  event.target.checked
                                    ? next.add(item.id)
                                    : next.delete(item.id);
                                  return next;
                                })
                              }
                            />
                            <strong>{item.titleRu}</strong>
                            <small>{item.id}</small>
                          </label>
                        ))
                      )}
                    </div>
                  )}
                  <label className="admin-field">
                    <span>Максимум карточек · {maxItems}</span>
                    <input
                      type="range"
                      min="1"
                      max="500"
                      value={maxItems}
                      onChange={(event) =>
                        setMaxItems(Number(event.target.value))
                      }
                    />
                    <small>
                      Для выбранных карточек применяется тот же верхний лимит.
                      Результат всегда сначала попадает на проверку.
                    </small>
                  </label>
                </>
              ) : (
                <>
                  <label className="admin-field admin-field--wide">
                    <span>Сценарий</span>
                    <select
                      value={scenario}
                      onChange={(event) => setScenario(event.target.value)}
                    >
                      <option value="manual">
                        Создать карточки по моему списку
                      </option>
                      <option value="discover">
                        {pipelineKey === "music"
                          ? "Найти и подготовить новых исполнителей"
                          : pipelineKey === "movie"
                            ? "Взять новые фильмы из топа Кинопоиска"
                            : "Взять новые аниме из топа Shikimori"}
                      </option>
                      <option value="candidates">
                        Обработать найденных кандидатов
                      </option>
                      <option value="review">
                        Перепроверить очередь ручной проверки
                      </option>
                      <option value="selected">
                        Обработать выбранные карточки по ID
                      </option>
                    </select>
                  </label>
                  {scenario === "selected" && (
                    <label className="admin-field admin-field--wide admin-artist-import">
                      <span>ID карточек <small>до 20 строк</small></span>
                      <textarea
                        value={selectedPipelineIdsText}
                        onChange={(event) => setSelectedPipelineIdsText(event.target.value)}
                        placeholder="Один ID карточки на строку"
                      />
                      <small>Выбрано: {selectedPipelineIds.length}. Количество ID не должно превышать установленный ниже лимит.</small>
                    </label>
                  )}
                  {scenario === "manual" && (
                    <>
                      <label className="admin-field admin-field--wide admin-artist-import">
                        <span>
                          {manualFieldLabel} <small>до 500 строк</small>
                        </span>
                        <textarea
                          value={manualText}
                          onChange={(event) =>
                            setManualText(event.target.value)
                          }
                          placeholder={manualPlaceholder}
                        />
                        <small>{manualHelp}</small>
                        <label className="admin-file-button">
                          <Upload />
                          Загрузить TXT или CSV
                          <input
                            type="file"
                            accept=".txt,.csv,text/plain,text/csv"
                            onChange={(event) => {
                              const file = event.target.files?.[0];
                              if (file) void file.text().then(setManualText);
                            }}
                          />
                        </label>
                      </label>
                      <label className="admin-toggle admin-pipeline-repeat-existing">
                        <input
                          type="checkbox"
                          checked={includeExisting}
                          onChange={(event) => setIncludeExisting(event.target.checked)}
                        />
                        Включать уже существующие карточки
                      </label>
                      <div className="admin-import-preview">
                        <header>
                          <strong>Предварительная проверка</strong>
                          <span>
                            {preview.isFetching
                              ? "Проверяем нашу базу…"
                              : `${manualItems.length} строк`}
                          </span>
                        </header>
                        {preview.error && !preview.isFetching && (
                          <ErrorState error={preview.error} />
                        )}
                        {preview.data && (
                          <>
                            <div className="admin-import-summary">
                              <span>
                                <b>{readyItems}</b> новых
                              </span>
                              <span>
                                <b>{String(previewSummary.existing ?? 0)}</b>{" "}
                                уже есть
                              </span>
                              <span>
                                <b>{String(previewSummary.duplicates ?? 0)}</b>{" "}
                                дублей
                              </span>
                            </div>
                            <div className="admin-import-list">
                              {preview.data.items.slice(0, 100).map((raw) => {
                                const item = record(raw);
                                const identity =
                                  pipelineKey === "music"
                                    ? title(item.artist)
                                    : pipelineKey === "movie"
                                      ? title(
                                          item.query ||
                                            (item.kinopoiskId
                                              ? `Кинопоиск #${String(item.kinopoiskId)}`
                                              : "Фильм не распознан"),
                                        )
                                      : `Shikimori #${String(item.shikimoriId)}`;
                                const details =
                                  pipelineKey === "movie"
                                    ? item.existingTitle ||
                                      (item.kinopoiskId
                                        ? `Кинопоиск #${String(item.kinopoiskId)}`
                                        : `ID будет найден после запуска${item.requestedYear ? ` · ${String(item.requestedYear)}` : ""}`)
                                    : item.country ||
                                      item.existingTitle ||
                                      item.hint ||
                                      "—";
                                return (
                                  <div
                                    key={`${item.index}-${item.artist ?? item.query ?? item.kinopoiskId ?? item.shikimoriId}`}
                                  >
                                    <strong>{identity}</strong>
                                    <small>{title(details)}</small>
                                    {item.existingItemId && (
                                      <button
                                        className="admin-link"
                                        onClick={() => {
                                          closePipelineDialog();
                                          navigate(
                                            "content",
                                            String(item.existingItemId),
                                          );
                                        }}
                                      >
                                        Открыть карточку <ChevronRight />
                                      </button>
                                    )}
                                    <Status value={item.status}>
                                      {item.status === "ready"
                                        ? "Новый"
                                        : item.status === "existing_card"
                                          ? "Уже есть"
                                          : item.status === "duplicate_input"
                                            ? "Дубль"
                                            : "Ошибка"}
                                    </Status>
                                  </div>
                                );
                              })}
                            </div>
                          </>
                        )}
                      </div>
                    </>
                  )}
                  <label className="admin-field">
                    <span>
                      {scenario === "manual" ? "Размер партии" : "Количество"} ·{" "}
                      {maxItems}
                    </span>
                    <input
                      type="range"
                      min="1"
                      max="20"
                      value={maxItems}
                      onChange={(event) =>
                        setMaxItems(Number(event.target.value))
                      }
                    />
                    <small>
                      {scenario === "manual"
                        ? "После каждой партии прогресс и расход сохраняются в БД."
                        : "Максимум элементов в текущем запуске."}
                    </small>
                  </label>
                </>
              )}
              <section className="admin-pipeline-run-options">
                {pipelineKey !== 'normalization' && (
                  <label className="admin-toggle">
                    <input
                      type="checkbox"
                      checked={pipelineAiMode !== 'never'}
                      onChange={(event) => setPipelineAiMode(event.target.checked ? 'auto' : 'never')}
                    />
                    Проверять результат через GPT-5 mini
                  </label>
                )}
                <label className="admin-toggle">
                  <input
                    type="checkbox"
                    checked={pipelineWebSearch}
                    disabled={pipelineKey !== 'normalization' && pipelineAiMode === 'never'}
                    onChange={(event) => setPipelineWebSearch(event.target.checked)}
                  />
                  Использовать веб-поиск
                </label>
              </section>
              <div className="admin-estimate">
                <CircleDollarSign />
                <div>
                  <span>Ориентировочная оценка</span>
                  <strong>
                    ${String(estimate.data?.estimatedCost ?? "—")}
                  </strong>
                  <small>
                    {String(estimate.data?.aiReviewCalls ?? "—")} AI-вызовов ·
                    фактическая сумма считается по usage и web search calls
                  </small>
                </div>
              </div>
            </div>
            <footer>
              <button
                className="admin-btn admin-btn--secondary"
                onClick={closePipelineDialog}
              >
                Отмена
              </button>
              <button
                className="admin-btn admin-btn--primary"
                disabled={
                  start.isPending ||
                  (pipelineKey === "normalization"
                    ? normalizationPrompt.trim().length < 10 ||
                      normalizationUnknownVariables.length > 0 ||
                      (normalizationScope === "selected" &&
                        !normalizationSelected.size)
                    : scenario === "manual" &&
                      (!runnableManualItems || preview.isFetching) ||
                      (scenario === "selected" &&
                        (!selectedPipelineIds.length || selectedPipelineIds.length > maxItems)))
                }
                onClick={() => start.mutate()}
              >
                <Play />
                {pipelineKey === "normalization"
                  ? `Нормализовать до ${maxItems} карточек`
                  : scenario === "manual"
                    ? `Запустить ${runnableManualItems} ${pipelineKey === "music" ? "артистов" : pipelineKey === "movie" ? "фильмов" : "аниме"}`
                    : scenario === "selected"
                      ? `Запустить ${selectedPipelineIds.length} карточек`
                    : `Запустить ${maxItems} элементов`}
              </button>
            </footer>
          </div>
        </div>
      )}
    </>
  );
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
  { id: 'builder', label: 'Конструктор игры', icon: LayoutTemplate },
  { id: 'reports', label: 'Баг-репорты', icon: Bug }, { id: 'pipelines', label: 'ИИ-пайплайны', icon: WandSparkles },
  { id: 'users', label: 'Пользователи', icon: UsersRound }, { id: 'events', label: 'События', icon: Activity },
  { id: 'quality', label: 'Контроль качества', icon: ListChecks }, { id: 'economy', label: 'Экономика', icon: CircleDollarSign },
  { id: 'integrations', label: 'API-интеграции', icon: KeyRound }, { id: 'system', label: 'Система', icon: Settings2 }, { id: 'audit', label: 'Журнал администратора', icon: FileClock },
]

export default function AdminApp() {
  const route = useRoute(); const [notices, setNotices] = useState<Notice[]>([]); const [global, setGlobal] = useState(''); const [contentMenuOpen, setContentMenuOpen] = useState(route.section === 'content'); const searchRef = useRef<HTMLInputElement>(null)
  const me = useQuery({ queryKey: ['admin', 'me'], queryFn: adminApi.me, retry: false }); const access = useQuery({ queryKey: ['admin', 'access'], queryFn: adminApi.health, enabled: me.data?.user.role === 'admin', retry: false }); const jobs = useQuery({ queryKey: ['admin', 'jobs', 'header'], queryFn: adminApi.jobs, enabled: access.isSuccess, refetchInterval: 5_000 })
  const globalResults = useQuery({ queryKey: ['admin', 'global-search', global], enabled: global.trim().length >= 2, queryFn: async () => { const [content, users, reports] = await Promise.all([adminApi.contentItems({ q: global, limit: 6 }), adminApi.users({ q: global, limit: 5 }), adminApi.reports({ q: global, limit: 5 })]); return { content: content.items, users: users.items, reports: reports.items } } })
  const notify = (tone: Notice['tone'], text: string) => { const id = crypto.randomUUID(); setNotices((current) => [...current, { id, tone, text }]); setTimeout(() => setNotices((current) => current.filter((notice) => notice.id !== id)), 4500) }
  useEffect(() => { const shortcut = (event: KeyboardEvent) => { if ((event.ctrlKey || event.metaKey) && event.key === 'k') { event.preventDefault(); searchRef.current?.focus() } }; addEventListener('keydown', shortcut); return () => removeEventListener('keydown', shortcut) }, [])
  useEffect(() => { if (route.section === 'content') setContentMenuOpen(true) }, [route.section])
  if (me.isLoading || (me.data?.user.role === 'admin' && access.isLoading)) return <div className="admin-gate"><div className="admin-gate__brand"><img src="/images/logo.svg" alt="Сходится!" /><LoaderCircle /></div><p>Проверяем административный доступ…</p></div>
  if (me.error || me.data?.user.role !== 'admin' || access.error) return <div className="admin-gate admin-gate--denied"><span><ShieldCheck /></span><h1>Административный доступ закрыт</h1><p>Войдите как разрешённый владелец проекта. Сервер дополнительно проверяет роль, UUID и email.</p><a className="admin-btn admin-btn--primary" href="/">Вернуться в игру</a>{(me.error || access.error) && <code>{errorText(me.error || access.error)}</code>}</div>
  const activeJobs = jobs.data?.items.filter((item) => ['queued', 'running'].includes(String(item.status))).length ?? 0
  const activeContentMode = new URLSearchParams(route.search).get('mode')
  return <div className="admin-root"><aside className="admin-sidebar"><a className="admin-brand" href="/" aria-label="Сходится! — игра"><img src="/images/logo.svg" alt="Сходится!" /><span>ADMIN</span></a><nav>{MENU.map(({ id, label, icon: Icon }) => id === 'content' ? <div key={id} className={`admin-nav-group ${contentMenuOpen ? 'is-open' : ''}`}><button className={route.section === id ? 'is-active' : ''} aria-expanded={contentMenuOpen} onClick={() => { setContentMenuOpen((isOpen) => !isOpen); if (route.section !== 'content') route.navigate('content') }}><Icon /><span>{label}</span><ChevronDown className="admin-nav-group__chevron" /></button><div className="admin-nav-group__children">{MODES.map((entry) => <button key={entry.value} className={activeContentMode === entry.value ? 'is-active' : ''} onClick={() => route.navigateContentMode(entry.value)}><span>{entry.label}</span></button>)}</div></div> : <button key={id} className={route.section === id ? 'is-active' : ''} onClick={() => route.navigate(id)}><Icon /><span>{label}</span>{id === 'reports' && <i />}</button>)}</nav><footer><div className="admin-admin-card"><span>{title(me.data.user.name).slice(0, 1)}</span><div><strong>{title(me.data.user.name)}</strong><small>{me.data.user.email}</small></div></div><a href="/"><ArrowLeft />Вернуться в игру</a></footer></aside><div className="admin-main"><header className="admin-topbar"><div className="admin-global-search"><Search /><input ref={searchRef} value={global} onChange={(event) => setGlobal(event.target.value)} placeholder="Глобальный поиск" /><kbd>Ctrl K</kbd>{globalResults.data && global.trim().length >= 2 && <div className="admin-search-results"><section><span>Карточки</span>{globalResults.data.content.map((item: AdminContentListItem) => <button key={item.id} onClick={() => { route.navigate('content', item.id); setGlobal('') }}><Boxes /><span><strong>{item.titleRu}</strong><small>{MODE_LABEL[item.mode]} · {item.id}</small></span></button>)}</section><section><span>Пользователи</span>{globalResults.data.users.map((item) => <button key={item.id} onClick={() => { route.navigate('users', item.id); setGlobal('') }}><UserRound /><span><strong>{item.isAnonymous ? 'Гость' : item.displayName || item.name}</strong><small>{item.email}</small></span></button>)}</section><section><span>Репорты</span>{globalResults.data.reports.map((entry) => <button key={String(entry.report.id)} onClick={() => { route.navigate('reports', String(entry.report.id)); setGlobal('') }}><Bug /><span><strong>{REPORT_REASON[String(entry.report.reason)]}</strong><small>{entry.titleRu}</small></span></button>)}</section></div>}</div><button className="admin-job-indicator" onClick={() => route.navigate('system')}><Activity />{activeJobs ? <><strong>{activeJobs}</strong><span>задач выполняется</span></> : <span>Фоновых задач нет</span>}</button><div className="admin-topbar-user"><span>{title(me.data.user.name).slice(0, 1)}</span><div><strong>{title(me.data.user.name)}</strong><small>Asia/Almaty</small></div></div></header><main className="admin-content">
    {route.section === 'dashboard' && <DashboardPage navigate={route.navigate} notify={notify} />}
    {route.section === 'content' && <ContentPage key={route.search} selectedId={route.id} navigate={route.navigate} notify={notify} />}
    {route.section === 'builder' && <GameBuilderPage notify={notify} onNavigateContent={() => route.navigate('content')} />}
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

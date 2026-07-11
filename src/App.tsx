import { useCallback, useEffect, useMemo, useReducer, useRef, useState, type ButtonHTMLAttributes, type CSSProperties, type ReactNode } from 'react'
import {
  AlertTriangle,
  Archive,
  ArrowDown,
  ArrowUp,
  BarChart3,
  CalendarDays,
  Check,
  ChevronLeft,
  ChevronRight,
  CircleHelp,
  ClipboardList,
  Copy,
  Film,
  Gamepad2,
  HeartPulse,
  Lock,
  LockOpen,
  MapPin,
  Music2,
  NotebookText,
  Play,
  RotateCcw,
  Search,
  Share2,
  Sparkles,
  Stethoscope,
  Ticket,
  Target,
  Trophy,
  Tv,
  UserRound,
  X,
} from 'lucide-react'
import { MODE_CONFIG, MODE_TABS } from './app/mode-config'
import { markAppFirstRender, markSearchDuration, trackMetrikaGoal, trackMetrikaScreen } from './app/metrics'
import {
  canUseAsArtistPortrait,
  canonicalMusicId,
  compareTitles,
  dailyTitle,
  DIFFICULTIES,
  DIFFICULTY_ORDER,
  getMoscowDate,
  localizeMusicCountry,
  MUSIC_ID_REDIRECTS,
  musicCareerStatusLabel,
  musicDifficultyPool,
  musicOriginLabel,
  musicTierLabel,
  musicTypeLabel,
  PERIODS,
  pickDailyVignette,
  poolFor,
  prettyDate,
  resolveMusicRedirectId,
  resultText,
  searchTitles,
} from './game'
import { createInitialGameSessionState, gameSessionReducer } from './game/session-reducer'
import { useDataLoader } from './hooks/use-data-loader'
import { useDebouncedValue } from './hooks/use-debounced-value'
import { addTicketLedgerEntry, allGames, consumeFreePlayUsage, gameKey, isPeriodUnlocked, loadAttendanceStats, loadDailyAttendance, loadFreePlayUsage, loadGame, loadMusicReviewApprovals, loadMusicReviewConflictChoices, loadPeriodUnlocks, loadPromoUsage, loadStats, loadTicketLedger, loadWallet, saveAttendanceStats, saveDailyAttendance, saveGame, savePromoUsage, saveStats, saveWallet, setMusicReviewApproval, setMusicReviewConflictChoice, unlockPeriod, unlockedPeriodsFor, type MusicReviewConflictChoices, type MusicReviewConflictOption } from './storage'
import type { AttendanceStats, AssistHintKey, Attempt, CaseVignetteMap, DailyAttendance, DifficultyKey, GameStatus, HintCheckpoint, HintChoice, HintPerson, LibrarySearchIndex, PeriodKey, Person, SavedGame, Stats, TitleItem, TitleMode, Wallet } from './types'

const normalizeTextMatch = (value: string) => value
  .normalize('NFKD')
  .toLocaleLowerCase('ru-RU')
  .replace(/[\u0300-\u036f]/g, '')
  .replace(/ё/g, 'е')
  .replace(/[^a-zа-я0-9]+/gi, ' ')
  .trim()
const modeIcon = (mode: TitleMode) => mode === 'movie'
  ? <Film />
  : mode === 'series'
    ? <Tv />
    : mode === 'anime'
      ? <Sparkles />
      : mode === 'game'
        ? <Gamepad2 />
        : mode === 'music'
          ? <Music2 />
          : <Stethoscope />
const modeMeta = (mode: TitleMode) => MODE_CONFIG[mode]
const PERIOD_UNLOCK_COSTS: Partial<Record<PeriodKey, number>> = {
  from_2020: 25,
  from_2010: 25,
  from_2000: 25,
  from_1990: 25,
  from_1980: 25,
  from_1960: 25,
}
const PERIOD_UNLOCK_ORDER: PeriodKey[] = ['all', 'from_2020', 'from_2010', 'from_2000', 'from_1990', 'from_1980', 'from_1960']
const UNLOCKABLE_PERIOD_MODES = new Set<TitleMode>(['movie', 'series', 'anime'])
const FREE_PLAY_MODES = new Set<TitleMode>(['movie', 'series', 'anime', 'music'])
const FREE_PLAY_BASE_COST = 45
const FREE_PLAY_COST_STEP = 15
const TICKET_PROMO_CODE = 'ДАЙБИЛЕТИК'
const TICKET_PROMO_AWARD = 50
const TICKET_PROMO_LIMIT = 3
const WIPE_TICKETS_CODE = 'СОСО'
const ECONOMY_CHANGE_EVENT = 'seans:economy-change'
const freePlayCost = (launchesToday: number) => {
  const safeLaunches = Math.max(0, Math.trunc(Number(launchesToday) || 0))
  return FREE_PLAY_BASE_COST + safeLaunches * FREE_PLAY_COST_STEP
}
type EconomyAward = {
  total: number
  base: number
  multiplier: number
  completed: number
  win: number
  speed: number
  firstDaily: number
  fullHouse: number
  newDailyStreak: number
  gracePasses: number
  alreadyClaimed: boolean
}
const emptyAward = (attendance: AttendanceStats): EconomyAward => ({
  total: 0,
  base: 0,
  multiplier: 1,
  completed: 0,
  win: 0,
  speed: 0,
  firstDaily: 0,
  fullHouse: 0,
  newDailyStreak: attendance.currentDailyStreak,
  gracePasses: attendance.gracePasses,
  alreadyClaimed: true,
})
const streakMultiplier = (days: number) => days >= 30 ? 1.6 : days >= 14 ? 1.4 : days >= 7 ? 1.25 : days >= 3 ? 1.1 : 1
const nextMultiplierAt = (days: number) => days < 3 ? 3 : days < 7 ? 7 : days < 14 ? 14 : days < 30 ? 30 : null
const formatMultiplier = (value: number) => `×${value.toLocaleString('ru-RU', { minimumFractionDigits: 1, maximumFractionDigits: value % 1 ? 2 : 1 })}`
const dateIndex = (date: string) => Math.floor(new Date(`${date}T12:00:00+03:00`).getTime() / 86_400_000)
const dateDistance = (from: string, to: string) => dateIndex(to) - dateIndex(from)
const uniqueModes = (modes: TitleMode[]) => [...new Set(modes)]
const completionSessionKey = (mode: TitleMode, period: PeriodKey, date: string, variant = '') => {
  const base = gameKey(mode, period, date)
  return variant ? `${base}|diff:${variant}` : base
}
const forceClientRefresh = () => {
  try {
    const url = new URL(window.location.href)
    url.searchParams.set('refresh', String(Date.now()))
    window.location.replace(url.toString())
  } catch {
    window.location.reload()
  }
}
const periodUnlockCost = (period: PeriodKey) => PERIOD_UNLOCK_COSTS[period] ?? 0
const canUnlockPeriods = (mode: TitleMode) => UNLOCKABLE_PERIOD_MODES.has(mode)
const formatTickets = (count: number) => `${count} ${countWord(count, ['билет', 'билета', 'билетов'])}`
const formatArtists = (count: number) => `${count} ${countWord(count, ['артист', 'артиста', 'артистов'])}`
const countWord = (count: number, forms: [string, string, string]) => {
  const mod100 = Math.abs(count) % 100
  const mod10 = mod100 % 10
  if (mod100 >= 11 && mod100 <= 14) return forms[2]
  if (mod10 === 1) return forms[0]
  if (mod10 >= 2 && mod10 <= 4) return forms[1]
  return forms[2]
}
const toInteger = (value: number | string | undefined, fallback: number) => {
  const parsed = Math.trunc(Number(value))
  return Number.isFinite(parsed) ? parsed : fallback
}
const normalizeSystemKey = (value: string) => normalizeTextMatch(value).replace(/[^a-zа-я0-9]+/gi, ' ').trim()
const diagnosisSystemIconByKey = new Map<string, string>([
  ['дыхательная система', './images/diagnosis-systems/respiratory.svg'],
  ['пищеварительная система', './images/diagnosis-systems/digestive.svg'],
  ['психика и поведение', './images/diagnosis-systems/mental.svg'],
  ['зубы и полость рта', './images/diagnosis-systems/dental.svg'],
  ['мочевыделительная система', './images/diagnosis-systems/urinary.svg'],
  ['нервная система', './images/diagnosis-systems/nervous.svg'],
  ['органы зрения', './images/diagnosis-systems/vision.svg'],
  ['органы слуха', './images/diagnosis-systems/hearing.svg'],
  ['кожа и подкожная клетчатка', './images/diagnosis-systems/skin.svg'],
  ['костно мышечная система', './images/diagnosis-systems/musculoskeletal.svg'],
  ['кровь и иммунная система', './images/diagnosis-systems/blood-immune.svg'],
  ['репродуктивная система', './images/diagnosis-systems/reproductive.svg'],
  ['сердечно сосудистая система', './images/diagnosis-systems/cardiovascular.svg'],
  ['эндокринная система', './images/diagnosis-systems/endocrine.svg'],
])
const defaultDiagnosisSystemIcon = './images/diagnosis-systems/nervous.svg'
const splitHintValues = (value: string) => value.split(',').map((item) => item.trim()).filter((item) => item && item !== 'Нет данных')
const visibleMatchedItems = (items: string[], matched: Set<string>, limit: number) =>
  items.filter((item, index) => index < limit || matched.has(normalizeTextMatch(item)))

const isEditableTarget = (target: EventTarget | null) => {
  if (!(target instanceof HTMLElement)) return false
  const tag = target.tagName
  return tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT' || target.isContentEditable
}

const useDismissOnOutside = (
  open: boolean,
  containerRef: { current: HTMLElement | null },
  onDismiss: () => void,
) => {
  useEffect(() => {
    if (!open) return

    const onPointerDown = (event: PointerEvent) => {
      if (!(event.target instanceof Node)) return
      if (containerRef.current?.contains(event.target)) return
      onDismiss()
    }

    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key !== 'Escape') return
      event.preventDefault()
      onDismiss()
    }

    window.addEventListener('pointerdown', onPointerDown)
    window.addEventListener('keydown', onKeyDown)
    return () => {
      window.removeEventListener('pointerdown', onPointerDown)
      window.removeEventListener('keydown', onKeyDown)
    }
  }, [open, containerRef, onDismiss])
}

type AssistHintView = {
  key: AssistHintKey
  title: string
  subtitle: string
  body?: string
  people?: Person[]
  available: boolean
}

const comparedAnimeFactLabels = new Set([
  'формат',
  'статус',
  'эпизоды',
  'вышло эпизодов',
  'вышло серий',
  'первоисточник',
])
const animeAssistFact = (facts: string[]) => facts.find((fact) => {
  const label = normalizeTextMatch(fact.split(':')[0] ?? '')
  return label && !comparedAnimeFactLabels.has(label)
}) ?? ''

type AppScreen = 'hub' | 'title' | 'game' | 'rewatch' | 'review'
const isAppScreen = (value: unknown): value is AppScreen => value === 'hub' || value === 'title' || value === 'game' || value === 'rewatch' || value === 'review'
type AdminWindow = Window & {
  __SEANS_ADMIN_NEW_DAILY__?: (saltStep?: number | string) => number
  __SEANS_ADMIN_SET_DAILY_SALT__?: (saltValue?: number | string) => number
  __SEANS_ADMIN_GET_DAILY_SALT__?: () => number
  SEANS_ADMIN_NEW_DAILY?: (saltStep?: number | string) => number
  SEANS_ADMIN_SET_DAILY_SALT?: (saltValue?: number | string) => number
  SEANS_ADMIN_GET_DAILY_SALT?: () => number
}

const ASSIST_HINT_KEYS: AssistHintKey[] = ['plot', 'slogan', 'cast_main', 'cast_secondary', 'fact', 'awards']
const isAssistHintKeyValue = (value: unknown): value is AssistHintKey => typeof value === 'string' && ASSIST_HINT_KEYS.includes(value as AssistHintKey)
const isHintCheckpointValue = (value: unknown): value is HintCheckpoint => value === 5 || value === 8

const collectSavedAttemptIds = (saved: SavedGame | null): string[] => {
  if (!saved) return []
  const fromIds = Array.isArray(saved.attemptTitleIds)
    ? saved.attemptTitleIds.filter((id): id is string => typeof id === 'string' && Boolean(id))
    : []
  if (fromIds.length) return fromIds.slice(0, 10)
  return saved.attempts.map((attempt) => attempt.titleId).filter(Boolean).slice(0, 10)
}

const sanitizeStoredHintChoices = (saved: SavedGame | null, allowedHintKeys: Set<AssistHintKey>): HintChoice[] => {
  if (!saved) return []

  const fallbackChoices = (saved.usedHints ?? []).filter(isAssistHintKeyValue).slice(0, 2).map((key, index) => ({
    round: (index === 0 ? 5 : 8) as HintCheckpoint,
    key,
  }))
  const rawChoices = Array.isArray(saved.hintChoices) && saved.hintChoices.length ? saved.hintChoices : fallbackChoices
  const seenRounds = new Set<HintCheckpoint>()
  const choices: HintChoice[] = []

  for (const rawChoice of rawChoices) {
    if (!rawChoice || typeof rawChoice !== 'object') continue
    const round = (rawChoice as { round?: unknown }).round
    const key = (rawChoice as { key?: unknown }).key
    if (!isHintCheckpointValue(round) || !isAssistHintKeyValue(key)) continue
    if (allowedHintKeys.size > 0 && !allowedHintKeys.has(key)) continue
    if (seenRounds.has(round)) continue
    seenRounds.add(round)
    choices.push({ round, key })
  }

  return choices
}

const sanitizeDismissedRounds = (saved: SavedGame | null, openedRounds: Set<HintCheckpoint>): HintCheckpoint[] => {
  if (!saved || !Array.isArray(saved.dismissedHintRounds)) return []
  const rounds = new Set<HintCheckpoint>()
  for (const round of saved.dismissedHintRounds) {
    if (!isHintCheckpointValue(round) || openedRounds.has(round)) continue
    rounds.add(round)
  }
  return [...rounds]
}

const rebuildAttemptsForAnswer = (attemptIds: string[], poolById: Map<string, TitleItem>, answer: TitleItem): Attempt[] => {
  const attempts: Attempt[] = []

  for (const titleId of attemptIds) {
    const guess = poolById.get(titleId)
    if (!guess) continue
    attempts.push({ titleId, hints: compareTitles(guess, answer) })
    if (titleId === answer.id || attempts.length >= 10) break
  }

  return attempts
}

const deriveStatusFromAttempts = (attempts: Attempt[], answerId: string): GameStatus => {
  if (attempts.some((attempt) => attempt.titleId === answerId)) return 'won'
  if (attempts.length >= 10) return 'lost'
  return 'playing'
}

const cleanHintText = (value: string) => {
  const redactionPlaceholder = '__SEANS_REDACTION__'
  return value
    .replace(/\[+\s*REDACTED\s*\]+/gi, redactionPlaceholder)
    .replace(/\[\[([^\[\]]+)\]\]/g, '$1')
    .replace(/\[\/?[a-z_]+(?:=[^\]]+)?\]/gi, ' ')
    .replace(new RegExp(redactionPlaceholder, 'g'), '[REDACTED]')
    .replace(/<[^>]+>/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
}
const cropHintText = (value: string, max = 210) => value.length > max ? `${value.slice(0, max).trimEnd()}…` : value
const TRUNCATED_HINT_END_RE = /(?:\.\.\.|…)\s*$/
const resolvePlotHintText = (item: TitleItem) => {
  const plotHint = cleanHintText(item.plotHint || '')
  const description = cleanHintText(item.description || '')

  if (!plotHint) return description
  if (item.mode === 'anime') return plotHint
  if (TRUNCATED_HINT_END_RE.test(plotHint) && description && !/\[+\s*REDACTED\s*\]+/i.test(plotHint)) return description
  return plotHint
}
const REDACTED_TOKEN_RE = /(\[+\s*REDACTED\s*\]+)/gi
const isRedactedToken = (value: string) => /^\[+\s*REDACTED\s*\]+$/i.test(value)
const renderHintBody = (value: string): ReactNode => {
  const text = cleanHintText(value)
  if (!text) return ''

  const parts = text.split(REDACTED_TOKEN_RE).filter(Boolean)
  if (parts.length === 1) return text

  const nodes: ReactNode[] = []
  for (let i = 0; i < parts.length; i += 1) {
    const part = parts[i]
    if (isRedactedToken(part)) {
      nodes.push(<span className="redaction-chip" key={`redaction-${i}`} aria-label="Скрытый фрагмент">██████</span>)
      continue
    }
    nodes.push(part)
  }

  return nodes
}
const personName = (person: { nameRu: string; nameOriginal: string }) => person.nameRu || person.nameOriginal || 'Без имени'
const titlePrimaryScore = (item: TitleItem) => {
  if (item.mode === 'anime') return item.shikimoriScore ?? item.ratings?.recognizability ?? null
  if (item.mode === 'music') return item.votes?.gamesPlayed ?? null
  if (item.mode === 'movie' || item.mode === 'series') return item.ratings?.kinopoisk ?? null
  return null
}
const ratingBadge = (item: TitleItem) => {
  if (item.mode === 'anime') {
    const value = titlePrimaryScore(item)
    return { label: 'SHIKI', value: value != null ? value.toFixed(2) : '—' }
  }
  if (item.mode === 'music') {
    const value = item.votes?.gamesPlayed
    return {
      label: 'LFM',
      value: value != null
        ? new Intl.NumberFormat('ru-RU', { notation: 'compact', maximumFractionDigits: 1 }).format(value)
        : '—',
    }
  }
  return { label: 'КП', value: item.ratings?.kinopoisk?.toFixed(1) ?? '—' }
}
const progressOverlapHintKeys = new Set([
  'body_systems',
  'symptoms',
  'diagnostics',
  'risk_factors',
  'genres',
  'steam_categories',
  'platforms',
  'developer',
  'publisher',
])
const nonScoringHintKeys = new Set(['similar_artists', 'top_track', 'top_album', 'listeners'])
const hintProgressScore = (hint: Attempt['hints'][number]) => {
  if (nonScoringHintKeys.has(hint.key)) return 0
  if (progressOverlapHintKeys.has(hint.key)) {
    const overlapCount = (hint.matchedValues ?? []).filter(Boolean).length
    if (overlapCount > 0) return overlapCount
  }
  if ((hint.key === 'creator' || hint.key === 'cast') && hint.people?.some((person) => person.matched)) return 1
  return hint.status === 'match' ? 1 : 0
}
const progressStats = (hints: Attempt['hints']) => {
  const scores = hints.map(hintProgressScore)
  return {
    matchedCount: scores.reduce((sum, score) => sum + score, 0),
    matchedFields: scores.filter((score) => score > 0).length,
    totalFields: hints.length,
  }
}

const SERVICE_REVIEW_REASONS = new Set(['theaudiodb_demo_key_used'])
const HUMAN_REVIEW_REASON_LABELS: Record<string, string> = {
  conflict_country: 'Конфликт: страна',
  conflict_begin_year: 'Конфликт: год дебюта',
  conflict_canonical_name: 'Конфликт: имя артиста',
  low_match_confidence: 'Низкая уверенность матчинга',
  top_tracks_missing: 'Отсутствуют топ-треки',
  top_albums_missing: 'Отсутствуют топ-альбомы',
  canonical_name_missing: 'Отсутствует каноническое имя',
  musicbrainz_no_match: 'MusicBrainz: не найдено',
  wikidata_no_match: 'Wikidata: не найдено',
  theaudiodb_no_match: 'TheAudioDB: не найдено',
  spotify_no_match: 'Spotify: не найдено',
}

const uniqueReviewReasons = (reasons: string[]) => {
  const seen = new Set<string>()
  const out: string[] = []
  for (const reason of reasons) {
    const text = String(reason ?? '').trim()
    if (!text || seen.has(text)) continue
    seen.add(text)
    out.push(text)
  }
  return out
}

const reviewReasonLabel = (reason: string) => {
  if (HUMAN_REVIEW_REASON_LABELS[reason]) return HUMAN_REVIEW_REASON_LABELS[reason]
  if (reason.includes('_failed:')) {
    const [source, details] = reason.split('_failed:')
    return `${source.toUpperCase()}: ошибка (${details || 'request failed'})`
  }
  if (reason.endsWith('_no_match')) {
    return `${reason.replace(/_no_match$/, '').toUpperCase()}: не найдено`
  }
  return reason.replace(/_/g, ' ')
}

const reviewReasonTone = (reason: string) => {
  if (SERVICE_REVIEW_REASONS.has(reason)) return 'service'
  if (reason.startsWith('conflict_')) return 'conflict'
  return 'doubt'
}

type ConflictEvidenceField = 'canonicalName' | 'country' | 'beginYear'
type ConflictOption = {
  value: string
  sources: string[]
}
type ConflictPair = {
  reason: string
  field: ConflictEvidenceField
  fieldLabel: string
  optionA: ConflictOption
  optionB: ConflictOption
}
type MusicNormalizedEvidence = {
  sourceEvidence?: Partial<Record<ConflictEvidenceField, unknown>>
}

const CONFLICT_REASON_META: Record<string, { field: ConflictEvidenceField; label: string }> = {
  conflict_canonical_name: { field: 'canonicalName', label: 'Имя артиста' },
  conflict_country: { field: 'country', label: 'Страна' },
  conflict_begin_year: { field: 'beginYear', label: 'Год дебюта' },
}

const asRecord = (value: unknown): Record<string, unknown> | null => {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return null
  return value as Record<string, unknown>
}

const normalizeEvidenceValue = (value: unknown): string => {
  if (value == null) return ''
  if (Array.isArray(value)) {
    return value
      .map((item) => String(item ?? '').trim())
      .filter(Boolean)
      .join(', ')
  }
  if (typeof value === 'number') {
    const parsed = Math.trunc(value)
    return Number.isFinite(parsed) ? String(parsed) : ''
  }
  if (typeof value === 'boolean') return value ? 'true' : 'false'
  return String(value).trim()
}

const toConflictPairs = (reasons: string[], normalizedItem: MusicNormalizedEvidence | null): ConflictPair[] => {
  if (!normalizedItem?.sourceEvidence) return []
  const sourceEvidence = normalizedItem.sourceEvidence
  const out: ConflictPair[] = []

  for (const reason of reasons) {
    const meta = CONFLICT_REASON_META[reason]
    if (!meta) continue

    const rawEntries = sourceEvidence[meta.field]
    if (!Array.isArray(rawEntries)) continue

    const grouped = new Map<string, Set<string>>()
    for (const entry of rawEntries) {
      const data = asRecord(entry)
      if (!data) continue
      const value = normalizeEvidenceValue(data.value)
      if (!value) continue
      const source = typeof data.source === 'string' && data.source.trim() ? data.source.trim() : 'unknown'
      if (!grouped.has(value)) grouped.set(value, new Set<string>())
      grouped.get(value)?.add(source)
    }

    const options = [...grouped.entries()]
      .map(([value, sources]) => ({ value, sources: [...sources].sort((a, b) => a.localeCompare(b, 'ru-RU')) }))
      .sort((a, b) => {
        if (b.sources.length !== a.sources.length) return b.sources.length - a.sources.length
        return a.value.localeCompare(b.value, 'ru-RU')
      })

    if (options.length < 2) continue
    out.push({
      reason,
      field: meta.field,
      fieldLabel: meta.label,
      optionA: options[0],
      optionB: options[1],
    })
  }

  return out
}

function AttemptScore({ matchedCount, matchedFields, totalFields, isCorrectAttempt }: { matchedCount: number; matchedFields: number; totalFields: number; isCorrectAttempt: boolean }) {
  const isFullFieldMatch = totalFields > 0 && matchedFields === totalFields
  const tone = matchedCount === 0 ? 'miss' : isFullFieldMatch && !isCorrectAttempt ? 'partial' : 'match'
  const label = isFullFieldMatch && !isCorrectAttempt
    ? `Совпадений: ${matchedCount}; все поля сходятся, ответ не совпал`
    : `Совпадений: ${matchedCount}; полей с совпадениями: ${matchedFields} из ${totalFields}`

  return <div className={`dx-score dx-score--${tone}`} aria-label={label}>
    <span>Совпадений</span>
    <div className="dx-score__bar">{Array.from({ length: totalFields }, (_, i) => <i key={i} className={i < matchedFields ? 'on' : ''} />)}</div>
    <strong>{matchedCount}</strong>
  </div>
}
const alignSystemTooltip = (iconEl: HTMLElement | null) => {
  if (!iconEl || typeof window === 'undefined') return

  if (!window.matchMedia('(max-width: 719px)').matches) {
    iconEl.style.setProperty('--dx-tooltip-shift', '0px')
    return
  }

  const tooltipEl = iconEl.querySelector<HTMLElement>('.dx-system-icon__tooltip')
  if (!tooltipEl) return

  const visualViewport = window.visualViewport
  const viewportLeft = visualViewport?.offsetLeft ?? 0
  const viewportWidth = Math.min(
    window.innerWidth,
    document.documentElement?.clientWidth || window.innerWidth,
    visualViewport?.width || window.innerWidth,
  )
  const viewportRight = viewportLeft + viewportWidth
  iconEl.style.setProperty('--dx-tooltip-shift', '0px')
  const tooltipRect = tooltipEl.getBoundingClientRect()
  const viewportPadding = 10
  let shift = 0

  if (tooltipRect.left < viewportLeft + viewportPadding) {
    shift = viewportLeft + viewportPadding - tooltipRect.left
  } else if (tooltipRect.right > viewportRight - viewportPadding) {
    shift = viewportRight - viewportPadding - tooltipRect.right
  }

  iconEl.style.setProperty('--dx-tooltip-shift', `${Math.round(shift)}px`)
}
const steamCategoryIcon = (value: string): 'single' | 'multi' | null => {
  const text = normalizeTextMatch(value).trim()
  if (!text) return null

  const countMatch = text.match(/^(\d+)/)
  if (countMatch) {
    const count = Number(countMatch[1])
    return count === 1 ? 'single' : 'multi'
  }
  if (text.includes('одиноч')) return 'single'
  if (text.includes('мульти') || text.includes('кооп') || text.includes('онлайн') || text.includes('игрок')) return 'multi'
  return null
}
const playerCountFromCategory = (value: string) => {
  const text = normalizeTextMatch(value)
  const matches = [...text.matchAll(/\d{1,2}/g)]
  if (!matches.length || !/(игрок|player)/.test(text)) return null
  const numbers = matches.map((match) => Number(match[0])).filter((num) => Number.isFinite(num))
  if (!numbers.length) return null
  return Math.max(...numbers)
}
const isPlayerCategory = (value: string) => {
  const text = normalizeTextMatch(value).trim()
  if (!text) return false
  if (playerCountFromCategory(text) != null) return true
  return text.includes('одиноч')
    || text.includes('single')
    || text.includes('мульти')
    || text.includes('multiplayer')
    || text.includes('кооп')
    || text.includes('coop')
    || text.includes('co-op')
    || text.includes('игрок')
    || text.includes('player')
    || text.includes('сетев')
    || text.includes('online')
}
const normalizeGameCategoryKey = (value: string) => {
  const text = normalizeTextMatch(value).trim()
  if (!text) return ''
  const playersCount = playerCountFromCategory(text)
  if (playersCount != null) return `players:${playersCount}`
  if (text.includes('одиноч') || text.includes('single')) return 'players:single'
  if (text.includes('мульти') || text.includes('multiplayer') || text.includes('кооп') || text.includes('coop') || text.includes('co-op') || text.includes('игрок') || text.includes('player') || text.includes('online') || text.includes('сетев')) {
    return 'players:multi'
  }
  return text.replace(/[^a-zа-я0-9]+/gi, ' ').trim()
}
const dedupeGameCategories = (categories: string[], removePlayerCategories: boolean) => {
  const seen = new Set<string>()
  const result: string[] = []

  for (const rawCategory of categories) {
    const category = rawCategory.trim()
    if (!category) continue
    if (removePlayerCategories && isPlayerCategory(category)) continue
    const key = normalizeGameCategoryKey(category) || normalizeTextMatch(category)
    if (seen.has(key)) continue
    seen.add(key)
    result.push(category)
  }

  return result
}
const collectMatchedTags = (attempts: Attempt[]) => {
  const tags: string[] = []
  const seen = new Set<string>()

  for (const attempt of attempts) {
    for (const hint of attempt.hints) {
      const matchedValues = (hint.matchedValues ?? []).map((value) => value.trim()).filter(Boolean)
      for (const value of matchedValues) {
        const hash = `value:${normalizeTextMatch(value)}`
        if (seen.has(hash)) continue
        seen.add(hash)
        tags.push(value)
      }

      if (matchedValues.length || hint.status !== 'match') continue
      if (['creator', 'cast'].includes(hint.key)) continue
      if (!hint.value || hint.value === '—' || hint.value === 'Нет данных') continue

      const exactTag = `${hint.label}: ${hint.value}`
      const hash = `exact:${hint.key}:${normalizeTextMatch(hint.value)}`
      if (seen.has(hash)) continue
      seen.add(hash)
      tags.push(exactTag)
    }
  }

  return tags
}

const buildAssistHints = (item: TitleItem): AssistHintView[] => {
  const plotBase = resolvePlotHintText(item)
  const plot = item.mode === 'movie' || item.mode === 'series' || item.mode === 'anime' ? plotBase : cropHintText(plotBase)
  const facts = (item.facts ?? []).map(cleanHintText).filter(Boolean)
  const sloganHint = cleanHintText(item.slogan || '')
  const fact = facts[0]

  if (item.mode === 'anime') {
    const factHint = animeAssistFact(facts)
    return [
      {
        key: 'plot',
        title: 'Сюжет',
        subtitle: 'Фрагмент описания без спойлеров',
        body: plot,
        available: Boolean(plot),
      },
      {
        key: 'fact',
        title: 'Факт',
        subtitle: 'Дополнительная деталь вне обычных признаков',
        body: factHint,
        available: Boolean(factHint),
      },
    ]
  }

  if (item.mode === 'diagnosis') {
    const diagnosticsHint = cropHintText(cleanHintText((item.diagnostics ?? []).slice(0, 4).join(', ')))
    return [
      {
        key: 'plot',
        title: 'Описание',
        subtitle: 'Короткое описание состояния',
        body: plot,
        available: Boolean(plot),
      },
      {
        key: 'slogan',
        title: 'Диагностика',
        subtitle: 'Что обычно назначают для проверки',
        body: diagnosticsHint,
        available: Boolean(diagnosticsHint),
      },
      {
        key: 'fact',
        title: 'Факт',
        subtitle: 'Дополнительная деталь по состоянию',
        body: fact,
        available: Boolean(fact),
      },
    ]
  }

  if (item.mode === 'game') {
    const dedupedGameCategories = dedupeGameCategories(item.steamCategories ?? [], true)
    const tagsHint = cropHintText(cleanHintText([
      ...(item.genres ?? []).slice(0, 3),
      ...dedupedGameCategories.slice(0, 3),
    ].join(', ')))
    const gameFact = cropHintText(cleanHintText([
      item.year ? `Год релиза: ${item.year}` : '',
      item.topRank ? `Позиция в топе: #${item.topRank}` : '',
      item.ratings?.metacritic ?? item.metacritic ? `Metacritic: ${item.ratings?.metacritic ?? item.metacritic}` : '',
    ].filter(Boolean).join(' · ')))
    return [
      {
        key: 'plot',
        title: 'Описание',
        subtitle: 'Фрагмент карточки игры без спойлеров',
        body: plot,
        available: Boolean(plot),
      },
      {
        key: 'slogan',
        title: 'Жанры и категории',
        subtitle: 'Подсказка по жанрам и тегам Steam',
        body: tagsHint,
        available: Boolean(tagsHint),
      },
      {
        key: 'fact',
        title: 'Релизный факт',
        subtitle: 'Год, место в топе или оценка Metacritic',
        body: gameFact,
        available: Boolean(gameFact),
      },
    ]
  }

  if (item.mode === 'music') {
    const topTracksHint = cropHintText(cleanHintText((item.topTracks ?? []).slice(0, 3).map((track) => track.title).join(', ')))
    const topAlbumsHint = cropHintText(cleanHintText((item.topAlbums ?? []).slice(0, 3).map((album) => album.title).join(', ')))
    const profileFact = cropHintText(cleanHintText([
      item.year ? `Начало карьеры: ${item.year}` : '',
      `Тип: ${musicTypeLabel(item.musicType)}`,
      `Сцена: ${musicOriginLabel(item.musicOrigin ?? null)}`,
      `Узнаваемость: ${musicTierLabel(item.gameTier ?? null)}`,
      item.votes?.gamesPlayed ? `Слушатели Last.fm: ${new Intl.NumberFormat('ru-RU').format(item.votes.gamesPlayed)}` : '',
    ].filter(Boolean).join(' · ')))

    return [
      {
        key: 'plot',
        title: 'Профайл',
        subtitle: 'Короткий профиль артиста',
        body: plot,
        available: Boolean(plot),
      },
      {
        key: 'slogan',
        title: 'Треки и альбомы',
        subtitle: 'Топовые релизы артиста',
        body: [topTracksHint, topAlbumsHint].filter(Boolean).join(' · '),
        available: Boolean(topTracksHint || topAlbumsHint),
      },
      {
        key: 'fact',
        title: 'Факт',
        subtitle: 'Дебют, тип и метрики популярности',
        body: profileFact,
        available: Boolean(profileFact),
      },
    ]
  }

  const mainCast = (item.cast ?? []).filter((person) => personName(person) !== 'Без имени').slice(0, 5)

  return [
    {
      key: 'plot',
      title: 'Сюжет',
      subtitle: 'Короткое описание истории',
      body: plot,
      available: Boolean(plot),
    },
    {
      key: 'slogan',
      title: 'Слоган',
      subtitle: 'Официальный рекламный слоган релиза',
      body: sloganHint,
      available: Boolean(sloganHint),
    },
    {
      key: 'cast_main',
      title: 'Актёрский состав',
      subtitle: 'Пять портретов из основного каста',
      people: mainCast,
      available: mainCast.length > 0,
    },
    {
      key: 'fact',
      title: 'Факт',
      subtitle: 'Интересный факт без спойлеров',
      body: fact,
      available: Boolean(fact),
    },
  ]
}

type MusicProgressiveHint = {
  step: number
  title: string
  body: string
}

const plotHintIntro = (text: string) => {
  const cleaned = cleanHintText(text)
  if (!cleaned) return ''
  const sentence = cleaned.split(/(?<=[.!?])\s+/).find(Boolean) ?? cleaned
  return cropHintText(sentence, 150)
}

const artistInitials = (name: string) => name
  .split(/\s+/)
  .filter(Boolean)
  .slice(0, 2)
  .map((part) => part[0])
  .join('')
  .toUpperCase()

const buildMusicProgressiveHints = (answer: TitleItem, attempts: Attempt[]): MusicProgressiveHint[] => {
  const attemptCount = attempts.length
  if (!attemptCount) return []
  const unlockedSteps = Math.min(10, attemptCount + 1)

  const latestAttempt = attempts[attempts.length - 1]
  const byKey = new Map((latestAttempt?.hints ?? []).map((hint) => [hint.key, hint]))
  const yearDirection = byKey.get('year')?.direction === 'up'
    ? 'направление года: позже'
    : byKey.get('year')?.direction === 'down'
      ? 'направление года: раньше'
      : 'направление года: совпало или неизвестно'

  const matchedGenres = (byKey.get('genres')?.matchedValues ?? []).filter(Boolean)
  const countries = (answer.countries ?? []).map(localizeMusicCountry).filter(Boolean)
  const decade = answer.year != null ? `${Math.floor(answer.year / 10) * 10}-е` : '—'
  const mainPlot = resolvePlotHintText(answer)
  const similarArtist = answer.similarArtists?.[0]?.name ?? ''
  const topAlbum = answer.topAlbums?.[0]?.title ?? ''
  const topTrack = answer.topTracks?.[0]?.title ?? ''
  const initials = artistInitials(answer.titleRu || answer.titleOriginal || '')

  const steps: MusicProgressiveHint[] = [
    {
      step: 1,
      title: 'Тип и направление года',
      body: `${musicTypeLabel(answer.musicType)} · ${yearDirection}`,
    },
    {
      step: 2,
      title: 'Страна',
      body: countries.length ? countries.join(', ') : 'Страна уточняется',
    },
    {
      step: 3,
      title: 'Совпавшие жанры',
      body: matchedGenres.length ? matchedGenres.join(', ') : 'Пока без пересечения по жанрам',
    },
    {
      step: 4,
      title: 'Статус и десятилетие',
      body: `${musicCareerStatusLabel(answer.musicIsActive)} · ${decade}`,
    },
    {
      step: 5,
      title: 'Первая часть профайла',
      body: plotHintIntro(mainPlot) || 'Пока нет описания',
    },
    {
      step: 6,
      title: 'Один похожий артист',
      body: similarArtist || 'Похожий артист не указан',
    },
    {
      step: 7,
      title: 'Топ-альбом',
      body: topAlbum || 'Топ-альбом не указан',
    },
    {
      step: 8,
      title: 'Топ-трек',
      body: topTrack || 'Топ-трек не указан',
    },
    {
      step: 9,
      title: 'Полный профайл и инициалы',
      body: `${cleanHintText(mainPlot) || 'Нет полного профайла'}${initials ? ` · Инициалы: ${initials}` : ''}`,
    },
    {
      step: 10,
      title: 'Последняя попытка',
      body: 'Финальный ход: используйте все накопленные подсказки.',
    },
  ]

  return steps.filter((hint) => hint.step <= unlockedSteps)
}

const dayNumber = (date: string) => {
  const start = Date.UTC(2026, 0, 1)
  const current = Date.parse(`${date}T00:00:00Z`)
  return Math.max(1, Math.floor((current - start) / 86_400_000) + 1)
}

const recordDailyCompletion = (mode: TitleMode, period: PeriodKey, date: string, won: boolean, attemptsCount: number, variant = ''): EconomyAward => {
  const sessionKey = completionSessionKey(mode, period, date, variant)
  const attendance = loadDailyAttendance(date)
  if (attendance.completedSessions.includes(sessionKey)) return emptyAward(loadAttendanceStats())

  const previousStats = loadAttendanceStats()
  const firstCompletionForDay = attendance.completedSessions.length === 0
  const nextAttendance: DailyAttendance = {
    ...attendance,
    completedModes: uniqueModes([...attendance.completedModes, mode]),
    wonModes: won ? uniqueModes([...attendance.wonModes, mode]) : attendance.wonModes,
    completedSessions: [...attendance.completedSessions, sessionKey],
    firstCompletedAt: attendance.firstCompletedAt || Date.now(),
    fullHouse: attendance.fullHouse || uniqueModes([...attendance.completedModes, mode]).length >= MODE_TABS.length,
  }

  let nextStats = previousStats
  if (firstCompletionForDay) {
    const distance = previousStats.lastCompletedDate ? dateDistance(previousStats.lastCompletedDate, date) : 0
    let nextStreak = previousStats.lastCompletedDate
      ? distance === 1
        ? previousStats.currentDailyStreak + 1
        : distance === 2 && previousStats.gracePasses > 0
          ? previousStats.currentDailyStreak + 1
          : 1
      : 1
    if (distance <= 0 && previousStats.lastCompletedDate) nextStreak = previousStats.currentDailyStreak
    const usedGrace = Boolean(previousStats.lastCompletedDate && distance === 2 && previousStats.gracePasses > 0)
    const earnedGrace = nextStreak > previousStats.currentDailyStreak && nextStreak % 7 === 0 ? 1 : 0
    nextStats = {
      ...previousStats,
      currentDailyStreak: nextStreak,
      bestDailyStreak: Math.max(previousStats.bestDailyStreak, nextStreak),
      lastCompletedDate: date,
      gracePasses: Math.min(2, Math.max(0, previousStats.gracePasses - (usedGrace ? 1 : 0)) + earnedGrace),
      totalActiveDays: previousStats.lastCompletedDate === date ? previousStats.totalActiveDays : previousStats.totalActiveDays + 1,
    }
  }
  if (!attendance.fullHouse && nextAttendance.fullHouse) {
    nextStats = { ...nextStats, fullHouseDays: nextStats.fullHouseDays + 1 }
  }

  const completed = 10
  const win = won ? 10 : 0
  const speed = won ? Math.max(0, 10 - attemptsCount) : 0
  const firstDaily = firstCompletionForDay ? 5 : 0
  const fullHouse = !attendance.fullHouse && nextAttendance.fullHouse ? 25 : 0
  const base = completed + win + speed + firstDaily + fullHouse
  const multiplier = firstCompletionForDay ? streakMultiplier(nextStats.currentDailyStreak) : 1
  const total = Math.round(base * multiplier)
  const wallet = loadWallet()
  const nextWallet = { tickets: wallet.tickets + total, lifetimeTickets: wallet.lifetimeTickets + total }
  saveWallet(nextWallet)
  addTicketLedgerEntry({
    type: 'earn',
    amount: total,
    balanceAfter: nextWallet.tickets,
    title: 'Сеанс завершён',
    detail: `${modeMeta(mode).daily}${variant && DIFFICULTIES[variant as DifficultyKey] ? ` · ${DIFFICULTIES[variant as DifficultyKey].label}` : ''} · ${won ? 'угадан' : 'ответ открыт'} · ${attemptsCount}/10`,
    date,
    mode,
    period,
  })
  saveDailyAttendance(nextAttendance)
  saveAttendanceStats(nextStats)

  return {
    total,
    base,
    multiplier,
    completed,
    win,
    speed,
    firstDaily,
    fullHouse,
    newDailyStreak: nextStats.currentDailyStreak,
    gracePasses: nextStats.gracePasses,
    alreadyClaimed: false,
  }
}

const Poster = ({ item, className = '' }: { item: TitleItem; className?: string }) => {
  const [failed, setFailed] = useState(false)
  const portraitSource = item.mode === 'music'
    ? [item.posterUrl, item.headerUrl, item.backdropUrl, ...(item.screenshots ?? [])].find((url) => canUseAsArtistPortrait(url ?? null)) ?? null
    : (item.posterUrl ?? null)
  const initials = artistInitials(item.titleRu || item.titleOriginal || '')

  return portraitSource && !failed
    ? <img className={className} src={portraitSource} alt={`Постер «${item.titleRu}»`} onError={() => setFailed(true)} />
    : <div className={`${className} poster-fallback`}>
      {item.mode === 'music'
        ? <>
            <Music2 />
            <span>{initials || '♪'}</span>
          </>
        : <>
            {item.mode !== 'diagnosis' ? modeIcon(item.mode) : null}
            <span>{item.titleRu}</span>
          </>}
    </div>
}

function BrandLogo({ className = '' }: { className?: string }) {
  return <picture className={className}>
    <source media="(max-width: 719px)" srcSet="./images/symbol.svg" />
    <img src="./images/logo.svg" alt="Сходится!" />
  </picture>
}

function ActionButton({ variant = 'primary', className = '', children, ...props }: ButtonHTMLAttributes<HTMLButtonElement> & {
  variant?: 'primary' | 'secondary' | 'ghost' | 'hint'
}) {
  return <button className={`ui-button ui-button--${variant} ${className}`.trim()} {...props}>{children}</button>
}

function GameSelector({ mode, onClick, compact = false }: { mode: TitleMode; onClick: () => void; compact?: boolean }) {
  return <button className={`game-selector ${compact ? 'game-selector--compact' : ''}`} onClick={onClick}>
    <span>{modeIcon(mode)}</span>
    <i>Тема</i>
    <strong>{modeMeta(mode).title}</strong>
    <ChevronRight />
  </button>
}

function PeriodControl({
  mode,
  value,
  onChange,
  onStartFreePlay,
  freePlayCostValue,
  freePlayShortage,
  freePlayLaunchesToday,
  wallet,
  unlockedPeriods,
  completedPeriods,
}: {
  mode: TitleMode
  value: PeriodKey
  onChange: (period: PeriodKey) => void
  onStartFreePlay: () => void
  freePlayCostValue: number
  freePlayShortage: number
  freePlayLaunchesToday: number
  wallet: Wallet
  unlockedPeriods: PeriodKey[]
  completedPeriods: PeriodKey[]
}) {
  const [open, setOpen] = useState(false)
  const wrapRef = useRef<HTMLDivElement | null>(null)
  const closePeriodMenu = useCallback(() => setOpen(false), [])
  const unlocked = new Set(unlockedPeriods)
  const completed = new Set(completedPeriods)
  const selectedLocked = !unlocked.has(value)
  const selectedCost = periodUnlockCost(value)
  const shortage = Math.max(0, selectedCost - wallet.tickets)
  const selectedUnlockable = selectedLocked && selectedCost > 0 && shortage === 0
  useDismissOnOutside(open, wrapRef, closePeriodMenu)

  return <div ref={wrapRef} className={`period-select-wrap ${open ? 'is-open' : ''}`}>
    <button type="button" className={`period-control period-control--custom ${selectedLocked ? 'is-locked' : ''} ${selectedUnlockable ? 'is-unlockable' : ''}`} onClick={(event) => {
      event.stopPropagation()
      setOpen((current) => !current)
    }} aria-expanded={open}>
      <span className="period-control__top">
        <span>Период</span>
        <strong><Ticket /> {wallet.tickets}</strong>
      </span>
      <span className="period-control__value">
        {selectedLocked && (selectedUnlockable ? <LockOpen /> : <Lock />)}
        <span>{PERIODS[value].label}</span>
        <ChevronRight />
      </span>
    </button>
    {open && <div className="period-menu" role="listbox" aria-label="Период">
      {PERIOD_UNLOCK_ORDER.map((periodKey) => {
        const isUnlocked = unlocked.has(periodKey)
        const isActive = value === periodKey
        const isMainSession = periodKey === 'all'
        const isCompleted = !isMainSession && completed.has(periodKey)
        const cost = periodUnlockCost(periodKey)
        const isUnlockable = !isUnlocked && cost > 0 && wallet.tickets >= cost
        const optionIcon = isMainSession
          ? <Target />
          : isCompleted
            ? <Check />
            : isUnlocked || isUnlockable
              ? <LockOpen />
              : <Lock />
        const optionDescription = isMainSession
          ? 'Главный сеанс'
          : isCompleted
            ? 'Пройден'
            : isUnlocked
              ? 'Открыт'
              : `${cost} билетов`
        return <button
          type="button"
          key={periodKey}
          className={`period-option ${isMainSession ? 'period-option--main' : ''} ${isActive ? 'active' : ''} ${isUnlocked ? 'unlocked' : isUnlockable ? 'unlockable' : 'locked'}`}
          onClick={(event) => {
            event.stopPropagation()
            trackMetrikaGoal('select_period', {
              mode,
              period: periodKey,
              unlocked: isUnlocked,
              unlockable: isUnlockable,
            })
            onChange(periodKey)
            setOpen(false)
          }}
          role="option"
          aria-selected={isActive}
        >
          <span className="period-option__lock">{optionIcon}</span>
          <span className="period-option__copy">
            <strong>{PERIODS[periodKey].label}</strong>
            <small>{optionDescription}</small>
          </span>
        </button>
      })}
      {(mode === 'movie' || mode === 'series' || mode === 'anime' || mode === 'music') && <button
        type="button"
        className={`period-option period-option--free-play ${freePlayShortage > 0 ? 'locked' : 'unlocked'}`}
        onClick={(event) => {
          event.stopPropagation()
          if (freePlayShortage > 0) return
          trackMetrikaGoal('open_free_play', {
            mode,
            cost: freePlayCostValue,
            launchesToday: freePlayLaunchesToday,
          })
          setOpen(false)
          onStartFreePlay()
        }}
        disabled={freePlayShortage > 0}
      >
        <span className="period-option__lock"><Sparkles /></span>
        <span className="period-option__copy">
          <strong>Свободная игра</strong>
          <small>{freePlayShortage > 0 ? `Не хватает ${formatTickets(freePlayShortage)}` : `${formatTickets(freePlayCostValue)} · запусков сегодня: ${freePlayLaunchesToday}`}</small>
        </span>
      </button>}
    </div>}
    <p className={`period-control__note ${selectedLocked ? 'is-warning' : ''}`}>
      {selectedLocked
        ? shortage > 0
          ? `Не хватает ${formatTickets(shortage)}. Период можно выбрать, но старт пока закрыт.`
          : `Период откроется за ${formatTickets(selectedCost)} при старте.`
        : 'Период открыт. Можно начинать сеанс.'}
    </p>
  </div>
}

function DifficultyControl({
  value,
  onChange,
  counts,
  onStartFreePlay,
  freePlayCostValue,
  freePlayShortage,
  freePlayLaunchesToday,
}: {
  value: DifficultyKey
  onChange: (difficulty: DifficultyKey) => void
  counts?: Record<DifficultyKey, number> | null
  onStartFreePlay: () => void
  freePlayCostValue: number
  freePlayShortage: number
  freePlayLaunchesToday: number
}) {
  const [open, setOpen] = useState(false)
  const wrapRef = useRef<HTMLDivElement | null>(null)
  const closeMenu = useCallback(() => setOpen(false), [])
  useDismissOnOutside(open, wrapRef, closeMenu)
  const current = DIFFICULTIES[value]

  return <div ref={wrapRef} className={`difficulty-select-wrap ${open ? 'is-open' : ''}`}>
    <button
      type="button"
      className="difficulty-trigger"
      onClick={(event) => {
        event.stopPropagation()
        setOpen((prev) => !prev)
      }}
      aria-expanded={open}
      aria-haspopup="listbox"
    >
      <span className="difficulty-trigger__label"><BarChart3 /> Сложность</span>
      <span className="difficulty-trigger__value">
        <span className={`difficulty-bars difficulty-bars--${value}`} aria-hidden="true"><i /><i /><i /></span>
        <strong>{current.label}</strong>
        <ChevronRight />
      </span>
    </button>
    {open && <div className="difficulty-menu" role="listbox" aria-label="Уровень сложности">
      <span className="difficulty-menu__head">Уровень сложности</span>
      {DIFFICULTY_ORDER.map((key) => {
        const meta = DIFFICULTIES[key]
        const isActive = value === key
        return <button
          type="button"
          key={key}
          role="option"
          aria-selected={isActive}
          className={`difficulty-option ${isActive ? 'active' : ''}`}
          onClick={(event) => {
            event.stopPropagation()
            trackMetrikaGoal('select_difficulty', { mode: 'music', difficulty: key })
            onChange(key)
            setOpen(false)
          }}
        >
          <span className={`difficulty-bars difficulty-bars--${key}`} aria-hidden="true"><i /><i /><i /></span>
          <span className="difficulty-option__copy">
            <strong>{meta.label}</strong>
            <small>{counts ? `${formatArtists(counts[key])} · ${meta.hint}` : meta.hint}</small>
          </span>
          {isActive && <Check className="difficulty-option__check" />}
        </button>
      })}
      <button
        type="button"
        className={`difficulty-option difficulty-option--free-play ${freePlayShortage > 0 ? 'locked' : ''}`}
        onClick={(event) => {
          event.stopPropagation()
          if (freePlayShortage > 0) return
          trackMetrikaGoal('open_free_play', { mode: 'music', cost: freePlayCostValue, launchesToday: freePlayLaunchesToday })
          setOpen(false)
          onStartFreePlay()
        }}
        disabled={freePlayShortage > 0}
      >
        <span className="difficulty-option__spark" aria-hidden="true"><Sparkles /></span>
        <span className="difficulty-option__copy">
          <strong>Свободная игра</strong>
          <small>{freePlayShortage > 0 ? `Не хватает ${formatTickets(freePlayShortage)}` : `${formatTickets(freePlayCostValue)} · запусков сегодня: ${freePlayLaunchesToday}`}</small>
        </span>
      </button>
    </div>}
  </div>
}

function AppHeader({ onHome, onArchive, onStats, onRules, onReview }: {
  onHome: () => void
  onArchive: () => void
  onStats: () => void
  onRules: () => void
  onReview: () => void
}) {
  const [economyOpen, setEconomyOpen] = useState(false)
  const wallet = loadWallet()
  const attendance = loadAttendanceStats()
  return <>
    <header className="app-header">
      <div className="app-header__inner">
        <button className="brand" aria-label="На главный экран" onClick={() => {
          trackMetrikaGoal('header_home_click')
          onHome()
        }}><BrandLogo /></button>
        <button className="header-economy" aria-label="Билеты и абонемент" onClick={() => {
          trackMetrikaGoal('open_economy_modal')
          setEconomyOpen(true)
        }}>
          <span><Ticket /> <strong>{wallet.tickets}</strong></span>
          <span><Trophy /> <strong>{attendance.currentDailyStreak}</strong><i>дн.</i></span>
        </button>
        <nav aria-label="Навигация">
          <button onClick={() => {
            trackMetrikaGoal('refresh_client')
            forceClientRefresh()
          }} aria-label="Получить обновления" title="Получить обновления"><RotateCcw /></button>
          <button onClick={() => {
            trackMetrikaGoal('open_rules')
            onRules()
          }} aria-label="Как играть"><CircleHelp /></button>
          <button onClick={() => {
            trackMetrikaGoal('open_archive')
            onArchive()
          }} aria-label="Архив"><Archive /></button>
          <button onClick={() => {
            trackMetrikaGoal('open_stats')
            onStats()
          }} aria-label="Статистика"><BarChart3 /></button>
        </nav>
      </div>
    </header>
    {economyOpen && <Modal title="Билеты" onClose={() => setEconomyOpen(false)}><EconomyView /></Modal>}
  </>
}

function HubScreen({ onSelect, onRewatch, onStats, onRules, onReview, onResume, activeSessionsCount, titleCounts, todayAttendance }: {
  onSelect: (mode: TitleMode) => void
  onRewatch: () => void
  onStats: () => void
  onRules: () => void
  onReview: () => void
  onResume: () => void
  activeSessionsCount: number
  titleCounts: { movie: number | null; series: number | null; anime: number | null; game: number | null; music: number | null; diagnosis: number | null }
  todayAttendance: DailyAttendance
}) {
  const futureCategories = [
    { title: 'Города', copy: 'Найдите город по его признакам', icon: <MapPin /> },
  ]
  const availableNowCount = MODE_TABS.length
  const scrollToGames = () => document.getElementById('available-games')?.scrollIntoView({ behavior: 'smooth', block: 'start' })

  return <>
    <AppHeader onHome={() => undefined} onArchive={onRewatch} onStats={onStats} onRules={onRules} onReview={onReview} />
    <main className="hub-screen">
      <section className="hub-hero">
        <div className="hub-hero__copy">
          <div className="hub-hero__facts" aria-label="Об игре">
            <span><CalendarDays /><strong>1 загадка в день</strong></span>
            <span><Target /><strong>10 попыток</strong></span>
          </div>
          <h1>Все сойдется!</h1>
          <p>Кино, сериалы, аниме, игры, города, музыка и диагнозы. Каждый день — новая загадка и 10 попыток, чтобы найти ответ по подсказкам.</p>
          <div className="hub-hero__actions">
            <ActionButton onClick={() => {
              trackMetrikaGoal('hub_scroll_to_games')
              scrollToGames()
            }}><Play /> Играть сейчас</ActionButton>
            {activeSessionsCount > 0
              ? <ActionButton variant="secondary" onClick={() => {
                trackMetrikaGoal('hub_resume_session', { activeSessionsCount })
                onResume()
              }}><RotateCcw /> {activeSessionsCount > 1 ? `Вернуться к игре (${activeSessionsCount})` : 'Вернуться к игре'}</ActionButton>
              : <ActionButton variant="secondary" onClick={() => {
                trackMetrikaGoal('hub_open_rules')
                onRules()
              }}><CircleHelp /> Как это работает</ActionButton>}
          </div>
        </div>
        <div className="hub-hero__visual" aria-hidden="true">
          <img src="./images/hero.webp" alt="" />
        </div>
      </section>

      <section className="category-section" id="available-games">
        <div className="category-heading"><span>Доступно сейчас</span><small>{String(availableNowCount).padStart(2, '0')} игры</small></div>
        <div className="category-grid category-grid--active">
          <button className="category-card category-card--movie" onClick={() => onSelect('movie')}>
            <span className="category-card__grain" aria-hidden="true" />
            <div className="category-card__head">
              <span className="category-card__icon"><Film /></span>
              <span className="category-card__pool"><b>{titleCounts.movie ?? '—'}</b> в пуле</span>
            </div>
            <i>{todayAttendance.completedModes.includes('movie') ? 'Штамп получен' : 'Ежедневная игра'}</i><h2>Кино</h2>
            <p>Угадайте фильм по актёрам, жанрам, году и рейтингам.</p>
            <strong>Играть <ChevronRight /></strong>
          </button>
          <button className="category-card category-card--series" onClick={() => onSelect('series')}>
            <span className="category-card__grain" aria-hidden="true" />
            <div className="category-card__head">
              <span className="category-card__icon"><Tv /></span>
              <span className="category-card__pool"><b>{titleCounts.series ?? '—'}</b> в пуле</span>
            </div>
            <i>{todayAttendance.completedModes.includes('series') ? 'Штамп получен' : 'Ежедневная игра'}</i><h2>Сериалы</h2>
            <p>Найдите сериал, сравнивая создателей, каст и периоды.</p>
            <strong>Играть <ChevronRight /></strong>
          </button>
          <button className="category-card category-card--anime" onClick={() => onSelect('anime')}>
            <span className="category-card__grain" aria-hidden="true" />
            <div className="category-card__head">
              <span className="category-card__icon"><Sparkles /></span>
              <span className="category-card__pool"><b>{titleCounts.anime ?? '—'}</b> в пуле</span>
            </div>
            <i>{todayAttendance.completedModes.includes('anime') ? 'Штамп получен' : 'Ежедневная игра'}</i><h2>Аниме</h2>
            <p>Угадайте аниме по формату, эпизодам, студии, сэйю и рангу в популярности.</p>
            <strong>Играть <ChevronRight /></strong>
          </button>
          <button className="category-card category-card--game" onClick={() => onSelect('game')}>
            <span className="category-card__grain" aria-hidden="true" />
            <div className="category-card__head">
              <span className="category-card__icon"><Gamepad2 /></span>
              <span className="category-card__pool"><b>{titleCounts.game ?? '—'}</b> в пуле</span>
            </div>
            <i>{todayAttendance.completedModes.includes('game') ? 'Штамп получен' : 'Ежедневная игра'}</i><h2>Игры</h2>
            <p>Угадайте игру по жанрам, рейтингу, месту в топе и метрикам Steam.</p>
            <strong>Играть <ChevronRight /></strong>
          </button>
          <button className="category-card category-card--music" onClick={() => onSelect('music')}>
            <span className="category-card__grain" aria-hidden="true" />
            <div className="category-card__head">
              <span className="category-card__icon"><Music2 /></span>
              <span className="category-card__pool"><b>{titleCounts.music ?? '—'}</b> в пуле</span>
            </div>
            <i>{todayAttendance.completedModes.includes('music') ? 'Штамп получен' : 'Ежедневная игра'}</i><h2>Музыка</h2>
            <p>Угадайте артиста по жанрам, связям, топ-трекам и метрикам Last.fm.</p>
            <strong>Играть <ChevronRight /></strong>
          </button>
          <button className="category-card category-card--diagnosis" onClick={() => onSelect('diagnosis')}>
            <span className="category-card__grain" aria-hidden="true" />
            <div className="category-card__head">
              <span className="category-card__icon"><Stethoscope /></span>
              <span className="category-card__pool"><b>{titleCounts.diagnosis ?? '—'}</b> в пуле</span>
            </div>
            <i>{todayAttendance.completedModes.includes('diagnosis') ? 'Штамп получен' : 'Ежедневная игра'}</i><h2>Диагнозы</h2>
            <p>Угадайте диагноз по симптомам, системе, факторам риска и МКБ-подсказкам.</p>
            <strong>Играть <ChevronRight /></strong>
          </button>
        </div>
      </section>

      <section className="category-section category-section--future">
        <div className="category-heading"><span>Следующие темы</span><small>в разработке</small></div>
        <div className="category-grid category-grid--future">
          {futureCategories.map((category) => <article className="category-card category-card--locked" key={category.title}>
            <span className="category-card__icon">{category.icon}</span><span className="category-card__lock"><Lock /> Скоро</span>
            <h3>{category.title}</h3><p>{category.copy}</p>
          </article>)}
        </div>
      </section>
    </main>
  </>
}

function TitleScreen({ mode, period, setPeriod, date, onHome, onBack, onPlay, onRewatch, onStats, onRules, onReview, isLeaving, onReadAnamnesis, hasAnamnesis, wallet, unlockedPeriods, completedPeriods, onUnlockPeriod, onStartFreePlay, freePlayCostValue, freePlayShortage, freePlayLaunchesToday, difficulty, setDifficulty, difficultyCounts }: {
  mode: TitleMode
  period: PeriodKey
  setPeriod: (period: PeriodKey) => void
  date: string
  onHome: () => void
  onBack: () => void
  onPlay: () => void
  onRewatch: () => void
  onStats: () => void
  onRules: () => void
  onReview: () => void
  isLeaving?: boolean
  onReadAnamnesis: () => void
  hasAnamnesis: boolean
  wallet: Wallet
  unlockedPeriods: PeriodKey[]
  completedPeriods: PeriodKey[]
  onUnlockPeriod: (period: PeriodKey) => boolean
  onStartFreePlay: () => void
  freePlayCostValue: number
  freePlayShortage: number
  freePlayLaunchesToday: number
  difficulty: DifficultyKey
  setDifficulty: (difficulty: DifficultyKey) => void
  difficultyCounts: Record<DifficultyKey, number> | null
}) {
  const periodLocked = canUnlockPeriods(mode) && !unlockedPeriods.includes(period)
  const periodCost = periodUnlockCost(period)
  const periodShortage = periodLocked ? Math.max(0, periodCost - wallet.tickets) : 0
  const canStart = !periodLocked || periodShortage === 0
  const playButtonLabel = periodLocked
    ? periodShortage > 0
      ? `Не хватает ${formatTickets(periodShortage)}`
      : `Открыть за ${formatTickets(periodCost)}`
    : 'Начать игру'
  const startSelectedPeriod = () => {
    if (!canStart) return
    if (periodLocked && !onUnlockPeriod(period)) return
    onPlay()
  }

  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.defaultPrevented) return
      if (event.key === 'Escape') {
        event.preventDefault()
        onBack()
        return
      }
      if (event.key === 'Enter') {
        event.preventDefault()
        startSelectedPeriod()
      }
    }
    window.addEventListener('keydown', onKeyDown)
    return () => window.removeEventListener('keydown', onKeyDown)
  }, [onBack, startSelectedPeriod])

  return <>
    <AppHeader onHome={onHome} onArchive={onRewatch} onStats={onStats} onRules={onRules} onReview={onReview} />
    <main className={`title-screen ${isLeaving ? 'is-leaving' : ''}`}>
      <div className="screen-back-row">
        <button className="screen-back" onClick={() => {
          trackMetrikaGoal('title_back_click', { mode })
          onBack()
        }} aria-label="Назад"><ChevronLeft /></button>
        <span className="keycap-hint" aria-hidden="true">Esc</span>
      </div>
      <section className="title-stage">
        <div className="title-game-mark">
          <span>{modeIcon(mode)}</span>
          <i>Игра дня · №{dayNumber(date)}</i>
          <h1>{modeMeta(mode).title}</h1>
        </div>
        <time>{prettyDate(date)} · {new Date(`${date}T12:00:00+03:00`).getFullYear()}</time>
        <p>Угадайте {modeMeta(mode).subject} дня за десять попыток</p>
        {mode === 'diagnosis'
          ? <section className="med-chart">
              <div className="med-chart__stub">
                <span className="med-chart__cross" aria-hidden="true"><i /><i /></span>
                <span>ПРИЁМ</span><strong>ОТКРЫТ</strong><small>Карта № {dayNumber(date)}</small><em>{date.slice(8, 10)}.{date.slice(5, 7)}</em>
                <svg className="med-chart__pulse" viewBox="0 0 120 28" preserveAspectRatio="none" aria-hidden="true">
                  <path d="M0 14 H30 L37 14 L42 4 L49 24 L55 14 L61 9 L66 14 H120" fill="none" stroke="currentColor" strokeWidth="2" strokeLinejoin="round" strokeLinecap="round" />
                </svg>
              </div>
              <div className="med-chart__body">
                <div className="med-chart__kicker"><span>Амбулаторная карта</span><i /> <small>анонимный пациент</small></div>
                <h1>Ежедневная игра: диагнозы</h1>
                <p>Каждый день — новый пациент с набором симптомов. У вас есть <strong>10 попыток</strong>, чтобы поставить верный диагноз по признакам.</p>
                {hasAnamnesis && <button type="button" className="med-chart__anamnesis" onClick={onReadAnamnesis}>
                  <span className="med-chart__anamnesis-portrait" aria-hidden="true"><UserRound /></span>
                  <span className="med-chart__anamnesis-copy"><strong>Прочитать анамнез</strong><small>С чем пациент пришёл на приём</small></span>
                  <ChevronRight aria-hidden="true" />
                </button>}
              </div>
            </section>
          : mode === 'game'
            ? <section className="game-case">
                <div className="game-case__spine" aria-hidden="true"><span>Сходится · Игры</span></div>
                <div className="game-case__body">
                  <div className="game-case__band">
                    <span className="game-case__platform">PC</span>
                    <span className="game-case__band-title">Игра дня</span>
                    <span className="game-case__band-no">№ {dayNumber(date)}</span>
                  </div>
                  <div className="game-case__cover">
                    <span className="game-case__disc cd disc" aria-hidden="true"><i /></span>
                    <div className="game-case__info">
                      <div className="game-case__kicker"><span>Ежедневный релиз</span><i /> <small>глобальный чарт</small></div>
                      <h1>Ежедневная игра: игры</h1>
                      <p>Каждый день — новая игра из мирового чарта. У вас есть <strong>10 попыток</strong>, чтобы узнать её по жанрам, студии и рейтингам.</p>
                    </div>
                  </div>
                  <div className="game-case__actions">
                    <ActionButton className="game-case__play" onClick={onPlay}><Play /> Начать игру <span className="keycap-hint keycap-hint--inline" aria-hidden="true">Enter</span></ActionButton>
                  </div>
                </div>
              </section>
          : mode === 'music'
            ? <section className="concert-ticket">
                <div className="concert-ticket__main">
                  <div className="concert-ticket__head">
                    <div className="concert-ticket__brand">
                      <span className="concert-ticket__kicker"><Music2 /> Концерт дня</span>
                      <h1>Артист дня</h1>
                      <p className="concert-ticket__venue">Главная сцена · сеанс №{dayNumber(date)}</p>
                    </div>
                    <div className="concert-ticket__when">
                      <strong>{date.slice(8, 10)}.{date.slice(5, 7)}</strong>
                      <small>21:45</small>
                    </div>
                  </div>
                  <p className="concert-ticket__lead">Каждый ответ сравнит страну, эпоху, формат и жанры. По мере попыток откроются история артиста, похожие исполнители, альбом и главный хит.</p>
                  <div className="concert-ticket__meta" aria-hidden="true">
                    <span><i>GATE</i><b>10</b></span>
                    <span><i>SEAT</i><b>A15</b></span>
                    <span><i>ROW</i><b>07</b></span>
                  </div>
                  <div className="concert-ticket__barcode" aria-hidden="true" />
                </div>
                <div className="concert-ticket__stub" aria-hidden="true">
                  <span className="concert-ticket__stub-kicker">Концерт дня</span>
                  <strong>Артист дня</strong>
                  <small>Главная сцена</small>
                  <em>{date.slice(8, 10)}.{date.slice(5, 7)} · 21:45</em>
                  <span className="concert-ticket__stub-no">№ {dayNumber(date)}</span>
                  <div className="concert-ticket__barcode concert-ticket__barcode--v" />
                </div>
              </section>
          : <section className="admit-ticket">
              <div className="admit-ticket__stub">
                <span>ВХОД</span><strong>ОДИН</strong><small>№ {dayNumber(date)}</small><em>{date.slice(8,10)}.{date.slice(5,7)}</em><i />
              </div>
              <div className="admit-ticket__body">
                <div className="ticket-kicker"><span>Ежедневная премьера</span><i /> <small>полночный сеанс</small></div>
                <h1>Ежедневная игра: {modeMeta(mode).lower}</h1>
                <p>Каждый день доступна новая загадка. У вас есть <strong>10 попыток</strong>, а каждый ответ открывает сравнительные подсказки.</p>
                <div className="ticket-settings">
                  <PeriodControl mode={mode} value={period} onChange={setPeriod} onStartFreePlay={onStartFreePlay} freePlayCostValue={freePlayCostValue} freePlayShortage={freePlayShortage} freePlayLaunchesToday={freePlayLaunchesToday} wallet={wallet} unlockedPeriods={unlockedPeriods} completedPeriods={completedPeriods} />
                </div>
              </div>
            </section>}
        {mode === 'music'
          ? <div className="title-play-row">
              <ActionButton className={`play-button ${!canStart ? 'is-disabled' : ''}`} onClick={startSelectedPeriod} disabled={!canStart}><Play /> {playButtonLabel} {canStart && <span className="keycap-hint keycap-hint--inline" aria-hidden="true">Enter</span>}</ActionButton>
              <DifficultyControl value={difficulty} onChange={setDifficulty} counts={difficultyCounts} onStartFreePlay={onStartFreePlay} freePlayCostValue={freePlayCostValue} freePlayShortage={freePlayShortage} freePlayLaunchesToday={freePlayLaunchesToday} />
            </div>
          : mode !== 'game' && <ActionButton className={`play-button ${!canStart ? 'is-disabled' : ''}`} onClick={startSelectedPeriod} disabled={!canStart}><Play /> {playButtonLabel} {canStart && <span className="keycap-hint keycap-hint--inline" aria-hidden="true">Enter</span>}</ActionButton>}
      </section>
    </main>
  </>
}

function RewatchScreen({ mode, setMode, period, dates, games, onOpen, onHome, onStats, onRules, onReview }: {
  mode: TitleMode
  setMode: (mode: TitleMode) => void
  period: PeriodKey
  dates: string[]
  games: SavedGame[]
  onOpen: (date: string, game: SavedGame | null) => void
  onHome: () => void
  onStats: () => void
  onRules: () => void
  onReview: () => void
}) {
  const latestByUpdatedAt = (items: SavedGame[]): SavedGame | null => {
    if (!items.length) return null
    return items.reduce((best, current) => current.updatedAt > best.updatedAt ? current : best)
  }

  return <>
    <AppHeader onHome={onHome} onArchive={() => undefined} onStats={onStats} onRules={onRules} onReview={onReview} />
    <main className="rewatch-screen">
      <div className="rewatch-heading"><RotateCcw /><h1>Архив</h1><p>История по всем режимам: сегодня и шесть предыдущих дней.</p></div>
      <div className="rewatch-toolbar">
        <div className="mode-tabs">{MODE_TABS.map((tabMode) => (
          <button className={mode === tabMode ? 'active' : ''} key={tabMode} onClick={() => setMode(tabMode)}>{modeMeta(tabMode).plural}</button>
        ))}</div>
      </div>
      <section className="rewatch-grid">{dates.map((itemDate, index) => {
        const dayGames = games.filter((game) => game.date === itemDate && game.mode === mode)
        const playedInCurrentPeriod = dayGames.find((game) => game.period === period)
        const played = playedInCurrentPeriod ?? latestByUpdatedAt(dayGames)
        return <button className={`rewatch-item ${played?.status ?? ''}`} key={itemDate} onClick={() => onOpen(itemDate, played)}>
          <div className="rewatch-poster"><span>#{dayNumber(itemDate)}</span><i>{played?.status === 'won' ? `${played.attempts.length}/10` : played?.status === 'lost' ? '×' : ''}</i></div>
          <strong>{index === 0 ? 'Сегодня' : index === 1 ? 'Вчера' : prettyDate(itemDate)}</strong>
          <small>{played
            ? `${played.status === 'won' ? 'Угадан' : played.status === 'lost' ? 'Не угадан' : 'В процессе'}${played.mode === 'movie' || played.mode === 'series' || played.mode === 'anime' || played.mode === 'music' ? ` · ${PERIODS[played.period].short}` : ''}`
            : 'Не сыгран'}</small>
        </button>
      })}</section>
      <ActionButton variant="secondary" className="back-to-premiere" onClick={onHome}>На главный экран</ActionButton>
    </main>
  </>
}

type MusicReviewEntry = {
  item: TitleItem
  reasons: string[]
  conflictReasons: string[]
  doubtReasons: string[]
  serviceReasons: string[]
  conflictPairs: ConflictPair[]
  missingFields: string[]
  approvedAt: number | null
}

function MusicReviewScreen({ onHome, onBack, onRewatch, onStats, onRules, onReview }: {
  onHome: () => void
  onBack: () => void
  onRewatch: () => void
  onStats: () => void
  onRules: () => void
  onReview: () => void
}) {
  const [items, setItems] = useState<TitleItem[]>([])
  const [loadingList, setLoadingList] = useState(true)
  const [loadError, setLoadError] = useState<string | null>(null)
  const [showServiceReasons, setShowServiceReasons] = useState(false)
  const [showApproved, setShowApproved] = useState(true)
  const [conflictsOnly, setConflictsOnly] = useState(false)
  const [activeIndex, setActiveIndex] = useState(0)
  const [approvals, setApprovals] = useState<Record<string, number>>(() => loadMusicReviewApprovals())
  const [conflictChoices, setConflictChoices] = useState<MusicReviewConflictChoices>(() => loadMusicReviewConflictChoices())
  const [normalizedById, setNormalizedById] = useState<Record<string, MusicNormalizedEvidence>>({})

  useEffect(() => {
    let disposed = false
    setLoadingList(true)
    setLoadError(null)

    fetch('./data/music.generated.json', { cache: 'no-store' })
      .then(async (response) => {
        if (!response.ok) throw new Error(`HTTP ${response.status}`)
        return response.json() as Promise<TitleItem[]>
      })
      .then((payload) => {
        if (disposed) return
        setItems(Array.isArray(payload) ? payload : [])
      })
      .catch((error: unknown) => {
        if (disposed) return
        const message = error instanceof Error ? error.message : String(error)
        setLoadError(message)
      })
      .finally(() => {
        if (!disposed) setLoadingList(false)
      })

    return () => { disposed = true }
  }, [])

  useEffect(() => {
    let disposed = false
    const fallbackEvidencePath = './data/music/normalized/music_artists_enriched_first500_merged_retry_batched.json'

    const resolveEvidencePath = async () => {
      try {
        const response = await fetch('./data/source.json', { cache: 'no-store' })
        if (!response.ok) return fallbackEvidencePath
        const sourceMeta = await response.json() as { musicSource?: unknown }
        const candidate = typeof sourceMeta?.musicSource === 'string' ? sourceMeta.musicSource.trim().replace(/^\/+/, '') : ''
        return candidate ? `./${candidate}` : fallbackEvidencePath
      } catch {
        return fallbackEvidencePath
      }
    }

    resolveEvidencePath()
      .then((evidencePath) => fetch(evidencePath, { cache: 'no-store' }))
      .then(async (response) => {
        if (!response.ok) throw new Error(`HTTP ${response.status}`)
        return response.json() as Promise<{ items?: unknown[] }>
      })
      .then((payload) => {
        if (disposed) return
        const list = Array.isArray(payload?.items) ? payload.items : []
        const map: Record<string, MusicNormalizedEvidence> = {}
        for (const raw of list) {
          const row = asRecord(raw)
          if (!row) continue
          const artistKey = typeof row.artistKey === 'string' ? row.artistKey.trim() : ''
          let normalizedId = artistKey ? `music:${artistKey}` : ''

          if (!normalizedId) {
            const input = asRecord(row.input)
            const artist = typeof input?.artist === 'string' ? input.artist.trim() : ''
            const position = Math.trunc(Number(input?.position))
            if (!artist || !Number.isFinite(position)) continue
            normalizedId = `music:${String(position).padStart(3, '0')}_${artist.toLocaleLowerCase('en-US').replace(/[^a-z0-9]+/g, '').slice(0, 24)}`
          }

          map[normalizedId] = { sourceEvidence: asRecord(row.sourceEvidence) as Partial<Record<ConflictEvidenceField, unknown>> | undefined }
        }
        setNormalizedById(map)
      })
      .catch(() => {
        if (!disposed) setNormalizedById({})
      })

    return () => { disposed = true }
  }, [])

  const entries = useMemo<MusicReviewEntry[]>(() => {
    const list: MusicReviewEntry[] = []
    for (const item of items) {
      const notes = uniqueReviewReasons(Array.isArray(item.notes) ? item.notes : [])
      const reasons = notes.filter((reason) => showServiceReasons || !SERVICE_REVIEW_REASONS.has(reason))
      if (!reasons.length) continue

      const conflictReasons = reasons.filter((reason) => reason.startsWith('conflict_'))
      const serviceReasons = reasons.filter((reason) => SERVICE_REVIEW_REASONS.has(reason))
      const doubtReasons = reasons.filter((reason) => !reason.startsWith('conflict_') && !SERVICE_REVIEW_REASONS.has(reason))
      if (conflictsOnly && !conflictReasons.length) continue

      const conflictPairs = toConflictPairs(conflictReasons, normalizedById[item.id] ?? null)

      const approvedAt = approvals[item.id] ?? null
      if (!showApproved && approvedAt != null) continue

      list.push({
        item,
        reasons,
        conflictReasons,
        doubtReasons,
        serviceReasons,
        conflictPairs,
        missingFields: Array.isArray(item.dataQuality?.missingFields) ? item.dataQuality.missingFields : [],
        approvedAt,
      })
    }

    list.sort((a, b) => {
      const tierOrder = ['core', 'popular', 'niche', 'discovery', 'experimental']
      const aTier = tierOrder.indexOf(String(a.item.gameTier ?? '').toLocaleLowerCase('en-US'))
      const bTier = tierOrder.indexOf(String(b.item.gameTier ?? '').toLocaleLowerCase('en-US'))
      const aTierSafe = aTier === -1 ? Number.MAX_SAFE_INTEGER : aTier
      const bTierSafe = bTier === -1 ? Number.MAX_SAFE_INTEGER : bTier
      if (aTierSafe !== bTierSafe) return aTierSafe - bTierSafe
      return a.item.titleRu.localeCompare(b.item.titleRu, 'ru-RU')
    })

    return list
  }, [items, showServiceReasons, showApproved, conflictsOnly, approvals, normalizedById])

  useEffect(() => {
    setActiveIndex((current) => {
      if (!entries.length) return 0
      return Math.min(current, entries.length - 1)
    })
  }, [entries.length])

  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if (isEditableTarget(event.target)) return
      if (!entries.length) return
      if (event.key === 'ArrowLeft') {
        event.preventDefault()
        setActiveIndex((current) => Math.max(0, current - 1))
        return
      }
      if (event.key === 'ArrowRight') {
        event.preventDefault()
        setActiveIndex((current) => Math.min(entries.length - 1, current + 1))
      }
    }

    window.addEventListener('keydown', onKeyDown)
    return () => window.removeEventListener('keydown', onKeyDown)
  }, [entries.length])

  const current = entries[activeIndex] ?? null
  const approvedCount = entries.filter((entry) => entry.approvedAt != null).length
  const conflictCount = entries.filter((entry) => entry.conflictReasons.length > 0).length

  const setApproval = (id: string, approved: boolean) => {
    const next = setMusicReviewApproval(id, approved)
    setApprovals(next)
  }

  const chooseConflictOption = (
    itemId: string,
    pair: ConflictPair,
    option: MusicReviewConflictOption,
  ) => {
    const selectedValue = option === 'A' ? pair.optionA.value : pair.optionB.value
    const next = setMusicReviewConflictChoice(itemId, pair.field, option, selectedValue)
    setConflictChoices(next)
  }

  return <>
    <AppHeader onHome={onHome} onArchive={onRewatch} onStats={onStats} onRules={onRules} onReview={onReview} />
    <main className="review-screen">
      <div className="screen-back-row">
        <button className="screen-back" onClick={onBack} aria-label="Назад"><ChevronLeft /></button>
        <span className="keycap-hint" aria-hidden="true">Esc</span>
      </div>

      <section className="review-heading">
        <span><NotebookText /> Модерация музыки</span>
        <h1>Сомнительные и конфликтные карточки</h1>
        <p>Листайте карточки, проверяйте причины и помечайте записи как одобренные.</p>
      </section>

      <section className="review-toolbar">
        <button className={showServiceReasons ? 'active' : ''} onClick={() => setShowServiceReasons((currentValue) => !currentValue)}>
          {showServiceReasons ? <Check /> : <X />} Служебные причины
        </button>
        <button className={conflictsOnly ? 'active' : ''} onClick={() => setConflictsOnly((currentValue) => !currentValue)}>
          {conflictsOnly ? <Check /> : <X />} Только конфликты
        </button>
        <button className={!showApproved ? 'active' : ''} onClick={() => setShowApproved((currentValue) => !currentValue)}>
          {!showApproved ? <Check /> : <X />} Скрыть одобренные
        </button>
      </section>

      <section className="review-stats">
        <article><small>Всего в ревью</small><strong>{entries.length}</strong></article>
        <article className="is-conflict"><small>С конфликтом</small><strong>{conflictCount}</strong></article>
        <article><small>Одобрено</small><strong>{approvedCount}</strong></article>
        <article><small>Осталось</small><strong>{Math.max(0, entries.length - approvedCount)}</strong></article>
      </section>

      {loadingList && <section className="review-empty"><Sparkles /> Загружаем карточки модерации…</section>}
      {!loadingList && loadError && <section className="review-empty review-empty--error">Ошибка загрузки: {loadError}</section>}
      {!loadingList && !loadError && !entries.length && <section className="review-empty">Нет карточек по выбранным фильтрам.</section>}

      {!loadingList && !loadError && current && <section className={`review-card ${current.conflictReasons.length ? 'has-conflict' : ''}`}>
        <div className="review-card__head">
          <span className="review-card__number">{String(activeIndex + 1).padStart(3, '0')}</span>
          <Poster item={current.item} className="review-card__poster" />
          <div className="review-card__identity">
            <span className="attempt-label">Уровень: {musicTierLabel(current.item.gameTier ?? null)}</span>
            <h2>{current.item.titleRu}</h2>
            <p className="gm-head__sub">
              <span className="gm-head__orig">{current.item.titleOriginal || 'Оригинальное название не указано'}</span>
              {current.item.year != null && <><i className="gm-head__dot" aria-hidden="true">·</i><span className="gm-year">{current.item.year}</span></>}
              {current.item.countries?.[0] && <><i className="gm-head__dot" aria-hidden="true">·</i><span className="gm-year">{current.item.countries[0]}</span></>}
            </p>
            {!!current.item.genres?.length && <div className="gm-genres">{current.item.genres.slice(0, 6).map((genre) => <span key={genre} className="gm-genre">{genre}</span>)}</div>}
          </div>
          <div className={`review-approval-badge ${current.approvedAt != null ? 'is-approved' : ''}`}>
            <small>Статус</small>
            <strong>{current.approvedAt != null ? 'Одобрено' : 'На проверке'}</strong>
          </div>
        </div>

        {!!current.conflictReasons.length && <div className="review-conflict-banner" role="status" aria-live="polite">
          <strong><AlertTriangle /> Конфликт данных</strong>
          <span>{current.conflictReasons.map(reviewReasonLabel).join(' • ')}</span>
        </div>}

        <div className="review-reasons">
          {[...current.conflictReasons, ...current.doubtReasons, ...current.serviceReasons]
            .map((reason) => <span key={reason} className={`review-reason review-reason--${reviewReasonTone(reason)}`}>{reviewReasonLabel(reason)}</span>)}
        </div>

        {!!current.conflictPairs.length && <section className="review-conflict-chooser">
          <h3>Выберите верный вариант по конфликту</h3>
          <div className="review-conflict-list">
            {current.conflictPairs.map((pair) => {
              const selected = conflictChoices[current.item.id]?.[pair.field]
              const isASelected = selected?.option === 'A' && selected.value === pair.optionA.value
              const isBSelected = selected?.option === 'B' && selected.value === pair.optionB.value
              return <article className="review-conflict-item" key={`${current.item.id}-${pair.field}`}>
                <header>
                  <small>{pair.fieldLabel}</small>
                  <strong>{reviewReasonLabel(pair.reason)}</strong>
                </header>
                <div className="review-conflict-item__options">
                  <button className={isASelected ? 'is-selected option-a' : 'option-a'} onClick={() => chooseConflictOption(current.item.id, pair, 'A')}>
                    <span>Вариант A</span>
                    <strong>{pair.optionA.value}</strong>
                    <small>{pair.optionA.sources.join(', ') || 'источник не указан'}</small>
                  </button>
                  <button className={isBSelected ? 'is-selected option-b' : 'option-b'} onClick={() => chooseConflictOption(current.item.id, pair, 'B')}>
                    <span>Вариант B</span>
                    <strong>{pair.optionB.value}</strong>
                    <small>{pair.optionB.sources.join(', ') || 'источник не указан'}</small>
                  </button>
                </div>
                <p>
                  {selected
                    ? `Выбрано: вариант ${selected.option} (${selected.value})`
                    : 'Вариант еще не выбран'}
                </p>
              </article>
            })}
          </div>
        </section>}

        {!!current.missingFields.length && <div className="review-missing">
          <small>Неполные игровые поля</small>
          <strong>{current.missingFields.join(', ')}</strong>
        </div>}

        <div className="review-card__meta">
          <span><small>Тип артиста</small><strong>{musicTypeLabel(current.item.musicType)}</strong></span>
          <span><small>Статус</small><strong>{musicCareerStatusLabel(current.item.musicIsActive)}</strong></span>
          <span><small>Топ-трек</small><strong>{current.item.topTracks?.[0]?.title || '—'}</strong></span>
          <span><small>Топ-альбом</small><strong>{current.item.topAlbums?.[0]?.title || '—'}</strong></span>
        </div>

        <details className="review-details">
          <summary>Сырые данные карточки (JSON)</summary>
          <pre>{JSON.stringify({
            id: current.item.id,
            notes: current.item.notes,
            dataQuality: current.item.dataQuality,
            topTracks: current.item.topTracks,
            topAlbums: current.item.topAlbums,
            similarArtists: current.item.similarArtists,
          }, null, 2)}</pre>
        </details>

        <div className="review-card__actions">
          <button onClick={() => setActiveIndex((currentValue) => Math.max(0, currentValue - 1))} disabled={activeIndex === 0}><ChevronLeft /> Предыдущая</button>
          {current.approvedAt == null
            ? <button className="approve" onClick={() => setApproval(current.item.id, true)}><Check /> Одобрить</button>
            : <button className="revoke" onClick={() => setApproval(current.item.id, false)}><X /> Снять одобрение</button>}
          <button onClick={() => setActiveIndex((currentValue) => Math.min(entries.length - 1, currentValue + 1))} disabled={activeIndex >= entries.length - 1}>Следующая <ChevronRight /></button>
        </div>
      </section>}
    </main>
  </>
}

function PersonPortrait({ person }: { person: HintPerson }) {
  const [failed, setFailed] = useState(false)
  const name = person.nameRu || person.nameOriginal || 'Нет данных'
  const initials = name.split(/\s+/).slice(0, 2).map((part) => part[0]).join('').toUpperCase()
  return <div className={`hint-person ${person.matched ? 'matched' : ''}`}>
    <div className="hint-person__portrait">
      {person.photoUrl && !failed
        ? <img src={person.photoUrl} alt={name} onError={() => setFailed(true)} />
        : <span>{initials || '—'}</span>}
    </div>
    <strong>{name}</strong>
  </div>
}

function ClueTile({ hint, delay }: { hint: Attempt['hints'][number]; delay: number }) {
  const genreTiles = hint.key === 'genres' ? hint.value.split(',').map((genre) => genre.trim()).filter(Boolean) : []
  return <div className={`clue-tile ${hint.status} clue-${hint.key}`} style={{ animationDelay: `${delay * 30}ms` }}>
    <div className="clue-tile__top">
      <span>{hint.label}</span>
      {hint.direction === 'up' ? <ArrowUp /> : hint.direction === 'down' ? <ArrowDown /> : hint.status === 'match' ? <Check /> : null}
    </div>
    {genreTiles.length
      ? <div className="clue-genre-list">{genreTiles.map((genre) => <span key={genre}>{genre}</span>)}</div>
      : <strong>{hint.value}</strong>}
  </div>
}

function DxSystemIcons({ hint }: { hint: Attempt['hints'][number] }) {
  const systems = splitHintValues(hint.value)
  if (!systems.length) return null

  const matched = new Set((hint.matchedValues ?? []).map(normalizeSystemKey))
  const matchedCount = systems.filter((value) => matched.has(normalizeSystemKey(value))).length
  const countTone = hint.status === 'match' ? 'match' : matchedCount ? 'partial' : 'miss'

  return <section className="dx-systems" aria-label={`Совпадение систем: ${matchedCount} из ${systems.length}`}>
    <div className="dx-systems__head">
      <span>{hint.label}</span>
      <small className={countTone}>{matchedCount}/{systems.length}</small>
    </div>
    <div className="dx-systems__list">
      {systems.map((system, index) => {
        const key = normalizeSystemKey(system)
        const icon = diagnosisSystemIconByKey.get(key) ?? defaultDiagnosisSystemIcon
        const isMatched = matched.has(key)
        const style = {
          animationDelay: `${index * 26}ms`,
        } as CSSProperties
        return <span
          key={`${hint.key}-${system}`}
          className={`dx-system-icon ${isMatched ? countTone : 'miss'}`}
          style={style}
          aria-label={system}
          tabIndex={0}
          onMouseEnter={(event) => alignSystemTooltip(event.currentTarget)}
          onFocus={(event) => alignSystemTooltip(event.currentTarget)}
          onTouchStart={(event) => alignSystemTooltip(event.currentTarget)}
        >
          <img className="dx-system-icon__glyph" src={icon} alt="" aria-hidden="true" loading="lazy" />
          <span className="dx-system-icon__tooltip" role="tooltip">{system}</span>
        </span>
      })}
    </div>
  </section>
}

function HorizontalScrollLane({ className, children }: { className: string; children: ReactNode }) {
  const laneRef = useRef<HTMLDivElement>(null)
  const dragRef = useRef({
    pointerId: -1,
    startX: 0,
    startScrollLeft: 0,
    moved: false,
  })
  const [isDragging, setIsDragging] = useState(false)

  const stopDrag = (pointerId: number) => {
    const lane = laneRef.current
    if (!lane) return
    if (lane.hasPointerCapture(pointerId)) lane.releasePointerCapture(pointerId)
    const shouldResetAfterClick = dragRef.current.moved
    dragRef.current.pointerId = -1
    setIsDragging(false)
    if (shouldResetAfterClick) {
      requestAnimationFrame(() => {
        dragRef.current.moved = false
      })
    }
  }

  return <div
    ref={laneRef}
    className={`${className} ${isDragging ? 'is-dragging' : ''}`.trim()}
    onWheel={(event) => {
      const lane = laneRef.current
      if (!lane || lane.scrollWidth <= lane.clientWidth) return
      const delta = Math.abs(event.deltaX) > Math.abs(event.deltaY) ? event.deltaX : event.deltaY
      if (!delta) return
      lane.scrollLeft += delta
      event.preventDefault()
    }}
    onPointerDown={(event) => {
      if (event.pointerType === 'mouse' && event.button !== 0) return
      const lane = laneRef.current
      if (!lane || lane.scrollWidth <= lane.clientWidth) return
      dragRef.current.pointerId = event.pointerId
      dragRef.current.startX = event.clientX
      dragRef.current.startScrollLeft = lane.scrollLeft
      dragRef.current.moved = false
      lane.setPointerCapture(event.pointerId)
      setIsDragging(true)
    }}
    onPointerMove={(event) => {
      const lane = laneRef.current
      if (!lane || dragRef.current.pointerId !== event.pointerId) return
      const dx = event.clientX - dragRef.current.startX
      if (Math.abs(dx) > 4) dragRef.current.moved = true
      lane.scrollLeft = dragRef.current.startScrollLeft - dx
    }}
    onPointerUp={(event) => stopDrag(event.pointerId)}
    onPointerCancel={(event) => stopDrag(event.pointerId)}
    onPointerLeave={(event) => {
      if (event.pointerType === 'mouse' && dragRef.current.pointerId === event.pointerId) stopDrag(event.pointerId)
    }}
    onClickCapture={(event) => {
      if (!dragRef.current.moved) return
      event.preventDefault()
      event.stopPropagation()
      dragRef.current.moved = false
    }}
  >
    {children}
  </div>
}

function PeopleGroup({ hint }: { hint: Attempt['hints'][number] }) {
  return <div className={`people-group ${hint.status} people-${hint.key}`}>
    <div className="people-group__head"><span>{hint.label}</span></div>
    <div className="people-row">
      {hint.people?.length
        ? hint.people.map((person, index) => <PersonPortrait key={`${person.nameRu}-${index}`} person={person} />)
        : <span className="people-empty">Нет данных</span>}
    </div>
  </div>
}

function AttemptCard({ attempt, item, index, isCorrectAttempt }: { attempt: Attempt; item: TitleItem; index: number; isCorrectAttempt: boolean }) {
  const byKey = new Map(attempt.hints.map((hint) => [hint.key, hint]))
  const metricClues = ['country', 'series_status', 'seasons', 'runtime', 'kp', 'imdb', 'anime_kind', 'anime_status', 'episodes', 'episodes_aired', 'studio', 'anime_source', 'shiki', 'rank', 'music_type', 'music_active', 'top_track', 'top_album', 'listeners']
    .map((key) => byKey.get(key))
    .filter(Boolean) as Attempt['hints']
  const people = ['creator', 'cast'].map((key) => byKey.get(key)).filter(Boolean) as Attempt['hints']
  const genresHint = byKey.get('genres')
  const genres = item.genres ?? []
  const genreMatched = new Set((genresHint?.matchedValues ?? []).map(normalizeTextMatch))
  const score = progressStats(attempt.hints)
  const yearHint = byKey.get('year')
  const ageHint = byKey.get('age')
  const yearText = item.year != null ? String(item.year) : null
  const ageText = item.ageRating ?? '—'
  const isSeriesAttempt = item.mode === 'series'
  const badge = ratingBadge(item)
  return <article className={`attempt-card attempt-card--screen${isSeriesAttempt ? ' attempt-card--screen-series' : ''}`}>
    <div className="attempt-card__header">
      <span className="attempt-card__number">{String(index + 1).padStart(2, '0')}</span>
      <Poster item={item} />
      <div className="attempt-card__identity">
        <span className="attempt-label">Попытка {index + 1}</span>
        <h2>{item.titleRu}</h2>
        <p className="gm-head__sub">
          <span className="gm-head__orig">{item.titleOriginal || 'Оригинальное название не указано'}</span>
          {yearText && <>
            <i className="gm-head__dot" aria-hidden="true">·</i>
            <span className={`gm-year ${yearHint?.status ?? ''}`}>
              {yearText}
              {yearHint?.direction === 'up' ? <ArrowUp /> : yearHint?.direction === 'down' ? <ArrowDown /> : yearHint?.status === 'match' ? <Check /> : null}
            </span>
          </>}
          {ageText !== '—' && <>
            <i className="gm-head__dot" aria-hidden="true">·</i>
            <span className={`gm-year gm-year--age ${ageHint?.status ?? ''}`}>
              {ageText}
              {ageHint?.direction === 'up' ? <ArrowUp /> : ageHint?.direction === 'down' ? <ArrowDown /> : ageHint?.status === 'match' ? <Check /> : null}
            </span>
          </>}
        </p>
        {!!genres.length && <div className="gm-genres">
          {visibleMatchedItems(genres, genreMatched, 4).map((genre) => {
            const isMatch = genreMatched.has(normalizeTextMatch(genre))
            return <span key={genre} className={`gm-genre ${isMatch ? 'match' : ''}`}>{genre}{isMatch && <Check />}</span>
          })}
        </div>}
      </div>
      <div className="rating-badge"><small>{badge.label}</small><strong>{badge.value}</strong></div>
    </div>

    <AttemptScore {...score} isCorrectAttempt={isCorrectAttempt} />

    <div className="attempt-clue-grid">
      {metricClues.map((hint, hintIndex) => <ClueTile key={hint.key} hint={hint} delay={hintIndex} />)}
      {people.map((hint) => <PeopleGroup key={hint.key} hint={hint} />)}
    </div>
  </article>
}

function GameStudioPlate({ label, names, hint }: { label: string; names: string[]; hint: Attempt['hints'][number] | undefined }) {
  if (!names.length) return null
  const matched = new Set((hint?.matchedValues ?? []).map(normalizeTextMatch))
  const isMatch = hint?.status === 'match' || names.some((name) => matched.has(normalizeTextMatch(name)))
  const monogram = (names[0].match(/[A-Za-zА-Яа-я0-9]+/g) ?? []).slice(0, 2).map((word) => word[0]).join('').toUpperCase() || '?'
  return <div className={`gm-studio ${isMatch ? 'match' : 'miss'}`}>
    <span className="gm-studio__logo" aria-hidden="true">{monogram}</span>
    <span className="gm-studio__meta">
      <small>{label}</small>
      <strong title={names.join(', ')}>{names.join(', ')}</strong>
    </span>
    <i className="gm-studio__mark" aria-hidden="true">{isMatch ? <Check /> : null}</i>
  </div>
}

function GameAttemptCard({ attempt, item, index, isCorrectAttempt }: { attempt: Attempt; item: TitleItem; index: number; isCorrectAttempt: boolean }) {
  const byKey = new Map(attempt.hints.map((hint) => [hint.key, hint]))
  const genresHint = byKey.get('genres')
  const rankHint = byKey.get('rank')
  const yearHint = byKey.get('year')
  const score = progressStats(attempt.hints)
  const genres = item.genres ?? []
  const genreMatched = new Set((genresHint?.matchedValues ?? []).map(normalizeTextMatch))
  const attrs = ['players', 'metacritic', 'steam_positive', 'reviews', 'price', 'age']
    .map((key) => byKey.get(key))
    .filter(Boolean) as Attempt['hints']
  const steamCategories = dedupeGameCategories(item.steamCategories ?? [], Boolean(byKey.get('players')))
  const platforms = dedupeGameCategories(item.platforms ?? [], false)
  const rankText = item.topRank != null ? `#${item.topRank}` : '—'

  return <article className="attempt-card attempt-card--game">
    <div className="gm-head">
      <span className="attempt-card__number">{String(index + 1).padStart(2, '0')}</span>
      <Poster item={item} className="gm-head__art" />
      <div className="gm-head__identity">
        <span className="attempt-label">Попытка {index + 1}</span>
        <h2>{item.titleRu}</h2>
        <p className="gm-head__sub">
          <span className="gm-head__orig">{item.titleOriginal || 'Оригинальное название не указано'}</span>
          {item.year != null && <>
            <i className="gm-head__dot" aria-hidden="true">·</i>
            <span className={`gm-year ${yearHint?.status ?? ''}`}>
              {item.year}
              {yearHint?.direction === 'up' ? <ArrowUp /> : yearHint?.direction === 'down' ? <ArrowDown /> : yearHint?.status === 'match' ? <Check /> : null}
            </span>
          </>}
        </p>
        {!!genres.length && <div className="gm-genres">
          {visibleMatchedItems(genres, genreMatched, 4).map((genre) => {
            const isMatch = genreMatched.has(normalizeTextMatch(genre))
            return <span key={genre} className={`gm-genre ${isMatch ? 'match' : ''}`}>{genre}{isMatch && <Check />}</span>
          })}
        </div>}
      </div>
      {rankHint && <div className={`gm-rank ${rankHint.status}`}>
        <span className="gm-rank__ico" aria-hidden="true"><Trophy /></span>
        <div className="gm-rank__val">
          <strong>{rankText}</strong>
          {rankHint.direction === 'up' ? <ArrowUp /> : rankHint.direction === 'down' ? <ArrowDown /> : null}
        </div>
        <small>место</small>
      </div>}
    </div>

    <AttemptScore {...score} isCorrectAttempt={isCorrectAttempt} />

    {(!!(item.developers ?? []).length || !!(item.publishers ?? []).length) && <div className="gm-studios">
      <GameStudioPlate label="Разработчик" names={item.developers ?? []} hint={byKey.get('developer')} />
      <GameStudioPlate label="Издатель" names={item.publishers ?? []} hint={byKey.get('publisher')} />
    </div>}

    {!!attrs.length && <div className="dx-attrs">{attrs.map((hint, hintIndex) => <ClueTile key={hint.key} hint={hint} delay={hintIndex} />)}</div>}

    <div className="dx-clouds">
      <DxChipCloud label="Категории" hint={byKey.get('steam_categories')} items={steamCategories} limit={6} iconKind="steam-categories" />
      <DxChipCloud label="Платформы" hint={byKey.get('platforms')} items={platforms} limit={6} />
    </div>
  </article>
}

function MusicAttemptCard({ attempt, item, index, isCorrectAttempt }: { attempt: Attempt; item: TitleItem; index: number; isCorrectAttempt: boolean }) {
  const byKey = new Map(attempt.hints.map((hint) => [hint.key, hint]))
  const score = progressStats(attempt.hints)
  const genresHint = byKey.get('genres')
  const genres = item.genres ?? []
  const genreMatched = new Set((genresHint?.matchedValues ?? []).map(normalizeTextMatch))
  const listenersValue = item.votes?.gamesPlayed ?? null
  const requestedHints = ['country', 'year', 'decade', 'music_type', 'music_active', 'music_origin']
    .map((key) => byKey.get(key))
    .filter(Boolean) as Attempt['hints']
  const similarArtistNames = (item.similarArtists ?? []).map((artist) => artist.name).filter(Boolean)

  return <article className="attempt-card attempt-card--music">
    <div className="attempt-card__header">
      <span className="attempt-card__number">{String(index + 1).padStart(2, '0')}</span>
      <Poster item={item} />
      <div className="attempt-card__identity">
        <span className="attempt-label">Попытка {index + 1}</span>
        <h2>{item.titleRu}</h2>
        <p className="gm-head__sub">
          <span className="gm-head__orig">{item.titleOriginal || 'Оригинальное название не указано'}</span>
          {item.year != null && <>
            <i className="gm-head__dot" aria-hidden="true">·</i>
            <span className={`gm-year ${byKey.get('year')?.status ?? ''}`}>
              {item.year}
              {byKey.get('year')?.direction === 'up' ? <ArrowUp /> : byKey.get('year')?.direction === 'down' ? <ArrowDown /> : byKey.get('year')?.status === 'match' ? <Check /> : null}
            </span>
          </>}
        </p>
        {!!genres.length && <div className="gm-genres">
          {visibleMatchedItems(genres, genreMatched, 6).map((genre) => {
            const isMatch = genreMatched.has(normalizeTextMatch(genre))
            return <span key={genre} className={`gm-genre ${isMatch ? 'match' : ''}`}>{genre}{isMatch && <Check />}</span>
          })}
        </div>}
      </div>
      {listenersValue != null && <div className="rating-badge"><small>LFM</small><strong>{new Intl.NumberFormat('ru-RU', { notation: 'compact', maximumFractionDigits: 1 }).format(listenersValue)}</strong></div>}
    </div>

    <AttemptScore {...score} isCorrectAttempt={isCorrectAttempt} />

    {!!requestedHints.length && <div className="attempt-clue-grid music-attempt__clues">
      {requestedHints.map((hint, hintIndex) => <ClueTile key={hint.key} hint={hint} delay={hintIndex} />)}
    </div>}

    <div className="dx-clouds">
      <DxChipCloud label="Похожие артисты" hint={byKey.get('similar_artists')} items={similarArtistNames} limit={6} wrap />
    </div>
  </article>
}

function DxChipCloud({ label, hint, items, limit = 6, iconKind, wrap = false }: { label: string; hint: Attempt['hints'][number] | undefined; items: string[]; limit?: number; iconKind?: 'steam-categories'; wrap?: boolean }) {
  if (!items.length) return null
  const matched = new Set((hint?.matchedValues ?? []).map(normalizeTextMatch))
  const matchedCount = items.filter((value) => matched.has(normalizeTextMatch(value))).length
  const shouldScroll = !wrap && items.length > limit
  const countTone = matchedCount === items.length ? 'match' : matchedCount ? 'partial' : 'miss'
  const chipsClassName = ['dx-cloud__chips', wrap ? 'is-wrap' : '', shouldScroll ? 'is-scrollable' : ''].filter(Boolean).join(' ')
  return <div className="dx-cloud">
    <div className="dx-cloud__head">
      <span>{label}</span>
      <small className={countTone}>{matchedCount}/{items.length}</small>
    </div>
    <HorizontalScrollLane className={chipsClassName}>
      {items.map((value) => {
        const isMatched = matched.has(normalizeTextMatch(value))
        const icon = iconKind === 'steam-categories' ? steamCategoryIcon(value) : null
        return <span key={value} className={`dx-chip ${isMatched ? 'match' : 'miss'}`}>
          {icon && <img className="dx-chip__icon" src={icon === 'single' ? './images/steam-icons/single-player.svg' : './images/steam-icons/multi-player.svg'} alt="" aria-hidden="true" />}
          {value}
          {isMatched && <Check />}
        </span>
      })}
    </HorizontalScrollLane>
  </div>
}

function DiagnosisAttemptCard({ attempt, item, index, isCorrectAttempt }: { attempt: Attempt; item: TitleItem; index: number; isCorrectAttempt: boolean }) {
  const byKey = new Map(attempt.hints.map((hint) => [hint.key, hint]))
  const bodySystemsHint = byKey.get('body_systems')
  const attrs = ['disease_types', 'course', 'contagiousness', 'typical_age', 'localization']
    .map((key) => byKey.get(key))
    .filter(Boolean) as Attempt['hints']
  const score = progressStats(attempt.hints)
  const icdValue = item.icd10?.[0] ?? item.icdGroup ?? '—'

  return <article className="attempt-card attempt-card--dx">
    <div className="dx-head">
      <span className="attempt-card__number">{String(index + 1).padStart(2, '0')}</span>
      <div className="dx-head__identity">
        <span className="attempt-label">Попытка {index + 1}</span>
        <h2>{item.titleRu}</h2>
        <p>{item.titleOriginal || 'Оригинальное название не указано'}</p>
      </div>
      <div className="dx-head__icd"><small>МКБ</small><strong>{icdValue}</strong></div>
    </div>

    <AttemptScore {...score} isCorrectAttempt={isCorrectAttempt} />

    {bodySystemsHint && <DxSystemIcons hint={bodySystemsHint} />}
    {!!attrs.length && <div className="dx-attrs">{attrs.map((hint, hintIndex) => <ClueTile key={hint.key} hint={hint} delay={hintIndex} />)}</div>}

    <div className="dx-clouds">
      <DxChipCloud label="Симптомы" hint={byKey.get('symptoms')} items={item.keySymptoms ?? []} limit={6} wrap />
      <DxChipCloud label="Диагностика" hint={byKey.get('diagnostics')} items={item.diagnostics ?? []} limit={4} wrap />
      <DxChipCloud label="Факторы риска" hint={byKey.get('risk_factors')} items={item.riskFactors ?? []} limit={4} wrap />
    </div>
  </article>
}

function Progress({ attempts }: { attempts: number }) {
  return <div className="progress-block">
    <div className="progress-copy"><span>Попытка</span><strong>{Math.min(attempts + 1, 10)} <i>из 10</i></strong></div>
    <div className="progress-track" aria-label={`Использовано попыток: ${attempts} из 10`}>
      {Array.from({ length: 10 }, (_, index) => <i key={index} className={index < attempts ? 'used' : index === attempts ? 'current' : ''} />)}
    </div>
  </div>
}

function Game({
  titles,
  mode,
  period,
  difficulty,
  date,
  setDate,
  onHome,
  onBack,
  onArchive,
  onStats,
  onRules,
  onReview,
  onEconomyChange,
  caseVignettes,
  dailySalt,
  isPracticeSession,
  searchIndex,
}: {
  titles: TitleItem[]
  mode: TitleMode
  period: PeriodKey
  difficulty: DifficultyKey
  date: string
  setDate: (date: string) => void
  onHome: () => void
  onBack: () => void
  onArchive: () => void
  onStats: () => void
  onRules: () => void
  onReview: () => void
  onEconomyChange: () => void
  caseVignettes: CaseVignetteMap
  dailySalt: number
  isPracticeSession: boolean
  searchIndex: LibrarySearchIndex | null
}) {
  const effectivePeriod: PeriodKey = mode === 'diagnosis' || mode === 'game' || mode === 'music' ? 'all' : period
  const difficultyVariant = mode === 'music' ? difficulty : ''
  const basePool = useMemo(() => poolFor(titles, mode, effectivePeriod), [titles, mode, effectivePeriod])
  const pool = useMemo(() => mode === 'music' ? musicDifficultyPool(basePool, difficulty) : basePool, [basePool, mode, difficulty])
  const answer = useMemo(() => pool.length ? dailyTitle(pool, mode, effectivePeriod, date, dailySalt, difficultyVariant) : null, [pool, mode, effectivePeriod, date, dailySalt, difficultyVariant])
  const baseKey = difficultyVariant ? `${gameKey(mode, effectivePeriod, date)}|diff:${difficultyVariant}` : gameKey(mode, effectivePeriod, date)
  const key = dailySalt === 0 ? baseKey : `${baseKey}|salt:${dailySalt}`
  const [sessionState, dispatchSession] = useReducer(gameSessionReducer, undefined, createInitialGameSessionState)
  const { attempts, status, query, selected, activeSuggestionIndex, message, hintChoices, dismissedHintRounds } = sessionState
  const debouncedQuery = useDebouncedValue(query, 100)
  const [gameMatchStripOpen, setGameMatchStripOpen] = useState(false)
  const [hintModalRound, setHintModalRound] = useState<HintCheckpoint | null>(null)
  const [copied, setCopied] = useState(false)
  const [anamnesisOpen, setAnamnesisOpen] = useState(false)
  const [lastAward, setLastAward] = useState<EconomyAward | null>(null)
  const [isSearchDropdownOpen, setIsSearchDropdownOpen] = useState(false)
  const searchPickerRef = useRef<HTMLDivElement | null>(null)
  const inputRef = useRef<HTMLInputElement>(null)
  const assistHints = useMemo(() => answer ? buildAssistHints(answer) : [], [answer])
  const availableAssistHintKeys = useMemo(
    () => new Set<AssistHintKey>(assistHints.filter((hint) => hint.available).map((hint) => hint.key)),
    [assistHints],
  )

  useEffect(() => {
    const saved = loadGame(key)
    const poolById = new Map<string, TitleItem>()
    if (mode === 'music') {
      for (const item of pool) {
        const canonicalId = canonicalMusicId(item)
        poolById.set(item.id, item)
        if (!poolById.has(canonicalId)) poolById.set(canonicalId, item)
      }
      for (const [fromId, toId] of Object.entries(MUSIC_ID_REDIRECTS)) {
        const resolved = poolById.get(toId)
        if (resolved) poolById.set(fromId, resolved)
      }
    } else {
      for (const item of pool) poolById.set(item.id, item)
    }

    const restoredAttemptIds = collectSavedAttemptIds(saved).map((id) => mode === 'music' ? resolveMusicRedirectId(id) : id)
    const savedAnswerId = mode === 'music'
      ? (poolById.get(resolveMusicRedirectId(saved?.answerId ?? ''))?.id ?? resolveMusicRedirectId(saved?.answerId ?? ''))
      : saved?.answerId
    const answerChanged = Boolean(answer && saved && savedAnswerId !== answer.id)
    const shouldRebuildAttempts = Boolean(answer && saved && !answerChanged && restoredAttemptIds.length)
    const restoredAttempts = answerChanged
      ? []
      : answer && shouldRebuildAttempts
        ? rebuildAttemptsForAnswer(restoredAttemptIds, poolById, answer)
        : (saved?.attempts ?? [])
    const restoredStatus: GameStatus = answerChanged
      ? 'playing'
      : answer && shouldRebuildAttempts
        ? deriveStatusFromAttempts(restoredAttempts, answer.id)
        : (saved?.status ?? 'playing')
    const restoredChoices = answerChanged ? [] : sanitizeStoredHintChoices(saved, availableAssistHintKeys)
    const openedRounds = new Set(restoredChoices.map((choice) => choice.round))
    const restoredDismissedRounds = answerChanged ? [] : sanitizeDismissedRounds(saved, openedRounds)

    dispatchSession({
      type: 'reset',
      payload: {
        attempts: restoredAttempts,
        status: restoredStatus,
        hintChoices: restoredChoices,
        dismissedHintRounds: restoredDismissedRounds,
      },
    })

    if (saved && answer && (shouldRebuildAttempts || answerChanged)) {
      saveGame({
        ...saved,
        key,
        mode,
        period: effectivePeriod,
        date,
        answerId: answer.id,
        attempts: restoredAttempts,
        attemptTitleIds: restoredAttempts.map((attempt) => attempt.titleId),
        status: restoredStatus,
        usedHints: restoredChoices.map((choice) => choice.key),
        hintChoices: restoredChoices,
        dismissedHintRounds: restoredDismissedRounds,
        updatedAt: Date.now(),
        ...(mode === 'music' ? { difficulty } : {}),
      })
    }

    setHintModalRound(null)
    setGameMatchStripOpen(mode === 'diagnosis')
    setAnamnesisOpen(false)
    setLastAward(null)
    setIsSearchDropdownOpen(false)
  }, [answer, availableAssistHintKeys, date, difficulty, effectivePeriod, key, mode, pool])

  const used = useMemo(() => new Set(attempts.map((attempt) => mode === 'music' ? resolveMusicRedirectId(attempt.titleId) : attempt.titleId)), [attempts, mode])
  const suggestions = useMemo(() => {
    const startedAt = typeof performance !== 'undefined' ? performance.now() : 0
    const next = searchTitles(pool, debouncedQuery, used, searchIndex)
    if (typeof performance !== 'undefined') {
      markSearchDuration(mode, debouncedQuery.length, performance.now() - startedAt, next.length)
    }
    return next
  }, [pool, debouncedQuery, used, mode, searchIndex])
  const matchedTags = useMemo(() => collectMatchedTags(attempts), [attempts])

  const isSuggestionsOpen = isSearchDropdownOpen && Boolean(query) && !selected

  useEffect(() => {
    if (!isSuggestionsOpen || !suggestions.length) {
      dispatchSession({ type: 'set_active_index', index: -1 })
      return
    }
    const nextIndex = activeSuggestionIndex < 0
      ? 0
      : activeSuggestionIndex >= suggestions.length
        ? suggestions.length - 1
        : activeSuggestionIndex
    dispatchSession({ type: 'set_active_index', index: nextIndex })
  }, [isSuggestionsOpen, suggestions, activeSuggestionIndex])
  const anamnesisText = useMemo(() => answer && mode === 'diagnosis'
    ? (pickDailyVignette(caseVignettes[answer.id] ?? [], answer.id, date)?.text ?? '')
    : '', [answer, mode, caseVignettes, date])
  const usedHintsSet = useMemo(() => new Set(hintChoices.map((choice) => choice.key)), [hintChoices])
  const revealedAssistHints = useMemo(() => assistHints.filter((hint) => usedHintsSet.has(hint.key)), [assistHints, usedHintsSet])
  const progressiveMusicHints = useMemo(
    () => mode === 'music' && answer ? buildMusicProgressiveHints(answer, attempts) : [],
    [mode, answer, attempts],
  )
  const currentRound = Math.min(attempts.length + 1, 10)
  const unlockedHintRounds: HintCheckpoint[] = []
  if (currentRound >= 5) unlockedHintRounds.push(5)
  if (currentRound >= 8) unlockedHintRounds.push(8)
  const usedHintRounds = useMemo(() => new Set(hintChoices.map((choice) => choice.round)), [hintChoices])
  const pendingHintRounds = useMemo(() => unlockedHintRounds.filter((round) => !usedHintRounds.has(round)), [unlockedHintRounds, usedHintRounds])
  const nextHintRound = pendingHintRounds[0] ?? null
  const nextUndismissedHintRound = pendingHintRounds.find((round) => !dismissedHintRounds.includes(round)) ?? null
  const preferredHintRound = nextUndismissedHintRound ?? nextHintRound
  const canUseHint = status === 'playing' && pendingHintRounds.length > 0
  const hintTriggerLabel = pendingHintRounds.length > 1 ? `Подсказка ×${pendingHintRounds.length}` : 'Подсказка'
  const showTodayLink = date !== getMoscowDate()
  const closeSearchDropdown = useCallback(() => setIsSearchDropdownOpen(false), [])
  const headingPeriodBadge = mode === 'music'
    ? DIFFICULTIES[difficulty].label
    : mode === 'movie' || mode === 'series' || mode === 'anime'
      ? effectivePeriod === 'all'
        ? 'Главная премьера'
        : PERIODS[effectivePeriod].label.replace(' года', '')
      : null
  useDismissOnOutside(isSuggestionsOpen, searchPickerRef, closeSearchDropdown)

  useEffect(() => {
    if (!canUseHint) {
      setHintModalRound(null)
      return
    }
    if (hintModalRound && !pendingHintRounds.includes(hintModalRound)) {
      setHintModalRound(null)
      return
    }
    if (!hintModalRound && nextUndismissedHintRound) {
      setHintModalRound(nextUndismissedHintRound)
    }
  }, [canUseHint, hintModalRound, nextUndismissedHintRound, pendingHintRounds])

  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.defaultPrevented) return
      if (event.key === 'Escape') {
        event.preventDefault()
        onBack()
        return
      }
      if (status !== 'playing' || hintModalRound) return
      if (event.ctrlKey || event.metaKey || event.altKey) return
      if (isEditableTarget(event.target)) return

      if (event.key.length === 1) {
        event.preventDefault()
        inputRef.current?.focus()
        dispatchSession({ type: 'append_query_char', char: event.key })
        dispatchSession({ type: 'set_selected', selected: null })
        dispatchSession({ type: 'set_message', message: '' })
        return
      }

      if (event.key === 'Backspace') {
        event.preventDefault()
        inputRef.current?.focus()
        dispatchSession({ type: 'backspace_query' })
        dispatchSession({ type: 'set_selected', selected: null })
        dispatchSession({ type: 'set_message', message: '' })
      }
    }
    window.addEventListener('keydown', onKeyDown)
    return () => window.removeEventListener('keydown', onKeyDown)
  }, [hintModalRound, onBack, status])

  const updateStats = (won: boolean, count: number) => {
    const stats = loadStats(mode, mode === 'music' ? difficulty : undefined)
    const next: Stats = {
      ...stats,
      distribution: [...stats.distribution],
      played: stats.played + 1,
      won: stats.won + (won ? 1 : 0),
      currentStreak: won ? stats.currentStreak + 1 : 0,
      bestStreak: won ? Math.max(stats.bestStreak, stats.currentStreak + 1) : stats.bestStreak,
    }
    if (won) next.distribution[count - 1] += 1
    saveStats(mode, next, mode === 'music' ? difficulty : undefined)
  }

  const persistGame = (nextAttempts: Attempt[], nextStatus: GameStatus, nextHintChoices: HintChoice[], nextDismissedRounds = dismissedHintRounds) => {
    if (!answer) return
    saveGame({
      key,
      mode,
      period: effectivePeriod,
      date,
      answerId: answer.id,
      attempts: nextAttempts,
      status: nextStatus,
      usedHints: nextHintChoices.map((choice) => choice.key),
      hintChoices: nextHintChoices,
      dismissedHintRounds: nextDismissedRounds,
      updatedAt: Date.now(),
      ...(mode === 'music' ? { difficulty } : {}),
    })
  }

  const revealAssistHint = (hintKey: AssistHintKey) => {
    if (!answer || status !== 'playing') return
    if (usedHintsSet.has(hintKey)) return
    const targetRound = hintModalRound ?? preferredHintRound
    if (!targetRound) return

    const targetHint = assistHints.find((hint) => hint.key === hintKey)
    if (!targetHint?.available) {
      dispatchSession({ type: 'set_message', message: 'Для этой подсказки пока нет данных' })
      return
    }
    const nextHintChoices = [...hintChoices, { round: targetRound, key: hintKey }]
    trackMetrikaGoal('reveal_hint', { mode, period: effectivePeriod, round: targetRound, hintKey })
    const nextDismissedRounds = dismissedHintRounds.filter((round) => round !== targetRound)
    dispatchSession({ type: 'set_dismissed_rounds', rounds: nextDismissedRounds })
    dispatchSession({ type: 'set_hint_choices', hintChoices: nextHintChoices })
    setHintModalRound(null)
    dispatchSession({ type: 'set_message', message: '' })
    persistGame(attempts, status, nextHintChoices, nextDismissedRounds)
  }

  const dismissHintModal = () => {
    if (!hintModalRound) return
    const nextDismissedRounds = [...new Set([...dismissedHintRounds, hintModalRound])] as HintCheckpoint[]
    dispatchSession({ type: 'set_dismissed_rounds', rounds: nextDismissedRounds })
    setHintModalRound(null)
    persistGame(attempts, status, hintChoices, nextDismissedRounds)
  }

  const submit = (forcedSelection?: TitleItem) => {
    const nextSelection = forcedSelection ?? selected
    if (!nextSelection || !answer || status !== 'playing') {
      dispatchSession({ type: 'set_message', message: 'Выберите вариант из найденного списка' })
      return
    }
    if (used.has(nextSelection.id)) {
      dispatchSession({ type: 'set_message', message: 'Этот вариант уже был в попытках' })
      return
    }
    setIsSearchDropdownOpen(false)
    const nextAttempts = [...attempts, { titleId: nextSelection.id, hints: compareTitles(nextSelection, answer) }]
    const nextStatus: GameStatus = nextSelection.id === answer.id ? 'won' : nextAttempts.length >= 10 ? 'lost' : 'playing'
    trackMetrikaGoal('submit_attempt', {
      mode,
      period: effectivePeriod,
      attempt: nextAttempts.length,
      status: nextStatus,
    })
    if (nextStatus === 'won') {
      trackMetrikaGoal('game_won', { mode, period: effectivePeriod, attempts: nextAttempts.length })
    }
    if (nextStatus === 'lost') {
      trackMetrikaGoal('game_lost', { mode, period: effectivePeriod, attempts: nextAttempts.length })
    }
    dispatchSession({ type: 'submit_attempt', attempts: nextAttempts, status: nextStatus })
    persistGame(nextAttempts, nextStatus, hintChoices)
    if (nextStatus !== 'playing' && !isPracticeSession) {
      const sessionKey = completionSessionKey(mode, effectivePeriod, date, difficultyVariant)
      const alreadyCompletedSession = loadDailyAttendance(date).completedSessions.includes(sessionKey)
      if (!alreadyCompletedSession) updateStats(nextStatus === 'won', nextAttempts.length)
      if (date === getMoscowDate()) {
        setLastAward(recordDailyCompletion(mode, effectivePeriod, date, nextStatus === 'won', nextAttempts.length, difficultyVariant))
        onEconomyChange()
      }
    }
    setTimeout(() => {
      const targetSelector = nextStatus === 'playing' ? '.attempt-card:first-child' : '.result-card'
      document.querySelector(targetSelector)?.scrollIntoView({ behavior: 'smooth', block: 'start' })
    }, 100)
  }

  const share = async () => {
    const text = resultText(mode, date, effectivePeriod, attempts.map((attempt) => attempt.hints), status === 'won')
    try {
      await navigator.clipboard.writeText(text)
      trackMetrikaGoal('share_copy', { mode, period: effectivePeriod, status })
      setCopied(true)
      setTimeout(() => setCopied(false), 1800)
    } catch {
      trackMetrikaGoal('share_copy_error', { mode, period: effectivePeriod, status })
      dispatchSession({ type: 'set_message', message: 'Не удалось скопировать результат' })
    }
  }

  if (!answer) return <div className="loading">В этой теме пока нет записей.</div>

  return <>
    <AppHeader onHome={onHome} onArchive={onArchive} onStats={onStats} onRules={onRules} onReview={onReview} />
    <main className="game-shell">
      <div className="screen-back-row">
        <button className="screen-back" onClick={() => {
          trackMetrikaGoal('game_back_click', { mode, period: effectivePeriod })
          onBack()
        }} aria-label="Назад"><ChevronLeft /></button>
        <span className="keycap-hint" aria-hidden="true">Esc</span>
      </div>
      <section className={`game-heading${mode === 'diagnosis' ? ' game-heading--diagnosis' : ''}`}>
        <div>
          <div className="game-heading__kicker">
            <span>
              {date === getMoscowDate() ? 'Сегодня' : 'Архив'} · Сеанс №{dayNumber(date)}
              {headingPeriodBadge ? ` · ${headingPeriodBadge}` : ''}
            </span>
          </div>
          <h1>{modeMeta(mode).daily} дня</h1>
          <p>{prettyDate(date)} · обновление в 00:00 МСК</p>
        </div>
        <div className="mini-ticket" aria-hidden="true"><Ticket /><span>{date.slice(8, 10)}<small>/{date.slice(5, 7)}</small></span></div>
      </section>

      {(showTodayLink || (mode === 'diagnosis' && !!anamnesisText)) && <section className="game-toolbar" aria-label="Настройки игры">
        {mode === 'diagnosis' && !!anamnesisText && <ActionButton variant="secondary" className="anamnesis-link" onClick={() => {
          trackMetrikaGoal('open_anamnesis', { mode })
          setAnamnesisOpen(true)
        }}><ClipboardList /> Анамнез</ActionButton>}
        {showTodayLink && <ActionButton variant="ghost" className="today-link" onClick={() => {
          trackMetrikaGoal('switch_to_today', { mode })
          setDate(getMoscowDate())
        }}>Сегодня</ActionButton>}
      </section>}

      <div className="progress-row">
        <Progress attempts={attempts.length} />
        {canUseHint && !hintModalRound && <ActionButton variant="hint" className="hint-trigger" onClick={() => {
          if (!preferredHintRound) return
          trackMetrikaGoal('open_hint_modal', { mode, period: effectivePeriod, round: preferredHintRound })
          setHintModalRound(preferredHintRound)
        }}><Sparkles /> {hintTriggerLabel}</ActionButton>}
      </div>

      {!!revealedAssistHints.length && <section className="assist-revealed" aria-label="Открытые подсказки">
        {revealedAssistHints.map((hint) => <article key={hint.key} className="assist-reveal-card">
          <span><Sparkles /> {hint.title}</span>
          {hint.body && <p>{renderHintBody(hint.body)}</p>}
          {!!hint.people?.length && <div className="assist-people-row">
            {hint.people.map((person, index) => <PersonPortrait key={`${personName(person)}-${index}`} person={person} />)}
          </div>}
        </article>)}
      </section>}

      {mode === 'music' && !!progressiveMusicHints.length && status === 'playing' && <section className="assist-revealed" aria-label="Постепенные музыкальные подсказки">
        {progressiveMusicHints.map((hint) => <article key={`music-step-${hint.step}`} className="assist-reveal-card">
          <span><Sparkles /> Шаг {hint.step}: {hint.title}</span>
          <p>{hint.body}</p>
        </article>)}
      </section>}

      {status !== 'playing' && <section className={`result-card ${status}`}>
        <Poster item={answer} />
        <div className="result-card__copy">
          <span>{status === 'won' ? (answer.mode === 'diagnosis' ? 'Диагноз угадан' : 'Сеанс угадан') : 'Сеанс завершён'}</span>
          <h2>{answer.titleRu}</h2>
          <p>{answer.mode === 'diagnosis'
            ? [answer.titleOriginal, ...(answer.icd10?.length ? [answer.icd10.join(', ')] : []), ...(answer.icdGroup ? [answer.icdGroup] : [])].filter(Boolean).join(' · ')
            : answer.mode === 'game'
              ? [answer.titleOriginal || 'Оригинальное название не указано', answer.year != null ? String(answer.year) : '—', answer.topRank != null ? `#${answer.topRank}` : null].filter(Boolean).join(' · ')
              : answer.mode === 'music'
                ? [
                    answer.titleOriginal || 'Оригинальное название не указано',
                    answer.year != null ? `начало карьеры: ${answer.year}` : null,
                    musicTypeLabel(answer.musicType),
                    musicTierLabel(answer.gameTier ?? null),
                    musicOriginLabel(answer.musicOrigin ?? null),
                  ].filter(Boolean).join(' · ')
              : `${answer.titleOriginal || 'Оригинальное название не указано'} · ${answer.year ?? '—'}`}</p>
          <div className="result-tags">{(answer.mode === 'diagnosis'
            ? [...(answer.bodySystems ?? []).slice(0, 2), ...(answer.diseaseTypes ?? []).slice(0, 2), ...(answer.icd10 ?? []).slice(0, 1)]
            : answer.mode === 'game'
              ? [...(answer.genres ?? []).slice(0, 3), ...dedupeGameCategories(answer.steamCategories ?? [], true).slice(0, 2)]
              : answer.mode === 'music'
                ? [
                    ...(answer.genres ?? []).slice(0, 2),
                    ...(answer.topAlbums?.[0]?.title ? [answer.topAlbums[0].title] : []),
                    ...(answer.topTracks?.[0]?.title ? [answer.topTracks[0].title] : []),
                  ]
              : (answer.genres ?? [])
          ).map((tag) => <i key={tag}>{tag}</i>)}</div>
          <strong>{status === 'won' ? `${attempts.length}/10 — верный ответ` : 'Правильный ответ открыт'}</strong>
          {lastAward && <EconomyAwardPanel award={lastAward} />}
        </div>
        <div className="result-actions">
          <button onClick={share}>{copied ? <Check /> : <Copy />}{copied ? 'Скопировано' : 'Скопировать'}</button>
          <a href={`https://t.me/share/url?url=${encodeURIComponent(location.href)}&text=${encodeURIComponent(resultText(mode, date, effectivePeriod, attempts.map((attempt) => attempt.hints), status === 'won'))}`} onClick={() => trackMetrikaGoal('share_telegram', { mode, period: effectivePeriod, status })} target="_blank" rel="noreferrer"><Share2 /> Telegram</a>
        </div>
      </section>}

      {status === 'playing' && <section className="search-area">
        <div ref={searchPickerRef} className="search-picker">
        <div className={`search-box ${selected ? 'selected' : ''}`}>
          <Search />
          <input
            ref={inputRef}
            id="movie-search"
            aria-label={mode === 'diagnosis' ? 'Введите диагноз' : mode === 'game' ? 'Введите игру' : mode === 'music' ? 'Введите артиста' : 'Введите название'}
            value={query}
            autoComplete="off"
            placeholder={modeMeta(mode).searchPlaceholder}
            onFocus={() => setIsSearchDropdownOpen(true)}
            onChange={(event) => {
              dispatchSession({ type: 'set_query', query: event.target.value })
              dispatchSession({ type: 'set_selected', selected: null })
              dispatchSession({ type: 'set_active_index', index: 0 })
              dispatchSession({ type: 'set_message', message: '' })
              setIsSearchDropdownOpen(true)
            }}
            onKeyDown={(event) => {
              if (event.key === 'Escape' && isSuggestionsOpen) {
                event.preventDefault()
                setIsSearchDropdownOpen(false)
                return
              }
              if (event.key === 'ArrowDown') {
                if (!suggestions.length || selected) return
                event.preventDefault()
                dispatchSession({
                  type: 'set_active_index',
                  index: activeSuggestionIndex < 0 ? 0 : Math.min(activeSuggestionIndex + 1, suggestions.length - 1),
                })
                return
              }
              if (event.key === 'ArrowUp') {
                if (!suggestions.length || selected) return
                event.preventDefault()
                dispatchSession({ type: 'set_active_index', index: activeSuggestionIndex <= 0 ? 0 : activeSuggestionIndex - 1 })
                return
              }
              if (event.key === 'Enter') {
                event.preventDefault()
                if (selected) {
                  submit()
                  return
                }
                if (suggestions.length) {
                  const index = activeSuggestionIndex >= 0 ? activeSuggestionIndex : 0
                  submit(suggestions[index])
                  return
                }
                submit()
              }
            }}
          />
          {selected && <Check className="selected-check" />}
          <button onClick={() => submit()} aria-label="Проверить ответ"><ChevronRight /></button>
        </div>
        {isSuggestionsOpen && <div className="suggestions">
          {suggestions.length ? suggestions.map((item, index) => <button key={item.id} className={index === activeSuggestionIndex ? 'is-active' : ''} onMouseEnter={() => dispatchSession({ type: 'set_active_index', index })} onClick={() => submit(item)}>
            <Poster item={item} />
            <span><strong>{item.titleRu}</strong><small>{item.mode === 'diagnosis'
              ? [item.titleOriginal || 'Без оригинального названия', ...(item.icd10?.length ? [item.icd10.join(', ')] : []), ...(item.icdGroup ? [item.icdGroup] : [])].filter(Boolean).join(' · ')
              : item.mode === 'game'
                ? [item.titleOriginal || 'Без оригинального названия', item.year != null ? String(item.year) : '—', item.topRank != null ? `#${item.topRank}` : null].filter(Boolean).join(' · ')
                : item.mode === 'music'
                  ? [
                      item.titleOriginal || 'Без оригинального названия',
                      item.year != null ? `начало карьеры: ${item.year}` : '—',
                      musicTypeLabel(item.musicType),
                    ].filter(Boolean).join(' · ')
                : `${item.titleOriginal || 'Без оригинального названия'} · ${item.year ?? '—'}`}</small></span>
            <em>{item.mode === 'diagnosis'
              ? (item.contagiousness ?? item.icd10?.[0] ?? '—')
              : item.mode === 'anime'
                ? (() => {
                    const score = titlePrimaryScore(item)
                    const scoreText = score != null ? score.toFixed(2) : '—'
                    const rankText = item.topRank != null ? `#${item.topRank}` : null
                    return rankText ? `${scoreText} · ${rankText}` : scoreText
                  })()
              : item.mode === 'music'
                ? (() => {
                    const listeners = item.votes?.gamesPlayed
                    return listeners != null
                      ? `${new Intl.NumberFormat('ru-RU', { notation: 'compact', maximumFractionDigits: 1 }).format(listeners)} слуш.`
                      : '—'
                  })()
              : item.mode === 'game'
                ? (item.ratings?.steamPositivePercent != null ? `${Math.round(item.ratings.steamPositivePercent)}%` : item.ratings?.metacritic ?? item.metacritic ?? item.topRank ?? '—')
                : (item.ratings?.kinopoisk?.toFixed(1) ?? '—')}</em>
          </button>) : <div className="empty-search">Ничего не найдено</div>}
        </div>}
        </div>
        {(mode === 'diagnosis' || !!attempts.length) && <div className={`game-match-strip ${gameMatchStripOpen ? 'is-open' : ''}`}>
          <button
            type="button"
            className="game-match-strip__toggle"
            onClick={() => {
              trackMetrikaGoal('toggle_match_strip', { mode, period: effectivePeriod })
              setGameMatchStripOpen((current) => !current)
            }}
            aria-expanded={gameMatchStripOpen}
            aria-controls="game-match-strip-panel"
          >
            <span className="game-match-strip__logo" aria-hidden="true"><img src="./images/symbol.svg" alt="" /></span>
            <span className="game-match-strip__title">Что сходится</span>
            <ChevronRight aria-hidden="true" />
          </button>
          <div className="game-match-strip__panel" id="game-match-strip-panel" aria-hidden={!gameMatchStripOpen}>
            <HorizontalScrollLane className="game-match-strip__tags">
              {matchedTags.length
                ? matchedTags.map((tag) => <span key={tag} className="dx-chip match game-match-strip__tag">{tag}</span>)
                : <span className="game-match-strip__empty">{attempts.length ? 'Пока совпадений нет' : 'Появится после первой попытки'}</span>}
            </HorizontalScrollLane>
          </div>
        </div>}
        {message && <div className="search-meta"><strong>{message}</strong></div>}
      </section>}

      {!attempts.length && status === 'playing' && <section className="empty-card">
        <div className="empty-card__icon">{modeIcon(mode)}</div>
        <div><h2>Начните с {modeMeta(mode).emptyArticle} {modeMeta(mode).subjectGenitive}</h2><p>{mode === 'diagnosis'
          ? 'После ответа появятся сравнения по системе, симптомам, диагностике и коду МКБ.'
          : mode === 'anime'
            ? 'После ответа появятся сравнения по формату, статусу, эпизодам, студии, сэйю и рейтингу Shikimori.'
          : mode === 'music'
            ? 'После ответа появятся сравнения по стране, старту карьеры, десятилетию, типу артиста, сцене и жанрам.'
          : mode === 'game'
            ? 'После ответа появятся сравнения по году, месту в топе, жанрам, категориям Steam и рейтингу.'
            : 'После ответа появятся сравнения по году, жанрам, актёрам, стране и рейтингам.'}</p></div>
        <ActionButton variant="secondary" onClick={() => {
          trackMetrikaGoal('open_rules_from_empty', { mode })
          onRules()
        }}>Как читать подсказки <ChevronRight /></ActionButton>
      </section>}

      {!!attempts.length && <section className="attempt-list">
        <div className="section-title"><span>Ваши попытки</span><strong>{attempts.length}/10</strong></div>
        {attempts.map((attempt, index) => ({ attempt, index })).reverse().map(({ attempt, index }) => {
          const item = titles.find((title) => title.id === attempt.titleId)
          if (!item) return null
          const isCorrectAttempt = answer?.id === attempt.titleId
          return item.mode === 'diagnosis'
            ? <DiagnosisAttemptCard key={`${attempt.titleId}-${index}`} attempt={attempt} item={item} index={index} isCorrectAttempt={isCorrectAttempt} />
            : item.mode === 'game'
              ? <GameAttemptCard key={`${attempt.titleId}-${index}`} attempt={attempt} item={item} index={index} isCorrectAttempt={isCorrectAttempt} />
              : item.mode === 'music'
                ? <MusicAttemptCard key={`${attempt.titleId}-${index}`} attempt={attempt} item={item} index={index} isCorrectAttempt={isCorrectAttempt} />
              : <AttemptCard key={`${attempt.titleId}-${index}`} attempt={attempt} item={item} index={index} isCorrectAttempt={isCorrectAttempt} />
        })}
      </section>}
    </main>

    {hintModalRound && <div className="hint-modal-backdrop" onMouseDown={(event) => event.target === event.currentTarget && dismissHintModal()}>
      <section className="hint-modal" role="dialog" aria-modal="true" aria-labelledby="hint-modal-title">
        <div className="hint-modal__head">
          <span><Sparkles /> Возможность · попытка {hintModalRound}</span>
          <button onClick={dismissHintModal} aria-label="Закрыть"><X /></button>
        </div>
        <h2 id="hint-modal-title">Выберите подсказку</h2>
        <p>{hintModalRound === 5 ? 'Это первая возможность. Если пропустить её сейчас, она всё равно останется доступной до конца сеанса.' : 'Это вторая возможность. Её также можно открыть в любой момент до конца сеанса.'}</p>
        <div className="hint-modal__options">
          {assistHints.map((hint, index) => {
            const isOpen = usedHintsSet.has(hint.key)
            return <button key={hint.key} disabled={isOpen || !hint.available} onClick={() => revealAssistHint(hint.key)}>
              <i>0{index + 1}</i><span><strong>{hint.title}</strong><small>{isOpen ? 'Уже открыта' : !hint.available ? 'Нет данных' : hint.subtitle}</small></span><ChevronRight />
            </button>
          })}
        </div>
        <button className="hint-modal__later" onClick={dismissHintModal}>Не сейчас</button>
      </section>
    </div>}

    {anamnesisOpen && !!anamnesisText && <AnamnesisModal text={anamnesisText} dayNo={dayNumber(date)} onClose={() => setAnamnesisOpen(false)} />}
  </>
}

function Modal({ title, onClose, children }: { title: string; onClose: () => void; children: ReactNode }) {
  return <div className="modal-backdrop" onMouseDown={(event) => event.target === event.currentTarget && onClose()}>
    <div className="modal" role="dialog" aria-modal="true" aria-label={title}>
      <div className="modal-head"><h2>{title}</h2><button onClick={onClose} aria-label="Закрыть"><X /></button></div>
      {children}
    </div>
  </div>
}

function EconomyAwardPanel({ award }: { award: EconomyAward }) {
  if (award.alreadyClaimed) {
    return <div className="ticket-award ticket-award--claimed">
      <Ticket />
      <span>Билеты уже начислены</span>
    </div>
  }

  return <div className="ticket-award">
    <Ticket />
    <strong>+{award.total}</strong>
  </div>
}

function AnamnesisModal({ text, dayNo, onClose, onStart }: {
  text: string
  dayNo: number
  onClose: () => void
  onStart?: () => void
}) {
  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        event.preventDefault()
        onClose()
      }
    }
    window.addEventListener('keydown', onKeyDown, true)
    return () => window.removeEventListener('keydown', onKeyDown, true)
  }, [onClose])

  return <div className="anamnesis-backdrop" onMouseDown={(event) => event.target === event.currentTarget && onClose()}>
    <section className="anamnesis-modal" role="dialog" aria-modal="true" aria-labelledby="anamnesis-title">
      <div className="anamnesis-modal__head">
        <span><Stethoscope /> Амбулаторная карта · Анамнез</span>
        <button onClick={onClose} aria-label="Закрыть"><X /></button>
      </div>
      <div className="anamnesis-modal__patient">
        <span className="anamnesis-modal__avatar" aria-hidden="true"><UserRound /></span>
        <div className="anamnesis-modal__patient-copy">
          <small>Анонимный пациент</small>
          <h2 id="anamnesis-title">Приём № {dayNo}</h2>
          <em>Жалобы записаны со слов пациента</em>
        </div>
      </div>
      <p className="anamnesis-modal__text">{text}</p>
      <div className="anamnesis-modal__note"><HeartPulse /> Поставьте верный диагноз по симптомам за десять попыток.</div>
      <div className="anamnesis-modal__actions">
        {onStart
          ? <ActionButton className="anamnesis-modal__start" onClick={onStart}><Stethoscope /> Взяться за дело</ActionButton>
          : <ActionButton className="anamnesis-modal__start" onClick={onClose}><Check /> Понятно</ActionButton>}
      </div>
    </section>
  </div>
}


function StatsView({ mode, difficulty }: { mode: TitleMode; difficulty?: DifficultyKey }) {
  const stats = loadStats(mode, mode === 'music' ? difficulty : undefined)
  const attendance = loadAttendanceStats()
  const wallet = loadWallet()
  const rate = stats.played ? Math.round(stats.won / stats.played * 100) : 0
  const max = Math.max(1, ...stats.distribution)
  return <>
    <div className="stats-grid stats-grid--economy">
      <div><strong>{wallet.tickets}</strong><span>билетов</span></div>
      <div><strong>{attendance.currentDailyStreak}</strong><span>абонемент</span></div>
      <div><strong>{formatMultiplier(streakMultiplier(attendance.currentDailyStreak))}</strong><span>множитель</span></div>
      <div><strong>{attendance.gracePasses}</strong><span>контрамарки</span></div>
    </div>
    <h3 className="subheading">Статистика темы</h3>
    {mode === 'music' && difficulty && <p className="modal-lead">Сложность: <strong>{DIFFICULTIES[difficulty].label}</strong></p>}
    <div className="stats-grid">
      <div><strong>{stats.played}</strong><span>сеансов</span></div>
      <div><strong>{rate}%</strong><span>побед</span></div>
      <div><strong>{stats.currentStreak}</strong><span>серия побед</span></div>
      <div><strong>{stats.bestStreak}</strong><span>рекорд побед</span></div>
    </div>
    <div className="attendance-line">
      <span>Активных дней: <strong>{attendance.totalActiveDays}</strong></span>
      <span>Полных залов: <strong>{attendance.fullHouseDays}</strong></span>
      <span>Рекорд абонемента: <strong>{attendance.bestDailyStreak}</strong></span>
    </div>
    <h3 className="subheading">Победы по попыткам</h3>
    <div className="distribution">{stats.distribution.map((count, index) => <div key={index}><span>{index + 1}</span><i style={{ width: `${Math.max(6, count / max * 100)}%` }}>{count}</i></div>)}</div>
  </>
}

function EconomyView() {
  const [wallet, setWallet] = useState(loadWallet)
  const [ledger, setLedger] = useState(loadTicketLedger)
  const [promoUsage, setPromoUsage] = useState(loadPromoUsage)
  const [promoCode, setPromoCode] = useState('')
  const [promoMessage, setPromoMessage] = useState('')
  const attendance = loadAttendanceStats()
  const nextAt = nextMultiplierAt(attendance.currentDailyStreak)
  const multiplier = streakMultiplier(attendance.currentDailyStreak)
  const promoUsesLeft = Math.max(0, TICKET_PROMO_LIMIT - (promoUsage[TICKET_PROMO_CODE] ?? 0))
  const notifyEconomyChange = () => window.dispatchEvent(new Event(ECONOMY_CHANGE_EVENT))

  const submitPromoCode = (event: React.FormEvent<HTMLFormElement>) => {
    event.preventDefault()
    const normalizedCode = promoCode.trim().toLocaleUpperCase('ru-RU').replace(/Ё/g, 'Е')
    if (!normalizedCode) {
      trackMetrikaGoal('promo_empty_submit')
      setPromoMessage('Кассир ждёт')
      return
    }

    if (normalizedCode === WIPE_TICKETS_CODE) {
      const currentWallet = loadWallet()
      const nextWallet = { ...currentWallet, tickets: 0 }
      saveWallet(nextWallet)
      addTicketLedgerEntry({
        type: 'spend',
        amount: currentWallet.tickets,
        balanceAfter: 0,
        title: 'Кассирский шёпот',
        detail: 'Код СОСО · билетики обнулены',
      })
      setWallet(nextWallet)
      setLedger(loadTicketLedger())
      setPromoCode('')
      setPromoMessage('Кассир забрал все билетики.')
      trackMetrikaGoal('promo_wipe_tickets', { removed: currentWallet.tickets })
      notifyEconomyChange()
      return
    }

    if (normalizedCode !== TICKET_PROMO_CODE) {
      trackMetrikaGoal('promo_invalid_code')
      setPromoMessage('Кассир не узнал этот код.')
      return
    }

    const used = promoUsage[TICKET_PROMO_CODE] ?? 0
    if (used >= TICKET_PROMO_LIMIT) {
      trackMetrikaGoal('promo_limit_reached')
      setPromoMessage('Этот код уже шептали кассиру три раза.')
      return
    }

    const currentWallet = loadWallet()
    const nextWallet = {
      tickets: currentWallet.tickets + TICKET_PROMO_AWARD,
      lifetimeTickets: currentWallet.lifetimeTickets + TICKET_PROMO_AWARD,
    }
    const nextUsage = { ...promoUsage, [TICKET_PROMO_CODE]: used + 1 }
    saveWallet(nextWallet)
    savePromoUsage(nextUsage)
    addTicketLedgerEntry({
      type: 'earn',
      amount: TICKET_PROMO_AWARD,
      balanceAfter: nextWallet.tickets,
      title: 'Кассирский шёпот',
      detail: `Промокод ${TICKET_PROMO_CODE} · ${used + 1}/${TICKET_PROMO_LIMIT}`,
    })
    setWallet(nextWallet)
    setLedger(loadTicketLedger())
    setPromoUsage(nextUsage)
    setPromoCode('')
    setPromoMessage(`Кассир выдал ${formatTickets(TICKET_PROMO_AWARD)}.`)
    trackMetrikaGoal('promo_ticket_bonus', { amount: TICKET_PROMO_AWARD, usage: used + 1 })
    notifyEconomyChange()
  }

  return <div className="economy-view">
    <div className="stats-grid stats-grid--economy">
      <div><strong>{wallet.tickets}</strong><span>сейчас</span></div>
      <div><strong>{wallet.lifetimeTickets}</strong><span>всего</span></div>
      <div><strong>{attendance.currentDailyStreak}</strong><span>абонемент</span></div>
      <div><strong>{formatMultiplier(multiplier)}</strong><span>множитель</span></div>
    </div>
    <div className="economy-note">
      <Ticket />
      <p>Билеты открывают дополнительные периоды в кино, сериалах, аниме и музыке. Базовый сеанс всегда доступен, а закрытый период можно выбрать заранее.</p>
    </div>
    <p className="modal-lead">Билеты хранятся только в этом браузере на этом устройстве. В другом браузере или на другом устройстве они не переносятся. Если очистить данные сайта, билеты и их история могут исчезнуть.</p>
    <form className="ticket-promo" onSubmit={submitPromoCode}>
      <div className="ticket-promo__copy">
        <span><Ticket /> Шепнуть кассиру</span>
        <small>Неизвестно, сколько раз это сработает</small>
      </div>
      <div className="ticket-promo__row">
        <input value={promoCode} onChange={(event) => setPromoCode(event.target.value)} placeholder="Секретная фраза" autoComplete="off" />
        <button type="submit">Сказать</button>
      </div>
      {promoMessage && <p>{promoMessage}</p>}
    </form>
    <h3 className="subheading">Как начисляется</h3>
    <div className="economy-rules">
      <span><strong>+10</strong> завершить сеанс</span>
      <span><strong>+10</strong> угадать ответ</span>
      <span><strong>+0-9</strong> бонус за попытки</span>
      <span><strong>+5</strong> первый сеанс дня</span>
      <span><strong>+25</strong> полный зал всех режимов</span>
    </div>
    <p className="modal-lead">
      Абонемент продлевается за первый завершённый daily-сеанс дня, даже если ответ не угадан. Первый сеанс дня умножается на текущий множитель. {nextAt ? `До ${formatMultiplier(streakMultiplier(nextAt))}: ${nextAt - attendance.currentDailyStreak} дн.` : 'Максимальный множитель уже активен.'}
    </p>
    <h3 className="subheading">История билетов</h3>
    {ledger.length
      ? <div className="ticket-ledger">{ledger.slice(0, 14).map((entry) => <article className={`ticket-ledger__item ${entry.type}`} key={entry.id}>
          <span>{entry.type === 'earn' ? <Ticket /> : <Lock />}</span>
          <div>
            <strong>{entry.title}</strong>
            <small>{entry.detail} · {new Intl.DateTimeFormat('ru-RU', { day: '2-digit', month: 'short', hour: '2-digit', minute: '2-digit' }).format(new Date(entry.at))}</small>
          </div>
          <em>{entry.type === 'earn' ? '+' : '-'}{entry.amount}</em>
        </article>)}</div>
      : <p className="modal-lead">История появится после первого завершённого сеанса или открытия периода.</p>}
  </div>
}

function RulesView() {
  return <div className="rules-list">
    <p>Выберите тайтл из поиска. После каждой попытки значения сравниваются с ответом дня.</p>
    <p>Перед 5-й и 8-й попытками можно открыть по одной из трёх дополнительных подсказок.</p>
    <p>В режиме «Аниме» сравниваются формат, статус, эпизоды, студия, сэйю и рейтинг Shikimori.</p>
    <p>В режиме «Игры» дополнительно сравниваются позиция в топе, метрики Steam и Metacritic.</p>
    <p>В режиме «Музыка» сравниваются страна, старт карьеры, десятилетие, тип артиста, статус карьеры, сцена и жанры.</p>
    <p>Топ-трек, топ-альбом и похожие артисты открываются как дополнительные подсказки и не увеличивают основной счетчик совпадений.</p>
    <div><i className="match" /><span><strong>Точно</strong> — значение совпало.</span></div>
    <div><i className="close" /><span><strong>Рядом</strong> — число близко или есть частичное совпадение.</span></div>
    <div><i className="miss" /><span><strong>Мимо</strong> — значение не совпало.</span></div>
    <p>Стрелка показывает, выше или ниже находится правильный год, рейтинг, хронометраж или количество сезонов.</p>
  </div>
}

function ResumeSessionsView({ sessions, onOpen }: {
  sessions: SavedGame[]
  onOpen: (session: SavedGame) => void
}) {
  return <>
    <p className="modal-lead">Незавершенные игры сохраняются автоматически. Выберите сохраненную игру, чтобы продолжить.</p>
    <div className="resume-list">
      {sessions.map((session) => {
        const attemptText = `${session.attempts.length}/10`
        const sessionLabel = session.mode === 'diagnosis' ? 'Прием' : 'Сеанс'
        const periodText = session.mode === 'movie' || session.mode === 'series' || session.mode === 'anime' || session.mode === 'music' ? PERIODS[session.period]?.short ?? 'Период не задан' : 'Без периода'
        return <article className="resume-item" key={session.key}>
          <button className="resume-item__open" onClick={() => onOpen(session)}>
            <span className="resume-item__mode">{modeIcon(session.mode)}<i>{modeMeta(session.mode).title}</i></span>
            <strong>{prettyDate(session.date)} · {sessionLabel} №{dayNumber(session.date)}</strong>
            <small>{periodText} · Попытки: {attemptText}</small>
          </button>
        </article>
      })}
    </div>
  </>
}

export default function App() {
  const [screen, setScreen] = useState<AppScreen>('hub')
  const [transition, setTransition] = useState<'idle' | 'title-to-game'>('idle')
  const [mode, setMode] = useState<TitleMode>('movie')
  const [period, setPeriod] = useState<PeriodKey>('all')
  const [difficulty, setDifficulty] = useState<DifficultyKey>('medium')
  const [date, setDate] = useState(getMoscowDate())
  const [adminDailySalt, setAdminDailySalt] = useState(0)
  const [gameBackTarget, setGameBackTarget] = useState<'title' | 'rewatch' | 'hub'>('title')
  const [reviewBackTarget, setReviewBackTarget] = useState<'hub' | 'title' | 'rewatch'>('hub')
  const { data, titleCounts, caseVignettes, loading, globalDailySalt, searchIndex } = useDataLoader(mode)
  const [modal, setModal] = useState<'stats' | 'rules' | 'resume' | 'anamnesis' | null>(null)
  const [economyVersion, setEconomyVersion] = useState(0)
  const transitionTimerRef = useRef<number | null>(null)
  const screenHistoryReadyRef = useRef(false)
  const screenFromPopStateRef = useRef(false)
  const lastScreenRef = useRef<AppScreen>('hub')
  const lastTrackedScreenRef = useRef<AppScreen | null>(null)
  const adminDailySaltRef = useRef(0)
  const globalDailySaltRef = useRef(0)
  const effectiveDailySalt = globalDailySalt + adminDailySalt
  const wallet = useMemo(() => loadWallet(), [economyVersion])
  const todayAttendance = useMemo(() => loadDailyAttendance(getMoscowDate()), [economyVersion])
  const freePlayLaunchesToday = useMemo(() => loadFreePlayUsage(getMoscowDate()), [economyVersion])
  const freePlayCostValue = useMemo(() => freePlayCost(freePlayLaunchesToday), [freePlayLaunchesToday])
  const freePlayShortage = Math.max(0, freePlayCostValue - wallet.tickets)
  const periodUnlocks = useMemo(() => loadPeriodUnlocks(), [economyVersion])
  const currentUnlockedPeriods = useMemo(() => unlockedPeriodsFor(mode, periodUnlocks), [mode, periodUnlocks])
  const musicDifficultyCounts = useMemo<Record<DifficultyKey, number> | null>(() => {
    if (!data.music.length) return null
    const base = poolFor(data.music, 'music', 'all')
    return {
      easy: musicDifficultyPool(base, 'easy').length,
      medium: musicDifficultyPool(base, 'medium').length,
      hard: musicDifficultyPool(base, 'hard').length,
      expert: musicDifficultyPool(base, 'expert').length,
      // Legacy property: DifficultyControl renders only DIFFICULTY_ORDER, where
      // the separate experimental option is intentionally absent.
      experimental: musicDifficultyPool(base, 'expert').length,
    }
  }, [data.music])
  const refreshEconomy = () => setEconomyVersion((version) => version + 1)

  useEffect(() => {
    window.addEventListener(ECONOMY_CHANGE_EVENT, refreshEconomy)
    return () => window.removeEventListener(ECONOMY_CHANGE_EVENT, refreshEconomy)
  }, [])

  useEffect(() => {
    if ((mode === 'diagnosis' || mode === 'game') && period !== 'all') {
      setPeriod('all')
    }
  }, [mode, period])

  useEffect(() => {
    adminDailySaltRef.current = adminDailySalt
  }, [adminDailySalt])

  useEffect(() => {
    globalDailySaltRef.current = globalDailySalt
  }, [globalDailySalt])

  useEffect(() => {
    markAppFirstRender()
  }, [])

  const archiveDates = Array.from({ length: 7 }, (_, offset) => {
    const day = new Date(`${getMoscowDate()}T12:00:00+03:00`)
    day.setDate(day.getDate() - offset)
    return getMoscowDate(day)
  })
  const clearTransitionTimer = () => {
    if (transitionTimerRef.current !== null) {
      window.clearTimeout(transitionTimerRef.current)
      transitionTimerRef.current = null
    }
  }

  useEffect(() => {
    const adminWindow = window as AdminWindow
    const openAdminSession = () => {
      clearTransitionTimer()
      setTransition('idle')
      setModal(null)
      setScreen('game')
      window.scrollTo({ top: 0 })
    }

    adminWindow.__SEANS_ADMIN_NEW_DAILY__ = (saltStep = 1) => {
      const parsedStep = toInteger(saltStep, 1)
      const safeStep = parsedStep === 0 ? 1 : parsedStep
      const nextSalt = adminDailySaltRef.current + safeStep
      adminDailySaltRef.current = nextSalt
      setAdminDailySalt(nextSalt)
      openAdminSession()
      return nextSalt
    }

    adminWindow.__SEANS_ADMIN_SET_DAILY_SALT__ = (saltValue = 0) => {
      const nextSalt = toInteger(saltValue, 0)
      adminDailySaltRef.current = nextSalt
      setAdminDailySalt(nextSalt)
      openAdminSession()
      return nextSalt
    }

    adminWindow.__SEANS_ADMIN_GET_DAILY_SALT__ = () => globalDailySaltRef.current + adminDailySaltRef.current

    adminWindow.SEANS_ADMIN_NEW_DAILY = adminWindow.__SEANS_ADMIN_NEW_DAILY__
    adminWindow.SEANS_ADMIN_SET_DAILY_SALT = adminWindow.__SEANS_ADMIN_SET_DAILY_SALT__
    adminWindow.SEANS_ADMIN_GET_DAILY_SALT = adminWindow.__SEANS_ADMIN_GET_DAILY_SALT__

    return () => {
      delete adminWindow.__SEANS_ADMIN_NEW_DAILY__
      delete adminWindow.__SEANS_ADMIN_SET_DAILY_SALT__
      delete adminWindow.__SEANS_ADMIN_GET_DAILY_SALT__
      delete adminWindow.SEANS_ADMIN_NEW_DAILY
      delete adminWindow.SEANS_ADMIN_SET_DAILY_SALT
      delete adminWindow.SEANS_ADMIN_GET_DAILY_SALT
    }
  }, [])

  useEffect(() => clearTransitionTimer, [])

  useEffect(() => {
    if (!screenHistoryReadyRef.current) {
      window.history.replaceState({ seansScreen: screen }, '')
      screenHistoryReadyRef.current = true
      lastScreenRef.current = screen
      return
    }
    if (screenFromPopStateRef.current) {
      screenFromPopStateRef.current = false
      lastScreenRef.current = screen
      return
    }
    if (lastScreenRef.current !== screen) {
      window.history.pushState({ seansScreen: screen }, '')
      lastScreenRef.current = screen
    }
  }, [screen])

  useEffect(() => {
    document.body.dataset.seansScreen = screen
    if (lastTrackedScreenRef.current === screen) return
    lastTrackedScreenRef.current = screen
    trackMetrikaScreen(screen, {
      mode,
      period,
      date,
    })
  }, [screen, mode, period, date])

  useEffect(() => {
    const onPopState = (event: PopStateEvent) => {
      const nextScreen = event.state?.seansScreen
      if (!isAppScreen(nextScreen)) return

      if (transitionTimerRef.current !== null) {
        window.clearTimeout(transitionTimerRef.current)
        transitionTimerRef.current = null
      }
      screenFromPopStateRef.current = true
      setTransition('idle')
      setModal(null)
      setScreen(nextScreen)
      window.scrollTo({ top: 0 })
    }

    window.addEventListener('popstate', onPopState)
    return () => window.removeEventListener('popstate', onPopState)
  }, [])

  const setModeSafe = (nextMode: TitleMode) => {
    setMode(nextMode)
    if (nextMode === 'diagnosis' || nextMode === 'game') {
      setPeriod('all')
    }
  }

  const moveToScreen = (target: 'hub' | 'title' | 'rewatch') => {
    clearTransitionTimer()
    setTransition('idle')
    if (target === 'hub') {
      setDate(getMoscowDate())
    }
    setScreen(target)
    setModal(null)
    window.scrollTo({ top: 0 })
  }

  const games = useMemo(() => allGames(), [screen])
  const currentCompletedPeriods = useMemo(() => {
    if (!canUnlockPeriods(mode)) return [] as PeriodKey[]
    const completed = new Set<PeriodKey>()
    for (const savedGame of games) {
      if (savedGame.mode !== mode) continue
      if (savedGame.status !== 'won' && savedGame.status !== 'lost') continue
      completed.add(savedGame.period)
    }
    return PERIOD_UNLOCK_ORDER.filter((periodKey) => completed.has(periodKey))
  }, [games, mode])
  const activeGames = useMemo(() => games.filter((game) => game.status === 'playing').sort((a, b) => b.updatedAt - a.updatedAt), [games])
  const diagnosisAnamnesis = useMemo(() => {
    if (mode !== 'diagnosis' || !data.diagnosis.length) return null
    const pool = poolFor(data.diagnosis, 'diagnosis', 'all')
    if (!pool.length) return null
    const answer = dailyTitle(pool, 'diagnosis', 'all', getMoscowDate(), effectiveDailySalt)
    if (!answer) return null
    const vignette = pickDailyVignette(caseVignettes[answer.id] ?? [], answer.id, getMoscowDate())
    return vignette?.text ? { text: vignette.text } : null
  }, [mode, data.diagnosis, caseVignettes, effectiveDailySalt])
  const goHome = () => moveToScreen('hub')
  const goBackFromTitle = () => moveToScreen('hub')
  const goBackFromGame = () => moveToScreen(gameBackTarget)
  const goBackFromReview = () => moveToScreen(reviewBackTarget)

  useEffect(() => {
    if (modal === 'resume' && !activeGames.length) {
      setModal(null)
    }
  }, [modal, activeGames.length])

  const openSavedSession = (savedGame: SavedGame, backTarget: 'hub' | 'rewatch' = 'hub') => {
    trackMetrikaGoal('open_saved_session', { mode: savedGame.mode, status: savedGame.status, backTarget })
    clearTransitionTimer()
    setTransition('idle')
    setGameBackTarget(backTarget)
    setModeSafe(savedGame.mode)
    setPeriod(savedGame.mode === 'movie' || savedGame.mode === 'series' || savedGame.mode === 'anime' ? savedGame.period : 'all')
    if (savedGame.mode === 'music' && savedGame.difficulty) setDifficulty(savedGame.difficulty)
    setDate(savedGame.date)
    setScreen('game')
    setModal(null)
    window.scrollTo({ top: 0 })
  }

  const resumeActiveSession = () => {
    if (!activeGames.length) return
    trackMetrikaGoal('resume_active_session', { count: activeGames.length })
    if (activeGames.length === 1) {
      openSavedSession(activeGames[0], 'hub')
      return
    }
    setModal('resume')
  }

  const selectCategory = (nextMode: TitleMode) => {
    trackMetrikaGoal('select_mode', { mode: nextMode })
    clearTransitionTimer()
    setTransition('idle')
    setModeSafe(nextMode)
    setDate(getMoscowDate())
    setScreen('title')
    setModal(null)
    window.scrollTo({ top: 0 })
  }

  const openMusicReview = () => {
    trackMetrikaGoal('open_music_review_screen', { from: screen })
    clearTransitionTimer()
    setTransition('idle')
    setModal(null)
    const backTarget = screen === 'title' || screen === 'rewatch' ? screen : 'hub'
    setReviewBackTarget(backTarget)
    setScreen('review')
    window.scrollTo({ top: 0 })
  }
  const buyPeriodUnlock = (periodKey: PeriodKey) => {
    if (!canUnlockPeriods(mode)) return false
    if (isPeriodUnlocked(mode, periodKey, periodUnlocks)) {
      trackMetrikaGoal('select_period', { mode, period: periodKey, alreadyUnlocked: true })
      setPeriod(periodKey)
      return true
    }
    const cost = periodUnlockCost(periodKey)
    const currentWallet = loadWallet()
    if (currentWallet.tickets < cost) return false
    const nextWallet = { ...currentWallet, tickets: currentWallet.tickets - cost }
    saveWallet(nextWallet)
    addTicketLedgerEntry({
      type: 'spend',
      amount: cost,
      balanceAfter: nextWallet.tickets,
      title: 'Открыт период',
      detail: `${modeMeta(mode).plural} · ${PERIODS[periodKey].label}`,
      mode,
      period: periodKey,
    })
    unlockPeriod(mode, periodKey)
    trackMetrikaGoal('unlock_period', { mode, period: periodKey, cost })
    setPeriod(periodKey)
    refreshEconomy()
    return true
  }
  const playToday = () => {
    if (transition === 'title-to-game') return
    trackMetrikaGoal('start_session', { mode, period })
    adminDailySaltRef.current = 0
    setAdminDailySalt(0)
    const backTarget = screen === 'rewatch' ? 'rewatch' : screen === 'title' ? 'title' : 'hub'
    setGameBackTarget(backTarget)
    setDate(getMoscowDate())
    setModal(null)
    window.scrollTo({ top: 0 })
    if (screen !== 'title') {
      clearTransitionTimer()
      setTransition('idle')
      setScreen('game')
      return
    }
    setTransition('title-to-game')
    clearTransitionTimer()
    transitionTimerRef.current = window.setTimeout(() => {
      setScreen('game')
      setTransition('idle')
      transitionTimerRef.current = null
    }, 460)
  }
  const startFreePlay = () => {
    if (transition === 'title-to-game') return
    if (!FREE_PLAY_MODES.has(mode)) return

    const today = getMoscowDate()
    const launchesToday = loadFreePlayUsage(today)
    const launchCost = freePlayCost(launchesToday)
    const currentWallet = loadWallet()
    if (currentWallet.tickets < launchCost) return

    const nextWallet = { ...currentWallet, tickets: currentWallet.tickets - launchCost }
    saveWallet(nextWallet)
    const nextLaunchNumber = consumeFreePlayUsage(today)
    addTicketLedgerEntry({
      type: 'spend',
      amount: launchCost,
      balanceAfter: nextWallet.tickets,
      title: 'Свободная игра',
      detail: `${modeMeta(mode).plural} · запуск #${nextLaunchNumber}`,
      date: today,
      mode,
      period: 'all',
    })
    trackMetrikaGoal('start_free_play', {
      mode,
      launchCost,
      nextLaunchNumber,
    })

    const backTarget = screen === 'rewatch' ? 'rewatch' : screen === 'title' ? 'title' : 'hub'
    setGameBackTarget(backTarget)
    setPeriod('all')
    setDate(today)
    setModal(null)
    window.scrollTo({ top: 0 })

    const nextSalt = adminDailySaltRef.current + 1
    adminDailySaltRef.current = nextSalt
    setAdminDailySalt(nextSalt)
    refreshEconomy()

    if (screen !== 'title') {
      clearTransitionTimer()
      setTransition('idle')
      setScreen('game')
      return
    }

    setTransition('title-to-game')
    clearTransitionTimer()
    transitionTimerRef.current = window.setTimeout(() => {
      setScreen('game')
      setTransition('idle')
      transitionTimerRef.current = null
    }, 460)
  }
  const openArchive = (archiveDate: string, savedGame: SavedGame | null) => {
    trackMetrikaGoal('open_archive_day', { hasSavedSession: Boolean(savedGame) })
    if (savedGame) {
      openSavedSession(savedGame, 'rewatch')
      return
    }
    clearTransitionTimer()
    setTransition('idle')
    setGameBackTarget('rewatch')
    setDate(archiveDate)
    setScreen('game')
    setModal(null)
    window.scrollTo({ top: 0 })
  }
  const appTone = transition === 'title-to-game' ? 'transition-game' : screen

  return <div className={`app app--${appTone}`}>
    {screen === 'hub' && <HubScreen onSelect={selectCategory} onRewatch={() => setScreen('rewatch')} onStats={() => setModal('stats')} onRules={() => setModal('rules')} onReview={openMusicReview} onResume={resumeActiveSession} activeSessionsCount={activeGames.length} titleCounts={titleCounts} todayAttendance={todayAttendance} />}

    {screen === 'title' && <TitleScreen mode={mode} period={period} setPeriod={setPeriod} date={getMoscowDate()} onHome={goHome} onBack={goBackFromTitle} onPlay={playToday} onRewatch={() => setScreen('rewatch')} onStats={() => setModal('stats')} onRules={() => setModal('rules')} onReview={openMusicReview} isLeaving={transition === 'title-to-game'} onReadAnamnesis={() => setModal('anamnesis')} hasAnamnesis={Boolean(diagnosisAnamnesis)} wallet={wallet} unlockedPeriods={currentUnlockedPeriods} completedPeriods={currentCompletedPeriods} onUnlockPeriod={buyPeriodUnlock} onStartFreePlay={startFreePlay} freePlayCostValue={freePlayCostValue} freePlayShortage={freePlayShortage} freePlayLaunchesToday={freePlayLaunchesToday} difficulty={difficulty} setDifficulty={setDifficulty} difficultyCounts={musicDifficultyCounts} />}

    {screen === 'rewatch' && <RewatchScreen mode={mode} setMode={setModeSafe} period={period} dates={archiveDates} games={games} onOpen={openArchive} onHome={goHome} onStats={() => setModal('stats')} onRules={() => setModal('rules')} onReview={openMusicReview} />}

    {screen === 'review' && <MusicReviewScreen onHome={goHome} onBack={goBackFromReview} onRewatch={() => setScreen('rewatch')} onStats={() => setModal('stats')} onRules={() => setModal('rules')} onReview={openMusicReview} />}

    {screen === 'game' && (loading
      ? <div className="loading"><Sparkles /> Настраиваем проектор…</div>
      : <Game
          titles={data[mode]}
          mode={mode}
          period={period}
          difficulty={difficulty}
          date={date}
          dailySalt={effectiveDailySalt}
          isPracticeSession={adminDailySalt !== 0}
          setDate={setDate}
          onHome={goHome}
          onBack={goBackFromGame}
          onArchive={() => setScreen('rewatch')}
          onStats={() => setModal('stats')}
          onRules={() => setModal('rules')}
          onReview={openMusicReview}
          onEconomyChange={refreshEconomy}
          caseVignettes={caseVignettes}
          searchIndex={searchIndex}
        />)}

    {modal === 'rules' && <Modal title="Как играть" onClose={() => setModal(null)}><RulesView /></Modal>}
    {modal === 'stats' && <Modal title="Статистика" onClose={() => setModal(null)}><div className="modal-mode">{modeMeta(mode).plural}</div><StatsView mode={mode} difficulty={mode === 'music' ? difficulty : undefined} /></Modal>}
    {modal === 'resume' && <Modal title="Вернуться к игре" onClose={() => setModal(null)}><ResumeSessionsView sessions={activeGames} onOpen={(session) => openSavedSession(session, 'hub')} /></Modal>}
    {modal === 'anamnesis' && diagnosisAnamnesis && <AnamnesisModal text={diagnosisAnamnesis.text} dayNo={dayNumber(getMoscowDate())} onClose={() => setModal(null)} onStart={() => { setModal(null); playToday() }} />}
  </div>
}

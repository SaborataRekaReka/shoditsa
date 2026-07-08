import { useCallback, useEffect, useMemo, useReducer, useRef, useState, type ButtonHTMLAttributes, type CSSProperties, type ReactNode } from 'react'
import {
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
import { markAppFirstRender, markSearchDuration } from './app/metrics'
import { compareTitles, dailyTitle, getMoscowDate, PERIODS, pickDailyVignette, poolFor, prettyDate, resultText, searchTitles } from './game'
import { createInitialGameSessionState, gameSessionReducer } from './game/session-reducer'
import { useDataLoader } from './hooks/use-data-loader'
import { useDebouncedValue } from './hooks/use-debounced-value'
import { addTicketLedgerEntry, allGames, consumeFreePlayUsage, gameKey, isPeriodUnlocked, loadAttendanceStats, loadDailyAttendance, loadFreePlayUsage, loadGame, loadPeriodUnlocks, loadStats, loadTicketLedger, loadWallet, saveAttendanceStats, saveDailyAttendance, saveGame, saveStats, saveWallet, unlockPeriod, unlockedPeriodsFor } from './storage'
import type { AttendanceStats, AssistHintKey, Attempt, CaseVignetteMap, DailyAttendance, GameStatus, HintCheckpoint, HintChoice, HintPerson, LibrarySearchIndex, PeriodKey, Person, SavedGame, Stats, TitleItem, TitleMode, Wallet } from './types'

const normalizeTextMatch = (value: string) => value.toLocaleLowerCase('ru-RU').replace(/ё/g, 'е')
const modeIcon = (mode: TitleMode) => mode === 'movie'
  ? <Film />
  : mode === 'series'
    ? <Tv />
    : mode === 'anime'
      ? <Sparkles />
      : mode === 'game'
        ? <Gamepad2 />
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
const FREE_PLAY_BASE_COST = 45
const FREE_PLAY_COST_STEP = 15
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
const completionSessionKey = (mode: TitleMode, period: PeriodKey, date: string) => gameKey(mode, period, date)
const periodUnlockCost = (period: PeriodKey) => PERIOD_UNLOCK_COSTS[period] ?? 0
const canUnlockPeriods = (mode: TitleMode) => UNLOCKABLE_PERIOD_MODES.has(mode)
const formatTickets = (count: number) => `${count} ${countWord(count, ['билет', 'билета', 'билетов'])}`
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

type AppScreen = 'hub' | 'title' | 'game' | 'rewatch'
const isAppScreen = (value: unknown): value is AppScreen => value === 'hub' || value === 'title' || value === 'game' || value === 'rewatch'
type AdminWindow = Window & {
  __SEANS_ADMIN_NEW_DAILY__?: (saltStep?: number | string) => number
  __SEANS_ADMIN_SET_DAILY_SALT__?: (saltValue?: number | string) => number
  __SEANS_ADMIN_GET_DAILY_SALT__?: () => number
  SEANS_ADMIN_NEW_DAILY?: (saltStep?: number | string) => number
  SEANS_ADMIN_SET_DAILY_SALT?: (saltValue?: number | string) => number
  SEANS_ADMIN_GET_DAILY_SALT?: () => number
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
  if (item.mode === 'movie' || item.mode === 'series') return item.ratings?.kinopoisk ?? null
  return null
}
const ratingBadge = (item: TitleItem) => {
  if (item.mode === 'anime') {
    const value = titlePrimaryScore(item)
    return { label: 'SHIKI', value: value != null ? value.toFixed(2) : '—' }
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
const hintProgressScore = (hint: Attempt['hints'][number]) => {
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

const dayNumber = (date: string) => {
  const start = Date.UTC(2026, 0, 1)
  const current = Date.parse(`${date}T00:00:00Z`)
  return Math.max(1, Math.floor((current - start) / 86_400_000) + 1)
}

const recordDailyCompletion = (mode: TitleMode, period: PeriodKey, date: string, won: boolean, attemptsCount: number): EconomyAward => {
  const sessionKey = completionSessionKey(mode, period, date)
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
    detail: `${modeMeta(mode).daily} · ${won ? 'угадан' : 'ответ открыт'} · ${attemptsCount}/10`,
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
  return item.posterUrl && !failed
    ? <img className={className} src={item.posterUrl} alt={`Постер «${item.titleRu}»`} onError={() => setFailed(true)} />
    : <div className={`${className} poster-fallback`}>
      {item.mode !== 'diagnosis' ? modeIcon(item.mode) : null}
      <span>{item.titleRu}</span>
    </div>
}

function BrandLogo({ className = '' }: { className?: string }) {
  return <img className={className} src="./images/logo.svg" alt="Сходится!" />
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
}) {
  const [open, setOpen] = useState(false)
  const wrapRef = useRef<HTMLDivElement | null>(null)
  const closePeriodMenu = useCallback(() => setOpen(false), [])
  const unlocked = new Set(unlockedPeriods)
  const selectedLocked = !unlocked.has(value)
  const selectedCost = periodUnlockCost(value)
  const shortage = Math.max(0, selectedCost - wallet.tickets)
  useDismissOnOutside(open, wrapRef, closePeriodMenu)

  return <div ref={wrapRef} className={`period-select-wrap ${open ? 'is-open' : ''}`}>
    <button type="button" className={`period-control period-control--custom ${selectedLocked ? 'is-locked' : ''}`} onClick={(event) => {
      event.stopPropagation()
      setOpen((current) => !current)
    }} aria-expanded={open}>
      <span className="period-control__top">
        <span>Период</span>
        <strong><Ticket /> {wallet.tickets}</strong>
      </span>
      <span className="period-control__value">
        {selectedLocked && <Lock />}
        <span>{PERIODS[value].label}</span>
        <ChevronRight />
      </span>
    </button>
    {open && <div className="period-menu" role="listbox" aria-label="Период">
      {PERIOD_UNLOCK_ORDER.map((periodKey) => {
        const isUnlocked = unlocked.has(periodKey)
        const isActive = value === periodKey
        const cost = periodUnlockCost(periodKey)
        return <button
          type="button"
          key={periodKey}
          className={`period-option ${isActive ? 'active' : ''} ${isUnlocked ? 'unlocked' : 'locked'}`}
          onClick={(event) => {
            event.stopPropagation()
            onChange(periodKey)
            setOpen(false)
          }}
          role="option"
          aria-selected={isActive}
        >
          <span className="period-option__lock">{isUnlocked ? <Check /> : <Lock />}</span>
          <span className="period-option__copy">
            <strong>{PERIODS[periodKey].label}</strong>
            <small>{periodKey === 'all' ? 'Главный сеанс' : isUnlocked ? 'Открыт' : `${cost} билетов`}</small>
          </span>
        </button>
      })}
      {(mode === 'movie' || mode === 'series' || mode === 'anime') && <button
        type="button"
        className={`period-option period-option--free-play ${freePlayShortage > 0 ? 'locked' : 'unlocked'}`}
        onClick={(event) => {
          event.stopPropagation()
          if (freePlayShortage > 0) return
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

function AppHeader({ onHome, onArchive, onStats, onRules }: {
  onHome: () => void
  onArchive: () => void
  onStats: () => void
  onRules: () => void
}) {
  const [economyOpen, setEconomyOpen] = useState(false)
  const wallet = loadWallet()
  const attendance = loadAttendanceStats()
  return <>
    <header className="app-header">
      <div className="app-header__inner">
        <button className="brand" aria-label="На главный экран" onClick={onHome}><BrandLogo /></button>
        <button className="header-economy" aria-label="Билеты и абонемент" onClick={() => setEconomyOpen(true)}>
          <span><Ticket /> <strong>{wallet.tickets}</strong></span>
          <span><Trophy /> <strong>{attendance.currentDailyStreak}</strong><i>дн.</i></span>
        </button>
        <nav aria-label="Навигация">
          <button onClick={onRules} aria-label="Как играть"><CircleHelp /></button>
          <button onClick={onArchive} aria-label="Архив"><Archive /></button>
          <button onClick={onStats} aria-label="Статистика"><BarChart3 /></button>
        </nav>
      </div>
    </header>
    {economyOpen && <Modal title="Билеты" onClose={() => setEconomyOpen(false)}><EconomyView /></Modal>}
  </>
}

function HubScreen({ onSelect, onRewatch, onStats, onRules, onResume, activeSessionsCount, titleCounts, todayAttendance }: {
  onSelect: (mode: TitleMode) => void
  onRewatch: () => void
  onStats: () => void
  onRules: () => void
  onResume: () => void
  activeSessionsCount: number
  titleCounts: { movie: number | null; series: number | null; anime: number | null; game: number | null; diagnosis: number | null }
  todayAttendance: DailyAttendance
}) {
  const futureCategories = [
    { title: 'Музыка', copy: 'Угадайте группу или исполнителя', icon: <Music2 /> },
    { title: 'Города', copy: 'Найдите город по его признакам', icon: <MapPin /> },
  ]
  const availableNowCount = MODE_TABS.length
  const scrollToGames = () => document.getElementById('available-games')?.scrollIntoView({ behavior: 'smooth', block: 'start' })

  return <>
    <AppHeader onHome={() => undefined} onArchive={onRewatch} onStats={onStats} onRules={onRules} />
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
            <ActionButton onClick={scrollToGames}><Play /> Играть сейчас</ActionButton>
            {activeSessionsCount > 0
              ? <ActionButton variant="secondary" onClick={onResume}><RotateCcw /> {activeSessionsCount > 1 ? `Вернуться к игре (${activeSessionsCount})` : 'Вернуться к игре'}</ActionButton>
              : <ActionButton variant="secondary" onClick={onRules}><CircleHelp /> Как это работает</ActionButton>}
          </div>
        </div>
        <div className="hub-hero__visual" aria-hidden="true">
          <img src="./images/hero.png" alt="" />
        </div>
      </section>

      <section className="category-section" id="available-games">
        <div className="category-heading"><span>Доступно сейчас</span><small>{String(availableNowCount).padStart(2, '0')} игры</small></div>
        <div className="category-grid category-grid--active">
          <button className="category-card category-card--movie" onClick={() => onSelect('movie')}>
            <div className="category-card__head">
              <span className="category-card__icon"><Film /></span>
              <span className="category-card__pool"><b>{titleCounts.movie ?? '—'}</b> в пуле</span>
            </div>
            <i>{todayAttendance.completedModes.includes('movie') ? 'Штамп получен' : 'Ежедневная игра'}</i><h2>Кино</h2>
            <p>Угадайте фильм по актёрам, жанрам, году и рейтингам.</p>
            <strong>Играть <ChevronRight /></strong>
          </button>
          <button className="category-card category-card--series" onClick={() => onSelect('series')}>
            <div className="category-card__head">
              <span className="category-card__icon"><Tv /></span>
              <span className="category-card__pool"><b>{titleCounts.series ?? '—'}</b> в пуле</span>
            </div>
            <i>{todayAttendance.completedModes.includes('series') ? 'Штамп получен' : 'Ежедневная игра'}</i><h2>Сериалы</h2>
            <p>Найдите сериал, сравнивая создателей, каст и периоды.</p>
            <strong>Играть <ChevronRight /></strong>
          </button>
          <button className="category-card category-card--anime" onClick={() => onSelect('anime')}>
            <div className="category-card__head">
              <span className="category-card__icon"><Sparkles /></span>
              <span className="category-card__pool"><b>{titleCounts.anime ?? '—'}</b> в пуле</span>
            </div>
            <i>{todayAttendance.completedModes.includes('anime') ? 'Штамп получен' : 'Ежедневная игра'}</i><h2>Аниме</h2>
            <p>Угадайте аниме по формату, эпизодам, студии, сэйю и рангу в популярности.</p>
            <strong>Играть <ChevronRight /></strong>
          </button>
          <button className="category-card category-card--game" onClick={() => onSelect('game')}>
            <div className="category-card__head">
              <span className="category-card__icon"><Gamepad2 /></span>
              <span className="category-card__pool"><b>{titleCounts.game ?? '—'}</b> в пуле</span>
            </div>
            <i>{todayAttendance.completedModes.includes('game') ? 'Штамп получен' : 'Ежедневная игра'}</i><h2>Игры</h2>
            <p>Угадайте игру по жанрам, рейтингу, месту в топе и метрикам Steam.</p>
            <strong>Играть <ChevronRight /></strong>
          </button>
          <button className="category-card category-card--diagnosis" onClick={() => onSelect('diagnosis')}>
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

function TitleScreen({ mode, period, setPeriod, date, onHome, onBack, onPlay, onRewatch, onStats, onRules, isLeaving, onReadAnamnesis, hasAnamnesis, wallet, unlockedPeriods, onUnlockPeriod, onStartFreePlay, freePlayCostValue, freePlayShortage, freePlayLaunchesToday }: {
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
  isLeaving?: boolean
  onReadAnamnesis: () => void
  hasAnamnesis: boolean
  wallet: Wallet
  unlockedPeriods: PeriodKey[]
  onUnlockPeriod: (period: PeriodKey) => boolean
  onStartFreePlay: () => void
  freePlayCostValue: number
  freePlayShortage: number
  freePlayLaunchesToday: number
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
    <AppHeader onHome={onHome} onArchive={onRewatch} onStats={onStats} onRules={onRules} />
    <main className={`title-screen ${isLeaving ? 'is-leaving' : ''}`}>
      <div className="screen-back-row">
        <button className="screen-back" onClick={onBack} aria-label="Назад"><ChevronLeft /></button>
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
                    <span className="game-case__disc" aria-hidden="true"><i /></span>
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
          : <section className="admit-ticket">
              <div className="admit-ticket__stub">
                <span>ВХОД</span><strong>ОДИН</strong><small>№ {dayNumber(date)}</small><em>{date.slice(8,10)}.{date.slice(5,7)}</em><i />
              </div>
              <div className="admit-ticket__body">
                <div className="ticket-kicker"><span>Ежедневная премьера</span><i /> <small>полночный сеанс</small></div>
                <h1>Ежедневная игра: {modeMeta(mode).lower}</h1>
                <p>Каждый день доступна новая загадка. У вас есть <strong>10 попыток</strong>, а каждый ответ открывает сравнительные подсказки.</p>
                <div className="ticket-settings">
                  <PeriodControl mode={mode} value={period} onChange={setPeriod} onStartFreePlay={onStartFreePlay} freePlayCostValue={freePlayCostValue} freePlayShortage={freePlayShortage} freePlayLaunchesToday={freePlayLaunchesToday} wallet={wallet} unlockedPeriods={unlockedPeriods} />
                </div>
              </div>
            </section>}
        {mode !== 'game' && <ActionButton className={`play-button ${!canStart ? 'is-disabled' : ''}`} onClick={startSelectedPeriod} disabled={!canStart}><Play /> {playButtonLabel} {canStart && <span className="keycap-hint keycap-hint--inline" aria-hidden="true">Enter</span>}</ActionButton>}
      </section>
    </main>
  </>
}

function RewatchScreen({ mode, setMode, period, dates, games, onOpen, onHome, onStats, onRules }: {
  mode: TitleMode
  setMode: (mode: TitleMode) => void
  period: PeriodKey
  dates: string[]
  games: SavedGame[]
  onOpen: (date: string, game: SavedGame | null) => void
  onHome: () => void
  onStats: () => void
  onRules: () => void
}) {
  const latestByUpdatedAt = (items: SavedGame[]): SavedGame | null => {
    if (!items.length) return null
    return items.reduce((best, current) => current.updatedAt > best.updatedAt ? current : best)
  }

  return <>
    <AppHeader onHome={onHome} onArchive={() => undefined} onStats={onStats} onRules={onRules} />
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
            ? `${played.status === 'won' ? 'Угадан' : played.status === 'lost' ? 'Не угадан' : 'В процессе'}${played.mode === 'movie' || played.mode === 'series' || played.mode === 'anime' ? ` · ${PERIODS[played.period].short}` : ''}`
            : 'Не сыгран'}</small>
        </button>
      })}</section>
      <ActionButton variant="secondary" className="back-to-premiere" onClick={onHome}>На главный экран</ActionButton>
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
  const metricClues = ['country', 'series_status', 'seasons', 'runtime', 'kp', 'imdb', 'anime_kind', 'anime_status', 'episodes', 'episodes_aired', 'studio', 'anime_source', 'shiki', 'rank']
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
  date,
  setDate,
  onHome,
  onBack,
  onArchive,
  onStats,
  onRules,
  onEconomyChange,
  caseVignettes,
  dailySalt,
  isPracticeSession,
  searchIndex,
}: {
  titles: TitleItem[]
  mode: TitleMode
  period: PeriodKey
  date: string
  setDate: (date: string) => void
  onHome: () => void
  onBack: () => void
  onArchive: () => void
  onStats: () => void
  onRules: () => void
  onEconomyChange: () => void
  caseVignettes: CaseVignetteMap
  dailySalt: number
  isPracticeSession: boolean
  searchIndex: LibrarySearchIndex | null
}) {
  const effectivePeriod: PeriodKey = mode === 'diagnosis' || mode === 'game' ? 'all' : period
  const pool = useMemo(() => poolFor(titles, mode, effectivePeriod), [titles, mode, effectivePeriod])
  const answer = useMemo(() => pool.length ? dailyTitle(pool, mode, effectivePeriod, date, dailySalt) : null, [pool, mode, effectivePeriod, date, dailySalt])
  const key = dailySalt === 0 ? gameKey(mode, effectivePeriod, date) : `${gameKey(mode, effectivePeriod, date)}|salt:${dailySalt}`
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

  useEffect(() => {
    const saved = loadGame(key)
    const restoredChoices = Array.isArray(saved?.hintChoices)
      ? saved.hintChoices
      : (saved?.usedHints ?? []).slice(0, 2).map((hintKey, index) => ({ round: (index === 0 ? 5 : 8) as HintCheckpoint, key: hintKey }))
    dispatchSession({
      type: 'reset',
      payload: {
        attempts: saved?.attempts ?? [],
        status: saved?.status ?? 'playing',
        hintChoices: restoredChoices,
        dismissedHintRounds: Array.isArray(saved?.dismissedHintRounds) ? saved.dismissedHintRounds : [],
      },
    })
    setHintModalRound(null)
    setGameMatchStripOpen(mode === 'diagnosis')
    setAnamnesisOpen(false)
    setLastAward(null)
    setIsSearchDropdownOpen(false)
  }, [key, mode])

  const used = useMemo(() => new Set(attempts.map((attempt) => attempt.titleId)), [attempts])
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
  const assistHints = useMemo(() => answer ? buildAssistHints(answer) : [], [answer])
  const anamnesisText = useMemo(() => answer && mode === 'diagnosis'
    ? (pickDailyVignette(caseVignettes[answer.id] ?? [], answer.id, date)?.text ?? '')
    : '', [answer, mode, caseVignettes, date])
  const usedHintsSet = useMemo(() => new Set(hintChoices.map((choice) => choice.key)), [hintChoices])
  const revealedAssistHints = useMemo(() => assistHints.filter((hint) => usedHintsSet.has(hint.key)), [assistHints, usedHintsSet])
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
  const headingPeriodBadge = mode === 'movie' || mode === 'series' || mode === 'anime'
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
    const stats = loadStats(mode)
    const next: Stats = {
      ...stats,
      distribution: [...stats.distribution],
      played: stats.played + 1,
      won: stats.won + (won ? 1 : 0),
      currentStreak: won ? stats.currentStreak + 1 : 0,
      bestStreak: won ? Math.max(stats.bestStreak, stats.currentStreak + 1) : stats.bestStreak,
    }
    if (won) next.distribution[count - 1] += 1
    saveStats(mode, next)
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
    dispatchSession({ type: 'submit_attempt', attempts: nextAttempts, status: nextStatus })
    persistGame(nextAttempts, nextStatus, hintChoices)
    if (nextStatus !== 'playing' && !isPracticeSession) {
      updateStats(nextStatus === 'won', nextAttempts.length)
      if (date === getMoscowDate()) {
        setLastAward(recordDailyCompletion(mode, effectivePeriod, date, nextStatus === 'won', nextAttempts.length))
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
      setCopied(true)
      setTimeout(() => setCopied(false), 1800)
    } catch {
      dispatchSession({ type: 'set_message', message: 'Не удалось скопировать результат' })
    }
  }

  if (!answer) return <div className="loading">В этой теме пока нет записей.</div>

  return <>
    <AppHeader onHome={onHome} onArchive={onArchive} onStats={onStats} onRules={onRules} />
    <main className="game-shell">
      <div className="screen-back-row">
        <button className="screen-back" onClick={onBack} aria-label="Назад"><ChevronLeft /></button>
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
        {mode === 'diagnosis' && !!anamnesisText && <ActionButton variant="secondary" className="anamnesis-link" onClick={() => setAnamnesisOpen(true)}><ClipboardList /> Анамнез</ActionButton>}
        {showTodayLink && <ActionButton variant="ghost" className="today-link" onClick={() => setDate(getMoscowDate())}>Сегодня</ActionButton>}
      </section>}

      <div className="progress-row">
        <Progress attempts={attempts.length} />
        {canUseHint && !hintModalRound && <ActionButton variant="hint" className="hint-trigger" onClick={() => preferredHintRound && setHintModalRound(preferredHintRound)}><Sparkles /> {hintTriggerLabel}</ActionButton>}
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

      {status !== 'playing' && <section className={`result-card ${status}`}>
        <Poster item={answer} />
        <div className="result-card__copy">
          <span>{status === 'won' ? (answer.mode === 'diagnosis' ? 'Диагноз угадан' : 'Сеанс угадан') : 'Сеанс завершён'}</span>
          <h2>{answer.titleRu}</h2>
          <p>{answer.mode === 'diagnosis'
            ? [answer.titleOriginal, ...(answer.icd10?.length ? [answer.icd10.join(', ')] : []), ...(answer.icdGroup ? [answer.icdGroup] : [])].filter(Boolean).join(' · ')
            : answer.mode === 'game'
              ? [answer.titleOriginal || 'Оригинальное название не указано', answer.year != null ? String(answer.year) : '—', answer.topRank != null ? `#${answer.topRank}` : null].filter(Boolean).join(' · ')
              : `${answer.titleOriginal || 'Оригинальное название не указано'} · ${answer.year ?? '—'}`}</p>
          <div className="result-tags">{(answer.mode === 'diagnosis'
            ? [...(answer.bodySystems ?? []).slice(0, 2), ...(answer.diseaseTypes ?? []).slice(0, 2), ...(answer.icd10 ?? []).slice(0, 1)]
            : answer.mode === 'game'
              ? [...(answer.genres ?? []).slice(0, 3), ...dedupeGameCategories(answer.steamCategories ?? [], true).slice(0, 2)]
              : (answer.genres ?? [])
          ).map((tag) => <i key={tag}>{tag}</i>)}</div>
          <strong>{status === 'won' ? `${attempts.length}/10 — верный ответ` : 'Правильный ответ открыт'}</strong>
          {lastAward && <EconomyAwardPanel award={lastAward} />}
        </div>
        <div className="result-actions">
          <button onClick={share}>{copied ? <Check /> : <Copy />}{copied ? 'Скопировано' : 'Скопировать'}</button>
          <a href={`https://t.me/share/url?url=${encodeURIComponent(location.href)}&text=${encodeURIComponent(resultText(mode, date, effectivePeriod, attempts.map((attempt) => attempt.hints), status === 'won'))}`} target="_blank" rel="noreferrer"><Share2 /> Telegram</a>
        </div>
      </section>}

      {status === 'playing' && <section className="search-area">
        <div ref={searchPickerRef} className="search-picker">
        <div className={`search-box ${selected ? 'selected' : ''}`}>
          <Search />
          <input
            ref={inputRef}
            id="movie-search"
            aria-label={mode === 'diagnosis' ? 'Введите диагноз' : mode === 'game' ? 'Введите игру' : 'Введите название'}
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
            onClick={() => setGameMatchStripOpen((current) => !current)}
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
          : mode === 'game'
            ? 'После ответа появятся сравнения по году, месту в топе, жанрам, категориям Steam и рейтингу.'
            : 'После ответа появятся сравнения по году, жанрам, актёрам, стране и рейтингам.'}</p></div>
        <ActionButton variant="secondary" onClick={onRules}>Как читать подсказки <ChevronRight /></ActionButton>
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


function StatsView({ mode }: { mode: TitleMode }) {
  const stats = loadStats(mode)
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
  const wallet = loadWallet()
  const attendance = loadAttendanceStats()
  const ledger = loadTicketLedger()
  const nextAt = nextMultiplierAt(attendance.currentDailyStreak)
  const multiplier = streakMultiplier(attendance.currentDailyStreak)

  return <div className="economy-view">
    <div className="stats-grid stats-grid--economy">
      <div><strong>{wallet.tickets}</strong><span>сейчас</span></div>
      <div><strong>{wallet.lifetimeTickets}</strong><span>всего</span></div>
      <div><strong>{attendance.currentDailyStreak}</strong><span>абонемент</span></div>
      <div><strong>{formatMultiplier(multiplier)}</strong><span>множитель</span></div>
    </div>
    <div className="economy-note">
      <Ticket />
      <p>Билеты открывают дополнительные периоды в кино и сериалах. Базовый сеанс всегда доступен, а закрытый период можно выбрать заранее.</p>
    </div>
    <p className="modal-lead">Билеты хранятся только в этом браузере на этом устройстве. В другом браузере или на другом устройстве они не переносятся. Если очистить данные сайта, билеты и их история могут исчезнуть.</p>
    <h3 className="subheading">Как начисляется</h3>
    <div className="economy-rules">
      <span><strong>+10</strong> завершить сеанс</span>
      <span><strong>+10</strong> угадать ответ</span>
      <span><strong>+0-9</strong> бонус за попытки</span>
      <span><strong>+5</strong> первый сеанс дня</span>
      <span><strong>+25</strong> полный зал 4/4</span>
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
        const periodText = session.mode === 'movie' || session.mode === 'series' || session.mode === 'anime' ? PERIODS[session.period]?.short ?? 'Период не задан' : 'Без периода'
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
  const [date, setDate] = useState(getMoscowDate())
  const [adminDailySalt, setAdminDailySalt] = useState(0)
  const [gameBackTarget, setGameBackTarget] = useState<'title' | 'rewatch' | 'hub'>('title')
  const { data, titleCounts, caseVignettes, loading, globalDailySalt, searchIndex } = useDataLoader(mode)
  const [modal, setModal] = useState<'stats' | 'rules' | 'resume' | 'anamnesis' | null>(null)
  const [economyVersion, setEconomyVersion] = useState(0)
  const transitionTimerRef = useRef<number | null>(null)
  const screenHistoryReadyRef = useRef(false)
  const screenFromPopStateRef = useRef(false)
  const lastScreenRef = useRef<AppScreen>('hub')
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
  const refreshEconomy = () => setEconomyVersion((version) => version + 1)

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

  useEffect(() => {
    if (modal === 'resume' && !activeGames.length) {
      setModal(null)
    }
  }, [modal, activeGames.length])

  const openSavedSession = (savedGame: SavedGame, backTarget: 'hub' | 'rewatch' = 'hub') => {
    clearTransitionTimer()
    setTransition('idle')
    setGameBackTarget(backTarget)
    setModeSafe(savedGame.mode)
    setPeriod(savedGame.mode === 'movie' || savedGame.mode === 'series' || savedGame.mode === 'anime' ? savedGame.period : 'all')
    setDate(savedGame.date)
    setScreen('game')
    setModal(null)
    window.scrollTo({ top: 0 })
  }

  const resumeActiveSession = () => {
    if (!activeGames.length) return
    if (activeGames.length === 1) {
      openSavedSession(activeGames[0], 'hub')
      return
    }
    setModal('resume')
  }

  const selectCategory = (nextMode: TitleMode) => {
    clearTransitionTimer()
    setTransition('idle')
    setModeSafe(nextMode)
    setDate(getMoscowDate())
    setScreen('title')
    setModal(null)
    window.scrollTo({ top: 0 })
  }
  const buyPeriodUnlock = (periodKey: PeriodKey) => {
    if (!canUnlockPeriods(mode)) return false
    if (isPeriodUnlocked(mode, periodKey, periodUnlocks)) {
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
    setPeriod(periodKey)
    refreshEconomy()
    return true
  }
  const playToday = () => {
    if (transition === 'title-to-game') return
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
    if (mode !== 'movie' && mode !== 'series' && mode !== 'anime') return

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
    {screen === 'hub' && <HubScreen onSelect={selectCategory} onRewatch={() => setScreen('rewatch')} onStats={() => setModal('stats')} onRules={() => setModal('rules')} onResume={resumeActiveSession} activeSessionsCount={activeGames.length} titleCounts={titleCounts} todayAttendance={todayAttendance} />}

    {screen === 'title' && <TitleScreen mode={mode} period={period} setPeriod={setPeriod} date={getMoscowDate()} onHome={goHome} onBack={goBackFromTitle} onPlay={playToday} onRewatch={() => setScreen('rewatch')} onStats={() => setModal('stats')} onRules={() => setModal('rules')} isLeaving={transition === 'title-to-game'} onReadAnamnesis={() => setModal('anamnesis')} hasAnamnesis={Boolean(diagnosisAnamnesis)} wallet={wallet} unlockedPeriods={currentUnlockedPeriods} onUnlockPeriod={buyPeriodUnlock} onStartFreePlay={startFreePlay} freePlayCostValue={freePlayCostValue} freePlayShortage={freePlayShortage} freePlayLaunchesToday={freePlayLaunchesToday} />}

    {screen === 'rewatch' && <RewatchScreen mode={mode} setMode={setModeSafe} period={period} dates={archiveDates} games={games} onOpen={openArchive} onHome={goHome} onStats={() => setModal('stats')} onRules={() => setModal('rules')} />}

    {screen === 'game' && (loading || !data[mode].length
      ? <div className="loading"><Sparkles /> Настраиваем проектор…</div>
      : <Game
          titles={data[mode]}
          mode={mode}
          period={period}
          date={date}
          dailySalt={effectiveDailySalt}
          isPracticeSession={adminDailySalt !== 0}
          setDate={setDate}
          onHome={goHome}
          onBack={goBackFromGame}
          onArchive={() => setScreen('rewatch')}
          onStats={() => setModal('stats')}
          onRules={() => setModal('rules')}
          onEconomyChange={refreshEconomy}
          caseVignettes={caseVignettes}
          searchIndex={searchIndex}
        />)}

    {modal === 'rules' && <Modal title="Как играть" onClose={() => setModal(null)}><RulesView /></Modal>}
    {modal === 'stats' && <Modal title="Статистика" onClose={() => setModal(null)}><div className="modal-mode">{modeMeta(mode).plural}</div><StatsView mode={mode} /></Modal>}
    {modal === 'resume' && <Modal title="Вернуться к игре" onClose={() => setModal(null)}><ResumeSessionsView sessions={activeGames} onOpen={(session) => openSavedSession(session, 'hub')} /></Modal>}
    {modal === 'anamnesis' && diagnosisAnamnesis && <AnamnesisModal text={diagnosisAnamnesis.text} dayNo={dayNumber(getMoscowDate())} onClose={() => setModal(null)} onStart={() => { setModal(null); playToday() }} />}
  </div>
}

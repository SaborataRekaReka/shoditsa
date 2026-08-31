import { lazy, Suspense, useCallback, useEffect, useLayoutEffect, useMemo, useReducer, useRef, useState, type CSSProperties, type FormEvent, type ReactNode } from 'react'
import { useMutation, useQueries, useQuery, useQueryClient } from '@tanstack/react-query'
import { useNavigate, useRouterState } from '@tanstack/react-router'
import type { ApiDifficultyKey, AttemptResponse, GameAttemptSnapshot, GameResponse, GameSessionSnapshot, GameStartBody, HintResponse, PublicContentItem } from '@shoditsa/contracts'
import {
  AlertTriangle,
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
  Crown,
  Film,
  Gamepad2,
  HeartPulse,
  LogIn,
  Lock,
  LockOpen,
  NotebookText,
  Play,
  RotateCcw,
  Share2,
  ShieldCheck,
  Sparkles,
  Stethoscope,
  Ticket,
  Target,
  Trophy,
  Waypoints,
  Tv,
  UserRound,
  Users,
  X,
} from 'lucide-react'
import { MODE_CONFIG, MODE_TABS } from './app/mode-config'
import { CATALOG_HINT_COPY, ECONOMY_RULE_SET, FREE_PLAY_MODE_IDS, FULL_HOUSE_MODE_IDS, GAME_MODE_MANIFEST, KPOP_ARTISTS_PACK_ID, PERIOD_UNLOCKABLE_MODE_IDS, isCatalogGuessModeId, isPlayableModeId } from '@shoditsa/contracts'
import { trackDiagnosisGoal } from './app/diagnosis-analytics'
import { trackConfirmedServerStart, trackGameCompleteOnce, trackGameStartOnce, trackNextGameClick, trackObservedServerStart, trackServerGameCompleteObserved } from './app/game-analytics'
import { markAppFirstRender, markSearchDuration, trackMetrikaGoal, trackMetrikaScreen } from './app/metrics'
import { applyRuntimeSeo } from './app/seo'
import { publicAssetUrl } from './app/public-asset'
import { ApiClientError, api, queryKeys } from './api/client'
import { apiErrorMessage } from './api/error-message'
import { DailyProgressStub } from './features/daily-progress/DailyProgressStub'
import { buildDailyHubState, isMainRouteGame, savedGameAttemptCount } from './features/daily-progress/daily-progress'
import { useAuthSession } from './features/auth/use-auth-session'
import { resetPasswordTokenFromLocation } from './features/auth/auth-helpers'
import { ChallengeInvite } from './features/challenge/ChallengeInvite'
import { buildChallengeUrl, challengeOutcome, getInstallationId, parseChallengeUrl, type ChallengePayload } from './features/challenge/challenge'
import { nextResultMode, resultRecommendedModes } from './features/daily-route/daily-route'
import { advanceAttendanceStreak, crossedDailyMilestones, shouldRecordCompletion } from './features/economy/completion'
import { formatArtists, formatTickets, freePlayCost, nextStreakMilestoneAt, nextStreakMilestoneReward } from './features/economy/economy-rules'
import { ECONOMY_CHANGE_EVENT } from './features/economy/economy-event'
import { GameResult } from './features/result/GameResult'
import { FinalChoicePanel } from './features/game-session/FinalChoicePanel'
import { FINAL_CHOICE_DURATION_SECONDS, finalChoiceSecondsRemaining } from './features/game-session/final-choice-countdown'
import { activeSessionToSavedGame, archiveItemToSavedGame, isCatalogArchiveItem, publicItemToTitle, serverTitleCounts, toLegacyAttendance, toLegacyDailyAttendance, toLegacyWallet } from './features/server-runtime/adapters'
import { canReplayCatalogSession, catalogActiveSessions, catalogGameExperience, gameExperienceForSession, type CatalogGameBackTarget } from './features/game-session/game-experience'
import type { ContentReportReason } from './features/content-report/ContentReport'
import { CategoryTicket } from './components/category-ticket/CategoryTicket'
import { CATEGORY_TICKET_CONFIG } from './components/category-ticket/category-ticket.config'
import { ArcGameCarousel } from './features/home/ArcGameCarousel'
import { ActionButton, AppFooter, AppHeader, Modal, PROFILE_OPEN_EVENT } from './components/app-shell/AppShell'
import { HorizontalScrollLane } from './components/horizontal-scroll-lane/HorizontalScrollLane'
import { GameArtifactSeoDetails, HomeSeoContent } from './components/seo-content/SeoContent'
import {
  canonicalMusicGenreLabel,
  canonicalMusicId,
  compareTitles,
  calculateCompletionReward,
  dailyTitle,
  DIFFICULTIES,
  DIFFICULTY_ORDER,
  getMoscowDate,
  formatDays,
  isKnownComparisonText,
  isPlayableGamePlotHint,
  isKpopArtistCard,
  KPOP_GENERATION_RANGES,
  kpopGenerationLabel,
  localizeMusicCountry,
  MUSIC_ID_REDIRECTS,
  musicCareerStatusLabel,
  musicActivityStartYear,
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
import { freePlayAnswerSalt, freePlayGameKey, freePlayLaunchFromGameKey } from './game/free-play'
import { collectMatchSummaryTags } from './game/match-summary'
import { attemptProgressStats } from './game/attempt-progress'
import { matchesUsedSearchQuery, searchEmptyMessage, searchResultMeta } from './game/search-presentation'
import { resultCardMeta, resultCardTags } from './game/result-presentation'
import { commitSuggestionAttempt } from './game/suggestion-attempt'
import { shareTextWithFallback } from './game/sharing'
import { useDataLoader } from './hooks/use-data-loader'
import { useDebouncedValue } from './hooks/use-debounced-value'
import { ensureServerSession, SERVER_RUNTIME, useServerRuntime } from './hooks/use-server-runtime'
import { addTicketLedgerEntry, allGames, claimDailyMilestones, consumeFreePlayUsage, gameKey, isPeriodUnlocked, loadAttendanceStats, loadDailyAttendance, loadDailyMilestoneClaims, loadFreePlayUsage, loadGame, loadMusicReviewApprovals, loadMusicReviewConflictChoices, loadPeriodUnlocks, loadStats, loadWallet, saveAttendanceStats, saveDailyAttendance, saveGame, saveStats, saveWallet, setMusicReviewApproval, setMusicReviewConflictChoice, unlockPeriod, unlockedPeriodsFor, type MusicReviewConflictChoices, type MusicReviewConflictOption } from './storage'
import type { AttendanceStats, AssistHintKey, Attempt, CaseVignetteMap, DailyAttendance, DifficultyKey, GameStatus, HintCheckpoint, HintChoice, HintPerson, LibrarySearchIndex, PeriodKey, Person, SavedGame, Stats, TitleItem, TitleMode, Wallet } from './types'
import { pathnameForPlayerRoute, playerRouteFromLocation, playerRouteFromPathname, type PlayerRouteState, type PlayerScreen } from './app/routes'
import { MODE_PRESENTATION } from './app/mode-presentation'
import { ModeVariantControl } from './components/mode-variant/ModeVariantControl'
import { GameLaunchControls, GameOption, GameOptionSelect } from './components/game-launch-controls/GameLaunchControls'
import { GamePageFrame } from './components/game-shell/GamePageFrame'
import { GameScreenShell } from './components/game-shell/GameScreenShell'
import { AdmissionTitleTicket, DiagnosisTitleCard, MusicTitleTicket, TicketKicker } from './components/title-ticket'
import { ControlButton, DialogSurface, InlineAlert, SegmentedProgress, Tabs, TextInput } from './components/ui'
import { SearchCombobox } from './components/search-combobox'
import { deterministicClientEventId, trackClientEvent } from './app/client-events'
import { canCreateFriendsRoom, canUseFriendsRoom, currentFriendsRoomReturnUrl, friendsRoomRegistrationHref } from './features/friends-room/friends-room-access'
import { SESSION_RENDERER_BY_ENGINE } from './features/game-session/session-renderers'
import { DtfCommentFeed, DtfCommentIntro, type DtfCommentCardData } from './features/dtf-comments/DtfCommentFeed'
import { DtfLeaderboard } from './features/dtf-comments/DtfLeaderboard'
import { dtfShareText } from './features/dtf-comments/dtf-sharing'
import { UserBadgeList } from './components/user-badges/UserBadgeList'
import { AnamnesisModal, EconomyAwardPanel, ResumeSessionsView, RulesView, StatsView } from './features/player-modals/PlayerModalViews'
import { PROFILE_TABS, type ProfileTab } from './features/profile/profile-tabs'
import { TitlePoster as Poster } from './components/title-poster'
import { defaultDiagnosisSystemIcon, diagnosisSystemIconByKey, normalizeDiagnosisSystemKey } from './features/game-session/diagnosis-presentation'
import './features/home/HomeScreen.css'
import './features/title/TitleScreen.css'
import { dayNumber } from './game/day-number'

const ClubScreen = lazy(() => import('./features/commerce/ClubScreen').then((module) => ({ default: module.ClubScreen })))
const PurchaseReturnScreen = lazy(() => import('./features/commerce/PurchaseReturnScreen').then((module) => ({ default: module.PurchaseReturnScreen })))
const SpecialsScreen = lazy(() => import('./features/commerce/SpecialsScreen').then((module) => ({ default: module.SpecialsScreen })))
const SpecialDetailScreen = lazy(() => import('./features/commerce/SpecialsScreen').then((module) => ({ default: module.SpecialDetailScreen })))
const CreateGameScreen = lazy(() => import('./features/private-games/CreateGameScreen').then((module) => ({ default: module.CreateGameScreen })))
const FriendsRoomScreen = lazy(() => import('./features/friends-room/FriendsRoomScreen').then((module) => ({ default: module.FriendsRoomScreen })))
const FriendsRoomIntroScreen = lazy(() => import('./features/friends-room/FriendsRoomIntroScreen').then((module) => ({ default: module.FriendsRoomIntroScreen })))
const LegalScreen = lazy(() => import('./features/legal/LegalScreen').then((module) => ({ default: module.LegalScreen })))
const DanetkiJoinPage = lazy(() => import('./features/danetki/DanetkiEntryPages').then((module) => ({ default: module.DanetkiJoinPage })))
const DanetkiLobbyPage = lazy(() => import('./features/danetki/DanetkiEntryPages').then((module) => ({ default: module.DanetkiLobbyPage })))
const DanetkiCatalogPage = lazy(() => import('./features/danetki/DanetkiCatalogPage').then((module) => ({ default: module.DanetkiCatalogPage })))
const DanetkiStoryPage = lazy(() => import('./features/danetki/DanetkiCatalogPage').then((module) => ({ default: module.DanetkiStoryPage })))
const ConnectionsTitleScreen = lazy(() => import('./features/connections/ConnectionsTitleScreen').then((module) => ({ default: module.ConnectionsTitleScreen })))
const RewatchScreen = lazy(() => import('./features/archive/RewatchScreen').then((module) => ({ default: module.RewatchScreen })))
const ProfileScreen = lazy(() => import('./features/profile/ProfileScreen').then((module) => ({ default: module.ProfileScreen })))

const normalizeTextMatch = (value: string) => value
  .normalize('NFKD')
  .toLocaleLowerCase('ru-RU')
  .replace(/[\u0300-\u036f]/g, '')
  .replace(/ё/g, 'е')
  .replace(/[^a-zа-я0-9]+/gi, ' ')
  .trim()
const modeIcon = (mode: TitleMode) => {
  const Icon = MODE_PRESENTATION[mode].icon
  return <Icon />
}
const modeMeta = (mode: TitleMode) => MODE_CONFIG[mode]
const resultTextForSession = (
  mode: TitleMode,
  date: string,
  period: PeriodKey,
  hints: Attempt['hints'][],
  won: boolean,
  maxAttempts: number,
  freePlay: boolean,
  completionType?: Parameters<typeof resultText>[6],
) => {
  const text = resultText(mode, date, period, hints, won, maxAttempts, completionType)
  return freePlay
    ? text.replace(/^Сеанс — .*$/m, `Сеанс — ${modeMeta(mode).daily} · свободная игра`)
    : text
}
const TITLE_POSTER_ASSETS: Record<TitleMode, string> = {
  movie: 'images/title-posters/movie-ticket-poster.avif',
  series: 'images/title-posters/series-ticket-poster.avif',
  anime: 'images/title-posters/anime-ticket-poster.avif',
  game: 'images/title-posters/game-ticket-poster.avif',
  city: 'images/title-posters/city-ticket-poster.avif',
  music: 'images/title-posters/music-ticket-poster.avif',
  diagnosis: 'images/title-posters/diagnosis-ticket-poster.avif',
  animal: 'images/title-posters/animal-ticket-poster.avif',
  book: 'images/title-posters/book-ticket-poster-v2.avif',
  character: 'images/title-posters/character-ticket-poster.webp',
}
const PERIOD_UNLOCK_ORDER: PeriodKey[] = ['all', 'from_2020', 'from_2010', 'from_2000', 'from_1990', 'from_1980', 'from_1960']
const UNLOCKABLE_PERIOD_MODES = new Set<TitleMode>(PERIOD_UNLOCKABLE_MODE_IDS.filter(isCatalogGuessModeId) as TitleMode[])
const FREE_PLAY_MODES = new Set<TitleMode>(FREE_PLAY_MODE_IDS.filter(isCatalogGuessModeId) as TitleMode[])
const DTF_COMMENTS_PACK_ID = 'dtf-game-comments-25-v1'
const DTF_COMMENTS_POOL_COUNT = 20

type EconomyAward = {
  total: number
  base: number
  completed: number
  win: number
  speed: number
  firstDaily: number
  milestoneBonus: number
  fullHouse: number
  streakMilestone: number
  newDailyStreak: number
  gracePasses: number
  alreadyClaimed: boolean
}
const emptyAward = (attendance: AttendanceStats): EconomyAward => ({
  total: 0,
  base: 0,
  completed: 0,
  win: 0,
  speed: 0,
  firstDaily: 0,
  milestoneBonus: 0,
  fullHouse: 0,
  streakMilestone: 0,
  newDailyStreak: attendance.currentDailyStreak,
  gracePasses: attendance.gracePasses,
  alreadyClaimed: true,
})
const uniqueModes = (modes: TitleMode[]) => [...new Set(modes)]
const completionSessionKey = (mode: TitleMode, period: PeriodKey, date: string, variant = '') => {
  const base = gameKey(mode, period, date)
  return variant ? `${base}|diff:${variant}` : base
}
const periodUnlockCost = (period: PeriodKey, unlockCost: number = ECONOMY_RULE_SET.periodUnlock) => period === 'all' ? 0 : unlockCost
const canUnlockPeriods = (mode: TitleMode) => UNLOCKABLE_PERIOD_MODES.has(mode)
const resultConfigureLabel = (mode: TitleMode) => mode === 'music'
  ? 'Сложность / свободная игра'
  : canUnlockPeriods(mode)
    ? 'Период / свободная игра'
    : 'Выбор режима'
const toInteger = (value: number | string | undefined, fallback: number) => {
  const parsed = Math.trunc(Number(value))
  return Number.isFinite(parsed) ? parsed : fallback
}
const normalizeSystemKey = normalizeDiagnosisSystemKey
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
  value?: unknown
  people?: Person[]
  available: boolean
}

type AppScreen = PlayerScreen
type AdminWindow = Window & {
  __SEANS_ADMIN_NEW_DAILY__?: (saltStep?: number | string) => number
  __SEANS_ADMIN_SET_DAILY_SALT__?: (saltValue?: number | string) => number
  __SEANS_ADMIN_GET_DAILY_SALT__?: () => number
  SEANS_ADMIN_NEW_DAILY?: (saltStep?: number | string) => number
  SEANS_ADMIN_SET_DAILY_SALT?: (saltValue?: number | string) => number
  SEANS_ADMIN_GET_DAILY_SALT?: () => number
}

const ASSIST_HINT_KEYS: AssistHintKey[] = ['plot', 'info', 'fact', 'silhouette', 'sound']
const LEGACY_ASSIST_HINT_MAP: Record<string, AssistHintKey> = {
  info: 'info',
  fact: 'fact',
  plot: 'plot',
  slogan: 'info',
  cast_main: 'info',
  cast_secondary: 'info',
  awards: 'info',
}
const assistHintTitle = (key: AssistHintKey, mode?: TitleMode) => {
  if (key === 'plot') return mode ? CATALOG_HINT_COPY[mode].plotOptionTitle : 'Сюжетная подсказка'
  if (key === 'fact') return mode === 'music' ? 'Песня-подсказка' : 'Интересный факт'
  if (key === 'silhouette') return 'Силуэт'
  if (key === 'sound') return 'Голос животного'
  return mode ? CATALOG_HINT_COPY[mode].optionTitle : 'Неоткрытая информация'
}

type AnimalMediaHint = {
  kind: 'silhouette' | 'sound'
  url: string
  soundType?: string | null
  attribution?: {
    author?: string | null
    license?: string | null
  } | null
}

const animalMediaHint = (value: unknown): AnimalMediaHint | null => {
  if (!value || typeof value !== 'object') return null
  const candidate = value as Partial<AnimalMediaHint>
  if ((candidate.kind !== 'silhouette' && candidate.kind !== 'sound') || typeof candidate.url !== 'string' || !candidate.url) return null
  return candidate as AnimalMediaHint
}

const hintMediaUrl = (url: string) => /^https?:\/\//i.test(url) ? url : publicAssetUrl(url)
const isAnimalSilhouetteAsset = (url: unknown): url is string => typeof url === 'string' && /^\/images\/animals\/silhouettes\/[a-f0-9]{24}\.webp$/.test(url)
const isAnimalSoundAsset = (url: unknown): url is string => typeof url === 'string' && /^\/audio\/animals\/[a-f0-9]{24}\.ogg$/.test(url)

function AssistHintValue({ value }: { value: unknown }) {
  const media = animalMediaHint(value)
  if (!media) {
    const text = Array.isArray(value) ? value.join(', ') : String(value ?? '—')
    return <p>{text}</p>
  }
  const attribution = [media.attribution?.author, media.attribution?.license].map((part) => String(part ?? '').trim()).filter(Boolean).join(' · ')
  return <div className={`animal-media-hint animal-media-hint--${media.kind}`}>
    {media.kind === 'silhouette'
      ? <div className="animal-media-hint__silhouette"><img src={hintMediaUrl(media.url)} alt="Силуэт загаданного животного" draggable={false} /></div>
      : <audio controls preload="metadata" controlsList="nodownload noplaybackrate" src={hintMediaUrl(media.url)}>Ваш браузер не поддерживает воспроизведение аудио.</audio>}
    {attribution && <small>{media.kind === 'sound' ? 'Запись' : 'Изображение'}: {attribution}</small>}
  </div>
}
const normalizeAssistHintKeyValue = (value: unknown): AssistHintKey | null => {
  if (typeof value !== 'string') return null
  const normalized = value.trim()
  if (ASSIST_HINT_KEYS.includes(normalized as AssistHintKey)) return normalized as AssistHintKey
  return LEGACY_ASSIST_HINT_MAP[normalized] ?? null
}
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

  const fallbackChoices = (saved.usedHints ?? []).map(normalizeAssistHintKeyValue).filter((key): key is AssistHintKey => Boolean(key)).slice(0, 2).map((key, index) => ({
    round: (index === 0 ? 5 : 8) as HintCheckpoint,
    key,
  }))
  const rawChoices = Array.isArray(saved.hintChoices) && saved.hintChoices.length ? saved.hintChoices : fallbackChoices
  const seenRounds = new Set<HintCheckpoint>()
  const choices: HintChoice[] = []

  for (const rawChoice of rawChoices) {
    if (!rawChoice || typeof rawChoice !== 'object') continue
    const round = (rawChoice as { round?: unknown }).round
    const key = normalizeAssistHintKeyValue((rawChoice as { key?: unknown }).key)
    if (!isHintCheckpointValue(round) || !key) continue
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
const cropHintText = (value: string, max = 190) => value.length > max ? `${value.slice(0, max).trimEnd()}…` : value
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

function AttemptScore({ matchedCount, matchedFields, partialFields, totalFields, isCorrectAttempt }: { matchedCount: number; matchedFields: number; partialFields: number; totalFields: number; isCorrectAttempt: boolean }) {
  const tone = matchedCount === 0 && partialFields === 0 ? 'miss' : isCorrectAttempt || matchedFields > 0 ? 'match' : 'partial'
  const label = `Точных совпадений: ${matchedFields} из ${totalFields}; частичных: ${partialFields}`

  return <div className={`dx-score dx-score--${tone}`} aria-label={label}>
    <span>Сходится</span>
    <div className="dx-score__bar">{Array.from({ length: totalFields }, (_, i) => <i key={i} className={i < matchedFields ? 'exact' : i < matchedFields + partialFields ? 'partial' : ''} />)}</div>
    <strong><b>{matchedCount}</b><small> точно{partialFields ? ` · ${partialFields} частично` : ''}</small></strong>
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
  if (text.includes('одиноч') || text.includes('single-player') || text.includes('single player') || text === 'singleplayer') return 'single'
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
  if (['pc', 'windows', 'windows pc', 'win'].includes(text)) return 'platform:pc'
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
    if (!isKnownComparisonText(category)) continue
    if (removePlayerCategories && isPlayerCategory(category)) continue
    if (/(регулируем.*размер.*текст|adjustable.*text|размер.*текст|text.*size|screen reader|экранн.*диктор|цветов.*слеп|color.?blind|high contrast|высок.*контраст|субтитр|caption|narrat.*menu|speech.?to.?text|text.?to.?speech)/i.test(category)) continue
    const key = normalizeGameCategoryKey(category) || normalizeTextMatch(category)
    if (seen.has(key)) continue
    seen.add(key)
    result.push(key === 'platform:pc' ? 'PC' : category)
  }

  return result
}
const dedupeOrganizationNames = (names: string[]) => {
  const seen = new Set<string>()
  return names
    .flatMap((name) => name.split(/[,;]/))
    .map((name) => name.trim())
    .filter((name) => {
      const key = normalizeTextMatch(name)
      if (!isKnownComparisonText(name) || !key || seen.has(key)) return false
      seen.add(key)
      return true
    })
}
function GameMatchStrip({ attempts, mode, open, onToggle }: { attempts: Attempt[]; mode: TitleMode; open: boolean; onToggle: () => void }) {
  const tags = useMemo(() => collectMatchSummaryTags(attempts, mode), [attempts, mode])

  return <div className={`game-match-strip ${open ? 'is-open' : ''}`}>
    <ControlButton
      type="button"
      className="game-match-strip__toggle"
      onClick={onToggle}
      aria-expanded={open}
      aria-controls="game-match-strip-panel"
    >
      <span className="game-match-strip__logo" aria-hidden="true"><img src={publicAssetUrl('images/symbol.svg')} alt="" /></span>
      <span className="game-match-strip__title">Что сходится</span>
      <ChevronRight aria-hidden="true" />
    </ControlButton>
    <div className="game-match-strip__panel" id="game-match-strip-panel" aria-hidden={!open}>
      <HorizontalScrollLane className="game-match-strip__tags">
        {tags.length
          ? tags.map((tag) => <span key={tag.id} className="game-match-strip__tag"><small>{tag.label}</small><span>{tag.value}</span></span>)
          : <span className="game-match-strip__empty">{attempts.length ? 'Пока совпадений нет' : 'Появится после первой попытки'}</span>}
      </HorizontalScrollLane>
    </div>
  </div>
}
const compactAssistList = (label: string, values: Array<string | null | undefined>, limit = 3) => {
  const normalized = values.map((value) => cleanHintText(String(value ?? ''))).filter(Boolean)
  if (!normalized.length) return ''
  return `${label}: ${normalized.slice(0, limit).join(', ')}`
}

const buildInfoHintCandidates = (item: TitleItem) => {
  if (item.mode === 'music') {
    return [
      compactAssistList('Страна', (item.countries ?? []).map(localizeMusicCountry), 2),
      item.activityStartYear ? `Начало деятельности: ${item.activityStartYear}` : '',
      `Тип: ${musicTypeLabel(item.musicType)}`,
      compactAssistList('Жанры', item.genres ?? [], 3),
      compactAssistList('Топ-треки', (item.topTracks ?? []).map((track) => track.title), 2),
    ].filter(Boolean)
  }

  if (item.mode === 'game') {
    return [
      item.year ? `Год релиза: ${item.year}` : '',
      compactAssistList('Жанры', item.genres ?? [], 3),
      compactAssistList('Платформы', item.platforms ?? [], 3),
      compactAssistList('Разработчики', item.developers ?? [], 2),
      item.topRank ? `Позиция в топе: #${item.topRank}` : '',
      item.ratings?.metacritic != null || item.metacritic != null ? `Metacritic: ${item.ratings?.metacritic ?? item.metacritic}` : '',
    ].filter(Boolean)
  }

  if (item.mode === 'diagnosis') {
    return [
      compactAssistList('Системы организма', item.bodySystems ?? [], 3),
      compactAssistList('Ключевые симптомы', item.keySymptoms ?? [], 3),
      compactAssistList('Диагностика', item.diagnostics ?? [], 3),
      compactAssistList('МКБ-10', item.icd10 ?? [], 3),
      item.icdGroup ? `Группа: ${item.icdGroup}` : '',
    ].filter(Boolean)
  }

  if (item.mode === 'animal') {
    return [
      item.taxonomicClass ? `Класс: ${item.taxonomicClass}` : '',
      item.animalOrder ? `Отряд: ${item.animalOrder}` : '',
      item.animalFamily ? `Семейство: ${item.animalFamily}` : '',
      compactAssistList('Среда', item.habitats ?? [], 2),
      compactAssistList('Ареал', item.animalContinents ?? [], 3),
      compactAssistList('Питание', item.diets ?? [], 2),
      item.conservationStatus ? `Охранный статус: ${item.conservationStatus}` : '',
    ].filter(Boolean)
  }

  if (item.mode === 'book') {
    return [
      compactAssistList('Автор', item.bookAuthors ?? [], 2),
      item.bookCountry ? `Страна: ${item.bookCountry}` : '',
      item.bookOriginalLanguage ? `Язык оригинала: ${item.bookOriginalLanguage}` : '',
      compactAssistList('Жанры', item.bookGenres ?? [], 3),
      compactAssistList('Главные персонажи', item.bookMainCharacters ?? [], 3),
      compactAssistList('Годы экранизаций', (item.bookAdaptationYears ?? []).map(String), 3),
      compactAssistList('Литературные премии', item.bookAwards ?? [], 2),
    ].filter(Boolean)
  }

  if (item.mode === 'city') {
    return [
      item.country ? `Страна: ${item.country}` : '',
      item.continent ? `Континент: ${item.continent}` : '',
      compactAssistList('Языки', item.languages ?? [], 3),
      item.population != null ? `Население: ${new Intl.NumberFormat('ru-RU').format(item.population)}` : '',
      item.timezone ? `Часовой пояс: ${item.timezone}` : '',
      item.ranks?.economy != null ? `Экономика: № ${item.ranks.economy}` : '',
    ].filter(Boolean)
  }

  if (item.mode === 'anime') {
    return [
      item.episodes ? `Эпизоды: ${item.episodes}` : '',
      compactAssistList('Студии', item.studios ?? [], 2),
      compactAssistList('Жанры', item.genres ?? [], 3),
      item.year ? `Год релиза: ${item.year}` : '',
    ].filter(Boolean)
  }

  return [
    item.year ? `Год релиза: ${item.year}` : '',
    compactAssistList('Страны', item.countries ?? [], 2),
    compactAssistList('Жанры', item.genres ?? [], 3),
    compactAssistList('Режиссёры', (item.directors ?? []).map((person) => personName(person)), 2),
    compactAssistList('Каст', (item.cast ?? []).map((person) => personName(person)), 3),
  ].filter(Boolean)
}

const renderUnopenedLocalInfo = (item: TitleItem, candidate: string, attempts: Attempt[]) => {
  const separator = candidate.indexOf(':')
  if (separator < 0) return candidate
  const label = candidate.slice(0, separator)
  const value = candidate.slice(separator + 1).trim()
  const answerHint = compareTitles(item, item).find((hint) => normalizeTextMatch(hint.value) === normalizeTextMatch(value))
  if (!answerHint) return candidate

  const fieldHints = attempts.flatMap((attempt) => attempt.hints).filter((hint) => hint.key === answerHint.key)
  if (fieldHints.some((hint) => hint.status === 'match')) return ''

  const revealedValues = new Set(fieldHints.flatMap((hint) => [
    ...(hint.matchedValues ?? []),
    ...(hint.people ?? []).filter((person) => person.matched).flatMap((person) => [person.nameRu, person.nameOriginal]),
  ]).map(normalizeTextMatch).filter(Boolean))
  if (!revealedValues.size) return candidate

  const remaining = value.split(',').map((entry) => entry.trim()).filter((entry) => entry && !revealedValues.has(normalizeTextMatch(entry)))
  return remaining.length ? `${label}: ${remaining.join(', ')}` : ''
}

const safeMusicTrackHintValue = (item: TitleItem) => {
  const answerNames = [item.titleRu, item.titleOriginal, ...(item.alternativeTitles ?? [])]
    .map(normalizeTextMatch)
    .filter((value) => value.length >= 3)
  return (item.topTracks ?? [])
    .map((entry) => cleanHintText(entry.title))
    .find((track) => track && !answerNames.some((name) => normalizeTextMatch(track).includes(name))) ?? ''
}

const buildAssistHints = (item: TitleItem, choices: HintChoice[], attempts: Attempt[] = []): AssistHintView[] => {
  const out: AssistHintView[] = []
  if (item.mode === 'music' && !choices.some((choice) => choice.key === 'fact')) {
    const track = safeMusicTrackHintValue(item)
    if (track) out.push({
      key: 'fact',
      title: 'Песня-подсказка',
      subtitle: 'Название известного трека без имени исполнителя',
      body: `Известная песня: ${cropHintText(track, 100)}`,
      available: true,
    })
  }
  if (item.mode === 'animal') {
    if (isAnimalSilhouetteAsset(item.silhouetteUrl) && !choices.some((choice) => choice.key === 'silhouette')) {
      out.push({
        key: 'silhouette',
        title: 'Силуэт',
        subtitle: 'Очертания загаданного животного без фотографии и названия',
        value: { kind: 'silhouette', url: item.silhouetteUrl, attribution: item.silhouetteAttribution ?? item.mediaAttribution ?? null },
        available: true,
      })
    }
    if (isAnimalSoundAsset(item.soundUrl) && !choices.some((choice) => choice.key === 'sound')) {
      out.push({
        key: 'sound',
        title: 'Голос животного',
        subtitle: 'Короткая лицензированная запись без названия животного',
        value: { kind: 'sound', url: item.soundUrl, soundType: item.soundType ?? null, attribution: item.soundAttribution ?? null },
        available: true,
      })
    }
  }
  if (!choices.some((choice) => choice.key === 'plot') && isPlayableGamePlotHint(item)) {
    const plotBody = cropHintText(cleanHintText(String(item.plotHint ?? '')))
    if (plotBody) {
      out.push({
        key: 'plot',
        title: CATALOG_HINT_COPY[item.mode].plotOptionTitle,
        subtitle: CATALOG_HINT_COPY[item.mode].plotOptionSubtitle,
        body: plotBody,
        available: true,
      })
    }
  }

  const infoCandidates = buildInfoHintCandidates(item)
    .map((candidate) => renderUnopenedLocalInfo(item, candidate, attempts))
    .filter(Boolean)
  const infoIndex = choices.filter((choice) => choice.key === 'info').length
  const infoBody = cleanHintText(infoCandidates[infoIndex] ?? '')
  if (infoBody) {
    out.push({
      key: 'info',
      title: CATALOG_HINT_COPY[item.mode].optionTitle,
      subtitle: CATALOG_HINT_COPY[item.mode].optionSubtitle,
      body: infoBody,
      available: true,
    })
  }

  return out
}

const buildRevealedAssistHints = (item: TitleItem, choices: HintChoice[]): AssistHintView[] => {
  const out: AssistHintView[] = []
  const plotBody = isPlayableGamePlotHint(item)
    ? cropHintText(cleanHintText(String(item.plotHint ?? '')))
    : ''
  const infoCandidates = buildInfoHintCandidates(item)
  let infoIndex = 0
  let plotOpened = false
  let factOpened = false

  for (const choice of [...choices].sort((a, b) => a.round - b.round)) {
    if (choice.key === 'silhouette' && item.mode === 'animal' && isAnimalSilhouetteAsset(item.silhouetteUrl)) {
      out.push({
        key: 'silhouette',
        title: `Подсказка после ${choice.round} попыток`,
        subtitle: 'Силуэт',
        value: { kind: 'silhouette', url: item.silhouetteUrl, attribution: item.silhouetteAttribution ?? item.mediaAttribution ?? null },
        available: true,
      })
    } else if (choice.key === 'sound' && item.mode === 'animal' && isAnimalSoundAsset(item.soundUrl)) {
      out.push({
        key: 'sound',
        title: `Подсказка после ${choice.round} попыток`,
        subtitle: 'Голос животного',
        value: { kind: 'sound', url: item.soundUrl, soundType: item.soundType ?? null, attribution: item.soundAttribution ?? null },
        available: true,
      })
    } else if (choice.key === 'fact' && item.mode === 'music' && !factOpened) {
      factOpened = true
      const track = safeMusicTrackHintValue(item)
      if (!track) continue
      out.push({
        key: 'fact',
        title: `Подсказка после ${choice.round} попыток`,
        subtitle: 'Песня-подсказка',
        body: `Известная песня: ${cropHintText(track, 100)}`,
        available: true,
      })
    } else if (choice.key === 'plot' && plotBody && !plotOpened) {
      plotOpened = true
      out.push({
        key: 'plot',
        title: `Подсказка после ${choice.round} попыток`,
        subtitle: CATALOG_HINT_COPY[item.mode].plotOptionTitle,
        body: plotBody,
        available: true,
      })
    } else if (choice.key === 'info') {
      const infoBody = cleanHintText(infoCandidates[infoIndex] ?? '')
      infoIndex += 1
      if (!infoBody) continue
      out.push({
        key: 'info',
        title: `Подсказка после ${choice.round} попыток`,
        subtitle: CATALOG_HINT_COPY[item.mode].optionTitle,
        body: infoBody,
        available: true,
      })
    }
  }

  return out
}


const recordDailyCompletion = (mode: TitleMode, period: PeriodKey, date: string, won: boolean, attemptsCount: number, variant = ''): EconomyAward => {
  const sessionKey = completionSessionKey(mode, period, date, variant)
  const attendance = loadDailyAttendance(date)
  if (!shouldRecordCompletion(attendance.completedSessions, sessionKey)) return emptyAward(loadAttendanceStats())

  const previousStats = loadAttendanceStats()
  const firstCompletionForDay = attendance.completedSessions.length === 0
  const previousCompletedCount = uniqueModes(attendance.completedModes).length
  const nextCompletedModes = uniqueModes([...attendance.completedModes, mode])
  const nextCompletedCount = nextCompletedModes.length
  const nextAttendance: DailyAttendance = {
    ...attendance,
    completedModes: nextCompletedModes,
    wonModes: won ? uniqueModes([...attendance.wonModes, mode]) : attendance.wonModes,
    completedSessions: [...attendance.completedSessions, sessionKey],
    firstCompletedAt: attendance.firstCompletedAt || Date.now(),
    fullHouse: attendance.fullHouse || nextCompletedCount >= MODE_TABS.length,
  }

  let nextStats = previousStats
  if (firstCompletionForDay) {
    nextStats = advanceAttendanceStreak(previousStats, date)
  }
  if (!attendance.fullHouse && nextAttendance.fullHouse) {
    nextStats = { ...nextStats, fullHouseDays: nextStats.fullHouseDays + 1 }
  }

  const milestoneClaims = loadDailyMilestoneClaims(date)
  const reachedMilestones = crossedDailyMilestones(previousCompletedCount, nextCompletedCount, milestoneClaims.claimed)
  const reachedThree = reachedMilestones.includes(3)
  const fullHouseTarget = FULL_HOUSE_MODE_IDS.length
  const reachedFullHouse = reachedMilestones.includes(fullHouseTarget)
  const reward = calculateCompletionReward({
    won,
    attemptsCount,
    firstCompletion: firstCompletionForDay,
    firstRoute3: reachedThree,
    firstFullHouse: reachedFullHouse,
    dailyStreak: nextStats.currentDailyStreak,
  })
  const completed = reward.components.completion
  const win = reward.components.win
  const speed = reward.components.efficiency
  const firstDaily = reward.components.firstGame
  const milestoneBonus = reward.components.route3
  const fullHouse = reward.components.fullRoute
  const streakMilestone = reward.components.streakMilestone
  if (reachedMilestones.length) {
    claimDailyMilestones(date, reachedMilestones)
    for (const milestone of reachedMilestones) {
      const milestoneReward = milestone === 3 ? ECONOMY_RULE_SET.rewards.route3 : ECONOMY_RULE_SET.rewards.fullRoute
      const analyticsParams = { mode, completedCount: nextCompletedCount, nextMilestone: milestone, reward: milestoneReward, dateMoscow: date, rulesVersion: ECONOMY_RULE_SET.version }
      trackMetrikaGoal('daily_milestone_reached', analyticsParams)
      trackMetrikaGoal('daily_milestone_claimed', analyticsParams)
      if (milestone === fullHouseTarget) trackMetrikaGoal('full_house_reached', analyticsParams)
    }
  }
  const base = reward.total
  const total = reward.total
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
    completed,
    win,
    speed,
    firstDaily,
    milestoneBonus,
    fullHouse,
    streakMilestone,
    newDailyStreak: nextStats.currentDailyStreak,
    gracePasses: nextStats.gracePasses,
    alreadyClaimed: false,
  }
}

function GameSelector({ mode, onClick, compact = false }: { mode: TitleMode; onClick: () => void; compact?: boolean }) {
  return <ControlButton className={`game-selector ${compact ? 'game-selector--compact' : ''}`} onClick={onClick}>
    <span>{modeIcon(mode)}</span>
    <i>Тема</i>
    <strong>{modeMeta(mode).title}</strong>
    <ChevronRight />
  </ControlButton>
}

function PeriodControl({
  mode,
  value,
  freePlayArmed,
  onChange,
  periodUnlockCostValue,
  onStartFreePlay,
  hasActiveFreePlay,
  freePlayCostValue,
  freePlayShortage,
  freePlayLaunchesToday,
  clubFreePlay,
  wallet,
  unlockedPeriods,
  completedPeriods,
}: {
  mode: TitleMode
  value: PeriodKey
  freePlayArmed: boolean
  onChange: (period: PeriodKey) => void
  periodUnlockCostValue: number
  onStartFreePlay: () => void
  hasActiveFreePlay: boolean
  freePlayCostValue: number
  freePlayShortage: number
  freePlayLaunchesToday: number
  clubFreePlay: boolean
  wallet: Wallet
  unlockedPeriods: PeriodKey[]
  completedPeriods: PeriodKey[]
}) {
  const unlocked = new Set(clubFreePlay ? PERIOD_UNLOCK_ORDER : unlockedPeriods)
  const completed = new Set(completedPeriods)
  const selectedLocked = !unlocked.has(value)
  const selectedCost = periodUnlockCost(value, periodUnlockCostValue)
  const shortage = Math.max(0, selectedCost - wallet.tickets)
  const selectedUnlockable = selectedLocked && selectedCost > 0 && shortage === 0
  return <GameOptionSelect
    label="Период"
    labelIcon={<CalendarDays />}
    value={freePlayArmed ? 'Свободная игра' : PERIODS[value].label}
    valueIcon={selectedLocked ? selectedUnlockable ? <LockOpen /> : <Lock /> : undefined}
    endLabel={<><Ticket /> {wallet.tickets}</>}
    menuLabel="Выберите период"
    className="period-select-wrap"
    triggerClassName={`period-control period-control--custom ${selectedLocked ? 'is-locked' : ''} ${selectedUnlockable ? 'is-unlockable' : ''}`}
    menuClassName="period-menu"
    resetKey={mode}
  >
    {(close) => <>
      {PERIOD_UNLOCK_ORDER.map((periodKey) => {
        const isUnlocked = unlocked.has(periodKey)
        const isActive = !freePlayArmed && value === periodKey
        const isMainSession = periodKey === 'all'
        const isCompleted = !isMainSession && completed.has(periodKey)
        const includedWithClub = clubFreePlay && !isMainSession && !isCompleted
        const cost = periodUnlockCost(periodKey, periodUnlockCostValue)
        const isUnlockable = !isUnlocked && cost > 0 && wallet.tickets >= cost
        const missingTickets = Math.max(0, cost - wallet.tickets)
        const optionDescription = isMainSession
          ? 'Главный сеанс · доступен всегда'
          : isCompleted
            ? 'Можно пройти снова'
            : includedWithClub
              ? 'Включено в клубный абонемент'
            : isUnlocked
              ? 'Можно играть сейчас'
              : isUnlockable
                ? 'Хватает билетов для открытия'
                : `Не хватает ${formatTickets(missingTickets)}`
        const optionStatus = isCompleted
          ? { label: 'Пройдено', tone: 'completed' as const, icon: <Check /> }
          : includedWithClub
            ? { label: 'Включено в клуб', tone: 'available' as const, icon: isActive ? <Check /> : <Play /> }
          : isMainSession || isUnlocked
            ? { label: 'Доступно', tone: 'available' as const, icon: isActive ? <Check /> : <Play /> }
            : isUnlockable
              ? { label: <>Открыть · {cost}</>, tone: 'unlockable' as const, icon: <Ticket /> }
              : { label: 'Закрыто', tone: 'locked' as const, icon: <Lock /> }
        return <GameOption
          key={periodKey}
          className={`period-option ${isMainSession ? 'period-option--main' : ''} ${isActive ? 'active' : ''} ${isUnlocked ? 'unlocked' : isUnlockable ? 'unlockable' : 'locked'}`}
          title={PERIODS[periodKey].label}
          description={optionDescription}
          icon={<CalendarDays />}
          status={optionStatus}
          selected={isActive}
          tone={isMainSession || isCompleted || isUnlocked ? 'positive' : isUnlockable ? 'special' : 'muted'}
          onSelect={() => {
            trackMetrikaGoal('select_period', {
              mode,
              period: periodKey,
              unlocked: isUnlocked,
              unlockable: isUnlockable,
            })
            onChange(periodKey)
            close()
          }}
        />
      })}
      {(mode === 'movie' || mode === 'series' || mode === 'anime' || mode === 'music') && <GameOption
        className={`period-option period-option--free-play ${freePlayArmed ? 'active ' : ''}${hasActiveFreePlay || freePlayShortage === 0 ? 'unlocked' : 'locked'}`}
        title="Свободная игра"
        description={hasActiveFreePlay ? 'Игра уже идет' : clubFreePlay ? `По клубному абонементу · запусков сегодня: ${freePlayLaunchesToday}` : freePlayShortage > 0 ? `Не хватает ${formatTickets(freePlayShortage)}` : `${formatTickets(freePlayCostValue)} · запусков сегодня: ${freePlayLaunchesToday}`}
        icon={<Sparkles />}
        status={freePlayArmed
          ? { label: 'Активна', tone: 'available', icon: <Check /> }
          : hasActiveFreePlay
            ? { label: 'Продолжить', tone: 'available', icon: <Play /> }
            : freePlayShortage > 0
              ? { label: 'Закрыто', tone: 'locked', icon: <Lock /> }
              : clubFreePlay
                ? { label: 'Запустить', tone: 'available', icon: <Play /> }
                : { label: <>Открыть · {freePlayCostValue}</>, tone: 'unlockable', icon: <Ticket /> }}
        selected={freePlayArmed}
        tone={hasActiveFreePlay || freePlayShortage === 0 ? 'positive' : 'muted'}
        onSelect={() => {
          trackMetrikaGoal('open_free_play', {
            mode,
            cost: hasActiveFreePlay ? 0 : freePlayCostValue,
            launchesToday: freePlayLaunchesToday,
            hasActiveSession: hasActiveFreePlay,
          })
          close()
          onStartFreePlay()
        }}
      />}
    </>}
  </GameOptionSelect>
}

function DifficultyControl({
  value,
  freePlayArmed,
  onChange,
  counts,
  completedDifficulties,
  onStartFreePlay,
  hasActiveFreePlay,
  freePlayCostValue,
  freePlayShortage,
  freePlayLaunchesToday,
  clubFreePlay,
}: {
  value: DifficultyKey
  freePlayArmed: boolean
  onChange: (difficulty: DifficultyKey) => void
  counts?: Record<DifficultyKey, number> | null
  completedDifficulties: DifficultyKey[]
  onStartFreePlay: () => void
  hasActiveFreePlay: boolean
  freePlayCostValue: number
  freePlayShortage: number
  freePlayLaunchesToday: number
  clubFreePlay: boolean
}) {
  const current = DIFFICULTIES[value]

  return <GameOptionSelect
    label="Сложность"
    labelIcon={<BarChart3 />}
    value={freePlayArmed ? 'Свободная игра' : current.label}
    valueIcon={<span className={`difficulty-bars difficulty-bars--${value}`} aria-hidden="true"><i /><i /><i /></span>}
    menuLabel="Уровень сложности"
    className="difficulty-select-wrap"
    triggerClassName="difficulty-trigger"
    menuClassName="difficulty-menu"
    resetKey="music"
  >
    {(close) => <>
      {DIFFICULTY_ORDER.map((key) => {
        const meta = DIFFICULTIES[key]
        const isActive = !freePlayArmed && value === key
        return <GameOption
          key={key}
          className={`difficulty-option ${isActive ? 'active' : ''}`}
          title={meta.label}
          description={`${counts ? `${formatArtists(counts[key])} · ` : ''}${meta.hint}${completedDifficulties.includes(key) ? ' · сыграно сегодня' : ''}`}
          icon={<span className={`difficulty-bars difficulty-bars--${key}`}><i /><i /><i /></span>}
          selected={isActive}
          tone={isActive ? 'positive' : 'default'}
          onSelect={() => {
            trackMetrikaGoal('select_difficulty', { mode: 'music', difficulty: key })
            onChange(key)
            close()
          }}
        />
      })}
      <GameOption
        className={`difficulty-option difficulty-option--free-play ${freePlayArmed ? 'active ' : ''}${hasActiveFreePlay || freePlayShortage === 0 ? '' : 'locked'}`}
        title="Свободная игра"
        description={hasActiveFreePlay ? 'Игра уже идет' : clubFreePlay ? `По клубному абонементу · запусков сегодня: ${freePlayLaunchesToday}` : freePlayShortage > 0 ? `Не хватает ${formatTickets(freePlayShortage)}` : `${formatTickets(freePlayCostValue)} · запусков сегодня: ${freePlayLaunchesToday}`}
        icon={<Sparkles />}
        status={freePlayArmed
          ? { label: 'Активна', tone: 'available', icon: <Check /> }
          : hasActiveFreePlay
            ? { label: 'Продолжить', tone: 'available', icon: <Play /> }
            : freePlayShortage > 0
              ? { label: 'Закрыто', tone: 'locked', icon: <Lock /> }
              : clubFreePlay
                ? { label: 'Запустить', tone: 'available', icon: <Play /> }
                : { label: <>Открыть · {freePlayCostValue}</>, tone: 'unlockable', icon: <Ticket /> }}
        selected={freePlayArmed}
        tone={hasActiveFreePlay || freePlayShortage === 0 ? 'special' : 'muted'}
        onSelect={() => {
          trackMetrikaGoal('open_free_play', { mode: 'music', cost: hasActiveFreePlay ? 0 : freePlayCostValue, launchesToday: freePlayLaunchesToday, hasActiveSession: hasActiveFreePlay })
          close()
          onStartFreePlay()
        }}
      />
    </>}
  </GameOptionSelect>
}

const apiDifficulty = (value: DifficultyKey | null | undefined): ApiDifficultyKey | null => value === 'experimental' ? 'expert' : value ?? null

function GameDataLoadError({ onRetry, onHome }: { onRetry: () => void; onHome: () => void }) {
  return <main className="loading loading--error" role="alert">
    <AlertTriangle />
    <h1>Проектор не настроился</h1>
    <p>Библиотека игры не загрузилась. Прогресс сохранён — попробуйте подключиться ещё раз.</p>
    <div>
      <ControlButton type="button" className="ui-button ui-button--primary" onClick={onRetry}>Повторить загрузку</ControlButton>
      <ControlButton type="button" className="ui-button ui-button--secondary" onClick={onHome}>На главную</ControlButton>
    </div>
  </main>
}

function CodapressPreviewHeader() {
  return <header className="codapress-preview-header">
    <a className="codapress-preview-header__brand" href="/?preview=codapress" aria-label="Сходится! — на главный экран">
      <img src={publicAssetUrl('images/symbol.svg')} alt="" aria-hidden="true" />
      <span>Сходится!</span>
    </a>
    <nav aria-label="Навигация превью">
      <a href="#available-games">Игры</a>
      <a href="/archive">Архив</a>
      <a href="/specials">Спецпоказы</a>
      <a href="/club">Клуб</a>
    </nav>
  </header>
}

function HubScreen({ onSelect, onSelectDtfSpecial, onSelectKpopSpecial, onSelectFriends, onDanetki, onConnections, danetkiEnabled, danetkiPoolCount, connectionsEnabled, connectionsPoolCount, connectionsStatus, connectionsMistakes, onRewatch, onStats, onRules, onReview, onResume, onOpenSaved, canAccessDtfSpecial, canAccessKpopSpecial, dtfPoolCount, kpopPoolCount, canAccessFriendsRoom, activeSessionsCount, games, preferredMode, titleCounts, todayAttendance, globalDailySalt, arcPreview = false, codapressPreview = false }: {
  onSelect: (mode: TitleMode) => void
  onSelectDtfSpecial: () => void
  onSelectKpopSpecial: () => void
  onSelectFriends: () => void
  onDanetki: () => void
  onConnections: () => void
  danetkiEnabled: boolean
  danetkiPoolCount: number | null
  connectionsEnabled: boolean
  connectionsPoolCount: number | null
  connectionsStatus: 'new' | 'active' | 'completed'
  connectionsMistakes: number | null
  onRewatch: () => void
  onStats: () => void
  onRules: () => void
  onReview: () => void
  onResume: () => void
  onOpenSaved: (game: SavedGame) => void
  canAccessDtfSpecial: boolean
  canAccessKpopSpecial: boolean
  dtfPoolCount: number | null
  kpopPoolCount: number | null
  canAccessFriendsRoom: boolean
  activeSessionsCount: number
  games: SavedGame[]
  preferredMode: TitleMode
  titleCounts: Record<TitleMode, number | null>
  todayAttendance: DailyAttendance
  globalDailySalt: number
  arcPreview?: boolean
  codapressPreview?: boolean
}) {
  const scrollToGames = () => document.getElementById('available-games')?.scrollIntoView({ behavior: 'smooth', block: 'start' })
  const dailyState = useMemo(
    () => buildDailyHubState(todayAttendance, games, preferredMode, globalDailySalt),
    [games, globalDailySalt, preferredMode, todayAttendance],
  )
  const mainRouteCards = CATEGORY_TICKET_CONFIG.map((config) => {
    const configMode = config.mode
    const activeGame = dailyState.activeGamesByMode[configMode] ?? null
    const completedGame = dailyState.finishedGamesByMode[configMode] ?? null
    const completed = todayAttendance.completedModes.includes(configMode) || Boolean(completedGame)
    const status = activeGame ? 'active' : completed ? 'completed' : 'new'
    const savedGame = activeGame ?? completedGame
    const handleClick = () => {
      const eventName = status === 'active' ? 'category_ticket_resume' : status === 'completed' ? 'category_ticket_result' : 'category_ticket_play'
      trackMetrikaGoal(eventName, { mode: config.mode, status, attempts: savedGameAttemptCount(savedGame), date: todayAttendance.date })
      if (savedGame) {
        onOpenSaved(savedGame)
        return
      }
      onSelect(configMode)
    }
    return {
      id: config.mode,
      content: <CategoryTicket key={config.mode} {...config} href={pathnameForPlayerRoute({ screen: 'title', mode: configMode })} poolCount={titleCounts[configMode]} status={status} attempts={savedGame ? savedGameAttemptCount(savedGame) : null} onClick={handleClick} />,
    }
  })
  const publicGameCount = mainRouteCards.length + Number(connectionsEnabled) + Number(danetkiEnabled)
  const useArcCarousel = arcPreview || codapressPreview

  return <>
    {codapressPreview
      ? <CodapressPreviewHeader />
      : <AppHeader onHome={() => undefined} onArchive={onRewatch} onStats={onStats} onRules={onRules} onReview={onReview} />}
    <main className={`hub-screen ${arcPreview ? 'hub-screen--arc-preview' : ''} ${codapressPreview ? 'hub-screen--codapress-preview' : ''}`}>
      <section className="hub-hero-ticket">
        <div className="hub-hero">
          <div className="hub-hero__copy">
            <div className="hub-hero__facts" aria-label="Об игре">
              <span><Gamepad2 /><strong>{publicGameCount} игр</strong></span>
              <span><CalendarDays /><strong>Новые загадки каждый день</strong></span>
              <span><Target /><strong>10 попыток</strong></span>
            </div>
            {codapressPreview
              ? <h1 className="codapress-preview__title" aria-label="Всё сойдётся сегодня">
                <span>ВСЁ</span>
                <span>СОЙДЁТСЯ</span>
                <span>СЕГОДНЯ</span>
              </h1>
              : <h1>Все сойдется!</h1>}
            <p>{codapressPreview
              ? `${publicGameCount} игровых форматов. Новые загадки каждый день. Один маршрут, который хочется закрыть до конца.`
              : 'Угадывайте фильмы, сериалы, аниме, видеоигры, города, исполнителей, диагнозы, животных, книги и персонажей — или решайте связи и данетки. Каждый день — новая загадка.'}</p>
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
            <img src={publicAssetUrl('images/hero.webp')} alt="" width="1122" height="913" fetchPriority="high" decoding="async" />
          </div>
        </div>
        {codapressPreview && <>
          <p className="codapress-preview__manifesto"><strong>Сходится!</strong> — ежедневная игровая афиша для тех, кто любит кино, игры, музыку и неожиданные связи. Мы превращаем каталоги и факты в короткие расследования: без спешки, без бесконечной ленты, по одной премьере каждого жанра в день.</p>
          <div className="codapress-preview__ticker" aria-hidden="true"><span>КИНО · СЕРИАЛЫ · АНИМЕ · ИГРЫ · ГОРОДА · МУЗЫКА · ДИАГНОЗЫ ·</span><span>КИНО · СЕРИАЛЫ · АНИМЕ · ИГРЫ · ГОРОДА · МУЗЫКА · ДИАГНОЗЫ ·</span></div>
        </>}
        <DailyProgressStub state={dailyState} />
        <HomeSeoContent />
      </section>

      <section className={`category-section ${useArcCarousel ? 'category-section--arc' : ''}`} id="available-games">
        <div className="category-heading">
          <span>ОСНОВНОЙ МАРШРУТ</span>
          {useArcCarousel && <small>ТЯНИТЕ ИЛИ ← →</small>}
        </div>
        {useArcCarousel
          ? <ArcGameCarousel items={mainRouteCards} />
          : <div className="category-grid category-grid--active">{mainRouteCards.map(({ content }) => content)}</div>}
      </section>

      <section className="category-section category-section--other" aria-labelledby="other-games-heading">
        <div className="category-heading"><span id="other-games-heading">ДРУГИЕ ИГРЫ</span></div>
        <div className="category-grid category-grid--active">
          {connectionsEnabled && <CategoryTicket
            mode="connections"
            title="Связи"
            description="Соберите 16 слов в четыре связанные группы"
            color="var(--mode-connections-brand)"
            icon={Waypoints}
            watermarkUrl={publicAssetUrl('images/connections/connections-card-v2.webp')}
            poolCount={connectionsPoolCount}
            poolLabel="РАУНДОВ"
            status={connectionsStatus}
            attempts={connectionsMistakes}
            progressLabel="ОШИБКИ"
            progressMax={4}
            completedProgress={false}
            href={pathnameForPlayerRoute({ screen: 'title', mode: 'connections' })}
            onClick={() => {
              trackMetrikaGoal('category_ticket_play', {
                mode: 'connections',
                status: connectionsStatus,
                mistakes: connectionsMistakes ?? 0,
                date: todayAttendance.date,
              })
              onConnections()
            }}
          />}
          {danetkiEnabled && <CategoryTicket
            mode="danetki"
            title="Данетки"
            description="Раскройте необычную историю вопросами — самостоятельно или вместе с друзьями."
            color="var(--mode-danetki-brand)"
            icon={Sparkles}
            watermarkUrl={publicAssetUrl('images/category-stubs/danetki-stub.webp')}
            poolCount={danetkiPoolCount}
            status="new"
            attempts={null}
            href={pathnameForPlayerRoute({ screen: 'danetki' })}
            onClick={() => {
              trackMetrikaGoal('category_ticket_play', { mode: 'danetki', status: 'new', attempts: 0, date: todayAttendance.date })
              onDanetki()
            }}
          />}
          <CategoryTicket
            mode="series"
            title="Игра с друзьями"
            description={canAccessFriendsRoom
              ? 'Соберите комнату, выберите любую категорию и угадывайте одновременно.'
              : 'Комнаты и совместные Данетки доступны с активным клубным билетом.'}
            color="var(--mode-movie-brand)"
            icon={Users}
            watermarkUrl={publicAssetUrl('images/friends-room/friends-ticket-art-v2.webp')}
            poolCount={7}
            poolLabel="КАТЕГОРИЙ"
            kicker={canAccessFriendsRoom ? 'КЛУБНАЯ ИГРА' : 'ТОЛЬКО В КЛУБЕ'}
            newActionLabel={canAccessFriendsRoom ? 'СОЗДАТЬ КОМНАТУ' : 'УЗНАТЬ О КЛУБЕ'}
            status="new"
            attempts={null}
            href="/games/together"
            onClick={() => {
              trackMetrikaGoal('friends_room_opened', { placement: 'hub_other_games' })
              onSelectFriends()
            }}
          />
        </div>
      </section>
      <section className="category-section category-section--specials" aria-labelledby="special-shows-heading">
        <div className="category-heading"><span id="special-shows-heading">СПЕЦПОКАЗЫ</span></div>
        <div className="category-grid category-grid--active">
          {canAccessDtfSpecial && <CategoryTicket
            mode="game"
            title="Игра по комментариям"
            description={`Специальная подборка для DTF: угадайте ${dtfPoolCount ?? DTF_COMMENTS_POOL_COUNT} игр по комментариям игроков.`}
            color="#FF6B35"
            icon={Gamepad2}
            watermarkUrl={publicAssetUrl('images/category-stubs/game-stub.webp')}
            poolCount={dtfPoolCount ?? DTF_COMMENTS_POOL_COUNT}
            poolLabel="ИГР"
            kicker="СПЕЦПОКАЗ DTF"
            newActionLabel="ОТКРЫТЬ"
            status="new"
            attempts={null}
            href={pathnameForPlayerRoute({ screen: 'special', packId: DTF_COMMENTS_PACK_ID })}
            onClick={() => {
              trackMetrikaGoal('pack_opened', { packId: DTF_COMMENTS_PACK_ID, placement: 'hub_specials' })
              onSelectDtfSpecial()
            }}
          />}
          {canAccessKpopSpecial && <CategoryTicket
            mode="music"
            title="K-pop: угадай артиста"
            description="Один артист в день. Сверяйте год дебюта, поколение, тип, пол, лейбл, состав и статус активности."
            color="#d33178"
            icon={Sparkles}
            watermarkUrl={publicAssetUrl('images/specials/kpop-special-card.webp')}
            poolCount={kpopPoolCount}
            poolLabel="АРТИСТОВ"
            kicker="СПЕЦПОКАЗ · 1 В ДЕНЬ"
            newActionLabel="ИГРАТЬ"
            status="new"
            attempts={null}
            href={pathnameForPlayerRoute({ screen: 'special', packId: KPOP_ARTISTS_PACK_ID })}
            onClick={() => {
              trackMetrikaGoal('pack_opened', { packId: KPOP_ARTISTS_PACK_ID, placement: 'hub_specials' })
              onSelectKpopSpecial()
            }}
          />}
        </div>
      </section>
    </main>
  </>
}

function TitleScreen({ mode, variantKey, setVariantKey, period, setPeriod, date, onHome, onBack, onPlay, onReplay, onViewTodayResult, onRewatch, onStats, onRules, onReview, isLeaving, onLeaveComplete, onReadAnamnesis, hasAnamnesis, todayCompleted, todayResultAvailable, wallet, unlockedPeriods, completedPeriods, completedDifficulties, onUnlockPeriod, periodUnlockCostValue, onStartFreePlay, freePlayArmed, hasActiveFreePlay, freePlayCostValue, freePlayShortage, freePlayLaunchesToday, clubFreePlay, difficulty, setDifficulty, difficultyCounts, isBusy }: {
  mode: TitleMode
  variantKey: string | null
  setVariantKey: (variant: string) => void
  period: PeriodKey
  setPeriod: (period: PeriodKey) => void
  date: string
  onHome: () => void
  onBack: () => void
  onPlay: () => void
  onReplay: () => void
  onViewTodayResult: () => void
  onRewatch: () => void
  onStats: () => void
  onRules: () => void
  onReview: () => void
  isLeaving?: boolean
  onLeaveComplete?: () => void
  onReadAnamnesis: () => void
  hasAnamnesis: boolean
  todayCompleted: boolean
  todayResultAvailable: boolean
  wallet: Wallet
  unlockedPeriods: PeriodKey[]
  completedPeriods: PeriodKey[]
  completedDifficulties: DifficultyKey[]
  onUnlockPeriod: (period: PeriodKey) => boolean | Promise<boolean>
  periodUnlockCostValue: number
  onStartFreePlay: () => void
  freePlayArmed: boolean
  hasActiveFreePlay: boolean
  freePlayCostValue: number
  freePlayShortage: number
  freePlayLaunchesToday: number
  clubFreePlay: boolean
  difficulty: DifficultyKey
  setDifficulty: (difficulty: DifficultyKey) => void
  difficultyCounts: Record<DifficultyKey, number> | null
  isBusy: boolean
}) {
  const isDiagnosisReplay = mode === 'diagnosis' && todayCompleted
  const isMusicResult = mode === 'music' && todayResultAvailable && !freePlayArmed
  const hasModeVariants = GAME_MODE_MANIFEST[mode].variants.length > 0
  const periodLocked = !freePlayArmed && !clubFreePlay && canUnlockPeriods(mode) && !unlockedPeriods.includes(period)
  const periodCost = periodUnlockCost(period, periodUnlockCostValue)
  const periodShortage = periodLocked ? Math.max(0, periodCost - wallet.tickets) : 0
  const canStart = isMusicResult
    ? true
    : isDiagnosisReplay || freePlayArmed
      ? hasActiveFreePlay || freePlayShortage === 0
      : !periodLocked || periodShortage === 0
  const canTriggerStart = canStart && !isBusy
  const playButtonLabel = isMusicResult
    ? `Посмотреть результат · ${DIFFICULTIES[difficulty].label}`
    : isDiagnosisReplay
    ? hasActiveFreePlay
      ? 'Продолжить'
      : freePlayShortage > 0
        ? `Не хватает ${formatTickets(freePlayShortage)}`
        : `Сыграть ещё раз · ${formatTickets(freePlayCostValue)}`
    : freePlayArmed
    ? hasActiveFreePlay
      ? 'Продолжить'
      : freePlayShortage > 0
        ? `Не хватает ${formatTickets(freePlayShortage)}`
        : 'Начать новую'
    : periodLocked
      ? periodShortage > 0
        ? `Не хватает ${formatTickets(periodShortage)}`
        : `Открыть за ${formatTickets(periodCost)}`
      : 'Начать игру'
  const playButtonText = isBusy ? 'Запускаем…' : playButtonLabel
  const startSelectedPeriod = async () => {
    if (!canTriggerStart) return
    if (isMusicResult) {
      onViewTodayResult()
      return
    }
    if (isDiagnosisReplay) {
      onReplay()
      return
    }
    if (freePlayArmed) {
      onPlay()
      return
    }
    if (periodLocked && !(await onUnlockPeriod(period))) return
    onPlay()
  }

  const launchOption = mode === 'music'
    ? <DifficultyControl value={difficulty} freePlayArmed={freePlayArmed} onChange={setDifficulty} counts={difficultyCounts} completedDifficulties={completedDifficulties} onStartFreePlay={onStartFreePlay} hasActiveFreePlay={hasActiveFreePlay} freePlayCostValue={freePlayCostValue} freePlayShortage={freePlayShortage} freePlayLaunchesToday={freePlayLaunchesToday} clubFreePlay={clubFreePlay} />
    : hasModeVariants
      ? <ModeVariantControl mode={mode} value={variantKey} disabled={isBusy} onChange={setVariantKey} />
      : GAME_MODE_MANIFEST[mode].periodPolicy === 'year'
        ? <PeriodControl mode={mode} value={period} freePlayArmed={freePlayArmed} onChange={setPeriod} periodUnlockCostValue={periodUnlockCostValue} onStartFreePlay={onStartFreePlay} hasActiveFreePlay={hasActiveFreePlay} freePlayCostValue={freePlayCostValue} freePlayShortage={freePlayShortage} freePlayLaunchesToday={freePlayLaunchesToday} clubFreePlay={clubFreePlay} wallet={wallet} unlockedPeriods={unlockedPeriods} completedPeriods={completedPeriods} />
        : undefined
  const launchControls = <GameLaunchControls
    mode={mode}
    option={launchOption}
    action={<ActionButton className={`play-button game-launch-controls__play ${!canTriggerStart ? 'is-disabled' : ''}`} onClick={startSelectedPeriod} disabled={!canTriggerStart}>
      {isDiagnosisReplay ? <RotateCcw className="play-button__replay-icon" /> : <Play />}
      {playButtonText}
      {canTriggerStart && <span className="keycap-hint keycap-hint--inline" aria-hidden="true">Enter</span>}
    </ActionButton>}
  />

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
        if (!canTriggerStart) return
        startSelectedPeriod()
      }
    }
    window.addEventListener('keydown', onKeyDown)
    return () => window.removeEventListener('keydown', onKeyDown)
  }, [onBack, startSelectedPeriod])

  useEffect(() => {
    if (!isLeaving || !onLeaveComplete || !window.matchMedia('(prefers-reduced-motion: reduce)').matches) return
    const frame = window.requestAnimationFrame(onLeaveComplete)
    return () => window.cancelAnimationFrame(frame)
  }, [isLeaving, onLeaveComplete])

  return <>
    <AppHeader onHome={onHome} onArchive={onRewatch} onStats={onStats} onRules={onRules} onReview={onReview} />
    <GameScreenShell variant="title" onBack={() => {
      trackMetrikaGoal('title_back_click', { mode })
      onBack()
    }} className={`title-screen ${isLeaving ? 'is-leaving' : ''}`} onTransitionEnd={(event) => {
      if (isLeaving && event.target === event.currentTarget && event.propertyName === 'opacity') onLeaveComplete?.()
    }}>
      <section className="title-stage">
        <div className="title-game-mark">
          <span>{modeIcon(mode)}</span>
          <i>Игра дня · №{dayNumber(date)}</i>
          <h1>{mode === 'book' ? 'Угадай книгу' : modeMeta(mode).title}</h1>
        </div>
        <time>{prettyDate(date)} · {new Date(`${date}T12:00:00+03:00`).getFullYear()}</time>
        <p>Угадайте {modeMeta(mode).subject} дня за десять попыток</p>
        {mode === 'diagnosis'
          ? <DiagnosisTitleCard
              id="ticket-diagnosis"
              posterUrl={publicAssetUrl(TITLE_POSTER_ASSETS.diagnosis)}
              dayNumber={dayNumber(date)}
              dateLabel={`${date.slice(8, 10)}.${date.slice(5, 7)}`}
              hasAnamnesis={hasAnamnesis}
              onReadAnamnesis={onReadAnamnesis}
              launchControls={launchControls}
              details={<GameArtifactSeoDetails mode="diagnosis" />}
            />
          : mode === 'music'
            ? <MusicTitleTicket
                id="ticket-music"
                posterUrl={publicAssetUrl(TITLE_POSTER_ASSETS.music)}
                dayNumber={dayNumber(date)}
                dateLabel={`${date.slice(8, 10)}.${date.slice(5, 7)}`}
                launchControls={launchControls}
                details={<GameArtifactSeoDetails mode="music" />}
              />
            : <AdmissionTitleTicket
                id={`ticket-${mode}`}
                mode={mode}
                posterUrl={publicAssetUrl(TITLE_POSTER_ASSETS[mode])}
                stubLabel="ВХОД"
                stubTitle="ОДИН"
                stubMeta={`№ ${dayNumber(date)}`}
                stubEnd={`${date.slice(8, 10)}.${date.slice(5, 7)}`}
                details={<GameArtifactSeoDetails mode={mode} />}
              >
                <TicketKicker title="Ежедневная премьера" detail="полночный сеанс" />
                <h2 id={`ticket-${mode}`}>{mode === 'game' ? 'Игра «Угадай видеоигру»' : `Ежедневная игра: ${modeMeta(mode).lower}`}</h2>
                <p>Каждый день доступна новая загадка. У вас есть <strong>10 попыток</strong>, а каждый ответ открывает сравнительные подсказки.</p>
                {launchControls}
              </AdmissionTitleTicket>}
      </section>
    </GameScreenShell>
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

type MusicReviewScreenProps = {
  onHome: () => void
  onBack: () => void
  onRewatch: () => void
  onStats: () => void
  onRules: () => void
  onReview: () => void
}

function MusicReviewScreen(props: MusicReviewScreenProps) {
  return SERVER_RUNTIME ? <ServerMusicReviewScreen {...props} /> : <LocalMusicReviewScreen {...props} />
}

function ServerMusicReviewScreen({ onHome, onBack, onRewatch, onStats, onRules, onReview }: MusicReviewScreenProps) {
  const queryClient = useQueryClient()
  const [activeIndex, setActiveIndex] = useState(0)
  const queueParams = useMemo(() => new URLSearchParams({ mode: 'music', pendingOnly: 'true', limit: '30' }), [])
  const queue = useQuery({ queryKey: queryKeys.review({ mode: 'music', pendingOnly: true }), queryFn: () => api.reviewQueue(queueParams) })
  const decisionKeyRef = useRef<string | null>(null)
  const approve = useMutation({
    mutationFn: ({ itemId, key }: { itemId: string; key: string }) => api.reviewDecision(itemId, '__approval__', { approved: true }, key),
    onSuccess: async () => {
      decisionKeyRef.current = null
      setActiveIndex((current) => Math.max(0, current - 1))
      await queryClient.invalidateQueries({ queryKey: ['admin', 'content-review'] })
    },
  })
  const items = queue.data?.items ?? []
  const current = items[activeIndex] ?? items[0] ?? null
  const payload = current?.payload ?? {}
  const posterUrl = typeof payload.posterUrl === 'string' ? payload.posterUrl : null
  const year = typeof payload.year === 'number' ? payload.year : null

  return <>
    <AppHeader onHome={onHome} onArchive={onRewatch} onStats={onStats} onRules={onRules} onReview={onReview} />
    <main className="review-screen">
      <div className="screen-back-row"><ControlButton className="screen-back" onClick={onBack} aria-label="Назад"><ChevronLeft /></ControlButton><span className="keycap-hint" aria-hidden="true">Esc</span></div>
      <section className="review-heading"><span><NotebookText /> Серверная модерация</span><h1>Карточки на проверке</h1><p>Решения сохраняются в базе вместе с автором и временем изменения.</p></section>
      <section className="review-stats"><article><small>В очереди</small><strong>{items.length}</strong></article><article><small>Позиция</small><strong>{current ? activeIndex + 1 : 0}</strong></article></section>
      {queue.isLoading && <section className="review-empty"><Sparkles /> Загружаем карточки модерации…</section>}
      {queue.isError && <section className="review-empty review-empty--error">{apiErrorMessage(queue.error)}</section>}
      {!queue.isLoading && !queue.isError && !current && <section className="review-empty">Очередь проверки пуста.</section>}
      {current && <section className={`review-card ${current.reviewReasons.length ? 'has-conflict' : ''}`}>
        <div className="review-card__head"><span className="review-card__number">{String(activeIndex + 1).padStart(3, '0')}</span><Poster item={publicItemToTitle({ id: current.id, mode: current.mode as TitleMode, titleRu: current.titleRu, titleOriginal: current.titleOriginal, year, posterUrl })} className="review-card__poster" /><div className="review-card__identity"><span className="attempt-label">{current.mode}</span><h2>{current.titleRu}</h2><p className="gm-head__sub"><span className="gm-head__orig">{current.titleOriginal || 'Оригинальное название не указано'}</span>{year != null && <><i className="gm-head__dot">·</i><span className="gm-year">{year}</span></>}</p></div><div className="review-approval-badge"><small>Статус</small><strong>На проверке</strong></div></div>
        {!!current.reviewReasons.length && <div className="review-conflict-banner"><strong><AlertTriangle /> Требует внимания</strong><span>{current.reviewReasons.join(' • ')}</span></div>}
        <details className="review-details"><summary>Сырые данные карточки (JSON)</summary><pre>{JSON.stringify(payload, null, 2)}</pre></details>
        {approve.isError && <InlineAlert tone="danger" className="server-error">{apiErrorMessage(approve.error)}</InlineAlert>}
        <div className="review-card__actions"><ControlButton onClick={() => setActiveIndex((value) => Math.max(0, value - 1))} disabled={activeIndex === 0}><ChevronLeft /> Предыдущая</ControlButton><ControlButton className="approve" disabled={approve.isPending} onClick={() => { const key = decisionKeyRef.current ?? crypto.randomUUID(); decisionKeyRef.current = key; approve.mutate({ itemId: current.id, key }) }}><Check /> {approve.isPending ? 'Сохраняем…' : 'Одобрить'}</ControlButton><ControlButton onClick={() => setActiveIndex((value) => Math.min(items.length - 1, value + 1))} disabled={activeIndex >= items.length - 1}>Следующая <ChevronRight /></ControlButton></div>
      </section>}
    </main>
  </>
}

function LocalMusicReviewScreen({ onHome, onBack, onRewatch, onStats, onRules, onReview }: MusicReviewScreenProps) {
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
        <ControlButton className="screen-back" onClick={onBack} aria-label="Назад"><ChevronLeft /></ControlButton>
        <span className="keycap-hint" aria-hidden="true">Esc</span>
      </div>

      <section className="review-heading">
        <span><NotebookText /> Модерация музыки</span>
        <h1>Сомнительные и конфликтные карточки</h1>
        <p>Листайте карточки, проверяйте причины и помечайте записи как одобренные.</p>
      </section>

      <section className="review-toolbar">
        <ControlButton className={showServiceReasons ? 'active' : ''} onClick={() => setShowServiceReasons((currentValue) => !currentValue)}>
          {showServiceReasons ? <Check /> : <X />} Служебные причины
        </ControlButton>
        <ControlButton className={conflictsOnly ? 'active' : ''} onClick={() => setConflictsOnly((currentValue) => !currentValue)}>
          {conflictsOnly ? <Check /> : <X />} Только конфликты
        </ControlButton>
        <ControlButton className={!showApproved ? 'active' : ''} onClick={() => setShowApproved((currentValue) => !currentValue)}>
          {!showApproved ? <Check /> : <X />} Скрыть одобренные
        </ControlButton>
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
                  <ControlButton className={isASelected ? 'is-selected option-a' : 'option-a'} onClick={() => chooseConflictOption(current.item.id, pair, 'A')}>
                    <span>Вариант A</span>
                    <strong>{pair.optionA.value}</strong>
                    <small>{pair.optionA.sources.join(', ') || 'источник не указан'}</small>
                  </ControlButton>
                  <ControlButton className={isBSelected ? 'is-selected option-b' : 'option-b'} onClick={() => chooseConflictOption(current.item.id, pair, 'B')}>
                    <span>Вариант B</span>
                    <strong>{pair.optionB.value}</strong>
                    <small>{pair.optionB.sources.join(', ') || 'источник не указан'}</small>
                  </ControlButton>
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
          <ControlButton onClick={() => setActiveIndex((currentValue) => Math.max(0, currentValue - 1))} disabled={activeIndex === 0}><ChevronLeft /> Предыдущая</ControlButton>
          {current.approvedAt == null
            ? <ControlButton className="approve" onClick={() => setApproval(current.item.id, true)}><Check /> Одобрить</ControlButton>
            : <ControlButton className="revoke" onClick={() => setApproval(current.item.id, false)}><X /> Снять одобрение</ControlButton>}
          <ControlButton onClick={() => setActiveIndex((currentValue) => Math.min(entries.length - 1, currentValue + 1))} disabled={activeIndex >= entries.length - 1}>Следующая <ChevronRight /></ControlButton>
        </div>
      </section>}
    </main>
  </>
}

function PersonPortrait({ person }: { person: HintPerson }) {
  const [failed, setFailed] = useState(false)
  const name = person.nameRu || person.nameOriginal || 'Нет данных'
  const initials = name.split(/\s+/).slice(0, 2).map((part) => part[0]).join('').toUpperCase()
  const photoUrl = (() => {
    if (!person.photoUrl) return null
    if (/^\/?media\//.test(person.photoUrl) || /^https?:\/\//.test(person.photoUrl)) return person.photoUrl
    const normalized = person.photoUrl.replace(/^\.\//, '/')
    const match = normalized.match(/^\/data\/libraries\/people\/img\/(.+)$/)
    return match ? `/media/people/${match[1]}` : person.photoUrl
  })()
  return <div className={`hint-person ${person.matched ? 'matched' : ''}`}>
    <div className="hint-person__portrait">
      {photoUrl && !failed
        ? <img src={photoUrl} alt={name} onError={() => setFailed(true)} />
        : <span>{initials || '—'}</span>}
    </div>
    <strong>{name}</strong>
  </div>
}

function ClueTile({ hint, delay }: { hint: Attempt['hints'][number]; delay: number }) {
  const genreTiles = hint.key === 'genres' ? hint.value.split(',').map((genre) => genre.trim()).filter(Boolean) : []
  const displayValue = hint.key === 'country'
    ? hint.value.replace(/^[\u{1F1E6}-\u{1F1FF}]{2}\s*/u, '')
    : hint.value
  const listValues = hint.matchedValues ? splitHintValues(displayValue) : []
  const matchedValues = new Set((hint.matchedValues ?? []).map(normalizeTextMatch))
  return <div className={`clue-tile ${hint.status} clue-${hint.key}`} style={{ animationDelay: `${delay * 30}ms` }}>
    <div className="clue-tile__top">
      <span>{hint.label}</span>
      {hint.direction === 'up' ? <ArrowUp /> : hint.direction === 'down' ? <ArrowDown /> : hint.status === 'match' ? <Check /> : null}
    </div>
    {genreTiles.length
      ? <div className="clue-genre-list">{genreTiles.map((genre) => <span key={genre}>{genre}</span>)}</div>
      : listValues.length > 1
        ? <div className="clue-token-list">{listValues.map((value) => {
            const matched = matchedValues.has(normalizeTextMatch(value))
            return <span key={value} className={matched ? 'is-match' : ''}>{value}{matched && <Check />}</span>
          })}</div>
      : <strong>{displayValue}</strong>}
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
  const genres = (item.genres ?? []).filter(isKnownComparisonText)
  const displayedGenres = genres.length ? genres : genresHint?.status === 'unknown' ? ['Нет данных'] : []
  const genreMatched = new Set((genresHint?.matchedValues ?? []).map(normalizeTextMatch))
  const score = attemptProgressStats(attempt.hints)
  const yearHint = byKey.get('year')
  const ageHint = byKey.get('age')
  const yearText = item.year != null ? String(item.year) : null
  const ageText = ageHint ? isKnownComparisonText(item.ageRating) ? item.ageRating : 'Нет данных' : null
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
          {yearHint && yearText && <>
            <i className="gm-head__dot" aria-hidden="true">·</i>
            <span className={`gm-year ${yearHint?.status ?? ''}`}>
              {yearText}
              {yearHint?.direction === 'up' ? <ArrowUp /> : yearHint?.direction === 'down' ? <ArrowDown /> : yearHint?.status === 'match' ? <Check /> : null}
            </span>
          </>}
          {ageText && <>
            <i className="gm-head__dot" aria-hidden="true">·</i>
            <span className={`gm-year gm-year--age ${ageHint?.status ?? ''}`}>
              {ageText}
              {ageHint?.direction === 'up' ? <ArrowUp /> : ageHint?.direction === 'down' ? <ArrowDown /> : ageHint?.status === 'match' ? <Check /> : null}
            </span>
          </>}
        </p>
        {!!displayedGenres.length && <div className="gm-genres">
          {visibleMatchedItems(displayedGenres, genreMatched, 4).map((genre) => {
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
  if (!hint) return null
  const displayedNames = hint.status === 'unknown' ? [hint.value || 'Нет данных'] : names
  if (!displayedNames.length) return null
  const matched = new Set((hint?.matchedValues ?? []).map(normalizeTextMatch))
  const isMatch = hint.status === 'match' || displayedNames.some((name) => matched.has(normalizeTextMatch(name)))
  const tone = isMatch ? 'match' : hint.status
  const monogram = (displayedNames[0].match(/[A-Za-zА-Яа-я0-9]+/g) ?? []).slice(0, 2).map((word) => word[0]).join('').toUpperCase() || '?'
  return <div className={`gm-studio ${tone}`}>
    <span className="gm-studio__logo" aria-hidden="true">{monogram}</span>
    <span className="gm-studio__meta">
      <small>{label}</small>
      <strong title={displayedNames.join(', ')}>{displayedNames.join(', ')}</strong>
    </span>
    <i className="gm-studio__mark" aria-hidden="true">{isMatch ? <Check /> : null}</i>
  </div>
}

function GameAttemptCard({ attempt, item, index, isCorrectAttempt }: { attempt: Attempt; item: TitleItem; index: number; isCorrectAttempt: boolean }) {
  const byKey = new Map(attempt.hints.map((hint) => [hint.key, hint]))
  const genresHint = byKey.get('genres')
  const rankHint = byKey.get('rank')
  const yearHint = byKey.get('year')
  const score = attemptProgressStats(attempt.hints)
  const genres = (item.genres ?? []).filter(isKnownComparisonText)
  const displayedGenres = genres.length ? genres : genresHint?.status === 'unknown' ? ['Нет данных'] : []
  const genreMatched = new Set((genresHint?.matchedValues ?? []).map(normalizeTextMatch))
  const attrs = ['country', 'players', 'metacritic', 'steam_positive', 'reviews', 'price', 'age']
    .map((key) => byKey.get(key))
    .filter(Boolean) as Attempt['hints']
  const platforms = dedupeGameCategories(item.platforms ?? [], false)
  const developers = dedupeOrganizationNames(item.developers ?? [])
  const publishers = dedupeOrganizationNames(item.publishers ?? [])
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
          {yearHint && item.year != null && <>
            <i className="gm-head__dot" aria-hidden="true">·</i>
            <span className={`gm-year ${yearHint?.status ?? ''}`}>
              {item.year}
              {yearHint?.direction === 'up' ? <ArrowUp /> : yearHint?.direction === 'down' ? <ArrowDown /> : yearHint?.status === 'match' ? <Check /> : null}
            </span>
          </>}
        </p>
        {!!displayedGenres.length && <div className="gm-genres">
          {visibleMatchedItems(displayedGenres, genreMatched, 4).map((genre) => {
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

    {(byKey.has('developer') || byKey.has('publisher')) && <div className="gm-studios">
      <GameStudioPlate label="Разработчик" names={developers} hint={byKey.get('developer')} />
      <GameStudioPlate label="Издатель" names={publishers} hint={byKey.get('publisher')} />
    </div>}

    {!!attrs.length && <div className="dx-attrs">{attrs.map((hint, hintIndex) => <ClueTile key={hint.key} hint={hint} delay={hintIndex} />)}</div>}

    {byKey.has('platforms') && <div className="dx-clouds">
      <DxChipCloud label="Платформы" hint={byKey.get('platforms')} items={platforms.length ? platforms : ['Нет данных']} limit={6} />
    </div>}
  </article>
}

function MusicAttemptCard({ attempt, item, index, isCorrectAttempt }: { attempt: Attempt; item: TitleItem; index: number; isCorrectAttempt: boolean }) {
  const byKey = new Map(attempt.hints.map((hint) => [hint.key, hint]))
  const score = attemptProgressStats(attempt.hints)
  const genresHint = byKey.get('genres')
  const genres = (item.genres ?? []).filter(isKnownComparisonText).map(canonicalMusicGenreLabel)
  const displayedGenres = genres.length ? genres : genresHint?.status === 'unknown' ? ['Нет данных'] : []
  const genreMatched = new Set((genresHint?.matchedValues ?? []).map(normalizeTextMatch))
  const listenersValue = item.votes?.gamesPlayed ?? null
  const activityStartYear = musicActivityStartYear(item)
  const activityStartHint = byKey.get('activity_start_year')
  const requestedHints = ['country', 'activity_start_year', 'decade', 'music_type', 'music_active', 'music_origin']
    .map((key) => byKey.get(key))
    .filter(Boolean) as Attempt['hints']
  const similarArtistNames = (item.similarArtists ?? []).map((artist) => artist.name).filter(isKnownComparisonText)

  return <article className="attempt-card attempt-card--music">
    <div className="attempt-card__header">
      <span className="attempt-card__number">{String(index + 1).padStart(2, '0')}</span>
      <Poster item={item} />
      <div className="attempt-card__identity">
        <span className="attempt-label">Попытка {index + 1}</span>
        <h2>{item.titleRu}</h2>
        <p className="gm-head__sub">
          <span className="gm-head__orig">{item.titleOriginal || 'Оригинальное название не указано'}</span>
          {activityStartHint && activityStartYear != null && <>
            <i className="gm-head__dot" aria-hidden="true">·</i>
            <span className={`gm-year ${activityStartHint.status}`}>
              {activityStartYear}
              {activityStartHint.direction === 'up' ? <ArrowUp /> : activityStartHint.direction === 'down' ? <ArrowDown /> : activityStartHint.status === 'match' ? <Check /> : null}
            </span>
          </>}
        </p>
        {!!displayedGenres.length && <div className="gm-genres">
          {visibleMatchedItems(displayedGenres, genreMatched, 6).map((genre) => {
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

function KpopLabelMark({ label, logoUrl }: { label: string; logoUrl?: string | null }) {
  const [failed, setFailed] = useState(false)
  const monogram = (label.match(/[A-Za-zА-Яа-я0-9]+/g) ?? [])
    .slice(0, 2)
    .map((word) => word[0])
    .join('')
    .toUpperCase() || 'K'
  return <span className="kpop-label-mark" aria-hidden="true">
    {logoUrl && !failed
      ? <img src={logoUrl} alt="" onError={() => setFailed(true)} />
      : monogram}
  </span>
}

function KpopAttemptCard({ attempt, item, index, isCorrectAttempt }: { attempt: Attempt; item: TitleItem; index: number; isCorrectAttempt: boolean }) {
  const byKey = new Map(attempt.hints.map((hint) => [hint.key, hint]))
  const score = attemptProgressStats(attempt.hints)
  const generation = item.kpopGeneration ?? null
  const generationRange = KPOP_GENERATION_RANGES.find((entry) => entry.generation === generation)?.years ?? 'Годы не указаны'
  const generationHint = byKey.get('kpop_generation')
  const labelHint = byKey.get('kpop_current_label')
  const detailHints = [
    'kpop_debut_year',
    'kpop_generation',
    'kpop_performer_type',
    'kpop_gender',
    'kpop_debut_members',
    'kpop_activity_status',
  ].map((key) => byKey.get(key)).filter(Boolean) as Attempt['hints']
  const englishName = item.kpopNameEnglish || item.titleOriginal || item.titleRu
  const russianName = item.kpopNameRussian && normalizeTextMatch(item.kpopNameRussian) !== normalizeTextMatch(englishName)
    ? item.kpopNameRussian
    : ''
  const localLabelLogoUrl = item.kpopCurrentLabelLogoUrl && item.id.startsWith('kpop:')
    ? `/images/kpop/labels/by-artist/${encodeURIComponent(item.id.slice('kpop:'.length))}.webp`
    : item.kpopCurrentLabelLogoUrl

  return <article className="attempt-card attempt-card--kpop">
    <div className="kpop-card__header">
      <span className="attempt-card__number">{String(index + 1).padStart(2, '0')}</span>
      <Poster item={item} className="kpop-card__portrait" />
      <div className="kpop-card__identity">
        <span className="attempt-label">K-pop · попытка {index + 1}</span>
        <h2>{englishName}</h2>
        <p>
          {russianName && <span>{russianName}</span>}
          {item.kpopNameHangul && <b lang="ko">{item.kpopNameHangul}</b>}
        </p>
      </div>
      {generationHint && <div className={`kpop-card__generation ${generationHint.status}`}>
        <Crown />
        <strong>{generation ? `${generation} GEN` : '—'}</strong>
        <small>{kpopGenerationLabel(generation)}</small>
      </div>}
    </div>

    <AttemptScore {...score} isCorrectAttempt={isCorrectAttempt} />

    {labelHint && <div className={`kpop-label-plate ${labelHint.status}`}>
      <KpopLabelMark label={item.kpopCurrentLabel || 'K-pop'} logoUrl={localLabelLogoUrl} />
      <span>
        <small>Текущий корейский лейбл</small>
        <strong>{item.kpopCurrentLabel || 'Нет данных'}</strong>
      </span>
      <i aria-hidden="true">
        {labelHint?.status === 'match' ? <Check /> : null}
      </i>
    </div>}

    <div className="attempt-clue-grid kpop-card__facts">
      {detailHints.map((hint, hintIndex) => <ClueTile key={hint.key} hint={hint} delay={hintIndex} />)}
    </div>

    {generationHint && <footer className="kpop-card__generation-note">
      <Sparkles />
      <span><strong>{kpopGenerationLabel(generation)}</strong>{generationRange}</span>
    </footer>}
  </article>
}

function DxChipCloud({ label, hint, items, limit = 6, iconKind, wrap = false }: { label: string; hint: Attempt['hints'][number] | undefined; items: string[]; limit?: number; iconKind?: 'steam-categories'; wrap?: boolean }) {
  if (!hint || !items.length) return null
  const matched = new Set((hint?.matchedValues ?? []).map(normalizeTextMatch))
  const matchedCount = items.filter((value) => matched.has(normalizeTextMatch(value))).length
  const shouldScroll = !wrap && items.length > limit
  const countTone = hint.status === 'unknown'
    ? 'unknown'
    : matchedCount === items.length ? 'match' : matchedCount ? 'partial' : 'miss'
  const chipsClassName = ['dx-cloud__chips', wrap ? 'is-wrap' : '', shouldScroll ? 'is-scrollable' : ''].filter(Boolean).join(' ')
  return <div className="dx-cloud">
    <div className="dx-cloud__head">
      <span>{label}</span>
      <small className={countTone}>{hint.status === 'unknown' ? '—' : `${matchedCount}/${items.length}`}</small>
    </div>
    <HorizontalScrollLane className={chipsClassName}>
      {items.map((value) => {
        const isMatched = matched.has(normalizeTextMatch(value))
        const icon = iconKind === 'steam-categories' ? steamCategoryIcon(value) : null
        const chipTone = hint.status === 'unknown' ? 'unknown' : isMatched ? 'match' : 'miss'
        return <span key={value} className={`dx-chip ${chipTone}`}>
          {icon && <img className="dx-chip__icon" src={publicAssetUrl(icon === 'single' ? 'images/steam-icons/single-player.svg' : 'images/steam-icons/multi-player.svg')} alt="" aria-hidden="true" />}
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
  const score = attemptProgressStats(attempt.hints)
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

const CITY_RANK_METRICS: Array<{ key: keyof NonNullable<TitleItem['ranks']>; label: string }> = [
  { key: 'economy', label: 'Экономика' },
  { key: 'humanCapital', label: 'Человеческий капитал' },
  { key: 'qualityOfLife', label: 'Качество жизни' },
  { key: 'ecology', label: 'Экология' },
  { key: 'governance', label: 'Работа властей' },
]
const CITY_RANK_HINT_KEYS = new Set<string>(CITY_RANK_METRICS.map(({ key }) => key))
const cityRankStrength = (rank: number | null) => rank == null
  ? 0
  : Math.max(1, Math.min(100, Math.round(((1001 - rank) / 1000) * 100)))
const cityRankComparisonLabel = (hint: Attempt['hints'][number] | undefined) => {
  if (!hint || hint.status === 'unknown') return 'Нет данных'
  if (hint.status === 'match') return 'Совпало'
  if (hint.direction === 'up') return hint.status === 'close' ? 'Искомый выше · близко' : 'Искомый выше'
  if (hint.direction === 'down') return hint.status === 'close' ? 'Искомый ниже · близко' : 'Искомый ниже'
  return 'Сравните место'
}

function CityRankProfile({ item, hints }: { item: TitleItem; hints: Attempt['hints'] }) {
  const hintsByKey = new Map(hints.map((hint) => [hint.key, hint]))
  return <section className="city-rank-profile" aria-label="Рейтинговый профиль города">
    <header className="city-rank-profile__heading">
      <span><BarChart3 /> Городской профиль</span>
      <small>№ 1 — лучшее место; длиннее шкала — ближе к первому</small>
    </header>
    <div className="city-rank-profile__grid">
      {CITY_RANK_METRICS.map(({ key, label }) => {
        const rank = item.ranks?.[key] ?? null
        const hint = hintsByKey.get(key)
        const strength = cityRankStrength(rank)
        return <div className={`city-rank-meter city-rank-meter--${hint?.status ?? 'unknown'}`} key={key}>
          <span className="city-rank-meter__label" title={label}>{label}</span>
          <strong>{rank == null ? '—' : `№ ${rank}`}</strong>
          <i
            className="city-rank-meter__track"
            role="progressbar"
            aria-label={`${label}: ${rank == null ? 'нет данных' : `место ${rank} из 1000`}`}
            aria-valuemin={0}
            aria-valuemax={100}
            aria-valuenow={strength}
          >
            <b style={{ width: `${strength}%` }} />
          </i>
          <small className="city-rank-meter__comparison">
            {hint?.status === 'match' ? <Check /> : hint?.direction === 'up' ? <ArrowUp /> : hint?.direction === 'down' ? <ArrowDown /> : null}
            {cityRankComparisonLabel(hint)}
          </small>
        </div>
      })}
    </div>
  </section>
}

function CityAttemptCard({ attempt, item, index, isCorrectAttempt }: { attempt: Attempt; item: TitleItem; index: number; isCorrectAttempt: boolean }) {
  const score = attemptProgressStats(attempt.hints)
  const primaryHints = attempt.hints.filter((hint) => !CITY_RANK_HINT_KEYS.has(hint.key))
  const rankHints = attempt.hints.filter((hint) => CITY_RANK_HINT_KEYS.has(hint.key))
  return <article className="attempt-card attempt-card--city">
    <div className="attempt-card__header">
      <span className="attempt-card__number">{String(index + 1).padStart(2, '0')}</span>
      <Poster item={item} />
      <div className="attempt-card__identity">
        <span className="attempt-label">Попытка {index + 1}</span>
        <h2>{item.titleRu}</h2>
        <p className="gm-head__sub"><span className="gm-head__orig">{item.titleOriginal || item.country || 'Город'}</span></p>
        <div className="gm-genres">
          {item.country && <span className="gm-genre">{item.country}</span>}
          {item.continent && <span className="gm-genre">{item.continent}</span>}
        </div>
      </div>
    </div>
    <AttemptScore {...score} isCorrectAttempt={isCorrectAttempt} />
    <div className="attempt-clue-grid city-attempt__clues">
      {primaryHints.map((hint, hintIndex) => <ClueTile key={hint.key} hint={hint} delay={hintIndex} />)}
    </div>
    <CityRankProfile item={item} hints={rankHints} />
  </article>
}

function AnimalAttemptCard({ attempt, item, index, isCorrectAttempt }: { attempt: Attempt; item: TitleItem; index: number; isCorrectAttempt: boolean }) {
  const score = attemptProgressStats(attempt.hints)
  return <article className="attempt-card attempt-card--animal">
    <div className="attempt-card__header">
      <span className="attempt-card__number">{String(index + 1).padStart(2, '0')}</span>
      <Poster item={item} />
      <div className="attempt-card__identity">
        <span className="attempt-label">Попытка {index + 1}</span>
        <h2>{item.titleRu}</h2>
        <p className="gm-head__sub"><span className="gm-head__orig">{item.scientificName || item.titleOriginal}</span></p>
        <div className="gm-genres">
          {item.taxonomicClass && <span className="gm-genre">{item.taxonomicClass}</span>}
          {item.animalOrder && <span className="gm-genre">{item.animalOrder}</span>}
        </div>
      </div>
    </div>
    <AttemptScore {...score} isCorrectAttempt={isCorrectAttempt} />
    <div className="attempt-clue-grid animal-attempt__clues">
      {attempt.hints.map((hint, hintIndex) => <ClueTile key={hint.key} hint={hint} delay={hintIndex} />)}
    </div>
  </article>
}

function BookAttemptCard({ attempt, item, index, isCorrectAttempt }: { attempt: Attempt; item: TitleItem; index: number; isCorrectAttempt: boolean }) {
  const score = attemptProgressStats(attempt.hints)
  const published = item.bookPublicationYear == null
    ? 'Год не указан'
    : item.bookPublicationYear < 0
      ? `${Math.abs(item.bookPublicationYear)} до н. э.`
      : String(item.bookPublicationYear)
  return <article className="attempt-card attempt-card--book">
    <div className="attempt-card__header">
      <span className="attempt-card__number">{String(index + 1).padStart(2, '0')}</span>
      <Poster item={item} />
      <div className="attempt-card__identity">
        <span className="attempt-label">Попытка {index + 1}</span>
        <h2>{item.titleRu}</h2>
        <p className="gm-head__sub"><span className="gm-head__orig">{item.titleOriginal || (item.bookAuthors ?? []).join(', ')}</span></p>
        <div className="gm-genres">
          {(item.bookAuthors ?? []).slice(0, 1).map((author) => <span className="gm-genre" key={author}>{author}</span>)}
          <span className="gm-genre">{published}</span>
        </div>
      </div>
    </div>
    <AttemptScore {...score} isCorrectAttempt={isCorrectAttempt} />
    <div className="attempt-clue-grid book-attempt__clues">
      {attempt.hints.map((hint, hintIndex) => <ClueTile key={hint.key} hint={hint} delay={hintIndex} />)}
    </div>
  </article>
}

const characterSummaryTone = (hint: Attempt['hints'][number] | undefined) => {
  if (!hint || hint.status === 'unknown') return 'miss'
  if (hint.status === 'match') return 'match'
  if (hint.status === 'close' || hint.status === 'partial' || hint.direction) return 'partial'
  return 'miss'
}

const characterSummaryValues = (hint: Attempt['hints'][number] | undefined) => {
  if (!hint) return []
  const values = splitHintValues(hint.value)
  return values.length ? values : [hint.value || 'Нет данных']
}

const characterRolePresentation = (value: string) => {
  const normalized = value.trim().toLocaleLowerCase('ru-RU')
  if (normalized === 'главный герой') return { icon: 'hero', caption: 'Главный' }
  if (normalized === 'главная героиня') return { icon: 'hero', caption: 'Главная' }
  if (normalized === 'герой' || normalized === 'героиня') return { icon: 'hero', caption: value }
  if (normalized === 'антигерой' || normalized === 'антигероиня') return { icon: 'antihero', caption: value }
  return { icon: null, caption: value }
}

function CharacterGenderIcon({ value }: { value: string }) {
  const normalized = normalizeTextMatch(value)
  if (normalized === 'мужчина' || normalized === 'мужской') {
    return <svg className="character-summary__gender" viewBox="0 0 24 24" aria-hidden="true">
      <circle cx="9.5" cy="14.5" r="5.5" />
      <path d="M13.5 10.5 20 4M15 4h5v5" />
    </svg>
  }
  if (normalized === 'женщина' || normalized === 'женский') {
    return <svg className="character-summary__gender" viewBox="0 0 24 24" aria-hidden="true">
      <circle cx="12" cy="8.5" r="5.5" />
      <path d="M12 14v7M8.5 18h7" />
    </svg>
  }
  return <span>{value}</span>
}

function CharacterSummaryTokens({ hint, compact = false }: { hint: Attempt['hints'][number] | undefined; compact?: boolean }) {
  if (!hint) return null
  const matchedValues = new Set((hint.matchedValues ?? []).map(normalizeTextMatch))
  const allMatched = hint.status === 'match'

  return <div className={`character-summary__tokens${compact ? ' is-compact' : ''}`}>
    {characterSummaryValues(hint).map((value) => {
      const matched = allMatched || matchedValues.has(normalizeTextMatch(value))
      const role = characterRolePresentation(value)
      const isGender = hint.key === 'character_gender'
      return <span
        className={`character-summary__token${matched ? ' is-match' : ''}${role?.icon ? ' has-role-icon' : ''}${isGender ? ' is-gender' : ''}`}
        key={`${hint.key}-${value}`}
        title={value}
        aria-label={`${value}${matched ? ', совпало' : ''}`}
      >
        {role?.icon && <i className={`character-summary__role-icon is-${role.icon}`} aria-hidden="true" />}
        {isGender ? <CharacterGenderIcon value={value} /> : <span>{role?.caption ?? value}</span>}
        {matched && !role?.icon && !isGender && <Check aria-hidden="true" />}
      </span>
    })}
    {hint.direction && <i className="character-summary__direction" aria-label={hint.direction === 'up' ? 'Искомый персонаж выше' : 'Искомый персонаж ниже'}>
      {hint.direction === 'up' ? <ArrowUp /> : <ArrowDown />}
    </i>}
  </div>
}

function CharacterSummaryRow({ hint }: { hint: Attempt['hints'][number] | undefined }) {
  if (!hint) return null
  return <div className={`character-summary__row character-summary__row--${characterSummaryTone(hint)}`}>
    <label>{hint.label}</label>
    <CharacterSummaryTokens hint={hint} />
  </div>
}

function CharacterSummaryDetail({ hint }: { hint: Attempt['hints'][number] | undefined }) {
  if (!hint) return null
  const matchedValues = new Set((hint.matchedValues ?? []).map(normalizeTextMatch))
  const allMatched = hint.status === 'match'
  return <div className={`character-summary__detail character-summary__detail--${characterSummaryTone(hint)}`}>
    <label>{hint.label}</label>
    <div>
      {characterSummaryValues(hint).map((value) => <span className={allMatched || matchedValues.has(normalizeTextMatch(value)) ? 'is-match' : ''} key={`${hint.key}-${value}`}>{value}</span>)}
    </div>
  </div>
}

function CharacterSummaryScore({ attempt, isCorrectAttempt }: { attempt: Attempt; isCorrectAttempt: boolean }) {
  const { matchedFields, partialFields, totalFields } = attemptProgressStats(attempt.hints)
  const label = `Точных совпадений: ${matchedFields} из ${totalFields}; частичных: ${partialFields}`
  return <div className={`character-summary__score${isCorrectAttempt ? ' is-correct' : ''}`} aria-label={label}>
    {Array.from({ length: totalFields }, (_, index) => <i key={index} className={index < matchedFields ? 'exact' : index < matchedFields + partialFields ? 'partial' : ''} />)}
  </div>
}

function CharacterAttemptCard({ attempt, item, index, isCorrectAttempt, isAnswerReveal = false }: { attempt: Attempt; item: TitleItem; index: number; isCorrectAttempt: boolean; isAnswerReveal?: boolean }) {
  const byKey = new Map(attempt.hints.map((hint) => [hint.key, hint]))
  const natureHint = byKey.get('character_nature')
  const genderHint = byKey.get('character_gender')
  const identityMatched = natureHint?.status === 'match' && genderHint?.status === 'match'
  const detailKeys = ['character_source_types', 'character_origin_cultures', 'character_age_group', 'character_archetypes', 'character_settings']

  return <article className={`attempt-card attempt-card--character attempt-card--character-summary${isAnswerReveal ? ' attempt-card--answer' : ''}`} aria-label={`${isAnswerReveal ? 'Правильный ответ' : `Попытка ${index + 1}`}: ${item.titleRu}`}>
    <aside className="character-summary__portrait">
      <Poster item={item} className="character-summary__portrait-image" />
      <span className="character-summary__number">{isAnswerReveal ? <Check aria-hidden="true" /> : String(index + 1).padStart(2, '0')}</span>
    </aside>
    <div className="character-summary__body">
      <header className="character-summary__header">
        <h2>{item.titleRu}</h2>
        <CharacterSummaryScore attempt={attempt} isCorrectAttempt={isCorrectAttempt || isAnswerReveal} />
      </header>
      <div className="character-summary__content">
        {(natureHint || genderHint) && <div className={`character-summary__row character-summary__row--identity${identityMatched ? ' is-match' : ''}`}>
          <label>{identityMatched ? 'Совпало' : 'Образ'}</label>
          <div className="character-summary__identity-values">
            <CharacterSummaryTokens hint={natureHint} />
            <CharacterSummaryTokens hint={genderHint} />
          </div>
        </div>}
        <CharacterSummaryRow hint={byKey.get('character_era')} />
        <CharacterSummaryRow hint={byKey.get('character_roles')} />
        <CharacterSummaryRow hint={byKey.get('character_abilities')} />
        <div className="character-summary__details">
          {detailKeys.map((key) => <CharacterSummaryDetail hint={byKey.get(key)} key={key} />)}
        </div>
      </div>
    </div>
  </article>
}

const ATTEMPT_CARD_BY_MODE: Record<TitleMode, typeof AttemptCard> = {
  movie: AttemptCard,
  series: AttemptCard,
  anime: AttemptCard,
  game: GameAttemptCard,
  city: CityAttemptCard,
  music: MusicAttemptCard,
  diagnosis: DiagnosisAttemptCard,
  animal: AnimalAttemptCard,
  book: BookAttemptCard,
  character: CharacterAttemptCard,
}

function ModeAttemptCard(props: Parameters<typeof AttemptCard>[0]) {
  if (isKpopArtistCard(props.item)) return <KpopAttemptCard {...props} />
  const Card = ATTEMPT_CARD_BY_MODE[props.item.mode]
  return <Card {...props} />
}

function Game({
  titles,
  mode,
  variantKey,
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
  freePlayLaunch,
  isPracticeSession,
  searchIndex,
  challenge,
  onPlayNext,
  onReplay,
  replayCost,
  replayShortage,
  replayPending,
  replayAccessSource,
  onConfigureMode,
}: {
  titles: TitleItem[]
  mode: TitleMode
  variantKey: string | null
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
  freePlayLaunch: number | null
  isPracticeSession: boolean
  searchIndex: LibrarySearchIndex | null
  challenge: ChallengePayload | null
  onPlayNext: (mode: TitleMode | null) => void
  onReplay: () => void
  replayCost: number
  replayShortage: number
  replayPending: boolean
  replayAccessSource: 'tickets' | 'club'
  onConfigureMode: () => void
}) {
  const effectivePeriod: PeriodKey = GAME_MODE_MANIFEST[mode].periodPolicy === 'all' ? 'all' : period
  const difficultyVariant = mode === 'music' ? difficulty : ''
  const basePool = useMemo(() => poolFor(titles, mode, effectivePeriod, variantKey), [titles, mode, effectivePeriod, variantKey])
  const pool = useMemo(() => mode === 'music' ? musicDifficultyPool(basePool, difficulty) : basePool, [basePool, mode, difficulty])
  const answerSalt = freePlayLaunch === null ? dailySalt : freePlayAnswerSalt(freePlayLaunch)
  const selectionVariant = variantKey ?? difficultyVariant
  const answer = useMemo(() => pool.length ? dailyTitle(pool, mode, effectivePeriod, date, answerSalt, selectionVariant) : null, [pool, mode, effectivePeriod, date, answerSalt, selectionVariant])
  const modeVariantSuffix = variantKey ? `|variant:${variantKey}` : ''
  const baseKey = difficultyVariant ? `${gameKey(mode, effectivePeriod, date)}|diff:${difficultyVariant}${modeVariantSuffix}` : `${gameKey(mode, effectivePeriod, date)}${modeVariantSuffix}`
  const key = freePlayLaunch === null
    ? dailySalt === 0 ? baseKey : `${baseKey}|salt:${dailySalt}`
    : freePlayGameKey(baseKey, freePlayLaunch)
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
  const assistHintCatalog = useMemo(() => answer ? buildAssistHints(answer, []) : [], [answer])
  const assistHints = useMemo(() => answer ? buildAssistHints(answer, hintChoices, attempts) : [], [answer, attempts, hintChoices])
  const availableAssistHintKeys = useMemo(
    () => new Set<AssistHintKey>(assistHintCatalog.filter((hint) => hint.available).map((hint) => hint.key)),
    [assistHintCatalog],
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

    if (restoredStatus === 'playing') {
      trackGameStartOnce(key, {
        mode,
        period: effectivePeriod,
        kind: freePlayLaunch === null ? 'daily' : 'free_play',
        state: saved ? 'resumed' : 'new',
      })
    }

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
    setGameMatchStripOpen(true)
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
  const usedTitles = useMemo(() => pool.filter((item) => used.has(item.id)), [pool, used])
  const alreadyUsedQuery = matchesUsedSearchQuery(debouncedQuery, usedTitles)
  const latestMatchCount = attempts.length ? attemptProgressStats(attempts.at(-1)!.hints).matchedFields : 0
  const searchPending = Boolean(query.trim()) && query.trim() !== debouncedQuery.trim()

  const isSuggestionsOpen = isSearchDropdownOpen && Boolean(query) && !selected
  const selectSuggestion = (item: TitleItem) => {
    dispatchSession({ type: 'set_selected', selected: item })
    dispatchSession({ type: 'set_query', query: item.titleRu })
    dispatchSession({ type: 'set_message', message: '' })
    setIsSearchDropdownOpen(false)
    inputRef.current?.focus()
  }

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
  const revealedAssistHints = useMemo(() => answer ? buildRevealedAssistHints(answer, hintChoices) : [], [answer, hintChoices])
  const currentRound = Math.min(attempts.length + 1, 10)
  const unlockedHintRounds: HintCheckpoint[] = []
  if (currentRound >= 5) unlockedHintRounds.push(5)
  if (currentRound >= 8) unlockedHintRounds.push(8)
  const usedHintRounds = useMemo(() => new Set(hintChoices.map((choice) => choice.round)), [hintChoices])
  const pendingHintRounds = useMemo(() => unlockedHintRounds.filter((round) => !usedHintRounds.has(round)), [unlockedHintRounds, usedHintRounds])
  const nextHintRound = pendingHintRounds[0] ?? null
  const nextUndismissedHintRound = pendingHintRounds.find((round) => !dismissedHintRounds.includes(round)) ?? null
  const preferredHintRound = nextUndismissedHintRound ?? nextHintRound
  const canUseHint = status === 'playing' && pendingHintRounds.length > 0 && assistHints.some((hint) => hint.available)
  const hintTriggerLabel = pendingHintRounds.length > 1 ? `Подсказка ×${pendingHintRounds.length}` : 'Подсказка'
  const isFreePlaySession = freePlayLaunch !== null
  const showTodayLink = !isFreePlaySession && date !== getMoscowDate()
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
      ...(variantKey ? { variantKey } : {}),
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
  const submit = (selection: TitleItem | null = selected) => {
    const nextSelection = selection
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
    if (mode === 'diagnosis') {
      trackDiagnosisGoal('attempt', {
        period: effectivePeriod,
        attempt: nextAttempts.length,
        status: nextStatus,
      })
    }
    if (nextStatus === 'won') {
      trackMetrikaGoal('game_won', { mode, period: effectivePeriod, attempts: nextAttempts.length })
      if (mode === 'diagnosis') trackDiagnosisGoal('win', { period: effectivePeriod, attempts: nextAttempts.length })
    }
    if (nextStatus === 'lost') {
      trackMetrikaGoal('game_lost', { mode, period: effectivePeriod, attempts: nextAttempts.length })
    }
    if (nextStatus !== 'playing') {
      trackGameCompleteOnce(key, {
        mode,
        period: effectivePeriod,
        kind: freePlayLaunch === null ? 'daily' : 'free_play',
        attempts: nextAttempts.length,
        outcome: nextStatus,
      })
    }
    if (nextStatus !== 'playing' && challenge) {
      const outcome = challengeOutcome(nextAttempts.length, challenge.opponentAttempts)
      trackMetrikaGoal('challenge_completed', { mode, attempts: nextAttempts.length, opponentAttempts: challenge.opponentAttempts })
      trackMetrikaGoal(outcome === 'won' ? 'challenge_won' : 'challenge_lost', { mode, outcome })
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
    if (nextStatus === 'playing') {
      requestAnimationFrame(() => {
        inputRef.current?.focus({ preventScroll: true })
        setIsSearchDropdownOpen(true)
      })
    } else {
      setTimeout(() => document.querySelector('.result-card')?.scrollIntoView({ behavior: 'smooth', block: 'start' }), 100)
    }
  }

  if (!answer) return <div className="loading">В этой теме пока нет записей.</div>

  const attendance = loadDailyAttendance(date)
  const completedToday = new Set(attendance.completedModes).size
  const nextMode = nextResultMode(mode, attendance.completedModes)
  const recommendedModes = resultRecommendedModes(mode, nextMode)
  const routeCompleted = !nextMode
  const nextLabel = nextMode ? `Играть дальше: ${modeMeta(nextMode).title}` : 'На главную'
  const configureLabel = routeCompleted ? 'Выбрать другой режим' : resultConfigureLabel(mode)
  const challengeLink = buildChallengeUrl(location.href, {
    mode,
    date,
    period: effectivePeriod,
    ...(mode === 'music' ? { difficulty } : {}),
    ...(variantKey ? { variantKey } : {}),
    opponentAttempts: Math.max(1, attempts.length),
    from: getInstallationId(),
  })
  const resultShareText = resultTextForSession(mode, date, effectivePeriod, attempts.map((attempt) => attempt.hints), status === 'won', 10, isFreePlaySession)
  const telegramUrl = `https://t.me/share/url?url=${encodeURIComponent(challengeLink)}&text=${encodeURIComponent(resultShareText)}`
  const shareChallenge = async () => {
    trackMetrikaGoal(challenge ? 'challenge_reshared' : 'challenge_created', { mode, period: effectivePeriod, attempts: attempts.length })
    trackMetrikaGoal('native_share_opened', { mode })
    const outcome = await shareTextWithFallback('Сходится! — вызов', resultShareText, challengeLink)
    if (outcome === 'native-completed') trackMetrikaGoal('native_share_completed', { mode })
    if (outcome === 'copied') {
      trackMetrikaGoal('share_copy', { mode, period: effectivePeriod, status, placement: 'challenge' })
      setCopied(true)
      setTimeout(() => setCopied(false), 1800)
    }
    if (outcome !== 'failed' && mode === 'diagnosis') trackDiagnosisGoal('share', { period: effectivePeriod, status })
    if (outcome === 'failed') dispatchSession({ type: 'set_message', message: 'Не удалось поделиться результатом' })
  }
  const reportContent = (reason: ContentReportReason, comment: string) => {
    const key = 'seans:v1:content-reports'
    let reports: unknown[] = []
    try { reports = JSON.parse(localStorage.getItem(key) ?? '[]') as unknown[] } catch { reports = [] }
    localStorage.setItem(key, JSON.stringify([...reports.slice(-99), { mode, date, answerId: answer.id, reason, comment, at: new Date().toISOString() }]))
    trackMetrikaGoal('content_report_submitted', { mode, reason })
  }
  const resultMeta = resultCardMeta(answer)
  const resultTags = resultCardTags(answer)

  return <>
    <GamePageFrame controller={{ source: 'local', mode, puzzleDate: date, status, attemptsCount: attempts.length, variantKey }} navigation={{ onHome, onArchive, onStats, onRules, onReview }} onBack={() => {
      trackMetrikaGoal('game_back_click', { mode, period: effectivePeriod })
      onBack()
    }}>
      <section className={`game-heading${mode === 'diagnosis' ? ' game-heading--diagnosis' : ''}`}>
        <div>
          <div className="game-heading__kicker">
            <span>
              {isFreePlaySession ? `Свободная игра · Партия №${freePlayLaunch}` : `${date === getMoscowDate() ? 'Сегодня' : 'Архив'} · Сеанс №${dayNumber(date)}`}
              {headingPeriodBadge ? ` · ${headingPeriodBadge}` : ''}
            </span>
          </div>
          <h1>{isFreePlaySession ? `Угадай ${modeMeta(mode).subjectGenitive}` : `${modeMeta(mode).daily} дня`}</h1>
          <p>{isFreePlaySession ? 'Случайная загадка · можно играть снова сразу' : `${prettyDate(date)} · обновление в 00:00 МСК`}</p>
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

      {status === 'playing' && <div className="progress-row">
        <SegmentedProgress value={attempts.length} />
        {canUseHint && !hintModalRound && <ActionButton variant="hint" className="hint-trigger" onClick={() => {
          if (!preferredHintRound) return
          trackMetrikaGoal('open_hint_modal', { mode, period: effectivePeriod, round: preferredHintRound })
          setHintModalRound(preferredHintRound)
        }}><Sparkles /> {hintTriggerLabel}</ActionButton>}
      </div>}

      {!!revealedAssistHints.length && <section className="assist-revealed" aria-label="Открытые подсказки">
        {revealedAssistHints.map((hint, index) => <article key={`${hint.key}-${index}`} className="assist-reveal-card">
          <span><Sparkles /> {hint.title}</span>
          {hint.body && <p>{renderHintBody(hint.body)}</p>}
          {hint.value != null && <AssistHintValue value={hint.value} />}
          {!!hint.people?.length && <div className="assist-people-row">
            {hint.people.map((person, index) => <PersonPortrait key={`${personName(person)}-${index}`} person={person} />)}
          </div>}
        </article>)}
      </section>}

      {status !== 'playing' && <GameResult
        mode={mode}
        won={status === 'won'}
        attempts={attempts.length}
        poster={<Poster item={answer} />}
        title={answer.titleRu}
        meta={resultMeta}
        tags={resultTags}
        completedToday={completedToday}
        nextRewardText={completedToday >= FULL_HOUSE_MODE_IDS.length ? 'Маршрут дня завершён' : completedToday === 2 ? 'До награды: ещё одна игра' : `До полного маршрута: ещё ${FULL_HOUSE_MODE_IDS.length - completedToday}`}
        nextLabel={nextLabel}
        nextActionLabel={routeCompleted ? 'Перейти' : 'Играть'}
        nextMode={nextMode ?? undefined}
        recommendedModes={recommendedModes}
        award={lastAward}
        streak={lastAward?.newDailyStreak ?? loadAttendanceStats().currentDailyStreak}
        copied={copied}
        telegramUrl={telegramUrl}
        challengeOutcome={challenge ? challengeOutcome(attempts.length, challenge.opponentAttempts) : undefined}
        opponentAttempts={challenge?.opponentAttempts}
        onNext={() => {
          if (nextMode) trackNextGameClick(mode, nextMode, { outcome: status })
          if (routeCompleted) onHome()
          else onPlayNext(nextMode)
        }}
        onRecommendedMode={(recommendedMode) => {
          trackNextGameClick(mode, recommendedMode, { outcome: status, placement: 'diagnosis-result-recommendations' })
          onPlayNext(recommendedMode)
        }}
        configureLabel={configureLabel}
        onConfigure={onConfigureMode}
        onChallenge={shareChallenge}
        onReplay={onReplay}
        replayCost={replayCost}
        replayShortage={replayShortage}
        replayPending={replayPending}
        replayAccessSource={replayAccessSource}
        onReport={reportContent}
      />}

      {status === 'lost' && mode === 'character' && <section className="answer-reveal" aria-label="Правильный ответ и все его признаки">
        <div className="section-title"><span>Правильный ответ</span><strong>10/10</strong></div>
        <CharacterAttemptCard
          attempt={{ titleId: answer.id, hints: compareTitles(answer, answer) }}
          item={answer}
          index={attempts.length}
          isCorrectAttempt
          isAnswerReveal
        />
      </section>}

      {status === 'playing' && <section className="search-area search-area--sticky">
        <div className="sticky-composer__status">
          <span>Попытка {Math.min(attempts.length + 1, 10)} из 10</span>
          {!!attempts.length && <strong>{latestMatchCount} {latestMatchCount === 1 ? 'признак совпал' : latestMatchCount >= 2 && latestMatchCount <= 4 ? 'признака совпали' : 'признаков совпали'}</strong>}
        </div>
        <SearchCombobox
          containerRef={searchPickerRef}
          inputProps={{
            ref: inputRef,
            id: 'movie-search',
            'aria-label': mode === 'diagnosis' ? 'Введите диагноз' : mode === 'animal' ? 'Введите животное' : mode === 'book' ? 'Введите книгу' : mode === 'game' ? 'Введите игру' : mode === 'music' ? 'Введите артиста' : 'Введите название',
            value: query,
            autoComplete: 'off',
            placeholder: modeMeta(mode).searchPlaceholder,
            onFocus: () => setIsSearchDropdownOpen(true),
            onChange: (event) => {
              dispatchSession({ type: 'set_query', query: event.target.value })
              dispatchSession({ type: 'set_selected', selected: null })
              dispatchSession({ type: 'set_active_index', index: 0 })
              dispatchSession({ type: 'set_message', message: '' })
              setIsSearchDropdownOpen(true)
            },
            onKeyDown: (event) => {
              if (event.key === 'Escape' && isSuggestionsOpen) {
                event.preventDefault()
                setIsSearchDropdownOpen(false)
                return
              }
              if (event.key === 'ArrowDown') {
                if (!suggestions.length || selected) return
                event.preventDefault()
                dispatchSession({ type: 'set_active_index', index: activeSuggestionIndex < 0 ? 0 : Math.min(activeSuggestionIndex + 1, suggestions.length - 1) })
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
                if (selected) submit()
                else if (suggestions.length) selectSuggestion(suggestions[activeSuggestionIndex >= 0 ? activeSuggestionIndex : 0])
                else submit()
              }
            },
          }}
          selected={Boolean(selected)}
          open={isSuggestionsOpen}
          loading={searchPending}
          loadingLabel="Ищем в текущем пуле…"
          suggestions={suggestions}
          activeIndex={activeSuggestionIndex}
          emptyMessage={alreadyUsedQuery ? 'Вы уже использовали этот вариант в текущей партии.' : searchEmptyMessage(mode)}
          submitDisabled={!selected}
          onSubmit={() => {
            if (selected) submit()
          }}
          onSuggestionHover={(_, index) => dispatchSession({ type: 'set_active_index', index })}
          onSuggestionSelect={(item) => commitSuggestionAttempt(item, selectSuggestion, submit)}
          getSuggestionKey={(item) => item.id}
          renderSuggestion={(item) => <>
            <Poster item={item} />
            <span><strong>{item.titleRu}</strong><small>{searchResultMeta(item)}</small></span>
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
          </>}
        />
        <GameMatchStrip attempts={attempts} mode={mode} open={gameMatchStripOpen} onToggle={() => {
          trackMetrikaGoal('toggle_match_strip', { mode, period: effectivePeriod })
          setGameMatchStripOpen((current) => !current)
        }} />
        {message && <div className="search-meta"><strong>{message}</strong></div>}
      </section>}

      {!attempts.length && status === 'playing' && <section className="empty-card">
        <div className="empty-card__icon">{modeIcon(mode)}</div>
        <div><h2>Начните с {modeMeta(mode).emptyArticle} {modeMeta(mode).subjectGenitive}</h2><p>{MODE_PRESENTATION[mode].emptyHint}</p></div>
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
          return <ModeAttemptCard key={`${attempt.titleId}-${index}`} attempt={attempt} item={item} index={index} isCorrectAttempt={isCorrectAttempt} />
        })}
      </section>}
    </GamePageFrame>

    {hintModalRound && <DialogSurface backdropClassName="hint-modal-backdrop" className="hint-modal" onClose={dismissHintModal} ariaLabelledBy="hint-modal-title">
        <div className="hint-modal__head">
          <span><Sparkles /> Возможность · попытка {hintModalRound}</span>
          <ControlButton onClick={dismissHintModal} aria-label="Закрыть"><X /></ControlButton>
        </div>
        <h2 id="hint-modal-title">{CATALOG_HINT_COPY[mode].modalTitle}</h2>
        <p>{hintModalRound === 5 ? 'Это первая возможность. Если пропустить её сейчас, она всё равно останется доступной до конца сеанса.' : 'Это вторая возможность. Её также можно открыть в любой момент до конца сеанса.'}</p>
        <div className="hint-modal__options">
          {assistHints.filter((hint) => hint.available).map((hint, index) => <ControlButton key={`${hint.key}-${index}`} onClick={() => revealAssistHint(hint.key)}>
            <i>0{index + 1}</i><span><strong>{hint.title}</strong><small>{hint.subtitle}</small></span><ChevronRight />
          </ControlButton>)}
        </div>
        <ControlButton className="hint-modal__later" onClick={dismissHintModal}>Не сейчас</ControlButton>
    </DialogSurface>}

    {anamnesisOpen && !!anamnesisText && <AnamnesisModal text={anamnesisText} dayNo={dayNumber(date)} onClose={() => setAnamnesisOpen(false)} />}
  </>
}

const serverAttemptToLegacy = (entry: GameAttemptSnapshot): Attempt => ({ titleId: entry.item.id, hints: entry.hints })

const withRevealedServerHint = (current: GameResponse | undefined, response: HintResponse): GameResponse | undefined => {
  if (!current) return current
  const nextChoice = { checkpoint: response.checkpoint, hintKey: response.hintKey, response }
  const hintChoices = current.session.hintChoices.some((choice) => choice.checkpoint === response.checkpoint)
    ? current.session.hintChoices.map((choice) => choice.checkpoint === response.checkpoint ? nextChoice : choice)
    : [...current.session.hintChoices, nextChoice].sort((left, right) => left.checkpoint - right.checkpoint)
  return {
    ...current,
    session: {
      ...current.session,
      hintChoices,
      hintCheckpoints: current.session.hintCheckpoints.map((checkpoint) => checkpoint.round === response.checkpoint
        ? { ...checkpoint, state: 'opened' }
        : checkpoint),
    },
  }
}

function ServerGame({ sessionId, onHome, onBack, onArchive, onStats, onRules, onReview, onPlayNext, onReplay, replayCost, replayShortage, replayPending, replayAccessSource, onConfigureMode, onSessionLoaded, onPackSession }: {
  sessionId: string
  onHome: () => void
  onBack: () => void
  onArchive: () => void
  onStats: () => void
  onRules: () => void
  onReview: () => void
  onPlayNext: (mode: TitleMode | null) => void
  onReplay: () => void
  replayCost: number
  replayShortage: number
  replayPending: boolean
  replayAccessSource: 'tickets' | 'club'
  onConfigureMode: () => void
  onSessionLoaded: (session: GameSessionSnapshot) => void
  onPackSession: (session: GameSessionSnapshot) => void
}) {
  const client = useQueryClient()
  const [query, setQuery] = useState('')
  const [selected, setSelected] = useState<PublicContentItem | null>(null)
  const [activeSuggestionIndex, setActiveSuggestionIndex] = useState(0)
  const debouncedQuery = useDebouncedValue(query.trim(), 120)
  const [message, setMessage] = useState('')
  const [copied, setCopied] = useState(false)
  const [gameMatchStripOpen, setGameMatchStripOpen] = useState(false)
  const [leaderboardOpen, setLeaderboardOpen] = useState(false)
  const [hintModalRound, setHintModalRound] = useState<5 | 8 | null>(null)
  const [revealedHint, setRevealedHint] = useState<HintResponse | null>(null)
  const [dismissedHintRounds, setDismissedHintRounds] = useState<Array<5 | 8>>([])
  const [lastAward, setLastAward] = useState<AttemptResponse['reward'] | null>(null)
  const [selectedFinalCandidateId, setSelectedFinalCandidateId] = useState<string | null>(null)
  const [finalChoiceSeconds, setFinalChoiceSeconds] = useState(FINAL_CHOICE_DURATION_SECONDS)
  const attemptKeyRef = useRef<string | null>(null)
  const finalChoiceKeyRef = useRef<string | null>(null)
  const finalChoiceShownRef = useRef<string | null>(null)
  const finalChoiceStartedAtRef = useRef<number | null>(null)
  const finalChoiceTimeoutSubmittedRef = useRef(false)
  const hintKeyRef = useRef<string | null>(null)
  const game = useQuery({ queryKey: queryKeys.game(sessionId), queryFn: () => api.game(sessionId), refetchOnWindowFocus: true })
  const session = game.data?.session
  const sessionOwnsLifecycle = session?.engine !== 'danetki_chat'
    || Boolean(session.danetki.members.some((member) => member.userId === session.danetki.currentUserId && member.role === 'owner'))
  const packDetail = useQuery({
    queryKey: queryKeys.pack(session?.packId ?? ''),
    queryFn: () => api.pack(session!.packId!),
    enabled: Boolean(session?.kind === 'pack' && session.packId),
  })
  const packLeaderboard = useQuery({
    queryKey: queryKeys.packLeaderboard(session?.packId ?? ''),
    queryFn: () => api.packLeaderboard(session!.packId!),
    enabled: session?.kind === 'pack' && session.packId === DTF_COMMENTS_PACK_ID,
    staleTime: 30_000,
  })
  const dashboard = useQuery({ queryKey: queryKeys.dashboard, queryFn: api.dashboard })
  const searchParams = useMemo(() => {
    if (!session || !debouncedQuery || selected) return null
    return new URLSearchParams({ mode: session.mode, q: debouncedQuery, sessionId, limit: '10' })
  }, [debouncedQuery, selected, session, sessionId])
  const search = useQuery({ queryKey: queryKeys.search(sessionId, debouncedQuery), queryFn: () => api.search(searchParams!), enabled: Boolean(searchParams), staleTime: 15_000 })
  const attempt = useMutation({
    mutationFn: ({ itemId, key }: { itemId: string; key: string }) => api.attempt(sessionId, itemId, key),
    retry: (count, error) => count < 1 && error instanceof ApiClientError && error.code === 'NETWORK_TIMEOUT',
    onSuccess: async (response) => {
      attemptKeyRef.current = null
      setQuery('')
      setSelected(null)
      setActiveSuggestionIndex(0)
      setMessage('')
      const attemptAnalytics = {
        mode: session?.mode ?? 'unknown',
        period: session?.period ?? 'unknown',
        attempt: response.session.attemptsCount,
        status: response.session.status,
      }
      trackMetrikaGoal('submit_attempt', attemptAnalytics)
      if (session?.mode === 'diagnosis') {
        trackDiagnosisGoal('attempt', {
          period: session.period,
          attempt: response.session.attemptsCount,
          status: response.session.status,
        })
      }
      if (response.session.status === 'won') {
        trackMetrikaGoal('game_won', { ...attemptAnalytics, attempts: response.session.attemptsCount })
        if (session?.mode === 'diagnosis') {
          trackDiagnosisGoal('win', { period: session.period, attempts: response.session.attemptsCount })
        }
      }
      if (response.session.status === 'lost' || response.session.status === 'expired') {
        trackMetrikaGoal('game_lost', { ...attemptAnalytics, attempts: response.session.attemptsCount })
      }
      if (['won', 'lost', 'expired'].includes(response.session.status)) {
        trackGameCompleteOnce(sessionId, {
          ...attemptAnalytics,
          attempts: response.session.attemptsCount,
          outcome: response.session.status,
          kind: session?.kind ?? 'unknown',
        })
      }
      if (response.reward) {
        setLastAward(response.reward)
        trackClientEvent('ticket_earned', {
          balanceBefore: response.reward.balanceAfter - response.reward.total,
          balanceAfter: response.reward.balanceAfter,
          amount: response.reward.total,
          required: 0,
          shortage: 0,
          source: 'daily-game',
          sink: null,
          mode: session?.mode ?? null,
          sessionKind: session?.kind ?? null,
          dailyCompletedCount: new Set([...(dashboard.data?.today?.completedModes ?? []), ...(session?.mode ? [session.mode] : [])]).size,
          streak: dashboard.data?.attendance?.currentDailyStreak ?? 0,
          rulesVersion: response.reward.rulesVersion,
          hasClub: dashboard.data?.membership.active ?? false,
        }, { gameSessionId: sessionId })
      }
      await Promise.all([
        client.invalidateQueries({ queryKey: queryKeys.game(sessionId) }),
        client.invalidateQueries({ queryKey: queryKeys.dashboard }),
        client.invalidateQueries({ queryKey: queryKeys.ledger }),
        client.invalidateQueries({ queryKey: ['archive'] }),
        ...(session?.packId ? [
          client.invalidateQueries({ queryKey: queryKeys.pack(session.packId) }),
          client.invalidateQueries({ queryKey: queryKeys.packLeaderboard(session.packId) }),
        ] : []),
      ])
    },
    onError: async (error) => {
      setMessage(apiErrorMessage(error))
      if (error instanceof ApiClientError && (error.status === 409 || error.code === 'NETWORK_TIMEOUT')) await client.invalidateQueries({ queryKey: queryKeys.game(sessionId) })
    },
  })
  const hint = useMutation({
    mutationFn: ({ checkpoint, hintKey, key }: { checkpoint: 5 | 8; hintKey: AssistHintKey; key: string }) => api.hint(sessionId, checkpoint, hintKey, key),
    retry: (count, error) => count < 1 && error instanceof ApiClientError && error.code === 'NETWORK_TIMEOUT',
    onSuccess: async (response) => {
      hintKeyRef.current = null
      client.setQueryData<GameResponse>(queryKeys.game(sessionId), (current) => withRevealedServerHint(current, response))
      setRevealedHint(response)
      setMessage('')
      await client.invalidateQueries({ queryKey: queryKeys.game(sessionId) })
    },
    onError: async (error) => {
      setMessage(apiErrorMessage(error))
      if (error instanceof ApiClientError && (error.status === 409 || error.code === 'NETWORK_TIMEOUT')) await client.invalidateQueries({ queryKey: queryKeys.game(sessionId) })
    },
  })
  const finalChoiceMutation = useMutation({
    mutationFn: ({ body, key }: {
      body: { action: 'choose'; itemId: string } | { action: 'reveal' }
      key: string
    }) => api.finalChoice(sessionId, body, key),
    retry: (count, error) => count < 1 && error instanceof ApiClientError && error.code === 'NETWORK_TIMEOUT',
    onSuccess: async (response, variables) => {
      finalChoiceKeyRef.current = null
      setSelectedFinalCandidateId(response.selectedItemId)
      setMessage('')
      const finalChoiceAnalytics = {
        mode: session?.mode ?? 'unknown',
        period: session?.period ?? 'unknown',
        attempts: response.session.attemptsCount,
        status: response.session.status,
        completionType: response.session.completionType ?? 'standard',
      }
      if (response.session.status === 'won') {
        trackMetrikaGoal('game_won', finalChoiceAnalytics)
        if (session?.mode === 'diagnosis') trackDiagnosisGoal('win', finalChoiceAnalytics)
      } else {
        trackMetrikaGoal('game_lost', finalChoiceAnalytics)
      }
      trackGameCompleteOnce(sessionId, {
        ...finalChoiceAnalytics,
        outcome: response.session.status,
        kind: session?.kind ?? 'unknown',
      })
      if (response.reward) {
        setLastAward(response.reward)
        trackClientEvent('ticket_earned', {
          balanceBefore: response.reward.balanceAfter - response.reward.total,
          balanceAfter: response.reward.balanceAfter,
          amount: response.reward.total,
          source: 'daily-game',
          mode: session?.mode ?? null,
          sessionKind: session?.kind ?? null,
          rulesVersion: response.reward.rulesVersion,
        }, { gameSessionId: sessionId })
      }
      trackClientEvent(response.timedOut ? 'final_choice_timed_out' : variables.body.action === 'reveal' ? 'final_choice_revealed' : 'final_choice_submitted', {
        sessionId,
        mode: session?.mode,
        kind: session?.kind,
        packId: session?.packId,
        attemptsCount: session?.attemptsCount,
        correct: response.correct,
        timeToDecisionMs: finalChoiceStartedAtRef.current ? Math.max(0, Date.now() - finalChoiceStartedAtRef.current) : null,
      }, { gameSessionId: sessionId })
      await Promise.all([
        client.invalidateQueries({ queryKey: queryKeys.game(sessionId) }),
        client.invalidateQueries({ queryKey: queryKeys.dashboard }),
        client.invalidateQueries({ queryKey: queryKeys.ledger }),
        client.invalidateQueries({ queryKey: ['archive'] }),
        ...(session?.packId ? [
          client.invalidateQueries({ queryKey: queryKeys.pack(session.packId) }),
          client.invalidateQueries({ queryKey: queryKeys.packLeaderboard(session.packId) }),
        ] : []),
      ])
    },
    onError: async (error) => {
      finalChoiceTimeoutSubmittedRef.current = false
      setMessage(apiErrorMessage(error))
      if (error instanceof ApiClientError && (error.status === 409 || error.code === 'NETWORK_TIMEOUT')) {
        await client.invalidateQueries({ queryKey: queryKeys.game(sessionId) })
      }
    },
  })
  const nextPackSession = useMutation({
    mutationFn: ({ packId, position }: { packId: string; position: number }) => api.startPack(packId, position),
    onSuccess: (response) => {
      setMessage('')
      trackConfirmedServerStart(response.session.id, {
        mode: response.session.mode,
        period: response.session.period,
        kind: response.session.kind,
        state: 'new',
      })
      onPackSession(response.session)
    },
    onError: (error) => setMessage(apiErrorMessage(error)),
  })

  useEffect(() => {
    setHintModalRound(null)
    setRevealedHint(null)
    setDismissedHintRounds([])
    setLeaderboardOpen(false)
    setQuery('')
    setSelected(null)
    setActiveSuggestionIndex(0)
    setSelectedFinalCandidateId(null)
    finalChoiceKeyRef.current = null
    finalChoiceShownRef.current = null
    finalChoiceStartedAtRef.current = null
    finalChoiceTimeoutSubmittedRef.current = false
    setFinalChoiceSeconds(FINAL_CHOICE_DURATION_SECONDS)
  }, [sessionId])

  useEffect(() => {
    if (!session) return
    setGameMatchStripOpen(true)
    applyRuntimeSeo(window.location.pathname, `/games/${session.mode}`)
    if (session.status === 'playing' || session.status === 'final_choice') {
      if (sessionOwnsLifecycle) trackObservedServerStart(session.id, {
        mode: session.mode,
        period: session.period,
        kind: session.kind,
        state: (session.engine === 'danetki_chat' ? session.danetki.questionCount : session.attemptsCount) > 0 ? 'resumed' : 'new',
      })
    } else if (sessionOwnsLifecycle && ['won', 'lost', 'expired'].includes(session.status)) {
      trackServerGameCompleteObserved(session.id, {
        mode: session.mode,
        period: session.period,
        kind: session.kind,
        outcome: session.status,
        attempts: session.attemptsCount,
        completionType: session.completionType ?? 'standard',
      })
    }
  }, [sessionOwnsLifecycle, session?.completionType, session?.id, session?.kind, session?.mode, session?.period, session?.status, session?.attemptsCount])

  useEffect(() => {
    if (session?.status !== 'final_choice' || !session.finalChoice) return
    setHintModalRound(null)
    setGameMatchStripOpen(true)
    if (finalChoiceShownRef.current === session.id) return
    finalChoiceShownRef.current = session.id
    finalChoiceStartedAtRef.current = Date.now()
    finalChoiceTimeoutSubmittedRef.current = false
    trackClientEvent('final_choice_shown', {
      sessionId: session.id,
      mode: session.mode,
      kind: session.kind,
      packId: session.packId,
      attemptsCount: session.attemptsCount,
      algorithmVersion: session.rulesVersion,
    }, { gameSessionId: session.id })
  }, [session])

  useEffect(() => {
    if (session?.status !== 'final_choice' || !session.finalChoice) {
      setFinalChoiceSeconds(FINAL_CHOICE_DURATION_SECONDS)
      finalChoiceTimeoutSubmittedRef.current = false
      return
    }
    const fallbackStartedAt = finalChoiceStartedAtRef.current ?? Date.now()
    const expiresAt = session.finalChoice.expiresAt
      ?? new Date(fallbackStartedAt + FINAL_CHOICE_DURATION_SECONDS * 1_000).toISOString()
    const tick = () => {
      const seconds = finalChoiceSecondsRemaining(expiresAt)
      setFinalChoiceSeconds(seconds)
      if (seconds > 0 || finalChoiceMutation.isPending || finalChoiceTimeoutSubmittedRef.current) return
      finalChoiceTimeoutSubmittedRef.current = true
      const key = finalChoiceKeyRef.current ?? crypto.randomUUID()
      finalChoiceKeyRef.current = key
      finalChoiceMutation.mutate({ body: { action: 'reveal' }, key })
    }
    tick()
    const interval = window.setInterval(tick, 200)
    return () => window.clearInterval(interval)
  }, [finalChoiceMutation.isPending, session?.finalChoice, session?.status])

  const hintOptions = session?.hintOptions ?? []
  const usedHintRounds = useMemo(() => new Set((session?.hintChoices ?? []).map((choice) => choice.checkpoint)), [session?.hintChoices])
  const pendingHintRounds = useMemo(() => (session?.hintCheckpoints ?? [])
    .filter((checkpoint) => checkpoint.state === 'available')
    .map((checkpoint) => checkpoint.round)
    .filter((round) => !usedHintRounds.has(round)), [session?.hintCheckpoints, usedHintRounds])
  const nextUndismissedHintRound = useMemo(() => pendingHintRounds.find((round) => !dismissedHintRounds.includes(round)) ?? null, [pendingHintRounds, dismissedHintRounds])
  const canUseHint = session?.status === 'playing' && hintOptions.length > 0 && pendingHintRounds.length > 0
  const availableHintRound = pendingHintRounds[0] ?? null
  const dismissHintModal = useCallback(() => {
    if (hint.isPending) return
    if (revealedHint) {
      setRevealedHint(null)
      setHintModalRound(null)
      return
    }
    if (hintModalRound) {
      setDismissedHintRounds((current) => current.includes(hintModalRound) ? current : [...current, hintModalRound])
    }
    setHintModalRound(null)
  }, [hint.isPending, hintModalRound, revealedHint])
  useEffect(() => {
    if (revealedHint) return
    if (!canUseHint) {
      if (hintModalRound) setHintModalRound(null)
      return
    }
    if (hintModalRound && !pendingHintRounds.includes(hintModalRound)) {
      setHintModalRound(null)
      return
    }
    if (!hintModalRound && nextUndismissedHintRound) {
      setHintModalRound(nextUndismissedHintRound)
    }
  }, [canUseHint, hintModalRound, nextUndismissedHintRound, pendingHintRounds, revealedHint])

  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key !== 'Escape') return
      if (isEditableTarget(event.target)) return
      event.preventDefault()
      if (hintModalRound || leaderboardOpen) return
      onBack()
    }
    window.addEventListener('keydown', onKeyDown)
    return () => window.removeEventListener('keydown', onKeyDown)
  }, [hintModalRound, leaderboardOpen, onBack])

  useEffect(() => {
    if (session) onSessionLoaded(session)
  }, [session, onSessionLoaded])

  if (game.isLoading) return <div className="loading"><Sparkles /> Восстанавливаем сеанс…</div>
  if (!session) return <><AppHeader onHome={onHome} onArchive={onArchive} onStats={onStats} onRules={onRules} onReview={onReview} /><main className="loading loading--error" role="alert"><AlertTriangle /><h1>Сеанс не открылся</h1><p>{apiErrorMessage(game.error)}</p><ActionButton onClick={onBack}>Назад</ActionButton></main></>
  if (session.engine === 'danetki_chat' && session.danetki) {
    const DanetkiRenderer = SESSION_RENDERER_BY_ENGINE.danetki_chat
    return <DanetkiRenderer sessionId={sessionId} session={session} onHome={onHome} onBack={onBack} onArchive={onArchive} onStats={onStats} onRules={onRules} onReview={onReview} onPlayNext={onPlayNext} />
  }
  if (session.engine === 'connections_grid' && session.connections) {
    const ConnectionsRenderer = SESSION_RENDERER_BY_ENGINE.connections_grid
    return <ConnectionsRenderer sessionId={sessionId} session={session} onHome={onHome} onBack={onBack} onArchive={onArchive} onStats={onStats} onRules={onRules} onReview={onReview} onPlayNext={onPlayNext} />
  }

  const isPromptSession = Boolean(session.promoPrompt)
  const isDtfCommentSession = session.promoPrompt?.packId === DTF_COMMENTS_PACK_ID
  const isKpopSession = session.variantKey === KPOP_ARTISTS_PACK_ID || session.packId === KPOP_ARTISTS_PACK_ID
  const maxAttempts = session.maxAttempts ?? 10
  const promoHints = isPromptSession
    ? session.progressiveHints
      .map((entry) => {
        const value = typeof entry.value === 'object' && entry.value !== null ? entry.value as Record<string, unknown> : null
        const text = typeof value?.text === 'string' ? value.text.trim() : ''
        if (!text) return null
        const unlockAfterAttempts = typeof value?.unlockAfterAttempts === 'number' ? value.unlockAfterAttempts : null
        const authorArchetype = typeof value?.authorArchetype === 'string' ? value.authorArchetype.trim() : ''
        const stringField = (key: string) => typeof value?.[key] === 'string'
          ? String(value[key]).trim()
          : ''
        const countField = (key: string) => typeof value?.[key] === 'number' && Number.isFinite(value[key])
          ? Math.max(0, Math.trunc(value[key] as number))
          : null
        return {
          key: entry.key,
          text,
          unlockAfterAttempts,
          authorArchetype,
          authorName: stringField('authorName'),
          authorAvatarUrl: stringField('authorAvatarUrl'),
          authorIsVerified: value?.authorIsVerified === true,
          authorIsPlus: value?.authorIsPlus === true,
          publishedAt: stringField('publishedAt'),
          likesCount: countField('likesCount'),
          dislikesCount: countField('dislikesCount'),
          replyCount: countField('replyCount'),
        }
      })
      .filter((entry): entry is DtfCommentCardData => Boolean(entry))
    : []
  const promoHeading = isPromptSession ? session.promoPrompt?.title?.trim() || 'Игра по комментариям' : null
  const promoSubtitle = isPromptSession ? session.promoPrompt?.subtitle?.trim() || '' : ''
  const promoDisclaimer = isPromptSession ? session.promoPrompt?.disclaimer?.trim() || '' : ''
  const promptSourceLabel = 'Спецпоказ DTF'

  const attempts = session.attempts.map(serverAttemptToLegacy)
  const answer = session.answer ? publicItemToTitle(session.answer) : null
  const used = new Set(session.attempts.map((entry) => entry.item.id))
  const usedTitles = session.attempts.map((entry) => publicItemToTitle(entry.item))
  const suggestions = (search.data?.items ?? []).filter((item) => !used.has(item.id))
  const searchPending = Boolean(query.trim()) && (query.trim() !== debouncedQuery.trim() || search.isFetching)
  const alreadyUsedQuery = matchesUsedSearchQuery(debouncedQuery, usedTitles)
  const isSuggestionsOpen = Boolean(query.trim() && !selected)
  const submit = (item: PublicContentItem) => {
    if (attempt.isPending || session.status !== 'playing') return
    const key = attemptKeyRef.current ?? crypto.randomUUID()
    attemptKeyRef.current = key
    attempt.mutate({ itemId: item.id, key })
  }
  const selectSuggestion = (item: PublicContentItem) => {
    setSelected(item)
    setQuery(item.titleRu)
    setMessage('')
  }
  const revealHint = (hintKey: AssistHintKey) => {
    if (!hintModalRound || hint.isPending || revealedHint) return
    const key = hintKeyRef.current ?? crypto.randomUUID()
    hintKeyRef.current = key
    hint.mutate({ checkpoint: hintModalRound, hintKey, key })
  }
  const selectFinalCandidate = (itemId: string, position: number) => {
    if (finalChoiceMutation.isPending) return
    setSelectedFinalCandidateId(itemId)
    finalChoiceKeyRef.current = null
    setMessage('')
    trackClientEvent('final_choice_candidate_selected', {
      sessionId,
      mode: session.mode,
      kind: session.kind,
      packId: session.packId,
      attemptsCount: session.attemptsCount,
      candidatePosition: position + 1,
    }, { gameSessionId: sessionId })
  }
  const submitFinalCandidate = () => {
    if (!selectedFinalCandidateId || finalChoiceMutation.isPending) return
    const key = finalChoiceKeyRef.current ?? crypto.randomUUID()
    finalChoiceKeyRef.current = key
    finalChoiceMutation.mutate({ body: { action: 'choose', itemId: selectedFinalCandidateId }, key })
  }
  const revealFinalAnswer = () => {
    if (finalChoiceMutation.isPending) return
    const key = finalChoiceKeyRef.current ?? crypto.randomUUID()
    finalChoiceKeyRef.current = key
    finalChoiceMutation.mutate({ body: { action: 'reveal' }, key })
  }
  const pendingHintOption = hintOptions.find((option) => option.key === hint.variables?.hintKey) ?? null
  const completedModeSet = new Set((dashboard.data?.today?.completedModes ?? []).filter(isCatalogGuessModeId))
  if (session.kind === 'daily' && ['won', 'lost', 'expired'].includes(session.status)) completedModeSet.add(session.mode)
  const completedModes = [...completedModeSet]
  const completedToday = completedModeSet.size
  const nextMode = nextResultMode(session.mode, completedModes)
  const recommendedModes = resultRecommendedModes(session.mode, nextMode)
  const routeCompleted = !nextMode
  const isPackSession = session.kind === 'pack'
  const isFreePlaySession = session.kind === 'free_play'
  const isSpecialSession = isPackSession || isKpopSession || isFreePlaySession
  const packTotalItems = packDetail.data?.pack.totalItems ?? (isDtfCommentSession ? DTF_COMMENTS_POOL_COUNT : null)
  const nextPackPosition = isPackSession
    && session.packPosition
    && packTotalItems
    && session.packPosition < packTotalItems
    ? session.packPosition + 1
    : null
  const nextLabel = isKpopSession
    ? 'К ежедневному спецпоказу'
    : isPackSession
    ? nextPackPosition
      ? nextPackSession.isPending
        ? 'Запускаем следующую…'
        : `Следующая игра · ${nextPackPosition} из ${packTotalItems}`
      : 'К подборке'
    : nextMode
      ? `Играть дальше: ${modeMeta(nextMode).title}`
      : 'На главную'
  const configureLabel = isKpopSession
    ? 'На главную'
    : isPackSession
    ? nextPackPosition
      ? 'К подборке'
      : 'На главную'
    : routeCompleted
      ? 'Выбрать другой режим'
      : resultConfigureLabel(session.mode)
  const headingPeriodBadge = isKpopSession
    ? 'K-pop'
    : session.mode === 'music' && session.difficulty
    ? DIFFICULTIES[session.difficulty].label
    : session.mode === 'city'
      ? GAME_MODE_MANIFEST.city.variants.find((entry) => entry.id === session.variantKey)?.label ?? 'Столицы'
    : session.mode === 'movie' || session.mode === 'series' || session.mode === 'anime'
      ? session.period === 'all'
        ? 'Главная премьера'
        : PERIODS[session.period].label.replace(' года', '')
      : null
  const shareText = isDtfCommentSession
    ? dtfShareText(attempts.length, maxAttempts, session.status === 'won')
    : resultTextForSession(session.mode, session.puzzleDate, session.period, attempts.map((entry) => entry.hints), session.status === 'won', maxAttempts, isFreePlaySession, session.completionType ?? undefined)
  const challengeLink = buildChallengeUrl(location.href, {
    mode: session.mode,
    date: session.puzzleDate,
    period: session.period,
    ...(session.difficulty ? { difficulty: session.difficulty } : {}),
    ...(session.variantKey ? { variantKey: session.variantKey } : {}),
    opponentAttempts: session.completionType === 'final_choice_win'
      ? 'f'
      : session.status === 'lost' || session.status === 'expired'
        ? 'x'
        : Math.max(1, attempts.length),
    from: getInstallationId(),
  })
  const telegramUrl = `https://t.me/share/url?url=${encodeURIComponent(challengeLink)}&text=${encodeURIComponent(shareText)}`
  const shareChallenge = async () => {
    const outcome = await shareTextWithFallback('Сходится! — вызов', shareText, challengeLink)
    if (outcome === 'copied') {
      trackMetrikaGoal('share_copy', { mode: session.mode, period: session.period, status: session.status, placement: 'challenge' })
      setCopied(true)
      window.setTimeout(() => setCopied(false), 1800)
    }
    if (outcome !== 'failed' && session.mode === 'diagnosis') trackDiagnosisGoal('share', { period: session.period, status: session.status })
    if (outcome === 'failed') setMessage('Не удалось поделиться результатом')
  }
  const award = lastAward ? {
    total: lastAward.total,
    base: Object.values(lastAward.components).reduce((sum, value) => sum + value, 0),
    completed: lastAward.components.completion,
    win: lastAward.components.win,
    speed: lastAward.components.efficiency,
    finalChoiceWin: lastAward.components.finalChoiceWin,
    firstDaily: lastAward.components.firstGame,
    milestoneBonus: lastAward.components.route3,
    fullHouse: lastAward.components.fullRoute,
    streakMilestone: lastAward.components.streakMilestone,
    newDailyStreak: dashboard.data?.attendance?.currentDailyStreak ?? 0,
    alreadyClaimed: lastAward.alreadyClaimed,
  } : null
  const answerMeta = answer ? resultCardMeta(answer) : ''
  const answerTags = answer ? resultCardTags(answer) : []

  return <>
    <GamePageFrame controller={{ source: 'server', mode: session.mode, puzzleDate: session.puzzleDate, status: session.status, attemptsCount: session.attemptsCount, variantKey: session.variantKey }} navigation={{ onHome, onArchive, onStats, onRules, onReview }} onBack={onBack}>
      <section className={`game-heading${session.mode === 'diagnosis' ? ' game-heading--diagnosis' : ''}${isKpopSession ? ' game-heading--kpop' : ''}`}><div><div className="game-heading__kicker"><span>{session.kind === 'archive' ? 'Архив' : isFreePlaySession ? 'Свободная игра' : session.kind === 'pack' ? 'Спецпоказ' : 'Сегодня'} · {isKpopSession && session.kind === 'pack' ? `Карточка ${session.packPosition ?? 1}` : `Сеанс №${dayNumber(session.puzzleDate)}`}{headingPeriodBadge ? ` · ${headingPeriodBadge}` : ''}</span></div><h1>{isKpopSession ? 'K-pop артист дня' : isPromptSession ? promoHeading : isFreePlaySession ? `Угадай ${modeMeta(session.mode).subjectGenitive}` : `${modeMeta(session.mode).daily} дня`}</h1><p>{isKpopSession ? `${prettyDate(session.puzzleDate)} · новый артист в 00:00 МСК` : isFreePlaySession ? 'Случайная загадка · можно играть снова сразу' : `${prettyDate(session.puzzleDate)} · ${isPromptSession ? promptSourceLabel : 'обновление в 00:00 МСК'}`}</p></div><div className="mini-ticket" aria-hidden="true"><Ticket /><span>{isKpopSession ? 'K' : isFreePlaySession ? '∞' : session.puzzleDate.slice(8, 10)}<small>{isKpopSession ? 'POP' : isFreePlaySession ? 'FREE' : `/${session.puzzleDate.slice(5, 7)}`}</small></span></div></section>
      {isPromptSession && (isDtfCommentSession
        ? <DtfCommentIntro subtitle={promoSubtitle} />
        : <section className="assist-revealed"><article className="assist-reveal-card"><span><Sparkles /> {promoHeading}</span>{promoSubtitle && <p>{promoSubtitle}</p>}{promoDisclaimer && <p>{promoDisclaimer}</p>}</article></section>)}
      {!!promoHints.length && (isDtfCommentSession
        ? <DtfCommentFeed comments={promoHints} attemptsCount={session.attemptsCount} />
        : <section className="assist-revealed">{promoHints.map((hint) => <article key={hint.key} className="assist-reveal-card"><span><Sparkles /> {hint.unlockAfterAttempts && hint.unlockAfterAttempts > 0 ? `Подсказка после ${hint.unlockAfterAttempts} попыток` : 'Стартовая реплика'}{hint.authorArchetype ? ` · ${hint.authorArchetype}` : ''}</span><p>{hint.text}</p></article>)}</section>)}
      {session.diagnosisVignette && <section className="assist-revealed"><article className="assist-reveal-card"><span><ClipboardList /> Анамнез</span><p>{session.diagnosisVignette.text}</p></article></section>}
      {(session.status === 'playing' || session.status === 'final_choice') && <div className="progress-row"><SegmentedProgress value={session.status === 'final_choice' ? maxAttempts : session.attemptsCount} max={maxAttempts} />{canUseHint && availableHintRound && <ActionButton variant="hint" className="hint-trigger" onClick={() => { setRevealedHint(null); setHintModalRound(availableHintRound) }}><Sparkles /> Подсказка</ActionButton>}</div>}
      {!!session.hintChoices.length && <section className="assist-revealed">{session.hintChoices.map((choice) => <article key={choice.checkpoint} className="assist-reveal-card"><span><Sparkles /> {assistHintTitle(choice.hintKey, session.mode)} · после {choice.checkpoint} попыток</span><AssistHintValue value={choice.response.value} /></article>)}</section>}
      {session.status === 'final_choice' && session.finalChoice && <FinalChoicePanel
        mode={session.mode}
        snapshot={session.finalChoice}
        selectedItemId={selectedFinalCandidateId}
        secondsRemaining={finalChoiceSeconds}
        pending={finalChoiceMutation.isPending}
        error={message}
        onSelect={selectFinalCandidate}
        onSubmit={submitFinalCandidate}
        onReveal={revealFinalAnswer}
        onRevealDialogOpen={() => trackClientEvent('final_choice_reveal_opened', { sessionId, mode: session.mode, kind: session.kind, packId: session.packId, attemptsCount: session.attemptsCount }, { gameSessionId: sessionId })}
        onRevealDialogCancel={() => trackClientEvent('final_choice_reveal_cancelled', { sessionId, mode: session.mode, kind: session.kind, packId: session.packId, attemptsCount: session.attemptsCount }, { gameSessionId: sessionId })}
      />}
      {session.status === 'final_choice' && <GameMatchStrip attempts={attempts} mode={session.mode} open={gameMatchStripOpen} onToggle={() => setGameMatchStripOpen((current) => !current)} />}
      {['won', 'lost', 'expired'].includes(session.status) && answer && <GameResult mode={session.mode} won={session.status === 'won'} completionType={session.completionType} attempts={attempts.length} maxAttempts={maxAttempts} poster={<Poster item={answer} />} title={answer.titleRu} meta={answerMeta} tags={answerTags} completedToday={isSpecialSession ? undefined : completedToday} nextRewardText={isSpecialSession ? undefined : completedToday >= FULL_HOUSE_MODE_IDS.length ? 'Маршрут дня завершён' : `До полного маршрута: ещё ${Math.max(0, FULL_HOUSE_MODE_IDS.length - completedToday)}`} packProgress={isDtfCommentSession && packDetail.data?.pack ? {
        played: packDetail.data.pack.completedItems,
        won: packDetail.data.pack.wonItems ?? 0,
        lost: packDetail.data.pack.lostItems ?? 0,
        total: packDetail.data.pack.totalItems,
        roundScore: 100 + (session.status === 'won' ? 50 + Math.max(0, maxAttempts - attempts.length) * 10 : 0),
      } : undefined} nextLabel={nextLabel} nextActionLabel={isKpopSession || (isPackSession && !nextPackPosition) || (!isPackSession && routeCompleted) ? 'Перейти' : 'Играть'} nextMode={!isSpecialSession ? nextMode ?? undefined : undefined} recommendedModes={!isSpecialSession ? recommendedModes : undefined} configureLabel={configureLabel} award={award} streak={dashboard.data?.attendance?.currentDailyStreak ?? 0} copied={copied} telegramUrl={telegramUrl} onNext={isKpopSession
        ? onBack
        : isPackSession
        ? () => {
            if (!session.packId || !nextPackPosition || nextPackSession.isPending) {
              onBack()
              return
            }
            nextPackSession.mutate({ packId: session.packId, position: nextPackPosition })
          }
        : () => {
            if (nextMode) trackNextGameClick(session.mode, nextMode, { outcome: session.status })
            if (routeCompleted) onHome()
            else onPlayNext(nextMode)
          }} onRecommendedMode={(recommendedMode) => {
            trackNextGameClick(session.mode, recommendedMode, { outcome: session.status, placement: 'diagnosis-result-recommendations' })
            onPlayNext(recommendedMode)
          }} onConfigure={isKpopSession ? onHome : isPackSession ? nextPackPosition ? onBack : onHome : onConfigureMode} onChallenge={() => void shareChallenge()} onReplay={canReplayCatalogSession(session) ? onReplay : undefined} replayCost={replayCost} replayShortage={replayShortage} replayPending={replayPending} replayAccessSource={replayAccessSource} onReport={async (reason: ContentReportReason, comment: string) => { await api.contentReport({ sessionId, reason, comment: comment || undefined }) }} />}
      {session.status === 'lost' && session.mode === 'character' && answer && <section className="answer-reveal" aria-label="Правильный ответ и все его признаки">
        <div className="section-title"><span>Правильный ответ</span><strong>10/10</strong></div>
        <CharacterAttemptCard
          attempt={{ titleId: answer.id, hints: compareTitles(answer, answer) }}
          item={answer}
          index={attempts.length}
          isCorrectAttempt
          isAnswerReveal
        />
      </section>}
      {['won', 'lost', 'expired'].includes(session.status) && isDtfCommentSession && !nextPackPosition && packLeaderboard.data && !packLeaderboard.isError && <div className="dtf-result-leaderboard-action">
        <ActionButton variant="secondary" onClick={() => setLeaderboardOpen(true)}><Trophy /> Открыть таблицу лидеров</ActionButton>
      </div>}
      {['won', 'lost', 'expired'].includes(session.status) && message && <InlineAlert tone="danger" className="specials-error">{message}</InlineAlert>}
      {session.status === 'playing' && <section className="search-area search-area--sticky">
        <div className="sticky-composer__status" role="status" aria-live="polite">
          <span>{attempt.isPending ? 'Проверяем ответ…' : `Попытка ${Math.min(session.attemptsCount + 1, maxAttempts)} из ${maxAttempts}`}</span>
        </div>
        <SearchCombobox
          inputProps={{
            id: 'movie-search',
            value: query,
            autoComplete: 'off',
            placeholder: modeMeta(session.mode).searchPlaceholder,
            onChange: (event) => { setQuery(event.target.value); setSelected(null); setActiveSuggestionIndex(0); attemptKeyRef.current = null; setMessage('') },
            onKeyDown: (event) => {
              if (event.key === 'ArrowDown') {
                if (!suggestions.length || selected) return
                event.preventDefault()
                setActiveSuggestionIndex((current) => Math.min(current + 1, suggestions.length - 1))
                return
              }
              if (event.key === 'ArrowUp') {
                if (!suggestions.length || selected) return
                event.preventDefault()
                setActiveSuggestionIndex((current) => Math.max(0, current - 1))
                return
              }
              if (event.key === 'Enter') {
                event.preventDefault()
                if (selected) submit(selected)
                else if (suggestions.length) selectSuggestion(suggestions[activeSuggestionIndex] ?? suggestions[0])
              }
            },
            disabled: attempt.isPending,
          }}
          selected={Boolean(selected)}
          open={isSuggestionsOpen}
          loading={searchPending}
          submitting={attempt.isPending}
          loadingLabel="Ищем в текущем пуле…"
          suggestions={suggestions}
          activeIndex={activeSuggestionIndex}
          emptyMessage={alreadyUsedQuery ? 'Вы уже использовали этот вариант в текущей партии.' : searchEmptyMessage(session.mode, isDtfCommentSession)}
          submitDisabled={attempt.isPending || !selected}
          onSubmit={() => {
            if (selected) submit(selected)
          }}
          onSuggestionHover={(_, index) => setActiveSuggestionIndex(index)}
          onSuggestionSelect={(item) => commitSuggestionAttempt(item, selectSuggestion, submit)}
          getSuggestionKey={(item) => item.id}
          renderSuggestion={(item) => {
            const title = publicItemToTitle(item)
            return <><Poster item={title} /><span><strong>{item.titleRu}</strong><small>{searchResultMeta(title)}</small></span></>
          }}
        />
        <GameMatchStrip attempts={attempts} mode={session.mode} open={gameMatchStripOpen} onToggle={() => {
          trackMetrikaGoal('toggle_match_strip', { mode: session.mode, period: session.period })
          setGameMatchStripOpen((current) => !current)
        }} />
        {message && <div className="search-meta"><strong>{message}</strong></div>}
      </section>}
      {!attempts.length && session.status === 'playing' && <section className={`empty-card${isKpopSession ? ' empty-card--kpop' : ''}`}><div className="empty-card__icon">{modeIcon(session.mode)}</div><div><h2>{isKpopSession ? 'Назовите первого K-pop артиста' : 'Начните с первой попытки'}</h2><p>{isKpopSession ? 'После ответа появится отдельная карточка с годом дебюта, поколением, типом, полом, лейблом, составом и статусом активности.' : 'После ответа сервер покажет сравнение признаков, не раскрывая правильный ответ до завершения сеанса.'}</p></div></section>}
      {!!session.attempts.length && <section className="attempt-list"><div className="section-title"><span>Ваши попытки</span><strong>{session.attempts.length}/{maxAttempts}</strong></div>{[...session.attempts].reverse().map((entry) => {
        const item = publicItemToTitle(entry.item)
        const attemptValue = serverAttemptToLegacy(entry)
        const correct = answer?.id === item.id
        return <ModeAttemptCard key={entry.position} attempt={attemptValue} item={item} index={entry.position - 1} isCorrectAttempt={correct} />
      })}</section>}
    </GamePageFrame>
    {leaderboardOpen && <Modal className="dtf-leaderboard-modal" title="Общий зачёт" onClose={() => setLeaderboardOpen(false)}>
      <DtfLeaderboard
        data={packLeaderboard.data}
        loading={packLeaderboard.isLoading}
        error={packLeaderboard.isError}
      />
    </Modal>}
    {hintModalRound && (hintOptions.length > 0 || revealedHint) && <DialogSurface backdropClassName="hint-modal-backdrop" className="hint-modal" onClose={dismissHintModal} ariaLabel="Подсказка">
        <div className="hint-modal__head">
          <span><Sparkles /> Возможность · попытка {hintModalRound}</span>
          <ControlButton onClick={dismissHintModal} aria-label="Закрыть" disabled={hint.isPending}><X /></ControlButton>
        </div>
        {hint.isPending ? <div className="hint-modal__state" role="status" aria-live="polite">
          <Sparkles className="hint-modal__spinner" />
          <h2>Открываем подсказку</h2>
          <p>{pendingHintOption?.title ?? CATALOG_HINT_COPY[session.mode].loadingText}…</p>
        </div> : revealedHint ? <>
          <h2>Подсказка открыта</h2>
          <article className="hint-modal__reveal">
            <span><Sparkles /> {assistHintTitle(revealedHint.hintKey, session.mode)} · после {revealedHint.checkpoint} попыток</span>
            <AssistHintValue value={revealedHint.value} />
          </article>
          <ActionButton className="hint-modal__confirm" onClick={dismissHintModal}>Понятно</ActionButton>
        </> : <>
          <h2>{CATALOG_HINT_COPY[session.mode].modalTitle}</h2>
          <div className="hint-modal__options">{hintOptions.map((option, index) => <ControlButton key={`${option.key}-${index}`} onClick={() => revealHint(option.key)}><i>0{index + 1}</i><span><strong>{option.title}</strong><small>{option.subtitle}</small></span><ChevronRight /></ControlButton>)}</div>
          <ControlButton className="hint-modal__later" onClick={dismissHintModal}>Не сейчас</ControlButton>
        </>}
    </DialogSurface>}
  </>
}

function GameApp() {
  const queryClient = useQueryClient()
  const navigate = useNavigate()
  const routeLocation = useRouterState({ select: (state) => state.location })
  const initialPlayerRoute = playerRouteFromLocation(
    routeLocation.pathname,
    typeof window === 'undefined' ? '' : window.location.search,
  )
  const serverRuntime = useServerRuntime()
  const hasActiveClub = Boolean(SERVER_RUNTIME && serverRuntime.dashboard?.membership.active)
  const canAccessFriendsRoom = canUseFriendsRoom(serverRuntime.me?.user)
  const canCreateFriendsRoomAccess = hasActiveClub && canCreateFriendsRoom(serverRuntime.me?.user)
  const serverArchive = useQuery({
    queryKey: queryKeys.archive({ app: true }),
    queryFn: () => api.archive(),
    enabled: SERVER_RUNTIME && Boolean(serverRuntime.me),
  })
  const serverPacks = useQuery({
    queryKey: queryKeys.packs,
    queryFn: api.packs,
    enabled: SERVER_RUNTIME,
  })
  const dtfPack = serverPacks.data?.items.find((pack) => pack.id === DTF_COMMENTS_PACK_ID) ?? null
  const kpopPack = serverPacks.data?.items.find((pack) => pack.id === KPOP_ARTISTS_PACK_ID) ?? null
  const canAccessDtfSpecial = Boolean(dtfPack && dtfPack.access !== 'locked')
  const canAccessKpopSpecial = Boolean(kpopPack && kpopPack.access !== 'locked')
  const [challenge, setChallenge] = useState<ChallengePayload | null>(() => typeof window === 'undefined' ? null : parseChallengeUrl(window.location.href))
  const [challengeAccepted, setChallengeAccepted] = useState(false)
  const [screen, setScreen] = useState<AppScreen>(() => resetPasswordTokenFromLocation()
    ? 'profile'
    : typeof window !== 'undefined' && new URLSearchParams(window.location.search).has('tab')
      ? 'profile'
      : initialPlayerRoute.screen)
  useEffect(() => {
    if (screen === 'game') void import('./features/game-session/GameSession.css')
    if (screen === 'review') void import('./features/review/ReviewScreen.css')
    if (typeof window !== 'undefined' && new URLSearchParams(window.location.search).get('preview') === 'codapress') {
      void import('./features/home/CodapressHomePreview.css')
    }
  }, [screen])
  const [transition, setTransition] = useState<'idle' | 'title-to-game'>('idle')
  const [mode, setMode] = useState<TitleMode>(() => (
    challenge?.mode ?? (isCatalogGuessModeId(initialPlayerRoute.mode) ? initialPlayerRoute.mode : 'movie')
  ))
  const [period, setPeriod] = useState<PeriodKey>(() => challenge?.period ?? 'all')
  const [difficulty, setDifficulty] = useState<DifficultyKey>(() => challenge?.difficulty ?? 'medium')
  const [modeVariant, setModeVariant] = useState<string | null>(() => GAME_MODE_MANIFEST.city.variants[0].id)
  const [date, setDate] = useState(() => challenge?.date ?? getMoscowDate())
  const [adminDailySalt, setAdminDailySalt] = useState(0)
  const [freePlayLaunch, setFreePlayLaunch] = useState<number | null>(null)
  const [freePlayArmed, setFreePlayArmed] = useState(false)
  const [serverSessionId, setServerSessionId] = useState<string | null>(() => initialPlayerRoute.sessionId ?? null)
  const [diagnosisPreviewSession, setDiagnosisPreviewSession] = useState<GameSessionSnapshot | null>(null)
  const [serverActionError, setServerActionError] = useState('')
  const [gameExperience, setGameExperience] = useState(() => catalogGameExperience('title'))
  const [reviewBackTarget, setReviewBackTarget] = useState<'hub' | 'title' | 'rewatch'>('hub')
  const { data, titleCounts: localTitleCounts, caseVignettes, loading, loadError, retryLoading, globalDailySalt, searchIndex } = useDataLoader(mode, !SERVER_RUNTIME)
  const [modal, setModal] = useState<'stats' | 'rules' | 'resume' | 'anamnesis' | null>(null)
  const [economyVersion, setEconomyVersion] = useState(0)
  const transitionTimerRef = useRef<number | null>(null)
  const applyingRouteRef = useRef(false)
  const lastRoutePathRef = useRef(routeLocation.pathname)
  const lastTrackedScreenRef = useRef<AppScreen | null>(null)
  const lastTrackedSeoLandingRef = useRef<string | null>(null)
  const adminDailySaltRef = useRef(0)
  const globalDailySaltRef = useRef(0)
  const effectiveDailySalt = globalDailySalt + adminDailySalt
  const wallet = useMemo<Wallet>(() => SERVER_RUNTIME ? toLegacyWallet(serverRuntime.dashboard) : loadWallet(), [economyVersion, serverRuntime.dashboard])
  const todayAttendance = useMemo<DailyAttendance>(() => SERVER_RUNTIME
    ? toLegacyDailyAttendance(serverRuntime.dashboard?.today, serverRuntime.meta?.moscowDate ?? getMoscowDate())
    : loadDailyAttendance(getMoscowDate()), [economyVersion, serverRuntime.dashboard, serverRuntime.meta])
  const titleCounts = useMemo(() => (
    SERVER_RUNTIME ? serverTitleCounts(serverRuntime.meta) : localTitleCounts
  ), [localTitleCounts, serverRuntime.meta])
  const freePlayLaunchesToday = useMemo(() => SERVER_RUNTIME
    ? serverRuntime.dashboard?.freePlayLaunchesToday ?? 0
    : loadFreePlayUsage(getMoscowDate()), [economyVersion, serverRuntime.dashboard])
  const clubFreePlay = hasActiveClub
  const freePlayCostValue = useMemo(() => clubFreePlay
    ? 0
    : SERVER_RUNTIME
      ? serverRuntime.dashboard?.freePlayNextCost ?? ECONOMY_RULE_SET.freePlay.ladder[0] ?? ECONOMY_RULE_SET.freePlay.max
      : freePlayCost(freePlayLaunchesToday), [clubFreePlay, freePlayLaunchesToday, serverRuntime.dashboard])
  const freePlayShortage = Math.max(0, freePlayCostValue - wallet.tickets)
  const periodUnlockCostValue = SERVER_RUNTIME
    ? serverRuntime.dashboard?.economyRules.periodUnlock ?? ECONOMY_RULE_SET.periodUnlock
    : ECONOMY_RULE_SET.periodUnlock
  const periodUnlocks = useMemo(() => loadPeriodUnlocks(), [economyVersion])
  const currentUnlockedPeriods = useMemo<PeriodKey[]>(() => {
    if (!SERVER_RUNTIME) return unlockedPeriodsFor(mode, periodUnlocks)
    if (hasActiveClub) return [...PERIOD_UNLOCK_ORDER]
    const unlocked = new Set<PeriodKey>(['all'])
    for (const entitlement of serverRuntime.dashboard?.entitlements ?? []) {
      if (entitlement.mode === mode) unlocked.add(entitlement.period)
    }
    return PERIOD_UNLOCK_ORDER.filter((entry) => unlocked.has(entry))
  }, [hasActiveClub, mode, periodUnlocks, serverRuntime.dashboard])
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

  // Reset after React has committed the shorter destination screen. Calling
  // scrollTo only inside click handlers can leave the previous page's offset
  // clamped to the new document height during an SPA route transition.
  useLayoutEffect(() => {
    window.scrollTo({ top: 0, left: 0 })
  }, [routeLocation.pathname, screen])

  const activateServerSession = useCallback((session: GameSessionSnapshot, backTarget: CatalogGameBackTarget) => {
    setServerActionError('')
    setServerSessionId(session.id)
    window.sessionStorage.setItem('shoditsa:active-server-session', session.id)
    setGameExperience(gameExperienceForSession(session, backTarget))
    if (session.engine === 'catalog_guess') {
      setMode(session.mode)
      setModeVariant(session.mode === 'city' ? session.variantKey ?? GAME_MODE_MANIFEST.city.variants[0].id : null)
      setPeriod(session.period)
      if (session.mode === 'music' && session.difficulty) setDifficulty(session.difficulty)
    }
    setDate(session.puzzleDate)
    setFreePlayLaunch(session.kind === 'free_play' ? 1 : null)
    setFreePlayArmed(false)
    setTransition('idle')
    setModal(null)
    setScreen('game')
    window.scrollTo({ top: 0 })
  }, [])
  const syncServerSessionContext = useCallback((session: GameSessionSnapshot) => {
    if (session.engine !== 'catalog_guess') {
      setDate(session.puzzleDate)
      return
    }
    setMode(session.mode)
    setGameExperience((current) => gameExperienceForSession(
      session,
      current.source === 'catalog' ? current.backTarget : 'title',
    ))
    setModeVariant(session.mode === 'city' ? session.variantKey ?? GAME_MODE_MANIFEST.city.variants[0].id : null)
    setPeriod(session.period)
    if (session.mode === 'music' && session.difficulty) setDifficulty(session.difficulty)
    setDate(session.puzzleDate)
  }, [])

  const startServerSession = useMutation({
    mutationFn: async ({ body, key }: { body: GameStartBody; key: string; backTarget: 'title' | 'rewatch' | 'hub'; previewAnamnesis?: boolean }) => {
      await ensureServerSession()
      return api.start(body, key)
    },
    onSuccess: async (response, variables) => {
      if (variables.previewAnamnesis) {
        setDiagnosisPreviewSession(response.session)
        setModal('anamnesis')
        await queryClient.invalidateQueries({ queryKey: queryKeys.dashboard })
        return
      }
      activateServerSession(response.session, variables.backTarget)
      if (response.session.status === 'playing' || response.session.status === 'final_choice') {
        trackConfirmedServerStart(response.session.id, {
          mode: response.session.mode,
          period: response.session.period,
          kind: response.session.kind,
          state: response.session.attemptsCount > 0 ? 'resumed' : 'new',
        })
      }
      if (variables.body.mode === 'danetki') {
        const isExtra = variables.body.kind === 'free_play'
        const roomMode = variables.body.roomMode ?? 'solo'
        const cost = isExtra
          ? roomMode === 'group'
            ? serverRuntime.dashboard?.danetkiAccess.nextGroupCost ?? 0
            : serverRuntime.dashboard?.danetkiAccess.nextSoloCost ?? 0
          : 0
        const roomStartAnalytics = {
          balanceBefore: wallet.tickets,
          balanceAfter: wallet.tickets - cost,
          amount: cost,
          required: cost,
          shortage: 0,
          source: isExtra && cost === 0 ? 'club' : variables.body.kind,
          sink: isExtra && cost > 0 ? 'danetki-room' : null,
          mode: 'danetki',
          sessionKind: variables.body.kind,
          roomMode,
          dailyCompletedCount: todayAttendance.completedModes.length,
          streak: serverRuntime.dashboard?.attendance?.currentDailyStreak ?? 0,
          rulesVersion: response.session.rulesVersion,
          hasClub: clubFreePlay,
        }
        trackClientEvent('danetki_room_started', roomStartAnalytics, {
          eventId: deterministicClientEventId(response.session.id, 'danetki_room_started'),
          gameSessionId: response.session.id,
        })
        trackMetrikaGoal('danetki_room_started', roomStartAnalytics)
        if (cost > 0) trackClientEvent('ticket_spent', {
          balanceBefore: wallet.tickets,
          balanceAfter: wallet.tickets - cost,
          amount: cost,
          required: cost,
          shortage: 0,
          source: 'wallet',
          sink: 'danetki-room',
          mode: 'danetki',
          sessionKind: 'free_play',
          dailyCompletedCount: todayAttendance.completedModes.length,
          streak: serverRuntime.dashboard?.attendance?.currentDailyStreak ?? 0,
          rulesVersion: response.session.rulesVersion,
          hasClub: clubFreePlay,
        }, {
          eventId: deterministicClientEventId(response.session.id, 'ticket_spent'),
          gameSessionId: response.session.id,
        })
      }
      await queryClient.invalidateQueries({ queryKey: queryKeys.dashboard })
    },
    onError: (error, variables) => {
      setServerActionError(apiErrorMessage(error))
      if (error instanceof ApiClientError && error.code === 'INSUFFICIENT_TICKETS') trackClientEvent('insufficient_tickets_view', {
        ...error.details,
        mode: variables.body.mode,
        sessionKind: variables.body.kind,
        hasClub: clubFreePlay,
      })
    },
  })
  const startServerFreePlay = useMutation({
    mutationFn: async ({ key }: { key: string; backTarget: 'title' | 'rewatch' | 'hub' }) => {
      await ensureServerSession()
      return api.freePlay(mode, mode === 'music' ? apiDifficulty(difficulty) : null, key)
    },
    onSuccess: async (session, variables) => {
      activateServerSession(session, variables.backTarget)
      trackConfirmedServerStart(session.id, {
        mode: session.mode,
        period: session.period,
        kind: session.kind,
        state: session.attemptsCount > 0 ? 'resumed' : 'new',
      })
      trackClientEvent('free_play_started', {
        balanceBefore: session.balanceAfter + session.cost,
        balanceAfter: session.balanceAfter,
        amount: session.cost,
        required: session.cost,
        shortage: 0,
        source: session.accessSource,
        sink: session.cost > 0 ? 'free-play' : null,
        mode: session.mode,
        sessionKind: session.kind,
        dailyCompletedCount: todayAttendance.completedModes.length,
        streak: serverRuntime.dashboard?.attendance?.currentDailyStreak ?? 0,
        rulesVersion: session.rulesVersion,
        hasClub: session.accessSource === 'club',
      }, {
        eventId: deterministicClientEventId(session.id, 'free_play_started'),
        gameSessionId: session.id,
      })
      if (session.cost > 0) trackClientEvent('ticket_spent', {
        balanceBefore: session.balanceAfter + session.cost,
        balanceAfter: session.balanceAfter,
        amount: session.cost,
        required: session.cost,
        shortage: 0,
        source: 'wallet',
        sink: 'free-play',
        mode: session.mode,
        sessionKind: session.kind,
        dailyCompletedCount: todayAttendance.completedModes.length,
        streak: serverRuntime.dashboard?.attendance?.currentDailyStreak ?? 0,
        rulesVersion: session.rulesVersion,
        hasClub: false,
      }, {
        eventId: deterministicClientEventId(session.id, 'ticket_spent'),
        gameSessionId: session.id,
      })
      if (session.accessSource === 'club') {
        trackClientEvent('club_free_play_started', { mode: session.mode, hasClub: true }, {
          eventId: deterministicClientEventId(session.id, 'club_free_play_started'),
          gameSessionId: session.id,
        })
        trackMetrikaGoal('club_free_play_started', { mode: session.mode })
      }
      await Promise.all([
        queryClient.invalidateQueries({ queryKey: queryKeys.dashboard }),
        queryClient.invalidateQueries({ queryKey: queryKeys.ledger }),
        queryClient.invalidateQueries({ queryKey: queryKeys.commerce }),
      ])
    },
    onError: (error) => {
      setServerActionError(apiErrorMessage(error))
      if (error instanceof ApiClientError && error.code === 'INSUFFICIENT_TICKETS') trackClientEvent('insufficient_tickets_view', { ...error.details, mode, sessionKind: 'free_play', hasClub: clubFreePlay })
    },
  })
  const unlockServerPeriod = useMutation({
    mutationFn: async ({ periodKey, key }: { periodKey: PeriodKey; key: string }) => {
      await ensureServerSession()
      return api.unlock(mode, periodKey, key)
    },
    onSuccess: async (result, variables) => {
      setServerActionError('')
      const cost = result.accessSource === 'club' ? 0 : serverRuntime.dashboard?.economyRules.periodUnlock ?? ECONOMY_RULE_SET.periodUnlock
      const balanceAfter = result.balanceAfter ?? wallet.tickets
      trackClientEvent('period_unlocked', {
        balanceBefore: balanceAfter + (result.alreadyUnlocked ? 0 : cost),
        balanceAfter,
        amount: result.alreadyUnlocked ? 0 : cost,
        required: cost,
        shortage: 0,
        source: result.accessSource,
        sink: 'period-unlock',
        mode,
        sessionKind: 'period-unlock',
        period: variables.periodKey,
        dailyCompletedCount: todayAttendance.completedModes.length,
        streak: serverRuntime.dashboard?.attendance?.currentDailyStreak ?? 0,
        rulesVersion: serverRuntime.dashboard?.economyRules.version ?? ECONOMY_RULE_SET.version,
        hasClub: clubFreePlay,
      })
      if (!result.alreadyUnlocked && result.accessSource === 'tickets') trackClientEvent('ticket_spent', {
        balanceBefore: balanceAfter + cost,
        balanceAfter,
        amount: cost,
        required: cost,
        shortage: 0,
        source: 'wallet',
        sink: 'period-unlock',
        mode,
        sessionKind: 'period-unlock',
        dailyCompletedCount: todayAttendance.completedModes.length,
        streak: serverRuntime.dashboard?.attendance?.currentDailyStreak ?? 0,
        rulesVersion: serverRuntime.dashboard?.economyRules.version ?? ECONOMY_RULE_SET.version,
        hasClub: clubFreePlay,
      })
      await Promise.all([
        queryClient.invalidateQueries({ queryKey: queryKeys.dashboard }),
        queryClient.invalidateQueries({ queryKey: queryKeys.ledger }),
      ])
    },
    onError: (error) => {
      setServerActionError(apiErrorMessage(error))
      if (error instanceof ApiClientError && error.code === 'INSUFFICIENT_TICKETS') trackClientEvent('insufficient_tickets_view', { ...error.details, mode, sessionKind: 'period-unlock', hasClub: clubFreePlay })
    },
  })

  useEffect(() => {
    window.addEventListener(ECONOMY_CHANGE_EVENT, refreshEconomy)
    return () => window.removeEventListener(ECONOMY_CHANGE_EVENT, refreshEconomy)
  }, [])

  useEffect(() => {
    const openProfile = (event: Event) => {
      const tab = (event as CustomEvent<{ tab?: ProfileTab }>).detail?.tab
      if (tab && PROFILE_TABS.some((entry) => entry.id === tab)) {
        const url = new URL(window.location.href)
        if (tab === 'overview') url.searchParams.delete('tab')
        else url.searchParams.set('tab', tab)
        window.history.replaceState(window.history.state, '', `${url.pathname}${url.search}${url.hash}`)
      }
      moveToScreen('profile')
    }
    window.addEventListener(PROFILE_OPEN_EVENT, openProfile)
    return () => window.removeEventListener(PROFILE_OPEN_EVENT, openProfile)
  }, [])

  useEffect(() => {
    if (GAME_MODE_MANIFEST[mode].periodPolicy === 'all' && period !== 'all') {
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

  useEffect(() => {
    if (challenge) trackMetrikaGoal('challenge_opened', { mode: challenge.mode, date: challenge.date, from: challenge.from })
  }, [])

  const archiveFirstDate = serverRuntime.meta?.commerce.archiveFirstDate ?? getMoscowDate()
  const totalArchiveDays = SERVER_RUNTIME
    ? Math.max(7, Math.min(62, Math.floor((Date.parse(`${getMoscowDate()}T12:00:00Z`) - Date.parse(`${archiveFirstDate}T12:00:00Z`)) / 86_400_000) + 1))
    : 7
  const archiveDates = Array.from({ length: totalArchiveDays }, (_, offset) => {
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
    if (SERVER_RUNTIME) return
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

  const navigateToPlayerRoute = useCallback((target: ReturnType<typeof playerRouteFromPathname>, replace = false) => {
    if (target.screen === 'danetki') return navigate({ to: '/games/$mode', params: { mode: 'danetki' }, replace })
    if (target.screen === 'danetki-catalog') return target.danetkiCollection
      ? navigate({ to: '/danetki/$slug', params: { slug: target.danetkiCollection }, replace })
      : navigate({ to: '/danetki', replace })
    if (target.screen === 'danetki-story' && target.danetkiSlug) return navigate({ to: '/danetki/$slug', params: { slug: target.danetkiSlug }, replace })
    if (target.screen === 'friends-intro') return navigate({ to: '/games/together', replace })
    if (target.screen === 'friends-room') return navigate({ to: '/games/together', replace })
    if (target.screen === 'danetki-join' && target.inviteToken) return navigate({ to: '/danetki/join/$token', params: { token: target.inviteToken }, replace })
    if (target.screen === 'title' && target.mode) return navigate({ to: '/games/$mode', params: { mode: target.mode }, replace })
    if (target.screen === 'game' && target.sessionId) return navigate({ to: '/sessions/$sessionId', params: { sessionId: target.sessionId }, replace })
    if (target.screen === 'game' && target.mode) return navigate({ to: '/play/$mode', params: { mode: target.mode }, replace })
    if (target.screen === 'rewatch') return navigate({ to: '/archive', replace })
    if (target.screen === 'profile') return navigate({ to: '/profile', replace })
    if (target.screen === 'club') return navigate({ to: '/club', replace })
    if (target.screen === 'specials') return navigate({ to: '/specials', replace })
    if (target.screen === 'special' && target.packId) return navigate({ to: '/specials/$packId', params: { packId: target.packId }, replace })
    if (target.screen === 'create-game') return navigate({ to: '/partners', replace })
    if (target.screen === 'purchase-return') return navigate({ to: '/purchase/return', replace })
    if (target.screen === 'review') return navigate({ to: '/review/music', replace })
    if (target.screen === 'legal' && target.legalDocument) return navigate({ to: '/legal/$document', params: { document: target.legalDocument }, replace })
    return navigate({ to: '/', replace })
  }, [navigate])

  useEffect(() => {
    if (lastRoutePathRef.current === routeLocation.pathname) return
    lastRoutePathRef.current = routeLocation.pathname
    const target = playerRouteFromPathname(routeLocation.pathname)
    applyingRouteRef.current = true
    clearTransitionTimer()
    setTransition('idle')
    setModal(null)
    setScreen(target.screen)
    if (isCatalogGuessModeId(target.mode)) {
      setModeSafe(target.mode)
      if (target.screen === 'title') setGameExperience(catalogGameExperience('title'))
    }
    if (target.sessionId) setServerSessionId(target.sessionId)
    window.scrollTo({ top: 0 })
  }, [routeLocation.pathname])

  useEffect(() => {
    const routedScreen: PlayerScreen = screen
    const currentRouteMode = playerRouteFromPathname(routeLocation.pathname).mode
    const target: PlayerRouteState = {
      screen: routedScreen,
      mode: routedScreen === 'title'
        ? currentRouteMode === 'connections' ? 'connections' : isPlayableModeId(mode) ? mode : undefined
        : routedScreen === 'game' && !serverSessionId
          ? isPlayableModeId(mode) ? mode : undefined
          : undefined,
      sessionId: routedScreen === 'game' ? serverSessionId ?? undefined : undefined,
      packId: routedScreen === 'special' ? playerRouteFromPathname(routeLocation.pathname).packId : undefined,
      legalDocument: routedScreen === 'legal' ? playerRouteFromPathname(routeLocation.pathname).legalDocument : undefined,
      inviteToken: routedScreen === 'danetki-join' ? playerRouteFromPathname(routeLocation.pathname).inviteToken : undefined,
      danetkiSlug: routedScreen === 'danetki-story' ? playerRouteFromPathname(routeLocation.pathname).danetkiSlug : undefined,
      danetkiCollection: routedScreen === 'danetki-catalog' ? playerRouteFromPathname(routeLocation.pathname).danetkiCollection : undefined,
    }
    const desiredPath = pathnameForPlayerRoute(target)
    if (applyingRouteRef.current) {
      applyingRouteRef.current = false
      return
    }
    if (routeLocation.pathname === desiredPath) return
    lastRoutePathRef.current = desiredPath
    void navigateToPlayerRoute(target)
  }, [mode, navigateToPlayerRoute, routeLocation.pathname, screen, serverSessionId])

  useEffect(() => {
    if (screen !== 'friends-room' || canAccessFriendsRoom || serverRuntime.loading) return
    window.location.replace(friendsRoomRegistrationHref(currentFriendsRoomReturnUrl()))
  }, [canAccessFriendsRoom, screen, serverRuntime.loading])

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
    const landingMode = routeLocation.pathname === '/games/game'
      ? 'game'
      : routeLocation.pathname === '/games/music'
        ? 'music'
        : routeLocation.pathname === '/games/danetki'
          ? 'danetki'
          : null
    if (!landingMode || lastTrackedSeoLandingRef.current === routeLocation.pathname) return
    lastTrackedSeoLandingRef.current = routeLocation.pathname
    trackMetrikaGoal('seo_game_landing_view', {
      mode: landingMode,
      route: routeLocation.pathname,
      referrer: document.referrer ? new URL(document.referrer).hostname : 'direct',
    })
  }, [routeLocation.pathname])

  useEffect(() => {
    if (!SERVER_RUNTIME || screen === 'game' || !serverSessionId) return
    window.sessionStorage.removeItem('shoditsa:active-server-session')
    setServerSessionId(null)
  }, [screen, serverSessionId])

  const setModeSafe = (nextMode: TitleMode) => {
    setMode(nextMode)
    setModeVariant(nextMode === 'city' ? (current => current ?? GAME_MODE_MANIFEST.city.variants[0].id) : null)
    if (GAME_MODE_MANIFEST[nextMode].periodPolicy === 'all') {
      setPeriod('all')
    }
  }
  const beginTitleTransition = () => {
    clearTransitionTimer()
    setTransition('title-to-game')
    transitionTimerRef.current = window.setTimeout(() => {
      transitionTimerRef.current = null
      setScreen('game')
      setTransition('idle')
      window.scrollTo({ top: 0 })
    }, 160)
  }

  const moveToScreen = (target: 'hub' | 'title' | 'rewatch' | 'profile' | 'club' | 'specials') => {
    clearTransitionTimer()
    setTransition('idle')
    setFreePlayArmed(false)
    if (target !== 'profile' && typeof window !== 'undefined') {
      const url = new URL(window.location.href)
      if (url.searchParams.has('tab')) {
        url.searchParams.delete('tab')
        window.history.replaceState(window.history.state, '', `${url.pathname}${url.search}${url.hash}`)
      }
    }
    if (target === 'hub') {
      setDate(getMoscowDate())
    }
    setScreen(target)
    setModal(null)
    window.scrollTo({ top: 0 })
  }

  const games = useMemo<SavedGame[]>(() => {
    if (!SERVER_RUNTIME) return allGames()
    return [
      ...catalogActiveSessions(serverRuntime.dashboard?.activeSessions ?? []).map(activeSessionToSavedGame),
      ...(serverArchive.data?.items ?? []).filter(isCatalogArchiveItem).map(archiveItemToSavedGame),
    ]
  }, [serverArchive.data, serverRuntime.dashboard])
  const activeDanetkiSessionId = (serverRuntime.dashboard?.activeSessions ?? []).find((session) => String(session.mode) === 'danetki' && session.status === 'playing')?.id ?? null
  const activeConnectionsSession = (serverRuntime.dashboard?.activeSessions ?? []).find((session) => (
    session.mode === 'connections' && session.status === 'playing'
  )) ?? null
  const completedConnectionsSession = (serverArchive.data?.items ?? []).find((session) => (
    session.mode === 'connections'
    && session.puzzleDate === (serverRuntime.meta?.moscowDate ?? getMoscowDate())
    && (session.status === 'won' || session.status === 'lost')
  )) ?? null
  const connectionsStatus = activeConnectionsSession
    ? 'active' as const
    : completedConnectionsSession
      ? 'completed' as const
      : 'new' as const
  const connectionsTitleActive = screen === 'title'
    && playerRouteFromPathname(routeLocation.pathname).mode === 'connections'
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
  const activeGames = useMemo(() => games.filter((game) => game.status === 'playing' || game.status === 'final_choice').sort((a, b) => b.updatedAt - a.updatedAt), [games])
  const completedDifficulties = useMemo(() => {
    const today = getMoscowDate()
    return DIFFICULTY_ORDER.filter((difficultyKey) => games.some((game) => (
      isMainRouteGame(game)
      &&
      game.mode === 'music'
      && game.date === today
      && game.difficulty === difficultyKey
      && (game.status === 'won' || game.status === 'lost' || game.status === 'expired')
    )))
  }, [games])
  const todayResultGame = useMemo(() => {
    const today = getMoscowDate()
    return games
      .filter((game) => (
        isMainRouteGame(game)
        &&
        game.mode === mode
        && game.date === today
        && (game.status === 'won' || game.status === 'lost' || game.status === 'expired')
        && (mode !== 'music' || game.difficulty === difficulty)
        && (mode !== 'city' || (game.variantKey ?? GAME_MODE_MANIFEST.city.variants[0].id) === (modeVariant ?? GAME_MODE_MANIFEST.city.variants[0].id))
        && (GAME_MODE_MANIFEST[mode].periodPolicy !== 'year' || game.period === period)
      ))
      .sort((left, right) => right.updatedAt - left.updatedAt)[0] ?? null
  }, [difficulty, games, mode, modeVariant, period])
  const hasActiveFreePlay = useMemo(() => {
    if (!FREE_PLAY_MODES.has(mode)) return false
    if (SERVER_RUNTIME) {
      return (serverRuntime.dashboard?.activeSessions ?? []).some((session) => (
        session.kind === 'free_play' && (session.status === 'playing' || session.status === 'final_choice') && session.mode === mode
      ))
    }
    return activeGames.some((savedGame) => (
      savedGame.mode === mode && (savedGame.status === 'playing' || savedGame.status === 'final_choice') && freePlayLaunchFromGameKey(savedGame.key) !== null
    ))
  }, [activeGames, mode, serverRuntime.dashboard])
  const diagnosisAnamnesis = useMemo(() => {
    if (SERVER_RUNTIME) return diagnosisPreviewSession?.diagnosisVignette?.text
      ? { text: diagnosisPreviewSession.diagnosisVignette.text }
      : null
    if (mode !== 'diagnosis' || !data.diagnosis.length) return null
    const pool = poolFor(data.diagnosis, 'diagnosis', 'all')
    if (!pool.length) return null
    const answer = dailyTitle(pool, 'diagnosis', 'all', getMoscowDate(), effectiveDailySalt)
    if (!answer) return null
    const vignette = pickDailyVignette(caseVignettes[answer.id] ?? [], answer.id, getMoscowDate())
    return vignette?.text ? { text: vignette.text } : null
  }, [mode, data.diagnosis, caseVignettes, effectiveDailySalt, diagnosisPreviewSession])
  const openDiagnosisAnamnesis = () => {
    if (mode !== 'diagnosis') return
    if (!SERVER_RUNTIME) {
      setModal('anamnesis')
      return
    }
    if (diagnosisPreviewSession?.diagnosisVignette?.text) {
      setModal('anamnesis')
      return
    }
    if (startServerSession.isPending) return
    setServerActionError('')
    startServerSession.mutate({
      key: crypto.randomUUID(),
      body: {
        kind: 'daily',
        mode: 'diagnosis',
        period: 'all',
        difficulty: null,
        archiveDate: null,
      },
      backTarget: 'title',
      previewAnamnesis: true,
    })
  }
  const goHome = () => moveToScreen('hub')
  const goBackFromTitle = () => moveToScreen('hub')
  const goBackFromGame = () => {
    if (
      serverSessionId
      && (activeConnectionsSession?.id === serverSessionId || completedConnectionsSession?.id === serverSessionId)
      && gameExperience.source === 'catalog'
      && gameExperience.backTarget === 'title'
    ) {
      void navigateToPlayerRoute({ screen: 'title', mode: 'connections' })
      return
    }
    if (gameExperience.source === 'pack') {
      void navigateToPlayerRoute({ screen: 'special', packId: gameExperience.packId })
      return
    }
    moveToScreen(gameExperience.backTarget)
  }
  const goBackFromReview = () => moveToScreen(reviewBackTarget)

  useEffect(() => {
    if (modal === 'resume' && !activeGames.length) {
      setModal(null)
    }
  }, [modal, activeGames.length])

  const openSavedSession = (savedGame: SavedGame, backTarget: 'hub' | 'rewatch' | 'title' = 'hub') => {
    trackMetrikaGoal('open_saved_session', { mode: savedGame.mode, status: savedGame.status, backTarget })
    clearTransitionTimer()
    setTransition('idle')
    setFreePlayArmed(false)
    if (SERVER_RUNTIME && savedGame.key.startsWith('server:')) {
      const sessionId = savedGame.key.slice('server:'.length)
      setServerSessionId(sessionId)
      window.sessionStorage.setItem('shoditsa:active-server-session', sessionId)
      setGameExperience(savedGame.variantKey === KPOP_ARTISTS_PACK_ID
        ? { source: 'pack', packId: KPOP_ARTISTS_PACK_ID }
        : catalogGameExperience(backTarget))
      setModeSafe(savedGame.mode)
      setModeVariant(savedGame.mode === 'city' ? savedGame.variantKey ?? GAME_MODE_MANIFEST.city.variants[0].id : null)
      setPeriod(savedGame.period)
      if (savedGame.mode === 'music' && savedGame.difficulty) setDifficulty(savedGame.difficulty)
      setDate(savedGame.date)
      setScreen('game')
      setModal(null)
      window.scrollTo({ top: 0 })
      return
    }
    setGameExperience(catalogGameExperience(backTarget))
    setFreePlayLaunch(freePlayLaunchFromGameKey(savedGame.key))
    setModeSafe(savedGame.mode)
    setModeVariant(savedGame.mode === 'city' ? savedGame.variantKey ?? GAME_MODE_MANIFEST.city.variants[0].id : null)
    setPeriod(GAME_MODE_MANIFEST[savedGame.mode].periodPolicy === 'year' ? savedGame.period : 'all')
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
    if (typeof window !== 'undefined') {
      const url = new URL(window.location.href)
      if (url.searchParams.has('tab')) {
        url.searchParams.delete('tab')
        window.history.replaceState(window.history.state, '', `${url.pathname}${url.search}${url.hash}`)
      }
    }
    setFreePlayLaunch(null)
    setFreePlayArmed(false)
    setGameExperience(catalogGameExperience('title'))
    setModeSafe(nextMode)
    setDate(getMoscowDate())
    setScreen('title')
    setModal(null)
    window.scrollTo({ top: 0 })
  }

  const openDanetki = () => {
    if (!SERVER_RUNTIME || serverRuntime.meta?.features.danetkiEnabled === false) return
    clearTransitionTimer()
    setTransition('idle')
    setServerActionError('')
    setModal(null)
    setScreen('danetki')
    window.scrollTo({ top: 0 })
  }

  const openConnectionsSession = (sessionId: string, puzzleDate: string, backTarget: 'hub' | 'title' | 'rewatch') => {
    clearTransitionTimer()
    setTransition('idle')
    setServerActionError('')
    setServerSessionId(sessionId)
    window.sessionStorage.setItem('shoditsa:active-server-session', sessionId)
    setGameExperience(catalogGameExperience(backTarget))
    setDate(puzzleDate)
    setModal(null)
    setScreen('game')
    window.scrollTo({ top: 0 })
  }

  const openConnections = () => {
    if (!SERVER_RUNTIME || serverRuntime.meta?.features.connectionsEnabled === false) return
    const existing = activeConnectionsSession ?? completedConnectionsSession
    if (existing) {
      openConnectionsSession(existing.id, existing.puzzleDate, 'hub')
      return
    }
    clearTransitionTimer()
    setTransition('idle')
    setServerActionError('')
    setModal(null)
    void navigateToPlayerRoute({ screen: 'title', mode: 'connections' })
  }

  const playConnectionsToday = () => {
    const existing = activeConnectionsSession ?? completedConnectionsSession
    if (existing) {
      openConnectionsSession(existing.id, existing.puzzleDate, 'title')
      return
    }
    if (!SERVER_RUNTIME || startServerSession.isPending) return
    setServerActionError('')
    startServerSession.mutate({
      key: crypto.randomUUID(),
      body: {
        kind: 'daily',
        mode: 'connections',
        period: 'all',
        difficulty: null,
        archiveDate: null,
      },
      backTarget: 'title',
    })
  }

  const openConnectionsArchive = (archiveDate: string, sessionId: string | null) => {
    trackMetrikaGoal('open_archive_day', { mode: 'connections', hasSavedSession: Boolean(sessionId) })
    if (sessionId) {
      openConnectionsSession(sessionId, archiveDate, 'rewatch')
      return
    }
    if (!SERVER_RUNTIME || startServerSession.isPending) return
    setServerActionError('')
    startServerSession.mutate({
      key: crypto.randomUUID(),
      body: {
        kind: 'archive',
        mode: 'connections',
        period: 'all',
        difficulty: null,
        archiveDate,
      },
      backTarget: 'rewatch',
    })
  }

  const startDanetki = (roomMode: 'solo' | 'group', itemId?: string) => {
    if (startServerSession.isPending) return
    setServerActionError('')
    startServerSession.mutate({
      key: crypto.randomUUID(),
      body: { kind: 'daily', mode: 'danetki', roomMode, ...(itemId ? { itemId } : {}) },
      backTarget: 'hub',
    })
  }

  const startFreePlayDanetki = (roomMode: 'solo' | 'group', itemId?: string) => {
    if (startServerSession.isPending) return
    setServerActionError('')
    startServerSession.mutate({ key: crypto.randomUUID(), body: { kind: 'free_play', mode: 'danetki', roomMode, ...(itemId ? { itemId } : {}) }, backTarget: 'hub' })
  }

  const tryCatalogDanetki = (itemId: string) => {
    if ((serverRuntime.dashboard?.danetkiAccess.dailyRoomsStarted ?? 0) === 0) {
      startDanetki('solo', itemId)
      return
    }
    startFreePlayDanetki('solo', itemId)
  }

  const continueDanetki = () => {
    if (!activeDanetkiSessionId) return
    setServerSessionId(activeDanetkiSessionId)
    window.sessionStorage.setItem('shoditsa:active-server-session', activeDanetkiSessionId)
    setGameExperience(catalogGameExperience('hub'))
    setScreen('game')
    setModal(null)
    window.scrollTo({ top: 0 })
  }

  const selectDtfSpecial = () => {
    if (!canAccessDtfSpecial) return
    setServerActionError('')
    setModal(null)
    void navigateToPlayerRoute({ screen: 'special', packId: DTF_COMMENTS_PACK_ID })
  }

  const selectKpopSpecial = () => {
    if (!canAccessKpopSpecial) return
    setServerActionError('')
    setModal(null)
    void navigateToPlayerRoute({ screen: 'special', packId: KPOP_ARTISTS_PACK_ID })
  }

  const selectFriendsIntro = () => {
    setServerActionError('')
    setModal(null)
    void navigateToPlayerRoute({ screen: 'friends-intro' })
  }

  const selectFriendsRoom = (initialMode?: 'danetki' | 'territory') => {
    const destination = initialMode ? `/games/together?mode=${initialMode}` : '/games/together?new=1'
    if (!canCreateFriendsRoomAccess) {
      window.location.assign('/club')
      return
    }
    setServerActionError('')
    setModal(null)
    window.location.assign(destination)
  }

  const acceptChallenge = () => {
    if (!challenge) return
    trackMetrikaGoal('challenge_accepted', { mode: challenge.mode, date: challenge.date, from: challenge.from })
    clearTransitionTimer()
    setTransition('idle')
    setFreePlayLaunch(null)
    setFreePlayArmed(false)
    setModeSafe(challenge.mode)
    setModeVariant(challenge.mode === 'city' ? challenge.variantKey ?? GAME_MODE_MANIFEST.city.variants[0].id : null)
    setPeriod(challenge.mode === 'movie' || challenge.mode === 'series' || challenge.mode === 'anime' ? challenge.period : 'all')
    if (challenge.difficulty) setDifficulty(challenge.difficulty)
    setDate(challenge.date)
    setGameExperience(catalogGameExperience(challenge.date === getMoscowDate() ? 'hub' : 'rewatch'))
    setChallengeAccepted(true)
    if (SERVER_RUNTIME) {
      if (!isPlayableModeId(challenge.mode)) {
        setServerActionError('Этот игровой режим ещё не опубликован')
        return
      }
      const today = serverRuntime.meta?.moscowDate ?? getMoscowDate()
      startServerSession.mutate({
        key: crypto.randomUUID(),
        body: {
          kind: challenge.date === today ? 'daily' : 'archive',
          mode: challenge.mode,
          period: challenge.period,
          difficulty: challenge.mode === 'music' ? apiDifficulty(challenge.difficulty ?? 'medium') : null,
          ...(challenge.mode === 'city' ? { variantKey: challenge.variantKey ?? GAME_MODE_MANIFEST.city.variants[0].id } : {}),
          archiveDate: challenge.date === today ? null : challenge.date,
        },
        backTarget: challenge.date === today ? 'hub' : 'rewatch',
      })
      return
    }
    setScreen('game')
    setModal(null)
    window.scrollTo({ top: 0 })
  }

  const dismissChallenge = () => {
    setChallenge(null)
    setChallengeAccepted(false)
    window.history.replaceState({ seansScreen: screen }, '', window.location.pathname)
  }

  const playNextDaily = (nextMode: TitleMode | null) => {
    setChallenge(null)
    setChallengeAccepted(false)
    setFreePlayLaunch(null)
    setFreePlayArmed(false)
    if (!nextMode) {
      setDate(getMoscowDate())
      setScreen('rewatch')
      window.scrollTo({ top: 0 })
      return
    }
    setModeSafe(nextMode)
    setDate(getMoscowDate())
    setGameExperience(catalogGameExperience('hub'))
    setScreen('title')
    window.scrollTo({ top: 0 })
  }

  const openMusicReview = () => {
    if (SERVER_RUNTIME && serverRuntime.me?.user.role !== 'admin') {
      setServerActionError('Модерация доступна только администратору.')
      return
    }
    trackMetrikaGoal('open_music_review_screen', { from: screen })
    clearTransitionTimer()
    setTransition('idle')
    setModal(null)
    const backTarget = screen === 'title' || screen === 'rewatch' ? screen : 'hub'
    setReviewBackTarget(backTarget)
    setScreen('review')
    window.scrollTo({ top: 0 })
  }
  const buyPeriodUnlock = async (periodKey: PeriodKey) => {
    if (!canUnlockPeriods(mode)) return false
    if (SERVER_RUNTIME) {
      if (unlockServerPeriod.isPending || startServerSession.isPending || startServerFreePlay.isPending) return false
      if (currentUnlockedPeriods.includes(periodKey)) {
        setPeriod(periodKey)
        return true
      }
      try {
        await unlockServerPeriod.mutateAsync({ periodKey, key: crypto.randomUUID() })
        setPeriod(periodKey)
        return true
      } catch {
        return false
      }
    }
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
  const launchFreePlay = () => {
    if (startServerSession.isPending || startServerFreePlay.isPending || unlockServerPeriod.isPending) return
    if (transition === 'title-to-game') return
    if (!FREE_PLAY_MODES.has(mode)) return

    const backTarget = screen === 'rewatch' ? 'rewatch' : screen === 'title' ? 'title' : 'hub'

    if (SERVER_RUNTIME) {
      setServerActionError('')
      const activeServerFreePlay = (serverRuntime.dashboard?.activeSessions ?? []).find((session) => (
        session.kind === 'free_play' && (session.status === 'playing' || session.status === 'final_choice') && session.mode === mode
      ))
      if (activeServerFreePlay) {
        setServerSessionId(activeServerFreePlay.id)
        window.sessionStorage.setItem('shoditsa:active-server-session', activeServerFreePlay.id)
        setGameExperience(catalogGameExperience(backTarget))
        setModeSafe(mode)
        setPeriod(activeServerFreePlay.period)
        if (activeServerFreePlay.mode === 'music' && activeServerFreePlay.difficulty) setDifficulty(activeServerFreePlay.difficulty)
        setDate(activeServerFreePlay.puzzleDate)
        setFreePlayLaunch(1)
        setFreePlayArmed(false)
        setTransition('idle')
        setModal(null)
        setScreen('game')
        window.scrollTo({ top: 0 })
        return
      }
      setFreePlayArmed(false)
      startServerFreePlay.mutate({ key: crypto.randomUUID(), backTarget })
      return
    }

    const activeLocalFreePlay = activeGames.find((savedGame) => (
      savedGame.mode === mode && (savedGame.status === 'playing' || savedGame.status === 'final_choice') && freePlayLaunchFromGameKey(savedGame.key) !== null
    ))
    if (activeLocalFreePlay) {
      setFreePlayArmed(false)
      openSavedSession(activeLocalFreePlay, backTarget)
      return
    }

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

    setGameExperience(catalogGameExperience(backTarget))
    setPeriod('all')
    setDate(today)
    setFreePlayLaunch(nextLaunchNumber)
    setFreePlayArmed(false)
    setModal(null)
    window.scrollTo({ top: 0 })
    refreshEconomy()

    if (screen !== 'title') {
      clearTransitionTimer()
      setTransition('idle')
      setScreen('game')
      return
    }

    beginTitleTransition()
  }
  const playToday = () => {
    if (startServerSession.isPending || startServerFreePlay.isPending || unlockServerPeriod.isPending) return
    if (freePlayArmed) {
      launchFreePlay()
      return
    }
    if (transition === 'title-to-game') return
    trackMetrikaGoal('start_session', { mode, period })
    if (mode === 'diagnosis' && !SERVER_RUNTIME) trackDiagnosisGoal('start', { period, entry: 'local-session' })
    if (SERVER_RUNTIME) {
      if (!isPlayableModeId(mode)) {
        setServerActionError('Этот игровой режим ещё не опубликован')
        return
      }
      setServerActionError('')
      setFreePlayArmed(false)
      const backTarget = screen === 'rewatch' ? 'rewatch' : screen === 'title' ? 'title' : 'hub'
      startServerSession.mutate({
        key: crypto.randomUUID(),
        body: {
          kind: 'daily',
          mode,
          period,
          difficulty: mode === 'music' ? apiDifficulty(difficulty) : null,
          ...(mode === 'city' && modeVariant ? { variantKey: modeVariant } : {}),
          archiveDate: null,
        },
        backTarget,
      })
      return
    }
    adminDailySaltRef.current = 0
    setAdminDailySalt(0)
    setFreePlayLaunch(null)
    setFreePlayArmed(false)
    const backTarget = screen === 'rewatch' ? 'rewatch' : screen === 'title' ? 'title' : 'hub'
    setGameExperience(catalogGameExperience(backTarget))
    setDate(getMoscowDate())
    setModal(null)
    window.scrollTo({ top: 0 })
    if (screen !== 'title') {
      clearTransitionTimer()
      setTransition('idle')
      setScreen('game')
      return
    }
    beginTitleTransition()
  }
  const startFreePlay = () => {
    if (!FREE_PLAY_MODES.has(mode)) return
    setServerActionError('')
    setFreePlayArmed(true)
    setPeriod('all')
  }
  const openArchive = (archiveDate: string, savedGame: SavedGame | null) => {
    trackMetrikaGoal('open_archive_day', { hasSavedSession: Boolean(savedGame) })
    setFreePlayArmed(false)
    if (savedGame) {
      openSavedSession(savedGame, 'rewatch')
      return
    }
    if (SERVER_RUNTIME) {
      if (startServerSession.isPending || startServerFreePlay.isPending || unlockServerPeriod.isPending) return
      if (!isPlayableModeId(mode)) {
        setServerActionError('Этот игровой режим ещё не опубликован')
        return
      }
      setServerActionError('')
      startServerSession.mutate({
        key: crypto.randomUUID(),
        body: {
          kind: 'archive',
          mode,
          period,
          difficulty: mode === 'music' ? apiDifficulty(difficulty) : null,
          ...(mode === 'city' && modeVariant ? { variantKey: modeVariant } : {}),
          archiveDate,
        },
        backTarget: 'rewatch',
      })
      return
    }
    clearTransitionTimer()
    setTransition('idle')
    setGameExperience(catalogGameExperience('rewatch'))
    setFreePlayLaunch(null)
    setFreePlayArmed(false)
    setDate(archiveDate)
    setScreen('game')
    setModal(null)
    window.scrollTo({ top: 0 })
  }
  const setPeriodFromTitle = (nextPeriod: PeriodKey) => {
    setFreePlayArmed(false)
    setPeriod(nextPeriod)
  }
  const setDifficultyFromTitle = (nextDifficulty: DifficultyKey) => {
    setFreePlayArmed(false)
    setDifficulty(nextDifficulty)
  }
  const appTone = transition === 'title-to-game' ? 'transition-game' : screen
  const homePreview = typeof window !== 'undefined' ? new URLSearchParams(window.location.search).get('preview') : null
  const arcPreview = homePreview === 'arc'
  const codapressPreview = homePreview === 'codapress'
  const titleActionPending = startServerSession.isPending || startServerFreePlay.isPending || unlockServerPeriod.isPending
  const completeTitleTransition = () => {
    if (transition !== 'title-to-game') return
    clearTransitionTimer()
    setScreen('game')
    setTransition('idle')
    window.scrollTo({ top: 0 })
  }

  return <div className={`app app--${appTone} ${screen === 'hub' && codapressPreview ? 'app--codapress-preview' : ''}`}>
    {serverActionError && <InlineAlert tone="danger" className="server-error app-action-error" onDismiss={() => setServerActionError('')}>{serverActionError}</InlineAlert>}
    {screen === 'hub' && <HubScreen onSelect={selectCategory} onSelectDtfSpecial={selectDtfSpecial} onSelectKpopSpecial={selectKpopSpecial} onSelectFriends={selectFriendsIntro} onDanetki={openDanetki} onConnections={openConnections} danetkiEnabled={SERVER_RUNTIME ? serverRuntime.meta?.features.danetkiEnabled !== false : false} danetkiPoolCount={serverRuntime.meta?.modes.find((entry) => String(entry.mode) === 'danetki')?.count ?? null} connectionsEnabled={SERVER_RUNTIME ? serverRuntime.meta?.features.connectionsEnabled !== false : false} connectionsPoolCount={serverRuntime.meta?.modes.find((entry) => entry.mode === 'connections')?.count ?? null} connectionsStatus={connectionsStatus} connectionsMistakes={activeConnectionsSession?.mistakesUsed ?? null} onRewatch={() => setScreen('rewatch')} onStats={() => setModal('stats')} onRules={() => setModal('rules')} onReview={openMusicReview} onResume={resumeActiveSession} onOpenSaved={(savedGame) => openSavedSession(savedGame, 'hub')} canAccessDtfSpecial={canAccessDtfSpecial} canAccessKpopSpecial={canAccessKpopSpecial} dtfPoolCount={dtfPack?.totalItems ?? null} kpopPoolCount={kpopPack?.totalItems ?? null} canAccessFriendsRoom={canCreateFriendsRoomAccess} activeSessionsCount={activeGames.length} games={games} preferredMode={mode} titleCounts={titleCounts} todayAttendance={todayAttendance} globalDailySalt={globalDailySalt} arcPreview={arcPreview} codapressPreview={codapressPreview} />}

    {screen === 'friends-intro' && <FriendsRoomIntroScreen canCreate={canCreateFriendsRoomAccess} territoryEnabled={SERVER_RUNTIME ? serverRuntime.meta?.features.territoryEnabled === true : false} onHome={goHome} onArchive={() => moveToScreen('rewatch')} onStats={() => setModal('stats')} onRules={() => setModal('rules')} onReview={openMusicReview} onStart={() => selectFriendsRoom()} onTerritory={() => selectFriendsRoom('territory')} onClub={() => moveToScreen('club')} />}

    {screen === 'friends-room' && canAccessFriendsRoom && <FriendsRoomScreen navigation={{ onHome: goHome, onArchive: () => moveToScreen('rewatch'), onStats: () => setModal('stats'), onRules: () => setModal('rules'), onReview: openMusicReview }} onExit={goHome} ticketBalance={serverRuntime.dashboard?.wallet.balance ?? 0} territoryEnabled={SERVER_RUNTIME ? serverRuntime.meta?.features.territoryEnabled === true : false} />}
    {screen === 'friends-room' && !canAccessFriendsRoom && <main className="loading" role="status">{serverRuntime.loading ? 'Проверяем доступ…' : 'Переходим к регистрации…'}</main>}

    {screen === 'danetki' && <DanetkiLobbyPage date={serverRuntime.meta?.moscowDate ?? getMoscowDate()} access={serverRuntime.dashboard?.danetkiAccess} ticketBalance={serverRuntime.dashboard?.wallet.balance ?? 0} canCreateGroupRoom={canCreateFriendsRoomAccess} onHome={goHome} onBack={goHome} onArchive={() => setScreen('rewatch')} onStats={() => setModal('stats')} onRules={() => setModal('rules')} onReview={openMusicReview} onStart={startDanetki} onStartFreePlay={startFreePlayDanetki} onCreateRoom={() => selectFriendsRoom('danetki')} onContinue={activeDanetkiSessionId ? continueDanetki : undefined} busy={startServerSession.isPending} error={serverActionError} />}

    {screen === 'danetki-catalog' && <DanetkiCatalogPage collection={playerRouteFromPathname(routeLocation.pathname).danetkiCollection} access={serverRuntime.dashboard?.danetkiAccess} ticketBalance={serverRuntime.dashboard?.wallet.balance ?? 0} busy={startServerSession.isPending} onTry={(item) => tryCatalogDanetki(item.id)} onHome={goHome} onArchive={() => moveToScreen('rewatch')} onStats={() => setModal('stats')} onRules={() => setModal('rules')} onReview={openMusicReview} />}

    {screen === 'danetki-story' && <DanetkiStoryPage slug={playerRouteFromPathname(routeLocation.pathname).danetkiSlug ?? ''} access={serverRuntime.dashboard?.danetkiAccess} ticketBalance={serverRuntime.dashboard?.wallet.balance ?? 0} busy={startServerSession.isPending} onTry={(item) => tryCatalogDanetki(item.id)} onHome={goHome} onArchive={() => moveToScreen('rewatch')} onStats={() => setModal('stats')} onRules={() => setModal('rules')} onReview={openMusicReview} />}

    {screen === 'danetki-join' && <DanetkiJoinPage token={playerRouteFromPathname(routeLocation.pathname).inviteToken ?? ''} onHome={goHome} onArchive={() => moveToScreen('rewatch')} onStats={() => setModal('stats')} onRules={() => setModal('rules')} onReview={openMusicReview} onJoined={(session) => activateServerSession(session, 'hub')} />}

    {screen === 'title' && (connectionsTitleActive
      ? <ConnectionsTitleScreen date={serverRuntime.meta?.moscowDate ?? getMoscowDate()} status={connectionsStatus} busy={startServerSession.isPending} onHome={goHome} onBack={goBackFromTitle} onArchive={() => setScreen('rewatch')} onStats={() => setModal('stats')} onRules={() => setModal('rules')} onReview={openMusicReview} onPlay={playConnectionsToday} />
      : <TitleScreen mode={mode} variantKey={modeVariant} setVariantKey={setModeVariant} period={period} setPeriod={setPeriodFromTitle} date={getMoscowDate()} onHome={goHome} onBack={goBackFromTitle} onPlay={playToday} onReplay={launchFreePlay} onViewTodayResult={() => { if (todayResultGame) openSavedSession(todayResultGame, 'title') }} onRewatch={() => setScreen('rewatch')} onStats={() => setModal('stats')} onRules={() => setModal('rules')} onReview={openMusicReview} isLeaving={transition === 'title-to-game'} onLeaveComplete={completeTitleTransition} onReadAnamnesis={openDiagnosisAnamnesis} hasAnamnesis={mode === 'diagnosis'} todayCompleted={todayAttendance.completedModes.includes(mode)} todayResultAvailable={Boolean(todayResultGame)} wallet={wallet} unlockedPeriods={currentUnlockedPeriods} completedPeriods={currentCompletedPeriods} completedDifficulties={completedDifficulties} onUnlockPeriod={buyPeriodUnlock} periodUnlockCostValue={periodUnlockCostValue} onStartFreePlay={startFreePlay} freePlayArmed={freePlayArmed} hasActiveFreePlay={hasActiveFreePlay} freePlayCostValue={freePlayCostValue} freePlayShortage={freePlayShortage} freePlayLaunchesToday={freePlayLaunchesToday} clubFreePlay={clubFreePlay} difficulty={difficulty} setDifficulty={setDifficultyFromTitle} difficultyCounts={musicDifficultyCounts} isBusy={titleActionPending} />)}

    {screen === 'rewatch' && <RewatchScreen mode={mode} setMode={setModeSafe} period={period} dates={archiveDates} games={games} titles={data[mode]} onOpen={openArchive} onOpenConnections={openConnectionsArchive} onHome={goHome} onStats={() => setModal('stats')} onRules={() => setModal('rules')} onReview={openMusicReview} onClub={() => moveToScreen('club')} />}

    {screen === 'review' && <MusicReviewScreen onHome={goHome} onBack={goBackFromReview} onRewatch={() => setScreen('rewatch')} onStats={() => setModal('stats')} onRules={() => setModal('rules')} onReview={openMusicReview} />}

    {screen === 'profile' && <ProfileScreen onHome={goHome} onArchive={() => moveToScreen('rewatch')} onStats={() => setModal('stats')} onRules={() => setModal('rules')} onReview={openMusicReview} onSelectMode={selectCategory} onClub={() => moveToScreen('club')} />}

    {screen === 'club' && <ClubScreen onHome={goHome} onArchive={() => moveToScreen('rewatch')} onFreePlay={() => { moveToScreen('title'); setFreePlayArmed(true) }} onProfile={() => moveToScreen('profile')} onStats={() => setModal('stats')} onRules={() => setModal('rules')} onReview={openMusicReview} />}

    {screen === 'specials' && <SpecialsScreen onHome={goHome} onArchive={() => moveToScreen('rewatch')} onStats={() => setModal('stats')} onRules={() => setModal('rules')} onReview={openMusicReview} />}

    {screen === 'special' && <SpecialDetailScreen packId={playerRouteFromPathname(routeLocation.pathname).packId ?? ''} onHome={goHome} onArchive={() => moveToScreen('rewatch')} onStats={() => setModal('stats')} onRules={() => setModal('rules')} onReview={openMusicReview} onSession={(session) => {
      trackConfirmedServerStart(session.id, { mode: session.mode, period: session.period, kind: session.kind, state: 'new' })
      activateServerSession(session, 'hub')
    }} />}

    {screen === 'create-game' && <CreateGameScreen onHome={goHome} onArchive={() => moveToScreen('rewatch')} onStats={() => setModal('stats')} onRules={() => setModal('rules')} onReview={openMusicReview} />}

    {screen === 'purchase-return' && <PurchaseReturnScreen onHome={goHome} onClub={() => moveToScreen('club')} onProfile={() => moveToScreen('profile')} onArchive={() => moveToScreen('rewatch')} onStats={() => setModal('stats')} onRules={() => setModal('rules')} onReview={openMusicReview} />}

    {screen === 'legal' && <LegalScreen document={playerRouteFromPathname(routeLocation.pathname).legalDocument ?? 'terms'} onHome={goHome} onArchive={() => moveToScreen('rewatch')} onStats={() => setModal('stats')} onRules={() => setModal('rules')} onReview={openMusicReview} />}

    {screen === 'game' && (SERVER_RUNTIME
      ? serverSessionId
        ? <ServerGame
            sessionId={serverSessionId}
            onHome={goHome}
            onBack={goBackFromGame}
            onArchive={() => setScreen('rewatch')}
            onStats={() => setModal('stats')}
            onRules={() => setModal('rules')}
            onReview={openMusicReview}
            onPlayNext={playNextDaily}
            onReplay={launchFreePlay}
            replayCost={freePlayCostValue}
            replayShortage={freePlayShortage}
            replayPending={titleActionPending}
            replayAccessSource={clubFreePlay ? 'club' : 'tickets'}
            onConfigureMode={() => moveToScreen('title')}
            onSessionLoaded={syncServerSessionContext}
            onPackSession={(session) => activateServerSession(session, 'hub')}
          />
        : <GameDataLoadError onRetry={goHome} onHome={goHome} />
      : loading
        ? <div className="loading"><Sparkles /> Настраиваем проектор…</div>
        : loadError
          ? <GameDataLoadError onRetry={retryLoading} onHome={goHome} />
          : <Game
          titles={data[mode]}
          mode={mode}
          variantKey={mode === 'city' ? modeVariant : null}
          period={period}
          difficulty={difficulty}
          date={date}
          dailySalt={effectiveDailySalt}
          freePlayLaunch={freePlayLaunch}
          isPracticeSession={freePlayLaunch !== null || adminDailySalt !== 0}
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
          challenge={challengeAccepted ? challenge : null}
          onPlayNext={playNextDaily}
          onReplay={launchFreePlay}
          replayCost={freePlayCostValue}
          replayShortage={freePlayShortage}
          replayPending={titleActionPending}
          replayAccessSource={clubFreePlay ? 'club' : 'tickets'}
          onConfigureMode={() => moveToScreen('title')}
            />)}

    <AppFooter onHome={goHome} onArchive={() => moveToScreen('rewatch')} onProfile={() => moveToScreen('profile')} onRules={() => setModal('rules')} />

    {modal === 'rules' && <Modal title="Как играть" onClose={() => setModal(null)}><RulesView /></Modal>}
    {modal === 'stats' && <Modal title="Статистика" onClose={() => setModal(null)}><div className="modal-mode">{modeMeta(mode).plural}</div><StatsView mode={mode} difficulty={mode === 'music' ? difficulty : undefined} /></Modal>}
    {modal === 'resume' && <Modal title="Вернуться к игре" onClose={() => setModal(null)}><ResumeSessionsView sessions={activeGames} onOpen={(session) => openSavedSession(session, 'hub')} /></Modal>}
    {modal === 'anamnesis' && diagnosisAnamnesis && <AnamnesisModal text={diagnosisAnamnesis.text} dayNo={dayNumber(getMoscowDate())} onClose={() => setModal(null)} onStart={() => {
      if (diagnosisPreviewSession) {
        const session = diagnosisPreviewSession
        setDiagnosisPreviewSession(null)
        trackConfirmedServerStart(session.id, { mode: session.mode, period: session.period, kind: session.kind, state: 'new' })
        activateServerSession(session, 'title')
        return
      }
      setModal(null)
      playToday()
    }} />}
    {challenge && !challengeAccepted && <ChallengeInvite challenge={challenge} onAccept={acceptChallenge} onDismiss={dismissChallenge} />}
  </div>
}

export default function App() {
  return <Suspense fallback={<main className="loading" role="status"><Sparkles /> Загружаем экран…</main>}><GameApp /></Suspense>
}

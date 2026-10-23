/** Deterministic, local-only presentation data. No database or network imports. */
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { tsImport } from 'tsx/esm/api'

const { ECONOMY_RULE_SET, DEFAULT_CLUB_PRODUCTS, DEFAULT_TICKET_BUNDLES, KPOP_ARTISTS_PACK_ID } = await tsImport('../../packages/contracts/src/index.ts', import.meta.url)
const { compareTitles } = await tsImport('../../packages/game-core/src/index.ts', import.meta.url)
const { ROOM_SCENARIOS, roomFixture, roomSummary } = await tsImport('./reference-room-fixtures.ts', import.meta.url)
export { ROOM_SCENARIOS }
export const TODAY = '2026-10-21'
export const NOW = `${TODAY}T12:00:00.000Z`
export const MODES = ['movie', 'series', 'anime', 'game', 'city', 'music', 'diagnosis', 'animal', 'book', 'character']
export const SCENARIOS = ['member', 'guest', 'club', 'expired', 'empty', 'error', 'pending', 'paid', 'failed', 'refunded', ...ROOM_SCENARIOS]
const libraryNames = ['movies', 'series', 'animes', 'games', 'cities', 'music', 'diagnoses', 'animals', 'books', 'characters']
export const libraries = Object.fromEntries(MODES.map((mode, index) => {
  const raw = JSON.parse(readFileSync(fileURLToPath(new URL(`../../public/data/libraries/${libraryNames[index]}/items.json`, import.meta.url)), 'utf8'))
  const items = (Array.isArray(raw) ? raw : raw.items).slice(0, 12).map(item => ({ ...item, mode, posterUrl: `/images/home-doodle/${mode}.webp` }))
  return [mode, items]
}))
const day = (offset) => new Date(Date.parse(`${TODAY}T12:00:00Z`) + offset * 86_400_000).toISOString().slice(0, 10)

export function me(scenario) {
  const anonymous = scenario === 'guest'
  return {
    user: { id: 'visual-owner', email: anonymous ? '' : 'visual@example.test', name: anonymous ? 'Гость' : 'Полуночный сеанс', role: 'player', isAnonymous: anonymous },
    profile: { userId: 'visual-owner', role: 'player', displayName: anonymous ? null : 'Полуночный сеанс', locale: 'ru-RU', timezone: 'Europe/Moscow', legacyImportedAt: null },
    badges: [], auth: { providers: anonymous ? [] : ['credential'], hasPassword: !anonymous },
  }
}
export function meta() {
  return {
    serverTime: NOW, moscowDate: TODAY, apiVersion: 'local-qa-fixtures', rulesVersion: ECONOMY_RULE_SET.version,
    activeRevision: { id: 'local-fixtures', version: 'qa-1' }, minimumFrontendVersion: '0.1.0', buildSha: 'local-qa',
    modes: [...MODES, 'danetki', 'connections'].map(mode => ({ mode, count: mode in libraries ? libraries[mode].length : 1 })),
    auth: { emailPassword: true, emailVerification: false, passwordReset: false, yandex: false },
    commerce: { enabled: true, provider: 'stub', currency: 'RUB', archiveFirstDate: '2026-07-01', freeArchiveDays: 7 },
    features: { danetkiEnabled: true, danetkiMultiplayerEnabled: true, finalChoiceEnabled: true, connectionsEnabled: true, connectionsHintsEnabled: true, connectionsLaunchDate: '2026-07-01', territoryEnabled: true },
  }
}
export function membership(scenario) {
  return { active: scenario === 'club', startsAt: scenario === 'club' || scenario === 'expired' ? '2026-09-01T00:00:00Z' : null, endsAt: scenario === 'club' ? '2027-01-15T00:00:00Z' : scenario === 'expired' ? '2026-10-01T00:00:00Z' : null, source: scenario === 'club' || scenario === 'expired' ? 'order' : null }
}
export function globalLeaderboard(scenario, query = new URLSearchParams()) {
  const period = query.get('period') === 'all' ? 'all' : 'week'
  const offset = Math.max(0, Number(query.get('offset')) || 0)
  const limit = Math.min(100, Math.max(1, Number(query.get('limit')) || 5))
  const entries = scenario === 'empty' ? [] : ['Люмен', 'Полуночный сеанс', 'Ракурс', 'Тихий зритель', 'Луна', 'Искатель', 'Знаток', 'Луч'].map((displayName, index) => ({
    playerKey: `qa-player-${index}`, rank: index + 1, displayName, avatarUrl: null,
    isClubMember: index === 0 || scenario === 'club' && index === 1,
    isCurrentUser: scenario !== 'guest' && index === 1, score: (period === 'all' ? 12000 : 900) - index * 70,
    totalRating: 12000 - index * 70, weeklyRating: 900 - index * 70, games: 40 - index, wins: 35 - index,
  }))
  return { period, rulesVersion: 1, updatedAt: NOW, serverTime: NOW,
    week: { startsAt: '2026-10-18T21:00:00.000Z', endsAt: '2026-10-25T21:00:00.000Z', timezone: 'Europe/Moscow' },
    participantCount: entries.length, entries: entries.slice(offset, offset + limit),
    viewerEntry: entries.find(entry => entry.isCurrentUser) ?? null,
    viewerState: scenario === 'guest' ? 'guest' : scenario === 'empty' ? 'unranked' : 'ranked',
    pointsToNextRank: scenario === 'guest' || scenario === 'empty' ? null : 71,
    nextOffset: offset + limit < entries.length ? offset + limit : null,
  }
}
export function dashboard(scenario) {
  const empty = scenario === 'empty' || scenario === 'guest'
  const balance = empty ? 0 : 248
  const quote = sink => ({ sink, allowed: balance >= 60 || scenario === 'club', accessSource: scenario === 'club' ? 'club' : 'tickets', cost: scenario === 'club' ? 0 : 60, balance, shortage: empty ? 60 : 0, paidUsesToday: 0, rulesVersion: ECONOMY_RULE_SET.version })
  return {
    wallet: { userId: 'visual-owner', balance, lifetimeEarned: empty ? 0 : 680, purchaseDebt: 0, version: 1, updatedAt: NOW },
    attendance: { currentDailyStreak: empty ? 0 : 5, bestDailyStreak: empty ? 0 : 12, lastCompletedDate: empty ? null : TODAY, gracePasses: 0, totalActiveDays: empty ? 0 : 24, fullHouseDays: empty ? 0 : 2 },
    today: { activityDate: TODAY, completedModes: empty ? [] : ['movie', 'series'], wonModes: empty ? [] : ['movie'], fullHouse: false },
    stats: MODES.map((mode, index) => ({ mode, difficultyKey: mode === 'music' ? 'medium' : '-', played: empty ? 0 : 10 + index, won: empty ? 0 : 8 + index, currentStreak: empty ? 0 : 3, bestStreak: empty ? 0 : 7, distribution: empty ? Array(10).fill(0) : [1, 2, 3, 2, 1, 1, 0, 0, 0, 0], finalChoiceWins: 0 })),
    entitlements: [], activeSessions: empty ? [] : [{ id: 'qa-anime-playing', mode: 'anime', kind: 'daily', status: 'playing', variantKey: null, period: 'all', difficulty: null, puzzleDate: TODAY, attemptsCount: 2, updatedAt: NOW }],
    freePlayLaunchesToday: 0, freePlayNextCost: 60, economyRules: ECONOMY_RULE_SET,
    economyQuotes: { freePlay: quote('free-play'), periodUnlock: quote('period-unlock'), danetkiSolo: quote('danetki-room'), danetkiGroup: quote('danetki-room') },
    danetkiAccess: { dailyRoomsStarted: 0, extraRoomsStarted: 0, clubRoomsRemaining: scenario === 'club' ? 2 : 0, nextSoloCost: 0, nextGroupCost: 0 },
    membership: membership(scenario),
  }
}
export function archiveItems(scenario, mode) {
  if (scenario === 'empty' || scenario === 'guest') return []
  return (mode ? [mode] : MODES).flatMap((entry, index) => [0, 1, 2].map(offset => ({
    id: `qa-${entry}-${offset === 1 ? 'lost' : 'won'}-${day(-offset - (mode ? 0 : index % 3))}`, mode: entry, variantKey: null, period: 'all', difficulty: entry === 'music' ? 'medium' : null,
    puzzleDate: day(-offset - (mode ? 0 : index % 3)), status: offset === 1 ? 'lost' : 'won', attemptsCount: offset === 1 ? 10 : 3, completedAt: NOW,
  })))
}
export function archiveCalendar(scenario, params) {
  const mode = params.get('mode') ?? 'movie'
  const from = params.get('from') ?? day(-13)
  const to = params.get('to') ?? TODAY
  const items = []
  for (let at = Date.parse(`${from}T12:00:00Z`), end = Date.parse(`${to}T12:00:00Z`); at <= end && items.length < 370; at += 86_400_000) {
    const date = new Date(at).toISOString().slice(0, 10)
    items.push({ date, available: true, access: date >= day(-6) ? 'free' : scenario === 'club' ? 'club' : 'locked', session: archiveItems(scenario, mode).find(item => item.puzzleDate === date) ?? null })
  }
  return { access: { archiveFirstDate: '2026-07-01', freeFrom: day(-6), clubActive: scenario === 'club' }, items }
}
export function commerce(scenario) {
  return {
    membership: membership(scenario),
    entitlements: scenario === 'empty' || scenario === 'guest' ? [] : [{ key: 'supporter', scope: 'paper', startsAt: NOW, endsAt: null }, { key: 'supporter', scope: 'gold', startsAt: NOW, endsAt: null }],
    subscriptions: scenario === 'club' ? [{ id: 'qa-subscription', productId: 'club_30d', status: 'active', amountMinor: DEFAULT_CLUB_PRODUCTS[0].priceMinor, currency: 'RUB', interval: 'Month', period: 1, nextPaymentAt: '2026-11-15T12:00:00Z', canceledAt: null, createdAt: NOW }] : [],
  }
}
// Same illustrative tips as LegalScreen's existing fallback catalog.
const tipProducts = [
  ['tip_paper_99', 'Бумажный жетон', 9_900], ['tip_silver_299', 'Серебряный жетон', 29_900], ['tip_gold_699', 'Золотой жетон', 69_900],
].map(([id, title, priceMinor]) => ({ id, kind: 'tip', title, description: 'Памятный цифровой жетон в профиле.', priceMinor, currency: 'RUB', durationDays: null, metadata: {} }))
export function catalog() { return { enabled: true, currency: 'RUB', products: [...DEFAULT_CLUB_PRODUCTS, ...DEFAULT_TICKET_BUNDLES, ...tipProducts] } }
export function packs(scenario) {
  if (scenario === 'empty') return []
  return [
    { id: 'dtf-game-comments-25-v1', mode: 'game', title: 'Игры по комментариям', subtitle: 'Подборка DTF', description: 'Узнайте знакомую игру по отзывам и сравните её признаки.', coverUrl: '/images/home-doodle/game.webp', totalItems: 25 },
    { id: KPOP_ARTISTS_PACK_ID, mode: 'music', title: 'K-pop каждый день', subtitle: 'Пять поколений корейской поп-сцены', description: 'Один артист и десять попыток. Новая загадка каждый день.', coverUrl: '/images/home-doodle/music.webp', totalItems: 120 },
  ].map((pack, index) => ({ ...pack, slug: pack.id, accessModel: 'club', includedInClub: true, previewItems: 0, productId: null, priceMinor: null, currency: null, access: scenario === 'club' ? 'club' : index === 0 && scenario === 'member' ? 'personal' : 'locked', owned: scenario === 'member' && index === 0, completedItems: scenario === 'club' || scenario === 'member' ? 4 : 0, wonItems: 3, lostItems: 1 }))
}
export function packDetail(scenario, id) {
  const pack = packs(scenario).find(entry => entry.id === id)
  return pack ? { ...pack, entries: Array.from({ length: pack.totalItems }, (_, index) => ({ position: index + 1, preview: false, completed: index < pack.completedItems, accessible: pack.access !== 'locked', prompt: {} })) } : null
}
const groups = [
  { color: 'yellow', title: 'Оканчиваются на «-ай»', words: ['МАЙ', 'ЛАЙ', 'ЧАЙ', 'КРАЙ'] },
  { color: 'green', title: 'Можно открыть ключом', words: ['ДВЕРЬ', 'ЗАМОК', 'СЕЙФ', 'СУНДУК'] },
  { color: 'blue', title: 'Виды волн', words: ['ЗВУК', 'СВЕТ', 'ПРИЛИВ', 'РАДИО'] },
  { color: 'purple', title: 'Скрытая связь', words: ['ЛИНИЯ', 'УЗЕЛ', 'ЦЕПЬ', 'МОСТ'] },
]
export const roomMembers = [
  { userId: 'visual-owner', role: 'owner', displayName: 'Полуночный сеанс', colorKey: 'player-1', score: 0, answered: false, joinedAt: NOW, leftAt: null, lastSeenAt: NOW },
  { userId: 'visual-friend', role: 'player', displayName: 'Тихий зритель', colorKey: 'player-2', score: 0, answered: false, joinedAt: NOW, leftAt: null, lastSeenAt: NOW },
]
/** Adapted from responsive-layout.spec.ts and the existing Connections UI Kit fixture. */
export function session(mode = 'movie', status = 'playing', overrides = {}) {
  const base = {
    id: `qa-${mode}-${status}`, engine: 'catalog_guess', rulesVersion: ECONOMY_RULE_SET.version, kind: 'daily', packId: null, packPosition: null, mode, variantKey: null, period: 'all', difficulty: mode === 'music' ? 'medium' : null,
    puzzleDate: TODAY, status, completionType: status === 'won' ? 'direct_win' : status === 'lost' ? 'attempts_exhausted' : null, finalChoice: null,
    attemptsCount: 0, attemptsRemaining: 10, maxAttempts: 10, attempts: [], hintCheckpoints: [{ round: 5, state: 'locked' }, { round: 8, state: 'locked' }], hintChoices: [], hintOptions: [], progressiveHints: [], promoPrompt: null,
    diagnosisVignette: mode === 'diagnosis' ? { id: 'qa-case', text: 'Пациент обратился с жалобами на слабость и повышение температуры. Эта история показана для проверки компоновки экрана.' } : null, serverTime: NOW,
  }
  if (mode === 'connections') {
    const tiles = groups.flatMap((group, groupIndex) => group.words.map((label, index) => ({ id: `${group.color}-${index}`, label, initialPosition: groupIndex * 4 + index })))
    return { ...base, engine: 'connections_grid', maxAttempts: 6, attemptsRemaining: status === 'playing' ? 6 : 0, connections: { tiles, solvedGroups: status === 'playing' ? [] : groups.map(group => ({ color: group.color, title: group.title, tiles: tiles.filter(tile => tile.id.startsWith(group.color)) })), guesses: [], hints: [], mistakesUsed: status === 'lost' ? 4 : 0, mistakesRemaining: status === 'lost' ? 0 : 4, maxMistakes: 4, maxGuesses: 6, hintAvailableAt: null, status }, ...overrides }
  }
  if (mode === 'danetki') return { ...base, engine: 'danetki_chat', danetki: {
    puzzle: { id: 'danetka-007', titleRu: 'Последний пассажир', condition: 'Человек вошёл в пустой вагон, улыбнулся незнакомцу и понял, что поезд уже приехал.', difficulty: 'medium', genres: ['детектив'], starterQuestions: [], contentWarnings: [] },
    roomMode: 'solo', startedAt: NOW, currentTurnUserId: 'visual-owner', capacity: 1, questionCount: 7, questionWarningAt: 35, questionLimit: 40, questionsRemaining: 33, hintLevel: 1, aiStatus: 'idle', members: [roomMembers[0]],
    messages: [{ id: 'qa-question', seq: 1, senderKind: 'user', senderUserId: 'visual-owner', senderName: 'Полуночный сеанс', senderColorKey: 'player-1', messageType: 'question', text: 'Вагон находился в музее?', classification: null, importance: null, parentMessageId: null, createdAt: NOW }, { id: 'qa-answer', seq: 2, senderKind: 'ai', senderUserId: null, senderName: null, senderColorKey: null, messageType: 'answer', text: 'Да.', classification: 'yes', importance: null, parentMessageId: 'qa-question', createdAt: NOW }],
    currentUserId: 'visual-owner', canStart: false, canInvite: false, lastSeq: 2, outcome: status, ...(status === 'playing' ? {} : { solution: 'Вагон стоял в железнодорожном музее. Герой участвовал в иммерсивной экскурсии.' }),
  }, ...overrides }
  const items = libraries[mode] ?? libraries.movie
  const answer = items[0]
  const guesses = status === 'won' ? [items[1], items[2], answer] : status === 'lost' ? Array.from({ length: 10 }, (_, index) => items[index % (items.length - 1) + 1]) : [items[1], items[2]]
  const attempts = guesses.map((item, index) => ({ position: index + 1, item, hints: compareTitles(item, answer) }))
  return { ...base, attempts, attemptsCount: attempts.length, attemptsRemaining: 10 - attempts.length, ...(status !== 'playing' ? { answer } : {}), ...overrides }
}
export const roomForScenario = (scenario, now = NOW) => roomFixture(scenario, libraries.movie, now)

/** Explicit local examples exercise special-session UI without changing real progress. */
export function specialSession(packKey, status = 'playing', position = 5) {
  const dtf = packKey === 'dtf'
  const packId = dtf ? 'dtf-game-comments-25-v1' : KPOP_ARTISTS_PACK_ID
  const result = session(dtf ? 'game' : 'music', status, {
    id: `qa-${packKey}-${status}`, kind: dtf ? 'pack' : 'daily', packId: dtf ? packId : null, packPosition: dtf ? position : null,
    variantKey: dtf ? null : packId, maxAttempts: dtf ? 6 : 10,
    ...(dtf ? { promoPrompt: { packId, title: 'Игры по комментариям', subtitle: `Игра ${position} из 25`, disclaimer: 'Примеры комментариев для локального просмотра.' },
      progressiveHints: ['В этом мире легко забыть, зачем шёл на задание.', 'Сначала изучаешь карту, а потом вспоминаешь про основной сюжет.', 'Знакомые персонажи делают каждое возвращение особенным.'].map((text, index) => ({ key: `comment-${index}`, value: {
        text, unlockAfterAttempts: index, authorName: `Игрок ${index + 1}`,
        publishedAt: `2026-10-${19 + index}T12:00:00.000Z`,
        likesCount: 12 + index * 9, dislikesCount: index === 1 ? 2 : 0, replyCount: 3 + index * 2,
      } })) } : {}),
  })
  if (dtf && result.attempts.length > 6) result.attempts = result.attempts.slice(0,6)
  result.attemptsCount = result.attempts.length
  result.attemptsRemaining = result.maxAttempts - result.attemptsCount
  return result
}
export const room = roomForScenario('member')
export const rooms = (scenario, now = NOW) => ['guest', 'empty'].includes(scenario) ? [] : [roomSummary(roomForScenario(scenario, now))]
export const leaderboard = id => ({ packId: id, participantCount: 4, totalItems: 25, updatedAt: NOW, viewerEntry: null, entries: ['Люмен', 'Полуночный сеанс', 'Ракурс', 'Тихий зритель'].map((displayName, index) => ({ rank: index + 1, displayName, avatarUrl: null, completedItems: 20 - index, totalItems: 25, score: 2450 - index * 120, wins: 18 - index, totalAttempts: 34 + index * 4, completedAt: null, isCurrentUser: index === 1 })) })
export const order = (scenario, id) => ({ order: { id, productId: 'club_30d', status: ['pending', 'paid', 'failed', 'refunded'].includes(scenario) ? scenario : 'pending', amountMinor: DEFAULT_CLUB_PRODUCTS[0].priceMinor, currency: 'RUB', createdAt: NOW, paidAt: scenario === 'paid' ? NOW : null }, product: DEFAULT_CLUB_PRODUCTS[0] })

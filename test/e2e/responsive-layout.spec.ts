import { expect, test, type Locator, type Page } from '@playwright/test'

const gameModes = ['movie', 'series', 'anime', 'game', 'city', 'music', 'diagnosis'] as const

async function expectNoPageOverflow(page: Page, screen: string) {
  const metrics = await page.evaluate(() => ({
    clientWidth: document.documentElement.clientWidth,
    scrollWidth: document.documentElement.scrollWidth,
    bodyWidth: document.body.scrollWidth,
  }))
  expect(metrics.scrollWidth - metrics.clientWidth, `${screen}: document overflow`).toBeLessThanOrEqual(1)
  expect(metrics.bodyWidth - metrics.clientWidth, `${screen}: body overflow`).toBeLessThanOrEqual(1)
}

async function expectInsideViewport(locator: Locator, label: string) {
  const bounds = await locator.evaluate((element) => {
    const rect = element.getBoundingClientRect()
    return { left: rect.left, right: rect.right, width: innerWidth }
  })
  expect(bounds.left, `${label}: left edge`).toBeGreaterThanOrEqual(-1)
  expect(bounds.right, `${label}: right edge`).toBeLessThanOrEqual(bounds.width + 1)
}

test('critical screens and all themed lobbies stay inside the viewport', async ({ page }) => {
  await page.goto('/')
  await expect(page.locator('.hub-hero')).toBeVisible()
  await expectNoPageOverflow(page, 'home')
  await expectInsideViewport(page.locator('.hub-hero__copy'), 'home copy')
  await expectInsideViewport(page.locator('.hub-hero__actions').first(), 'home actions')

  for (const mode of gameModes) {
    await page.goto(`/games/${mode}`)
    await expect(page.locator('.title-screen')).toBeVisible()
    await expectNoPageOverflow(page, `${mode} lobby`)
    await expectInsideViewport(page.locator('.title-screen').locator(':is(.admit-ticket, .concert-ticket, .med-chart)').first(), `${mode} artifact`)
  }

  for (const route of ['/archive', '/profile', '/login']) {
    await page.goto(route)
    await expect(page.locator('main')).toBeVisible()
    await expectNoPageOverflow(page, route)
  }
})

test('mobile controls remain tappable and inputs do not trigger iOS zoom', async ({ page, viewport }) => {
  test.skip(!viewport || viewport.width > 430, 'Touch audit is scoped to phone viewports')
  await page.goto('/')

  const controls = page.locator('.app-header button:visible, .hub-hero__actions a:visible')
  for (let index = 0; index < await controls.count(); index += 1) {
    const box = await controls.nth(index).boundingBox()
    expect(box?.width ?? 0, `control ${index} width`).toBeGreaterThanOrEqual(44)
    expect(box?.height ?? 0, `control ${index} height`).toBeGreaterThanOrEqual(44)
  }

  await page.goto('/games/movie')
  const start = page.locator('.game-launch-controls button').last()
  await expect(start).toBeVisible()
  await expect((await start.boundingBox())?.height ?? 0).toBeGreaterThanOrEqual(44)

  await page.goto('/login')
  const inputs = page.locator('input:visible')
  for (let index = 0; index < await inputs.count(); index += 1) {
    const fontSize = await inputs.nth(index).evaluate((element) => Number.parseFloat(getComputedStyle(element).fontSize))
    expect(fontSize, `input ${index} font size`).toBeGreaterThanOrEqual(16)
  }
})

test('dialog traps focus, closes with Escape, and returns focus', async ({ page }) => {
  await page.goto('/')
  const trigger = page.locator('.header-profile')
  await trigger.click()
  await page.locator('.header-profile-dropdown__economy').click()
  const dialog = page.getByRole('dialog', { name: 'Билеты' })
  await expect(dialog).toBeVisible()
  await expect.poll(() => page.evaluate(() => document.activeElement?.closest('[role="dialog"]') !== null)).toBe(true)

  for (let index = 0; index < 8; index += 1) {
    await page.keyboard.press('Tab')
    expect(await page.evaluate(() => document.activeElement?.closest('[role="dialog"]') !== null)).toBe(true)
  }

  await page.keyboard.press('Escape')
  await expect(dialog).toBeHidden()
  await expect(trigger).toBeFocused()
})

test('login has stable visual layout', async ({ page }) => {
  await page.addInitScript(() => {
    window.localStorage.setItem('shoditsa:analytics-consent:v1', 'rejected')
  })
  await page.route('**/api/v1/meta', (route) => route.fulfill({
    contentType: 'application/json',
    body: JSON.stringify({
      serverTime: '2026-07-25T12:00:00.000Z',
      moscowDate: '2026-07-25',
      apiVersion: 'visual-test',
      rulesVersion: 1,
      activeRevision: null,
      modes: [],
      minimumFrontendVersion: '0.1.0',
      buildSha: 'visual-test',
      auth: { emailPassword: true, emailVerification: true, passwordReset: true, yandex: true },
      commerce: { enabled: false, provider: 'none', currency: 'RUB', archiveFirstDate: '2026-01-01', freeArchiveDays: 0 },
      features: { danetkiEnabled: true, danetkiMultiplayerEnabled: true },
    }),
  }))
  await page.route('**/api/v1/me', (route) => route.fulfill({
    contentType: 'application/json',
    body: JSON.stringify({
      user: { id: 'visual-guest', email: '', name: 'Гость', isAnonymous: true, role: 'player' },
      profile: { userId: 'visual-guest', role: 'player', displayName: null, locale: 'ru-RU', timezone: 'Europe/Moscow', legacyImportedAt: null },
      badges: [],
      auth: { hasPassword: false, providers: [] },
    }),
  }))
  await page.route('**/api/v1/me/dashboard', (route) => route.fulfill({
    contentType: 'application/json',
    body: JSON.stringify({}),
  }))
  await page.goto('/login')
  await expect(page.locator('.login-card')).toBeVisible()
  await expect(page.locator('.login-form input').first()).toBeVisible()
  await expect(page).toHaveScreenshot('login-responsive.png', {
    fullPage: true,
    animations: 'disabled',
    maxDiffPixelRatio: 0.01,
  })
})

test('friends room and profile controls keep their visual composition', async ({ page }, testInfo) => {
  test.skip(testInfo.project.name !== 'chromium', 'One deterministic browser owns the cross-screen visual baseline')
  await page.addInitScript(() => {
    window.localStorage.setItem('shoditsa:analytics-consent:v1', 'rejected')
  })

  const now = '2026-07-25T12:00:00.000Z'
  const room = {
    id: 'room-visual',
    code: 'SEANS7',
    gameType: 'quiz',
    danetkiSessionId: null,
    danetkiLaunchCost: 0,
    mode: 'movie',
    packs: [
      { mode: 'movie', variant: 'all' },
      { mode: 'series', variant: 'from_2020' },
    ],
    capacity: 8,
    roundsTotal: 6,
    shufflePacks: true,
    answerTimeSeconds: 30,
    phase: 'lobby',
    currentRound: 0,
    version: 1,
    currentUserId: 'visual-owner',
    isHost: true,
    serverTime: now,
    members: [
      { userId: 'visual-owner', role: 'owner', displayName: 'Полуночный сеанс', colorKey: 'player-1', score: 0, answered: false, joinedAt: now, leftAt: null, lastSeenAt: now },
      { userId: 'visual-friend', role: 'player', displayName: 'Тихий зритель', colorKey: 'player-2', score: 0, answered: false, joinedAt: now, leftAt: null, lastSeenAt: now },
    ],
    round: null,
    answers: [],
    messages: [],
  }
  const me = {
    user: { id: 'visual-owner', email: 'visual@example.test', name: 'Полуночный сеанс', role: 'user', isAnonymous: false },
    profile: {},
    badges: [],
    auth: { providers: ['credential'], hasPassword: true },
  }

  await page.route('**/api/v1/me', (route) => route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(me) }))
  await page.route('**/api/v1/friends/rooms', (route) => route.fulfill({
    status: 200,
    contentType: 'application/json',
    body: JSON.stringify(route.request().method() === 'GET' ? { rooms: [] } : { room }),
  }))
  await page.route('**/api/v1/friends/rooms/room-visual/snapshot', (route) => route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ room }) }))
  await page.route('**/api/v1/friends/rooms/room-visual/events', (route) => route.abort())

  await page.setViewportSize({ width: 1440, height: 1000 })
  await page.goto('/games/together?new=1')
  await expect(page.locator('.room-lobby')).toBeVisible()
  await expect(page.locator('.room-lobby')).toHaveScreenshot('friends-room-lobby-desktop.png', {
    animations: 'disabled',
    maxDiffPixelRatio: 0.01,
  })

  await page.setViewportSize({ width: 390, height: 844 })
  await page.addStyleTag({ content: '.mobile-app-nav { display: none !important; }' })
  await expect(page.locator('.room-lobby')).toHaveScreenshot('friends-room-lobby-mobile.png', {
    animations: 'disabled',
    maxDiffPixelRatio: 0.01,
  })

  await page.goto('/profile')
  await expect(page.locator('.profile-tabs')).toBeVisible()
  await expect(page.locator('.profile-tabs')).toHaveScreenshot('profile-tabs-mobile.png', {
    animations: 'disabled',
    maxDiffPixelRatio: 0.01,
  })
})

test('finished Danetki room keeps its visual composition', async ({ page }, testInfo) => {
  test.skip(testInfo.project.name !== 'chromium', 'One deterministic browser owns the cross-screen visual baseline')
  await page.addInitScript(() => {
    window.localStorage.setItem('shoditsa:analytics-consent:v1', 'rejected')
  })

  const now = '2026-07-25T12:00:00.000Z'
  const members = [
    { userId: 'visual-owner', role: 'owner', displayName: 'Полуночный сеанс', colorKey: 'player-1', score: 0, answered: false, joinedAt: now, leftAt: null, lastSeenAt: now },
    { userId: 'visual-friend', role: 'player', displayName: 'Тихий зритель', colorKey: 'player-2', score: 0, answered: false, joinedAt: now, leftAt: null, lastSeenAt: now },
  ]
  const room = {
    id: 'room-danetki-visual',
    code: 'CASE7',
    gameType: 'danetki',
    danetkiSessionId: 'session-danetki-visual',
    danetkiLaunchCost: 360,
    mode: 'series',
    packs: [{ mode: 'series', variant: 'all' }],
    capacity: 4,
    roundsTotal: 6,
    shufflePacks: false,
    answerTimeSeconds: 30,
    phase: 'finished',
    currentRound: 0,
    version: 4,
    currentUserId: 'visual-owner',
    isHost: true,
    serverTime: now,
    members,
    round: null,
    answers: [],
    messages: [{ id: 'chat-1', seq: 1, userId: 'visual-friend', displayName: 'Тихий зритель', colorKey: 'player-2', text: 'Вот это была развязка!', createdAt: now }],
  }
  const summary = {
    id: room.id,
    code: room.code,
    gameType: room.gameType,
    mode: room.mode,
    packs: room.packs,
    players: 2,
    capacity: 4,
    phase: 'finished',
    currentRound: 0,
    roundsTotal: 6,
    isHost: true,
    joinedAt: now,
    updatedAt: now,
  }
  const game = {
    id: room.danetkiSessionId,
    engine: 'danetki_chat',
    rulesVersion: 1,
    kind: 'free_play',
    packId: null,
    packPosition: null,
    mode: 'danetki',
    variantKey: null,
    period: 'all',
    difficulty: null,
    puzzleDate: '2026-07-25',
    status: 'won',
    attemptsCount: 0,
    attemptsRemaining: 0,
    attempts: [],
    hintCheckpoints: [],
    hintChoices: [],
    hintOptions: [],
    progressiveHints: [],
    promoPrompt: null,
    diagnosisVignette: null,
    serverTime: now,
    danetki: {
      puzzle: {
        id: 'danetka-007',
        titleRu: 'Последний пассажир',
        condition: 'Человек вошёл в пустой вагон, улыбнулся незнакомцу и понял, что поезд уже приехал.',
        difficulty: 'medium',
        genres: ['детектив'],
        starterQuestions: [],
        contentWarnings: [],
      },
      roomMode: 'group',
      startedAt: now,
      currentTurnUserId: 'visual-friend',
      capacity: 4,
      questionCount: 7,
      questionWarningAt: 50,
      questionLimit: 60,
      questionsRemaining: 53,
      hintLevel: 1,
      aiStatus: 'idle',
      members,
      messages: [
        { id: 'guess-1', seq: 1, senderKind: 'user', senderUserId: 'visual-friend', senderName: 'Тихий зритель', senderColorKey: 'player-2', messageType: 'guess', text: 'Поезд был частью музейной инсталляции, а незнакомец — смотрителем.', classification: null, importance: null, parentMessageId: null, createdAt: now },
      ],
      currentUserId: 'visual-owner',
      canStart: false,
      canInvite: false,
      lastSeq: 1,
      outcome: 'won',
      solution: 'Вагон стоял в железнодорожном музее. Герой участвовал в иммерсивной экскурсии, а незнакомец был смотрителем, который объявил прибытие вымышленного поезда.',
    },
  }
  const me = {
    user: { id: 'visual-owner', email: 'visual@example.test', name: 'Полуночный сеанс', role: 'user', isAnonymous: false },
    profile: {},
    badges: [],
    auth: { providers: ['credential'], hasPassword: true },
  }

  await page.route('**/api/v1/me', (route) => route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(me) }))
  await page.route('**/api/v1/friends/rooms', (route) => route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ rooms: [summary] }) }))
  await page.route('**/api/v1/friends/rooms/room-danetki-visual/snapshot', (route) => route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ room }) }))
  await page.route('**/api/v1/friends/rooms/room-danetki-visual/events', (route) => route.abort())
  await page.route('**/api/v1/games/session-danetki-visual', (route) => route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ session: game }) }))
  await page.route('**/api/v1/danetki/sessions/session-danetki-visual/events', (route) => route.abort())

  await page.setViewportSize({ width: 1440, height: 1000 })
  await page.goto('/games/together?room=CASE7')
  await expect(page.locator('.room-projector__outcome')).toBeVisible()
  await expect(page.locator('.friends-room__columns--danetki')).toHaveScreenshot('friends-room-danetki-finished-desktop.png', {
    animations: 'disabled',
    maxDiffPixelRatio: 0.01,
  })

  await page.setViewportSize({ width: 390, height: 844 })
  await page.addStyleTag({ content: '.mobile-app-nav { display: none !important; }' })
  await expect(page.locator('.friends-room__columns--danetki')).toHaveScreenshot('friends-room-danetki-finished-mobile.png', {
    animations: 'disabled',
    maxDiffPixelRatio: 0.01,
  })
})

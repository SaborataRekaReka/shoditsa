import { lazy, Suspense, useEffect, useLayoutEffect } from 'react'
import {
  Outlet,
  DefaultGlobalNotFound,
  createHashHistory,
  createRootRouteWithContext,
  createRoute,
  createRouter,
  useRouter,
  useRouterState,
} from '@tanstack/react-router'
import { isCatalogGuessModeId } from '@shoditsa/contracts'
import { useQueryClient, type QueryClient } from '@tanstack/react-query'
import { api, queryKeys } from '../api/client'
import { SERVER_RUNTIME } from '../hooks/use-server-runtime'
import { AlertTriangle, LoaderCircle } from 'lucide-react'
import { applyRuntimeSeo } from './seo'
import { CookieConsentBanner } from '../features/legal/CookieConsentBanner'
import { applyApplicationPresentation, applyPublicPresentation, CONNECTED_PRESENTATION, isReferencePresentationPath, REFERENCE_PRESENTATION } from './local-presentation'
import { ConnectedPreviewNotice } from '../components/app-shell/ConnectedPreviewNotice'
import { PublicNotFoundScreen } from '../features/not-found/PublicNotFoundScreen'
import { APPLICATION_DESIGN } from './application-design'
import { ApplicationFrame } from '../features/application/ApplicationFrame'
import { RoutePending } from './RoutePending'
import { preloadableScreen } from './preloadable-screen'
import { applicationSection, isApplicationShellPage, type ApplicationLocation } from '../features/application/routes'
import { applicationLink, installApplicationNavigator } from './application-navigation'
import { PlayerLocation } from './PlayerLocation'
import { useStudyTheme } from '../dev/quest-game/StudyTheme'
import { AppErrorBoundary } from '../components/app-shell/AppErrorBoundary'
import '../dev/quest-game/study-navigation.css'
import { isSvoyakPath } from '../features/rooms/room-navigation'
import { SVOYAK_ENABLED } from '../features/svoyak/SvoyakHomeCard'
import { ANALYTICS_CONSENT_EVENT } from './metrics'
import { refreshNavigationConsent, trackNavigationAction, trackNavigationView } from './navigation-analytics'
import { runViewTransition } from './view-transition'

const App = preloadableScreen(() => import('../App'))
const StudyApp = preloadableScreen(() => import('../dev/quest-game/StudyApp'))
const RoomLobbyPage = preloadableScreen(() => import('../features/rooms/RoomLobbyPage'))
const SvoyakPage = preloadableScreen<{ pathname: string; onNavigate: (href: string, replace?: boolean) => Promise<void> }>(() => import('../features/svoyak/SvoyakPage').then(module => ({ default: module.SvoyakPage })))
function PageFailure({ error }: { error: Error }): never { throw error }

function NavigationProgress() {
  const pending = useRouterState({ select: state => state.isLoading })
  return pending ? <div className="study-navigation-progress" role="status" aria-label="Открываем игру"><span /></div> : null
}

async function preparePlayerPage(location: ApplicationLocation, queryClient?: QueryClient | null) {
  if (APPLICATION_DESIGN && location.pathname === '/lobby') { await RoomLobbyPage.preload(); return location }
  if (APPLICATION_DESIGN && SVOYAK_ENABLED && isSvoyakPath(location.pathname)) { await SvoyakPage.preload(); return location }
  if (APPLICATION_DESIGN && isApplicationShellPage(location, SERVER_RUNTIME)) {
    await StudyApp.preload()
    await (await import('../dev/quest-game/StudyApp')).prepareSection(applicationSection(location.pathname) ?? 'title')
  } else {
    await App.preload()
    if (APPLICATION_DESIGN && /^\/(?:play|sessions)\//.test(location.pathname)) {
      await (await import('../components/game-shell/GamePageFrame')).prepareGamePageFrame()
      const mode = location.pathname.match(/^\/play\/([^/]+)$/)?.[1]
      if (!SERVER_RUNTIME && mode && isCatalogGuessModeId(mode)) {
        // Dataset failures are rendered by the game's existing retry screen.
        await (await import('../hooks/use-data-loader')).prepareLocalGameData(mode).catch(() => {})
      }
      const sessionId = location.pathname.match(/^\/sessions\/([^/]+)$/)?.[1]
      if (SERVER_RUNTIME && sessionId && queryClient) {
        await queryClient.prefetchQuery({ queryKey: queryKeys.game(sessionId), queryFn: () => api.game(sessionId), staleTime: 10_000, retry: false })
      }
    }
  }
  return location
}

const AdminApp = import.meta.env.MODE === 'yandex' ? null : lazy(() => import('../admin/AdminApp'))
const UiKitScreen = lazy(() => import('../features/ui-kit/UiKitScreen'))
const LoginScreen = lazy(() => import('../features/auth/LoginScreen').then((module) => ({ default: module.LoginScreen })))
const ApplicationAuthPage = lazy(() => import('../features/auth/ApplicationAuthPage').then(module => ({ default: module.ApplicationAuthPage })))

const RootView = () => {
  useStudyTheme(APPLICATION_DESIGN)
  const router = useRouter()
  const queryClient = useQueryClient()
  const pathname = useRouterState({ select: state => state.matches.at(-1)?.pathname ?? state.location.pathname })
  const resolvedLocation = useRouterState({ select: state => state.status === 'idle' ? state.resolvedLocation : undefined })
  useLayoutEffect(() => {
    applyPublicPresentation(pathname)
    if (APPLICATION_DESIGN && isApplicationShellPage({ pathname, search: window.location.search, hash: window.location.hash }, SERVER_RUNTIME)) applyApplicationPresentation()
  }, [pathname])
  useEffect(() => applyRuntimeSeo(pathname), [pathname])
  useEffect(() => {
    if (resolvedLocation) trackNavigationView({ pathname: resolvedLocation.pathname, search: resolvedLocation.searchStr })
  }, [resolvedLocation])
  useEffect(() => {
    window.addEventListener(ANALYTICS_CONSENT_EVENT, refreshNavigationConsent)
    return () => window.removeEventListener(ANALYTICS_CONSENT_EVENT, refreshNavigationConsent)
  }, [])
  useEffect(() => {
    if (!APPLICATION_DESIGN) return
    const uninstall = installApplicationNavigator((href, replace) => {
      // A mode choice updates this workspace without scrolling away from its form.
      const lobbyFilter = window.location.pathname === '/lobby' && new URL(href, window.location.origin).pathname === '/lobby'
      return router.navigate({ href, replace, ...(lobbyFilter ? { resetScroll: false, viewTransition: false } : {}) })
    })
    const linkTarget = (event: Event) => {
      const link = event.target instanceof Element ? event.target.closest<HTMLAnchorElement>('a[href]') : null
      if (!link || link.hasAttribute('download') || link.rel.includes('external') || (link.target && link.target !== '_self')) return undefined
      return applicationLink(link.href, window.location.origin)
    }
    const follow = (event: MouseEvent) => {
      if (event.defaultPrevented || event.button !== 0 || event.ctrlKey || event.metaKey || event.shiftKey || event.altKey) return
      const href = linkTarget(event)
      if (!href) return
      event.preventDefault()
      trackNavigationAction(href, 'application_link')
      void router.navigate({ href })
    }
    const warm = (event: Event) => {
      const href = linkTarget(event)
      if (!href) return
      const url = new URL(href, window.location.origin)
      void preparePlayerPage(url, queryClient).catch(() => {})
    }
    const resolved = router.subscribe('onResolved', () => {
      document.documentElement.dataset.studyTransition = 'same-document'
      // Do not move focus away from a search field during an internal session update.
      if (document.activeElement === document.body) {
        const main = document.querySelector<HTMLElement>('main')
        if (main) { main.setAttribute('tabindex', '-1'); main.focus({ preventScroll: true }) }
      }
    })
    document.addEventListener('click', follow)
    document.addEventListener('pointerover', warm)
    document.addEventListener('focusin', warm)
    return () => { uninstall(); resolved(); document.removeEventListener('click', follow); document.removeEventListener('pointerover', warm); document.removeEventListener('focusin', warm) }
  }, [router, queryClient])
  useEffect(() => {
    if (!APPLICATION_DESIGN) return
    const mode = pathname.match(/^\/games\/([^/]+)$/)?.[1]
    if (!mode || !isCatalogGuessModeId(mode)) return
    // Opening a title is intent to play. Prepare the controller without starting a session.
    const timer = window.setTimeout(() => { void preparePlayerPage({ pathname: `/play/${mode}`, search: '', hash: '' }).catch(() => {}) }, 200)
    return () => window.clearTimeout(timer)
  }, [pathname])
  return <>{CONNECTED_PRESENTATION && <ConnectedPreviewNotice />}{APPLICATION_DESIGN && <NavigationProgress />}<Outlet /><CookieConsentBanner /></>
}
const PlayerLayout = () => {
  const router = useRouter()
  const location = useRouterState({ select: state => state.matches.at(-1)?.loaderData as ApplicationLocation | undefined })
  const pathname = location?.pathname ?? '/'
  const referenceNotFound = useRouterState({
    select: (state) => isReferencePresentationPath(state.location.pathname)
      && (state.matches.some((match) => match.globalNotFound)
        || router.matchRoutes(state.location.pathname).some((match) => match.globalNotFound)),
  })
  // During history navigation location changes before matches commit. Do not let
  // the app canonicalise that pending 404 to its home-screen fallback.
  if (referenceNotFound) return <Outlet />
  if (!location) return <RoutePending />
  if (APPLICATION_DESIGN && (pathname === '/lobby' || pathname === '/games/together' && !new URLSearchParams(location.search).get('room'))) return <PlayerLocation.Provider value={location}><RoomLobbyPage /></PlayerLocation.Provider>
  if (APPLICATION_DESIGN && SVOYAK_ENABLED && isSvoyakPath(pathname)) return <SvoyakPage pathname={pathname} onNavigate={(href, replace) => router.navigate({ href, replace })} />
  if (APPLICATION_DESIGN && isApplicationShellPage(location, SERVER_RUNTIME)) return <StudyApp key={pathname + location.search} routed />
  const roomCode = pathname === '/games/together' ? new URLSearchParams(location.search).get('room') : null
  const content = <><App key={APPLICATION_DESIGN && roomCode ? `room:${roomCode}` : APPLICATION_DESIGN && !SERVER_RUNTIME ? pathname + location.search : 'player'} /><Outlet /></>
  const page = APPLICATION_DESIGN && !/^\/(?:play|sessions)\//.test(pathname)
    ? <ApplicationFrame pathname={pathname}>{content}</ApplicationFrame>
    : content
  return <PlayerLocation.Provider value={location}>{page}</PlayerLocation.Provider>
}
const RouteMarker = () => null
const LoginRoute = ({ mode }: { mode: 'login' | 'register' }) => <Suspense fallback={APPLICATION_DESIGN ? <RoutePending /> : <main className="loading"><LoaderCircle /> Загружаем вход…</main>}>{APPLICATION_DESIGN ? <ApplicationAuthPage mode={mode} /> : <LoginScreen mode={mode} />}</Suspense>
const AdminRoute = () => {
  if (!AdminApp) return <main className="loading loading--error" role="alert"><AlertTriangle /><h1>Раздел недоступен</h1><p>Административная панель не включается в сборку Яндекс Игр.</p><a href="#/">Вернуться в игру</a></main>
  return <Suspense fallback={<main className="loading"><LoaderCircle /> Загружаем административную панель…</main>}><AdminApp /></Suspense>
}
const UiKitRoute = () => <Suspense fallback={APPLICATION_DESIGN ? <RoutePending /> : <main className="loading"><LoaderCircle /> Загружаем UI-кит…</main>}><UiKitScreen /></Suspense>
const PublicNotFoundRoute = () => {
  const pathname = useRouterState({ select: (state) => state.location.pathname })
  return isReferencePresentationPath(pathname) ? <PublicNotFoundScreen /> : <DefaultGlobalNotFound />
}

const rootRoute = createRootRouteWithContext<{ queryClient: QueryClient | null }>()({ component: RootView, validateSearch: (search: Record<string, unknown>) => search })
const playerLayoutRoute = createRoute({ getParentRoute: () => rootRoute, id: 'player', component: PlayerLayout })

function playerRoute<const Path extends string>(path: Path) {
  return createRoute({
    getParentRoute: () => playerLayoutRoute, path, component: RouteMarker,
    loaderDeps: ({ search }) => search,
    loader: ({ location, context }) => preparePlayerPage({ pathname: location.pathname, search: location.searchStr, hash: location.hash }, context.queryClient),
  })
}

const playerRoutes = [
  playerRoute('/'),
  createRoute({ getParentRoute: () => playerLayoutRoute, path: 'games/$mode', component: RouteMarker,
    loaderDeps: ({ search }) => search,
    loader: ({ location, context }) => preparePlayerPage({ pathname: location.pathname, search: location.searchStr, hash: location.hash }, context.queryClient),
  }),
  playerRoute('games/together'),
  playerRoute('lobby'),
  playerRoute('games/svoyak'),
  playerRoute('svoyak/create'),
  playerRoute('svoyak/join/$code'),
  playerRoute('svoyak/rooms/$code'),
  playerRoute('svoyak/rooms/$code/result'),
  playerRoute('danetki'),
  playerRoute('danetki/$slug'),
  playerRoute('play/$mode'),
  createRoute({ getParentRoute: () => playerLayoutRoute, path: 'sessions/$sessionId', component: RouteMarker,
    loaderDeps: ({ search }) => search,
    loader: ({ location, context }) => preparePlayerPage({ pathname: location.pathname, search: location.searchStr, hash: location.hash }, context.queryClient),
  }),
  playerRoute('danetki/join/$token'),
  playerRoute('archive'),
  playerRoute('profile'),
  playerRoute('quests'),
  playerRoute('settings'),
  playerRoute('club/membership'),
  playerRoute('leaderboard'),
  playerRoute('support'),
  playerRoute('blog'),
  playerRoute('blog/$slug'),
  playerRoute('club'),
  playerRoute('specials'),
  playerRoute('specials/$packId'),
  playerRoute('partners'),
  playerRoute('create-a-game'),
  playerRoute('purchase/return'),
  playerRoute('review/music'),
  playerRoute('legal/$document'),
]

const loginRoute = createRoute({ getParentRoute: () => rootRoute, path: 'login', component: () => <LoginRoute mode="login" /> })
const registerRoute = createRoute({ getParentRoute: () => rootRoute, path: 'register', component: () => <LoginRoute mode="register" /> })
const adminRoute = createRoute({ getParentRoute: () => rootRoute, path: 'admin/$', component: AdminRoute })
const uiKitRoute = createRoute({ getParentRoute: () => rootRoute, path: 'ui-kit', component: UiKitRoute })

const routeTree = rootRoute.addChildren([
  playerLayoutRoute.addChildren(playerRoutes),
  loginRoute,
  registerRoute,
  adminRoute,
  uiKitRoute,
])

export const appRouter = createRouter({
  routeTree,
  context: { queryClient: null },
  history: SERVER_RUNTIME || APPLICATION_DESIGN ? undefined : createHashHistory(),
  defaultPreload: 'intent',
  defaultPendingComponent: APPLICATION_DESIGN ? RoutePending : undefined,
  defaultErrorComponent: APPLICATION_DESIGN ? ({ error }) => <AppErrorBoundary><PageFailure error={error} /></AppErrorBoundary> : undefined,
  defaultPendingMs: APPLICATION_DESIGN ? Infinity : 1000,
  defaultPendingMinMs: 0,
  scrollRestoration: APPLICATION_DESIGN,
  defaultViewTransition: APPLICATION_DESIGN,
  defaultNotFoundComponent: REFERENCE_PRESENTATION ? PublicNotFoundRoute : undefined,
})

if (APPLICATION_DESIGN) {
  // This router version discards the native transition's promises. Keep its commit timing and
  // per-navigation opt-out, but own all three promises so skipped animations cannot reject globally.
  appRouter.startViewTransition = (update) => {
    const animate = appRouter.shouldViewTransition ?? appRouter.options.defaultViewTransition
    appRouter.shouldViewTransition = undefined
    runViewTransition(update, Boolean(animate))
  }
}

declare module '@tanstack/react-router' {
  interface Register {
    router: typeof appRouter
  }
}

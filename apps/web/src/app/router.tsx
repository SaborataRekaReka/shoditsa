import { lazy, Suspense, useEffect } from 'react'
import {
  Outlet,
  createHashHistory,
  createRootRoute,
  createRoute,
  createRouter,
  useRouterState,
} from '@tanstack/react-router'
import App from '../App'
import { LoginScreen } from '../features/auth/LoginScreen'
import { SERVER_RUNTIME } from '../hooks/use-server-runtime'
import { AlertTriangle, Sparkles } from 'lucide-react'
import { applyRuntimeSeo } from './seo'

const AdminApp = import.meta.env.MODE === 'yandex' ? null : lazy(() => import('../admin/AdminApp'))

const RootView = () => {
  const pathname = useRouterState({ select: (state) => state.location.pathname })
  useEffect(() => applyRuntimeSeo(pathname), [pathname])
  return <Outlet />
}
const PlayerLayout = () => <><App /><Outlet /></>
const RouteMarker = () => null
const LoginRoute = ({ mode }: { mode: 'login' | 'register' }) => <LoginScreen mode={mode} />
const AdminRoute = () => {
  if (!AdminApp) return <main className="loading loading--error" role="alert"><AlertTriangle /><h1>Раздел недоступен</h1><p>Административная панель не включается в сборку Яндекс Игр.</p><a href="#/">Вернуться в игру</a></main>
  return <Suspense fallback={<main className="loading"><Sparkles /> Загружаем административную панель…</main>}><AdminApp /></Suspense>
}

const rootRoute = createRootRoute({ component: RootView })
const playerLayoutRoute = createRoute({ getParentRoute: () => rootRoute, id: 'player', component: PlayerLayout })

const playerRoutes = [
  createRoute({ getParentRoute: () => playerLayoutRoute, path: '/', component: RouteMarker }),
  createRoute({ getParentRoute: () => playerLayoutRoute, path: 'games/$mode', component: RouteMarker }),
  createRoute({ getParentRoute: () => playerLayoutRoute, path: 'play/$mode', component: RouteMarker }),
  createRoute({ getParentRoute: () => playerLayoutRoute, path: 'sessions/$sessionId', component: RouteMarker }),
  createRoute({ getParentRoute: () => playerLayoutRoute, path: 'archive', component: RouteMarker }),
  createRoute({ getParentRoute: () => playerLayoutRoute, path: 'profile', component: RouteMarker }),
  createRoute({ getParentRoute: () => playerLayoutRoute, path: 'review/music', component: RouteMarker }),
]

const loginRoute = createRoute({ getParentRoute: () => rootRoute, path: 'login', component: () => <LoginRoute mode="login" /> })
const registerRoute = createRoute({ getParentRoute: () => rootRoute, path: 'register', component: () => <LoginRoute mode="register" /> })
const adminIndexRoute = createRoute({ getParentRoute: () => rootRoute, path: 'admin', component: AdminRoute })
const adminCatchAllRoute = createRoute({ getParentRoute: () => rootRoute, path: 'admin/$', component: AdminRoute })

const routeTree = rootRoute.addChildren([
  playerLayoutRoute.addChildren(playerRoutes),
  loginRoute,
  registerRoute,
  adminIndexRoute,
  adminCatchAllRoute,
])

export const appRouter = createRouter({
  routeTree,
  history: SERVER_RUNTIME ? undefined : createHashHistory(),
  defaultPreload: 'intent',
})

declare module '@tanstack/react-router' {
  interface Register {
    router: typeof appRouter
  }
}

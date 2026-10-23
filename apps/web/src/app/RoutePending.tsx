import { useSyncExternalStore } from 'react'
import { BrandLoader } from '../components/app-shell/BrandLoader'
import { isRouteLoading, subscribeRouteLoading } from './route-loading'

/** Shared scene for suspended pages and asynchronous section navigation. */
export function RoutePending() {
  return <div data-page-pending><BrandLoader /></div>
}

export function RouteLoadingOverlay() {
  return useSyncExternalStore(subscribeRouteLoading, isRouteLoading, () => false) ? <RoutePending /> : null
}

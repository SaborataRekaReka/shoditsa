import type { DashboardResponse, MeCommerceResponse } from '@shoditsa/contracts'
import { queryKeys } from '../../api/client'
import { useStudyAccountCache } from './study-account-cache'

/** Account-wide membership, including screens that do not load commerce themselves. */
export function useStudyClubActive(fallback = false) {
  const commerce = useStudyAccountCache<MeCommerceResponse>(queryKeys.commerce)
  const dashboard = useStudyAccountCache<DashboardResponse>(queryKeys.dashboard)
  return (commerce?.membership ?? dashboard?.membership)?.active ?? fallback
}

import type { ReactNode } from 'react'
import { useQuery } from '@tanstack/react-query'
import { api, ApiClientError, queryKeys } from '../../api/client'
import { SERVER_RUNTIME } from '../../hooks/use-server-runtime'
import { InlineAlert } from '../../components/ui'
import { QuestButton } from '../../components/ui/QuestPrimitives'
import { ClubAccessPanel } from '../../components/club-access-panel/ClubAccessPanel'
import { navigateApplication } from '../../app/application-navigation'
import { STUDY_CLUB_OFFER_HREF } from '../../dev/quest-game/account-routing'

export function useRoomCreationAccess() {
  const query = useQuery({ queryKey: queryKeys.commerce, queryFn: api.meCommerce, enabled: SERVER_RUNTIME, retry: (count, error) => !(error instanceof ApiClientError && error.status === 401) && count < 1 })
  const status = !SERVER_RUNTIME ? 'ready' : query.isPending ? 'loading' : query.error instanceof ApiClientError && query.error.status === 401 ? 'auth-required' : query.isError ? 'error' : 'ready'
  return { status, allowed: SERVER_RUNTIME && query.isSuccess && query.data.membership.active, retry: () => { void query.refetch() } }
}

export function RoomCreationGate({ children }: { children: ReactNode }) {
  const access = useRoomCreationAccess()
  if (access.status === 'loading') return <p role="status">Проверяем клубный билет…</p>
  if (access.status === 'auth-required') return <ClubAccessPanel title="Войди, чтобы собрать компанию" description="После входа проверим твой клубный билет. Друзья присоединяются по приглашению бесплатно." primaryLabel="Войти" onPrimary={() => { void navigateApplication('/login?returnUrl=%2Flobby') }} />
  if (access.status === 'error') return <InlineAlert tone="warning">Не удалось проверить клубный билет.<QuestButton kind="text" onClick={access.retry}>Повторить</QuestButton></InlineAlert>
  if (!access.allowed) return <ClubAccessPanel title="Собери компанию с Клубом" description="Клубный билет нужен только создателю комнаты. Друзья присоединяются по приглашению бесплатно." primaryLabel="Выбрать клубный билет" onPrimary={() => { void navigateApplication(STUDY_CLUB_OFFER_HREF) }} />
  return children
}

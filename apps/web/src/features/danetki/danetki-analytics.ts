import type { GameSessionSnapshot } from '@shoditsa/contracts'

type SessionStatus = GameSessionSnapshot['status']

export const isFreshDanetkiCompletion = (previous: SessionStatus, current: SessionStatus) => (
  previous === 'playing' && current !== 'playing'
)

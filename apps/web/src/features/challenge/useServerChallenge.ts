import { useEffect } from 'react'
import { observeServerChallengeCompletion } from './challenge-analytics'
import { readServerChallenge, serverChallengeComparison, type ChallengeSession } from './server-challenge'

/** Place before loading/error returns in ServerGame, so hook order stays stable. */
export const useServerChallenge = (session: ChallengeSession | undefined) => {
  const context = session ? readServerChallenge(session) : null
  useEffect(() => {
    if (session && context) observeServerChallengeCompletion(session, context)
  }, [session?.id, session?.status, session?.completionType, session?.attemptsCount, context?.joinedWhilePlaying])
  return session ? serverChallengeComparison(session, context) : null
}

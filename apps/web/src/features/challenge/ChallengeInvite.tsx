import { Swords } from 'lucide-react'
import type { ChallengePayload } from './challenge'

export function ChallengeInvite({ challenge, onAccept, onDismiss }: { challenge: ChallengePayload; onAccept: () => void; onDismiss: () => void }) {
  return <div className="challenge-invite-backdrop" role="presentation">
    <section className="challenge-invite" role="dialog" aria-modal="true" aria-labelledby="challenge-invite-title">
      <Swords aria-hidden="true" />
      <span>Вам бросили вызов</span>
      <h2 id="challenge-invite-title">Друг угадал с {challenge.opponentAttempts}-й попытки.</h2>
      <p>Сможете быстрее?</p>
      <button type="button" className="challenge-invite__accept" onClick={onAccept}>Принять вызов</button>
      <button type="button" className="challenge-invite__dismiss" onClick={onDismiss}>Не сейчас</button>
    </section>
  </div>
}

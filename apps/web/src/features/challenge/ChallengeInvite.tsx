import { Swords } from 'lucide-react'
import { ControlButton, DialogSurface } from '../../components/ui'
import type { ChallengePayload } from './challenge'
import './ChallengeInvite.css'

export function ChallengeInvite({ challenge, onAccept, onDismiss }: { challenge: ChallengePayload; onAccept: () => void; onDismiss: () => void }) {
  return <DialogSurface backdropClassName="challenge-invite-backdrop" className="challenge-invite" onClose={onDismiss} ariaLabelledBy="challenge-invite-title" closeOnBackdrop={false}>
      <Swords aria-hidden="true" />
      <span>Вам бросили вызов</span>
      <h2 id="challenge-invite-title">Друг угадал с {challenge.opponentAttempts}-й попытки.</h2>
      <p>Сможете быстрее?</p>
      <ControlButton className="challenge-invite__accept" onClick={onAccept}>Принять вызов</ControlButton>
      <ControlButton className="challenge-invite__dismiss" onClick={onDismiss}>Не сейчас</ControlButton>
  </DialogSurface>
}

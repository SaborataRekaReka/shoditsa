import { Swords } from 'lucide-react'
import { ControlButton, DialogSurface } from '../../components/ui'
import { challengeResultLabel, type ChallengePayload } from './challenge'
import './ChallengeInvite.css'

export function ChallengeInvite({ challenge, onAccept, onDismiss, isPending = false, errorMessage }: { challenge: ChallengePayload; onAccept: () => void; onDismiss: () => void; isPending?: boolean; errorMessage?: string }) {
  return <DialogSurface backdropClassName="challenge-invite-backdrop" className="challenge-invite" onClose={onDismiss} ariaLabelledBy="challenge-invite-title" closeOnBackdrop={false}>
      <Swords aria-hidden="true" />
      <span>Вам бросили вызов</span>
      <h2 id="challenge-invite-title">Результат друга — {challengeResultLabel(challenge.opponentAttempts)}.</h2>
      <p>Задача от {challenge.date.split('-').reverse().join('.')}. Попробуйте справиться за меньшее число попыток.</p>
      <p className="challenge-invite__note">Откроется ваша игра. Если вы уже прошли эту задачу, сравним готовый результат.</p>
      {errorMessage && <p className="challenge-invite__error" role="alert">{errorMessage}</p>}
      <ControlButton className="challenge-invite__accept" onClick={onAccept} disabled={isPending}>{isPending ? 'Открываем вашу игру…' : 'Принять вызов'}</ControlButton>
      <ControlButton className="challenge-invite__dismiss" onClick={onDismiss} disabled={isPending}>Не сейчас</ControlButton>
  </DialogSurface>
}

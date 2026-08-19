import { useEffect, useRef } from 'react'
import { CheckCircle2, Save } from 'lucide-react'
import { trackClientEvent } from '../../app/client-events'
import { trackMetrikaGoal } from '../../app/metrics'
import { useAuthSession } from '../auth/use-auth-session'
import {
  currentDanetkiReturnUrl,
  danetkiRegistrationHref,
  readDanetkiTrafficContext,
  rememberDanetkiRegistrationIntent,
  type DanetkiRegistrationPlacement,
} from './danetki-registration-attribution'
import './DanetkiRegistrationOffer.css'

type Props = {
  placement: DanetkiRegistrationPlacement
  sessionId?: string
  questionCount?: number
  story?: string
}

const COPY: Record<DanetkiRegistrationPlacement, { title: string; description: string; action: string }> = {
  investigation: {
    title: 'Не потеряйте расследование',
    description: 'После регистрации вы вернётесь в это дело, а прогресс останется в профиле.',
    action: 'Создать аккаунт',
  },
  result: {
    title: 'Сохраните закрытое дело',
    description: 'Аккаунт сохранит результат, серию дней и статистику на любом устройстве.',
    action: 'Сохранить в аккаунте',
  },
  catalog: {
    title: 'Соберите историю побед',
    description: 'Профиль сохранит результаты, серию дней и открытые игры. Играть можно и без регистрации.',
    action: 'Создать аккаунт',
  },
}

export function DanetkiRegistrationOffer({ placement, sessionId, questionCount = 0, story }: Props) {
  const { session: authSession, loading } = useAuthSession()
  const viewTracked = useRef(false)
  const guest = !authSession || authSession.isAnonymous
  const returnUrl = currentDanetkiReturnUrl()
  const href = danetkiRegistrationHref(placement, returnUrl, story)
  const traffic = readDanetkiTrafficContext()
  const copy = COPY[placement]
  const trackingContext = sessionId ? { gameSessionId: sessionId } : undefined

  useEffect(() => {
    if (loading || !guest || viewTracked.current) return
    viewTracked.current = true
    const payload = {
      placement,
      mode: 'danetki',
      questionCount,
      story: story ?? null,
      entrySource: traffic?.entrySource ?? null,
      collection: traffic?.collection ?? null,
    }
    trackClientEvent('danetki_registration_offer_view', payload, trackingContext)
    trackMetrikaGoal('danetki_registration_offer_view', payload)
  }, [guest, loading, placement, questionCount, story, traffic?.collection, traffic?.entrySource, trackingContext])

  if (loading) return null
  if (!guest) return placement === 'result'
    ? <section className="danetki-registration-offer is-saved" aria-label="Прогресс сохранён">
        <span><CheckCircle2 aria-hidden="true" /></span>
        <div><strong>Расследование сохранено</strong><p>Результат, серия дней и статистика доступны в вашем профиле.</p></div>
      </section>
    : null

  const click = () => {
    rememberDanetkiRegistrationIntent(placement, returnUrl, story)
    const payload = {
      placement,
      mode: 'danetki',
      questionCount,
      returnUrl,
      story: story ?? null,
      entrySource: traffic?.entrySource ?? null,
      collection: traffic?.collection ?? null,
    }
    trackClientEvent('danetki_registration_offer_clicked', payload, trackingContext)
    trackMetrikaGoal('danetki_registration_offer_clicked', payload)
  }

  return <section className={`danetki-registration-offer danetki-registration-offer--${placement}`} aria-label="Сохранить прогресс">
    <span><Save aria-hidden="true" /></span>
    <div><strong>{copy.title}</strong><p>{copy.description}</p></div>
    <a href={href} onClick={click}>{copy.action}</a>
  </section>
}

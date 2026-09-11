import { CheckCircle2, Save } from 'lucide-react'
import { deterministicClientEventId, trackClientEvent } from '../../app/client-events'
import { trackMetrikaGoal } from '../../app/metrics'
import { offerObservationScope, useVisibleImpression } from '../../app/visible-impression'
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
  const guest = !authSession || authSession.isAnonymous
  const returnUrl = currentDanetkiReturnUrl()
  const href = danetkiRegistrationHref(placement, returnUrl, story)
  const traffic = readDanetkiTrafficContext()
  const copy = COPY[placement]
  const trackingContext = sessionId ? { gameSessionId: sessionId } : undefined
  const scope = offerObservationScope(`danetki-registration:${placement}`, sessionId, returnUrl.split(/[?#]/)[0])
  const viewId = deterministicClientEventId(scope, 'danetki_registration_offer_view')
  const offerRef = useVisibleImpression(!loading && guest ? viewId : null, () => {
    const payload = {
      placement,
      mode: 'danetki',
      questionCount,
      story: story ?? null,
      entrySource: traffic?.entrySource ?? null,
      collection: traffic?.collection ?? null,
      measurement_version: 'visible-v2',
    }
    trackClientEvent('danetki_registration_offer_view', payload, { ...trackingContext, eventId: viewId })
    trackMetrikaGoal('danetki_registration_offer_view', payload)
  })

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
      measurement_version: 'visible-v2',
    }
    trackClientEvent('danetki_registration_offer_clicked', payload, {
      ...trackingContext,
      eventId: deterministicClientEventId(scope, 'danetki_registration_offer_clicked'),
    })
    trackMetrikaGoal('danetki_registration_offer_clicked', payload)
  }

  return <section ref={offerRef} className={`danetki-registration-offer danetki-registration-offer--${placement}`} aria-label="Сохранить прогресс">
    <span><Save aria-hidden="true" /></span>
    <div><strong>{copy.title}</strong><p>{copy.description}</p></div>
    <a href={href} onClick={click}>{copy.action}</a>
  </section>
}

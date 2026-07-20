import { useEffect, useState } from 'react'
import { useQuery } from '@tanstack/react-query'
import { Archive, Clapperboard, Heart, LockKeyhole, Sparkles, Ticket } from 'lucide-react'
import { ActionButton, AppHeader } from '../../components/app-shell/AppShell'
import { trackClientEvent } from '../../app/client-events'
import { trackMetrikaGoal } from '../../app/metrics'
import {
  SERVER_RUNTIME,
  useServerRuntime,
} from '../../hooks/use-server-runtime'
import { ClubCard, type ClubOffer } from './ClubCard'
import { CheckoutButton } from './CheckoutButton'
import { TipCheckoutTrigger } from './TipCheckout'
import { api, queryKeys } from '../../api/client'
import './CommercialShell.css'

const fallbackOffers: ClubOffer[] = [
  {
    id: 'club_30d',
    title: 'Клубный билет',
    durationLabel: '30 дней',
    note: 'Архив, свободная игра и клубные спецпоказы на 30 дней.',
    priceLabel: '199 ₽',
    unitLabel: '6,63 ₽ в день',
  },
  {
    id: 'club_365d',
    title: 'Годовой клубный билет',
    durationLabel: '365 дней',
    note: 'Архив, свободная игра и клубные спецпоказы на весь год.',
    priceLabel: '1 490 ₽',
    unitLabel: '124 ₽ в месяц',
    savingsLabel: 'Экономия 898 ₽',
  },
]

type Props = {
  onHome: () => void
  onArchive: () => void
  onProfile: () => void
  onStats: () => void
  onRules: () => void
  onReview: () => void
}

const priceFormatter = new Intl.NumberFormat('ru-RU', {
  style: 'currency',
  currency: 'RUB',
  maximumFractionDigits: 0,
})

const decimalFormatter = new Intl.NumberFormat('ru-RU', {
  maximumFractionDigits: 2,
})

const formatMembershipDate = (value: string) => new Intl.DateTimeFormat('ru-RU', {
  day: 'numeric',
  month: 'long',
  year: 'numeric',
}).format(new Date(value))

export function ClubScreen({
  onHome,
  onArchive,
  onStats,
  onRules,
  onReview,
}: Props) {
  const runtime = useServerRuntime()
  const [notice, setNotice] = useState('')
  const authenticated = Boolean(runtime.me && !runtime.me.user.isAnonymous)
  const catalog = useQuery({
    queryKey: queryKeys.commerceCatalog,
    queryFn: api.commerceCatalog,
    enabled: SERVER_RUNTIME,
  })
  const commerce = useQuery({
    queryKey: queryKeys.commerce,
    queryFn: api.meCommerce,
    enabled: SERVER_RUNTIME && Boolean(runtime.me),
  })
  const commerceEnabled =
    SERVER_RUNTIME &&
    Boolean(catalog.data?.enabled && runtime.meta?.commerce.enabled)
  const membership = commerce.data?.membership ??
    runtime.dashboard?.membership ?? { active: false, endsAt: null }
  const hasClub = membership.active
  const productsById = new Map(
    (catalog.data?.products ?? []).map((product) => [product.id, product]),
  )
  const monthlyPriceMinor = productsById.get('club_30d')?.priceMinor ?? 19_900
  const annualPriceMinor = productsById.get('club_365d')?.priceMinor ?? 149_000
  const offers = fallbackOffers.map((offer) => {
    const product = productsById.get(offer.id)
    if (!product) return offer

    const annual = offer.id === 'club_365d'
    const savingsMinor = monthlyPriceMinor * 12 - annualPriceMinor
    return {
      ...offer,
      title: product.title,
      note: product.description,
      priceLabel: new Intl.NumberFormat('ru-RU', {
        style: 'currency',
        currency: product.currency,
        maximumFractionDigits: 0,
      }).format(product.priceMinor / 100),
      unitLabel: annual
        ? `${priceFormatter.format(Math.round(product.priceMinor / 12) / 100)} в месяц`
        : `${decimalFormatter.format(product.priceMinor / 30 / 100)} ₽ в день`,
      savingsLabel: annual && savingsMinor > 0
        ? `Экономия ${priceFormatter.format(savingsMinor / 100)}`
        : undefined,
    }
  })
  const membershipNumber = String(runtime.dashboard?.wallet.balance ?? 0).padStart(6, '0')
  const tipsRequested =
    typeof window !== 'undefined' &&
    (new URLSearchParams(window.location.search).get('section') === 'tips' ||
      window.location.hash.includes('section=tips'))

  useEffect(() => {
    const properties = {
      placement: 'club_screen',
      isAuthenticated: authenticated,
      hasClub,
    }
    trackClientEvent('club_screen_view', properties)
    trackMetrikaGoal('club_screen_view', properties)
  }, [authenticated, hasClub])

  const selectOffer = (offer: ClubOffer) => {
    const properties = {
      productId: offer.id,
      placement: 'club_screen',
      isAuthenticated: authenticated,
      hasClub,
    }
    if (!commerceEnabled) {
      trackClientEvent('club_interest_clicked', properties)
      trackMetrikaGoal('club_interest_clicked', properties)
      setNotice(
        'Спасибо! Мы сохранили ваш интерес. Оплата появится после безопасного запуска клуба.',
      )
      return
    }
    setNotice('Подключаем безопасную оплату. Попробуйте немного позже.')
  }

  const scrollToOffers = () => {
    document.getElementById('club-offers')?.scrollIntoView({ behavior: 'smooth' })
  }

  return (
    <>
      <AppHeader
        onHome={onHome}
        onArchive={onArchive}
        onStats={onStats}
        onRules={onRules}
        onReview={onReview}
      />
      <main className="club-screen hub-screen">
        <section className="club-hero">
          <div className="club-hero__copy">
            <div className="club-hero__eyebrow">
              <span>Клуб «Сходится!»</span>
              {hasClub && (
                <span className="club-hero__status">
                  <Sparkles />
                  {membership.endsAt
                    ? `Активен до ${formatMembershipDate(membership.endsAt)}`
                    : 'Клуб активен'}
                </span>
              )}
            </div>
            <h1>
              Больше игр.
              <br />
              Больше поводов вернуться.
            </h1>
            <p>
              Архив с первого дня, свободная игра
              <br />
              и клубные спецпоказы — по одному билету.
            </p>
            <div className="club-hero__actions">
              <ActionButton type="button" onClick={hasClub ? onArchive : scrollToOffers}>
                {hasClub ? 'Открыть архив' : 'Вступить в клуб'}
              </ActionButton>
              <a href={hasClub ? '/specials' : '#club-benefits'}>
                {hasClub ? 'Перейти к спецпоказам' : 'Посмотреть преимущества'}
              </a>
            </div>
            <small className="club-hero__renewal"><LockKeyhole /> Продление только вручную</small>
          </div>

          <div className="club-hero__visual" aria-label="Клубный билет">
            <div className="club-hero__ticket">
              <span className="club-hero__star" aria-hidden="true">★</span>
              <strong>Клубный<br />билет</strong>
              <span className="club-hero__number">№ <b>{membershipNumber}</b></span>
              <small>Archive · Free play · Specials</small>
              <em>Сходится!</em>
            </div>
            <div className="club-hero__stub"><Ticket /> Archive · Free play · Specials</div>
          </div>
        </section>

        <section className="club-principles" id="club-benefits" aria-label="Преимущества клуба">
          <article>
            <Archive />
            <div>
              <strong>Весь архив</strong>
              <p>Возвращайтесь к любой игре<br />с первого дня проекта.</p>
            </div>
          </article>
          <article>
            <Ticket />
            <div>
              <strong>Свободная игра</strong>
              <p>Играйте без списания<br />билетов.</p>
            </div>
          </article>
          <article>
            <Clapperboard />
            <div>
              <strong>Спецпоказы</strong>
              <p>Тематические серии игр<br />только для клуба.</p>
            </div>
          </article>
        </section>

        <section className="club-offers" id="club-offers">
          <div className="club-offers__heading">
            <h2>Выберите срок</h2>
            <p>Один доступ. Разница только в сроке.</p>
          </div>
          <div className="club-offers__grid">
            {offers.map((offer) => {
              const product = productsById.get(offer.id)
              const buttonLabel = hasClub
                ? offer.id === 'club_365d' ? 'Продлить на год' : 'Продлить на месяц'
                : offer.id === 'club_365d' ? 'Взять на год' : 'Взять на месяц'
              return (
                <ClubCard
                  key={offer.id}
                  offer={offer}
                  onSelect={selectOffer}
                  action={
                    commerceEnabled && product ? (
                      <CheckoutButton
                        product={product}
                        authenticated={authenticated}
                        label={buttonLabel}
                      />
                    ) : undefined
                  }
                />
              )
            })}
          </div>
          {notice && (
            <p className="club-offers__notice" role="status">{notice}</p>
          )}
        </section>

        <section className="club-tip-cta" id="club-support">
          <span className="club-tip-cta__mark" aria-hidden="true"><Heart /></span>
          <div className="club-tip-cta__copy">
            <span>Поддержать проект</span>
            <h2>Оставить чаевые кассиру</h2>
            <p>Добровольная поддержка новых ежедневных игр — без игровых преимуществ.</p>
          </div>
          <TipCheckoutTrigger
            className="club-tip-cta__button"
            placement="club_tip"
            initialOpen={tipsRequested}
            label="Выбрать сумму"
            hint="Сразу перейти к оплате"
          />
        </section>
      </main>
    </>
  )
}

import { useEffect, useState } from 'react'
import { useQuery } from '@tanstack/react-query'
import { DEFAULT_CLUB_PRODUCTS, ECONOMY_RULE_SET } from '@shoditsa/contracts'
import { Archive, CircleHelp, Clapperboard, LockKeyhole, Sparkles, Ticket } from 'lucide-react'
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

const defaultMonthly = DEFAULT_CLUB_PRODUCTS.find((product) => product.id === 'club_30d')!
const defaultAnnual = DEFAULT_CLUB_PRODUCTS.find((product) => product.id === 'club_365d')!
const fallbackRubles = (minor: number) => `${new Intl.NumberFormat('ru-RU', { maximumFractionDigits: 0 }).format(minor / 100)} ₽`
const fallbackSavings = defaultMonthly.priceMinor * 12 - defaultAnnual.priceMinor
const fallbackDiscount = Math.round((1 - defaultAnnual.priceMinor / (defaultMonthly.priceMinor * 12)) * 100)

const fallbackOffers: ClubOffer[] = [
  {
    id: defaultMonthly.id,
    title: defaultMonthly.title,
    durationLabel: '30 дней',
    note: defaultMonthly.description,
    priceLabel: fallbackRubles(defaultMonthly.priceMinor),
    unitLabel: `${new Intl.NumberFormat('ru-RU', { maximumFractionDigits: 2 }).format(defaultMonthly.priceMinor / 30 / 100)} ₽ в день`,
  },
  {
    id: defaultAnnual.id,
    title: defaultAnnual.title,
    durationLabel: '365 дней',
    note: defaultAnnual.description,
    priceLabel: fallbackRubles(defaultAnnual.priceMinor),
    unitLabel: `${fallbackRubles(Math.round(defaultAnnual.priceMinor / 12))} в месяц`,
    savingsLabel: `Экономия ${fallbackRubles(fallbackSavings)}`,
    discountLabel: `${fallbackDiscount}%`,
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
  const monthlyPriceMinor = productsById.get('club_30d')?.priceMinor ?? defaultMonthly.priceMinor
  const annualPriceMinor = productsById.get('club_365d')?.priceMinor ?? defaultAnnual.priceMinor
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
      discountLabel: annual && monthlyPriceMinor > 0
        ? `${Math.round((1 - product.priceMinor / (monthlyPriceMinor * 12)) * 100)}%`
        : undefined,
    }
  })
  const tipsRequested =
    typeof window !== 'undefined' &&
    (new URLSearchParams(window.location.search).get('section') === 'tips' ||
      window.location.hash.includes('section=tips'))

  useEffect(() => {
    if (SERVER_RUNTIME && !runtime.dashboard) return
    const properties = {
      placement: 'club_screen',
      isAuthenticated: authenticated,
      balanceBefore: runtime.dashboard?.wallet.balance ?? 0,
      balanceAfter: runtime.dashboard?.wallet.balance ?? 0,
      amount: 0,
      required: 0,
      shortage: 0,
      source: 'club-screen',
      sink: null,
      mode: null,
      sessionKind: 'club-paywall',
      dailyCompletedCount: runtime.dashboard?.today?.completedModes.length ?? 0,
      streak: runtime.dashboard?.attendance?.currentDailyStreak ?? 0,
      rulesVersion: runtime.dashboard?.economyRules.version ?? ECONOMY_RULE_SET.version,
      hasClub,
    }
    trackClientEvent('club_screen_view', properties)
    if (!hasClub) trackClientEvent('club_paywall_view', properties)
    trackMetrikaGoal('club_screen_view', properties)
  }, [authenticated, hasClub, runtime.dashboard?.economyRules.version])

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

  const scrollToBenefits = () => {
    document.getElementById('club-benefits')?.scrollIntoView({ behavior: 'smooth' })
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
          <div className="club-hero__top">
            <div className="club-hero__copy">
              <div className="club-hero__trust" aria-label="Условия клуба">
                <span><LockKeyhole /><strong>Без автопродления</strong></span>
                <span><b>Daily</b><strong>Бесплатный</strong></span>
              </div>
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
              <h1 className="club-hero__title">
                <span>Больше игр.</span>
                <span>Больше поводов вернуться.</span>
              </h1>
              <p>Архив с первого дня, свободная игра, клубные спецпоказы и две дополнительные Данетки в сутки.</p>
              <div className="club-hero__actions">
                <ActionButton type="button" onClick={hasClub ? onArchive : scrollToOffers}>
                  {hasClub ? <Archive /> : <Ticket />}
                  {hasClub ? 'Открыть архив' : 'Вступить в клуб'}
                </ActionButton>
                {hasClub ? (
                  <a className="ui-button ui-button--secondary" href="/specials">
                    <Clapperboard />
                    Перейти к спецпоказам
                  </a>
                ) : (
                  <ActionButton type="button" variant="secondary" onClick={scrollToBenefits}>
                    <CircleHelp />
                    Что входит
                  </ActionButton>
                )}
              </div>
            </div>

            <div className="club-hero__artwork">
              <img
                src="/assets/club/club-hero-character.png"
                alt="Героиня протягивает клубный билет"
                width="1536"
                height="1024"
                fetchPriority="high"
              />
            </div>
          </div>

          <div className="club-principles" id="club-benefits" aria-label="Преимущества клуба">
            <article>
              <Archive />
              <div>
                <strong>Весь архив</strong>
                <p>Возвращайтесь к любой игре с первого дня.</p>
              </div>
            </article>
            <article>
              <Ticket />
              <div>
                <strong>Свободная игра</strong>
                <p>Играйте без списания билетов.</p>
              </div>
            </article>
            <article>
              <Clapperboard />
              <div>
                <strong>Спецпоказы</strong>
                <p>Тематические серии игр только для клуба.</p>
              </div>
            </article>
          </div>

          <div className="club-hero__service">
            <span><LockKeyhole /> Без автопродления</span>
            <span>Daily-игры, подсказки и заработанные билеты остаются бесплатными</span>
          </div>
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
                        hasClub={hasClub}
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

        <section className="club-tip-cta club-tip-cta--quiet" id="club-support">
          <div className="club-tip-cta__copy">
            <span>Поддержать проект</span>
            <p>Добровольная поддержка новых ежедневных игр — без игровых преимуществ.</p>
          </div>
          <TipCheckoutTrigger
            className="club-tip-cta__button"
            placement="club_tip"
            initialOpen={tipsRequested}
            label="Оставить чаевые"
            hint="99, 299 или 699 ₽"
          />
        </section>
      </main>
    </>
  )
}

import { useEffect, useState } from 'react'
import { useQuery } from '@tanstack/react-query'
import {
  ArrowLeft,
  Clapperboard,
  Heart,
  ShieldCheck,
  Sparkles,
} from 'lucide-react'
import { AppHeader } from '../../components/app-shell/AppShell'
import { trackClientEvent } from '../../app/client-events'
import { trackMetrikaGoal } from '../../app/metrics'
import {
  SERVER_RUNTIME,
  useServerRuntime,
} from '../../hooks/use-server-runtime'
import { ClubCard, type ClubOffer } from './ClubCard'
import { CheckoutButton } from './CheckoutButton'
import { TipCheckoutTrigger } from './TipCheckout'
import { MembershipBadge } from './MembershipBadge'
import { api, queryKeys } from '../../api/client'
import './CommercialShell.css'

const fallbackOffers: ClubOffer[] = [
  {
    id: 'club_30d',
    title: 'Клубный билет',
    durationLabel: '30 дней',
    note: 'Попробуйте клуб на месяц. Без автопродления.',
  },
  {
    id: 'club_365d',
    title: 'Годовой клубный билет',
    durationLabel: '365 дней',
    note: 'Спокойный доступ к архиву и свободной игре на весь год.',
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

export function ClubScreen({
  onHome,
  onArchive,
  onProfile,
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
  const offers = fallbackOffers.map((offer) => {
    const product = productsById.get(offer.id)
    return product
      ? {
          ...offer,
          title: product.title,
          note: product.description,
          priceLabel: new Intl.NumberFormat('ru-RU', {
            style: 'currency',
            currency: product.currency,
            maximumFractionDigits: 0,
          }).format(product.priceMinor / 100),
        }
      : offer
  })
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
    // The enabled checkout action is connected by the commerce phase. Until then
    // no payment data or non-working provider button is exposed.
    setNotice('Подключаем безопасную оплату. Попробуйте немного позже.')
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
      <main className="club-screen">
        <button className="club-screen__back" type="button" onClick={onHome}>
          <ArrowLeft /> На главную
        </button>
        <section className="club-hero">
          <div className="club-hero__copy">
            <span>
              <Sparkles /> Клуб «Сходится!»
            </span>
            <h1>
              Больше сеансов.
              <br />
              Та же честная игра.
            </h1>
            <p>
              Daily-игры, обычные подсказки и билеты остаются бесплатными. Клуб
              открывает архив с первого дня проекта и свободную игру без
              списаний.
            </p>
            <button
              type="button"
              onClick={() =>
                document
                  .getElementById('club-offers')
                  ?.scrollIntoView({ behavior: 'smooth' })
              }
            >
              Выбрать срок
            </button>
          </div>
          <div
            className="club-hero__ticket"
            aria-label="Преимущества клубного билета"
          >
            <span>ADMIT ONE</span>
            <strong>КЛУБ</strong>
            <small>ARCHIVE · FREE PLAY · BADGE</small>
          </div>
        </section>

        <section className="club-principles" aria-label="Принципы клуба">
          <article>
            <Clapperboard />
            <div>
              <strong>Daily навсегда бесплатный</strong>
              <p>Никаких жизней, рекламы и покупки правильных ответов.</p>
            </div>
          </article>
          <article>
            <ShieldCheck />
            <div>
              <strong>Без автопродления</strong>
              <p>Каждый срок покупается осознанно и продлевается вручную.</p>
            </div>
          </article>
          <article>
            <Heart />
            <div>
              <strong>Поддержка проекта</strong>
              <p>Абонемент помогает выпускать новые ежедневные категории.</p>
            </div>
          </article>
        </section>

        <section className="club-offers" id="club-offers">
          <div className="club-offers__heading">
            <span>Абонементы</span>
            <h2>
              {hasClub ? 'Ваш клубный билет активен' : 'Выберите удобный срок'}
            </h2>
            {hasClub ? (
              <MembershipBadge membership={membership} />
            ) : (
              <p>
                Сумма и срок всегда подтверждаются серверным каталогом до
                оплаты.
              </p>
            )}
          </div>
          <div className="club-offers__grid">
            {offers.map((offer) => {
              const product = productsById.get(offer.id)
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
                      />
                    ) : undefined
                  }
                />
              )
            })}
          </div>
          {notice && (
            <p className="club-offers__notice" role="status">
              {notice}
            </p>
          )}
        </section>

        <section className="club-account-state">
          <div>
            <span>Ваш статус</span>
            <strong>
              {hasClub
                ? 'Клубный доступ активен'
                : authenticated
                  ? 'Аккаунт готов к покупке'
                  : 'Сейчас вы играете как гость'}
            </strong>
            <p>
              {hasClub
                ? 'Архив и свободная игра уже доступны по клубному билету.'
                : authenticated
                  ? 'После оплаты абонемент будет привязан к этому аккаунту.'
                  : 'Посмотреть предложение можно без регистрации. Для покупки потребуется постоянный аккаунт.'}
            </p>
          </div>
          <button type="button" onClick={onProfile}>
            {authenticated ? 'Открыть профиль' : 'Создать аккаунт'}
          </button>
        </section>

        <section className="club-tip-cta" id="tips">
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

import { useEffect, useRef, useState, type ReactNode } from 'react'
import { useQuery } from '@tanstack/react-query'
import { ECONOMY_RULE_SET } from '@shoditsa/contracts'
import {
  Archive,
  ArrowRight,
  Clapperboard,
  Eye,
  Gamepad2,
  LockKeyhole,
  Settings,
  Sparkles,
  Ticket,
  UsersRound,
} from 'lucide-react'
import { ActionButton, AppHeader } from '../../components/app-shell/AppShell'
import { InlineAlert } from '../../components/ui'
import { trackClientEvent } from '../../app/client-events'
import { trackMetrikaGoal } from '../../app/metrics'
import { publicAssetUrl } from '../../app/public-asset'
import { SERVER_RUNTIME, useServerRuntime } from '../../hooks/use-server-runtime'
import { api, queryKeys } from '../../api/client'
import { ClubCard, type ClubPlanFeature } from './ClubCard'
import { CheckoutButton } from './CheckoutButton'
import { buildClubPageViewModel, dailyPriceMinor } from './club-page-model'
import './ClubScreen.css'

type Props = {
  onHome: () => void
  onArchive: () => void
  onProfile: () => void
  onStats: () => void
  onRules: () => void
  onReview: () => void
}

const number = new Intl.NumberFormat('ru-RU')
const decimal = new Intl.NumberFormat('ru-RU', { maximumFractionDigits: 2 })

const money = (minor: number, currency = 'RUB') => new Intl.NumberFormat('ru-RU', {
  style: 'currency',
  currency,
  maximumFractionDigits: 0,
}).format(minor / 100)

const dailyMoney = (minor: number) => `${decimal.format(minor / 100)} ₽ в день`

const dateLabel = (value: string) => new Intl.DateTimeFormat('ru-RU', {
  day: 'numeric',
  month: 'long',
  year: 'numeric',
}).format(new Date(value))

const plural = (value: number, one: string, few: string, many: string) => {
  const lastTwo = Math.abs(value) % 100
  const last = lastTwo % 10
  if (lastTwo > 10 && lastTwo < 20) return many
  if (last === 1) return one
  if (last > 1 && last < 5) return few
  return many
}

function ContentCard({
  title,
  description,
  image,
  imageAlt = '',
  icon,
  action,
  large = false,
  label,
  stamp,
}: {
  title: string
  description: string
  image: string
  imageAlt?: string
  icon: ReactNode
  action: () => void
  large?: boolean
  label?: string
  stamp?: string
}) {
  return (
    <ActionButton
      type="button"
      variant="ghost"
      surface="paper"
      className={`club-content-card${large ? ' club-content-card--special' : ''}`}
      onClick={action}
    >
      <figure>
        <img src={image} alt={imageAlt} loading={large ? 'eager' : 'lazy'} />
      </figure>
      <div className="club-content-card__copy">
        {label && <span>{label}</span>}
        <h3>{title}</h3>
        <p>{description}</p>
        {stamp && <em>{stamp}</em>}
      </div>
      <strong className="club-content-card__action">
        {icon}
        <span>{stamp ? 'Открыть с клубным билетом' : 'Нужен клубный билет'}</span>
        <ArrowRight aria-hidden="true" />
      </strong>
    </ActionButton>
  )
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
  const resumedPlan = useRef(false)
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
  const packs = useQuery({
    queryKey: queryKeys.packs,
    queryFn: api.packs,
    enabled: SERVER_RUNTIME,
  })
  const membership = commerce.data?.membership ?? runtime.dashboard?.membership
  const currentSpecial = packs.data?.items.find((pack) => pack.includedInClub) ?? packs.data?.items[0]
  const view = buildClubPageViewModel({
    authenticated,
    firstName: runtime.me?.user.name?.trim().split(/\s+/)[0],
    membership,
    products: catalog.data?.products.filter((product) => product.kind === 'club'),
    meta: runtime.meta,
    economyRules: runtime.dashboard?.economyRules,
    currentSpecial,
  })
  const hasClub = view.membership.status === 'active'
  const expired = view.membership.status === 'expired'
  const commerceEnabled = Boolean(
    SERVER_RUNTIME &&
    catalog.data?.enabled &&
    runtime.meta?.commerce.enabled,
  )
  const productsById = new Map((catalog.data?.products ?? []).map((product) => [product.id, product]))
  const specialTitle = view.currentSpecial?.title ?? 'Кино нулевых'
  const specialDescription = view.currentSpecial?.subtitle ?? view.currentSpecial?.description ?? 'Фильмы, которые смотрели все'
  const specialImage = view.currentSpecial?.coverUrl || publicAssetUrl('images/title-posters/movie-ticket-poster.webp')
  const archiveDescription = `${number.format(view.stats.archiveGames)} ${plural(view.stats.archiveGames, 'игра', 'игры', 'игр')} · ${view.stats.archiveDays} ${plural(view.stats.archiveDays, 'день', 'дня', 'дней')}`
  const clubFeatures: ClubPlanFeature[] = [
    { label: 'Весь архив с первого дня' },
    { label: 'Свободная игра без списания билетиков' },
    { label: 'Все клубные спецпоказы' },
    { label: `${view.stats.danetkiPerDay} ${plural(view.stats.danetkiPerDay, 'Данетка', 'Данетки', 'Данеток')} в сутки` },
    { label: `Комнаты до ${view.stats.friendRoomRoundLimit} раундов без списания` },
    { label: 'Заработанные билетики сохраняются' },
  ]
  const guestFeatures: ClubPlanFeature[] = [
    { label: `Ежедневные игры: сегодня + ${Math.max(0, view.stats.freeArchiveDays - 1)} дней` },
    { label: `Свободная игра: от ${view.stats.guestFreePlayCost} билетиков` },
    { label: 'Клубные спецпоказы закрыты', locked: true },
    { label: `${view.stats.guestDanetkiPerDay} ${plural(view.stats.guestDanetkiPerDay, 'Данетка', 'Данетки', 'Данеток')} в сутки` },
    { label: `Комната друзей: бесплатный блок до ${view.stats.guestFriendRoomRoundLimit} раундов` },
    { label: 'Заработанные билетики сохраняются' },
  ]

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

  const scrollToPlan = (productId = 'club_30d', message = '') => {
    if (message) setNotice(message)
    window.requestAnimationFrame(() => {
      const plan = document.querySelector<HTMLElement>(`[data-plan-id="${productId}"]`)
      plan?.scrollIntoView({ behavior: 'smooth', block: 'center' })
      plan?.querySelector<HTMLElement>('button')?.focus({ preventScroll: true })
    })
  }

  useEffect(() => {
    if (hasClub || resumedPlan.current || typeof window === 'undefined') return
    const productId = new URLSearchParams(window.location.search).get('product')
    if (productId !== 'club_30d' && productId !== 'club_365d') return
    resumedPlan.current = true
    scrollToPlan(productId, 'Выбранный клубный билет сохранён. Подтвердите условия, чтобы продолжить оформление.')
  }, [hasClub])

  const lockedAction = (message: string) => {
    trackClientEvent('club_interest_clicked', {
      placement: 'club_content',
      isAuthenticated: authenticated,
      hasClub,
    })
    trackMetrikaGoal('club_interest_clicked', { placement: 'club_content' })
    scrollToPlan('club_30d', message)
  }

  const openSpecial = () => {
    if (!hasClub) return lockedAction('Этот спецпоказ входит в клубный билет.')
    window.location.assign(view.currentSpecial
      ? `/specials/${encodeURIComponent(view.currentSpecial.id)}`
      : '/specials')
  }

  const monthly = view.pricing.monthly
  const annual = view.pricing.annual
  const heroStatus = hasClub
    ? `Билет активен${view.membership.expiresAt ? ` до ${dateLabel(view.membership.expiresAt)}` : ''}`
    : expired && view.membership.expiresAt
      ? `Билет истёк ${dateLabel(view.membership.expiresAt)}`
      : authenticated
        ? 'Билет не активен'
        : 'Гостевой режим'
  const featureAction = (activeAction: () => void, message: string) => (
    hasClub ? activeAction : () => lockedAction(message)
  )

  return (
    <>
      <AppHeader
        onHome={onHome}
        onArchive={onArchive}
        onStats={onStats}
        onRules={onRules}
        onReview={onReview}
        minimal
      />
      <main className={`club-lobby-screen${hasClub ? ' club-lobby-screen--active' : ''}`}>
        <nav className="club-lobby-tabs" aria-label="Разделы клуба">
          <ActionButton type="button" variant="ghost" className="is-active" onClick={() => document.getElementById('club-hero')?.scrollIntoView({ behavior: 'smooth', block: 'start' })}>
            <Ticket aria-hidden="true" />
            Сегодня
          </ActionButton>
          <ActionButton type="button" variant="ghost" onClick={() => document.getElementById('club-content')?.scrollIntoView({ behavior: 'smooth', block: 'start' })}>
            <Clapperboard aria-hidden="true" />
            Спецпоказы
          </ActionButton>
          <ActionButton
            type="button"
            variant="ghost"
            onClick={featureAction(onArchive, 'Весь архив открывается с клубным билетом.')}
          >
            <Archive aria-hidden="true" />
            Архив
          </ActionButton>
          <ActionButton
            type="button"
            variant="ghost"
            onClick={featureAction(onHome, 'Свободная игра без списания билетиков входит в Клуб.')}
          >
            <Gamepad2 aria-hidden="true" />
            Свободная игра
          </ActionButton>
        </nav>
        <section className="club-entry" id="club-hero">
          <div className="club-entry__copy">
            <div className="club-entry__meta">
              <span>Клубный вход</span>
              <strong className={hasClub ? 'is-active' : expired ? 'is-expired' : undefined}>
                {hasClub ? <Sparkles aria-hidden="true" /> : <LockKeyhole aria-hidden="true" />}
                {heroStatus}
              </strong>
            </div>
            <h1>Здесь игра продолжается</h1>
            <p>
              Полный архив, свободные партии, все спецпоказы и {view.stats.danetkiPerDay}{' '}
              {plural(view.stats.danetkiPerDay, 'Данетка', 'Данетки', 'Данеток')} в сутки.
            </p>
            <div className="club-entry__actions">
              <ActionButton type="button" onClick={hasClub ? onArchive : () => scrollToPlan()}>
                {hasClub ? <Archive aria-hidden="true" /> : <Ticket aria-hidden="true" />}
                {hasClub
                  ? 'Открыть весь архив'
                  : expired
                    ? 'Продлить клубный билет'
                    : `Получить клубный билет — от ${money(monthly.priceMinor, monthly.currency)}`}
              </ActionButton>
              <ActionButton
                type="button"
                variant="secondary"
                onClick={hasClub ? openSpecial : () => document.getElementById('club-content')?.scrollIntoView({ behavior: 'smooth', block: 'start' })}
              >
                {hasClub ? <Clapperboard aria-hidden="true" /> : <Eye aria-hidden="true" />}
                {hasClub ? 'Открыть спецпоказ' : 'Посмотреть, что внутри'}
              </ActionButton>
            </div>
            <div className="club-entry__service">
              {hasClub
                ? <ActionButton type="button" variant="ghost" onClick={onProfile}><Settings aria-hidden="true" /> Управление билетом</ActionButton>
                : <span>{monthly.durationDays ?? 30} дней · без автопродления</span>}
            </div>
          </div>
          <div className="club-entry__art">
            <img
              src={publicAssetUrl('assets/club/club-hero-character.png')}
              alt="Героиня протягивает клубный билет"
              width="1536"
              height="1024"
              fetchPriority="high"
            />
          </div>
        </section>

        <section className="club-content" id="club-content">
          <header className="club-section-heading">
            <h2>Сегодня в клубе</h2>
            <span><Archive aria-hidden="true" /> {number.format(view.stats.archiveGames)} игр в архиве</span>
          </header>
          <div className="club-content__grid">
            <ContentCard
              large
              title={specialTitle}
              description={specialDescription}
              image={specialImage}
              imageAlt=""
              icon={hasClub ? <Clapperboard aria-hidden="true" /> : <LockKeyhole aria-hidden="true" />}
              action={openSpecial}
              label="Клубный спецпоказ"
              stamp={hasClub ? undefined : 'Только для клуба'}
            />
            <div className="club-content__features">
              <ContentCard
                title="Весь архив"
                description={archiveDescription}
                image={publicAssetUrl('images/title-posters/movie-ticket-poster.webp')}
                icon={hasClub ? <Archive aria-hidden="true" /> : <LockKeyhole aria-hidden="true" />}
                action={featureAction(onArchive, 'Весь архив открывается с клубным билетом.')}
              />
              <ContentCard
                title="Свободная игра"
                description={`${view.stats.freePlayModes} режимов · без списания билетиков`}
                image={publicAssetUrl('images/title-posters/game-ticket-poster.webp')}
                icon={hasClub ? <Gamepad2 aria-hidden="true" /> : <LockKeyhole aria-hidden="true" />}
                action={featureAction(onHome, 'Свободная игра без списания билетиков входит в Клуб.')}
              />
              <ContentCard
                title="Данетки"
                description={`${view.stats.danetkiPerDay} истории в сутки`}
                image={publicAssetUrl('images/title-posters/danetki-ticket-poster.webp')}
                icon={hasClub ? <Sparkles aria-hidden="true" /> : <LockKeyhole aria-hidden="true" />}
                action={featureAction(
                  () => window.location.assign('/games/danetki'),
                  `${view.stats.danetkiPerDay} Данетки в сутки доступны с клубным билетом.`,
                )}
              />
              <ContentCard
                title="Комната друзей"
                description={`До ${view.stats.friendRoomRoundLimit} раундов без списания`}
                image={publicAssetUrl('images/friends-room/lobby-collage-lower.webp')}
                icon={hasClub ? <UsersRound aria-hidden="true" /> : <LockKeyhole aria-hidden="true" />}
                action={featureAction(
                  () => window.location.assign('/games/together?new=1'),
                  `Комнаты до ${view.stats.friendRoomRoundLimit} раундов входят в клубный билет.`,
                )}
              />
            </div>
          </div>
        </section>

        {!hasClub && (
          <section className="club-pricing" id="club-offers" aria-labelledby="club-pricing-title">
            <header>
              <h2 id="club-pricing-title">Выберите, как играть</h2>
              <p>Один состав клуба — два срока действия билета</p>
            </header>
            {notice && <InlineAlert tone="warning" className="club-pricing__notice">{notice}</InlineAlert>}
            <div className="club-pricing__grid">
              <ClubCard
                guest
                eyebrow="Бесплатно"
                title="Гость"
                priceLabel="0 ₽"
                unitLabel="Можно играть без оплаты"
                features={guestFeatures}
                action={<ActionButton type="button" variant="secondary" onClick={onHome}>Остаться гостем</ActionButton>}
                note="Ваш текущий режим"
              />
              <ClubCard
                planId={monthly.id}
                eyebrow="Клубный билет"
                title={`${monthly.durationDays ?? 30} дней`}
                priceLabel={money(monthly.priceMinor, monthly.currency)}
                unitLabel={dailyMoney(dailyPriceMinor(monthly))}
                features={clubFeatures}
                action={commerceEnabled && productsById.get(monthly.id)
                  ? <CheckoutButton
                    product={productsById.get(monthly.id)!}
                    authenticated={authenticated}
                    hasClub={hasClub}
                    label={`Выбрать ${monthly.durationDays ?? 30} дней`}
                    placement="club_pricing_monthly"
                  />
                  : <ActionButton type="button" onClick={() => setNotice('Оплата временно недоступна. Попробуйте немного позже.')}>
                    Выбрать {monthly.durationDays ?? 30} дней
                  </ActionButton>}
                note={<><LockKeyhole aria-hidden="true" /> Без автопродления</>}
              />
              <ClubCard
                featured
                planId={annual.id}
                eyebrow="Клубный билет"
                title={`${annual.durationDays ?? 365} дней`}
                priceLabel={money(annual.priceMinor, annual.currency)}
                unitLabel={`${dailyMoney(dailyPriceMinor(annual))} · экономия ${money(view.pricing.annualSavingsMinor, annual.currency)}`}
                features={clubFeatures}
                badge={<>Выгоднее <strong>{view.pricing.annualDiscountPercent}%</strong></>}
                action={commerceEnabled && productsById.get(annual.id)
                  ? <CheckoutButton
                    product={productsById.get(annual.id)!}
                    authenticated={authenticated}
                    hasClub={hasClub}
                    label={`Выбрать ${annual.durationDays ?? 365} дней`}
                    placement="club_pricing_annual"
                  />
                  : <ActionButton type="button" onClick={() => setNotice('Оплата временно недоступна. Попробуйте немного позже.')}>
                    Выбрать {annual.durationDays ?? 365} дней
                  </ActionButton>}
                note={<><LockKeyhole aria-hidden="true" /> Без автопродления</>}
              />
            </div>
            <ActionButton type="button" variant="ghost" className="club-pricing__back" onClick={() => document.getElementById('club-hero')?.scrollIntoView({ behavior: 'smooth' })}>
              Вернуться к содержимому клуба
              <ArrowRight aria-hidden="true" />
            </ActionButton>
          </section>
        )}
      </main>
    </>
  )
}

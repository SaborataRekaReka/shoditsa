import { ThemedArtwork } from '../../components/ui/ThemedArtwork'
import { GameArtwork } from '../../components/ui/GameArtwork'
import type { ReactNode } from 'react'
import { ArrowDown, ArrowRight, Check, ChevronLeft, LockKeyhole, Settings, Ticket } from 'lucide-react'
import { ActionButton, InlineAlert, TextButton } from '../../components/ui'
import { ReferenceIcon } from '../../components/ui/ReferenceIcon'
import { mascotAsset } from '../../components/mascot/Mascot'
import type { ClubPlanFeature } from './ClubCard'
import { dailyPriceMinor, type ClubPageViewModel } from './club-page-model'
import './ReferenceClubPage.css'

export type ReferenceClubPageProps = {
  view: ClubPageViewModel
  heroStatus: string
  header: ReactNode
  notice: string
  contextualOffer: boolean
  canOpenSpecial: boolean
  special: { title: string; description: string; image: string }
  clubFeatures: ClubPlanFeature[]
  guestFeatures: ClubPlanFeature[]
  monthlyAction: ReactNode
  annualAction: ReactNode
  onHome: () => void
  onArchive: () => void
  onFreePlay: () => void
  onProfile: () => void
  onSpecial: () => void
  onSelectPlan: (productId?: string, message?: string) => void
  onLockedFeature: (message: string) => void
}

const money = (minor: number, currency: string) => new Intl.NumberFormat('ru-RU', {
  style: 'currency', currency, maximumFractionDigits: 0,
}).format(minor / 100)
const dailyMoney = (minor: number) => `${new Intl.NumberFormat('ru-RU', { maximumFractionDigits: 2 }).format(minor / 100)} ₽ в день`
const countLabel = (value: number, forms: [string, string, string]) => {
  const tens = Math.abs(value) % 100
  const digit = tens % 10
  return `${value} ${forms[tens > 10 && tens < 20 ? 2 : digit === 1 ? 0 : digit > 1 && digit < 5 ? 1 : 2]}`
}

export function ReferenceClubPage({
  view, heroStatus, header, notice, contextualOffer, canOpenSpecial, special,
  clubFeatures, guestFeatures, monthlyAction, annualAction,
  onHome, onArchive, onFreePlay, onProfile, onSpecial, onSelectPlan, onLockedFeature,
}: ReferenceClubPageProps) {
  const active = view.membership.status === 'active'
  const expired = view.membership.status === 'expired'
  const { monthly, annual } = view.pricing
  const opportunities: Array<{
    title: string; description: string; image: string; tone: string
    action: () => void; actionLabel: string
  }> = [
    {
      title: 'Весь архив',
      description: active
        ? `${countLabel(view.stats.archiveGames, ['игра', 'игры', 'игр'])} · ${countLabel(view.stats.archiveDays, ['день', 'дня', 'дней'])}`
        : `${view.stats.freeArchiveDays} дней доступны бесплатно · весь архив — в клубе`,
      image: 'movie', tone: 'lilac', action: onArchive,
      actionLabel: active ? 'Открыть архив' : 'Посмотреть архив',
    },
    {
      title: 'Свободная игра',
      description: `${view.stats.freePlayModes} режимов · без списания билетиков с Клубом`,
      image: 'game', tone: 'mint', action: onFreePlay,
      actionLabel: 'Выбрать игру',
    },
    {
      title: 'Данетки',
      description: `${countLabel(view.stats.danetkiPerDay, ['история', 'истории', 'историй'])} в сутки с клубным билетом`,
      image: 'yes-no', tone: 'yellow',
      action: () => window.location.assign('/games/danetki'), actionLabel: 'Раскрыть историю',
    },
    {
      title: 'Комната друзей',
      description: `До ${view.stats.friendRoomRoundLimit} раундов. Друзья присоединяются по приглашению бесплатно.`,
      image: 'associations', tone: 'blue',
      action: active
        ? () => window.location.assign('/games/together?new=1')
        : () => onLockedFeature('Создание комнаты и совместные Данетки входят в клубный билет. Участникам по приглашению клуб не нужен.'),
      actionLabel: active ? 'Создать комнату' : 'Открыть с Клубом',
    },
  ]

  return <>
    {header}
    <main className="reference-club" data-membership={view.membership.status}>
      <nav className="reference-club__back" aria-label="Навигация по сайту">
        <TextButton onClick={onHome}><ChevronLeft aria-hidden="true" /> Все игры</TextButton>
      </nav>

      <section className="reference-club__hero" id="club-hero" aria-labelledby="club-heading">
        <div className="reference-club__copy">
          <div className="reference-club__meta">
            <span>Клуб «Сходится!»</span>
            <span className="reference-club__status">
              {active ? <Check aria-hidden="true" /> : <Ticket aria-hidden="true" />}
              {heroStatus}
            </span>
          </div>
          <h1 id="club-heading">Здесь игра продолжается</h1>
          <p>Полный архив, свободные партии, все спецпоказы и {countLabel(view.stats.danetkiPerDay, ['Данетка', 'Данетки', 'Данеток'])} в сутки.</p>
          <div className="reference-club__hero-actions">
            <ActionButton onClick={active ? onArchive : () => onSelectPlan()}>
              {active ? 'Открыть весь архив' : expired ? 'Продлить клубный билет' : 'Выбрать клубный билет'}
              <ArrowRight aria-hidden="true" />
            </ActionButton>
            <TextButton onClick={active ? onProfile : () => document.getElementById('club-content')?.scrollIntoView({ behavior: 'smooth', block: 'start' })}>
              {active ? <Settings aria-hidden="true" /> : <ArrowDown aria-hidden="true" />}
              {active ? 'Управление билетом' : 'Что входит в Клуб'}
            </TextButton>
          </div>
          {!active && <small className="reference-club__terms">От {money(monthly.priceMinor, monthly.currency)} за {monthly.durationDays ?? 30} дней · автопродление по выбору</small>}
        </div>
        <figure className="reference-club__hero-art">
          <ThemedArtwork src={mascotAsset('club')} alt="Зелёный пушистый персонаж с клубным билетом" width="1254" height="1254" fetchPriority="high" />
        </figure>
      </section>

      <section className="reference-club__content" id="club-content" aria-labelledby="club-content-title">
        <header className="reference-club__section-heading">
          <h2 id="club-content-title">Играть в своём ритме</h2>
          <p>Больше возможностей с одним клубным билетом.</p>
        </header>
        <div className="reference-club__benefits">
          {opportunities.map(item => <article className="reference-club__benefit" key={item.title}>
            <div className="reference-club__benefit-art" data-tone={item.tone}>
              <GameArtwork mode={item.image} alt="" width="120" height="120" loading="lazy" />
            </div>
            <h3>{item.title}</h3>
            <p>{item.description}</p>
            <TextButton onClick={item.action}>{item.actionLabel}<ArrowRight aria-hidden="true" /></TextButton>
          </article>)}
        </div>
      </section>

      <article className="reference-club__special" aria-labelledby="club-special-title">
        <figure data-illustration={/(?:home-doodle|title-posters)\//.test(special.image) || undefined}><ThemedArtwork src={special.image} alt="" loading="lazy" /></figure>
        <div className="reference-club__special-copy">
          <span><ReferenceIcon name="movie" size={20} /> Клубный спецпоказ</span>
          <h2 id="club-special-title">{special.title}</h2>
          <p>{special.description}</p>
          <ActionButton variant="secondary" onClick={onSpecial}>
            {canOpenSpecial ? 'Открыть спецпоказ' : 'Открыть с клубным билетом'}
            <ArrowRight aria-hidden="true" />
          </ActionButton>
        </div>
      </article>

      {!active && <>
        <section className="reference-club__pricing" id="club-offers" aria-labelledby="club-pricing-title">
          <header className="reference-club__section-heading">
            <h2 id="club-pricing-title">Выберите свой билет</h2>
            <p>{contextualOffer
              ? 'Продолжайте «Диагнозы»: новые случаи и весь архив без списания билетиков. Для начала — билет на 30 дней.'
              : 'Все возможности Клуба. Разница только в сроке.'}</p>
          </header>
          {notice && <InlineAlert tone="warning" className="reference-club__notice">{notice}</InlineAlert>}
          <div className="reference-club__plans">
            {[{ product: monthly, action: monthlyAction }, { product: annual, action: annualAction }].map(({ product, action }, index) => <article
              className="reference-club__plan"
              data-plan-id={product.id}
              key={product.id}
              aria-label={`Клубный билет: ${product.durationDays ?? (index ? 365 : 30)} дней`}
            >
              <header>
                <span>{product.durationDays ?? (index ? 365 : 30)} дней в Клубе</span>
                {index === 1 && view.pricing.annualDiscountPercent > 0 && <small>Выгоднее на {view.pricing.annualDiscountPercent}%</small>}
              </header>
              <strong className="reference-club__price">{money(product.priceMinor, product.currency)}</strong>
              <p className="reference-club__daily">{dailyMoney(dailyPriceMinor(product))}</p>
              <p className="reference-club__plan-detail">{index === 1
                ? `Экономия ${money(view.pricing.annualSavingsMinor, product.currency)} по сравнению с 12 билетами на 30 дней.`
                : 'Чтобы познакомиться со всеми возможностями и найти свой ритм.'}</p>
              <div className="reference-club__checkout">{action}</div>
            </article>)}
          </div>
          <p className="reference-club__renewal"><LockKeyhole aria-hidden="true" /> Автопродление — только по вашему выбору. Управление билетом — в профиле.</p>
        </section>

        <section className="reference-club__comparison" aria-labelledby="club-comparison-title">
          <header className="reference-club__section-heading">
            <h2 id="club-comparison-title">Можно играть и бесплатно</h2>
            <p>Ежедневные загадки доступны всем. Клуб открывает больше.</p>
          </header>
          <table>
            <thead><tr><th scope="col">Возможности</th><th scope="col">Без билета</th><th scope="col">С Клубом</th></tr></thead>
            <tbody>{clubFeatures.map((feature, index) => <tr key={feature.label}>
              <th scope="row">{feature.label}</th>
              <td>{guestFeatures[index]?.value}</td>
              <td>{feature.value}</td>
            </tr>)}</tbody>
          </table>
          <dl className="reference-club__mobile-comparison">
            {clubFeatures.map((feature, index) => <div key={feature.label}>
              <dt>{feature.label}</dt>
              <dd>
                <div><span>Без билета</span><strong>{guestFeatures[index]?.value}</strong></div>
                <div><span>С Клубом</span><strong>{feature.value}</strong></div>
              </dd>
            </div>)}
          </dl>
          <div className="reference-club__guest-action"><TextButton onClick={onHome}>Продолжить бесплатно<ArrowRight aria-hidden="true" /></TextButton><span>Ваши билетики сохраняются в любом режиме.</span></div>
        </section>
      </>}
    </main>
  </>
}

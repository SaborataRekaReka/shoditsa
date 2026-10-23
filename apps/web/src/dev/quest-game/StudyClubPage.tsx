import { useLayoutEffect, useState } from 'react'
import { Check, LockKeyhole } from 'lucide-react'
import { QuestButton } from '../../components/ui/QuestPrimitives'
import { InlineAlert } from '../../components/ui'
import type { ReferenceClubPageProps } from '../../features/commerce/ReferenceClubPage'
import { StudyClubPlans } from './StudyClubPlans'
import { GeneratedShoditsaGlyph as Glyph } from './GeneratedShoditsaArt'
import { StudySidebar } from './StudySidebar'
import { StudyHeader } from './StudyHeader'
import { StudyRightSidebar } from './StudyRightSidebar'
import { STUDY_HOME_VARIANT_KEY, studyHomeHref } from './home-route'
import { localPresentationLink } from '../../app/local-presentation'
import '../../styles/quest-study-tokens.css'
import '../../styles/shoditsa-study-tokens.css'
import './quest-game.css'
import './shoditsa-game.css'
import { StudyAccountWidget, StudyStreakWidget } from './StudySidebarWidgets'
import { StudyClubHero } from './StudyClubHero'
import { StudyClubBenefits } from './StudyClubBenefits'
import { StudyClubLibrary } from './StudyClubLibrary'
import { StudyFooter } from './StudyTheme'
import './study-club.css'
import { HomeSpecials } from '../quest-home/HomeSpecials'

/** Presentation only: membership, prices and checkout still belong to ClubScreen. */
export default function StudyClubPage({ view, heroStatus, notice, contextualOffer, clubFeatures, guestFeatures, monthlyAction, annualAction, onSelectPlan, onLockedFeature, onPlanUnavailable, onFreePlay, studySection }: ReferenceClubPageProps & { onPlanUnavailable?: () => void; studySection?: 'library' | 'offers' }) {
  const active = view.membership.status === 'active'
  const expired = view.membership.status === 'expired'
  const { monthly, annual } = view.pricing
  const [selectedPlan, setSelectedPlan] = useState(new URLSearchParams(window.location.search).get('product') === annual.id ? annual.id : monthly.id)
  const home = (() => { try { return studyHomeHref(sessionStorage.getItem(STUDY_HOME_VARIANT_KEY)) ?? '/' } catch { return '/' } })()
  const archive = '/archive'
  const profile = '/profile'
  useLayoutEffect(() => {
    const root = document.documentElement
    const previous = { localStudy: root.dataset.localStudy, questSkin: root.dataset.questSkin }
    root.dataset.localStudy = 'club'
    root.dataset.questSkin = 'shoditsa'
    return () => {
      if (previous.localStudy) root.dataset.localStudy = previous.localStudy; else delete root.dataset.localStudy
      if (previous.questSkin) root.dataset.questSkin = previous.questSkin; else delete root.dataset.questSkin
    }
  }, [])

  const section = studySection ?? new URLSearchParams(window.location.hash.split('?')[1]).get('section')
  if (section === 'library' || (active && section !== 'offers')) return <StudyClubLibrary view={view} heroStatus={heroStatus} homeHref={home} archiveHref={archive} profileHref={profile} onFreePlay={onFreePlay} />

  return <div className="qg-app study-club" data-public-theme="quest-study" data-quest-skin="shoditsa">
    <a className="study-club-skip" href="#study-club-main" onClick={event => { event.preventDefault(); document.getElementById('study-club-main')?.focus() }}>Перейти к содержимому</a>
    <StudySidebar view="kit" currentPage="club-offer" clubActive={active} shoditsa homeHref={home} Glyph={Glyph} />
    <div className="qg-layout study-layout">
      <StudyHeader Glyph={Glyph} profileHref={profile} currentPage="club-offer" />
      <main id="study-club-main" className="qg-main study-club-main" data-membership={view.membership.status} tabIndex={-1}>
        <StudyClubHero active={active} expired={expired} archiveHref={archive} onSelectPlan={() => onSelectPlan(selectedPlan)} />
        <StudyClubBenefits stats={view.stats} active={active} homeHref={home} archiveHref={archive} onLockedFeature={onLockedFeature} />

        {!active && <section className="study-club-section" id="club-offers" aria-labelledby="club-pricing-title">
          <header><h2 id="club-pricing-title">Выберите свой билет</h2><p>{contextualOffer ? 'Продолжайте «Диагнозы»: новые случаи и весь архив без списания билетиков. Для начала — билет на 30 дней.' : 'Все возможности Клуба. Разница только в сроке.'}</p></header>
          {notice && <InlineAlert tone="warning" className="study-club-notice">{notice}</InlineAlert>}
          <StudyClubPlans pricing={view.pricing} selectedPlan={selectedPlan} onSelect={setSelectedPlan} />
          <div className="study-club-selected-checkout">{onPlanUnavailable ? <QuestButton onClick={onPlanUnavailable}>Выбрать {selectedPlan === annual.id ? annual.durationDays ?? 365 : monthly.durationDays ?? 30} дней</QuestButton> : selectedPlan === annual.id ? annualAction : monthlyAction}</div>
          <p className="study-club-renewal"><LockKeyhole size={17} />Автопродление — только по вашему выбору. Управление билетом — в профиле.</p>
        </section>}

        <HomeSpecials />



        <section className="study-club-section study-club-comparison" id="club-comparison" aria-labelledby="club-comparison-title">
          <header><h2 id="club-comparison-title" tabIndex={-1}>Можно играть и бесплатно</h2><p>Ежедневные загадки доступны всем. Клуб открывает больше.</p></header>
          <div className="study-club-comparison-frame"><table><thead><tr><th scope="col">Возможности</th><th scope="col">Без билета</th><th scope="col"><Glyph name="medal" size={25} />С Клубом</th></tr></thead><tbody>{clubFeatures.map((feature, index) => <tr key={feature.label}><th scope="row">{feature.label}</th><td>{guestFeatures[index]?.value}</td><td><span className="study-club-included"><Check size={14} strokeWidth={3} aria-hidden="true" /></span><strong>{feature.value}</strong></td></tr>)}</tbody></table></div>
          <dl className="study-club-mobile-comparison">{clubFeatures.map((feature, index) => <div key={feature.label}><dt>{feature.label}</dt><dd><div><span>Без билета</span><strong>{guestFeatures[index]?.value}</strong></div><div><span>С Клубом</span><strong><Check size={14} strokeWidth={3} aria-hidden="true" />{feature.value}</strong></div></dd></div>)}</dl>
          <a className="quest-button quest-button--outline study-club-free-action" href={home}>Продолжить бесплатно</a>
          <p className="study-club-quiet">Ваши билетики сохраняются в любом режиме.</p>
        </section>
      </main>

      <StudyRightSidebar className="study-club-aside" label="Аккаунт и серия дней">
        {!view.user.isAuthenticated && <StudyAccountWidget />}
        {active && <section className="qg-card study-section-widget"><div className="qg-side-head"><h2>Клубный билет</h2><Glyph name="ticket" size={47} /></div><p>{heroStatus}</p><a className="quest-button quest-button--outline study-widget-action" href={profile}>Управление билетом</a></section>}
        <StudyStreakWidget homeHref={`${home}#home-games`} />
        <StudyFooter><a href={home}>Все игры</a><a href={localPresentationLink('/legal/terms')}>Оферта</a><a href={localPresentationLink('/legal/refunds')}>Возвраты</a></StudyFooter>
      </StudyRightSidebar>
    </div>
  </div>
}

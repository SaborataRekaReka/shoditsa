import { QuestButton } from '../../components/ui/QuestPrimitives'
import { StudyClubSky } from './StudyClubSky'
import './study-club-hero.css'

export function StudyClubHero({ active, expired, archiveHref, onSelectPlan }: {
  active: boolean
  expired: boolean
  archiveHref: string
  onSelectPlan: () => void
}) {
  return <section className="study-club-hero" id="club-hero" aria-labelledby="club-heading">
    <StudyClubSky page headingId="club-heading" heading={<>Больше игры.<br /><em>Больше открытий.</em></>} />
    <div className="study-club-hero-copy">
      <p>Все возможности Клуба с одним билетом.</p>
      <div className="study-club-hero-actions">
        {active ? <a className="quest-button quest-button--club" href={archiveHref}>Открыть весь архив</a> : <QuestButton kind="club" onClick={onSelectPlan}>{expired ? 'Продлить клубный билет' : 'Выбрать клубный билет'}</QuestButton>}
      </div>
    </div>
  </section>
}


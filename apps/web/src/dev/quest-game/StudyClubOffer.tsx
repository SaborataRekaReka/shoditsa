import { useEffect, useRef, useState, type ReactNode } from 'react'
import { Pause, Play } from 'lucide-react'
import { publicAssetUrl } from '../../app/public-asset'
import { QuestButton } from '../../components/ui/QuestPrimitives'
import type { ClubPageViewModel } from '../../features/commerce/club-page-model'
import { StudyClubPlans } from './StudyClubPlans'
import { StudyClubOfferScene } from './StudyClubOfferScene'
import './study-club-offer.css'

// Editorial amounts for the Club's support goal; not a live payment total.
const supportGoal = { collected: 3400, target: 5000 }
const formatRubles = new Intl.NumberFormat('ru-RU', { style: 'currency', currency: 'RUB', maximumFractionDigits: 0 })

/** The offer owns its presentation; the existing checkout owns consent and payment. */
export function StudyClubOffer({ pricing, selectedPlan, onSelect, notice, children }: {
  pricing: ClubPageViewModel['pricing']
  selectedPlan: string
  onSelect: (id: string) => void
  notice?: ReactNode
  children: ReactNode
}) {
  const surface = useRef<HTMLElement>(null)
  const [paused, setPaused] = useState(false)
  const [visible, setVisible] = useState(false)
  const [documentVisible, setDocumentVisible] = useState(true)

  useEffect(() => {
    const element = surface.current
    if (!element) return
    const observer = 'IntersectionObserver' in window
      ? new IntersectionObserver(([entry]) => setVisible(entry.isIntersecting))
      : null
    observer?.observe(element)
    if (!observer) setVisible(true)
    const visibility = () => setDocumentVisible(!document.hidden)
    visibility()
    document.addEventListener('visibilitychange', visibility)
    return () => { observer?.disconnect(); document.removeEventListener('visibilitychange', visibility) }
  }, [])

  return <section ref={surface} className="study-club-section club-paywall" id="club-offers" aria-labelledby="club-pricing-title" data-motion-paused={paused || !visible || !documentVisible || undefined}>
    <header className="club-paywall__heading">
      <StudyClubOfferScene />
      <div className="club-paywall__copy">
        <span className="club-paywall__eyebrow">Заходи в Клуб</span>
        <h2 id="club-pricing-title">Ещё одну?<em>Сколько хочешь.</em></h2>
        <p>Архив, свободная игра<br />и все клубные спецпоказы.</p>
      </div>
      <img className="club-paywall__mascot" src={publicAssetUrl('images/mascot/club-invitation-v1.webp')} width="224" height="224" alt="" decoding="async" />
      <div className="club-paywall__goal">
        <div className="club-paywall__goal-caption">
          <span>На поддержку проекта</span>
          <span className="club-paywall__goal-amount"><strong>{formatRubles.format(supportGoal.collected)}</strong> из {formatRubles.format(supportGoal.target)}</span>
        </div>
        <progress aria-label="На поддержку проекта" aria-valuetext={`Собрано ${formatRubles.format(supportGoal.collected)} из ${formatRubles.format(supportGoal.target)}`} value={supportGoal.collected} max={supportGoal.target} />
      </div>
    </header>
    {notice}
    <StudyClubPlans pricing={pricing} selectedPlan={selectedPlan} onSelect={onSelect} variant="premium" />
    <div className="study-club-selected-checkout" key={selectedPlan}>{children}</div>
    <QuestButton kind="icon" className="club-paywall__motion" aria-label={paused ? 'Включить анимацию фона' : 'Остановить анимацию фона'} aria-pressed={paused} onClick={() => setPaused(value => !value)}>
      {paused ? <Play size={13} /> : <Pause size={13} />}
    </QuestButton>
  </section>
}

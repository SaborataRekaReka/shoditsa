import { ThemedArtwork } from '../../components/ui/ThemedArtwork'
import { useEffect, useRef, type CSSProperties } from 'react'
import { ArrowUpRight, Route } from 'lucide-react'
import type { TitleMode } from '../../types'
import { MODE_PRESENTATION } from '../../app/mode-presentation'
import { REFERENCE_PRESENTATION } from '../../app/local-presentation'
import { referenceModeIllustration } from '../game/reference-mode-art'
import { trackClientEvent } from '../../app/client-events'
import { trackMetrikaGoal } from '../../app/metrics'
import { DanetkiRegistrationOffer } from './DanetkiRegistrationOffer'
import { DANETKI_RECOMMENDATIONS as RECOMMENDATIONS } from '../../app/danetki-recommendation-copy'
import './DanetkiRecommendations.css'

type Placement = 'landing-bottom' | 'catalog-bottom'

export function DanetkiRecommendations({ placement }: { placement: Placement }) {
  const viewTracked = useRef(false)

  useEffect(() => {
    if (viewTracked.current) return
    viewTracked.current = true
    const payload = { mode: 'danetki', placement, destinations: RECOMMENDATIONS.map((entry) => entry.mode) }
    trackClientEvent('danetki_cross_game_offer_view', payload)
    trackMetrikaGoal('danetki_cross_game_offer_view', payload)
  }, [placement])

  const trackClick = (mode: TitleMode) => {
    const destination = `/games/${mode}`
    const payload = { mode: 'danetki', placement, destination, toMode: mode }
    trackClientEvent('danetki_cross_game_clicked', payload)
    trackMetrikaGoal('seo_search_action_clicked', payload)
  }

  return <section className="danetki-recommendations" aria-labelledby={`danetki-recommendations-${placement}`}>
    <header className="danetki-recommendations__header">
      <span><Route aria-hidden="true" /> Маршрут продолжается</span>
      <h2 id={`danetki-recommendations-${placement}`}>Ещё три игры, где важна хорошая версия</h2>
      <p>Выберите следующий короткий раунд — правила объяснятся по ходу игры.</p>
    </header>
    <div className="danetki-recommendations__grid">
      {RECOMMENDATIONS.map((entry, index) => {
        const presentation = MODE_PRESENTATION[entry.mode]
        const Icon = presentation.icon
        return <a
          className={`danetki-recommendation-card${index === 0 ? ' is-primary' : ''}`}
          href={`/games/${entry.mode}`}
          key={entry.mode}
          onClick={() => trackClick(entry.mode)}
          style={{ '--danetki-recommendation-color': presentation.color } as CSSProperties}
        >
          <ThemedArtwork src={REFERENCE_PRESENTATION ? referenceModeIllustration(entry.mode) : presentation.watermarkUrl} alt="" aria-hidden="true" loading="lazy" />
          <span className="danetki-recommendation-card__veil" aria-hidden="true" />
          <span className="danetki-recommendation-card__icon" aria-hidden="true"><Icon /></span>
          <span className="danetki-recommendation-card__copy">
            <small>{entry.kicker}</small>
            <strong>{entry.title}</strong>
            <span>{entry.description}</span>
          </span>
          <span className="danetki-recommendation-card__action">Играть <ArrowUpRight aria-hidden="true" /></span>
        </a>
      })}
    </div>
    <DanetkiRegistrationOffer placement="catalog" />
  </section>
}

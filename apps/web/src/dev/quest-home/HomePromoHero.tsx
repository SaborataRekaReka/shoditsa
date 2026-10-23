import { HOME_HERO_COPY } from '../../app/home-copy'
import { publicAssetUrl } from '../../app/public-asset'
import './home-promo-hero.css'

/** The Shop promotion's composition, using Shoditsa copy and original artwork. */
export function HomePromoHero() {
  return <>
    <header className="hs-promo-hero" aria-labelledby="home-hero-heading">
      <div className="hs-promo-copy">
        <h1 id="home-hero-heading">{HOME_HERO_COPY.heading}</h1>
        <p>Новые загадки <strong>каждый день</strong></p>
        <a className="quest-button quest-button--promo hs-promo-play" href="#home-games">{HOME_HERO_COPY.playLabel}</a>
      </div>
      <div className="hs-promo-scene" aria-hidden="true">
        <img src={publicAssetUrl('images/shoditsa-study/home-promo-v1.webp')} alt="" width="420" height="525" fetchPriority="high" />
      </div>
      <span className="hs-promo-spark hs-promo-spark--one" aria-hidden="true" />
      <span className="hs-promo-spark hs-promo-spark--two" aria-hidden="true" />
    </header>
    <div className="hs-home-intro">
      <p>{HOME_HERO_COPY.lead}</p>
    </div>
  </>
}

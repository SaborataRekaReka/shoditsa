import type { PlayableModeId } from '@shoditsa/contracts'
import { GAME_SEO, HOME_SEO, INDEXABLE_GAME_SEO } from '../../app/seo-content'
import './SeoContent.css'

export function HomeSeoContent() {
  return <section className="seo-content seo-content--home" aria-labelledby="home-about-title">
    <span className="seo-content__eyebrow">Игры на каждый день</span>
    <h2 id="home-about-title">{HOME_SEO.heading}</h2>
    <p className="seo-content__lead">{HOME_SEO.lead}</p>
    {HOME_SEO.paragraphs.map((paragraph) => <p key={paragraph}>{paragraph}</p>)}
    <nav className="seo-content__game-links" aria-label="Все ежедневные игры">
      {INDEXABLE_GAME_SEO.map((game) => <a key={game.mode} href={game.canonicalPath}>{game.shortName}</a>)}
    </nav>
  </section>
}

export function GameSeoContent({ mode }: { mode: PlayableModeId }) {
  const content = GAME_SEO[mode]
  return <article className="seo-content seo-content--game" aria-labelledby={`about-${mode}`}>
    <nav className="seo-breadcrumbs" aria-label="Хлебные крошки">
      <a href="/">Сходится!</a><span aria-hidden="true">/</span><span>{content.shortName}</span>
    </nav>
    <span className="seo-content__eyebrow">Об игре</span>
    <h2 id={`about-${mode}`}>{content.heading}</h2>
    <p className="seo-content__lead">{content.lead}</p>
    {content.paragraphs.map((paragraph) => <p key={paragraph}>{paragraph}</p>)}

    <div className="seo-content__columns">
      <section>
        <h3>Какие подсказки доступны</h3>
        <ul>{content.features.map((feature) => <li key={feature}>{feature}</li>)}</ul>
      </section>
      <section>
        <h3>Как играть</h3>
        <ol>{content.steps.map((step) => <li key={step}>{step}</li>)}</ol>
      </section>
    </div>

    <section className="seo-content__faq" aria-labelledby={`faq-${mode}`}>
      <h3 id={`faq-${mode}`}>Вопросы об игре</h3>
      <div>{content.faq.map((entry) => <section key={entry.question}><h4>{entry.question}</h4><p>{entry.answer}</p></section>)}</div>
    </section>
  </article>
}

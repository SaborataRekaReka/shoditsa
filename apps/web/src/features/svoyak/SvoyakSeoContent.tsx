import React from 'react'
import { PUBLIC_INDEXABLE_GAME_SEO, SVOYAK_SEO } from '../../app/seo-content'
import { ArrowUpRight, ChevronDown } from 'lucide-react'

/** Shared by the live page and its crawlable HTML, without private room data. */
export function SvoyakSeoContent() {
  const content = SVOYAK_SEO
  return <React.Fragment><div className="game-landing game-landing--svoyak">
    <section className="game-landing__intro" aria-labelledby="svoyak-about-title">
      <header><h2 id="svoyak-about-title">{content.heading}</h2><p className="game-landing__lead">{content.lead}</p></header>
      <div className="game-landing__story">{content.paragraphs.map(paragraph => <p key={paragraph}>{paragraph}</p>)}</div>
    </section>
    <div className="game-landing__comparison">
      <section aria-labelledby="svoyak-features-title"><h2 id="svoyak-features-title">Что есть в игре</h2><ul>{content.features.map(feature => <li key={feature}>{feature}</li>)}</ul></section>
      <section aria-labelledby="svoyak-start-title"><h2 id="svoyak-start-title">Как начать партию с друзьями</h2><ol>{content.steps.map(step => <li key={step}>{step}</li>)}</ol></section>
    </div>
    <section className="game-landing__faq" aria-labelledby="svoyak-faq-title">
      <h2 id="svoyak-faq-title">Вопросы о «Своей игре»</h2>
      <div>{content.faq.map(entry => <details key={entry.question}><summary><span>{entry.question}</span><ChevronDown aria-hidden="true" /></summary><p>{entry.answer}</p></details>)}</div>
    </section>
    <details className="game-landing__method"><summary><span>Как подбираются вопросы</span><ChevronDown aria-hidden="true" /></summary><div><p>{content.collectionMethod.text}</p></div></details>
    <nav className="game-landing__games" aria-label="Другие игры"><h2>Во что ещё сыграть</h2><div>{PUBLIC_INDEXABLE_GAME_SEO.filter(game => game.mode !== 'svoyak').map(game => <a key={game.mode} href={game.canonicalPath}><span aria-hidden="true">→</span><span>{game.internalLinkLabel ?? game.shortName}</span><ArrowUpRight size={18} aria-hidden="true" /></a>)}</div></nav>
  </div></React.Fragment>
}

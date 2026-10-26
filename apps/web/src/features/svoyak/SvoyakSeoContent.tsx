import React from 'react'
import { PUBLIC_INDEXABLE_GAME_SEO, SVOYAK_SEO } from '../../app/seo-content'
import { GameDiscovery, GameFaq } from '../../components/game-information/GameInformation'

/** Shared by the live page and its crawlable HTML, without private room data. */
export function SvoyakSeoContent() {
  const content = SVOYAK_SEO
  return <React.Fragment><div className="svoyak-guide">
    <section className="svoyak-guide__intro" aria-labelledby="svoyak-about-title">
      <header><h2 id="svoyak-about-title">{content.heading}</h2><p className="svoyak-guide__lead">{content.lead}</p></header>
      <div className="svoyak-guide__story">{content.paragraphs.map(paragraph => <p key={paragraph}>{paragraph}</p>)}</div>
    </section>
    <div className="svoyak-guide__comparison">
      <section aria-labelledby="svoyak-features-title"><h2 id="svoyak-features-title">Что есть в игре</h2><ul>{content.features.map(feature => <li key={feature}>{feature}</li>)}</ul></section>
      <section aria-labelledby="svoyak-start-title"><h2 id="svoyak-start-title">Как начать партию с друзьями</h2><ol>{content.steps.map(step => <li key={step}>{step}</li>)}</ol></section>
    </div>
    <GameFaq id="svoyak-faq-title" title="Вопросы о «Своей игре»" entries={content.faq} />
    <section className="svoyak-guide__method" aria-labelledby="svoyak-method-title"><h3 id="svoyak-method-title">Как подбираются вопросы</h3><p>{content.collectionMethod.text}</p></section>
    <GameDiscovery title="Во что ещё сыграть" label="Другие игры" heading="h2" links={PUBLIC_INDEXABLE_GAME_SEO.filter(game => game.mode !== 'svoyak').map(game => ({ id: game.mode, mode: game.mode, href: game.canonicalPath, label: game.internalLinkLabel ?? game.shortName }))} />
  </div></React.Fragment>
}

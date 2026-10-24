import React from 'react'
import { Plus } from 'lucide-react'

type GameFaqEntry = { question: string; answer: string }
export type GameDiscoveryLink = { id: string; href: string; label: string; mode?: string }

/** Native disclosures keep every answer in both the live and pre-boot HTML. */
export function GameFaq({ id, title, entries, heading: Heading = 'h2' }: {
  id: string
  title: string
  entries: readonly GameFaqEntry[]
  heading?: 'h2' | 'h3' | 'h4'
}): React.ReactElement {
  return <section className="game-faq" aria-labelledby={id}>
    <header className="game-information-heading"><Heading id={id}>{title}</Heading></header>
    <div className="game-faq__items">{entries.map(entry => <details className="game-faq__item" key={entry.question}>
      <summary><span>{entry.question}</span><Plus size={18} aria-hidden="true" /></summary>
      <p>{entry.answer}</p>
    </details>)}</div>
  </section>
}

/** One quiet internal link per game. Icons match the main catalogue. */
export function GameDiscovery({ title, label = title, links, heading: Heading = 'h3', baseUrl = '/' }: {
  title: string
  label?: string
  links: readonly GameDiscoveryLink[]
  heading?: 'h2' | 'h3'
  baseUrl?: string
}): React.ReactElement {
  const base = baseUrl.endsWith('/') ? baseUrl : `${baseUrl}/`
  return <section className="game-discovery">
    <header className="game-information-heading"><Heading>{title}</Heading></header>
    <nav className="game-discovery__links" aria-label={label}>{links.map(link => {
      const art = link.mode === 'danetki' ? 'yes-no' : link.mode
      return <a className={`game-discovery__link${art ? '' : ' game-discovery__link--text'}`} key={link.id} href={link.href}>
        {art && <span className="game-discovery__art" aria-hidden="true">
          <img className="game-discovery__day" src={`${base}images/home-doodle/${art}.webp`} alt="" width="32" height="32" loading="lazy" />
          <img className="game-discovery__night" src={`${base}images/home-doodle/dark-v2/${art}.webp`} alt="" width="32" height="32" loading="lazy" />
        </span>}
        <span>{link.label}</span>
      </a>
    })}</nav>
  </section>
}

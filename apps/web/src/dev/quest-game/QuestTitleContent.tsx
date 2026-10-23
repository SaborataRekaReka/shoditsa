import { GameArtwork } from '../../components/ui/GameArtwork'
import { BookOpen, Check, ChevronDown, Minus, MoveUp } from 'lucide-react'
import { DANETKI_RULES, GAME_GUIDE_PRESENTATION, GAME_RULES, GAME_SEO, INDEXABLE_GAME_SEO, type GameSeoContent, type SeoGameMode } from '../../app/seo-content'
import { DANETKI_RECOMMENDATIONS } from '../../app/danetki-recommendation-copy'
import { StudyGlyph } from './ShoditsaPresentation'
import type { GlyphName } from './QuestArt'
import { StudyGameDirectory } from './StudyGameDirectory'

const featureGlyphs: GlyphName[] = ['play', 'archive', 'profile', 'medal']
const stepGlyphs: GlyphName[] = ['play', 'hint', 'medal']
const linkLabel = (game: GameSeoContent) => game.internalLinkLabel ?? game.shortName

// The presentation may change; the copy and destinations remain owned by the
// same content sources as the live title. All disclosure content stays in HTML.
export function QuestTitleContent({ mode = 'anime' }: { mode?: SeoGameMode }) {
  const content: GameSeoContent = GAME_SEO[mode]
  const presentation = GAME_GUIDE_PRESENTATION[mode]
  const rules = mode === 'danetki' ? DANETKI_RULES : GAME_RULES[mode]
  const comparable = mode !== 'danetki' && mode !== 'connections'
  return <div className="qt-content">
    <section className="qt-guide" aria-labelledby={`about-${mode}`}>
      <header className="qt-guide-intro">
        {mode !== 'diagnosis' && <span>{presentation.introLabel.replace(/\s*[\u00b7\u2022]\s*/g, ' ')}</span>}
        <h3 id={`about-${mode}`}>{content.heading}</h3>
        <p>{content.lead}</p>
      </header>

      <section className="qt-features" aria-labelledby={`artifact-features-${mode}`}>
        <div className="qt-section-heading"><span>{presentation.evidenceLabel}</span><h4 id={`artifact-features-${mode}`}>{presentation.evidenceTitle}</h4></div>
        <ul>{content.features.map((feature, index) => <li key={feature}><StudyGlyph name={featureGlyphs[index % featureGlyphs.length]} size={35} /><span>{feature}</span></li>)}</ul>
      </section>

      <section className="qt-route" aria-labelledby={`artifact-steps-${mode}`}>
        <div className="qt-section-heading"><span>{presentation.routeLabel}</span><h4 id={`artifact-steps-${mode}`}>{presentation.routeTitle}</h4></div>
        <ol>{content.steps.map((step, index) => <li className="qg-card qt-route-card" key={step}>
          <div className="qt-route-art"><StudyGlyph name={stepGlyphs[index % stepGlyphs.length]} size={62} /><span aria-hidden="true">{String(index + 1).padStart(2, '0')}</span></div>
          <div><p>{step}</p>{comparable && index === 1 && <div className="qt-match-preview" aria-hidden="true"><span><Check size={16} strokeWidth={3} /></span><span><MoveUp size={16} strokeWidth={3} /></span><span><Minus size={16} strokeWidth={3} /></span></div>}</div>
        </li>)}</ol>
      </section>

      <section className="qt-reference" aria-label="Правила и справка">
        <details className="qg-card qt-disclosure qt-rule-card">
          <summary><StudyGlyph name="hint" size={42} /><span><small>Правила игры</small><h4 id={`artifact-rules-${mode}`}>Как играть</h4></span><ChevronDown size={20} /></summary>
          <div className="qt-disclosure-body">
            <ol className="qt-instructions"><li>{rules.searchInstruction}</li><li>{rules.comparisonInstruction}</li><li>{comparable ? 'Перед пятой и восьмой попытками можно открыть по одной из трёх дополнительных подсказок.' : rules.directionInstruction}</li></ol>
            {comparable && <div className="qt-legend" aria-label="Значения цветов подсказок">
              <div><i className="is-exact"><Check size={16} strokeWidth={3} /></i><span><strong>Точно</strong><small>значение совпало</small></span></div>
              <div><i className="is-close">≈</i><span><strong>Рядом</strong><small>число близко или есть частичное совпадение</small></span></div>
              <div><i className="is-miss"><Minus size={16} strokeWidth={3} /></i><span><strong>Мимо</strong><small>значение не совпало</small></span></div>
            </div>}
            {comparable && rules.directionInstruction && <p>{rules.directionInstruction}</p>}{rules.modeNote && <p>{rules.modeNote}</p>}
          </div>
        </details>

        <details className="qg-card qt-disclosure qt-collection-card">
          <summary><StudyGlyph name="archive" size={42} /><span><small>Происхождение каталога</small><h4 id={`artifact-collection-${mode}`}>Как собран набор</h4></span><ChevronDown size={20} /></summary>
          <div className="qt-disclosure-body"><p>{content.collectionMethod.text}</p><div className="qt-source-links">{content.collectionMethod.sources.map(source => <a key={source.url} href={source.url} target="_blank" rel="noreferrer">{source.label}<span aria-hidden="true">↗</span></a>)}</div></div>
        </details>
      </section>

      <section className="qt-faq" aria-labelledby={`artifact-faq-${mode}`}>
        <div className="qt-section-heading"><h4 id={`artifact-faq-${mode}`}>Вопросы об игре</h4></div>
        <div className="qt-faq-answers">{content.faq.map(entry => <details className="qt-disclosure qt-faq-item" key={entry.question}><summary><span>{entry.question}</span><ChevronDown size={19} /></summary><div className="qt-disclosure-body"><p>{entry.answer}</p></div></details>)}</div>
      </section>
    </section>

    <section className="qt-search-summary" aria-labelledby={content.searchSummary ? `search-summary-${mode}` : undefined} aria-label={content.searchSummary ? undefined : 'Подробнее об игре'}>
      <details className="qt-disclosure qt-story-card">
        <summary><BookOpen size={22} aria-hidden="true" /><span>{content.searchSummary ? <><small>Об игре</small><h2 id={`search-summary-${mode}`}>{content.searchSummary.heading}</h2></> : <strong>Подробнее об игре</strong>}</span><ChevronDown size={20} /></summary>
        <div className="qt-disclosure-body">{content.searchSummary?.paragraphs.map(paragraph => <p key={paragraph}>{paragraph}</p>)}{content.searchSummary?.action && <div className="qt-source-links"><a href={content.searchSummary.action.href}>{content.searchSummary.action.label}</a></div>}{content.searchSummary && <strong className="qt-story-label">Подробнее об игре</strong>}{content.paragraphs.map(paragraph => <p key={paragraph}>{paragraph}</p>)}</div>
      </details>
      {content.searchSummary && !!content.relatedModes?.length && <nav className="qt-related" aria-label="Похожие игры"><span>Попробуйте также</span><div>{content.relatedModes.map(mode => { const game = GAME_SEO[mode]; return <a href={game.canonicalPath} key={mode}>{linkLabel(game)}</a> })}</div></nav>}
    </section>

    <StudyGameDirectory title="Другие игры" games={INDEXABLE_GAME_SEO.filter(game => game.mode !== mode).map(game => ({ mode: game.mode, href: game.canonicalPath, label: linkLabel(game) }))} />
    {mode === 'danetki' && <section className="qt-recommendations" aria-labelledby="danetki-recommendations-landing-bottom">
      <div className="qt-section-heading"><span>Маршрут продолжается</span><h2 id="danetki-recommendations-landing-bottom">Ещё три игры, где важна хорошая версия</h2><p>Выберите следующий короткий раунд — правила объяснятся по ходу игры.</p></div>
      <div>{DANETKI_RECOMMENDATIONS.map(item => <a className="qg-card" href={GAME_SEO[item.mode].canonicalPath} key={item.mode}>
        <GameArtwork mode={item.mode} alt="" width="58" height="58" loading="lazy" /><span><small>{item.kicker}</small><strong>{item.title}</strong><span>{item.description}</span></span><b>Играть</b>
      </a>)}</div>
    </section>}
  </div>
}

import { useId, useMemo } from 'react'
import { BookOpen, ChevronRight } from 'lucide-react'
import { APPLICATION_DESIGN } from '../../app/application-design'
import { QuestButton } from '../../components/ui/QuestPrimitives'
import { ReferenceIcon } from '../../components/ui/ReferenceIcon'
import { REFERENCE_PRESENTATION } from '../../app/local-presentation'
import { publicAssetUrl } from '../../app/public-asset'
import { HorizontalScrollLane } from '../../components/horizontal-scroll-lane/HorizontalScrollLane'
import { ControlButton, TextButton } from '../../components/ui'
import { collectMatchSummaryTags } from '../../game/match-summary'
import type { Attempt, TitleMode } from '../../types'
import './GameMatchStrip.css'

type GameMatchStripProps = {
  attempts: Attempt[]
  mode: TitleMode
  open: boolean
  onToggle: () => void
  onRules?: () => void
}

/** Keeps the same accumulated matches and controlled disclosure in both skins. */
export function GameMatchStrip({ attempts, mode, open, onToggle, onRules }: GameMatchStripProps) {
  const tags = useMemo(() => collectMatchSummaryTags(attempts, mode), [attempts, mode])
  const referencePanelId = useId()

  if (APPLICATION_DESIGN) return <div className="application-match-strip">
    <div className="application-match-strip__toolbar">
      {!!attempts.length && <QuestButton kind="text" size="compact" onClick={onToggle} aria-expanded={open} aria-controls={referencePanelId}>Совпадения{tags.length ? `: ${tags.length}` : ''}<ChevronRight size={16} /></QuestButton>}
      {onRules && <QuestButton kind="text" size="compact" onClick={onRules}><BookOpen size={16} />Правила игры</QuestButton>}
    </div>
    {!!attempts.length && <div id={referencePanelId} hidden={!open} className="application-match-strip__panel">
      {tags.length ? <ul>{tags.map(tag => <li key={tag.id}><small>{tag.label}</small><strong>{tag.value}</strong></li>)}</ul> : <p>Пока нет совпадений. Проверь другую версию.</p>}
    </div>}
  </div>

  if (REFERENCE_PRESENTATION) return <div className={`reference-match-strip${open ? ' is-open' : ''}`}>
    <div className="reference-match-strip__toolbar">
      <TextButton
        type="button"
        className="reference-match-strip__toggle"
        onClick={onToggle}
        aria-expanded={open}
        aria-controls={referencePanelId}
      >
        <span>Что уже сходится</span>
        <ChevronRight aria-hidden="true" />
      </TextButton>
      {onRules && <TextButton type="button" className="reference-match-strip__rules" onClick={onRules}>
        <ReferenceIcon name="guide" />
        <span>Правила игры</span>
      </TextButton>}
    </div>
    <div className="reference-match-strip__panel" id={referencePanelId} hidden={!open}>
      {tags.length ? <ul className="reference-match-strip__tags" tabIndex={0} aria-label="Совпавшие признаки">
        {tags.map((tag) => <li key={tag.id} className="reference-match-strip__tag">
          <span className="reference-match-strip__tag-label">{tag.label}:</span>
          <span className="reference-match-strip__tag-value">{tag.value}</span>
        </li>)}
      </ul> : <p className="reference-match-strip__empty">
        {attempts.length ? 'Пока совпадений нет. Попробуй другой ответ.' : 'Здесь появятся совпавшие признаки после первой попытки.'}
      </p>}
    </div>
  </div>

  return <div className={`game-match-strip ${open ? 'is-open' : ''}`}>
    <ControlButton
      type="button"
      className="game-match-strip__toggle"
      onClick={onToggle}
      aria-expanded={open}
      aria-controls="game-match-strip-panel"
    >
      <span className="game-match-strip__logo" aria-hidden="true"><img src={publicAssetUrl('images/symbol.svg')} alt="" /></span>
      <span className="game-match-strip__title">Что сходится</span>
      <ChevronRight aria-hidden="true" />
    </ControlButton>
    <div className="game-match-strip__panel" id="game-match-strip-panel" aria-hidden={!open}>
      <HorizontalScrollLane className="game-match-strip__tags">
        {tags.length
          ? tags.map((tag) => <span key={tag.id} className="game-match-strip__tag"><small>{tag.label}</small><span>{tag.value}</span></span>)
          : <span className="game-match-strip__empty">{attempts.length ? 'Пока совпадений нет' : 'Появится после первой попытки'}</span>}
      </HorizontalScrollLane>
    </div>
  </div>
}

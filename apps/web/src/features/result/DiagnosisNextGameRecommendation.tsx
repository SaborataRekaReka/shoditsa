import type { CSSProperties } from 'react'
import { ArrowRight } from 'lucide-react'
import { MODE_CONFIG } from '../../app/mode-config'
import { MODE_PRESENTATION } from '../../app/mode-presentation'
import { ControlButton } from '../../components/ui'
import { GameArtwork } from '../../components/ui/GameArtwork'
import type { TitleMode } from '../../types'
import './DiagnosisNextGameRecommendation.css'

const recommendationCopy: Partial<Record<TitleMode, { title: string; reason: string }>> = {
  animal: {
    title: 'Угадай животное',
    reason: 'Знакомая логика: сравнивайте признаки и сужайте круг ответов — теперь по классу и среде обитания.',
  },
  character: {
    title: 'Угадай персонажа',
    reason: 'Знакомая логика: каждый ответ помогает найти героя по происхождению, роли и способностям.',
  },
  book: {
    title: 'Угадай книгу',
    reason: 'Знакомая логика: сравнивайте автора, эпоху и жанры, чтобы найти загаданную книгу.',
  },
}

/** The existing route chooses an unfinished game; its callback owns click/start attribution. */
export function DiagnosisNextGameRecommendation({ mode, onSelect }: {
  mode?: TitleMode
  onSelect: (mode: TitleMode) => void
}) {
  if (!mode || mode === 'diagnosis') return null
  const presentation = MODE_PRESENTATION[mode]
  const copy = recommendationCopy[mode]
  const title = copy?.title ?? MODE_CONFIG[mode].title
  return <section className="result-recommendations result-recommendations--focused result-card__wide" aria-label="Следующая игра после Диагнозов" data-recommendation-variant="single-v1">
    <header><div><strong>Знакомая логика, новая загадка</strong></div></header>
    <div>
      <ControlButton
        type="button"
        style={{ '--result-recommendation-color': presentation.color } as CSSProperties}
        aria-label={`Попробовать «${title}»`}
        onClick={() => onSelect(mode)}
      >
        <span className="result-recommendations__art" aria-hidden="true"><GameArtwork mode={mode} alt="" width="112" height="112" loading="lazy" /></span>
        <span className="result-recommendations__copy"><strong>{title}</strong><small>{copy?.reason ?? presentation.description}</small></span>
        <span className="result-recommendations__action" aria-hidden="true"><span>Попробовать</span><ArrowRight /></span>
      </ControlButton>
    </div>
  </section>
}

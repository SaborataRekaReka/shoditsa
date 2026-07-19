import { Check } from 'lucide-react'
import type { CSSProperties } from 'react'
import type { TitleMode } from '../../types'
import { DAILY_MODE_LABELS, DAILY_MODE_ORDER } from './daily-progress'

export function ProgressPunches({ completedModes, caption }: { completedModes: TitleMode[]; caption: string }) {
  const completed = new Set(completedModes)
  return <div className="progress-punches-wrap">
    <div className="progress-punches" role="list" aria-label={`${DAILY_MODE_ORDER.length} ежедневных игр`}>
      {DAILY_MODE_ORDER.map((mode, index) => {
        const isCompleted = completed.has(mode)
        return <span
          className={`progress-punch ${isCompleted ? 'is-completed' : 'is-pending'}`}
          style={{ '--punch-index': index } as CSSProperties}
          role="listitem"
          aria-label={`${DAILY_MODE_LABELS[mode]} ${isCompleted ? 'завершено' : 'не завершено'}`}
          key={mode}
        >{isCompleted && <Check aria-hidden="true" />}</span>
      })}
    </div>
    <p className="progress-punches__caption">{caption}</p>
  </div>
}

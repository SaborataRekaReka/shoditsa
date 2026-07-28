import type { ReactNode } from 'react'
import './Progress.css'

export function SegmentedProgress({ value, max = 10, label = 'Использовано попыток', valueLabel, className = '' }: {
  value: number
  max?: number
  label?: ReactNode
  valueLabel?: ReactNode
  className?: string
}) {
  return <div className={`progress-block ui-segmented-progress ${className}`.trim()}>
    <div className="progress-copy"><span>{label}</span><strong>{valueLabel ?? <>{Math.min(value, max)} <i>из {max}</i></>}</strong></div>
    <div className="progress-track" aria-label={`${String(label)}: ${value} из ${max}`}>
      {Array.from({ length: max }, (_, index) => <i key={index} className={index < value ? 'used' : ''} />)}
    </div>
  </div>
}

export function LinearProgress({ value, max, label, valueLabel, className = '' }: {
  value: number
  max: number
  label?: ReactNode
  valueLabel?: ReactNode
  className?: string
}) {
  const percent = max > 0 ? Math.max(0, Math.min(100, Math.round(value / max * 100))) : 0
  return <div className={`ui-linear-progress ${className}`.trim()} aria-label={typeof label === 'string' ? `${label}: ${value} из ${max}` : `Прогресс: ${value} из ${max}`}>
    {(label || valueLabel) && <span className="ui-linear-progress__copy">
      <span>{valueLabel ?? <><strong>{value}</strong> / {max}</>}</span>
      {label && <span>{label}</span>}
    </span>}
    <i aria-hidden="true"><b style={{ width: `${percent}%` }} /></i>
  </div>
}

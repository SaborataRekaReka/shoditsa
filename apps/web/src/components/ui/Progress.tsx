import type { ReactNode } from 'react'
import './Progress.css'

export function SegmentedProgress({ value, max = 10, segments = max, label = 'Использовано попыток', valueLabel, className = '' }: {
  value: number
  max?: number
  segments?: number
  label?: ReactNode
  valueLabel?: ReactNode
  className?: string
}) {
  const segmentCount = Math.max(1, Math.round(segments))
  const usedSegments = value <= 0 || max <= 0 ? 0 : Math.min(segmentCount, Math.ceil(value / max * segmentCount))
  return <div className={`progress-block ui-segmented-progress ${className}`.trim()}>
    <div className="progress-copy"><span>{label}</span><strong>{valueLabel ?? <>{Math.min(value, max)} <i>из {max}</i></>}</strong></div>
    <div className="progress-track" role="progressbar" aria-label={`${String(label)}: ${value} из ${max}`} aria-valuemin={0} aria-valuemax={max} aria-valuenow={value} style={{ gridTemplateColumns: `repeat(${segmentCount}, minmax(0, 1fr))` }}>
      {Array.from({ length: segmentCount }, (_, index) => <i key={index} className={index < usedSegments ? 'used' : ''} />)}
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

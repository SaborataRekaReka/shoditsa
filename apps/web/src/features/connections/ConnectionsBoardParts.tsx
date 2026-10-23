import { forwardRef, type ButtonHTMLAttributes } from 'react'
import type { ConnectionsColor } from '@shoditsa/contracts'
import { X } from 'lucide-react'
import { ControlButton } from '../../components/ui'
import './ConnectionsGamePage.css'

/** The word tile is shared by the live board and the component catalogue. */
export const ConnectionsTile = forwardRef<HTMLButtonElement, ButtonHTMLAttributes<HTMLButtonElement> & {
  label: string
  selected?: boolean
  selectionNumber?: number
}>(function ConnectionsTile({ label, selected = false, selectionNumber, className = '', ...props }, ref) {
  return <ControlButton
    {...props}
    ref={ref}
    className={`connections-tile${selected ? ' is-selected' : ''}${className ? ` ${className}` : ''}`}
    aria-pressed={selected}
  >
    {selected && selectionNumber != null && <small className="connections-tile__number" aria-hidden="true">{selectionNumber}</small>}
    <span className={`connections-tile__label${label.length > 7 ? ' is-long' : ''}`}>{label}</span>
  </ControlButton>
})

export function ConnectionsSolvedGroup({ title, words, color, autoSolved = false }: {
  title: string
  words: readonly string[]
  color: ConnectionsColor
  autoSolved?: boolean
}) {
  return <article className={`connections-solved__group connections-color--${color}`}>
    <strong>{title}</strong>
    <span>{words.join(', ')}</span>
    {autoSolved && <small>последняя группа раскрыта автоматически</small>}
  </article>
}

export function ConnectionsMistakes({ used, total = 4, label = 'Ошибки' }: {
  used: number
  total?: number
  label?: string
}) {
  return <span className="connections-mistakes" aria-label={`Ошибок: ${used} из ${total}`}>
    <span>{label}</span>
    {Array.from({ length: total }, (_, index) => (
      <i key={index} className={index < used ? 'is-used' : ''} aria-hidden="true">
        {index < used ? <X /> : null}
      </i>
    ))}
  </span>
}

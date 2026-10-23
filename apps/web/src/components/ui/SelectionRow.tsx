import { forwardRef, type ButtonHTMLAttributes, type ReactNode } from 'react'
import { Check, ChevronRight } from 'lucide-react'
import { ControlButton } from './UiControls'
import './SelectionRow.css'

/** A list item that selects or opens one entity, rather than a pill action. */
export const SelectionRow = forwardRef<HTMLButtonElement, Omit<ButtonHTMLAttributes<HTMLButtonElement>, 'title'> & {
  title: ReactNode
  description?: ReactNode
  leading?: ReactNode
  selected?: boolean
  highlighted?: boolean
  compact?: boolean
}>(function SelectionRow({ title, description, leading, selected = false, highlighted = false, compact = false, className = '', ...props }, ref) {
  return <ControlButton ref={ref} className={`ui-selection-row${selected ? ' is-selected' : ''}${highlighted ? ' is-highlighted' : ''}${compact ? ' ui-selection-row--compact' : ''} ${className}`.trim()} {...props}>
    {leading && <span className="ui-selection-row__leading">{leading}</span>}
    <span className="ui-selection-row__text"><strong>{title}</strong>{description && <small>{description}</small>}</span>
    <span className="ui-selection-row__end" aria-hidden="true">{selected ? <Check size={18} /> : <ChevronRight size={17} />}</span>
  </ControlButton>
})

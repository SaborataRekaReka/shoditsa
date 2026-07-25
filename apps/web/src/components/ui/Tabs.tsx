import type { ReactNode } from 'react'
import { ControlButton } from './UiControls'
import './Tabs.css'

export type TabItem<T extends string> = {
  id: T
  label: ReactNode
  disabled?: boolean
}

export function Tabs<T extends string>({ items, value, onChange, label, className = '', activeClassName = 'is-active', surface = 'dark' }: {
  items: ReadonlyArray<TabItem<T>>
  value: T
  onChange: (value: T) => void
  label: string
  className?: string
  activeClassName?: string
  surface?: 'paper' | 'dark'
}) {
  return <div className={`ui-tabs ui-tabs--${surface} ${className}`.trim()} role="tablist" aria-label={label}>
    {items.map((item) => <ControlButton
      key={item.id}
      role="tab"
      aria-selected={value === item.id}
      className={value === item.id ? activeClassName : ''}
      disabled={item.disabled}
      onClick={() => onChange(item.id)}
    >{item.label}</ControlButton>)}
  </div>
}

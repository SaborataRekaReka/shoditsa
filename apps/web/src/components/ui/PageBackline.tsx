import type { MouseEventHandler, ReactNode } from 'react'
import { ArrowLeft } from 'lucide-react'
import { ControlButton } from './UiControls'
import './PageBackline.css'

/** A consistent return link above game and room pages. */
export function PageBackline({ href, label, trailing, onClick, onBack, className = '' }: {
  href?: string
  label: string
  trailing?: ReactNode
  onClick?: MouseEventHandler<HTMLAnchorElement>
  onBack?: () => void
  className?: string
}) {
  const content = <><ArrowLeft size={18} aria-hidden="true" />{label}</>
  return <div className={`ui-page-backline ${className}`.trim()}>
    {href ? <a href={href} onClick={onClick}>{content}</a> : <ControlButton type="button" onClick={onBack}>{content}</ControlButton>}
    {trailing}
  </div>
}

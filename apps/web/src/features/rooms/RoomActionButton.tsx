import type { ComponentProps } from 'react'
import { ActionButton } from '../../components/ui/UiControls'
import { QuestButton } from '../../components/ui/QuestPrimitives'
import { APPLICATION_DESIGN } from '../../app/application-design'

/** Existing multiplayer controllers use the same public controls as the rest of the site. */
export function RoomActionButton({ variant = 'primary', surface, className = '', ...props }: ComponentProps<typeof ActionButton>) {
  if (!APPLICATION_DESIGN) return <ActionButton variant={variant} surface={surface} className={className} {...props} />
  const kind = variant === 'primary' ? 'primary' : variant === 'ghost' ? 'text' : 'outline'
  return <QuestButton kind={kind} className={`${variant === 'danger' ? 'room-action-danger' : ''} ${className}`.trim()} {...props} />
}

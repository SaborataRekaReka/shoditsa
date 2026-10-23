import type { ComponentProps } from 'react'
import { createPortal } from 'react-dom'
import { QuestDialog } from '../../components/ui/QuestPrimitives'

/** Dialogs escape the centre column's container-query stacking context. */
export function ApplicationDialog({ className = '', ...props }: ComponentProps<typeof QuestDialog> & { className?: string }) {
  const content = <div className={`application-overlay ${className}`.trim()} data-public-theme="quest-study" data-quest-skin="shoditsa"><QuestDialog {...props} /></div>
  return typeof document === 'undefined' ? content : createPortal(content, document.body)
}

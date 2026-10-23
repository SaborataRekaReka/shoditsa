import { forwardRef, type ButtonHTMLAttributes } from 'react'
import { ControlButton } from './UiControls'
import './QuestionPriceButton.css'

/** A numbered game cell; ordinary actions continue to use QuestButton. */
export const QuestionPriceButton = forwardRef<HTMLButtonElement, ButtonHTMLAttributes<HTMLButtonElement> & {
  price: number
  played?: boolean
}>(function QuestionPriceButton({ price, played = false, className = '', disabled, ...props }, ref) {
  return <ControlButton ref={ref} {...props} disabled={played || disabled} className={`question-price-button${played ? ' question-price-button--played' : ''} ${className}`.trim()}>
    <span aria-hidden="true">{played ? '' : price}</span>
  </ControlButton>
})

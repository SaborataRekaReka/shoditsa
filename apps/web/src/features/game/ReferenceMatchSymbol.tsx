import { ArrowDown, ArrowUp, Check, CircleHelp, Minus, X } from 'lucide-react'

export type ReferenceMatchKind = 'match' | 'partial' | 'miss' | 'up' | 'down' | 'unknown'

const symbols = {
  match: Check,
  partial: Minus,
  miss: X,
  up: ArrowUp,
  down: ArrowDown,
  unknown: CircleHelp,
} as const

export function ReferenceMatchSymbol({ kind, className = '' }: { kind: ReferenceMatchKind; className?: string }) {
  const Symbol = symbols[kind]
  return <Symbol
    className={`reference-match-symbol reference-match-symbol--${kind} ${className}`.trim()}
    size={20}
    strokeWidth={2}
    aria-hidden="true"
    focusable="false"
  />
}

import type { HTMLAttributes, ReactNode } from 'react'
import { ScreenBack } from '../app-shell/AppShell'

type GameScreenShellProps = Omit<HTMLAttributes<HTMLElement>, 'children'> & {
  children: ReactNode
  onBack: () => void
  variant: 'title' | 'session'
  backLabel?: string
  status?: ReactNode
  wide?: boolean
}

/** Stable platform frame shared by every game title and live session. */
export function GameScreenShell({ children, onBack, variant, backLabel = 'Назад', status, wide = false, className = '', ...props }: GameScreenShellProps) {
  return <main className={`game-screen-shell game-screen-shell--${variant} ${className}`.trim()} {...props}>
    <ScreenBack
      onBack={onBack}
      label={backLabel}
      keyboardShortcut={false}
      trailing={status}
      className="game-screen-shell__nav"
    />
    <div className={`game-screen-shell__content game-screen-shell__content--${variant}${wide ? ' game-screen-shell__content--wide' : ''}`}>
      {children}
    </div>
  </main>
}

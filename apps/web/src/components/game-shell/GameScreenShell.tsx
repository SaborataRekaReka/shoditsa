import { useContext, type HTMLAttributes, type ReactNode } from 'react'
import { EmbeddedApplicationContext } from '../../features/application/EmbeddedApplicationContext'
import { ScreenBack } from '../app-shell/AppShell'
import './GameScreenShell.css'

type GameScreenShellProps = Omit<HTMLAttributes<HTMLElement>, 'children'> & {
  children: ReactNode
  onBack: () => void
  variant: 'title' | 'session'
  backLabel?: string
  status?: ReactNode
  wide?: boolean
  presentation?: 'default' | 'sidebar' | 'landing'
}

/** Stable platform frame shared by every game title and live session. */
export function GameScreenShell({ children, onBack, variant, backLabel = 'Назад', status, wide = false, presentation = 'default', className = '', ...props }: GameScreenShellProps) {
  const embedded = useContext(EmbeddedApplicationContext)
  const embeddedSession = embedded && variant === 'session'
  return <main className={`game-screen-shell game-screen-shell--${variant}${wide ? ' game-screen-shell--wide' : ''}${presentation !== 'default' ? ` game-screen-shell--${presentation}` : ''}${embeddedSession ? ' application-session-main' : ''} ${className}`.trim()} {...props}>
    {embedded ? status && <div className="application-session-status">{status}</div> : <ScreenBack
      onBack={onBack}
      label={backLabel}
      keyboardShortcut={false}
      trailing={status}
      className="game-screen-shell__nav"
    />}
    <div className={`game-screen-shell__content game-screen-shell__content--${variant}${wide ? ' game-screen-shell__content--wide' : ''}`}>
      {children}
    </div>
  </main>
}

import type { ReactNode } from 'react'
import { ScreenBack } from '../../components/app-shell/AppShell'

type DanetkiShellProps = {
  children: ReactNode
  onBack: () => void
  className?: string
  backLabel?: string
  status?: ReactNode
}

export function DanetkiShell({ children, onBack, className = '', backLabel = 'Назад', status }: DanetkiShellProps) {
  return <main className={`danetki-shell ${className}`.trim()}>
    <ScreenBack
      onBack={onBack}
      label={backLabel}
      keyboardShortcut={false}
      trailing={status}
      className="danetki-shell__nav"
    />
    {children}
  </main>
}

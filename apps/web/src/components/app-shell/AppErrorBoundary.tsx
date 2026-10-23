import { Component, type ErrorInfo, type ReactNode } from 'react'
import { ActionButton } from '../ui/UiControls'
import './AppErrorBoundary.css'

export class AppErrorBoundary extends Component<{ children: ReactNode }, { error: Error | null }> {
  state: { error: Error | null } = { error: null }

  static getDerivedStateFromError(error: Error) {
    return { error }
  }

  componentDidCatch(error: Error, info: ErrorInfo) {
    console.error('Application render failed', error, info)
  }

  render() {
    if (!this.state.error) return this.props.children
    return <main className="server-state app-render-error" role="alert">
      <h1>Не удалось открыть экран</h1>
      <p>Обновите страницу. Если ошибка повторится, сообщите её идентификатор поддержке.</p>
      <code>{this.state.error.message}</code>
      <ActionButton onClick={() => window.location.reload()}>Обновить</ActionButton>
    </main>
  }
}

import { Component, type ErrorInfo, type ReactNode } from 'react'

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
    return <main className="server-state" role="alert">
      <h1>Не удалось открыть экран</h1>
      <p>Обновите страницу. Если ошибка повторится, сообщите её идентификатор поддержке.</p>
      <code>{this.state.error.message}</code>
      <button className="primary-button" onClick={() => window.location.reload()}>Обновить</button>
    </main>
  }
}

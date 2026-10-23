import { createElement, type ReactNode } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { EmbeddedApplicationContext } from '../application/EmbeddedApplicationContext'

const design = vi.hoisted(() => ({ enabled: true }))
vi.mock('../../app/application-design', () => ({ get APPLICATION_DESIGN() { return design.enabled } }))
vi.mock('../application/ApplicationFrame', () => ({
  ApplicationFrame: ({ children, aside }: { children: ReactNode; aside?: ReactNode }) => createElement(
    EmbeddedApplicationContext.Provider, { value: true },
    createElement('div', { 'data-shared-frame': true }, children, aside),
  ),
}))
import { EngineSessionFrame } from './EngineSessionFrame'
import { GameScreenShell } from '../../components/game-shell/GameScreenShell'
import { AppHeader, AppFooter } from '../../components/app-shell/AppShell'

const noop = () => {}
const actions = { onHome: noop, onArchive: noop, onStats: noop, onRules: noop, onReview: noop, onProfile: noop }
beforeEach(() => { design.enabled = true })

describe('non-catalog engine chrome', () => {
  it('starts the public game landing at the hero without a duplicate Games back button', () => {
    const html = renderToStaticMarkup(createElement(EmbeddedApplicationContext.Provider, { value: true },
      createElement(GameScreenShell, { variant: 'title', onBack: noop, backLabel: 'Все игры', children: createElement('h1', null, 'Сериалы') }),
    ))
    expect(html).toContain('Сериалы')
    expect(html).not.toContain('Все игры')
    expect(html).not.toContain('game-screen-shell__nav')
  })
  it.each(['connections', 'danetki'] as const)('%s gets common chrome without a second header or back row', mode => {
    const html = renderToStaticMarkup(createElement(EngineSessionFrame, { mode, onRules: noop, children: [
      createElement(AppHeader, { ...actions, key: 'header' }),
      createElement(GameScreenShell, { variant: 'session', onBack: noop, status: 'Переподключение', key: 'game', children: createElement('h1', null, 'Текущая игра') }),
      createElement(AppFooter, { ...actions, key: 'footer' }),
    ] }))
    expect(html).toContain('data-shared-frame="true"')
    expect(html).toContain('Текущая игра')
    expect(html).toContain('Переподключение')
    expect(html).toContain('Правила игры')
    expect(html).not.toContain('screen-back-row')
    expect(html).not.toContain('app-header')
    expect(html).not.toContain('reference-footer')
  })

  it('keeps the platform back action when application chrome is disabled', () => {
    design.enabled = false
    const html = renderToStaticMarkup(createElement(EngineSessionFrame, { mode: 'connections', onRules: noop, children:
      createElement(GameScreenShell, { variant: 'session', onBack: noop, children: 'Платформенная игра' }),
    }))
    expect(html).toContain('screen-back-row')
    expect(html).toContain('Назад')
    expect(html).not.toContain('data-shared-frame')
    expect(html).not.toContain('engine-session-guide')
  })
})

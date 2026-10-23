import {
  createElement,
  isValidElement,
  type AnchorHTMLAttributes,
  type ComponentProps,
  type MouseEvent,
  type ReactNode,
} from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { describe, expect, it, vi } from 'vitest'
import { ActionLink } from '../../components/ui'
import { ResultActionBar } from './ResultActionBar'
import { ResultPersistence } from './ResultPersistence'

const actionProps = (overrides: Partial<ComponentProps<typeof ResultActionBar>> = {}): ComponentProps<typeof ResultActionBar> => ({
  nextLabel: 'Играть дальше: кино',
  nextDestination: 'кино',
  nextArtworkUrl: '/images/next-movie.svg',
  nextTicketNumber: '05/10',
  nextActionLabel: 'Играть',
  configureLabel: 'Период / свободная игра',
  copied: false,
  onNext: vi.fn(),
  onConfigure: vi.fn(),
  ...overrides,
})

const renderActions = (props: ComponentProps<typeof ResultActionBar>) => renderToStaticMarkup(createElement(ResultActionBar, props))

describe('shared result controls', () => {
  it('keeps sharing visible in the celebration and preserves the paid continuation cost', () => {
    const html = renderActions(actionProps({ celebration: true, onShare: vi.fn(), primaryReplay: true, onReplay: vi.fn(), replayCost: 1 }))
    expect(html).toContain('Поделиться победой')
    expect(html).toContain('Ещё за 1 билет')
    expect(html).toContain('Другие игры')
    expect(html).toContain('aria-label="Настроить игру"')
    expect(html).not.toContain('aria-expanded=')
    expect(html).not.toContain('result-next__art')
  })

  it('offers replay and a friend challenge directly on victory without a disclosure', () => {
    const props = actionProps({ celebration: true, showReplayGate: true, onReplay: vi.fn(), onChallenge: vi.fn() })
    const html = renderActions(props)
    expect(html).toContain('aria-label="Сыграть ещё раз"')
    expect(html).toContain('aria-label="Бросить вызов другу"')
    expect(html).not.toContain('aria-expanded=')
    expect(props.onReplay).not.toHaveBeenCalled()
    expect(props.onChallenge).not.toHaveBeenCalled()
  })

  it('does not invent a share action when no handler is supplied', () => {
    const html = renderActions(actionProps({ celebration: true }))
    expect(html).not.toContain('Поделиться победой')
    expect(html).toContain('Играть дальше')
    expect(html).toContain('aria-label="Играть дальше: кино"')
  })

  it('keeps ActionLink a native anchor and forwards the original tracking callback without intercepting navigation', () => {
    const onClick = vi.fn()
    const props = {
      href: '/register?returnUrl=%2Fplay%2Fanime',
      variant: 'secondary' as const,
      target: '_blank',
      rel: 'noreferrer',
      onClick,
      children: 'Сохранить в аккаунте',
    }
    // Inspect the stateless forwardRef primitive, following the existing SSR tests'
    // element-inspection approach; no DOM, browser or synthetic navigation needed.
    const anchor = (ActionLink as unknown as {
      render: (input: ComponentProps<typeof ActionLink>, ref: null) => ReactNode
    }).render(props, null)

    expect(isValidElement<AnchorHTMLAttributes<HTMLAnchorElement>>(anchor)).toBe(true)
    if (!isValidElement<AnchorHTMLAttributes<HTMLAnchorElement>>(anchor)) throw new Error('Expected an anchor element')
    expect(anchor.type).toBe('a')
    expect(anchor.props.href).toBe(props.href)
    expect(anchor.props.target).toBe('_blank')
    expect(anchor.props.rel).toBe('noreferrer')
    expect(anchor.props.onClick).toBe(onClick)
    const event = { preventDefault: vi.fn() } as unknown as MouseEvent<HTMLAnchorElement>
    anchor.props.onClick?.(event)
    expect(onClick).toHaveBeenCalledExactlyOnceWith(event)
    expect(event.preventDefault).not.toHaveBeenCalled()

    const html = renderToStaticMarkup(createElement(ActionLink, props))
    expect(html).toContain('<a ')
    expect(html).toContain('href="/register?returnUrl=%2Fplay%2Fanime"')
    expect(html).not.toContain('<button')
  })

  it('renders the account explanation and a single actionable registration link without tracking a render as a click', () => {
    const onClick = vi.fn()
    const html = renderToStaticMarkup(createElement(ResultPersistence, {
      title: 'Сохраните победу и прогресс',
      'aria-label': 'Сохранить прогресс',
      children: 'Продолжите завтра с любого устройства.',
      action: createElement(ActionLink, {
        variant: 'secondary',
        href: '/register?bonus=all-games',
        onClick,
        children: 'Получить бонусы',
      }),
    }))
    expect(html).toContain('aria-label="Сохранить прогресс"')
    expect(html).toContain('<strong>Сохраните победу и прогресс</strong>')
    expect(html).toContain('<p>Продолжите завтра с любого устройства.</p>')
    expect(html.match(/<a\s/g)).toHaveLength(1)
    expect(html).toContain('href="/register?bonus=all-games"')
    expect(html).toContain('Получить бонусы</a>')
    expect(html).not.toContain('<button')
    expect(onClick).not.toHaveBeenCalled()
  })

  it('renders saved progress without offering another registration action', () => {
    const html = renderToStaticMarkup(createElement(ResultPersistence, {
      saved: true,
      'aria-label': 'Прогресс сохранён',
      title: 'Прогресс сохранён в профиле',
      children: 'Этот результат уже доступен на всех ваших устройствах.',
    }))
    expect(html).toContain('aria-label="Прогресс сохранён"')
    expect(html).toContain('Этот результат уже доступен на всех ваших устройствах.')
    expect(html).not.toContain('<a ')
    expect(html).not.toContain('<button')
  })

  it('keeps the next-game card a single named button and renders without starting a game', () => {
    const props = actionProps({ compactNext: true })
    const html = renderActions(props)
    expect(html.match(/<button\s/g)).toHaveLength(1)
    expect(html).toContain('type="button"')
    expect(html).toContain('aria-label="Играть дальше: кино"')
    expect(html).toContain('05/10')
    expect(html).not.toContain('disabled=""')
    expect(props.onNext).not.toHaveBeenCalled()
    expect(props.onConfigure).not.toHaveBeenCalled()
  })

  it('disables a pending paid replay while retaining its ticket cost and progress label', () => {
    const onReplay = vi.fn()
    const props = actionProps({ primaryReplay: true, replayCost: 5, replayPending: true, onReplay })
    const html = renderActions(props)
    const firstButton = html.match(/<button\b[^>]*>/)?.[0]
    expect(firstButton).toContain('disabled=""')
    expect(firstButton).toContain('aria-label="Следующий случай, 5 билетов"')
    expect(html).toContain('5 билетов, новая загадка')
    expect(html).toContain('Запускаем…')
    expect(onReplay).not.toHaveBeenCalled()
    expect(props.onNext).not.toHaveBeenCalled()
  })

  it.each([
    ['club', 'по клубному билету', 'Входит в клубный билет'],
    ['registration_bonus', 'за регистрационный бонус', 'Бонусная партия, без списания билетов'],
    ['free_archive', 'Следующий диагноз — бесплатно', 'Бесплатно, из архива'],
  ] as const)('explains %s replay access before an action can be taken', (replayAccessSource, accessibleLabel, explanation) => {
    const onReplay = vi.fn()
    const html = renderActions(actionProps({ primaryReplay: true, replayAccessSource, onReplay }))
    expect(html).toContain(accessibleLabel)
    expect(html).toContain(explanation)
    expect(onReplay).not.toHaveBeenCalled()
  })

  it('explains insufficient tickets without starting a replay on render', () => {
    const onReplay = vi.fn()
    const html = renderActions(actionProps({ primaryReplay: true, replayCost: 5, replayShortage: 2, onReplay }))
    expect(html).toContain('Следующий случай, недостаточно билетов')
    expect(html).toContain('Выберите способ продолжить')
    expect(onReplay).not.toHaveBeenCalled()
  })

  it('connects the secondary-actions disclosure to its content and preserves all available action labels', () => {
    const html = renderActions(actionProps({ showReplayGate: true, onReplay: vi.fn(), onChallenge: vi.fn(), showCopy: true, onCopy: vi.fn() }))
    const controlledId = html.match(/aria-controls="([^"]+)"/)?.[1]
    expect(controlledId).toBeTruthy()
    expect(html).toContain(`id="${controlledId}"`)
    expect(html).toContain('aria-expanded="false"')
    for (const label of ['Другие действия', 'Сыграть ещё раз', 'Настроить игру', 'Бросить вызов другу', 'Скопировать результат']) {
      expect(html).toContain(label)
    }
    expect(html.match(/<button\s/g)).toHaveLength(6)
    expect(html.match(/type="button"/g)).toHaveLength(6)
  })
})

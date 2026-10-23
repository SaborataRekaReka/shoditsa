import { isValidElement, type ReactElement, type ReactNode } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { describe, expect, it, vi } from 'vitest'
import { ControlButton } from '../../components/ui'
import { DiagnosisNextGameRecommendation } from './DiagnosisNextGameRecommendation'

const buttons = (node: ReactNode): ReactElement<{ onClick: () => void }>[] => {
  if (Array.isArray(node)) return node.flatMap(buttons)
  if (!isValidElement<{ children?: ReactNode }>(node)) return []
  if (node.type === ControlButton) return [node as ReactElement<{ onClick: () => void }>]
  return buttons(node.props.children)
}

describe('diagnosis next-game recommendation', () => {
  it('offers one route-selected game and delegates only the click to the existing tracked callback', () => {
    const onSelect = vi.fn()
    const tree = DiagnosisNextGameRecommendation({ mode: 'character', onSelect })
    const html = renderToStaticMarkup(tree)

    expect(onSelect).not.toHaveBeenCalled()
    expect(html.match(/type="button"/g)).toHaveLength(1)
    expect(html).toContain('Угадай персонажа')
    expect(html).toContain('происхождению, роли и способностям')
    expect(html).not.toContain('Угадай животное')
    buttons(tree)[0].props.onClick()
    expect(onSelect).toHaveBeenCalledExactlyOnceWith('character')
  })

  it('does not invent a next game when the route is complete or recommend another diagnosis', () => {
    const onSelect = vi.fn()
    expect(DiagnosisNextGameRecommendation({ onSelect })).toBeNull()
    expect(DiagnosisNextGameRecommendation({ mode: 'diagnosis', onSelect })).toBeNull()
    expect(onSelect).not.toHaveBeenCalled()
  })
})

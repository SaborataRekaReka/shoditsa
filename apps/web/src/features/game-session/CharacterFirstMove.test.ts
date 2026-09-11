import { createElement, isValidElement, type ReactElement, type ReactNode } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { describe, expect, it, vi } from 'vitest'
import { ControlButton } from '../../components/ui'
import { CharacterFirstMove } from './CharacterFirstMove'

const exampleButtons = (node: ReactNode): ReactElement<{ onClick: () => void; children: string }>[] => {
  if (Array.isArray(node)) return node.flatMap(exampleButtons)
  if (!isValidElement<{ children?: ReactNode }>(node)) return []
  if (node.type === ControlButton) return [node as ReactElement<{ onClick: () => void; children: string }>]
  return exampleButtons(node.props.children)
}

describe('CharacterFirstMove', () => {
  it('offers search examples without submitting a form or calling back during render', () => {
    const onExample = vi.fn()
    const tree = CharacterFirstMove({ onExample })
    const html = renderToStaticMarkup(tree)

    expect(onExample).not.toHaveBeenCalled()
    expect(html.match(/type="button"/g)).toHaveLength(3)
    expect(html).not.toContain('type="submit"')
    expect(html).toContain('классической литературы, сказок и мифов')
    const buttons = exampleButtons(tree)
    buttons[1].props.onClick()
    expect(onExample).toHaveBeenCalledExactlyOnceWith('Золушка')
  })

  it('explains an empty search without blaming the player and disables examples while busy', () => {
    const html = renderToStaticMarkup(createElement(CharacterFirstMove, {
      onExample: vi.fn(), variant: 'empty-search', disabled: true,
    }))
    expect(html).toContain('Возможно, этого героя ещё нет в подборке')
    expect(html.match(/disabled=""/g)).toHaveLength(3)
    expect(html).toContain('Шерлок Холмс')
    expect(html).toContain('Граф Дракула')
  })
})

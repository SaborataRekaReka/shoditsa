import { createElement } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { describe, expect, it } from 'vitest'
import { StudySectionAside, studyAsideLabel } from './StudySectionAside'
import type { StudyView } from './navigation'

const render = (view: StudyView, factsFound = 2) => renderToStaticMarkup(createElement(StudySectionAside, {
  view, homeHref: '/', goalsDone: 1, factsFound, onContinue: () => {},
}))

describe('section-specific right sidebar', () => {
  it('reuses the same account widget without changing its copy between sections', () => {
    const widget = (view: StudyView) => render(view).match(/<section[^>]*data-study-widget="account"[\s\S]*?<\/section>/)?.[0]
    expect(widget('profile')).toBeTruthy()
    expect(widget('archive')).toBe(widget('profile'))
    expect(widget('league')).toBe(widget('profile'))
  })
  it('places account access before the shared games widget in the archive', () => {
    const html = render('archive')
    expect(html).toContain('Сохрани свой прогресс')
    expect(html).not.toContain('Свежая идея?')
    expect(html).not.toContain('Мастер деталей')
  })
  it('shows a real initial streak without inventing ranks or rewards', () => {
    const html = render('league')
    expect(html).toContain('Твоя серия')
    expect(html).toContain('<strong>0</strong>')
    expect(html).toContain('Сохрани свой прогресс')
    expect(html).not.toContain('Мастер деталей')
  })
  it('keeps task progress and account access in the sidebar while the badge belongs to the page', () => {
    const html = render('quests', 8)
    expect(html).toContain('Выполнено 1 из 3 заданий.')
    expect(html).not.toContain('Мастер деталей')
    expect(html).toContain('Войти в аккаунт')
  })
  it('provides account access and daily activity on the profile screen', () => {
    const html = render('profile')
    expect(html).toContain('Войти в аккаунт')
    expect(html).not.toContain('data-study-widget="games"')
    expect(html).not.toContain('Подсказка откроется')
    expect(studyAsideLabel('profile')).toBe('Аккаунт и сегодняшние игры')
  })
})

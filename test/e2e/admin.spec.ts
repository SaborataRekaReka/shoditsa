import { expect, test, type Page, type Route } from '@playwright/test'

const json = (route: Route, body: unknown, status = 200) => route.fulfill({ status, contentType: 'application/json', body: JSON.stringify(body) })

const me = { user: { id: '07533c59-de3e-43f8-b40a-5a0fee06f557', email: 'breneize@yandex.ru', name: 'Владелец', role: 'admin', isAnonymous: false }, profile: {}, auth: { providers: ['credential'], hasPassword: true } }
const workspace = { id: '10000000-0000-4000-8000-000000000001', status: 'open', baseRevisionId: '10000000-0000-4000-8000-000000000002', builtRevisionId: null, version: 1, changesCount: 0, errorsCount: 0, warningsCount: 0 }
const payload = { id: 'movie:test-card', mode: 'movie', titleRu: 'Тестовая карточка', titleOriginal: 'Test card', alternativeTitles: [], year: 2024, plotHint: 'Достаточно длинная подсказка без ответа.', allowedInGame: true }

const installAdminMocks = async (page: Page, options: { denyGuard?: boolean; edit?: boolean } = {}) => {
  let savedPayload: Record<string, unknown> | null = null
  await page.route('**/api/v1/**', async (route) => {
    const request = route.request(); const url = new URL(request.url()); const path = url.pathname
    if (path === '/api/v1/me') return json(route, me)
    if (path === '/api/v1/admin/health') return options.denyGuard
      ? json(route, { error: { code: 'ADMIN_REQUIRED', message: 'Недостаточно прав', requestId: 'e2e' } }, 403)
      : json(route, { status: 'ok', checks: { database: true, queueDepth: 0, mediaRootConfigured: true, enrichmentRootConfigured: true }, app: { version: 'e2e', gitSha: 'e2e' } })
    if (path === '/api/v1/admin/jobs') return json(route, { items: [] })
    if (path === '/api/v1/admin/content/workspace') return json(route, { ...workspace, changesCount: savedPayload ? 1 : 0 })
    if (path === '/api/v1/admin/content/items' && request.method() === 'GET') return json(route, { items: [{ id: 'movie:test-card', versionId: '20000000-0000-4000-8000-000000000001', mode: 'movie', titleRu: String(savedPayload?.titleRu ?? payload.titleRu), titleOriginal: 'Test card', year: 2024, posterUrl: null, allowedInGame: true, reportsCount: 0, issuesCount: 0, completeness: 80, updatedAt: new Date().toISOString(), draftVersion: savedPayload ? 1 : null }], nextCursor: null, total: 1, filters: {} })
    if (path === '/api/v1/admin/content/items/movie%3Atest-card' && request.method() === 'GET') return json(route, {
      active: { id: '20000000-0000-4000-8000-000000000001', itemId: 'movie:test-card', mode: 'movie', payload, createdAt: new Date().toISOString(), revisionId: workspace.baseRevisionId },
      draft: savedPayload ? { id: '30000000-0000-4000-8000-000000000001', itemId: 'movie:test-card', mode: 'movie', afterPayload: savedPayload, beforePayload: payload, changedFields: ['titleRu'], version: 1, source: 'manual', validationIssues: [] } : null,
      workspace: { ...workspace, changesCount: savedPayload ? 1 : 0 },
      schema: { mode: 'movie', groups: [{ key: 'identity', title: 'Названия', fields: ['id', 'mode', 'titleRu', 'titleOriginal', 'alternativeTitles'] }, { key: 'game', title: 'Игра', fields: ['year', 'plotHint', 'allowedInGame'] }] },
      reports: [], issues: [], decisions: [],
    })
    if (path === '/api/v1/admin/content/items/movie%3Atest-card/history') return json(route, { versions: [], drafts: [] })
    if (path === '/api/v1/admin/content/workspace/items/movie%3Atest-card' && request.method() === 'PUT') {
      const body = request.postDataJSON() as { payload: Record<string, unknown> }
      savedPayload = body.payload
      return json(route, { id: '30000000-0000-4000-8000-000000000001', itemId: 'movie:test-card', version: 1, afterPayload: savedPayload })
    }
    return json(route, { error: { code: 'UNMOCKED', message: `${request.method()} ${path}`, requestId: 'e2e' } }, 404)
  })
  return { savedPayload: () => savedPayload }
}

test('exact server guard denies the admin shell even when /me reports an admin role', async ({ page }) => {
  await installAdminMocks(page, { denyGuard: true })
  await page.goto('/admin')
  await expect(page.getByRole('heading', { name: 'Административный доступ закрыт' })).toBeVisible()
  await expect(page.getByText('Недостаточно прав')).toBeVisible()
  await expect(page.locator('.admin-sidebar')).toHaveCount(0)
})

test('admin searches, opens and saves a card into the workspace', async ({ page }) => {
  const state = await installAdminMocks(page, { edit: true })
  await page.goto('/admin/content/movie%3Atest-card')
  await expect(page.getByRole('heading', { name: 'Карточки' })).toBeVisible()
  await expect(page.getByRole('complementary', { name: 'Карточка movie:test-card' })).toBeVisible()
  const titleInput = page.locator('.admin-field').filter({ hasText: 'Title Ru' }).locator('input')
  await titleInput.fill('Исправленная карточка')
  await page.getByRole('button', { name: /Сохранить/ }).click()
  await expect(page.getByText('Карточка сохранена в рабочую версию')).toBeVisible()
  await expect.poll(() => String(state.savedPayload()?.titleRu ?? '')).toBe('Исправленная карточка')
  await expect(page.getByText('1 изменений')).toBeVisible()
})

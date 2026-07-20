import { expect, test } from '@playwright/test'

test('partners section links stay on the corporate landing page', async ({ page }) => {
  await page.goto('/partners')

  await page.getByRole('link', { name: 'Посмотреть форматы', exact: true }).click()
  await expect(page).toHaveURL(/\/partners#formats$/)
  await expect(page.locator('#formats')).toBeInViewport()

  await page.getByRole('link', { name: 'Обсудить проект', exact: true }).click()
  await expect(page).toHaveURL(/\/partners#brief$/)
  await expect(page.locator('#brief')).toBeInViewport()
})

import { test, expect } from '@playwright/test';

test('ekran logowania się wyświetla', async ({ page }) => {
  await page.goto('/login', { waitUntil: 'domcontentloaded' });

  await expect(page.getByText('ClickUp Activity Monitor')).toBeVisible();
  await expect(page.getByText('Zaloguj się, aby kontynuować')).toBeVisible();
  await expect(page.getByRole('button', { name: 'Zaloguj się' })).toBeVisible();
});

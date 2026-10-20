import { expect, test } from '@playwright/test';

test('placeholder app loads', async ({ page }) => {
  await page.goto('/');
  await expect(page.getByRole('heading', { name: 'Tarazu' })).toBeVisible();
});

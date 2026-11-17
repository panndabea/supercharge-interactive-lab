import { test, expect } from '@playwright/test';

function watch(page) {
  const errors = [];
  page.on('pageerror', (e) => errors.push(e.message));
  page.on('console', (m) => { if (m.type() === 'error') errors.push(m.text()); });
  return errors;
}

test('Startseite und Karte', async ({ page }) => {
  const errors = watch(page);
  await page.goto('./');
  await expect(page.locator('h1')).toContainText('Schnellladestationen');
  await expect(page.locator('svg.svgmap path.zone').first()).toBeVisible();
  await page.locator('.cand[role=button]').first().click();
  await expect(page.locator('.stat').first()).toContainText('1 / 3');
  expect(errors).toEqual([]);
});

test('Alle 54 Kapitel rendern ohne Fehler', async ({ page }) => {
  const errors = watch(page);
  await page.goto('./');
  for (let n = 0; n <= 53; n++) {
    await page.goto(`./#/kapitel/${n}`);
    await expect(page.locator('main h1')).toBeVisible();
    await expect(page.locator('.kicker')).toContainText(`Kapitel ${n}`);
    await expect(page.locator('text=Widget-Fehler')).toHaveCount(0);
  }
  expect(errors).toEqual([]);
});

test('Übung prüfen gibt Feedback', async ({ page }) => {
  await page.goto('./#/kapitel/16');
  await page.locator('.exercise input').first().fill('93');
  await page.locator('.exercise .check').first().click();
  await expect(page.locator('.feedback').first()).toHaveClass(/ok/);
});

test('Solver und QAOA im Web Worker', async ({ page }) => {
  const errors = watch(page);
  await page.goto('./#/kapitel/50');
  await page.getByRole('button', { name: 'QAOA starten' }).click();
  await expect(page.locator('text=bestes zulässiges Sample')).toBeVisible({ timeout: 90_000 });
  await page.goto('./#/kapitel/24');
  await page.getByRole('button', { name: /Alle klassischen Solver/ }).click();
  await expect(page.locator('td', { hasText: 'Brute Force' })).toBeVisible();
  await expect(page.locator('tr', { hasText: 'Brute Force' })).toContainText('exakt');
  expect(errors).toEqual([]);
});

test('Labor und Code-Explorer', async ({ page }) => {
  const errors = watch(page);
  await page.goto('./#/studio');
  await expect(page.locator('main h1')).toHaveText('Supercharge Studio');
  await expect(page.locator('.circuit svg')).toBeVisible();
  await page.goto('./#/code');
  await expect(page.locator('#src')).toContainText('haversine');
  await page.getByRole('tab', { name: 'Rust' }).click();
  await expect(page.locator('#src')).toContainText('pub fn');
  expect(errors).toEqual([]);
});

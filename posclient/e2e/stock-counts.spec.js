// Stock count on the seeded demo data: a store keeper counts the store room
// blind, finds 2 bottles of oil missing, submits; a manager approves and the
// stock is corrected.
import { test, expect } from '@playwright/test';
import AxeBuilder from '@axe-core/playwright';
import { loginAs, settle } from './helpers';

async function noSeriousA11yIssues(page, where) {
  await page.evaluate(() => Promise.all(document.getAnimations()
    .filter((a) => a.effect?.getTiming().iterations !== Infinity)
    .map((a) => a.finished.catch(() => {}))));
  const results = await new AxeBuilder({ page }).withTags(['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa']).analyze();
  const serious = results.violations
    .filter((v) => ['serious', 'critical'].includes(v.impact))
    .map((v) => `${v.id}: ${v.nodes.slice(0, 3).map((n) => n.target.join(' ')).join(' | ')}`);
  expect(serious, `axe violations on ${where}`).toEqual([]);
}

test.beforeEach(({}, info) => {
  test.skip(info.project.name !== 'desktop', 'flows run once; layouts are covered by the quality suite');
});

test('blind count: keeper counts and submits a shortage, a manager approves and stock is corrected', async ({ page }) => {
  await loginAs(page, 'keeper', { theme: 'light' });
  await page.goto('/stock?tab=counts');
  await settle(page);
  await page.getByRole('button', { name: 'New stock count' }).first().click();
  const form = page.getByRole('dialog', { name: 'Start a stock count' });
  await form.getByLabel('Location').selectOption({ label: 'Store room' });
  await form.getByLabel('What to count').selectOption('products');
  await form.getByPlaceholder(/Search/).fill('oil');
  await form.getByText('Cooking oil 1L · OIL-1').click();
  await expect(form.getByText('Blind count')).toHaveCount(0); // only managers can switch blind counting off
  await noSeriousA11yIssues(page, 'new stock count');
  await form.getByRole('button', { name: 'Start counting' }).click();

  await expect(page.getByRole('heading', { name: /^Stock count SC-\d{4}-\d{6}$/ })).toBeVisible();
  await expect(page.getByText('The system quantity is hidden on purpose')).toBeVisible();
  await expect(page.getByRole('columnheader', { name: 'Expected' })).toHaveCount(0);
  await page.getByLabel('Counted Cooking oil 1L at Store room').fill('4');
  await page.getByLabel('Reason for the difference on Cooking oil 1L').selectOption('theft');
  await noSeriousA11yIssues(page, 'counting');
  await page.getByRole('button', { name: 'Submit count' }).click();
  await expect(page.getByRole('status').filter({ hasText: 'Count submitted - a manager has been alerted' })).toBeVisible();
  await expect(page.getByText('Waiting for a manager').first()).toBeVisible();
  const url = page.url();

  await loginAs(page, 'manager', { theme: 'light' });
  await page.goto(url);
  await settle(page);
  await expect(page.getByRole('cell', { name: '-2' })).toBeVisible();
  await noSeriousA11yIssues(page, 'count review');
  await page.getByRole('button', { name: 'Approve and correct stock' }).click();
  const confirm = page.getByRole('dialog', { name: 'Approve this count' });
  await confirm.getByRole('button', { name: 'Approve and correct stock' }).click();
  await expect(page.getByRole('status').filter({ hasText: 'Stock corrected' })).toBeVisible();

  await page.goto('/stock');
  await settle(page);
  await page.getByPlaceholder(/Search/).fill('Cooking oil');
  const row = page.getByRole('row').filter({ hasText: 'Store room' }).filter({ hasText: 'Cooking oil 1L' });
  await expect(row).toContainText('4');
});

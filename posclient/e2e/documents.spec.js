// Printable documents on the seeded demo data:
//  - the daily report downloads as a PDF from the dashboard
//  - a manager sets the business details, opens an employee's 360° page and prints the report
//  - a cashier issues a proforma, downloads it, and converts it into a sale
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

const inDays = (n) => {
  const d = new Date(Date.now() + n * 86400000);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
};

test.beforeEach(({}, info) => {
  test.skip(info.project.name !== 'desktop', 'flows run once; layouts are covered by the quality suite');
});

test('the daily report downloads as a PDF from the dashboard', async ({ page }) => {
  await loginAs(page, 'cashier', { theme: 'light' });
  await page.goto('/');
  await settle(page);
  const [download] = await Promise.all([
    page.waitForEvent('download'),
    page.locator('.today-sales').getByRole('button', { name: 'Download PDF' }).click(),
  ]);
  expect(download.suggestedFilename()).toMatch(/^daily-report-\d{4}-\d{2}-\d{2}\.pdf$/);
});

test('manager sets the business details, opens an employee 360° and prints their report', async ({ page }) => {
  await loginAs(page, 'manager', { theme: 'light' });
  await page.goto('/admin/business');
  await settle(page);
  await page.getByLabel('Business name').fill('Kigali Corner Shop');
  await page.getByLabel('TIN').fill('100200300');
  await noSeriousA11yIssues(page, 'business details');
  await page.getByRole('button', { name: 'Save' }).click();
  await expect(page.getByRole('status').filter({ hasText: 'Business details saved' })).toBeVisible();

  await page.goto('/admin/users');
  await settle(page);
  await page.getByRole('link', { name: 'Open the activity of Alice Mukamana' }).click();
  await expect(page.getByRole('heading', { name: 'Alice Mukamana' })).toBeVisible();
  await expect(page.getByRole('heading', { name: 'Cash accountability' })).toBeVisible();
  await page.getByRole('button', { name: 'Last 90 days' }).click();
  await settle(page);
  await noSeriousA11yIssues(page, 'employee 360');
  const [download] = await Promise.all([page.waitForEvent('download'), page.getByRole('button', { name: 'Download PDF' }).click()]);
  expect(download.suggestedFilename()).toMatch(/^employee-alice-mukamana-\d{4}-\d{2}-\d{2}-\d{4}-\d{2}-\d{2}\.pdf$/);
});

test('cashier issues a proforma, downloads it, and converts it into a paid sale', async ({ page }) => {
  await loginAs(page, 'cashier', { theme: 'light' });
  await page.goto('/proformas');
  await settle(page);
  await page.getByRole('button', { name: 'New proforma' }).first().click();
  const form = page.getByRole('dialog', { name: 'New proforma invoice' });
  await form.getByLabel('Customer name').fill('Jean Bosco');
  await form.getByLabel('Valid until').fill(inDays(7));
  await form.getByLabel('Product').selectOption({ label: 'Soap bar' });
  await form.getByLabel('Qty').fill('3');
  await noSeriousA11yIssues(page, 'new proforma');
  await form.getByRole('button', { name: 'Issue proforma' }).click();

  const detail = page.getByRole('dialog', { name: /^Proforma invoice PRO-\d{4}-\d{6}$/ });
  await expect(detail.getByText('Jean Bosco').first()).toBeVisible();
  await expect(detail.getByText('Valid', { exact: true })).toBeVisible();
  const [download] = await Promise.all([page.waitForEvent('download'), detail.getByRole('button', { name: 'Download PDF' }).click()]);
  expect(download.suggestedFilename()).toMatch(/^PRO-\d{4}-\d{6}\.pdf$/);

  await detail.getByRole('button', { name: 'Convert to sale' }).click();
  const convert = page.getByRole('dialog', { name: /^Convert PRO-/ });
  await convert.getByLabel('Client').selectOption({ label: 'Green Hills School' });
  await convert.getByText('Paid at the sale').click();
  await noSeriousA11yIssues(page, 'convert proforma');
  await convert.getByRole('button', { name: 'Convert to sale' }).click();
  await expect(page.getByRole('status').filter({ hasText: /Sale recorded as invoice #\d+/ })).toBeVisible();
  await expect(page).toHaveURL(/\/institutions\/\d+\?tab=invoices$/);
});

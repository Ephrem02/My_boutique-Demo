// Supplier & customer ledger in the browser, on the seeded demo data:
//  - a cashier settles an overdue customer invoice from the account screen
//  - a store keeper sees a delivery's batch/expiry and its supplier return, but can't pay
//  - a manager approves a customer return waiting on the Finance page
// Dialogs are checked for serious a11y issues on the way.
import { test, expect } from '@playwright/test';
import AxeBuilder from '@axe-core/playwright';
import { loginAs, settle } from './helpers';

async function noSeriousA11yIssues(page, where) {
  // Scan the settled UI, not a dialog halfway through its fade-in (contrast would be misread)
  await page.evaluate(() => Promise.all(document.getAnimations().map((a) => a.finished.catch(() => {}))));
  const results = await new AxeBuilder({ page }).withTags(['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa']).analyze();
  const serious = results.violations
    .filter((v) => ['serious', 'critical'].includes(v.impact))
    .map((v) => `${v.id}: ${v.nodes.slice(0, 3).map((n) => n.target.join(' ')).join(' | ')}`);
  expect(serious, `axe violations on ${where}`).toEqual([]);
}

test.beforeEach(({}, info) => {
  test.skip(info.project.name !== 'desktop', 'flows run once; layouts are covered by the quality suite');
});

test('cashier pays off an overdue customer invoice in instalment history', async ({ page }) => {
  await loginAs(page, 'cashier', { theme: 'light' });
  await page.goto('/institutions');
  await settle(page);
  await page.getByRole('button', { name: /Green Hills School/ }).first().click();
  const account = page.getByRole('dialog', { name: 'Green Hills School' });
  await expect(account.getByText('Owes us')).toBeVisible();
  await account.getByRole('tab', { name: 'Statement' }).click();
  await expect(account.getByRole('table', { name: 'Statement' })).toBeVisible();
  await account.getByRole('tab', { name: /Invoices/ }).click();

  const overdueCard = account.locator('.record-card').filter({ hasText: 'Overdue' });
  await overdueCard.getByRole('button', { name: 'Open' }).click();
  const invoice = page.getByRole('dialog', { name: /^Invoice #/ });
  await expect(invoice.getByText('MTN-5521')).toBeVisible(); // the first instalment, with its reference
  await noSeriousA11yIssues(page, 'customer invoice');

  await invoice.getByRole('button', { name: 'Record payment' }).click();
  const payment = page.getByRole('dialog', { name: 'Record payment', exact: true });
  await payment.getByLabel('Method').selectOption('airtel_money');
  await payment.getByLabel(/Reference no/).fill('AM-778');
  await payment.getByRole('button', { name: 'Record payment' }).click();
  await expect(page.getByRole('status').filter({ hasText: /Payment of RWF 2,250 recorded/ })).toBeVisible();
  await expect(invoice.getByText('AM-778')).toBeVisible();
  await expect(invoice.locator('.badge').filter({ hasText: 'Paid' }).first()).toBeVisible();
});

test('store keeper sees batch, expiry and the supplier return, and cannot pay suppliers', async ({ page }) => {
  await loginAs(page, 'keeper', { theme: 'light' });
  await page.goto('/suppliers');
  await settle(page);
  await page.getByRole('button', { name: /Kigali Wholesale/ }).first().click();
  const account = page.getByRole('dialog', { name: 'Kigali Wholesale Ltd' });
  await account.getByRole('button', { name: 'Open' }).first().click();
  const delivery = page.getByRole('dialog', { name: /^Delivery #/ });
  await expect(delivery.getByText('B-0426')).toBeVisible();
  await expect(delivery.getByText('KW-2026-118')).toBeVisible();
  await expect(delivery.getByText(/Damaged/).first()).toBeVisible();
  await expect(delivery.getByRole('button', { name: 'Record payment' })).toHaveCount(0);
  await expect(delivery.getByRole('button', { name: 'Record return' })).toBeVisible();
  await noSeriousA11yIssues(page, 'supplier delivery');

  await delivery.getByRole('button', { name: 'Record return' }).click();
  const ret = page.getByRole('dialog', { name: 'Return goods to supplier' });
  await expect(ret.getByLabel(/Quantity of .* to return/)).toBeVisible();
  await noSeriousA11yIssues(page, 'supplier return dialog');
  await ret.getByRole('button', { name: 'Cancel' }).click();
});

test('manager approves a large customer return from the Finance page', async ({ page }) => {
  await loginAs(page, 'manager', { theme: 'light' });
  await page.goto('/finance');
  await settle(page);
  await expect(page.getByRole('heading', { name: 'Customer receivables' })).toBeVisible();
  const queue = page.getByRole('table', { name: 'Customer returns waiting for approval' });
  await queue.getByRole('row').nth(1).click();
  const invoice = page.getByRole('dialog', { name: /^Invoice #/ });
  await expect(invoice.getByText('Waiting for approval')).toBeVisible();
  await invoice.getByRole('button', { name: 'Approve return' }).click();
  const confirm = page.getByRole('dialog', { name: 'Approve this return' });
  await confirm.getByRole('button', { name: 'Approve return' }).click();
  await expect(page.getByRole('status').filter({ hasText: 'Return approved' })).toBeVisible();
  await expect(invoice.getByText('Credit balance')).toBeVisible(); // paid in full, then returned: the customer holds credit
});

test('cashier sells on account at the till, part paid; it lands on the customer ledger', async ({ page }) => {
  await loginAs(page, 'cashier', { theme: 'light' });
  await page.goto('/pos');
  await settle(page);
  await page.getByRole('button', { name: /^Add Soap bar/ }).click();
  await page.getByRole('button', { name: /^Add Soap bar/ }).click();
  const cart = page.locator('.cart-panel');
  await cart.getByLabel('Customer (optional)').selectOption({ label: 'Green Hills School' });
  await cart.getByText('On account').click();
  await cart.getByLabel(/Paid now/).fill('600');
  await expect(cart.getByText('Goes on their account: RWF 1,000')).toBeVisible();
  await noSeriousA11yIssues(page, 'till on account');
  await cart.getByRole('button', { name: 'Sell on account' }).click();
  await expect(page.getByRole('status').filter({ hasText: /Sold on account to Green Hills School · RWF 1,000 owed/ })).toBeVisible();

  await page.goto('/institutions');
  await settle(page);
  await page.getByRole('button', { name: /Green Hills School/ }).first().click();
  const account = page.getByRole('dialog', { name: 'Green Hills School' });
  await expect(account.locator('.record-card').filter({ hasText: 'RWF 1,600' })).toBeVisible();
});

test('manager answers "what did we pay each supplier, and how" and exports it', async ({ page }) => {
  await loginAs(page, 'manager', { theme: 'light' });
  await page.goto('/finance');
  await settle(page);
  await page.getByRole('tab', { name: 'Payments' }).click();
  await page.getByLabel('Ledger').selectOption('supplier');
  await page.getByLabel('Supplier / customer').selectOption({ label: 'Kigali Wholesale Ltd' });
  const table = page.getByRole('table', { name: 'Payment history' });
  await expect(table.getByText('MP240118')).toBeVisible();
  await noSeriousA11yIssues(page, 'payments report');
  const [download] = await Promise.all([page.waitForEvent('download'), page.getByRole('button', { name: 'Export CSV' }).click()]);
  expect(download.suggestedFilename()).toMatch(/^payments-\d{4}-\d{2}-\d{2}\.csv$/);

  await page.getByRole('tab', { name: 'Returns' }).click();
  const returns = page.getByRole('table', { name: 'Returned goods' });
  await expect(returns.getByText('Damaged').first()).toBeVisible();
  await noSeriousA11yIssues(page, 'returns report');
});


// Approval-controlled opening, end to end in the browser: with no open day a
// cashier requests opening, a manager rejects (reason required), the cashier
// asks again, the manager approves and the day opens. Screens and dialogs are
// checked for serious a11y issues on the way. Leaves a business day open, so
// the other suites still find the shop trading.
import { test, expect } from '@playwright/test';
import AxeBuilder from '@axe-core/playwright';
import { loginAs, settle } from './helpers';

const API = 'http://localhost:4199/api';

async function noSeriousA11yIssues(page, where) {
  const results = await new AxeBuilder({ page }).withTags(['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa']).analyze();
  const serious = results.violations
    .filter((v) => ['serious', 'critical'].includes(v.impact))
    .map((v) => `${v.id}: ${v.nodes.slice(0, 3).map((n) => n.target.join(' ')).join(' | ')}`);
  expect(serious, `axe violations on ${where}`).toEqual([]);
}

async function signedIn(browser, role) {
  const context = await browser.newContext();
  const page = await context.newPage();
  await loginAs(page, role, { theme: 'light' });
  return { context, page };
}

test('cashier requests opening; manager rejects, then approves; the day opens', async ({ browser }, info) => {
  test.skip(info.project.name !== 'desktop', 'one full run is enough - layouts are covered by the quality suite');
  const manager = await signedIn(browser, 'manager');
  const cashier = await signedIn(browser, 'cashier');

  // Close whatever day is open so the shop has no open business day.
  const api = manager.page.request;
  const board = await (await api.get(`${API}/business-days/dashboard`)).json();
  if (board.today) {
    if (board.today.day.status === 'open') expect((await api.post(`${API}/business-days/current/closing/start`)).ok()).toBeTruthy();
    const preview = await (await api.get(`${API}/business-days/current/closing/preview`)).json();
    const submitted = await api.post(`${API}/business-days/current/closing/submit`, { data: { counted_cash: preview.figures.cash.expected_cash } });
    expect(submitted.ok()).toBeTruthy();
  }

  // Cashier: can't open, can request.
  const c = cashier.page;
  await c.goto('/');
  await settle(c);
  await expect(c.getByText('Business day is not open. Request opening access from the Store Manager.').first()).toBeVisible();
  await expect(c.getByRole('button', { name: 'Open business day' })).toHaveCount(0);
  await c.getByRole('button', { name: 'Request business day opening' }).first().click();
  const dialog = c.getByRole('dialog', { name: 'Request business day opening' });
  await dialog.getByLabel(/Opening cash counted/).fill('20000');
  await dialog.getByLabel(/^Reason/).fill('Start of daily operations');
  await noSeriousA11yIssues(c, 'request dialog');
  await dialog.getByRole('button', { name: 'Send request' }).click();
  await expect(c.getByRole('status').filter({ hasText: 'Opening request sent' })).toBeVisible();
  await expect(c.getByText('Waiting for manager approval')).toBeVisible();

  // Manager: sees the request and rejects it with a reason.
  const m = manager.page;
  await m.goto('/');
  await settle(m);
  const card = m.locator('.opening-request');
  await expect(card).toContainText('Alice Mukamana');
  await expect(card).toContainText('Start of daily operations');
  await expect(card).toContainText('RWF 20,000');
  await noSeriousA11yIssues(m, 'manager dashboard with a request');
  await card.getByRole('button', { name: 'Reject' }).click();
  const reject = m.getByRole('dialog', { name: 'Reject opening request' });
  await expect(reject.getByRole('button', { name: 'Reject' })).toBeDisabled(); // reason required
  await reject.getByLabel(/Reason for rejecting/).fill('Stock count first');
  await reject.getByRole('button', { name: 'Reject' }).click();
  await expect(m.getByRole('status').filter({ hasText: 'Opening request rejected' })).toBeVisible();
  await expect(card).toHaveCount(0);

  // Cashier: sees why, and asks again.
  await c.reload();
  await settle(c);
  await expect(c.getByText('Your opening request was rejected')).toBeVisible();
  await expect(c.getByText('Grace Uwase: Stock count first')).toBeVisible();
  await c.getByRole('button', { name: 'Request again' }).click();
  const again = c.getByRole('dialog', { name: 'Request business day opening' });
  await again.getByLabel(/Opening cash counted/).fill('20000');
  await again.getByLabel(/^Reason/).fill('Stock count done');
  await again.getByRole('button', { name: 'Send request' }).click();
  await expect(c.getByText('Waiting for manager approval')).toBeVisible();

  // Manager approves: the day opens.
  await m.reload();
  await settle(m);
  await m.locator('.opening-request').getByRole('button', { name: 'Approve' }).click();
  await m.getByRole('dialog', { name: 'Approve and open the business day' }).getByRole('button', { name: 'Approve' }).click();
  await expect(m.getByRole('status').filter({ hasText: 'Business day opened' })).toBeVisible();
  await expect(m.getByText('Opening requested by').first()).toBeVisible(); // today's people (and the last closing's, when it was requested too)

  await c.reload();
  await settle(c);
  await expect(c.getByRole('button', { name: 'Start closing' })).toBeVisible(); // the day is open for the cashier

  await manager.context.close();
  await cashier.context.close();
});

// Quality gate for the design system (runs per viewport project):
//  - no horizontal overflow on any key screen, in light and dark
//  - no serious/critical axe (WCAG 2.1 A/AA) violations, in light and dark
//  - appearance: System follows the OS; choice persists per user
//  - dialogs: Escape closes and focus returns; keyboard focus is visible
//  - a complete sale on a phone through the cart sheet
import { test, expect } from '@playwright/test';
import AxeBuilder from '@axe-core/playwright';
import { loginAs, settle } from './helpers';

const SCREENS = [
  ['cashier', '/'], ['cashier', '/pos'], ['cashier', '/sales-history'], ['cashier', '/notifications'], ['cashier', '/settings'],
  ['keeper', '/'], ['keeper', '/stock'], ['keeper', '/products'],
  ['manager', '/'], ['manager', '/products'], ['manager', '/suppliers'], ['manager', '/institutions'], ['manager', '/reports'],
  ['manager', '/business-days'], ['manager', '/closing/corrections'], ['manager', '/admin'], ['manager', '/admin/monitoring'],
  ['manager', '/admin/notifications/rules'], ['manager', '/admin/audit'], ['manager', '/admin/users'], ['manager', '/admin/closing'],
];

/** Elements whose right edge is past the viewport, ignoring intentional horizontal scrollers. */
async function overflowingElements(page) {
  return page.evaluate(() => {
    const width = document.documentElement.clientWidth;
    const scrollers = '.table-wrap, .tabs, .admin-nav, .segmented, .json-block';
    const offenders = [];
    for (const el of document.querySelectorAll('body *')) {
      if (el.closest(scrollers) && !el.matches(scrollers)) continue;
      const r = el.getBoundingClientRect();
      if (r.width === 0 || r.height === 0) continue;
      const style = getComputedStyle(el);
      if (style.position === 'fixed' || style.visibility === 'hidden') continue;
      if (r.right > width + 1) offenders.push(`${el.tagName.toLowerCase()}.${[...el.classList].join('.')} (${Math.round(r.right)} > ${width})`);
    }
    return { docOverflow: document.documentElement.scrollWidth > width + 1, offenders: offenders.slice(0, 5) };
  });
}

for (const theme of ['light', 'dark']) {
  for (const [role, path] of SCREENS) {
    test(`${role} ${path} · ${theme}: no overflow, no serious a11y issues`, async ({ page }) => {
      await loginAs(page, role, { theme });
      await page.goto(path);
      await settle(page);
      await expect(page.locator('html')).toHaveAttribute('data-theme', theme);

      const overflow = await overflowingElements(page);
      expect(overflow, `horizontal overflow on ${path}`).toEqual({ docOverflow: false, offenders: [] });

      const results = await new AxeBuilder({ page }).withTags(['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa']).analyze();
      const serious = results.violations
        .filter((v) => ['serious', 'critical'].includes(v.impact))
        .map((v) => `${v.id}: ${v.nodes.slice(0, 3).map((n) => n.target.join(' ')).join(' | ')}`);
      expect(serious, `axe violations on ${path} (${theme})`).toEqual([]);
    });
  }
}

test('System appearance follows the OS and the choice is saved per user', async ({ page }) => {
  await loginAs(page, 'cashier', { theme: 'system' });
  await page.emulateMedia({ colorScheme: 'dark' });
  await page.goto('/settings');
  await settle(page);
  await expect(page.locator('html')).toHaveAttribute('data-theme', 'dark');
  await page.emulateMedia({ colorScheme: 'light' });
  await expect(page.locator('html')).toHaveAttribute('data-theme', 'light');

  await page.getByRole('radio', { name: /Dark/ }).check({ force: true });
  await expect(page.locator('html')).toHaveAttribute('data-theme', 'dark');
  await page.waitForTimeout(300);
  const me = await page.request.get('http://localhost:4199/api/auth/me');
  expect((await me.json()).user.preferences.appearance).toBe('dark');
  await page.request.put('http://localhost:4199/api/auth/me/preferences', { data: { appearance: 'system' } });
});

test('dialogs close on Escape and return focus; focus ring is visible', async ({ page }, info) => {
  test.skip(info.project.name === 'mobile', 'keyboard flow checked on tablet/desktop');
  await loginAs(page, 'manager', { theme: 'light' });
  await page.goto('/products');
  await settle(page);
  const opener = page.getByRole('button', { name: 'New product' });
  await opener.focus();
  await page.keyboard.press('Enter');
  const dialog = page.getByRole('dialog', { name: 'New product' });
  await expect(dialog).toBeVisible();
  await expect(dialog.locator(':focus')).toHaveCount(1);
  await page.keyboard.press('Escape');
  await expect(dialog).toHaveCount(0);
  await expect(opener).toBeFocused();
  const outline = await opener.evaluate((el) => getComputedStyle(el).outlineStyle);
  expect(outline).not.toBe('none');
});

test('phone: complete a sale through the cart sheet', async ({ page }, info) => {
  test.skip(info.project.name !== 'mobile', 'phone flow');
  await loginAs(page, 'cashier', { theme: 'light' });
  await page.goto('/pos');
  await settle(page);
  await page.getByRole('button', { name: /^Add Soap bar/ }).click();
  await page.getByRole('button', { name: /^Add Soap bar/ }).click();
  const bar = page.locator('.cart-bar');
  await expect(bar).toContainText('2 item(s)');
  await expect(bar).toContainText('RWF 1,600');
  await bar.getByRole('button', { name: 'Review' }).click();
  const sheet = page.getByRole('dialog', { name: 'Cart' });
  await sheet.getByText('MTN Mobile Money').click();
  const box = await sheet.getByRole('button', { name: 'Complete sale' }).boundingBox();
  expect(box.height).toBeGreaterThanOrEqual(44);
  await sheet.getByRole('button', { name: 'Complete sale' }).click();
  await expect(page.getByRole('status').filter({ hasText: 'Sale completed' })).toBeVisible();
  await expect(sheet).toHaveCount(0);
});

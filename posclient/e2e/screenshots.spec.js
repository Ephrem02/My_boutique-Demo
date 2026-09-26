// Captures key screens per viewport for visual review.
// SNAPSHOT_LABEL=before|after picks the output folder.
import { test } from '@playwright/test';
import { loginAs, settle } from './helpers';

const LABEL = process.env.SNAPSHOT_LABEL || 'current';
const SCREENS = [
  ['manager', '/', 'dashboard-manager'],
  ['cashier', '/', 'dashboard-cashier'],
  ['cashier', '/pos', 'pos'],
  ['manager', '/products', 'products'],
  ['keeper', '/stock', 'stock'],
  ['manager', '/sales-history', 'sales-history'],
  ['manager', '/admin/notifications', 'admin'],
];
const THEMES = (process.env.SNAPSHOT_THEMES || 'light').split(',');

for (const theme of THEMES) {
  for (const [role, path, name] of SCREENS) {
    test(`${name} (${theme})`, async ({ page }, info) => {
      await loginAs(page, role, { theme });
      await page.goto(path);
      await settle(page);
      await page.screenshot({ path: `e2e/artifacts/screens/${LABEL}/${info.project.name}/${name}-${theme}.png`, fullPage: true });
    });
  }
}

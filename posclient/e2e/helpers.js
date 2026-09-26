import { expect } from '@playwright/test';

export const USERS = {
  manager: 'manager@demo.local',
  keeper: 'keeper@demo.local',
  cashier: 'cashier@demo.local',
};
export const PASSWORD = 'correct-horse-battery';

/** Signs in through the API (sets the httpOnly cookie for localhost) and optionally forces a theme. */
export async function loginAs(page, role, { theme } = {}) {
  const res = await page.request.post('http://localhost:4199/api/auth/login', { data: { email: USERS[role], password: PASSWORD } });
  expect(res.ok()).toBeTruthy();
  if (theme) {
    await page.request.put('http://localhost:4199/api/auth/me/preferences', { data: { appearance: theme } });
  }
}

/** Waits until the page has settled (no skeletons / loading text left). */
export async function settle(page) {
  await page.waitForLoadState('networkidle');
  await page.waitForFunction(() => !document.querySelector('.skeleton, [aria-busy="true"]'), null, { timeout: 10_000 }).catch(() => {});
}

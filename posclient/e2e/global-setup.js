// Re-seeds the test database so every run starts from the same demo data.
import { execSync } from 'node:child_process';

export default async function globalSetup() {
  if (process.env.E2E_SKIP_SEED) return;
  execSync('npm run seed:e2e', { cwd: new URL('../../backend', import.meta.url), stdio: 'inherit' });
}

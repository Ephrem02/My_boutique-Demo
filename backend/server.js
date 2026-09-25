require('dotenv').config();

// Refuse to boot on a missing/weak/placeholder JWT secret - this is what signs
// and verifies every auth token, so a known value here means anyone can forge
// a token for any user/role.
const KNOWN_PLACEHOLDER_JWT_SECRETS = new Set([
  'change_this_to_a_long_random_string',
  'secret',
  'changeme',
  'your-secret-key',
]);
const jwtSecret = process.env.JWT_SECRET || '';
if (!jwtSecret || jwtSecret.length < 32 || KNOWN_PLACEHOLDER_JWT_SECRETS.has(jwtSecret)) {
  console.error('Refusing to start: JWT_SECRET is missing, too short (<32 chars), or a known placeholder.');
  console.error('Generate a strong secret, e.g.: openssl rand -hex 32');
  process.exit(1);
}

const app = require('./src/app');

const PORT = process.env.PORT || 4000;

const worker = require('./src/notifications/worker');
const realtime = require('./src/notifications/realtime');
const db = require('./src/config/db');

const server = app.listen(PORT, () => {
  console.log(`Shop management API running on port ${PORT}`);
  // Sends queued notification emails and runs scheduled checks
  worker.start();
});

async function shutdown(signal) {
  console.log(`${signal} received - shutting down`);
  worker.stop();
  await realtime.shutdown();
  server.close(() => db.destroy().finally(() => process.exit(0)));
  setTimeout(() => process.exit(0), 10000).unref();
}
process.on('SIGINT', () => shutdown('SIGINT'));
process.on('SIGTERM', () => shutdown('SIGTERM'));

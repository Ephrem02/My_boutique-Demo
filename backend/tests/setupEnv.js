// Runs before each test file's modules load: point everything at the test
// database and loosen limits that would trip on rapid test traffic.
process.env.NODE_ENV = 'test';
require('dotenv').config({ path: require('path').join(__dirname, '..', '.env'), quiet: true });
process.env.JWT_SECRET = process.env.JWT_SECRET && process.env.JWT_SECRET.length >= 32
  ? process.env.JWT_SECRET
  : 'test-secret-that-is-at-least-32-characters-long';
process.env.LOGIN_RATE_LIMIT = '10000';
process.env.API_RATE_LIMIT = '100000';
process.env.ADMIN_SEND_RATE_LIMIT = '10000';
delete process.env.SMTP_HOST; // tests use an injected fake transport, never real SMTP
delete process.env.TRUST_PROXY;

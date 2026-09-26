const request = require('supertest');
const app = require('../src/app');
const { resetDb, createUser, loginAs, ownerDb } = require('./helpers');

beforeEach(resetDb);

test('users save their own appearance preference, returned by /me and login', async () => {
  const user = await createUser('cashier');
  const agent = await loginAs(app, user);
  expect((await agent.get('/api/auth/me')).body.user.preferences).toEqual({});

  const res = await agent.put('/api/auth/me/preferences').send({ appearance: 'dark' });
  expect(res.status).toBe(200);
  expect(res.body.preferences).toEqual({ appearance: 'dark' });
  expect((await agent.get('/api/auth/me')).body.user.preferences.appearance).toBe('dark');

  const login = await request(app).post('/api/auth/login').send({ email: user.email, password: 'correct-horse-battery' });
  expect(login.body.user.preferences.appearance).toBe('dark');
});

test('only allowlisted keys and values are accepted', async () => {
  const agent = await loginAs(app, await createUser('cashier'));
  expect((await agent.put('/api/auth/me/preferences').send({ appearance: 'neon' })).status).toBe(400);
  expect((await agent.put('/api/auth/me/preferences').send({ role: 'store_manager' })).status).toBe(400);
  expect((await agent.put('/api/auth/me/preferences').send({})).status).toBe(400);
});

test("one user's preference never changes another's", async () => {
  const a = await createUser('cashier');
  const b = await createUser('cashier');
  await (await loginAs(app, a)).put('/api/auth/me/preferences').send({ appearance: 'light' });
  const row = await ownerDb()('users').where({ id: b.id }).first('preferences');
  expect(row.preferences).toEqual({});
});

test('requires authentication', async () => {
  expect((await request(app).put('/api/auth/me/preferences').send({ appearance: 'dark' })).status).toBe(401);
});

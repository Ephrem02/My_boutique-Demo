afterAll(async () => {
  await require('../src/notifications/realtime').shutdown();
  await require('../src/config/db').destroy();
  await require('./helpers').closeOwner();
});

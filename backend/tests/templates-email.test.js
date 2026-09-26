const app = require('../src/app');
const { resetDb, createUser, loginAs, ownerDb, inbox, eventsOfType } = require('./helpers');
const { emit } = require('../src/notifications/notificationService');
const { setTransportForTesting } = require('../src/notifications/email/transport');
const worker = require('../src/notifications/worker');
const { buildEmail } = require('../src/notifications/email/render');
const db = require('../src/config/db');

function fakeTransport({ fail = null } = {}) {
  const sent = [];
  return {
    sent,
    sendMail: async (msg) => {
      if (fail) throw Object.assign(new Error(fail.message || 'boom'), { responseCode: fail.code });
      sent.push(msg);
      return { messageId: `<id-${sent.length}@test>` };
    },
  };
}

async function enableEmail(admin) {
  const res = await admin.put('/api/admin/email-settings').send({ enabled: true, sender_address: 'shop@test.local', sender_name: 'Test Shop' });
  expect(res.status).toBe(200);
}

beforeEach(resetDb);
afterEach(() => setTransportForTesting(null));

describe('admin-editable templates', () => {
  test('valid edits apply to new notifications and are fully audited', async () => {
    const manager = await createUser('store_manager');
    const admin = await loginAs(app, manager);
    const res = await admin.put('/api/admin/notification-templates/DELIVERY_RECEIVED').send({
      title: 'Goods in from {{supplier_name}}',
      body: 'Delivery {{delivery_id}} worth {{amount_rwf}}.',
      email_subject: 'Delivery from {{supplier_name}}',
      email_body: 'Delivery {{delivery_id}}.',
    });
    expect(res.status).toBe(200);
    expect(res.body.version).toBe(1);

    const other = await createUser('store_manager');
    await emit(db, { type: 'DELIVERY_RECEIVED', dedupKey: 'd:1', params: { supplier_name: 'Acme', delivery_id: 7, amount_rwf: 1500 } });
    const [n] = await inbox(other.id);
    expect(n.title).toBe('Goods in from Acme');
    expect(n.body).toBe('Delivery 7 worth 1,500 RWF.');

    const [row] = await ownerDb()('audit_logs').where({ action: 'notification.template_update' });
    expect(row.old_values.source).toBe('default');
    expect(row.new_values.title).toBe('Goods in from {{supplier_name}}');
    expect(row.actor_user_id).toBe(manager.id);

    const reset = await admin.post('/api/admin/notification-templates/DELIVERY_RECEIVED/reset');
    expect(reset.body.customized).toBe(false);
    expect(await ownerDb()('audit_logs').where({ action: 'notification.template_reset' })).toHaveLength(1);
  });

  test.each([
    ['unknown placeholder', { title: 'Hi {{password}}' }, /unknown placeholder \{\{password\}\}/],
    ['HTML', { body: 'Click <a href="http://evil">here</a>' }, /plain text/],
    ['script', { email_body: '<script>alert(1)</script>' }, /plain text/],
    ['malformed placeholder', { body: 'Hello {{ supplier-name }}' }, /malformed placeholder/],
    ['multi-line subject', { email_subject: 'a\nBcc: victim@x.com' }, /single line/],
    ['control chars', { body: 'bad\u0007bell' }, /control characters/],
    ['too long', { title: 'x'.repeat(151) }, /at most 150/],
  ])('rejects %s', async (_, override, message) => {
    const admin = await loginAs(app, await createUser('store_manager'));
    const base = { title: 'T', body: 'B', email_subject: 'S', email_body: 'E' };
    const res = await admin.put('/api/admin/notification-templates/DELIVERY_RECEIVED').send({ ...base, ...override });
    expect(res.status).toBe(422);
    expect(res.body.error).toMatch(message);
    expect(await ownerDb()('notification_templates')).toHaveLength(0);
  });

  test('preview renders with sample values only', async () => {
    const admin = await loginAs(app, await createUser('store_manager'));
    const res = await admin.post('/api/admin/notification-templates/LOW_STOCK/preview').send({
      title: 'Low: {{product_name}}', body: '{{quantity}} left', email_subject: 'S', email_body: 'E',
    });
    expect(res.body.title).toBe('Low: [product_name]');
  });

  test('data values cannot inject markup into the HTML email', () => {
    const email = buildEmail({ subject: 'Low stock: <img src=x onerror=alert(1)>', bodyText: 'Product "<b>X</b>" & co\n\nnext' });
    expect(email.html).not.toContain('<img');
    expect(email.html).not.toContain('<b>X');
    expect(email.html).toContain('&lt;img src=x onerror=alert(1)&gt;');
    expect(email.text).toContain('<b>X</b>'); // plain-text part is literal
  });
});

describe('email delivery worker', () => {
  test('email is off by default: deliveries are recorded as skipped and nothing is sent', async () => {
    const transport = fakeTransport();
    setTransportForTesting(transport);
    await createUser('store_manager');
    await emit(db, { type: 'OVERPAYMENT', dedupKey: 'o:1', params: { party_name: 'X' } });
    await worker.runOnce();
    const [delivery] = await ownerDb()('notification_deliveries');
    expect(delivery.status).toBe('skipped');
    expect(delivery.skip_reason).toBe('email_disabled');
    expect(transport.sent).toHaveLength(0);
  });

  test('sends queued emails once, with escaped HTML and no duplicate on rerun', async () => {
    const transport = fakeTransport();
    setTransportForTesting(transport);
    const manager = await createUser('store_manager');
    await enableEmail(await loginAs(app, manager));
    const other = await createUser('store_manager', { email: 'other@test.local' });
    await emit(db, { type: 'OVERPAYMENT', dedupKey: 'o:2', params: { party_name: '<b>Acme</b>', party_type: 'supplier delivery', reference_id: 1, total_rwf: 100, paid_rwf: 200 } });

    await worker.runOnce();
    await worker.runOnce();
    const toOther = transport.sent.filter((m) => m.to === 'other@test.local');
    expect(toOther).toHaveLength(1);
    expect(toOther[0].html).toContain('&lt;b&gt;Acme&lt;/b&gt;');
    expect(toOther[0].from).toEqual({ name: 'Test Shop', address: 'shop@test.local' });
    const row = await ownerDb()('notification_deliveries').where({ recipient_user_id: other.id }).first();
    expect(row.status).toBe('sent');
    expect(row.provider_message_id).toMatch(/@test>/);
  });

  test('transient failures retry with backoff, then go dead and alert admins in-app only', async () => {
    const manager = await createUser('store_manager');
    const admin = await loginAs(app, manager);
    await enableEmail(admin);
    await admin.put('/api/admin/email-settings').send({ max_attempts: 2 });
    setTransportForTesting(fakeTransport({ fail: { code: 421, message: 'try later' } }));
    const target = await createUser('store_manager', { email: 't@test.local' });
    await emit(db, { type: 'OVERPAYMENT', dedupKey: 'o:3', params: { party_name: 'X' } });

    await worker.runOnce();
    let row = await ownerDb()('notification_deliveries').where({ recipient_user_id: target.id }).first();
    expect(row.status).toBe('failed');
    expect(row.last_error).toMatch(/421: try later/);
    expect(new Date(row.next_attempt_at).getTime()).toBeGreaterThan(Date.now() + 30 * 1000);

    await ownerDb()('notification_deliveries').update({ next_attempt_at: ownerDb().fn.now() });
    await worker.runOnce();
    row = await ownerDb()('notification_deliveries').where({ recipient_user_id: target.id }).first();
    expect(row.status).toBe('dead');

    const [alert] = await eventsOfType('EMAIL_DELIVERY_FAILED');
    expect(alert).toBeDefined();
    const alertDeliveries = await ownerDb()('notification_deliveries')
      .join('notifications', 'notifications.id', 'notification_deliveries.notification_id')
      .where('notifications.event_id', alert.id);
    expect(alertDeliveries).toHaveLength(0); // never emails about failed email
  });

  test('permanent 5xx rejection goes straight to dead; admin can resend (audited)', async () => {
    const manager = await createUser('store_manager');
    const admin = await loginAs(app, manager);
    await enableEmail(admin);
    setTransportForTesting(fakeTransport({ fail: { code: 550, message: 'mailbox unavailable' } }));
    const target = await createUser('store_manager', { email: 'gone@test.local' });
    await emit(db, { type: 'OVERPAYMENT', dedupKey: 'o:4', params: { party_name: 'X' } });
    await worker.runOnce();
    const row = await ownerDb()('notification_deliveries').where({ recipient_user_id: target.id }).first();
    expect(row.status).toBe('dead');
    expect(row.attempts).toBe(1);

    const transport = fakeTransport();
    setTransportForTesting(transport);
    const res = await admin.post(`/api/admin/deliveries/${row.id}/resend`);
    expect(res.status).toBe(200);
    await worker.runOnce();
    expect(transport.sent.map((m) => m.to)).toContain('gone@test.local');
    expect(await ownerDb()('audit_logs').where({ action: 'notification.resend' })).toHaveLength(1);
    expect((await admin.post(`/api/admin/deliveries/${row.id}/resend`)).status).toBe(409); // already sent
  });

  test('delivery list masks recipient emails', async () => {
    const manager = await createUser('store_manager', { email: 'manager.person@test.local' });
    const admin = await loginAs(app, manager);
    await enableEmail(admin);
    await createUser('store_manager', { email: 'someone.else@test.local' });
    await emit(db, { type: 'OVERPAYMENT', dedupKey: 'o:5', params: { party_name: 'X' } });
    const res = await admin.get('/api/admin/deliveries');
    expect(res.body.items[0].recipient_email).toBe('s***@test.local');
    expect(JSON.stringify(res.body)).not.toContain('someone.else');
  });

  test('email settings never expose SMTP credentials and validate input', async () => {
    process.env.SMTP_PASSWORD = 'super-secret-smtp-pass';
    const admin = await loginAs(app, await createUser('store_manager'));
    const res = await admin.get('/api/admin/email-settings');
    expect(JSON.stringify(res.body)).not.toContain('super-secret-smtp-pass');
    const bad = await admin.put('/api/admin/email-settings').send({ sender_address: 'x@y.com\r\nBcc: a@b.com' });
    expect(bad.status).toBe(422);
    const smuggle = await admin.put('/api/admin/email-settings').send({ smtp_password: 'x' });
    expect(smuggle.status).toBe(422);
    delete process.env.SMTP_PASSWORD;
  });

  test('scheduled check raises due and overdue supplier payment alerts once', async () => {
    await createUser('store_manager');
    const owner = ownerDb();
    const [supplier] = await owner('suppliers').insert({ name: 'Acme' }).returning('*');
    const keeper = await createUser('store_keeper');
    const base = { supplier_id: supplier.id, delivery_date: '2026-01-01', total_amount: 1000, recorded_by: keeper.id };
    await owner('supplier_deliveries').insert([
      { ...base, payment_due_date: owner.raw("current_date - interval '2 days'") },
      { ...base, payment_due_date: owner.raw("current_date + interval '1 day'") },
      { ...base, payment_due_date: owner.raw("current_date + interval '30 days'") },
    ]);
    await worker.checkSupplierPayments();
    await worker.checkSupplierPayments();
    expect(await eventsOfType('SUPPLIER_PAYMENT_OVERDUE')).toHaveLength(1);
    expect(await eventsOfType('SUPPLIER_PAYMENT_DUE')).toHaveLength(1);
  });
});

// Notification system. An *event* is recorded once per thing that happened;
// each recipient gets their own *notification* row pointing at it, and each
// email is a *delivery* row the background worker sends and retries.
//
// Rules and templates tables only hold admin overrides - defaults live in
// src/notifications/types.js, so rows here mean "an admin changed this".
exports.up = async function (knex) {
  await knex.schema
    .createTable('notification_events', (t) => {
      t.bigIncrements('id').primary();
      t.string('type', 64).notNullable();
      t.string('category', 32).notNullable();
      t.enu('severity', ['info', 'warning', 'critical']).notNullable();
      t.string('entity_type', 64);
      t.integer('entity_id');
      t.jsonb('params').notNullable().defaultTo('{}');
      t.string('dedup_key', 255).notNullable();
      t.integer('actor_user_id').references('id').inTable('users');
      t.integer('occurrence_count').notNullable().defaultTo(1);
      t.timestamp('created_at').notNullable().defaultTo(knex.fn.now());
      t.timestamp('last_occurred_at').notNullable().defaultTo(knex.fn.now());
      t.timestamp('resolved_at');

      t.index(['category', 'created_at']);
      t.index(['type', 'created_at']);
      t.index(['created_at']);
      t.index(['dedup_key', 'created_at']);
    })
    .createTable('notifications', (t) => {
      t.bigIncrements('id').primary();
      t.bigInteger('event_id').notNullable().references('id').inTable('notification_events');
      t.integer('recipient_user_id').notNullable().references('id').inTable('users');
      t.boolean('in_app').notNullable().defaultTo(true);
      t.string('title', 200).notNullable();
      t.text('body').notNullable();
      t.timestamp('read_at');
      t.timestamp('archived_at');
      t.timestamp('created_at').notNullable().defaultTo(knex.fn.now());

      t.unique(['event_id', 'recipient_user_id']);
      t.index(['recipient_user_id', 'archived_at', 'read_at', 'created_at']);
    })
    .createTable('notification_deliveries', (t) => {
      t.bigIncrements('id').primary();
      t.bigInteger('notification_id').notNullable().references('id').inTable('notifications');
      t.integer('recipient_user_id').notNullable().references('id').inTable('users');
      t.string('channel', 16).notNullable().defaultTo('email');
      t.enu('status', ['pending', 'sending', 'sent', 'failed', 'dead', 'skipped']).notNullable().defaultTo('pending');
      t.integer('attempts').notNullable().defaultTo(0);
      t.timestamp('next_attempt_at').notNullable().defaultTo(knex.fn.now());
      t.timestamp('claimed_at');
      t.string('subject', 200).notNullable();
      t.text('body_text').notNullable();
      t.string('skip_reason', 64);
      t.text('last_error');
      t.string('provider_message_id', 255);
      t.timestamp('sent_at');
      t.timestamp('created_at').notNullable().defaultTo(knex.fn.now());
      t.timestamp('updated_at').notNullable().defaultTo(knex.fn.now());

      t.unique(['notification_id', 'channel']);
      t.index(['status', 'next_attempt_at']);
      t.index(['recipient_user_id', 'sent_at']);
      t.index(['created_at']);
    })
    .createTable('notification_rules', (t) => {
      t.string('type', 64).primary();
      t.boolean('enabled').notNullable();
      t.specificType('recipient_roles', 'text[]').notNullable();
      t.boolean('in_app').notNullable();
      t.boolean('email').notNullable();
      t.enu('severity', ['info', 'warning', 'critical']).notNullable();
      t.jsonb('thresholds').notNullable().defaultTo('{}');
      t.integer('cooldown_minutes').notNullable().defaultTo(0);
      t.integer('updated_by').references('id').inTable('users');
      t.timestamp('updated_at').notNullable().defaultTo(knex.fn.now());
    })
    .createTable('notification_preferences', (t) => {
      t.integer('user_id').notNullable().references('id').inTable('users');
      t.string('type', 64).notNullable();
      t.boolean('in_app_enabled').notNullable().defaultTo(true);
      t.boolean('email_enabled').notNullable().defaultTo(true);
      t.timestamp('updated_at').notNullable().defaultTo(knex.fn.now());
      t.primary(['user_id', 'type']);
    })
    .createTable('notification_templates', (t) => {
      t.string('type', 64).primary();
      t.string('title', 200).notNullable();
      t.text('body').notNullable();
      t.string('email_subject', 200).notNullable();
      t.text('email_body').notNullable();
      t.boolean('is_active').notNullable().defaultTo(true);
      t.integer('version').notNullable().defaultTo(1);
      t.integer('updated_by').references('id').inTable('users');
      t.timestamp('updated_at').notNullable().defaultTo(knex.fn.now());
    })
    .createTable('app_settings', (t) => {
      t.string('key', 64).primary();
      t.jsonb('value').notNullable();
      t.integer('updated_by').references('id').inTable('users');
      t.timestamp('updated_at').notNullable().defaultTo(knex.fn.now());
    });

  // One open event per dedup key: a second identical event while the first
  // is unresolved is dropped (or counted, for grouped events) by ON CONFLICT.
  await knex.raw(
    'CREATE UNIQUE INDEX notification_events_open_dedup ON notification_events (dedup_key) WHERE resolved_at IS NULL'
  );
};

exports.down = async function (knex) {
  await knex.schema
    .dropTableIfExists('app_settings')
    .dropTableIfExists('notification_templates')
    .dropTableIfExists('notification_preferences')
    .dropTableIfExists('notification_rules')
    .dropTableIfExists('notification_deliveries')
    .dropTableIfExists('notifications')
    .dropTableIfExists('notification_events');
};

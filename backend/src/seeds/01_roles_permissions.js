const crypto = require('crypto');
const bcrypt = require('bcrypt');

// Central permission list. Add new codes here as new modules/features are built.
const PERMISSIONS = [
  // Sales / POS
  'sales.create', 'sales.void', 'sales.view', 'sales.view_all',
  'returns.process',
  // Stock
  'stock.intake', 'stock.transfer', 'stock.adjust', 'stock.view', 'stock.movements.view',
  // Products & categories
  'products.manage', 'products.view',
  // Suppliers
  'suppliers.view', 'suppliers.manage',
  'supplier_deliveries.view', 'supplier_deliveries.manage',
  'supplier_payments.view', 'supplier_payments.manage',
  'supplier_returns.manage',
  // Institutions (customers)
  'institutions.view', 'institutions.manage',
  'institution_orders.view', 'institution_orders.manage',
  'institution_payments.view', 'institution_payments.manage',
  'customer_returns.manage', 'customer_returns.approve',
  // Ledger corrections: refunds, credit applications, reversals (managers)
  'ledger.manage',
  // Pricing / employees / settings (admin territory)
  'pricing.manage', 'employees.manage', 'settings.manage',
  // Reporting
  'reports.sales.view', 'reports.shrinkage.view', 'reports.financial.view',
  // Notifications / audit (admin territory)
  'notifications.manage', 'notifications.deliveries.manage', 'audit.view',
  // Daily business cycle (opening/closing/corrections)
  'day.view', 'day.open', 'day.close', 'day.corrections.request', 'day.review', 'day.reopen', 'day.history.view',
  'day.open.request', 'day.open.review',
];

const ROLE_PERMISSIONS = {
  // Cashiers only see their own sales (no sales.view_all) and no stock
  // movement history - least privilege for the till.
  cashier: [
    'sales.create', 'sales.view', 'returns.process',
    'stock.view', 'products.view',
    // Customer accounts: record credit sales and payments, see balances,
    // process returns (large ones wait for a manager)
    'institutions.view', 'institution_orders.view', 'institution_orders.manage',
    'institution_payments.view', 'institution_payments.manage', 'customer_returns.manage',
    // Cashiers ask a manager to open the day (never open it directly) and
    // submit the shop's single daily closing
    'day.view', 'day.open.request', 'day.close', 'day.corrections.request',
  ],
  store_keeper: [
    'sales.create', 'sales.view', 'sales.view_all', 'returns.process',
    'stock.intake', 'stock.transfer', 'stock.adjust', 'stock.view', 'stock.movements.view',
    'products.manage', 'products.view',
    // Receive goods and return them to suppliers; never pay suppliers
    'suppliers.view', 'supplier_deliveries.manage', 'supplier_deliveries.view', 'supplier_payments.view', 'supplier_returns.manage',
    'institutions.view', 'institution_orders.manage', 'institution_orders.view', 'institution_payments.view',
    // Store keepers ask a manager to open the day (never open it directly)
    // and can close it like a cashier
    'day.view', 'day.open.request', 'day.close',
  ],
  // Full access, including employee management and settings. Managers open the
  // day directly, so they never file opening requests (they approve them).
  store_manager: PERMISSIONS.filter((code) => code !== 'day.open.request'),
};

exports.seed = async function (knex) {
  // Wipe in FK-safe order for repeatable seeding in dev
  await knex('role_permissions').del();
  await knex('users').del();
  await knex('permissions').del();
  await knex('roles').del();

  const roleRows = await knex('roles')
    .insert([
      { name: 'store_manager', description: 'Full access: pricing, employees, financials, settings' },
      { name: 'cashier', description: 'Processes sales and returns' },
      { name: 'store_keeper', description: 'Handles sales, stock intake/transfers, supplier orders' },
    ])
    .returning(['id', 'name']);

  const permissionRows = await knex('permissions')
    .insert(PERMISSIONS.map((code) => ({ code })))
    .returning(['id', 'code']);

  const roleIdByName = Object.fromEntries(roleRows.map((r) => [r.name, r.id]));
  const permIdByCode = Object.fromEntries(permissionRows.map((p) => [p.code, p.id]));

  const mappings = [];
  for (const [roleName, codes] of Object.entries(ROLE_PERMISSIONS)) {
    for (const code of codes) {
      mappings.push({ role_id: roleIdByName[roleName], permission_id: permIdByCode[code] });
    }
  }
  await knex('role_permissions').insert(mappings);

  // Default admin account - password is generated fresh on every seed run and
  // printed once below. It is never hardcoded or written to disk, since this
  // seed file (and its history) ends up in the repo.
  const adminEmail = process.env.SEED_ADMIN_EMAIL || 'admin@shop.local';
  const generatedPassword = crypto.randomBytes(12).toString('base64url');
  const passwordHash = await bcrypt.hash(generatedPassword, 10);
  await knex('users').insert({
    full_name: 'Shop Admin',
    email: adminEmail,
    password_hash: passwordHash,
    role_id: roleIdByName.store_manager,
    status: 'active',
  });

  console.log('\n==============================================');
  console.log('Seeded default admin account (shown only once):');
  console.log(`  email:    ${adminEmail}`);
  console.log(`  password: ${generatedPassword}`);
  console.log('Save this now and change the password after first login.');
  console.log('==============================================\n');
};

// Exported so tests and scripts/check-permissions.js can read the canonical
// role mapping without running this (destructive) seed.
exports.PERMISSIONS = PERMISSIONS;
exports.ROLE_PERMISSIONS = ROLE_PERMISSIONS;

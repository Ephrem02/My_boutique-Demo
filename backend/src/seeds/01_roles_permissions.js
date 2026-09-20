const bcrypt = require('bcrypt');

// Central permission list. Add new codes here as new modules/features are built.
const PERMISSIONS = [
  // Sales / POS
  'sales.create', 'sales.void', 'sales.view',
  'returns.process',
  // Stock
  'stock.intake', 'stock.transfer', 'stock.adjust', 'stock.view',
  // Products & categories
  'products.manage', 'products.view',
  // Suppliers
  'suppliers.view', 'suppliers.manage',
  'supplier_deliveries.view', 'supplier_deliveries.manage',
  'supplier_payments.view', 'supplier_payments.manage',
  // Institutions
  'institutions.view', 'institutions.manage',
  'institution_orders.view', 'institution_orders.manage',
  'institution_payments.view', 'institution_payments.manage',
  // Pricing / employees / settings (admin territory)
  'pricing.manage', 'employees.manage', 'settings.manage',
  // Reporting
  'reports.sales.view', 'reports.shrinkage.view', 'reports.financial.view',
];

const ROLE_PERMISSIONS = {
  cashier: [
    'sales.create', 'sales.view', 'returns.process',
    'stock.view', 'products.view',
  ],
  store_keeper: [
    'sales.create', 'sales.view', 'returns.process',
    'stock.intake', 'stock.transfer', 'stock.adjust', 'stock.view',
    'products.manage', 'products.view',
    'suppliers.view', 'supplier_deliveries.manage', 'supplier_deliveries.view', 'supplier_payments.view',
    'institutions.view', 'institution_orders.manage', 'institution_orders.view', 'institution_payments.view',
  ],
  store_manager: PERMISSIONS, // full access, including employee management and settings
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

  // Default admin account - CHANGE THIS PASSWORD after first login
  const passwordHash = await bcrypt.hash('ChangeMe123!', 10);
  await knex('users').insert({
    full_name: 'Shop Admin',
    email: 'admin@shop.local',
    password_hash: passwordHash,
    role_id: roleIdByName.store_manager,
    status: 'active',
  });
};

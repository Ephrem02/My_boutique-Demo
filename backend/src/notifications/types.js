// Notification type catalogue - the single source of truth for defaults.
//
// Security model (enforced server-side in recipients.js, not just the UI):
//  - `permission` is a hard ceiling on who can receive a type: a role-based
//    recipient must hold it. Admins can narrow `recipient_roles` via rules,
//    never widen past this.
//  - `targets` are users the event is *about* (e.g. the cashier whose sale
//    was voided, the employee whose role changed). They receive it because
//    it concerns their own data, not because of a permission.
//  - `mandatory` types can't be disabled by an admin or opted out of by a
//    user (security and fraud-control alerts).
//  - `vars` is the complete allowlist of template placeholders for the type;
//    admin-edited templates may only reference these.
//
// Money values are passed pre-formatted as "12,500 RWF".

const ROLES = ['cashier', 'store_keeper', 'store_manager'];
const SEVERITIES = ['info', 'warning', 'critical'];
const CATEGORIES = ['inventory', 'sales', 'purchasing', 'users', 'security', 'system'];

const TYPES = {
  LOW_STOCK: {
    category: 'inventory', severity: 'warning', permission: 'stock.view',
    roles: ['store_keeper', 'store_manager'], inApp: true, email: true, cooldown: 60,
    vars: ['product_name', 'sku', 'quantity', 'reorder_level'],
    title: 'Low stock: {{product_name}}',
    body: '{{product_name}} ({{sku}}) is down to {{quantity}} units - at or below its reorder level of {{reorder_level}}.',
  },
  OUT_OF_STOCK: {
    category: 'inventory', severity: 'critical', permission: 'stock.view',
    roles: ['store_keeper', 'store_manager'], inApp: true, email: true, cooldown: 60,
    vars: ['product_name', 'sku'],
    title: 'Out of stock: {{product_name}}',
    body: '{{product_name}} ({{sku}}) has no stock left in any location.',
  },
  SHELF_EMPTY: {
    category: 'inventory', severity: 'warning', permission: 'stock.view',
    roles: ['store_keeper'], inApp: true, email: false, cooldown: 30,
    vars: ['product_name', 'sku', 'store_room_quantity'],
    title: 'Front shelf empty: {{product_name}}',
    body: 'The front shelf has run out of {{product_name}} ({{sku}}). Store room has {{store_room_quantity}} units.',
  },
  STOCK_REPLENISHED: {
    category: 'inventory', severity: 'info', permission: 'stock.view',
    roles: ['store_keeper', 'store_manager'], inApp: true, email: false,
    vars: ['product_name', 'sku', 'quantity'],
    title: 'Restocked: {{product_name}}',
    body: '{{product_name}} ({{sku}}) is back above its reorder level with {{quantity}} units.',
  },
  LARGE_DAMAGE: {
    category: 'inventory', severity: 'warning', permission: 'reports.shrinkage.view',
    roles: ['store_manager'], inApp: true, email: true,
    thresholds: { min_value_rwf: 50000 },
    vars: ['product_name', 'quantity', 'value_rwf', 'actor_name'],
    title: 'Large damage write-off: {{product_name}}',
    body: '{{actor_name}} recorded {{quantity}} damaged units of {{product_name}} worth {{value_rwf}} at cost.',
  },
  PRODUCT_CREATED: {
    category: 'inventory', severity: 'info', permission: 'products.view',
    roles: ['store_manager'], inApp: true, email: false,
    vars: ['product_name', 'sku', 'actor_name'],
    title: 'New product: {{product_name}}',
    body: '{{actor_name}} added {{product_name}} ({{sku}}).',
  },
  PRICE_CHANGED: {
    category: 'inventory', severity: 'info', permission: 'products.view',
    roles: ['store_keeper', 'store_manager'], inApp: true, email: false,
    vars: ['product_name', 'old_price_rwf', 'new_price_rwf', 'actor_name'],
    title: 'Price changed: {{product_name}}',
    body: '{{actor_name}} changed the selling price of {{product_name}} from {{old_price_rwf}} to {{new_price_rwf}}.',
  },
  PRODUCT_DEACTIVATED: {
    category: 'inventory', severity: 'info', permission: 'products.view',
    roles: ['store_keeper', 'store_manager'], inApp: true, email: false,
    vars: ['product_name', 'sku', 'actor_name'],
    title: 'Product deactivated: {{product_name}}',
    body: '{{actor_name}} deactivated {{product_name}} ({{sku}}). It no longer appears at the till.',
  },
  HIGH_VALUE_SALE: {
    category: 'sales', severity: 'info', permission: 'sales.view_all',
    roles: ['store_manager'], inApp: true, email: false,
    thresholds: { min_amount_rwf: 500000 },
    vars: ['sale_id', 'amount_rwf', 'cashier_name', 'payment_method'],
    title: 'High-value sale #{{sale_id}}: {{amount_rwf}}',
    body: '{{cashier_name}} completed sale #{{sale_id}} for {{amount_rwf}} ({{payment_method}}).',
  },
  SALE_VOIDED: {
    category: 'sales', severity: 'warning', permission: 'sales.view_all', mandatory: true,
    roles: ['store_manager', 'cashier'], inApp: true, email: true,
    vars: ['sale_id', 'amount_rwf', 'cashier_name', 'actor_name'],
    title: 'Sale #{{sale_id}} voided',
    body: '{{actor_name}} voided sale #{{sale_id}} ({{amount_rwf}}) made by {{cashier_name}}. Its items were returned to stock.',
  },
  REFUND_PROCESSED: {
    category: 'sales', severity: 'warning', permission: 'sales.view_all',
    roles: ['store_manager'], inApp: true, email: false,
    thresholds: { min_amount_rwf: 0 },
    vars: ['sale_id', 'product_name', 'quantity', 'amount_rwf', 'restocked', 'actor_name'],
    title: 'Refund on sale #{{sale_id}}: {{amount_rwf}}',
    body: '{{actor_name}} refunded {{quantity}} x {{product_name}} ({{amount_rwf}}) from sale #{{sale_id}}. Returned to shelf: {{restocked}}.',
  },
  SUSPICIOUS_ACTIVITY: {
    category: 'sales', severity: 'critical', permission: 'sales.view_all', mandatory: true,
    roles: ['store_manager'], inApp: true, email: true,
    thresholds: { refunds_per_hour: 5 },
    vars: ['user_name', 'refund_count', 'window_minutes'],
    title: 'Unusual refund activity by {{user_name}}',
    body: '{{user_name}} has processed {{refund_count}} refunds in the last {{window_minutes}} minutes. Please review.',
  },
  DELIVERY_RECEIVED: {
    category: 'purchasing', severity: 'info', permission: 'supplier_payments.view',
    roles: ['store_manager'], inApp: true, email: false,
    vars: ['supplier_name', 'delivery_id', 'amount_rwf', 'due_date', 'actor_name'],
    title: 'Delivery received from {{supplier_name}}',
    body: '{{actor_name}} recorded delivery #{{delivery_id}} from {{supplier_name}} worth {{amount_rwf}}. Payment due: {{due_date}}.',
  },
  SUPPLIER_PAYMENT_DUE: {
    category: 'purchasing', severity: 'warning', permission: 'supplier_payments.view',
    roles: ['store_manager'], inApp: true, email: true,
    thresholds: { days_before: 3 },
    vars: ['supplier_name', 'delivery_id', 'balance_rwf', 'due_date'],
    title: 'Supplier payment due: {{supplier_name}}',
    body: '{{balance_rwf}} is due to {{supplier_name}} for delivery #{{delivery_id}} on {{due_date}}.',
  },
  SUPPLIER_PAYMENT_OVERDUE: {
    category: 'purchasing', severity: 'critical', permission: 'supplier_payments.view',
    roles: ['store_manager'], inApp: true, email: true,
    vars: ['supplier_name', 'delivery_id', 'balance_rwf', 'due_date'],
    title: 'Overdue supplier payment: {{supplier_name}}',
    body: '{{balance_rwf}} owed to {{supplier_name}} for delivery #{{delivery_id}} was due on {{due_date}}.',
  },
  OVERPAYMENT: {
    category: 'purchasing', severity: 'warning', permission: 'reports.financial.view', mandatory: true,
    roles: ['store_manager'], inApp: true, email: true,
    vars: ['party_type', 'party_name', 'reference_id', 'total_rwf', 'paid_rwf'],
    title: 'Overpayment recorded: {{party_name}}',
    body: 'Payments on {{party_type}} #{{reference_id}} ({{party_name}}) now total {{paid_rwf}}, more than the {{total_rwf}} owed.',
  },
  INSTITUTION_ORDER_CREATED: {
    category: 'sales', severity: 'info', permission: 'institution_payments.view',
    roles: ['store_manager'], inApp: true, email: false,
    vars: ['institution_name', 'order_id', 'amount_rwf', 'actor_name'],
    title: 'New order from {{institution_name}}',
    body: '{{actor_name}} recorded order #{{order_id}} for {{institution_name}} worth {{amount_rwf}} (on credit).',
  },
  INSTITUTION_ORDER_DELIVERED: {
    category: 'sales', severity: 'info', permission: 'institution_orders.view',
    roles: ['store_manager'], inApp: true, email: false,
    vars: ['institution_name', 'order_id', 'actor_name'],
    title: 'Order #{{order_id}} delivered',
    body: '{{actor_name}} marked order #{{order_id}} for {{institution_name}} as delivered.',
  },
  INSTITUTION_PAYMENT_RECEIVED: {
    category: 'sales', severity: 'info', permission: 'institution_payments.view',
    roles: ['store_manager'], inApp: true, email: false,
    vars: ['institution_name', 'order_id', 'amount_rwf', 'balance_rwf', 'actor_name'],
    title: 'Payment received from {{institution_name}}',
    body: '{{actor_name}} recorded {{amount_rwf}} from {{institution_name}} on order #{{order_id}}. Remaining balance: {{balance_rwf}}.',
  },
  USER_CREATED: {
    category: 'users', severity: 'info', permission: 'employees.manage', mandatory: true, targetAlways: true,
    roles: ['store_manager'], inApp: true, email: true,
    vars: ['user_name', 'role', 'actor_name'],
    title: 'New account: {{user_name}}',
    body: '{{actor_name}} created an account for {{user_name}} with the role {{role}}. The password is shared in person, never by email.',
  },
  ACCOUNT_ROLE_CHANGED: {
    category: 'users', severity: 'warning', permission: 'employees.manage', mandatory: true, targetAlways: true,
    roles: ['store_manager'], inApp: true, email: true,
    vars: ['user_name', 'old_role', 'new_role', 'actor_name'],
    title: 'Role changed for {{user_name}}',
    body: "{{actor_name}} changed {{user_name}}'s role from {{old_role}} to {{new_role}}.",
  },
  ACCOUNT_DISABLED: {
    category: 'users', severity: 'warning', permission: 'employees.manage', mandatory: true, targetAlways: true,
    roles: ['store_manager'], inApp: true, email: true,
    vars: ['user_name', 'actor_name'],
    title: 'Account disabled: {{user_name}}',
    body: "{{actor_name}} disabled {{user_name}}'s account.",
  },
  ACCOUNT_PASSWORD_RESET: {
    category: 'users', severity: 'warning', permission: 'employees.manage', mandatory: true, targetAlways: true,
    roles: ['store_manager'], inApp: true, email: true,
    vars: ['user_name', 'actor_name'],
    title: 'Password reset for {{user_name}}',
    body: "{{actor_name}} reset {{user_name}}'s password. All of that account's existing sessions were signed out. If this wasn't expected, tell your manager.",
  },
  FAILED_LOGIN_BURST: {
    category: 'security', severity: 'critical', permission: 'audit.view', mandatory: true,
    roles: ['store_manager'], inApp: true, email: true,
    thresholds: { failures: 5, window_minutes: 15 },
    vars: ['identifier', 'failure_count', 'window_minutes', 'ip'],
    title: 'Repeated failed logins for {{identifier}}',
    body: '{{failure_count}} failed sign-in attempts for {{identifier}} in {{window_minutes}} minutes (latest from {{ip}}).',
  },
  ACCESS_DENIED_BURST: {
    category: 'security', severity: 'warning', permission: 'audit.view', mandatory: true,
    roles: ['store_manager'], inApp: true, email: false,
    thresholds: { denials: 10, window_minutes: 10 },
    vars: ['user_name', 'denial_count', 'window_minutes'],
    title: 'Repeated access denials for {{user_name}}',
    body: '{{user_name}} was refused access {{denial_count}} times in {{window_minutes}} minutes. This can indicate probing for admin features.',
  },
  SYSTEM_ERROR: {
    category: 'system', severity: 'critical', permission: 'settings.manage', mandatory: true,
    roles: ['store_manager'], inApp: true, email: false,
    vars: ['path', 'request_id'],
    title: 'Server errors detected',
    body: 'The server hit an unexpected error (first seen on {{path}}, request {{request_id}}). Check the server logs.',
  },
  EMAIL_DELIVERY_FAILED: {
    category: 'system', severity: 'warning', permission: 'notifications.deliveries.manage', mandatory: true,
    roles: ['store_manager'], inApp: true, email: false, emailAllowed: false,
    vars: ['recipient_name', 'subject'],
    title: 'Email delivery failed',
    body: 'An email to {{recipient_name}} ("{{subject}}") could not be delivered. See Admin > Deliveries.',
  },
  MANUAL: {
    category: 'system', severity: 'info', permission: null, manual: true,
    roles: [], inApp: true, email: false,
    vars: ['title', 'message', 'sender_name'],
    title: '{{title}}',
    body: '{{message}}\n\n- {{sender_name}}',
  },
};

for (const def of Object.values(TYPES)) {
  def.thresholds = def.thresholds || {};
  def.cooldown = def.cooldown || 0;
  def.emailSubject = def.emailSubject || def.title;
  def.emailBody = def.emailBody || def.body;
}

module.exports = { TYPES, ROLES, SEVERITIES, CATEGORIES };

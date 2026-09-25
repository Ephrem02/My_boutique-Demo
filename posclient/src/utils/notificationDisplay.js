// Display helpers shared by the bell, the notification centre and admin pages.

export const SEVERITY_BADGE = {
  info: 'paid',
  warning: 'partial',
  critical: 'unpaid',
};

/** LOW_STOCK -> "Low stock" when there's no translation. */
export function humanizeType(type) {
  const s = String(type || '').toLowerCase().replace(/_/g, ' ');
  return s.charAt(0).toUpperCase() + s.slice(1);
}

// Where a notification's "open" goes. The target page enforces its own
// permissions server-side; this only avoids offering links the user can't use.
const LINKS = {
  product: { path: '/products', permission: 'products.view' },
  sale: { path: '/sales-history', permission: 'sales.view' },
  supplier_delivery: { path: '/suppliers', permission: 'suppliers.view' },
  institution_order: { path: '/institutions', permission: 'institutions.view' },
  user: { path: '/employees', permission: 'employees.manage' },
  notification_delivery: { path: '/admin/notifications?tab=deliveries', permission: 'notifications.deliveries.manage' },
};

export function linkFor(notification, hasPermission) {
  if (notification.entity_type === 'business_day') {
    // Managers get the day's full report; everyone else the dashboard boards
    return hasPermission('day.history.view') ? `/business-days/${notification.entity_id}` : '/';
  }
  const link = LINKS[notification.entity_type];
  if (!link || !hasPermission(link.permission)) return null;
  return link.path;
}

export function timeAgo(date, t) {
  const seconds = Math.max(0, Math.round((Date.now() - new Date(date).getTime()) / 1000));
  if (seconds < 60) return t('notifications.justNow');
  const minutes = Math.round(seconds / 60);
  if (minutes < 60) return t('notifications.minutesAgo', { count: minutes });
  const hours = Math.round(minutes / 60);
  if (hours < 24) return t('notifications.hoursAgo', { count: hours });
  return new Date(date).toLocaleDateString();
}

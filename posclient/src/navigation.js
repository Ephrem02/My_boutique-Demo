import {
  LayoutDashboard, ShoppingCart, ReceiptText, Package, Boxes, Truck, Building2, Bell, BarChart3,
  CalendarCheck2, FileCheck2, Settings2, MoreHorizontal,
} from 'lucide-react';

// Single source for navigation. `anyOf` hides links the user can't use -
// convenience only; the API enforces every permission itself.
export const ADMIN_PERMISSIONS = ['notifications.manage', 'notifications.deliveries.manage', 'settings.manage', 'audit.view', 'employees.manage'];

export const NAV_GROUPS = [
  {
    id: 'operations',
    items: [
      { id: 'dashboard', to: '/', end: true, icon: LayoutDashboard, anyOf: ['day.view'] },
      { id: 'sell', to: '/pos', icon: ShoppingCart, anyOf: ['sales.create'] },
      { id: 'history', to: '/sales-history', icon: ReceiptText, anyOf: ['sales.view'] },
      { id: 'products', to: '/products', icon: Package, anyOf: ['products.view'] },
      { id: 'stock', to: '/stock', icon: Boxes, anyOf: ['stock.view'] },
      { id: 'suppliers', to: '/suppliers', icon: Truck, anyOf: ['suppliers.view'] },
      { id: 'clients', to: '/institutions', icon: Building2, anyOf: ['institutions.view'] },
      { id: 'notifications', to: '/notifications', icon: Bell, anyOf: null },
    ],
  },
  {
    id: 'management',
    items: [
      { id: 'reports', to: '/reports', icon: BarChart3, anyOf: ['reports.sales.view', 'reports.shrinkage.view', 'reports.financial.view'] },
      { id: 'businessDays', to: '/business-days', icon: CalendarCheck2, anyOf: ['day.history.view'] },
      { id: 'corrections', to: '/closing/corrections', icon: FileCheck2, anyOf: ['day.corrections.request', 'day.review'] },
      { id: 'admin', to: '/admin', icon: Settings2, anyOf: ADMIN_PERMISSIONS },
    ],
  },
];

// Phone bottom bar: at most 4 destinations + More, tuned per role (UX only).
const BOTTOM = {
  store_manager: ['dashboard', 'sell', 'stock', 'notifications'],
  store_keeper: ['dashboard', 'stock', 'products', 'notifications'],
  cashier: ['dashboard', 'sell', 'history', 'notifications'],
};

export function visibleGroups(hasPermission) {
  return NAV_GROUPS.map((group) => ({
    ...group,
    items: group.items.filter((item) => !item.anyOf || hasPermission(...item.anyOf)),
  })).filter((group) => group.items.length);
}

export function bottomNavItems(role, hasPermission) {
  const all = NAV_GROUPS.flatMap((g) => g.items);
  const ids = BOTTOM[role] || BOTTOM.cashier;
  return ids
    .map((id) => all.find((item) => item.id === id))
    .filter((item) => item && (!item.anyOf || hasPermission(...item.anyOf)));
}

export const MORE_ICON = MoreHorizontal;

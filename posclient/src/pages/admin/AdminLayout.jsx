import { Link, NavLink, Outlet } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import { Activity, BellRing, CalendarClock, ChevronRight, FileText, Mail, Send, ShieldCheck, Users, Megaphone } from 'lucide-react';
import { useAuth } from '../../context/AuthContext';
import { PageHeader } from '../../ui/display';

// Admin (global) configuration, clearly separate from personal /settings.
// Every section's API enforces its own permission; hiding is convenience.
export const ADMIN_SECTIONS = [
  { id: 'monitoring', to: '/admin/monitoring', icon: Activity, anyOf: ['notifications.manage'], group: 'overview' },
  { id: 'closing', to: '/admin/closing', icon: CalendarClock, anyOf: ['settings.manage'], group: 'business' },
  { id: 'users', to: '/admin/users', icon: Users, anyOf: ['employees.manage'], group: 'business' },
  { id: 'rules', to: '/admin/notifications/rules', icon: BellRing, anyOf: ['notifications.manage'], group: 'notifications' },
  { id: 'templates', to: '/admin/notifications/templates', icon: FileText, anyOf: ['notifications.manage'], group: 'notifications' },
  { id: 'send', to: '/admin/notifications/send', icon: Megaphone, anyOf: ['notifications.manage'], group: 'notifications' },
  { id: 'email', to: '/admin/email', icon: Mail, anyOf: ['settings.manage'], group: 'notifications' },
  { id: 'deliveries', to: '/admin/deliveries', icon: Send, anyOf: ['notifications.deliveries.manage'], group: 'notifications' },
  { id: 'audit', to: '/admin/audit', icon: ShieldCheck, anyOf: ['audit.view'], group: 'security' },
];
const GROUPS = ['overview', 'business', 'notifications', 'security'];

function useSections() {
  const { hasPermission } = useAuth();
  return ADMIN_SECTIONS.filter((s) => hasPermission(...s.anyOf));
}

export default function AdminLayout() {
  const { t } = useTranslation();
  const sections = useSections();
  return (
    <div className="page admin-page">
      <PageHeader title={t('admin.title')} subtitle={t('admin.subtitle')} />
      <div className="admin-layout">
        <nav className="admin-nav" aria-label={t('admin.title')}>
          {GROUPS.map((group) => {
            const items = sections.filter((s) => s.group === group);
            if (!items.length) return null;
            return (
              <div key={group} className="admin-nav-group">
                <div className="nav-group-label">{t(`admin.groups.${group}`)}</div>
                {items.map(({ id, to, icon: Icon }) => (
                  <NavLink key={id} to={to} className={({ isActive }) => `nav-link${isActive ? ' active' : ''}`}>
                    <Icon className="nav-icon" aria-hidden="true" />
                    <span className="nav-label">{t(`admin.sections.${id}.title`)}</span>
                  </NavLink>
                ))}
              </div>
            );
          })}
        </nav>
        <div className="admin-content">
          <Outlet />
        </div>
      </div>
    </div>
  );
}

/** /admin - a hub of the sections this person can manage. */
export function AdminHome() {
  const { t } = useTranslation();
  const sections = useSections();
  return (
    <div className="admin-hub">
      {sections.map(({ id, to, icon: Icon }) => (
        <Link key={id} to={to} className="hub-card">
          <span className="hub-card-icon" aria-hidden="true"><Icon /></span>
          <span className="hub-card-text">
            <span className="hub-card-title">{t(`admin.sections.${id}.title`)}</span>
            <span className="hub-card-description">{t(`admin.sections.${id}.description`)}</span>
          </span>
          <ChevronRight className="hub-card-chevron" aria-hidden="true" />
        </Link>
      ))}
    </div>
  );
}

import { Link, NavLink, Outlet, useNavigate } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import { useAuth } from '../context/AuthContext';
import LanguageSwitcher from './LanguageSwitcher';
import NotificationBell from './NotificationBell';

export default function Layout() {
  const { t } = useTranslation();
  const { user, logout, hasPermission } = useAuth();
  const navigate = useNavigate();

  async function handleLogout() {
    await logout();
    navigate('/login');
  }

  return (
    <div className="app-shell">
      <aside className="sidebar">
        <div className="sidebar-top">
          <Link to="/" className="sidebar-brand">{t('nav.brand')}</Link>
          <NotificationBell />
        </div>

        <nav className="sidebar-nav">
          {hasPermission('sales.create', 'sales.view') && (
            <NavLink to="/" end className={({ isActive }) => `sidebar-link${isActive ? ' active' : ''}`}>
              {t('nav.sales')}
            </NavLink>
          )}
          {hasPermission('sales.view') && (
            <NavLink to="/sales-history" className={({ isActive }) => `sidebar-link${isActive ? ' active' : ''}`}>
              {t('nav.history')}
            </NavLink>
          )}
          {hasPermission('suppliers.view') && (
            <NavLink to="/suppliers" className={({ isActive }) => `sidebar-link${isActive ? ' active' : ''}`}>
              {t('nav.suppliers')}
            </NavLink>
          )}
          {hasPermission('institutions.view') && (
            <NavLink to="/institutions" className={({ isActive }) => `sidebar-link${isActive ? ' active' : ''}`}>
              {t('nav.institutions')}
            </NavLink>
          )}
          {hasPermission('products.view') && (
            <NavLink to="/products" className={({ isActive }) => `sidebar-link${isActive ? ' active' : ''}`}>
              {t('nav.products')}
            </NavLink>
          )}
          {hasPermission('stock.view') && (
            <NavLink to="/stock" className={({ isActive }) => `sidebar-link${isActive ? ' active' : ''}`}>
              {t('nav.stock')}
            </NavLink>
          )}
          {hasPermission('employees.manage') && (
            <NavLink to="/employees" className={({ isActive }) => `sidebar-link${isActive ? ' active' : ''}`}>
              {t('nav.employees')}
            </NavLink>
          )}
          {hasPermission('reports.sales.view', 'reports.shrinkage.view', 'reports.financial.view') && (
            <NavLink to="/reports" className={({ isActive }) => `sidebar-link${isActive ? ' active' : ''}`}>
              {t('nav.reports')}
            </NavLink>
          )}
          <NavLink to="/notifications" className={({ isActive }) => `sidebar-link${isActive ? ' active' : ''}`}>
            {t('nav.notifications')}
          </NavLink>
          {hasPermission('notifications.manage', 'notifications.deliveries.manage', 'settings.manage', 'audit.view') && (
            <NavLink to="/admin/notifications" className={({ isActive }) => `sidebar-link${isActive ? ' active' : ''}`}>
              {t('nav.admin')}
            </NavLink>
          )}
        </nav>

        <div className="sidebar-footer">
          <LanguageSwitcher />
          <span className="sidebar-user">
            {user?.full_name} · {t(`roles.${user?.role}`, { defaultValue: user?.role?.replace('_', ' ') })}
          </span>
          <button className="btn btn-block" onClick={handleLogout}>
            {t('nav.signOut')}
          </button>
        </div>
      </aside>

      <div className="main-content">
        <Outlet />
      </div>
    </div>
  );
}

import { useEffect, useState } from 'react';
import { Link, NavLink, Outlet, useLocation } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import { Menu, Store } from 'lucide-react';
import { useAuth } from '../context/AuthContext';
import { useBusinessDay } from '../context/BusinessDayContext';
import { useNotifications } from '../context/NotificationContext';
import { visibleGroups, bottomNavItems, MORE_ICON } from '../navigation';
import { IconButton } from '../ui/Button';
import Dialog from '../ui/Dialog';
import { StatusBadge } from '../ui/display';
import NotificationBell from './NotificationBell';
import UserMenu from './UserMenu';

const DAY_TONE = { open: 'success', closing_in_progress: 'warning', none: 'neutral' };

function NavList({ hasPermission, onNavigate }) {
  const { t } = useTranslation();
  const { unread } = useNotifications();
  return visibleGroups(hasPermission).map((group) => (
    <div key={group.id} className="nav-group">
      <div className="nav-group-label">{t(`nav.groups.${group.id}`)}</div>
      <ul>
        {group.items.map(({ id, to, end, icon: Icon }) => (
          <li key={id}>
            <NavLink to={to} end={end} className={({ isActive }) => `nav-link${isActive ? ' active' : ''}`} onClick={onNavigate}>
              <Icon className="nav-icon" aria-hidden="true" />
              <span className="nav-label">{t(`nav.items.${id}`)}</span>
              {id === 'notifications' && unread > 0 && <span className="nav-count num">{unread > 99 ? '99+' : unread}</span>}
            </NavLink>
          </li>
        ))}
      </ul>
    </div>
  ));
}

/** Business-day status in the header - visible on every screen. */
function DayStatusPill() {
  const { t } = useTranslation();
  const { status } = useBusinessDay();
  if (!status) return null;
  return (
    <Link to="/" className="day-pill" aria-label={t('shell.dayStatus', { status: t(`shell.day.${status}`) })}>
      <StatusBadge tone={DAY_TONE[status]}>{t(`shell.day.${status}`)}</StatusBadge>
    </Link>
  );
}

/**
 * App shell. Desktop (≥1024): sidebar + header. Tablet: header + menu
 * drawer. Phone (<640): compact header + role-based bottom navigation.
 */
export default function Layout() {
  const { t } = useTranslation();
  const { user, hasPermission } = useAuth();
  const { unread } = useNotifications();
  const [drawerOpen, setDrawerOpen] = useState(false);
  const location = useLocation();
  const bottomItems = bottomNavItems(user?.role, hasPermission);

  // Close the drawer whenever the route changes
  useEffect(() => setDrawerOpen(false), [location.pathname]);

  return (
    <div className="app">
      <a href="#main" className="skip-link">{t('shell.skipToContent')}</a>

      <aside className="sidebar" aria-label={t('shell.mainNavigation')}>
        <Link to="/" className="brand">
          <span className="brand-mark" aria-hidden="true"><Store /></span>
          <span className="brand-name">{t('nav.brand')}</span>
        </Link>
        <nav className="sidebar-nav">
          <NavList hasPermission={hasPermission} />
        </nav>
      </aside>

      <div className="app-main">
        <header className="app-header">
          <IconButton icon={Menu} label={t('shell.openMenu')} className="header-menu-button" onClick={() => setDrawerOpen(true)} />
          <Link to="/" className="brand header-brand">
            <span className="brand-mark" aria-hidden="true"><Store /></span>
            <span className="brand-name">{t('nav.brand')}</span>
          </Link>
          <div className="header-spacer" />
          <DayStatusPill />
          <NotificationBell />
          <UserMenu />
        </header>

        <main id="main" className="app-content" tabIndex={-1}>
          <Outlet />
        </main>
      </div>

      {bottomItems.length > 0 && (
        <nav className="bottom-nav" aria-label={t('shell.quickNavigation')}>
          {bottomItems.map(({ id, to, end, icon: Icon }) => (
            <NavLink key={id} to={to} end={end} className={({ isActive }) => `bottom-nav-item${isActive ? ' active' : ''}`}>
              <span className="bottom-nav-icon">
                <Icon aria-hidden="true" />
                {id === 'notifications' && unread > 0 && <span className="count-badge num" aria-hidden="true">{unread > 99 ? '99+' : unread}</span>}
              </span>
              <span className="bottom-nav-label">{t(`nav.items.${id}`)}</span>
            </NavLink>
          ))}
          <button type="button" className="bottom-nav-item" onClick={() => setDrawerOpen(true)} aria-haspopup="dialog">
            <span className="bottom-nav-icon"><MORE_ICON aria-hidden="true" /></span>
            <span className="bottom-nav-label">{t('nav.items.more')}</span>
          </button>
        </nav>
      )}

      {drawerOpen && (
        <Dialog variant="drawer" title={t('shell.menu')} onClose={() => setDrawerOpen(false)}>
          <nav aria-label={t('shell.mainNavigation')} className="drawer-nav">
            <NavList hasPermission={hasPermission} onNavigate={() => setDrawerOpen(false)} />
          </nav>
        </Dialog>
      )}
    </div>
  );
}
